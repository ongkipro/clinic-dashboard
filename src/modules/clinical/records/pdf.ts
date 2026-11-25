// A minimal PDF 1.4 writer for the patient record copy (PR-49, DEC-117 Row 6): A4 pages of Helvetica text,
// no images, no dependency. Preserves WinAnsi Latin-1 characters (0xA0-0xFF) and transcribes common clinical
// symbols (≤, ≥, ±, ×, °, µ) to readable ASCII without silent `?` corruption; wraps by Helvetica glyph width
// within the printable margin; xref offsets are byte offsets of the Latin-1 output.
const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 50;
const SIZE = 10;
const LEADING = 14;
const MAX_LINE_PT = PAGE_W - 2 * MARGIN; // 495 pt
const LINES_PER_PAGE = Math.floor((PAGE_H - 2 * MARGIN) / LEADING);

export type PdfLine = { text: string; bold?: boolean };

const CLINICAL_SUBS: [RegExp, string][] = [
  [/\u2264/g, "<="],
  [/\u2265/g, ">="],
  [/\u00b1/g, "+/-"],
  [/\u00d7/g, "x"],
  [/\u00b0/g, " deg "],
  [/[\u00b5\u03bc]/g, "u"],
  [/[\u2013\u2014\u2212]/g, "-"],
  [/[\u2018\u2019]/g, "'"],
  [/[\u201c\u201d]/g, '"'],
  [/\u2026/g, "..."],
  [/\t/g, " "],
];

// Normalize to WinAnsi-safe Latin-1 (preserving accented letters & clinical notation cleanly).
const toWinAnsi = (s: string): string => {
  let t = s.normalize("NFC");
  for (const [re, rep] of CLINICAL_SUBS) t = t.replace(re, rep);
  let out = "";
  for (const ch of t) {
    const cp = ch.codePointAt(0)!;
    if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff)) {
      out += ch;
    } else {
      const stripped = ch.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
      if (stripped && /^[\x20-\x7e]+$/.test(stripped)) out += stripped;
      else out += "?";
    }
  }
  return out;
};

const escape = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);

// Standard Adobe AFM advance widths (1/1000 em) for WinAnsi ASCII 0x20..0x7E in Helvetica & Helvetica-Bold
// (DEC-117 Row 6: prevents wide glyphs like '@' [1015] or 'W' [944] from overflowing MAX_LINE_PT).
const HELV_WIDTHS: readonly number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const HELV_BOLD_WIDTHS: readonly number[] = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

// Exact Adobe AFM advance widths (1/1000 em) for WinAnsi Latin-1 0xA0..0xFF in Helvetica & Helvetica-Bold.
const HELV_LATIN1_WIDTHS: readonly number[] = [
  278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333,
  400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611,
  667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
  722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
  556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
];
const HELV_BOLD_LATIN1_WIDTHS: readonly number[] = [
  278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333,
  400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611,
  722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
  722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
  556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278,
  611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556,
];

function charWidthPt(ch: string, bold: boolean): number {
  const cp = ch.charCodeAt(0);
  let units: number;
  if (cp >= 0x20 && cp <= 0x7e) {
    units = (bold ? HELV_BOLD_WIDTHS : HELV_WIDTHS)[cp - 0x20];
  } else if (cp >= 0xa0 && cp <= 0xff) {
    units = (bold ? HELV_BOLD_LATIN1_WIDTHS : HELV_LATIN1_WIDTHS)[cp - 0xa0];
  } else {
    units = 1000;
  }
  return units * (SIZE / 1000);
}

export function measureLineWidthPt(s: string, bold = false): number {
  let w = 0;
  for (let i = 0; i < s.length; i++) w += charWidthPt(s[i], bold);
  return w;
}

const textWidthPt = measureLineWidthPt;
export const PDF_MAX_LINE_PT = MAX_LINE_PT;

// One logical line (already without newlines) wrapped strictly within MAX_LINE_PT, breaking at spaces.
function wrap(text: string, bold = false): string[] {
  const out: string[] = [];
  let line = "";
  const pushSplit = (token: string) => {
    let cur = "";
    for (const ch of token) {
      if (cur && textWidthPt(cur + ch, bold) > MAX_LINE_PT) {
        out.push(cur);
        cur = ch;
      } else {
        cur += ch;
      }
    }
    line = cur;
  };
  for (const word of toWinAnsi(text).split(/ +/)) {
    if (!line) {
      if (textWidthPt(word, bold) <= MAX_LINE_PT) line = word;
      else pushSplit(word);
    } else if (textWidthPt(`${line} ${word}`, bold) <= MAX_LINE_PT) {
      line += ` ${word}`;
    } else {
      out.push(line);
      if (textWidthPt(word, bold) <= MAX_LINE_PT) line = word;
      else pushSplit(word);
    }
  }
  out.push(line);
  return out;
}

export function renderPdf(lines: PdfLine[]): Buffer {
  const flat: PdfLine[] = lines.flatMap((l) =>
    l.text.split(/\r?\n/).flatMap((t) => wrap(t, Boolean(l.bold)).map((w) => ({ text: w, bold: l.bold }))),
  );
  const pages: PdfLine[][] = [];
  for (let i = 0; i < Math.max(flat.length, 1); i += LINES_PER_PAGE) pages.push(flat.slice(i, i + LINES_PER_PAGE));
  // Objects: 1 catalog, 2 pages, 3 font regular, 4 font bold, then per page: page, content.
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ");
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  pages.forEach((page, i) => {
    const body = page.map((l, j) => `BT /${l.bold ? "F2" : "F1"} ${SIZE} Tf ${MARGIN} ${PAGE_H - MARGIN - j * LEADING} Td (${escape(l.text)}) Tj ET`).join("\n");
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${Buffer.byteLength(body, "latin1")} >>\nstream\n${body}\nendstream`);
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
