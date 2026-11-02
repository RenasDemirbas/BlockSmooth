// Hiding the cage's surface without breaking Blockbench's picking.
//
// Blockbench raycasts the cage mesh itself (selection, painting, vertex snap)
// and maps the hit triangle back to a face by counting the cage's triangles,
// so the cage must keep its geometry and stay "visible" as an object. Only its
// materials are swapped for invisible twins: three.js skips them when drawing
// but still raycasts against them. Each twin copies the original's `side`, so
// back-face hits behave exactly as before.

const twinsBySide = new Map<number, any>();
const twins = new WeakSet<object>();

export function invisibleTwin(material: any): any {
  const side = material?.side ?? THREE.FrontSide;
  let twin = twinsBySide.get(side);
  if (!twin) {
    twin = new THREE.MeshBasicMaterial({ visible: false, side });
    twin.name = 'blocksmooth_hidden_cage';
    twinsBySide.set(side, twin);
    twins.add(twin);
  }
  return twin;
}

export function isTwin(material: any): boolean {
  return Array.isArray(material) ? material.some((m) => twins.has(m)) : !!material && twins.has(material);
}

export function hideSurface(object: any): void {
  const m = object.material;
  if (isTwin(m)) return;
  object.material = Array.isArray(m) ? m.map(invisibleTwin) : invisibleTwin(m);
}

/**
 * Material slot of each cage face, read from the cage's geometry groups (built
 * by Blockbench's updateFaces). null when the cage uses a single material.
 */
export function faceSlots(bbIndexStart: Int32Array, object: any): Int32Array | null {
  if (!Array.isArray(object.material)) return null;
  const groups: { start: number; count: number; materialIndex: number }[] = object.geometry?.groups ?? [];
  const slots = new Int32Array(bbIndexStart.length);
  let g = 0;
  for (let f = 0; f < bbIndexStart.length; f++) {
    const at = bbIndexStart[f];
    while (g < groups.length && at >= groups[g].start + groups[g].count) g++;
    let slot = 0;
    if (g < groups.length && at >= groups[g].start) slot = groups[g].materialIndex;
    else { // not in order: search
      const hit = groups.find((gr) => at >= gr.start && at < gr.start + gr.count);
      if (hit) slot = hit.materialIndex;
    }
    slots[f] = slot;
  }
  return slots;
}

export function disposeTwins(): void {
  for (const twin of twinsBySide.values()) twin.dispose?.();
  twinsBySide.clear();
}
