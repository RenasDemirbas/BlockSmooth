// One level of Catmull-Clark subdivision with semi-sharp creases, built as
// sparse maps (parent -> child vertices, parent -> child corners) so it can be
// re-evaluated cheaply. Pure — no Blockbench globals.
//
// Rules (DeRose, Kass & Truong 1998; boundary = "edge and corner" interpolation):
//  - face point:  average of the face's vertices
//  - edge point:  smooth (v0 + v1 + F_a + F_b) / 4; sharp: midpoint;
//                 0 < sharpness < 1 blends the two
//  - vertex point: smooth (Q + 2R + (n - 3) S) / n; with two sharp incident
//                 edges the crease rule (a + 6v + b) / 8; with more, or a
//                 boundary vertex that belongs to one face only, the corner
//                 rule (stays put); fractional sharpness blends with smooth
//  - boundary and non-manifold edges count as infinitely sharp
//  - child edges of an edge keep its sharpness minus one
// Face-varying data (UVs) is interpolated linearly inside each face, so
// texture seams and pixel-art texel layouts stay where they were painted.

import { RowBuilder, type SparseRows } from './sparse';
import { buildTopology, edgeFaceCount, nextCorner, otherEnd, prevCorner, type Topology } from './topology';

export interface Level {
  readonly parent: Topology;
  readonly child: Topology;
  /** Child vertex <- parent vertices. */
  readonly vertexRows: SparseRows;
  /** Child corner <- parent corners (linear inside each face). */
  readonly cornerRows: SparseRows;
  /** Crease sharpness of each child edge. */
  readonly childSharpness: Float64Array;
  /** Child edge -> the parent edge it is half of, or -1 for an edge inside a parent face. */
  readonly edgeParent: Int32Array;
  /** Child face -> parent face. */
  readonly faceParent: Int32Array;
  /** Child vertex -> the parent vertex it moved from, or -1 for edge and face points. */
  readonly vertexParent: Int32Array;
}

/** Sharpness that the rules see: boundary and non-manifold edges are infinitely sharp. */
export function effectiveSharpness(t: Topology, sharpness: Float64Array, e: number): number {
  return edgeFaceCount(t, e) === 2 ? sharpness[e] : Infinity;
}

export function subdivideOnce(parent: Topology, sharpness: Float64Array): Level {
  const nv = parent.vertexCount, ne = parent.edgeCount, nf = parent.faceCount;
  const edgePoint = (e: number) => nv + e;
  const facePoint = (f: number) => nv + ne + f;

  // ── child topology: corner c of parent face f becomes the quad
  //    [vertex(c), edge(c -> next), face(f), edge(prev -> c)], keeping the winding.
  //    Child face index == parent corner index, so the faces of one parent face
  //    stay contiguous and in order at every level.
  const childFaceOffsets = new Int32Array(parent.cornerCount + 1);
  const childFaceVerts = new Int32Array(parent.cornerCount * 4);
  const faceParent = new Int32Array(parent.cornerCount);
  for (let c = 0; c < parent.cornerCount; c++) {
    const p = prevCorner(parent, c);
    childFaceOffsets[c + 1] = 4 * (c + 1);
    childFaceVerts[4 * c] = parent.faceVerts[c];
    childFaceVerts[4 * c + 1] = edgePoint(parent.cornerEdge[c]);
    childFaceVerts[4 * c + 2] = facePoint(parent.cornerFace[c]);
    childFaceVerts[4 * c + 3] = edgePoint(parent.cornerEdge[p]);
    faceParent[c] = parent.cornerFace[c];
  }
  const child = buildTopology(nv + ne + nf, childFaceOffsets, childFaceVerts);

  const vertexRows = buildVertexRows(parent, sharpness);
  const cornerRows = buildCornerRows(parent);

  // ── child edges: a vertex point joined to an edge point is half of that parent edge.
  const edgeParent = new Int32Array(child.edgeCount);
  const childSharpness = new Float64Array(child.edgeCount);
  for (let e = 0; e < child.edgeCount; e++) {
    const a = child.edgeVerts[2 * e], b = child.edgeVerts[2 * e + 1]; // a < b
    if (a < nv && b >= nv && b < nv + ne) {
      const pe = b - nv;
      edgeParent[e] = pe;
      const s = sharpness[pe];
      childSharpness[e] = s === Infinity ? Infinity : Math.max(0, s - 1);
    } else {
      edgeParent[e] = -1;
    }
  }

  const vertexParent = new Int32Array(child.vertexCount).fill(-1);
  for (let v = 0; v < nv; v++) vertexParent[v] = v;

  return { parent, child, vertexRows, cornerRows, childSharpness, edgeParent, faceParent, vertexParent };
}

function addFacePoint(rows: RowBuilder, t: Topology, f: number, weight: number) {
  const start = t.faceOffsets[f], end = t.faceOffsets[f + 1];
  const w = weight / (end - start);
  for (let c = start; c < end; c++) rows.add(t.faceVerts[c], w);
}

function buildVertexRows(t: Topology, sharpness: Float64Array): SparseRows {
  const rows = new RowBuilder(t.vertexCount);

  // Vertex points.
  for (let v = 0; v < t.vertexCount; v++) {
    const cornerStart = t.vertexCornerOffsets[v], cornerEnd = t.vertexCornerOffsets[v + 1];
    const edgeStart = t.vertexEdgeOffsets[v], edgeEnd = t.vertexEdgeOffsets[v + 1];
    if (cornerStart === cornerEnd) { // loose vertex: not part of any face
      rows.add(v, 1);
      rows.commit();
      continue;
    }

    let sharpCount = 0, sharpSum = 0, boundary = false;
    const creaseEnds: number[] = [];
    for (let i = edgeStart; i < edgeEnd; i++) {
      const e = t.vertexEdges[i];
      if (edgeFaceCount(t, e) === 1) boundary = true;
      const s = effectiveSharpness(t, sharpness, e);
      if (s > 0) {
        sharpCount++;
        sharpSum += Math.min(s, 1);
        creaseEnds.push(otherEnd(t, e, v));
      }
    }
    const corner = (boundary && cornerEnd - cornerStart === 1) || sharpCount > 2;
    const crease = !corner && sharpCount === 2;
    const blend = corner || crease ? (sharpCount ? sharpSum / sharpCount : 1) : 0;

    if (blend < 1) {
      // Smooth rule, weighted by (1 - blend).
      const k = 1 - blend;
      const n = edgeEnd - edgeStart;
      const m = cornerEnd - cornerStart;
      for (let i = cornerStart; i < cornerEnd; i++) {
        addFacePoint(rows, t, t.cornerFace[t.vertexCorners[i]], k / (m * n));
      }
      for (let i = edgeStart; i < edgeEnd; i++) {
        const e = t.vertexEdges[i];
        rows.add(t.edgeVerts[2 * e], k / (n * n));
        rows.add(t.edgeVerts[2 * e + 1], k / (n * n));
      }
      rows.add(v, k * (n - 3) / n);
    }
    if (blend > 0) {
      if (crease) {
        rows.add(v, blend * 0.75);
        rows.add(creaseEnds[0], blend * 0.125);
        rows.add(creaseEnds[1], blend * 0.125);
      } else {
        rows.add(v, blend);
      }
    }
    rows.commit();
  }

  // Edge points.
  for (let e = 0; e < t.edgeCount; e++) {
    const a = t.edgeVerts[2 * e], b = t.edgeVerts[2 * e + 1];
    const s = Math.min(1, effectiveSharpness(t, sharpness, e));
    if (s < 1) {
      const k = 1 - s;
      rows.add(a, k * 0.25);
      rows.add(b, k * 0.25);
      for (let i = t.edgeCornerOffsets[e]; i < t.edgeCornerOffsets[e + 1]; i++) {
        addFacePoint(rows, t, t.cornerFace[t.edgeCorners[i]], k * 0.25);
      }
    }
    if (s > 0) {
      rows.add(a, s * 0.5);
      rows.add(b, s * 0.5);
    }
    rows.commit();
  }

  // Face points.
  for (let f = 0; f < t.faceCount; f++) {
    addFacePoint(rows, t, f, 1);
    rows.commit();
  }
  return rows.build();
}

function buildCornerRows(t: Topology): SparseRows {
  const rows = new RowBuilder(t.cornerCount);
  for (let c = 0; c < t.cornerCount; c++) {
    const n = nextCorner(t, c), p = prevCorner(t, c);
    const f = t.cornerFace[c];
    const start = t.faceOffsets[f], end = t.faceOffsets[f + 1];
    rows.add(c, 1); rows.commit();                         // at the parent vertex
    rows.add(c, 0.5); rows.add(n, 0.5); rows.commit();     // at the outgoing edge point
    for (let k = start; k < end; k++) rows.add(k, 1 / (end - start));
    rows.commit();                                         // at the face point
    rows.add(p, 0.5); rows.add(c, 0.5); rows.commit();     // at the incoming edge point
  }
  return rows.build();
}
