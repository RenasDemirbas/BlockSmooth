// The "blocksmooth" property on Blockbench meshes. Registered as an object
// Property, so Blockbench saves it in .bbmodel files and copies it into undo
// steps by itself. Reading always goes through readData (never trusts the file).

import { isEmpty, readData, type SmoothData } from '../model/schema';
import type { Deletable } from '../util/lifecycle';

export const PROPERTY_NAME = 'blocksmooth';

export function registerProperty(): Deletable {
  const property = new Property(Mesh, 'object', PROPERTY_NAME, { default: {} });
  return {
    delete() {
      // Instances keep their values: reloading the plugin with a project open loses nothing.
      property.delete();
    },
  };
}

export function getData(mesh: any): SmoothData {
  return readData(mesh?.[PROPERTY_NAME]);
}

/** Store data on the mesh. Empty data is stored as {} to keep project files clean. */
export function setData(mesh: any, data: SmoothData): void {
  mesh[PROPERTY_NAME] = isEmpty(data) ? {} : structuredClone(data);
}

export function hasData(mesh: any): boolean {
  const raw = mesh?.[PROPERTY_NAME];
  return !!raw && typeof raw === 'object' && Object.keys(raw).length > 0;
}
