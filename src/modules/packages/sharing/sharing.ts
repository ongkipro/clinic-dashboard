// Family package sharing (PR-93, P-24, DATA-67; T-082, migration 0098, DEC-095). The owner switches sharing on per package template
// (default off; the sold package keeps the template's state at the sale instant); on a sharing package the Paket & Saldo actors
// (owner, manager, FO/cashier) name beneficiaries who may reserve its sessions on their own visits — under the package row lock, so
// two beneficiaries never reserve beyond the paid value. Ownership, refunds and the balance stay with the package owner (BILL-11).
// Reservation itself is the existing reserveSession (packages.ts); the database decides who may use the package.
import type pg from "pg";
import { runCommand, type Json } from "../../../lib/command";
import { assertProductionGoLive } from "../../vendor/profile/profile";
import { call } from "../packages";

async function command<T extends Json>(db: pg.ClientBase, name: string, key: string, body: Record<string, Json>, sql: string, args: unknown[]) {
  await assertProductionGoLive(db);
  const out = await call(() => runCommand<T>(db, { command: name, key, body }, async (c) => ((await c.query(sql, args)).rows[0]?.r ?? null) as T));
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}

export async function setPackageSharing(db: pg.ClientBase, key: string, itemId: string, enabled: boolean, reason: string) {
  const out = await command<{ enabled: boolean; changed: boolean; version?: number }>(db, "package_sharing_set", key, { item_id: itemId, enabled, reason },
    `select package_sharing_set($1, $2, $3) as r`, [itemId, enabled, reason]);
  return out.result;
}
export async function addBeneficiary(db: pg.ClientBase, key: string, packageId: string, patientId: string, reason: string) {
  const out = await command<string>(db, "package_beneficiary_add", key, { package_id: packageId, patient_id: patientId, reason },
    `select package_beneficiary_add($1, $2, $3, $4) as r`, [key, packageId, patientId, reason]);
  return { beneficiaryId: out.result, replayed: out.replayed };
}
export async function removeBeneficiary(db: pg.ClientBase, key: string, beneficiaryId: string, reason: string) {
  await command<null>(db, "package_beneficiary_remove", key, { beneficiary_id: beneficiaryId, reason },
    `select package_beneficiary_remove($1, $2) as r`, [beneficiaryId, reason]);
}

export type PackageSharingState = {
  item_id: string; enabled: boolean; can_change: boolean; history: { version: number; enabled: boolean; changed_at: string; changed_as: string }[];
};
export const packageSharing = (db: pg.ClientBase, itemId: string) =>
  call(async () => (await db.query(`select package_sharing_get($1) as r`, [itemId])).rows[0].r as PackageSharingState);
