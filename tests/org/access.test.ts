// T-031 Done-when: scenario PR-91 passes; revoking ends only that membership's sessions;
// an already open session loses access within 60 s (here: on its next request).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, AUTH_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { accessLog, call, CAPABILITY_LABEL, duties, endMembership, permissionMatrix, removeRole, revokeSession, setBranch, setDuty, staffSessions } from "../../src/modules/org/access/access";
import { activeContext, ContextSwitchError, switchContext } from "../../src/modules/org/context/context";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { AccountExistsError, createAuth } from "../../src/auth/server";
import { acceptInvite, acceptWithNewAccount, cancelInvite, invite, listInvitations, listStaff, lookupInvite, manageableSessions } from "../../src/modules/org/staff/staff";
import { BASE_URL, Client, PASSWORD } from "../auth/helpers";
import { createHarness, type Harness } from "../rls/harness";

// Invitations are open only outside production (DEC-024 gate); these tests run as local.
process.env.DEPLOY_ENV = "local";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; membershipId: string; tenantId: string; role: Role; branch?: string };

async function tenant(name = "PT Sintetis"): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry default values returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, name]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("B1"), b2: await br("B2") };
}

async function account(): Promise<string> {
  return (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`s${++n}@klinik-sintetis.test`])).rows[0].id as string;
}

async function person(t: T, roles: Role[], branch?: string, acc?: string): Promise<P> {
  acc ??= await account();
  const { staffId, membershipId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf ${n}` });
  for (const role of roles) {
    const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
    if (branch && !["owner", "admin_pusat", "finance"].includes(role)) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: branch });
  }
  return { acc, staffId, membershipId, tenantId: t.tenantId, role: roles[0], branch };
}

async function session(acc: string, minutesAgo = 5): Promise<string> {
  return (await h.admin.query(
    `insert into auth_session (user_id, token, expires_at, created_at, updated_at, user_agent, last_active_at)
     values ($1, $2, now() + interval '12 hours', now() - make_interval(mins => $3), now(), 'Tablet Ruang 2', now()) returning id`,
    [acc, crypto.randomUUID(), minutesAgo],
  )).rows[0].id as string;
}

const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>, role: Role = p.role) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: role, activeBranchId: ["owner", "admin_pusat", "finance"].includes(role) ? undefined : p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));

let A: T;
let B: T;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = new pg.Pool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant("PT Klinik A");
  B = await tenant("PT Klinik B");
});

afterAll(async () => {
  await owner?.end();
  await app?.end();
  await h?.close();
});

describe("scenario PR-91 revoke session", () => {
  it("the owner revokes a staff member's session on a lost tablet: that session has no access on its next request", async () => {
    const own = await person(A, ["owner"]);
    const nurse = await person(A, ["nurse"], A.b1);
    const tablet = await session(nurse.acc);
    const phone = await session(nurse.acc);
    expect(await activeContext(app, nurse.acc, {}, tablet)).not.toBeNull();
    const listed = await as(own, (db) => staffSessions(db, nurse.staffId));
    expect(listed.map((s) => s.sessionId).sort()).toEqual([tablet, phone].sort());
    await as(own, (db) => revokeSession(db, nurse.staffId, tablet));
    // The already open tablet session loses access immediately (well within 60 s).
    expect(await activeContext(app, nurse.acc, {}, tablet)).toBeNull();
    // The phone session (not revoked) keeps working.
    expect(await activeContext(app, nurse.acc, {}, phone)).not.toBeNull();
    expect((await as(own, (db) => staffSessions(db, nurse.staffId))).find((s) => s.sessionId === tablet)!.revoked).toBe(true);
  });

  it("revoking ends only that membership's sessions: the same account keeps its other clinic", async () => {
    const ownA = await person(A, ["owner"]);
    const acc = await account();
    const inA = await person(A, ["fo_cashier"], A.b1, acc);
    await person(B, ["fo_cashier"], B.b1, acc);
    const s = await session(acc);
    await as(ownA, (db) => revokeSession(db, inA.staffId, null));
    const after = await activeContext(app, acc, { tenantId: A.tenantId }, s);
    expect(after).not.toBeNull();
    expect(after!.context.tenantId).toBe(B.tenantId); // A is gone for this session, B remains
    expect(after!.clinics.map((c) => c.tenantId)).toEqual([B.tenantId]);
  });

  it("HYG-009 N1: staff detail lists sessions only for members the viewer may manage; a refused probe leaves the page's transaction usable", async () => {
    const own = await person(A, ["owner"]);
    const ap = await person(A, ["admin_pusat"]);
    const fin = await person(A, ["finance"]);
    const fo = await person(A, ["fo_cashier"], A.b1);
    const s = await session(fo.acc);
    const r = await as(ap, async (db) => {
      const priv = await manageableSessions(db, fin.staffId);
      const self = await manageableSessions(db, ap.staffId);
      const ok = await manageableSessions(db, fo.staffId);
      const after = (await listStaff(db)).some((x) => x.staffId === fin.staffId); // the transaction still runs
      return { priv, self, ok, after };
    });
    expect(r.priv).toBeNull();
    expect(r.self).toBeNull();
    expect(r.ok!.map((x) => x.sessionId)).toEqual([s]);
    expect(r.after).toBe(true);
    expect(await as(own, (db) => manageableSessions(db, fin.staffId))).toEqual([]);
  });

  it("HYG-009 N3: a session revoked for clinic A cannot switch back into A and records nothing there", async () => {
    const ownA = await person(A, ["owner"]);
    const acc = await account();
    const inA = await person(A, ["fo_cashier"], A.b1, acc);
    await person(B, ["fo_cashier"], B.b1, acc);
    const s = await session(acc);
    await as(ownA, (db) => revokeSession(db, inA.staffId, null));
    const rows = async () => Number((await h.admin.query(`select count(*) from org_actions where tenant_id = $1 and staff_id = $2`, [A.tenantId, inA.staffId])).rows[0].count);
    const before = await rows();
    await expect(switchContext(app, acc, { tenantId: B.tenantId }, { kind: "clinic", tenantId: A.tenantId }, s)).rejects.toBeInstanceOf(ContextSwitchError);
    expect(await rows()).toBe(before);
    // Control: a session signed in after the revocation still switches into A (and records it).
    const fresh = await session(acc, 0);
    expect(await switchContext(app, acc, { tenantId: B.tenantId }, { kind: "clinic", tenantId: A.tenantId }, fresh)).toMatchObject({ tenantId: A.tenantId });
    expect(await rows()).toBe(before + 1);
  });

  it("a session signed in after the revocation works again, whatever its created_at says (no clock comparison)", async () => {
    const own = await person(A, ["owner"]);
    const nurse = await person(A, ["nurse"], A.b1);
    const old = await session(nurse.acc, -10); // an app clock ahead of the database: created "in the future"
    await as(own, (db) => revokeSession(db, nurse.staffId, null));
    const fresh = await session(nurse.acc, 60); // an app clock behind: created "an hour ago"
    expect(await activeContext(app, nurse.acc, {}, old)).toBeNull();
    expect(await activeContext(app, nurse.acc, {}, fresh)).not.toBeNull();
  });
});

describe("IAM-16: every revocation reaches open sessions", () => {
  it("removing a role, a branch or ending the membership revokes the open session", async () => {
    const own = await person(A, ["owner"]);
    for (const act of ["role", "branch", "membership"] as const) {
      const p = await person(A, ["doctor"], A.b1);
      if (act === "branch") await assignBranch(h.admin, { tenantId: A.tenantId, staffRoleId: (await h.admin.query(`select id from staff_roles where staff_id = $1`, [p.staffId])).rows[0].id, branchId: A.b2 });
      const s = await session(p.acc);
      if (act === "role") await as(own, (db) => removeRole(db, p.staffId, "doctor"));
      if (act === "branch") await as(own, (db) => setBranch(db, p.staffId, "doctor", A.b2, false));
      if (act === "membership") await as(own, (db) => endMembership(db, p.staffId));
      expect(await activeContext(app, p.acc, {}, s), act).toBeNull();
    }
  });
});

describe("IAM-11 and IAM-13 rules", () => {
  it("Admin Pusat manages Level 3 staff but not the owner or privileged roles; nobody changes their own access", async () => {
    const ap = await person(A, ["admin_pusat"]);
    const own = await person(A, ["owner"]);
    const fin = await person(A, ["finance"]);
    const fo = await person(A, ["fo_cashier"], A.b1);
    expect(await code(as(ap, (db) => revokeSession(db, own.staffId, null)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(ap, (db) => endMembership(db, fin.staffId)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(ap, (db) => removeRole(db, fin.staffId, "finance")))).toBe("ERR_FORBIDDEN");
    expect(await code(as(ap, (db) => revokeSession(db, ap.staffId, null)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(ap, (db) => removeRole(db, fo.staffId, "fo_cashier")))).toBe("ok");
    const ap2 = await person(A, ["admin_pusat"]);
    expect(await code(as(ap, (db) => endMembership(db, ap2.staffId)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(ap, (db) => setDuty(db, ap2.staffId, "it_admin", true)))).toBe("ERR_FORBIDDEN");
    for (const role of ["owner", "admin_pusat"] as const) {
      expect(await code(as(ap, (db) => invite(db, { email: `x.${role}@klinik-sintetis.test`, name: "X Priv", roles: [role], branchIds: [] })))).toBe("ERR_FORBIDDEN");
    }
    // A mixed invitation from the owner (Level 3 + privileged) cannot be cancelled by Admin Pusat.
    const mixed = await as(own, (db) => invite(db, { email: "x.mixed@klinik-sintetis.test", name: "X Mixed", roles: ["nurse", "finance"], branchIds: [A.b1] }));
    expect(await code(as(ap, (db) => cancelInvite(db, mixed.invitationId)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(own, (db) => endMembership(db, own.staffId)))).toBe("ERR_FORBIDDEN");
  });

  it("other roles cannot manage staff; another tenant's staff is not found", async () => {
    const mgr = await person(A, ["manager"], A.b1);
    const fo = await person(A, ["fo_cashier"], A.b1);
    expect(await code(as(mgr, (db) => revokeSession(db, fo.staffId, null)))).toBe("ERR_FORBIDDEN");
    const ownB = await person(B, ["owner"]);
    expect(await code(as(ownB, (db) => revokeSession(db, fo.staffId, null)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(ownB, (db) => staffSessions(db, fo.staffId)))).toBe("ERR_NOT_FOUND");
    // Admin Pusat does not see an owner's devices either.
    const ap = await person(A, ["admin_pusat"]);
    const own = await person(A, ["owner"]);
    expect(await code(as(ap, (db) => staffSessions(db, own.staffId)))).toBe("ERR_NOT_FOUND");
  });

  it("two owners ending each other at the same time leave one owner (access changes of a tenant are serialized)", async () => {
    const o1 = await person(A, ["owner"]);
    const o2 = await person(A, ["owner"]);
    // Both transactions have their context bound before either acts (a barrier), so the
    // definer functions really run at the same time; the tenant lock makes the second wait
    // and then see that its own membership has ended.
    let arrived = 0;
    let open!: () => void;
    const barrier = new Promise<void>((r) => (open = r));
    const meet = async () => {
      if (++arrived === 2) open();
      await barrier;
    };
    const r = await Promise.all([
      code(as(o1, async (db) => { await meet(); await endMembership(db, o2.staffId); })),
      code(as(o2, async (db) => { await meet(); await endMembership(db, o1.staffId); })),
    ]);
    expect(r.sort()).toEqual(["ERR_FORBIDDEN", "ok"]);
    const active = await h.admin.query(
      `select count(*)::int as n from memberships where id = any($1) and (effective_to is null or effective_to > now())`, [[o1.membershipId, o2.membershipId]]);
    expect(active.rows[0].n).toBe(1);
  });

  it("removing the last Owner/Admin Pusat role ends the person's duties; a duty needs an active membership", async () => {
    const own = await person(A, ["owner"]);
    const ap = await person(A, ["admin_pusat", "manager"], A.b1);
    await as(own, (db) => setDuty(db, ap.staffId, "it_admin", true));
    await as(own, (db) => removeRole(db, ap.staffId, "admin_pusat"));
    expect((await as(own, duties)).filter((d) => d.staffId === ap.staffId)).toEqual([]);
    expect((await as(own, (db) => accessLog(db))).some((l) => l.reason === "duty_removed" && l.targetStaffId === ap.staffId)).toBe(true);
    // Still holding another privileged role (owner): the duty stays.
    const both = await person(A, ["owner", "admin_pusat"]);
    await as(own, (db) => setDuty(db, both.staffId, "data_protection", true));
    await as(own, (db) => removeRole(db, both.staffId, "admin_pusat"));
    expect((await as(own, duties)).filter((d) => d.staffId === both.staffId).map((d) => d.duty)).toEqual(["data_protection"]);
    // Ending the membership ends the duty, audited.
    await as(own, (db) => endMembership(db, both.staffId));
    expect((await as(own, duties)).filter((d) => d.staffId === both.staffId)).toEqual([]);
    const gone = await person(A, ["admin_pusat"]);
    await as(own, (db) => endMembership(db, gone.staffId));
    expect(await code(as(own, (db) => setDuty(db, gone.staffId, "it_admin", true)))).toBe("ERR_NOT_FOUND");
  });

  it("a session of another account cannot be revoked through this staff member", async () => {
    const own = await person(A, ["owner"]);
    const fo = await person(A, ["fo_cashier"], A.b1);
    const other = await person(A, ["nurse"], A.b1);
    const s = await session(other.acc);
    expect(await code(as(own, (db) => revokeSession(db, fo.staffId, s)))).toBe("ERR_NOT_FOUND");
  });

  it("duties go to Owner or Admin Pusat, only the owner assigns them, ending one revokes sessions", async () => {
    const own = await person(A, ["owner"]);
    const ap = await person(A, ["admin_pusat"]);
    const mgr = await person(A, ["manager"], A.b1);
    expect(await code(as(own, (db) => setDuty(db, mgr.staffId, "data_protection", true)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(ap, (db) => setDuty(db, ap.staffId, "data_protection", true)))).toBe("ERR_FORBIDDEN");
    await as(own, (db) => setDuty(db, ap.staffId, "data_protection", true));
    expect(await code(as(own, (db) => setDuty(db, ap.staffId, "data_protection", true)))).toBe("ERR_VERSION_CONFLICT");
    expect((await as(own, duties)).filter((d) => d.staffId === ap.staffId).map((d) => d.duty)).toEqual(["data_protection"]);
    const s = await session(ap.acc);
    await as(own, (db) => setDuty(db, ap.staffId, "data_protection", false));
    expect(await activeContext(app, ap.acc, {}, s)).toBeNull();
    // A one-owner clinic: the owner may hold a duty themselves.
    expect(await code(as(own, (db) => setDuty(db, own.staffId, "it_admin", true)))).toBe("ok");
  });
});

describe("Undangan (UX-3)", () => {
  it("an invitation creates the membership, roles and branches when the invited account accepts", async () => {
    const own = await person(A, ["owner"]);
    const { invitationId, token } = await as(own, (db) => invite(db, { email: "Perawat.Baru@Klinik-Sintetis.test", name: "Perawat Baru", roles: ["nurse"], branchIds: [A.b1] }));
    expect(await lookupInvite(app, token)).toEqual({ email: "perawat.baru@klinik-sintetis.test", displayName: "Perawat Baru", clinic: "PT Klinik A", roles: ["nurse"] });
    const acc = (await h.admin.query(`insert into auth_user (name, email) values ('Perawat Baru', 'perawat.baru@klinik-sintetis.test') returning id`)).rows[0].id;
    const r = await acceptInvite(app, token, acc);
    expect(r.tenantId).toBe(A.tenantId);
    const ctx = await activeContext(app, acc, {});
    expect(ctx!.context).toMatchObject({ tenantId: A.tenantId, actingRole: "nurse", activeBranchId: A.b1 });
    expect((await as(own, listInvitations)).find((i) => i.id === invitationId)!.state).toBe("accepted");
    expect(await lookupInvite(app, token)).toBeNull();
    expect(await code(acceptInvite(app, token, acc))).toBe("ERR_NOT_FOUND"); // used once
  });

  it("an invitation is refused for another email, after expiry, or after cancellation", async () => {
    const own = await person(A, ["owner"]);
    const a = await as(own, (db) => invite(db, { email: "a.only@klinik-sintetis.test", name: "A Only", roles: ["fo_cashier"], branchIds: [A.b1] }));
    const stranger = await account();
    expect(await code(acceptInvite(app, a.token, stranger))).toBe("ERR_FORBIDDEN");
    const b = await as(own, (db) => invite(db, { email: "b.exp@klinik-sintetis.test", name: "B Exp", roles: ["fo_cashier"], branchIds: [A.b1] }));
    await h.admin.query(`update staff_invitations set invited_at = now() - interval '9 days', expires_at = now() - interval '1 day' where id = $1`, [b.invitationId]);
    const bAcc = (await h.admin.query(`insert into auth_user (name, email) values ('B', 'b.exp@klinik-sintetis.test') returning id`)).rows[0].id;
    expect(await code(acceptInvite(app, b.token, bAcc))).toBe("ERR_NOT_FOUND");
    const c = await as(own, (db) => invite(db, { email: "c.cancel@klinik-sintetis.test", name: "C Cancel", roles: ["fo_cashier"], branchIds: [A.b1] }));
    await as(own, (db) => cancelInvite(db, c.invitationId));
    const cAcc = (await h.admin.query(`insert into auth_user (name, email) values ('C', 'c.cancel@klinik-sintetis.test') returning id`)).rows[0].id;
    expect(await code(acceptInvite(app, c.token, cAcc))).toBe("ERR_NOT_FOUND");
  });

  it("Admin Pusat invites Level 3 roles only; a branch role needs a branch; one pending invitation per email; members are not re-invited", async () => {
    const ap = await person(A, ["admin_pusat"]);
    expect(await code(as(ap, (db) => invite(db, { email: "x.fin@klinik-sintetis.test", name: "X Fin", roles: ["finance"], branchIds: [] })))).toBe("ERR_FORBIDDEN");
    expect(await code(as(ap, (db) => invite(db, { email: "x.nob@klinik-sintetis.test", name: "X Nob", roles: ["nurse"], branchIds: [] })))).toBe("ERR_FORBIDDEN");
    expect(await code(as(ap, (db) => invite(db, { email: "x.br@klinik-sintetis.test", name: "X Br", roles: ["nurse"], branchIds: [B.b1] })))).toBe("ERR_NOT_FOUND");
    await as(ap, (db) => invite(db, { email: "x.dup@klinik-sintetis.test", name: "X Dup", roles: ["nurse"], branchIds: [A.b1] }));
    expect(await code(as(ap, (db) => invite(db, { email: "x.dup@klinik-sintetis.test", name: "X Dup", roles: ["nurse"], branchIds: [A.b1] })))).toBe("ERR_IDEMPOTENCY_CONFLICT");
    const m = await person(A, ["nurse"], A.b1);
    const email = (await h.admin.query(`select email from auth_user where id = $1`, [m.acc])).rows[0].email;
    expect(await code(as(ap, (db) => invite(db, { email, name: "Already", roles: ["bc"], branchIds: [A.b1] })))).toBe("ERR_VERSION_CONFLICT");
    // A former member is not invited again either (one membership per tenant).
    const own = await person(A, ["owner"]);
    const former = await person(A, ["bc"], A.b1);
    await as(own, (db) => endMembership(db, former.staffId));
    const fEmail = (await h.admin.query(`select email from auth_user where id = $1`, [former.acc])).rows[0].email;
    expect(await code(as(ap, (db) => invite(db, { email: fEmail, name: "Former", roles: ["bc"], branchIds: [A.b1] })))).toBe("ERR_VERSION_CONFLICT");
  });

  it("duplicate roles and branches collapse; an expired invitation no longer blocks a new one; Admin Pusat cannot cancel an owner's privileged invitation", async () => {
    const own = await person(A, ["owner"]);
    const ap = await person(A, ["admin_pusat"]);
    const d = await as(own, (db) => invite(db, { email: "d.dup@klinik-sintetis.test", name: "D Dup", roles: ["nurse", "nurse"], branchIds: [A.b1, A.b1] }));
    const dAcc = (await h.admin.query(`insert into auth_user (name, email) values ('D', 'd.dup@klinik-sintetis.test') returning id`)).rows[0].id;
    expect(await code(acceptInvite(app, d.token, dAcc))).toBe("ok");
    const e1 = await as(own, (db) => invite(db, { email: "e.exp@klinik-sintetis.test", name: "E Exp", roles: ["bc"], branchIds: [A.b1] }));
    await h.admin.query(`update staff_invitations set invited_at = now() - interval '9 days', expires_at = now() - interval '1 day' where id = $1`, [e1.invitationId]);
    expect(await code(as(own, (db) => invite(db, { email: "e.exp@klinik-sintetis.test", name: "E Exp", roles: ["bc"], branchIds: [A.b1] })))).toBe("ok");
    expect((await as(own, listInvitations)).find((i) => i.id === e1.invitationId)!.state).toBe("expired");
    const fin = await as(own, (db) => invite(db, { email: "f.fin@klinik-sintetis.test", name: "F Fin", roles: ["finance"], branchIds: [] }));
    expect(await code(as(ap, (db) => cancelInvite(db, fin.invitationId)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(own, (db) => cancelInvite(db, fin.invitationId)))).toBe("ok");
  });

  it("accepting is audited as the new staff member; an account already in the tenant cannot accept", async () => {
    const own = await person(A, ["owner"]);
    const g = await as(own, (db) => invite(db, { email: "g.acc@klinik-sintetis.test", name: "G Acc", roles: ["therapist"], branchIds: [A.b2] }));
    const gAcc = (await h.admin.query(`insert into auth_user (name, email) values ('G', 'g.acc@klinik-sintetis.test') returning id`)).rows[0].id;
    const { staffId } = await acceptInvite(app, g.token, gAcc);
    const row = (await h.admin.query(`select staff_id, acting_role, branch_id, object_id from audit_events where reason_code = 'invitation_accepted' and object_id = $1`, [g.invitationId])).rows[0];
    expect(row).toMatchObject({ staff_id: staffId, acting_role: "therapist", branch_id: A.b2 });
    const log = await as(own, (db) => accessLog(db));
    expect(log.find((l) => l.reason === "invitation_accepted")).toMatchObject({ label: "Undangan diterima", targetStaffId: staffId });
    // An existing member's account (same email) cannot take a second membership here.
    const m = await person(A, ["bc"], A.b1);
    const mEmail = (await h.admin.query(`select email from auth_user where id = $1`, [m.acc])).rows[0].email;
    const token = "existing-member-token-0001";
    const { hashToken } = await import("../../src/modules/org/staff/staff");
    await h.admin.query(`insert into staff_invitations (tenant_id, email, display_name, roles, branch_ids, token_hash, invited_by, expires_at)
      values ($1, $2, 'Mia Lama', '{bc}', $3, $4, $5, now() + interval '1 day')`, [A.tenantId, mEmail, [A.b1], hashToken(token), own.staffId]);
    expect(await code(acceptInvite(app, token, m.acc))).toBe("ERR_VERSION_CONFLICT");
  });

  it("a pending invitation dies with its inviter's authority (membership ended or Admin Pusat role removed)", async () => {
    const own = await person(A, ["owner"]);
    const ap = await person(A, ["admin_pusat", "manager"], A.b1);
    const i1 = await as(ap, (db) => invite(db, { email: "h.one@klinik-sintetis.test", name: "H One", roles: ["manager"], branchIds: [A.b1] }));
    await as(own, (db) => removeRole(db, ap.staffId, "admin_pusat"));
    expect((await as(own, listInvitations)).find((i) => i.id === i1.invitationId)!.state).toBe("cancelled");
    const ap2 = await person(A, ["admin_pusat"]);
    const i2 = await as(ap2, (db) => invite(db, { email: "h.two@klinik-sintetis.test", name: "H Two", roles: ["bc"], branchIds: [A.b1] }));
    // Even if the cancellation were missed, acceptance re-checks the inviter.
    await h.admin.query(`update memberships set effective_to = now() where id = $1`, [ap2.membershipId]);
    const acc = (await h.admin.query(`insert into auth_user (name, email) values ('H', 'h.two@klinik-sintetis.test') returning id`)).rows[0].id;
    expect(await code(acceptInvite(app, i2.token, acc))).toBe("ERR_NOT_FOUND");
    const ap3 = await person(A, ["admin_pusat"]);
    const i3 = await as(ap3, (db) => invite(db, { email: "h.three@klinik-sintetis.test", name: "H Three", roles: ["bc"], branchIds: [A.b1] }));
    await as(own, (db) => endMembership(db, ap3.staffId));
    expect((await as(own, listInvitations)).find((i) => i.id === i3.invitationId)!.state).toBe("cancelled");
    const log = await as(own, (db) => accessLog(db));
    expect(log.filter((l) => l.reason === "invitation_cancelled").map((l) => l.objectId)).toEqual(expect.arrayContaining([i1.invitationId, i3.invitationId]));
  });

  it("two accepts of one link at once create one membership", async () => {
    const own = await person(A, ["owner"]);
    const j = await as(own, (db) => invite(db, { email: "j.race@klinik-sintetis.test", name: "J Race", roles: ["bc"], branchIds: [A.b1] }));
    const acc = (await h.admin.query(`insert into auth_user (name, email) values ('J', 'j.race@klinik-sintetis.test') returning id`)).rows[0].id;
    const r = await Promise.all([code(acceptInvite(app, j.token, acc)), code(acceptInvite(app, j.token, acc))]);
    expect(r.sort()).toEqual(["ERR_NOT_FOUND", "ok"]);
    expect((await h.admin.query(`select count(*)::int n from memberships where tenant_id = $1 and account_id = $2`, [A.tenantId, acc])).rows[0].n).toBe(1);
  });

  it("acceptance leaves no tenant context behind on the connection", async () => {
    const own = await person(A, ["owner"]);
    const k = await as(own, (db) => invite(db, { email: "k.ctx@klinik-sintetis.test", name: "K Ctx", roles: ["nurse"], branchIds: [A.b1] }));
    const acc = (await h.admin.query(`insert into auth_user (name, email) values ('K', 'k.ctx@klinik-sintetis.test') returning id`)).rows[0].id;
    const c = await app.connect();
    try {
      await c.query("begin");
      await c.query(`select * from staff_invite_accept($1, $2)`, [(await import("../../src/modules/org/staff/staff")).hashToken(k.token), acc]);
      const after = (await c.query(`select app_tenant_id() t, app_staff_id() s, app_acting_role() r`)).rows[0];
      expect(after).toEqual({ t: null, s: null, r: null });
      expect((await c.query(`select count(*)::int n from staff`)).rows[0].n).toBe(0); // RLS: nothing visible
      await c.query("commit");
    } finally {
      c.release();
    }
  });

  it("invalid invitation input is refused with a mapped code, also when the function is called directly with NULLs", async () => {
    const own = await person(A, ["owner"]);
    const hash = "b".repeat(64);
    for (const args of [
      ["n.days@klinik-sintetis.test", "Nama", ["bc"], [A.b1], hash, null],
      [null, "Nama", ["bc"], [A.b1], hash, 7],
      [`${"x".repeat(250)}@klinik-sintetis.test`, "Nama", ["bc"], [A.b1], hash, 7],
      ["n.role@klinik-sintetis.test", "Nama", [null], [A.b1], hash, 7],
      ["n.roles@klinik-sintetis.test", "Nama", null, [A.b1], hash, 7],
      ["n.hash@klinik-sintetis.test", "Nama", ["bc"], [A.b1], null, 7],
    ] as unknown[][]) {
      expect(await code(as(own, (db) => call(() => db.query(`select staff_invite($1, $2, $3, $4, $5, $6)`, args))))).toBe("ERR_FORBIDDEN");
    }
    for (const bad of [
      { email: "bukan-email", name: "Nama", roles: ["bc"], branchIds: [A.b1] },
      { email: "ok@klinik-sintetis.test", name: "N", roles: ["bc"], branchIds: [A.b1] },
      { email: "ok@klinik-sintetis.test", name: "Nama", roles: ["kasir_palsu"], branchIds: [A.b1] },
      { email: "ok@klinik-sintetis.test", name: "Nama", roles: [], branchIds: [] },
    ]) {
      expect(await code(as(own, (db) => invite(db, bad as never)))).toBe("ERR_FORBIDDEN");
    }
  });

  it("the token hash never reaches clinic_app", async () => {
    const own = await person(A, ["owner"]);
    await as(own, (db) => invite(db, { email: "t.hash@klinik-sintetis.test", name: "T Hash", roles: ["bc"], branchIds: [A.b1] }));
    await expect(as(own, (db) => db.query(`select token_hash from staff_invitations`))).rejects.toMatchObject({ code: "42501" });
  });
});

describe("invite link flow (account + membership)", () => {
  let authPool: pg.Pool;
  let auth: ReturnType<typeof createAuth>;
  beforeAll(async () => {
    authPool = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [AUTH_GROUP_ROLE])), max: 2 }, AUTH_GROUP_ROLE);
    auth = createAuth({ pool: authPool, baseURL: BASE_URL, secret: "x".repeat(44), roles: async () => ["bc"], rateLimit: false, sleep: async () => {} });
  });
  afterAll(async () => {
    await authPool?.end();
  });

  it("creates the account and membership; the person signs in right away (email unverified is not required)", async () => {
    const own = await person(A, ["owner"]);
    const l = await as(own, (db) => invite(db, { email: "l.flow@klinik-sintetis.test", name: "L Flow", roles: ["bc"], branchIds: [A.b1] }));
    const r = await acceptWithNewAccount(app, auth, l.token, PASSWORD);
    expect(r).toMatchObject({ tenantId: A.tenantId });
    expect((await new Client(auth).signIn("l.flow@klinik-sintetis.test")).status).toBe(200);
    expect((await h.admin.query(`select email_verified from auth_user where id = $1`, [r!.accountId])).rows[0].email_verified).toBe(false);
  });

  it("a failed accept removes the new account again; an existing account is reported, not reused", async () => {
    const own = await person(A, ["owner"]);
    const m = await as(own, (db) => invite(db, { email: "m.flow@klinik-sintetis.test", name: "M Flow", roles: ["bc"], branchIds: [A.b1] }));
    // The invitation is cancelled between the page lookup and the accept: simulate by a maker
    // that cancels it right after creating the account.
    const maker = {
      createStaffAccount: async (i: { email: string; name: string; password: string }) => {
        const u = await auth.createStaffAccount(i);
        await as(own, (db) => cancelInvite(db, m.invitationId));
        return u;
      },
      discardNewAccount: auth.discardNewAccount,
    };
    expect(await acceptWithNewAccount(app, maker, m.token, PASSWORD)).toBeNull();
    expect((await h.admin.query(`select count(*)::int n from auth_user where email = 'm.flow@klinik-sintetis.test'`)).rows[0].n).toBe(0);
    // Mixed-case existing account for the invited email.
    await auth.createStaffAccount({ email: "N.Flow@Klinik-Sintetis.test", name: "N", password: PASSWORD });
    const n2 = await as(own, (db) => invite(db, { email: "n.flow@klinik-sintetis.test", name: "N Flow", roles: ["bc"], branchIds: [A.b1] }));
    await expect(acceptWithNewAccount(app, auth, n2.token, PASSWORD)).rejects.toBeInstanceOf(AccountExistsError);
  });

  it("a discard after an accept that did commit (lost response) leaves the member's account intact", async () => {
    const own = await person(A, ["owner"]);
    const q = await as(own, (db) => invite(db, { email: "q.late@klinik-sintetis.test", name: "Q Late", roles: ["bc"], branchIds: [A.b1] }));
    const u = await auth.createStaffAccount({ email: "q.late@klinik-sintetis.test", name: "Q", password: PASSWORD });
    await acceptInvite(app, q.token, u.id);
    await expect(auth.discardNewAccount(u.id)).rejects.toMatchObject({ code: "23503" });
    expect((await new Client(auth).signIn("q.late@klinik-sintetis.test")).status).toBe(200); // credential still there
  });

  it("invitations work in production; the copied link works once, then never again (DEC-031 D1)", async () => {
    const own = await person(A, ["owner"]);
    process.env.DEPLOY_ENV = "production";
    try {
      const r = await as(own, (db) => invite(db, { email: "p.gate@klinik-sintetis.test", name: "P Gate", roles: ["bc"], branchIds: [A.b1] }));
      expect(await acceptWithNewAccount(app, auth, r.token, PASSWORD)).toMatchObject({ tenantId: A.tenantId });
      expect(await acceptWithNewAccount(app, auth, r.token, PASSWORD)).toBeNull();
      expect(await lookupInvite(app, r.token)).toBeNull();
    } finally {
      process.env.DEPLOY_ENV = "local";
    }
  });

  it("an invitation accepted from Admin Pusat notifies the owners; one from an Owner does not (DEC-031 D1 residual risk)", async () => {
    const own = await person(A, ["owner"]);
    const ap = await person(A, ["admin_pusat"]);
    const byAp = await as(ap, (db) => invite(db, { email: `ap.inv${Date.now()}@klinik-sintetis.test`, name: "Dokter Baru", roles: ["doctor"], branchIds: [A.b1] }));
    const byOwner = await as(own, (db) => invite(db, { email: `own.inv${Date.now()}@klinik-sintetis.test`, name: "Perawat Baru", roles: ["nurse"], branchIds: [A.b1] }));
    await acceptWithNewAccount(app, auth, byAp.token, PASSWORD);
    await acceptWithNewAccount(app, auth, byOwner.token, PASSWORD);
    const rows = (await h.admin.query(
      `select subject_id, recipient_role from notifications where tenant_id = $1 and type = 'staff_joined_by_admin_invite'`, [A.tenantId])).rows;
    expect(rows).toEqual([{ subject_id: byAp.invitationId, recipient_role: "owner" }]);
    // Visible in the owner's notifications (the bell), not to Admin Pusat.
    const { list } = await import("../../src/modules/notifications/notifications");
    expect((await as(own, (db) => list(db))).map((n) => n.subjectId)).toContain(byAp.invitationId);
    expect((await as(ap, (db) => list(db))).map((n) => n.subjectId)).not.toContain(byAp.invitationId);
  });
});

describe("Pengguna & Akses views", () => {
  it("the permission matrix is the 07 matrix, read-only (the bundled copy equals the spec)", async () => {
    const { readFileSync } = await import("node:fs");
    const { parseMatrix } = await import("../../src/modules/org/roles/matrix");
    const spec = parseMatrix(readFileSync("docs/spec/07-IAM-RBAC-ABAC.md", "utf8"));
    const m = permissionMatrix();
    expect(m.cells).toEqual(spec); // regenerate src/modules/org/access/matrix.generated.json when 07 changes
    // Every row has an Indonesian label for the screen.
    expect(m.capabilities.filter((c) => !CAPABILITY_LABEL[c])).toEqual([]);
    expect(m.capabilities).toContain("Staff & invitations");
    expect(m.cells["Staff & invitations"].owner).toBe("full");
    expect(m.roles).toHaveLength(16);
  });

  it("the access change log shows who changed what, and staff lists respect readers", async () => {
    const own = await person(A, ["owner"]);
    const fo = await person(A, ["fo_cashier"], A.b1);
    await as(own, (db) => revokeSession(db, fo.staffId, null));
    let log = await as(own, (db) => accessLog(db));
    expect(log[0]).toMatchObject({ reason: "session_revoked", label: "Sesi dicabut", actingRole: "owner", staffId: own.staffId, targetStaffId: fo.staffId });
    // A removed branch and role say which.
    await assignBranch(h.admin, { tenantId: A.tenantId, staffRoleId: (await h.admin.query(`select id from staff_roles where staff_id = $1`, [fo.staffId])).rows[0].id, branchId: A.b2 });
    await as(own, (db) => setBranch(db, fo.staffId, "fo_cashier", A.b2, false));
    await as(own, (db) => removeRole(db, fo.staffId, "fo_cashier"));
    log = await as(own, (db) => accessLog(db));
    expect(log[0]).toMatchObject({ reason: "role_removed", targetStaffId: fo.staffId, role: "fo_cashier", branchId: null });
    expect(log[1]).toMatchObject({ reason: "branch_removed", targetStaffId: fo.staffId, role: "fo_cashier", branchId: A.b2 });
    expect((await as(own, listStaff)).map((s) => s.staffId)).toContain(fo.staffId);
    const nurse = await person(A, ["nurse"], A.b1);
    expect((await as(nurse, listStaff)).map((s) => s.staffId)).toEqual([nurse.staffId]); // own row only (T-029)
    await expect(as(nurse, (db) => db.query(`select id, email from staff_invitations`))).resolves.toMatchObject({ rowCount: 0 });
  });

  it("clinic_app cannot write access tables directly", async () => {
    const own = await person(A, ["owner"]);
    for (const sql of [
      `insert into membership_revocations (tenant_id, membership_id, session_ids, reason) values ('${A.tenantId}', '${own.membershipId}', '{}', 'session_revoked')`,
      `insert into staff_duties (tenant_id, staff_id, duty, assigned_by) values ('${A.tenantId}', '${own.staffId}', 'it_admin', '${own.staffId}')`,
      `update staff_invitations set state = 'accepted'`,
      `delete from membership_revocations`,
    ]) {
      await expect(as(own, (db) => db.query(sql)), sql).rejects.toMatchObject({ code: "42501" });
    }
  });
});
