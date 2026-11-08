// Patient registration (PR-5, DATA-8, DATA-13; T-037). Every call runs inside withTenantContext. The
// identity number (NIK 16 digits, passport, KITAS) is normalised, encrypted under the tenant data key
// and blind-indexed here; only the sealed value and the index reach the database (patient_register,
// migration 0057). The number is never logged, returned, put in an event or an error message.
import type pg from "pg";
import { blindIndex, decryptField, encryptField, type KekRing, type TenantKeys } from "../../lib/keys/envelope";
import { EncryptionUnavailableError, ensureTenantKeys, kekRing, tenantKeys } from "../../lib/keys/runtime";
import { CommandError, type ErrorCode } from "../../lib/command";
import { assertProductionGoLive } from "../vendor/profile/profile";

export const IDENTITY_PURPOSE = "patient.identity";
const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_VERSION_CONFLICT", "ERR_INVALID_INPUT", "ERR_TENANT_SUSPENDED"]);

export class PatientError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new PatientError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}

export type IdentityType = "nik" | "passport" | "kitas" | "newborn_via_guardian";

// The normalised identity number, or null when it is malformed (plan r1 P1-2).
export function normaliseIdentity(type: IdentityType, raw: string): string | null {
  const v = (raw ?? "").replace(/\s+/g, "");
  if (type === "nik") return /^[0-9]{16}$/.test(v) ? v : null;
  if (type === "passport" || type === "kitas") {
    const u = v.toUpperCase();
    return /^[A-Z0-9-]{4,30}$/.test(u) ? u : null;
  }
  return null;
}

// Phone normalisation, the same rule as patient_phone_norm in SQL.
export function normalisePhone(raw: string): string | null {
  const s = (raw ?? "").trim();
  const d = s.replace(/[^0-9]/g, "");
  const v = d.startsWith("0") ? `+62${d.slice(1)}` : d.startsWith("62") ? `+${d}` : s.startsWith("+") ? `+${d}` : null;
  return v && /^\+[1-9][0-9]{7,14}$/.test(v) ? v : null;
}

// A masked display of the identity number: the last four characters only.
export const maskIdentity = (normalised: string) => `${"•".repeat(Math.max(normalised.length - 4, 0))}${normalised.slice(-4)}`;

export type Sealed = { enc: string; bidx: string; masked: string };

function ring(): KekRing {
  const r = kekRing();
  if (!r) throw new EncryptionUnavailableError();
  return r;
}
const indexOf = (r: KekRing, keys: TenantKeys, type: IdentityType, normalised: string) => blindIndex(r, keys, IDENTITY_PURPOSE, `${type}:${normalised}`);

// Seals a normalised identity number for a write (creates the tenant data key at the first write).
export async function sealIdentity(db: pg.ClientBase, tenantId: string, type: IdentityType, normalised: string): Promise<Sealed> {
  const r = ring();
  const keys = await ensureTenantKeys(db, r, tenantId);
  return { enc: encryptField(r, keys, IDENTITY_PURPOSE, normalised), bidx: indexOf(r, keys, type, normalised), masked: maskIdentity(normalised) };
}

// The blind index for a search; null when the tenant has no key yet (then nothing is encrypted, so
// nothing can match) — a read never creates a key (plan r1 open point 1).
export async function identityIndexForSearch(db: pg.ClientBase, tenantId: string, type: IdentityType, normalised: string): Promise<string | null> {
  const r = ring();
  const keys = await tenantKeys(db, tenantId);
  return keys ? indexOf(r, keys, type, normalised) : null;
}

// A sealed pair posted back by the duplicate step: it must open under the tenant key and index to the
// posted index, or it was tampered with (plan r2 P3-1). Returns the masked display.
export async function verifySealed(db: pg.ClientBase, tenantId: string, type: IdentityType, enc: string, bidx: string): Promise<string | null> {
  const r = ring();
  const keys = await tenantKeys(db, tenantId);
  if (!keys) return null;
  try {
    const value = decryptField(r, keys, IDENTITY_PURPOSE, enc);
    const n = normaliseIdentity(type, value);
    return n && n === value && indexOf(r, keys, type, n) === bidx ? maskIdentity(n) : null;
  } catch {
    return null;
  }
}

export type Match = { id: string; mrn: string; fullName: string; birthYear: number; maskedPhone: string | null };
const matches = (j: unknown): Match[] =>
  ((j as { id: string; mrn: string; full_name: string; birth_year: number; masked_phone: string | null }[]) ?? [])
    .map((m) => ({ id: m.id, mrn: m.mrn, fullName: m.full_name, birthYear: m.birth_year, maskedPhone: m.masked_phone }));

export type RegistrationFields = {
  full_name: string; birth_date: string; sex: "female" | "male"; phone: string;
  identity_type: IdentityType; no_identity_reason?: string | null;
  religion: string; occupation: string; education: string; marital_status: string; address?: string | null;
  branch_id?: string | null;
  guardian?: { name: string; relation: string; phone?: string | null } | null;
};
export type RegisterResult =
  | { ok: true; patientId: string; mrn: string }
  | { ok: false; code: "duplicate_identity" | "duplicate_decision_required"; matches: Match[] };

// Registers with an already sealed identity (or none for a newborn). The production go-live gate
// (ARCH-10) runs first; the database decides roles, the tenant lifecycle, the guardian and duplicates.
export async function registerPatient(
  db: pg.ClientBase,
  fields: RegistrationFields,
  sealed: { enc: string; bidx: string } | null,
  decision: "new" | null,
): Promise<RegisterResult> {
  await assertProductionGoLive(db);
  const r = await call(() =>
    db.query(`select patient_register($1::jsonb, $2, $3, $4) as r`, [JSON.stringify(fields), sealed?.enc ?? null, sealed?.bidx ?? null, decision]),
  );
  const j = r.rows[0].r;
  return j.ok ? { ok: true, patientId: j.patient_id, mrn: j.mrn } : { ok: false, code: j.code, matches: matches(j.matches) };
}

// Cari dulu (19:53), FO and CS: by phone, name (with birth date), MRN or the identity index.
export async function findMatches(
  db: pg.ClientBase,
  q: { phone?: string | null; name?: string | null; birthDate?: string | null; mrn?: string | null; identityBidx?: string | null },
): Promise<Match[]> {
  const r = await call(() =>
    db.query(`select patient_matches($1, $2, $3::date, $4, $5) as r`, [q.phone ?? null, q.name ?? null, q.birthDate ?? null, q.mrn ?? null, q.identityBidx ?? null]),
  );
  return matches(r.rows[0].r);
}

export type PatientView = {
  id: string; mrn: string; fullName: string; birthDate: string; sex: string; identityType: IdentityType; religion: string; occupation: string;
  education: string; maritalStatus: string; address: string | null; registeredBranchId: string; createdAt: string; phone: string | null;
  guardians: { name: string; relation: string; phone: string | null }[];
};
// One patient for an identity reader, or null (scenario PR-1: every not-found is audited in the caller's
// tenant; the caller must let the transaction commit).
export async function getPatient(db: pg.ClientBase, id: string): Promise<PatientView | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const j = (await call(() => db.query(`select patient_get($1) as r`, [id]))).rows[0].r;
  if (!j) return null;
  return {
    id: j.id, mrn: j.mrn, fullName: j.full_name, birthDate: j.birth_date, sex: j.sex, identityType: j.identity_type, religion: j.religion,
    occupation: j.occupation, education: j.education, maritalStatus: j.marital_status, address: j.address, registeredBranchId: j.registered_branch_id,
    createdAt: j.created_at, phone: j.phone, guardians: j.guardians,
  };
}
