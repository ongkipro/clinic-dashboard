// Vendor staff and maker-checker (PR-57, IAM-10, DATA-48). Server only.
// - Runs on the platform operator connection (the vendor console, T-021); every call names
//   the signed-in account and the client IP. The database (migration 0032) checks the
//   actor — active vendor staff, TOTP enrolled, allowed IP, the needed role — and logs
//   every action, allowed or refused, in vendor_actions.
// - Refusals come back as a result (not an exception) so the refusal's log row commits;
//   this module turns them into VendorStaffError with the TD-51 code.
// - Requester ≠ approver for clinical-data grant, suspension, exit, server-fee change,
//   invoice waiver and dual identity; the platform owner approves; a dual vendor/clinic
//   identity also needs that clinic's owner (vendorDualIdentityClinicDecide, clinic app).
import type pg from "pg";
import { VENDOR_REQUEST_KINDS, VENDOR_ROLES } from "../schema";

export type VendorRole = (typeof VENDOR_ROLES)[number];
export type VendorRequestKind = (typeof VENDOR_REQUEST_KINDS)[number];

// The signed-in vendor console caller, all three from the vendor console's server-side
// session and the trusted proxy (T-021), never from the request body: the account, the
// time the session last passed its TOTP challenge, and the client IP.
export type VendorCaller = { accountId: string; ip: string; mfaAt: Date };

export class VendorStaffError extends Error {
  constructor(readonly code: string, readonly reason?: string) {
    super(reason ? `${code}: ${reason}` : code);
  }
}

type Result = { ok: boolean; code?: string; reason?: string; id?: string; state?: string };

async function run(db: pg.ClientBase, sql: string, args: unknown[]): Promise<Result> {
  // Each call commits on its own: a refusal's log row must survive (outside the caller's
  // transaction, like the vendor profile writes).
  if ((db as pg.Client).getTransactionStatus?.() !== "I") throw new VendorStaffError("ERR_FORBIDDEN", "call outside an open transaction");
  await db.query("begin");
  try {
    const r = (await db.query<{ r: Result }>(sql, args)).rows[0].r;
    await db.query("commit");
    if (!r.ok) throw new VendorStaffError(r.code ?? "ERR_FORBIDDEN", r.reason);
    return r;
  } catch (e) {
    if (!(e instanceof VendorStaffError)) await db.query("rollback").catch(() => undefined);
    const m = /^(ERR_[A-Z_]+):/.exec((e as { message?: string }).message ?? "");
    if (!(e instanceof VendorStaffError) && m) throw new VendorStaffError(m[1]);
    throw e;
  }
}

// One-time setup: the first platform owner and the first allowed IP range.
export async function bootstrapVendor(op: pg.ClientBase, accountId: string, name: string, cidr: string, label: string): Promise<string> {
  return (await run(op, `select vendor_bootstrap($1, $2, $3, $4) as r`, [accountId, name, cidr, label])).id!;
}

export async function createVendorStaff(op: pg.ClientBase, c: VendorCaller, accountId: string, name: string, roles: VendorRole[]): Promise<string> {
  return (await run(op, `select vendor_staff_create($1, $2, $3, $4, $5, $6) as r`, [c.accountId, c.ip, c.mfaAt, accountId, name, roles])).id!;
}

export async function updateVendorStaff(op: pg.ClientBase, c: VendorCaller, staffId: string, roles: VendorRole[], state: "active" | "suspended" | "exited"): Promise<void> {
  await run(op, `select vendor_staff_update($1, $2, $3, $4, $5, $6) as r`, [c.accountId, c.ip, c.mfaAt, staffId, roles, state]);
}

export async function setVendorIpAllowlist(op: pg.ClientBase, c: VendorCaller, cidr: string, label: string, add: boolean): Promise<void> {
  await run(op, `select vendor_ip_allowlist_set($1, $2, $3, $4, $5, $6) as r`, [c.accountId, c.ip, c.mfaAt, cidr, label, add]);
}

export type RequestPayload =
  | { kind: "suspension" | "exit" | "reactivation" | "closure" }
  | { kind: "server_fee_change"; amountRupiah: number; effectiveMonth: string }
  | { kind: "invoice_waiver"; invoiceId: string; amountRupiah: number }
  | { kind: "clinical_grant"; staffId: string }
  | { kind: "dual_identity"; accountId: string };

function payloadJson(p: RequestPayload): Record<string, unknown> {
  switch (p.kind) {
    case "suspension": case "exit": case "reactivation": case "closure": return {};
    case "server_fee_change": return { amount_rupiah: p.amountRupiah, effective_month: p.effectiveMonth };
    case "invoice_waiver": return { invoice_id: p.invoiceId, amount_rupiah: p.amountRupiah };
    case "clinical_grant": return { staff_id: p.staffId };
    case "dual_identity": return { account_id: p.accountId };
  }
}

// Ajukan (19 §3): a maker-checker request for a tenant.
export async function requestVendorAction(op: pg.ClientBase, c: VendorCaller, tenantId: string, p: RequestPayload, reason: string): Promise<string> {
  return (await run(op, `select vendor_request($1, $2, $3, $4, $5, $6::jsonb, $7) as r`, [c.accountId, c.ip, c.mfaAt, p.kind, tenantId, JSON.stringify(payloadJson(p)), reason])).id!;
}

// Setujui / Tolak by the platform owner (never the requester).
export async function decideVendorRequest(op: pg.ClientBase, c: VendorCaller, requestId: string, approve: boolean, reason?: string): Promise<"approved" | "rejected"> {
  return (await run(op, `select vendor_request_decide($1, $2, $3, $4, $5, $6) as r`, [c.accountId, c.ip, c.mfaAt, requestId, approve, reason ?? null])).state as "approved" | "rejected";
}

// The task that executes an approved request consumes it once (within 30 days of approval)
// INSIDE the transaction that applies its effect, on a clinic_executor login: a failed
// effect rolls the consumption back. `service` is the executing service's name (audited,
// anchored to the login). Refusals raise; the worker then rolls back and records the
// refusal with `recordConsumeRefusal` on its own connection. The task re-validates its own
// preconditions before acting (clinical grant subject still active with support or
// onboarding; waiver invoice belongs to the tenant).
export async function consumeVendorRequest(
  tx: pg.ClientBase, requestId: string, kind: Exclude<VendorRequestKind, "dual_identity">, tenantId: string, service: string,
): Promise<Record<string, unknown>> {
  if ((tx as pg.Client).getTransactionStatus?.() !== "T") throw new VendorStaffError("ERR_FORBIDDEN", "call inside the effect's transaction");
  try {
    return (await tx.query<{ p: Record<string, unknown> }>(`select vendor_request_consume($1, $2, $3, $4) as p`, [requestId, kind, tenantId, service])).rows[0].p;
  } catch (e) {
    const m = /^(ERR_[A-Z_]+): .*?(?:\((\w+)\))?$/.exec((e as { message?: string }).message ?? "");
    if (m) throw new VendorStaffError(m[1], m[2]);
    throw e;
  }
}

export const CONSUME_REFUSALS = new Set(["not_found", "not_approved", "already_consumed", "approval_expired", "effective_month_passed", "approver_inactive"]);

// The one way a worker applies an approved request: consume and the effect in one
// transaction on a clinic_executor pool; on a consumption refusal the transaction is rolled
// back (effect and consumption both undone) and the refusal is recorded durably on the
// same, now idle, connection before the error is rethrown. Any other failure (the effect's
// own) just rolls back.
export async function executeVendorRequest<R>(
  pool: pg.Pool, requestId: string, kind: Exclude<VendorRequestKind, "dual_identity">, tenantId: string, service: string,
  effect: (tx: pg.PoolClient, payload: Record<string, unknown>) => Promise<R>,
): Promise<R> {
  const tx = await pool.connect();
  try {
    await tx.query("begin");
    let payload: Record<string, unknown>;
    try {
      payload = await consumeVendorRequest(tx, requestId, kind, tenantId, service);
    } catch (e) {
      await tx.query("rollback");
      // Only a refusal raised by consume itself is a consumption refusal.
      if (e instanceof VendorStaffError && e.reason && CONSUME_REFUSALS.has(e.reason)) {
        await recordConsumeRefusal(tx, requestId, kind, tenantId, service, e.reason);
      }
      throw e;
    }
    try {
      const r = await effect(tx, payload);
      await tx.query("commit");
      return r;
    } catch (e) {
      await tx.query("rollback");
      throw e;
    }
  } finally {
    tx.release();
  }
}

export async function recordConsumeRefusal(
  db: pg.ClientBase, requestId: string, kind: Exclude<VendorRequestKind, "dual_identity">, tenantId: string, service: string, reason: string,
): Promise<void> {
  if ((db as pg.Client).getTransactionStatus?.() !== "I") throw new VendorStaffError("ERR_FORBIDDEN", "call outside an open transaction");
  await db.query(`select vendor_request_consume_refused($1, $2, $3, $4, $5)`, [requestId, kind, tenantId, service, reason]);
}

// Batalkan: the requester withdraws a pending request.
export async function cancelVendorRequest(op: pg.ClientBase, c: VendorCaller, requestId: string): Promise<void> {
  await run(op, `select vendor_request_cancel($1, $2, $3, $4) as r`, [c.accountId, c.ip, c.mfaAt, requestId]);
}

// Clinic app, Akses Vendor: the clinic owner's half of a dual identity (runs on the
// owner's client inside withTenantContext). A refusal is audited in the database and
// returned (the caller's transaction commits it); this maps it to a TD-51 code.
const CLINIC_REFUSAL: Record<string, string> = {
  not_owner: "ERR_FORBIDDEN", not_found: "ERR_NOT_FOUND", approver_is_requester: "ERR_APPROVER_IS_REQUESTER", already_decided: "ERR_VERSION_CONFLICT",
};
export async function vendorDualIdentityClinicDecide(db: pg.ClientBase, requestId: string, approve: boolean): Promise<"approved" | "rejected" | { refused: string }> {
  const s = (await db.query<{ s: string }>(`select vendor_dual_identity_clinic_decide($1, $2) as s`, [requestId, approve])).rows[0].s;
  if (s === "approved" || s === "rejected") return s;
  const reason = s.replace(/^refused:/, "");
  return { refused: CLINIC_REFUSAL[reason] ?? "ERR_FORBIDDEN" };
}

// Saya › Akses Vendor › Cabut (DEC-030 (1), DEC-044): the acting Owner revokes an effective dual
// identity; the subject's clinic membership in this tenant ends at once (the database decides).
const REVOKE_REFUSAL: Record<string, string> = {
  not_owner: "ERR_FORBIDDEN", not_found: "ERR_NOT_FOUND", self: "ERR_FORBIDDEN_SELF", not_effective: "ERR_VERSION_CONFLICT",
};
export async function vendorDualIdentityClinicRevoke(db: pg.ClientBase, requestId: string): Promise<"revoked" | { refused: string }> {
  const s = (await db.query<{ s: string }>(`select vendor_dual_identity_clinic_revoke($1) as s`, [requestId])).rows[0].s;
  if (s === "revoked") return s;
  return { refused: REVOKE_REFUSAL[s.replace(/^refused:/, "")] ?? "ERR_FORBIDDEN" };
}

export type DualIdentity = { requestId: string; accountId: string; vendorName: string | null; state: string; effective: boolean; requestedAt: Date; platformDecidedAt: Date | null; clinicApprovedAt: Date | null; revokedAt: Date | null };

export async function vendorDualIdentities(db: pg.ClientBase): Promise<DualIdentity[]> {
  return (await db.query(`select * from vendor_dual_identities()`)).rows.map((r) => ({
    requestId: r.request_id, accountId: r.account_id, vendorName: r.vendor_name, state: r.state, effective: r.effective,
    requestedAt: r.requested_at, platformDecidedAt: r.platform_decided_at, clinicApprovedAt: r.clinic_approved_at, revokedAt: r.revoked_at,
  }));
}
