// Everything the plugin installs returns a Deletable; the plugin keeps them in
// a Lifecycle and removes them in reverse order on unload.

export interface Deletable {
  delete(): void;
}

export class Lifecycle {
  private readonly items: Deletable[] = [];

  add<T extends Deletable | undefined | null>(item: T): T {
    if (item) this.items.push(item);
    return item;
  }

  /** Remove everything, newest first. One failing removal does not stop the rest. */
  dispose(): void {
    while (this.items.length) {
      const item = this.items.pop()!;
      try { item.delete(); } catch (err) { console.error('[BlockSmooth] cleanup failed:', err); }
    }
  }
}

/** Replace obj[key] with a wrapper; delete() puts the original back if nobody replaced it since. */
export function patchMethod<T extends object, K extends keyof T>(obj: T, key: K, makeWrapper: (original: T[K]) => T[K]): Deletable {
  const original = obj[key];
  const wrapper = makeWrapper(original);
  obj[key] = wrapper;
  return {
    delete() {
      if (obj[key] === wrapper) obj[key] = original;
      else console.warn(`[BlockSmooth] ${String(key)} was patched again by someone else; leaving it in place.`);
    },
  };
}
