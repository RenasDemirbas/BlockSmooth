import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTopology } from '../src/core/topology';
import { buildHierarchy, Evaluator } from '../src/core/hierarchy';
import { computeCornerNormals } from '../src/core/normals';
import { shareCorners, sharingFits, weldVertices } from '../src/core/sharing';

const CUBE_POS = [-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1];
const CUBE_FACES = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]];

function cube() {
  const offsets = new Int32Array(CUBE_FACES.length + 1);
  CUBE_FACES.forEach((f, i) => { offsets[i + 1] = offsets[i] + f.length; });
  return buildTopology(8, offsets, Int32Array.from(CUBE_FACES.flat()));
}

test('smooth level-2 cube: one shared vertex per surface point and cage face', () => {
  const h = buildHierarchy(cube(), new Float64Array(12), 2);
  const p = new Evaluator(h, 3).run(CUBE_POS);
  const cn = computeCornerNormals(h.final, p, { flat: false, maxAngle: null });
  const s = shareCorners(h.final, h.faceOrigin, cn.fan, cn.fanCount);
  assert.equal(h.final.cornerCount, 384);
  assert.equal(s.vertexCount, 6 * 25); // a 4x4 patch has 5x5 points, patches do not share
  assert.ok(sharingFits(s, cn.fan));
  for (let c = 0; c < h.final.cornerCount; c++) {
    const rep = s.vertexCorner[s.cornerVertex[c]];
    assert.equal(h.final.faceVerts[rep], h.final.faceVerts[c]);         // same surface point
    assert.equal(h.faceOrigin[h.final.cornerFace[rep]], h.faceOrigin[h.final.cornerFace[c]]); // same cage face
  }
});

test('flat shading shares nothing; sharp fans split vertices', () => {
  const t = cube();
  const flat = computeCornerNormals(t, CUBE_POS, { flat: true, maxAngle: null });
  const identity = Int32Array.from({ length: 6 }, (_, i) => i);
  assert.equal(shareCorners(t, identity, flat.fan, flat.fanCount).vertexCount, 24);
  const smooth = computeCornerNormals(t, CUBE_POS, { flat: false, maxAngle: null });
  assert.equal(shareCorners(t, identity, smooth.fan, smooth.fanCount).vertexCount, 24); // cage faces never share
});

test('sharingFits detects fans that split after the sharing was built', () => {
  const h = buildHierarchy(cube(), new Float64Array(12), 1);
  const p = new Evaluator(h, 3).run(CUBE_POS);
  const coarse = computeCornerNormals(h.final, p, { flat: false, maxAngle: null });
  const s = shareCorners(h.final, h.faceOrigin, coarse.fan, coarse.fanCount);
  const fine = computeCornerNormals(h.final, p, { flat: false, maxAngle: Math.PI / 180 });
  assert.ok(fine.fanCount > coarse.fanCount);
  assert.equal(sharingFits(s, Int32Array.from(fine.fan)), false);
  assert.equal(sharingFits(s, new Int32Array(3)), false); // other topology
});

test('weldVertices merges only bit-identical vertices and remaps the index', () => {
  const pos = [0, 0, 0, 1, 0, 0, 0, 1, 0, /* dup of 1 */ 1, 0, 0, /* -0 dup of 0 */ -0, 0, -0, /* near, kept */ 1e-7, 0, 0];
  const uv = [0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0];
  const r = weldVertices(6, [{ array: pos, itemSize: 3 }, { array: uv, itemSize: 2 }], [0, 1, 2, 4, 3, 5]);
  assert.equal(r.vertexCount, 4);
  assert.deepEqual(Array.from(r.remap), [0, 1, 2, 1, 0, 3]);
  assert.deepEqual(Array.from(r.index), [0, 1, 2, 0, 1, 3]);
  const unindexed = weldVertices(6, [{ array: pos, itemSize: 3 }], null);
  assert.deepEqual(Array.from(unindexed.index), [0, 1, 2, 1, 0, 3]);
});

test('welding a per-corner mesh keeps every triangle identical', () => {
  const h = buildHierarchy(cube(), new Float64Array(12), 2);
  const p = new Evaluator(h, 3).run(CUBE_POS);
  const cn = computeCornerNormals(h.final, p, { flat: false, maxAngle: null });
  const t = h.final;
  const pos = new Float32Array(t.cornerCount * 3), nor = new Float32Array(t.cornerCount * 3);
  for (let c = 0; c < t.cornerCount; c++) {
    for (let k = 0; k < 3; k++) { pos[3 * c + k] = p[3 * t.faceVerts[c] + k]; nor[3 * c + k] = cn.normals[3 * c + k]; }
  }
  const index: number[] = [];
  for (let f = 0; f < t.faceCount; f++) { const s = t.faceOffsets[f]; index.push(s, s + 1, s + 2, s, s + 2, s + 3); }
  const r = weldVertices(t.cornerCount, [{ array: pos, itemSize: 3 }, { array: nor, itemSize: 3 }], index);
  assert.ok(r.vertexCount < t.cornerCount / 2, `${r.vertexCount}`);
  for (let i = 0; i < index.length; i++) {
    for (let k = 0; k < 3; k++) {
      assert.equal(r.attributes[0][3 * r.index[i] + k], pos[3 * index[i] + k]);
      assert.equal(r.attributes[1][3 * r.index[i] + k], nor[3 * index[i] + k]);
    }
  }
});
