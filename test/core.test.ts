import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTopology, edgeFaceCount, findEdge } from '../src/core/topology';
import { buildHierarchy, Evaluator } from '../src/core/hierarchy';
import { computeCornerNormals, edgesSharperThan } from '../src/core/normals';
import { bakeConnected, bakeSplit } from '../src/core/bake';

// Cube [-1, 1]^3, outward winding.
const CUBE_POS = [
  -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1,
  -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
];
const CUBE_FACES = [
  [0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4],
  [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3],
];

function mesh(faces: number[][], vertexCount: number) {
  const offsets = new Int32Array(faces.length + 1);
  faces.forEach((f, i) => { offsets[i + 1] = offsets[i] + f.length; });
  return buildTopology(vertexCount, offsets, Int32Array.from(faces.flat()));
}

function close(actual: ArrayLike<number>, expected: number[], eps = 1e-9) {
  expected.forEach((v, i) => assert.ok(Math.abs(actual[i] - v) < eps, `index ${i}: ${actual[i]} != ${v}`));
}

test('topology of a cube: 12 manifold edges, valence 3', () => {
  const t = mesh(CUBE_FACES, 8);
  assert.equal(t.edgeCount, 12);
  for (let e = 0; e < t.edgeCount; e++) assert.equal(edgeFaceCount(t, e), 2);
  for (let v = 0; v < 8; v++) assert.equal(t.vertexEdgeOffsets[v + 1] - t.vertexEdgeOffsets[v], 3);
  assert.ok(findEdge(t, 0, 1) >= 0);
  assert.equal(findEdge(t, 0, 6), -1);
});

test('one Catmull-Clark level of a cube matches the textbook values', () => {
  const t = mesh(CUBE_FACES, 8);
  const h = buildHierarchy(t, new Float64Array(t.edgeCount), 1);
  const p = new Evaluator(h, 3).run(CUBE_POS);
  assert.equal(h.final.vertexCount, 8 + 12 + 6);
  assert.equal(h.final.faceCount, 24);
  close(Array.from(p).slice(18, 21), [5 / 9, 5 / 9, 5 / 9]);                   // vertex 6 = (1,1,1)
  const e = findEdge(t, 6, 2);                                                  // (1,1,1)-(1,1,-1)
  close(Array.from(p).slice((8 + e) * 3, (8 + e) * 3 + 3), [0.75, 0.75, 0]);
  close(Array.from(p).slice((8 + 12 + 1) * 3, (8 + 12 + 1) * 3 + 3), [0, 0, 1]); // face point of +z face
});

test('a fully creased cube stays a cube; faces keep their origin', () => {
  const t = mesh(CUBE_FACES, 8);
  const h = buildHierarchy(t, new Float64Array(t.edgeCount).fill(Infinity), 2);
  const p = new Evaluator(h, 3).run(CUBE_POS);
  for (let i = 0; i < p.length; i++) assert.ok(Math.abs(p[i]) <= 1 + 1e-12);
  close(Array.from(p).slice(0, 3), [-1, -1, -1]);
  for (let f = 0; f < h.final.faceCount; f++) assert.equal(h.faceOrigin[f], Math.floor(f / 16));
});

test('semi-sharp crease lies between smooth and sharp', () => {
  const t = mesh(CUBE_FACES, 8);
  const at = (s: number) => {
    const h = buildHierarchy(t, new Float64Array(t.edgeCount).fill(s), 1);
    return new Evaluator(h, 3).run(CUBE_POS)[0];
  };
  const smooth = at(0), half = at(0.5), sharp = at(1);
  assert.ok(smooth > half && half > sharp, `${smooth} ${half} ${sharp}`);
  assert.equal(sharp, -1);
});

test('open plane: boundary corners stay, boundary edges stay straight', () => {
  // 2 x 1 quads in the XY plane.
  const t = mesh([[0, 1, 4, 3], [1, 2, 5, 4]], 6);
  const pos = [0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0, 1, 1, 0, 2, 1, 0];
  const h = buildHierarchy(t, new Float64Array(t.edgeCount), 2);
  const p = new Evaluator(h, 3).run(pos);
  close(Array.from(p).slice(0, 3), [0, 0, 0]);
  close(Array.from(p).slice(6, 9), [2, 0, 0]);
  for (let v = 0; v < h.final.vertexCount; v++) {
    assert.ok(Math.abs(p[3 * v + 2]) < 1e-12);           // stays planar
    assert.ok(p[3 * v + 1] >= -1e-12 && p[3 * v + 1] <= 1 + 1e-12);
  }
});

test('triangles subdivide into quads; corner data interpolates linearly', () => {
  const t = mesh([[0, 1, 2]], 3);
  const h = buildHierarchy(t, new Float64Array(t.edgeCount), 1);
  assert.equal(h.final.faceCount, 3);
  const uv = new Evaluator(h, 2, true).run([0, 0, 1, 0, 0, 1]);
  close(Array.from(uv).slice(0, 8), [0, 0, 0.5, 0, 1 / 3, 1 / 3, 0, 0.5]);
});

test('subdivided cube normals point outward and are unit length', () => {
  const t = mesh(CUBE_FACES, 8);
  const h = buildHierarchy(t, new Float64Array(t.edgeCount), 2);
  const p = new Evaluator(h, 3).run(CUBE_POS);
  const cn = computeCornerNormals(h.final, p, { flat: false, maxAngle: null });
  for (let c = 0; c < h.final.cornerCount; c++) {
    const v = h.final.faceVerts[c];
    const n = [cn.normals[3 * c], cn.normals[3 * c + 1], cn.normals[3 * c + 2]];
    assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-5);
    assert.ok(n[0] * p[3 * v] + n[1] * p[3 * v + 1] + n[2] * p[3 * v + 2] > 0);
  }
  assert.equal(cn.fanCount, h.final.vertexCount); // fully smooth: one fan per vertex
});

test('smoothing angle splits a cube into flat fans; sharp marks do too', () => {
  const t = mesh(CUBE_FACES, 8);
  const byAngle = computeCornerNormals(t, CUBE_POS, { flat: false, maxAngle: Math.PI / 6 });
  assert.equal(byAngle.fanCount, 24);
  const marked = computeCornerNormals(t, CUBE_POS, { flat: false, maxAngle: null, sharpEdges: new Uint8Array(12).fill(1) });
  assert.equal(marked.fanCount, 24);
  assert.equal(edgesSharperThan(t, CUBE_POS, Math.PI / 6).length, 12);
  assert.equal(edgesSharperThan(t, CUBE_POS, Math.PI * 0.9).length, 0);
});

test('bake: connected keeps vertices shared, split follows the fans', () => {
  const t = mesh(CUBE_FACES, 8);
  assert.equal(bakeConnected(t, CUBE_POS).vertexCount, 8);
  const cn = computeCornerNormals(t, CUBE_POS, { flat: false, maxAngle: Math.PI / 6 });
  const split = bakeSplit(t, CUBE_POS, cn);
  assert.equal(split.vertexCount, 24);
  assert.ok(split.normals);
});

test('edge origins: halves of a cage edge map back to it, inner edges to -1', () => {
  const t = mesh(CUBE_FACES, 8);
  const h = buildHierarchy(t, new Float64Array(t.edgeCount), 2);
  const counts = new Map<number, number>();
  for (let e = 0; e < h.final.edgeCount; e++) counts.set(h.edgeOrigin[e], (counts.get(h.edgeOrigin[e]) ?? 0) + 1);
  for (let e = 0; e < 12; e++) assert.equal(counts.get(e), 4);
  for (let v = 0; v < 8; v++) assert.equal(h.vertexOrigin[v], v);
});
