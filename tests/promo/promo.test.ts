// T-081 Done-when: scenario PR-77 (a code with quota 10 used 10 times is refused as exhausted) and two concurrent cashiers cannot
// exceed the quota. Plus the plan and its reviews: the discount (percent with a cap, rupiah), VAT on the discounted total, a package
// line (BILL-7 split of the promo price), the refusals in order, one discount per line, the per-patient limit (merged patients
// counted on the survivor), the usage lifecycle (reserved → consumed on settlement incl. a receivable; released on void, on a
// cancelled unpaid package, on a full refund to balance or cash; a partial refund keeps it consumed), versions frozen once used,
// management roles, RLS on usages, the Kasir hint, tenants and replay. Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { decideApproval } from "../../src/modules/approvals/approvals";
import { issueKasirInvoice, kasirInvoice, KasirError, openKasirInvoice, receivePayment, requestVoid } from "../../src/modules/cashier/kasir/kasir";
import { convertToReceivable, payRefund, requestRefund } from "../../src/modules/cashier/receivables/receivables";
import { releaseAddition } from "../../src/modules/cashier/additions/additions";
import { captureConsent, consentText } from "../../src/modules/clinical/consent/consent";
import { addPlanItem, createPlan, openExam } from "../../src/modules/clinical/exam/exam";
import { signRecord, type StepUp } from "../../src/modules/clinical/records/records";
import { createRequest, decideRequest } from "../../src/modules/clinical/requests/requests";
import { setKekRingForTests } from "../../src/lib/keys/runtime";
import { runPackageExpiryScan } from "../../src/modules/packages/expiry";
import { confirmSelection } from "../../src/modules/pharmacy/pharmacy";
import { finishTreatment, startTreatment } from "../../src/modules/treatment/treatment";
import { publish } from "../../src/modules/catalog/catalog";
import { decideEvidence, uploadEvidence } from "../../src/modules/compliance/compliance";
import { saveItem } from "../../src/modules/inventory/stock";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { cancelPackage, interruptedToBalance, reserveSession, setPackageContents } from "../../src/modules/packages/packages";
import { mergePatients } from "../../src/modules/patients/merge/merge";
import { checkPromoCode, createPromoCode, listPromoCodes, setPromoCode, versionPromoCode, type PromoTerms } from "../../src/modules/promo/promo";
import { setTaxProfile } from "../../src/modules/tax/tax";
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
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Promo Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string, tz: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone, address) values ($1, $2, $2, $3, 'Jl. Uji 1') returning id`, [tenantId, c, tz])).rows[0].id as string;
  return { tenantId, b1: await br("PR1", "Asia/Jakarta"), b2: await br("PR2", "Asia/Makassar") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`prm${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Promo ${n}` });
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
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const NPWP = "012345678901234";
async function patient(t: T, branch: string, name = "Pasien Promo"): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "");
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $5, '1990-01-01', 'female', 'nik', $3, $4, 'islam', 'Karyawan', 's1', 'kawin', $2,
             (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id`,
    [t.tenantId, branch, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43), name])).rows[0].id as string;
}

let A: T; let B: T;
let OWN: P; let MK: P; let AP: P; let FIN: P; let MGR: P; let FO: P; let FO2: P; let AU: P; let PH: P; let BOWN: P; let RO: P;
let serum: string; let big: string; let pkg: string; let svc: string; let svcV: string; let filler: string; let fillerV: string;
let DOC: P; let NUR: P; let BC: P; let FH: P;
const STEP: StepUp = { verified: true };

async function product(t: { own: P; ph: P }, c: string, name: string, price: number, tax = "taxable_goods") {
  const v = await as(t.own, (db) => publish(db, { kind: "product", code: c }, { name, tax_category: tax, tax_basis: "Barang", normal_price: price } as never, "Produk"));
  await as(t.ph, (db) => saveItem(db, key(), null, { catalogItemId: v.itemId, unit: "pcs", storage: "ruang", highValue: false, active: true }));
  return v.itemId;
}
const terms = (items: string[], o: Partial<PromoTerms> = {}): PromoTerms =>
  ({ validFrom: day(-1), validTo: day(30), discountKind: "percent", discountValue: 10, itemIds: items, ...o });
let codeN = 0;
const newCode = async (quota: number, t: PromoTerms, by: P = MK) => {
  const c = `PRM-${++codeN}-${Math.floor(Math.random() * 1e6)}`;
  const id = await as(by, (db) => createPromoCode(db, key(), c, quota, t));
  return { id, code: c };
};
const line = async (inv: string) => (await h.admin.query(`select * from invoice_lines where invoice_id = $1 order by created_at, id limit 1`, [inv])).rows[0];
const usage = async (inv: string) => (await h.admin.query(`select * from promo_usages where invoice_id = $1`, [inv])).rows[0];
const used = async (promo: string) => (await h.admin.query(`select used from promo_codes where id = $1`, [promo])).rows[0].used as number;
async function issue(by: P, lines: { item: string; qty?: number; promo?: string; discount?: number }[], o: { pid?: string; counter?: boolean } = {}) {
  const pid = o.counter ? undefined : o.pid ?? (await patient(A, by.branch ?? A.b1));
  const br = by.branch ? {} : { branchId: A.b1 };
  const { invoiceId } = await as(by, (db) => openKasirInvoice(db, key(), o.counter ? { counter: true, ...br } : { patientId: pid, ...br }));
  const r = await as(by, (db) => issueKasirInvoice(db, key(), invoiceId, lines.map((x) => ({ itemId: x.item, quantity: x.qty ?? 1,
    ...(x.promo ? { promoCode: x.promo } : {}), ...(x.discount !== undefined ? { discount: x.discount } : {}) }))));
  return { invoiceId, r, pid };
}
const pay = (by: P, inv: string, amount: number) => as(by, (db) => receivePayment(db, key(), inv, [{ method: "cash", amount, cashTendered: amount }]));

function png(): Buffer {
  const b = Buffer.alloc(80);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(640, 16);
  b.writeUInt32BE(240, 20);
  return b;
}
async function credential(t: T, p: P, branch: string) {
  for (const [kind, b] of [["str", null], ["sip", branch]] as const) {
    const id = (await h.admin.query(
      `insert into staff_credentials (tenant_id, staff_id, kind, number, issuer, profession, branch_id, valid_from, expires_on, recorded_by)
       values ($1, $2, $3, $4, 'Konsil Kesehatan', 'dokter', $5, '2024-01-01', $6, $7) returning id`,
      [t.tenantId, p.staffId, kind, `NO-${++n}`, b, b ? "2099-12-31" : null, OWN.staffId])).rows[0].id as string;
    await h.admin.query(`update staff_credentials set state = 'verified', decided_by = $2, decided_at = now() where id = $1`, [id, FH.staffId]);
  }
}
const consent = async (v: string, planId: string) => {
  const t = await as(DOC, (db) => consentText(db, v, planId));
  await as(DOC, (db) => captureConsent(db, key(), { visitId: v, planId, signer: "patient", expectedHash: t.content_hash, signature: png() }));
};
// An open visit of the patient with a signed exam, a plan of the given service versions and the consent.
async function visitWith(pid: string, versions: string[]) {
  const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
    [A.tenantId, A.b1, pid, FO.staffId])).rows[0].id as string;
  const { examId } = await as(DOC, (db) => openExam(db, key(), v));
  const { planId } = await as(DOC, (db) => createPlan(db, key(), examId, "Program Promo", "Kondisi rahasia"));
  const items: string[] = [];
  for (const ver of versions) items.push((await as(DOC, (db) => addPlanItem(db, key(), examId, planId, { stage: 1, catalog_version_id: ver, qty: 1 }))).itemId);
  await as(DOC, (db) => signRecord(db, key(), examId, STEP));
  await consent(v, planId);
  return { v, planId, items };
}
const start = (v: string, item: string) => as(DOC, (db) => startTreatment(db, key(), v, { planItemId: item, performerId: DOC.staffId, identityConfirmed: true }));
const finish = (eid: string, outcome: "completed" | "medical_stop") =>
  as(DOC, (db) => finishTreatment(db, key(), eid, outcome === "completed" ? { outcome } : { outcome, reason: "Alasan berhenti uji" }));

beforeAll(async () => {
  setKekRingForTests({ current: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) });
  h = await createHarness();
  const login = h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE]));
  app = await openAppPool({ connectionString: login, max: 8 });
  worker = await openAppPool({ connectionString: login, max: 2 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); MK = await person(A, "marketing"); AP = await person(A, "admin_pusat"); FIN = await person(A, "finance");
  AU = await person(A, "auditor"); MGR = await person(A, "manager", A.b1); FO = await person(A, "fo_cashier", A.b1); FO2 = await person(A, "fo_cashier", A.b1);
  PH = await person(A, "pharmacist", A.b1); RO = await person(A, "records_officer", A.b1);
  BOWN = await person(B, "owner");
  const ctx = { own: OWN, ph: PH };
  serum = await product(ctx, "PR-SRM", "Serum Promo", 1_000_000);
  big = await product(ctx, "PR-BIG", "Alat Promo", 8_000_000);
  FH = await person(A, "facility_head", A.b1); DOC = await person(A, "doctor", A.b1); NUR = await person(A, "nurse", A.b1); BC = await person(A, "bc", A.b1);
  await credential(A, DOC, A.b1);
  const service = async (c: string, name: string, price: number) => {
    const s = await as(OWN, (db) => publish(db, { kind: "service", code: c }, {
      name, tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: price, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
      indications: "Indikasi", consent_template: `Templat ${name}.`, delegation: "Dokter", aftercare_text: "Perawatan",
      eligibility: [{ role: "doctor", mode: "performs" }, { role: "nurse", mode: "performs" }],
    } as never, "Layanan baru"));
    if (s.approvalId) await as(FH, (db) => db.query(`select approval_decide($1, true, null)`, [s.approvalId]));
    return s;
  };
  const s = await service("PR-FAC", "Facial Promo", 600_000);
  svc = s.itemId; svcV = s.versionId;
  const f = await service("PR-FIL", "Filler Promo", 400_000);
  filler = f.itemId; fillerV = f.versionId;
  const pv = await as(OWN, (db) => publish(db, { kind: "package", code: "PR-PKT" }, { name: "Paket 2x Facial Promo", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 1_000_000 } as never, "Paket"));
  await as(OWN, (db) => setPackageContents(db, key(), pv.versionId, [{ serviceItemId: svc, count: 2 }]));
  pkg = pv.itemId;
}, 300_000);
afterAll(async () => {
  setKekRingForTests(undefined);
  await app?.end();
  await worker?.end();
  await owner?.end();
  await h?.close();
});

describe("scenario PR-77 and the atomic quota (Done-when)", () => {
  it("a code with quota 10 already used 10 times is refused as exhausted; nothing is written", async () => {
    const c = await newCode(10, terms([serum]));
    for (let k = 0; k < 10; k++) await issue(FO, [{ item: serum, promo: c.code }]);
    expect(await used(c.id)).toBe(10);
    const pid = await patient(A, A.b1);
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid }));
    expect(await why(as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: serum, quantity: 1, promoCode: c.code }])))).toBe("ERR_VERSION_CONFLICT:promo_exhausted");
    expect((await h.admin.query(`select state from invoices where id = $1`, [invoiceId])).rows[0].state).toBe("draft");
    expect(await h.admin.query(`select count(*)::int c from invoice_lines where invoice_id = $1`, [invoiceId]).then((r) => r.rows[0].c)).toBe(0);
    expect(await used(c.id)).toBe(10);
    expect(await as(FO, (db) => checkPromoCode(db, c.code, serum))).toEqual({ ok: false, reason: "promo_exhausted" });
  });

  it("two cashiers take the last use at the same time: exactly one issues (the second waits, then sees it used); rollback frees it", async () => {
    const c = await newCode(1, terms([serum]));
    const prep = async (by: P) => {
      const pid = await patient(A, A.b1);
      return (await as(by, (db) => openKasirInvoice(db, key(), { patientId: pid }))).invoiceId;
    };
    const [i1, i2] = [await prep(FO), await prep(FO2)];
    // Hold the first cashier's transaction open after its issue; the second starts, blocks, then resolves after the first commits.
    const ctx1 = await resolveContext(app, FO.acc, { tenantId: A.tenantId, actingRole: "fo_cashier", activeBranchId: A.b1 });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const t1 = withTenantContext(app, ctx1, async (db) => {
      await issueKasirInvoice(db, key(), i1, [{ itemId: serum, quantity: 1, promoCode: c.code }]);
      await gate;
    });
    await new Promise((r) => setTimeout(r, 300));
    const t2 = why(as(FO2, (db) => issueKasirInvoice(db, key(), i2, [{ itemId: serum, quantity: 1, promoCode: c.code }])));
    await new Promise((r) => setTimeout(r, 500));
    release();
    await t1;
    expect(await t2).toBe("ERR_VERSION_CONFLICT:promo_exhausted");
    expect(await used(c.id)).toBe(1);
    expect((await h.admin.query(`select count(*)::int c from promo_usages where promo_id = $1`, [c.id])).rows[0].c).toBe(1);
    // The first rolls back instead: the second succeeds.
    const d = await newCode(1, terms([serum]));
    const [j1, j2] = [await prep(FO), await prep(FO2)];
    let release2!: () => void;
    const gate2 = new Promise<void>((r) => (release2 = r));
    const u1 = withTenantContext(app, ctx1, async (db) => {
      await issueKasirInvoice(db, key(), j1, [{ itemId: serum, quantity: 1, promoCode: d.code }]);
      await gate2;
      throw new Error("rollback");
    }).catch((e) => e.message);
    await new Promise((r) => setTimeout(r, 300));
    const u2 = why(as(FO2, (db) => issueKasirInvoice(db, key(), j2, [{ itemId: serum, quantity: 1, promoCode: d.code }])));
    await new Promise((r) => setTimeout(r, 500));
    release2();
    expect(await u1).toBe("rollback");
    expect(await u2).toBe("ok");
    expect(await used(d.id)).toBe(1);
  });

  it("a burst of 6 parallel issues against quota 3 issues exactly 3", async () => {
    const c = await newCode(3, terms([serum]));
    const invs = await Promise.all([FO, FO2, FO, FO2, FO, FO2].map(async (by) => {
      const pid = await patient(A, A.b1);
      return { by, inv: (await as(by, (db) => openKasirInvoice(db, key(), { patientId: pid }))).invoiceId };
    }));
    const out = await Promise.all(invs.map((x) => why(as(x.by, (db) => issueKasirInvoice(db, key(), x.inv, [{ itemId: serum, quantity: 1, promoCode: c.code }])))));
    expect(out.filter((x) => x === "ok")).toHaveLength(3);
    expect(out.filter((x) => x === "ERR_VERSION_CONFLICT:promo_exhausted")).toHaveLength(3);
    expect(await used(c.id)).toBe(3);
  });
});

describe("the discount and its refusals", () => {
  it("percent with a cap, rupiah; the line is kind promo with no approval; the manual limit is not used (FO with SET-12 0 %)", async () => {
    const pc = await newCode(50, terms([big], { discountValue: 10, maxDiscount: 500_000 }));
    const r1 = await issue(FO, [{ item: big, promo: pc.code }]);
    const l1 = await line(r1.invoiceId);
    expect([l1.discount_kind, Number(l1.discount), Number(l1.line_total), l1.discount_approval_id]).toEqual(["promo", 500_000, 7_500_000, null]);
    expect(r1.r.discount_pending).toBe(0);
    expect(r1.r.promo_lines).toBe(1);
    const rp = await newCode(50, terms([serum], { discountKind: "rupiah", discountValue: 150_000 }));
    const r2 = await issue(FO, [{ item: serum, qty: 2, promo: rp.code }]);
    expect(Number((await line(r2.invoiceId)).discount)).toBe(150_000);
    expect((await usage(r2.invoiceId)).state).toBe("reserved");
    expect((await as(FO, (db) => kasirInvoice(db, r2.invoiceId))).lines[0].promo_code).toBe(rp.code);
    expect(await as(FO, (db) => checkPromoCode(db, rp.code, serum, { quantity: 2 }))).toMatchObject({ ok: true, gross: 2_000_000, discount: 150_000 });
  });

  it("refusals in order: unknown, inactive, outside the period, branch, item; with a manual discount; patient limit on a counter sale", async () => {
    const ok = await newCode(50, terms([serum], { branchIds: [A.b1] }));
    expect(await why(issue(FO, [{ item: serum, promo: "TIDAK-ADA" }]))).toBe("ERR_NOT_FOUND:promo");
    expect(await why(issue(FO, [{ item: big, promo: ok.code }]))).toBe("ERR_VERSION_CONFLICT:promo_item");
    expect(await why(issue(FO, [{ item: serum, promo: ok.code, discount: 1000 }]))).toBe("ERR_INVALID_INPUT:promo_and_discount");
    const b2 = await newCode(50, terms([serum], { branchIds: [A.b2] }));
    expect(await why(issue(FO, [{ item: serum, promo: b2.code }]))).toBe("ERR_VERSION_CONFLICT:promo_branch");
    const later = await newCode(50, terms([serum], { validFrom: day(5), validTo: day(9) }));
    expect(await why(issue(FO, [{ item: serum, promo: later.code }]))).toBe("ERR_VERSION_CONFLICT:promo_outside_period");
    const off = await newCode(50, terms([serum]));
    await as(MK, (db) => setPromoCode(db, key(), off.id, { active: false }));
    expect(await why(issue(FO, [{ item: serum, promo: off.code }]))).toBe("ERR_VERSION_CONFLICT:promo_inactive");
    const lim = await newCode(50, terms([serum], { perPatientLimit: 1 }));
    expect(await why(issue(FO, [{ item: serum, promo: lim.code }], { counter: true }))).toBe("ERR_VERSION_CONFLICT:promo_patient_limit");
    expect(await as(FO, (db) => checkPromoCode(db, off.code, serum))).toEqual({ ok: false, reason: "promo_inactive" });
  });

  it("per-patient limit: a second use by the same patient (also across a merge) is refused; two lines of one code at quota 1 are refused", async () => {
    const lim = await newCode(50, terms([serum], { perPatientLimit: 1 }));
    const pid = await patient(A, A.b1);
    await issue(FO, [{ item: serum, promo: lim.code }], { pid });
    expect(await why(issue(FO, [{ item: serum, promo: lim.code }], { pid }))).toBe("ERR_VERSION_CONFLICT:promo_patient_limit");
    const dup = await patient(A, A.b1, "Pasien Ganda Promo");
    await as(RO, (db) => mergePatients(db, key(), pid, dup, "Data ganda: pasien yang sama"));
    expect(await why(issue(FO, [{ item: serum, promo: lim.code }], { pid }))).toBe("ERR_VERSION_CONFLICT:promo_patient_limit");
    const two = await newCode(50, terms([serum, big], { perPatientLimit: 1 }));
    expect(await why(issue(FO, [{ item: serum, promo: two.code }, { item: big, promo: two.code }]))).toBe("ERR_VERSION_CONFLICT:promo_patient_limit");
    const q1 = await newCode(1, terms([serum, big]));
    expect(await why(issue(FO, [{ item: serum, promo: q1.code }, { item: big, promo: q1.code }]))).toBe("ERR_VERSION_CONFLICT:promo_exhausted");
    expect(await used(q1.id)).toBe(0);
  });

  it("VAT on the discounted total (PKP); a package's sessions split the promo price; a promo equal to a package's gross is refused", async () => {
    const C = await tenant();
    const cown = await person(C, "owner"); const cmk = await person(C, "marketing"); const cph = await person(C, "pharmacist", C.b1);
    const cfo = await person(C, "fo_cashier", C.b1); const cfin = await person(C, "finance");
    const tx = await product({ own: cown, ph: cph }, "PRT-TAX", "Krim PKP Promo", 1_110_000);
    const pdf = Buffer.from(`%PDF-1.7\nsaran pajak promo\n%%EOF\n`);
    const { fileId } = await as(cfin, (db) => uploadEvidence(db, { obligationKey: "tax_advice", fileName: "saran.pdf", content: pdf, expertName: "Konsultan Pajak Sintetis", documentDate: "2026-10-01" }));
    const item = (await h.admin.query(`select item_id from evidence_files where id = $1`, [fileId])).rows[0].item_id;
    await as(cown, (db) => decideEvidence(db, item, fileId, "approved"));
    await h.admin.query("alter table tax_profile_changes disable trigger tax_profile_changes_guard");
    await h.admin.query("alter table tenants disable trigger tenants_tax_guard");
    await as(cown, (db) => setTaxProfile(db, key(), { isPkp: true, pkpEffectiveFrom: day(1), npwp: NPWP, reason: "PKP" }));
    await h.admin.query(`update tax_profile_changes set pkp_effective_from = $2::date - 1, changed_at = now() - interval '2 days' where tenant_id = $1`, [C.tenantId, today()]);
    await h.admin.query(`update tenants set pkp_effective_from = $2::date - 1 where id = $1`, [C.tenantId, today()]);
    await h.admin.query("alter table tax_profile_changes enable always trigger tax_profile_changes_guard");
    await h.admin.query("alter table tenants enable always trigger tenants_tax_guard");
    const cid = await as(cmk, (db) => createPromoCode(db, key(), "PKP-PROMO", 5, terms([tx], { discountKind: "rupiah", discountValue: 111_000 })));
    const pid = await patient(C, C.b1);
    const { invoiceId } = await as(cfo, (db) => openKasirInvoice(db, key(), { patientId: pid }));
    const r = await as(cfo, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: tx, quantity: 1, promoCode: "pkp-promo" }]));
    expect(r.is_pkp_at_issue).toBe(true);
    const l = await line(invoiceId);
    expect([Number(l.line_total), Number(l.vat_base), Number(l.vat_amount)]).toEqual([999_000, 900_000, 99_000]);
    expect(cid).toBeTruthy();
    // package
    const pp = await newCode(5, terms([pkg], { discountKind: "rupiah", discountValue: 200_000 }));
    const { invoiceId: pi } = await issue(FO, [{ item: pkg, promo: pp.code }]);
    const pk = (await h.admin.query(`select id, price::bigint p from packages where invoice_id = $1`, [pi])).rows[0];
    expect(Number(pk.p)).toBe(800_000);
    expect(Number((await h.admin.query(`select sum(allocated_value)::bigint s from package_sessions where package_id = $1`, [pk.id])).rows[0].s)).toBe(800_000);
    const full = await newCode(5, terms([pkg], { discountKind: "percent", discountValue: 100 }));
    expect(await why(issue(FO, [{ item: pkg, promo: full.code }]))).toBe("ERR_INVALID_INPUT:discount");
    expect(await as(FO, (db) => checkPromoCode(db, full.code, pkg))).toEqual({ ok: false, reason: "discount" }); // the hint agrees (review r1 P2-1)
  });
});

describe("the usage lifecycle (BILL-36)", () => {
  it("paid in full → consumed; partly paid → reserved; void of an unpaid invoice → released (void), used − 1", async () => {
    const c = await newCode(50, terms([serum]));
    const a1 = await issue(FO, [{ item: serum, promo: c.code }]);
    await pay(FO, a1.invoiceId, 400_000);
    expect((await usage(a1.invoiceId)).state).toBe("reserved");
    await pay(FO, a1.invoiceId, 500_000);
    expect((await usage(a1.invoiceId)).state).toBe("consumed");
    const a2 = await issue(FO, [{ item: serum, promo: c.code }]);
    expect(await used(c.id)).toBe(2);
    const v = await as(FO, (db) => requestVoid(db, key(), a2.invoiceId, "Salah input"));
    await as(OWN, (db) => decideApproval(db, v.approvalId, true));
    const u = await usage(a2.invoiceId);
    expect([u.state, u.release_code]).toEqual(["released", "void"]);
    expect(await used(c.id)).toBe(1);
  });

  it("refunds: a partial refund keeps it consumed; the rest (full value) releases it; a full cash refund (approved) releases it", async () => {
    const c = await newCode(50, terms([serum]));
    const a = await issue(FO, [{ item: serum, promo: c.code }]);
    await pay(FO, a.invoiceId, 900_000);
    const l = await line(a.invoiceId);
    await as(FO, (db) => requestRefund(db, key(), l.id, { amount: 400_000, reason: "Sebagian dikembalikan" }));
    expect((await usage(a.invoiceId)).state).toBe("consumed");
    await as(FO, (db) => requestRefund(db, key(), l.id, { amount: 500_000, reason: "Sisanya dikembalikan" }));
    expect([(await usage(a.invoiceId)).state, (await usage(a.invoiceId)).release_code]).toEqual(["released", "refunded_full"]);
    const b = await issue(FO, [{ item: serum, promo: c.code }]);
    await pay(FO, b.invoiceId, 900_000);
    const lb = (await line(b.invoiceId)).id as string;
    const r = await as(FO, (db) => requestRefund(db, key(), lb, { amount: 900_000, destination: "cash", reason: "Pasien minta tunai" }));
    expect((await usage(b.invoiceId)).state).toBe("consumed");
    await as(OWN, (db) => decideApproval(db, r.approval_id!, true));
    await as(FO, (db) => payRefund(db, key(), r.refund_id, "cash"));
    expect([(await usage(b.invoiceId)).state, (await usage(b.invoiceId)).release_code]).toEqual(["released", "refunded_full"]);
    expect(await used(c.id)).toBe(0);
  });

  it("packages: an unpaid package cancelled → released (removed); a paid unredeemed one cancelled → released (refunded_full)", async () => {
    const c = await newCode(50, terms([pkg], { discountKind: "rupiah", discountValue: 100_000 }));
    const a = await issue(FO, [{ item: pkg, promo: c.code }]);
    const pkA = (await h.admin.query(`select id from packages where invoice_id = $1`, [a.invoiceId])).rows[0].id as string;
    await as(OWN, (db) => cancelPackage(db, key(), pkA, "Pasien batal membeli"));
    expect([(await usage(a.invoiceId)).state, (await usage(a.invoiceId)).release_code]).toEqual(["released", "removed"]);
    const b = await issue(FO, [{ item: pkg, promo: c.code }]);
    await pay(FO, b.invoiceId, 900_000);
    expect((await usage(b.invoiceId)).state).toBe("consumed");
    const pkB = (await h.admin.query(`select id from packages where invoice_id = $1`, [b.invoiceId])).rows[0].id as string;
    await as(OWN, (db) => cancelPackage(db, key(), pkB, "Pasien membatalkan paket"));
    expect([(await usage(b.invoiceId)).state, (await usage(b.invoiceId)).release_code]).toEqual(["released", "refunded_full"]);
    expect(await used(c.id)).toBe(0);
  });

  it("packages: a voided unpaid package invoice → released (void, not removed); cancelled after a redeemed session → stays consumed", async () => {
    const c = await newCode(50, terms([pkg], { discountKind: "rupiah", discountValue: 100_000 }));
    const a = await issue(FO, [{ item: pkg, promo: c.code }]);
    const v = await as(FO, (db) => requestVoid(db, key(), a.invoiceId, "Salah input paket"));
    await as(OWN, (db) => decideApproval(db, v.approvalId, true));
    expect([(await usage(a.invoiceId)).state, (await usage(a.invoiceId)).release_code]).toEqual(["released", "void"]);
    // A paid package (900,000 = two sessions of 450,000), one session redeemed, then cancelled: the purchase is not refunded in
    // full, so the use stays consumed.
    const b = await issue(FO, [{ item: pkg, promo: c.code }]);
    await pay(FO, b.invoiceId, 900_000);
    const pk = (await h.admin.query(`select id from packages where invoice_id = $1`, [b.invoiceId])).rows[0].id as string;
    const w = await visitWith(b.pid!, [svcV]);
    await as(FO, (db) => reserveSession(db, key(), pk, w.v));
    const e = await start(w.v, w.items[0]);
    await finish(e.executionId, "completed");
    expect((await h.admin.query(`select count(*)::int c from package_sessions where package_id = $1 and state = 'redeemed'`, [pk])).rows[0].c).toBe(1);
    await as(OWN, (db) => cancelPackage(db, key(), pk, "Pasien membatalkan sisa paket"));
    expect((await usage(b.invoiceId)).state).toBe("consumed");
    expect(await used(c.id)).toBe(1);
  });

  it("package expiry: a partly paid package's use moves reserved → consumed (the remainder cancelled); a fully paid one stays consumed", async () => {
    const c = await newCode(50, terms([pkg], { discountKind: "rupiah", discountValue: 100_000 }));
    const part = await issue(FO, [{ item: pkg, promo: c.code }]);
    await pay(FO, part.invoiceId, 450_000);
    expect((await usage(part.invoiceId)).state).toBe("reserved");
    const full = await issue(FO, [{ item: pkg, promo: c.code }]);
    await pay(FO, full.invoiceId, 900_000);
    for (const inv of [part.invoiceId, full.invoiceId]) {
      await h.admin.query(`alter table packages disable trigger packages_guard`);
      await h.admin.query(`update packages set validity_end = now() - interval '1 day' where invoice_id = $1`, [inv]);
      await h.admin.query(`alter table packages enable always trigger packages_guard`);
    }
    expect(await runPackageExpiryScan(worker)).toBeGreaterThanOrEqual(2);
    expect([(await usage(part.invoiceId)).state, (await usage(full.invoiceId)).state]).toEqual(["consumed", "consumed"]);
    expect(await used(c.id)).toBe(2);
  });

  it("a partly paid addition stopped (medical) and moved to balance: the remainder is cancelled and the use consumed (r1 P1-1)", async () => {
    const pid = await patient(A, A.b1, "Pasien Tambahan Promo");
    const w = await visitWith(pid, [svcV]);
    await as(BC, (db) => confirmSelection(db, key(), w.v, { items: [{ planItemId: w.items[0] }] }));
    const { invoiceId: init } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: w.v }));
    await as(FO, (db) => issueKasirInvoice(db, key(), init, [{ itemId: svc, quantity: 1 }]));
    await pay(FO, init, 600_000);
    const { requestId } = await as(NUR, (db) => createRequest(db, key(), w.v, {
      kind: "addition", planId: w.planId, catalogVersionId: fillerV, stage: 1, qty: 1, reason: "Tambahan di ruang tindakan",
    }));
    const d = await as(DOC, (db) => decideRequest(db, key(), requestId, true, null));
    const itemId = (d as { item_id: string }).item_id;
    await consent(w.v, w.planId);
    const c = await newCode(50, terms([filler], { discountKind: "rupiah", discountValue: 100_000 }));
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: w.v }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: filler, quantity: 1, planItemId: itemId, promoCode: c.code }]));
    expect(Number((await line(invoiceId)).line_total)).toBe(300_000);
    await pay(FO, invoiceId, 100_000);
    expect((await usage(invoiceId)).state).toBe("reserved");
    await as(FO, (db) => releaseAddition(db, key(), itemId, FO.staffId));
    const e = await start(w.v, itemId);
    await finish(e.executionId, "medical_stop");
    expect((await as(FO, (db) => interruptedToBalance(db, key(), e.executionId))).amount).toBe(100_000);
    const l = await line(invoiceId);
    expect([Number(l.cancelled_amount), Number(l.moved_to_balance)]).toEqual([200_000, 100_000]);
    expect((await usage(invoiceId)).state).toBe("consumed");
    expect(await used(c.id)).toBe(1);
  });

  it("a delivered visit line converted to a receivable → consumed", async () => {
    const c = await newCode(50, terms([serum]));
    const pid = await patient(A, A.b1);
    const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
      [A.tenantId, A.b1, pid, FO.staffId])).rows[0].id as string;
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: serum, quantity: 1, promoCode: c.code }]));
    const l = await line(invoiceId);
    const si = (await h.admin.query(`select id from stock_items where tenant_id = $1 and catalog_item_id = $2`, [A.tenantId, serum])).rows[0].id as string;
    const depot = (await h.admin.query(`select id from depots where tenant_id = $1 and branch_id = $2 and is_default`, [A.tenantId, A.b1])).rows[0].id as string;
    await h.admin.query(`alter table dispensings disable trigger dispensings_guard`);
    try {
      await h.admin.query(`insert into dispensings (tenant_id, branch_id, visit_id, patient_id, invoice_line_id, stock_item_id, quantity, state,
                             prepared_at, prepared_by, prepare_key, depot_id, handed_at, handed_by, hand_key, checks)
        values ($1, $2, null, $3, $4, $5, 1, 'handed', now(), $6, $7, $8, now(), $6, $9, '{}'::jsonb)`, [A.tenantId, A.b1, pid, l.id, si, FO.staffId, `pk-${key()}`, depot, `hk-${key()}`]);
    } finally {
      await h.admin.query(`alter table dispensings enable always trigger dispensings_guard`);
    }
    await as(FO, (db) => convertToReceivable(db, key(), v));
    expect((await usage(invoiceId)).state).toBe("consumed");
  });
});

describe("versions, management, readers, guards, tenants", () => {
  it("an edit is a new version (the old one frozen); the quota is shared across versions and never lowered below its use", async () => {
    const c = await newCode(2, terms([serum], { discountValue: 10 }));
    await issue(FO, [{ item: serum, promo: c.code }]);
    await as(MK, (db) => versionPromoCode(db, key(), c.id, terms([serum], { discountValue: 20 })));
    const r = await issue(FO, [{ item: serum, promo: c.code }]);
    expect(Number((await line(r.invoiceId)).discount)).toBe(200_000);
    expect(await why(issue(FO, [{ item: serum, promo: c.code }]))).toBe("ERR_VERSION_CONFLICT:promo_exhausted");
    expect(await code(as(MK, (db) => setPromoCode(db, key(), c.id, { quota: 1 })))).toBe("ERR_INVALID_INPUT");
    const v1 = (await h.admin.query(`select id from promo_code_versions where promo_id = $1 and version = 1`, [c.id])).rows[0].id;
    expect(await raw(`update promo_code_versions set discount_value = 50 where id = $1`, [v1])).toBe("raw:42501");
    expect(await raw(`delete from promo_usages where promo_id = $1`, [c.id])).toBe("raw:42501");
    expect(await raw(`update promo_codes set used = 0 where id = $1`, [c.id])).toBe("raw:42501");
    const list = await as(AP, (db) => listPromoCodes(db));
    const row = list.find((x) => x.id === c.id)!;
    expect([row.used, row.versions.map((x) => [x.version, x.reserved])]).toEqual([2, [[2, 1], [1, 1]]]);
    // aggregates only: no patient, invoice or line ids in the statistics (r1 P2-5)
    expect(JSON.stringify(list)).not.toMatch(/"(patient_id|invoice_id|invoice_line_id|patient)"/);
  });

  it("roles: owner, Admin Pusat and Marketing manage; FO, manager, finance, auditor do not; Admin Pusat and Marketing cannot read usages; tenant B sees nothing", async () => {
    for (const p of [OWN, AP, MK]) expect(await code(as(p, (db) => createPromoCode(db, key(), `ROLE-${p.role.toUpperCase().replace("_", "")}-${n}`, 1, terms([serum]))))).toBe("ok");
    for (const p of [FO, MGR, FIN, AU]) expect(await code(as(p, (db) => createPromoCode(db, key(), `NO-${n++}`, 1, terms([serum]))))).toBe("ERR_FORBIDDEN");
    const c = await newCode(5, terms([serum]));
    await issue(FO, [{ item: serum, promo: c.code }]);
    const seen = async (p: P) => (await as(p, (db) => db.query(`select count(*)::int c from promo_usages where promo_id = $1`, [c.id]))).rows[0].c;
    expect([await seen(OWN), await seen(FIN), await seen(AU), await seen(FO), await seen(AP), await seen(MK)]).toEqual([1, 1, 1, 1, 0, 0]);
    expect((await as(BOWN, (db) => listPromoCodes(db))).some((x) => x.id === c.id)).toBe(false);
    expect(await why(as(BOWN, (db) => db.query(`select promo_code_check($1, $2, null)`, [c.code, serum])).then((r) => r.rows[0]))).not.toBe("raw:ok");
    // the same code text in tenant B is unrelated
    const bph = await person(B, "pharmacist", B.b1);
    const bserum = await product({ own: BOWN, ph: bph }, "PRB-SRM", "Serum B", 500_000);
    await as(BOWN, (db) => createPromoCode(db, key(), c.code, 1, terms([bserum])));
    expect(await used(c.id)).toBe(1);
  });

  it("replay of an issue with a code reserves once; the TS hint matches the issue", async () => {
    const c = await newCode(5, terms([serum]));
    const pid = await patient(A, A.b1);
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid }));
    const k = key();
    await as(FO, (db) => issueKasirInvoice(db, k, invoiceId, [{ itemId: serum, quantity: 1, promoCode: c.code }]));
    await as(FO, (db) => issueKasirInvoice(db, k, invoiceId, [{ itemId: serum, quantity: 1, promoCode: c.code }]));
    expect(await used(c.id)).toBe(1);
    const hint = await as(FO, (db) => checkPromoCode(db, c.code, serum));
    expect(hint).toMatchObject({ ok: true, discount: Number((await line(invoiceId)).discount) });
  });
});
