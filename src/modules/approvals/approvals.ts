// Approvals engine (PR-37, DATA-41, BILL-23, TD-51). Server code over the approval_*
// functions; runs on the caller's client inside withTenantContext. Database refusals come
// back as TD-51 CommandErrors (ERR_APPROVER_IS_REQUESTER, ERR_FORBIDDEN, ERR_NOT_FOUND,
// ERR_VERSION_CONFLICT) so screens show the catalog message; a missing mandatory reason is
// ERR_FORBIDDEN (the TD-51 catalog has no reason code; the screen names the field).
import type pg from "pg";
import { CommandError, type ErrorCode } from "../../lib/command";

const CODE = /^(ERR_[A-Z_]+):/;
// Only the codes these functions raise (TD-51 catalog); anything else stays a raw error.
const KNOWN = new Set<string>(["ERR_APPROVER_IS_REQUESTER", "ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_VERSION_CONFLICT", "ERR_IDEMPOTENCY_CONFLICT"]);

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new CommandError(m[1] as ErrorCode);
    throw e;
  }
}

// The consumer that later acts on an approved request must verify that the subject (its
// tenant, branch and amount) is the one approved; the approval names it, nothing more.
export type ApprovalRequest = {
  type: string;
  subjectKind: string;
  subjectId: string;
  reason?: string;
  branchId?: string; // tenant-wide requesters name the subject's branch
  amountRupiah?: number; // integer rupiah, for SET-43 thresholds
};

export async function requestApproval(db: pg.ClientBase, r: ApprovalRequest): Promise<string> {
  return call(async () =>
    (await db.query<{ id: string }>(`select approval_request($1, $2, $3, $4, $5, $6) as id`, [
      r.type, r.subjectKind, r.subjectId, r.reason ?? null, r.branchId ?? null, r.amountRupiah ?? null,
    ])).rows[0].id,
  );
}

export async function decideApproval(db: pg.ClientBase, approvalId: string, approve: boolean, reason?: string): Promise<"approved" | "rejected"> {
  return call(async () =>
    (await db.query<{ s: "approved" | "rejected" }>(`select approval_decide($1, $2, $3) as s`, [approvalId, approve, reason ?? null])).rows[0].s,
  );
}

// B-14: whitelisted types only (write_off); the reason is mandatory.
export async function ownerSelfApprove(db: pg.ClientBase, r: ApprovalRequest & { reason: string }): Promise<string> {
  return call(async () =>
    (await db.query<{ id: string }>(`select approval_owner_self($1, $2, $3, $4, $5, $6) as id`, [
      r.type, r.subjectKind, r.subjectId, r.reason, r.branchId ?? null, r.amountRupiah ?? null,
    ])).rows[0].id,
  );
}

export async function cancelApproval(db: pg.ClientBase, approvalId: string): Promise<void> {
  await call(() => db.query(`select approval_cancel($1)`, [approvalId]));
}

export type Approval = {
  id: string;
  type: string;
  state: "pending" | "approved" | "rejected" | "cancelled";
  requestedBy: string;
  requestedAs: string;
  decidedBy: string | null;
  ownerSelf: boolean;
  branchId: string | null;
  subjectKind: string;
  subjectId: string;
};

// Persetujuan inbox (UX-26 data): RLS decides which approvals the acting role reads.
export async function listApprovals(db: pg.ClientBase, filter: { state?: Approval["state"]; type?: string } = {}): Promise<Approval[]> {
  const { rows } = await db.query(
    `select id, type, state, requested_by, requested_as, decided_by, owner_self, branch_id, subject_kind, subject_id
       from approvals
      where ($1::text is null or state = $1) and ($2::text is null or type = $2)
      order by requested_at desc, id desc limit 200`,
    [filter.state ?? null, filter.type ?? null],
  );
  return rows.map((r) => ({
    id: r.id, type: r.type, state: r.state, requestedBy: r.requested_by, requestedAs: r.requested_as,
    decidedBy: r.decided_by, ownerSelf: r.owner_self, branchId: r.branch_id, subjectKind: r.subject_kind, subjectId: r.subject_id,
  }));
}
