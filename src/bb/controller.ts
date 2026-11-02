// Keeps each mesh's viewport display in step with the mesh. Called from the
// preview hooks with the aspect Blockbench just refreshed; works out what has to
// be rebuilt (topology / settings) or only re-evaluated (positions, UVs,
// materials, highlight). Any failure tears the display down and leaves the
// plain Blockbench mesh visible — the fail-safe state.

import { report } from '../util/guard';
import { getData, hasData } from './property';
import { quickSignature, readCage, readDisplayUVs, type Cage } from './cage';
import { SmoothDisplay } from './display';
import { faceSlots, hideSurface, isTwin } from './materials';
import { buildSurface, evaluate, planFor, surfaceKey, type Surface } from './surface';

export interface Aspects {
  geometry?: boolean;
  uv?: boolean;
  faces?: boolean;
  highlight?: boolean;
}

export const ALL_ASPECTS: Aspects = { geometry: true, uv: true, faces: true, highlight: true };

interface DisplayRecord {
  readonly display: SmoothDisplay;
  surface: Surface | null;
  /** What Blockbench last assigned to the cage, before it was hidden. */
  material: any;
  slots: Int32Array | null;
}

/** Tools and view modes that show data on the cage itself (vertex weights). */
function cageOnlyMode(): boolean {
  const view = Project?.view_mode;
  return Toolbox?.selected?.id === 'weight_brush' || view === 'vertex_weight' || view === 'weighted_bone_colors';
}

export class DisplayController {
  private readonly records = new Map<string, DisplayRecord>();
  /** Meshes whose data is temporarily swapped (export bake): left alone entirely. */
  private readonly suspended = new Set<string>();
  /** Meshes we are refreshing ourselves: ignore the events that causes. */
  private readonly busy = new Set<string>();
  private lastCageOnly = false;

  constructor(private readonly viewportEnabled: () => boolean) {}

  /** Bring the display of one mesh up to date after Blockbench refreshed `aspects`. */
  sync(mesh: any, aspects: Aspects, offsets?: Record<string, number[]> | null): void {
    const uuid = mesh?.uuid;
    if (!uuid || this.busy.has(uuid) || this.suspended.has(uuid)) return;
    try {
      this.syncUnsafe(mesh, aspects, offsets);
    } catch (err) {
      report('viewport update', err, mesh.name);
      this.teardown(mesh);
    }
  }

  /** Armature deformation frame: only positions and normals change. */
  deform(mesh: any, offsets: Record<string, number[]> | null): void {
    const rec = this.records.get(mesh?.uuid);
    if (!rec?.surface || this.suspended.has(mesh.uuid)) return;
    try {
      const ev = evaluate(rec.surface, mesh, offsets);
      rec.display.writeSurface(ev.positions, ev.normals.normals);
    } catch (err) {
      report('deformation update', err, mesh.name);
      this.teardown(mesh);
    }
  }

  /** The three.js object drawing the smooth result, or null. */
  displayObject(mesh: any): any {
    const rec = this.records.get(mesh?.uuid);
    return rec?.display.object.parent ? rec.display.object : null;
  }

  /** The viewport surface (for statistics), or null. */
  surfaceOf(mesh: any): Surface | null {
    return this.records.get(mesh?.uuid)?.surface ?? null;
  }

  /** Stop drawing a mesh and leave it alone until resume() (used while its data is swapped). */
  suspend(mesh: any): void {
    this.teardown(mesh);
    this.suspended.add(mesh.uuid);
  }

  resume(mesh: any): void {
    this.suspended.delete(mesh.uuid);
  }

  /** Remove the display; the cage shows its own surface again. */
  teardown(mesh: any): void {
    const rec = this.records.get(mesh?.uuid);
    if (!rec) return;
    this.records.delete(mesh.uuid);
    rec.display.dispose();
    const object = mesh.mesh;
    if (object && isTwin(object.material)) this.refreshFaces(mesh, rec);
  }

  /** Forget displays of meshes that no longer exist in any open project. */
  prune(): void {
    const alive = new Set<string>();
    for (const project of ModelProject?.all ?? []) {
      for (const el of project.elements ?? []) alive.add(el.uuid);
    }
    for (const [uuid, rec] of this.records) {
      if (!alive.has(uuid)) { rec.display.dispose(); this.records.delete(uuid); }
    }
  }

  /** Re-sync every mesh of the current project. */
  refreshAll(): void {
    this.lastCageOnly = cageOnlyMode();
    for (const mesh of Mesh?.all ?? []) this.sync(mesh, ALL_ASPECTS);
  }

  /**
   * Call after tool / view-mode switches: re-syncs everything when weight
   * painting started or ended. (Leaving the weight brush refreshes the meshes
   * while it is still the selected tool, so the switch needs this check.)
   */
  checkModeChange(): void {
    if (cageOnlyMode() !== this.lastCageOnly) this.refreshAll();
  }

  /** Remove every display (plugin unload). */
  disposeAll(): void {
    for (const project of ModelProject?.all ?? []) {
      for (const el of project.elements ?? []) if (this.records.has(el.uuid)) this.teardown(el);
    }
    for (const rec of this.records.values()) rec.display.dispose();
    this.records.clear();
  }

  // ───────────────────────────── internals ─────────────────────────────

  private syncUnsafe(mesh: any, aspects: Aspects, offsets?: Record<string, number[]> | null): void {
    const object = mesh.mesh;
    if (!object || !this.viewportEnabled() || !hasData(mesh) || cageOnlyMode()) {
      this.teardown(mesh);
      return;
    }
    const data = getData(mesh);
    const plan = planFor(mesh, data, 'viewport');
    if (!plan.active) {
      this.teardown(mesh);
      return;
    }

    let rec = this.records.get(mesh.uuid);
    const reuseCage = !aspects.geometry && rec?.surface && rec.surface.cage.quick === quickSignature(mesh);
    const cage: Cage = reuseCage ? rec!.surface!.cage : readCage(mesh);
    if (!cage.topology.faceCount) {
      this.teardown(mesh);
      return;
    }

    if (!rec) {
      rec = { display: new SmoothDisplay(mesh.uuid), surface: null, material: null, slots: null };
      this.records.set(mesh.uuid, rec);
    }
    let all = false;
    if (rec.surface?.key !== surfaceKey(cage, data, plan)) {
      rec.surface = buildSurface(mesh, data, 'viewport', cage);
      rec.display.setTopology(rec.surface.hierarchy.final);
      all = true;
    }
    const surface = rec.surface;
    const { display } = rec;

    if (all || aspects.geometry) {
      const ev = evaluate(surface, mesh, offsets);
      display.writeSurface(ev.positions, ev.normals.normals);
    }
    if (all || aspects.uv) {
      // Read from the cage's own uv buffer: already normalized, flipped and frame-adjusted by Blockbench.
      display.writeUVs(surface.corners.run(readDisplayUVs(mesh, surface.cage)));
    }
    // The cage holds real materials only right after Blockbench's updateFaces; once
    // hidden it holds twins. Never mistake twins for the real thing: if we have
    // no real material yet, let Blockbench assign them again first.
    if (isTwin(object.material) && !rec.material) this.refreshFaces(mesh, rec);
    let materialsChanged = false;
    if (!isTwin(object.material)) {
      rec.material = object.material;
      rec.slots = faceSlots(surface.cage.bbIndexStart, object);
      materialsChanged = true;
    }
    if (all || materialsChanged) {
      const slots = rec.slots && rec.slots.length === surface.cage.topology.faceCount ? rec.slots : null;
      const material = Array.isArray(rec.material) && !slots ? rec.material[0] : rec.material;
      display.writeMaterials(material, surface.hierarchy.faceOrigin, slots);
    }
    if (all || aspects.highlight || materialsChanged) {
      display.writeHighlight(surface.hierarchy.faceOrigin, readCageHighlight(object, surface.cage));
    }
    hideSurface(object);
    display.attach(object);
  }

  /** Let Blockbench reassign the cage's real materials, without reacting to it ourselves. */
  private refreshFaces(mesh: any, rec: DisplayRecord): void {
    this.busy.add(mesh.uuid);
    try {
      Mesh.preview_controller.updateFaces(mesh);
    } catch (err) {
      report('restoring cage materials', err, mesh.name);
      if (rec.material) mesh.mesh.material = rec.material;
    } finally {
      this.busy.delete(mesh.uuid);
    }
  }
}

/** The cage's highlight value per cage face (Blockbench writes one per corner). */
function readCageHighlight(object: any, cage: Cage): Uint8Array {
  const out = new Uint8Array(cage.topology.faceCount);
  const attr = object.geometry?.attributes?.highlight;
  if (!attr) return out;
  for (let f = 0; f < out.length; f++) {
    const i = cage.bbCornerStart[f];
    if (i < attr.count) out[f] = attr.array[i];
  }
  return out;
}
