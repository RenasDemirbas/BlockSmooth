// The smooth result shown in the viewport: a three.js mesh parented to the
// cage's own scene object, so it follows every transform, bone and visibility
// change of the cage for free. It is never raycast (Blockbench picks on the
// cage) and is marked no_export (exporters get baked data instead, see export/).

import type { Topology } from '../core/topology';
import { invisibleTwin } from './materials';

/** Blockbench's per-vertex colour for plain meshes (used by its vertex-colour materials). */
const PLAIN_VERTEX_COLOR = [0, 0.03, 0.08];

export class SmoothDisplay {
  readonly object: any;
  private topology: Topology | null = null;
  private faceIndexStart: Int32Array = new Int32Array(1);

  constructor(ownerUuid: string) {
    // Drawn with the cage's materials once writeMaterials runs; invisible until then.
    this.object = new THREE.Mesh(new THREE.BufferGeometry(), invisibleTwin(null));
    this.object.name = `${ownerUuid}_blocksmooth`;
    this.object.no_export = true;
    this.object.isBlockSmoothDisplay = true;
    this.object.frustumCulled = false; // positions change every animation frame
    this.object.raycast = () => {};
  }

  attach(cage: any): void {
    if (this.object.parent !== cage) cage.add(this.object);
    this.object.renderOrder = cage.renderOrder;
  }

  detach(): void {
    this.object.parent?.remove(this.object);
  }

  /** Allocate buffers for a new final topology. Call before the write* methods. */
  setTopology(t: Topology): void {
    this.topology = t;
    const g = this.object.geometry;
    const corners = t.cornerCount;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(corners * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(corners * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(corners * 2), 2));
    g.setAttribute('highlight', new THREE.BufferAttribute(new Uint8Array(corners), 1));
    const color = new Float32Array(corners * 3);
    for (let c = 0; c < corners; c++) color.set(PLAIN_VERTEX_COLOR, 3 * c);
    g.setAttribute('color', new THREE.BufferAttribute(color, 3));

    const index: number[] = [];
    this.faceIndexStart = new Int32Array(t.faceCount + 1);
    for (let f = 0; f < t.faceCount; f++) {
      const s = t.faceOffsets[f], n = t.faceOffsets[f + 1] - s;
      for (let k = 1; k + 1 < n; k++) index.push(s, s + k, s + k + 1); // fan: (0,1,2), (0,2,3)
      this.faceIndexStart[f + 1] = index.length;
    }
    g.setIndex(corners > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1));
    g.clearGroups();
  }

  /** Positions (3 per final vertex) and normals (3 per corner). */
  writeSurface(positions: ArrayLike<number>, normals: Float32Array): void {
    const t = this.requireTopology();
    const g = this.object.geometry;
    const pos = g.attributes.position.array as Float32Array;
    for (let c = 0; c < t.cornerCount; c++) {
      const v = 3 * t.faceVerts[c];
      pos[3 * c] = positions[v]; pos[3 * c + 1] = positions[v + 1]; pos[3 * c + 2] = positions[v + 2];
    }
    (g.attributes.normal.array as Float32Array).set(normals);
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
    g.computeBoundingBox();
    g.computeBoundingSphere();
  }

  /** UVs, 2 per corner, already in three.js convention. */
  writeUVs(uvs: ArrayLike<number>): void {
    const g = this.object.geometry;
    (g.attributes.uv.array as Float32Array).set(uvs as any);
    g.attributes.uv.needsUpdate = true;
  }

  /**
   * Materials: `material` is what Blockbench assigned to the cage (one material
   * or an array); `cageSlots` gives each cage face its slot in the array.
   */
  writeMaterials(material: any, faceOrigin: Int32Array, cageSlots: Int32Array | null): void {
    const t = this.requireTopology();
    const g = this.object.geometry;
    g.clearGroups();
    if (Array.isArray(material)) {
      const slotOf = (f: number) => {
        const s = cageSlots ? cageSlots[faceOrigin[f]] : 0;
        return s < material.length ? s : 0;
      };
      let runStart = 0;
      for (let f = 1; f <= t.faceCount; f++) {
        if (f === t.faceCount || slotOf(f) !== slotOf(runStart)) {
          if (t.faceCount) {
            g.addGroup(this.faceIndexStart[runStart], this.faceIndexStart[f] - this.faceIndexStart[runStart], slotOf(runStart));
          }
          runStart = f;
        }
      }
    }
    this.object.material = material;
  }

  /** Highlight value (Blockbench's hover / selected-face shading) of each cage face. */
  writeHighlight(faceOrigin: Int32Array, cageHighlight: Uint8Array): void {
    const t = this.requireTopology();
    const attr = this.object.geometry.attributes.highlight;
    const arr = attr.array as Uint8Array;
    for (let f = 0; f < t.faceCount; f++) {
      const value = cageHighlight[faceOrigin[f]];
      for (let c = t.faceOffsets[f]; c < t.faceOffsets[f + 1]; c++) arr[c] = value;
    }
    attr.needsUpdate = true;
  }

  dispose(): void {
    this.detach();
    this.object.geometry.dispose();
    this.topology = null;
  }

  private requireTopology(): Topology {
    if (!this.topology) throw new Error('SmoothDisplay: setTopology() was not called');
    return this.topology;
  }
}
