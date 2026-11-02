// Per-corner shading normals with sharp edges: corners around a vertex are
// grouped into "fans" that are separated by sharp edges (marked sharp, open
// boundary, non-manifold, or folded more than the smoothing angle), and each fan
// shares one angle-weighted normal. Pure — no Blockbench globals.
//
// NormalSolver precomputes everything that depends only on the topology, so
// re-solving after a vertex drag or an animation frame is a few passes over
// flat arrays. Without a smoothing angle the fans themselves are fixed and
// cached too.

import { nextCorner, prevCorner, type Topology } from './topology';

export interface NormalOptions {
  /** One normal per face (faceted). */
  readonly flat: boolean;
  /** Edges whose faces meet at more than this angle (radians) shade sharp. null: no limit. */
  readonly maxAngle: number | null;
}

export interface CornerNormals {
  /** 3 floats per corner. */
  readonly normals: Float32Array;
  /** Corner -> fan id, 0..fanCount-1. Corners of one fan share a vertex and a normal. */
  readonly fan: Int32Array;
  readonly fanCount: number;
}

interface Fans {
  readonly fan: Int32Array;
  readonly fanCount: number;
}

/**
 * Buffers are reused between solves (a dense level-3 surface would otherwise
 * allocate megabytes per animation frame and stall on garbage collection):
 * the returned CornerNormals is only valid until the next solve() call.
 */
export class NormalSolver {
  private readonly prev: Int32Array;
  private readonly next: Int32Array;
  /** Per joinable edge (manifold, not marked sharp): its two faces and the two corner pairs to join. */
  private readonly joinFaces: Int32Array;
  private readonly joinCorners: Int32Array;
  private staticFans: Fans | null = null;
  private readonly normals: Float32Array;
  private readonly faceN: Float64Array;
  private readonly sums: Float64Array;
  private readonly parent: Int32Array;
  private readonly fanOfRoot: Int32Array;
  private readonly dynamicFan: Int32Array;
  private flatFan: Int32Array | null = null;

  /** sharpEdges: per edge, 1 = always shade sharp. */
  constructor(private readonly t: Topology, sharpEdges?: Uint8Array | null) {
    this.prev = new Int32Array(t.cornerCount);
    this.next = new Int32Array(t.cornerCount);
    for (let c = 0; c < t.cornerCount; c++) {
      this.prev[c] = prevCorner(t, c);
      this.next[c] = nextCorner(t, c);
    }
    const faces: number[] = [];
    const corners: number[] = [];
    for (let e = 0; e < t.edgeCount; e++) {
      const start = t.edgeCornerOffsets[e];
      if (t.edgeCornerOffsets[e + 1] - start !== 2 || sharpEdges?.[e]) continue;
      const h1 = t.edgeCorners[start], h2 = t.edgeCorners[start + 1];
      const n1 = this.next[h1], n2 = this.next[h2];
      faces.push(t.cornerFace[h1], t.cornerFace[h2]);
      if (t.faceVerts[h1] === t.faceVerts[h2]) corners.push(h1, h2, n1, n2); // one face is flipped
      else corners.push(h1, n2, n1, h2);
    }
    this.joinFaces = Int32Array.from(faces);
    this.joinCorners = Int32Array.from(corners);
    this.normals = new Float32Array(t.cornerCount * 3);
    this.faceN = new Float64Array(t.faceCount * 3);
    this.sums = new Float64Array(t.cornerCount * 3);
    this.parent = new Int32Array(t.cornerCount);
    this.fanOfRoot = new Int32Array(t.cornerCount);
    this.dynamicFan = new Int32Array(t.cornerCount);
  }

  solve(positions: ArrayLike<number>, options: NormalOptions): CornerNormals {
    const t = this.t;
    const fn = faceNormals(t, positions, this.faceN);
    const normals = this.normals;

    if (options.flat) {
      if (!this.flatFan) {
        this.flatFan = new Int32Array(t.cornerCount);
        for (let c = 0; c < t.cornerCount; c++) this.flatFan[c] = c;
      }
      for (let c = 0; c < t.cornerCount; c++) {
        const f = 3 * t.cornerFace[c];
        normals[3 * c] = fn[f]; normals[3 * c + 1] = fn[f + 1]; normals[3 * c + 2] = fn[f + 2];
      }
      return { normals, fan: this.flatFan, fanCount: t.cornerCount };
    }

    const fans = options.maxAngle === null
      ? (this.staticFans ??= this.buildFans(null, -Infinity, new Int32Array(t.cornerCount)))
      : this.buildFans(fn, Math.cos(options.maxAngle), this.dynamicFan);
    const { fan, fanCount } = fans;

    // Angle-weighted sum of face normals per fan.
    const sums = this.sums;
    sums.fill(0, 0, fanCount * 3);
    const p = positions, fv = t.faceVerts;
    for (let c = 0; c < t.cornerCount; c++) {
      const v = 3 * fv[c], a = 3 * fv[this.prev[c]], b = 3 * fv[this.next[c]];
      const ax = p[a] - p[v], ay = p[a + 1] - p[v + 1], az = p[a + 2] - p[v + 2];
      const bx = p[b] - p[v], by = p[b + 1] - p[v + 1], bz = p[b + 2] - p[v + 2];
      const ll = (ax * ax + ay * ay + az * az) * (bx * bx + by * by + bz * bz);
      let w = 0;
      if (ll > 0) {
        const cos = (ax * bx + ay * by + az * bz) / Math.sqrt(ll);
        w = Math.acos(cos < -1 ? -1 : cos > 1 ? 1 : cos);
      }
      const f = 3 * t.cornerFace[c], k = 3 * fan[c];
      sums[k] += w * fn[f]; sums[k + 1] += w * fn[f + 1]; sums[k + 2] += w * fn[f + 2];
    }
    for (let c = 0; c < t.cornerCount; c++) {
      const k = 3 * fan[c];
      let x = sums[k], y = sums[k + 1], z = sums[k + 2];
      let len = Math.sqrt(x * x + y * y + z * z);
      if (!(len > 1e-12)) { // fan of degenerate faces: fall back to the face normal
        const f = 3 * t.cornerFace[c];
        x = fn[f]; y = fn[f + 1]; z = fn[f + 2]; len = 1;
      }
      normals[3 * c] = x / len; normals[3 * c + 1] = y / len; normals[3 * c + 2] = z / len;
    }
    return { normals, fan, fanCount };
  }

  /** Union the corner pairs of every joinable edge whose faces meet within the angle. */
  private buildFans(fn: Float64Array | null, cosLimit: number, fan: Int32Array): Fans {
    const t = this.t;
    const parent = this.parent;
    for (let i = 0; i < parent.length; i++) parent[i] = i;
    const find = (x: number) => {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    };
    const union = (a: number, b: number) => {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };
    const jf = this.joinFaces, jc = this.joinCorners;
    for (let i = 0; i < jf.length >> 1; i++) {
      if (fn) {
        const fa = 3 * jf[2 * i], fb = 3 * jf[2 * i + 1];
        if (fn[fa] * fn[fb] + fn[fa + 1] * fn[fb + 1] + fn[fa + 2] * fn[fb + 2] < cosLimit) continue;
      }
      union(jc[4 * i], jc[4 * i + 1]);
      union(jc[4 * i + 2], jc[4 * i + 3]);
    }
    const fanOfRoot = this.fanOfRoot.fill(-1);
    let fanCount = 0;
    for (let c = 0; c < t.cornerCount; c++) {
      const r = find(c);
      if (fanOfRoot[r] < 0) fanOfRoot[r] = fanCount++;
      fan[c] = fanOfRoot[r];
    }
    return { fan, fanCount };
  }
}

/** Unit normal of each face (Newell's method: robust for non-planar quads). */
export function faceNormals(t: Topology, positions: ArrayLike<number>, out: Float64Array = new Float64Array(t.faceCount * 3)): Float64Array {
  const p = positions;
  for (let f = 0; f < t.faceCount; f++) {
    let x = 0, y = 0, z = 0;
    const start = t.faceOffsets[f], end = t.faceOffsets[f + 1];
    for (let c = start; c < end; c++) {
      const a = t.faceVerts[c] * 3;
      const b = t.faceVerts[c + 1 < end ? c + 1 : start] * 3;
      x += (p[a + 1] - p[b + 1]) * (p[a + 2] + p[b + 2]);
      y += (p[a + 2] - p[b + 2]) * (p[a] + p[b]);
      z += (p[a] - p[b]) * (p[a + 1] + p[b + 1]);
    }
    const len = Math.sqrt(x * x + y * y + z * z);
    if (len > 0) { out[3 * f] = x / len; out[3 * f + 1] = y / len; out[3 * f + 2] = z / len; }
    else { out[3 * f] = 0; out[3 * f + 1] = 0; out[3 * f + 2] = 0; }
  }
  return out;
}

/** Edges whose two faces meet at more than maxAngle (radians); boundary and non-manifold edges excluded. */
export function edgesSharperThan(t: Topology, positions: ArrayLike<number>, maxAngle: number): number[] {
  const fn = faceNormals(t, positions);
  const cosLimit = Math.cos(maxAngle);
  const out: number[] = [];
  for (let e = 0; e < t.edgeCount; e++) {
    const start = t.edgeCornerOffsets[e];
    if (t.edgeCornerOffsets[e + 1] - start !== 2) continue;
    const fa = 3 * t.cornerFace[t.edgeCorners[start]], fb = 3 * t.cornerFace[t.edgeCorners[start + 1]];
    if (fn[fa] * fn[fb] + fn[fa + 1] * fn[fb + 1] + fn[fa + 2] * fn[fb + 2] < cosLimit) out.push(e);
  }
  return out;
}

/** One-shot convenience: solve normals for a topology without keeping a solver. */
export function computeCornerNormals(t: Topology, positions: ArrayLike<number>, options: NormalOptions & { sharpEdges?: Uint8Array | null }): CornerNormals {
  return new NormalSolver(t, options.sharpEdges).solve(positions, options);
}
