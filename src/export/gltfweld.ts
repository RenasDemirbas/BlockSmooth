// Shared vertices in glTF exports. Blockbench builds one vertex per face
// corner; its glTF exporter writes them as they are. While a glTF compile
// runs, GLTFExporter.parse is wrapped: for the synchronous part of the call,
// in which the exporter reads every geometry, each baked mesh's scene object
// holds a welded copy (bit-identical vertices merged, triangles and material
// groups unchanged). The original geometry is back before parse returns, so
// nothing else in Blockbench ever sees the copy.

import { report } from '../util/guard';
import { patchMethod, type Deletable } from '../util/lifecycle';
import { weldedGeometry } from '../bb/weldgeometry';
import type { BakeSession } from './session';

/** Wrap the glTF exporter for one compile; delete() unwraps it. null when there is no exporter to wrap. */
export function weldDuringParse(session: BakeSession): Deletable | null {
  const proto = THREE?.GLTFExporter?.prototype;
  if (!proto || typeof proto.parse !== 'function') return null;
  return patchMethod(proto, 'parse', (original: any) => function (this: any, ...args: any[]) {
    const swapped: [any, any][] = [];
    try {
      for (const mesh of session.bakedMeshes()) {
        const object = mesh.mesh;
        if (!object?.geometry?.attributes?.position) continue;
        try {
          const welded = weldedGeometry(object.geometry);
          swapped.push([object, object.geometry]);
          object.geometry = welded;
        } catch (err) {
          report('welding glTF geometry (kept unwelded)', err, mesh.name);
        }
      }
      return original.apply(this, args);
    } finally {
      for (const [object, geometry] of swapped) {
        object.geometry.dispose();
        object.geometry = geometry;
      }
    }
  });
}
