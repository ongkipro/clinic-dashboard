// HYG-003 / DEC-036 (UX-46, PR-57): Tim Vendor — a platform owner invites a vendor staff
// member with a one-time link; the person sets their own password; TOTP follows on sign-in.
// Only a platform owner lists, invites, cancels or changes state, with the 10-minute step-up;
// every refusal from a resolved account is logged; T-020 rules (not oneself, not the last
// platform owner, dual identity) still hold.
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_GROUP_ROLE, AUTH_GROUP_ROLE, VENDOR_GROUP_ROLE } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { createAuth } from "../../src/auth/server";
import { createMembership } from "../../src/modules/org/identity";
import { hashToken } from "../../src/modules/org/staff/staff";
import { bootstrapVendor, createVendorStaff, updateVendorStaff, type VendorCaller } from "../../src/modules/vendor/staff/staff";
import {
  acceptMemberWithNewAccount, cancelMemberInvite, inviteMember, listTeam, lookupMemberInvite, setMemberState,
} from "../../src/modules/vendor/team/team";
import { createHarness, type Harness } from "../rls/harness";
import { PASSWORD } from "../auth/helpers";

let h: Harness;
let consoleDb: pg.Pool;
let authPool: pg.Pool;
let appPoolRole: pg.Pool;
let auth: ReturnType<typeof createAuth>;
let n = 0;
const IP = "203.0.113.10";
const caller = (accountId: string): VendorCaller => ({ accountId, ip: IP, mfaAt: new Date() });

async function account(totp = true, email = `tim${++n}@vendor-sintetis.test`): Promise<string> {
  return (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('V', $1, $2) returning id`, [email, totp])).rows[0].id as string;
}
async function session(acc: string, mfaAgo = "0 minutes"): Promise<string> {
  const tok = `tok${++n}${randomBytes(12).toString("hex")}`;
  await h.admin.query(`insert into auth_session (user_id, token, expires_at, surface, second_factor_at) values ($1, $2, now() + interval '8 hours', 'vendor', now() - $3::interval)`, [acc, tok, mfaAgo]);
  return tok;
}
// Until some backend is blocked on an advisory lock (the second transaction is really waiting).
async function waitForLockWaiter() {
  for (let i = 0; i < 200; i++) {
    if ((await h.admin.query(`select 1 from pg_locks where locktype = 'advisory' and not granted limit 1`)).rowCount) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("no backend waited on the advisory lock");
}
const lastAction = async () => (await h.admin.query(`select action, outcome, reason_code from vendor_actions order by seq desc limit 1`)).rows[0];
const as = (token: string, ip = IP) => ({ token, ip });
const email = () => `baru${++n}@vendor-sintetis.test`;

let PO: string; let PO2: string; let FIN: string;
let poTok: string; let po2Tok: string; let finTok: string;
let op: pg.Pool;

beforeAll(async () => {
  h = await createHarness();
  consoleDb = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [VENDOR_GROUP_ROLE])), max: 3 }, VENDOR_GROUP_ROLE);
  authPool = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [AUTH_GROUP_ROLE])), max: 3 }, AUTH_GROUP_ROLE);
  appPoolRole = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 1 });
  auth = createAuth({ pool: authPool, baseURL: "https://vendor.test", surface: "vendor", allowAddress: async () => true, secret: randomBytes(32).toString("base64"), roles: async () => [], rateLimit: false, sleep: async () => {} });
  op = new pg.Pool({ connectionString: h.ownerUrl(), max: 1 });
  const c = await op.connect();
  try {
    PO = await account();
    await bootstrapVendor(c, PO, "Rani Pemilik Platform", "203.0.113.0/24", "Kantor vendor");
    PO2 = await account();
    FIN = await account();
    await createVendorStaff(c, caller(PO), PO2, "Bima Pemilik Platform", ["platform_owner"]);
    await createVendorStaff(c, caller(PO), FIN, "Keuangan Vendor", ["vendor_finance"]);
  } finally {
    c.release();
  }
  poTok = await session(PO); po2Tok = await session(PO2); finTok = await session(FIN);
});
afterAll(async () => {
  await op?.end();
  await appPoolRole?.end();
  await authPool?.end();
  await consoleDb?.end();
  await h?.close();
});

describe("Tim Vendor invitation (DEC-036)", () => {
  it("a platform owner invites; the link works once, for that email, creating vendor staff with exactly the invited roles", async () => {
    const e = email();
    const r = await inviteMember(consoleDb, as(poTok), e.toUpperCase(), "Sari Onboarding", ["onboarding", "support", "onboarding"]);
    expect(r.ok).toBe(true);
    const token = (r as { data: { token: string } }).data.token;
    expect((await h.admin.query(`select token_hash, roles, email from vendor_staff_invitations where email = $1`, [e])).rows[0]).toEqual({ token_hash: hashToken(token), roles: ["onboarding", "support"], email: e });
    expect(await lookupMemberInvite(consoleDb, token)).toEqual({ email: e, name: "Sari Onboarding", roles: ["onboarding", "support"] });
    const a = await acceptMemberWithNewAccount(consoleDb, auth, token, PASSWORD);
    expect(a.ok).toBe(true);
    const staff = (await h.admin.query(`select s.state, array_agg(x.role order by x.role) roles, u.two_factor_enabled from vendor_staff s join auth_user u on u.id = s.account_id
                                          join vendor_staff_roles x on x.staff_id = s.id where u.email = $1 group by 1, 3`, [e])).rows;
    expect(staff).toEqual([{ state: "active", roles: ["onboarding", "support"], two_factor_enabled: false }]);
    expect((await h.admin.query(`select state from vendor_staff_invitations where email = $1`, [e])).rows[0].state).toBe("accepted");
    // Once only.
    expect(await lookupMemberInvite(consoleDb, token)).toBeNull();
    expect(await acceptMemberWithNewAccount(consoleDb, auth, token, PASSWORD)).toMatchObject({ ok: false, code: "ERR_NOT_FOUND" });
    // The replay is logged against the invitation (once per 10 minutes, no token or account).
    const invId = (await h.admin.query(`select id from vendor_staff_invitations where email = $1`, [e])).rows[0].id;
    expect(await lastAction()).toMatchObject({ action: "vendor_staff_invite_accept", outcome: "denied", reason_code: "not_open" });
    await acceptMemberWithNewAccount(consoleDb, auth, token, PASSWORD);
    expect((await h.admin.query(`select count(*)::int n, count(account_id)::int a from vendor_actions where object_id = $1 and outcome = 'denied'`, [invId])).rows[0]).toEqual({ n: 1, a: 0 });
    // A direct accept of a cancelled link (the database function on its own) is refused and logged too.
    const ce = email();
    const ct = ((await inviteMember(consoleDb, as(poTok), ce, "Orang Batal", ["support"])) as { data: { token: string } }).data.token;
    const cid = (await h.admin.query(`select id from vendor_staff_invitations where email = $1`, [ce])).rows[0].id;
    await cancelMemberInvite(consoleDb, as(poTok), cid);
    const used = (await consoleDb.query(`select vendor_staff_invite_accept($1, $2) as r`, [hashToken(ct), await account(false, ce)])).rows[0].r;
    expect(used).toMatchObject({ ok: false, code: "ERR_NOT_FOUND" });
    expect((await h.admin.query(`select reason_code from vendor_actions where object_id = $1 and outcome = 'denied'`, [cid])).rows).toEqual([{ reason_code: "not_open" }]);
    // An unknown token logs nothing.
    const before = (await h.admin.query(`select count(*)::int n from vendor_actions`)).rows[0].n;
    expect(await acceptMemberWithNewAccount(consoleDb, auth, "x".repeat(43), PASSWORD)).toMatchObject({ ok: false, code: "ERR_NOT_FOUND" });
    expect((await h.admin.query(`select count(*)::int n from vendor_actions`)).rows[0].n).toBe(before);
    // The new member shows in the list with TOTP not yet enrolled.
    const list = await listTeam(consoleDb, as(poTok));
    expect(list.ok && list.data.staff.find((s) => s.email === e)).toMatchObject({ totp: false, roles: ["onboarding", "support"], state: "active" });
    expect(JSON.stringify(list)).not.toContain(hashToken(token));
  });

  it("refused: another email, expired, cancelled, inviter no longer a platform owner, an existing vendor account, an unapproved clinic membership", async () => {
    // Another account's email.
    const e1 = email();
    const t1 = ((await inviteMember(consoleDb, as(poTok), e1, "Orang Satu", ["support"])) as { data: { token: string } }).data.token;
    const other = await account(false);
    expect((await consoleDb.query(`select vendor_staff_invite_accept($1, $2) as r`, [hashToken(t1), other])).rows[0].r).toMatchObject({ ok: false, reason: "email_mismatch" });
    expect(await lastAction()).toMatchObject({ action: "vendor_staff_invite_accept", outcome: "denied", reason_code: "email_mismatch" });
    // Expired.
    await h.admin.query(`alter table vendor_staff_invitations disable trigger vendor_staff_invitations_guard`);
    await h.admin.query(`update vendor_staff_invitations set expires_at = now() - interval '1 minute', invited_at = now() - interval '8 days' where email = $1`, [e1]);
    await h.admin.query(`alter table vendor_staff_invitations enable trigger vendor_staff_invitations_guard`);
    expect(await lookupMemberInvite(consoleDb, t1)).toBeNull();
    const invitee = await account(false, e1);
    expect((await consoleDb.query(`select vendor_staff_invite_accept($1, $2) as r`, [hashToken(t1), invitee])).rows[0].r).toMatchObject({ ok: false, code: "ERR_NOT_FOUND" });
    await h.admin.query(`delete from auth_user where id = $1`, [invitee]);
    expect(await acceptMemberWithNewAccount(consoleDb, auth, t1, PASSWORD)).toMatchObject({ ok: false });
    expect((await h.admin.query(`select count(*)::int n from auth_user where email = $1`, [e1])).rows[0].n).toBe(0);
    // Cancelled.
    const e2 = email();
    const r2 = await inviteMember(consoleDb, as(poTok), e2, "Orang Dua", ["support"]);
    const t2 = (r2 as { data: { token: string } }).data.token;
    const inv2 = (await h.admin.query(`select id from vendor_staff_invitations where email = $1`, [e2])).rows[0].id;
    expect(await cancelMemberInvite(consoleDb, as(po2Tok), inv2)).toMatchObject({ ok: true });
    expect(await cancelMemberInvite(consoleDb, as(po2Tok), inv2)).toMatchObject({ ok: false, code: "ERR_NOT_FOUND" });
    expect(await acceptMemberWithNewAccount(consoleDb, auth, t2, PASSWORD)).toMatchObject({ ok: false, code: "ERR_NOT_FOUND" });
    expect(await lastAction()).toMatchObject({ action: "vendor_staff_invite_accept", outcome: "denied", reason_code: "not_open" });
    // Inviter lost the platform owner role: the account created by the flow is removed again.
    const tmpPo = await account();
    const c = await op.connect();
    let tmpStaff: string;
    try {
      tmpStaff = await createVendorStaff(c, caller(PO), tmpPo, "Pemilik Sementara", ["platform_owner"]);
    } finally {
      c.release();
    }
    const e3 = email();
    const t3 = ((await inviteMember(consoleDb, as(await session(tmpPo)), e3, "Orang Tiga", ["support"])) as { data: { token: string } }).data.token;
    const c2 = await op.connect();
    try {
      await updateVendorStaff(c2, caller(PO), tmpStaff, ["support"], "active");
    } finally {
      c2.release();
    }
    expect(await acceptMemberWithNewAccount(consoleDb, auth, t3, PASSWORD)).toMatchObject({ ok: false, reason: "inviter_not_authorised" });
    expect((await h.admin.query(`select count(*)::int n from auth_user where email = $1`, [e3])).rows[0].n).toBe(0);
    // The invited email already has an account: refused through the link flow, logged.
    const e6 = email();
    const t6 = ((await inviteMember(consoleDb, as(poTok), e6, "Orang Enam", ["support"])) as { data: { token: string } }).data.token;
    await account(false, e6);
    await expect(acceptMemberWithNewAccount(consoleDb, auth, t6, PASSWORD)).rejects.toThrow(/account for this email exists/);
    expect(await lastAction()).toMatchObject({ action: "vendor_staff_invite_accept", outcome: "denied", reason_code: "account_exists" });
    // Already vendor staff / an unapproved clinic membership (IAM-10): direct accept with that account.
    const e4 = email();
    const t4 = ((await inviteMember(consoleDb, as(poTok), e4, "Orang Empat", ["support"])) as { data: { token: string } }).data.token;
    const clinicAcc = await account(false, e4);
    const tenant = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id;
    await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Klinik Sintetis', 'emkm')`, [tenant]);
    await createMembership(op, { tenantId: tenant, accountId: clinicAcc, displayName: "Orang Empat" });
    expect((await consoleDb.query(`select vendor_staff_invite_accept($1, $2) as r`, [hashToken(t4), clinicAcc])).rows[0].r).toMatchObject({ ok: false, reason: "dual_identity_not_approved" });
    const e5 = (await h.admin.query(`select email from auth_user where id = $1`, [FIN])).rows[0].email;
    expect(await inviteMember(consoleDb, as(poTok), e5, "Keuangan Lagi", ["support"])).toMatchObject({ ok: false, reason: "already_vendor_staff" });
    expect(await lastAction()).toMatchObject({ action: "vendor_staff_invite", outcome: "denied", reason_code: "already_vendor_staff" });
    expect(await inviteMember(consoleDb, as(poTok), e4, "Orang Empat", ["support"])).toMatchObject({ ok: false, reason: "invitation_open" });
  });

  it("only a platform owner with a fresh step-up, from the allowlist; invalid input refused; every refusal logged", async () => {
    expect(await inviteMember(consoleDb, as(finTok), email(), "Orang", ["support"])).toMatchObject({ ok: false, reason: "role_not_held" });
    expect(await lastAction()).toMatchObject({ action: "vendor_staff_invite", outcome: "denied", reason_code: "role_not_held" });
    expect(await listTeam(consoleDb, as(finTok))).toMatchObject({ ok: false, reason: "role_not_held" });
    expect(await inviteMember(consoleDb, as(await session(PO, "30 minutes")), email(), "Orang", ["support"])).toMatchObject({ ok: false, reason: "totp_not_verified" });
    expect(await inviteMember(consoleDb, as(poTok, "198.51.100.7"), email(), "Orang", ["support"])).toMatchObject({ ok: false, reason: "ip_not_allowed" });
    expect(await inviteMember(consoleDb, as("x".repeat(40)), email(), "Orang", ["support"])).toMatchObject({ ok: false, reason: "no_session" });
    for (const [e, name, roles] of [["bukan email", "Orang", ["support"]], [email(), "O", ["support"]], [email(), "Orang", []], [email(), "Orang", ["owner"]]] as [string, string, string[]][]) {
      expect(await inviteMember(consoleDb, as(poTok), e, name, roles), JSON.stringify([e, name, roles])).toMatchObject({ ok: false, code: "ERR_INVALID_INPUT" });
    }
    expect(await lastAction()).toMatchObject({ action: "vendor_staff_invite", outcome: "denied", reason_code: "invalid_input" });
    expect(await cancelMemberInvite(consoleDb, as(finTok), crypto.randomUUID())).toMatchObject({ ok: false, reason: "role_not_held" });
  });
});

describe("Nonaktifkan / Aktifkan Kembali", () => {
  it("platform owner only; keeps roles; never oneself; never the last platform owner; logged", async () => {
    const fin = (await h.admin.query(`select id from vendor_staff where account_id = $1`, [FIN])).rows[0].id;
    const me = (await h.admin.query(`select id from vendor_staff where account_id = $1`, [PO])).rows[0].id;
    expect(await setMemberState(consoleDb, as(poTok), fin, "suspended")).toMatchObject({ ok: true });
    expect((await h.admin.query(`select s.state, array_agg(x.role) roles from vendor_staff s join vendor_staff_roles x on x.staff_id = s.id where s.id = $1 group by 1`, [fin])).rows[0]).toEqual({ state: "suspended", roles: ["vendor_finance"] });
    expect(await listTeam(consoleDb, as(finTok))).toMatchObject({ ok: false, reason: "vendor_staff_inactive" });
    expect(await setMemberState(consoleDb, as(poTok), fin, "active")).toMatchObject({ ok: true });
    expect(await setMemberState(consoleDb, as(poTok), me, "suspended")).toMatchObject({ ok: false, reason: "self_change" });
    expect(await setMemberState(consoleDb, as(finTok), me, "suspended")).toMatchObject({ ok: false, reason: "role_not_held" });
    expect(await setMemberState(consoleDb, as(poTok), fin, "exited")).toMatchObject({ ok: false, code: "ERR_INVALID_INPUT" });
    expect(await lastAction()).toMatchObject({ action: "vendor_staff_update", outcome: "denied", reason_code: "invalid_input" });
    expect(await setMemberState(consoleDb, as(await session(PO, "30 minutes")), fin, "suspended")).toMatchObject({ ok: false, reason: "totp_not_verified" });
  });
});

describe("state change never restores a revoked role (review round 1)", () => {
  it("a demotion committed while a state change waits on the staff lock is kept", async () => {
    const target = await account();
    const c = await op.connect();
    let staffId: string;
    try {
      staffId = await createVendorStaff(c, caller(PO), target, "Target Demosi", ["platform_owner"]);
    } finally {
      c.release();
    }
    // Connection A holds the vendor_staff lock and demotes the target; the console state
    // change (B) starts meanwhile and must read the roles only after A commits.
    const a = await op.connect();
    try {
      await a.query("begin");
      await a.query(`select pg_advisory_xact_lock(hashtextextended('vendor_staff', 0))`);
      const b = setMemberState(consoleDb, as(po2Tok), staffId, "suspended");
      await waitForLockWaiter();
      await a.query(`delete from vendor_staff_roles where staff_id = $1 and role = 'platform_owner'`, [staffId]);
      await a.query(`insert into vendor_staff_roles (staff_id, role) values ($1, 'support')`, [staffId]);
      await a.query("commit");
      expect(await b).toMatchObject({ ok: true });
    } finally {
      a.release();
    }
    expect((await h.admin.query(`select s.state, array_agg(x.role) roles from vendor_staff s join vendor_staff_roles x on x.staff_id = s.id where s.id = $1 group by 1`, [staffId])).rows[0]).toEqual({ state: "suspended", roles: ["support"] });
  });
});

describe("refusal log dedup under concurrency (review round 2)", () => {
  it("parallel refused uses of one closed link log exactly one refusal", async () => {
    const e = email();
    const t = ((await inviteMember(consoleDb, as(poTok), e, "Orang Paralel", ["support"])) as { data: { token: string } }).data.token;
    const id = (await h.admin.query(`select id from vendor_staff_invitations where email = $1`, [e])).rows[0].id;
    await cancelMemberInvite(consoleDb, as(poTok), id);
    const par = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [VENDOR_GROUP_ROLE])), max: 8 }, VENDOR_GROUP_ROLE);
    try {
      const acc = await account(false, e);
      await Promise.all([
        ...Array.from({ length: 6 }, () => par.query(`select vendor_staff_invite_refused($1, 'not_open')`, [hashToken(t)])),
        ...Array.from({ length: 2 }, () => par.query(`select vendor_staff_invite_accept($1, $2)`, [hashToken(t), acc])),
      ]);
    } finally {
      await par.end();
    }
    expect((await h.admin.query(`select count(*)::int n from vendor_actions where object_id = $1 and outcome = 'denied' and reason_code = 'not_open'`, [id])).rows[0].n).toBe(1);
  });

  it("a second refusal started while the first is uncommitted waits for it and logs nothing", async () => {
    const e = email();
    const t = ((await inviteMember(consoleDb, as(poTok), e, "Orang Antre", ["support"])) as { data: { token: string } }).data.token;
    const id = (await h.admin.query(`select id from vendor_staff_invitations where email = $1`, [e])).rows[0].id;
    await cancelMemberInvite(consoleDb, as(poTok), id);
    const a = await op.connect();
    try {
      // A: first refusal, not yet committed (holds the per-invitation lock with the row written).
      await a.query("begin");
      await a.query(`select vendor_staff_invite_refused($1, 'not_open')`, [hashToken(t)]);
      // B starts now; without the lock it would not see A's row and log a second one.
      const b = consoleDb.query(`select vendor_staff_invite_refused($1, 'not_open')`, [hashToken(t)]);
      await waitForLockWaiter();
      await a.query("commit");
      await b;
    } finally {
      a.release();
    }
    expect((await h.admin.query(`select count(*)::int n from vendor_actions where object_id = $1 and outcome = 'denied' and reason_code = 'not_open'`, [id])).rows[0].n).toBe(1);
  });
});

describe("history and privileges", () => {
  it("invitation history only moves forward; no table is readable by the console or the app", async () => {
    const e = email();
    await inviteMember(consoleDb, as(poTok), e, "Orang Riwayat", ["support"]);
    const id = (await h.admin.query(`select id from vendor_staff_invitations where email = $1`, [e])).rows[0].id;
    for (const q of [`update vendor_staff_invitations set roles = '{platform_owner}' where id = '${id}'`, `delete from vendor_staff_invitations where id = '${id}'`,
      `update vendor_staff_invitations set state = 'pending' where id = '${id}'`]) {
      await expect(h.admin.query(q), q).rejects.toMatchObject({ code: expect.stringMatching(/42501|23514/) });
    }
    await expect(consoleDb.query(`select 1 from vendor_staff_invitations limit 1`)).rejects.toMatchObject({ code: "42501" });
    await expect(appPoolRole.query(`select vendor_console_staff_list('a','b')`)).rejects.toMatchObject({ code: "42501" });
  });

  it("clinic_vendor executes exactly the console functions (session-token entry points) and the two invitation-link functions", async () => {
    const fns = (await h.admin.query(`select p.proname || '(' || oidvectortypes(p.proargtypes) || ')' f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                       where n.nspname = 'public' and has_function_privilege('clinic_vendor', p.oid, 'EXECUTE')
                                         and not has_function_privilege('public', p.oid, 'EXECUTE') order by 1`)).rows.map((r) => r.f);
    expect(fns).toEqual([
      // HYG-008b: the console logs an authority re-check refusal in its own transaction.
      "vendor_authority_refused(text, text, text, text, uuid, uuid, text)",
      "vendor_console_ip_allowed(text)",
      "vendor_console_me(text, text)",
      "vendor_console_onboarding_access(text, text, uuid, text)",
      "vendor_console_onboarding_invite(text, text, uuid, text, text, text[], uuid[])",
      "vendor_console_owner_invite(text, text, uuid, text, text)",
      "vendor_console_owner_invite_approve(text, text, uuid, text)",
      "vendor_console_owner_invite_cancel(text, text, uuid)",
      "vendor_console_staff_invite(text, text, text, text, text[], text)",
      "vendor_console_staff_invite_cancel(text, text, uuid)",
      "vendor_console_staff_list(text, text)",
      "vendor_console_staff_state(text, text, uuid, text)",
      "vendor_console_support_end(text, text, uuid)",
      "vendor_console_support_extend(text, text, uuid, text, integer)",
      "vendor_console_support_list(text, text, uuid)",
      "vendor_console_support_open(text, text, uuid, text, text[], integer)",
      "vendor_console_support_ticket(text, text, uuid, integer, bigint)",
      "vendor_console_tenant_advance(text, text, uuid, text, text)",
      "vendor_console_tenant_create(text, text, text, text, text, text, text, text, text)",
      "vendor_console_tenant_detail(text, text, uuid)",
      "vendor_console_tenants(text, text)",
      "vendor_staff_invite_accept(text, uuid)",
      "vendor_staff_invite_lookup(text)",
      "vendor_staff_invite_refused(text, text)",
    ]);
  });
});
