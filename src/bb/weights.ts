// Armature bone weights of a mesh, pushed through the subdivision. Weights are
// stored on the bones keyed "<first 6 chars of mesh uuid>:<vertex key>" (with
// a legacy fallback of the bare vertex key). Catmull-Clark masks are positive
// and sum to 1, so interpolated weights stay normalized.

import { Evaluator, type Hierarchy } from '../core/hierarchy';
import type { Cage } from './cage';

/** Bone -> this mesh's new weight entries (full keys). */
export type WeightEntries = Map<any, Record<string, number>>;

export function armatureBones(mesh: any): any[] {
  try {
    return mesh.getArmature?.()?.getAllBones?.() ?? [];
  } catch {
    return [];
  }
}

function weightPrefix(mesh: any): string {
  return `${String(mesh.uuid).substring(0, 6)}:`;
}

/**
 * Weight entries for the new vertices, for every bone that weights this mesh.
 * `vertexKeys[i]` is the key of output vertex i, which copies final-level vertex `source[i]`.
 */
export function transferWeights(mesh: any, cage: Cage, hierarchy: Hierarchy, vertexKeys: string[], source: Int32Array): WeightEntries {
  const out: WeightEntries = new Map();
  const prefix = weightPrefix(mesh);
  const evaluator = new Evaluator(hierarchy, 1);
  for (const bone of armatureBones(mesh)) {
    const cageWeights = new Float64Array(cage.vertexKeys.length);
    let any = false;
    cage.vertexKeys.forEach((key, i) => {
      const w = bone.getVertexWeight(mesh, key) || 0;
      cageWeights[i] = w;
      if (w) any = true;
    });
    if (!any) continue;
    const final = evaluator.run(cageWeights);
    const entries: Record<string, number> = {};
    // Written even when 0: a missing entry would fall back to a legacy bare-key weight.
    vertexKeys.forEach((key, i) => { entries[prefix + key] = final[source[i]]; });
    out.set(bone, entries);
  }
  return out;
}

/** A new vertex_weights dictionary: the bone's entries for other meshes plus `entries` for this one. */
export function mergedWeights(bone: any, mesh: any, entries: Record<string, number>): Record<string, number> {
  const prefix = weightPrefix(mesh);
  const dict: Record<string, number> = {};
  for (const [key, value] of Object.entries(bone.vertex_weights as Record<string, number>)) {
    if (!key.startsWith(prefix)) dict[key] = value;
  }
  return Object.assign(dict, entries);
}
