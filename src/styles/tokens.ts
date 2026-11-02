// DESIGN.md tokens as data (UI-1, UI-2, D-14..D-16). tokens.css mirrors these values; a
// test keeps the two equal. Light appearance only.
export const COLORS = {
  bg: "#FFFFFF",
  bgGrouped: "#F2F2F7",
  surface: "#FFFFFF",
  surface2: "#E9E9EE",
  label: "#000000",
  label2: "#636366",
  label3: "#8A8A8E", // disabled only, never information
  separator: "#C6C6C8", // decorative
  controlBorder: "#7C7C80",
  tint: "#0A6E86",
  onTint: "#FFFFFF",
  tintSoft: "#E2EEF0",
  danger: "#C4281C",
  dangerSoft: "#FDECEA",
  dangerPressed: "#FBE2DF", // hover/pressed fill of the destructive button (not in DESIGN.md's table; derived, ≥ 4.5 with danger)
  warning: "#A14F00",
  warningSoft: "#FFF1DF",
  success: "#1E7A34",
  successSoft: "#E7F5EA",
  locked: "#4B3FB5",
  lockedSoft: "#EEEBFB",
  neutral: "#3A3A3C",
  neutralSoft: "#E9E9EE",
  badge: "#D70015",
  chart1: "#0072B2",
  chart2: "#D55E00",
  chart3: "#009E73",
  chart4: "#B5568C",
} as const;

// Bar glass over black content, worst case (DESIGN.md Materials).
export const BAR_GLASS_OVER_BLACK = "#EBEBEB";

export type Hex = `#${string}`;

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function parseHex(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new TypeError(`not a #RRGGBB colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

// WCAG 2.x relative luminance and contrast ratio.
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Hover/pressed fill of the tinted button: the accent darkened by 8% (never lighter), so
// white text keeps at least the accent's own contrast.
export function pressedOf(accent: string): string {
  const [r, g, b] = parseHex(accent);
  return toHex([r * 0.92, g * 0.92, b * 0.92]);
}

// tint-soft = accent at 12% over white, sRGB blend (DESIGN.md).
export function softOf(accent: string): string {
  const [r, g, b] = parseHex(accent);
  return toHex([r * 0.12 + 255 * 0.88, g * 0.12 + 255 * 0.88, b * 0.12 + 255 * 0.88]);
}

// Every text and boundary pair the design uses (UI-1): [foreground, background, floor].
// 4.5 for text under 18 px, 3 for UI boundaries and chart marks.
type TokenName = keyof typeof COLORS | "barGlass" | "tintPressed";
export const PAIRS: [TokenName, TokenName, number][] = [
  ["label", "bg", 4.5],
  ["label", "bgGrouped", 4.5],
  ["label", "surface2", 4.5],
  ["label", "separator", 4.5], // secondary button hover fill
  ["label2", "bg", 4.5],
  ["label2", "bgGrouped", 4.5],
  ["label2", "surface2", 4.5],
  ["label2", "tintSoft", 4.5],
  ["controlBorder", "bg", 3],
  ["controlBorder", "bgGrouped", 3],
  ["tint", "bg", 4.5],
  ["tint", "bgGrouped", 4.5],
  ["tint", "tintSoft", 4.5],
  ["tint", "barGlass", 4.5],
  ["label2", "barGlass", 4.5],
  ["onTint", "tint", 4.5],
  ["onTint", "tintPressed", 4.5],
  ["danger", "bg", 4.5],
  ["danger", "bgGrouped", 4.5],
  ["danger", "dangerSoft", 4.5],
  ["danger", "dangerPressed", 4.5],
  ["warning", "bg", 4.5],
  ["warning", "bgGrouped", 4.5],
  ["warning", "warningSoft", 4.5],
  ["success", "bg", 4.5],
  ["success", "bgGrouped", 4.5],
  ["success", "successSoft", 4.5],
  ["locked", "lockedSoft", 4.5],
  ["locked", "bg", 4.5],
  ["neutral", "neutralSoft", 4.5],
  ["neutral", "bg", 4.5],
  ["onTint", "badge", 4.5],
  ["chart1", "surface", 3],
  ["chart2", "surface", 3],
  ["chart3", "surface", 3],
  ["chart4", "surface", 3],
];

export function colorOf(name: keyof typeof COLORS | "barGlass" | "tintPressed"): string {
  if (name === "barGlass") return BAR_GLASS_OVER_BLACK;
  if (name === "tintPressed") return pressedOf(COLORS.tint);
  return COLORS[name];
}

// UI-2: a tenant accent is accepted only if accent on white, on grouped, on its derived
// soft and on bar glass over black are each ≥ 4.5:1. A refusal names the failing pair
// and suggests the nearest darker shade that passes.
export type AccentCheck =
  | { ok: true; accent: string; soft: string }
  | { ok: false; failures: { against: string; ratio: number }[]; suggestion: string | null };

export function checkAccent(input: string): AccentCheck {
  const accent = toHex(parseHex(input.trim()));
  const failures = accentFailures(accent);
  if (failures.length === 0) return { ok: true, accent, soft: softOf(accent) };
  return { ok: false, failures, suggestion: darkerPassing(accent) };
}

function accentFailures(accent: string): { against: string; ratio: number }[] {
  const soft = softOf(accent);
  const checks: [string, string][] = [
    ["putih", COLORS.bg],
    ["latar grup", COLORS.bgGrouped],
    ["warna lembut", soft],
    ["bar kaca", BAR_GLASS_OVER_BLACK],
  ];
  // Compare the exact ratio; round only for display (4.4985 must fail, not show as 4.50).
  return checks
    .map(([against, bg]) => ({ against, exact: contrast(accent, bg) }))
    .filter((c) => c.exact < 4.5)
    .map(({ against, exact }) => ({ against, ratio: Math.floor(exact * 100) / 100 }));
}

function darkerPassing(accent: string): string | null {
  const [r, g, b] = parseHex(accent);
  for (let f = 0.99; f > 0; f -= 0.01) {
    const c = toHex([r * f, g * f, b * f]);
    if (accentFailures(c).length === 0) return c;
  }
  return null;
}
