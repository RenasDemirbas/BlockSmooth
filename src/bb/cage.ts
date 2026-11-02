// Read a Blockbench mesh as a subdivision cage: its topology (with the
// Blockbench-side index of every face and corner, so viewport highlight,
// material groups and UVs can be looked up), positions, corner UVs and edge marks.

import { buildTopology, type Topology } from '../core/topology';
import { edgeKey } from '../model/edges';
import type { SmoothData } from '../model/schema';

export interface Cage {
  readonly topology: Topology;
  /** Cage vertex index -> Blockbench vertex key. */
  readonly vertexKeys: string[];
  readonly vertexIndex: Map<string, number>;
  /** Cage face index -> Blockbench face key. */
  readonly faceKeys: string[];
  /** Cage face -> first corner of that face in Blockbench's per-corner buffers (highlight, uv). */
  readonly bbCornerStart: Int32Array;
  /** Cage face -> first index of that face in Blockbench's index buffer (material groups). */
  readonly bbIndexStart: Int32Array;
  /** Cage corner -> Blockbench per-corner buffer slot (Blockbench stores corners unsorted). */
  readonly bbCorner: Int32Array;
  /** Changes whenever faces, their vertex loops or the vertex set change. */
  readonly signature: string;
  /** quickSignature() of the mesh this cage was read from. */
  readonly quick: string;
}

/**
 * Cheap topology fingerprint (keys only, no quad sorting). Equal values mean
 * the topology is unchanged unless vertices moved so far that a quad's sorted
 * loop flipped — geometry updates therefore always re-read the full cage.
 */
export function quickSignature(mesh: any): string {
  const parts: string[] = [Object.keys(mesh.vertices).join(',')];
  for (const fkey in mesh.faces) parts.push(`${fkey}:${mesh.faces[fkey].vertices.join(',')}`);
  return parts.join('|');
}

/**
 * Faces with fewer than 3 vertices (loose edges) or a repeated vertex are
 * skipped: they draw nothing, and Catmull-Clark needs proper polygons.
 * Quads are read in Blockbench's sorted loop order (the order it renders).
 */
export function readCage(mesh: any): Cage {
  const vertexKeys = Object.keys(mesh.vertices);
  const vertexIndex = new Map<string, number>();
  vertexKeys.forEach((k, i) => vertexIndex.set(k, i));

  const faceKeys: string[] = [];
  const offsets: number[] = [0];
  const verts: number[] = [];
  const bbCornerStart: number[] = [];
  const bbIndexStart: number[] = [];
  const bbCorner: number[] = [];
  const signature: string[] = [vertexKeys.join(',')];
  let cornerCursor = 0, indexCursor = 0;

  for (const fkey in mesh.faces) {
    const face = mesh.faces[fkey];
    const raw: string[] = face.vertices;
    if (raw.length < 3) continue;
    const startCorner = cornerCursor, startIndex = indexCursor;
    cornerCursor += raw.length;
    indexCursor += raw.length === 3 ? 3 : raw.length === 4 ? 6 : 0;

    const loop: string[] = raw.length === 4 ? face.getSortedVertices() : raw;
    const ids = loop.map((k) => vertexIndex.get(k));
    if (raw.length > 4 || ids.some((i) => i === undefined) || new Set(ids).size !== ids.length) continue;

    faceKeys.push(fkey);
    bbCornerStart.push(startCorner);
    bbIndexStart.push(startIndex);
    for (let i = 0; i < loop.length; i++) {
      verts.push(ids[i]!);
      bbCorner.push(startCorner + raw.indexOf(loop[i]));
    }
    offsets.push(verts.length);
    signature.push(`${fkey}:${loop.join(',')}`);
  }

  return {
    topology: buildTopology(vertexKeys.length, Int32Array.from(offsets), Int32Array.from(verts)),
    vertexKeys, vertexIndex, faceKeys,
    bbCornerStart: Int32Array.from(bbCornerStart),
    bbIndexStart: Int32Array.from(bbIndexStart),
    bbCorner: Int32Array.from(bbCorner),
    signature: signature.join('|'),
    quick: quickSignature(mesh),
  };
}

/** Cage positions, optionally displaced (armature deformation offsets by vertex key). */
export function readPositions(mesh: any, cage: Cage, offsets?: Record<string, number[]> | null): Float64Array {
  const out = new Float64Array(cage.vertexKeys.length * 3);
  cage.vertexKeys.forEach((key, i) => {
    const v = mesh.vertices[key];
    const o = offsets?.[key];
    out[3 * i] = v[0] + (o ? o[0] : 0);
    out[3 * i + 1] = v[1] + (o ? o[1] : 0);
    out[3 * i + 2] = v[2] + (o ? o[2] : 0);
  });
  return out;
}

/** Corner UVs in Blockbench UV units (face.uv), for writing baked faces. */
export function readFaceUVs(mesh: any, cage: Cage): Float64Array {
  const t = cage.topology;
  const out = new Float64Array(t.cornerCount * 2);
  for (let f = 0; f < t.faceCount; f++) {
    const face = mesh.faces[cage.faceKeys[f]];
    for (let c = t.faceOffsets[f]; c < t.faceOffsets[f + 1]; c++) {
      const uv = face.uv[cage.vertexKeys[t.faceVerts[c]]] || [0, 0];
      out[2 * c] = uv[0];
      out[2 * c + 1] = uv[1];
    }
  }
  return out;
}

/**
 * Corner UVs exactly as Blockbench shows them (normalized, animated-texture
 * frame applied), read from the cage's own geometry buffer.
 */
export function readDisplayUVs(mesh: any, cage: Cage): Float64Array {
  const t = cage.topology;
  const out = new Float64Array(t.cornerCount * 2);
  const attr = mesh.mesh?.geometry?.attributes?.uv;
  if (!attr) return out;
  for (let c = 0; c < t.cornerCount; c++) {
    const slot = cage.bbCorner[c];
    if (slot < attr.count) {
      out[2 * c] = attr.array[2 * slot];
      out[2 * c + 1] = attr.array[2 * slot + 1];
    }
  }
  return out;
}

/** Crease sharpness per cage edge (Blender's mapping: sharpness = 10 * crease², crease 1 = infinitely sharp). */
export function readSharpness(cage: Cage, data: SmoothData): Float64Array {
  const t = cage.topology;
  const out = new Float64Array(t.edgeCount);
  if (!Object.keys(data.creases).length) return out;
  for (let e = 0; e < t.edgeCount; e++) {
    const c = data.creases[edgeKey(cage.vertexKeys[t.edgeVerts[2 * e]], cage.vertexKeys[t.edgeVerts[2 * e + 1]])];
    if (c) out[e] = c >= 1 ? Infinity : 10 * c * c;
  }
  return out;
}

/** 1 for each cage edge marked sharp. */
export function readSharpEdges(cage: Cage, data: SmoothData): Uint8Array {
  const t = cage.topology;
  const out = new Uint8Array(t.edgeCount);
  if (!Object.keys(data.sharp).length) return out;
  for (let e = 0; e < t.edgeCount; e++) {
    if (data.sharp[edgeKey(cage.vertexKeys[t.edgeVerts[2 * e]], cage.vertexKeys[t.edgeVerts[2 * e + 1]])]) out[e] = 1;
  }
  return out;
}
