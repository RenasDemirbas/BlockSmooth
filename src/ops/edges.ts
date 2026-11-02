// Finding mesh edges to mark: validated explicit lists, the edit-mode
// selection, or every edge folded more than an angle.

import { edgesSharperThan } from '../core/normals';
import { findEdge } from '../core/topology';
import { readCage, readPositions } from '../bb/cage';

export type EdgePair = [string, string];

/** Check that every pair is an edge of a face of the mesh; throws a message naming the bad pairs. */
export function validateEdges(mesh: any, edges: unknown): EdgePair[] {
  if (!Array.isArray(edges)) throw new Error('edges must be an array of [vertexA, vertexB] vertex-key pairs');
  const cage = readCage(mesh);
  const bad: string[] = [];
  const out: EdgePair[] = [];
  for (const pair of edges) {
    const a = Array.isArray(pair) ? cage.vertexIndex.get(pair[0]) : undefined;
    const b = Array.isArray(pair) ? cage.vertexIndex.get(pair[1]) : undefined;
    if (a === undefined || b === undefined || findEdge(cage.topology, a, b) < 0) {
      bad.push(JSON.stringify(pair));
    } else {
      out.push([pair[0], pair[1]]);
    }
  }
  if (bad.length) {
    throw new Error(`Not edges of mesh "${mesh.name}": ${bad.slice(0, 8).join(', ')}${bad.length > 8 ? ` and ${bad.length - 8} more` : ''}. Use vertex keys of two vertices that share a face side.`);
  }
  return out;
}

/** Edges selected in edit mode (edge selection, or the sides of selected faces). */
export function selectedEdges(mesh: any): EdgePair[] {
  const sel = Project.mesh_selection?.[mesh.uuid];
  if (!sel) return [];
  const out: EdgePair[] = [];
  for (const edge of sel.edges ?? []) out.push([edge[0], edge[1]]);
  if (!out.length) {
    for (const fkey of sel.faces ?? []) {
      const face = mesh.faces[fkey];
      if (!face) continue;
      const loop: string[] = face.getSortedVertices();
      loop.forEach((v, i) => out.push([v, loop[(i + 1) % loop.length]]));
    }
  }
  return out;
}

/** Run fn for each mesh with selected edges; returns how many edges were passed in total. */
export function withSelectedEdges(meshes: any[], fn: (mesh: any, edges: EdgePair[]) => void): number {
  let count = 0;
  for (const mesh of meshes) {
    const edges = selectedEdges(mesh);
    if (edges.length) { fn(mesh, edges); count += edges.length; }
  }
  return count;
}

/** Every edge whose two faces meet at more than `degrees`. */
export function edgesByAngle(mesh: any, degrees: number): EdgePair[] {
  const cage = readCage(mesh);
  const t = cage.topology;
  return edgesSharperThan(t, readPositions(mesh, cage), degrees * Math.PI / 180).map((e) => [
    cage.vertexKeys[t.edgeVerts[2 * e]], cage.vertexKeys[t.edgeVerts[2 * e + 1]],
  ]);
}
