// Rekonsiliasi (UX-22 ▸ Rekon, PR-34; T-108): the loader core. It reads the period through the one reader that owns the figures
// (recon_report, drizzle/0129: owner, finance, auditor; the actor lock first) via readRecon (decode → reconcile), and composes the props of
// the presentational view. It never recomputes a figure. The database decides who reads; data.ts puts the role gate in front, and this
// core — no `server-only` — is what the isolation case runs as another tenant's reader.
import type pg from "pg";
import { CommandError } from "../../../../lib/command";
import { isCalendarDate } from "../../../../modules/accounting/ledger/ledger";
import type { ReconReport, Ref } from "../../../../modules/accounting/recon/recon";
import { readRecon } from "../../../../modules/accounting/recon/report";
import type { RekonProps, ScreenState } from "./model";

// owner, finance, auditor: the reader's own actor set (recon_report → ledger_actor). Nav shows the page to Finance (19 :180).
export const READERS = ["owner", "finance", "auditor"] as const;
export const PATH = "/keuangan/rekon";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const LEDGER = "/keuangan/buku-besar";
export const READ_FAILED = "Rekonsiliasi belum bisa dibaca. Tidak ada yang berubah.";

export type Query = { dari?: string; sampai?: string; cabang?: string };
export type Filters = { from: string; to: string; branch: string | null };
export type Rekon = { kind: "not-found" } | { kind: "forbidden" } | { kind: "ok"; props: RekonProps };

const jakartaToday = (now: Date) => now.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
// The period: ?dari / ?sampai when both are calendar days, in order and at most 366 days apart (the reader's bound), else this month to
// today. A malformed ?cabang is ignored (all branches); a well-formed one is asked of the reader, which answers not-found for a branch that
// is not the caller's tenant's.
export function filters(q: Query, now: Date = new Date()): Filters {
  const t = jakartaToday(now);
  const month = { from: `${t.slice(0, 8)}01`, to: t };
  const from = q.dari && isCalendarDate(q.dari) ? q.dari : month.from;
  const to = q.sampai && isCalendarDate(q.sampai) ? q.sampai : month.to;
  const ok = to >= from && (Date.parse(to) - Date.parse(from)) / 86_400_000 <= 366;
  return { ...(ok ? { from, to } : month), branch: q.cabang && UUID.test(q.cabang) ? q.cabang : null };
}

const fmt = (iso: string) => new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
export const periodLabel = (f: Filters) => (f.from === f.to ? fmt(f.from) : `${fmt(f.from)} – ${fmt(f.to)}`);

// Drill-down to the source document where a page exists that takes that id: a payment → its receipt (UX-15 struk), a receivable → Piutang.
// Every other reference renders as text (no dead link).
export async function hrefsFor(db: pg.ClientBase, refs: Ref[]): Promise<Map<string, string>> {
  const pays = [...new Set(refs.filter((r) => r.kind === "payment").map((r) => r.id))];
  const out = new Map<string, string>();
  if (pays.length) {
    for (const r of (await db.query<{ id: string; receipt_id: string }>(`select id, receipt_id from payments where id = any($1::uuid[])`, [pays])).rows) {
      out.set(`payment:${r.id}`, `/kasir/struk/${r.receipt_id}`);
    }
  }
  for (const r of refs) if (r.kind === "receivable") out.set(`receivable:${r.id}`, `/piutang/${r.id}`);
  return out;
}

export async function rekonIn(db: pg.ClientBase, q: Query, now: Date = new Date()): Promise<Rekon> {
  const f = filters(q, now);
  const branches = (await db.query<{ id: string; name: string }>(`select id, name from branches order by name, code`)).rows;
  const scope = { branches, branch: f.branch, from: f.from, to: f.to, action: PATH, period: periodLabel(f) };
  const view = (state: ScreenState<ReconReport>, hrefs = new Map<string, string>()): Rekon =>
    ({ kind: "ok", props: { scope, ledgerHref: LEDGER, hrefFor: (r) => hrefs.get(`${r.kind}:${r.id}`), state } });
  await db.query("savepoint rekon_read");
  try {
    const data = await readRecon(db, { from: f.from, to: f.to, branchId: f.branch });
    // the drill-down lookup runs INSIDE the savepoint too: a failure there rolls back like a reader failure (R3 e4444cef P2)
    const hrefs = await hrefsFor(db, data.items.map((i) => i.ref));
    await db.query("release savepoint rekon_read");
    return view({ kind: "ready", data }, hrefs);
  } catch (e) {
    await db.query("rollback to savepoint rekon_read");
    if (e instanceof CommandError && e.code === "ERR_NOT_FOUND") return { kind: "not-found" }; // another tenant's branch (TEN-1)
    if (e instanceof CommandError && e.code === "ERR_FORBIDDEN") return { kind: "forbidden" };
    // a reader, decoder or link-lookup fault (unexpected shape, unsafe rupiah): an error state, never a clean or empty report; logged without a payload
    console.error("keuangan/rekon: reader failed", { error: e instanceof Error ? e.name : "unknown" });
    return view({ kind: "error", message: READ_FAILED, retryHref: `${PATH}?${new URLSearchParams({ dari: f.from, sampai: f.to, ...(f.branch ? { cabang: f.branch } : {}) })}` });
  }
}
