// A welded copy of a three.js geometry for exporters that write the scene
// (glTF): vertices whose position, normal and UV are bit-identical are merged.
// Triangle order and material groups are unchanged, so face picking by
// triangle index and the per-group materials stay valid.

import { weldVertices } from '../core/sharing';

const WELDED_ATTRIBUTES = ['position', 'normal', 'uv'];

export function weldedGeometry(source: any): any {
  const names = WELDED_ATTRIBUTES.filter((n) => source.attributes[n]);
  const count = source.attributes.position.count;
  const index = source.index ? source.index.array : null;
  const result = weldVertices(count, names.map((n) => ({ array: source.attributes[n].array, itemSize: source.attributes[n].itemSize })), index);
  const geometry = new THREE.BufferGeometry();
  names.forEach((n, i) => geometry.setAttribute(n, new THREE.BufferAttribute(result.attributes[i], source.attributes[n].itemSize)));
  geometry.setIndex(new THREE.BufferAttribute(result.vertexCount > 65535 ? result.index : Uint16Array.from(result.index), 1));
  for (const g of source.groups) geometry.addGroup(g.start, g.count, g.materialIndex);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
