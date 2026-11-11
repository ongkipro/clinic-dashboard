// T-011 Done-when: scenario PR-37 passes; a requester approving their own request is
// refused with a TD-51 code; an owner write-off without a reason is refused.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { cancelApproval, decideApproval, listApprovals, ownerSelfApprove, requestApproval } from "../../src/modules/approvals/approvals";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { createHarness, type Harness, testPool } from "../rls/harness";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
type T = { tenantId: string; b1: string; b2: string };

async function tenant(): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry default values returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("B1"), b2: await br("B2") };
}

async function person(t: T, roles: Role[], branch?: string): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`a${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf ${n}` });
  for (const role of roles) {
    const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
    if (branch && !["owner", "finance", "admin_pusat", "purchasing"].includes(role)) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: branch });
  }
  return { acc, staffId, tenantId: t.tenantId, role: roles[0], branch };
}

const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>, role: Role = p.role) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: role, activeBranchId: ["owner", "finance", "purchasing"].includes(role) ? undefined : p.branch }), fn);

const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const subject = () => crypto.randomUUID();

let T1: T;
let T2: T;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 4 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  T1 = await tenant();
  T2 = await tenant();
});

afterAll(async () => {
  await owner?.end();
  await app?.end();
  await h?.close();
});

describe("scenario PR-37 maker-checker", () => {
  it("a manager's refund exception cannot be approved by the same manager (ERR_APPROVER_IS_REQUESTER)", async () => {
    const mgr = await person(T1, ["manager"], T1.b1);
    const id = await as(mgr, (db) => requestApproval(db, { type: "refund_exception", subjectKind: "refund", subjectId: subject(), reason: "Pasien batal" }));
    expect(await code(as(mgr, (db) => decideApproval(db, id, true)))).toBe("ERR_APPROVER_IS_REQUESTER");
    const err = await as(mgr, (db) => decideApproval(db, id, true)).catch((e) => e);
    expect(err).toMatchObject({ code: "ERR_APPROVER_IS_REQUESTER", http: 422 });
    const own = await person(T1, ["owner"]);
    expect(await as(own, (db) => decideApproval(db, id, true))).toBe("approved");
  });

  it("cash refunds are approved by the owner only until the tenant setting allows a manager (SET-11)", async () => {
    const fo = await person(T1, ["fo_cashier"], T1.b1);
    const id = await as(fo, (db) => requestApproval(db, { type: "refund_exception", subjectKind: "refund", subjectId: subject() }));
    const mgr = await person(T1, ["manager"], T1.b1);
    expect(await code(as(mgr, (db) => decideApproval(db, id, true)))).toBe("ERR_FORBIDDEN");
  });

  it("the same person through another role is still the requester", async () => {
    const both = await person(T1, ["manager", "owner"], T1.b1);
    const id = await as(both, (db) => requestApproval(db, { type: "refund_exception", subjectKind: "refund", subjectId: subject() }), "manager");
    expect(await code(as(both, (db) => decideApproval(db, id, true), "owner"))).toBe("ERR_APPROVER_IS_REQUESTER");
  });

  it("every PR-37 type refuses self-approval, and the database refuses it even past the function", async () => {
    for (const [type, role] of [
      ["refund_exception", "fo_cashier"], ["write_off", "fo_cashier"], ["attribution_correction", "manager"],
      ["commission_batch", "finance"], ["stock_adjustment", "pharmacist"], ["disposal", "manager"],
    ] as const) {
      const p = await person(T1, [role, "owner"], T1.b1);
      const id = await as(p, (db) => requestApproval(db, { type, subjectKind: "subject", subjectId: subject() }), role);
      expect(await code(as(p, (db) => decideApproval(db, id, true), "owner")), type).toBe("ERR_APPROVER_IS_REQUESTER");
    }
    const row = (await h.admin.query(`select id, requested_by from approvals where state = 'pending' limit 1`)).rows[0];
    await expect(
      h.admin.query(`update approvals set state = 'approved', decided_by = requested_by, decided_as = 'owner', decided_at = now() where id = $1`, [row.id]),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("scenario PR-37 owner write-off (B-14, BILL-23)", () => {
  it("the owner writes off alone with a reason: recorded as requester and approver, audited", async () => {
    const own = await person(T1, ["owner"]);
    const receivable = subject();
    const id = await as(own, (db) => ownerSelfApprove(db, { type: "write_off", subjectKind: "receivable", subjectId: receivable, reason: "Piutang Rp150.000 lewat 90 hari, tidak tertagih" }));
    const row = (await h.admin.query(`select * from approvals where id = $1`, [id])).rows[0];
    expect(row).toMatchObject({ state: "approved", requested_by: own.staffId, decided_by: own.staffId, requested_as: "owner", decided_as: "owner", owner_self: true });
    expect(row.decision_reason).toContain("tidak tertagih");
    const audit = (await h.admin.query(`select reason_code, reason, acting_role from audit_events where object_id = $1`, [id])).rows;
    // The audit row carries the code; the free-text reason stays on the approval (T-008:
    // audit_events holds free text only for break-glass).
    expect(audit).toEqual([{ reason_code: "approval_owner_self", reason: null, acting_role: "owner" }]);
    const ev = (await h.admin.query(`select type, payload from domain_events where aggregate_id = $1`, [id])).rows;
    expect(ev).toEqual([{ type: "ApprovalDecided", payload: { approval_type: "write_off", outcome: "approved", owner_self: true, subject_kind: "receivable", subject_id: receivable } }]);
  });

  it("an owner write-off without a reason (or a token reason) is refused", async () => {
    const own = await person(T1, ["owner"]);
    for (const reason of ["", "   ", "ok"]) {
      expect(await code(as(own, (db) => ownerSelfApprove(db, { type: "write_off", subjectKind: "receivable", subjectId: subject(), reason }))), JSON.stringify(reason)).toBe("ERR_FORBIDDEN");
    }
  });

  it("only whitelisted types allow the owner alone; only the owner acts alone", async () => {
    const own = await person(T1, ["owner"]);
    expect(await code(as(own, (db) => ownerSelfApprove(db, { type: "refund_exception", subjectKind: "refund", subjectId: subject(), reason: "Alasan yang cukup panjang" })))).toBe("ERR_APPROVER_IS_REQUESTER");
    const fin = await person(T1, ["finance"]);
    expect(await code(as(fin, (db) => ownerSelfApprove(db, { type: "write_off", subjectKind: "receivable", subjectId: subject(), reason: "Alasan yang cukup panjang" })))).toBe("ERR_FORBIDDEN");
  });
});

describe("roles, scope and lifecycle", () => {
  it("a role outside the type's requester or approver list is refused (07 matrix)", async () => {
    const nurse = await person(T1, ["nurse"], T1.b1);
    expect(await code(as(nurse, (db) => requestApproval(db, { type: "refund_exception", subjectKind: "refund", subjectId: subject() })))).toBe("ERR_FORBIDDEN");
    const fo = await person(T1, ["fo_cashier"], T1.b1);
    const id = await as(fo, (db) => requestApproval(db, { type: "write_off", subjectKind: "receivable", subjectId: subject() }));
    const mgr = await person(T1, ["manager"], T1.b1);
    expect(await code(as(mgr, (db) => decideApproval(db, id, true)))).toBe("ERR_FORBIDDEN"); // write-off: owner only
  });

  it("a branch approver decides only its own branches' requests; tenant-wide requests name their branch", async () => {
    const fo = await person(T1, ["fo_cashier"], T1.b2);
    const id = await as(fo, (db) => requestApproval(db, { type: "attribution_correction", subjectKind: "invoice_line", subjectId: subject() }));
    const mgr1 = await person(T1, ["manager"], T1.b1);
    expect(await code(as(mgr1, (db) => decideApproval(db, id, true)))).toBe("ERR_NOT_FOUND"); // not even visible
    const mgr2 = await person(T1, ["manager"], T1.b2);
    expect(await as(mgr2, (db) => decideApproval(db, id, true))).toBe("approved");
    // Finance (tenant-wide) names the subject's branch; only that branch's manager sees it.
    const fin = await person(T1, ["finance"]);
    const id2 = await as(fin, (db) => requestApproval(db, { type: "attribution_correction", subjectKind: "invoice_line", subjectId: subject(), branchId: T1.b2 }));
    expect(await code(as(mgr1, (db) => decideApproval(db, id2, true)))).toBe("ERR_NOT_FOUND");
    expect(await as(mgr2, (db) => decideApproval(db, id2, true))).toBe("approved");
    // A tenant-wide request without a branch is for the owner only.
    const id3 = await as(fin, (db) => requestApproval(db, { type: "attribution_correction", subjectKind: "invoice_line", subjectId: subject() }));
    expect(await code(as(mgr2, (db) => decideApproval(db, id3, true)))).toBe("ERR_NOT_FOUND");
    // A branch role cannot file for another branch.
    expect(await code(as(fo, (db) => requestApproval(db, { type: "attribution_correction", subjectKind: "invoice_line", subjectId: subject(), branchId: T1.b1 })))).toBe("ERR_FORBIDDEN");
  });

  it("a non-reader learns nothing about an approval (no existence or state leak)", async () => {
    const fo = await person(T1, ["fo_cashier"], T1.b1);
    const own = await person(T1, ["owner"]);
    const pending = await as(fo, (db) => requestApproval(db, { type: "refund_exception", subjectKind: "refund", subjectId: subject() }));
    const decided = await as(fo, (db) => requestApproval(db, { type: "refund_exception", subjectKind: "refund", subjectId: subject() }));
    await as(own, (db) => decideApproval(db, decided, true));
    const nurse = await person(T1, ["nurse"], T1.b1);
    for (const id of [pending, decided, subject()]) expect(await code(as(nurse, (db) => decideApproval(db, id, true)))).toBe("ERR_NOT_FOUND");
  });

  it("a second request for the same subject is refused while one is pending or granted", async () => {
    const fo = await person(T1, ["fo_cashier"], T1.b1);
    const own = await person(T1, ["owner"]);
    const s = subject();
    const id = await as(fo, (db) => requestApproval(db, { type: "write_off", subjectKind: "receivable", subjectId: s, amountRupiah: 150_000 }));
    expect(await code(as(fo, (db) => requestApproval(db, { type: "write_off", subjectKind: "receivable", subjectId: s })))).toBe("ERR_IDEMPOTENCY_CONFLICT");
    expect(await code(as(own, (db) => ownerSelfApprove(db, { type: "write_off", subjectKind: "receivable", subjectId: s, reason: "Alasan yang cukup panjang" })))).toBe("ERR_IDEMPOTENCY_CONFLICT");
    await as(own, (db) => decideApproval(db, id, false, "Masih bisa ditagih"));
    // After a rejection the subject may be requested again.
    await expect(as(fo, (db) => requestApproval(db, { type: "write_off", subjectKind: "receivable", subjectId: s }))).resolves.toBeTypeOf("string");
  });

  it("a decided approval is final in the database too; nothing is deleted", async () => {
    const fo = await person(T1, ["fo_cashier"], T1.b1);
    const own = await person(T1, ["owner"]);
    const id = await as(fo, (db) => requestApproval(db, { type: "refund_exception", subjectKind: "refund", subjectId: subject() }));
    await as(own, (db) => decideApproval(db, id, true));
    await expect(h.admin.query(`update approvals set state = 'rejected' where id = $1`, [id])).rejects.toMatchObject({ code: "42501" });
    await expect(h.admin.query(`delete from approvals where id = $1`, [id])).rejects.toMatchObject({ code: "42501" });
    await expect(h.admin.query(`update approvals set subject_id = $2 where id = $1`, [id, subject()])).rejects.toMatchObject({ code: "42501" });
    await expect(
      h.admin.query(`insert into approvals (tenant_id, type, subject_kind, subject_id, requested_by, requested_as, state, decided_by, decided_as, decided_at, decision_reason, owner_self)
                     values ($1, 'refund_exception', 'refund', $2, $3, 'owner', 'approved', $3, 'owner', now(), 'Alasan yang cukup panjang', true)`, [T1.tenantId, subject(), own.staffId]),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("a decided approval cannot be decided again; a rejection needs a reason; the requester may cancel", async () => {
    const fo = await person(T1, ["fo_cashier"], T1.b1);
    const own = await person(T1, ["owner"]);
    const id = await as(fo, (db) => requestApproval(db, { type: "refund_exception", subjectKind: "refund", subjectId: subject() }));
    expect(await code(as(own, (db) => decideApproval(db, id, false)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(own, (db) => db.query(`select approval_decide($1, null, 'x')`, [id]).then(() => undefined)))).toMatch(/ERR_FORBIDDEN|raw:/);
    expect((await h.admin.query(`select state from approvals where id = $1`, [id])).rows[0].state).toBe("pending");
    expect(await as(own, (db) => decideApproval(db, id, false, "Tidak sesuai kebijakan"))).toBe("rejected");
    expect(await code(as(own, (db) => decideApproval(db, id, true)))).toBe("ERR_VERSION_CONFLICT");
    const id2 = await as(fo, (db) => requestApproval(db, { type: "refund_exception", subjectKind: "refund", subjectId: subject() }));
    await as(fo, (db) => cancelApproval(db, id2));
    expect(await code(as(own, (db) => decideApproval(db, id2, true)))).toBe("ERR_VERSION_CONFLICT");
    const ev = (await h.admin.query(`select payload->>'outcome' as o from domain_events where aggregate_id = $1`, [id2])).rows.map((r) => r.o);
    expect(ev).toEqual([null, "cancelled"]);
  });

  it("every step is audited and emits an ID-only event", async () => {
    const own = await person(T1, ["owner"]);
    const ph = await person(T1, ["pharmacist"], T1.b1);
    const id = await as(ph, (db) => requestApproval(db, { type: "disposal", subjectKind: "stock_batch", subjectId: subject() }));
    await as(own, (db) => decideApproval(db, id, true));
    const audit = (await h.admin.query(`select reason_code from audit_events where object_id = $1 order by seq`, [id])).rows.map((r) => r.reason_code);
    expect(audit).toEqual(["approval_requested", "approval_approved"]);
    const ev = (await h.admin.query(`select type from domain_events where aggregate_id = $1 order by id`, [id])).rows.map((r) => r.type);
    expect(ev).toEqual(["ApprovalRequested", "ApprovalDecided"]);
  });

  it("the inbox shows the tenant's approvals to readers only; requesters see their own; no cross-tenant view or decision", async () => {
    const fo = await person(T1, ["fo_cashier"], T1.b1);
    const id = await as(fo, (db) => requestApproval(db, { type: "refund_exception", subjectKind: "refund", subjectId: subject() }));
    const own = await person(T1, ["owner"]);
    expect((await as(own, (db) => listApprovals(db, { state: "pending" }))).map((a) => a.id)).toContain(id);
    expect((await as(fo, (db) => listApprovals(db))).every((a) => a.requestedBy === fo.staffId)).toBe(true);
    const nurse = await person(T1, ["nurse"], T1.b1);
    expect(await as(nurse, (db) => listApprovals(db))).toEqual([]);
    const other = await person(T2, ["owner"]);
    expect((await as(other, (db) => listApprovals(db))).map((a) => a.id)).not.toContain(id);
    expect(await code(as(other, (db) => decideApproval(db, id, true)))).toBe("ERR_NOT_FOUND");
  });

  it("clinic_app cannot write approvals directly or add approval types", async () => {
    const own = await person(T1, ["owner"]);
    for (const sql of [
      `insert into approvals (tenant_id, type, subject_kind, subject_id, requested_by, requested_as) values ('${T1.tenantId}', 'write_off', 'x', '${subject()}', '${own.staffId}', 'owner')`,
      `update approvals set state = 'approved'`,
      `delete from approvals`,
      `insert into approval_types (key, label, requester_roles, approver_roles) values ('nope', 'x', '{owner}', '{owner}')`,
    ]) {
      await expect(as(own, (db) => db.query(sql)), sql).rejects.toMatchObject({ code: "42501" });
    }
  });
});

describe("regression: app_branch_allowed never fails open (T-016)", () => {
  it("a manager context with an empty branch list cannot decide a branch request", async () => {
    const fo = await person(T1, ["fo_cashier"], T1.b1);
    const id = await as(fo, (db) => requestApproval(db, { type: "attribution_correction", subjectKind: "invoice_line", subjectId: subject() }));
    const mgr = await person(T1, ["manager"], T1.b1);
    const ctx = { tenantId: T1.tenantId, allowedBranchIds: [] as string[], activeBranchId: T1.b1, roles: ["manager"], staffId: mgr.staffId };
    expect(await code(withTenantContext(app, ctx, (db) => decideApproval(db, id, true)))).toBe("ERR_NOT_FOUND");
  });
});
