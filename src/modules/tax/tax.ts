// Tax profile (PR-24, A-07, SET-39; T-071). Every call runs inside withTenantContext; the database decides authority
// (the owner changes the profile; owner, finance, admin pusat and auditor read it) and gates PKP on approved tax
// advice inside its own definer (the evidence is locked after staff_access; never assertFeatureGate first).
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../lib/command";
import { assertProductionGoLive } from "../vendor/profile/profile";

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED", "ERR_IDEMPOTENCY_CONFLICT", "ERR_GATE_CLOSED"]);

export class TaxError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
export async function call<T>(fn: () => Promise<T>, Err: new (c: ErrorCode, r?: string) => CommandError = TaxError): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CommandError) throw e;
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new Err(m[1] as ErrorCode, m[2]);
    throw e;
  }
}

export type TaxProfileInput = { isPkp: boolean; pkpEffectiveFrom?: string | null; npwp?: string | null; reason: string };
export async function setTaxProfile(db: pg.ClientBase, key: string, i: TaxProfileInput) {
  await assertProductionGoLive(db);
  const p: Record<string, Json> = { is_pkp: i.isPkp, reason: i.reason };
  if (i.pkpEffectiveFrom !== undefined) p.pkp_effective_from = i.pkpEffectiveFrom;
  if (i.npwp !== undefined) p.npwp = i.npwp;
  const out = await call(() => runCommand<string>(db, { command: "tax_profile_set", key, body: p }, async (c) =>
    (await c.query(`select tax_profile_set($1, $2::jsonb) as r`, [key, JSON.stringify(p)])).rows[0].r));
  if (!out.ok) throw out.error;
  return { changeId: out.result, replayed: out.replayed };
}

export type TaxProfile = {
  npwp: string | null; is_pkp: boolean; pkp_effective_from: string | null; pkp_now: boolean; vat_gate_open: boolean; can_change: boolean;
  turnover_12m: number; as_of: string; warning: "none" | "near" | "over";
  history: { id: string; npwp: string | null; is_pkp: boolean; pkp_effective_from: string | null; reason: string; changed_at: string; changed_by: string }[];
};
export const getTaxProfile = (db: pg.ClientBase) => call(async () => (await db.query(`select tax_profile_get() as r`)).rows[0].r as TaxProfile);
