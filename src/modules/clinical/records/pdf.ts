// A minimal PDF 1.4 writer for the patient record copy (PR-49): A4 pages of Helvetica text, no images, no
// dependency. Text is reduced to printable ASCII (accents stripped, others `?`), `\` `(` `)` escaped, control characters dropped; lines
// wrap at a fixed width; xref offsets are byte offsets of the Latin-1 output.
const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 50;
const SIZE = 10;
const LEADING = 14;
const WRAP = 95; // characters per line at 10 pt Helvetica within the margins (conservative)
const LINES_PER_PAGE = Math.floor((PAGE_H - 2 * MARGIN) / LEADING);

export type PdfLine = { text: string; bold?: boolean };

const ascii = (s: string) =>
  s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[\u2013\u2014]/g, "-").replace(/\t/g, " ").replace(/[^\x20-\x7e]/g, "?");
const escape = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);

// One logical line (already without newlines) to lines of at most WRAP characters, breaking at spaces.
function wrap(text: string): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of ascii(text).split(/ +/)) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= WRAP) line += ` ${word}`;
    else { out.push(line); line = word; }
    while (line.length > WRAP) { out.push(line.slice(0, WRAP)); line = line.slice(WRAP); }
  }
  out.push(line);
  return out;
}

export function renderPdf(lines: PdfLine[]): Buffer {
  const flat: PdfLine[] = lines.flatMap((l) => l.text.split(/\r?\n/).flatMap((t) => wrap(t).map((w) => ({ text: w, bold: l.bold }))));
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
