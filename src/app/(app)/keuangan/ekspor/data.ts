// Ekspor (Keuangan) data (UX-22 ▸ Ekspor; HYG-NAV-2). Finance (nav row). Reads only what decides what to show: the ledger status (via the
// journal reader of a one-day range: owner, finance, auditor), the commission batches (commission_batches_list) and the tenant-local
// today. Every download is its existing route handler, which re-checks role and gate in the database.
import "server-only";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { journal, type LedgerStatus } from "../../../../modules/accounting/ledger/ledger";
import { type BatchSummary, listBatches } from "../../../../modules/commission/commission";
import { appPool, requestContext } from "../../../../modules/org/context/store";

export const EXPORTERS = ["finance"];
export type EksporData =
  | { kind: "redirect"; to: string } | { kind: "forbidden" }
  | { kind: "ok"; today: string; ledger: LedgerStatus | null; batches: BatchSummary[] };

const soft = <T>(p: Promise<T>): Promise<T | null> => p.catch((e) => (e instanceof CommandError && (e.code === "ERR_FORBIDDEN" || e.code === "ERR_NOT_FOUND") ? null : Promise.reject(e)));

export async function loadEkspor(): Promise<EksporData> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  if (rc.kind === "blocked" || !EXPORTERS.includes(rc.active.context.actingRole)) return { kind: "forbidden" };
  return withTenantContext(await appPool(), rc.active.context, async (db) => {
    const today = (await db.query(`select to_char(clock_timestamp() at time zone 'Asia/Jakarta', 'YYYY-MM-DD') as d`)).rows[0].d as string;
    const j = await soft(journal(db, { from: today, to: today }));
    const b = await soft(listBatches(db));
    return { kind: "ok" as const, today, ledger: j?.status ?? null, batches: b?.batches ?? [] };
  });
}
