// Value specs of the settings registry (PR-38, 19 §5). One small type system shared by the
// server validator here, the database validator (setting_value_ok, migration 0028, fed the
// same JSON) and the Pengaturan editor (form fields and display). Bounds are enforced on
// both sides; a value outside them is refused with the bound named.

export type Spec =
  | { t: "int"; min: number; max: number; unit: string }
  | { t: "rupiah"; min: number; max?: number }
  | { t: "bool"; on?: string; off?: string }
  | { t: "enum"; of: { v: string; l: string }[] }
  | { t: "time"; min: string; max: string }
  | { t: "text"; min: number; max: number; pattern?: string; hint?: string }
  | { t: "accent" }
  | { t: "obj"; f: { k: string; l: string; s: Spec }[]; lt?: [string, string][]; le?: [string, string][] }
  | { t: "list"; of: Spec; min: number; max: number; desc?: boolean; unique?: boolean }
  | { t: "opt"; of: Spec; off: string }
  | { t: "oneof"; of: { k: string; l: string; s?: Spec }[] };

export type Value = null | boolean | number | string | Value[] | { [k: string]: Value };

const rp = (n: number) => `Rp${new Intl.NumberFormat("id-ID").format(n)}`;
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// "30–1095 hari", "Rp0–Rp1.000.000", "07:00–21:00", ...
export function boundsText(s: Spec): string {
  switch (s.t) {
    case "int": return `${s.min}–${s.max} ${s.unit}`.trim();
    case "rupiah": return s.max === undefined ? `minimal ${rp(s.min)}` : `${rp(s.min)}–${rp(s.max)}`;
    case "bool": return `${s.on ?? "Aktif"} / ${s.off ?? "Nonaktif"}`;
    case "enum": return s.of.map((o) => o.l).join(" / ");
    case "time": return `${s.min}–${s.max}`;
    case "text": return s.hint ?? `${s.min}–${s.max} karakter`;
    case "accent": return "warna hex dengan kontras ≥ 4,5:1 (UI-2)";
    case "obj": return s.f.map((f) => `${f.l}: ${boundsText(f.s)}`).join("; ");
    case "list": return `${s.min === s.max ? s.min : `${s.min}–${s.max}`} nilai, masing-masing ${boundsText(s.of)}${s.desc ? ", menurun" : ""}`;
    case "opt": return `${s.off}, atau ${boundsText(s.of)}`;
    case "oneof": return s.of.map((o) => (o.s ? `${o.l} (${boundsText(o.s)})` : o.l)).join(" atau ");
  }
}

// Human display of a value ("365 hari", "Aktif", "Rp50.000", ...).
export function formatValue(s: Spec, v: Value): string {
  if (v === null || v === undefined) return s.t === "opt" ? s.off : "Belum diisi";
  switch (s.t) {
    case "int": return `${v} ${s.unit}`.trim();
    case "rupiah": return rp(v as number);
    case "bool": return v ? (s.on ?? "Aktif") : (s.off ?? "Nonaktif");
    case "enum": return s.of.find((o) => o.v === v)?.l ?? String(v);
    case "time": case "text": case "accent": return String(v);
    case "obj": return s.f.map((f) => `${f.l}: ${formatValue(f.s, (v as Record<string, Value>)[f.k])}`).join(" · ");
    case "list": return (v as Value[]).map((x) => formatValue(s.of, x)).join(", ");
    case "opt": return formatValue(s.of, v);
    case "oneof": {
      const o = v as { k: string; v?: Value };
      const c = s.of.find((x) => x.k === o.k);
      return c ? (c.s ? `${c.l} ${formatValue(c.s, o.v ?? null)}` : c.l) : String(o.k);
    }
  }
}

// UI-2 / DESIGN.md: an accent is accepted only if it reaches 4.5:1 against white, the
// grouped background #F2F2F7, its own soft tint (12% over white) and bar glass over
// black (#EBEBEB). Returns the worst of the four ratios (setting_accent_ratio in SQL).
function luminance(rgb: number[]): number {
  const [r, g, b] = rgb.map((x) => {
    const c = x / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
export function accentWorstRatio(hex: string): number {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const l = luminance(rgb);
  const soft = luminance(rgb.map((c) => 0.12 * c + 0.88 * 255));
  return Math.min(ratio(l, 1), ratio(l, luminance([242, 242, 247])), ratio(l, soft), ratio(l, luminance([235, 235, 235])));
}

export type Invalid = { path: string; message: string };

// One explicit whitespace class for both validators (database locales differ on \s).
const WS = "[\\t-\\r \\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]";
const EDGE_WS = new RegExp(`^${WS}|${WS}$`);

// The first problem with v, naming the bound, or null when v fits s. `label` names the
// field in the message.
export function validate(s: Spec, v: Value, label = "Nilai", path = ""): Invalid | null {
  const bad = (message: string): Invalid => ({ path, message });
  switch (s.t) {
    case "int":
      return isInt(v) && v >= s.min && v <= s.max ? null : bad(`${label} harus ${s.min}–${s.max} ${s.unit}.`.replace(" .", "."));
    case "rupiah":
      return isInt(v) && v >= s.min && (s.max === undefined || v <= s.max) ? null : bad(`${label} harus ${boundsText(s)}.`);
    case "bool":
      return typeof v === "boolean" ? null : bad(`${label} harus dipilih.`);
    case "enum":
      return s.of.some((o) => o.v === v) ? null : bad(`${label} harus salah satu: ${boundsText(s)}.`);
    case "time":
      return typeof v === "string" && TIME.test(v) && v >= s.min && v <= s.max ? null : bad(`${label} harus antara ${s.min} dan ${s.max}.`);
    case "text": {
      // Code points, no leading or trailing whitespace (same as setting_value_ok).
      const len = typeof v === "string" ? [...v].length : -1;
      return typeof v === "string" && !EDGE_WS.test(v) && len >= s.min && len <= s.max && (!s.pattern || new RegExp(s.pattern).test(v))
        ? null : bad(`${label} harus ${boundsText(s)}.`);
    }
    case "accent": {
      if (typeof v !== "string" || !/^#[0-9A-F]{6}$/.test(v)) return bad(`${label} harus warna hex huruf besar, contoh #0A6E86.`);
      // Rounded down to two decimals on both sides (setting_value_ok), so 4.496 fails as 4,49.
      const worst = Math.floor(accentWorstRatio(v) * 100) / 100;
      return worst >= 4.5 ? null : bad(`${label} kontrasnya ${worst.toFixed(2).replace(".", ",")}:1, perlu ≥ 4,5:1 (UI-2). Pilih warna yang lebih gelap.`);
    }
    case "obj": {
      if (typeof v !== "object" || v === null || Array.isArray(v)) return bad(`${label} tidak lengkap.`);
      const keys = Object.keys(v);
      if (keys.length !== s.f.length || !s.f.every((f) => keys.includes(f.k))) return bad(`${label} tidak sesuai bentuknya.`);
      for (const f of s.f) {
        const e = validate(f.s, v[f.k], f.l, path ? `${path}.${f.k}` : f.k);
        if (e) return e;
      }
      const label2 = (k: string) => s.f.find((f) => f.k === k)?.l ?? k;
      // Compared only when both sides are set (an "off" optional side is free), as in SQL.
      const set = (k: string) => v[k] !== null && v[k] !== undefined;
      for (const [a, b] of s.lt ?? []) if (set(a) && set(b) && !((v[a] as number | string) < (v[b] as number | string))) return bad(`${label2(a)} harus lebih kecil dari ${label2(b)}.`);
      for (const [a, b] of s.le ?? []) if (set(a) && set(b) && !((v[a] as number | string) <= (v[b] as number | string))) return bad(`${label2(a)} tidak boleh melewati ${label2(b)}.`);
      return null;
    }
    case "list": {
      if (!Array.isArray(v) || v.length < s.min || v.length > s.max) return bad(`${label} harus ${boundsText(s)}.`);
      for (let i = 0; i < v.length; i++) {
        const e = validate(s.of, v[i], label, `${path}[${i}]`);
        if (e) return e;
      }
      if (s.unique && new Set(v.map((x) => JSON.stringify(x))).size !== v.length) return bad(`${label} tidak boleh berulang.`); // lists of scalars only
      if (s.desc && v.some((x, i) => i > 0 && !((x as number) < (v[i - 1] as number)))) return bad(`${label} harus berurutan menurun.`);
      return null;
    }
    case "opt":
      return v === null ? null : validate(s.of, v, label, path);
    case "oneof": {
      if (typeof v !== "object" || v === null || Array.isArray(v)) return bad(`${label} harus ${boundsText(s)}.`);
      const c = s.of.find((o) => o.k === v.k);
      if (!c) return bad(`${label} harus ${boundsText(s)}.`);
      if (!c.s) return Object.keys(v).length === 1 ? null : bad(`${label} harus ${boundsText(s)}.`);
      if (Object.keys(v).length !== 2 || !("v" in v)) return bad(`${label} harus ${boundsText(s)}.`);
      return validate(c.s, v.v, `${label} (${c.l})`, `${path}.v`);
    }
  }
}

// Reads a value of spec s from submitted form fields named `${name}`, `${name}.field`,
// `${name}[i]`, `${name}.on` (optional), `${name}.k` (one-of). Unparseable input becomes a
// value the validator refuses (never silently a default).
// Whole numbers only: "730", or for rupiah also id-ID thousands "1.500.000". Anything else
// ("36.5", "1e3", "0x1F", "") comes back as the raw text, which the validator refuses.
export function parseWhole(x: string | null, thousands: boolean): number | string {
  const t = (x ?? "").trim();
  if (/^-?\d+$/.test(t)) return Number(t);
  if (thousands && /^-?[1-9]\d{0,2}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ""));
  return t;
}

export function fromForm(s: Spec, get: (n: string) => string | null, all: (n: string) => string[], name: string): Value {
  switch (s.t) {
    case "int": return parseWhole(get(name), false);
    case "rupiah": return parseWhole(get(name), true);
    // A checkbox sends "1" when on; the form always sends a hidden "0" first, so a missing
    // field (a tampered form) is refused rather than read as off.
    case "bool": {
      const v = all(name);
      return v.includes("1") ? true : v.includes("0") ? false : "";
    }
    case "enum": case "time": return get(name) ?? "";
    case "accent": return (get(name) ?? "").trim().toUpperCase();
    case "text": return (get(name) ?? "").trim();
    case "obj": return Object.fromEntries(s.f.map((f) => [f.k, fromForm(f.s, get, all, `${name}.${f.k}`)]));
    case "list":
      if (s.of.t === "enum") return all(name);
      return all(name).filter((x) => x.trim() !== "").map((x) => (s.of.t === "int" || s.of.t === "rupiah" ? parseWhole(x, s.of.t === "rupiah") : x));
    case "opt": return get(`${name}.on`) === "1" ? fromForm(s.of, get, all, name) : null;
    case "oneof": {
      const k = get(`${name}.k`) ?? "";
      const c = s.of.find((o) => o.k === k);
      return c?.s ? { k, v: fromForm(c.s, get, all, `${name}.v`) } : { k };
    }
  }
}
