// A cage subdivided several levels deep, plus where every final face, edge and
// vertex came from on the cage, and evaluators that push cage data (positions,
// bone weights, UVs) through all levels. Pure — no Blockbench globals.

import { applyRows } from './sparse';
import { subdivideOnce, type Level } from './subdivide';
import type { Topology } from './topology';

export interface Hierarchy {
  readonly cage: Topology;
  readonly levels: readonly Level[];
  readonly final: Topology;
  /** Final face -> cage face. Faces of one cage face are contiguous, in cage face order. */
  readonly faceOrigin: Int32Array;
  /** Final edge -> the cage edge it lies on, or -1. */
  readonly edgeOrigin: Int32Array;
  /** Final vertex -> the cage vertex it moved from, or -1. */
  readonly vertexOrigin: Int32Array;
  /** Crease sharpness left on each final edge. */
  readonly finalSharpness: Float64Array;
}

export function buildHierarchy(cage: Topology, sharpness: Float64Array, levelCount: number): Hierarchy {
  const levels: Level[] = [];
  let top = cage;
  let topSharpness = sharpness;
  let faceOrigin = identity(cage.faceCount);
  let edgeOrigin = identity(cage.edgeCount);
  let vertexOrigin = identity(cage.vertexCount);
  for (let i = 0; i < levelCount; i++) {
    const level = subdivideOnce(top, topSharpness);
    levels.push(level);
    faceOrigin = compose(level.faceParent, faceOrigin);
    edgeOrigin = compose(level.edgeParent, edgeOrigin);
    vertexOrigin = compose(level.vertexParent, vertexOrigin);
    top = level.child;
    topSharpness = level.childSharpness;
  }
  return { cage, levels, final: top, faceOrigin, edgeOrigin, vertexOrigin, finalSharpness: topSharpness };
}

/**
 * Pushes per-vertex (or, with corners: true, per-corner) data from the cage to
 * the final level. Buffers are reused between runs: the returned array is only
 * valid until the next run of the same evaluator.
 */
export class Evaluator {
  private readonly buffers: Float64Array[];

  constructor(private readonly hierarchy: Hierarchy, private readonly stride: number, private readonly corners = false) {
    this.buffers = hierarchy.levels.map((l) => new Float64Array(
      (corners ? l.child.cornerCount : l.child.vertexCount) * stride,
    ));
  }

  run(input: ArrayLike<number>): ArrayLike<number> {
    let current: ArrayLike<number> = input;
    this.hierarchy.levels.forEach((level, i) => {
      current = applyRows(this.corners ? level.cornerRows : level.vertexRows, current, this.stride, this.buffers[i]);
    });
    return current;
  }
}

function identity(n: number): Int32Array {
  const out = new Int32Array(n);
  for (let i = 0; i < n; i++) out[i] = i;
  return out;
}

/** origin[parent[i]] for each i, -1 staying -1. */
function compose(parent: Int32Array, origin: Int32Array): Int32Array {
  const out = new Int32Array(parent.length);
  for (let i = 0; i < parent.length; i++) out[i] = parent[i] < 0 ? -1 : origin[parent[i]];
  return out;
}
