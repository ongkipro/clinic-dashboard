// Consent ledger (PR-4, DATA-14, DATA-66, PRIV-1; T-038, DEC-052). Every call runs inside
// withTenantContext. Grants and withdrawals run through runCommand with the caller's idempotency key
// (DATA-45): a domain refusal (text changed, already granted, not withdrawable, already withdrawn) is a
// stored outcome replayed for the same key; forbidden, not found, invalid input and a suspended tenant
// raise and leave no record. Withdrawal is never blocked by the tenant lifecycle (PRIV-1).
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode } from "../../../lib/command";
import { assertProductionGoLive } from "../../vendor/profile/profile";

export const CONSENT_PURPOSES = ["care_notice", "procedure", "clinical_photo", "marketing_wa", "publication"] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];
export type GrantablePurpose = Exclude<ConsentPurpose, "procedure">;
export const CONSENT_CHANNELS = ["in_person", "paper", "whatsapp", "phone"] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_TENANT_SUSPENDED"]);

export class ConsentError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new ConsentError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}

export type GrantRefusal = "consent_text_changed" | "already_granted";
export type WithdrawRefusal = "not_withdrawable" | "already_withdrawn";
export type Outcome<R extends string> = { ok: true; consentId: string; replayed: boolean } | { ok: false; code: R; replayed: boolean };

type Raw = { ok: boolean; consent_id?: string; code?: string };
async function command<R extends string>(db: pg.ClientBase, command: string, key: string, body: Record<string, string>, sql: string, args: unknown[]): Promise<Outcome<R>> {
  // The database error is mapped only outside runCommand: inside it, a CommandError counts as a stored
  // refusal, while a raw error rolls the claim back (forbidden, not found, invalid, suspended; impl
  // review r1 P2). Domain refusals come back as {ok:false, code} rows and are stored on purpose.
  const out = await call(() => runCommand<Raw>(db, { command, key, body }, async (c) => (await c.query(sql, args)).rows[0].r as Raw));
  if (!out.ok) throw out.error;
  const r = out.result;
  return r.ok ? { ok: true, consentId: r.consent_id!, replayed: out.replayed } : { ok: false, code: r.code as R, replayed: out.replayed };
}

// SET-45: the Owner, or Admin Pusat with the data-protection duty. Returns the new version.
export async function publishConsentText(db: pg.ClientBase, i: { purpose: ConsentPurpose; body: string; effectiveFrom?: Date | null }) {
  const r = await call(() => db.query(`select consent_text_publish($1, $2, $3) as r`, [i.purpose, i.body, i.effectiveFrom ?? null]));
  const j = r.rows[0].r as { consent_text_id: string; version: number };
  return { id: j.consent_text_id, version: j.version };
}

export type ConsentText = { id: string; purpose: ConsentPurpose; version: number; body: string; effectiveFrom: Date; createdAt: Date };
// The text in force now for a purpose (what the patient is shown before a grant), or null.
export async function currentText(db: pg.ClientBase, purpose: ConsentPurpose): Promise<ConsentText | null> {
  const r = (await db.query(
    `select id, purpose, version, body, effective_from, created_at from consent_texts
      where purpose = $1 and effective_from <= clock_timestamp() order by version desc limit 1`,
    [purpose],
  )).rows[0];
  return r ? { id: r.id, purpose: r.purpose, version: r.version, body: r.body, effectiveFrom: r.effective_from, createdAt: r.created_at } : null;
}

export async function grantConsent(
  db: pg.ClientBase,
  key: string,
  i: { patientId: string; purpose: GrantablePurpose; textId: string; channel: ConsentChannel },
): Promise<Outcome<GrantRefusal>> {
  await assertProductionGoLive(db);
  return command<GrantRefusal>(db, "consent.grant", key, { patient: i.patientId, purpose: i.purpose, text: i.textId, channel: i.channel },
    `select consent_grant($1, $2, $3, $4) as r`, [i.patientId, i.purpose, i.textId, i.channel]);
}

export async function withdrawConsent(
  db: pg.ClientBase,
  key: string,
  i: { consentId: string; channel: ConsentChannel; reason: string },
): Promise<Outcome<WithdrawRefusal>> {
  return command<WithdrawRefusal>(db, "consent.withdraw", key, { consent: i.consentId, channel: i.channel, reason: i.reason },
    `select consent_withdraw($1, $2, $3) as r`, [i.consentId, i.channel, i.reason]);
}

export type ConsentRow = {
  id: string; purpose: GrantablePurpose; textId: string; textVersion: number; grantedAt: string; grantedBy: string; grantedAs: string;
  grantChannel: ConsentChannel; withdrawnAt: string | null; withdrawnBy: string | null; withdrawnAs: string | null;
  withdrawChannel: ConsentChannel | null; withdrawReason: string | null;
};
export async function patientConsents(db: pg.ClientBase, patientId: string): Promise<ConsentRow[]> {
  const r = await call(() => db.query(`select patient_consents($1) as r`, [patientId]));
  return (r.rows[0].r as Record<string, unknown>[]).map((x) => ({
    id: x.id as string, purpose: x.purpose as GrantablePurpose, textId: x.text_id as string, textVersion: x.text_version as number,
    grantedAt: x.granted_at as string, grantedBy: x.granted_by as string, grantedAs: x.granted_as as string, grantChannel: x.grant_channel as ConsentChannel,
    withdrawnAt: (x.withdrawn_at as string | null) ?? null, withdrawnBy: (x.withdrawn_by as string | null) ?? null, withdrawnAs: (x.withdrawn_as as string | null) ?? null,
    withdrawChannel: (x.withdraw_channel as ConsentChannel | null) ?? null, withdrawReason: (x.withdraw_reason as string | null) ?? null,
  }));
}

// For the outbound task (scenario PR-4 second half) and later gates; also a tenant-bound service context.
export async function consentActive(db: pg.ClientBase, patientId: string, purpose: ConsentPurpose): Promise<boolean> {
  return (await call(() => db.query(`select consent_active($1, $2) as r`, [patientId, purpose]))).rows[0].r === true;
}

// Marketing's only view of patients (TEN-18, DEC-052).
export async function marketingContacts(db: pg.ClientBase): Promise<{ patientId: string; fullName: string; phone: string | null }[]> {
  const r = await call(() => db.query(`select patient_id, full_name, phone from marketing_contacts()`));
  return r.rows.map((x) => ({ patientId: x.patient_id, fullName: x.full_name, phone: x.phone ?? null }));
}
