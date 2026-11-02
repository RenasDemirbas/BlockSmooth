// Compressed sparse row lists: "for each key, the items that belong to it".
// Used for the incidence tables in topology.ts. Pure — no Blockbench globals.

export interface Csr {
  /** Items of key k are items[offsets[k] .. offsets[k + 1]). */
  readonly offsets: Int32Array;
  readonly items: Int32Array;
}

/** Group item indices 0..keys.length-1 by their key (each key < keyCount). Items keep their order. */
export function groupBy(keyCount: number, keys: ArrayLike<number>): Csr {
  const offsets = new Int32Array(keyCount + 1);
  for (let i = 0; i < keys.length; i++) offsets[keys[i] + 1]++;
  for (let k = 0; k < keyCount; k++) offsets[k + 1] += offsets[k];
  const fill = offsets.slice(0, keyCount);
  const items = new Int32Array(keys.length);
  for (let i = 0; i < keys.length; i++) items[fill[keys[i]]++] = i;
  return { offsets, items };
}

/** Like groupBy, but each item may belong to two keys (an edge to both its vertices). */
export function groupByPairs(keyCount: number, pairs: ArrayLike<number>): Csr {
  const n = pairs.length >> 1;
  const offsets = new Int32Array(keyCount + 1);
  for (let i = 0; i < pairs.length; i++) offsets[pairs[i] + 1]++;
  for (let k = 0; k < keyCount; k++) offsets[k + 1] += offsets[k];
  const fill = offsets.slice(0, keyCount);
  const items = new Int32Array(pairs.length);
  for (let i = 0; i < n; i++) {
    items[fill[pairs[2 * i]]++] = i;
    items[fill[pairs[2 * i + 1]]++] = i;
  }
  return { offsets, items };
}
