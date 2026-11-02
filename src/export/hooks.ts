// Wraps the compile() of Blockbench's mesh-capable exporters in a BakeSession,
// and makes the project codec (.bbmodel save, auto-backup) always see the cages.
// compile() is the single funnel every export path goes through (File > Export,
// export dialogs, plugins and scripts calling Codecs.x.compile()).
//
// If baking fails the export still happens, without modifiers: a broken
// export is worse than an unsmoothed one.
//
// glTF without armature additionally gets welded geometry: Blockbench builds
// one vertex per face corner, the welded copy one per distinct vertex.

import { guarded, report } from '../util/guard';
import { Lifecycle, patchMethod, type Deletable } from '../util/lifecycle';
import type { DisplayController } from '../bb/controller';
import { BakeSession } from './session';
import { weldDuringParse } from './gltfweld';

/** Codecs that write mesh geometry: OBJ, FBX, Collada (mesh data) and glTF, STL (three.js scene). */
export const MESH_CODECS = ['obj', 'fbx', 'collada', 'gltf', 'stl'];

/** The options a codec's compile() will use: its saved export options with the call's own on top. */
function exportOptions(codec: any, given: any): Record<string, any> {
  let saved: Record<string, any> = {};
  try { saved = codec.getExportOptions?.() ?? {}; } catch { /* older codecs */ }
  return Object.assign({}, saved, given && typeof given === 'object' ? given : {});
}

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
      // Skinned glTF pairs skin weights with Blockbench's per-corner vertices: never weld it.
      const weld = id === 'gltf' && !exportOptions(this, args[0]).armature
        ? guarded('preparing glTF welding', () => weldDuringParse(session)) : null;
      const end = () => {
        guarded('ending glTF welding', () => weld?.delete());
        guarded('ending export bake', () => session.end());
      };
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
