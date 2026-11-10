// The type and pixel size of an uploaded file, read from its own bytes (never the name or the declared type):
// PDF by its header; PNG by signature and IHDR; JPEG by SOI and the first SOF marker. Corrupt or truncated
// headers are refused (null). No dependency.
export type Sniffed = { contentType: "application/pdf" } | { contentType: "image/png" | "image/jpeg"; width: number; height: number };

const startsWith = (b: Buffer, sig: number[]) => b.length >= sig.length && sig.every((x, i) => b[i] === x);

export function sniff(b: Buffer): Sniffed | null {
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { contentType: "application/pdf" };
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    if (b.length < 24 || b.toString("latin1", 12, 16) !== "IHDR") return null;
    const width = b.readUInt32BE(16);
    const height = b.readUInt32BE(20);
    return width >= 1 && height >= 1 && width <= 20000 && height <= 20000 ? { contentType: "image/png", width, height } : null;
  }
  if (startsWith(b, [0xff, 0xd8, 0xff])) {
    // Walk the marker segments to the first SOF (C0–CF except C4 DHT, C8 JPG, CC DAC).
    let i = 2;
    while (i + 4 <= b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker === 0xff) { i += 1; continue; }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
      if (marker === 0xd9 || marker === 0xda) return null; // end or scan before any frame header
      const len = b.readUInt16BE(i + 2);
      if (len < 2 || i + 2 + len > b.length) return null;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        if (len < 7) return null;
        const height = b.readUInt16BE(i + 5);
        const width = b.readUInt16BE(i + 7);
        return width >= 1 && height >= 1 ? { contentType: "image/jpeg", width, height } : null;
      }
      i += 2 + len;
    }
    return null;
  }
  return null;
}
