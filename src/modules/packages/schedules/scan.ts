// The daily instalment reminder (PR-96; T-083): an unbound worker connection (no tenant context) raises one instalment_due alert for
// FO/cashier at the target's branch for each agreed row overdue and not covered by what was paid since the schedule was set, and cancels a
// schedule whose target closed or was fully paid. As runPackageExpiryScan; the platform worker calls it once a day.
import type pg from "pg";

export async function runInstalmentReminderScan(worker: pg.Pool | pg.ClientBase, today?: string): Promise<number> {
  const r = await worker.query<{ n: number }>(`select instalment_reminder_scan($1::date) as n`, [today ?? null]);
  return r.rows[0].n;
}
