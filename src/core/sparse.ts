// Sparse linear maps "output row = weighted sum of input rows". One
// subdivision level is such a map from parent to child vertices (and another
// from parent to child corners), so the expensive topology work happens once
// and re-evaluating after a vertex drag or an animation frame is a few
// multiply-adds per output value. Pure — no Blockbench globals.

export interface SparseRows {
  readonly rowCount: number;
  readonly rowPtr: Int32Array;
  readonly cols: Int32Array;
  readonly vals: Float64Array;
}

/** Builds SparseRows row by row; repeated columns within a row are summed. */
export class RowBuilder {
  private readonly scratch: Float64Array;
  private readonly inRow: Uint8Array;
  private readonly touched: number[] = [];
  private readonly rowPtr: number[] = [0];
  private readonly cols: number[] = [];
  private readonly vals: number[] = [];

  constructor(inputCount: number) {
    this.scratch = new Float64Array(inputCount);
    this.inRow = new Uint8Array(inputCount);
  }

  add(col: number, weight: number): void {
    if (!this.inRow[col]) {
      this.inRow[col] = 1;
      this.touched.push(col);
    }
    this.scratch[col] += weight;
  }

  /** Close the current row. */
  commit(): void {
    for (const col of this.touched) {
      const w = this.scratch[col];
      if (w !== 0) {
        this.cols.push(col);
        this.vals.push(w);
      }
      this.scratch[col] = 0;
      this.inRow[col] = 0;
    }
    this.touched.length = 0;
    this.rowPtr.push(this.cols.length);
  }

  build(): SparseRows {
    if (this.touched.length) throw new Error('RowBuilder.build: the last row was not committed');
    return {
      rowCount: this.rowPtr.length - 1,
      rowPtr: Int32Array.from(this.rowPtr),
      cols: Int32Array.from(this.cols),
      vals: Float64Array.from(this.vals),
    };
  }
}

/** output[row * stride + k] = sum of vals * input[col * stride + k]. */
export function applyRows(rows: SparseRows, input: ArrayLike<number>, stride: number, output: Float64Array): Float64Array {
  const { rowCount, rowPtr, cols, vals } = rows;
  for (let r = 0; r < rowCount; r++) {
    const base = r * stride;
    for (let k = 0; k < stride; k++) output[base + k] = 0;
    for (let i = rowPtr[r]; i < rowPtr[r + 1]; i++) {
      const w = vals[i];
      const src = cols[i] * stride;
      for (let k = 0; k < stride; k++) output[base + k] += w * input[src + k];
    }
  }
  return output;
}
