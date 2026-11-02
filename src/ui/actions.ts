// Menu actions (mesh context menu and keybindable): add modifiers, apply,
// crease / sharp marks on the edit-mode selection.

import { Lifecycle, type Deletable } from '../util/lifecycle';
import { addModifier, setCrease, setSharp } from '../ops/edit';
import { withSelectedEdges, type EdgePair } from '../ops/edges';
import { applyModifiers } from '../ops/apply';

interface ActionSpec {
  id: string;
  name: string;
  description: string;
  icon: string;
  run(meshes: any[]): void;
}

function forSelectedEdges(meshes: any[], fn: (mesh: any, edges: EdgePair[]) => void): void {
  if (!withSelectedEdges(meshes, fn)) Blockbench.showQuickMessage('Select edges or faces of a mesh first (edit mode)', 2000);
}

export const ACTIONS: ActionSpec[] = [
  {
    id: 'blocksmooth_add_subdivision', name: 'Add Subdivision Surface', icon: 'blur_on',
    description: 'Smooth the mesh with Catmull-Clark subdivision (2 levels), non-destructively. Switches the mesh to smooth shading.',
    run: (meshes) => { addModifier(meshes, 'subdivision', { levels: 2 }, { smoothShading: true }); },
  },
  {
    id: 'blocksmooth_add_smooth_by_angle', name: 'Add Smooth by Angle', icon: 'filter_tilt_shift',
    description: 'Shade smooth, but keep edges folded more than 30° (and edges marked sharp) crisp.',
    run: (meshes) => { addModifier(meshes, 'smooth_by_angle', { angle: 30 }); },
  },
  {
    id: 'blocksmooth_apply', name: 'Apply Subdivision', icon: 'done_all',
    description: 'Make the viewport subdivision permanent: the mesh gets the subdivided vertices and faces.',
    run: (meshes) => {
      const applied = meshes.map((m) => applyModifiers(m)).filter((r) => r.applied);
      if (!applied.length) Blockbench.showQuickMessage('No viewport subdivision to apply', 2000);
    },
  },
  {
    id: 'blocksmooth_crease_edges', name: 'Crease Edges', icon: 'line_weight',
    description: 'Keep the selected edges sharp in subdivision (crease 1).',
    run: (meshes) => forSelectedEdges(meshes, (mesh, edges) => setCrease(mesh, edges, 1)),
  },
  {
    id: 'blocksmooth_clear_crease', name: 'Clear Edge Crease', icon: 'line_style',
    description: 'Remove the crease from the selected edges.',
    run: (meshes) => forSelectedEdges(meshes, (mesh, edges) => setCrease(mesh, edges, 0)),
  },
  {
    id: 'blocksmooth_mark_sharp', name: 'Mark Edges Sharp', icon: 'change_history',
    description: 'Shade the selected edges sharp (hard normals) while the surface stays smooth.',
    run: (meshes) => forSelectedEdges(meshes, (mesh, edges) => setSharp(mesh, edges, true)),
  },
  {
    id: 'blocksmooth_clear_sharp', name: 'Clear Sharp Edges', icon: 'details',
    description: 'Shade the selected edges smooth again.',
    run: (meshes) => forSelectedEdges(meshes, (mesh, edges) => setSharp(mesh, edges, false)),
  },
];

export function registerActions(): Deletable {
  const life = new Lifecycle();
  const menu = Mesh.prototype.menu;
  for (const spec of ACTIONS) {
    const action = new Action(spec.id, {
      name: spec.name,
      description: spec.description,
      icon: spec.icon,
      category: 'edit',
      condition: () => Modes.edit && Mesh.selected.length > 0,
      click() {
        try {
          spec.run(Mesh.selected.slice());
        } catch (err) {
          Blockbench.showQuickMessage(`BlockSmooth: ${(err as Error).message}`, 3000);
          console.error('[BlockSmooth]', err);
        }
      },
    });
    life.add(action);
    if (menu?.addAction) {
      menu.addAction(action);
      life.add({ delete: () => menu.removeAction?.(action) });
    }
  }
  return { delete: () => life.dispose() };
}
