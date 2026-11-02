// Export baking: for the duration of one export, every mesh with active
// modifiers holds its subdivided data (vertices, faces, shading normals, bone
// weights) instead of its cage, and its scene object shows that data. Every
// exporter — the ones that read mesh data (OBJ, FBX, Collada) and the ones that
// read the three.js scene (glTF, STL) — then writes the smooth result without
// knowing about BlockSmooth. end() puts every cage back exactly as it was:
// the original objects are re-assigned, nothing is copied back field by field.
//
// Safety:
//  - Reentrant: a nested export joins the running session.
//  - withCage(): code that must see the real project during a session (the
//    .bbmodel codec: saving, auto-backup) runs with the cages swapped back in.
//  - A mesh that fails to bake is exported as its cage (reported, not thrown).

import { report } from '../util/guard';
import { getData } from '../bb/property';
import { bakeSurface, makeFaces } from '../bb/bakedmesh';
import { buildSurface } from '../bb/surface';
import { mergedWeights, transferWeights, type WeightEntries } from '../bb/weights';
import type { DisplayController } from '../bb/controller';

interface MeshData {
  readonly vertices: Record<string, number[]>;
  readonly faces: Record<string, any>;
  readonly shading: string;
  /** Per-vertex shading normals (split at sharp edges), or null for flat / Blockbench's own. */
  readonly normals: Record<string, number[]> | null;
}

interface Swap {
  readonly mesh: any;
  readonly cage: MeshData;
  readonly baked: MeshData;
  readonly weights: WeightEntries;
  readonly selection: any;
}

export class BakeSession {
  private static current: BakeSession | null = null;
  private depth = 1;
  private readonly swaps: Swap[] = [];
  /** Bone -> its vertex_weights object before the session touched it. */
  private readonly originalWeights = new Map<any, Record<string, number>>();
  private swappedIn = false;

  static get active(): BakeSession | null {
    return BakeSession.current;
  }

  /** Bake every mesh of the current project with active export modifiers (or join the running session). */
  static begin(controller: DisplayController): BakeSession {
    if (BakeSession.current) {
      BakeSession.current.depth++;
      return BakeSession.current;
    }
    const session = new BakeSession(controller);
    BakeSession.current = session;
    try {
      session.prepare();
      session.swapIn();
    } catch (err) {
      session.depth = 1;
      session.end();
      throw err;
    }
    return session;
  }

  private constructor(private readonly controller: DisplayController) {}

  get meshCount(): number {
    return this.swaps.length;
  }

  end(): void {
    if (BakeSession.current !== this) return;
    if (--this.depth > 0) return;
    BakeSession.current = null;
    this.swapOut();
  }

  /** The meshes currently holding baked data. */
  bakedMeshes(): any[] {
    return this.swappedIn ? this.swaps.map((s) => s.mesh) : [];
  }

  /** Run fn with every cage temporarily restored (fn must be synchronous). */
  withCage<T>(fn: () => T): T {
    if (!this.swappedIn) return fn();
    this.swapOut();
    try {
      return fn();
    } finally {
      this.swapIn();
    }
  }

  private prepare(): void {
    for (const mesh of Mesh.all) {
      try {
        const baked = bakeMesh(mesh);
        if (!baked) continue;
        this.swaps.push({
          mesh,
          cage: { vertices: mesh.vertices, faces: mesh.faces, shading: mesh.shading, normals: null },
          baked: baked.data,
          weights: baked.weights,
          selection: Project.mesh_selection?.[mesh.uuid],
        });
      } catch (err) {
        report('export bake (exported without modifiers)', err, mesh.name);
        Blockbench.showQuickMessage?.(`BlockSmooth: "${mesh.name}" exported without modifiers (see console)`, 3000);
      }
    }
  }

  private swapIn(): void {
    if (this.swappedIn) return;
    this.swappedIn = true;
    for (const swap of this.swaps) {
      this.controller.suspend(swap.mesh);
      if (Project.mesh_selection) delete Project.mesh_selection[swap.mesh.uuid];
      for (const [bone, entries] of swap.weights) {
        if (!this.originalWeights.has(bone)) this.originalWeights.set(bone, bone.vertex_weights);
        bone.vertex_weights = mergedWeights(bone, swap.mesh, entries);
      }
      applyData(swap.mesh, swap.baked);
      refreshPreview(swap.mesh);
    }
  }

  private swapOut(): void {
    if (!this.swappedIn) return;
    this.swappedIn = false;
    for (const [bone, dict] of this.originalWeights) bone.vertex_weights = dict;
    this.originalWeights.clear();
    for (const swap of this.swaps) {
      try {
        applyData(swap.mesh, swap.cage);
        if (swap.selection && Project.mesh_selection) Project.mesh_selection[swap.mesh.uuid] = swap.selection;
      } catch (err) {
        report('restoring a mesh after export', err, swap.mesh.name);
      } finally {
        this.controller.resume(swap.mesh);
      }
      refreshPreview(swap.mesh);
    }
  }
}

/** The mesh's export-context result as Blockbench data, or null if nothing changes. */
function bakeMesh(mesh: any): { data: MeshData; weights: WeightEntries } | null {
  const surface = buildSurface(mesh, getData(mesh), 'export');
  if (!surface.plan.active || !surface.cage.topology.faceCount) return null;

  const split = !surface.plan.flat;
  const geo = bakeSurface(surface, mesh, split);
  const { baked } = geo;
  const keys: string[] = [];
  const vertices: Record<string, number[]> = {};
  for (let i = 0; i < baked.vertexCount; i++) {
    // "~" never occurs in Blockbench's own keys, so these cannot collide with legacy weight keys.
    const key = `bs~${i.toString(36)}`;
    keys.push(key);
    vertices[key] = [baked.positions[3 * i], baked.positions[3 * i + 1], baked.positions[3 * i + 2]];
  }
  const faces: Record<string, any> = {};
  makeFaces(mesh, surface, geo, keys).forEach((face, i) => { faces[`bsf~${i.toString(36)}`] = face; });

  let normals: Record<string, number[]> | null = null;
  if (baked.normals) {
    normals = {};
    for (let i = 0; i < baked.vertexCount; i++) {
      normals[keys[i]] = [baked.normals[3 * i], baked.normals[3 * i + 1], baked.normals[3 * i + 2]];
    }
  }
  return {
    data: { vertices, faces, shading: split ? 'smooth' : 'flat', normals },
    weights: transferWeights(mesh, surface.cage, surface.hierarchy, keys, baked.vertexSource),
  };
}

function applyData(mesh: any, data: MeshData): void {
  mesh.vertices = data.vertices;
  mesh.faces = data.faces;
  mesh.shading = data.shading;
  if (data.normals) {
    const normals = data.normals;
    // Instance override: Blockbench's exporters and updateGeometry call this for smooth meshes.
    mesh.calculateNormals = () => normals;
  } else {
    delete mesh.calculateNormals;
  }
}

function refreshPreview(mesh: any): void {
  try {
    const pc = Mesh.preview_controller;
    pc.updateGeometry(mesh);
    pc.updateFaces(mesh);
    pc.updateUV(mesh);
  } catch (err) {
    report('refreshing the preview', err, mesh.name);
  }
}
