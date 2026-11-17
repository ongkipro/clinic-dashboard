// T-103 increment 2 gate (Panel 2 option A; addendum a2): the vendor console's billing entrypoints and the token-fenced Bayar finish.
// Console (R1–R4, N): allowed roles; every other vendor role, a clinic login and the support operator refused; no / invalid session refused
// without a log row; a stale step-up and an IP outside the allowlist refused (logged); kinds restricted on direct calls; the tenant comes from
// the stored request / attempt; requester ≠ approver; approval never applies (the executor does); R1 returns allowlisted fields only (no ket,
// instruction or provider body; no clinic data); the note never changes an attempt, the outstanding or eligibility. Every refused write leaves
// the victim's money and request state unchanged. Finish: the old signature is gone; a bound context, the vendor login, a forged / empty /
// other-attempt token are refused with nothing written; a replayed begin gets no token and makes no provider call; a lost-token attempt
// without a provider id stays blocking after recovery. Mock port only; fetch is never called.
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { APP_GROUP_ROLE, VENDOR_GROUP_ROLE, withTenantContext } from "../../../src/db/rls/context";
import { openAppPool } from "../../../src/db/rls/pool";
import { bayar, issue, recover } from "../../../src/modules/vendor/billing/billing";
import { billingDetail, billingList, cancelBilling, decideBilling, issueBilling, noteAttempt, requestBilling } from "../../../src/modules/vendor/billing/console";
import { createVaOk } from "../../../src/modules/vendor/billing/fixtures";
import { mockAutolarisPort } from "../../../src/modules/vendor/billing/mock";
import { assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { bootstrapVendor, createVendorStaff, type VendorCaller } from "../../../src/modules/vendor/staff/staff";
import { createHarness, type Harness, testPool } from "../../rls/harness";

let h: Harness;
let app: pg.Pool;
let unbound: pg.Pool;
let exec: pg.Pool;
let vendor: pg.Pool;
let execUser: string;
let vendorUser: string;
let owner: pg.Pool;
let opPool: pg.Pool;
let op: pg.PoolClient;
let n = 0;
const IP = "203.0.113.10";
const caller = (accountId: string): VendorCaller => ({ accountId, ip: IP, mfaAt: new Date() });
const WIB = (d: string) => new Date(`${d}T09:00:00+07:00`);
const fetchSpy = vi.fn();
const PAYER = { id: "T1", name: "PT Klinik Sintetis", phone: "081200000000", email: "owner@klinik-sintetis.test" };
type Who = { acc: string; tok: string };
let PO: Who; let PO2: Who; let FIN: Who; let FIN2: Who; let AUD: Who; let SUP: Who; let ONB: Who;

async function account(tag: string) {
  return (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`${tag}${++n}@sintetis.test`])).rows[0].id as string;
}
async function session(acc: string, stepUpAgo = "0 minutes"): Promise<string> {
  const tok = `tok${++n}${"y".repeat(30)}`;
  await h.admin.query(`insert into auth_session (user_id, token, expires_at, surface, second_factor_at) values ($1, $2, now() + interval '8 hours', 'vendor', now() - $3::interval)`,
    [acc, tok, stepUpAgo]);
  return tok;
}
type Clinic = { tenantId: string; ownerAcc: string };
async function clinic(goLive: string): Promise<Clinic> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Klinik Konsol Sintetis', 'emkm')`, [tenantId]);
  await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'B1', 'Cabang 1', 'Asia/Jakarta')`, [tenantId]);
  const acc = await account("own");
  const { staffId } = await createMembership(owner, { tenantId, accountId: acc, displayName: "Pemilik Konsol" });
  await assignRole(h.admin, { tenantId, staffId, role: "owner" });
  await h.admin.query(`alter table tenant_lifecycle_events disable trigger user`);
  try {
    await h.admin.query(`insert into tenant_lifecycle_events (tenant_id, from_state, to_state, reason, actor_kind, actor, at)
      values ($1, 'onboarding', 'live', 'Fixture uji konsol tagihan', 'service', 'billing.fixture', $2)`, [tenantId, WIB(goLive)]);
  } finally {
    await h.admin.query(`alter table tenant_lifecycle_events enable trigger user`);
  }
  return { tenantId, ownerAcc: acc };
}
const c = (w: Who, ip = IP) => ({ token: w.tok, ip });
const invoiceOf = async (t: string) => (await h.admin.query(`select id from vendor_invoices where tenant_id = $1 order by period limit 1`, [t])).rows[0].id as string;
// The victim's money and request state (compared before / after refused writes).
const snapshot = async (t: string) => (await h.admin.query(`select
    (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'state', state, 'out', vendor_invoice_outstanding(id)) order by id), '[]') from vendor_invoices where tenant_id = $1) inv,
    (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'state', state, 'gen', generation, 'trx', provider_trx_id) order by id), '[]') from vendor_payment_attempts where tenant_id = $1) att,
    (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'state', state, 'decided', decided_by, 'consumed', consumed_at) order by id), '[]') from vendor_requests where tenant_id = $1) req,
    (select count(*) from vendor_credit_notes where tenant_id = $1) credits, (select count(*) from server_fee_versions where tenant_id = $1) versions`, [t])).rows[0];
const ownerCtx = async (cl: Clinic) => resolveContext(app, cl.ownerAcc, { tenantId: cl.tenantId, actingRole: "owner" });
const nextMonth = (d: number) => { const x = new Date(); x.setUTCDate(15); x.setUTCMonth(x.getUTCMonth() + d); return x.toISOString().slice(0, 7); };
const logged = async (action: string, staffAcc: string) => (await h.admin.query(`select outcome, reason_code from vendor_actions where action = $1 and account_id = $2 order by at`, [action, staffAcc])).rows;

beforeAll(async () => {
  vi.stubGlobal("fetch", fetchSpy);
  h = await createHarness();
  const appLogin = h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE]));
  app = await openAppPool({ connectionString: appLogin, max: 4 });
  unbound = await openAppPool({ connectionString: appLogin, max: 2 });
  execUser = await h.createLoginRole("", ["clinic_executor"]);
  vendorUser = await h.createLoginRole("", [VENDOR_GROUP_ROLE]);
  exec = testPool({ connectionString: h.urlAs(execUser), max: 3 });
  vendor = testPool({ connectionString: h.urlAs(vendorUser), max: 3 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  opPool = testPool({ connectionString: h.ownerUrl(), max: 1 });
  op = await opPool.connect();
  const mk = async (roles: string[] | null, name: string) => {
    const acc = await account(name);
    if (roles) await createVendorStaff(op, caller(PO.acc), acc, name, roles as never);
    return { acc, tok: await session(acc) };
  };
  const poAcc = await account("po");
  await bootstrapVendor(op, poAcc, "Pemilik Platform", "203.0.113.0/24", "Kantor vendor");
  PO = { acc: poAcc, tok: await session(poAcc) };
  PO2 = await mk(["platform_owner"], "po2");
  FIN = await mk(["vendor_finance"], "fin");
  FIN2 = await mk(["vendor_finance"], "fin2");
  AUD = await mk(["vendor_auditor"], "aud");
  SUP = await mk(["support"], "sup");
  ONB = await mk(["onboarding"], "onb");
  await h.admin.query(`alter table vendor_billing_policy disable trigger vendor_billing_policy_guard`);
  await h.admin.query(`update vendor_billing_policy set channel_fee_bearer = 'tenant', fee_bearer_ref = 'UJI-Q16', tax_treatment_ref = 'SURAT-KONSULTAN-PAJAK-UJI'`);
  await h.admin.query(`alter table vendor_billing_policy enable always trigger vendor_billing_policy_guard`);
  await h.admin.query(`alter table vendor_profile disable trigger user`);
  await h.admin.query(`update vendor_profile set is_pkp = false, pkp_effective_from = null, tax_evidence_ref = 'SURAT-NON-PKP-UJI' where id = 1`);
  await h.admin.query(`alter table vendor_profile enable trigger user`);
});
afterEach(() => expect(fetchSpy).not.toHaveBeenCalled());
afterAll(async () => {
  vi.unstubAllGlobals();
  op?.release();
  for (const p of [opPool, exec, vendor, owner, unbound, app]) await p?.end();
  await h?.close();
});

describe("T-103 console reader R1", () => {
  it("finance, platform owner and auditor read allowlisted fields only (no ket, instruction, provider body or clinic data)", async () => {
    const cl = await clinic("2026-03-02");
    await issue(exec, WIB("2026-03-02"));
    const port = mockAutolarisPort();
    await bayar(app, unbound, await ownerCtx(cl), port, { key: crypto.randomUUID(), invoiceId: await invoiceOf(cl.tenantId), channel: "VABNI", payer: PAYER, now: WIB("2026-03-03") });
    for (const w of [FIN, PO, AUD]) {
      const r = await billingDetail(vendor, c(w), cl.tenantId);
      expect(r.ok, w.acc).toBe(true);
      if (!r.ok) continue;
      const json = JSON.stringify(r.data);
      expect(r.data.invoices[0].attempts[0]).toMatchObject({ state: "pending", channel: "VABNI" });
      expect(Object.keys(r.data.invoices[0].attempts[0]).sort()).toEqual(["advice_count", "amount", "channel", "closed_by", "expires_at", "id", "notes", "observations", "rc", "reff_id", "state"]);
      expect(json).not.toMatch(/virtual_account|8779611150001393|"ket"|"instruction"|"raw"|finish_token|Pemilik Konsol|owner@klinik/);
    }
    const before = (await logged("billing_read", AUD.acc)).length;
    const list = await billingList(vendor, c(AUD));
    expect(list.ok && list.data.tenants.some((t) => t.id === cl.tenantId)).toBe(true);
    expect(list.ok && list.data.gates).toEqual({ settlement_confirmed: false, fee_bearer: "tenant", tax_treatment_set: true, vendor_tax_status_set: true });
    // review r1 P2: a successful list read is logged (an authenticated outcome)
    const after = await logged("billing_read", AUD.acc);
    expect(after.length).toBe(before + 1);
    expect(after.at(-1)).toEqual({ outcome: "success", reason_code: "list" });
    expect(JSON.stringify(list)).not.toMatch(/SURAT-NON-PKP-UJI|tax_evidence/); // a boolean only, no evidence reference
    // review r1 P2: treatment set but the vendor's tax status unknown → its own blocker
    await h.admin.query(`alter table vendor_profile disable trigger user`);
    await h.admin.query(`update vendor_profile set tax_evidence_ref = null where id = 1`);
    await h.admin.query(`alter table vendor_profile enable trigger user`);
    try {
      const l2 = await billingList(vendor, c(AUD));
      expect(l2.ok && l2.data.gates).toMatchObject({ tax_treatment_set: true, vendor_tax_status_set: false });
    } finally {
      await h.admin.query(`alter table vendor_profile disable trigger user`);
      await h.admin.query(`update vendor_profile set tax_evidence_ref = 'SURAT-NON-PKP-UJI' where id = 1`);
      await h.admin.query(`alter table vendor_profile enable trigger user`);
    }
  });
  it("support and onboarding staff, no session, an invalid token, a stale step-up and an IP outside the allowlist are refused", async () => {
    const cl = await clinic("2026-03-02");
    for (const w of [SUP, ONB]) expect(await billingDetail(vendor, c(w), cl.tenantId)).toMatchObject({ ok: false, code: "ERR_FORBIDDEN", reason: "role_not_held" });
    expect(await billingDetail(vendor, { token: "tok-nicht-vorhanden-xxxxxxxxxxxxxxxx", ip: IP }, cl.tenantId)).toMatchObject({ ok: false, reason: "no_session" });
    const stale = { acc: FIN.acc, tok: await session(FIN.acc, "11 minutes") };
    expect(await billingDetail(vendor, c(stale), cl.tenantId)).toMatchObject({ ok: false, reason: "totp_not_verified" });
    expect(await billingDetail(vendor, c(FIN, "198.51.100.7"), cl.tenantId)).toMatchObject({ ok: false, reason: "ip_not_allowed" });
    expect(await billingDetail(vendor, c(FIN), "00000000-0000-7000-8000-000000000000")).toMatchObject({ ok: false, code: "ERR_NOT_FOUND" });
    // a clinic login has no EXECUTE on any console entry point
    for (const sql of [`select vendor_console_billing($1, $2, null)`, `select vendor_billing_attempt_note($1, $2, null, 'x', 'y')`]) {
      expect(await app.query(sql, [FIN.tok, IP]).then(() => "ok", (e) => `raw:${e.code}`), sql).toBe("raw:42501");
    }
  });
});

describe("T-103 console requests R2–R4", () => {
  it("finance requests a fee change; the same person cannot approve; another platform owner approves; approval does not apply it; replay refused", async () => {
    const cl = await clinic("2026-01-05");
    const r = await requestBilling(vendor, c(FIN), cl.tenantId, { kind: "server_fee_change", amountRupiah: 1_250_000, effectiveMonth: nextMonth(2) }, "Penyesuaian biaya server sesuai kontrak");
    expect(r.ok).toBe(true);
    const id = r.ok ? r.data.id : "";
    expect(await requestBilling(vendor, c(FIN2), cl.tenantId, { kind: "server_fee_change", amountRupiah: 1_300_000, effectiveMonth: nextMonth(2) }, "Penyesuaian biaya server kedua"))
      .toMatchObject({ ok: false, code: "ERR_IDEMPOTENCY_CONFLICT" });
    // the platform owner role is required; finance cannot decide
    expect(await decideBilling(vendor, c(FIN), id, true, "")).toMatchObject({ ok: false, reason: "role_not_held" });
    expect(await decideBilling(vendor, c(PO2), id, true, "")).toMatchObject({ ok: true, data: { state: "approved" } });
    expect(await decideBilling(vendor, c(PO), id, false, "terlambat")).toMatchObject({ ok: false, code: "ERR_VERSION_CONFLICT" });
    expect((await snapshot(cl.tenantId)).versions).toBe("0"); // approval never applies; the executor worker does
    expect((await h.admin.query(`select consumed_at from vendor_requests where id = $1`, [id])).rows[0].consumed_at).toBeNull();
  });
  it("one person holding both vendor finance and platform owner can file but never approve their own request (requester ≠ approver)", async () => {
    const cl = await clinic("2026-01-05");
    const both = await account("both");
    await createVendorStaff(op, caller(PO.acc), both, "Keuangan dan Pemilik", ["vendor_finance", "platform_owner"] as never);
    const w = { acc: both, tok: await session(both) };
    const r = await requestBilling(vendor, c(w), cl.tenantId, { kind: "server_fee_change", amountRupiah: 1_100_000, effectiveMonth: nextMonth(3) }, "Penyesuaian biaya oleh peran ganda");
    expect(r.ok).toBe(true);
    const id = r.ok ? r.data.id : "";
    const before = await snapshot(cl.tenantId);
    expect(await decideBilling(vendor, c(w), id, true, "")).toMatchObject({ ok: false, code: "ERR_APPROVER_IS_REQUESTER" });
    expect(await snapshot(cl.tenantId)).toEqual(before);
    expect((await logged("billing_decide", both)).map((x) => [x.outcome, x.reason_code])).toEqual([["denied", "approver_is_requester"]]);
    expect(await decideBilling(vendor, c(PO2), id, true, "")).toMatchObject({ ok: true });
  });

  it("kinds are restricted on direct calls; a waiver names an issued invoice of that tenant; other-kind requests are invisible to decide / cancel", async () => {
    const cl = await clinic("2026-01-05");
    const other = await clinic("2026-01-05");
    await issue(exec, WIB("2026-01-05"));
    const before = await snapshot(cl.tenantId);
    for (const kind of ["suspension", "clinical_grant", "exit", "dual_identity"]) {
      const r = (await vendor.query(`select vendor_console_billing_request($1, $2, $3, $4, '{}'::jsonb, 'Permintaan di luar tagihan') r`, [FIN.tok, IP, cl.tenantId, kind])).rows[0].r;
      expect({ kind, r }).toEqual({ kind, r: { ok: false, code: "ERR_NOT_FOUND" } });
    }
    expect(await requestBilling(vendor, c(FIN), cl.tenantId, { kind: "invoice_waiver", invoiceId: await invoiceOf(other.tenantId), amountRupiah: 1000 }, "Pembebasan tagihan klinik lain"))
      .toMatchObject({ ok: false, code: "ERR_INVALID_INPUT" });
    // a lifecycle request (filed through the actor-id path) cannot be decided or cancelled through the billing entrypoints
    const susp = (await op.query(`select vendor_request($1, $2, now(), 'suspension', $3, '{}'::jsonb, 'Penangguhan uji batas jenis permintaan') r`, [FIN.acc, IP, cl.tenantId])).rows[0].r;
    expect(susp.ok).toBe(true);
    expect(await decideBilling(vendor, c(PO2), susp.id, true, "")).toMatchObject({ ok: false, code: "ERR_NOT_FOUND" });
    expect(await cancelBilling(vendor, c(FIN), susp.id)).toMatchObject({ ok: false, code: "ERR_NOT_FOUND" });
    expect((await h.admin.query(`select state from vendor_requests where id = $1`, [susp.id])).rows[0].state).toBe("pending");
    const after = await snapshot(cl.tenantId);
    expect({ ...after, req: undefined }).toEqual({ ...before, req: undefined });
  });
  it("cancel: only the requester, only pending; the platform owner and another finance user are refused; every refusal logged", async () => {
    const cl = await clinic("2026-01-05");
    await issue(exec, WIB("2026-01-05"));
    const r = await requestBilling(vendor, c(FIN), cl.tenantId, { kind: "invoice_waiver", invoiceId: await invoiceOf(cl.tenantId), amountRupiah: 5000 }, "Kompensasi gangguan uji batal");
    const id = r.ok ? r.data.id : "";
    expect(await cancelBilling(vendor, c(FIN2), id)).toMatchObject({ ok: false, code: "ERR_NOT_FOUND" });
    expect(await cancelBilling(vendor, c(PO), id)).toMatchObject({ ok: false, reason: "role_not_held" });
    expect(await cancelBilling(vendor, c(FIN), id)).toMatchObject({ ok: true });
    expect(await cancelBilling(vendor, c(FIN), id)).toMatchObject({ ok: false, code: "ERR_NOT_FOUND" });
    expect(await decideBilling(vendor, c(PO2), id, true, "")).toMatchObject({ ok: false, code: "ERR_VERSION_CONFLICT" });
    expect((await logged("billing_cancel", FIN2.acc)).map((x) => x.outcome)).toContain("denied");
    // no valid session: refused without an attributable log row (the established exception)
    const rows = (await h.admin.query(`select count(*)::int n from vendor_actions where action like 'billing_%' and account_id is null`)).rows[0].n;
    expect(await cancelBilling(vendor, { token: "tok-nicht-vorhanden-yyyyyyyyyyyyyyyy", ip: IP }, id)).toMatchObject({ ok: false, reason: "no_session" });
    expect((await h.admin.query(`select count(*)::int n from vendor_actions where action like 'billing_%' and account_id is null`)).rows[0].n).toBe(rows);
  });
});

describe("T-103 Terbitkan Tagihan (Panel 2 option b)", () => {
  it("finance / platform owner issue what is due for one tenant (same issuer: once, BILL-31 amounts); nothing due says so; other roles refused", async () => {
    const cl = await clinic("2025-11-21");
    const r = await issueBilling(vendor, c(FIN), cl.tenantId);
    expect(r.ok && r.data.issued).toBeGreaterThanOrEqual(1);
    const first = (await h.admin.query(`select amount_rupiah, kind, to_char(issue_date, 'YYYY-MM-DD') d from vendor_invoices where tenant_id = $1 order by period limit 1`, [cl.tenantId])).rows[0];
    expect(first).toEqual({ amount_rupiah: 333_333, kind: "first", d: "2025-11-21" }); // the BILL-31 first invoice, dated go-live (no back-dating, no override)
    const before = await snapshot(cl.tenantId);
    expect(await issueBilling(vendor, c(PO), cl.tenantId)).toMatchObject({ ok: true, data: { issued: 0, held: 0 } }); // idempotent: nothing due
    expect(await snapshot(cl.tenantId)).toEqual(before);
    for (const w of [AUD, SUP, ONB]) expect(await issueBilling(vendor, c(w), cl.tenantId)).toMatchObject({ ok: false, reason: "role_not_held" });
    expect(await issueBilling(vendor, { token: "tok-nicht-vorhanden-zzzzzzzzzzzzzzzz", ip: IP }, cl.tenantId)).toMatchObject({ ok: false, reason: "no_session" });
    expect(await issueBilling(vendor, { token: await session(FIN.acc, "11 minutes"), ip: IP }, cl.tenantId)).toMatchObject({ ok: false, reason: "totp_not_verified" });
    expect(await issueBilling(vendor, c(FIN, "198.51.100.7"), cl.tenantId)).toMatchObject({ ok: false, reason: "ip_not_allowed" });
    // no tenant / unknown tenant: never an all-tenants issuance
    for (const t of [null, "00000000-0000-7000-8000-000000000000"]) expect(await issueBilling(vendor, c(FIN), t)).toMatchObject({ ok: false, code: "ERR_NOT_FOUND" });
    expect(await snapshot(cl.tenantId)).toEqual(before);
    expect((await logged("billing_issue", FIN.acc)).map((x) => x.reason_code)).toEqual(expect.arrayContaining(["issued", "tenant_not_found"]));
  });
  it("held by the tax gate: unknown vendor tax status → nothing issued and the result says held (no false success)", async () => {
    const cl = await clinic("2025-09-02");
    await h.admin.query(`alter table vendor_profile disable trigger user`);
    await h.admin.query(`update vendor_profile set tax_evidence_ref = null where id = 1`);
    await h.admin.query(`alter table vendor_profile enable trigger user`);
    try {
      expect(await issueBilling(vendor, c(FIN), cl.tenantId)).toMatchObject({ ok: true, data: { issued: 0, held: expect.any(Number) } });
      const r = await issueBilling(vendor, c(FIN), cl.tenantId);
      expect(r.ok && r.data.held).toBeGreaterThanOrEqual(1);
      expect((await h.admin.query(`select count(*)::int n from vendor_invoices where tenant_id = $1`, [cl.tenantId])).rows[0].n).toBe(0);
      expect((await logged("billing_issue", FIN.acc)).map((x) => x.reason_code)).toContain("held_tax_status");
    } finally {
      await h.admin.query(`alter table vendor_profile disable trigger user`);
      await h.admin.query(`update vendor_profile set tax_evidence_ref = 'SURAT-NON-PKP-UJI' where id = 1`);
      await h.admin.query(`alter table vendor_profile enable trigger user`);
    }
  });
  it("mixed outcome (review a3 P2): PKP effective inside the catch-up → earlier months held, later issued; the result and the log say both", async () => {
    const cl = await clinic("2025-05-10");
    const eff = new Date();
    eff.setUTCDate(1);
    eff.setUTCMonth(eff.getUTCMonth() - 1);
    await h.admin.query(`alter table vendor_profile disable trigger user`);
    await h.admin.query(`update vendor_profile set is_pkp = true, pkp_effective_from = $1::date, tax_evidence_ref = 'PKP-UJI' where id = 1`, [eff.toISOString().slice(0, 10)]);
    await h.admin.query(`alter table vendor_profile enable trigger user`);
    try {
      const r = await issueBilling(vendor, c(FIN), cl.tenantId);
      expect(r.ok && r.data.issued).toBeGreaterThanOrEqual(1);
      expect(r.ok && r.data.held).toBeGreaterThanOrEqual(1);
      const rows = (await h.admin.query(`select vat_rupiah from vendor_invoices where tenant_id = $1`, [cl.tenantId])).rows;
      expect(rows.length).toBe(r.ok ? r.data.issued : -1);
      expect(rows.every((x) => x.vat_rupiah > 0)).toBe(true); // only the PKP months were issued (with VAT); the earlier ones held
      expect((await logged("billing_issue", FIN.acc)).map((x) => x.reason_code)).toContain("issued_partly_held");
    } finally {
      await h.admin.query(`alter table vendor_profile disable trigger user`);
      await h.admin.query(`update vendor_profile set is_pkp = false, pkp_effective_from = null, tax_evidence_ref = 'SURAT-NON-PKP-UJI' where id = 1`);
      await h.admin.query(`alter table vendor_profile enable trigger user`);
    }
  });
  it("concurrent manual and automatic issuance: no deadlock, each period once (forced: the shape that deadlocked under a per-month number lock)", async () => {
    // A (earlier id) goes live today: the worker issues A this month, then needs T's lock. T has months to catch up, this month included. A
    // blocker holds T's lock; the console issue for T queues first, the worker queues second (after issuing A). On release T goes to the
    // console (FIFO) while the worker still holds A's transaction: any lock the worker took for A that the console needs for T deadlocks.
    const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    const a = await clinic(today);
    const t = await clinic("2025-07-15");
    const advisoryWaiters = async (user: string, blockerPid: number) => (await h.admin.query(`select count(*)::int n from pg_stat_activity where usename = $2
      and datname = current_database() and wait_event_type = 'Lock' and wait_event = 'advisory' and pid <> $1`, [blockerPid, user])).rows[0].n as number;
    const until = async (f: () => Promise<boolean>) => { for (let i = 0; i < 200 && !(await f()); i++) await new Promise((r) => setTimeout(r, 25)); return f(); };
    const blocker = await owner.connect();
    const queued = [false, false];
    let manual: Promise<unknown> | undefined;
    let auto: Promise<unknown> | undefined;
    await blocker.query("begin");
    try {
      await blocker.query(`select pg_advisory_xact_lock(hashtextextended('vendor_billing:' || $1::text, 0))`, [t.tenantId]);
      const pid = (await blocker.query(`select pg_backend_pid() p`)).rows[0].p as number;
      manual = issueBilling(vendor, c(FIN), t.tenantId).then((r) => r, (e) => e);
      queued[0] = await until(async () => (await advisoryWaiters(vendorUser, pid)) === 1);
      auto = issue(exec).then((r) => r, (e) => e);
      queued[1] = await until(async () => (await advisoryWaiters(execUser, pid)) === 1);
    } finally {
      await blocker.query("commit");
      blocker.release();
    }
    expect(queued, "console then worker queued on T's lock before release").toEqual([true, true]);
    const [m, w] = await Promise.all([manual, auto]);
    expect([m instanceof Error ? (m as { code?: string }).code : "ok", w instanceof Error ? (w as { code?: string }).code : "ok"]).toEqual(["ok", "ok"]);
    expect(m).toMatchObject({ ok: true });
    for (const x of [a.tenantId, t.tenantId]) {
      const per = (await h.admin.query(`select period, count(*)::int n from vendor_invoices where tenant_id = $1 group by period`, [x])).rows;
      expect(per.length).toBeGreaterThanOrEqual(1);
      expect(per.every((r) => r.n === 1)).toBe(true);
    }
    const nums = (await h.admin.query(`select number from vendor_invoices`)).rows.map((r) => r.number as string);
    expect(new Set(nums).size).toBe(nums.length);
  });
});

describe("T-103 support note N (not D2)", () => {
  it("a note (direct call, replay, other roles, stale step-up) never changes the attempt, the outstanding or whether a new attempt is allowed", async () => {
    const cl = await clinic("2025-12-01");
    await issue(exec, WIB("2025-12-01"));
    const inv = await invoiceOf(cl.tenantId);
    const port = mockAutolarisPort();
    port.next("create", { http: 503, body: null });
    const b = await bayar(app, unbound, await ownerCtx(cl), port, { key: crypto.randomUUID(), invoiceId: inv, channel: "VABNI", payer: PAYER, now: WIB("2025-12-02") });
    expect(b.state).toBe("unknown");
    const before = await snapshot(cl.tenantId);
    expect(await noteAttempt(vendor, c(FIN), b.attemptId, "CS-AUTOLARIS-1234", "Dukungan AutoLaris: transaksi tidak ditemukan")).toMatchObject({ ok: true });
    expect(await noteAttempt(vendor, c(FIN), b.attemptId, "CS-AUTOLARIS-1234", "Dukungan AutoLaris: transaksi tidak ditemukan")).toMatchObject({ ok: true });
    for (const w of [PO, AUD, SUP]) expect(await noteAttempt(vendor, c(w), b.attemptId, "CS-X", "Catatan dari peran lain")).toMatchObject({ ok: false, reason: "role_not_held" });
    expect(await noteAttempt(vendor, { token: (await session(FIN.acc, "11 minutes")), ip: IP }, b.attemptId, "CS-Y", "Catatan dengan verifikasi kedaluwarsa"))
      .toMatchObject({ ok: false, reason: "totp_not_verified" });
    expect(await snapshot(cl.tenantId)).toEqual(before);
    expect((await h.admin.query(`select count(*)::int n from vendor_attempt_notes where attempt_id = $1`, [b.attemptId])).rows[0].n).toBe(2);
    // still blocking: a new Bayar is refused and no provider call happens
    await expect(bayar(app, unbound, await ownerCtx(cl), port, { key: crypto.randomUUID(), invoiceId: inv, channel: "VABNI", payer: PAYER, now: WIB("2025-12-03") }))
      .rejects.toMatchObject({ code: "ERR_VERSION_CONFLICT", reason: "attempt_open" });
    expect(port.count("create")).toBe(1);
  });
});

describe("T-103 token-fenced finish (addendum a2-1)", () => {
  it("the old finish signature is gone; the vendor login cannot finish; a bound context is refused; forged / empty / other-attempt tokens write nothing", async () => {
    expect((await h.admin.query(`select count(*)::int n from pg_proc where proname = 'vendor_billing_bayar_finish'`)).rows[0].n).toBe(1);
    const cl = await clinic("2025-11-03");
    await issue(exec, WIB("2025-11-03"));
    const inv = await invoiceOf(cl.tenantId);
    const begin = async (key = crypto.randomUUID()) => (await withTenantContext(app, await ownerCtx(cl), (db) =>
      db.query(`select vendor_billing_bayar_begin($1, $2, 'VABNI', array['VABNI'], $3) r`, [key, inv, WIB("2025-11-04")]))).rows[0].r;
    const b = await begin();
    expect(b.finish_token).toMatch(/^[A-Za-z0-9_-]{40,64}$/);
    const fin = (pool: pg.Pool | pg.PoolClient, token: unknown, attempt = b.attempt_id) => pool.query(`select vendor_billing_bayar_finish($1, $2, 1, 'ok', $3::jsonb, now(), 'billing.bayar') r`,
      [attempt, token, JSON.stringify({ trx_id: "888001", admin: 3000, total: 1003000, instruction: {} })]).then((r) => r.rows[0].r, (e) => `raw:${e.code}:${String(e.message).slice(0, 40)}`);
    const before = await snapshot(cl.tenantId);
    expect(await fin(vendor, b.finish_token)).toMatch(/^raw:42501/); // no grant
    expect(await withTenantContext(app, await ownerCtx(cl), (db) => fin(db, b.finish_token))).toMatch(/^raw:42501:ERR_FORBIDDEN: the billing /);
    expect(await fin(unbound, "A".repeat(43))).toBe("refused");
    expect(await fin(unbound, "")).toBe("refused");
    expect(await fin(unbound, null)).toBe("refused");
    // another attempt's valid token
    const cl2 = await clinic("2025-11-03");
    await issue(exec, WIB("2025-11-03"));
    const inv2 = await invoiceOf(cl2.tenantId);
    const b2 = (await withTenantContext(app, await ownerCtx(cl2), (db) => db.query(`select vendor_billing_bayar_begin($1, $2, 'VABNI', array['VABNI'], now()) r`, [crypto.randomUUID(), inv2]))).rows[0].r;
    expect(await fin(unbound, b2.finish_token)).toBe("refused");
    expect(await snapshot(cl.tenantId)).toEqual(before);
    expect((await h.admin.query(`select count(*)::int n from vendor_actions where action = 'vendor_bayar_finish' and outcome = 'denied' and tenant_id = $1`, [cl.tenantId])).rows[0].n).toBe(4);
    // the right token finishes once; a replay after completion is stale and changes nothing
    expect(await fin(unbound, b.finish_token)).toBe("pending");
    const done = await snapshot(cl.tenantId);
    expect(await fin(unbound, b.finish_token)).toBe("stale");
    expect(await snapshot(cl.tenantId)).toEqual(done);
    // the token never appears in a reader or a log
    expect(JSON.stringify((await h.admin.query(`select * from vendor_actions where tenant_id = $1`, [cl.tenantId])).rows)).not.toContain(b.finish_token);
    const v = await withTenantContext(app, await ownerCtx(cl), (db) => db.query(`select vendor_billing_tenant_view() r`).then((r) => r.rows[0].r));
    expect(JSON.stringify(v)).not.toMatch(new RegExp(`${b.finish_token}|finish_token`));
  });
  it("a replayed begin gets no token and makes no provider call; with the first caller gone and no provider id the attempt stays blocking after recovery", async () => {
    const cl = await clinic("2025-10-06");
    await issue(exec, WIB("2025-10-06"));
    const inv = await invoiceOf(cl.tenantId);
    const key = crypto.randomUUID();
    const first = (await withTenantContext(app, await ownerCtx(cl), (db) => db.query(`select vendor_billing_bayar_begin($1, $2, 'VABNI', array['VABNI'], now()) r`, [key, inv]))).rows[0].r;
    expect(first.finish_token).toBeTruthy();
    const port = mockAutolarisPort();
    const replay = await bayar(app, unbound, await ownerCtx(cl), port, { key, invoiceId: inv, channel: "VABNI", payer: PAYER });
    expect(replay).toMatchObject({ attemptId: first.attempt_id, replayed: true, state: "creating" });
    expect(port.count("create")).toBe(0);
    await h.admin.query(`alter table vendor_payment_attempts disable trigger vendor_payment_attempts_guard`);
    await h.admin.query(`update vendor_payment_attempts set creating_since = now() - interval '10 minutes' where id = $1`, [first.attempt_id]);
    await h.admin.query(`alter table vendor_payment_attempts enable always trigger vendor_payment_attempts_guard`);
    expect(await recover(exec)).toBeGreaterThanOrEqual(1);
    expect((await h.admin.query(`select state, provider_trx_id from vendor_payment_attempts where id = $1`, [first.attempt_id])).rows[0]).toEqual({ state: "unknown", provider_trx_id: null });
    await expect(bayar(app, unbound, await ownerCtx(cl), port, { key: crypto.randomUUID(), invoiceId: inv, channel: "VABNI", payer: PAYER }))
      .rejects.toMatchObject({ code: "ERR_VERSION_CONFLICT", reason: "attempt_open" });
    expect(port.count("create")).toBe(0);
    void createVaOk;
  });
});
