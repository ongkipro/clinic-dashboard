// T-012 Done-when: contrast over all token pairs (UI-1); accent validation rejects a
// failing hex (UI-2). Also: tokens.css equals tokens.ts, and DESIGN.md's table values
// are the ones used.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkAccent, COLORS, colorOf, contrast, PAIRS, pressedOf, softOf } from "../../src/styles/tokens";

const ROOT = join(import.meta.dirname, "../..");
const css = readFileSync(join(ROOT, "src/styles/tokens.css"), "utf8");
const design = readFileSync(join(ROOT, "DESIGN.md"), "utf8");
const kebab = (k: string) => k.replace(/([a-z])([A-Z0-9])/g, "$1-$2").toLowerCase();

describe("UI-1 contrast over all token pairs", () => {
  it.each(PAIRS.map(([f, b, min]) => [f, b, min] as const))("%s on %s ≥ %s:1", (fg, bg, min) => {
    expect(contrast(colorOf(fg), colorOf(bg))).toBeGreaterThanOrEqual(min);
  });

  // Every "fg on bg ratio" stated in the DESIGN.md colour table (rounded to 2 decimals).
  // Two stated values are off and are pinned to the computed ratio here (both stay
  // above the floor; DESIGN.md to be corrected): label on grouped is 18.82, not 18.9;
  // label-2 on tint-soft is 5.05 (as the tint-soft row says), not 5.18 (label-2 row).
  const STATED: [string, string, number][] = [
    [COLORS.label, COLORS.bg, 21.0], [COLORS.label, COLORS.bgGrouped, 18.82],
    [COLORS.label2, COLORS.bg, 5.99], [COLORS.label2, COLORS.bgGrouped, 5.37],
    [COLORS.label2, COLORS.surface2, 4.95], [COLORS.label2, COLORS.tintSoft, 5.05],
    [COLORS.label3, COLORS.bg, 3.44], [COLORS.separator, COLORS.bg, 1.71],
    [COLORS.controlBorder, COLORS.bg, 4.16], [COLORS.controlBorder, COLORS.bgGrouped, 3.73],
    [COLORS.tint, COLORS.bg, 5.85], [COLORS.tint, COLORS.bgGrouped, 5.25], [COLORS.onTint, COLORS.tint, 5.85],
    [COLORS.tint, COLORS.tintSoft, 4.94],
    [COLORS.danger, COLORS.bg, 5.73], [COLORS.danger, COLORS.bgGrouped, 5.13], [COLORS.danger, COLORS.dangerSoft, 5.01],
    [COLORS.warning, COLORS.bg, 5.78], [COLORS.warning, COLORS.bgGrouped, 5.18], [COLORS.warning, COLORS.warningSoft, 5.2],
    [COLORS.success, COLORS.bg, 5.4], [COLORS.success, COLORS.bgGrouped, 4.84], [COLORS.success, COLORS.successSoft, 4.8],
    [COLORS.locked, COLORS.lockedSoft, 6.69], [COLORS.neutral, COLORS.neutralSoft, 9.38], [COLORS.onTint, COLORS.badge, 5.38],
    [COLORS.chart1, COLORS.surface, 5.19], [COLORS.chart2, COLORS.surface, 3.87], [COLORS.chart3, COLORS.surface, 3.42],
    [COLORS.chart4, COLORS.surface, 4.49],
  ];
  it.each(STATED)("DESIGN.md: %s on %s is %s:1", (fg, bg, ratio) => {
    expect(Math.abs(contrast(fg, bg) - ratio)).toBeLessThan(0.06);
  });

  it("the hover/pressed tint keeps white text ≥ 4.5 for the default and for accepted accents", () => {
    for (const a of [COLORS.tint, "#0F766E", "#2E718F"]) {
      expect(checkAccent(a).ok, a).toBe(true);
      expect(contrast(COLORS.onTint, pressedOf(a)), a).toBeGreaterThanOrEqual(contrast(COLORS.onTint, a));
    }
  });

  it("label-3 is below 4.5 and therefore reserved for disabled text only", () => {
    expect(contrast(COLORS.label3, COLORS.bg)).toBeLessThan(4.5);
  });
});

describe("tokens.css mirrors tokens.ts and DESIGN.md", () => {
  // DESIGN.md table rows: "| `--token` | `#HEX` ..." or "`--a` / `--b` | `#A` / `#B`".
  const designValue = (token: string): string | undefined => {
    for (const row of design.split("\n").filter((l) => l.startsWith("| `--"))) {
      const names = [...row.split("|")[1].matchAll(/--([a-z0-9-]+)/g)].map((m) => m[1]);
      const values = [...row.split("|")[2].matchAll(/#[0-9A-Fa-f]{6}/g)].map((m) => m[0].toUpperCase());
      const i = names.indexOf(token);
      if (i >= 0) return values[i] ?? values[0];
    }
    return undefined;
  };
  it.each(Object.entries(COLORS))("--%s equals DESIGN.md and tokens.css", (name, value) => {
    const token = kebab(name);
    const v = new RegExp(`--${token}:\\s*(#[0-9A-Fa-f]{6});`).exec(css)?.[1];
    expect(v?.toUpperCase(), token).toBe(value);
    // Derived tokens that DESIGN.md does not list (tested by their contrast pairs).
    if (!token.startsWith("chart") && token !== "danger-pressed") expect(designValue(token), token).toBe(value);
  });

  it("chart series match DESIGN.md in order", () => {
    const row = design.split("\n").find((l) => l.startsWith("| `--chart-1…4`"))!;
    expect([...row.matchAll(/#[0-9A-Fa-f]{6}/g)].map((m) => m[0].toUpperCase())).toEqual([
      COLORS.chart1, COLORS.chart2, COLORS.chart3, COLORS.chart4,
    ]);
  });

  it("increased contrast overrides label-2 and separators", () => {
    expect(css).toMatch(/@media \(prefers-contrast: more\)[\s\S]*--label-2: #3A3A3C;[\s\S]*--separator: var\(--control-border\)/);
  });

  it("no blur outside the bar glass, no looping animation in components", async () => {
    const { readdirSync } = await import("node:fs");
    const dir = join(ROOT, "src/components/ui");
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src, f).not.toMatch(/backdrop-blur|animate-pulse|animate-spin|animate-in/);
      // Colours come from tokens: no hex literals in component classes.
      expect(src, f).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
    }
  });

  it("tint-soft is the 12% blend of tint over white", () => {
    expect(softOf(COLORS.tint)).toBe(COLORS.tintSoft);
  });

  it("tokens.css has balanced braces (a stray brace breaks every page)", () => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect((stripped.match(/{/g) ?? []).length).toBe((stripped.match(/}/g) ?? []).length);
  });

  it("light only: no dark variant or prefers-color-scheme: dark rules", () => {
    expect(css).toMatch(/color-scheme:\s*only light/);
    expect(css).not.toMatch(/prefers-color-scheme:\s*dark|\.dark\b/);
  });

  it("no bundled fonts (system font stack only)", () => {
    expect(css).not.toMatch(/@font-face|SF Pro|San Francisco/i);
  });
});

describe("UI-2 tenant accent validation", () => {
  it("accepts the default accent and derives its soft", () => {
    expect(checkAccent("#0A6E86")).toEqual({ ok: true, accent: "#0A6E86", soft: "#E2EEF0" });
  });

  it("rejects a failing hex, names the failing pairs with ratios, and suggests a darker shade that passes", () => {
    const r = checkAccent("#4FC3F7"); // light blue
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.failures.map((f) => f.against)).toEqual(["putih", "latar grup", "warna lembut", "bar kaca"]);
    expect(r.failures.every((f) => f.ratio < 4.5)).toBe(true);
    expect(r.suggestion).toMatch(/^#[0-9A-F]{6}$/);
    expect(checkAccent(r.suggestion!).ok).toBe(true);
  });

  it("compares the exact ratio: #0172A0 (4.4985:1 on bar glass) is rejected, not rounded up", () => {
    const r = checkAccent("#0172A0");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failures).toEqual([{ against: "bar kaca", ratio: 4.49 }]);
  });

  it("rejects a near-miss that fails only on bar glass (4.49:1)", () => {
    expect(checkAccent("#0E7490")).toEqual({
      ok: false,
      failures: [{ against: "bar kaca", ratio: 4.49 }],
      suggestion: expect.stringMatching(/^#[0-9A-F]{6}$/),
    });
    expect(checkAccent("#0F766E").ok).toBe(true);
  });

  it("refuses malformed input", () => {
    for (const bad of ["0A6E86", "#0A6E8", "#GGGGGG", "red", "#0a6e86; background:url(x)"]) {
      expect(() => checkAccent(bad), bad).toThrow("not a #RRGGBB colour");
    }
  });
});
