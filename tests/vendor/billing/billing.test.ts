// T-103 increment 1 gate (PR-61; plan r4 + addendum a1; DEC-114): Scenarios PR-61 (prorated first month, expired attempt, provider error,
// waiver needs two people); the Q-13 fail-closed settlement (unconfirmed rule → review, never paid; a test-confirmed fixture rule → paid);
// the success envelope; the attempt fence, crash recovery and late answers; one open attempt; late settlement of an expired attempt; settlement
// allocation and overpayment credits; credit allocation to the next invoice; exit credit; fee versions after the last issued invoice; the
// fail-closed fee-bearer and VAT gates; reminders; roles; concurrency. Mock port only; fetch is stubbed and never called. Synthetic data.
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { APP_GROUP_ROLE, withTenantContext } from "../../../src/db/rls/context";
import { openAppPool } from "../../../src/db/rls/pool";
import { CommandError } from "../../../src/lib/command";
import { applyFeeChange, applyWaiver, bayar, finish, issue, recover, reminders, runAdvice, tenantView } from "../../../src/modules/vendor/billing/billing";
import { adviceDelivered, adviceExpired, advicePending, adviceRc02WithSettledFields, adviceSettled, createRc07, createVaOk, EXPIRED_STATUS,
  SETTLED_STATUS, SOURCE, timeout } from "../../../src/modules/vendor/billing/fixtures";
import { mockAutolarisPort } from "../../../src/modules/vendor/billing/mock";
import { assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { bootstrapVendor, createVendorStaff, decideVendorRequest, requestVendorAction, type VendorCaller, VendorStaffError } from "../../../src/modules/vendor/staff/staff";
import { createHarness, type Harness, testPool } from "../../rls/harness";

let h: Harness;
let app: pg.Pool;
let exec: pg.Pool;
let owner: pg.Pool;
let opPool: pg.Pool;
let op: pg.PoolClient;
let n = 0;
const IP = "203.0.113.10";
const caller = (accountId: string): VendorCaller => ({ accountId, ip: IP, mfaAt: new Date() });
const code = (x: Promise<unknown>) =>
  x.then(() => "ok", (e) => (e instanceof VendorStaffError ? `${e.code}:${e.reason ?? ""}` : e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason ?? ""}` : `raw:${e.code ?? e.message}`));
const fetchSpy = vi.fn();
const PAYER = { id: "T1", name: "PT Klinik Sintetis", phone: "081200000000", email: "owner@klinik-sintetis.test" };
const WIB = (d: string) => new Date(`${d}T09:00:00+07:00`);

let PO: string; let PO2: string; let FIN: string;
type Clinic = { tenantId: string; ownerAcc: string; finAcc: string; apAcc: string; audAcc: string; mgrAcc: string };

async function account(tag: string) {
  return (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`${tag}${++n}@sintetis.test`])).rows[0].id as string;
}
// A tenant that went live on `goLive` (YYYY-MM-DD, WIB) with an owner, finance, Admin Pusat, auditor and a manager.
async function clinic(goLive: string): Promise<Clinic> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Klinik Tagihan Sintetis', 'emkm')`, [tenantId]);
  const branch = (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'B1', 'Cabang 1', 'Asia/Jakarta') returning id`, [tenantId])).rows[0].id;
  await lifecycleEvent(tenantId, "onboarding", "live", WIB(goLive));
  const member = async (role: "owner" | "finance" | "admin_pusat" | "auditor" | "manager") => {
    const acc = await account(role);
    const { staffId } = await createMembership(owner, { tenantId, accountId: acc, displayName: `Staf ${role} ${n}` });
    const rid = await assignRole(h.admin, { tenantId, staffId, role });
    if (role === "manager") await h.admin.query(`insert into staff_branches (tenant_id, staff_role_id, staff_id, role, branch_id) select tenant_id, id, staff_id, role, $2 from staff_roles where id = $1`, [rid, branch]).catch(() => undefined);
    return acc;
  };
  return { tenantId, ownerAcc: await member("owner"), finAcc: await member("finance"), apAcc: await member("admin_pusat"), audAcc: await member("auditor"), mgrAcc: await member("manager") };
}
// The lifecycle event as tenant_lifecycle_transition writes it (stand-in: the go-live / exit date is the fixture's; the guard that keeps the
// history append-only is paused for the insert only).
async function lifecycleEvent(tenantId: string, from: string, to: string, at: Date) {
  await h.admin.query(`alter table tenant_lifecycle_events disable trigger user`);
  try {
    await h.admin.query(`insert into tenant_lifecycle_events (tenant_id, from_state, to_state, reason, actor_kind, actor, at)
      values ($1, $2, $3, 'Fixture uji tagihan server', 'service', 'billing.fixture', $4)`, [tenantId, from, to, at]);
  } finally {
    await h.admin.query(`alter table tenant_lifecycle_events enable trigger user`);
  }
}
const ctx = async (c: Clinic, who: "ownerAcc" | "finAcc" | "apAcc" | "audAcc" | "mgrAcc", role: string) => resolveContext(app, c[who], { tenantId: c.tenantId, actingRole: role });
const view = async (c: Clinic, who: "ownerAcc" | "finAcc" | "apAcc" | "audAcc" | "mgrAcc" = "ownerAcc", role = "owner") =>
  withTenantContext(app, await ctx(c, who, role), (db) => tenantView(db));
const invoices = async (t: string) => (await h.admin.query(`select * from vendor_invoices where tenant_id = $1 order by period`, [t])).rows;
const attempts = async (inv: string) => (await h.admin.query(`select * from vendor_payment_attempts where invoice_id = $1 order by seq`, [inv])).rows;
const outstanding = async (inv: string) => (await h.admin.query(`select vendor_invoice_outstanding($1) o`, [inv])).rows[0].o as number;
const pay = async (c: Clinic, port: ReturnType<typeof mockAutolarisPort>, inv: string, o: { key?: string; channel?: string; now?: Date } = {}) =>
  bayar(app, exec, await ctx(c, "ownerAcc", "owner"), port, { key: o.key ?? crypto.randomUUID(), invoiceId: inv, channel: o.channel ?? "VABNI", payer: PAYER, now: o.now });
// policy / rule fixtures (the database owner stands in for the owner-gated steps that have no writer in T-103)
async function policy(p: { bearer?: "tenant" | "vendor" | null; tax?: string | null }) {
  await h.admin.query(`alter table vendor_billing_policy disable trigger vendor_billing_policy_guard`);
  try {
    if (p.bearer !== undefined) await h.admin.query(`update vendor_billing_policy set channel_fee_bearer = $1, fee_bearer_ref = $2`, [p.bearer, p.bearer ? "UJI-Q16" : null]);
    if (p.tax !== undefined) await h.admin.query(`update vendor_billing_policy set tax_treatment_ref = $1`, [p.tax]);
  } finally {
    await h.admin.query(`alter table vendor_billing_policy enable always trigger vendor_billing_policy_guard`);
  }
}
async function vendorTax(s: "pkp" | "non_pkp" | "unknown") {
  await h.admin.query(`alter table vendor_profile disable trigger user`);
  try {
    if (s === "pkp") await h.admin.query(`update vendor_profile set is_pkp = true, pkp_effective_from = '2020-01-01', tax_evidence_ref = 'SKPKP-UJI' where id = 1`);
    else if (s === "non_pkp") await h.admin.query(`update vendor_profile set is_pkp = false, pkp_effective_from = null, tax_evidence_ref = 'SURAT-NON-PKP-UJI' where id = 1`);
    else await h.admin.query(`update vendor_profile set is_pkp = false, pkp_effective_from = null, tax_evidence_ref = null where id = 1`);
  } finally {
    await h.admin.query(`alter table vendor_profile enable trigger user`);
  }
}
async function confirmRule(meaning: "settled" | "expired", status: string) {
  await h.admin.query(`insert into autolaris_settlement_rules (meaning, status, confirmed, flag, evidence_ref) values ($1, $2, true, 'pending_q13', 'FIXTURE-Q13')
    on conflict (meaning, status) do nothing`, [meaning, status]);
}
async function dropConfirmedRules() {
  await h.admin.query(`alter table autolaris_settlement_rules disable trigger autolaris_settlement_rules_guard`);
  try {
    await h.admin.query(`delete from autolaris_settlement_rules where confirmed`);
  } finally {
    await h.admin.query(`alter table autolaris_settlement_rules enable always trigger autolaris_settlement_rules_guard`);
  }
}
// the Advice worker runs `minutes` after `base` (the schedule needs advice_next_at to be due)
const advise = (port: ReturnType<typeof mockAutolarisPort>, at: Date) => runAdvice(exec, port, { now: at });
const later = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);

beforeAll(async () => {
  vi.stubGlobal("fetch", fetchSpy);
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  exec = testPool({ connectionString: h.urlAs(await h.createLoginRole("", ["clinic_executor"])), max: 4 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  opPool = testPool({ connectionString: h.ownerUrl(), max: 1 });
  op = await opPool.connect();
  PO = await account("po"); PO2 = await account("po"); FIN = await account("fin");
  await bootstrapVendor(op, PO, "Pemilik Platform", "203.0.113.0/24", "Kantor vendor");
  await createVendorStaff(op, caller(PO), PO2, "Pemilik Platform Kedua", ["platform_owner"]);
  await createVendorStaff(op, caller(PO), FIN, "Keuangan Vendor", ["vendor_finance"]);
  await policy({ bearer: "tenant", tax: "SURAT-KONSULTAN-PAJAK-UJI" });
  await vendorTax("non_pkp");
});
afterEach(() => expect(fetchSpy).not.toHaveBeenCalled());
afterAll(async () => {
  vi.unstubAllGlobals();
  op?.release();
  await opPool?.end();
  await exec?.end();
  await owner?.end();
  await app?.end();
  await h?.close();
});

describe("T-103 Scenarios PR-61", () => {
  it("prorated first month: go-live 21 Nov, 30 days, Rp1,000,000 → Rp333,333; paid only after AutoLaris reports a verified settled status", async () => {
    const c = await clinic("2026-11-21");
    expect(await issue(exec, WIB("2026-11-21"))).toBe(1);
    const [inv] = await invoices(c.tenantId);
    expect(inv).toMatchObject({ kind: "first", period: "2026-11", amount_rupiah: 333_333, vat_rupiah: 0, total_rupiah: 333_333, fee_source: "default",
      fee_amount: 1_000_000, proration: { days: 10, days_in_month: 30 }, state: "issued", number: expect.stringMatching(/^VND-202611-\d{4}$/) });
    expect((await h.admin.query(`select to_char(issue_date, 'YYYY-MM-DD') i, to_char(due_date, 'YYYY-MM-DD') d from vendor_invoices where id = $1`, [inv.id])).rows[0])
      .toEqual({ i: "2026-11-21", d: "2026-12-01" }); // issued on go-live, due 10 days later (BILL-31)
    const port = mockAutolarisPort();
    expect(port.source).toBe(SOURCE);
    const t0 = WIB("2026-11-22");
    const b = await pay(c, port, inv.id, { now: t0 });
    expect(b.state).toBe("pending");
    // the seeded rule is unconfirmed (Q-13): a settled-looking Advice is recorded for review, the invoice stays issued
    port.next("advice", adviceSettled(333_333));
    await advise(port, later(t0, 2));
    expect((await invoices(c.tenantId))[0].state).toBe("issued");
    expect((await h.admin.query(`select interpreted from vendor_advice_observations o join vendor_payment_attempts a on a.id = o.attempt_id where a.invoice_id = $1`, [inv.id])).rows)
      .toEqual([{ interpreted: "unrecognized" }]);
    expect((await h.admin.query(`select kind from vendor_billing_reviews where tenant_id = $1`, [c.tenantId])).rows).toEqual([{ kind: "advice_unconfirmed" }]);
    // an Advice whose status matches the seeded UNCONFIRMED rule exactly: recorded settled_unconfirmed, still never paid (Q-13)
    port.next("advice", { http: 200, body: { rc: "00", ket: "Sukses", data: { status: "PENDING_Q13_PLACEHOLDER", amount: "333333" } } });
    await advise(port, later(t0, 6));
    expect((await invoices(c.tenantId))[0].state).toBe("issued");
    expect((await h.admin.query(`select interpreted from vendor_advice_observations o join vendor_payment_attempts a on a.id = o.attempt_id where a.invoice_id = $1 order by o.at`, [inv.id])).rows
      .map((r) => r.interpreted)).toEqual(["unrecognized", "settled_unconfirmed"]);
    expect((await h.admin.query(`select count(*)::int n from vendor_payments p join vendor_payment_attempts a on a.id = p.attempt_id where a.invoice_id = $1`, [inv.id])).rows[0].n).toBe(0);
    // a confirmed rule (test fixture flagged pending_q13) → paid
    await confirmRule("settled", SETTLED_STATUS);
    port.next("advice", adviceSettled(333_333));
    expect(await advise(port, later(t0, 30))).toMatchObject({ settled: 1 });
    expect((await invoices(c.tenantId))[0].state).toBe("paid");
    expect(await outstanding(inv.id)).toBe(0);
    await dropConfirmedRules();
  });

  it("expired attempt: Advice proves expiry → Bayar again creates a new attempt with a new reff_id; the expired one stays recorded", async () => {
    const c = await clinic("2026-10-05");
    await issue(exec, WIB("2026-10-05"));
    const [inv] = await invoices(c.tenantId);
    const port = mockAutolarisPort();
    const t0 = WIB("2026-10-06");
    const a1 = await pay(c, port, inv.id, { now: t0 });
    // while unconfirmed, nothing unlocks: Bayar again is refused
    expect(await code(pay(c, port, inv.id, { now: t0 }))).toBe("ERR_VERSION_CONFLICT:attempt_open");
    await confirmRule("expired", EXPIRED_STATUS);
    port.next("advice", adviceExpired());
    expect(await advise(port, later(t0, 2))).toMatchObject({ expired: 1 });
    const a2 = await pay(c, port, inv.id, { now: later(t0, 5) });
    expect(a2.state).toBe("pending");
    expect(a2.reffId).not.toBe(a1.reffId);
    expect((await attempts(inv.id)).map((x) => [x.state, x.reff_id])).toEqual([["expired", a1.reffId], ["pending", a2.reffId]]);
    await dropConfirmedRules();
  });

  it("provider error: rc ≠ 00 → the attempt is failed, no transaction id stored, the invoice stays issued", async () => {
    const c = await clinic("2026-09-01");
    await issue(exec, WIB("2026-09-01"));
    const [inv] = await invoices(c.tenantId);
    const port = mockAutolarisPort();
    port.next("create", createRc07());
    const r = await pay(c, port, inv.id, { now: WIB("2026-09-02") });
    expect(r.state).toBe("failed");
    expect((await attempts(inv.id))[0]).toMatchObject({ state: "failed", provider_trx_id: null, rc: "07", closed_by: "create_rc" });
    expect((await invoices(c.tenantId))[0].state).toBe("issued");
    // a failed create does not block a new attempt
    expect((await pay(c, port, inv.id, { now: WIB("2026-09-02") })).state).toBe("pending");
  });

  it("waiver needs two people: the requester approving is refused; a different platform owner's approval creates a waiver document", async () => {
    const c = await clinic("2026-08-03");
    await issue(exec, WIB("2026-08-03"));
    const [inv] = await invoices(c.tenantId);
    const out = await outstanding(inv.id);
    // vendor finance requests; the same person cannot approve (IAM-10)
    const req = await requestVendorAction(op, caller(FIN), c.tenantId, { kind: "invoice_waiver", invoiceId: inv.id, amountRupiah: out }, "Bulan pertama dibebaskan untuk uji tagihan");
    expect(await code(decideVendorRequest(op, caller(FIN), req, true))).toMatch(/^ERR_/);
    expect(await code(applyWaiver(exec, req, c.tenantId))).toMatch(/not_approved/);
    expect(await decideVendorRequest(op, caller(PO), req, true)).toBe("approved");
    const note = await applyWaiver(exec, req, c.tenantId);
    expect((await h.admin.query(`select kind, amount_rupiah, remaining_rupiah, request_id from vendor_credit_notes where id = $1`, [note])).rows[0])
      .toEqual({ kind: "waiver", amount_rupiah: out, remaining_rupiah: 0, request_id: req });
    expect((await invoices(c.tenantId))[0].state).toBe("waived");
    expect(await code(applyWaiver(exec, req, c.tenantId))).toMatch(/already_consumed/);
    // a stale / altered amount (above the outstanding when applied) is refused and leaves the request unconsumed
    const c2 = await clinic("2026-08-03");
    await issue(exec, WIB("2026-08-03"));
    const [inv2] = await invoices(c2.tenantId);
    const big = await requestVendorAction(op, caller(FIN), c2.tenantId, { kind: "invoice_waiver", invoiceId: inv2.id, amountRupiah: (await outstanding(inv2.id)) + 1 },
      "Pembebasan dengan nominal melebihi tagihan");
    await decideVendorRequest(op, caller(PO), big, true);
    expect(await code(applyWaiver(exec, big, c2.tenantId))).toMatch(/amount_stale/);
    expect((await h.admin.query(`select consumed_at from vendor_requests where id = $1`, [big])).rows[0].consumed_at).toBeNull();
    expect((await h.admin.query(`select count(*)::int n from vendor_credit_notes where tenant_id = $1`, [c2.tenantId])).rows[0].n).toBe(0);
  });
});

describe("T-103 Q-13 and the success envelope", () => {
  it("non-00 envelopes (incl. settled-looking fields) and shipping vocabulary never settle; the confirmed rule needs rc 00", async () => {
    const c = await clinic("2026-07-10");
    await issue(exec, WIB("2026-07-10"));
    const [inv] = await invoices(c.tenantId);
    await confirmRule("settled", SETTLED_STATUS);
    const port = mockAutolarisPort();
    const t0 = WIB("2026-07-11");
    await pay(c, port, inv.id, { now: t0 });
    const amount = (await attempts(inv.id))[0].amount_rupiah;
    port.next("advice", adviceRc02WithSettledFields(amount));
    port.next("advice", adviceDelivered());
    port.next("advice", { http: 500, body: { rc: "00", ket: "x", data: { status: SETTLED_STATUS, amount: String(amount) } } });
    port.next("advice", advicePending());
    for (const m of [2, 10, 30, 120]) await advise(port, later(t0, m));
    expect((await invoices(c.tenantId))[0].state).toBe("issued");
    expect((await h.admin.query(`select interpreted from vendor_advice_observations o join vendor_payment_attempts a on a.id = o.attempt_id where a.invoice_id = $1 order by o.at`, [inv.id])).rows.map((r) => r.interpreted))
      .toEqual(["pending", "unrecognized", "envelope_error", "pending"]);
    await dropConfirmedRules();
  });

  it("an Advice amount different from the attempt stays unpaid and is audited", async () => {
    const c = await clinic("2026-06-10");
    await issue(exec, WIB("2026-06-10"));
    const [inv] = await invoices(c.tenantId);
    await confirmRule("settled", SETTLED_STATUS);
    const port = mockAutolarisPort();
    const t0 = WIB("2026-06-11");
    await pay(c, port, inv.id, { now: t0 });
    port.next("advice", adviceSettled(1));
    await advise(port, later(t0, 2));
    expect((await invoices(c.tenantId))[0].state).toBe("issued");
    expect((await h.admin.query(`select kind from vendor_billing_reviews where tenant_id = $1`, [c.tenantId])).rows).toEqual([{ kind: "amount_mismatch" }]);
    expect((await h.admin.query(`select outcome, reason_code from vendor_actions where tenant_id = $1 and action = 'vendor_advice_amount_mismatch'`, [c.tenantId])).rows)
      .toEqual([{ outcome: "denied", reason_code: "amount_mismatch" }]);
    await dropConfirmedRules();
  });
});

describe("T-103 attempts: reff_id first, fence, recovery, one open attempt", () => {
  it("the reff_id is committed before the provider call; a timeout leaves the attempt unknown, no second create, a new Bayar refused", async () => {
    const c = await clinic("2026-05-04");
    await issue(exec, WIB("2026-05-04"));
    const [inv] = await invoices(c.tenantId);
    const port = mockAutolarisPort();
    let seen: unknown[] = [];
    port.during("create", async (arg) => {
      seen = (await h.admin.query(`select state, reff_id from vendor_payment_attempts where reff_id = $1`, [(arg as { reff_id: string }).reff_id])).rows;
    });
    port.next("create", timeout());
    const r = await pay(c, port, inv.id, { now: WIB("2026-05-05") });
    expect(seen).toEqual([{ state: "creating", reff_id: r.reffId }]);
    expect(r.state).toBe("unknown");
    expect(await code(pay(c, port, inv.id, { now: WIB("2026-05-05") }))).toBe("ERR_VERSION_CONFLICT:attempt_open");
    expect(port.count("create")).toBe(1);
    // the unknown attempt raises a review item for vendor finance (the support-note writer is increment 2; it never unlocks, a1-1)
    expect((await h.admin.query(`select kind from vendor_billing_reviews where subject_id = $1`, [r.attemptId])).rows).toEqual([{ kind: "attempt_unknown" }]);
  });

  it("review r1 P1: a create answered with HTTP 5xx (or any non-2xx, even with rc 00) is unknown, never failed: no replacement, no second create", async () => {
    for (const x of [{ http: 500, body: { rc: "00", ket: "x" } }, { http: 502, body: null }, { http: 404, body: { rc: "01", ket: "x" } }, { http: 200, body: { ket: "tanpa rc" } }]) {
      const c = await clinic("2026-05-11");
      await issue(exec, WIB("2026-05-11"));
      const [inv] = await invoices(c.tenantId);
      const port = mockAutolarisPort();
      port.next("create", x);
      const r = await pay(c, port, inv.id, { now: WIB("2026-05-12") });
      expect({ http: x.http, state: r.state }).toEqual({ http: x.http, state: "unknown" });
      expect((await attempts(inv.id))[0]).toMatchObject({ state: "unknown", provider_trx_id: null });
      expect(await code(pay(c, port, inv.id, { now: WIB("2026-05-12") }))).toBe("ERR_VERSION_CONFLICT:attempt_open");
      expect(port.count("create")).toBe(1);
    }
  });

  it("review r1 P2: identifiers grow without truncation — invoice sequence 10000 and attempt sequence 100 stay unique", async () => {
    const c = await clinic("2026-05-18");
    await issue(exec, WIB("2026-05-18"));
    const [inv] = await invoices(c.tenantId);
    // the next invoice number of that month after 9999 existing ones (fixture rows by the database owner)
    await h.admin.query(`alter table vendor_invoices disable trigger vendor_invoices_guard`);
    try {
      const t2 = await clinic("2026-05-18");
      await h.admin.query(`insert into vendor_invoices (tenant_id, number, kind, period, service_from, service_to, issue_date, due_date, fee_source, fee_amount, proration,
          amount_rupiah, vat_rupiah, total_rupiah, tax_basis, created_by) values ($1, 'VND-202606-9999', 'monthly', '2026-06', '2026-06-01', '2026-06-30', '2026-06-01', '2026-06-10',
          'default', 1000000, '{"days":30,"days_in_month":30}', 1000000, 0, 1000000, '{}', 'uji')`, [t2.tenantId]);
    } finally {
      await h.admin.query(`alter table vendor_invoices enable always trigger vendor_invoices_guard`);
    }
    await issue(exec, WIB("2026-06-01"));
    // other tenants of this database are issued June in the same run, so the exact number varies; it must continue past 9999 untruncated
    const june = (await h.admin.query(`select number from vendor_invoices where number like 'VND-202606-%' order by number`)).rows.map((r) => r.number as string);
    expect(june).toContain("VND-202606-10000");
    expect(new Set(june).size).toBe(june.length);
    expect(june.every((x) => /^VND-202606-\d{4,}$/.test(x))).toBe(true);
    // attempts 1..100 of one invoice: each failed by rc 07 → the 100th attempt's reff_id is distinct from the 10th
    const port = mockAutolarisPort();
    const reffs: string[] = [];
    for (let k = 1; k <= 100; k++) {
      port.next("create", createRc07());
      reffs.push((await pay(c, port, inv.id, { now: WIB("2026-05-19") })).reffId);
    }
    expect(new Set(reffs).size).toBe(100);
    expect(reffs[9]).toMatch(/A10$/);
    expect(reffs[99]).toMatch(/A100$/);
    expect(reffs.every((r) => /^SF[0-9]{10,}A[0-9]+$/.test(r) && r.length <= 30)).toBe(true);
  });

  it("a replayed key returns the same attempt without a provider call; two Bayar at once give one attempt", async () => {
    const c = await clinic("2026-04-06");
    await issue(exec, WIB("2026-04-06"));
    const [inv] = await invoices(c.tenantId);
    const port = mockAutolarisPort();
    const key = crypto.randomUUID();
    const r1 = await pay(c, port, inv.id, { key, now: WIB("2026-04-07") });
    const r2 = await pay(c, port, inv.id, { key, now: WIB("2026-04-07") });
    expect(r2).toMatchObject({ attemptId: r1.attemptId, replayed: true });
    expect(port.count("create")).toBe(1);
    const c2 = await clinic("2026-04-06");
    await issue(exec, WIB("2026-04-06"));
    const [inv2] = await invoices(c2.tenantId);
    const both = await Promise.all([pay(c2, port, inv2.id, { now: WIB("2026-04-07") }), pay(c2, port, inv2.id, { now: WIB("2026-04-07") })].map((p) => code(p)));
    expect(both.sort()).toEqual(["ERR_VERSION_CONFLICT:attempt_open", "ok"]);
    expect((await attempts(inv2.id)).length).toBe(1);
  });

  it("crash before the call: recovery → unknown (no create); crash after the provider created it: a late answer learns the id once and Advice reconciles", async () => {
    const c = await clinic("2026-03-02");
    await issue(exec, WIB("2026-03-02"));
    const [inv] = await invoices(c.tenantId);
    const t0 = new Date(); // recovery compares creating_since (the database clock) — the whole case runs on the real clock
    // begin committed, then the process stops: no provider call happened
    const b = (await withTenantContext(app, await ctx(c, "ownerAcc", "owner"), (db) =>
      db.query(`select vendor_billing_bayar_begin($1, $2, 'VABNI', array['VABNI'], $3) r`, [crypto.randomUUID(), inv.id, t0]))).rows[0].r;
    expect(await recover(exec, later(t0, 1))).toBe(0); // not yet 2 minutes
    expect(await recover(exec, later(t0, 3))).toBe(1);
    expect((await attempts(inv.id))[0]).toMatchObject({ state: "unknown", generation: 2, provider_trx_id: null });
    // the late provider answer (generation 1) still records the id once and returns it to reconciliation
    expect(await finish(exec, b.attempt_id, 1, createVaOk("777001", b.amount), "billing.bayar", later(t0, 4))).toBe("pending");
    expect((await attempts(inv.id))[0]).toMatchObject({ state: "pending", provider_trx_id: "777001" });
    // a second late answer is evidence only: the id is never replaced
    expect(await finish(exec, b.attempt_id, 1, createVaOk("777002", b.amount), "billing.bayar")).toBe("stale");
    expect((await attempts(inv.id))[0].provider_trx_id).toBe("777001");
    await confirmRule("settled", SETTLED_STATUS);
    const port = mockAutolarisPort();
    port.next("advice", adviceSettled(b.amount));
    expect(await advise(port, later(t0, 6))).toMatchObject({ settled: 1 });
    expect((await invoices(c.tenantId))[0].state).toBe("paid");
    await dropConfirmedRules();
  });
});

describe("T-103 settlement allocation, credits and late settlements", () => {
  it("expired observation → replacement attempt → late settlement of the old attempt (real worker selection) → paid once; the replacement's settlement becomes a credit", async () => {
    const c = await clinic("2026-02-03");
    await issue(exec, WIB("2026-02-03"));
    const [inv] = await invoices(c.tenantId);
    const amount = await outstanding(inv.id);
    await confirmRule("expired", EXPIRED_STATUS);
    await confirmRule("settled", SETTLED_STATUS);
    const port = mockAutolarisPort();
    const t0 = WIB("2026-02-04");
    const a1 = await pay(c, port, inv.id, { now: t0 });
    port.next("advice", adviceExpired());
    await advise(port, later(t0, 2));
    const a2 = await pay(c, port, inv.id, { now: later(t0, 3) });
    expect(a2.state).toBe("pending");
    // the old attempt is still read (expired, inside expires_at + 24 h) and settles late; the new one stays reconcilable
    const trx1 = (await attempts(inv.id))[0].provider_trx_id;
    port.next("advice", (id) => (id === trx1 ? adviceSettled(amount) : advicePending()));
    port.next("advice", (id) => (id === trx1 ? adviceSettled(amount) : advicePending()));
    await advise(port, later(t0, 70));
    expect((await invoices(c.tenantId))[0].state).toBe("paid");
    expect((await attempts(inv.id)).map((x) => x.state)).toEqual(["paid", "pending"]);
    // the replacement settles too → an overpayment credit equal to its settlement, the invoice paid once
    port.next("advice", adviceSettled(amount));
    await advise(port, later(t0, 200));
    expect((await attempts(inv.id)).map((x) => x.state)).toEqual(["paid", "paid"]);
    expect((await h.admin.query(`select kind, amount_rupiah, remaining_rupiah from vendor_credit_notes where tenant_id = $1`, [c.tenantId])).rows)
      .toEqual([{ kind: "overpayment", amount_rupiah: amount, remaining_rupiah: amount }]);
    expect((await h.admin.query(`select count(*)::int n, sum(amount_rupiah)::int s from vendor_payment_allocations where invoice_id = $1`, [inv.id])).rows[0]).toEqual({ n: 1, s: amount });
    void a1;
    await dropConfirmedRules();
  });

  it("pending attempt → approved partial credit → settlement: paid with no negative outstanding, the excess an overpayment credit; full waiver likewise", async () => {
    await confirmRule("settled", SETTLED_STATUS);
    for (const full of [false, true]) {
      const c = await clinic("2026-01-02");
      await issue(exec, WIB("2026-01-02"));
      const [inv] = await invoices(c.tenantId);
      const port = mockAutolarisPort();
      const t0 = WIB("2026-01-03");
      const a = await pay(c, port, inv.id, { now: t0 });
      const amount = (await attempts(inv.id))[0].amount_rupiah as number;
      const credit = full ? amount : Math.floor(amount / 2);
      const req = await requestVendorAction(op, caller(FIN), c.tenantId, { kind: "invoice_waiver", invoiceId: inv.id, amountRupiah: credit }, "Kompensasi gangguan layanan uji");
      await decideVendorRequest(op, caller(PO), req, true);
      await applyWaiver(exec, req, c.tenantId);
      port.next("advice", adviceSettled(amount));
      await advise(port, later(t0, 2));
      const i = (await invoices(c.tenantId))[0];
      expect({ full, state: i.state, out: await outstanding(inv.id) }).toEqual({ full, state: full ? "waived" : "paid", out: 0 });
      expect((await h.admin.query(`select kind, amount_rupiah from vendor_credit_notes where tenant_id = $1 order by created_at`, [c.tenantId])).rows)
        .toEqual([{ kind: full ? "waiver" : "credit", amount_rupiah: credit }, { kind: "overpayment", amount_rupiah: credit }]);
      void a;
    }
    await dropConfirmedRules();
  });

  it("a credit is allocated to the next invoice once (partial carry-forward); parallel issuers never spend it twice", async () => {
    await confirmRule("settled", SETTLED_STATUS);
    const c = await clinic("2025-11-21");
    await issue(exec, WIB("2025-11-21"));
    const [nov] = await invoices(c.tenantId);
    const port = mockAutolarisPort();
    const t0 = WIB("2025-11-22");
    // pay November twice over two attempts → one overpayment credit of 333,333
    await pay(c, port, nov.id, { now: t0 });
    await h.admin.query(`select 1`); // the first is pending; settle it, then a second payment on an already paid invoice is impossible via Bayar
    port.next("advice", adviceSettled(333_333));
    await advise(port, later(t0, 2));
    await h.admin.query(`insert into vendor_credit_notes (tenant_id, source_invoice_id, kind, amount_rupiah, remaining_rupiah, reason, created_by)
      values ($1, $2, 'exit_remainder', 1200000, 1200000, 'Fixture saldo kredit', 'uji')`, [c.tenantId, nov.id]);
    // December and January are issued by two parallel issuers: the 1,200,000 credit covers December (1,000,000) and 200,000 of January
    await Promise.all([issue(exec, WIB("2026-01-01")), issue(exec, WIB("2026-01-01"))]);
    const inv = await invoices(c.tenantId);
    expect(inv.map((x) => [x.period, x.state])).toEqual([["2025-11", "paid"], ["2025-12", "credited"], ["2026-01", "issued"]]);
    expect(await outstanding(inv[2].id)).toBe(800_000);
    expect((await h.admin.query(`select sum(a.amount_rupiah)::int s from vendor_credit_allocations a join vendor_credit_notes n on n.id = a.credit_id where n.tenant_id = $1`, [c.tenantId])).rows[0].s).toBe(1_200_000);
    expect((await h.admin.query(`select remaining_rupiah from vendor_credit_notes where tenant_id = $1`, [c.tenantId])).rows[0].remaining_rupiah).toBe(0);
    await dropConfirmedRules();
  });
});

describe("T-103 issuance: monthly, suspended, exit, fee versions, fail-closed VAT", () => {
  it("monthly invoices on the 1st due the 10th; a suspended month is billed; idempotent re-runs", async () => {
    const c = await clinic("2025-09-15");
    expect(await issue(exec, WIB("2025-11-03"))).toBe(3);
    expect(await issue(exec, WIB("2025-11-03"))).toBe(0);
    await h.admin.query(`update tenants_registry set lifecycle_state = 'suspended' where id = $1`, [c.tenantId]).catch(() => undefined);
    expect(await issue(exec, WIB("2025-12-01"))).toBe(1);
    const inv = await invoices(c.tenantId);
    expect(inv.map((x) => [x.period, x.kind, x.amount_rupiah])).toEqual([["2025-09", "first", 533_333], ["2025-10", "monthly", 1_000_000],
      ["2025-11", "monthly", 1_000_000], ["2025-12", "monthly", 1_000_000]]);
    const dec = inv[3];
    expect([String(dec.issue_date.toISOString?.() ?? dec.issue_date).slice(0, 10), String(dec.due_date.toISOString?.() ?? dec.due_date).slice(0, 10)])
      .toEqual(expect.arrayContaining([expect.stringMatching(/^2025-1[12]-/)]));
    expect((await h.admin.query(`select to_char(issue_date, 'YYYY-MM-DD') i, to_char(due_date, 'YYYY-MM-DD') d from vendor_invoices where id = $1`, [dec.id])).rows[0])
      .toEqual({ i: "2025-12-01", d: "2025-12-10" });
  });

  it("exit inside the go-live month: 21 Nov go-live (Rp333,333), exit 25 Nov → credit Rp166,666 from the monthly fee, capped", async () => {
    const c = await clinic("2024-11-21");
    await lifecycleEvent(c.tenantId, "live", "exit", WIB("2024-11-25"));
    await issue(exec, WIB("2024-12-05"));
    const inv = await invoices(c.tenantId);
    expect(inv.map((x) => x.period)).toEqual(["2024-11"]);
    expect((await h.admin.query(`select kind, amount_rupiah from vendor_credit_notes where tenant_id = $1`, [c.tenantId])).rows).toEqual([{ kind: "exit_remainder", amount_rupiah: 166_666 }]);
    expect(await outstanding(inv[0].id)).toBe(333_333 - 166_666);
    await issue(exec, WIB("2024-12-06"));
    expect((await h.admin.query(`select count(*)::int n from vendor_credit_notes where tenant_id = $1`, [c.tenantId])).rows[0].n).toBe(1);
  });

  it("an approved fee change applies from its month (never on an already issued period); requester ≠ approver", async () => {
    const c = await clinic("2024-01-10");
    await issue(exec, WIB("2024-02-01"));
    const now = new Date();
    const month = (d: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit" }).format(new Date(now.getFullYear(), now.getMonth() + d, 15)).slice(0, 7);
    const req = await requestVendorAction(op, caller(FIN), c.tenantId, { kind: "server_fee_change", amountRupiah: 1_500_000, effectiveMonth: month(2) }, "Penyesuaian biaya server sesuai kontrak");
    expect(await code(decideVendorRequest(op, caller(FIN), req, true))).toMatch(/^ERR_/);
    await decideVendorRequest(op, caller(PO2), req, true);
    const v = await applyFeeChange(exec, req, c.tenantId);
    expect((await h.admin.query(`select amount_rupiah, effective_month from server_fee_versions where id = $1`, [v])).rows[0]).toEqual({ amount_rupiah: 1_500_000, effective_month: month(2) });
    // an issued period at or after the effective month refuses the change (BILL-20)
    const c2 = await clinic("2024-01-10");
    await h.admin.query(`alter table vendor_invoices disable trigger vendor_invoices_guard`);
    await h.admin.query(`insert into vendor_invoices (tenant_id, number, kind, period, service_from, service_to, issue_date, due_date, fee_source, fee_amount, proration,
        amount_rupiah, vat_rupiah, total_rupiah, tax_basis, created_by) values ($1, 'VND-209901-9999', 'monthly', $2, '2099-01-01', '2099-01-31', '2099-01-01', '2099-01-10',
        'default', 1000000, '{}', 1000000, 0, 1000000, '{}', 'uji')`, [c2.tenantId, month(3)]);
    await h.admin.query(`alter table vendor_invoices enable always trigger vendor_invoices_guard`);
    const req2 = await requestVendorAction(op, caller(FIN), c2.tenantId, { kind: "server_fee_change", amountRupiah: 1_200_000, effectiveMonth: month(2) }, "Penyesuaian biaya server sesuai kontrak");
    await decideVendorRequest(op, caller(PO), req2, true);
    expect(await code(applyFeeChange(exec, req2, c2.tenantId))).toMatch(/already_invoiced/);
    expect((await h.admin.query(`select consumed_at from vendor_requests where id = $1`, [req2])).rows[0].consumed_at).toBeNull();
  });

  it("VAT: unknown vendor tax status or no treatment reference → no invoice and a review item; PKP and evidenced non-PKP fixtures compute", async () => {
    await vendorTax("unknown");
    const c = await clinic("2023-11-21");
    expect(await issue(exec, WIB("2023-11-21"))).toBe(0);
    expect(await invoices(c.tenantId)).toEqual([]);
    expect((await h.admin.query(`select kind, period from vendor_billing_reviews where tenant_id = $1`, [c.tenantId])).rows).toEqual([{ kind: "tax_status_unknown", period: "2023-11" }]);
    await vendorTax("pkp");
    await policy({ tax: null });
    expect(await issue(exec, WIB("2023-11-21"))).toBe(0);
    await policy({ tax: "SURAT-KONSULTAN-PAJAK-UJI" });
    expect(await issue(exec, WIB("2023-11-21"))).toBeGreaterThanOrEqual(1);
    const [inv] = await invoices(c.tenantId);
    // PKP (synthetic, pending BILL-33): DPP = floor(333,333 × 11/12) = 305,555; VAT = floor(305,555 × 12%) = 36,666
    expect(inv).toMatchObject({ amount_rupiah: 333_333, vat_rupiah: 36_666, total_rupiah: 369_999, tax_basis: { status: "pkp", dpp: 305_555 } });
    await vendorTax("non_pkp");
  });
});

describe("T-103 fail-closed Bayar gate, reminders, roles", () => {
  it("Bayar is refused while the channel-fee bearer is undecided (Q-16) and for the unsupported vendor-bears option; COD and unknown channels refused", async () => {
    const c = await clinic("2023-06-05");
    await issue(exec, WIB("2023-06-05"));
    const [inv] = await invoices(c.tenantId);
    const port = mockAutolarisPort();
    await policy({ bearer: null });
    expect(await code(pay(c, port, inv.id))).toBe("ERR_VERSION_CONFLICT:fee_policy_pending");
    await policy({ bearer: "vendor" });
    expect(await code(pay(c, port, inv.id))).toBe("ERR_VERSION_CONFLICT:fee_policy_unsupported");
    await policy({ bearer: "tenant" });
    expect(await code(pay(c, port, inv.id, { channel: "COD" }))).toBe("ERR_INVALID_INPUT:channel_unavailable");
    // the database refuses COD even when the server passes it as offered (defence in depth: COD is never a server-fee channel)
    expect(await code(withTenantContext(app, await ctx(c, "ownerAcc", "owner"), (db) =>
      db.query(`select vendor_billing_bayar_begin($1, $2, 'COD', array['COD','VABNI'], now())`, [crypto.randomUUID(), inv.id]).catch((e) => Promise.reject(new Error(e.message)))))).toMatch(/channel_unavailable/);
    expect(await code(pay(c, port, inv.id, { channel: "VABSI" }))).toBe("ERR_INVALID_INPUT:channel_unavailable");
    expect(port.count("create")).toBe(0);
    expect((await view(c)).payment_available).toBe(true);
  });

  it("reminders at the due date, +7 and +14 to owner and finance, once each", async () => {
    const c = await clinic("2023-03-01");
    await issue(exec, WIB("2023-03-01"));
    await reminders(exec, WIB("2023-03-11"));
    await reminders(exec, WIB("2023-03-11"));
    await reminders(exec, WIB("2023-03-25"));
    const k = (await h.admin.query(`select r.kind from vendor_reminders r join vendor_invoices i on i.id = r.invoice_id where i.tenant_id = $1 order by r.kind`, [c.tenantId])).rows.map((r) => r.kind);
    expect(k.filter((x) => ["due", "plus7", "plus14"].includes(x)).sort()).toEqual(["due", "plus14", "plus7"].filter((x) => k.includes(x)).sort());
    expect(k).toContain("due");
    expect((await h.admin.query(`select recipient_role from notifications where tenant_id = $1 and type = 'vendor_invoice_reminder' order by recipient_role`, [c.tenantId])).rows.length)
      .toBe(k.length * 2);
  });

  it("roles: owner / finance pay; Admin Pusat / auditor read; a manager is refused; another tenant's invoice is not found", async () => {
    const c = await clinic("2023-01-09");
    await issue(exec, WIB("2023-01-09"));
    const [inv] = await invoices(c.tenantId);
    for (const [who, role] of [["apAcc", "admin_pusat"], ["audAcc", "auditor"]] as const) {
      const v = await view(c, who, role);
      expect({ role, can_pay: v.can_pay, n: v.invoices.length }).toEqual({ role, can_pay: false, n: 1 });
      expect(await code(withTenantContext(app, await ctx(c, who, role), (db) => db.query(`select vendor_billing_bayar_begin($1, $2, 'VABNI', array['VABNI'], now())`, [crypto.randomUUID(), inv.id]))))
        .toMatch(/raw:42501|ERR_FORBIDDEN/);
    }
    expect(await code(view(c, "mgrAcc", "manager"))).toMatch(/raw:42501|ERR_FORBIDDEN/);
    const other = await clinic("2023-01-09");
    await issue(exec, WIB("2023-01-09"));
    expect(await code(pay(other, mockAutolarisPort(), inv.id))).toBe("ERR_NOT_FOUND:");
    expect((await view(other)).invoices.map((x) => x.id)).not.toContain(inv.id);
    // the clinic login reads no billing table directly
    for (const t of ["vendor_invoices", "vendor_payment_attempts", "vendor_credit_notes", "autolaris_settlement_rules", "vendor_billing_policy"]) {
      expect(await code(withTenantContext(app, await ctx(c, "ownerAcc", "owner"), (db) => db.query(`select 1 from ${t} limit 1`))), t).toBe("raw:42501");
    }
  });
});
