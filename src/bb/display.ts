// The smooth result shown in the viewport: a three.js mesh parented to the
// cage's own scene object, so it follows every transform, bone and visibility
// change of the cage for free. It is never raycast (Blockbench picks on the
// cage) and is marked no_export (exporters get baked data instead, see export/).
//
// Geometry is indexed with shared vertices (see core/sharing.ts): a vertex is
// shared by every corner on the same surface point, normal fan and cage face,
// so a smooth patch costs about one GPU vertex per surface point instead of
// four per quad.

import type { CornerSharing } from '../core/sharing';
import type { Topology } from '../core/topology';
import { invisibleTwin } from './materials';

/** Blockbench's per-vertex colour for plain meshes (used by its vertex-colour materials). */
const PLAIN_VERTEX_COLOR = [0, 0.03, 0.08];

interface Layout {
  readonly topology: Topology;
  readonly faceOrigin: Int32Array;
  readonly sharing: CornerSharing;
}

export class SmoothDisplay {
  readonly object: any;
  private layout: Layout | null = null;
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

  /** The sharing the buffers are built for, or null. */
  get sharing(): CornerSharing | null {
    return this.layout?.sharing ?? null;
  }

  /** Allocate buffers for a final topology and its vertex sharing. Call before the write* methods. */
  setLayout(topology: Topology, faceOrigin: Int32Array, sharing: CornerSharing): void {
    this.layout = { topology, faceOrigin, sharing };
    const g = this.object.geometry;
    const n = sharing.vertexCount;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    g.setAttribute('highlight', new THREE.BufferAttribute(new Uint8Array(n), 1));
    const color = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) color.set(PLAIN_VERTEX_COLOR, 3 * v);
    g.setAttribute('color', new THREE.BufferAttribute(color, 3));

    const t = topology;
    const cv = sharing.cornerVertex;
    let triangles = 0;
    for (let f = 0; f < t.faceCount; f++) triangles += t.faceOffsets[f + 1] - t.faceOffsets[f] - 2;
    const index = n > 65535 ? new Uint32Array(triangles * 3) : new Uint16Array(triangles * 3);
    this.faceIndexStart = new Int32Array(t.faceCount + 1);
    let i = 0;
    for (let f = 0; f < t.faceCount; f++) {
      const s = t.faceOffsets[f], count = t.faceOffsets[f + 1] - s;
      for (let k = 1; k + 1 < count; k++) { // fan: (0,1,2), (0,2,3)
        index[i++] = cv[s]; index[i++] = cv[s + k]; index[i++] = cv[s + k + 1];
      }
      this.faceIndexStart[f + 1] = i;
    }
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.clearGroups();
  }

  /** Positions (3 per final vertex) and normals (3 per corner). */
  writeSurface(positions: ArrayLike<number>, normals: Float32Array): void {
    const { topology: t, sharing } = this.requireLayout();
    const g = this.object.geometry;
    const pos = g.attributes.position.array as Float32Array;
    const nor = g.attributes.normal.array as Float32Array;
    const reps = sharing.vertexCorner;
    for (let v = 0; v < reps.length; v++) {
      const c = reps[v], p = 3 * t.faceVerts[c];
      pos[3 * v] = positions[p]; pos[3 * v + 1] = positions[p + 1]; pos[3 * v + 2] = positions[p + 2];
      nor[3 * v] = normals[3 * c]; nor[3 * v + 1] = normals[3 * c + 1]; nor[3 * v + 2] = normals[3 * c + 2];
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
    g.computeBoundingBox();
    g.computeBoundingSphere();
  }

  /** UVs, 2 per corner, already in three.js convention. */
  writeUVs(uvs: ArrayLike<number>): void {
    const { sharing } = this.requireLayout();
    const attr = this.object.geometry.attributes.uv;
    const out = attr.array as Float32Array;
    const reps = sharing.vertexCorner;
    for (let v = 0; v < reps.length; v++) {
      out[2 * v] = uvs[2 * reps[v]];
      out[2 * v + 1] = uvs[2 * reps[v] + 1];
    }
    attr.needsUpdate = true;
  }

  /**
   * Materials: `material` is what Blockbench assigned to the cage (one material
   * or an array); `cageSlots` gives each cage face its slot in the array.
   */
  writeMaterials(material: any, cageSlots: Int32Array | null): void {
    const { topology: t, faceOrigin } = this.requireLayout();
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
  writeHighlight(cageHighlight: Uint8Array): void {
    const { topology: t, faceOrigin, sharing } = this.requireLayout();
    const attr = this.object.geometry.attributes.highlight;
    const arr = attr.array as Uint8Array;
    const reps = sharing.vertexCorner;
    // Shared vertices never cross cage faces, so one corner tells the cage face.
    for (let v = 0; v < reps.length; v++) arr[v] = cageHighlight[faceOrigin[t.cornerFace[reps[v]]]];
    attr.needsUpdate = true;
  }

  dispose(): void {
    this.detach();
    this.object.geometry.dispose();
    this.layout = null;
  }

  private requireLayout(): Layout {
    if (!this.layout) throw new Error('SmoothDisplay: setLayout() was not called');
    return this.layout;
  }
}
