import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModifier, patchModifier, readData, isEmpty } from '../src/model/schema';
import { facesAfter, levelsWithinBudget, resolvePlan } from '../src/model/plan';
import { edgeKey } from '../src/model/edges';

test('readData tolerates garbage and clamps values', () => {
  assert.ok(isEmpty(readData(undefined)));
  assert.ok(isEmpty(readData('nope')));
  const d = readData({
    modifiers: [
      { type: 'subdivision', levels: 99, export_levels: -3 },
      { type: 'smooth_by_angle', angle: 'x' },
      { type: 'future_thing', strength: 2, id: 'keep_me' },
      null, 42,
    ],
    creases: { a_b: 5, c_d: -1, bad: 1, e_f: '0.5' },
    sharp: { a_b: true, x_y: 0 },
  });
  assert.equal(d.modifiers.length, 3);
  const [sub, angle] = d.modifiers as any[];
  assert.deepEqual([sub.levels, sub.export_levels], [4, 0]);
  assert.equal(angle.angle, 30);
  assert.equal(d.modifiers[2].type, 'future_thing');
  assert.equal(d.modifiers[2].strength, 2);
  assert.deepEqual(d.creases, { a_b: 1, e_f: 0.5 });
  assert.deepEqual(d.sharp, { a_b: 1 });
});

test('duplicate modifier ids are renamed', () => {
  const d = readData({ modifiers: [{ type: 'subdivision', id: 'same' }, { type: 'subdivision', id: 'same' }] });
  assert.notEqual(d.modifiers[0].id, d.modifiers[1].id);
});

test('patchModifier validates and cannot change type or id', () => {
  const m = createModifier('subdivision', { levels: 1 });
  assert.equal((m as any).export_levels, 1);
  const p = patchModifier(m, { levels: 3, type: 'smooth_by_angle', id: 'other' });
  assert.equal(p.type, 'subdivision');
  assert.equal(p.id, m.id);
  assert.equal((p as any).levels, 3);
});

test('resolvePlan: levels add up, last smooth_by_angle wins, contexts differ', () => {
  const d = readData({
    modifiers: [
      { type: 'subdivision', levels: 1, export_levels: 3 },
      { type: 'subdivision', levels: 1, viewport: false },
      { type: 'smooth_by_angle', angle: 60 },
      { type: 'smooth_by_angle', angle: 180, export: false },
    ],
  });
  assert.deepEqual(resolvePlan(d, 'viewport', 'flat'), { active: true, levels: 1, flat: false, maxAngle: null });
  assert.deepEqual(resolvePlan(d, 'export', 'flat'), { active: true, levels: 4, flat: false, maxAngle: 60 });
  assert.equal(resolvePlan(readData({}), 'viewport', 'smooth').active, false);
  assert.equal(resolvePlan(readData({ modifiers: [{ type: 'subdivision', levels: 0 }] }), 'viewport', 'smooth').active, false);
  assert.equal(resolvePlan(readData({ modifiers: [{ type: 'subdivision' }] }), 'viewport', 'flat').flat, true);
});

test('face budget', () => {
  assert.equal(facesAfter(6, 24, 0), 6);
  assert.equal(facesAfter(6, 24, 2), 96);
  assert.equal(levelsWithinBudget(6, 24, 6, 1000), 3);
});

test('edgeKey matches Blockbench seam keys', () => {
  assert.equal(edgeKey('b', 'a'), 'a_b');
  assert.equal(edgeKey('a', 'b'), ['b', 'a'].sort().join('_'));
});
