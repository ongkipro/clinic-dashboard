// Promo codes (PR-77, BILL-36; T-081, migration 0097, DEC-094). Server code over the promo definers: the code managers
// (owner, Admin Pusat, Marketing) create codes and new versions of their terms, switch them on or off and change the quota;
// the Kasir roles read the list and the per-code hint. A code is applied at issue through issueKasirInvoice
// (lines[].promoCode): the database resolves it, takes a use atomically (never above the quota) and reserves it on the line.
import type pg from "pg";
import { runCommand, type Json } from "../../lib/command";
import { call } from "../cashier/kasir/kasir";

export type PromoTerms = {
  validFrom: string; validTo: string; discountKind: "percent" | "rupiah"; discountValue: number; maxDiscount?: number | null;
  itemIds: string[]; branchIds?: string[]; perPatientLimit?: number | null;
};
const terms = (t: PromoTerms) => ({
  valid_from: t.validFrom, valid_to: t.validTo, discount_kind: t.discountKind, discount_value: t.discountValue, max_discount: t.maxDiscount ?? null,
  item_ids: t.itemIds, branch_ids: t.branchIds ?? [], per_patient_limit: t.perPatientLimit ?? null,
});
async function command<T extends Json>(db: pg.ClientBase, name: string, key: string, body: Record<string, Json>, sql: string, args: unknown[]) {
  const out = await call(() => runCommand<T>(db, { command: name, key, body }, async (c) => ((await c.query(sql, args)).rows[0]?.r ?? null) as T));
  if (!out.ok) throw out.error;
  return out.result;
}

export async function createPromoCode(db: pg.ClientBase, key: string, code: string, quota: number, t: PromoTerms): Promise<string> {
  const p = { code, quota, terms: terms(t) };
  return command<string>(db, "promo_code_create", key, p, `select promo_code_create($1, $2::jsonb) as r`, [key, JSON.stringify(p)]);
}
export async function versionPromoCode(db: pg.ClientBase, key: string, promoId: string, t: PromoTerms): Promise<string> {
  const p = terms(t);
  return command<string>(db, "promo_code_version", key, { promo_id: promoId, terms: p }, `select promo_code_version($1, $2, $3::jsonb) as r`,
    [key, promoId, JSON.stringify(p)]);
}
export async function setPromoCode(db: pg.ClientBase, key: string, promoId: string, o: { active?: boolean; quota?: number }) {
  await command<null>(db, "promo_code_set", key, { promo_id: promoId, active: o.active ?? null, quota: o.quota ?? null },
    `select promo_code_set($1, $2, $3) as r`, [promoId, o.active ?? null, o.quota ?? null]);
}

export type PromoVersionRow = {
  id: string; version: number; valid_from: string; valid_to: string; discount_kind: "percent" | "rupiah"; discount_value: number;
  max_discount: number | null; item_ids: string[]; branch_ids: string[]; per_patient_limit: number | null;
  reserved: number; consumed: number; released: number; discount_given: number;
};
export type PromoCodeRow = { id: string; code: string; quota: number; used: number; active: boolean; versions: PromoVersionRow[] };
export const listPromoCodes = async (db: pg.ClientBase) =>
  call(async () => (await db.query<{ r: PromoCodeRow[] }>(`select promo_codes_list() as r`)).rows[0].r);

export type PromoCheck = { ok: true; promo_id: string; version: number; gross: number; discount: number } | { ok: false; reason: string };
export const checkPromoCode = async (db: pg.ClientBase, code: string, itemId: string, o: { branchId?: string; quantity?: number; patientId?: string } = {}) =>
  call(async () => (await db.query<{ r: PromoCheck }>(`select promo_code_check($1, $2, $3, $4, $5) as r`,
    [code, itemId, o.branchId ?? null, o.quantity ?? 1, o.patientId ?? null])).rows[0].r);
