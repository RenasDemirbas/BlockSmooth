// A readable summary of a mesh's BlockSmooth state: the stack and what it
// produces in each context, without building the surface.

import { facesAfter, FACE_BUDGET, levelsWithinBudget, resolvePlan, type Context } from '../model/plan';
import { getData } from '../bb/property';
import { readCage } from '../bb/cage';

export function describeMesh(mesh: any) {
  const data = getData(mesh);
  const t = readCage(mesh).topology;
  const context = (c: Context) => {
    const plan = resolvePlan(data, c, mesh.shading);
    const levels = levelsWithinBudget(t.faceCount, t.cornerCount, plan.levels, FACE_BUDGET[c]);
    return {
      active: plan.active,
      levels,
      faces: plan.active ? facesAfter(t.faceCount, t.cornerCount, levels) : t.faceCount,
      shading: plan.flat ? 'flat' : plan.maxAngle === null ? 'smooth' : `smooth below ${plan.maxAngle}°`,
      reduced_to_fit_budget: levels < plan.levels ? { requested: plan.levels, budget_faces: FACE_BUDGET[c] } : undefined,
    };
  };
  return {
    mesh: mesh.name,
    uuid: mesh.uuid,
    mesh_shading: mesh.shading,
    cage_faces: t.faceCount,
    modifiers: data.modifiers,
    creased_edges: Object.keys(data.creases).length,
    sharp_edges: Object.keys(data.sharp).length,
    viewport: context('viewport'),
    export: context('export'),
  };
}
