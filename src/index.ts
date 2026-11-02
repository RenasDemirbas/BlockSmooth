// BlockSmooth — Blockbench plugin entry. Composition root only: checks that
// the Blockbench APIs it relies on exist, installs every part in dependency
// order and removes them in reverse on unload. File name must stay
// `blocksmooth.js` (plugin id == file name).
//
// Layers (imports only point downward):
//   core/   pure geometry (topology, Catmull-Clark, normals, baking)
//   model/  pure data rules (stored schema, modifier stack -> plan)
//   bb/     Blockbench adapters (property, cage reading, viewport display)
//   export/ export-time baking around Blockbench's codecs
//   ops/    undoable user operations
//   ui/, api.ts  panel, actions, settings, window.BlockSmooth

import { Lifecycle } from './util/lifecycle';
import { registerProperty } from './bb/property';
import { DisplayController } from './bb/controller';
import { installPreviewHooks } from './bb/hooks';
import { installEdgeOverlay } from './bb/overlay';
import { disposeTwins } from './bb/materials';
import { installExportHooks } from './export/hooks';
import { installApi } from './api';
import { registerSettings, settingEnabled, SETTING_EXPORT, SETTING_VIEWPORT } from './ui/settings';
import { registerActions } from './ui/actions';
import { registerPanel } from './ui/panel';
// Bundled as a data URL (see scripts/build.mjs): the small-size cut reads best at the plugin list's 48 px.
import pluginIcon from '../assets/blocksmooth-small.svg';

const MIN_BLOCKBENCH = '5.2.0';
const life = new Lifecycle();

/** What BlockSmooth needs from Blockbench; a missing piece means "do not install". */
function missingApis(): string[] {
  const pc = (globalThis as any).Mesh?.preview_controller;
  const checks: [string, boolean][] = [
    ['Mesh', typeof Mesh === 'function'],
    ['MeshFace', typeof MeshFace === 'function'],
    ['Mesh.preview_controller.on', typeof pc?.on === 'function'],
    ['Mesh.preview_controller.displayDeformation', typeof pc?.displayDeformation === 'function'],
    ['Property', typeof Property === 'function'],
    ['Codecs', typeof Codecs === 'object'],
    ['THREE.Mesh', typeof THREE?.Mesh === 'function'],
  ];
  return checks.filter(([, ok]) => !ok).map(([name]) => name);
}

const REPOSITORY = 'https://github.com/RenasDemirbas/BlockSmooth';

Plugin.register('blocksmooth', {
  title: 'BlockSmooth',
  author: 'Renas Demirbas',
  description: 'Non-destructive subdivision surfaces for meshes: Catmull-Clark with edge creases, smooth-by-angle shading and sharp edges, shown live in the viewport and applied automatically when exporting OBJ, FBX, glTF, Collada and STL.',
  icon: pluginIcon,
  version: __BLOCKSMOOTH_VERSION__,
  variant: 'both',
  min_version: MIN_BLOCKBENCH,
  tags: ['Modeling', 'Mesh'],
  website: REPOSITORY,
  repository: REPOSITORY,
  bug_tracker: `${REPOSITORY}/issues`,
  creation_date: '2026-11-02',
  onload() {
    const missing = missingApis();
    if (missing.length) {
      console.error(`[BlockSmooth] not installed: this Blockbench lacks ${missing.join(', ')}.`);
      Blockbench.showQuickMessage?.('BlockSmooth needs a newer Blockbench (see console)', 4000);
      return;
    }
    try {
      life.add(registerProperty());
      const controller = new DisplayController(() => settingEnabled(SETTING_VIEWPORT));
      life.add({ delete: () => { controller.disposeAll(); disposeTwins(); } });
      life.add(registerSettings(() => controller.refreshAll()));
      life.add(installPreviewHooks(controller));
      life.add(installEdgeOverlay());
      life.add(installExportHooks(controller, () => settingEnabled(SETTING_EXPORT)));
      life.add(installApi(controller));
      life.add(registerActions());
      life.add(registerPanel());
      controller.refreshAll();
    } catch (err) {
      console.error('[BlockSmooth] failed to load; removing what was installed.', err);
      life.dispose();
    }
  },
  onunload() {
    life.dispose();
  },
});
