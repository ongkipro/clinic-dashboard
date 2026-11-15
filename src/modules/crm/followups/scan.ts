// The daily follow-up scan (PR-30; T-093): an unbound worker connection (no tenant context) creates the follow-up tasks of the date rules —
// control due, package stage and expiry, locked instalments, receivables, unselected plan items, dormant patients — once per rule × source
// × step (a closed task is never re-created). The no-show rule needs no scan (the appointments trigger). As runInstalmentReminderScan; the
// platform worker calls it once a day.
import type pg from "pg";

export async function runFollowupScan(worker: pg.Pool | pg.ClientBase, today?: string): Promise<number> {
  const r = await worker.query<{ n: number }>(`select followup_scan($1::date) as n`, [today ?? null]);
  return r.rows[0].n;
}
