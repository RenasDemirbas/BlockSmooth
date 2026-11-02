// window.BlockSmooth: the public API for scripts and other plugins (the
// Blockbench MCP bridge uses it). Versioned: API_VERSION changes only on
// breaking changes. Errors are thrown as Error with a message that says how to
// fix the call. Every editing call is one undo step unless {undo: false}.

import { LIMITS, MODIFIER_TYPES } from './model/schema';
import { getData } from './bb/property';
import type { DisplayController } from './bb/controller';
import { addModifier, moveModifier, removeModifier, setCrease, setSharp, updateModifier, type EditOptions } from './ops/edit';
import { edgesByAngle, selectedEdges, validateEdges, type EdgePair } from './ops/edges';
import { applyModifiers } from './ops/apply';
import { describeMesh } from './ops/describe';
import type { Deletable } from './util/lifecycle';

export const API_VERSION = 1;

type MeshRef = any;

function resolveMesh(ref: MeshRef): any {
  if (ref instanceof Mesh) return ref;
  if (typeof ref === 'string') {
    const byUuid = Mesh.all.find((m: any) => m.uuid === ref);
    if (byUuid) return byUuid;
    const byName = Mesh.all.filter((m: any) => m.name === ref);
    if (byName.length === 1) return byName[0];
    if (byName.length > 1) throw new Error(`${byName.length} meshes are named "${ref}"; pass the uuid.`);
  }
  throw new Error(`No mesh ${JSON.stringify(ref)} in the open project. Pass a Mesh, its uuid or its unique name.`);
}

function resolveEdges(mesh: any, edges: unknown): EdgePair[] {
  if (edges === 'selected') {
    const sel = selectedEdges(mesh);
    if (!sel.length) throw new Error(`No edges or faces of "${mesh.name}" are selected in edit mode.`);
    return sel;
  }
  if (edges && typeof edges === 'object' && !Array.isArray(edges) && typeof (edges as any).angle === 'number') {
    return edgesByAngle(mesh, (edges as any).angle);
  }
  return validateEdges(mesh, edges);
}

export function installApi(controller: DisplayController): Deletable {
  const api = {
    version: __BLOCKSMOOTH_VERSION__,
    api_version: API_VERSION,
    modifier_types: [...MODIFIER_TYPES],
    limits: LIMITS,

    /** Modifier stack, creases and what it produces in the viewport and in exports. */
    describe: (mesh: MeshRef) => describeMesh(resolveMesh(mesh)),
    /** A validated copy of the stored data. */
    getData: (mesh: MeshRef) => getData(resolveMesh(mesh)),

    addModifier: (mesh: MeshRef, type: string, patch?: Record<string, unknown>, options?: EditOptions & { smoothShading?: boolean }) =>
      addModifier([resolveMesh(mesh)], type, patch, options)[0],
    updateModifier: (mesh: MeshRef, modifier: string | number, patch: Record<string, unknown>, options?: EditOptions) =>
      updateModifier(resolveMesh(mesh), modifier, patch, options),
    removeModifier: (mesh: MeshRef, modifier: string | number, options?: EditOptions) =>
      removeModifier(resolveMesh(mesh), modifier, options),
    moveModifier: (mesh: MeshRef, modifier: string | number, toIndex: number, options?: EditOptions) =>
      moveModifier(resolveMesh(mesh), modifier, toIndex, options),

    /** edges: [[a, b], ...] vertex keys, "selected", or {angle: degrees}. Returns the number of edges set. */
    setCrease: (mesh: MeshRef, edges: unknown, value: number, options?: EditOptions) => {
      const m = resolveMesh(mesh);
      return setCrease(m, resolveEdges(m, edges), value, options);
    },
    setSharp: (mesh: MeshRef, edges: unknown, sharp = true, options?: EditOptions) => {
      const m = resolveMesh(mesh);
      return setSharp(m, resolveEdges(m, edges), sharp, options);
    },
    /** [[a, b], ...] edges whose faces meet at more than `degrees`. */
    edgesByAngle: (mesh: MeshRef, degrees: number) => edgesByAngle(resolveMesh(mesh), degrees),

    /** Make the viewport subdivision permanent (one undo step). */
    apply: (mesh: MeshRef) => applyModifiers(resolveMesh(mesh)),

    /** The three.js object that draws the smooth result, or null (mesh shown as-is). */
    getDisplayObject: (mesh: MeshRef) => controller.displayObject(resolveMesh(mesh)),
    /** Rebuild the viewport display of one mesh, or of all. */
    refresh: (mesh?: MeshRef) => {
      if (mesh === undefined) controller.refreshAll();
      else controller.sync(resolveMesh(mesh), { geometry: true, uv: true, faces: true, highlight: true });
    },
  };
  window.BlockSmooth = api;
  window.dispatchEvent?.(new (window as any).CustomEvent('blocksmooth_ready', { detail: { version: api.version } }));
  return {
    delete() {
      if (window.BlockSmooth === api) delete window.BlockSmooth;
    },
  };
}
