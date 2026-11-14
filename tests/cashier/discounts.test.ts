// T-080 Done-when: scenario PR-72 (an over-limit manual discount waits for approval in Persetujuan; the line is not payable
// meanwhile) and the approver capped by the approver's own limit (SET-12: a manager within 10 % and Rp500,000, the lower wins;
// else the owner). Plus the plan review: within-limit discounts at issue, the default FO 0 %, reject and withdraw, payment of the
// other lines, the guards, VAT on the discounted total (PKP), a package opened at the decision, roles, branches, tenants, replay
// and the TS twin of the limit. Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { cancelApproval, decideApproval } from "../../src/modules/approvals/approvals";
import { inboxDetail, listInbox } from "../../src/modules/approvals/inbox";
import { publish } from "../../src/modules/catalog/catalog";
import { issueKasirInvoice, kasirInvoice, KasirError, openKasirInvoice, receivePayment, requestVoid } from "../../src/modules/cashier/kasir/kasir";
import { listManualDiscounts, withinDiscountLimit } from "../../src/modules/cashier/discounts/discounts";
import { mergePatients } from "../../src/modules/patients/merge/merge";
import { setPackageContents } from "../../src/modules/packages/packages";
import { decideEvidence, uploadEvidence } from "../../src/modules/compliance/compliance";
import { saveItem } from "../../src/modules/inventory/stock";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { changeSetting } from "../../src/modules/settings/settings";
import { setTaxProfile } from "../../src/modules/tax/tax";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "auditor", "purchasing", "marketing", "central_cs"];

async function tenant(): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Diskon Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string, tz: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone, address) values ($1, $2, $2, $3, 'Jl. Uji 1') returning id`, [tenantId, c, tz])).rows[0].id as string;
  return { tenantId, b1: await br("DS1", "Asia/Jakarta"), b2: await br("DS2", "Asia/Makassar") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`dsk${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Diskon ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const why = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof KasirError ? `${e.code}:${e.reason}` : e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const key = () => crypto.randomUUID();
const raw = (sql: string, args: unknown[]) => h.admin.query(sql, args).then(() => "ok", (e) => `raw:${e.code}`);
const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
const NPWP = "012345678901234";
async function patient(t: T, branch: string, name = "Pasien Kasir"): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "");
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $5, '1990-01-01', 'female', 'nik', $3, $4, 'islam', 'Karyawan', 's1', 'kawin', $2,
             (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id`,
    [t.tenantId, branch, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43), name])).rows[0].id as string;
}
async function visit(t: T, branch: string, by: P, pid?: string): Promise<{ visitId: string; patientId: string }> {
  const patientId = pid ?? (await patient(t, branch));
  const visitId = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
    [t.tenantId, branch, patientId, by.staffId])).rows[0].id as string;
  return { visitId, patientId };
}

let A: T; let B: T;
let OWN: P; let FIN: P; let MGR: P; let MGR2: P; let FO: P; let AU: P; let PH: P; let BOWN: P;
let serum: string; let big: string; let pkg: string;
let FH: P; let RO: P;
const setLimits = (fo: number) => as(OWN, (db) => changeSetting(db, { key: "SET-12", branchId: null, value: { fo_persen: fo, manajer_persen: 10, manajer_rupiah: 500_000 }, reason: "Batas diskon uji" }));

async function product(t: { own: P; ph: P }, c: string, name: string, price: number, tax = "taxable_goods", stock = true) {
  const v = await as(t.own, (db) => publish(db, { kind: "product", code: c }, { name, tax_category: tax, tax_basis: "Barang", normal_price: price } as never, "Produk"));
  if (stock) await as(t.ph, (db) => saveItem(db, key(), null, { catalogItemId: v.itemId, unit: "pcs", storage: "ruang", highValue: false, active: true }));
  return { item: v.itemId, version: v.versionId };
}
async function approveTaxAdvice(t: T) {
  const fin = await person(t, "finance");
  const own = await person(t, "owner");
  const pdf = Buffer.from(`%PDF-1.7\nsaran pajak ${++n}\n%%EOF\n`);
  const { fileId } = await as(fin, (db) => uploadEvidence(db, { obligationKey: "tax_advice", fileName: "saran.pdf", content: pdf, expertName: "Konsultan Pajak Sintetis", documentDate: "2026-10-01" }));
  const item = (await h.admin.query(`select item_id from evidence_files where id = $1`, [fileId])).rows[0].item_id;
  await as(own, (db) => decideEvidence(db, item, fileId, "approved"));
}

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); FIN = await person(A, "finance"); AU = await person(A, "auditor");
  MGR = await person(A, "manager", A.b1); MGR2 = await person(A, "manager", A.b1); FO = await person(A, "fo_cashier", A.b1);
  PH = await person(A, "pharmacist", A.b1);
  BOWN = await person(B, "owner"); FH = await person(A, "facility_head", A.b1); RO = await person(A, "records_officer", A.b1);
  const ctx = { own: OWN, ph: PH };
  ({ item: serum } = await product(ctx, "DS-SRM", "Serum Diskon", 1_000_000));
  ({ item: big } = await product(ctx, "DS-BIG", "Alat Mahal", 8_000_000));
  // A package of 2 sessions of a service (BILL-7 split of the discounted price).
  const svc = await as(OWN, (db) => publish(db, { kind: "service", code: "DS-FAC" }, {
    name: "Facial Diskon", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 600_000, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
    indications: "Indikasi", consent_template: "Templat facial.", delegation: "Dokter", aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }],
  } as never, "Layanan baru"));
  if (svc.approvalId) await as(FH, (db) => db.query(`select approval_decide($1, true, null)`, [svc.approvalId]));
  const pv = await as(OWN, (db) => publish(db, { kind: "package", code: "DS-PKT" }, { name: "Paket 2x Facial", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 1_000_000 } as never, "Paket"));
  await as(OWN, (db) => setPackageContents(db, key(), pv.versionId, [{ serviceItemId: svc.itemId, count: 2 }]));
  pkg = pv.itemId;
  // SET-12 for the PR-72 scenario: FO 10 %, manager 10 % / Rp500,000.
  await setLimits(10);
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

const line = async (inv: string, item?: string) => (await h.admin.query(
  `select * from invoice_lines where invoice_id = $1 ${item ? "and item_id = $2" : ""} order by created_at, id limit 1`, item ? [inv, item] : [inv])).rows[0];
const approval = async (id: string) => (await h.admin.query(`select * from approvals where id = $1`, [id])).rows[0];
async function issue(by: P, items: { item: string; qty?: number; discount?: number }[], o: { visit?: boolean; patient?: boolean } = {}) {
  const pid = o.patient === false ? undefined : await patient(A, by.branch ?? A.b1);
  const v = o.visit ? await visit(A, by.branch ?? A.b1, by, pid) : null;
  const br = by.branch ? {} : { branchId: A.b1 }; // tenant-wide roles name the branch
  const { invoiceId } = await as(by, (db) => openKasirInvoice(db, key(), v ? { patientId: v.patientId, visitId: v.visitId, ...br } : pid ? { patientId: pid, ...br } : { counter: true, ...br }));
  const r = await as(by, (db) => issueKasirInvoice(db, key(), invoiceId, items.map((x) => ({ itemId: x.item, quantity: x.qty ?? 1, ...(x.discount !== undefined ? { discount: x.discount } : {}) }))));
  return { invoiceId, r, visitId: v?.visitId };
}

describe("scenario PR-72: an over-limit manual discount waits for approval", () => {
  it("FO 15 % with a 10 % limit → issued at full price, one pending approval for the line, listed for manager and owner, not FO", async () => {
    const { invoiceId, r } = await issue(FO, [{ item: serum, discount: 150_000 }]);
    expect(r.discount_pending).toBe(1);
    const l = await line(invoiceId);
    expect([Number(l.discount), Number(l.line_total), l.discount_kind]).toEqual([0, 1_000_000, "manual"]);
    const ap = await approval(l.discount_approval_id);
    expect([ap.type, ap.subject_kind, ap.subject_id, Number(ap.amount_rupiah), ap.state, ap.requested_by]).toEqual(["manual_discount", "invoice_line", l.id, 150_000, "pending", FO.staffId]);
    // 15 % is over the manager's own 10 % as well: the manager does not see it (capped); the owner does
    expect((await as(MGR, (db) => listInbox(db, "manager"))).rows.some((x) => x.id === ap.id)).toBe(false);
    expect((await as(OWN, (db) => listInbox(db, "owner"))).rows.some((x) => x.id === ap.id)).toBe(true);
    expect((await as(FO, (db) => listInbox(db, "fo_cashier"))).rows.some((x) => x.id === ap.id)).toBe(false);
    // the line is not payable meanwhile; the invoice void waits for the decision
    expect(await why(as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 1_000_000, cashTendered: 1_000_000 }])))).toBe("ERR_VERSION_CONFLICT:discount_pending");
    expect(await why(as(FO, (db) => requestVoid(db, key(), invoiceId, "Salah input")))).toBe("ERR_VERSION_CONFLICT:discount_pending");
    // approved by the owner → discounted, payable, DiscountApproved
    await as(OWN, (db) => decideApproval(db, ap.id, true));
    const l2 = await line(invoiceId);
    expect([Number(l2.discount), Number(l2.line_total), l2.discount_kind]).toEqual([150_000, 850_000, "manual"]);
    const ev = (await h.admin.query(`select payload from domain_events where type = 'DiscountApproved' and aggregate_id = $1`, [l.id])).rows;
    expect(ev.map((e) => Object.keys(e.payload).sort())).toEqual([["approval_id", "invoice_id", "invoice_line_id"]]);
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 850_000, cashTendered: 850_000 }]));
  });

  it("within the limit the discount applies at issue (no approval); the default SET-12 (FO 0 %) sends any FO discount to approval", async () => {
    const { invoiceId, r } = await issue(FO, [{ item: serum, discount: 100_000 }]);
    const l = await line(invoiceId);
    expect([r.discount_pending, Number(l.discount), l.discount_kind, l.discount_approval_id]).toEqual([0, 100_000, "manual", null]);
    const z = await issue(FO, [{ item: serum }]);
    expect((await line(z.invoiceId)).discount_kind).toBeNull();
    await setLimits(0);
    try {
      const d = await issue(FO, [{ item: serum, discount: 1 }]);
      expect(d.r.discount_pending).toBe(1);
    } finally {
      await setLimits(10);
    }
    // finance uses the FO/Kasir limit (plan open point 1): 10 % applies, 10 % + 1 waits
    expect((await issue(FIN, [{ item: serum, discount: 100_000 }])).r.discount_pending).toBe(0);
    expect((await issue(FIN, [{ item: serum, discount: 100_001 }])).r.discount_pending).toBe(1);
    // the owner is unlimited
    const o = await issue(OWN, [{ item: serum, discount: 900_000 }]);
    expect([o.r.discount_pending, Number((await line(o.invoiceId)).discount)]).toEqual([0, 900_000]);
  });
});

describe("the approver is capped by the approver's own limit (Done-when)", () => {
  it("a manager decides within 10 % and Rp500,000 (the lower wins); above it neither approve nor reject, the owner decides", async () => {
    // manager boundaries on Rp8,000,000: 10 % = 800,000 > Rp500,000 → 500,000 is the manager's cap
    const m1 = await issue(MGR, [{ item: big, discount: 500_000 }]);
    expect(m1.r.discount_pending).toBe(0);
    const m2 = await issue(MGR, [{ item: big, discount: 500_001 }]);
    expect(m2.r.discount_pending).toBe(1);
    // FO asks 900,000 on Rp8,000,000 (11.25 %: over the FO 10 %, and over the manager's Rp500,000 cap): the manager may not decide
    const f = await issue(FO, [{ item: big, discount: 900_000 }]);
    const ap = (await line(f.invoiceId)).discount_approval_id as string;
    expect(await why(as(MGR, (db) => decideApproval(db, ap, true)))).toMatch(/^ERR_FORBIDDEN/);
    expect(await why(as(MGR, (db) => decideApproval(db, ap, false, "Terlalu besar")))).toMatch(/^ERR_FORBIDDEN/);
    expect((await as(MGR, (db) => inboxDetail(db, { staffId: MGR.staffId, role: "manager" }, ap)))?.blocked).toBe("not-approver");
    expect((await as(MGR, (db) => listInbox(db, "manager"))).rows.some((x) => x.id === ap)).toBe(false);
    await as(OWN, (db) => decideApproval(db, ap, true));
    expect(Number((await line(f.invoiceId)).discount)).toBe(900_000);
    // the requesting manager cannot approve the manager's own request; another manager may not either (over the cap): the owner does
    const ap2 = (await line(m2.invoiceId)).discount_approval_id as string;
    expect(await code(as(MGR, (db) => decideApproval(db, ap2, true)))).toBe("ERR_APPROVER_IS_REQUESTER");
    expect(await code(as(MGR2, (db) => decideApproval(db, ap2, true)))).toBe("ERR_FORBIDDEN");
  });

  it("rejected or withdrawn: the line stays at full price and becomes payable; deciding twice is refused", async () => {
    const r1 = await issue(FO, [{ item: serum, discount: 200_000 }]);
    const ap = (await line(r1.invoiceId)).discount_approval_id as string;
    await as(OWN, (db) => decideApproval(db, ap, false, "Tidak sesuai kebijakan"));
    expect(Number((await line(r1.invoiceId)).discount)).toBe(0);
    expect(await code(as(OWN, (db) => decideApproval(db, ap, true)))).not.toBe("ok");
    await as(FO, (db) => receivePayment(db, key(), r1.invoiceId, [{ method: "cash", amount: 1_000_000, cashTendered: 1_000_000 }]));
    const r2 = await issue(FO, [{ item: serum, discount: 200_000 }]);
    const ap2w = (await line(r2.invoiceId)).discount_approval_id as string;
    await as(FO, (db) => cancelApproval(db, ap2w));
    expect(Number((await line(r2.invoiceId)).discount)).toBe(0);
    expect((await as(FO, (db) => kasirInvoice(db, r2.invoiceId))).lines[0].discount_requested).toBeNull();
  });
});

describe("payment, VAT, packages, guards", () => {
  it("only the pending line is blocked: the other line is payable in full, overpayment refused; the guard refuses a direct allocation", async () => {
    const { invoiceId } = await issue(FO, [{ item: serum, discount: 200_000 }, { item: big }]);
    expect(await why(as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 8_000_001, cashTendered: 8_000_001 }])))).toBe("ERR_INVALID_INPUT:overpayment");
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 8_000_000, cashTendered: 8_000_000 }]));
    const pending = await line(invoiceId, serum);
    expect((await h.admin.query(`select count(*)::int c from payment_allocations where invoice_line_id = $1`, [pending.id])).rows[0].c).toBe(0);
    // A spare payment on the owner connection (room on the payment), so the pending discount is the only reason to refuse.
    const r0 = (await h.admin.query(`select receipt_id from payments where invoice_id = $1 limit 1`, [invoiceId])).rows[0].receipt_id;
    const spare = (await h.admin.query(`insert into payments (tenant_id, branch_id, receipt_id, seq, invoice_id, patient_id, method, amount, environment, received_by, received_as)
                values ($1, $2, $3, 6, $4, (select patient_id from invoices where id = $4), 'edc', 900000, 'production', $5, 'fo_cashier') returning id`, [A.tenantId, A.b1, r0, invoiceId, FO.staffId])).rows[0].id;
    expect(await raw(`insert into payment_allocations (tenant_id, branch_id, payment_id, invoice_line_id, amount, method, environment, is_simulated)
                      values ($1, $2, $3, $4, 1, 'edc', 'production', false)`, [A.tenantId, A.b1, spare, pending.id])).toBe("raw:42501");
    // a direct change of the discount outside the approved transition is refused
    expect(await raw(`update invoice_lines set discount = 1, line_total = line_total - 1, vat_base = vat_base - 1 where id = $1`, [pending.id])).toBe("raw:42501");
  });

  it("VAT on the approved discounted total (PKP): 1,110,000 − 111,000 → base 900,000, VAT 99,000", async () => {
    const C = await tenant();
    const cown = await person(C, "owner");
    const cph = await person(C, "pharmacist", C.b1);
    const cfo = await person(C, "fo_cashier", C.b1);
    const tx = (await product({ own: cown, ph: cph }, "DP-TAX", "Krim PKP", 1_110_000)).item;
    await approveTaxAdvice(C);
    await h.admin.query("alter table tax_profile_changes disable trigger tax_profile_changes_guard");
    await h.admin.query("alter table tenants disable trigger tenants_tax_guard");
    await as(cown, (db) => setTaxProfile(db, key(), { isPkp: true, pkpEffectiveFrom: day(1), npwp: NPWP, reason: "PKP" }));
    await h.admin.query(`update tax_profile_changes set pkp_effective_from = $2::date - 1, changed_at = now() - interval '2 days' where tenant_id = $1`, [C.tenantId, today()]);
    await h.admin.query(`update tenants set pkp_effective_from = $2::date - 1 where id = $1`, [C.tenantId, today()]);
    await h.admin.query("alter table tax_profile_changes enable always trigger tax_profile_changes_guard");
    await h.admin.query("alter table tenants enable always trigger tenants_tax_guard");
    const pid = await patient(C, C.b1);
    const { invoiceId } = await as(cfo, (db) => openKasirInvoice(db, key(), { patientId: pid }));
    const r = await as(cfo, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: tx, quantity: 1, discount: 111_000 }]));
    expect([r.is_pkp_at_issue, r.discount_pending]).toEqual([true, 1]); // the default SET-12 (FO 0 %)
    const l0 = await line(invoiceId);
    expect([Number(l0.vat_base), Number(l0.vat_amount)]).toEqual([1_000_000, 110_000]);
    await as(cown, (db) => decideApproval(db, l0.discount_approval_id, true));
    const l = await line(invoiceId);
    expect([Number(l.line_total), Number(l.vat_base), Number(l.vat_amount)]).toEqual([999_000, 900_000, 99_000]);
  });

  it("a package with a pending discount opens at the decision on the discounted price; a discount equal to the gross is refused", async () => {
    const { invoiceId } = await issue(FO, [{ item: pkg, discount: 200_000 }]);
    expect((await h.admin.query(`select count(*)::int c from packages where invoice_id = $1`, [invoiceId])).rows[0].c).toBe(0);
    const apk = (await line(invoiceId)).discount_approval_id as string;
    await as(OWN, (db) => decideApproval(db, apk, true));
    const pk = (await h.admin.query(`select id, price::bigint p from packages where invoice_id = $1`, [invoiceId])).rows[0];
    expect(Number(pk.p)).toBe(800_000);
    expect(Number((await h.admin.query(`select sum(allocated_value)::bigint s from package_sessions where package_id = $1`, [pk.id])).rows[0].s)).toBe(800_000);
    expect(await why(issue(OWN, [{ item: pkg, discount: 1_000_000 }]))).toBe("ERR_INVALID_INPUT:discount");
  });

  it("a patient merged while the package discount is pending: the decision opens the package on the canonical patient", async () => {
    const dup = await patient(A, A.b1, "Pasien Ganda");
    const surv = await patient(A, A.b1, "Pasien Utama");
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: dup }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: pkg, quantity: 1, discount: 200_000 }]));
    await as(RO, (db) => mergePatients(db, key(), surv, dup, "Data ganda: pasien yang sama"));
    const apm = (await line(invoiceId)).discount_approval_id as string;
    await as(OWN, (db) => decideApproval(db, apm, true));
    expect((await h.admin.query(`select patient_id from packages where invoice_id = $1`, [invoiceId])).rows[0].patient_id).toBe(surv);
  });

  it("the line guard: the approved transition only on an untouched line, with the exact VAT split; a pending line inserts only with its own approval", async () => {
    const { invoiceId } = await issue(FO, [{ item: serum, discount: 200_000 }]);
    const l = await line(invoiceId);
    await as(OWN, (db) => decideApproval(db, l.discount_approval_id, true));
    const ok = await line(invoiceId);
    expect(Number(ok.line_total)).toBe(800_000);
    // Re-run the transition by hand on an approved line with a wrong VAT split: refused (the split must equal tax_vat_split).
    await h.admin.query("alter table invoice_lines disable trigger invoice_lines_guard");
    await h.admin.query(`update invoice_lines set discount = 0, line_total = 1000000, vat_base = 1000000, vat_amount = 0 where id = $1`, [l.id]);
    await h.admin.query("alter table invoice_lines enable always trigger invoice_lines_guard");
    expect(await raw(`update invoice_lines set discount = 200000, line_total = 800000, vat_base = 700000, vat_amount = 100000 where id = $1`, [l.id])).toBe("raw:42501");
    // …and refused once the line carries a tax document, even with the right split.
    await h.admin.query("alter table invoice_lines disable trigger invoice_lines_guard");
    await h.admin.query(`update invoice_lines set tax_document_ref = 'FP-UJI-1' where id = $1`, [l.id]);
    await h.admin.query("alter table invoice_lines enable always trigger invoice_lines_guard");
    expect(await raw(`update invoice_lines set discount = 200000, line_total = 800000, vat_base = $2, vat_amount = $3 where id = $1`,
      [l.id, ok.vat_base, ok.vat_amount])).toBe("raw:42501");
    // An insert pointing at an approval of another subject kind is refused.
    const other = (await h.admin.query(`insert into approvals (tenant_id, branch_id, type, subject_kind, subject_id, requested_by, requested_as, amount_rupiah)
       values ($1, $2, 'manual_discount', 'invoice', gen_random_uuid(), $3, 'fo_cashier', 1000) returning id, subject_id`, [A.tenantId, A.b1, FO.staffId])).rows[0];
    const pd = await patient(A, A.b1);
    const d = (await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pd }))).invoiceId;
    expect(await raw(`insert into invoice_lines (id, tenant_id, branch_id, invoice_id, item_id, catalog_version_id, quantity, unit_price, discount, line_total, tax_category, tax_basis, vat_base, vat_amount, discount_kind, discount_approval_id)
       select $4, tenant_id, branch_id, $1, item_id, catalog_version_id, 1, unit_price, 0, unit_price, tax_category, tax_basis, unit_price, 0, 'manual', $2 from invoice_lines where id = $3`,
      [d, other.id, l.id, other.subject_id])).toBe("raw:42501");
  });
});

describe("roles, branches, tenants, replay; the TS twin", () => {
  it("a branch-2 manager, the auditor and tenant B cannot decide; replay gives one approval", async () => {
    const MGRB2 = await person(A, "manager", A.b2);
    const { invoiceId } = await issue(FO, [{ item: serum, discount: 500_000 }]);
    const ap = (await line(invoiceId)).discount_approval_id as string;
    expect(await code(as(MGRB2, (db) => decideApproval(db, ap, true)))).not.toBe("ok");
    expect(await code(as(AU, (db) => decideApproval(db, ap, true)))).not.toBe("ok");
    expect(await code(as(BOWN, (db) => decideApproval(db, ap, true)))).not.toBe("ok");
    expect((await as(BOWN, (db) => db.query(`select approval_manager_decides_discount($1) ok`, [ap]))).rows[0].ok).toBe(false);
    const pid = await patient(A, A.b1);
    const { invoiceId: inv } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid }));
    const k = key();
    await as(FO, (db) => issueKasirInvoice(db, k, inv, [{ itemId: serum, quantity: 1, discount: 300_000 }]));
    await as(FO, (db) => issueKasirInvoice(db, k, inv, [{ itemId: serum, quantity: 1, discount: 300_000 }]));
    expect((await h.admin.query(`select count(*)::int c from approvals a join invoice_lines l on l.id = a.subject_id where l.invoice_id = $1`, [inv])).rows[0].c).toBe(1);
  });

  it("the suspicious-activity report (SEC-19): owner and auditor see every manual discount with requester, approver and amount", async () => {
    const C = await tenant();
    const cown = await person(C, "owner"); const cau = await person(C, "auditor"); const cfin = await person(C, "finance");
    const cmgr = await person(C, "manager", C.b1); const cfo = await person(C, "fo_cashier", C.b1); const cph = await person(C, "pharmacist", C.b1);
    const it2 = (await product({ own: cown, ph: cph }, "DR-SRM", "Serum Laporan", 1_000_000)).item;
    const iss = async (by: P, d: number) => {
      const pid = await patient(C, C.b1);
      const { invoiceId } = await as(by, (db) => openKasirInvoice(db, key(), { patientId: pid }));
      await as(by, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: it2, quantity: 1, discount: d }]));
      return (await line(invoiceId)) as { id: string; discount_approval_id: string | null };
    };
    const within = await iss(cmgr, 50_000); // within the manager limit
    const pending = await iss(cfo, 100_000);
    const appr = await iss(cfo, 100_000);
    await as(cown, (db) => decideApproval(db, appr.discount_approval_id!, true));
    const rej = await iss(cfo, 100_000);
    await as(cmgr, (db) => decideApproval(db, rej.discount_approval_id!, false, "Tidak disetujui"));
    await iss(cfo, 0); // no discount: not in the report
    const rows = await as(cau, (db) => listManualDiscounts(db));
    const by = Object.fromEntries(rows.map((r) => [r.line_id, r]));
    expect(rows).toHaveLength(4);
    expect([by[within.id].state, by[within.id].discount, by[within.id].requester.role, by[within.id].approver]).toEqual(["within_limit", 50_000, "manager", null]);
    expect([by[pending.id].state, by[pending.id].requested, by[pending.id].approver]).toEqual(["pending", 100_000, null]);
    expect([by[appr.id].state, by[appr.id].discount, by[appr.id].approver?.role, by[appr.id].requester.id]).toEqual(["approved", 100_000, "owner", cfo.staffId]);
    expect([by[rej.id].state, by[rej.id].discount, by[rej.id].approver?.id]).toEqual(["rejected", 0, cmgr.staffId]);
    expect(JSON.stringify(rows)).not.toMatch(/patient/i);
    expect((await as(cown, (db) => listManualDiscounts(db, C.b2)))).toHaveLength(0);
    for (const p of [cfin, cmgr, cfo]) expect(await code(as(p, (db) => listManualDiscounts(db))), p.role).toBe("raw:42501");
    expect(await as(BOWN, (db) => listManualDiscounts(db))).toHaveLength(0); // tenant B sees nothing of C
  });

  it("withinDiscountLimit equals discount_within_limit over a boundary table", async () => {
    const cases: [string, number, number][] = [
      ["owner", 1_000_000, 1_000_000], ["manager", 8_000_000, 500_000], ["manager", 8_000_000, 500_001], ["manager", 1_000_000, 100_000], ["manager", 1_000_000, 100_001],
      ["fo_cashier", 1_000_000, 100_000], ["fo_cashier", 1_000_000, 100_001], ["finance", 999_999, 99_999], ["finance", 999_999, 100_000], ["doctor", 1, 1], ["fo_cashier", 5, 0],
    ];
    for (const [role, gross, d] of cases) {
      const sql = (await h.admin.query(`select discount_within_limit($1, $2, $3, clock_timestamp()) ok`, [role, gross, d])).rows[0].ok;
      expect(withinDiscountLimit(role, gross, d), `${role} ${gross} ${d}`).toBe(sql); // both on the SET-12 default
    }
  });
});
