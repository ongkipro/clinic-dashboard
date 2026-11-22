// Ringkasan CS (UX-36, PR-33e; T-113): the page-data core. It reads the window through readCsSummary (existing granted readers with their own
// authority: dashboard_kpi k13/k14, lead_list + branch_is_open, survey_summary) and composes the props of the presentational CsSummary.
// No `server-only`: data.ts gates the role first; this core is what the isolation case runs as another tenant's central CS.
// Page authority (settled): central CS only — the nav row "/ringkasan/cs" (CS), 19:35 and 17 UX-36 (role "Central CS"); the readers may
// admit other roles, but the page does not. Waiting semantics (documented): a lead counts as waiting when it ENTERED while its branch was
// open (branch_is_open at created_at — the K14 basis on main); its wait is WALL-CLOCK minutes since entry; overdue = lead_list's own
// verdict against today's SET-20. Unconfirmed appointments and open service complaints stay unavailable (no count-only reader yet).
import type pg from "pg";
import type { Role } from "../../../../auth/policy";
import { NAV } from "../../../../components/shell/nav";
import { CommandError } from "../../../../lib/command";
import type { CsSummaryProps } from "./model";
import { readCsSummary } from "./reader";

export const PATH = "/ringkasan/cs";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const READ_FAILED = "Ringkasan CS belum bisa dibaca. Tidak ada yang berubah.";
// The page roles are the nav row of PATH (one source; no new authority).
export function readers(): readonly Role[] {
  return NAV.flatMap((g) => g.pages).find((p) => p.href === PATH)?.roles ?? [];
}

export type Query = { cabang?: string };
export type Branch = { id: string; name: string };
export type CsPage = { kind: "not-found" } | { kind: "ok"; props: CsSummaryProps; branches: Branch[]; branchId: string | null };

const jakarta = (now: Date) => now.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
const monthLabel = (ym: string) => new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${ym}-01T00:00:00Z`));

// The window: this calendar month up to today (Asia/Jakarta), the K13 / K14 period; `today` drives "Lead baru hari ini". A malformed ?cabang
// is ignored (all branches); a well-formed one is asked of the readers, which answer not-found when it is not the caller's tenant's.
export function csWindow(q: Query, now: Date = new Date()) {
  const today = jakarta(now);
  return { from: `${today.slice(0, 8)}01`, to: today, today, label: monthLabel(today.slice(0, 7)), branchId: q.cabang && UUID.test(q.cabang) ? q.cabang : null };
}

export async function csIn(db: pg.ClientBase, q: Query, now: Date = new Date()): Promise<CsPage> {
  const w = csWindow(q, now);
  await db.query("savepoint ringkasan_cs_page");
  try {
    const branches = (await db.query<Branch>(`select id, name from branches order by created_at, id`)).rows;
    const scope = w.branchId ? branches.find((b) => b.id === w.branchId)?.name ?? "Cabang" : "Semua Cabang";
    // K13 rows carry no link: /lead does not read ?sumber= or ?cabang= yet, so a link would land on the unfiltered list
    const data = await readCsSummary(db, w);
    await db.query("release savepoint ringkasan_cs_page");
    return { kind: "ok", branches, branchId: w.branchId, props: { scope, state: { kind: "ready", data } } };
  } catch (e) {
    await db.query("rollback to savepoint ringkasan_cs_page");
    if (e instanceof CommandError && e.code === "ERR_NOT_FOUND") return { kind: "not-found" }; // another tenant's branch (TEN-1)
    // a reader fault: the error state (never an empty or zero summary), logged by name only
    console.error("ringkasan/cs: reader failed", { error: e instanceof Error ? e.name : "unknown" });
    return { kind: "ok", branches: [], branchId: w.branchId,
      props: { scope: "Ringkasan CS", state: { kind: "error", message: READ_FAILED, retryHref: w.branchId ? `${PATH}?cabang=${w.branchId}` : PATH } } };
  }
}
