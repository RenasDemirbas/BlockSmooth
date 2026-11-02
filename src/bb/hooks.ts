// Wiring between Blockbench's mesh preview controller and the DisplayController.
// Only public extension points are used: the controller's events (dispatched at
// the end of each update) and one wrapped method, displayDeformation, which
// fires no event (armature animation playback).

import { guarded } from '../util/guard';
import { Lifecycle, patchMethod, type Deletable } from '../util/lifecycle';
import { ALL_ASPECTS, type DisplayController } from './controller';

export function installPreviewHooks(controller: DisplayController): Deletable {
  const life = new Lifecycle();
  const pc = Mesh.preview_controller;
  const on = (event: string, fn: (element: any) => void) => {
    life.add(pc.on(event, (data: any) => {
      const element = data?.element;
      if (element instanceof Mesh) guarded(`preview event ${event}`, () => fn(element));
    }));
  };

  on('setup', (el) => controller.sync(el, ALL_ASPECTS));
  on('update_geometry', (el) => controller.sync(el, { geometry: true }));
  on('update_faces', (el) => controller.sync(el, { faces: true }));
  on('update_uv', (el) => controller.sync(el, { uv: true }));
  on('update_highlight', (el) => controller.sync(el, { highlight: true }));
  on('remove', (el) => controller.teardown(el));

  life.add(patchMethod(pc, 'displayDeformation', (original: any) => function (this: any, element: any, offsets: any) {
    const result = original.call(this, element, offsets);
    guarded('armature deformation', () => controller.deform(element, offsets ?? null));
    return result;
  }));

  // Tool / view-mode switches (weight painting shows the cage) and project changes.
  const resync = () => guarded('refresh', () => controller.refreshAll());
  life.add(Blockbench.on('select_project', resync));
  life.add(Blockbench.on('select_mode', resync));
  // A tool switch schedules a selection update; cheap check for weight-painting changes.
  life.add(Blockbench.on('update_selection', () => guarded('mode check', () => controller.checkModeChange())));
  life.add(Blockbench.on('close_project', () => guarded('prune', () => controller.prune())));

  return { delete: () => life.dispose() };
}
