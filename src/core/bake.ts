// Turn an evaluated surface into a plain polygon list that a file format (or
// Blockbench's own mesh) can hold: either one vertex per topology vertex
// (connected, for further modeling) or one vertex per normal fan (split along
// sharp edges, so per-vertex normals reproduce the shading). Corners keep their
// order, so per-corner data (UVs) indexes the same way. Pure — no Blockbench globals.

import type { CornerNormals } from './normals';
import type { Topology } from './topology';

export interface BakedMesh {
  readonly vertexCount: number;
  /** 3 per baked vertex. */
  readonly positions: Float64Array;
  /** 3 per baked vertex, or null when the shading is flat. */
  readonly normals: Float32Array | null;
  /** Baked vertex -> topology vertex it copies (for per-vertex data such as bone weights). */
  readonly vertexSource: Int32Array;
  readonly faceOffsets: Int32Array;
  /** Corner -> baked vertex. Corner c is corner c of the topology. */
  readonly faceVerts: Int32Array;
}

/** One baked vertex per topology vertex that a face uses. */
export function bakeConnected(t: Topology, positions: ArrayLike<number>): BakedMesh {
  const map = new Int32Array(t.vertexCount).fill(-1);
  const source: number[] = [];
  const faceVerts = new Int32Array(t.cornerCount);
  for (let c = 0; c < t.cornerCount; c++) {
    const v = t.faceVerts[c];
    if (map[v] < 0) { map[v] = source.length; source.push(v); }
    faceVerts[c] = map[v];
  }
  return finish(source, positions, null, t.faceOffsets, faceVerts);
}

/** One baked vertex per normal fan: vertices split where the shading is sharp. */
export function bakeSplit(t: Topology, positions: ArrayLike<number>, cn: CornerNormals): BakedMesh {
  const source = new Int32Array(cn.fanCount);
  const normals = new Float32Array(cn.fanCount * 3);
  for (let c = 0; c < t.cornerCount; c++) {
    const k = cn.fan[c];
    source[k] = t.faceVerts[c];
    normals[3 * k] = cn.normals[3 * c]; normals[3 * k + 1] = cn.normals[3 * c + 1]; normals[3 * k + 2] = cn.normals[3 * c + 2];
  }
  return finish(Array.from(source), positions, normals, t.faceOffsets, Int32Array.from(cn.fan));
}

function finish(source: number[], positions: ArrayLike<number>, normals: Float32Array | null, faceOffsets: Int32Array, faceVerts: Int32Array): BakedMesh {
  const out = new Float64Array(source.length * 3);
  source.forEach((v, i) => {
    out[3 * i] = positions[3 * v]; out[3 * i + 1] = positions[3 * v + 1]; out[3 * i + 2] = positions[3 * v + 2];
  });
  return { vertexCount: source.length, positions: out, normals, vertexSource: Int32Array.from(source), faceOffsets, faceVerts };
}
