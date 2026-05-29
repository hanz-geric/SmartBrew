// Minimal ESC/POS byte builder — pure JS, no native dependencies.
// Covers the command subset needed for receipt/kitchen/test printing.

export type PaperWidth = '58mm' | '80mm';

const COLS: Record<PaperWidth, number> = { '58mm': 32, '80mm': 48 };

export class EscPos {
  private buf: number[] = [];
  readonly cols: number;

  constructor(width: PaperWidth = '80mm') {
    this.cols = COLS[width];
  }

  // ── Printer control ────────────────────────────────────────────────────────

  init(): this  { return this.push(0x1B, 0x40); }
  cut(): this   { return this.push(0x1D, 0x56, 0x41, 0x03); }  // partial cut
  feed(n = 1): this {
    for (let i = 0; i < n; i++) this.push(0x0A);
    return this;
  }

  // ── Text formatting ────────────────────────────────────────────────────────

  align(a: 'left' | 'center' | 'right'): this {
    return this.push(0x1B, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2);
  }

  bold(on: boolean): this      { return this.push(0x1B, 0x45, on ? 1 : 0); }
  underline(on: boolean): this { return this.push(0x1B, 0x2D, on ? 1 : 0); }

  // w/h: 1 = normal, 2 = double
  size(w: 1 | 2, h: 1 | 2): this {
    return this.push(0x1D, 0x21, ((w - 1) << 4) | (h - 1));
  }

  // ── Text output ────────────────────────────────────────────────────────────

  text(str: string): this {
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      this.push(c < 0x80 ? c : 0x3F); // replace non-ASCII with '?'
    }
    return this;
  }

  line(str = ''): this { return this.text(str + '\n'); }

  divider(): this { return this.line('-'.repeat(this.cols)); }

  // Left label + right-aligned value on one line
  row(left: string, right: string): this {
    const gap = this.cols - left.length - right.length;
    if (gap <= 0) {
      return this.line(left.slice(0, this.cols - right.length - 1) + ' ' + right);
    }
    return this.line(left + ' '.repeat(gap) + right);
  }

  // ── Output ─────────────────────────────────────────────────────────────────

  bytes(): Uint8Array { return new Uint8Array(this.buf); }

  private push(...bytes: number[]): this { this.buf.push(...bytes); return this; }
}
