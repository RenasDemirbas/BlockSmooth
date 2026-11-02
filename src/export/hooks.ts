// Wraps the compile() of Blockbench's mesh-capable exporters in a BakeSession,
// and makes the project codec (.bbmodel save, auto-backup) always see the cages.
// compile() is the single funnel every export path goes through (File > Export,
// export dialogs, plugins and scripts calling Codecs.x.compile()).
//
// If baking fails the export still happens, without modifiers: a broken
// export is worse than an unsmoothed one.

import { guarded, report } from '../util/guard';
import { Lifecycle, patchMethod, type Deletable } from '../util/lifecycle';
import type { DisplayController } from '../bb/controller';
import { BakeSession } from './session';

/** Codecs that write mesh geometry: OBJ, FBX, Collada (mesh data) and glTF, STL (three.js scene). */
export const MESH_CODECS = ['obj', 'fbx', 'collada', 'gltf', 'stl'];

export function installExportHooks(controller: DisplayController, applyOnExport: () => boolean): Deletable {
  const life = new Lifecycle();

  for (const id of MESH_CODECS) {
    const codec = Codecs?.[id];
    if (!codec || typeof codec.compile !== 'function') continue;
    life.add(patchMethod(codec, 'compile', (original: any) => function (this: any, ...args: any[]) {
      if (BakeSession.active || !applyOnExport() || !Mesh.all?.length) return original.apply(this, args);
      const session = guarded(`baking for ${id} export`, () => BakeSession.begin(controller), () => {
        Blockbench.showQuickMessage?.('BlockSmooth: exporting without modifiers (see console)', 3000);
      });
      if (!session) return original.apply(this, args);
      const end = () => guarded('ending export bake', () => session.end());
      let result: any;
      try {
        result = original.apply(this, args);
      } catch (err) {
        end();
        throw err;
      }
      if (result && typeof result.then === 'function') {
        return result.then((value: any) => { end(); return value; }, (err: any) => { end(); throw err; });
      }
      end();
      return result;
    }));
  }

  const project = Codecs?.project;
  if (project && typeof project.compile === 'function') {
    life.add(patchMethod(project, 'compile', (original: any) => function (this: any, ...args: any[]) {
      const session = BakeSession.active;
      if (!session) return original.apply(this, args);
      try {
        return session.withCage(() => original.apply(this, args));
      } catch (err) {
        report('saving during an export', err);
        throw err;
      }
    }));
  }

  return { delete: () => life.dispose() };
}
