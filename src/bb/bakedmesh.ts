// Turn an evaluated surface into Blockbench mesh data (vertex dictionary and
// MeshFaces with UVs and textures), shared by export baking and Apply.

import { bakeConnected, bakeSplit, type BakedMesh } from '../core/bake';
import { readFaceUVs } from './cage';
import { evaluate, type Surface } from './surface';

export interface BlockbenchGeometry {
  readonly baked: BakedMesh;
  /** Corner UVs in Blockbench units, 2 per final corner. */
  readonly uvs: ArrayLike<number>;
}

/**
 * Evaluate the surface and bake it. split: one vertex per normal fan (for
 * exporting smooth shading with sharp edges); otherwise one vertex per vertex.
 */
export function bakeSurface(surface: Surface, mesh: any, split: boolean): BlockbenchGeometry {
  const ev = evaluate(surface, mesh);
  const final = surface.hierarchy.final;
  const baked = split ? bakeSplit(final, ev.positions, ev.normals) : bakeConnected(final, ev.positions);
  const uvs = Array.from(surface.corners.run(readFaceUVs(mesh, surface.cage)));
  return { baked, uvs };
}

/** MeshFaces for the baked polygons; `keys[i]` is the vertex key of baked vertex i. */
export function makeFaces(mesh: any, surface: Surface, geo: BlockbenchGeometry, keys: string[]): any[] {
  const { baked, uvs } = geo;
  const final = surface.hierarchy.final;
  const faces: any[] = [];
  for (let f = 0; f < final.faceCount; f++) {
    const source = mesh.faces[surface.cage.faceKeys[surface.hierarchy.faceOrigin[f]]];
    const vertices: string[] = [];
    const uv: Record<string, number[]> = {};
    for (let c = baked.faceOffsets[f]; c < baked.faceOffsets[f + 1]; c++) {
      const key = keys[baked.faceVerts[c]];
      vertices.push(key);
      uv[key] = [uvs[2 * c], uvs[2 * c + 1]];
    }
    // texture: uuid, false (none) or null (face hidden) — copied as-is from the cage face.
    faces.push(new MeshFace(mesh, { vertices, uv, texture: source ? source.texture : false }));
  }
  return faces;
}
