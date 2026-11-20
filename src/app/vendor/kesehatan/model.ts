// Konsol Vendor › Kesehatan Platform, pure (UX-45, PR-62, OBS-2–OBS-4; T-118, Panel 2 D1 = Option A). The reader vendor_console_health
// (SQL-DRAFT.sql) returns aggregates only; projectHealth keeps an explicit allowlist of keys so a reader that returned more (patient ids,
// contacts, payloads, provider bodies, amounts, order refs) renders none of it (PR-60, PR-62 "error codes and counts only"). Error codes
// pass a strict pattern or become "lainnya". Uptime, worker heartbeat, backup age and the app error rate have no source yet: they are
// "not_measured" and render "Belum terpantau" — never a fake 0 or 100 %. OBS-4 thresholds are constants here (class F, not settings).
// No database, no Next.js: tests/vendor/health.test.ts runs this module.

export const HEALTH_ROLES = ["platform_owner", "support"] as const;
export const ROUTE = "/vendor/kesehatan";

// OBS-4 alert thresholds.
export const OBS4 = { backlogSeconds: 15 * 60, satusehatFailureRate: 0.05, heartbeatSeconds: 5 * 60, backupHours: 26 } as const;

export const PROVIDERS = ["outbox", "whatsapp", "satusehat", "payment_webhook", "meta_webhook"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const PROVIDER_LABEL: Record<Provider, string> = {
  outbox: "Antrean event", whatsapp: "WhatsApp keluar", satusehat: "SATUSEHAT", payment_webhook: "Webhook pembayaran", meta_webhook: "Webhook Meta",
};

export const NOT_MEASURED = ["uptime", "worker_heartbeat", "backup_age", "error_rate"] as const;
export type NotMeasuredKey = (typeof NOT_MEASURED)[number];
export const NOT_MEASURED_COPY: Record<NotMeasuredKey, { label: string; why: string }> = {
  uptime: { label: "Uptime", why: "Pemeriksaan uptime belum dipasang" },
  worker_heartbeat: { label: "Detak worker", why: "Proses worker belum berjalan" },
  backup_age: { label: "Umur backup", why: "Catatan backup belum tersedia" },
  error_rate: { label: "Tingkat error aplikasi", why: "Penghitung error aplikasi belum ada" },
};

const CODE = /^[A-Za-z][A-Za-z0-9_.]{1,48}$/;
export const OTHER = "lainnya";
export const safeCode = (v: unknown): string => (typeof v === "string" && CODE.test(v) ? v : OTHER);

// Metric values: a count, a duration in seconds, an instant, or not measured. An unknown or malformed value is "invalid", never 0.
export type Count = { kind: "count"; value: number } | { kind: "none" };
const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);
const cnt = (v: unknown): Count => (int(v) === null ? { kind: "none" } : { kind: "count", value: int(v)! });
const iso = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

export type ProviderRow = {
  provider: Provider;
  open: Count; // queued / received-unprocessed
  oldestSeconds: number | null; // age of the oldest open item
  failed1h: Count;
  failed24h: Count;
  attempts1h: Count; // denominator of the SATUSEHAT failure rate
  deadLetter: Count; // outbox only (r2): exhausted receipts NOW — a stock, not a 24-hour flow; "none" for the other providers
  codes: { code: string; count: number }[]; // top error / hold / deferral codes
  lastActivity: string | null; // ISO; the worker-activity proxy
};
export type TenantHealth = { id: string; name: string | null; state: string; providers: ProviderRow[] };
export type Health = {
  at: string;
  tenants: TenantHealth[];
  platform: { unrouted: Count; walArchivedAt: string | null; walFailedAt: string | null; walReadable: boolean };
  notMeasured: NotMeasuredKey[];
};
export type Projection = { kind: "ok"; health: Health } | { kind: "invalid" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATES = new Set(["provisioning", "onboarding", "live", "suspended", "exit", "closed"]);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function codes(v: unknown): { code: string; count: number }[] {
  if (!Array.isArray(v)) return [];
  const merged = new Map<string, number>();
  for (const x of v) {
    const o = obj(x);
    const n = int(o.count);
    if (n === null || n === 0) continue;
    const c = safeCode(o.code);
    merged.set(c, (merged.get(c) ?? 0) + n);
  }
  return [...merged.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)).slice(0, 5);
}

function provider(p: Provider, v: unknown): ProviderRow {
  const o = obj(v);
  const oldest = int(o.oldest_seconds);
  return { provider: p, open: cnt(o.open), oldestSeconds: oldest, failed1h: cnt(o.failed_1h), failed24h: cnt(o.failed_24h), attempts1h: cnt(o.attempts_1h),
    deadLetter: cnt(o.dead_letter), codes: codes(o.codes), lastActivity: iso(o.last_activity) };
}

// Allowlist projection. Reads exactly: at; tenants[].{id, name, state, providers.<PROVIDERS>.{open, oldest_seconds, failed_1h, failed_24h,
// attempts_1h, dead_letter, codes[].{code, count}, last_activity}}; platform.{unrouted, wal_archived_at, wal_failed_at, wal_readable}; not_measured.
export function projectHealth(raw: unknown): Projection {
  const r = obj(raw);
  const at = iso(r.at);
  if (!at || !Array.isArray(r.tenants)) return { kind: "invalid" };
  const tenants: TenantHealth[] = [];
  for (const t of r.tenants) {
    const o = obj(t);
    if (typeof o.id !== "string" || !UUID.test(o.id) || typeof o.state !== "string" || !STATES.has(o.state)) return { kind: "invalid" };
    const name = typeof o.name === "string" && o.name.trim() !== "" ? o.name.slice(0, 120) : null;
    const ps = obj(o.providers);
    tenants.push({ id: o.id, name, state: o.state, providers: PROVIDERS.map((p) => provider(p, ps[p])) });
  }
  const pl = obj(r.platform);
  const nm = Array.isArray(r.not_measured) ? r.not_measured.filter((x): x is NotMeasuredKey => (NOT_MEASURED as readonly unknown[]).includes(x)) : [];
  return {
    kind: "ok",
    health: {
      at, tenants: tenants.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "id") || a.id.localeCompare(b.id)),
      platform: { unrouted: cnt(pl.unrouted), walArchivedAt: iso(pl.wal_archived_at), walFailedAt: iso(pl.wal_failed_at), walReadable: pl.wal_readable === true },
      // Option A: the four sources that do not exist are always reported as not measured, whatever the reader says.
      notMeasured: [...new Set<NotMeasuredKey>([...NOT_MEASURED, ...nm])],
    },
  };
}

// ── OBS-4 status per provider row ─────────────────────────────────────────────────────────────────────────────────────────────
export type Tone = "ok" | "warning" | "alert" | "none";
export type Status = { tone: Tone; reasons: string[] };
export function failureRate(row: ProviderRow): number | null {
  if (row.attempts1h.kind !== "count" || row.attempts1h.value === 0 || row.failed1h.kind !== "count") return null;
  return row.failed1h.value / row.attempts1h.value;
}
export function statusOf(row: ProviderRow): Status {
  const reasons: string[] = [];
  if (row.oldestSeconds !== null && row.oldestSeconds > OBS4.backlogSeconds) reasons.push(`Antrean tertua ${duration(row.oldestSeconds)} (> 15 menit)`);
  const rate = failureRate(row);
  if (row.provider === "satusehat" && rate !== null && rate > OBS4.satusehatFailureRate) reasons.push(`Gagal ${percent(rate)} dalam 1 jam (> 5%)`);
  // the dead-letter stock is always named, also beside an alert (an old exhausted receipt is usually also the oldest open one)
  const dead = row.deadLetter.kind === "count" && row.deadLetter.value > 0 ? [`${row.deadLetter.value} habis percobaan (surat mati)`] : [];
  if (reasons.length) return { tone: "alert", reasons: [...reasons, ...dead] };
  const warn = [...dead];
  if (row.failed24h.kind === "count" && row.failed24h.value > 0) warn.push(`${row.failed24h.value} gagal dalam 24 jam`);
  if (warn.length) return { tone: "warning", reasons: warn };
  if (row.open.kind === "none" && row.failed24h.kind === "none") return { tone: "none", reasons: [] };
  return { tone: "ok", reasons: [] };
}
export const needsAttention = (t: TenantHealth) => t.providers.some((p) => statusOf(p).tone === "alert" || statusOf(p).tone === "warning");

// ── formatting ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const nf = new Intl.NumberFormat("id-ID");
const pf = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });
export const percent = (r: number) => `${pf.format(r * 100)}%`;
export const showCount = (c: Count) => (c.kind === "count" ? nf.format(c.value) : "—");
// r2 (review 1d2a370d #2): the outbox records no failure time, so its 1-hour and 24-hour failure counts are not measured — said so, not "—".
export const UNMEASURED_FAILURES: readonly Provider[] = ["outbox"];
export const showFailed = (p: Provider, c: Count) => (UNMEASURED_FAILURES.includes(p) ? "Tidak diukur" : showCount(c));
export function duration(s: number): string {
  if (s < 60) return `${s} detik`;
  if (s < 3600) return `${Math.floor(s / 60)} menit`;
  if (s < 86_400) return `${Math.floor(s / 3600)} jam ${Math.floor((s % 3600) / 60)} menit`;
  return `${Math.floor(s / 86_400)} hari`;
}
const at = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });
export const when = (iso: string | null) => (iso ? `${at.format(new Date(iso))} WIB` : "Belum ada");

// ── filters and page state ──────────────────────────────────────────────────────────────────────────────────────────────────
export type Filter = { provider: Provider | null; attention: boolean };
export function parseFilter(q: { penyedia?: unknown; perlu?: unknown }): Filter {
  const p = typeof q.penyedia === "string" && (PROVIDERS as readonly string[]).includes(q.penyedia) ? (q.penyedia as Provider) : null;
  return { provider: p, attention: q.perlu === "1" };
}
export function filterHref(f: Filter): string {
  const qs = new URLSearchParams({ ...(f.provider ? { penyedia: f.provider } : {}), ...(f.attention ? { perlu: "1" } : {}) }).toString();
  return qs ? `${ROUTE}?${qs}` : ROUTE;
}
export function visible(h: Health, f: Filter): TenantHealth[] {
  return h.tenants
    .map((t) => ({ ...t, providers: f.provider ? t.providers.filter((p) => p.provider === f.provider) : t.providers }))
    .filter((t) => !f.attention || needsAttention(t));
}
export type ViewState =
  | { kind: "permission" } | { kind: "error" } | { kind: "empty"; health: Health }
  | { kind: "filtered-empty"; health: Health; filter: Filter } | { kind: "ok"; health: Health; filter: Filter; rows: TenantHealth[] };
export function resolveView(i: { allowed: boolean; read: { ok: true; raw: unknown } | { ok: false } ; filter: Filter }): ViewState {
  if (!i.allowed) return { kind: "permission" };
  if (!i.read.ok) return { kind: "error" };
  const p = projectHealth(i.read.raw);
  if (p.kind === "invalid") return { kind: "error" };
  if (p.health.tenants.length === 0) return { kind: "empty", health: p.health };
  const rows = visible(p.health, i.filter);
  if (rows.length === 0) return { kind: "filtered-empty", health: p.health, filter: i.filter };
  return { kind: "ok", health: p.health, filter: i.filter, rows };
}
