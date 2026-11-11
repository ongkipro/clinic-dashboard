// HYG-013 (DEC-030 (1), DEC-044; PR-57, IAM-10): the clinic Owner revokes an approved dual
// vendor/clinic identity. The subject's clinic membership in this tenant ends at once (sessions
// revoked, duties ended, invitations re-checked); the vendor account is untouched; the request keeps
// both approvals and records the revocation; a membership cannot come back without a new request.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import {
  bootstrapVendor, createVendorStaff, decideVendorRequest, requestVendorAction, type VendorCaller,
  vendorDualIdentities, vendorDualIdentityClinicDecide, vendorDualIdentityClinicRevoke,
} from "../../src/modules/vendor/staff/staff";
import { createHarness, type Harness, testPool } from "../rls/harness";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let opPool: pg.Pool;
let op: pg.PoolClient;
let n = 0;
const IP = "203.0.113.10";
const caller = (accountId: string): VendorCaller => ({ accountId, ip: IP, mfaAt: new Date() });

let PO: string;
let SUP: string;

async function account(totp = true): Promise<string> {
  return (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('A', $1, $2) returning id`, [`a${++n}@sintetis.test`, totp])).rows[0].id as string;
}
async function tenant(): Promise<string> {
  const id = (await h.admin.query(`insert into tenants_registry default values returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Sintetis', 'emkm')`, [id]);
  return id;
}
async function member(t: string, acc: string, role: Role): Promise<string> {
  const { staffId } = await createMembership(owner, { tenantId: t, accountId: acc, displayName: `Staf ${n}` });
  await assignRole(h.admin, { tenantId: t, staffId, role });
  return staffId;
}
const as = async <R>(acc: string, t: string, role: Role, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, acc, { tenantId: t, actingRole: role }), fn);

// A clinic with its Owner, and a vendor staff account (support) that is also a member with `role`
// through a dual identity approved by a platform owner and that Owner.
async function setup(role: Role = "admin_pusat") {
  const t = await tenant();
  const ownerAcc = await account();
  const ownerStaff = await member(t, ownerAcc, "owner");
  const subject = await account();
  await createVendorStaff(op, caller(PO), subject, `Petugas Ganda ${n}`, ["support"]);
  const req = await requestVendorAction(op, caller(SUP), t, { kind: "dual_identity", accountId: subject }, "Petugas vendor membantu klinik");
  expect(await decideVendorRequest(op, caller(PO), req, true)).toBe("approved");
  expect(await as(ownerAcc, t, "owner", (db) => vendorDualIdentityClinicDecide(db, req, true))).toBe("approved");
  const subjectStaff = await member(t, subject, role);
  return { t, ownerAcc, ownerStaff, subject, subjectStaff, req };
}
// Waits until some backend is blocked by `pid` (or, for waitBlocked, until `pid` itself is blocked).
async function waitBlockedBy(c: pg.PoolClient, pid: number) {
  for (let i = 0; i < 400; i++) {
    if ((await c.query(`select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))`, [pid])).rows[0].n > 0) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`nothing blocked by ${pid}`);
}
async function waitBlocked(c: pg.PoolClient, pid: number) {
  for (let i = 0; i < 400; i++) {
    if ((await c.query(`select cardinality(pg_blocking_pids($1))::int as n`, [pid])).rows[0].n > 0) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`${pid} never blocked`);
}
const audit = async (t: string, object: string) =>
  // Clinic-side rows only (the vendor's request and platform decision are chained too, by vendor staff).
  (await h.admin.query(`select object_kind, outcome, reason_code from audit_events where tenant_id = $1 and object_id = $2 and staff_id is not null order by seq`, [t, object])).rows;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 3 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 3 });
  opPool = testPool({ connectionString: h.ownerUrl(), max: 1 });
  op = await opPool.connect();
  PO = await account();
  await bootstrapVendor(op, PO, "Pemilik Platform", "203.0.113.0/24", "Kantor vendor");
  SUP = await account();
  await createVendorStaff(op, caller(PO), SUP, "Dukungan Vendor", ["support"]);
});

afterAll(async () => {
  op?.release();
  await opPool?.end();
  await owner?.end();
  await app?.end();
  await h?.close();
});

describe("HYG-013: the Owner revokes an effective dual identity (DEC-044)", () => {
  it("revoking ends the membership here at once (sessions, duties, invitations); the vendor account stays; the request keeps its history", async () => {
    const x = await setup("admin_pusat");
    const sess = (await h.admin.query(
      `insert into auth_session (user_id, token, expires_at, created_at, updated_at, user_agent, last_active_at)
       values ($1, $2, now() + interval '12 hours', now(), now(), 'Laptop', now()) returning id`, [x.subject, crypto.randomUUID()])).rows[0].id as string;
    await h.admin.query(`insert into staff_duties (tenant_id, staff_id, duty, assigned_by) values ($1, $2, 'it_admin', $3)`, [x.t, x.subjectStaff, x.ownerStaff]);
    const inv = (await h.admin.query(
      `insert into staff_invitations (tenant_id, email, display_name, roles, branch_ids, token_hash, invited_by, expires_at)
       values ($1, 'calon@klinik-sintetis.test', 'Calon', '{manager}', '{}', $2, $3, now() + interval '1 day') returning id`,
      [x.t, crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, ""), x.subjectStaff])).rows[0].id as string;
    const before = (await as(x.ownerAcc, x.t, "owner", vendorDualIdentities)).find((d) => d.requestId === x.req)!;
    expect(before).toMatchObject({ effective: true, revokedAt: null });

    expect(await as(x.ownerAcc, x.t, "owner", (db) => vendorDualIdentityClinicRevoke(db, x.req))).toBe("revoked");

    const m = (await h.admin.query(`select effective_to from memberships where tenant_id = $1 and account_id = $2`, [x.t, x.subject])).rows[0];
    expect(m.effective_to).not.toBeNull();
    expect(new Date(m.effective_to).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect((await h.admin.query(`select ended_at from staff_duties where staff_id = $1`, [x.subjectStaff])).rows[0].ended_at).not.toBeNull();
    expect((await h.admin.query(`select state from staff_invitations where id = $1`, [inv])).rows[0].state).toBe("cancelled");
    const rev = (await h.admin.query(`select reason, session_ids, revoked_by from membership_revocations where tenant_id = $1 order by revoked_at desc limit 1`, [x.t])).rows[0];
    expect(rev).toEqual({ reason: "membership_ended", session_ids: [sess], revoked_by: x.ownerStaff });
    // The subject can no longer act here.
    await expect(resolveContext(app, x.subject, { tenantId: x.t, actingRole: "admin_pusat" })).rejects.toThrow();
    // The vendor account is not touched.
    expect((await h.admin.query(`select state from vendor_staff where account_id = $1`, [x.subject])).rows[0].state).toBe("active");
    // History: both approvals kept, the revocation recorded; listed as revoked, not effective.
    const row = (await h.admin.query(`select state, decided_by, clinic_approved_at, clinic_revoked_by, clinic_revoked_account, clinic_revoked_at from vendor_requests where id = $1`, [x.req])).rows[0];
    expect(row).toMatchObject({ state: "approved", clinic_revoked_by: x.ownerStaff, clinic_revoked_account: x.ownerAcc });
    expect(row.decided_by).not.toBeNull();
    expect(row.clinic_approved_at).not.toBeNull();
    expect(row.clinic_revoked_at).not.toBeNull();
    const after = (await as(x.ownerAcc, x.t, "owner", vendorDualIdentities)).find((d) => d.requestId === x.req)!;
    expect(after).toMatchObject({ effective: false, state: "approved" });
    expect(after.revokedAt).not.toBeNull();
    expect((await audit(x.t, x.req)).at(-1)).toEqual({ object_kind: "vendor_request", outcome: "success", reason_code: "vendor_dual_identity_revoked" });
    // A membership cannot come back without a new request: re-opening is refused by the guard.
    await expect(h.admin.query(`update memberships set effective_to = null where tenant_id = $1 and account_id = $2`, [x.t, x.subject])).rejects.toThrow(/membership not allowed/);
    expect((await h.admin.query(`select vendor_dual_approved($1, $2) as ok`, [x.subject, x.t])).rows[0].ok).toBe(false);
    // A new dual identity with both approvals makes it approved again.
    const again = await requestVendorAction(op, caller(SUP), x.t, { kind: "dual_identity", accountId: x.subject }, "Petugas kembali membantu klinik");
    expect(await decideVendorRequest(op, caller(PO), again, true)).toBe("approved");
    expect(await as(x.ownerAcc, x.t, "owner", (db) => vendorDualIdentityClinicDecide(db, again, true))).toBe("approved");
    expect((await h.admin.query(`select vendor_dual_approved($1, $2) as ok`, [x.subject, x.t])).rows[0].ok).toBe(true);
  });

  it("refused and audited: a non-Owner, the subject itself, another tenant's Owner, a second revoke, an identity not yet effective", async () => {
    const x = await setup("owner"); // the subject is also an Owner of this clinic
    const ap = await account();
    await member(x.t, ap, "admin_pusat");
    expect(await as(ap, x.t, "admin_pusat", (db) => vendorDualIdentityClinicRevoke(db, x.req))).toEqual({ refused: "ERR_FORBIDDEN" });
    expect(await as(x.subject, x.t, "owner", (db) => vendorDualIdentityClinicRevoke(db, x.req))).toEqual({ refused: "ERR_FORBIDDEN_SELF" });
    const other = await tenant();
    const otherOwner = await account();
    await member(other, otherOwner, "owner");
    expect(await as(otherOwner, other, "owner", (db) => vendorDualIdentityClinicRevoke(db, x.req))).toEqual({ refused: "ERR_NOT_FOUND" });
    // Nothing changed so far.
    expect((await h.admin.query(`select clinic_revoked_at from vendor_requests where id = $1`, [x.req])).rows[0].clinic_revoked_at).toBeNull();
    expect((await h.admin.query(`select effective_to from memberships where tenant_id = $1 and account_id = $2`, [x.t, x.subject])).rows[0].effective_to).toBeNull();
    expect(await as(x.ownerAcc, x.t, "owner", (db) => vendorDualIdentityClinicRevoke(db, x.req))).toBe("revoked");
    expect(await as(x.ownerAcc, x.t, "owner", (db) => vendorDualIdentityClinicRevoke(db, x.req))).toEqual({ refused: "ERR_VERSION_CONFLICT" });
    // Platform-approved but not clinic-approved: nothing to revoke.
    const sub2 = await account();
    await createVendorStaff(op, caller(PO), sub2, "Petugas Dua", ["support"]);
    const pending = await requestVendorAction(op, caller(SUP), x.t, { kind: "dual_identity", accountId: sub2 }, "Petugas kedua membantu klinik");
    expect(await decideVendorRequest(op, caller(PO), pending, true)).toBe("approved");
    expect(await as(x.ownerAcc, x.t, "owner", (db) => vendorDualIdentityClinicRevoke(db, pending))).toEqual({ refused: "ERR_VERSION_CONFLICT" });
    expect((await audit(x.t, x.req)).map((r) => `${r.outcome}:${r.reason_code}`)).toEqual([
      "success:vendor_dual_identity_approved",
      "denied:dual_identity_not_owner",
      "denied:dual_identity_self",
      "success:vendor_dual_identity_revoked",
      "denied:dual_identity_not_effective",
    ]);
    // Another tenant's refusal is audited in that tenant, never in this one.
    expect((await audit(other, x.req)).map((r) => `${r.outcome}:${r.reason_code}`)).toEqual(["denied:dual_identity_not_found"]);
  });

  it("the revocation is written only by the function: never cleared, never stamped on another state", async () => {
    const x = await setup();
    expect(await as(x.ownerAcc, x.t, "owner", (db) => vendorDualIdentityClinicRevoke(db, x.req))).toBe("revoked");
    await expect(h.admin.query(`update vendor_requests set clinic_revoked_at = null, clinic_revoked_by = null, clinic_revoked_account = null where id = $1`, [x.req])).rejects.toThrow(/final/);
    const sub2 = await account();
    await createVendorStaff(op, caller(PO), sub2, "Petugas Tiga", ["support"]);
    const pending = await requestVendorAction(op, caller(SUP), x.t, { kind: "dual_identity", accountId: sub2 }, "Petugas ketiga membantu klinik");
    await expect(h.admin.query(`update vendor_requests set clinic_revoked_at = now(), clinic_revoked_by = $2, clinic_revoked_account = $3 where id = $1`, [pending, x.ownerStaff, x.ownerAcc])).rejects.toThrow();
    // The app role cannot write the table directly.
    await expect(as(x.ownerAcc, x.t, "owner", (db) => db.query(`update vendor_requests set clinic_revoked_at = null where id = $1`, [x.req]))).rejects.toThrow(/permission denied/);
  });

  // Review round 1 (P1): a second request for the same account that already carries the clinic approval
  // and awaits the platform is revoked too; the platform's later approval cannot make it effective.
  it("a clinic-approved request still awaiting the platform is revoked with the effective one; approving it later restores nothing", async () => {
    const x = await setup();
    const r2 = await requestVendorAction(op, caller(SUP), x.t, { kind: "dual_identity", accountId: x.subject }, "Permintaan kedua untuk akun yang sama");
    expect(await as(x.ownerAcc, x.t, "owner", (db) => vendorDualIdentityClinicDecide(db, r2, true))).toBe("approved");
    expect(await as(x.ownerAcc, x.t, "owner", (db) => vendorDualIdentityClinicRevoke(db, x.req))).toBe("revoked");
    const row2 = (await h.admin.query(`select state, clinic_revoked_at from vendor_requests where id = $1`, [r2])).rows[0];
    expect(row2.state).toBe("pending");
    expect(row2.clinic_revoked_at).not.toBeNull();
    expect(await decideVendorRequest(op, caller(PO), r2, true)).toBe("approved");
    expect((await h.admin.query(`select vendor_dual_approved($1, $2) as ok`, [x.subject, x.t])).rows[0].ok).toBe(false);
    expect((await as(x.ownerAcc, x.t, "owner", vendorDualIdentities)).find((d) => d.requestId === r2)).toMatchObject({ effective: false, state: "approved" });
    await expect(h.admin.query(`update memberships set effective_to = null where tenant_id = $1 and account_id = $2`, [x.t, x.subject])).rejects.toThrow(/membership not allowed/);
    expect((await audit(x.t, r2)).map((r) => `${r.outcome}:${r.reason_code}`)).toEqual(["success:vendor_dual_identity_approved", "success:vendor_dual_identity_revoked"]);
  });

  it("a platform approval racing the revoke: whichever commits first, the second request ends revoked and not effective", async () => {
    const x = await setup();
    const r2 = await requestVendorAction(op, caller(SUP), x.t, { kind: "dual_identity", accountId: x.subject }, "Permintaan kedua untuk akun yang sama");
    expect(await as(x.ownerAcc, x.t, "owner", (db) => vendorDualIdentityClinicDecide(db, r2, true))).toBe("approved");
    // The platform decision holds R2's row lock (as vendor_request_decide does) while the revoke starts.
    const c1 = await owner.connect();
    const c2 = await owner.connect();
    try {
      await c1.query("begin");
      await c1.query(`select 1 from vendor_requests where id = $1 for update`, [r2]);
      const pid = (await c1.query(`select pg_backend_pid() as p`)).rows[0].p;
      const revoke = as(x.ownerAcc, x.t, "owner", (db) => vendorDualIdentityClinicRevoke(db, x.req));
      await waitBlockedBy(c2, pid);
      await c1.query(`update vendor_requests set state = 'approved', decided_by = (select id from vendor_staff where account_id = $2), decided_at = now() where id = $1`, [r2, PO]);
      await c1.query("commit");
      expect(await revoke).toBe("revoked");
    } finally {
      await c1.query("rollback").catch(() => {});
      c1.release();
      c2.release();
    }
    const row2 = (await h.admin.query(`select state, clinic_revoked_at from vendor_requests where id = $1`, [r2])).rows[0];
    expect(row2.state).toBe("approved");
    expect(row2.clinic_revoked_at).not.toBeNull();
    expect((await h.admin.query(`select vendor_dual_approved($1, $2) as ok`, [x.subject, x.t])).rows[0].ok).toBe(false);
  });

  // Review round 1 (P2): a real concurrent membership write. The revoke locks the subject's membership
  // row before the account lock (a membership write's order: row, then the guard's account lock), so a
  // write arriving while the revoke waits never deadlocks with it; it runs after and is refused.
  it("a membership write racing the revoke neither deadlocks nor reopens the membership", async () => {
    const x = await setup();
    const c0 = await owner.connect();
    const c1 = await owner.connect();
    const c2 = await owner.connect();
    try {
      // c0 holds the subject's account lock, so the revoke stops at that lock (after its row lock).
      await c0.query("begin");
      await c0.query(`select vendor_account_lock($1)`, [x.subject]);
      const p0 = (await c0.query(`select pg_backend_pid() as p`)).rows[0].p;
      const revoke = as(x.ownerAcc, x.t, "owner", (db) => vendorDualIdentityClinicRevoke(db, x.req));
      await waitBlockedBy(c2, p0);
      // c1 writes the membership row (a non-end update: the guard would take the account lock).
      const p1 = (await c1.query(`select pg_backend_pid() as p`)).rows[0].p;
      const write = c1.query(`update memberships set effective_to = null where tenant_id = $1 and account_id = $2`, [x.t, x.subject]).then(() => "ok", (e) => String(e.message));
      await waitBlocked(c2, p1);
      await c0.query("commit");
      expect(await revoke).toBe("revoked");
      expect(await write).toMatch(/membership not allowed/);
    } finally {
      await c0.query("rollback").catch(() => {});
      c0.release();
      c1.release();
      c2.release();
    }
    expect((await h.admin.query(`select effective_to from memberships where tenant_id = $1 and account_id = $2`, [x.t, x.subject])).rows[0].effective_to).not.toBeNull();
  });
});
