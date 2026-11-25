// T-129 (PR-87, 19 §4) — Read-only verification of the Release 1 public site page set.
// Asserts that:
//  1. Every page listed in `docs/spec/19-NAVIGATION-PAGE-CATALOGUE.md` §4 Release 1 is mounted under src/app/(public)/[slug]/;
//  2. No Permenkes 1787/2010 / JUR-ID-7 prohibited promo, testimonial, or discount pages exist under src/app/(public)/[slug]/;
//  3. No Phase 4 (PR-40 / IAM-2) routes are prematurely mounted in Release 1;
//  4. Public pages never import vendor or authenticated clinic-staff modules.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
const PUB_SLUG = join(ROOT, "src/app/(public)/[slug]");

const RELEASE_1_MAP: Record<string, string> = {
  Beranda: "page.tsx",
  Perawatan: "perawatan/page.tsx",
  "Detail Perawatan": "perawatan/[treatment]/page.tsx",
  Cabang: "cabang/page.tsx",
  "Detail Cabang": "cabang/[branch]/page.tsx",
  Dokter: "dokter/page.tsx",
  "Profil Dokter": "dokter/[doctor]/page.tsx",
  Booking: "booking/page.tsx",
  "Kebijakan Privasi": "kebijakan-privasi/page.tsx",
  "Syarat & Ketentuan": "syarat-ketentuan/page.tsx",
  "Kebijakan Pembatalan": "kebijakan-pembatalan/page.tsx",
};

function collectPageFiles(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const nextRel = rel ? `${rel}/${entry}` : entry;
    if (statSync(full).isDirectory()) {
      out.push(...collectPageFiles(full, nextRel));
    } else if (entry === "page.tsx") {
      out.push(nextRel);
    }
  }
  return out.sort();
}

describe("PR-87 public site page set (19 §4 Release 1, read-only)", () => {
  it("parses 19 §4 Release 1 and confirms every listed page is mounted under src/app/(public)/[slug]/", () => {
    const spec = readFileSync(join(ROOT, "docs/spec/19-NAVIGATION-PAGE-CATALOGUE.md"), "utf8");
    const sec4 = /^## 4\. [\s\S]*?(?=^## 5\. )/m.exec(spec)?.[0] ?? "";
    const r1Line = /^Release 1 \([^)]+\):\s*([^.]+)\./m.exec(sec4)?.[1];
    expect(r1Line).toBeTruthy();

    const specPages = r1Line!
      .split("·")
      .map((s) => s.replace(/\s*\([^)]*\)/g, "").trim())
      .filter(Boolean);

    expect(specPages).toEqual(Object.keys(RELEASE_1_MAP));
    for (const label of specPages) {
      const relFile = RELEASE_1_MAP[label];
      expect(existsSync(join(PUB_SLUG, relFile)), `Missing mounted 19 §4 page for "${label}": ${relFile}`).toBe(true);
    }

    // Mounted page.tsx tree equals the exact Release 1 set (no unlisted promo, testimonial, or Phase 4 pages).
    const mounted = collectPageFiles(PUB_SLUG);
    expect(mounted).toEqual(Object.values(RELEASE_1_MAP).sort());
  });

  it("mounts zero Permenkes 1787/2010 prohibited pages and zero Phase 4 pages in Release 1", () => {
    const forbidden = [
      "promo",
      "promosi",
      "diskon",
      "testimoni",
      "ulasan",
      "review",
      "before-after",
      "artikel",
      "masalah-kulit",
      "skin-quiz",
      "paket",
      "produk",
      "portal",
    ];
    for (const seg of forbidden) {
      expect(existsSync(join(PUB_SLUG, seg)), `Forbidden or Phase 4 route mounted: /${seg}`).toBe(false);
    }
  });

  it("no public page imports vendor console or authenticated clinic staff shell modules", () => {
    for (const relFile of Object.values(RELEASE_1_MAP)) {
      const src = readFileSync(join(PUB_SLUG, relFile), "utf8");
      expect(src, relFile).not.toMatch(/from\s+["'][^"']*\/vendor\//);
      expect(src, relFile).not.toMatch(/from\s+["'][^"']*components\/shell/);
      expect(src, relFile).not.toMatch(/["']use server["']/);
    }
  });
});
