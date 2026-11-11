// T-023 Done-when: creating a tenant writes registry, tenant and branch rows; moving to
// onboarding is refused while the processor-agreement evidence is not approved. Plus the
// first-owner invitation (DEC-033): maker-checker, single use, only while no Owner, never a
// vendor account, Owner membership on acceptance; console guard and logging; isolation.
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_GROUP_ROLE, AUTH_GROUP_ROLE, VENDOR_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { createAuth } from "../../src/auth/server";
import { decideEvidence, uploadEvidence } from "../../src/modules/compliance/compliance";
import { resolveContext } from "../../src/modules/org/identity";
import { acceptOwnerWithNewAccount, invite, lookupOwnerInvite } from "../../src/modules/org/staff/staff";
import { bootstrapVendor, createVendorStaff, type VendorCaller } from "../../src/modules/vendor/staff/staff";
import { advanceTenant, approveOwnerInvite, cancelOwnerInvite, createTenant, type NewTenant, requestOwnerInvite, tenantDetail } from "../../src/modules/vendor/tenants/tenants";
import { createHarness, type Harness, testPool } from "../rls/harness";
import { PASSWORD } from "../auth/helpers";

let h: Harness;
let app: pg.Pool;
let consoleDb: pg.Pool;
let authPool: pg.Pool;
let auth: ReturnType<typeof createAuth>;
let n = 0;
const IP = "203.0.113.10";
const caller = (accountId: string): VendorCaller => ({ accountId, ip: IP, mfaAt: new Date() });

async function account(totp = true): Promise<string> {
  return (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('V', $1, $2) returning id`, [`tn${++n}@vendor-sintetis.test`, totp])).rows[0].id as string;
}
async function session(acc: string, mfaAgo = "0 minutes"): Promise<string> {
  const tok = `tok${++n}${randomBytes(12).toString("hex")}`;
  await h.admin.query(`insert into auth_session (user_id, token, expires_at, surface, second_factor_at) values ($1, $2, now() + interval '8 hours', 'vendor', now() - $3::interval)`, [acc, tok, mfaAgo]);
  return tok;
}
const tenantInput = (over: Partial<NewTenant> = {}): NewTenant => ({
  legalName: `PT Klinik Sintetis ${++n}`, sak: "emkm", branchCode: "PST", branchName: "Cabang Pusat", timezone: "Asia/Jakarta",
  ownerName: "Ibu Pemilik Sintetis", ownerEmail: `pemilik${n}@klinik-sintetis.test`, ...over,
});
const lastAction = async () => (await h.admin.query(`select action, outcome, reason_code from vendor_actions order by seq desc limit 1`)).rows[0];

let PO: string; let PO2: string; let ONB: string; let FIN: string;
let poTok: string; let po2Tok: string; let onbTok: string; let finTok: string;
const as = (token: string) => ({ token, ip: IP });

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 4 });
  consoleDb = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [VENDOR_GROUP_ROLE])), max: 3 }, VENDOR_GROUP_ROLE);
  authPool = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [AUTH_GROUP_ROLE])), max: 3 }, AUTH_GROUP_ROLE);
  auth = createAuth({ pool: authPool, baseURL: "http://app.test", secret: randomBytes(32).toString("base64"), roles: async () => [], rateLimit: false, sleep: async () => {} });
  const op = testPool({ connectionString: h.ownerUrl(), max: 1 });
  const c = await op.connect();
  try {
    PO = await account();
    await bootstrapVendor(c, PO, "Pemilik Platform", "203.0.113.0/24", "Kantor vendor");
    PO2 = await account(); ONB = await account(); FIN = await account();
    await createVendorStaff(c, caller(PO), PO2, "Pemilik Platform Kedua", ["platform_owner"]);
    await createVendorStaff(c, caller(PO), ONB, "Onboarding Vendor", ["onboarding"]);
    await createVendorStaff(c, caller(PO), FIN, "Keuangan Vendor", ["vendor_finance"]);
  } finally {
    c.release();
    await op.end();
  }
  poTok = await session(PO); po2Tok = await session(PO2); onbTok = await session(ONB); finTok = await session(FIN);
});

afterAll(async () => {
  await authPool?.end();
  await consoleDb?.end();
  await app?.end();
  await h?.close();
});

describe("Buat Tenant (PR-1, Done-when)", () => {
  it("writes exactly the registry (provisioning), the tenant and the first branch, plus a pending first-owner invitation", async () => {
    const r = await createTenant(consoleDb, as(onbTok), tenantInput({ legalName: "PT Klinik Aurelia Sintetis", branchCode: "KMG", branchName: "Cabang Kemang" }));
    expect(r.ok).toBe(true);
    const id = (r as { data: { tenant_id: string } }).data.tenant_id;
    expect((await h.admin.query(`select lifecycle_state from tenants_registry where id = $1`, [id])).rows).toEqual([{ lifecycle_state: "provisioning" }]);
    expect((await h.admin.query(`select legal_name, sak_framework from tenants where id = $1`, [id])).rows).toEqual([{ legal_name: "PT Klinik Aurelia Sintetis", sak_framework: "emkm" }]);
    expect((await h.admin.query(`select code, name, timezone from branches where tenant_id = $1`, [id])).rows).toEqual([{ code: "KMG", name: "Cabang Kemang", timezone: "Asia/Jakarta" }]);
    expect((await h.admin.query(`select state, token_hash from tenant_owner_invitations where tenant_id = $1`, [id])).rows).toEqual([{ state: "pending", token_hash: null }]);
    expect((await h.admin.query(`select count(*)::int n from memberships where tenant_id = $1`, [id])).rows[0].n).toBe(0);
    // Logged in the vendor log (the tenant has no audit chain rows before it has staff? it does: SEC-16 rows by vendor staff).
    const acts = (await h.admin.query(`select action, outcome from vendor_actions where tenant_id = $1 order by seq`, [id])).rows.map((x) => `${x.action}:${x.outcome}`);
    expect(acts).toEqual(["tenant_create:success", "owner_invite_request:success"]);
  });

  it("only onboarding or a platform owner, with a session, a fresh TOTP and an allowlisted IP; every refusal logged; inputs validated", async () => {
    expect(await createTenant(consoleDb, as(finTok), tenantInput())).toMatchObject({ ok: false, reason: "role_not_held" });
    expect(await lastAction()).toMatchObject({ action: "tenant_create", outcome: "denied", reason_code: "role_not_held" });
    // No valid session: refused, and not logged (nothing to attribute; an anonymous caller
    // must not be able to write log rows), as vendor_console_guard (T-021).
    const before = (await h.admin.query(`select count(*)::int n from vendor_actions`)).rows[0].n;
    expect(await createTenant(consoleDb, as("x".repeat(40)), tenantInput())).toMatchObject({ ok: false, reason: "no_session" });
    expect((await h.admin.query(`select count(*)::int n from vendor_actions`)).rows[0].n).toBe(before);
    expect(await createTenant(consoleDb, as(await session(ONB, "30 minutes")), tenantInput())).toMatchObject({ ok: false, reason: "totp_not_verified" });
    expect(await createTenant(consoleDb, { token: onbTok, ip: "198.51.100.7" }, tenantInput())).toMatchObject({ ok: false, reason: "ip_not_allowed" });
    for (const bad of [{ legalName: "PT" }, { sak: "x" as never }, { branchCode: "kmg" }, { branchCode: "TERLALU-PANJANG" }, { timezone: "Asia/Singapore" as never },
      { ownerName: "A" }, { ownerEmail: "bukan email" }, { ownerEmail: "a@b" }]) {
      expect(await createTenant(consoleDb, as(onbTok), tenantInput(bad)), JSON.stringify(bad)).toMatchObject({ ok: false, code: "ERR_INVALID_INPUT" });
    }
    expect(await lastAction()).toMatchObject({ action: "tenant_create", outcome: "denied", reason_code: "invalid_input" });
  });
});

describe("first-owner invitation (DEC-033)", () => {
  async function fresh() {
    const r = await createTenant(consoleDb, as(onbTok), tenantInput());
    return (r as { data: { tenant_id: string; invitation_id: string } }).data;
  }

  it("a different platform owner approves; the maker cannot; the link works once for that email and creates the Owner", async () => {
    const t = await fresh();
    expect(await approveOwnerInvite(consoleDb, as(finTok), t.invitation_id)).toMatchObject({ ok: false, reason: "role_not_held" });
    // A platform owner who made the request cannot approve it.
    const byPo = (await createTenant(consoleDb, as(poTok), tenantInput())) as { data: { invitation_id: string } };
    expect(await approveOwnerInvite(consoleDb, as(poTok), byPo.data.invitation_id)).toMatchObject({ ok: false, code: "ERR_APPROVER_IS_REQUESTER" });
    // A malformed hash or an unknown invitation is refused and logged.
    const bad = await consoleDb.query(`select vendor_console_owner_invite_approve($1, $2, $3, 'nothex') as r`, [poTok, IP, t.invitation_id]);
    expect(bad.rows[0].r).toMatchObject({ ok: false, code: "ERR_INVALID_INPUT" });
    expect(await lastAction()).toMatchObject({ action: "owner_invite_approve", outcome: "denied", reason_code: "invalid_input" });
    expect(await approveOwnerInvite(consoleDb, as(poTok), null)).toMatchObject({ ok: false, reason: "not_pending" });
    expect(await lastAction()).toMatchObject({ action: "owner_invite_approve", outcome: "denied", reason_code: "not_pending" });
    const ok = await approveOwnerInvite(consoleDb, as(poTok), t.invitation_id);
    expect(ok.ok).toBe(true);
    const token = (ok as { data: { token: string } }).data.token;
    expect(await approveOwnerInvite(consoleDb, as(po2Tok), t.invitation_id)).toMatchObject({ ok: false, reason: "not_pending" });
    // Only the hash is stored.
    expect((await h.admin.query(`select token_hash from tenant_owner_invitations where id = $1`, [t.invitation_id])).rows[0].token_hash).not.toContain(token);
    const info = await lookupOwnerInvite(app, token);
    expect(info).toMatchObject({ displayName: "Ibu Pemilik Sintetis", clinic: expect.stringMatching(/^PT Klinik Sintetis/) });
    const accepted = await acceptOwnerWithNewAccount(app, auth, token, PASSWORD);
    expect(accepted).toMatchObject({ tenantId: t.tenant_id });
    // The person is the Owner (no D7 confirmation step), audited as the first owner.
    await expect(resolveContext(app, accepted!.accountId, { tenantId: t.tenant_id, actingRole: "owner" })).resolves.toMatchObject({ actingRole: "owner" });
    expect((await h.admin.query(`select reason_code from audit_events where tenant_id = $1 and reason_code = 'first_owner_joined'`, [t.tenant_id])).rows).toHaveLength(1);
    expect((await h.admin.query(`select state, accepted_account from tenant_owner_invitations where id = $1`, [t.invitation_id])).rows[0]).toEqual({ state: "accepted", accepted_account: accepted!.accountId });
    // Single use; and no new first-owner invitation while an Owner exists.
    expect(await lookupOwnerInvite(app, token)).toBeNull();
    expect(await acceptOwnerWithNewAccount(app, auth, token, PASSWORD)).toBeNull();
    const usedHash = (await h.admin.query(`select token_hash from tenant_owner_invitations where id = $1`, [t.invitation_id])).rows[0].token_hash;
    const late = (await h.admin.query(`insert into auth_user (name, email) values ('L', $1) returning id`, [`late${++n}@klinik-sintetis.test`])).rows[0].id;
    await expect(app.query(`select * from tenant_owner_invite_accept($1, $2)`, [usedHash, late])).rejects.toMatchObject({ code: "P0002" });
    expect(await requestOwnerInvite(consoleDb, as(onbTok), t.tenant_id, "Orang Lain", "lain@klinik-sintetis.test")).toMatchObject({ ok: false, reason: "owner_or_invitation_exists" });
    // From here, invitations come from the Owner (DEC-024/031).
    const ctx = await resolveContext(app, accepted!.accountId, { tenantId: t.tenant_id, actingRole: "owner" });
    const branch = (await h.admin.query(`select id from branches where tenant_id = $1`, [t.tenant_id])).rows[0].id;
    await expect(withTenantContext(app, ctx, (db) => invite(db, { email: `adm${n}@klinik-sintetis.test`, name: "Admin Pusat Baru", roles: ["admin_pusat"], branchIds: [] }))).resolves.toBeTruthy();
    await expect(withTenantContext(app, ctx, (db) => invite(db, { email: `dok${n}@klinik-sintetis.test`, name: "Dokter Baru", roles: ["doctor"], branchIds: [branch] }))).resolves.toBeTruthy();
  });

  it("refused for another email, an expired link, a vendor staff account, or once an Owner joined another way", async () => {
    const t = await fresh();
    const token = ((await approveOwnerInvite(consoleDb, as(poTok), t.invitation_id)) as { data: { token: string } }).data.token;
    const hash = (await h.admin.query(`select token_hash from tenant_owner_invitations where id = $1`, [t.invitation_id])).rows[0].token_hash;
    const other = (await h.admin.query(`insert into auth_user (name, email) values ('O', 'orang.lain@klinik-sintetis.test') returning id`)).rows[0].id;
    await expect(app.query(`select * from tenant_owner_invite_accept($1, $2)`, [hash, other])).rejects.toMatchObject({ code: "42501" });
    // A vendor staff account with the invited email cannot accept.
    const t2 = await fresh();
    const vEmail = (await h.admin.query(`select email from tenant_owner_invitations where id = $1`, [t2.invitation_id])).rows[0].email;
    const vAcc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('V', $1, true) returning id`, [vEmail])).rows[0].id;
    const op = testPool({ connectionString: h.ownerUrl(), max: 1 });
    const c = await op.connect();
    try {
      await createVendorStaff(c, caller(PO), vAcc, "Staf Vendor", ["support"]);
    } finally {
      c.release();
      await op.end();
    }
    await approveOwnerInvite(consoleDb, as(poTok), t2.invitation_id);
    const hash2 = (await h.admin.query(`select token_hash from tenant_owner_invitations where id = $1`, [t2.invitation_id])).rows[0].token_hash;
    await expect(app.query(`select * from tenant_owner_invite_accept($1, $2)`, [hash2, vAcc])).rejects.toMatchObject({ code: "42501" });
    // Expired.
    await h.admin.query(`alter table tenant_owner_invitations disable trigger tenant_owner_invitations_guard`);
    await h.admin.query(`update tenant_owner_invitations set expires_at = now() - interval '1 minute' where id = $1`, [t.invitation_id]);
    await h.admin.query(`alter table tenant_owner_invitations enable trigger tenant_owner_invitations_guard`);
    expect(await lookupOwnerInvite(app, token)).toBeNull();
    const invitee = (await h.admin.query(`insert into auth_user (name, email) select 'I', email from tenant_owner_invitations where id = $1 returning id`, [t.invitation_id])).rows[0].id;
    await expect(app.query(`select * from tenant_owner_invite_accept($1, $2)`, [hash, invitee])).rejects.toMatchObject({ code: "P0002" });
    // Expired: a new invitation can be requested (maker) and needs the checker again.
    const again = await requestOwnerInvite(consoleDb, as(onbTok), t.tenant_id, "Ibu Pemilik Sintetis", `baru${n}@klinik-sintetis.test`);
    expect(again.ok).toBe(true);
    expect((await h.admin.query(`select state from tenant_owner_invitations where id = $1`, [t.invitation_id])).rows[0].state).toBe("expired");
    // Cancelling an open invitation.
    expect(await cancelOwnerInvite(consoleDb, as(onbTok), (again as { data: { invitation_id: string } }).data.invitation_id)).toMatchObject({ ok: true });
    expect(await cancelOwnerInvite(consoleDb, as(onbTok), (again as { data: { invitation_id: string } }).data.invitation_id)).toMatchObject({ ok: false, code: "ERR_NOT_FOUND" });
  });

  it("an issued link stops working once the tenant has an Owner, and a vendor approval is refused then too", async () => {
    const t = await fresh();
    const token = ((await approveOwnerInvite(consoleDb, as(poTok), t.invitation_id)) as { data: { token: string } }).data.token;
    const second = await fresh();
    // An Owner joins by another path (first link of another invitation is not possible: use the owner pool).
    const acc = (await h.admin.query(`insert into auth_user (name, email) values ('P', $1) returning id`, [`lain${++n}@klinik-sintetis.test`])).rows[0].id;
    const op = testPool({ connectionString: h.ownerUrl(), max: 1 });
    try {
      const m = (await op.query(`insert into memberships (tenant_id, account_id) values ($1, $2) returning id`, [t.tenant_id, acc])).rows[0].id;
      const st = (await op.query(`insert into staff (tenant_id, membership_id, display_name) values ($1, $2, 'Owner Lain') returning id`, [t.tenant_id, m])).rows[0].id;
      await op.query(`insert into staff_roles (tenant_id, staff_id, role) values ($1, $2, 'owner')`, [t.tenant_id, st]);
      const m2 = (await op.query(`insert into memberships (tenant_id, account_id) values ($1, $2) returning id`, [second.tenant_id, acc])).rows[0].id;
      const st2 = (await op.query(`insert into staff (tenant_id, membership_id, display_name) values ($1, $2, 'Owner Lain') returning id`, [second.tenant_id, m2])).rows[0].id;
      await op.query(`insert into staff_roles (tenant_id, staff_id, role) values ($1, $2, 'owner')`, [second.tenant_id, st2]);
    } finally {
      await op.end();
    }
    expect(await lookupOwnerInvite(app, token)).toBeNull();
    expect(await acceptOwnerWithNewAccount(app, auth, token, PASSWORD)).toBeNull();
    // Closed in the same transaction as the Owner role, so it stays closed even after that
    // Owner's membership ends.
    expect((await h.admin.query(`select state from tenant_owner_invitations where tenant_id in ($1, $2) order by tenant_id`, [t.tenant_id, second.tenant_id])).rows.map((x) => x.state)).toEqual(["cancelled", "cancelled"]);
    await h.admin.query(`update memberships set effective_to = now() where tenant_id = $1 and account_id = $2`, [t.tenant_id, acc]);
    expect(await lookupOwnerInvite(app, token)).toBeNull();
    const h1 = (await h.admin.query(`select token_hash, email from tenant_owner_invitations where id = $1`, [t.invitation_id])).rows[0];
    const invitee = (await h.admin.query(`insert into auth_user (name, email) values ('I', $1) returning id`, [h1.email])).rows[0].id;
    await expect(app.query(`select * from tenant_owner_invite_accept($1, $2)`, [h1.token_hash, invitee])).rejects.toMatchObject({ code: "P0002" });
    expect(await approveOwnerInvite(consoleDb, as(poTok), second.invitation_id)).toMatchObject({ ok: false, reason: "not_pending" });
  });

  it("invitation history only moves forward; the tables are platform-only", async () => {
    const t = await fresh();
    for (const q of [`update tenant_owner_invitations set email = 'x@klinik-sintetis.test' where id = '${t.invitation_id}'`,
      `delete from tenant_owner_invitations where id = '${t.invitation_id}'`,
      `update tenant_owner_invitations set state = 'accepted' where id = '${t.invitation_id}'`]) {
      await expect(h.admin.query(q), q).rejects.toMatchObject({ code: expect.stringMatching(/42501|23514/) });
    }
    await expect(app.query(`select 1 from tenant_owner_invitations limit 1`)).rejects.toMatchObject({ code: "42501" });
    await expect(consoleDb.query(`select 1 from tenant_owner_invitations limit 1`)).rejects.toMatchObject({ code: "42501" });
    await expect(app.query(`select vendor_console_tenant_create('a','b','c','emkm','PST','x','Asia/Jakarta','x','x@x.co')`)).rejects.toMatchObject({ code: "42501" });
  });
});

describe("onboarding gate (TEN-12, Done-when)", () => {
  it("moving to onboarding is refused until the Owner approves the processor agreement, then allowed", async () => {
    const t = (await createTenant(consoleDb, as(onbTok), tenantInput())) as { data: { tenant_id: string; invitation_id: string } };
    const tenantId = t.data.tenant_id;
    expect(await advanceTenant(consoleDb, as(onbTok), tenantId, "onboarding", "Mulai onboarding klinik baru")).toMatchObject({ ok: false, reason: "processor_agreement" });
    const token = ((await approveOwnerInvite(consoleDb, as(poTok), t.data.invitation_id)) as { data: { token: string } }).data.token;
    const owner = await acceptOwnerWithNewAccount(app, auth, token, PASSWORD);
    const ctx = await resolveContext(app, owner!.accountId, { tenantId, actingRole: "owner" });
    const pdf = Buffer.from("%PDF-1.7\nPerjanjian pengolahan data sintetis\n%%EOF\n");
    const file = await withTenantContext(app, ctx, (db) => uploadEvidence(db, { obligationKey: "processor_agreement_signed", fileName: "dpa.pdf", content: pdf, expertName: "Konsultan Hukum Sintetis", documentDate: "2026-10-01" }));
    expect(await advanceTenant(consoleDb, as(onbTok), tenantId, "onboarding", "Mulai onboarding klinik baru")).toMatchObject({ ok: false, reason: "processor_agreement" });
    const item = (await h.admin.query(`select item_id from evidence_files where id = $1`, [file.fileId])).rows[0].item_id;
    await withTenantContext(app, ctx, (db) => decideEvidence(db, item, file.fileId, "approved"));
    expect(await advanceTenant(consoleDb, as(onbTok), tenantId, "onboarding", "Mulai onboarding klinik baru")).toEqual({ ok: true, data: { ok: true, state: "onboarding" } });
    // Again: not a step any more, refused and logged; a malformed tenant id is logged too.
    expect(await advanceTenant(consoleDb, as(onbTok), tenantId, "onboarding", "Mulai onboarding klinik baru")).toMatchObject({ ok: false, reason: "not_a_step" });
    expect(await lastAction()).toMatchObject({ action: "tenant_onboarding", outcome: "denied", reason_code: "not_a_step" });
    expect(await advanceTenant(consoleDb, as(onbTok), null, "onboarding", "Mulai onboarding klinik baru")).toMatchObject({ ok: false, code: "ERR_INVALID_INPUT" });
    expect(await lastAction()).toMatchObject({ action: "tenant_onboarding", outcome: "denied", reason_code: "invalid_input" });
    const d = await tenantDetail(consoleDb, as(finTok), tenantId);
    expect(d).toMatchObject({ ok: true, data: { state: "onboarding", has_owner: true, processor_agreement: true } });
  });

  it("the detail shows no patient or staff data and another tenant's id is not found", async () => {
    const t = (await createTenant(consoleDb, as(onbTok), tenantInput())) as { data: { tenant_id: string } };
    const d = (await tenantDetail(consoleDb, as(finTok), t.data.tenant_id)) as { data: Record<string, unknown> };
    expect(Object.keys(d.data).sort()).toEqual(["branches", "has_owner", "history", "id", "invitations", "me", "my_roles", "name", "ok", "processor_agreement", "sak", "state"]);
    expect(await tenantDetail(consoleDb, as(finTok), crypto.randomUUID())).toMatchObject({ ok: false, code: "ERR_NOT_FOUND" });
  });
});
