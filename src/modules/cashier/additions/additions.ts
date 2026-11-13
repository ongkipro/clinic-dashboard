// Tindakan Tambahan for the cashier (PR-15, BILL-3, BILL-22, B-18; T-074, migration 0089, DEC-085). An approved
// addition (T-056) may be released by FO/cashier or a manager to start before payment, naming the staff accountable for
// collecting; it is billed on its own addition invoice (issueKasirInvoice with planItemId lines). The database decides
// authority, the branch, the agreement in force and the collector; nothing here reaches a provider.
import type pg from "pg";
import { runCommand } from "../../../lib/command";
import { assertProductionGoLive } from "../../vendor/profile/profile";
import { call } from "../kasir/kasir";

export async function releaseAddition(db: pg.ClientBase, key: string, planItemId: string, collectorStaffId: string) {
  await assertProductionGoLive(db);
  const p = { collector_staff_id: collectorStaffId };
  const out = await call(() =>
    runCommand<string>(db, { command: "addition_release", key, body: { plan_item_id: planItemId, release: p } }, async (c) =>
      (await c.query(`select addition_release($1, $2, $3::jsonb) as r`, [key, planItemId, JSON.stringify(p)])).rows[0]?.r ?? null),
  );
  if (!out.ok) throw out.error;
  return { releaseId: out.result as string, replayed: out.replayed };
}

export type Addition = {
  plan_item_id: string; request_id: string; item_id: string; name: string; quantity: number; price: number | null; consent_active: boolean;
  authorized_by: string | null;
  release: { id: string; released_at: string; released_by: string | null; collector: string | null } | null;
  invoice_line_id: string | null; invoice_id: string | null; paid: boolean; counted: boolean;
};
export type VisitAdditions = {
  visit_id: string; branch_id: string; closed: boolean; payment: string;
  patient: { id: string; name: string | null; mrn: string } | null; additions: Addition[];
};
export const visitAdditions = (db: pg.ClientBase, visitId: string) =>
  call(async () => (await db.query(`select addition_visit_list($1) as r`, [visitId])).rows[0].r as VisitAdditions);
