// Unit check for inline-SVG 2FA QR generation (vendor CSP safe: no data: URLs, no inline styles).
import { describe, expect, it } from "vitest";
import { encode } from "uqr";
import { qrToSvgPath } from "../../src/app/(auth)/aktifkan-2fa/qr";

const SAMPLE_URI =
  "otpauth://totp/Klinik%20Dashboard:demo%40klinik-estetika.test?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Klinik%20Dashboard&algorithm=SHA1&digits=6&period=30";

describe("qrToSvgPath", () => {
  it("encodes an otpauth URI into an exact SVG path with a 4-module quiet zone", () => {
    const expected = encode(SAMPLE_URI, { ecc: "M", border: 4 });
    const actual = qrToSvgPath(SAMPLE_URI);
    expect(actual.size).toBe(expected.size);

    // Reconstruct the grid from the emitted M{x} {y}h{w}v1h-{w}z runs and verify 1:1 parity.
    const grid = Array.from({ length: actual.size }, () => Array<boolean>(actual.size).fill(false));
    const runs = [...actual.path.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)];
    expect(runs.length).toBeGreaterThan(20);
    expect(runs.map((m) => m[0]).join("")).toBe(actual.path);

    for (const [, xs, ys, ws, back] of runs) {
      const x = Number(xs);
      const y = Number(ys);
      const w = Number(ws);
      expect(w).toBe(Number(back));
      for (let i = 0; i < w; i++) {
        expect(grid[y]![x + i]).toBe(false);
        grid[y]![x + i] = true;
      }
    }

    expect(grid).toEqual(expected.data);

    // Confirm the 4-module quiet zone around all four edges is completely clear.
    for (let i = 0; i < actual.size; i++) {
      for (let b = 0; b < 4; b++) {
        expect(grid[b]![i]).toBe(false);
        expect(grid[actual.size - 1 - b]![i]).toBe(false);
        expect(grid[i]![b]).toBe(false);
        expect(grid[i]![actual.size - 1 - b]).toBe(false);
      }
    }
  });
});
