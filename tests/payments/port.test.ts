// T-073 Done-when: scenario PR-68 (duplicate webhook → one simulated payment and allocation, receipt SIMULASI, the
// line still unpaid for treatment start and visit close; the mock hidden in production), money scenario 18 (lost
// response → Cek Status settles once → two webhooks are no-ops) and the TD-43 contract suite against the mock adapter:
// duplicate webhook, paid after expiry, amount mismatch, bad signature, lost webhook, out of order (paid after
// failed/cancelled), refund idempotent incl. partial, outside the timestamp window, tenant mismatch, paid after cash.
// Plus roles, tenants, guards and the audit trail. Synthetic data (MIG-2); no network.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { setKekRingForTests } from "../../src/lib/keys/runtime";
import { publish } from "../../src/modules/catalog/catalog";
import { issueKasirInvoice, kasirInvoice, openKasirInvoice, receivePayment, requestVoid } from "../../src/modules/cashier/kasir/kasir";
import { decideApproval } from "../../src/modules/approvals/approvals";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { decideEvidence, uploadEvidence } from "../../src/modules/compliance/compliance";
import { setTaxProfile } from "../../src/modules/tax/tax";
import { mockSecret, sign, SIGNATURE_HEADER } from "../../src/modules/payments/mock";
import {
  cancelCharge, createCharge, enableMockPort, PortError, pollCharge, receiveMockWebhook, refundCharge, simulate, simulasiList, type SignedWebhook,
} from "../../src/modules/payments/payments";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local";

let h: Harness;
let app: pg.Pool;
let worker: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "auditor", "purchasing", "marketing", "central_cs"];

async function tenant(): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Port Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone, address) values ($1, $2, $2, 'Asia/Jakarta', 'Jl. Uji') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("PT1"), b2: await br("PT2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`prt${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Port ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const why = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof PortError ? `${e.code}:${e.reason}` : e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason ?? ""}` : `raw:${e.code ?? e.message}`));
const key = () => crypto.randomUUID();
const raw = (sql: string, args: unknown[]) => h.admin.query(sql, args).then(() => "ok", (e) => `raw:${e.code}`);
const deliver = (w: SignedWebhook, env: "local" | "production" = "local") => receiveMockWebhook(worker, w.rawBody, w.headers[SIGNATURE_HEADER], env);

let A: T; let B: T;
let OWN: P; let MGR: P; let FO: P; let FO2: P; let FIN: P; let AU: P; let PH: P; let BFO: P; let BMGR: P;
let facial: string; let serum: string;

// A tagihan for a visit (so the treatment-start and visit-close blockers can be read) with two lines.
// Always a visit tagihan (a counter sale needs stock items; the port does not care which).
async function invoiceFor(t: T, fo: P, lines: { itemId: string; quantity: number }[], _counter = false) {
  const withVisit = true;
  void _counter;
  let visitId: string | undefined;
  let patientId: string | undefined;
  if (withVisit) {
    const id = crypto.randomUUID().replace(/-/g, "");
    patientId = (await h.admin.query(
      `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                             marital_status, registered_branch_id, created_by, created_as)
       values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Pasien Port', '1990-01-01', 'female', 'nik', $3, $4, 'islam', 'Karyawan', 's1', 'kawin', $2,
               $5, 'fo_cashier') returning id`, [t.tenantId, t.b1, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43), fo.staffId])).rows[0].id as string;
    visitId = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
      [t.tenantId, t.b1, patientId, fo.staffId])).rows[0].id as string;
  }
  const { invoiceId } = await as(fo, (db) => openKasirInvoice(db, key(), withVisit ? { patientId, visitId } : { counter: true }));
  await as(fo, (db) => issueKasirInvoice(db, key(), invoiceId, lines));
  return { invoiceId, visitId };
}
const charge = async (fo: P, invoiceId: string, channel: "qris" | "va" | "payment_link" = "qris") => as(fo, (db) => createCharge(db, key(), invoiceId, { channel }));
const sim = (p: P, chargeId: string, action: "paid" | "expired" | "failed" | "resend") => as(p, (db) => simulate(db, chargeId, action, p.tenantId));
const counts = async (invoiceId: string) => (await h.admin.query(
  `select (select count(*)::int from payments where invoice_id = $1) p, (select count(*)::int from payment_allocations a join payments y on y.id = a.payment_id where y.invoice_id = $1) a,
          (select count(*)::int from receipts where invoice_id = $1) r`, [invoiceId])).rows[0];

beforeAll(async () => {
  setKekRingForTests({ current: 1, keys: new Map([[1, Buffer.alloc(32, 7)], [2, Buffer.alloc(32, 9)]]) });
  h = await createHarness();
  const login = h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE]));
  app = await openAppPool({ connectionString: login, max: 6 });
  worker = await openAppPool({ connectionString: login, max: 3 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); FIN = await person(A, "finance"); AU = await person(A, "auditor");
  MGR = await person(A, "manager", A.b1); FO = await person(A, "fo_cashier", A.b1); FO2 = await person(A, "fo_cashier", A.b2); PH = await person(A, "pharmacist", A.b1);
  BFO = await person(B, "fo_cashier", B.b1); BMGR = await person(B, "manager", B.b1);
  const item = async (o: P, c: string, price: number) =>
    (await as(o, (db) => publish(db, { kind: "product", code: c }, { name: `Produk ${c}`, tax_category: "taxable_goods", tax_basis: "Barang", normal_price: price } as never, "Baru"))).itemId;
  facial = await item(OWN, "PT-FAC", 900_000);
  serum = await item(OWN, "PT-SRM", 600_000);
  await as(MGR, (db) => enableMockPort(db));
  await as(BMGR, (db) => enableMockPort(db));
}, 300_000);
afterAll(async () => {
  setKekRingForTests(undefined);
  await app?.end();
  await worker?.end();
  await owner?.end();
  await h?.close();
});

describe("scenario PR-68 and money scenario 18", () => {
  it("duplicate webhook: one simulated payment and allocation, receipt SIMULASI, the line still unpaid (treatment start and visit close blocked)", async () => {
    const { invoiceId, visitId } = await invoiceFor(A, FO, [{ itemId: facial, quantity: 1 }, { itemId: serum, quantity: 1 }]);
    const c = await charge(FO, invoiceId);
    expect([c.amount, c.is_simulated, c.state, c.reused]).toEqual([1_500_000, true, "pending", false]);
    const w = await sim(FO, c.charge_id, "paid");
    expect(await deliver(w)).toEqual({ status: 200, outcome: "applied" });
    expect(await deliver(w)).toEqual({ status: 200, outcome: "duplicate" });
    const resend = await sim(FO, c.charge_id, "resend");
    expect(await deliver(resend)).toEqual({ status: 200, outcome: "duplicate" });
    expect(await counts(invoiceId)).toEqual({ p: 1, a: 2, r: 1 });
    const pay = (await h.admin.query(`select method, is_simulated, provider, environment, charge_id, webhook_event_id is not null ev from payments where invoice_id = $1`, [invoiceId])).rows[0];
    expect(pay).toEqual({ method: "qris", is_simulated: true, provider: "mock", environment: "local", charge_id: c.charge_id, ev: true });
    const inv = await as(FO, (db) => kasirInvoice(db, invoiceId));
    expect(inv.outstanding).toBe(1_500_000); // simulated money never counts as paid (BILL-29)
    expect(inv.receipts.map((r) => r.is_simulated)).toEqual([true]);
    const body = (await h.admin.query(`select body from receipts where invoice_id = $1`, [invoiceId])).rows[0].body as string;
    expect(body.startsWith("SIMULASI\n")).toBe(true);
    expect(body).toMatch(/QRIS Rp1\.500\.000/);
    expect((await h.admin.query(`select payment from visits where id = $1`, [visitId])).rows[0].payment).toBe("in_progress"); // treatment start blocked
    expect(await raw(`update visits set closed_at = now(), closed_by = $2 where id = $1`, [visitId, FO.staffId])).toBe("raw:42501"); // visit close blocked
    // A simulated payment never touches the VAT recognition (BILL-29, r1 P1-4).
    expect((await h.admin.query(`select sum(vat_recognised_amount)::int v from invoice_lines where invoice_id = $1`, [invoiceId])).rows[0].v).toBe(0);
    const ch = (await h.admin.query(`select state, review_flag, balance_pending::int b from payment_charges where id = $1`, [c.charge_id])).rows[0];
    expect(ch).toEqual({ state: "paid", review_flag: null, b: 0 });
    // The payment's own events are attributed to the charge's creator too (no staff context on the webhook, r2 F-3).
    expect((await h.admin.query(`select distinct e.staff_id from domain_events e join payments y on y.id = e.aggregate_id where y.charge_id = $1`, [c.charge_id])).rows)
      .toEqual([{ staff_id: FO.staffId }]);
    // Ids-only events; the audit trail by the payment service.
    const ev = (await h.admin.query(`select type, staff_id from domain_events where aggregate_id = $1 order by occurred_at`, [c.charge_id])).rows;
    expect(ev.map((x) => x.type)).toEqual(["PaymentChargeCreated", "PaymentChargeSettled"]);
    expect(ev[1].staff_id).toBe(FO.staffId); // attributed to the charge's creator (DATA-60)
    const au = (await h.admin.query(`select service_identity, reason_code from audit_events where tenant_id = $1 and object_id = $2 and service_identity is not null`, [A.tenantId, c.charge_id])).rows;
    expect(au).toContainEqual({ service_identity: "payment_webhook", reason_code: "payment_webhook_applied" });
  });

  it("money scenario 18: the response lost, Cek Status settles once, then two webhooks are no-ops; a retry never creates a second charge", async () => {
    const { invoiceId } = await invoiceFor(A, FO, [{ itemId: facial, quantity: 1 }, { itemId: serum, quantity: 1 }]);
    const k = key();
    const c = await as(FO, (db) => createCharge(db, k, invoiceId, { channel: "qris" }));
    // The gateway marks it paid; the webhook is lost (not delivered yet).
    const w = await sim(FO, c.charge_id, "paid");
    // The cashier retries: the same key, or a new attempt, returns the pending charge.
    expect((await as(FO, (db) => createCharge(db, k, invoiceId, { channel: "qris" }))).charge_id).toBe(c.charge_id);
    const again = await as(FO, (db) => createCharge(db, key(), invoiceId, { channel: "qris" }));
    expect([again.charge_id, again.reused]).toEqual([c.charge_id, true]);
    expect((await as(FO, (db) => pollCharge(db, c.charge_id))).outcome).toBe("applied");
    expect((await as(FO, (db) => pollCharge(db, c.charge_id))).outcome).toBe("duplicate");
    expect(await deliver(w)).toEqual({ status: 200, outcome: "duplicate" });
    expect(await deliver(w)).toEqual({ status: 200, outcome: "duplicate" });
    expect(await counts(invoiceId)).toEqual({ p: 1, a: 2, r: 1 });
    expect((await h.admin.query(`select count(*)::int c from payment_charges where invoice_id = $1`, [invoiceId])).rows[0].c).toBe(1);
    // A charge after the paid one (the line still owes real money): a new charge is allowed. Its lines have no room
    // left for simulated money (the first simulated payment took it, r2 F-2): paid, it waits for the balance, flagged.
    const c2 = await charge(FO, invoiceId);
    expect(c2.reused).toBe(false);
    expect(await deliver(await sim(FO, c2.charge_id, "paid"))).toEqual({ status: 200, outcome: "flagged" });
    expect((await h.admin.query(`select review_flag, balance_pending::int b from payment_charges where id = $1`, [c2.charge_id])).rows[0]).toEqual({ review_flag: "paid_after_cash", b: 1_500_000 });
    expect(await counts(invoiceId)).toEqual({ p: 2, a: 2, r: 2 });
    // A paid charge cannot be cancelled.
    expect(await why(as(FO, (db) => cancelCharge(db, c.charge_id)))).toBe("ERR_VERSION_CONFLICT:charge paid");
  });

  it("mock hidden in production: QRIS, VA and link not offered; no charge; the webhook 404; the simulator refused", async () => {
    const { invoiceId } = await invoiceFor(A, FO, [{ itemId: serum, quantity: 1 }], false);
    const c = await charge(FO, invoiceId);
    const w = await sim(FO, c.charge_id, "paid");
    process.env.DEPLOY_ENV = "production";
    try {
      const inv = await as(FO, (db) => kasirInvoice(db, invoiceId));
      expect(inv.tenders.map((t) => t.method)).toEqual(["cash", "edc", "transfer", "balance"]);
      expect(inv.port).toBeNull();
      // The writer refuses in production twice over: the go-live gate (TypeScript) and the database's own check.
      expect(await why(as(FO, (db) => createCharge(db, key(), invoiceId, { channel: "qris" })))).toMatch(/production go-live blocked|ERR_NOT_AVAILABLE:payment_port/);
      expect(await as(FO, async (db) => {
        await db.query(`select set_config('app.deploy_env', 'production', true)`);
        return db.query(`select payment_charge_create($1, $2, '{"channel":"qris"}'::jsonb)`, [key(), invoiceId]).then(() => "ok", (e) => e.message);
      })).toBe("ERR_NOT_AVAILABLE: payment_port");
      expect(await why(as(FO, (db) => simulate(db, c.charge_id, "paid", A.tenantId)))).toBe("ERR_NOT_AVAILABLE:mock_in_production");
      expect(await why(as(MGR, (db) => enableMockPort(db)))).toBe("ERR_NOT_AVAILABLE:mock_in_production");
      // A missing or unknown deployment value reads as production (fail closed): the charge writer refuses.
      for (const v of ["", "prod", "Local"])
        expect(await as(FO, async (db) => {
          await db.query(`select set_config('app.deploy_env', $1, true)`, [v]);
          return db.query(`select payment_charge_create($1, $2, '{"channel":"qris"}'::jsonb)`, [key(), invoiceId]).then(() => "ok", (e) => e.message);
        }), v).toBe("ERR_NOT_AVAILABLE: payment_port");
      expect(await deliver(w, "production")).toEqual({ status: 404, outcome: "port_unusable" });
    } finally {
      process.env.DEPLOY_ENV = "local";
    }
    // Before provisioning, a tenant keeps T-072's tenders (QRIS and link blocked, no VA).
    const C = await tenant();
    const cfo = await person(C, "fo_cashier", C.b1);
    const cown = await person(C, "owner");
    const it = (await as(cown, (db) => publish(db, { kind: "product", code: "PC-1" }, { name: "Produk C", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1_000 } as never, "Baru"))).itemId;
    const { invoiceId: ci } = await invoiceFor(C, cfo, [{ itemId: it, quantity: 1 }], false);
    expect((await as(cfo, (db) => kasirInvoice(db, ci))).tenders.map((t) => [t.method, t.available, t.blocked])).toEqual([
      ["cash", true, null], ["qris", false, "payment_port"], ["edc", true, null], ["transfer", true, null], ["payment_link", false, "payment_port"], ["balance", false, "balance"]]);
    // Provisioned: QRIS, VA and link available.
    expect((await as(FO, (db) => kasirInvoice(db, invoiceId))).tenders.filter((t) => t.available).map((t) => t.method)).toEqual(["cash", "qris", "edc", "transfer", "va", "payment_link"]);
  });
});

describe("BILL-29 on a PKP tenant, closing states, duplicates, lock order", () => {
  it("a simulated payment never recognises VAT on a PKP line; a real one then recognises it in full", async () => {
    const C = await tenant();
    const cown = await person(C, "owner");
    const cfin = await person(C, "finance");
    const cmgr = await person(C, "manager", C.b1);
    const cfo = await person(C, "fo_cashier", C.b1);
    const pdf = Buffer.from(`%PDF-1.7\nsaran pajak port\n%%EOF\n`);
    const { fileId } = await as(cfin, (db) => uploadEvidence(db, { obligationKey: "tax_advice", fileName: "saran.pdf", content: pdf, expertName: "Konsultan Pajak Sintetis", documentDate: "2026-10-01" }));
    const ev = (await h.admin.query(`select item_id from evidence_files where id = $1`, [fileId])).rows[0].item_id;
    await as(cown, (db) => decideEvidence(db, ev, fileId, "approved"));
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await as(cown, (db) => setTaxProfile(db, key(), { isPkp: true, pkpEffectiveFrom: tomorrow, npwp: "012345678901234", reason: "PKP" }));
    // In force from yesterday (the writer refuses a past date; the documented owner-connection stand-in, as T-072).
    await h.admin.query("begin");
    await h.admin.query("alter table tax_profile_changes disable trigger tax_profile_changes_guard");
    await h.admin.query("alter table tenants disable trigger tenants_tax_guard");
    await h.admin.query(`update tax_profile_changes set pkp_effective_from = current_date - 1, changed_at = now() - interval '2 days' where tenant_id = $1`, [C.tenantId]);
    await h.admin.query(`update tenants set pkp_effective_from = current_date - 1 where id = $1`, [C.tenantId]);
    await h.admin.query("alter table tax_profile_changes enable always trigger tax_profile_changes_guard");
    await h.admin.query("alter table tenants enable always trigger tenants_tax_guard");
    await h.admin.query("commit");
    const it = (await as(cown, (db) => publish(db, { kind: "product", code: "PK-1" }, { name: "Produk PKP", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 333_000 } as never, "Baru"))).itemId;
    await as(cmgr, (db) => enableMockPort(db));
    const { invoiceId } = await invoiceFor(C, cfo, [{ itemId: it, quantity: 1 }]);
    const c = await charge(cfo, invoiceId);
    expect(await deliver(await sim(cfo, c.charge_id, "paid"))).toEqual({ status: 200, outcome: "applied" });
    const vat = async () => (await h.admin.query(`select vat_amount::int v, vat_recognised_amount::int r from invoice_lines where invoice_id = $1`, [invoiceId])).rows[0];
    expect(await vat()).toEqual({ v: 33_000, r: 0 });
    expect((await h.admin.query(`select sum(a.vat_portion)::int s from payment_allocations a join payments y on y.id = a.payment_id where y.charge_id = $1`, [c.charge_id])).rows[0].s).toBe(0);
    await as(cfo, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 333_000, cashTendered: 333_000 }]));
    expect(await vat()).toEqual({ v: 33_000, r: 33_000 });
  });

  it("a closing state never reopens a paid charge; repeating a closing webhook is a duplicate; the ingest takes the charge's locks in order", async () => {
    const { invoiceId } = await invoiceFor(A, FO, [{ itemId: serum, quantity: 1 }]);
    const c = await charge(FO, invoiceId);
    await deliver(await sim(FO, c.charge_id, "paid"));
    // The gateway later says failed (out of order): the paid charge stays paid.
    const w = JSON.parse((await sim(FO, c.charge_id, "resend")).rawBody);
    const late = JSON.stringify({ ...w, state: "failed", event_id: `${w.event_id}_late` });
    const secret = mockSecret(A.tenantId, w.provider_account, 1)!;
    expect(await receiveMockWebhook(worker, late, sign(secret, late), "local")).toEqual({ status: 200, outcome: "duplicate" });
    expect((await h.admin.query(`select state from payment_charges where id = $1`, [c.charge_id])).rows[0].state).toBe("paid");
    // A second "expired" for an expired charge is a duplicate (the first applied).
    const { invoiceId: i2 } = await invoiceFor(A, FO, [{ itemId: serum, quantity: 1 }]);
    const c2 = await charge(FO, i2);
    const e1 = await sim(FO, c2.charge_id, "expired");
    expect(await deliver(e1)).toEqual({ status: 200, outcome: "applied" });
    const e1b = JSON.parse(e1.rawBody);
    const again = JSON.stringify({ ...e1b, event_id: `${e1b.event_id}_2` });
    expect(await receiveMockWebhook(worker, again, sign(secret, again), "local")).toEqual({ status: 200, outcome: "duplicate" });
    // Lock order: a webhook waits for an interactive transaction holding the tagihan's visit (visit → invoice → lines →
    // charge), so it never settles under a cash payment in flight on the same lines.
    const { invoiceId: i3, visitId: v3 } = await invoiceFor(A, FO, [{ itemId: serum, quantity: 1 }]);
    const c3 = await charge(FO, i3);
    const w3 = await sim(FO, c3.charge_id, "paid");
    const holder = await owner.connect();
    try {
      await holder.query("begin");
      const hpid = (await holder.query(`select pg_backend_pid() p`)).rows[0].p as number;
      await holder.query(`select 1 from visits where id = $1 for update`, [v3]);
      const pending = deliver(w3);
      // Wait until the ingest backend is blocked by the holder (observed in pg_locks, never a fixed sleep; review
      // 584e77a6 P3): it took staff_access, then queued on the visit the holder has locked.
      for (let t = 0; ; t++) {
        const blocked = (await h.admin.query(`select count(*)::int n from pg_stat_activity a where $1 = any(pg_blocking_pids(a.pid))`, [hpid])).rows[0].n;
        if (blocked > 0) break;
        if (t > 300) throw new Error("the webhook never waited on the visit lock");
        await new Promise((r) => setTimeout(r, 20));
      }
      expect((await h.admin.query(`select state from payment_charges where id = $1`, [c3.charge_id])).rows[0].state).toBe("pending"); // still waiting
      await holder.query("commit");
      expect(await pending).toEqual({ status: 200, outcome: "applied" });
    } finally {
      holder.release();
    }
  });
});

describe("TD-43 contract suite (the mock adapter)", () => {
  it("paid after expiry: recorded, flagged, nothing on the lines (the balance waits for T-075)", async () => {
    const { invoiceId } = await invoiceFor(A, FO, [{ itemId: serum, quantity: 1 }], false);
    const c = await charge(FO, invoiceId);
    expect(await deliver(await sim(FO, c.charge_id, "expired"))).toEqual({ status: 200, outcome: "applied" });
    expect((await h.admin.query(`select state from payment_charges where id = $1`, [c.charge_id])).rows[0].state).toBe("expired");
    expect(await deliver(await sim(FO, c.charge_id, "paid"))).toEqual({ status: 200, outcome: "flagged" });
    expect((await h.admin.query(`select state, review_flag, balance_pending::int b from payment_charges where id = $1`, [c.charge_id])).rows[0])
      .toEqual({ state: "paid", review_flag: "paid_after_expiry", b: 600_000 });
    expect(await counts(invoiceId)).toEqual({ p: 1, a: 0, r: 1 });
  });

  it("amount mismatch: not recorded, flagged in the event, audited", async () => {
    const { invoiceId } = await invoiceFor(A, FO, [{ itemId: serum, quantity: 1 }], false);
    const c = await charge(FO, invoiceId);
    const w = await sim(FO, c.charge_id, "paid");
    const body = JSON.parse(w.rawBody);
    body.amount = 599_999;
    body.event_id = `${body.event_id}x`;
    const secret = mockSecret(A.tenantId, body.provider_account, 1)!;
    const forged = JSON.stringify(body);
    expect(await receiveMockWebhook(worker, forged, sign(secret, forged), "local")).toEqual({ status: 200, outcome: "rejected_amount" });
    expect(await counts(invoiceId)).toEqual({ p: 0, a: 0, r: 0 });
    expect((await h.admin.query(`select state from payment_charges where id = $1`, [c.charge_id])).rows[0].state).toBe("pending");
    // The same mismatched event again is a duplicate (one verified row per event id).
    expect(await receiveMockWebhook(worker, forged, sign(secret, forged), "local")).toEqual({ status: 200, outcome: "duplicate" });
    // An explicit charge amount above what the tagihan owes is refused.
    await as(FO, (db) => cancelCharge(db, c.charge_id));
    expect(await why(as(FO, (db) => createCharge(db, key(), invoiceId, { channel: "qris", amount: 600_001 })))).toBe("ERR_INVALID_INPUT:overpayment");
    expect((await h.admin.query(`select count(*)::int c from audit_events where object_id = $1 and reason_code = 'payment_webhook_rejected_amount'`, [c.charge_id])).rows[0].c).toBe(1);
  });

  it("bad signature → 401, audited, never claims the event id; outside the window → 401", async () => {
    const { invoiceId } = await invoiceFor(A, FO, [{ itemId: serum, quantity: 1 }], false);
    const c = await charge(FO, invoiceId);
    const w = await sim(FO, c.charge_id, "paid");
    const bad = w.headers[SIGNATURE_HEADER].replace(/v1=[0-9a-f]/, (m) => (m.endsWith("0") ? "v1=1" : "v1=0"));
    expect(await receiveMockWebhook(worker, w.rawBody, bad, "local")).toEqual({ status: 401, outcome: "rejected_signature" });
    expect(await receiveMockWebhook(worker, w.rawBody, "t=1,v1=zz", "local")).toEqual({ status: 401, outcome: "rejected_signature" });
    expect(await receiveMockWebhook(worker, w.rawBody, null, "local")).toEqual({ status: 401, outcome: "rejected_signature" });
    const secret = mockSecret(A.tenantId, JSON.parse(w.rawBody).provider_account, 1)!;
    expect(await receiveMockWebhook(worker, w.rawBody, sign(secret, w.rawBody, Math.floor(Date.now() / 1000) - 301), "local")).toEqual({ status: 401, outcome: "rejected_window" });
    // The real event still applies (the forged ones did not claim its id).
    expect(await deliver(w)).toEqual({ status: 200, outcome: "applied" });
    const ev = (await h.admin.query(`select outcome from payment_webhook_events where charge_id = $1 order by received_at`, [c.charge_id])).rows.map((x) => x.outcome);
    expect(ev).toEqual(["rejected_signature", "rejected_signature", "rejected_signature", "rejected_window", "applied"]);
    expect((await h.admin.query(`select count(*)::int c from audit_events where tenant_id = $1 and object_kind = 'payment_webhook' and reason_code like 'rejected_%'`, [A.tenantId])).rows[0].c).toBeGreaterThanOrEqual(4);
  });

  it("out of order: paid after failed and after cancelled → recorded and flagged", async () => {
    const { invoiceId } = await invoiceFor(A, FO, [{ itemId: serum, quantity: 1 }], false);
    const c = await charge(FO, invoiceId);
    await deliver(await sim(FO, c.charge_id, "failed"));
    expect(await deliver(await sim(FO, c.charge_id, "paid"))).toEqual({ status: 200, outcome: "flagged" });
    expect((await h.admin.query(`select review_flag from payment_charges where id = $1`, [c.charge_id])).rows[0].review_flag).toBe("paid_after_failed");
    const { invoiceId: i2 } = await invoiceFor(A, FO, [{ itemId: serum, quantity: 1 }], false);
    const c2 = await charge(FO, i2);
    await as(FO, (db) => cancelCharge(db, c2.charge_id));
    expect(await deliver(await sim(FO, c2.charge_id, "paid"))).toEqual({ status: 200, outcome: "flagged" });
    expect((await h.admin.query(`select review_flag from payment_charges where id = $1`, [c2.charge_id])).rows[0].review_flag).toBe("paid_after_failed");
  });

  it("refund idempotent, partial included; Σ never above the charge", async () => {
    const { invoiceId } = await invoiceFor(A, FO, [{ itemId: serum, quantity: 1 }], false);
    const c = await charge(FO, invoiceId);
    await deliver(await sim(FO, c.charge_id, "paid"));
    const k = key();
    const r1 = await as(MGR, (db) => refundCharge(db, k, c.charge_id, 200_000));
    const r2 = await as(MGR, (db) => refundCharge(db, k, c.charge_id, 200_000));
    expect([r2.refund_id, r2.replayed, r2.refunded]).toEqual([r1.refund_id, true, 200_000]);
    expect(await code(as(MGR, (db) => refundCharge(db, k, c.charge_id, 300_000)))).toBe("ERR_IDEMPOTENCY_CONFLICT");
    expect((await as(MGR, (db) => refundCharge(db, key(), c.charge_id, 400_000))).refunded).toBe(600_000);
    expect(await why(as(MGR, (db) => refundCharge(db, key(), c.charge_id, 1)))).toBe("ERR_INVALID_INPUT:refund_amount");
    expect(await code(as(FO, (db) => refundCharge(db, key(), c.charge_id, 1)))).toBe("ERR_FORBIDDEN");
  });

  it("lost webhook: the status query settles once (the poll path)", async () => {
    const { invoiceId } = await invoiceFor(A, FO, [{ itemId: serum, quantity: 1 }], false);
    const c = await charge(FO, invoiceId);
    expect((await as(FO, (db) => pollCharge(db, c.charge_id))).outcome).toBe("duplicate"); // still pending at the gateway
    await sim(FO, c.charge_id, "paid"); // not delivered
    expect((await as(FO, (db) => pollCharge(db, c.charge_id))).outcome).toBe("applied");
    expect(await counts(invoiceId)).toEqual({ p: 1, a: 1, r: 1 });
  });

  it("tenant mismatch: a webhook signed by B's account with A's order prefix is dropped; an unknown prefix is logged on the platform", async () => {
    const { invoiceId } = await invoiceFor(A, FO, [{ itemId: serum, quantity: 1 }], false);
    const c = await charge(FO, invoiceId);
    const w = JSON.parse((await sim(FO, c.charge_id, "paid")).rawBody);
    const bAcc = (await h.admin.query(`select provider_account from payment_port_configs where tenant_id = $1`, [B.tenantId])).rows[0].provider_account;
    const forged = JSON.stringify({ ...w, provider_account: bAcc, event_id: `${w.event_id}b` });
    const bSecret = mockSecret(B.tenantId, bAcc, 1)!;
    expect(await receiveMockWebhook(worker, forged, sign(bSecret, forged), "local")).toEqual({ status: 200, outcome: "dropped_tenant_mismatch" });
    expect(await counts(invoiceId)).toEqual({ p: 0, a: 0, r: 0 });
    expect((await h.admin.query(`select tenant_id from payment_webhook_events where order_ref = $1`, [w.order_ref])).rows.map((x) => x.tenant_id)).toEqual([A.tenantId]);
    const unknown = JSON.stringify({ ...w, order_ref: `ZZZZZZZZ-${"0".repeat(32)}`, event_id: `${w.event_id}u` });
    const before = (await h.admin.query(`select count(*)::int c from vendor_actions where action = 'payment_webhook_drop'`)).rows[0].c;
    expect(await receiveMockWebhook(worker, unknown, sign(bSecret, unknown), "local")).toEqual({ status: 200, outcome: "dropped_unknown_route" });
    expect((await h.admin.query(`select count(*)::int c from vendor_actions where action = 'payment_webhook_drop'`)).rows[0].c).toBe(before + 1);
  });

  it("paid at the gateway after the line was settled in cash → the value waits for the balance, flagged paid_after_cash", async () => {
    const { invoiceId } = await invoiceFor(A, FO, [{ itemId: serum, quantity: 1 }], false);
    const c = await charge(FO, invoiceId);
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 600_000, cashTendered: 600_000 }]));
    expect(await deliver(await sim(FO, c.charge_id, "paid"))).toEqual({ status: 200, outcome: "flagged" });
    expect((await h.admin.query(`select review_flag, balance_pending::int b from payment_charges where id = $1`, [c.charge_id])).rows[0]).toEqual({ review_flag: "paid_after_cash", b: 600_000 });
    expect((await h.admin.query(`select count(*)::int c from payment_allocations a join payments y on y.id = a.payment_id where y.charge_id = $1`, [c.charge_id])).rows[0].c).toBe(0);
  });

  it("paid at the gateway after part was paid in cash: what still fits goes to the lines, the rest waits for the balance", async () => {
    const { invoiceId } = await invoiceFor(A, FO, [{ itemId: facial, quantity: 1 }, { itemId: serum, quantity: 1 }]);
    const c = await charge(FO, invoiceId); // 1,500,000 for real, but simulated money only counts against all allocations
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 500_000, cashTendered: 500_000 }]));
    expect(await deliver(await sim(FO, c.charge_id, "paid"))).toEqual({ status: 200, outcome: "flagged" });
    expect((await h.admin.query(`select review_flag, balance_pending::int b from payment_charges where id = $1`, [c.charge_id])).rows[0]).toEqual({ review_flag: "paid_after_cash", b: 500_000 });
    expect((await h.admin.query(`select sum(a.amount)::int s from payment_allocations a join payments y on y.id = a.payment_id where y.charge_id = $1`, [c.charge_id])).rows[0].s).toBe(1_000_000);
  });

  it("paid on a void invoice: the void cancels the pending charge; a late paid webhook is recorded against the charge, flagged, nothing allocated", async () => {
    const { invoiceId } = await invoiceFor(A, FO, [{ itemId: serum, quantity: 1 }], false);
    const c = await charge(FO, invoiceId);
    const { approvalId } = await as(FO, (db) => requestVoid(db, key(), invoiceId, "Salah item"));
    await as(MGR, (db) => decideApproval(db, approvalId, true));
    expect((await h.admin.query(`select state from payment_charges where id = $1`, [c.charge_id])).rows[0].state).toBe("cancelled");
    expect(await deliver(await sim(FO, c.charge_id, "paid"))).toEqual({ status: 200, outcome: "flagged" });
    expect((await h.admin.query(`select review_flag, balance_pending::int b from payment_charges where id = $1`, [c.charge_id])).rows[0]).toEqual({ review_flag: "paid_after_failed", b: 600_000 });
  });
});

describe("roles, tenants, guards", () => {
  it("roles: charges by the Kasir roles at their branch; others refused; B cannot reach A's charge; the simulator list", async () => {
    const { invoiceId } = await invoiceFor(A, FO, [{ itemId: serum, quantity: 1 }], false);
    for (const p of [PH, AU]) expect(await code(as(p, (db) => createCharge(db, key(), invoiceId, { channel: "qris" }))), p.role).toBe("ERR_FORBIDDEN");
    expect(await code(as(FO2, (db) => createCharge(db, key(), invoiceId, { channel: "qris" })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BFO, (db) => createCharge(db, key(), invoiceId, { channel: "qris" })))).toBe("ERR_NOT_FOUND");
    const c = await as(FIN, (db) => createCharge(db, key(), invoiceId, { channel: "payment_link" }));
    expect(await code(as(BFO, (db) => pollCharge(db, c.charge_id)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BFO, (db) => simulate(db, c.charge_id, "paid", B.tenantId)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(FO2, (db) => cancelCharge(db, c.charge_id)))).toBe("ERR_NOT_FOUND");
    for (const p of [FO, PH, FIN]) expect(await code(as(p, (db) => enableMockPort(db))), p.role).toBe("ERR_FORBIDDEN");
    // Another branch's FO reads neither the mock's status nor the charge in its Simulasi list.
    expect(await code(as(FO2, (db) => db.query(`select payment_mock_status($1)`, [c.charge_id])))).toBe("raw:P0002");
    expect((await as(FO2, (db) => simulasiList(db))).charges.map((x) => x.id)).not.toContain(c.charge_id);
    const list = await as(FO, (db) => simulasiList(db));
    expect(list.charges.map((x) => x.id)).toContain(c.charge_id);
    expect((await as(BFO, (db) => simulasiList(db))).charges.map((x) => x.id)).not.toContain(c.charge_id);
    expect(await code(as(PH, (db) => simulasiList(db)))).toBe("ERR_FORBIDDEN");
    // Direct reads (RLS): A's charge invisible to B and to a branch role elsewhere.
    expect((await as(BFO, (db) => db.query(`select id from payment_charges where id = $1`, [c.charge_id]))).rows).toEqual([]);
    expect((await as(FO2, (db) => db.query(`select id from payment_charges where id = $1`, [c.charge_id]))).rows).toEqual([]);
    expect((await as(FO, (db) => db.query(`select id from payment_charges where id = $1`, [c.charge_id]))).rows).toHaveLength(1);
  });

  it("guards: charges never deleted and their identity frozen; a paid charge final; webhook events recorded once; refunds and lines insert-only; no secret stored", async () => {
    const { invoiceId } = await invoiceFor(A, FO, [{ itemId: serum, quantity: 1 }], false);
    const c = await charge(FO, invoiceId);
    expect(await raw(`update payment_charges set amount = 1 where id = $1`, [c.charge_id])).toBe("raw:42501");
    expect(await raw(`update payment_charges set state = 'paid' where id = $1`, [c.charge_id])).toBe("raw:23514"); // a paid charge has its settle time
    expect(await raw(`delete from payment_charges where id = $1`, [c.charge_id])).toBe("raw:42501");
    expect(await raw(`update payment_charge_lines set amount = 1 where charge_id = $1`, [c.charge_id])).toBe("raw:42501");
    await deliver(await sim(FO, c.charge_id, "paid"));
    expect(await raw(`update payment_charges set state = 'failed' where id = $1`, [c.charge_id])).toBe("raw:42501");
    expect(await raw(`update payment_charges set state = 'pending', receipt_id = null, settled_at = null where id = $1`, [c.charge_id])).toBe("raw:42501");
    expect(await raw(`update payment_webhook_events set outcome = 'duplicate' where charge_id = $1`, [c.charge_id])).toBe("raw:42501");
    expect(await raw(`delete from payment_webhook_events where charge_id = $1`, [c.charge_id])).toBe("raw:42501");
    expect(await raw(`update payment_port_configs set order_prefix = 'ZZZZZZ' where tenant_id = $1`, [A.tenantId])).toBe("raw:42501");
    // Refunds never exceed the charge, even written directly.
    const rf = (await h.admin.query(`select branch_id from payment_charges where id = $1`, [c.charge_id])).rows[0];
    expect(await raw(`insert into payment_refunds (tenant_id, branch_id, charge_id, amount, provider_refund_id, state, command_key, created_by, created_as)
                      values ($1, $2, $3, 600001, 'rf-x', 'succeeded', $4, $5, 'owner')`, [A.tenantId, rf.branch_id, c.charge_id, key(), OWN.staffId])).toBe("raw:42501");
    // A port payment names its charge; a cash payment never does.
    const r = (await h.admin.query(`select receipt_id, branch_id from payments where charge_id = $1`, [c.charge_id])).rows[0];
    expect(await raw(`insert into payments (tenant_id, branch_id, receipt_id, seq, invoice_id, method, amount, environment, is_simulated, received_by, received_as)
                      values ($1, $2, $3, 2, $4, 'qris', 1, 'local', true, $5, 'fo_cashier')`, [A.tenantId, r.branch_id, r.receipt_id, invoiceId, FO.staffId])).toBe("raw:42501");
    const cols = (await h.admin.query(`select column_name from information_schema.columns where table_name = 'payment_port_configs'`)).rows.map((x) => x.column_name);
    expect(cols.filter((x) => /secret|key$|token/.test(x))).toEqual([]);
    const t = (await h.admin.query(`select tgname, tgenabled from pg_trigger where tgname in ('payment_port_configs_guard','payment_charges_guard','payment_refunds_guard',
              'payment_mock_states_guard','payment_webhook_events_guard','payment_charge_lines_insert_only','payment_refunds_insert_only') order by tgname`)).rows;
    expect(t.map((x) => x.tgenabled)).toEqual(["A", "A", "A", "A", "A", "A", "A"]);
    // Generic descriptions only (SEC-15).
    expect((await h.admin.query(`select distinct description from payment_charges where tenant_id = $1`, [A.tenantId])).rows.map((x) => x.description)).toEqual(["Produk"]);
  });

  it("KEK rotation: the secret of an existing port stays the one of its recorded KEK version", async () => {
    const { invoiceId } = await invoiceFor(A, FO, [{ itemId: serum, quantity: 1 }], false);
    const c = await charge(FO, invoiceId);
    const w = await sim(FO, c.charge_id, "paid"); // signed under KEK v1 (the port recorded version 1)
    setKekRingForTests({ current: 2, keys: new Map([[1, Buffer.alloc(32, 7)], [2, Buffer.alloc(32, 9)]]) });
    try {
      expect(await deliver(w)).toEqual({ status: 200, outcome: "applied" }); // still verified with v1
      // Each tenant's secret is its own (another account under the same KEK does not verify).
      const acc = JSON.parse(w.rawBody).provider_account;
      expect(mockSecret(A.tenantId, acc, 1)!.equals(mockSecret(B.tenantId, acc, 1)!)).toBe(false);
    } finally {
      setKekRingForTests({ current: 1, keys: new Map([[1, Buffer.alloc(32, 7)], [2, Buffer.alloc(32, 9)]]) });
    }
  });

  it("the webhook route's limits: too large 413, not JSON 400, a bound connection refused by the ingest definer", async () => {
    expect(await receiveMockWebhook(worker, "x".repeat(16 * 1024 + 1), null, "local")).toEqual({ status: 413, outcome: "too_large" });
    expect(await receiveMockWebhook(worker, "{not json", null, "local")).toEqual({ status: 400, outcome: "bad_json" });
    expect(await receiveMockWebhook(worker, "[]", null, "local")).toEqual({ status: 400, outcome: "bad_json" });
    expect(await receiveMockWebhook(worker, JSON.stringify({ order_ref: "x" }), null, "local")).toEqual({ status: 400, outcome: "bad_payload" });
    expect(await code(as(FO, (db) => db.query(`select payment_webhook_ingest('{}'::jsonb, true, true, $1)`, ["0".repeat(64)])))).toBe("raw:42501");
    expect(await code(as(FO, (db) => db.query(`select payment_webhook_route('X')`)))).toBe("raw:42501");
    // Without the key ring the mock is unusable: enabling refused, the webhook 404.
    setKekRingForTests(null);
    try {
      expect(await code(as(MGR, (db) => enableMockPort(db)))).toBe("raw:the mock payment port needs the server key ring");
    } finally {
      setKekRingForTests({ current: 1, keys: new Map([[1, Buffer.alloc(32, 7)], [2, Buffer.alloc(32, 9)]]) });
    }
  });
});
