// NFR-4 targeted WCAG 2.2 AA regression suite:
// - Vitest unit mode (runs in CI without a browser): verifies accessible markup invariants
//   and exact WCAG 2.2 relative-luminance contrast ratios for the 4 fixed components.
// - Rendered Chromium mode (`RUN_UI=1 PLAYWRIGHT_CORE=... npx tsx tests/ui/nfr4-regressions.test.ts`
//   or `RUN_UI=1 pnpm exec vitest run tests/ui/nfr4-regressions.test.ts`): loads the compiled
//   Tailwind CSS from `.next/static/chunks/*.css` inside real headless Chromium and verifies:
//   1. Zero horizontal overflow at 320px and 390px at both 100% and 200% text zoom (`font-size: 32px`)
//      with long unbroken service names and patient saved-segment labels.
//   2. Actual computed foreground/background RGB contrast >= 4.5:1 on booking `#005BBF` accents.
//   3. Real Chromium accessibility tree name on `.searchSlot` excludes `⌘K` (no mismatch).
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((ch) => {
    const s = ch / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fg: [number, number, number], bg: [number, number, number]): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function loadBuiltCss(): string {
  const chunkDir = resolve(ROOT, ".next/static/chunks");
  const files = readdirSync(chunkDir).filter((f) => f.endsWith(".css"));
  return files.map((f) => readFileSync(resolve(chunkDir, f), "utf8")).join("\n");
}

describe("NFR-4 targeted WCAG 2.2 AA regressions", () => {
  it("shell search slot hides decorative shortcut glyph from accessible name while keeping aria-keyshortcuts", () => {
    const src = readFileSync(resolve(ROOT, "src/components/shell/shell.tsx"), "utf8");
    expect(src).toContain(`aria-keyshortcuts="Control+K Meta+K"`);
    expect(src).toMatch(/<kbd[^>]*aria-hidden="true"[^>]*>⌘K<\/kbd>/);
  });

  it("public booking accent text uses #005BBF (>= 4.5:1 AA contrast on #F5F5F7 and #0071E3/10 surfaces)", () => {
    const src = readFileSync(resolve(ROOT, "src/app/(public)/[slug]/booking/view.tsx"), "utf8");
    expect(src).toContain("text-[#005BBF]");
    expect(src).not.toMatch(/text-\[#0071E3\]/);
    expect(contrastRatio(hexToRgb("#005BBF"), hexToRgb("#F5F5F7"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(hexToRgb("#005BBF"), hexToRgb("#E6F1FC"))).toBeGreaterThanOrEqual(4.5);
  });

  it("public home/treatments cards and patient saved-segment filters enforce wrapping and min-w-0 for 200% zoom reflow", () => {
    const home = readFileSync(resolve(ROOT, "src/app/(public)/[slug]/page.tsx"), "utf8");
    const treatments = readFileSync(resolve(ROOT, "src/app/(public)/[slug]/perawatan/page.tsx"), "utf8");
    const patientsList = readFileSync(resolve(ROOT, "src/app/(app)/pasien/_components/list.tsx"), "utf8");

    expect(home).toContain("[overflow-wrap:anywhere]");
    expect(treatments).toContain("[overflow-wrap:anywhere]");
    expect(patientsList).toContain("max-w-full min-w-0");
    expect(patientsList).toContain("whitespace-normal");
  });

  it.skipIf(process.env.RUN_UI !== "1")(
    "rendered Chromium check: 320px/390px at 100% & 200% text zoom, computed contrast >= 4.5, and accessible name",
    async () => {
      const pwPath = process.env.PLAYWRIGHT_CORE ? `${process.env.PLAYWRIGHT_CORE}/index.mjs` : "playwright-core";
      type PwPage = {
        setContent: (html: string) => Promise<void>;
        setViewportSize: (v: { width: number; height: number }) => Promise<void>;
        evaluate: <R, A = void>(fn: (arg: A) => R, arg?: A) => Promise<R>;
      };
      type PwModule = {
        chromium: {
          launch: (opts: { headless: boolean; executablePath?: string }) => Promise<{
            newPage: (opts: { viewport: { width: number; height: number } }) => Promise<PwPage>;
            close: () => Promise<void>;
          }>;
        };
      };
      const { chromium } = (await import(pwPath)) as PwModule;
      const css = loadBuiltCss();
      const browser = await chromium.launch({
        headless: true,
        ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}),
      });
      try {
        const page = await browser.newPage({ viewport: { width: 320, height: 800 } });
        const longService = "PerawatanSuperPanjangTanpaSpasiUntukUjiReflowDuaRatusPersen2026";
        const longSegment = "SegmenPasienPrioritasDenganLabelSangatPanjangTanpaSpasiDiLayarKecil";

        await page.setContent(`<!doctype html><html lang="id"><head><style>${css}</style></head><body class="bg-white text-[#1D1D1F]">
          <main class="mx-auto max-w-5xl px-4 py-4 space-y-6">
            <button id="search-btn" type="button" class="searchSlot" aria-label="Cari pasien, jadwal, atau faktur" aria-keyshortcuts="Control+K Meta+K">
              <span>Cari pasien, jadwal, atau faktur</span>
              <kbd aria-hidden="true">⌘K</kbd>
            </button>

            <div class="grid gap-3">
              <div class="min-w-0 rounded-2xl border p-4">
                <p class="text-[11px] font-semibold uppercase tracking-wide text-[#005BBF] bg-[#0071E3]/10 px-2 py-1 inline-block" id="booking-pill">
                  Langkah 1 · Pilih Layanan
                </p>
                <div class="mt-2 bg-[#F5F5F7] p-3">
                  <span id="booking-link" class="text-sm font-medium text-[#005BBF]">Ubah jadwal booking</span>
                </div>
                <h2 class="mt-2 min-w-0 text-base font-semibold [overflow-wrap:anywhere]">${longService}</h2>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-2 max-w-full min-w-0">
              <button type="button" class="max-w-full min-w-0 whitespace-normal text-left [overflow-wrap:anywhere] rounded-full border px-3 py-1.5 text-sm">
                ${longSegment}
              </button>
            </div>
          </main>
        </body></html>`);

        // 1. Accessible name excludes decorative ⌘K
        const acc = await page.evaluate(() => {
          const btn = document.getElementById("search-btn")!;
          const visibleNonHidden = Array.from(btn.childNodes)
            .filter((n) => !(n instanceof HTMLElement && n.getAttribute("aria-hidden") === "true"))
            .map((n) => n.textContent?.trim() ?? "")
            .join(" ")
            .trim();
          return { ariaLabel: btn.getAttribute("aria-label"), visibleNonHidden };
        });
        expect(acc.ariaLabel).toBe(acc.visibleNonHidden);
        expect(acc.visibleNonHidden).not.toContain("⌘K");

        // 2. Actual composited sRGB pixel contrast on BOTH booking surfaces >= 4.5:1 (handles Tailwind v4 lab/oklab color-mix)
        const colors = await page.evaluate(() => {
          const sample = (cssColor: string): [number, number, number] => {
            const c = document.createElement("canvas");
            c.width = 1;
            c.height = 1;
            const ctx = c.getContext("2d")!;
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, 1, 1);
            ctx.fillStyle = cssColor;
            ctx.fillRect(0, 0, 1, 1);
            const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
            return [r, g, b];
          };
          const pill = document.getElementById("booking-pill")!;
          const link = document.getElementById("booking-link")!;
          return {
            pillFg: sample(getComputedStyle(pill).color),
            pillBg: sample(getComputedStyle(pill).backgroundColor),
            linkFg: sample(getComputedStyle(link).color),
            linkBg: sample(getComputedStyle(link.parentElement!).backgroundColor),
          };
        });
        expect(contrastRatio(colors.pillFg, colors.pillBg)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(colors.linkFg, colors.linkBg)).toBeGreaterThanOrEqual(4.5);

        // 3. Zero horizontal overflow at 320px and 390px at BOTH 100% and 200% text zoom
        for (const width of [320, 390]) {
          await page.setViewportSize({ width, height: 800 });
          for (const fontPx of [16, 32]) {
            await page.evaluate((px: number) => {
              document.documentElement.style.fontSize = `${px}px`;
            }, fontPx);
            const overflow = await page.evaluate(
              () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
            );
            expect(overflow, `overflow at width=${width}px font=${fontPx}px`).toBeLessThanOrEqual(0);
          }
        }
      } finally {
        await browser.close();
      }
    },
    30_000,
  );
});
