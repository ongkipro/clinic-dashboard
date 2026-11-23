// Owner daily digest (PR-80, P-18; Scenario PR-80: opted in → when the day closes, K1, K2 and exception counts, no patient names).
// Pure: no database, no provider. Two steps, because outbox payloads carry ids only and provider bodies are built at send time
// (AGENTS.md):
//   planDigest   — at the SET-37 time: opted in? due? → one queue item per channel with its idempotency key (tenant, day, channel);
//   composeDigest — at send time: the aggregate facts → the WhatsApp template parameters / email subject and text.
// Opt-in is SET-37 (`ringkasan`: "HH:MM" 17:00–23:00, null = Nonaktif — the default; `penerima`: roles). No new setting.
// Privacy (PR-80 "aggregates only", AGENTS.md "no clinical content in … WhatsApp messages or dashboards"): the composer reads only the
// allowlisted fields below (anything else an upstream reader adds is never read). The email body is a typed payload: lines of free-text parts
// and numeric FIGURES (integer rupiah, counts) kept structurally apart; only the trusted renderer turns a figure into text. A runtime guard
// scans the rendered body (no masking) and refuses the digest if it carries a medical-record number, phone number, NIK, e-mail address or a
// URL anywhere except wholly inside one figure — so a valid figure such as Rp1.081.234.567 is never read as a phone number, and
// currency-shaped free text such as "Rp62.812.999.000" is never trusted as a figure. Exceptions are counts.
// A value the reader cannot give is "Belum tersedia", never Rp0; a total over branches is unavailable when any branch is, or when the sum
// leaves the exact integer range (never a rounded number).

// Owner decision 2026-11-23 (D1 confirmed): email is the digest channel; in-app is allowed later, not required for Done. Staff WhatsApp
// stays a named, GATED channel (WABA template + staff phone + owner decision) outside this constant: it can be composed, never planned.
export const CHANNELS = ["email"] as const;
export const GATED_CHANNELS = ["whatsapp"] as const;
export type Channel = (typeof CHANNELS)[number] | (typeof GATED_CHANNELS)[number];
export const RECIPIENT_ROLES = ["owner", "admin_pusat", "finance", "manager"] as const; // SET-37 `penerima` options
export type RecipientRole = (typeof RECIPIENT_ROLES)[number];

// UX-20 "Perlu ditangani": the six Ringkasan Owner items (T-109 attention.ts; owner decision 2026-11-23), as counts, with the same
// meaning: compliance counts only evidence already EXPIRED (no "expiring soon" window exists in the spec); unpaid visits are open visits
// checked in before the branch's business date whose payment is in progress or blocked.
export const EXCEPTIONS = [
  { key: "approvals", label: "Persetujuan menunggu" },
  { key: "unpaid_visits", label: "Kunjungan belum bayar sebelum hari ini" },
  { key: "low_stock", label: "Stok klinis menipis" },
  { key: "leads_overdue", label: "Lead melewati batas respons" },
  { key: "satusehat_errors", label: "Kiriman SATUSEHAT gagal" },
  { key: "compliance_expired", label: "Bukti kepatuhan sudah kedaluwarsa" },
] as const;
export type ExceptionKey = (typeof EXCEPTIONS)[number]["key"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// ── opt-in (SET-37) ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export type Set37 = { ringkasan: string | null; penerima: RecipientRole[] };
export type OptIn = { kind: "in"; at: string; recipients: RecipientRole[] } | { kind: "out" } | { kind: "invalid" };
export function optIn(v: unknown): OptIn {
  if (!v || typeof v !== "object") return { kind: "invalid" };
  const { ringkasan, penerima } = v as Record<string, unknown>;
  if (ringkasan === null) return { kind: "out" }; // Nonaktif (default)
  if (typeof ringkasan !== "string" || !TIME.test(ringkasan) || ringkasan < "17:00" || ringkasan > "23:00") return { kind: "invalid" };
  if (!Array.isArray(penerima) || penerima.length < 1 || penerima.length > 4 || new Set(penerima).size !== penerima.length
    || !penerima.every((r) => (RECIPIENT_ROLES as readonly unknown[]).includes(r))) return { kind: "invalid" };
  return { kind: "in", at: ringkasan, recipients: penerima as RecipientRole[] };
}

// Idempotency key per (tenant, business day, channel): a re-run of the scheduler never queues a second digest for that day.
export function digestKey(tenantId: string, businessDate: string, channel: Channel): string {
  if (!UUID.test(tenantId) || !DATE.test(businessDate) || ![...CHANNELS, ...GATED_CHANNELS].includes(channel)) throw new RangeError("invalid digest key part");
  return `digest:${tenantId.toLowerCase()}:${businessDate}:${channel}`; // ≤ 128, [A-Za-z0-9_.:-] (command_key pattern)
}

// ── plan (scheduler) ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// `localNow` is the tenant's local date and time ("YYYY-MM-DDTHH:MM"); the day closes at the SET-37 time.
export type QueueItem = { key: string; tenantId: string; businessDate: string; channel: Channel; recipients: RecipientRole[] }; // ids only
export type Plan = { kind: "skip"; reason: "opted_out" | "invalid_setting" | "not_due" } | { kind: "queue"; items: QueueItem[] };
export function planDigest(i: { tenantId: string; setting: unknown; localNow: string; channels: readonly Channel[] }): Plan {
  const o = optIn(i.setting);
  if (o.kind === "out") return { kind: "skip", reason: "opted_out" };
  if (o.kind === "invalid") return { kind: "skip", reason: "invalid_setting" };
  const [day, time] = i.localNow.split("T");
  if (!DATE.test(day ?? "") || !TIME.test((time ?? "").slice(0, 5))) throw new RangeError("localNow must be YYYY-MM-DDTHH:MM");
  if (time.slice(0, 5) < o.at) return { kind: "skip", reason: "not_due" };
  const channels = [...new Set(i.channels)].filter((c) => (CHANNELS as readonly string[]).includes(c)); // a gated channel is never queued
  return { kind: "queue", items: channels.map((channel) => ({ key: digestKey(i.tenantId, day, channel), tenantId: i.tenantId, businessDate: day, channel, recipients: o.recipients })) };
}

// ── slice A (pure, channel-neutral): the day close at the SET-37 time in the tenant's day basis, live tenants only, one run key per day ──
// Panel 2 D2: the tenant's day is its primary branch's local day — the earliest-created branch (ties by id; the same basis as
// tax_local_date's tenant fallback), else Asia/Jakarta. Branches have no active/closed state on disk (DATA-11), so every branch counts.
// The clock is injected (`now`): the business date and the time of day come from the branch zone, never from the process timezone.
// Panel 2 D3: only `live` tenants get a digest.
const ZONES = ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"] as const; // the branches_timezone_check values (DATA-11)
export type Zone = (typeof ZONES)[number];
export type BranchClock = { id: string; timezone: string; createdAt: string };
export function primaryZone(branches: readonly BranchClock[]): Zone {
  const first = [...branches].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
  if (!first) return "Asia/Jakarta";
  if (!(ZONES as readonly string[]).includes(first.timezone) || Number.isNaN(Date.parse(first.createdAt))) throw new RangeError("invalid branch clock");
  return first.timezone as Zone;
}
// The local date and minute of an instant in a zone (Intl with an explicit timeZone; independent of the process timezone).
export function localClock(now: Date, zone: Zone): { date: string; time: string } {
  if (Number.isNaN(now.getTime())) throw new RangeError("invalid instant");
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
export const eligible = (lifecycleState: unknown) => lifecycleState === "live";
// One run per tenant per local business day, whatever channels are later chosen (command_key pattern).
export function runKey(tenantId: string, businessDate: string): string {
  if (!UUID.test(tenantId) || !DATE.test(businessDate) || new Date(`${businessDate}T00:00:00Z`).toISOString().slice(0, 10) !== businessDate) throw new RangeError("invalid run key part");
  return `digest-run:${tenantId.toLowerCase()}:${businessDate}`;
}
export type DayClose =
  | { kind: "skip"; reason: "tenant_not_live" | "opted_out" | "invalid_setting" | "not_due" }
  | { kind: "due"; runKey: string; tenantId: string; businessDate: string; zone: Zone; recipients: RecipientRole[] };
export function dayClose(i: { tenantId: string; lifecycleState: unknown; setting: unknown; branches: readonly BranchClock[]; now: Date }): DayClose {
  if (!eligible(i.lifecycleState)) return { kind: "skip", reason: "tenant_not_live" };
  const o = optIn(i.setting);
  if (o.kind === "out") return { kind: "skip", reason: "opted_out" };
  if (o.kind === "invalid") return { kind: "skip", reason: "invalid_setting" };
  const zone = primaryZone(i.branches);
  const { date, time } = localClock(i.now, zone);
  if (time < o.at) return { kind: "skip", reason: "not_due" };
  return { kind: "due", runKey: runKey(i.tenantId, date), tenantId: i.tenantId, businessDate: date, zone, recipients: o.recipients };
}

// ── compose (send time) ──────────────────────────────────────────────────────────────────────────────────────────────────────
export type Amount = { kind: "money"; rupiah: number } | { kind: "unavailable" };
export type Count = { kind: "count"; value: number } | { kind: "unavailable" };
export type BranchFigures = { name: string; k1: Amount; k2: Amount };
export type DigestFacts = { clinic: string; businessDate: string; branches: BranchFigures[]; exceptions: Record<ExceptionKey, Count> };

const money = (v: unknown): Amount => (typeof v === "number" && Number.isSafeInteger(v) ? { kind: "money", rupiah: v } : { kind: "unavailable" });
const cnt = (v: unknown): Count => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? { kind: "count", value: v } : { kind: "unavailable" });
const label = (v: unknown, max: number) => (typeof v === "string" && v.trim() !== "" ? v.trim().replace(/\s+/g, " ").slice(0, max) : null);

// Allowlist projection of the reader result. Reads exactly: clinic, branches[].name/.k1_rupiah/.k2_rupiah, exceptions.<EXCEPTIONS key>.
export function projectFacts(raw: unknown, businessDate: string): DigestFacts | null {
  if (!raw || typeof raw !== "object" || !DATE.test(businessDate)) return null;
  const r = raw as Record<string, unknown>;
  const clinic = label(r.clinic, 60); // SET-1 clinic name ≤ 60
  if (!clinic || !Array.isArray(r.branches)) return null;
  const branches: BranchFigures[] = [];
  for (const b of r.branches) {
    const o = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
    const name = label(o.name, 80);
    if (!name) return null;
    branches.push({ name, k1: money(o.k1_rupiah), k2: money(o.k2_rupiah) });
  }
  const ex = (r.exceptions && typeof r.exceptions === "object" ? r.exceptions : {}) as Record<string, unknown>;
  const exceptions = Object.fromEntries(EXCEPTIONS.map((e) => [e.key, cnt(ex[e.key])])) as Record<ExceptionKey, Count>;
  return { clinic, businessDate, branches, exceptions };
}

const nf = new Intl.NumberFormat("id-ID");
const df = new Intl.DateTimeFormat("id-ID", { dateStyle: "full", timeZone: "UTC" });
export const UNAVAILABLE = "Belum tersedia";
export const rupiah = (a: Amount) => (a.kind === "money" ? `${a.rupiah < 0 ? "−" : ""}Rp${nf.format(Math.abs(a.rupiah))}` : UNAVAILABLE);
// Exact over integers: the sum is computed in BigInt and is unavailable when it is not a safe integer (it would have been rounded).
export function total(xs: readonly Amount[]): Amount {
  if (xs.length === 0 || xs.some((x) => x.kind === "unavailable")) return { kind: "unavailable" };
  const sum = xs.reduce((s, x) => s + BigInt((x as { rupiah: number }).rupiah), BigInt(0));
  return sum <= BigInt(Number.MAX_SAFE_INTEGER) && sum >= BigInt(Number.MIN_SAFE_INTEGER) ? { kind: "money", rupiah: Number(sum) } : { kind: "unavailable" };
}

// Runtime guard: identifiers that must never leave in a digest (the subject as is; the body via renderedIdentifier).
const FORBIDDEN: { name: string; re: RegExp }[] = [
  { name: "mrn", re: /\bRM-\d{6,}\b/i },
  { name: "phone", re: /(?:\+?62|\b0)[\s.-]?8\d(?:[\s.-]?\d){6,11}\b/ },
  { name: "nik", re: /\b\d{16}\b/ },
  { name: "email", re: /[^\s@]+@[^\s@]+\.[a-z]{2,}/i },
  { name: "url", re: /\bhttps?:\/\/|\bwww\./i },
];
export function guard(strings: readonly string[]): { ok: true } | { ok: false; found: string } {
  for (const s of strings) for (const f of FORBIDDEN) if (f.re.test(s)) return { ok: false, found: f.name };
  return { ok: true };
}
// ── the typed body: free text and figures never share a string ──
export type Figure = { money: Amount } | { count: Count };
export type Part = string | Figure;
export type Line = readonly Part[];
const showCount = (c: Count) => (c.kind === "count" ? nf.format(c.value) : UNAVAILABLE);
// A figure as the renderer accepts it: exactly the Amount / Count shapes, integers only (anything else is not a figure).
export function isFigure(x: unknown): x is Figure {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== 1) return false;
  const v = (o.money ?? o.count) as Record<string, unknown> | undefined;
  if (!v || typeof v !== "object") return false;
  if (v.kind === "unavailable") return Object.keys(v).length === 1;
  if (keys[0] === "money") return v.kind === "money" && Object.keys(v).length === 2 && Number.isSafeInteger(v.rupiah);
  return v.kind === "count" && Object.keys(v).length === 2 && Number.isSafeInteger(v.value) && (v.value as number) >= 0;
}
export const renderPart = (p: Part) => (typeof p === "string" ? p : "money" in p ? rupiah(p.money) : showCount(p.count));
export const renderLines = (lines: readonly Line[]) => lines.map((l) => l.map(renderPart).join("")).join("\n");
// The body exactly as delivered, with the [start, end) span of every figure in it (R3-r5 finding 1).
export function renderWithSpans(lines: readonly Line[]): { text: string; spans: [number, number][] } {
  let text = "";
  const spans: [number, number][] = [];
  lines.forEach((l, i) => {
    if (i > 0) text += "\n";
    for (const p of l) {
      const r = renderPart(p);
      if (typeof p !== "string") spans.push([text.length, text.length + r.length]);
      text += r;
    }
  });
  return { text, spans };
}
// Every forbidden-identifier pattern runs over the FULL rendered text, from every start position (overlapping candidates included). A match
// is exempt only if it lies WHOLLY inside a single figure span (a typed number the renderer produced, e.g. Rp1.081.234.567); a match that
// touches free text — an identifier split across parts, or assembled across a figure such as "Hubungi " + 123 + "@example.test" — is
// refused. Free text is never masked; no layout rule is needed.
export function renderedIdentifier(text: string, spans: readonly [number, number][]): string | null {
  for (const f of FORBIDDEN) {
    const re = new RegExp(f.re.source, f.re.flags.replace("g", "") + "g");
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const [s0, e0] = [m.index, m.index + m[0].length];
      if (!spans.some(([a, b]) => a <= s0 && e0 <= b)) return f.name;
      re.lastIndex = m.index + 1; // exempt: keep looking for a later or overlapping match
    }
  }
  return null;
}
// The body check the composer and the port share: every line is parts of free text or figures (anything else is an invalid body); the subject
// and the rendered body are scanned as above.
export function bodyProblem(subject: unknown, lines: unknown): "invalid_body" | "identifier_found" | null {
  if (typeof subject !== "string" || !Array.isArray(lines) || lines.length > 200) return "invalid_body";
  for (const l of lines) if (!Array.isArray(l) || !l.every((p) => typeof p === "string" || isFigure(p))) return "invalid_body";
  const { text, spans } = renderWithSpans(lines as Line[]);
  return guard([subject]).ok && renderedIdentifier(text, spans) === null ? null : "identifier_found";
}

export type Composed =
  | { kind: "ok"; channel: Channel; whatsapp?: { params: string[] }; email?: { subject: string; lines: Line[] }; text: string }
  | { kind: "refused"; reason: "invalid_facts" | "identifier_found"; found?: string };

// WhatsApp: a utility template with 5 parameters (clinic, date, K1, K2, exception total) — the template text itself is reviewed for
// WABA (R-02); the long text is the email body and the in-app preview.
export function composeDigest(item: Pick<QueueItem, "channel" | "businessDate">, raw: unknown): Composed {
  const f = projectFacts(raw, item.businessDate);
  if (!f) return { kind: "refused", reason: "invalid_facts" };
  const day = df.format(new Date(`${f.businessDate}T00:00:00Z`));
  const k1 = total(f.branches.map((b) => b.k1)), k2 = total(f.branches.map((b) => b.k2));
  const exAll = f.exceptions;
  const exTotal: Count = Object.values(exAll).some((c) => c.kind === "unavailable") ? { kind: "unavailable" }
    : { kind: "count", value: Object.values(exAll).reduce((s, c) => s + (c as { value: number }).value, 0) };
  const lines: Line[] = [
    [`Ringkasan harian ${f.clinic} — ${day}`],
    [],
    ["Uang masuk (K1): ", { money: k1 }],
    ["Layanan selesai (K2): ", { money: k2 }],
    ...(f.branches.length > 1 ? [[], ["Per cabang:"], ...f.branches.map((b): Line => [`• ${b.name}: uang masuk `, { money: b.k1 }, ", layanan selesai ", { money: b.k2 }])] : []),
    [],
    ["Perlu ditangani: ", { count: exTotal }],
    ...EXCEPTIONS.filter((e) => exAll[e.key].kind === "unavailable" || (exAll[e.key] as { value: number }).value > 0)
      .map((e): Line => [`• ${e.label}: `, { count: exAll[e.key] }]),
    [],
    ["Angka gabungan tanpa data pasien. Rincian ada di Ringkasan Owner."],
  ];
  const text = renderLines(lines);
  const params = [f.clinic, day, rupiah(k1), rupiah(k2), showCount(exTotal)];
  const subject = `Ringkasan harian ${f.clinic} — ${day}`;
  // the subject, then the body as rendered: a forbidden match is exempt only wholly inside one figure
  const { spans } = renderWithSpans(lines);
  const g = guard([subject]);
  const found = g.ok ? renderedIdentifier(text, spans) : g.found;
  if (found) return { kind: "refused", reason: "identifier_found", found };
  return item.channel === "whatsapp" ? { kind: "ok", channel: "whatsapp", whatsapp: { params }, text } : { kind: "ok", channel: "email", email: { subject, lines }, text };
}
