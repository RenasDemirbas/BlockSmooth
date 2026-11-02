// Undoable edits of the BlockSmooth data on meshes: the modifier stack and the
// crease / sharp marks. Every function validates first and changes nothing on
// error; with undo (the default) the change is one Blockbench undo step.

import { edgeKey } from '../model/edges';
import { createModifier, isKnownModifier, LIMITS, MODIFIER_TYPES, patchModifier, type Modifier, type ModifierType, type SmoothData } from '../model/schema';
import { getData, setData } from '../bb/property';
import type { EdgePair } from './edges';

export interface EditOptions {
  /** Record an undo step (default true). Pass false when the caller already opened one. */
  undo?: boolean;
}

export function refreshMeshes(meshes: any[]): void {
  Canvas.updateView({ elements: meshes, element_aspects: { geometry: true, faces: true, uv: true }, selection: true });
}

/**
 * Apply `mutate` to the data of each mesh as one undo step. `mutate` works on
 * copies and must not touch the mesh; everything is computed (and may throw)
 * before the first mesh changes. `alsoChange` runs inside the same undo step
 * for changes to the mesh itself.
 */
export function editData(
  meshes: any[], label: string, mutate: (data: SmoothData, mesh: any) => void,
  options: EditOptions = {}, alsoChange?: (mesh: any) => void,
): void {
  const undo = options.undo !== false;
  const next = meshes.map((mesh) => {
    const data = getData(mesh);
    mutate(data, mesh);
    pruneEdgeMarks(data, mesh);
    return data;
  });
  if (undo) Undo.initEdit({ elements: meshes });
  meshes.forEach((mesh, i) => {
    setData(mesh, next[i]);
    alsoChange?.(mesh);
  });
  if (undo) Undo.finishEdit(label);
  refreshMeshes(meshes);
}

/**
 * Append a modifier to each mesh. smoothShading: a subdivision also switches
 * flat-shaded meshes to smooth shading (what you almost always want).
 */
export function addModifier(meshes: any[], type: string, patch: Record<string, unknown> = {}, options: EditOptions & { smoothShading?: boolean } = {}): Modifier[] {
  if (!(MODIFIER_TYPES as readonly string[]).includes(type)) {
    throw new Error(`Unknown modifier type "${type}". Types: ${MODIFIER_TYPES.join(', ')}.`);
  }
  const created: Modifier[] = [];
  editData(meshes, 'Add BlockSmooth modifier', (data) => {
    const m = createModifier(type as ModifierType, patch);
    data.modifiers.push(m);
    created.push(m);
  }, options, (mesh) => {
    if (options.smoothShading && type === 'subdivision') mesh.shading = 'smooth';
  });
  return created;
}

export function updateModifier(mesh: any, ref: string | number, patch: Record<string, unknown>, options: EditOptions = {}): Modifier {
  let updated: Modifier | null = null;
  editData([mesh], 'Edit BlockSmooth modifier', (data) => {
    const i = indexOf(data, ref, mesh);
    const m = data.modifiers[i];
    if (!isKnownModifier(m)) throw new Error(`Modifier "${m.id}" (${m.type}) comes from a newer BlockSmooth and cannot be edited here.`);
    updated = patchModifier(m, patch);
    data.modifiers[i] = updated;
  }, options);
  return updated!;
}

export function removeModifier(mesh: any, ref: string | number, options: EditOptions = {}): void {
  editData([mesh], 'Remove BlockSmooth modifier', (data) => {
    data.modifiers.splice(indexOf(data, ref, mesh), 1);
  }, options);
}

export function moveModifier(mesh: any, ref: string | number, toIndex: number, options: EditOptions = {}): void {
  editData([mesh], 'Move BlockSmooth modifier', (data) => {
    const from = indexOf(data, ref, mesh);
    const to = Math.max(0, Math.min(data.modifiers.length - 1, Math.round(toIndex)));
    const [m] = data.modifiers.splice(from, 1);
    data.modifiers.splice(to, 0, m);
  }, options);
}

/** Crease 0-1 on the given edges (0 removes the crease). */
export function setCrease(mesh: any, edges: EdgePair[], value: number, options: EditOptions = {}): number {
  if (!Number.isFinite(value)) throw new Error('crease must be a number from 0 to 1');
  const c = Math.min(LIMITS.crease.max, Math.max(LIMITS.crease.min, value));
  editData([mesh], 'Set edge crease', (data) => {
    for (const [a, b] of edges) {
      const key = edgeKey(a, b);
      if (c > 0) data.creases[key] = c; else delete data.creases[key];
    }
  }, options);
  return edges.length;
}

/** Mark (true) or clear (false) sharp shading on the given edges. */
export function setSharp(mesh: any, edges: EdgePair[], sharp: boolean, options: EditOptions = {}): number {
  editData([mesh], sharp ? 'Mark edges sharp' : 'Clear sharp edges', (data) => {
    for (const [a, b] of edges) {
      const key = edgeKey(a, b);
      if (sharp) data.sharp[key] = 1; else delete data.sharp[key];
    }
  }, options);
  return edges.length;
}

/** Drop marks on edges whose vertices no longer exist (deleted or merged since). */
function pruneEdgeMarks(data: SmoothData, mesh: any): void {
  const alive = (key: string) => {
    const i = key.indexOf('_');
    return i > 0 && !!mesh.vertices[key.slice(0, i)] && !!mesh.vertices[key.slice(i + 1)];
  };
  for (const key of Object.keys(data.creases)) if (!alive(key)) delete data.creases[key];
  for (const key of Object.keys(data.sharp)) if (!alive(key)) delete data.sharp[key];
}

function indexOf(data: SmoothData, ref: string | number, mesh: any): number {
  const i = typeof ref === 'number' ? ref : data.modifiers.findIndex((m) => m.id === ref);
  if (!Number.isInteger(i) || i < 0 || i >= data.modifiers.length) {
    const ids = data.modifiers.map((m, k) => `${k}: ${m.id} (${m.type})`).join(', ') || 'none';
    throw new Error(`Mesh "${mesh.name}" has no modifier ${JSON.stringify(ref)}. Modifiers: ${ids}.`);
  }
  return i;
}
