// Vertex sharing for drawing and exporting. Pure — no Blockbench globals.
//
// A subdivided surface is naturally described per corner (each corner has its
// own normal fan and UV), which costs 4 GPU vertices per quad. Two corners can
// share one vertex when everything drawn at them is identical:
//  - shareCorners(): structural sharing for the live display. Corners share when
//    they sit on the same final vertex, in the same normal fan and in the same
//    cage face (UVs, material and highlight are per cage face).
//  - weldVertices(): exact sharing for an already-built attribute set (export):
//    vertices merge only when every attribute value is bit-identical.

import type { Topology } from './topology';

export interface CornerSharing {
  readonly vertexCount: number;
  /** Corner -> shared vertex. */
  readonly cornerVertex: Int32Array;
  /** Shared vertex -> one of its corners (the first), to read per-corner data from. */
  readonly vertexCorner: Int32Array;
}

/** Group corners by (cage face, normal fan). faceOrigin: final face -> cage face. */
export function shareCorners(t: Topology, faceOrigin: Int32Array, fan: Int32Array, fanCount: number): CornerSharing {
  const ids = new Map<number, number>();
  const cornerVertex = new Int32Array(t.cornerCount);
  const reps: number[] = [];
  for (let c = 0; c < t.cornerCount; c++) {
    const key = faceOrigin[t.cornerFace[c]] * fanCount + fan[c];
    let v = ids.get(key);
    if (v === undefined) { v = reps.length; ids.set(key, v); reps.push(c); }
    cornerVertex[c] = v;
  }
  return { vertexCount: reps.length, cornerVertex, vertexCorner: Int32Array.from(reps) };
}

/**
 * True when no shared vertex mixes corners of different fans. Fans can split
 * while a mesh deforms (smooth-by-angle); a sharing built for coarser fans would
 * then blur a sharp edge and must be rebuilt.
 */
export function sharingFits(sharing: CornerSharing, fan: Int32Array): boolean {
  const { cornerVertex, vertexCorner } = sharing;
  if (cornerVertex.length !== fan.length) return false;
  for (let c = 0; c < cornerVertex.length; c++) {
    if (fan[c] !== fan[vertexCorner[cornerVertex[c]]]) return false;
  }
  return true;
}

export interface WeldInput {
  readonly array: ArrayLike<number>;
  readonly itemSize: number;
}

export interface WeldResult {
  readonly vertexCount: number;
  /** Old vertex -> new vertex. */
  readonly remap: Int32Array;
  /** Welded attributes, same order as the input. */
  readonly attributes: Float32Array[];
  /** The index rewritten to the welded vertices (or a new one for non-indexed input). */
  readonly index: Uint32Array;
}

/** Merge vertices whose attribute values are all bit-identical (as float32; -0 counts as 0). */
export function weldVertices(count: number, attributes: WeldInput[], index: ArrayLike<number> | null): WeldResult {
  const width = attributes.reduce((s, a) => s + a.itemSize, 0);
  const bits = new Uint32Array(width);
  const floats = new Float32Array(bits.buffer);
  const ids = new Map<string, number>();
  const remap = new Int32Array(count);
  const firsts: number[] = [];
  for (let v = 0; v < count; v++) {
    let k = 0;
    for (const a of attributes) {
      for (let j = 0; j < a.itemSize; j++) floats[k++] = a.array[v * a.itemSize + j] + 0; // +0 turns -0 into 0
    }
    const key = Array.prototype.join.call(bits, ',');
    let id = ids.get(key);
    if (id === undefined) { id = firsts.length; ids.set(key, id); firsts.push(v); }
    remap[v] = id;
  }
  const out = attributes.map((a) => {
    const arr = new Float32Array(firsts.length * a.itemSize);
    firsts.forEach((v, i) => { for (let j = 0; j < a.itemSize; j++) arr[i * a.itemSize + j] = a.array[v * a.itemSize + j]; });
    return arr;
  });
  const source = index ?? Array.from({ length: count }, (_, i) => i);
  const newIndex = new Uint32Array(source.length);
  for (let i = 0; i < source.length; i++) newIndex[i] = remap[source[i]];
  return { vertexCount: firsts.length, remap, attributes: out, index: newIndex };
}
