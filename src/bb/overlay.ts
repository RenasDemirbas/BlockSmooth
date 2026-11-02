// Edit-mode overlay: creased edges drawn magenta (brighter = sharper) and edges
// marked sharp drawn cyan on the mesh outline, like Blender. Runs after
// Blockbench colours the outline in updateSelection; selected edges stay white.

import { edgeKey } from '../model/edges';
import { guarded } from '../util/guard';
import type { Deletable } from '../util/lifecycle';
import { getData, hasData } from './property';

const CREASE = [1, 0.23, 0.85];
const SHARP = [0.15, 0.78, 1];

export function installEdgeOverlay(): Deletable {
  const listener = Mesh.preview_controller.on('update_selection', (data: any) => {
    const mesh = data?.element;
    if (!(mesh instanceof Mesh) || !mesh.selected || !Modes.edit || !hasData(mesh)) return;
    guarded('edge overlay', () => paint(mesh), undefined, mesh.name);
  });
  return { delete: () => listener?.delete() };
}

function paint(mesh: any): void {
  const { creases, sharp } = getData(mesh);
  if (!Object.keys(creases).length && !Object.keys(sharp).length) return;
  const outline = mesh.mesh?.outline;
  const order: string[] = outline?.vertex_order;
  const attr = outline?.geometry?.attributes?.color;
  if (!order || !attr || attr.count < order.length) return;
  const colors = attr.array as Float32Array;
  const base = (window as any).gizmo_colors?.grid;
  const grid = base ? [base.r, base.g, base.b] : [0.3, 0.3, 0.3];

  for (let i = 0; i + 1 < order.length; i += 2) {
    const r = colors[3 * i], g = colors[3 * i + 1], b = colors[3 * i + 2];
    if (r === 1 && g === 1 && b === 1) continue; // selected edge
    const key = edgeKey(order[i], order[i + 1]);
    let color: number[] | null = null;
    const c = creases[key];
    if (c) color = grid.map((v, k) => v + (CREASE[k] - v) * (0.35 + 0.65 * c));
    else if (sharp[key]) color = SHARP;
    if (!color) continue;
    colors.set(color, 3 * i);
    colors.set(color, 3 * (i + 1));
  }
  attr.needsUpdate = true;
}
