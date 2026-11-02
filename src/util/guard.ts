// Error isolation: BlockSmooth runs inside Blockbench's own render and export
// paths, so an exception of ours must never escape into them. Hook bodies run
// through guarded(); the error is logged once per element and message.

const reported = new Set<string>();

export function report(context: string, err: unknown, key = ''): void {
  const message = err instanceof Error ? err.message : String(err);
  const id = `${context}|${key}|${message}`;
  if (reported.has(id)) return;
  reported.add(id);
  console.error(`[BlockSmooth] ${context}${key ? ` (${key})` : ''}:`, err);
}

/** Run fn; on error report it, run onError (if given) and return undefined. */
export function guarded<T>(context: string, fn: () => T, onError?: (err: unknown) => void, key?: string): T | undefined {
  try {
    return fn();
  } catch (err) {
    report(context, err, key);
    if (onError) {
      try { onError(err); } catch (inner) { report(`${context} recovery`, inner, key); }
    }
    return undefined;
  }
}
