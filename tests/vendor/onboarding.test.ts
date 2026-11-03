// T-024 Done-when (PR-58, TEN-13, PR-60 expired grant): the onboarding grant is created when
// the tenant enters onboarding and ends at go-live or day 30 (renewable once by the Owner);
// it opens configuration kinds only — a patient record is denied and audited; invitations
// prepared under it are drafts the Owner confirms; Level 2 roles and vendor accounts are
// never invitable (self-invite as Owner refused and audited).
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_GROUP_ROLE, AUTH_GROUP_ROLE, VENDOR_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { createAuth } from "../../src/auth/server";
import { CommandError } from "../../src/lib/command";
import { assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { acceptWithNewAccount, lookupInvite } from "../../src/modules/org/staff/staff";
import { confirmDraft, declineDraft, draftInvitation, grantStatus, onboardingAccess, renewGrant } from "../../src/modules/vendor/onboarding/onboarding";
import { bootstrapVendor, createVendorStaff, type VendorCaller } from "../../src/modules/vendor/staff/staff";
import { advanceTenant } from "../../src/modules/vendor/tenants/tenants";
import { createHarness, type Harness } from "../rls/harness";
import { PASSWORD } from "../auth/helpers";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let consoleDb: pg.Pool;
let authPool: pg.Pool;
let auth: ReturnType<typeof createAuth>;
let n = 0;
const IP = "203.0.113.10";
const caller = (accountId: string): VendorCaller => ({ accountId, ip: IP, mfaAt: new Date() });

async function account(totp = true, email = `onb${++n}@vendor-sintetis.test`): Promise<string> {
  return (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('V', $1, $2) returning id`, [email, totp])).rows[0].id as string;
}
async function session(acc: string, mfaAgo = "0 minutes"): Promise<string> {
  const tok = `tok${++n}${randomBytes(12).toString("hex")}`;
  await h.admin.query(`insert into auth_session (user_id, token, expires_at, surface, second_factor_at) values ($1, $2, now() + interval '8 hours', 'vendor', now() - $3::interval)`, [acc, tok, mfaAgo]);
  return tok;
}
const as = (token: string, ip = IP) => ({ token, ip });
const lastAction = async () => (await h.admin.query(`select action, outcome, reason_code, tenant_id from vendor_actions order by seq desc limit 1`)).rows[0];

type Clinic = { tenantId: string; branchId: string; ownerAcc: string; ownerStaff: string; adminAcc: string };
// A tenant in provisioning with an Owner and an Admin Pusat, moved to onboarding through the
// console (so the grant comes from the lifecycle, not from the test).
async function clinic(onboard = true): Promise<Clinic> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('provisioning') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Klinik Sintetis', 'emkm')`, [tenantId]);
  const branchId = (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'B1', 'Cabang 1', 'Asia/Jakarta') returning id`, [tenantId])).rows[0].id as string;
  const member = async (role: "owner" | "admin_pusat") => {
    const acc = (await h.admin.query(`insert into auth_user (name, email) values ('C', $1) returning id`, [`klinik${++n}@klinik-sintetis.test`])).rows[0].id as string;
    const { staffId } = await createMembership(owner, { tenantId, accountId: acc, displayName: `Staf ${n}` });
    await assignRole(h.admin, { tenantId, staffId, role });
    return { acc, staffId };
  };
  const o = await member("owner");
  const a = await member("admin_pusat");
  if (onboard) {
    // The processor agreement is approved (TEN-12) directly here; T-023 tests the real path.
    await markAgreementApproved(tenantId, o.staffId);
    const r = await advanceTenant(consoleDb, as(onbTok), tenantId, "onboarding", "Mulai onboarding klinik uji");
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
  }
  return { tenantId, branchId, ownerAcc: o.acc, ownerStaff: o.staffId, adminAcc: a.acc };
}
async function markAgreementApproved(tenantId: string, ownerStaff: string) {
  const { decideEvidence, uploadEvidence } = await import("../../src/modules/compliance/compliance");
  const ownerAcc = (await h.admin.query(`select m.account_id from staff s join memberships m on m.id = s.membership_id where s.id = $1`, [ownerStaff])).rows[0].account_id;
  const ctx = await resolveContext(app, ownerAcc, { tenantId, actingRole: "owner" });
  const pdf = Buffer.from("%PDF-1.7\nPerjanjian pengolahan data sintetis\n%%EOF\n");
  const file = await withTenantContext(app, ctx, (db) => uploadEvidence(db, { obligationKey: "processor_agreement_signed", fileName: "dpa.pdf", content: pdf, expertName: "Konsultan Hukum Sintetis", documentDate: "2026-10-01" }));
  const item = (await h.admin.query(`select item_id from evidence_files where id = $1`, [file.fileId])).rows[0].item_id;
  await withTenantContext(app, ctx, (db) => decideEvidence(db, item, file.fileId, "approved"));
}
const asOwner = async <R>(c: Clinic, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, c.ownerAcc, { tenantId: c.tenantId, actingRole: "owner" }), fn);
const asAdmin = async <R>(c: Clinic, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, c.adminAcc, { tenantId: c.tenantId, actingRole: "admin_pusat" }), fn);
const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e instanceof CommandError ? e.code : (e as { code?: string }).code ?? String(e)));
// Moves the grant clock back (test-only, with the guard trigger off).
async function ageGrant(tenantId: string, days: number) {
  await h.admin.query(`alter table onboarding_grants disable trigger onboarding_grants_guard`);
  await h.admin.query(`update onboarding_grants set granted_at = granted_at - make_interval(days => $2), expires_at = expires_at - make_interval(days => $2) where tenant_id = $1`, [tenantId, days]);
  await h.admin.query(`alter table onboarding_grants enable trigger onboarding_grants_guard`);
}

let PO: string; let ONB: string; let FIN: string;
let poTok: string; let onbTok: string; let finTok: string;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 4 });
  owner = new pg.Pool({ connectionString: h.ownerUrl(), max: 2 });
  consoleDb = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [VENDOR_GROUP_ROLE])), max: 3 }, VENDOR_GROUP_ROLE);
  authPool = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [AUTH_GROUP_ROLE])), max: 3 }, AUTH_GROUP_ROLE);
  auth = createAuth({ pool: authPool, baseURL: "http://app.test", secret: randomBytes(32).toString("base64"), roles: async () => [], rateLimit: false, sleep: async () => {} });
  const c = await owner.connect();
  try {
    PO = await account();
    await bootstrapVendor(c, PO, "Pemilik Platform", "203.0.113.0/24", "Kantor vendor");
    ONB = await account();
    FIN = await account();
    await createVendorStaff(c, caller(PO), ONB, "Sari Onboarding", ["onboarding"]);
    await createVendorStaff(c, caller(PO), FIN, "Keuangan Vendor", ["vendor_finance"]);
  } finally {
    c.release();
  }
  poTok = await session(PO); onbTok = await session(ONB); finTok = await session(FIN);
});
afterAll(async () => {
  await authPool?.end();
  await consoleDb?.end();
  await owner?.end();
  await app?.end();
  await h?.close();
});

describe("grant lifecycle (Done-when: expires at go-live or day 30)", () => {
  it("no grant before onboarding; created on provisioning → onboarding for 30 days; ended at go-live", async () => {
    const pre = await clinic(false);
    expect(await onboardingAccess(consoleDb, as(onbTok), pre.tenantId, "catalog")).toMatchObject({ ok: false, reason: "grant_not_active" });
    const c = await clinic();
    const g = (await h.admin.query(`select expires_at - granted_at as d, ended_at from onboarding_grants where tenant_id = $1`, [c.tenantId])).rows[0];
    expect(g).toEqual({ d: { days: 30 }, ended_at: null });
    expect(await onboardingAccess(consoleDb, as(onbTok), c.tenantId, "catalog")).toMatchObject({ ok: true });
    expect(await lastAction()).toMatchObject({ action: "onboarding_read", outcome: "success", reason_code: "kind_catalog", tenant_id: c.tenantId });
    // Go-live (platform owner) ends the grant.
    expect(await advanceTenant(consoleDb, as(poTok), c.tenantId, "live", "Klinik siap melayani pasien")).toMatchObject({ ok: true });
    expect((await h.admin.query(`select end_reason from onboarding_grants where tenant_id = $1`, [c.tenantId])).rows[0].end_reason).toBe("go_live");
    expect(await onboardingAccess(consoleDb, as(onbTok), c.tenantId, "catalog")).toMatchObject({ ok: false, reason: "grant_not_active" });
  });

  it("scenario PR-60 expired grant: created 31 days ago, tenant not live — the catalog is denied (and audited)", async () => {
    const c = await clinic();
    await ageGrant(c.tenantId, 31);
    expect(await onboardingAccess(consoleDb, as(onbTok), c.tenantId, "catalog")).toMatchObject({ ok: false, reason: "grant_not_active" });
    expect(await lastAction()).toMatchObject({ action: "onboarding_read", outcome: "denied", reason_code: "grant_not_active" });
    expect((await h.admin.query(`select reason_code from audit_events where tenant_id = $1 order by seq desc limit 1`, [c.tenantId])).rows[0].reason_code).toBe("grant_not_active");
    // Day 29 still open.
    const d = await clinic();
    await ageGrant(d.tenantId, 29);
    expect(await onboardingAccess(consoleDb, as(onbTok), d.tenantId, "catalog")).toMatchObject({ ok: true });
  });

  it("the Owner renews once (30 days from now); Admin Pusat cannot; not after expiry", async () => {
    const c = await clinic();
    await ageGrant(c.tenantId, 20);
    expect(await code(asAdmin(c, (db) => renewGrant(db)))).toBe("ERR_FORBIDDEN");
    const until = await asOwner(c, (db) => renewGrant(db));
    expect(Math.round((until.getTime() - Date.now()) / 86_400_000)).toBe(30);
    expect(await code(asOwner(c, (db) => renewGrant(db)))).toBe("ERR_VERSION_CONFLICT");
    expect((await h.admin.query(`select reason_code from audit_events where tenant_id = $1 and reason_code = 'onboarding_grant_renewed'`, [c.tenantId])).rows).toHaveLength(1);
    const e = await clinic();
    await ageGrant(e.tenantId, 31);
    expect(await code(asOwner(e, (db) => renewGrant(db)))).toBe("ERR_VERSION_CONFLICT");
    // Status for the Owner (Akses Vendor data): shows the renewal.
    expect(await asOwner(c, (db) => grantStatus(db))).toMatchObject({ grant: { renewed: true, active: true }, drafts: [] });
    expect(await code(asAdmin(c, (db) => grantStatus(db)))).toBe("ERR_FORBIDDEN");
  });
});

describe("the grant is judged at the moment of use (review round 1)", () => {
  it("a transaction that started before expiry cannot use the grant after it", { timeout: 30_000 }, async () => {
    const c = await clinic();
    const vendorTx = await consoleDb.connect();
    try {
      await vendorTx.query("begin");
      // The transaction's now() is fixed here; the grant then expires one second later.
      await vendorTx.query("select now()");
      await h.admin.query(`alter table onboarding_grants disable trigger onboarding_grants_guard`);
      await h.admin.query(`update onboarding_grants set expires_at = clock_timestamp() + interval '1 second' where tenant_id = $1`, [c.tenantId]);
      await h.admin.query(`alter table onboarding_grants enable trigger onboarding_grants_guard`);
      await new Promise((r) => setTimeout(r, 1500));
      const r = (await vendorTx.query(`select vendor_console_onboarding_access($1, $2, $3, 'catalog') as r`, [onbTok, IP, c.tenantId])).rows[0].r;
      expect(r).toMatchObject({ ok: false, reason: "grant_not_active" });
    } finally {
      await vendorTx.query("rollback").catch(() => undefined);
      vendorTx.release();
    }
  });

  it("a draft that waited on the clinic's staff lock past expiry is refused (the grant is judged after the lock)", { timeout: 30_000 }, async () => {
    const c = await clinic();
    await h.admin.query(`alter table onboarding_grants disable trigger onboarding_grants_guard`);
    await h.admin.query(`update onboarding_grants set expires_at = clock_timestamp() + interval '2 seconds' where tenant_id = $1`, [c.tenantId]);
    await h.admin.query(`alter table onboarding_grants enable trigger onboarding_grants_guard`);
    const hold = new pg.Client({ connectionString: h.ownerUrl() });
    await hold.connect();
    try {
      await hold.query("begin");
      await hold.query(`select pg_advisory_xact_lock(hashtextextended('staff_access:' || $1::text, 0))`, [c.tenantId]);
      const pending = draftInvitation(consoleDb, as(onbTok), c.tenantId, { email: `tunggu${++n}@klinik-sintetis.test`, name: "Orang Menunggu", roles: ["marketing"], branchIds: [] });
      for (let i = 0; i < 200 && !(await h.admin.query(`select 1 from pg_locks where locktype = 'advisory' and not granted`)).rowCount; i++) await new Promise((r) => setTimeout(r, 25));
      // The draft holds a share lock on the grant row (its first check), so the grant row
      // cannot be updated now. Expire it by time instead: the grant was set to end 2 s
      // after this test started; wait past that before releasing the lock.
      await new Promise((r) => setTimeout(r, 2_500));
      await hold.query("commit");
      expect(await pending).toMatchObject({ ok: false, reason: "grant_not_active" });
    } finally {
      await hold.query("rollback").catch(() => undefined);
      await hold.end();
    }
    expect((await h.admin.query(`select count(*)::int n from onboarding_invitation_drafts where tenant_id = $1`, [c.tenantId])).rows[0].n).toBe(0);
    expect(await lastAction()).toMatchObject({ action: "onboarding_write", outcome: "denied", reason_code: "grant_not_active" });
  });

  it("a renewal that waited on a vendor transaction holding the grant past expiry is refused (review round 2)", { timeout: 30_000 }, async () => {
    const c = await clinic();
    await h.admin.query(`alter table onboarding_grants disable trigger onboarding_grants_guard`);
    await h.admin.query(`update onboarding_grants set expires_at = clock_timestamp() + interval '2 seconds' where tenant_id = $1`, [c.tenantId]);
    await h.admin.query(`alter table onboarding_grants enable trigger onboarding_grants_guard`);
    const vendorTx = await consoleDb.connect();
    try {
      await vendorTx.query("begin");
      expect((await vendorTx.query(`select vendor_console_onboarding_access($1, $2, $3, 'catalog') as r`, [onbTok, IP, c.tenantId])).rows[0].r).toMatchObject({ ok: true });
      const renewal = code(asOwner(c, (db) => renewGrant(db)));
      for (let i = 0; i < 200 && !(await h.admin.query(`select 1 from pg_locks where not granted and locktype in ('tuple','transactionid')`)).rowCount; i++) await new Promise((r) => setTimeout(r, 25));
      await new Promise((r) => setTimeout(r, 2_500));
      await vendorTx.query("commit");
      expect(await renewal).toBe("ERR_VERSION_CONFLICT");
    } finally {
      vendorTx.release();
    }
    expect((await h.admin.query(`select renewed_at from onboarding_grants where tenant_id = $1`, [c.tenantId])).rows[0].renewed_at).toBeNull();
    expect((await h.admin.query(`select count(*)::int n from audit_events where tenant_id = $1 and reason_code = 'onboarding_grant_renewed'`, [c.tenantId])).rows[0].n).toBe(0);
  });

  it("drafting and the Owner's renewal at the same time never deadlock (one lock order)", { timeout: 30_000 }, async () => {
    const c = await clinic();
    for (let i = 0; i < 5; i++) {
      const results = await Promise.allSettled([
        draftInvitation(consoleDb, as(onbTok), c.tenantId, { email: `paralel${++n}@klinik-sintetis.test`, name: "Orang Paralel", roles: ["marketing"], branchIds: [] }),
        asOwner(c, (db) => renewGrant(db)),
        draftInvitation(consoleDb, as(onbTok), c.tenantId, { email: `paralel${++n}@klinik-sintetis.test`, name: "Orang Paralel", roles: ["marketing"], branchIds: [] }),
      ]);
      for (const r of results) {
        if (r.status === "rejected") expect((r.reason as { code?: string }).code, String(r.reason)).not.toBe("40P01");
      }
    }
    expect((await h.admin.query(`select count(*)::int n from onboarding_invitation_drafts where tenant_id = $1`, [c.tenantId])).rows[0].n).toBe(10);
  });

  it("a draft whose logging waited on the tenant's audit lock past expiry is not written (final re-check)", { timeout: 30_000 }, async () => {
    const c = await clinic();
    await h.admin.query(`alter table onboarding_grants disable trigger onboarding_grants_guard`);
    await h.admin.query(`update onboarding_grants set expires_at = clock_timestamp() + interval '2 seconds' where tenant_id = $1`, [c.tenantId]);
    await h.admin.query(`alter table onboarding_grants enable trigger onboarding_grants_guard`);
    const hold = new pg.Client({ connectionString: h.ownerUrl() });
    await hold.connect();
    try {
      await hold.query("begin");
      await hold.query(`select pg_advisory_xact_lock(hashtextextended('audit:' || $1::text, 0))`, [c.tenantId]);
      const pending = draftInvitation(consoleDb, as(onbTok), c.tenantId, { email: `audit${++n}@klinik-sintetis.test`, name: "Orang Audit", roles: ["marketing"], branchIds: [] });
      for (let i = 0; i < 200 && !(await h.admin.query(`select 1 from pg_locks where locktype = 'advisory' and not granted`)).rowCount; i++) await new Promise((r) => setTimeout(r, 25));
      await new Promise((r) => setTimeout(r, 2_500));
      await hold.query("commit");
      expect(await pending).toMatchObject({ ok: false, reason: "grant_not_active" });
    } finally {
      await hold.end();
    }
    expect((await h.admin.query(`select count(*)::int n from onboarding_invitation_drafts where tenant_id = $1`, [c.tenantId])).rows[0].n).toBe(0);
  });

  it("access then invite in one vendor transaction while the Owner renews: no deadlock (review round 4)", { timeout: 30_000 }, async () => {
    const c = await clinic();
    const vendorTx = await consoleDb.connect();
    try {
      await vendorTx.query("begin");
      // 1. The vendor transaction checks access (takes staff_access, then the grant row).
      expect((await vendorTx.query(`select vendor_console_onboarding_access($1, $2, $3, 'catalog') as r`, [onbTok, IP, c.tenantId])).rows[0].r).toMatchObject({ ok: true });
      // 2. The Owner's renewal now waits on staff_access (held by the vendor), not on the row.
      const renewal = code(asOwner(c, (db) => renewGrant(db)));
      for (let i = 0; i < 200 && !(await h.admin.query(`select 1 from pg_locks where locktype = 'advisory' and not granted`)).rowCount; i++) await new Promise((r) => setTimeout(r, 25));
      // 3. The same vendor transaction drafts an invitation: it already holds both locks.
      const d = (await vendorTx.query(`select vendor_console_onboarding_invite($1, $2, $3, $4, 'Orang Satu Transaksi', '{marketing}', '{}') as r`, [onbTok, IP, c.tenantId, `satu${++n}@klinik-sintetis.test`])).rows[0].r;
      expect(d).toMatchObject({ ok: true });
      await vendorTx.query("commit");
      expect(await renewal).toBe("ok");
    } finally {
      vendorTx.release();
    }
  });

  it("go-live while a vendor check holds staff_access: no deadlock (review round 5)", { timeout: 30_000 }, async () => {
    const c = await clinic();
    const vendorTx = await consoleDb.connect();
    try {
      // The vendor transaction is inside a check: it holds staff_access but has not yet
      // touched the tenant row (that comes with its log row's foreign key).
      await vendorTx.query("begin");
      await vendorTx.query(`select pg_advisory_xact_lock(hashtextextended('staff_access:' || $1::text, 0))`, [c.tenantId]);
      // Go-live through the console entry point: waits on staff_access before the tenant row.
      const live = advanceTenant(consoleDb, as(poTok), c.tenantId, "live", "Klinik siap melayani pasien");
      for (let i = 0; i < 200 && !(await h.admin.query(`select 1 from pg_locks where not granted`)).rowCount; i++) await new Promise((r) => setTimeout(r, 25));
      await new Promise((r) => setTimeout(r, 200));
      // The vendor transaction logs again (needs the tenant row for share via the FK) and
      // reads the grant: neither may wait on go-live.
      expect((await vendorTx.query(`select vendor_console_onboarding_access($1, $2, $3, 'catalog') as r`, [onbTok, IP, c.tenantId])).rows[0].r).toMatchObject({ ok: true });
      await vendorTx.query("commit");
      expect(await live).toMatchObject({ ok: true });
    } finally {
      await vendorTx.query("rollback").catch(() => undefined);
      vendorTx.release();
    }
    expect((await h.admin.query(`select end_reason from onboarding_grants where tenant_id = $1`, [c.tenantId])).rows[0].end_reason).toBe("go_live");
  });

  it("refusal logs never come before staff_access: two transactions mixing a refused advance and access checks do not deadlock (review round 6)", { timeout: 30_000 }, async () => {
    const c = await clinic();
    const a = await consoleDb.connect();
    const b = await consoleDb.connect();
    try {
      await a.query("begin");
      await b.query("begin");
      // A: a refused advance (invalid target) — logged.
      expect((await a.query(`select vendor_console_tenant_advance($1, $2, $3, 'closed', 'Alasan tidak valid untuk uji') as r`, [poTok, IP, c.tenantId])).rows[0].r).toMatchObject({ ok: false, code: "ERR_INVALID_INPUT" });
      // B: an access check on the same tenant — must wait on A (staff_access), not hold it.
      const bAccess = b.query(`select vendor_console_onboarding_access($1, $2, $3, 'catalog') as r`, [onbTok, IP, c.tenantId]);
      for (let i = 0; i < 200 && !(await h.admin.query(`select 1 from pg_locks where locktype = 'advisory' and not granted`)).rowCount; i++) await new Promise((r) => setTimeout(r, 25));
      // A: an access check of its own; it already holds staff_access.
      expect((await a.query(`select vendor_console_onboarding_access($1, $2, $3, 'catalog') as r`, [onbTok, IP, c.tenantId])).rows[0].r).toMatchObject({ ok: true });
      await a.query("commit");
      expect((await bAccess).rows[0].r).toMatchObject({ ok: true });
      await b.query("commit");
    } finally {
      await a.query("rollback").catch(() => undefined);
      await b.query("rollback").catch(() => undefined);
      a.release();
      b.release();
    }
  });

  it("an access check that waited on a held grant row past expiry is refused, even when the holder rolls back", { timeout: 30_000 }, async () => {
    const c = await clinic();
    await h.admin.query(`alter table onboarding_grants disable trigger onboarding_grants_guard`);
    await h.admin.query(`update onboarding_grants set expires_at = clock_timestamp() + interval '2 seconds' where tenant_id = $1`, [c.tenantId]);
    await h.admin.query(`alter table onboarding_grants enable trigger onboarding_grants_guard`);
    const holder = new pg.Client({ connectionString: h.ownerUrl() });
    await holder.connect();
    try {
      await holder.query("begin");
      await holder.query(`select 1 from onboarding_grants where tenant_id = $1 for update`, [c.tenantId]);
      const access = onboardingAccess(consoleDb, as(onbTok), c.tenantId, "catalog");
      for (let i = 0; i < 200 && !(await h.admin.query(`select 1 from pg_locks where not granted and locktype in ('tuple','transactionid')`)).rowCount; i++) await new Promise((r) => setTimeout(r, 25));
      await new Promise((r) => setTimeout(r, 2_500));
      await holder.query("rollback");
      expect(await access).toMatchObject({ ok: false, reason: "grant_not_active" });
    } finally {
      await holder.end();
    }
  });

  it("a caller without a valid session writes nothing into the tenant's audit chain or the vendor log (no flooding)", { timeout: 30_000 }, async () => {
    const c = await clinic();
    // ... and takes no clinic lock: a staff_access holder does not block it.
    const holder = new pg.Client({ connectionString: h.ownerUrl() });
    await holder.connect();
    try {
      await holder.query("begin");
      await holder.query(`select pg_advisory_xact_lock(hashtextextended('staff_access:' || $1::text, 0))`, [c.tenantId]);
      const t0 = Date.now();
      expect(await onboardingAccess(consoleDb, as("y".repeat(40)), c.tenantId, "catalog")).toMatchObject({ ok: false, reason: "no_session" });
      expect(await advanceTenant(consoleDb, as("y".repeat(40)), c.tenantId, "live", "Klinik siap melayani pasien")).toMatchObject({ ok: false, reason: "no_session" });
      expect(Date.now() - t0).toBeLessThan(2_000);
    } finally {
      await holder.query("rollback").catch(() => undefined);
      await holder.end();
    }
    const count = async () => [
      (await h.admin.query(`select count(*)::int n from vendor_actions`)).rows[0].n,
      (await h.admin.query(`select count(*)::int n from audit_events where tenant_id = $1`, [c.tenantId])).rows[0].n,
    ];
    const before = await count();
    expect(await onboardingAccess(consoleDb, as("x".repeat(40)), c.tenantId, "patient_record")).toMatchObject({ ok: false, reason: "no_session" });
    expect(await draftInvitation(consoleDb, as("x".repeat(40)), c.tenantId, { email: "a@klinik-sintetis.test", name: "Orang", roles: ["marketing"], branchIds: [] })).toMatchObject({ ok: false, reason: "no_session" });
    expect(await count()).toEqual(before);
  });
});

describe("scenario PR-58 onboarding grant boundary", () => {
  it("with an active grant, opening a patient's medical record (or any clinical kind) is denied and audited; configuration kinds are allowed", async () => {
    const c = await clinic();
    for (const kind of ["patient_record", "clinical_note", "photo", "consent", "prescription", "whatsapp_message", "balance", "x"]) {
      expect(await onboardingAccess(consoleDb, as(onbTok), c.tenantId, kind), kind).toMatchObject({ ok: false, reason: "not_in_grant" });
    }
    const denied = (await h.admin.query(`select reason_code from audit_events where tenant_id = $1 and outcome = 'denied' and action = 'approval' order by seq`, [c.tenantId])).rows.map((r) => r.reason_code);
    expect(denied).toContain("not_in_grant_patient_record");
    expect((await h.admin.query(`select count(*)::int n from vendor_actions where tenant_id = $1 and reason_code = 'not_in_grant_patient_record'`, [c.tenantId])).rows[0].n).toBe(1);
    // Long kinds (claude review): a 28-character kind is recorded with its name, a 29-character
    // one as plain not_in_grant — both in the vendor log and the tenant audit chain.
    const k28 = "patient_record_attachment_xy";
    const k29 = "patient_record_attachment_xyz";
    expect(k28).toHaveLength(28);
    for (const kind of [k28, k29]) {
      expect(await onboardingAccess(consoleDb, as(onbTok), c.tenantId, kind), kind).toMatchObject({ ok: false, reason: "not_in_grant" });
    }
    const lastTwo = (await h.admin.query(`select reason_code from vendor_actions where tenant_id = $1 order by seq desc limit 2`, [c.tenantId])).rows.map((r) => r.reason_code);
    expect(lastTwo).toEqual(["not_in_grant", `not_in_grant_${k28}`]);
    const lastAudit = (await h.admin.query(`select reason_code from audit_events where tenant_id = $1 order by seq desc limit 2`, [c.tenantId])).rows.map((r) => r.reason_code);
    expect(lastAudit).toEqual(["not_in_grant", `not_in_grant_${k28}`]);
    for (const kind of ["branches", "catalog", "staff_invitations", "imports", "branding", "templates"]) {
      expect(await onboardingAccess(consoleDb, as(onbTok), c.tenantId, kind), kind).toMatchObject({ ok: true });
    }
  });

  it("only onboarding staff or a platform owner, from the allowlist; another tenant's grant does not open this one", async () => {
    const c = await clinic();
    const other = await clinic(false);
    expect(await onboardingAccess(consoleDb, as(finTok), c.tenantId, "catalog")).toMatchObject({ ok: false, reason: "role_not_held" });
    expect(await onboardingAccess(consoleDb, as(onbTok, "198.51.100.7"), c.tenantId, "catalog")).toMatchObject({ ok: false, reason: "ip_not_allowed" });
    expect(await onboardingAccess(consoleDb, as("x".repeat(40)), c.tenantId, "catalog")).toMatchObject({ ok: false, reason: "no_session" });
    expect(await onboardingAccess(consoleDb, as(onbTok), other.tenantId, "catalog")).toMatchObject({ ok: false, reason: "grant_not_active" });
    expect(await onboardingAccess(consoleDb, as(onbTok), crypto.randomUUID(), "catalog")).toMatchObject({ ok: false, code: "ERR_NOT_FOUND" });
    expect(await onboardingAccess(consoleDb, as(poTok), c.tenantId, "catalog")).toMatchObject({ ok: true });
  });
});

describe("draft invitations (TEN-13)", () => {
  it("scenario PR-58 self-invite: an onboarding specialist inviting their own account as Owner is refused and audited", async () => {
    const c = await clinic();
    const own = (await h.admin.query(`select email from auth_user where id = $1`, [ONB])).rows[0].email;
    expect(await draftInvitation(consoleDb, as(onbTok), c.tenantId, { email: own, name: "Sari Onboarding", roles: ["owner"], branchIds: [] })).toMatchObject({ ok: false, reason: "role_not_assignable" });
    expect(await lastAction()).toMatchObject({ action: "onboarding_invite", outcome: "denied", reason_code: "role_not_assignable", tenant_id: c.tenantId });
    // Even with a Level 3 role, a vendor account's email is refused (TEN-13).
    expect(await draftInvitation(consoleDb, as(onbTok), c.tenantId, { email: own.toUpperCase(), name: "Sari Onboarding", roles: ["marketing"], branchIds: [] })).toMatchObject({ ok: false, reason: "vendor_account" });
    expect((await h.admin.query(`select reason_code from audit_events where tenant_id = $1 and outcome = 'denied' order by seq desc limit 2`, [c.tenantId])).rows.map((r) => r.reason_code).sort()).toEqual(["role_not_assignable", "vendor_account"]);
    for (const role of ["owner", "admin_pusat", "finance", "facility_head", "records_officer", "auditor"]) {
      expect(await draftInvitation(consoleDb, as(onbTok), c.tenantId, { email: `l2${++n}@klinik-sintetis.test`, name: "Orang Level Dua", roles: ["marketing", role], branchIds: [c.branchId] }), role).toMatchObject({ ok: false, reason: "role_not_assignable" });
    }
    expect((await h.admin.query(`select count(*)::int n from onboarding_invitation_drafts where tenant_id = $1`, [c.tenantId])).rows[0].n).toBe(0);
  });

  it("a draft has no token; the Owner confirms it into a normal invitation the invitee accepts; Admin Pusat cannot confirm", async () => {
    const c = await clinic();
    const e = `dokter${++n}@klinik-sintetis.test`;
    const d = await draftInvitation(consoleDb, as(onbTok), c.tenantId, { email: e, name: "Dokter Baru", roles: ["doctor"], branchIds: [c.branchId] });
    expect(d.ok).toBe(true);
    const draftId = (d as { data: { id: string } }).data.id;
    expect(await draftInvitation(consoleDb, as(onbTok), c.tenantId, { email: e, name: "Dokter Baru", roles: ["doctor"], branchIds: [c.branchId] })).toMatchObject({ ok: false, reason: "draft_open" });
    // Not a staff invitation yet: nothing to accept.
    expect((await h.admin.query(`select count(*)::int n from staff_invitations where tenant_id = $1 and email = $2`, [c.tenantId, e])).rows[0].n).toBe(0);
    expect(await asOwner(c, (db) => grantStatus(db))).toMatchObject({ drafts: [{ id: draftId, email: e, roles: ["doctor"], drafted_by: "Sari Onboarding" }] });
    expect(await code(asAdmin(c, (db) => confirmDraft(db, draftId)))).toBe("ERR_FORBIDDEN");
    const { invitationId, token } = await asOwner(c, (db) => confirmDraft(db, draftId));
    expect((await h.admin.query(`select invited_by, roles, state from staff_invitations where id = $1`, [invitationId])).rows[0]).toEqual({ invited_by: c.ownerStaff, roles: ["doctor"], state: "pending" });
    expect((await h.admin.query(`select state, invitation_id from onboarding_invitation_drafts where id = $1`, [draftId])).rows[0]).toEqual({ state: "confirmed", invitation_id: invitationId });
    expect(await code(asOwner(c, (db) => confirmDraft(db, draftId)))).toBe("ERR_NOT_FOUND");
    expect(await lookupInvite(app, token)).toMatchObject({ email: e, roles: ["doctor"] });
    expect(await acceptWithNewAccount(app, auth, token, PASSWORD)).toMatchObject({ tenantId: c.tenantId });
    expect((await h.admin.query(`select reason_code from audit_events where tenant_id = $1 and reason_code = 'onboarding_draft_confirmed'`, [c.tenantId])).rows).toHaveLength(1);
  });

  it("declined by the Owner; another tenant's Owner can neither see nor decide it; a draft whose email became a vendor account is not confirmed", async () => {
    const c = await clinic();
    const other = await clinic();
    const d1 = ((await draftInvitation(consoleDb, as(onbTok), c.tenantId, { email: `cs${++n}@klinik-sintetis.test`, name: "CS Pusat", roles: ["central_cs"], branchIds: [] })) as { data: { id: string } }).data.id;
    expect(await asOwner(other, (db) => grantStatus(db))).toMatchObject({ drafts: [] });
    expect(await code(asOwner(other, (db) => confirmDraft(db, d1)))).toBe("ERR_NOT_FOUND");
    expect(await code(asOwner(other, (db) => declineDraft(db, d1)))).toBe("ERR_NOT_FOUND");
    await asOwner(c, (db) => declineDraft(db, d1));
    expect((await h.admin.query(`select state from onboarding_invitation_drafts where id = $1`, [d1])).rows[0].state).toBe("declined");
    expect(await code(asOwner(c, (db) => declineDraft(db, d1)))).toBe("ERR_NOT_FOUND");
    // The email turns into a vendor staff account after drafting: confirming is refused.
    const e2 = `nanti${++n}@vendor-sintetis.test`;
    const d2 = ((await draftInvitation(consoleDb, as(onbTok), c.tenantId, { email: e2, name: "Calon Vendor", roles: ["marketing"], branchIds: [] })) as { data: { id: string } }).data.id;
    const acc = await account(true, e2);
    const op = await owner.connect();
    try {
      await createVendorStaff(op, caller(PO), acc, "Calon Vendor", ["support"]);
    } finally {
      op.release();
    }
    expect(await code(asOwner(c, (db) => confirmDraft(db, d2)))).toBe("ERR_FORBIDDEN");
  });

  it("an email that becomes a vendor account after the Owner confirmed cannot accept the invitation (TEN-13)", async () => {
    const c = await clinic();
    const e = `kemudian${++n}@vendor-sintetis.test`;
    const d = ((await draftInvitation(consoleDb, as(onbTok), c.tenantId, { email: e, name: "Calon Vendor Dua", roles: ["marketing"], branchIds: [] })) as { data: { id: string } }).data.id;
    const { token } = await asOwner(c, (db) => confirmDraft(db, d));
    const acc = await account(true, e);
    const op = await owner.connect();
    try {
      await createVendorStaff(op, caller(PO), acc, "Calon Vendor Dua", ["support"]);
    } finally {
      op.release();
    }
    const hash = (await h.admin.query(`select token_hash from staff_invitations where email = $1`, [e])).rows[0].token_hash;
    // memberships_vendor_guard (IAM-10) refuses it — the message pins the cause.
    await expect(app.query(`select * from staff_invite_accept($1, $2)`, [hash, acc])).rejects.toMatchObject({ code: "42501", message: expect.stringMatching(/membership not allowed for this account/) });
    expect((await h.admin.query(`select count(*)::int n from memberships where tenant_id = $1 and account_id = $2`, [c.tenantId, acc])).rows[0].n).toBe(0);
    expect(token).toBeTruthy();
  });

  it("drafting needs an active grant covering invitations, the step-up, valid input and this tenant's branches", async () => {
    const c = await clinic();
    const other = await clinic();
    const ok = { email: `x${++n}@klinik-sintetis.test`, name: "Orang Baru", roles: ["nurse"], branchIds: [c.branchId] };
    expect(await draftInvitation(consoleDb, as(await session(ONB, "30 minutes")), c.tenantId, ok)).toMatchObject({ ok: false, reason: "totp_not_verified" });
    expect(await draftInvitation(consoleDb, as(finTok), c.tenantId, ok)).toMatchObject({ ok: false, reason: "role_not_held" });
    expect(await draftInvitation(consoleDb, as(onbTok), c.tenantId, { ...ok, branchIds: [other.branchId] })).toMatchObject({ ok: false, code: "ERR_INVALID_INPUT" });
    expect(await draftInvitation(consoleDb, as(onbTok), c.tenantId, { ...ok, branchIds: [] })).toMatchObject({ ok: false, code: "ERR_INVALID_INPUT" });
    expect(await draftInvitation(consoleDb, as(onbTok), c.tenantId, { ...ok, email: "bukan email" })).toMatchObject({ ok: false, code: "ERR_INVALID_INPUT" });
    const ownerEmail = (await h.admin.query(`select email from auth_user where id = $1`, [c.ownerAcc])).rows[0].email;
    expect(await draftInvitation(consoleDb, as(onbTok), c.tenantId, { ...ok, email: ownerEmail })).toMatchObject({ ok: false, reason: "already_member" });
    await ageGrant(c.tenantId, 31);
    expect(await draftInvitation(consoleDb, as(onbTok), c.tenantId, ok)).toMatchObject({ ok: false, reason: "grant_not_active" });
  });
});

describe("history and privileges", () => {
  it("grants only end or renew once; drafts are decided once; no application role reads either table", async () => {
    const c = await clinic();
    const d = ((await draftInvitation(consoleDb, as(onbTok), c.tenantId, { email: `h${++n}@klinik-sintetis.test`, name: "Orang Riwayat", roles: ["marketing"], branchIds: [] })) as { data: { id: string } }).data.id;
    for (const q of [`update onboarding_grants set expires_at = expires_at + interval '90 days' where tenant_id = '${c.tenantId}'`,
      `delete from onboarding_grants where tenant_id = '${c.tenantId}'`,
      `update onboarding_invitation_drafts set roles = '{owner}' where id = '${d}'`,
      `delete from onboarding_invitation_drafts where id = '${d}'`]) {
      await expect(h.admin.query(q), q).rejects.toMatchObject({ code: expect.stringMatching(/42501|23514/) });
    }
    // Constraint-valid rewrites are refused by the history guard itself (42501).
    for (const q of [`update onboarding_invitation_drafts set display_name = 'Nama Lain' where id = '${d}'`,
      `update onboarding_invitation_drafts set roles = '{doctor}' where id = '${d}'`]) {
      await expect(h.admin.query(q), q).rejects.toMatchObject({ code: "42501" });
    }
    await asOwner(c, (db) => declineDraft(db, d));
    await expect(h.admin.query(`update onboarding_invitation_drafts set state = 'declined', decided_at = now() where id = $1`, [d])).rejects.toMatchObject({ code: "42501" });
    await expect(h.admin.query(`update onboarding_invitation_drafts set state = 'confirmed' where id = $1`, [d])).rejects.toMatchObject({ code: expect.stringMatching(/42501|23514/) });
    for (const t of ["onboarding_grants", "onboarding_invitation_drafts"]) {
      await expect(app.query(`select 1 from ${t} limit 1`)).rejects.toMatchObject({ code: "42501" });
      await expect(consoleDb.query(`select 1 from ${t} limit 1`)).rejects.toMatchObject({ code: "42501" });
    }
    await expect(app.query(`select vendor_console_onboarding_access('a','b',null,'catalog')`)).rejects.toMatchObject({ code: "42501" });
    await expect(consoleDb.query(`select onboarding_draft_confirm($1, $2)`, [d, "0".repeat(64)])).rejects.toMatchObject({ code: "42501" });
  });
});
