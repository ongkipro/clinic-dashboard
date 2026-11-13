// Saldo pasien (PR-21, BILL-12, DATA-30; T-075, migration 0090, DEC-086). The balance never expires and never goes
// below 0; it is spent at the Kasir as the `balance` tender (receivePayment). Credits arrive with their tasks
// (packages, deposits, refunds, the import) through the internal balance_post. This module reads only.
import type pg from "pg";
import { call } from "../cashier/kasir/kasir";
import type { BALANCE_KINDS } from "./schema";

export type BalanceKind = (typeof BALANCE_KINDS)[number];
export type BalanceEntry = {
  id: string; kind: BalanceKind; amount: number; balance_after: number; branch: { id: string; name: string } | null; created_at: string;
  payment_id: string | null; source_kind: string | null; source_id: string | null; reason: string | null;
};
export type PatientBalance = {
  patient: { id: string; name: string | null; mrn: string } | null; balance: number; role: string; entries: BalanceEntry[];
};
export const patientBalance = (db: pg.ClientBase, patientId: string) =>
  call(async () => (await db.query(`select balance_get($1) as r`, [patientId])).rows[0].r as PatientBalance);
