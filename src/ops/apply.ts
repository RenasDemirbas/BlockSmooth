// Apply: make the viewport subdivision permanent, as one undo step. The mesh
// stays connected (no vertex splitting) so you can keep modeling it:
//  - vertices that come from cage vertices keep their keys (selections and
//    references to them stay meaningful), new vertices get new keys
//  - loose vertices and loose edges of the cage are kept as they were
//  - UVs, textures, bone weights, seams and sharp marks carry over; creases
//    keep what is left of their sharpness after the applied levels
//  - the applied subdivision modifiers are removed; the others stay

import { edgeKey } from '../model/edges';
import { isKnownModifier } from '../model/schema';
import { getData, setData } from '../bb/property';
import { bakeSurface, makeFaces } from '../bb/bakedmesh';
import { buildSurface } from '../bb/surface';
import { armatureBones, mergedWeights, transferWeights } from '../bb/weights';
import { refreshMeshes } from './edit';

export interface ApplyResult {
  readonly applied: boolean;
  readonly levels: number;
  readonly faces_before: number;
  readonly faces_after: number;
  readonly vertices_after: number;
}

export function applyModifiers(mesh: any): ApplyResult {
  const data = getData(mesh);
  const surface = buildSurface(mesh, data, 'viewport');
  const facesBefore = Object.keys(mesh.faces).length;
  if (surface.levels === 0) {
    return { applied: false, levels: 0, faces_before: facesBefore, faces_after: facesBefore, vertices_after: Object.keys(mesh.vertices).length };
  }

  // ── compute everything first
  const { cage, hierarchy } = surface;
  const geo = bakeSurface(surface, mesh, false);
  const { baked } = geo;
  const final = hierarchy.final;
  const keptLoose = cage.vertexKeys.filter((_, i) => cage.topology.vertexCornerOffsets[i + 1] === cage.topology.vertexCornerOffsets[i]);
  const looseEdges = Object.entries(mesh.faces).filter(([, f]: any) => f.vertices.length < 3) as [string, any][];

  const taken = new Set<string>([...cage.vertexKeys]);
  const keys: string[] = [];
  const vertices: Record<string, number[]> = {};
  for (let i = 0; i < baked.vertexCount; i++) {
    const o = hierarchy.vertexOrigin[baked.vertexSource[i]];
    const key = o >= 0 ? cage.vertexKeys[o] : uniqueKey(taken);
    taken.add(key);
    keys.push(key);
    vertices[key] = [baked.positions[3 * i], baked.positions[3 * i + 1], baked.positions[3 * i + 2]];
  }
  for (const key of keptLoose) vertices[key] = mesh.vertices[key].slice();
  const faces = makeFaces(mesh, surface, geo, keys);
  const weights = transferWeights(mesh, cage, hierarchy, keys, baked.vertexSource);

  // Edge marks: final edge -> new key, from the cage edge it lies on.
  const finalToBaked = new Int32Array(final.vertexCount).fill(-1);
  for (let i = 0; i < baked.vertexCount; i++) finalToBaked[baked.vertexSource[i]] = i;
  const cageEdgeKey = (e: number) => edgeKey(cage.vertexKeys[cage.topology.edgeVerts[2 * e]], cage.vertexKeys[cage.topology.edgeVerts[2 * e + 1]]);
  const seams: Record<string, string> = {};
  const sharp: Record<string, 1> = {};
  const creases: Record<string, number> = {};
  for (let e = 0; e < final.edgeCount; e++) {
    const o = hierarchy.edgeOrigin[e];
    if (o < 0) continue;
    const a = finalToBaked[final.edgeVerts[2 * e]], b = finalToBaked[final.edgeVerts[2 * e + 1]];
    if (a < 0 || b < 0) continue;
    const from = cageEdgeKey(o), to = edgeKey(keys[a], keys[b]);
    if (mesh.seams?.[from]) seams[to] = mesh.seams[from];
    if (data.sharp[from]) sharp[to] = 1;
    const s = hierarchy.finalSharpness[e];
    if (s > 0) creases[to] = s === Infinity ? 1 : Math.min(1, Math.sqrt(s / 10));
  }
  for (const [, face] of looseEdges) {
    const [a, b] = face.vertices;
    const key = edgeKey(a, b);
    if (mesh.seams?.[key]) seams[key] = mesh.seams[key];
  }
  const nextData = {
    ...data,
    modifiers: data.modifiers.filter((m) => !(isKnownModifier(m) && m.type === 'subdivision' && m.viewport)),
    creases, sharp,
  };

  // ── then change the mesh, as one undo step
  const bones = armatureBones(mesh).filter((b) => weights.has(b));
  Undo.initEdit({ elements: [mesh, ...bones], selection: true });
  try {
    mesh.vertices = vertices;
    mesh.faces = {};
    for (const [key, face] of looseEdges) mesh.faces[key] = face; // first: addFaces avoids taken keys
    mesh.addFaces(...faces);
    mesh.seams = seams;
    setData(mesh, nextData);
    for (const bone of bones) bone.vertex_weights = mergedWeights(bone, mesh, weights.get(bone)!);
    if (Project.mesh_selection) delete Project.mesh_selection[mesh.uuid];
  } catch (err) {
    Undo.cancelEdit(true);
    throw err;
  }
  Undo.finishEdit('Apply BlockSmooth subdivision');
  refreshMeshes([mesh]);
  return {
    applied: true, levels: surface.levels, faces_before: facesBefore,
    faces_after: Object.keys(mesh.faces).length, vertices_after: Object.keys(mesh.vertices).length,
  };
}

/** A 4-character key like Blockbench's own (bbuid(4)) that is not taken yet. */
function uniqueKey(taken: Set<string>): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  for (let len = 4; ; len++) {
    for (let attempt = 0; attempt < 64; attempt++) {
      let key = '';
      for (let i = 0; i < len; i++) key += chars[Math.floor(Math.random() * chars.length)];
      if (!taken.has(key)) return key;
    }
  }
}
