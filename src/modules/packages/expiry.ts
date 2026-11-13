// The daily package expiry (BILL-10; T-076): an unbound worker connection (no tenant context) closes every active
// package past its validity — paid-unused to the balance, the unpaid remainder cancelled. As credential_alert_scan
// and logbook_due_scan; the platform worker calls it once a day.
import type pg from "pg";

export async function runPackageExpiryScan(worker: pg.Pool | pg.ClientBase, today?: string): Promise<number> {
  const r = await worker.query<{ n: number }>(`select package_expiry_scan($1::date) as n`, [today ?? null]);
  return r.rows[0].n;
}
