// T-022 Done-when: scenario PR-56 manual suspension keeps records; suspended tenants keep
// care-message eligibility. Plus the TEN-12 edges (processor agreement before onboarding),
// maker-checker for every vendor-initiated edge, append-only history, owner notice,
// isolation of the lifecycle tables and serialised transitions.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { decideEvidence, uploadEvidence } from "../../src/modules/compliance/compliance";
import { list as listNotifications } from "../../src/modules/notifications/notifications";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { applyLifecycleRequest, assertTenantCapability, CAPABILITIES, type Capability, tenantLifecycleStatus } from "../../src/modules/vendor/lifecycle/lifecycle";
import { bootstrapVendor, createVendorStaff, decideVendorRequest, requestVendorAction, type VendorCaller, VendorStaffError } from "../../src/modules/vendor/staff/staff";
import { createHarness, type Harness } from "../rls/harness";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let exec: pg.Pool;
let opPool: pg.Pool;
let op: pg.PoolClient;
let n = 0;
const IP = "203.0.113.10";
const SVC = "lifecycle.worker";
const caller = (accountId: string): VendorCaller => ({ accountId, ip: IP, mfaAt: new Date() });
const code = (x: Promise<unknown>) =>
  x.then(() => "ok", (e) => (e instanceof VendorStaffError ? (e.reason ? `${e.code}:${e.reason}` : e.code) : e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));

async function account(): Promise<string> {
  return (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('V', $1, true) returning id`, [`lc${++n}@vendor-sintetis.test`])).rows[0].id as string;
}
type Clinic = { tenantId: string; branchId: string; ownerAcc: string; ownerStaff: string; fhAcc: string };
async function clinic(state: string): Promise<Clinic> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ($1) returning id`, [state])).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Klinik Sintetis', 'emkm')`, [tenantId]);
  const branchId = (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'B1', 'Cabang 1', 'Asia/Jakarta') returning id`, [tenantId])).rows[0].id as string;
  const member = async (role: "owner" | "facility_head") => {
    const acc = (await h.admin.query(`insert into auth_user (name, email) values ('C', $1) returning id`, [`klinik${++n}@klinik-sintetis.test`])).rows[0].id as string;
    const { staffId } = await createMembership(owner, { tenantId, accountId: acc, displayName: `Staf ${n}` });
    const rid = await assignRole(h.admin, { tenantId, staffId, role });
    if (role === "facility_head") await assignBranch(h.admin, { tenantId, staffRoleId: rid, branchId });
    return { acc, staffId };
  };
  const o = await member("owner");
  const fh = await member("facility_head");
  return { tenantId, branchId, ownerAcc: o.acc, ownerStaff: o.staffId, fhAcc: fh.acc };
}
const asOwner = async <R>(c: Clinic, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, c.ownerAcc, { tenantId: c.tenantId, actingRole: "owner" }), fn);
const asFh = async <R>(c: Clinic, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, c.fhAcc, { tenantId: c.tenantId, actingRole: "facility_head", activeBranchId: c.branchId }), fn);
const state = async (tenantId: string) => (await h.admin.query(`select lifecycle_state from tenants_registry where id = $1`, [tenantId])).rows[0].lifecycle_state as string;
const allowed = async (c: Clinic, cap: Capability) => code(asOwner(c, (db) => assertTenantCapability(db, cap)));

let PO: string; // platform owner
let PO2: string; // second platform owner
let FIN: string; // vendor finance
let ONB: string; // onboarding
let ONBId: string;
let POId: string;
let consoleDb: pg.Pool;
let ONBTok: string;
let POTok: string;
let FINTok: string;
// A vendor-surface session for an account (as the vendor console's sign-in creates it).
async function session(acc: string): Promise<string> {
  const tok = `tok${++n}${"x".repeat(30)}`;
  await h.admin.query(`insert into auth_session (user_id, token, expires_at, surface, second_factor_at) values ($1, $2, now() + interval '8 hours', 'vendor', now())`, [acc, tok]);
  return tok;
}

// A maker-checker request approved by a platform owner and applied by the worker.
async function approved(kind: "suspension" | "exit" | "reactivation" | "closure", tenantId: string, maker = FIN, checker = PO, reason = `Permintaan ${kind} untuk uji siklus`): Promise<string> {
  const id = await requestVendorAction(op, caller(maker), tenantId, { kind }, reason);
  expect(await decideVendorRequest(op, caller(checker), id, true)).toBe("approved");
  return id;
}

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 4 });
  owner = new pg.Pool({ connectionString: h.ownerUrl(), max: 2 });
  exec = new pg.Pool({ connectionString: h.urlAs(await h.createLoginRole("", ["clinic_executor"])), max: 3 });
  opPool = new pg.Pool({ connectionString: h.ownerUrl(), max: 1 });
  op = await opPool.connect();
  PO = await account();
  await bootstrapVendor(op, PO, "Pemilik Platform", "203.0.113.0/24", "Kantor vendor");
  PO2 = await account();
  FIN = await account();
  ONB = await account();
  await createVendorStaff(op, caller(PO), PO2, "Pemilik Platform Kedua", ["platform_owner"]);
  await createVendorStaff(op, caller(PO), FIN, "Keuangan Vendor", ["vendor_finance"]);
  ONBId = await createVendorStaff(op, caller(PO), ONB, "Onboarding Vendor", ["onboarding"]);
  POId = (await h.admin.query(`select id from vendor_staff where account_id = $1`, [PO])).rows[0].id;
  consoleDb = new pg.Pool({ connectionString: h.urlAs(await h.createLoginRole("", ["clinic_vendor"])), max: 2 });
  ONBTok = await session(ONB);
  POTok = await session(PO);
  FINTok = await session(FIN);
});

afterAll(async () => {
  op?.release();
  await opPool?.end();
  await exec?.end();
  await consoleDb?.end();
  await owner?.end();
  await app?.end();
  await h?.close();
});

describe("scenario PR-56 manual suspension keeps records", () => {
  it("a live tenant with an unpaid server fee is suspended with a reason: new bookings refused, owner notified, clinical read/export continue", async () => {
    const c = await clinic("live");
    // Unpaid server fee: billing (T-103) does not exist yet; the request reason carries it.
    const req = await approved("suspension", c.tenantId, FIN, PO, "Tagihan server dua bulan belum dibayar");
    expect(await applyLifecycleRequest(exec, req, "suspension", c.tenantId, SVC)).toBe("suspended");
    expect(await state(c.tenantId)).toBe("suspended");
    expect(await allowed(c, "new_booking")).toBe("ERR_TENANT_SUSPENDED");
    expect(await allowed(c, "public_site")).toBe("ERR_TENANT_SUSPENDED");
    expect(await allowed(c, "marketing_message")).toBe("ERR_TENANT_SUSPENDED");
    for (const cap of ["clinical_read", "clinical_export", "existing_appointment", "cashier", "care_message", "satusehat_outbox", "record_correction", "patient_copy", "data_request", "purpose_read"] as Capability[]) {
      expect(await allowed(c, cap), cap).toBe("ok");
    }
    // Staff other than the owner read the same capabilities (clinical read for the facility head).
    expect(await code(asFh(c, (db) => assertTenantCapability(db, "clinical_read")))).toBe("ok");
    expect(await code(asFh(c, (db) => assertTenantCapability(db, "new_booking")))).toBe("ERR_TENANT_SUSPENDED");
    // The owner is notified, with the reason in the lifecycle status.
    const notes = await asOwner(c, (db) => listNotifications(db));
    expect(notes.filter((x) => x.type === "tenant_lifecycle").map((x) => x.subjectId)).toEqual([c.tenantId]);
    expect(await asOwner(c, (db) => tenantLifecycleStatus(db))).toMatchObject({ state: "suspended", reason: "Tagihan server dua bulan belum dibayar" });
    expect(await asFh(c, (db) => tenantLifecycleStatus(db))).toMatchObject({ state: "suspended", reason: null });
    // History, with the consumed request and the service actor.
    const hist = (await h.admin.query(`select from_state, to_state, actor_kind, actor, vendor_request_id from tenant_lifecycle_events where tenant_id = $1`, [c.tenantId])).rows;
    expect(hist).toEqual([{ from_state: "live", to_state: "suspended", actor_kind: "service", actor: expect.stringMatching(/^lifecycle\.worker\./), vendor_request_id: req }]);
    // The platform event carries ids and states only.
    const ev = (await h.admin.query(`select payload, staff_id from domain_events where tenant_id = $1 and type = 'TenantLifecycleChanged'`, [c.tenantId])).rows;
    expect(ev).toEqual([{ payload: { from_state: "live", to_state: "suspended" }, staff_id: null }]);
  });

  it("suspended tenants keep care-message eligibility; reactivation by a second platform owner restores bookings", async () => {
    const c = await clinic("live");
    await applyLifecycleRequest(exec, await approved("suspension", c.tenantId), "suspension", c.tenantId, SVC);
    expect(await allowed(c, "care_message")).toBe("ok");
    expect(await allowed(c, "marketing_message")).toBe("ERR_TENANT_SUSPENDED");
    // Reactivation: requested by a platform owner, approved by another; never by finance.
    expect(await code(requestVendorAction(op, caller(FIN), c.tenantId, { kind: "reactivation" }, "Aktifkan kembali setelah lunas"))).toBe("ERR_FORBIDDEN:role_not_held");
    const r = await requestVendorAction(op, caller(PO), c.tenantId, { kind: "reactivation" }, "Tagihan sudah lunas, aktifkan kembali");
    expect(await code(decideVendorRequest(op, caller(PO), r, true))).toBe("ERR_APPROVER_IS_REQUESTER");
    expect(await decideVendorRequest(op, caller(PO2), r, true)).toBe("approved");
    expect(await applyLifecycleRequest(exec, r, "reactivation", c.tenantId, SVC)).toBe("live");
    expect(await allowed(c, "new_booking")).toBe("ok");
    const notes = (await asOwner(c, (db) => listNotifications(db))).filter((x) => x.type === "tenant_lifecycle");
    expect(notes).toHaveLength(2);
  });
});

describe("TEN-12 edges and maker-checker", () => {
  it("provisioning → onboarding needs the approved processor agreement and a vendor staff action", async () => {
    const c = await clinic("provisioning");
    const step = (token: string, to = "onboarding", ip = IP) =>
      consoleDb.query(`select vendor_console_tenant_advance($1, $2, $3, $4, 'Mulai onboarding klinik baru') as r`, [token, ip, c.tenantId, to]).then((r) => r.rows[0].r, (e) => ({ raw: e.code }));
    // Processor agreement not approved: refused and logged (T-023 review round 2).
    expect(await step(ONBTok)).toMatchObject({ ok: false, reason: "processor_agreement" });
    expect((await h.admin.query(`select action, outcome, reason_code from vendor_actions order by seq desc limit 1`)).rows[0]).toEqual({ action: "tenant_onboarding", outcome: "denied", reason_code: "processor_agreement" });
    expect(await step(ONBTok, "closed")).toMatchObject({ ok: false, code: "ERR_INVALID_INPUT" });
    expect((await h.admin.query(`select action, outcome, reason_code from vendor_actions order by seq desc limit 1`)).rows[0]).toEqual({ action: "tenant_advance", outcome: "denied", reason_code: "invalid_input" });
    const pdf = Buffer.from("%PDF-1.7\nPerjanjian pengolahan data sintetis\n%%EOF\n");
    const file = await asOwner(c, (db) => uploadEvidence(db, { obligationKey: "processor_agreement_signed", fileName: "dpa.pdf", content: pdf, expertName: "Konsultan Hukum Sintetis", documentDate: "2026-10-01" }));
    const item = (await h.admin.query(`select item_id from evidence_files where id = $1`, [file.fileId])).rows[0].item_id;
    // The owner is the sole privacy decider here (DEC-031 D3): approves their own upload.
    await asOwner(c, (db) => decideEvidence(db, item, file.fileId, "approved"));
    expect(await step(FINTok)).toMatchObject({ ok: false, reason: "role_not_held" }); // vendor finance is not onboarding
    expect(await step("x".repeat(40))).toMatchObject({ ok: false, reason: "no_session" });
    expect(await step(ONBTok, "onboarding", "198.51.100.7")).toMatchObject({ ok: false, reason: "ip_not_allowed" });
    expect(await step(ONBTok)).toEqual({ ok: true, state: "onboarding" });
    expect((await h.admin.query(`select actor_kind, actor from tenant_lifecycle_events where tenant_id = $1`, [c.tenantId])).rows).toEqual([{ actor_kind: "vendor_staff", actor: ONBId }]);
    expect(await state(c.tenantId)).toBe("onboarding");
    expect(await allowed(c, "configuration")).toBe("ok");
    expect(await allowed(c, "new_booking")).toBe("ERR_TENANT_SUSPENDED");
    // onboarding → live: platform owner only; the TOTP step-up (10 minutes) applies.
    expect(await step(ONBTok, "live")).toMatchObject({ ok: false, reason: "role_not_held" });
    await h.admin.query(`update auth_session set second_factor_at = now() - interval '30 minutes' where token = $1`, [POTok]);
    expect(await step(POTok, "live")).toMatchObject({ ok: false, reason: "totp_not_verified" });
    await h.admin.query(`update auth_session set second_factor_at = now() where token = $1`, [POTok]);
    expect(await step(POTok, "live")).toEqual({ ok: true, state: "live" });
    // The executor knowing a platform owner's id cannot move the tenant (review round 1 #1).
    await expect(exec.query(`select tenant_lifecycle_transition($1, 'live', 'Go-live tanpa sesi', null, 'vendor_staff', $2)`, [c.tenantId, POId])).rejects.toMatchObject({ code: "42501" });
    expect(await state(c.tenantId)).toBe("live");
  });

  it("every other edge is refused; vendor edges need their own approved request, consumed now, for this tenant, once", async () => {
    const c = await clinic("live");
    const other = await clinic("live");
    // Nobody calls the internal transition directly (not even the executor).
    await expect(exec.query(`select tenant_lifecycle_transition($1, 'suspended', 'Alasan transisi untuk uji', null, 'service', 'x.y')`, [c.tenantId])).rejects.toMatchObject({ code: "42501" });
    // Consumed in an earlier, committed transaction, then applied: refused (review round 1 #2).
    const early = await approved("suspension", c.tenantId);
    await exec.query(`select vendor_request_consume($1, 'suspension', $2, 'lifecycle.worker')`, [early, c.tenantId]).catch(() => undefined);
    expect(await code(applyLifecycleRequest(exec, early, "suspension", c.tenantId, SVC))).toBe("ERR_VERSION_CONFLICT:already_consumed");
    expect(await state(c.tenantId)).toBe("live");
    const req = await approved("suspension", c.tenantId);
    // Another tenant's request, or the wrong kind, cannot be applied.
    const foreign = await approved("suspension", other.tenantId);
    expect(await code(applyLifecycleRequest(exec, foreign, "suspension", c.tenantId, SVC))).toBe("ERR_VERSION_CONFLICT:not_found");
    const exitReq = await approved("exit", c.tenantId);
    expect(await code(applyLifecycleRequest(exec, exitReq, "suspension", c.tenantId, SVC))).toBe("ERR_VERSION_CONFLICT:not_found");
    // Applied once; a second application is refused (already consumed) and the state stays.
    expect(await applyLifecycleRequest(exec, req, "suspension", c.tenantId, SVC)).toBe("suspended");
    expect(await code(applyLifecycleRequest(exec, req, "suspension", c.tenantId, SVC))).toBe("ERR_VERSION_CONFLICT:already_consumed");
    // The approved reason is the one recorded (review round 1 #3): the worker passes none.
    const exitReq2 = exitReq;
    // suspended → exit, then exit → closed (two platform owners).
    expect(await applyLifecycleRequest(exec, exitReq2, "exit", c.tenantId, SVC)).toBe("exit");
    expect(await allowed(c, "clinical_export")).toBe("ok");
    expect(await allowed(c, "cashier")).toBe("ERR_TENANT_SUSPENDED");
    const close = await approved("closure", c.tenantId, PO, PO2);
    expect(await applyLifecycleRequest(exec, close, "closure", c.tenantId, SVC)).toBe("closed");
    for (const cap of CAPABILITIES) expect(await allowed(c, cap), cap).toBe("ERR_TENANT_SUSPENDED");
    expect((await h.admin.query(`select to_state, reason from tenant_lifecycle_events where tenant_id = $1 order by seq`, [c.tenantId])).rows).toEqual([
      { to_state: "suspended", reason: "Permintaan suspension untuk uji siklus" },
      { to_state: "exit", reason: "Permintaan exit untuk uji siklus" },
      { to_state: "closed", reason: "Permintaan closure untuk uji siklus" },
    ]);
    // A wrong edge for the state is refused and rolls the consumption back (request stays usable).
    const d = await clinic("live");
    const re = await approved("reactivation", d.tenantId, PO, PO2);
    expect(await code(applyLifecycleRequest(exec, re, "reactivation", d.tenantId, SVC))).toBe("raw:55000");
    expect((await h.admin.query(`select consumed_at from vendor_requests where id = $1`, [re])).rows[0].consumed_at).toBeNull();
  });

  it.each([1, 2, 3, 4, 5])("two applications at once (round %i): serialised, never a deadlock", async () => {
    const c = await clinic("live");
    const a = await approved("suspension", c.tenantId);
    const b = await approved("exit", c.tenantId);
    const r = await Promise.all([
      code(applyLifecycleRequest(exec, a, "suspension", c.tenantId, SVC)),
      code(applyLifecycleRequest(exec, b, "exit", c.tenantId, SVC)),
    ]);
    // The worker that gets the tenant row second waits, then applies from the new state:
    // live → suspended → exit or live → exit then a refused suspension. Never a deadlock,
    // never two transitions from the same state.
    const hist = (await h.admin.query(`select from_state, to_state from tenant_lifecycle_events where tenant_id = $1 order by seq`, [c.tenantId])).rows;
    expect(r.every((x) => x === "ok" || x === "raw:55000"), JSON.stringify(r)).toBe(true);
    expect(new Set(hist.map((x) => x.from_state)).size).toBe(hist.length);
    expect(r.filter((x) => x === "ok").length).toBe(hist.length);
    expect(hist.length).toBeGreaterThanOrEqual(1);
  });
});

describe("history and isolation", () => {
  it("history is append-only; the clinic app reads no lifecycle table and calls no transition", async () => {
    const c = await clinic("live");
    await applyLifecycleRequest(exec, await approved("suspension", c.tenantId), "suspension", c.tenantId, SVC);
    for (const q of [`update tenant_lifecycle_events set reason = 'diubah sekali' where tenant_id = '${c.tenantId}'`, `delete from tenant_lifecycle_events where tenant_id = '${c.tenantId}'`, `truncate tenant_lifecycle_events`]) {
      await expect(h.admin.query(q), q).rejects.toMatchObject({ code: "42501" });
    }
    await asOwner(c, async (db) => {
      await expect(db.query(`select 1 from tenant_lifecycle_events limit 1`)).rejects.toMatchObject({ code: "42501" });
    });
    await asOwner(c, async (db) => {
      await expect(db.query(`select tenant_lifecycle_transition($1, 'live', 'Coba dari aplikasi klinik', null, 'service', 'x.y')`, [c.tenantId])).rejects.toMatchObject({ code: "42501" });
    });
    // The executor role reads no table either.
    await expect(exec.query(`select 1 from tenant_lifecycle_events limit 1`)).rejects.toMatchObject({ code: "42501" });
    await expect(exec.query(`select 1 from tenants_registry limit 1`)).rejects.toMatchObject({ code: "42501" });
  });

  it("capabilities and status follow the bound tenant only (another tenant's state never leaks)", async () => {
    const a = await clinic("live");
    const b = await clinic("live");
    await applyLifecycleRequest(exec, await approved("suspension", b.tenantId), "suspension", b.tenantId, SVC);
    expect(await allowed(a, "new_booking")).toBe("ok");
    expect(await allowed(b, "new_booking")).toBe("ERR_TENANT_SUSPENDED");
    expect(await asOwner(a, (db) => tenantLifecycleStatus(db))).toMatchObject({ state: "live", reason: null });
    // An unknown capability is refused; outside a tenant context nothing is allowed.
    expect(await code(asOwner(a, (db) => db.query(`select tenant_capability('apa_saja') as ok`).then((r) => { if (!r.rows[0].ok) throw new CommandError("ERR_TENANT_SUSPENDED"); })))).toBe("ERR_TENANT_SUSPENDED");
    expect((await app.query(`select tenant_capability('clinical_read') as ok`)).rows[0].ok).toBe(false);
  });
});
