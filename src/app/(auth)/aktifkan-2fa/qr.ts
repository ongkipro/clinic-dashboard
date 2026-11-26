import { encode } from "uqr";

export type QrSvg = { size: number; path: string };

// Render a QR code as a single SVG path with a 4-module quiet zone (ISO/IEC 18004)
// so callers render inline <svg> with zero data: URIs or inline styles (vendor CSP).
export function qrToSvgPath(value: string): QrSvg {
  const { size, data } = encode(value, { ecc: "M", border: 4 });
  const parts: string[] = [];
  for (let y = 0; y < size; y++) {
    const row = data[y]!;
    for (let x = 0; x < size; ) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < size && row[x]) x++;
      parts.push(`M${start} ${y}h${x - start}v1h-${x - start}z`);
    }
  }
  return { size, path: parts.join("") };
}
