// Edge keys, in the same format Blockbench uses for mesh seams: the two vertex
// keys sorted and joined with "_". Pure — no Blockbench globals.

export function edgeKey(a: string, b: string): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}
