// A mesh's modifier stack turned into an evaluatable surface: the cage, the
// subdivision hierarchy and its evaluators. Building is the expensive part and
// depends only on topology + settings; evaluate() is cheap and runs on every
// vertex drag or animation frame.

import { buildHierarchy, Evaluator, type Hierarchy } from '../core/hierarchy';
import { NormalSolver, type CornerNormals } from '../core/normals';
import { FACE_BUDGET, levelsWithinBudget, resolvePlan, type Context, type Plan } from '../model/plan';
import type { SmoothData } from '../model/schema';
import { readCage, readPositions, readSharpEdges, readSharpness, type Cage } from './cage';

export interface Surface {
  readonly cage: Cage;
  readonly plan: Plan;
  /** Levels actually used (the plan's, reduced to the face budget). */
  readonly levels: number;
  readonly hierarchy: Hierarchy;
  /** Identifies topology + settings; equal keys mean the same surface. */
  readonly key: string;
  readonly positions: Evaluator;
  readonly corners: Evaluator;
  /** Shading normals of the final level (knows the edges marked sharp on the cage). */
  readonly normals: NormalSolver;
}

export interface Evaluated {
  /** 3 per final vertex. */
  readonly positions: ArrayLike<number>;
  readonly normals: CornerNormals;
}

/** Cheap identity of what buildSurface would produce, without building it. */
export function surfaceKey(cage: Cage, data: SmoothData, plan: Plan): string {
  return `${cage.signature}#${JSON.stringify(data.creases)}#${JSON.stringify(data.sharp)}#${plan.levels}|${plan.flat}|${plan.maxAngle}`;
}

/** The plan for this mesh and context (inactive when the stack changes nothing). */
export function planFor(mesh: any, data: SmoothData, context: Context): Plan {
  return resolvePlan(data, context, mesh.shading);
}

export function buildSurface(mesh: any, data: SmoothData, context: Context, cage: Cage = readCage(mesh)): Surface {
  const plan = planFor(mesh, data, context);
  const t = cage.topology;
  const levels = levelsWithinBudget(t.faceCount, t.cornerCount, plan.levels, FACE_BUDGET[context]);
  const hierarchy = buildHierarchy(t, readSharpness(cage, data), levels);
  const cageSharp = readSharpEdges(cage, data);
  const sharpEdges = new Uint8Array(hierarchy.final.edgeCount);
  for (let e = 0; e < sharpEdges.length; e++) {
    const o = hierarchy.edgeOrigin[e];
    if (o >= 0 && cageSharp[o]) sharpEdges[e] = 1;
  }
  return {
    cage, plan, levels, hierarchy,
    key: surfaceKey(cage, data, plan),
    positions: new Evaluator(hierarchy, 3),
    corners: new Evaluator(hierarchy, 2, true),
    normals: new NormalSolver(hierarchy.final, sharpEdges),
  };
}

/** Final positions and shading normals for the mesh's current (optionally deformed) vertices. */
export function evaluate(surface: Surface, mesh: any, offsets?: Record<string, number[]> | null): Evaluated {
  const positions = surface.positions.run(readPositions(mesh, surface.cage, offsets));
  const maxAngle = surface.plan.maxAngle === null ? null : surface.plan.maxAngle * Math.PI / 180;
  const normals = surface.normals.solve(positions, { flat: surface.plan.flat, maxAngle });
  return { positions, normals };
}
