// What the modifier stack means for one context (viewport or export): how many
// subdivision levels and how to shade. Also the face budget that keeps a deep
// stack from freezing Blockbench. Pure — no Blockbench globals.

import { isKnownModifier, type SmoothData } from './schema';

export type Context = 'viewport' | 'export';

export interface Plan {
  /** True when BlockSmooth changes anything; false leaves the mesh to Blockbench. */
  readonly active: boolean;
  readonly levels: number;
  readonly flat: boolean;
  /** Smoothing angle in degrees, or null for no limit (marked sharp edges still apply). */
  readonly maxAngle: number | null;
}

/** Most faces a context may produce; deeper stacks are reduced to fit. */
export const FACE_BUDGET: Record<Context, number> = { viewport: 400_000, export: 1_500_000 };

/**
 * Levels of all enabled subdivision modifiers add up. The last enabled
 * "smooth by angle" decides the shading; without one the mesh's own
 * Blockbench shading (flat / smooth) is used.
 */
export function resolvePlan(data: SmoothData, context: Context, shading: string): Plan {
  let levels = 0;
  let angle: number | undefined;
  let any = false;
  for (const m of data.modifiers) {
    if (!isKnownModifier(m) || !m[context]) continue;
    if (m.type === 'subdivision') {
      const l = context === 'export' ? m.export_levels : m.levels;
      levels += l;
      if (l > 0) any = true;
    } else {
      angle = m.angle;
      any = true;
    }
  }
  if (angle !== undefined) return { active: true, levels, flat: false, maxAngle: angle >= 180 ? null : angle };
  return { active: any, levels, flat: shading !== 'smooth', maxAngle: null };
}

/** Faces after `levels` levels: every cage corner becomes a quad, which then splits into 4 per level. */
export function facesAfter(faceCount: number, cornerCount: number, levels: number): number {
  return levels <= 0 ? faceCount : cornerCount * 4 ** (levels - 1);
}

/** The deepest level count, at most `levels`, that stays within the budget. */
export function levelsWithinBudget(faceCount: number, cornerCount: number, levels: number, budget: number): number {
  let l = levels;
  while (l > 0 && facesAfter(faceCount, cornerCount, l) > budget) l--;
  return l;
}
