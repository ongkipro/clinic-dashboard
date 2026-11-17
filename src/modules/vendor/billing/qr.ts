// QR code encoder (ISO/IEC 18004; byte mode, error correction level M, versions 1–40) for the QRIS payment instruction on UX-49 (T-103 review r1
// P1: the EMVCo payload must be shown as a scannable code). Local and dependency-free: no external QR service, nothing leaves the server.
// Returns the module matrix (true = dark) without the quiet zone; the page draws it as an SVG with a 4-module white margin.

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

// Error correction blocks for level M per version: [blocks, total codewords, data codewords] (+ a second group where the version has one).
const RS_M: number[][] = [
  [1, 26, 16], [1, 44, 28], [1, 70, 44], [2, 50, 32], [2, 67, 43], [4, 43, 27], [4, 49, 31], [2, 60, 38, 2, 61, 39], [3, 58, 36, 2, 59, 37],
  [4, 69, 43, 1, 70, 44], [1, 80, 50, 4, 81, 51], [6, 58, 36, 2, 59, 37], [8, 59, 37, 1, 60, 38], [4, 64, 40, 5, 65, 41], [5, 65, 41, 5, 66, 42],
  [7, 73, 45, 3, 74, 46], [10, 74, 46, 1, 75, 47], [9, 69, 43, 4, 70, 44], [3, 70, 44, 11, 71, 45], [3, 67, 41, 13, 68, 42], [17, 68, 42],
  [17, 74, 46], [4, 75, 47, 14, 76, 48], [6, 73, 45, 14, 74, 46], [8, 75, 47, 13, 76, 48], [19, 74, 46, 4, 75, 47], [22, 73, 45, 3, 74, 46],
  [3, 73, 45, 23, 74, 46], [21, 73, 45, 7, 74, 46], [19, 75, 47, 10, 76, 48], [2, 74, 46, 29, 75, 47], [10, 74, 46, 23, 75, 47],
  [14, 74, 46, 21, 75, 47], [14, 74, 46, 23, 75, 47], [12, 75, 47, 26, 76, 48], [6, 75, 47, 34, 76, 48], [29, 74, 46, 14, 75, 47],
  [13, 74, 46, 32, 75, 47], [40, 75, 47, 7, 76, 48], [18, 75, 47, 31, 76, 48],
];
// Alignment pattern centre coordinates per version.
const ALIGN: number[][] = [
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62],
  [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90], [6, 28, 50, 72, 94],
  [6, 26, 50, 74, 98], [6, 30, 54, 78, 102], [6, 28, 54, 80, 106], [6, 32, 58, 84, 110], [6, 30, 58, 86, 114], [6, 34, 62, 90, 118],
  [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130], [6, 30, 56, 82, 108, 134], [6, 34, 60, 86, 112, 138],
  [6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146], [6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154],
  [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162], [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170],
];

const blocksOf = (v: number) => {
  const t = RS_M[v - 1];
  const out: { total: number; data: number }[] = [];
  for (let g = 0; g < t.length; g += 3) for (let i = 0; i < t[g]; i++) out.push({ total: t[g + 1], data: t[g + 2] });
  return out;
};
const dataCapacity = (v: number) => blocksOf(v).reduce((n, b) => n + b.data, 0);

function generator(ec: number): number[] {
  let g = [1];
  for (let i = 0; i < ec; i++) {
    const r = new Array<number>(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      r[j] ^= g[j];
      r[j + 1] ^= mul(g[j], EXP[i]);
    }
    g = r;
  }
  return g;
}
function remainder(data: number[], ec: number): number[] {
  const g = generator(ec);
  const rem = new Array<number>(ec).fill(0);
  for (const b of data) {
    const f = b ^ rem[0];
    rem.shift();
    rem.push(0);
    for (let k = 0; k < ec; k++) rem[k] ^= mul(g[k + 1], f);
  }
  return rem;
}

const digits = (x: number) => {
  let n = 0;
  while (x !== 0) {
    n++;
    x >>>= 1;
  }
  return n;
};
const bch = (data: number, poly: number, shift: number) => {
  let d = data << shift;
  while (digits(d) - digits(poly) >= 0) d ^= poly << (digits(d) - digits(poly));
  return (data << shift) | d;
};
const G15 = 0b10100110111;
const G18 = 0b1111100100101;
const FORMAT_MASK = 0b101010000010010;

const MASKS: ((i: number, j: number) => boolean)[] = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (_i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i * j) % 3) + ((i + j) % 2)) % 2 === 0,
];

function codewords(bytes: Uint8Array, v: number): number[] {
  const cap = dataCapacity(v);
  const bits: number[] = [];
  const put = (x: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((x >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, v < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  for (let i = 0; i < 4 && bits.length < cap * 8; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let p = 0; data.length < cap; p++) data.push(p % 2 ? 0x11 : 0xec);
  // split into blocks, add error correction, interleave
  const blocks = blocksOf(v);
  const dc: number[][] = [];
  const ecc: number[][] = [];
  let off = 0;
  for (const b of blocks) {
    const d = data.slice(off, off + b.data);
    off += b.data;
    dc.push(d);
    ecc.push(remainder(d, b.total - b.data));
  }
  const out: number[] = [];
  const maxD = Math.max(...dc.map((d) => d.length));
  for (let i = 0; i < maxD; i++) for (const d of dc) if (i < d.length) out.push(d[i]);
  const maxE = Math.max(...ecc.map((e) => e.length));
  for (let i = 0; i < maxE; i++) for (const e of ecc) if (i < e.length) out.push(e[i]);
  return out;
}

function build(v: number, words: number[], mask: number): boolean[][] {
  const n = v * 4 + 17;
  const m: (boolean | null)[][] = Array.from({ length: n }, () => new Array<boolean | null>(n).fill(null));
  const finder = (row: number, col: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        if (row + r < 0 || row + r >= n || col + c < 0 || col + c >= n) continue;
        m[row + r][col + c] = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6)) || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      }
    }
  };
  finder(0, 0);
  finder(n - 7, 0);
  finder(0, n - 7);
  const pos = ALIGN[v - 1];
  for (const row of pos) {
    for (const col of pos) {
      if (m[row][col] !== null) continue;
      for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) m[row + r][col + c] = r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0);
    }
  }
  for (let i = 8; i < n - 8; i++) {
    if (m[i][6] === null) m[i][6] = i % 2 === 0;
    if (m[6][i] === null) m[6][i] = i % 2 === 0;
  }
  // format information (level M = 00, then the mask)
  const fmt = bch((0b00 << 3) | mask, G15, 10) ^ FORMAT_MASK;
  for (let i = 0; i < 15; i++) {
    const d = ((fmt >> i) & 1) === 1;
    if (i < 6) m[i][8] = d;
    else if (i < 8) m[i + 1][8] = d;
    else m[n - 15 + i][8] = d;
    if (i < 8) m[8][n - i - 1] = d;
    else if (i < 9) m[8][15 - i] = d;
    else m[8][15 - i - 1] = d;
  }
  m[n - 8][8] = true; // the dark module
  if (v >= 7) {
    const ver = bch(v, G18, 12);
    for (let i = 0; i < 18; i++) {
      const d = ((ver >> i) & 1) === 1;
      m[Math.floor(i / 3)][(i % 3) + n - 11] = d;
      m[(i % 3) + n - 11][Math.floor(i / 3)] = d;
    }
  }
  // data, in two-column zigzag from the bottom right, skipping the vertical timing column
  const f = MASKS[mask];
  let inc = -1;
  let row = n - 1;
  let bit = 7;
  let idx = 0;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (;;) {
      for (let c = 0; c < 2; c++) {
        if (m[row][col - c] === null) {
          let dark = idx < words.length && ((words[idx] >>> bit) & 1) === 1;
          if (f(row, col - c)) dark = !dark;
          m[row][col - c] = dark;
          if (--bit === -1) {
            idx++;
            bit = 7;
          }
        }
      }
      row += inc;
      if (row < 0 || row >= n) {
        row -= inc;
        inc = -inc;
        break;
      }
    }
  }
  return m as boolean[][];
}

// The standard mask penalty (adjacent runs, 2×2 blocks, finder-like patterns, dark balance).
function penalty(m: boolean[][]): number {
  const n = m.length;
  let p = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      let run = 1;
      for (let j = 1; j <= n; j++) {
        const same = j < n && (pass ? m[j][i] === m[j - 1][i] : m[i][j] === m[i][j - 1]);
        if (same) run++;
        else {
          if (run >= 5) p += 3 + run - 5;
          run = 1;
        }
      }
      for (let j = 0; j + 10 < n; j++) {
        const at = (k: number) => (pass ? m[j + k][i] : m[i][j + k]);
        const a = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0].every((b, k) => at(k) === (b === 1));
        const b = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1].every((x, k) => at(k) === (x === 1));
        if (a || b) p += 40;
      }
    }
  }
  let dark = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (m[i][j]) dark++;
      if (i + 1 < n && j + 1 < n && m[i][j] === m[i + 1][j] && m[i][j] === m[i][j + 1] && m[i][j] === m[i + 1][j + 1]) p += 3;
    }
  }
  p += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return p;
}

export type QrMatrix = { version: number; mask: number; modules: boolean[][] };

export function encodeQr(text: string): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  let v = 1;
  while (v <= 40 && 4 + (v < 10 ? 8 : 16) + bytes.length * 8 > dataCapacity(v) * 8) v++;
  if (v > 40) throw new Error("QR payload too long");
  const words = codewords(bytes, v);
  let best: QrMatrix | undefined;
  let score = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const modules = build(v, words, mask);
    const s = penalty(modules);
    if (s < score) {
      score = s;
      best = { version: v, mask, modules };
    }
  }
  return best!;
}

// One SVG path (dark modules) with a 4-module quiet zone; the caller sizes it.
export function qrPath(q: QrMatrix): { size: number; d: string } {
  const parts: string[] = [];
  q.modules.forEach((row, y) => row.forEach((dark, x) => { if (dark) parts.push(`M${x + 4} ${y + 4}h1v1h-1z`); }));
  return { size: q.modules.length + 8, d: parts.join("") };
}
