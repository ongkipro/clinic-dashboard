// Clinical credentials (PR-73, IAM-4; T-050). Every call runs inside withTenantContext; the database decides
// who may record (Owner, Admin Pusat), verify (the facility head of the branch, else the Owner; never the
// holder, the recorder or the inviter) and end a credential, and which rows a reader sees. Writers go
// through runCommand with the caller's idempotency key and the production go-live gate.
// credentialValid / assertCredentialValid are the one validity check for later gates (T-054, T-102).
// runCredentialAlerts is the daily expiry scan on an unbound worker connection (scheduler: operations task).
// Folder name: `licences` (DEC-062).
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../../lib/command";
import { assertProductionGoLive } from "../../vendor/profile/profile";
import type { CREDENTIAL_KINDS, CREDENTIAL_STATES, PROFESSIONS } from "./schema";

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set([
  "ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED", "ERR_APPROVER_IS_REQUESTER", "ERR_CREDENTIAL_INVALID",
]);

export class CredentialError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CommandError) throw e;
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new CredentialError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}
async function command<T extends Json>(db: pg.ClientBase, command: string, key: string, body: Record<string, Json>, sql: string, args: unknown[]) {
  await assertProductionGoLive(db);
  const out = await call(() => runCommand<T>(db, { command, key, body }, async (c) => ((await c.query(sql, args)).rows[0]?.r ?? null) as T));
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}

export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];
export type Profession = (typeof PROFESSIONS)[number];
export type CredentialState = (typeof CREDENTIAL_STATES)[number];

export type CredentialInput = {
  kind: CredentialKind; number: string; issuer: string; profession: Profession; scope?: string | null; branchId?: string | null;
  validFrom: string; expiresOn?: string | null; evidenceNote?: string | null; replaces?: string | null;
};

export async function recordCredential(db: pg.ClientBase, key: string, staffId: string, i: CredentialInput) {
  const body = {
    kind: i.kind, number: i.number, issuer: i.issuer, profession: i.profession, scope: i.scope ?? null, branch_id: i.branchId ?? null,
    valid_from: i.validFrom, expires_on: i.expiresOn ?? null, evidence_note: i.evidenceNote ?? null, replaces: i.replaces ?? null,
  };
  const out = await command<string>(db, "credential_record", key, { staff_id: staffId, ...body },
    `select credential_record($1, $2::jsonb) as r`, [staffId, JSON.stringify(Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null)))]);
  return { credentialId: out.result, replayed: out.replayed };
}

export async function decideCredential(db: pg.ClientBase, key: string, credentialId: string, verified: boolean, reason?: string | null) {
  await command(db, "credential_decide", key, { credential_id: credentialId, verified, reason: reason ?? null },
    `select credential_decide($1, $2, $3) as r`, [credentialId, verified, reason ?? null]);
}

export async function endCredential(db: pg.ClientBase, key: string, credentialId: string, state: "suspended" | "revoked", reason: string) {
  await command(db, "credential_end", key, { credential_id: credentialId, state, reason }, `select credential_end($1, $2, $3) as r`, [credentialId, state, reason]);
}

export type Credential = {
  id: string; staffId: string; kind: CredentialKind; number: string; issuer: string; profession: Profession; scope: string | null; branchId: string | null;
  validFrom: string; expiresOn: string | null; evidenceNote: string | null; replaces: string | null; state: CredentialState;
  recordedBy: string; recordedAt: Date; decidedBy: string | null; decidedAt: Date | null; decisionReason: string | null;
  endedBy: string | null; endedAt: Date | null; endReason: string | null;
  superseded: boolean; // no longer the current one of its line (see listCredentials)
  replaced: boolean; // has any live replacement (pending included): never decided again
};

// The credentials the caller may read (RLS), newest first. superseded (review r1 P1-3): replaced by a
// replacement that is in force (verified with valid_from reached) or ended, or, for an ended credential, any
// newer live credential of the same staff, kind and branch (a reinstatement that started fresh). A pending
// replacement does not supersede: the current credential stays shown and can still be ended.
export async function listCredentials(db: pg.ClientBase, staffIds?: readonly string[]): Promise<Credential[]> {
  const { rows } = await call(() =>
    db.query(
      `select c.*, to_char(c.valid_from, 'YYYY-MM-DD') as vf, to_char(c.expires_on, 'YYYY-MM-DD') as eo,
              exists (select 1 from staff_credentials r
                       where r.tenant_id = c.tenant_id and r.state <> 'rejected'
                         -- lazy: "in force" uses the database date, not the branch zone (a display badge only;
                         -- credential_valid decides in branch time). Upgrade: pass the branch-local today.
                         and (r.replaces = c.id and (r.state in ('suspended','revoked') or r.state = 'verified' and r.valid_from <= current_date)
                              or c.state in ('suspended','revoked') and r.staff_id = c.staff_id and r.kind = c.kind
                                 and r.branch_id is not distinct from c.branch_id and (r.recorded_at, r.id) > (c.recorded_at, c.id))) as superseded,
              exists (select 1 from staff_credentials r where r.tenant_id = c.tenant_id and r.replaces = c.id and r.state <> 'rejected') as replaced
         from staff_credentials c where ($1::uuid[] is null or c.staff_id = any($1)) order by c.recorded_at desc, c.id`,
      [staffIds ? [...staffIds] : null],
    ),
  );
  return rows.map((r) => ({
    id: r.id, staffId: r.staff_id, kind: r.kind, number: r.number, issuer: r.issuer, profession: r.profession, scope: r.scope, branchId: r.branch_id,
    validFrom: r.vf, expiresOn: r.eo, evidenceNote: r.evidence_note, replaces: r.replaces, state: r.state, recordedBy: r.recorded_by,
    recordedAt: r.recorded_at, decidedBy: r.decided_by, decidedAt: r.decided_at, decisionReason: r.decision_reason, endedBy: r.ended_by,
    endedAt: r.ended_at, endReason: r.end_reason, superseded: r.superseded, replaced: r.replaced,
  }));
}

// Per credential, may the caller verify it now, and if not why (review r1 P2-1): the database answers with
// the same rules the writer applies (role and scope, the Owner only without another facility head, never the
// holder, the recorder or the inviter). A credential with a live replacement is never decided.
export type Decidable = { ok: boolean; why: "role" | "scope" | "facility_head" | "holder" | "recorder" | "inviter" | null };
export async function decidable(db: pg.ClientBase, ids: readonly string[]): Promise<Map<string, Decidable>> {
  if (ids.length === 0) return new Map();
  const { rows } = await call(() => db.query(`select credential_id, ok, why from credential_decidable($1::uuid[])`, [[...ids]]));
  return new Map(rows.map((r) => [r.credential_id as string, { ok: r.ok as boolean, why: r.why as Decidable["why"] }]));
}

// A complete, valid set for one branch-free view (review r1 P1-3): a verified STR and a verified permit of the
// same profession, both in force on `today`. The database check (credentialValid) is per branch; this drives
// the blocked notice on the staff page only.
export function completeSet(rows: readonly Credential[], today: string): boolean {
  const live = rows.filter((c) => !c.superseded && c.state === "verified" && c.validFrom <= today && (c.expiresOn === null || c.expiresOn >= today));
  return live.some((s) => s.kind === "str" && live.some((p) => p.kind !== "str" && p.profession === s.profession));
}

// Status of one staff member's credential set for the list (worst first). `today` is the branch-local date
// (YYYY-MM-DD) the caller shows. Lifetime STR never expires.
export type CredentialStatus =
  | { kind: "none" }
  | { kind: "pending" }
  | { kind: "ended" }
  | { kind: "expired" }
  | { kind: "expiring"; days: number }
  | { kind: "verified" };

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export function credentialStatus(rows: readonly Credential[], today: string): CredentialStatus {
  const live = rows.filter((c) => !c.superseded && c.state !== "rejected");
  if (live.length === 0) return { kind: "none" };
  if (live.some((c) => c.state === "suspended" || c.state === "revoked")) return { kind: "ended" };
  if (live.some((c) => c.expiresOn !== null && c.expiresOn < today)) return { kind: "expired" };
  if (live.some((c) => c.state === "pending")) return { kind: "pending" };
  const soonest = live.filter((c) => c.expiresOn !== null).map((c) => daysBetween(today, c.expiresOn!)).sort((a, b) => a - b)[0];
  if (soonest !== undefined && soonest <= 60) return { kind: "expiring", days: soonest };
  return { kind: "verified" };
}

// The list badge for a status (UI-3: tone + symbol + Indonesian word).
export function statusBadge(st: CredentialStatus): { tone: "success" | "warning" | "danger" | "neutral" | "blocked"; label: string } {
  switch (st.kind) {
    case "none": return { tone: "neutral", label: "Belum ada kredensial" };
    case "pending": return { tone: "warning", label: "Menunggu verifikasi" };
    case "ended": return { tone: "blocked", label: "Ditangguhkan/Dicabut" };
    case "expired": return { tone: "danger", label: "Kedaluwarsa" };
    case "expiring": return { tone: "warning", label: st.days === 0 ? "Habis hari ini" : `Habis dalam ${st.days} hari` };
    case "verified": return { tone: "success", label: "Terverifikasi" };
  }
}

export async function credentialValid(db: pg.ClientBase, staffId: string, branchId: string, at: Date = new Date()): Promise<boolean> {
  const { rows } = await call(() => db.query<{ ok: boolean }>(`select credential_valid($1, $2, $3) as ok`, [staffId, branchId, at]));
  return rows[0]?.ok === true;
}

// ERR_CREDENTIAL_INVALID (18:214): "Izin praktik tenaga kesehatan tidak berlaku."
export async function assertCredentialValid(db: pg.ClientBase, staffId: string, branchId: string, at?: Date): Promise<void> {
  if (!(await credentialValid(db, staffId, branchId, at))) throw new CredentialError("ERR_CREDENTIAL_INVALID");
}

// The daily expiry scan; `today` (YYYY-MM-DD) overrides each credential's local date (tests, catch-up).
export async function runCredentialAlerts(worker: pg.Pool | pg.ClientBase, today?: string): Promise<number> {
  const { rows } = await worker.query<{ n: number }>(`select credential_alert_scan($1::date) as n`, [today ?? null]);
  return rows[0]?.n ?? 0;
}
