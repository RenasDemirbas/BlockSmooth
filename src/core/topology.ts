// Polygon mesh connectivity: faces as corner loops, edges, and the incidence
// tables the subdivision and normal code walks. Pure — no Blockbench globals.
//
// Vocabulary: a "corner" is one vertex slot of one face (face-varying data
// such as UVs lives on corners). Corner c of face f runs from vertex
// faceVerts[c] to the vertex of the next corner of the same face; that
// directed side is the face's half of edge cornerEdge[c].

import { groupBy, groupByPairs } from './csr';

export interface Topology {
  readonly vertexCount: number;
  readonly faceCount: number;
  readonly cornerCount: number;
  /** Face f owns corners faceOffsets[f] .. faceOffsets[f + 1] - 1, in loop order. */
  readonly faceOffsets: Int32Array;
  /** Corner -> vertex. */
  readonly faceVerts: Int32Array;
  /** Corner -> face. */
  readonly cornerFace: Int32Array;
  readonly edgeCount: number;
  /** Edge e joins vertices edgeVerts[2e] < edgeVerts[2e + 1]. */
  readonly edgeVerts: Int32Array;
  /** Corner -> the edge from its vertex to the next corner's vertex. */
  readonly cornerEdge: Int32Array;
  /** Edge -> the corners whose outgoing side it is (one per incident face side). */
  readonly edgeCornerOffsets: Int32Array;
  readonly edgeCorners: Int32Array;
  /** Vertex -> incident edges. */
  readonly vertexEdgeOffsets: Int32Array;
  readonly vertexEdges: Int32Array;
  /** Vertex -> corners at that vertex. */
  readonly vertexCornerOffsets: Int32Array;
  readonly vertexCorners: Int32Array;
}

/**
 * Build the connectivity of a polygon mesh. Faces must have at least 3
 * corners and no repeated vertex (callers drop degenerate faces first).
 */
export function buildTopology(vertexCount: number, faceOffsets: Int32Array, faceVerts: Int32Array): Topology {
  const faceCount = faceOffsets.length - 1;
  const cornerCount = faceVerts.length;
  const cornerFace = new Int32Array(cornerCount);
  for (let f = 0; f < faceCount; f++) {
    for (let c = faceOffsets[f]; c < faceOffsets[f + 1]; c++) cornerFace[c] = f;
  }

  // Edges, numbered in order of first appearance. Key a * vertexCount + b stays
  // an exact integer in a double for any mesh that fits in memory.
  const edgeIndex = new Map<number, number>();
  const edgeVertList: number[] = [];
  const cornerEdge = new Int32Array(cornerCount);
  for (let f = 0; f < faceCount; f++) {
    const start = faceOffsets[f], end = faceOffsets[f + 1];
    for (let c = start; c < end; c++) {
      const a = faceVerts[c];
      const b = faceVerts[c + 1 < end ? c + 1 : start];
      const lo = a < b ? a : b, hi = a < b ? b : a;
      const key = lo * vertexCount + hi;
      let e = edgeIndex.get(key);
      if (e === undefined) {
        e = edgeVertList.length >> 1;
        edgeIndex.set(key, e);
        edgeVertList.push(lo, hi);
      }
      cornerEdge[c] = e;
    }
  }
  const edgeVerts = Int32Array.from(edgeVertList);
  const edgeCount = edgeVerts.length >> 1;

  const byEdge = groupBy(edgeCount, cornerEdge);
  const byVertexEdge = groupByPairs(vertexCount, edgeVerts);
  const byVertexCorner = groupBy(vertexCount, faceVerts);

  return {
    vertexCount, faceCount, cornerCount, faceOffsets, faceVerts, cornerFace,
    edgeCount, edgeVerts, cornerEdge,
    edgeCornerOffsets: byEdge.offsets, edgeCorners: byEdge.items,
    vertexEdgeOffsets: byVertexEdge.offsets, vertexEdges: byVertexEdge.items,
    vertexCornerOffsets: byVertexCorner.offsets, vertexCorners: byVertexCorner.items,
  };
}

export function nextCorner(t: Topology, c: number): number {
  const f = t.cornerFace[c];
  return c + 1 < t.faceOffsets[f + 1] ? c + 1 : t.faceOffsets[f];
}

export function prevCorner(t: Topology, c: number): number {
  const f = t.cornerFace[c];
  return c > t.faceOffsets[f] ? c - 1 : t.faceOffsets[f + 1] - 1;
}

/** Number of face sides on edge e: 1 = boundary, 2 = manifold, more = non-manifold. */
export function edgeFaceCount(t: Topology, e: number): number {
  return t.edgeCornerOffsets[e + 1] - t.edgeCornerOffsets[e];
}

/** The edge joining vertices a and b, or -1. */
export function findEdge(t: Topology, a: number, b: number): number {
  for (let i = t.vertexEdgeOffsets[a]; i < t.vertexEdgeOffsets[a + 1]; i++) {
    const e = t.vertexEdges[i];
    const o = t.edgeVerts[2 * e] === a ? t.edgeVerts[2 * e + 1] : t.edgeVerts[2 * e];
    if (o === b) return e;
  }
  return -1;
}

/** The vertex across edge e from v. */
export function otherEnd(t: Topology, e: number, v: number): number {
  return t.edgeVerts[2 * e] === v ? t.edgeVerts[2 * e + 1] : t.edgeVerts[2 * e];
}
