// The BlockSmooth panel (edit mode, mesh formats): modifier stack of the
// selected mesh, edge crease / sharp tools for the edit-mode selection, face
// counts, Apply. All changes go through ops/ (undoable, validated).

import { LIMITS } from '../model/schema';
import { Lifecycle, type Deletable } from '../util/lifecycle';
import { addModifier, moveModifier, removeModifier, setCrease, setSharp, updateModifier } from '../ops/edit';
import { withSelectedEdges, type EdgePair } from '../ops/edges';
import { applyModifiers } from '../ops/apply';
import { describeMesh } from '../ops/describe';

const CSS = `
.blocksmooth_panel { padding: 4px 8px 8px; }
.blocksmooth_panel .bs_row { display: flex; gap: 4px; align-items: center; margin: 4px 0; }
.blocksmooth_panel .bs_row > label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.blocksmooth_panel .bs_row input[type=number] { width: 60px; flex: 0 0 60px; height: 28px; padding: 0 6px; }
.blocksmooth_panel .bs_mod { border: 1px solid var(--color-border); border-radius: 4px; padding: 4px 6px; margin: 6px 0; }
.blocksmooth_panel .bs_mod_head { display: flex; align-items: center; gap: 2px; }
.blocksmooth_panel .bs_mod_head > b { flex: 1; }
.blocksmooth_panel .bs_mod_head i { cursor: pointer; opacity: 0.85; font-size: 18px; }
.blocksmooth_panel .bs_mod_head i.off { opacity: 0.3; }
.blocksmooth_panel .bs_stats { opacity: 0.75; font-size: 0.9em; }
.blocksmooth_panel button { flex: 1 1 0; min-width: 0; padding: 0 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.blocksmooth_panel button.bs_small { flex: 0 0 auto; }
`;

const TEMPLATE = `
<div class="blocksmooth_panel">
  <p v-if="!info" class="bs_stats">Select a mesh to add subdivision or smooth shading.</p>
  <template v-else>
    <div class="bs_row">
      <button @click="add('subdivision')" title="Catmull-Clark subdivision, non-destructive">+ Subdivision</button>
      <button @click="add('smooth_by_angle')" title="Smooth shading that keeps folded edges crisp">+ Smooth by Angle</button>
    </div>
    <div v-for="(m, i) in info.modifiers" :key="m.id" class="bs_mod">
      <div class="bs_mod_head">
        <b>{{ label(m) }}</b>
        <i class="material-icons" :class="{off: !m.viewport}" title="Show in viewport" @click="patch(m, {viewport: !m.viewport})">visibility</i>
        <i class="material-icons" :class="{off: !m.export}" title="Apply in exported files" @click="patch(m, {export: !m.export})">file_download</i>
        <i class="material-icons" title="Move up" @click="move(m, i - 1)">expand_less</i>
        <i class="material-icons" title="Move down" @click="move(m, i + 1)">expand_more</i>
        <i class="material-icons" title="Remove" @click="remove(m)">delete</i>
      </div>
      <template v-if="m.type === 'subdivision'">
        <div class="bs_row"><label>Viewport levels</label>
          <input class="dark_bordered" type="number" :min="limits.levels.min" :max="limits.levels.max" step="1" :value="m.levels" @change="patch(m, {levels: +$event.target.value})"></div>
        <div class="bs_row"><label>Export levels</label>
          <input class="dark_bordered" type="number" :min="limits.exportLevels.min" :max="limits.exportLevels.max" step="1" :value="m.export_levels" @change="patch(m, {export_levels: +$event.target.value})"></div>
      </template>
      <div v-else-if="m.type === 'smooth_by_angle'" class="bs_row"><label>Angle (°)</label>
        <input class="dark_bordered" type="number" :min="limits.angle.min" :max="limits.angle.max" step="1" :value="m.angle" @change="patch(m, {angle: +$event.target.value})"></div>
      <div v-else class="bs_stats">From a newer BlockSmooth — kept, not applied.</div>
    </div>
    <div class="bs_row"><label title="0-1: how sharp the selected edges stay in subdivision">Edge crease</label>
      <input class="dark_bordered" type="number" min="0" max="1" step="0.1" v-model.number="crease">
      <button class="bs_small" @click="setCrease(crease)" title="Set the crease of the selected edges">Set</button>
      <button class="bs_small" @click="setCrease(0)" title="Remove the crease of the selected edges">Clear</button>
    </div>
    <div class="bs_row">
      <button @click="setSharp(true)" title="Shade the selected edges sharp">Mark Sharp</button>
      <button @click="setSharp(false)" title="Shade the selected edges smooth">Clear Sharp</button>
    </div>
    <div class="bs_stats">
      Cage {{ info.cage_faces }} faces · viewport {{ info.viewport.faces }} · export {{ info.export.faces }}<br>
      {{ info.creased_edges }} creased, {{ info.sharp_edges }} sharp edges
      <span v-if="info.viewport.reduced_to_fit_budget"><br>Viewport levels reduced to stay under {{ info.viewport.reduced_to_fit_budget.budget_faces }} faces.</span>
      <span v-if="info.export.reduced_to_fit_budget"><br>Export levels reduced to stay under {{ info.export.reduced_to_fit_budget.budget_faces }} faces.</span>
    </div>
    <div class="bs_row" v-if="info.viewport.levels > 0">
      <button @click="apply()" title="Make the viewport subdivision permanent">Apply Subdivision</button>
    </div>
  </template>
</div>`;

export function registerPanel(): Deletable {
  const life = new Lifecycle();
  life.add(Blockbench.addCSS(CSS));

  let vm: any = null;
  const component = {
    data: () => ({ info: null as any, crease: 1, limits: LIMITS }),
    mounted(this: any) { vm = this; this.refresh(); },
    methods: {
      refresh(this: any) {
        const mesh = Mesh.selected?.[0];
        try {
          this.info = mesh ? describeMesh(mesh) : null;
        } catch (err) {
          console.error('[BlockSmooth] panel', err);
          this.info = null;
        }
      },
      mesh: () => Mesh.selected[0],
      run(this: any, fn: () => void) {
        try { fn(); } catch (err) { Blockbench.showQuickMessage(`BlockSmooth: ${(err as Error).message}`, 3000); }
        this.refresh();
      },
      label: (m: any) => (m.type === 'subdivision' ? 'Subdivision' : m.type === 'smooth_by_angle' ? 'Smooth by Angle' : m.type),
      add(this: any, type: string) {
        this.run(() => addModifier(Mesh.selected.slice(), type, type === 'subdivision' ? { levels: 2 } : { angle: 30 }, { smoothShading: true }));
      },
      patch(this: any, m: any, patch: Record<string, unknown>) { this.run(() => updateModifier(this.mesh(), m.id, patch)); },
      move(this: any, m: any, to: number) { this.run(() => moveModifier(this.mesh(), m.id, to)); },
      remove(this: any, m: any) { this.run(() => removeModifier(this.mesh(), m.id)); },
      apply(this: any) { this.run(() => { for (const mesh of Mesh.selected.slice()) applyModifiers(mesh); }); },
      setCrease(this: any, value: number) { this.run(() => withEdges((mesh, edges) => setCrease(mesh, edges, value))); },
      setSharp(this: any, flag: boolean) { this.run(() => withEdges((mesh, edges) => setSharp(mesh, edges, flag))); },
    },
    template: TEMPLATE,
  };

  life.add(new Panel('blocksmooth', {
    name: 'BlockSmooth',
    icon: 'blur_on',
    condition: { modes: ['edit'], method: () => !!Format?.meshes },
    default_position: { slot: 'right_bar', float_position: [0, 0], float_size: [300, 360], height: 360 },
    component,
  }));

  // Coalesce the many selection / edit events into one refresh per task.
  let queued = false;
  const refresh = () => {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; vm?.refresh?.(); }, 0);
  };
  for (const event of ['update_selection', 'undo', 'redo', 'finished_edit', 'select_project', 'select_mode']) {
    life.add(Blockbench.on(event, refresh));
  }
  life.add({ delete: () => { vm = null; } });
  return { delete: () => life.dispose() };
}

function withEdges(fn: (mesh: any, edges: EdgePair[]) => void): void {
  if (!withSelectedEdges(Mesh.selected.slice(), fn)) throw new Error('select edges or faces of a mesh first');
}
