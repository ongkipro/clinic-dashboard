// Ringkasan Keuangan (UX-22 ▸ Ringkasan, PR-33f; T-114): the page-data core. It reads the period through readFinanceSummary (existing granted
// readers with their own authority: dashboard_kpi k1/k4/k17, subledger_rollforward, commission / payables / shift readers) and composes the
// props of the presentational FinanceSummary. No `server-only`: data.ts gates the role first; this core is what the isolation case runs.
// Page roles: the nav row "/keuangan/ringkasan" (F O; 19:37 Finance, 19:177 Finance + owner). Settlement gateway tertunda stays UNAVAILABLE
// ("Settlement dari penyedia pembayaran belum dicatat", slice 3) until a settlement fact exists (G-SETTLE). Periods are local days ≤ 366 days.
import type pg from "pg";
import type { Role } from "../../../../auth/policy";
import { NAV } from "../../../../components/shell/nav";
import { CommandError } from "../../../../lib/command";
import { isCalendarDate } from "../../../../modules/accounting/ledger/ledger";
import type { FinanceSummaryProps } from "./model";
import { HREF, readFinanceSummary } from "./reader";

export const PATH = "/keuangan/ringkasan";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const READ_FAILED = "Ringkasan keuangan belum bisa dibaca. Tidak ada yang berubah.";
// The page roles are the nav row of PATH (one source; no new authority).
export function readers(): readonly Role[] {
  return NAV.flatMap((g) => g.pages).find((p) => p.href === PATH)?.roles ?? [];
}

export type Query = { dari?: string; sampai?: string; cabang?: string };
export type Filters = { from: string; to: string; branch: string | null };
export type FinancePage = { kind: "not-found" } | { kind: "ok"; props: FinanceSummaryProps };

const today = (now: Date) => now.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
// ?dari / ?sampai when both are calendar days, in order and ≤ 366 days apart (the readers' bound), else this month to today (Asia/Jakarta).
// A malformed ?cabang is ignored (consolidated); a well-formed one is asked of the readers, which answer not-found when it is not the caller's.
export function filters(q: Query, now: Date = new Date()): Filters {
  const t = today(now);
  const month = { from: `${t.slice(0, 8)}01`, to: t };
  const ok = !!q.dari && !!q.sampai && isCalendarDate(q.dari) && isCalendarDate(q.sampai) && q.sampai >= q.dari
    && (Date.parse(q.sampai) - Date.parse(q.dari)) / 86_400_000 <= 366;
  return { ...(ok ? { from: q.dari!, to: q.sampai! } : month), branch: q.cabang && UUID.test(q.cabang) ? q.cabang : null };
}
const fmt = (iso: string) => new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
export const periodLabel = (f: Pick<Filters, "from" | "to">) => (f.from === f.to ? fmt(f.from) : `${fmt(f.from)} – ${fmt(f.to)}`);

export async function financeIn(db: pg.ClientBase, q: Query, now: Date = new Date()): Promise<FinancePage> {
  const f = filters(q, now);
  const retryHref = `${PATH}?${new URLSearchParams({ dari: f.from, sampai: f.to, ...(f.branch ? { cabang: f.branch } : {}) })}`;
  await db.query("savepoint ringkasan_keuangan_page");
  try {
    const branches = (await db.query<{ id: string; name: string }>(`select id, name from branches order by created_at, id`)).rows;
    const scope = { branches, branch: f.branch, from: f.from, to: f.to, action: PATH, period: periodLabel(f) };
    const data = await readFinanceSummary(db, { from: f.from, to: f.to, branchId: f.branch });
    await db.query("release savepoint ringkasan_keuangan_page");
    return { kind: "ok", props: { scope, ledgerHref: HREF.ledger, state: { kind: "ready", data } } };
  } catch (e) {
    await db.query("rollback to savepoint ringkasan_keuangan_page");
    if (e instanceof CommandError && e.code === "ERR_NOT_FOUND") return { kind: "not-found" }; // another tenant's branch (TEN-1)
    // a reader fault: the error state (never an empty or zero summary), logged by name only
    console.error("keuangan/ringkasan: reader failed", { error: e instanceof Error ? e.name : "unknown" });
    const scope = { branches: [], branch: f.branch, from: f.from, to: f.to, action: PATH, period: periodLabel(f) };
    return { kind: "ok", props: { scope, ledgerHref: HREF.ledger, state: { kind: "error", message: READ_FAILED, retryHref } } };
  }
}
