// T-076 Done-when (domain parts): scenario PR-20 and money scenario 8 (expiry: paid-unused to balance, the unpaid
// remainder cancelled, no receivable), 5a/5b (equal split, instalment unlocking, minimum DP), 2 and 7 (interrupted
// treatment: medical and clinic stop to balance, patient stop counted; 7d a package session returned on a stop), 11
// (sold at A, redeemed at B), 12a/12b (substitution), 13 (an instalment paid by balance), 16 and 19 (tax facts), the PR-14
// session effects, CLIN-006/007/009/010/011/028; plus the plan reviews: concurrent reservations, simulated money never
// counts, one session for one item, the in-treatment guard, a zero paid-unused close, a void, patient merge, the
// expiry scan, top-up through the Kasir records, readers, roles and tenants. Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { setKekRingForTests } from "../../src/lib/keys/runtime";
import { decideApproval } from "../../src/modules/approvals/approvals";
import { patientBalance } from "../../src/modules/balance/balance";
import { issueKasirInvoice, kasirQueue, openKasirInvoice, receivePayment, requestVoid } from "../../src/modules/cashier/kasir/kasir";
import { publish } from "../../src/modules/catalog/catalog";
import { decideEvidence, uploadEvidence } from "../../src/modules/compliance/compliance";
import { captureConsent, consentText } from "../../src/modules/clinical/consent/consent";
import { addPlanItem, createPlan, openExam } from "../../src/modules/clinical/exam/exam";
import { signRecord, type StepUp } from "../../src/modules/clinical/records/records";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { runPackageExpiryScan } from "../../src/modules/packages/expiry";
import {
  cancelPackage, decideSubstitution, interruptedToBalance, packageContents, patientPackages, releaseSession, requestSubstitution, reserveSession,
  searchPatients, setPackageContents, topUpBalance,
} from "../../src/modules/packages/packages";
import { mergePatients } from "../../src/modules/patients/merge/merge";
import { SIGNATURE_HEADER } from "../../src/modules/payments/mock";
import { createCharge, enableMockPort, receiveMockWebhook, simulate } from "../../src/modules/payments/payments";
import { setTaxProfile } from "../../src/modules/tax/tax";
import { blockersOf, finishTreatment, getTreatment, startTreatment } from "../../src/modules/treatment/treatment";
import { closeVisit } from "../../src/modules/visits/visits";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local";

let h: Harness;
let app: pg.Pool;
let worker: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "purchasing", "marketing", "central_cs", "auditor"];
const STEP: StepUp = { verified: true };
const NPWP = "012345678901234";

async function tenant(): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Paket Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("PK1"), b2: await br("PK2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`pkt${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Paket ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const key = () => crypto.randomUUID();
const why = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason ?? ""}` : `raw:${e.code ?? ""}:${e.message}`));
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const blocked = (x: Promise<unknown>) => x.then(() => [] as string[], (e) => blockersOf(e));
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
// HYG-016: tomorrow in the clinic's zone. day(1) is tomorrow in UTC, which between 00:00 and 07:00 WIB is today in
// WIB: scenario 16 then set PKP from the date of its own just-issued invoice and was refused (pkp_effective_from).
const tomorrowWib = () => new Date(Date.now() + 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
function png(): Buffer {
  const b = Buffer.alloc(80);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(640, 16);
  b.writeUInt32BE(240, 20);
  return b;
}
async function patient(t: T, branch: string, name = "Pasien Paket"): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "");
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $5, '1990-01-01', 'female', 'nik', $3, $4, 'islam', 'Karyawan', 's1', 'kawin', $2,
             (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id`,
    [t.tenantId, branch, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43), name])).rows[0].id as string;
}
async function credential(t: T, p: P, branch: string, fh: P, own: P) {
  for (const [kind, b] of [["str", null], ["sip", branch]] as const) {
    const id = (await h.admin.query(
      `insert into staff_credentials (tenant_id, staff_id, kind, number, issuer, profession, branch_id, valid_from, expires_on, recorded_by)
       values ($1, $2, $3, $4, 'Konsil Kesehatan', 'dokter', $5, '2024-01-01', $6, $7) returning id`,
      [t.tenantId, p.staffId, kind, `NO-${++n}`, b, b ? "2099-12-31" : null, own.staffId])).rows[0].id as string;
    await h.admin.query(`update staff_credentials set state = 'verified', decided_by = $2, decided_at = now() where id = $1`, [id, fh.staffId]);
  }
}
const balance = async (pid: string) =>
  Number((await h.admin.query(`select coalesce((select balance from balance_accounts where patient_id = $1), 0) b`, [pid])).rows[0].b);
const sessions = async (pkg: string) =>
  (await h.admin.query(`select seq, state, allocated_value::int v, vat_amount::int vat, vat_recognised_amount::int rec, reserved_visit_id is not null r,
                               reserved_execution_id is not null x, redeemed_branch_id rb from package_sessions where package_id = $1 order by seq`, [pkg])).rows;
const pkgRow = async (pkg: string) => (await h.admin.query(`select * from packages where id = $1`, [pkg])).rows[0];

let A: T; let B: T;
let OWN: P; let AP: P; let FIN: P; let AU: P; let FH: P; let DOC: P; let DOC2: P; let NUR: P; let BC: P; let FO: P; let FOB2: P; let MGR: P; let RO: P; let BFO: P;
let facial: string; let facialV: string; let laser: string; let laserV: string; let peel: string; let pricey: string;

// Publish a package item (5 facial sessions by default) with its contents.
async function packageItem(c: string, price: number, rows: { serviceItemId: string; count: number }[], o: { pct?: number; days?: number; installments?: boolean; tax?: string } = {}) {
  const v = await as(OWN, (db) => publish(db, { kind: "package", code: c }, {
    name: `Paket ${c}`, tax_category: o.tax ?? "exempt_medical", tax_basis: o.tax ? "Jasa" : "Jasa medis", normal_price: price,
    ...(o.pct !== undefined ? { min_dp_pct: o.pct } : {}), installments_allowed: o.installments ?? true, ...(o.days ? { validity_days: o.days } : {}),
  } as never, "Paket baru"));
  await as(OWN, (db) => setPackageContents(db, key(), v.versionId, rows));
  return { item: v.itemId, version: v.versionId };
}
// Sell a package to a patient at the FO's branch; optionally pay a first amount in cash.
async function sell(fo: P, pid: string, item: string, pay?: number) {
  const { invoiceId } = await as(fo, (db) => openKasirInvoice(db, key(), { patientId: pid }));
  await as(fo, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: item, quantity: 1 }]));
  if (pay) await as(fo, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: pay, cashTendered: pay }]));
  const pkg = (await h.admin.query(`select id from packages where invoice_id = $1`, [invoiceId])).rows[0].id as string;
  return { invoiceId, pkg };
}
const pay = (fo: P, invoiceId: string, amount: number) => as(fo, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount, cashTendered: amount }]));
// An open visit for the patient at a branch with a signed exam, a plan of `items` (service versions) and consent.
async function visitWith(pid: string, branch: string, versions: string[], who = DOC) {
  const doc = branch === who.branch ? who : { ...who, branch };
  // One open visit per patient and branch: a previous visit of the fixture is closed first (the board's Tutup).
  await h.admin.query(`update visits set closed_at = now(), closed_by = checked_in_by, payment = case when payment in ('in_progress','blocked') then 'done' else payment end,
                         dispensing = case when dispensing in ('in_progress','blocked') then 'done' else dispensing end,
                         treatment = case when treatment in ('in_progress','blocked') then 'done' else treatment end
                       where tenant_id = $1 and branch_id = $2 and patient_id = $3 and closed_at is null`, [A.tenantId, branch, pid]);
  const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
    [A.tenantId, branch, pid, FO.staffId])).rows[0].id as string;
  const { examId } = await as(doc, (db) => openExam(db, key(), v));
  const { planId } = await as(doc, (db) => createPlan(db, key(), examId, "Program Paket", "Kondisi rahasia"));
  const items: string[] = [];
  for (const ver of versions) items.push((await as(doc, (db) => addPlanItem(db, key(), examId, planId, { stage: 1, catalog_version_id: ver, qty: 1 }))).itemId);
  await as(doc, (db) => signRecord(db, key(), examId, STEP));
  const t = await as(doc, (db) => consentText(db, v, planId));
  await as(doc, (db) => captureConsent(db, key(), { visitId: v, planId, signer: "patient", expectedHash: t.content_hash, signature: png() }));
  return { v, items };
}
const start = (v: string, item: string, by = DOC, branch?: string) => as(branch ? { ...by, branch } : by, (db) => startTreatment(db, key(), v, { planItemId: item, performerId: by.staffId, identityConfirmed: true }));
const finish = (eid: string, outcome: "completed" | "medical_stop" | "clinic_stop" | "patient_stop" = "completed", who = DOC) =>
  as(who, (db) => finishTreatment(db, key(), eid, outcome === "completed" ? { outcome } : { outcome, reason: "Alasan berhenti uji" }));

beforeAll(async () => {
  setKekRingForTests({ current: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) });
  h = await createHarness();
  const login = h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE]));
  app = await openAppPool({ connectionString: login, max: 6 });
  worker = await openAppPool({ connectionString: login, max: 2 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); AP = await person(A, "admin_pusat"); FIN = await person(A, "finance"); AU = await person(A, "auditor");
  FH = await person(A, "facility_head", A.b1); DOC = await person(A, "doctor", A.b1, A.b2); DOC2 = await person(A, "doctor", A.b1); NUR = await person(A, "nurse", A.b1);
  BC = await person(A, "bc", A.b1); FO = await person(A, "fo_cashier", A.b1); FOB2 = await person(A, "fo_cashier", A.b2); MGR = await person(A, "manager", A.b1);  RO = await person(A, "records_officer", A.b1); BFO = await person(B, "fo_cashier", B.b1);
  await credential(A, DOC, A.b1, FH, OWN);
  await credential(A, DOC, A.b2, FH, OWN);
  await credential(A, DOC2, A.b1, FH, OWN);
  const svc = async (c: string, name: string, price: number) => {
    const v = await as(OWN, (db) => publish(db, { kind: "service", code: c }, {
      name, tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: price, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
      indications: "Indikasi", consent_template: `Templat persetujuan ${name}.`, delegation: "Dokter", aftercare_text: "Perawatan",
      eligibility: [{ role: "doctor", mode: "performs" }, { role: "nurse", mode: "performs" }],
    } as never, "Layanan baru"));
    if (v.approvalId) await as(FH, (db) => db.query(`select approval_decide($1, true, null)`, [v.approvalId]));
    return v;
  };
  ({ itemId: facial, versionId: facialV } = await svc("PK-FAC", "Facial Paket", 600_000));
  ({ itemId: laser, versionId: laserV } = await svc("PK-LAS", "Laser Paket", 1_200_000));
  peel = (await svc("PK-PEL", "Peeling Paket", 450_000)).itemId;
  pricey = (await svc("PK-PRE", "Laser Premium Paket", 800_000)).itemId;
  await as(MGR, (db) => enableMockPort(db));
}, 300_000);
afterAll(async () => {
  setKekRingForTests(undefined);
  await app?.end();
  await worker?.end();
  await owner?.end();
  await h?.close();
});

describe("scenario PR-20 and money scenario 8: expiry", () => {
  it("Rp5,000,000 for 5 sessions, Rp3,000,000 paid, 2 counted: Rp1,000,000 to balance, Rp2,000,000 cancelled, no receivable, closed", async () => {
    const { item } = await packageItem("PR20", 5_000_000, [{ serviceItemId: facial, count: 5 }]);
    const pid = await patient(A, A.b1, "Pasien Paket Kedaluwarsa");
    const { invoiceId, pkg } = await sell(FO, pid, item, 3_000_000);
    expect((await sessions(pkg)).map((s) => s.v)).toEqual([1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000]);
    for (let i = 0; i < 2; i++) {
      const { v, items } = await visitWith(pid, A.b1, [facialV]);
      await as(FO, (db) => reserveSession(db, key(), pkg, v));
      const e = await start(v, items[0]);
      await finish(e.executionId);
    }
    expect((await sessions(pkg)).map((s) => s.state)).toEqual(["redeemed", "redeemed", "available", "available", "available"]);
    await h.admin.query(`alter table packages disable trigger packages_guard`);
    await h.admin.query(`update packages set validity_end = now() - interval '1 day' where id = $1`, [pkg]);
    await h.admin.query(`alter table packages enable always trigger packages_guard`);
    expect(await runPackageExpiryScan(worker)).toBeGreaterThanOrEqual(1);
    const p = await pkgRow(pkg);
    expect([p.state, Number(p.paid_unused_moved), Number(p.remainder_cancelled)]).toEqual(["expired", 1_000_000, 2_000_000]);
    expect(await balance(pid)).toBe(1_000_000);
    expect((await sessions(pkg)).map((s) => s.state)).toEqual(["redeemed", "redeemed", "closed", "closed", "closed"]);
    // The invoice owes nothing, leaves the open list and refuses payment; no receivable exists.
    expect((await as(FO, (db) => kasirQueue(db))).open.map((x) => x.id)).not.toContain(invoiceId);
    expect(await why(pay(FO, invoiceId, 1_000))).toBe("ERR_INVALID_INPUT:overpayment");
    const ent = (await h.admin.query(`select kind, amount::int a from balance_entries where source_id = $1`, [pkg])).rows;
    expect(ent).toEqual([{ kind: "from_expiry", a: 1_000_000 }]);
    expect((await h.admin.query(`select type from domain_events where aggregate_id = $1 and type in ('PackageExpired','PackageCancelled')`, [pkg])).rows.map((r) => r.type)).toEqual(["PackageExpired"]);
    expect((await h.admin.query(`select service_identity from audit_events where object_id = $1 and reason_code = 'package_expired'`, [pkg])).rows[0].service_identity).toBe("package_expiry");
    // The scan runs only unbound and is idempotent.
    expect(await runPackageExpiryScan(worker)).toBe(0);
    expect(await code(as(FO, (db) => db.query(`select package_expiry_scan(null)`)))).toBe("raw:42501");
  });
});

describe("money scenario 5: equal split, instalment unlocking, minimum DP (BILL-7..9; CLIN-006)", () => {
  it("5 × 600,000; DP below the first session refused; 1,000,000 unlocks one session; 1,200,000 unlocks the second (ERR_SESSION_NOT_UNLOCKED before)", async () => {
    const { item } = await packageItem("S5B", 3_000_000, [{ serviceItemId: facial, count: 5 }]);
    const pid = await patient(A, A.b1);
    const { invoiceId, pkg } = await sell(FO, pid, item);
    expect(Number((await pkgRow(pkg)).min_dp)).toBe(600_000);
    expect((await sessions(pkg)).every((s) => s.state === "available")).toBe(true); // CLIN-006: credits sessions, consumes none
    expect(await why(pay(FO, invoiceId, 599_999))).toBe("ERR_MIN_DP_NOT_MET:min_dp");
    await pay(FO, invoiceId, 1_000_000);
    const { v } = await visitWith(pid, A.b1, [facialV, facialV]);
    await as(FO, (db) => reserveSession(db, key(), pkg, v));
    expect(await why(as(FO, (db) => reserveSession(db, key(), pkg, v)))).toBe("ERR_SESSION_NOT_UNLOCKED:need 200000");
    expect((await sessions(pkg)).map((s) => s.state)).toEqual(["reserved", "available", "available", "available", "available"]); // CLIN-028: nothing touched
    await pay(FO, invoiceId, 200_000);
    await as(FO, (db) => reserveSession(db, key(), pkg, v));
    expect((await sessions(pkg)).map((s) => s.state)).toEqual(["reserved", "reserved", "available", "available", "available"]);
    // A min DP %: max(first session, line × pct).
    const { item: i2 } = await packageItem("S5P", 3_000_000, [{ serviceItemId: facial, count: 5 }], { pct: 30 });
    const { pkg: p2 } = await sell(FO, await patient(A, A.b1), i2);
    expect(Number((await pkgRow(p2)).min_dp)).toBe(900_000);
  });

  it("mixed package (CLIN-010): weights by the branch price, largest remainder; only the matching service is reserved; a catalog change keeps the sessions (CLIN-011)", async () => {
    const { item, version } = await packageItem("MIX", 2_000_001, [{ serviceItemId: facial, count: 2 }, { serviceItemId: laser, count: 1 }]);
    const pid = await patient(A, A.b1);
    const { invoiceId, pkg } = await sell(FO, pid, item, 2_000_001);
    // Weights 600,000 / 600,000 / 1,200,000 of 2,000,001: 500,000.25 / 500,000.25 / 1,000,000.5 → the +1 to the largest remainder (the laser).
    expect((await sessions(pkg)).map((s) => s.v)).toEqual([500_000, 500_000, 1_000_001]);
    const { v } = await visitWith(pid, A.b1, [laserV]);
    await as(FO, (db) => reserveSession(db, key(), pkg, v, laser));
    expect((await sessions(pkg)).map((s) => s.state)).toEqual(["available", "available", "reserved"]);
    // The sold version's contents are frozen; a new version carries them; the sold sessions keep their snapshot.
    expect(await code(as(OWN, (db) => setPackageContents(db, key(), version, [{ serviceItemId: facial, count: 1 }])))).toBe("ERR_VERSION_CONFLICT");
    const nv = await as(OWN, (db) => publish(db, { itemId: item }, { name: "Paket MIX", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 2_500_000 } as never, "Harga baru"));
    expect((await as(AP, (db) => packageContents(db, nv.versionId))).rows.map((r) => [r.service_item_id, r.count])).toEqual([[facial, 2], [laser, 1]]);
    expect((await sessions(pkg)).map((s) => s.v)).toEqual([500_000, 500_000, 1_000_001]);
    void invoiceId;
  });

  it("an empty package and a contents row that is not a service are refused; only owner and admin pusat edit contents", async () => {
    const v = await as(OWN, (db) => publish(db, { kind: "package", code: "EMP" }, { name: "Paket Kosong", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 100_000 } as never, "Baru"));
    const pEmp = await patient(A, A.b1);
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pEmp }));
    expect(await why(as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: v.itemId, quantity: 1 }])))).toBe("ERR_INVALID_INPUT:package_empty");
    expect(await code(as(OWN, (db) => setPackageContents(db, key(), v.versionId, [{ serviceItemId: v.itemId, count: 1 }])))).toBe("ERR_INVALID_INPUT");
    for (const p of [FO, MGR, FIN, DOC]) expect(await code(as(p, (db) => setPackageContents(db, key(), v.versionId, [{ serviceItemId: facial, count: 1 }]))), p.role).toBe("ERR_FORBIDDEN");
    await as(AP, (db) => setPackageContents(db, key(), v.versionId, [{ serviceItemId: facial, count: 1 }]));
    // A package invoice is one package line of quantity 1, for a patient, with no visit.
    const pid = await patient(A, A.b1);
    const { invoiceId: i2 } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid }));
    expect(await why(as(FO, (db) => issueKasirInvoice(db, key(), i2, [{ itemId: v.itemId, quantity: 2 }])))).toBe("ERR_INVALID_INPUT:package_invoice");
    const { invoiceId: i3 } = await as(FO, (db) => openKasirInvoice(db, key(), { counter: true }));
    expect(await why(as(FO, (db) => issueKasirInvoice(db, key(), i3, [{ itemId: v.itemId, quantity: 1 }])))).toMatch(/ERR_INVALID_INPUT:(package_invoice|counter_products_only)/);
  });
});

describe("reserve, redeem, release (B-15, BILL-24, PR-14, CLIN-007/009/028; scenario 7d)", () => {
  it("a reserved session pays the start; counted redeems it; a medical or clinic stop returns it (no blocker); a patient stop counts", async () => {
    const { item } = await packageItem("S7D", 3_000_000, [{ serviceItemId: facial, count: 5 }]);
    const pid = await patient(A, A.b1);
    const { pkg } = await sell(FO, pid, item, 3_000_000);
    const run = async (outcome: "completed" | "medical_stop" | "clinic_stop" | "patient_stop") => {
      const { v, items } = await visitWith(pid, A.b1, [facialV]);
      expect((await as(DOC, (db) => getTreatment(db, v))).items[0].blockers).toEqual([]); // no selection: allowed (DEC-074)
      await as(FO, (db) => reserveSession(db, key(), pkg, v));
      const e = await start(v, items[0]);
      await finish(e.executionId, outcome);
      return { v, e: e.executionId };
    };
    const c = await run("completed");
    const m = await run("medical_stop");
    const k = await run("clinic_stop");
    const p = await run("patient_stop");
    expect((await sessions(pkg)).map((s) => s.state)).toEqual(["redeemed", "redeemed", "available", "available", "available"]);
    expect((await h.admin.query(`select blocker from visits where id = $1`, [k.v])).rows[0].blocker).toBeNull();
    const ev = (await h.admin.query(`select type from domain_events where type in ('SessionRedeemed','SessionReleased') and payload ->> 'package_id' = $1 order by occurred_at, id`, [pkg])).rows;
    expect(ev.map((x) => x.type)).toEqual(["SessionRedeemed", "SessionReleased", "SessionReleased", "SessionRedeemed"]);
    // A returned execution is still the package's: it cannot be moved to balance (r3 1), even when the visit also has a
    // fully paid ordinary line of the same service.
    expect(await why(as(FO, (db) => interruptedToBalance(db, key(), m.e)))).toBe("ERR_VERSION_CONFLICT:not_movable");
    // A medical stop of a package session on a visit (still open) that also has a fully paid ordinary facial line.
    const w = await visitWith(pid, A.b1, [facialV, facialV]);
    const { invoiceId: oi } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: w.v }));
    await as(FO, (db) => issueKasirInvoice(db, key(), oi, [{ itemId: facial, quantity: 1 }]));
    await pay(FO, oi, 600_000);
    await as(FO, (db) => reserveSession(db, key(), pkg, w.v));
    const ew = await start(w.v, w.items[0]);
    await finish(ew.executionId, "medical_stop");
    expect(await why(as(FO, (db) => interruptedToBalance(db, key(), ew.executionId)))).toBe("ERR_VERSION_CONFLICT:not_movable");
    void c; void p;
  });

  it("CLIN-009 release; the visit close releases an unbound session; the in-treatment guard; one session covers one item", async () => {
    const { item } = await packageItem("S9", 1_200_000, [{ serviceItemId: facial, count: 2 }]);
    const pid = await patient(A, A.b1);
    const { pkg } = await sell(FO, pid, item, 600_000);
    const { v, items } = await visitWith(pid, A.b1, [facialV, facialV]);
    const r = await as(FO, (db) => reserveSession(db, key(), pkg, v));
    await as(FO, (db) => releaseSession(db, key(), r.sessionId));
    expect((await sessions(pkg))[0].state).toBe("available");
    await as(FO, (db) => reserveSession(db, key(), pkg, v));
    const e = await start(v, items[0]);
    expect(await blocked(start(v, items[1]))).toEqual(["payment_unpaid"]); // only one session: the second item is unpaid
    // A plan item of quantity 2 is not covered by a free session (r2 F5): with a second session paid and reserved on the
    // visit, the qty-1 item would be covered; the same item at qty 2 is not.
    const q2 = items[1];
    await pay(FO, (await h.admin.query(`select invoice_id from packages where id = $1`, [pkg])).rows[0].invoice_id, 600_000);
    const second = await as(FO, (db) => reserveSession(db, key(), pkg, v));
    expect((await h.admin.query(`select (package_covering_session($1, $2, $3)).id`, [A.tenantId, v, q2])).rows[0].id).toBe(second.sessionId);
    await h.admin.query(`alter table plan_items disable trigger plan_items_guard`);
    await h.admin.query(`update plan_items set qty = 2 where id = $1`, [q2]);
    await h.admin.query(`alter table plan_items enable always trigger plan_items_guard`);
    expect((await h.admin.query(`select (package_covering_session($1, $2, $3)).id`, [A.tenantId, v, q2])).rows[0].id).toBeNull();
    await as(FO, (db) => releaseSession(db, key(), second.sessionId));
    const bound = (await h.admin.query(`select id from package_sessions where package_id = $1 and reserved_execution_id is not null`, [pkg])).rows[0].id as string;
    expect(await why(as(FO, (db) => releaseSession(db, key(), bound)))).toBe("ERR_VERSION_CONFLICT:session_in_treatment");
    expect(await why(as(MGR, (db) => cancelPackage(db, key(), pkg, "Pasien pindah kota")))).toBe("ERR_VERSION_CONFLICT:session_in_treatment");
    await finish(e.executionId);
    // Another visit: reserved, not started, the visit closes → released.
    const w = await visitWith(pid, A.b1, [facialV]);
    await as(FO, (db) => reserveSession(db, key(), pkg, w.v));
    expect(await why(as(FO, (db) => closeVisit(db, key(), w.v)))).toBe("ok");
    expect((await sessions(pkg)).map((s) => s.state)).toEqual(["redeemed", "available"]);
  });

  it("concurrent reservations within the paid value for one more session: exactly one wins", async () => {
    const { item } = await packageItem("CNC", 1_200_000, [{ serviceItemId: facial, count: 2 }]);
    const pid = await patient(A, A.b1);
    const { pkg } = await sell(FO, pid, item, 600_000);
    const v1 = await visitWith(pid, A.b1, [facialV]);
    const v2 = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
      [A.tenantId, A.b2, pid, FOB2.staffId])).rows[0].id as string;
    const res = await Promise.all([code(as(FO, (db) => reserveSession(db, key(), pkg, v1.v))), code(as(FOB2, (db) => reserveSession(db, key(), pkg, v2)))]);
    expect(res.sort()).toEqual(["ERR_SESSION_NOT_UNLOCKED", "ok"]);
  });

  it("money scenario 11: sold at branch 1, redeemed at branch 2 (the executing branch recorded)", async () => {
    const { item } = await packageItem("S11", 3_000_000, [{ serviceItemId: facial, count: 5 }]);
    const pid = await patient(A, A.b1);
    const { pkg } = await sell(FO, pid, item, 3_000_000);
    // Another patient's open visit cannot hold this patient's session (CLIN-028: nothing touched).
    const other = await patient(A, A.b1);
    const ov = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
      [A.tenantId, A.b1, other, FO.staffId])).rows[0].id as string;
    expect(await why(as(FO, (db) => reserveSession(db, key(), pkg, ov)))).toBe("ERR_NOT_FOUND:package not found");
    expect((await sessions(pkg)).every((x) => x.state === "available")).toBe(true);
    const { v, items } = await visitWith(pid, A.b2, [facialV]);
    await as(FOB2, (db) => reserveSession(db, key(), pkg, v));
    const e = await start(v, items[0], DOC, A.b2);
    await as({ ...DOC, branch: A.b2 }, (db) => finishTreatment(db, key(), e.executionId, { outcome: "completed" }));
    const s = (await sessions(pkg))[0];
    expect([s.state, s.rb]).toEqual(["redeemed", A.b2]);
    expect((await pkgRow(pkg)).sold_branch_id).toBe(A.b1);
  });

  it("simulated port money never counts as paid: no unlock, no VAT (BILL-29)", async () => {
    const { item } = await packageItem("SIM", 1_200_000, [{ serviceItemId: facial, count: 2 }]);
    const pid = await patient(A, A.b1);
    const { invoiceId, pkg } = await sell(FO, pid, item);
    const c = await as(FO, (db) => createCharge(db, key(), invoiceId, { channel: "qris" }));
    const w = await as(FO, (db) => simulate(db, c.charge_id, "paid", A.tenantId));
    await receiveMockWebhook(worker, w.rawBody, w.headers[SIGNATURE_HEADER], "local");
    const { v } = await visitWith(pid, A.b1, [facialV]);
    expect(await code(as(FO, (db) => reserveSession(db, key(), pkg, v)))).toBe("ERR_SESSION_NOT_UNLOCKED");
    // A port charge below the minimum DP on a fresh package is refused.
    const { invoiceId: i2 } = await sell(FO, await patient(A, A.b1), item);
    expect(await code(as(FO, (db) => createCharge(db, key(), i2, { channel: "qris", amount: 1_000 })))).toBe("ERR_MIN_DP_NOT_MET");
  });
});

describe("money scenarios 2 and 7: interrupted single treatment (BILL-14, BILL-25)", () => {
  async function paidVisit(pid: string) {
    const { v, items } = await visitWith(pid, A.b1, [facialV]);
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: facial, quantity: 1 }]));
    await pay(FO, invoiceId, 600_000);
    return { v, item: items[0], invoiceId };
  }
  it("2: paid, completed and counted (nothing moves); 7a medical stop → balance once; 7b clinic stop → balance and the blocker clears; 7c patient stop counted", async () => {
    const pid = await patient(A, A.b1);
    const s2 = await paidVisit(pid);
    const e2 = await start(s2.v, s2.item);
    await finish(e2.executionId);
    expect(await why(as(FO, (db) => interruptedToBalance(db, key(), e2.executionId)))).toBe("ERR_VERSION_CONFLICT:not_movable");
    expect(await why(as(FO, (db) => closeVisit(db, key(), s2.v)))).toBe("ok");
    const a = await paidVisit(pid);
    const ea = await start(a.v, a.item);
    await finish(ea.executionId, "medical_stop");
    expect((await as(FO, (db) => interruptedToBalance(db, key(), ea.executionId))).amount).toBe(600_000);
    expect(await balance(pid)).toBe(600_000);
    expect(await why(as(FO, (db) => interruptedToBalance(db, key(), ea.executionId)))).toBe("ERR_VERSION_CONFLICT:already_moved");
    expect(Number((await h.admin.query(`select moved_to_balance from invoice_lines where invoice_id = $1`, [a.invoiceId])).rows[0].moved_to_balance)).toBe(600_000);
    const b = await paidVisit(pid);
    const eb = await start(b.v, b.item);
    await finish(eb.executionId, "clinic_stop");
    expect((await h.admin.query(`select blocker from visits where id = $1`, [b.v])).rows[0].blocker).not.toBeNull();
    await as(MGR, (db) => interruptedToBalance(db, key(), eb.executionId));
    expect((await h.admin.query(`select blocker from visits where id = $1`, [b.v])).rows[0].blocker).toBeNull();
    expect(await balance(pid)).toBe(1_200_000);
    const c = await paidVisit(pid);
    const ec = await start(c.v, c.item);
    await finish(ec.executionId, "patient_stop");
    expect(await why(as(FO, (db) => interruptedToBalance(db, key(), ec.executionId)))).toBe("ERR_VERSION_CONFLICT:not_movable");
    for (const p of [DOC, NUR, BC, FIN]) expect(await code(as(p, (db) => interruptedToBalance(db, key(), ea.executionId))), p.role).toBe("ERR_FORBIDDEN");
  });
});

describe("money scenario 12: substitution (BILL-11)", () => {
  it("12b cheaper: the difference to balance, the effective paid value drops (no double move at close); 12a dearer: a difference line to pay before the start", async () => {
    const { item } = await packageItem("S12", 3_000_000, [{ serviceItemId: facial, count: 5 }]);
    const pid = await patient(A, A.b1);
    const { invoiceId, pkg } = await sell(FO, pid, item, 3_000_000);
    const ss = (await h.admin.query(`select id from package_sessions where package_id = $1 order by seq`, [pkg])).rows.map((r) => r.id as string);
    // 12b: 600,000 → peel at 450,000: 150,000 to balance.
    const { substitutionId: u1 } = await as(FO, (db) => requestSubstitution(db, key(), ss[0], peel, "Kulit lebih sensitif"));
    expect(await code(as(FO, (db) => decideSubstitution(db, key(), u1, true, null)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(BC, (db) => decideSubstitution(db, key(), u1, true, null)))).toBe("ERR_FORBIDDEN");
    await as(DOC, (db) => decideSubstitution(db, key(), u1, true, null));
    expect(await balance(pid)).toBe(150_000);
    expect((await sessions(pkg))[0].v).toBe(450_000);
    expect(Number((await pkgRow(pkg)).moved_to_balance)).toBe(150_000);
    // 12a: session 2 → the premium laser at 800,000: a 200,000 difference line; the start waits for it.
    const { substitutionId: u2 } = await as(BC, (db) => requestSubstitution(db, key(), ss[1], pricey, "Hasil lebih baik"));
    expect(await code(as(BC, (db) => decideSubstitution(db, key(), u2, true, null)))).toBe("ERR_FORBIDDEN");
    const d = await as(FH, (db) => decideSubstitution(db, key(), u2, true, null));
    expect(d.difference).toBe(200_000);
    const premiumV = (await h.admin.query(`select id from catalog_versions where item_id = $1 and state = 'active'`, [pricey])).rows[0].id;
    const { v, items } = await visitWith(pid, A.b1, [premiumV]);
    await as(FO, (db) => reserveSession(db, key(), pkg, v, pricey));
    expect(await blocked(start(v, items[0]))).toEqual(["payment_unpaid"]);
    const { invoiceId: di } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    expect(await why(as(FO, (db) => issueKasirInvoice(db, key(), di, [{ itemId: pricey, quantity: 1, substitutionId: crypto.randomUUID() }])))).toBe("ERR_NOT_FOUND:substitution not found");
    // A pending (undecided) dearer substitution cannot be billed yet.
    const { substitutionId: u3 } = await as(FO, (db) => requestSubstitution(db, key(), ss[2], pricey, "Coba lebih mahal"));
    const { invoiceId: di3 } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid }));
    expect(await why(as(FO, (db) => issueKasirInvoice(db, key(), di3, [{ itemId: pricey, quantity: 1, substitutionId: u3 }])))).toBe("ERR_NOT_FOUND:substitution not found");
    await as(FO, (db) => issueKasirInvoice(db, key(), di, [{ itemId: pricey, quantity: 1, substitutionId: u2 }]));
    expect(Number((await h.admin.query(`select line_total from invoice_lines where invoice_id = $1`, [di])).rows[0].line_total)).toBe(200_000);
    await pay(FO, di, 200_000);
    const e = await start(v, items[0]);
    await finish(e.executionId);
    // Close the package: paid 3,000,000 − moved 150,000 − redeemed 600,000 = 2,250,000 to balance (the 150,000 not twice).
    const r = await as(MGR, (db) => cancelPackage(db, key(), pkg, "Pasien pindah kota"));
    expect([r.to_balance, r.cancelled]).toEqual([2_250_000, 0]);
    expect(await balance(pid)).toBe(2_400_000);
    // A declined request needs a reason; the requester never decides.
    void invoiceId;
  });
});

describe("money scenario 13 and the top-up (balance funds a package)", () => {
  it("Isi Saldo: a KW receipt and a payment with no invoice; then the balance pays the first instalment and a session is redeemed", async () => {
    const pid = await patient(A, A.b1, "Pasien Isi Saldo");
    const t = await as(FO, (db) => topUpBalance(db, key(), pid, null, { method: "cash", amount: 1_000_000, cashTendered: 1_000_000 }));
    expect(t.number).toMatch(/^KW-/);
    expect(await balance(pid)).toBe(1_000_000);
    const pay0 = (await h.admin.query(`select invoice_id, method, patient_id from payments where receipt_id = $1`, [t.receipt_id])).rows[0];
    expect(pay0).toEqual({ invoice_id: null, method: "cash", patient_id: pid });
    expect((await h.admin.query(`select count(*)::int c from invoice_lines l join invoices i on i.id = l.invoice_id where i.patient_id = $1`, [pid])).rows[0].c).toBe(0); // not turnover
    const { item } = await packageItem("S13", 3_000_000, [{ serviceItemId: facial, count: 5 }]);
    const { invoiceId, pkg } = await sell(FO, pid, item);
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "balance", amount: 600_000 }]));
    expect(await balance(pid)).toBe(400_000);
    const { v, items } = await visitWith(pid, A.b1, [facialV]);
    await as(FO, (db) => reserveSession(db, key(), pkg, v));
    const e = await start(v, items[0]);
    await finish(e.executionId);
    expect((await sessions(pkg))[0].state).toBe("redeemed");
    // A payment with no invoice must be a top-up (the guard below the writer).
    expect(await code(h.admin.query(
      `insert into payments (tenant_id, branch_id, receipt_id, seq, invoice_id, patient_id, method, amount, environment, is_simulated, received_by, received_as, received_at)
       values ($1, $2, $3, 2, null, $4, 'balance', 1000, 'local', false, $5, 'fo_cashier', now())`, [A.tenantId, A.b1, t.receipt_id, pid, FO.staffId]))).toBe("raw:42501");
    // Even a top-up-shaped row (same receipt, patient, amount) is refused when its method is not cash, EDC or transfer (balance here;
    // a port method is refused earlier by the charge rule).
    const tu = (await h.admin.query(`select amount::int a from balance_top_ups where receipt_id = $1`, [t.receipt_id])).rows[0].a;
    expect(await h.admin.query(
      `insert into payments (tenant_id, branch_id, receipt_id, seq, invoice_id, patient_id, method, amount, environment, is_simulated, received_by, received_as, received_at)
       values ($1, $2, $3, 2, null, $4, 'balance', $6, 'local', false, $5, 'fo_cashier', now())`, [A.tenantId, A.b1, t.receipt_id, pid, FO.staffId, tu])
      .then(() => "ok", (e) => e.message)).toBe("a payment with no invoice is a balance top-up");
    for (const p of [DOC, BC, AU]) expect(await code(as(p, (db) => topUpBalance(db, key(), pid, null, { method: "edc", amount: 1_000 }))), p.role).toBe("ERR_FORBIDDEN");
    // Owner and finance (tenant-wide, no branch role) top up too: the named branch, else the first by name (review F1).
    const o1 = await as(OWN, (db) => topUpBalance(db, key(), pid, null, { method: "edc", amount: 1_000 }));
    const f1 = await as(FIN, (db) => topUpBalance(db, key(), pid, A.b2, { method: "transfer", amount: 2_000 }));
    const br = (await h.admin.query(`select receipt_id, branch_id from balance_top_ups where receipt_id = any($1::uuid[])`, [[o1.receipt_id, f1.receipt_id]])).rows;
    expect(Object.fromEntries(br.map((r) => [r.receipt_id, r.branch_id]))).toEqual({ [o1.receipt_id]: A.b1, [f1.receipt_id]: A.b2 });
    // One allocation per top-up payment (review F2): a second allocation of the same top-up is refused below the writer.
    const pay1 = (await h.admin.query(`select id, branch_id from payments where receipt_id = $1`, [o1.receipt_id])).rows[0];
    expect(await h.admin.query(
      `insert into payment_allocations (tenant_id, branch_id, payment_id, top_up_id, amount, vat_portion, method, environment, is_simulated)
       select tenant_id, branch_id, payment_id, top_up_id, amount, 0, method, environment, false from payment_allocations where payment_id = $1`, [pay1.id])
      .then(() => "ok", (e) => e.message)).toBe("a top-up allocation names its top-up");
  });
});

describe("tax facts (scenarios 16 and 19; PENDING Q-05)", () => {
  async function pkpTenant() {
    const C = await tenant();
    const own = await person(C, "owner");
    const fin = await person(C, "finance");
    const fo = await person(C, "fo_cashier", C.b1);
    const fh = await person(C, "facility_head", C.b1);
    const doc = await person(C, "doctor", C.b1);
    await credential(C, doc, C.b1, fh, own);
    const s = await as(own, (db) => publish(db, { kind: "service", code: "TX-SVC" }, {
      name: "Layanan Kena Pajak", tax_category: "taxable_service", tax_basis: "Jasa", normal_price: 666_000, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
      indications: "Indikasi", consent_template: "Templat persetujuan.", delegation: "Dokter", aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }],
    } as never, "Baru"));
    if (s.approvalId) await as(fh, (db) => db.query(`select approval_decide($1, true, null)`, [s.approvalId]));
    const pk = await as(own, (db) => publish(db, { kind: "package", code: "TX-PKG" }, { name: "Paket Kena Pajak", tax_category: "taxable_service", tax_basis: "Jasa", normal_price: 3_330_000 } as never, "Baru"));
    await as(own, (db) => setPackageContents(db, key(), pk.versionId, [{ serviceItemId: s.itemId, count: 5 }]));
    const pdf = Buffer.from(`%PDF-1.7\nsaran pajak ${++n}\n%%EOF\n`);
    const { fileId } = await as(fin, (db) => uploadEvidence(db, { obligationKey: "tax_advice", fileName: "saran.pdf", content: pdf, expertName: "Konsultan Pajak Sintetis", documentDate: "2026-10-01" }));
    const it = (await h.admin.query(`select item_id from evidence_files where id = $1`, [fileId])).rows[0].item_id;
    await as(own, (db) => decideEvidence(db, it, fileId, "approved"));
    const becomePkp = async () => {
      await h.admin.query("alter table tax_profile_changes disable trigger tax_profile_changes_guard");
      await h.admin.query("alter table tenants disable trigger tenants_tax_guard");
      await as(own, (db) => setTaxProfile(db, key(), { isPkp: true, pkpEffectiveFrom: tomorrowWib(), npwp: NPWP, reason: "PKP" }));
      await h.admin.query(`update tax_profile_changes set pkp_effective_from = $2::date - 1, changed_at = now() - interval '2 days' where tenant_id = $1`, [C.tenantId, today()]);
      await h.admin.query(`update tenants set pkp_effective_from = $2::date - 1 where id = $1`, [C.tenantId, today()]);
      await h.admin.query("alter table tax_profile_changes enable always trigger tax_profile_changes_guard");
      await h.admin.query("alter table tenants enable always trigger tenants_tax_guard");
    };
    return { C, own, fo, doc, svcV: s.versionId, pkgItem: pk.itemId, becomePkp };
  }

  it("19: a PKP package paid for 3 sessions recognises their VAT; expired with 1 redeemed, the unredeemed sessions' VAT is reversed; the balance is gross", async () => {
    const x = await pkpTenant();
    await x.becomePkp();
    const pid = await patient(x.C, x.C.b1);
    const { invoiceId } = await as(x.fo, (db) => openKasirInvoice(db, key(), { patientId: pid }));
    await as(x.fo, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: x.pkgItem, quantity: 1 }]));
    const pkg = (await h.admin.query(`select id from packages where invoice_id = $1`, [invoiceId])).rows[0].id;
    expect((await sessions(pkg)).map((s) => [s.v, s.vat])).toEqual(Array(5).fill([666_000, 66_000]));
    await as(x.fo, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 1_998_000, cashTendered: 1_998_000 }]));
    expect((await sessions(pkg)).map((s) => s.rec)).toEqual([66_000, 66_000, 66_000, 0, 0]);
    await h.admin.query(`alter table packages disable trigger packages_guard`);
    await h.admin.query(`update packages set validity_end = now() - interval '1 day' where id = $1`, [pkg]);
    await h.admin.query(`alter table packages enable always trigger packages_guard`);
    await runPackageExpiryScan(worker);
    const p = await pkgRow(pkg);
    expect([Number(p.paid_unused_moved), Number(p.vat_reversed_amount)]).toEqual([1_998_000, 198_000]);
    expect(await balance(pid)).toBe(1_998_000);
  });

  it("16: a package sold before PKP has no VAT; a session redeemed after PKP (gate open) records its delivery VAT", async () => {
    const x = await pkpTenant();
    const pid = await patient(x.C, x.C.b1);
    const { invoiceId } = await as(x.fo, (db) => openKasirInvoice(db, key(), { patientId: pid }));
    await as(x.fo, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: x.pkgItem, quantity: 1 }]));
    await as(x.fo, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 3_330_000, cashTendered: 3_330_000 }]));
    const pkg = (await h.admin.query(`select id from packages where invoice_id = $1`, [invoiceId])).rows[0].id;
    expect((await sessions(pkg)).map((s) => s.vat)).toEqual([0, 0, 0, 0, 0]);
    await x.becomePkp();
    const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
      [x.C.tenantId, x.C.b1, pid, x.fo.staffId])).rows[0].id as string;
    const { examId } = await as(x.doc, (db) => openExam(db, key(), v));
    const { planId } = await as(x.doc, (db) => createPlan(db, key(), examId, "Program", "Kondisi"));
    const { itemId } = await as(x.doc, (db) => addPlanItem(db, key(), examId, planId, { stage: 1, catalog_version_id: x.svcV, qty: 1 }));
    await as(x.doc, (db) => signRecord(db, key(), examId, STEP));
    const t = await as(x.doc, (db) => consentText(db, v, planId));
    await as(x.doc, (db) => captureConsent(db, key(), { visitId: v, planId, signer: "patient", expectedHash: t.content_hash, signature: png() }));
    await as(x.fo, (db) => reserveSession(db, key(), pkg, v));
    const e = await as(x.doc, (db) => startTreatment(db, key(), v, { planItemId: itemId, performerId: x.doc.staffId, identityConfirmed: true }));
    await as(x.doc, (db) => finishTreatment(db, key(), e.executionId, { outcome: "completed" }));
    const s1 = (await sessions(pkg))[0];
    expect([s1.state, s1.vat, s1.rec]).toEqual(["redeemed", 66_000, 66_000]);
    // Later payments or syncs never overwrite it (r3 2): the package invoice was not PKP at issue.
    expect((await sessions(pkg))[1].vat).toBe(0);
  });
});

describe("closing, voiding, merging, reading", () => {
  it("a zero paid-unused cancel (nothing paid) moves nothing and cancels the remainder; a void of an unpaid package invoice cancels the package", async () => {
    const { item } = await packageItem("ZRO", 1_200_000, [{ serviceItemId: facial, count: 2 }]);
    const pid = await patient(A, A.b1);
    const { invoiceId, pkg } = await sell(FO, pid, item);
    expect(await code(as(FO, (db) => cancelPackage(db, key(), pkg, "Batal beli")))).toBe("ERR_FORBIDDEN");
    expect(await why(as(MGR, (db) => cancelPackage(db, key(), pkg, "x")))).toBe("ERR_INVALID_INPUT:reason");
    const r = await as(MGR, (db) => cancelPackage(db, key(), pkg, "Batal beli"));
    expect([r.to_balance, r.cancelled]).toEqual([0, 1_200_000]);
    expect(await balance(pid)).toBe(0);
    expect(await why(as(MGR, (db) => cancelPackage(db, key(), pkg, "Batal beli")))).toBe("ERR_VERSION_CONFLICT:package_closed");
    void invoiceId;
    const { invoiceId: i2, pkg: p2 } = await sell(FO, pid, item);
    const { approvalId } = await as(FO, (db) => requestVoid(db, key(), i2, "Salah input paket"));
    await as(MGR, (db) => decideApproval(db, approvalId, true));
    expect((await pkgRow(p2)).state).toBe("cancelled");
  });

  it("patient merge: a package bought by the duplicate is read and reserved under the survivor; its close credits the survivor", async () => {
    const surv = await patient(A, A.b1, "Pasien Utama Paket");
    const dup = await patient(A, A.b1, "Pasien Ganda Paket");
    const { item } = await packageItem("MRG", 1_200_000, [{ serviceItemId: facial, count: 2 }]);
    const { pkg } = await sell(FO, dup, item, 1_200_000);
    expect((await pkgRow(pkg)).patient_id).toBe(dup);
    await as(RO, (db) => mergePatients(db, key(), surv, dup, "Rekam ganda pasien yang sama"));
    const got = await as(FO, (db) => patientPackages(db, surv));
    expect(got.packages.map((x) => x.id)).toContain(pkg);
    const { v } = await visitWith(surv, A.b1, [facialV]);
    await as(FO, (db) => reserveSession(db, key(), pkg, v));
    const r = await as(MGR, (db) => cancelPackage(db, key(), pkg, "Pasien pindah kota"));
    expect(r.to_balance).toBe(1_200_000);
    expect((await as(FO, (db) => patientBalance(db, surv))).balance).toBe(1_200_000);
    expect(await balance(dup)).toBe(0);
  });

  it("readers: Paket & Saldo for the cashier roles (auditor masked), search; other roles and tenants refused; RLS", async () => {
    const pid = await patient(A, A.b1, "Pasien Paket Rahasia");
    const { item } = await packageItem("RDR", 1_200_000, [{ serviceItemId: facial, count: 2 }]);
    const { pkg } = await sell(FO, pid, item, 600_000);
    for (const p of [FO, FOB2, MGR, OWN, FIN]) {
      const g = await as(p, (db) => patientPackages(db, pid));
      expect([g.patient?.name, g.packages[0].id, g.packages[0].paid, g.packages[0].unlocked_value], p.role).toEqual(["Pasien Paket Rahasia", pkg, 600_000, 600_000]);
    }
    const au = await as(AU, (db) => patientPackages(db, pid));
    expect([au.patient?.name ?? null, au.packages[0].paid]).toEqual([null, 600_000]);
    expect((await as(FO, (db) => searchPatients(db, "Paket Rahasia"))).map((x) => x.id)).toContain(pid);
    for (const p of [DOC, NUR, BC, AP, RO]) expect(await code(as(p, (db) => patientPackages(db, pid))), p.role).toBe("ERR_FORBIDDEN");
    expect(await code(as(BFO, (db) => patientPackages(db, pid)))).toBe("ERR_NOT_FOUND");
    const sees = async (p: P) => (await as(p, (db) => db.query(`select id from packages where id = $1`, [pkg]))).rowCount;
    expect([await sees(FO), await sees(FOB2), await sees(OWN), await sees(AU), await sees(DOC), await sees(BFO)]).toEqual([1, 1, 1, 1, 0, 0]);
    expect(await code(as(FO, (db) => db.query(`select close_reason from packages limit 1`)))).toBe("raw:42501");
    expect(await code(as(FO, (db) => db.query(`select package_open(null::invoices, null, null, now())`)))).toBe("raw:42501");
  });
});
