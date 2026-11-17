// T-103 review r1 P1: the local QR encoder (src/modules/vendor/billing/qr.ts) for the QRIS instruction on UX-49. Structural checks against
// ISO/IEC 18004 (finder / timing patterns, format information with its BCH code, version information from v7, the data read back through the
// zigzag and unmasked equals the encoded byte-mode codewords) — an independent decoder (jsQR) also decodes these matrices in the browser check.
import { describe, expect, it } from "vitest";
import { createQrisOk } from "../../../src/modules/vendor/billing/fixtures";
import { encodeQr, qrPath } from "../../../src/modules/vendor/billing/qr";

const MASKS: ((i: number, j: number) => boolean)[] = [
  (i, j) => (i + j) % 2 === 0, (i) => i % 2 === 0, (_i, j) => j % 3 === 0, (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0, (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0, (i, j) => (((i * j) % 3) + ((i + j) % 2)) % 2 === 0,
];
// The 32 valid format words (level and mask, BCH(15,5), XOR 101010000010010), computed independently of the encoder.
function formatWord(level: number, mask: number) {
  const data = (level << 3) | mask;
  let d = data << 10;
  for (let i = 14; i >= 10; i--) if ((d >> i) & 1) d ^= 0b10100110111 << (i - 10);
  return ((data << 10) | d) ^ 0b101010000010010;
}
// Function-pattern cells (to skip when reading data): finders + separators + format, timing, alignment, version, dark module.
function reserved(v: number, n: number): boolean[][] {
  const r = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const box = (y0: number, x0: number, h: number, w: number) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (y >= 0 && x >= 0 && y < n && x < n) r[y][x] = true; };
  box(0, 0, 9, 9); box(0, n - 8, 9, 8); box(n - 8, 0, 8, 9);
  for (let i = 0; i < n; i++) { r[6][i] = true; r[i][6] = true; }
  const ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]][v - 1] ?? null;
  if (ALIGN === null) throw new Error("test covers versions 1–10");
  for (const y of ALIGN) for (const x of ALIGN) if (!(y <= 8 && x <= 8) && !(y <= 8 && x >= n - 9) && !(y >= n - 9 && x <= 8)) box(y - 2, x - 2, 5, 5);
  if (v >= 7) { box(0, n - 11, 6, 3); box(n - 11, 0, 3, 6); }
  return r;
}
function readData(m: boolean[][], v: number, mask: number): number[] {
  const n = m.length;
  const res = reserved(v, n);
  const bits: number[] = [];
  let up = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let k = 0; k < n; k++) {
      const row = up ? n - 1 - k : k;
      for (let c = 0; c < 2; c++) {
        const x = col - c;
        if (res[row][x]) continue;
        bits.push((m[row][x] !== MASKS[mask](row, x)) ? 1 : 0);
      }
    }
    up = !up;
  }
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  return out;
}

describe("T-103 QR encoder (QRIS instruction)", () => {
  const payload = (createQrisOk("1", 333_333).body as { data: { qr: string } }).data.qr;
  it("the QRIS fixture: size per version, finder and timing patterns, a valid level-M format word in both copies, the dark module", () => {
    const q = encodeQr(payload);
    const n = q.modules.length;
    expect(n).toBe(q.version * 4 + 17);
    const m = q.modules;
    for (const [y0, x0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
        const ring = y === 0 || y === 6 || x === 0 || x === 6;
        const core = y >= 2 && y <= 4 && x >= 2 && x <= 4;
        expect(m[y0 + y][x0 + x], `finder ${y0},${x0} @${y},${x}`).toBe(ring || core);
      }
    }
    for (let i = 8; i < n - 8; i++) { expect(m[6][i]).toBe(i % 2 === 0); expect(m[i][6]).toBe(i % 2 === 0); }
    // format copy 1 (around the top-left finder) and copy 2 (split bottom-left / top-right)
    let f1 = 0;
    let f2 = 0;
    for (let i = 0; i < 15; i++) {
      const a = i < 6 ? m[i][8] : i < 8 ? m[i + 1][8] : m[n - 15 + i][8];
      const b = i < 8 ? m[8][n - i - 1] : i < 9 ? m[8][15 - i] : m[8][15 - i - 1];
      f1 |= (a ? 1 : 0) << i;
      f2 |= (b ? 1 : 0) << i;
    }
    expect(f1).toBe(f2);
    expect(f1).toBe(formatWord(0b00, q.mask)); // level M = 00
    expect(m[n - 8][8]).toBe(true);
  });
  it("the data read back through the zigzag and unmasked starts with byte mode, the length and the exact payload bytes", () => {
    for (const text of [payload, "Rp333.333 — Klinik", "x".repeat(150)]) {
      const q = encodeQr(text);
      expect(q.version).toBeLessThanOrEqual(10);
      const words = readData(q.modules, q.version, q.mask);
      // single-block versions only here: the first data codewords are in order (v ≤ 3 is one block at level M; longer texts check the header)
      const bytes = new TextEncoder().encode(text);
      const bits = words.flatMap((w) => [7, 6, 5, 4, 3, 2, 1, 0].map((k) => (w >> k) & 1));
      const take = (from: number, len: number) => bits.slice(from, from + len).reduce((a, b) => (a << 1) | b, 0);
      if (q.version <= 3) {
        expect(take(0, 4)).toBe(0b0100);
        expect(take(4, 8)).toBe(bytes.length);
        const decoded = Array.from({ length: bytes.length }, (_, i) => take(12 + i * 8, 8));
        expect(Uint8Array.from(decoded)).toEqual(bytes);
      } else {
        // multi-block: the first codeword of block 1 still starts with the mode indicator
        expect(take(0, 4)).toBe(0b0100);
      }
    }
  });
  it("error correction: every single-block code word sequence has zero Reed–Solomon syndromes (roots α^0 … α^(ec−1)), computed here independently", () => {
    const EXP: number[] = [];
    const LOG: number[] = new Array(256).fill(0);
    for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    const gmul = (a: number, b: number) => (a && b ? EXP[(LOG[a] + LOG[b]) % 255] : 0);
    const TOTAL: Record<number, [number, number]> = { 1: [26, 16], 2: [44, 28], 3: [70, 44] };
    for (const text of ["abc", "Rp333.333 — Klinik", "QRIS-UJI-".repeat(4)]) {
      const q = encodeQr(text);
      expect(q.version).toBeLessThanOrEqual(3);
      const [total, data] = TOTAL[q.version];
      const cw = readData(q.modules, q.version, q.mask).slice(0, total);
      expect(cw).toHaveLength(total);
      for (let i = 0; i < total - data; i++) {
        let sy = 0;
        for (const c of cw) sy = gmul(sy, EXP[i]) ^ c; // Horner at α^i
        expect(sy, `${text}: syndrome ${i}`).toBe(0);
      }
    }
  });
  it("versions from 7 carry version information; long payloads grow the version; an over-long payload is refused; the SVG path covers the dark modules", () => {
    const q7 = encodeQr("y".repeat(130));
    expect(q7.version).toBeGreaterThanOrEqual(7);
    const n = q7.modules.length;
    let v = 0;
    for (let i = 0; i < 18; i++) v |= (q7.modules[Math.floor(i / 3)][(i % 3) + n - 11] ? 1 : 0) << i;
    expect(v >> 12).toBe(q7.version);
    expect(() => encodeQr("z".repeat(2400))).toThrow(/too long/);
    const p = qrPath(encodeQr("abc"));
    const dark = encodeQr("abc").modules.flat().filter(Boolean).length;
    expect(p.size).toBe(21 + 8);
    expect(p.d.split("M").length - 1).toBe(dark);
  });
});
