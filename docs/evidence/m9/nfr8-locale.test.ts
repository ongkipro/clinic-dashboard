// TEST-LOC-1 — NFR-8 Localization (02-PRD NFR-8; LOC-1; UI-6): Indonesian UI, IDR integer rupiah, branch timezone labels. No database:
// reads the label sources read-only — the clinic navigation (src/components/shell/nav.ts), the settings registry
// (src/modules/settings/registry.ts) and every src/app/**/labels.ts module — and calls their formatters. Proves:
//   1. every display label is non-empty Indonesian text: no raw snake_case key, ERR_* code, undefined / NaN / null / [object …], no store
//      word (P-13 glossary), and no English UI word outside the recorded findings below;
//   2. every rupiah formatter writes id-ID integer rupiah ("Rp" + dot-grouped digits, no decimals, never "IDR" or a comma), and a formatter
//      that takes null shows a word, never Rp0 or NaN;
//   3. every date formatter writes Indonesian month and weekday names ("Agu", "Kamis"), never "Invalid Date" or English names;
//   4. every timezone label map covers exactly Asia/Jakarta, Asia/Makassar, Asia/Jayapura (the branch TIMEZONES) as WIB, WITA, WIT, and
//      branch times render in that zone;
//   5. Intl formatters in labels use "id-ID" only, except a machine date key (YYYY-MM-DD for URLs) that is not displayed.
// Recorded findings (not fixed here; owned by T-130's nav sweep): FINDINGS lists them exactly, so a new one fails this test and a fixed
// one fails it too (the list must shrink with the fix).
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { globSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NAV, ROLE_LABEL, SAYA } from "../../../src/components/shell/nav";
import { TIMEZONES } from "../../../src/modules/org/branches/branches";
import { GROUPS, SETTINGS } from "../../../src/modules/settings/registry";

const ROOT = join(__dirname, "../../..");
const LABEL_FILES = globSync("src/app/**/labels.ts", { cwd: ROOT }).sort();

// ── the rules (pure; the self-test block below proves each one rejects what it must) ─────────────────────────────────────────────
const LEAK = /undefined|NaN|\bnull\b|\[object|\bERR_[A-Z_]+|\b[a-z][a-z0-9]*_[a-z0-9_]+\b/;
const STORE = /\b(Keranjang|Checkout|Pesanan|Pembeli)\b|^Pengiriman$/i; // P-13; "pengiriman pesan" (message dispatch) is not a store word
// lazy: a denylist of English UI words (status, action and object nouns); a word outside it is not caught. Upgrade path: an allowlist of the
// clinic glossary + id-ID dictionary when the UI copy is frozen (T-130). Loanwords the glossary allows (QRIS, Lead, Check-in, Closing, DP)
// are deliberately absent.
const ENGLISH = /\b(Pending|Paid|Unpaid|Cancell?ed|Failed|Approved|Rejected|Waiting|Submitted|Completed|Expired|Inactive|Draft|Error|Success|Loading|Save|Submit|Delete|Edit|Settings|Closed|Done|Yes|None|Unknown|Invalid|Required|Optional|Search|Amount|Price|Reason|Branch|Patient|Staff|Doctor|Nurse|Consultant|Beauty|Booked|Booking confirmed|Confirmed|Arrived|Scheduled|Rescheduled|Queued|Sent|Delivered|Received|Processing|In progress|Finished|Started|Paused|Stopped|Refunded|Voided|Issued|Overdue|Due|Started|Ready|Available|Unavailable|Blocked|Locked|Archived|Deleted|Created|Updated|Assigned|Unassigned|Open|New|Cancel|Close|Back|Next|Previous|Add|Remove|Confirm|Reject|Approve)\b/i;
export function labelIssue(s: unknown): string | null {
  if (typeof s !== "string" || s.trim() === "") return "empty";
  if (LEAK.test(s)) return "leak";
  if (STORE.test(s)) return "store-word";
  if (ENGLISH.test(s)) return "english";
  return null;
}
const RUPIAH = /^[+\-−]?Rp[\u00a0 ]?\d{1,3}(\.\d{3})*$/;
export const rupiahOk = (s: unknown) => typeof s === "string" && RUPIAH.test(s);
const MONTHS_EN = /\b(Jan(uary)?|Feb(ruary)?|Mar(ch)?|Apr(il)?|May|June?|July?|Aug(ust)?|Sep(tember)?|Oct(ober)?|Nov(ember)?|Dec(ember)?|Mon(day)?|Tue(sday)?|Wed(nesday)?|Thu(rsday)?|Fri(day)?|Sat(urday)?|Sun(day)?)\b/;
export function dateIssue(s: unknown): string | null {
  if (typeof s !== "string" || s === "") return "empty";
  if (/Invalid Date|NaN|undefined/.test(s)) return "invalid";
  // "Nov", "Sep", "Feb", "Mar", "Apr", "Jan" are also Indonesian abbreviations; English-only names are the discriminators
  if (/\b(Aug(ust)?|Oct(ober)?|Dec(ember)?|May|June|July|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/.test(s) && MONTHS_EN.test(s)) return "english";
  return null;
}

// Every display label: object exports of labels.ts whose values are strings, [label, tone] tuples or { label | long }.
type Hit = { where: string; label: string };
function displayLabels(mod: Record<string, unknown>, file: string): Hit[] {
  const out: Hit[] = [];
  for (const [name, v] of Object.entries(mod)) {
    if (!v || typeof v !== "object" || Array.isArray(v) || v instanceof Set) continue;
    if (NOT_LABELS.has(`${file}#${name}`)) continue;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const lab = typeof x === "string" ? x : Array.isArray(x) && typeof x[0] === "string" ? x[0]
        : x && typeof x === "object" ? ((x as { label?: unknown }).label ?? (x as { long?: unknown }).long) : undefined;
      if (lab !== undefined) out.push({ where: `${file} ${name}.${k}`, label: String(lab) });
    }
  }
  return out;
}
// Formatters of amounts that cannot be negative (catalog prices: catalog_versions_price_check normal_price >= 0, 0054); the sign rule is
// not applied to them. Recorded so a new formatter is checked with negatives by default.
const NON_NEGATIVE = new Set(["src/app/(app)/katalog/labels.ts#rupiah"]);
// Object exports that are not display text (routes, CSS values).
const NOT_LABELS = new Set(["src/app/(app)/stok/labels.ts#HOME", "src/app/(app)/pemeriksaan/labels.ts#LAYER_COLOR"]);

// Recorded findings: HYG-LOC-1 (ac94d88c) aligned all four page label modules from "Beauty Consultant"
// to canonical "BC" (07/19). Only SET-29 ("Close-up area" photography angle option) remains tracked in settings.
const SETTINGS_FINDINGS = ["SET-29.l: Close-up area"];
const FINDINGS: string[] = [];

const load = async (f: string) => (await import(/* @vite-ignore */ join(ROOT, f))) as Record<string, unknown>;

describe("TEST-LOC-1 rules reject what they must (self-test)", () => {
  it("labels", () => {
    for (const bad of ["pending_approval", "ERR_FORBIDDEN", "Rp undefined", "NaN hari", "[object Object]", "", "  ", "Keranjang", "Checkout",
      "Pending", "Payment failed", "Save", "Beauty Consultant"]) expect(labelIssue(bad), bad).not.toBeNull();
    for (const ok of ["Menunggu persetujuan", "Status Backup", "Total", "QRIS", "VA Bank BNI", "Sejuk (8–15 °C)", "BC closing", "Tanpa persetujuan pemasaran",
      "pesan masuk antrean pengiriman"]) expect(labelIssue(ok), ok).toBeNull();
    for (const bad of ["Booked", "Confirmed", "In progress", "Overdue", "Open", "Cancel"]) expect(labelIssue(bad), bad).toBe("english");
  });
  it("rupiah and dates", () => {
    for (const ok of ["Rp1.234.567", "Rp\u00a01.234.567", "Rp0", "-Rp5.000", "−Rp5.000", "+Rp1.234.567"]) expect(rupiahOk(ok), ok).toBe(true);
    for (const bad of ["IDR 1,234,567", "Rp1,234,567", "Rp1.234.567,00", "RpNaN", "1.234.567", "Rp 1234567,5", "$5"]) expect(rupiahOk(bad), bad).toBe(false);
    for (const bad of ["Aug 17, 2026", "Thursday, 19 November", "Invalid Date", "17 Oct 2026"]) expect(dateIssue(bad), bad).not.toBeNull();
    for (const ok of ["17 Agu 2026", "Kamis, 19 November", "19 Nov 2026 10.00"]) expect(dateIssue(ok), ok).toBeNull();
  });
});

describe("TEST-LOC-1 Indonesian labels", () => {
  it("the label sources exist (the sweep is not vacuous)", () => {
    expect(LABEL_FILES.length).toBeGreaterThanOrEqual(30);
  });
  it("navigation, Saya, role names and settings groups", () => {
    const issues: string[] = [];
    for (const g of NAV) for (const s of [g.label, ...g.pages.map((p) => p.label)]) if (labelIssue(s)) issues.push(`nav: ${s}`);
    for (const p of SAYA) if (labelIssue(p.label)) issues.push(`saya: ${p.label}`);
    for (const [k, v] of Object.entries(ROLE_LABEL)) if (labelIssue(v)) issues.push(`role ${k}: ${v}`);
    for (const g of GROUPS) if (labelIssue(g.label)) issues.push(`group: ${g.label}`);
    expect(issues).toEqual([]);
  });
  it("every settings row label, note, field label, unit, option label and off text; English only where recorded", () => {
    const issues: string[] = [];
    const walk = (where: string, s: unknown): void => {
      if (!s || typeof s !== "object") return;
      const o = s as Record<string, unknown>;
      for (const key of ["l", "off", "on", "unit", "hint"]) {
        if (typeof o[key] !== "string" || (key === "unit" && o[key] === "")) continue; // a unitless count (SET-44 day of month)
        if (labelIssue(o[key])) issues.push(`${where}.${key}: ${o[key]}`);
      }
      for (const v of Object.values(o)) if (typeof v === "object") walk(where, v);
    };
    for (const r of SETTINGS) {
      for (const [k, v] of [["label", r.label], ["note", r.note]] as const) if (v !== undefined && labelIssue(v)) issues.push(`${r.key} ${k}: ${v}`);
      if (r.kind === "value") walk(r.key, r.spec);
      else for (const v of [r.defaultText, r.boundsText]) if (labelIssue(v)) issues.push(`${r.key}: ${v}`);
    }
    expect(issues.sort()).toEqual(SETTINGS_FINDINGS);
  });
  it("every labels.ts display value; English only where recorded (FINDINGS)", async () => {
    const issues: string[] = [];
    let count = 0;
    for (const f of LABEL_FILES) {
      for (const h of displayLabels(await load(f), f)) {
        count++;
        const why = labelIssue(h.label);
        if (why) issues.push(`${h.where}: ${h.label}`);
      }
    }
    expect(count).toBeGreaterThan(500);
    expect(issues.sort()).toEqual(FINDINGS);
  });
});

describe("TEST-LOC-1 rupiah, dates and timezones", () => {
  it("every rp / rupiah formatter writes id-ID integer rupiah; null shows a word, never Rp0", async () => {
    let n = 0;
    for (const f of LABEL_FILES) {
      const m = await load(f);
      const src = readFileSync(join(ROOT, f), "utf8");
      for (const name of ["rp", "rupiah"]) {
        const fn = m[name];
        if (typeof fn !== "function") continue;
        n++;
        const values = NON_NEGATIVE.has(`${f}#${name}`) ? [1_234_567, 0, 999] : [1_234_567, 0, -5_000, 999];
        for (const v of values) expect(rupiahOk(fn(v)), `${f} ${name}(${v}) = ${fn(v)}`).toBe(true);
        if (new RegExp(`export (const|function) ${name}\\b[^\\n]*null`).test(src)) {
          for (const v of [null, undefined]) {
            const s = String(fn(v));
            expect(s, `${f} ${name}(${v})`).not.toMatch(/Rp\s?0$|NaN|undefined|null/);
          }
        }
      }
    }
    expect(n).toBeGreaterThanOrEqual(10);
  });
  it("every date formatter writes Indonesian names", async () => {
    const at = "2026-08-17T03:00:00Z"; // Monday 17 August: English "Aug" / "Monday" vs Indonesian "Agu" / "Senin"
    let n = 0;
    for (const f of LABEL_FILES) {
      const m = await load(f);
      for (const name of ["day", "date", "when", "dayLabel", "at"]) {
        const fn = m[name];
        if (typeof fn !== "function") continue;
        // the argument the source declares: a Date, a calendar day (the body appends "T00:00:00Z") or an ISO instant
        const decl = readFileSync(join(ROOT, f), "utf8").split("\n").find((l) => new RegExp(`export const ${name} = `).test(l)) ?? "";
        const arg = /^\S+ const \w+ = \(\w+: Date/.test(decl) ? new Date(at) : /T00:00:00Z`/.test(decl) && !/slice\(0, 10\)/.test(decl) ? at.slice(0, 10) : at;
        const out: unknown = fn(arg);
        n++;
        expect(dateIssue(out), `${f} ${name} → ${String(out)}`).toBeNull();
        expect(String(out), `${f} ${name}`).toMatch(/Agu|Agustus|Senin|17\/08|17\.08/);
      }
    }
    expect(n).toBeGreaterThanOrEqual(15);
  });
  it("timezone labels cover exactly the branch zones as WIB / WITA / WIT; times render in the branch zone", async () => {
    const expected = { "Asia/Jakarta": "WIB", "Asia/Makassar": "WITA", "Asia/Jayapura": "WIT" };
    expect([...TIMEZONES].sort()).toEqual(Object.keys(expected).sort());
    let maps = 0;
    for (const f of LABEL_FILES) {
      const m = await load(f);
      if (m.ZONE) { maps++; expect(m.ZONE, f).toEqual(expected); }
      if (m.TZ_LABEL) {
        maps++;
        const tz = m.TZ_LABEL as Record<string, string>;
        expect(Object.keys(tz).sort(), f).toEqual(Object.keys(expected).sort());
        for (const [k, v] of Object.entries(expected)) expect(tz[k].startsWith(v), `${f} ${k}`).toBe(true);
      }
      if (typeof m.time === "function" && m.ZONE) {
        const t = m.time as (d: Date, tz: string) => string;
        const d = new Date("2026-11-19T03:00:00Z");
        expect([t(d, "Asia/Jakarta"), t(d, "Asia/Makassar"), t(d, "Asia/Jayapura")], f).toEqual(["10.00", "11.00", "12.00"]);
      }
    }
    expect(maps).toBeGreaterThanOrEqual(4);
  });
  it("Intl formatters in labels use id-ID; the one machine date key (en-CA → YYYY-MM-DD) is not a display string", async () => {
    const other: string[] = [];
    for (const f of LABEL_FILES) {
      for (const mm of readFileSync(join(ROOT, f), "utf8").matchAll(/new Intl\.(NumberFormat|DateTimeFormat)\(\s*"([^"]+)"/g)) {
        if (mm[2] !== "id-ID") other.push(`${relative(ROOT, join(ROOT, f))}: ${mm[2]}`);
      }
    }
    expect(other).toEqual(["src/app/(app)/jadwal/labels.ts: en-CA"]);
    const { localDate } = (await load("src/app/(app)/jadwal/labels.ts")) as { localDate: (d: Date, tz: string) => string };
    expect(localDate(new Date("2026-11-19T20:00:00Z"), "Asia/Jayapura")).toBe("2026-11-20"); // a URL key, branch-local day
  });
});
