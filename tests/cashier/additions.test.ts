// T-074 Done-when: scenarios PR-15 alerts and PR-15 cannot close unpaid, CLIN-020, CLIN-025, the domain part of money
// scenario 3 (3a: an addition of Rp400,000 authorized, agreed, released before payment, performed, then paid by EDC the
// same visit) and the PR-7 unpaid-addition blocker. Plus the plan reviews: the release record (BILL-22: clinician,
// agreement, releasing FO, collector) and its refusals; the per-item payment rule at start (a released addition starts
// before its own payment, never before the initial bill; an unreleased one waits for its paid line; an unpaid addition
// never blocks paid initial items); the addition invoice (only addition lines, matching item and quantity, billed once,
// visit invoices only); the performed-but-unbilled addition owing (board, payment step, close blocker named first); the
// second alert once per execution, never for a non-counted stop or a paid addition; simulated or partial payments leave
// it unpaid; no clinical text in alerts, events or the reader; readers per role, branch and tenant. Receivable
// conversion is T-078's. Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { setKekRingForTests } from "../../src/lib/keys/runtime";
import { decideApproval } from "../../src/modules/approvals/approvals";
import { releaseAddition, visitAdditions } from "../../src/modules/cashier/additions/additions";
import { issueKasirInvoice, kasirInvoice, kasirQueue, openKasirInvoice, receivePayment, requestVoid } from "../../src/modules/cashier/kasir/kasir";
import { publish } from "../../src/modules/catalog/catalog";
import { captureConsent, consentText } from "../../src/modules/clinical/consent/consent";
import { addPlanItem, createPlan, openExam } from "../../src/modules/clinical/exam/exam";
import { signRecord, type StepUp } from "../../src/modules/clinical/records/records";
import { createRequest, decideRequest } from "../../src/modules/clinical/requests/requests";
import { saveItem } from "../../src/modules/inventory/stock";
import { list as listNotifications } from "../../src/modules/notifications/notifications";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { SIGNATURE_HEADER } from "../../src/modules/payments/mock";
import { createCharge, enableMockPort, receiveMockWebhook, simulate } from "../../src/modules/payments/payments";
import { confirmSelection } from "../../src/modules/pharmacy/pharmacy";
import { blockersOf, finishTreatment, getTreatment, startTreatment } from "../../src/modules/treatment/treatment";
import { closeBlocker, closeVisit, today } from "../../src/modules/visits/visits";
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
const EDC = { card_type: "debit", bank: "BCA", trace: "123456", approval_code: "A1B2C3" };

async function tenant(): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Tambahan Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("TB1"), b2: await br("TB2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`add${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Tambahan ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const key = () => crypto.randomUUID();
const why = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason ?? ""}` : `raw:${e.code ?? e.message}`));
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const blocked = (x: Promise<unknown>) => x.then(() => [] as string[], (e) => blockersOf(e));
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
async function patient(t: T, branch: string, name: string): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "");
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $5, '1990-01-01', 'female', 'nik', $3, $4, 'islam', 'Karyawan', 's1', 'kawin', $2,
             (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id`,
    [t.tenantId, branch, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43), name])).rows[0].id as string;
}
const consent = async (v: string, planId: string) => {
  const t = await as(DOC, (db) => consentText(db, v, planId));
  await as(DOC, (db) => captureConsent(db, key(), { visitId: v, planId, signer: "patient", expectedHash: t.content_hash, signature: png() }));
};
// A visit with a signed exam, a plan of one initial item (facial ×1), the consent, the selection confirmed and the
// initial bill issued and (optionally) paid in cash.
async function visitReady(o: { pay?: boolean; name?: string } = {}) {
  const pid = await patient(A, A.b1, o.name ?? "Pasien Tambahan");
  const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
    [A.tenantId, A.b1, pid, FO.staffId])).rows[0].id as string;
  const { examId } = await as(DOC, (db) => openExam(db, key(), v));
  const { planId } = await as(DOC, (db) => createPlan(db, key(), examId, "Program Tambahan", "Kondisi rahasia pasien"));
  const { itemId } = await as(DOC, (db) => addPlanItem(db, key(), examId, planId, { stage: 1, catalog_version_id: facialV, qty: 1 }));
  await as(DOC, (db) => signRecord(db, key(), examId, STEP));
  await consent(v, planId);
  await as(BC, (db) => confirmSelection(db, key(), v, { items: [{ planItemId: itemId }] }));
  const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
  await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: facial, quantity: 1 }]));
  if (o.pay !== false) await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 500_000, cashTendered: 500_000 }]));
  return { pid, v, examId, planId, itemId, invoiceId };
}
type S = Awaited<ReturnType<typeof visitReady>>;
// The nurse proposes an addition in the room; the doctor approves; the patient agrees (a new consent covering it).
async function addition(s: S, o: { version?: string; qty?: number; agree?: boolean; approve?: boolean } = {}) {
  const { requestId } = await as(NUR, (db) => createRequest(db, key(), s.v, {
    kind: "addition", planId: s.planId, catalogVersionId: o.version ?? fillerV, stage: 1, qty: o.qty ?? 1, reason: "Lipatan nasolabial dalam",
  }));
  if (o.approve === false) return { requestId, itemId: "" };
  const d = await as(DOC, (db) => decideRequest(db, key(), requestId, true, null));
  const itemId = (d as { item_id: string }).item_id;
  if (o.agree !== false) await consent(s.v, s.planId);
  return { requestId, itemId };
}
const release = (who: P, itemId: string, collector = FO.staffId, k = key()) => as(who, (db) => releaseAddition(db, k, itemId, collector));
const start = (v: string, itemId: string, who = DOC) => as(who, (db) => startTreatment(db, key(), v, { planItemId: itemId, performerId: who.staffId, identityConfirmed: true }));
const finish = (eid: string, outcome: "completed" | "medical_stop" | "clinic_stop" | "patient_stop" = "completed", who = DOC) =>
  as(who, (db) => finishTreatment(db, key(), eid, outcome === "completed" ? { outcome } : { outcome, reason: "Alasan berhenti uji" }));
async function billAddition(s: S, itemId: string, item = filler, qty = 1) {
  const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: s.pid, visitId: s.v }));
  await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: item, quantity: qty, planItemId: itemId }]));
  return invoiceId;
}
const payment = async (v: string) => (await h.admin.query(`select payment from visits where id = $1`, [v])).rows[0].payment as string;
const close = (v: string, who = FO) => why(as(who, (db) => closeVisit(db, key(), v)));
const alerts = async (itemId: string) =>
  (await h.admin.query(`select type, recipient_role, branch_id, subject_kind from notifications where type = 'addition_unpaid_finished' and subject_id = $1 order by recipient_role`, [itemId])).rows;

let A: T; let B: T;
let MGR12: P;
let OWN: P; let FH: P; let DOC: P; let NUR: P; let BC: P; let FO: P; let FO2: P; let FOB2: P; let MGR: P; let FIN: P; let AU: P; let PH: P; let BFO: P;
let facial: string; let facialV: string; let filler: string; let fillerV: string; let peelV: string;

beforeAll(async () => {
  setKekRingForTests({ current: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) });
  h = await createHarness();
  const login = h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE]));
  app = await openAppPool({ connectionString: login, max: 6 });
  worker = await openAppPool({ connectionString: login, max: 2 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); FH = await person(A, "facility_head", A.b1); DOC = await person(A, "doctor", A.b1); NUR = await person(A, "nurse", A.b1);
  BC = await person(A, "bc", A.b1); FO = await person(A, "fo_cashier", A.b1); FO2 = await person(A, "fo_cashier", A.b1); FOB2 = await person(A, "fo_cashier", A.b2);
  MGR = await person(A, "manager", A.b1); FIN = await person(A, "finance"); AU = await person(A, "auditor"); PH = await person(A, "pharmacist", A.b1);
  BFO = await person(B, "fo_cashier", B.b1);
  MGR12 = await person(A, "manager", A.b2, A.b1); // both branches; acting at branch 2
  await credential(A, DOC, A.b1);
  const svc = async (c: string, name: string, price: number) => {
    const v = await as(OWN, (db) => publish(db, { kind: "service", code: c }, {
      name, tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: price, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
      indications: "Indikasi", consent_template: `Templat persetujuan ${name}.`, delegation: "Dokter", aftercare_text: "Perawatan",
      eligibility: [{ role: "doctor", mode: "performs" }, { role: "nurse", mode: "performs" }],
    } as never, "Layanan baru"));
    if (v.approvalId) await as(FH, (db) => db.query(`select approval_decide($1, true, null)`, [v.approvalId]));
    return v;
  };
  const f = await svc("TB-FAC", "Facial Dasar", 500_000); facial = f.itemId; facialV = f.versionId;
  const g = await svc("TB-FIL", "Filler Tambahan", 400_000); filler = g.itemId; fillerV = g.versionId;
  peelV = (await svc("TB-PEL", "Peeling Tambahan", 250_000)).versionId;
  await as(MGR, (db) => enableMockPort(db));
  void saveItem;
}, 300_000);
afterAll(async () => {
  setKekRingForTests(undefined);
  await app?.end();
  await worker?.end();
  await owner?.end();
  await h?.close();
});

describe("money scenario 3a (domain) and scenario PR-15 alerts", () => {
  it("authorized, agreed, released before payment, performed and counted; the second alert once; paid by EDC after; the visit closes", async () => {
    const s = await visitReady({ name: "Pasien Rahasia Tambahan" });
    const { requestId, itemId } = await addition(s);
    // First alert at approval (T-056): FO.
    expect((await as(FO, (db) => listNotifications(db, { open: true }))).some((x) => x.type === "clinical_request_approved" && x.subjectId === requestId)).toBe(true);
    // Unreleased and unpaid: the addition cannot start; the paid initial item still can.
    expect(await blocked(start(s.v, itemId))).toEqual(["payment_unpaid"]);
    expect((await as(DOC, (db) => getTreatment(db, s.v))).items.find((x) => x.plan_item_id === itemId)!.blockers).toContain("payment_unpaid");
    expect((await as(DOC, (db) => getTreatment(db, s.v))).items.find((x) => x.plan_item_id === s.itemId)!.blockers).not.toContain("payment_unpaid");
    // FO releases it, naming the manager as the collector (BILL-22 record).
    const { releaseId } = await release(FO, itemId, MGR.staffId);
    const r = (await h.admin.query(`select visit_id, plan_item_id, request_id, authorized_by, consent_id, collector_staff_id, released_by, released_as from addition_releases where id = $1`, [releaseId])).rows[0];
    const k = (await h.admin.query(`select id from procedure_consents where plan_id = $1 and state = 'active'`, [s.planId])).rows[0].id;
    expect(r).toEqual({ visit_id: s.v, plan_item_id: itemId, request_id: requestId, authorized_by: DOC.staffId, consent_id: k, collector_staff_id: MGR.staffId, released_by: FO.staffId, released_as: "fo_cashier" });
    const add = (await as(FO, (db) => visitAdditions(db, s.v))).additions;
    expect(add).toHaveLength(1);
    expect(add[0]).toMatchObject({ plan_item_id: itemId, item_id: filler, name: "Filler Tambahan", quantity: 1, price: 400_000, consent_active: true, invoice_line_id: null, paid: false, counted: false });
    expect(add[0].release).toMatchObject({ id: releaseId });
    expect(add[0].release!.collector).toMatch(/^Staf Tambahan/);
    // It starts before payment and is performed (counted): the second alert reaches FO and the manager, once.
    const { executionId } = await start(s.v, itemId);
    expect(await payment(s.v)).toBe("done");
    await finish(executionId);
    expect((await alerts(itemId)).map((x) => `${x.recipient_role}:${x.branch_id === A.b1}:${x.subject_kind}`)).toEqual(["fo_cashier:true:plan_item", "manager:true:plan_item"]);
    expect((await as(MGR, (db) => listNotifications(db, { open: true }))).some((x) => x.type === "addition_unpaid_finished" && x.subjectId === itemId)).toBe(true);
    // Performed, not billed: the visit owes it (PR-7) and cannot close (named first).
    expect(await payment(s.v)).toBe("in_progress");
    expect(await close(s.v)).toBe("ERR_VERSION_CONFLICT:unbilled_addition");
    // Billed on its own invoice; unpaid: the bill blocks; then EDC pays it and the visit closes.
    const inv = await billAddition(s, itemId);
    expect(await close(s.v)).toBe("ERR_VERSION_CONFLICT:unpaid_bill");
    const got = await as(FO, (db) => kasirInvoice(db, inv));
    expect(got.lines.map((l) => [l.plan_item_id, l.line_total])).toEqual([[itemId, 400_000]]);
    await as(FO, (db) => receivePayment(db, key(), inv, [{ method: "edc", amount: 400_000, details: EDC }]));
    const alloc = (await h.admin.query(`select sum(a.amount)::bigint s from payment_allocations a join invoice_lines l on l.id = a.invoice_line_id where l.plan_item_id = $1`, [itemId])).rows[0].s;
    expect(Number(alloc)).toBe(400_000);
    expect(await payment(s.v)).toBe("done");
    expect((await as(FO, (db) => visitAdditions(db, s.v))).additions[0]).toMatchObject({ paid: true, counted: true, invoice_id: inv });
    expect(await close(s.v)).toBe("ok");
    // The release event and the alert event carry ids only (no reason, no condition, no name).
    const ev = (await h.admin.query(`select type, payload::text p from domain_events where type in ('AdditionReleasedBeforePayment','AdditionFinishedUnpaid') and (payload ->> 'plan_item_id') = $1 order by type`, [itemId])).rows;
    expect(ev.map((e) => e.type)).toEqual(["AdditionFinishedUnpaid", "AdditionReleasedBeforePayment"]);
    for (const e of ev) expect(e.p).not.toMatch(/Lipatan|rahasia|Rahasia|Filler/);
    expect(JSON.stringify(add)).not.toMatch(/Lipatan|Kondisi/);
  });

  it("a paid addition finishing raises no second alert; a non-counted stop raises none and owes nothing; a patient stop counts", async () => {
    // Paid before starting: no release needed, no alert.
    const s = await visitReady();
    const { itemId } = await addition(s);
    const inv = await billAddition(s, itemId);
    expect(await blocked(start(s.v, itemId))).toEqual(["payment_unpaid"]); // billed but not paid, not released
    await as(FO, (db) => receivePayment(db, key(), inv, [{ method: "cash", amount: 400_000, cashTendered: 400_000 }]));
    const e1 = await start(s.v, itemId);
    await finish(e1.executionId);
    expect(await alerts(itemId)).toEqual([]);
    expect(await close(s.v)).toBe("ok");
    // Medical stop on a released addition: not counted — no alert, nothing owed, the visit closes.
    const s2 = await visitReady();
    const a2 = await addition(s2);
    await release(FO, a2.itemId);
    const e2 = await start(s2.v, a2.itemId);
    await finish(e2.executionId, "medical_stop");
    expect(await alerts(a2.itemId)).toEqual([]);
    expect(await payment(s2.v)).toBe("done");
    expect(await close(s2.v)).toBe("ok");
    // Patient stop: counted — the alert, and the close refused.
    const s3 = await visitReady();
    const a3 = await addition(s3);
    await release(MGR, a3.itemId);
    const e3 = await start(s3.v, a3.itemId);
    await finish(e3.executionId, "patient_stop");
    expect(await alerts(a3.itemId)).toHaveLength(2);
    expect(await close(s3.v)).toBe("ERR_VERSION_CONFLICT:unbilled_addition");
  });
});

describe("scenario PR-15 cannot close unpaid, CLIN-020, CLIN-025 and PR-7", () => {
  it("CLIN-020: planned 25, paid 20, executed 25 — the +5 add-on blocks closure until its bill is paid; the board lists the visit meanwhile", async () => {
    const s = await visitReady();
    const { itemId } = await addition(s, { version: fillerV, qty: 5 });
    await release(FO, itemId);
    const e = await start(s.v, itemId);
    await finish(e.executionId);
    // PR-7: the board's outstanding list shows the visit (payment in progress) and the close blocker is the addition.
    const board = await as(FO, (db) => today(db, A.b1));
    const row = board.visits.find((x) => x.id === s.v)!;
    expect(row.payment).toBe("in_progress");
    expect(closeBlocker({ ...row, unbilledAddition: true })).toBe("unbilled_addition");
    expect(closeBlocker(row)).toBe("unpaid_bill");
    expect(await close(s.v)).toBe("ERR_VERSION_CONFLICT:unbilled_addition");
    // Billed with the wrong quantity (+1 instead of +5): refused; billed right; partial payment keeps it owing.
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: s.pid, visitId: s.v }));
    expect(await why(as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: filler, quantity: 1, planItemId: itemId }])))).toBe("ERR_INVALID_INPUT:addition_item_or_quantity");
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: filler, quantity: 5, planItemId: itemId }]));
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 1_500_000, cashTendered: 1_500_000 }]));
    expect(await close(s.v)).toBe("ERR_VERSION_CONFLICT:unpaid_bill");
    expect((await as(FO, (db) => kasirQueue(db))).open.map((x) => x.id)).toContain(invoiceId);
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "edc", amount: 500_000, details: EDC }]));
    expect(await close(s.v)).toBe("ok");
  });

  it("CLIN-025: pending pharmacy blocks closure (the dispensing step named)", async () => {
    const s = await visitReady();
    await h.admin.query(`update visits set dispensing = 'in_progress' where id = $1`, [s.v]); // a dispensing not handed over (T-065 sets it)
    expect(await close(s.v)).toBe("ERR_VERSION_CONFLICT:pending_dispensing");
    await h.admin.query(`update visits set dispensing = 'done' where id = $1`, [s.v]);
    expect(await close(s.v)).toBe("ok");
  });

  it("a void of the unpaid addition invoice brings the unbilled blocker back; a simulated payment leaves it unpaid", async () => {
    const s = await visitReady();
    const { itemId } = await addition(s);
    await release(FO, itemId);
    const e = await start(s.v, itemId);
    await finish(e.executionId);
    const inv = await billAddition(s, itemId);
    const { approvalId } = await as(FO, (db) => requestVoid(db, key(), inv, "Salah tagih tambahan"));
    await as(MGR, (db) => decideApproval(db, approvalId, true));
    expect(await payment(s.v)).toBe("in_progress"); // the void resets the step; the performed addition still owes
    expect(await close(s.v)).toBe("ERR_VERSION_CONFLICT:unbilled_addition");
    // Billed again (the void freed it) and paid with simulated QRIS: still unpaid (BILL-29).
    const inv2 = await billAddition(s, itemId);
    const c = await as(FO, (db) => createCharge(db, key(), inv2, { channel: "qris" }));
    const w = await as(FO, (db) => simulate(db, c.charge_id, "paid", A.tenantId));
    expect(await receiveMockWebhook(worker, w.rawBody, w.headers[SIGNATURE_HEADER], "local")).toEqual({ status: 200, outcome: "applied" });
    expect((await as(FO, (db) => visitAdditions(db, s.v))).additions[0].paid).toBe(false);
    expect(await close(s.v)).toBe("ERR_VERSION_CONFLICT:unpaid_bill");
  });

  it("a simulated payment of the addition before the start does not count as paid: an unreleased addition stays blocked and the alert fires", async () => {
    const s = await visitReady();
    const { itemId } = await addition(s);
    const inv = await billAddition(s, itemId);
    const c = await as(FO, (db) => createCharge(db, key(), inv, { channel: "qris" }));
    const w = await as(FO, (db) => simulate(db, c.charge_id, "paid", A.tenantId));
    await receiveMockWebhook(worker, w.rawBody, w.headers[SIGNATURE_HEADER], "local");
    expect(await blocked(start(s.v, itemId))).toEqual(["payment_unpaid"]);
    await release(FO, itemId);
    const e = await start(s.v, itemId);
    await finish(e.executionId);
    expect(await alerts(itemId)).toHaveLength(2);
  });
});

describe("the payment rule at start (B-01, BILL-1, BILL-3; plan r1 P1-1)", () => {
  it("a released addition never starts before the initial bill is paid; the initial bill paid, an unpaid addition does not block the initial item", async () => {
    const s = await visitReady({ pay: false });
    const { itemId } = await addition(s);
    await release(FO, itemId);
    expect(await blocked(start(s.v, itemId))).toEqual(["payment_unpaid"]);
    expect(await blocked(start(s.v, s.itemId))).toEqual(["payment_unpaid"]);
    await as(FO, (db) => receivePayment(db, key(), s.invoiceId, [{ method: "cash", amount: 500_000, cashTendered: 500_000 }]));
    // An issued, unpaid addition invoice does not block the paid initial item.
    await billAddition(s, itemId);
    expect(await payment(s.v)).toBe("in_progress");
    expect(await blocked(start(s.v, s.itemId))).toEqual([]);
    expect(await blocked(start(s.v, itemId))).toEqual([]); // released
  });

  it("a blocked payment step blocks every start; a partial real payment of an unreleased addition does not let it start", async () => {
    const s = await visitReady();
    const { itemId } = await addition(s);
    const inv = await billAddition(s, itemId);
    await as(FO, (db) => receivePayment(db, key(), inv, [{ method: "cash", amount: 399_999, cashTendered: 399_999 }]));
    expect(await blocked(start(s.v, itemId))).toEqual(["payment_unpaid"]);
    expect((await as(FO, (db) => visitAdditions(db, s.v))).additions[0].paid).toBe(false);
    await h.admin.query(`update visits set payment = 'blocked' where id = $1`, [s.v]);
    expect(await blocked(start(s.v, s.itemId))).toEqual(["payment_unpaid"]);
    await h.admin.query(`update visits set payment = 'in_progress' where id = $1`, [s.v]);
    expect(await blocked(start(s.v, s.itemId))).toEqual([]); // the initial bill is paid; only the addition owes
    await as(FO, (db) => receivePayment(db, key(), inv, [{ method: "cash", amount: 1, cashTendered: 1 }]));
    expect(await blocked(start(s.v, itemId))).toEqual([]);
  });

  it("BILL-1: a confirmed selection without an issued initial bill blocks the start; no selection yet still allows it (DEC-074)", async () => {
    const pid = await patient(A, A.b1, "Pasien Tanpa Tagihan");
    const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
      [A.tenantId, A.b1, pid, FO.staffId])).rows[0].id as string;
    const { examId } = await as(DOC, (db) => openExam(db, key(), v));
    const { planId } = await as(DOC, (db) => createPlan(db, key(), examId, "Program", "Kondisi"));
    const { itemId } = await as(DOC, (db) => addPlanItem(db, key(), examId, planId, { stage: 1, catalog_version_id: facialV, qty: 1 }));
    await as(DOC, (db) => signRecord(db, key(), examId, STEP));
    await consent(v, planId);
    expect((await as(DOC, (db) => getTreatment(db, v))).items[0].blockers).toEqual([]); // not_started: allowed until the cashier
    await as(BC, (db) => confirmSelection(db, key(), v, { items: [{ planItemId: itemId }] }));
    expect(await blocked(start(v, itemId))).toEqual(["payment_unpaid"]);
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: facial, quantity: 1 }]));
    expect(await blocked(start(v, itemId))).toEqual(["payment_unpaid"]);
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 500_000, cashTendered: 500_000 }]));
    expect(await blocked(start(v, itemId))).toEqual([]);
  });

  it("an addition chosen into the selection is an ordinary item (billed on the initial bill, no release)", async () => {
    const pid = await patient(A, A.b1, "Pasien Pilih Tambahan");
    const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
      [A.tenantId, A.b1, pid, FO.staffId])).rows[0].id as string;
    const { examId } = await as(DOC, (db) => openExam(db, key(), v));
    const { planId } = await as(DOC, (db) => createPlan(db, key(), examId, "Program", "Kondisi"));
    await as(DOC, (db) => addPlanItem(db, key(), examId, planId, { stage: 1, catalog_version_id: facialV, qty: 1 }));
    await as(DOC, (db) => signRecord(db, key(), examId, STEP));
    await consent(v, planId);
    const s = { pid, v, examId, planId, itemId: "", invoiceId: "" };
    const { itemId } = await addition(s);
    await as(BC, (db) => confirmSelection(db, key(), v, { items: [{ planItemId: itemId }] }));
    expect(await why(release(FO, itemId))).toBe("ERR_NOT_FOUND:addition not found");
    expect((await as(FO, (db) => visitAdditions(db, v))).additions).toEqual([]);
  });
});

describe("the release (BILL-22, B-18; plan r1 P1-4)", () => {
  it("refusals: unapproved, no agreement, collector without the role or branch, another branch, twice; roles; replay by key", async () => {
    const s = await visitReady();
    const pend = await addition(s, { approve: false });
    const pendItem = (await h.admin.query(`select id from plan_items where request_id = $1`, [pend.requestId])).rows[0]?.id ?? crypto.randomUUID();
    expect(await why(release(FO, pendItem))).toBe("ERR_NOT_FOUND:addition not found"); // pending: no item yet
    await as(DOC, (db) => decideRequest(db, key(), pend.requestId, false, "Tidak perlu"));
    const { itemId } = await addition(s, { agree: false, version: peelV });
    expect(await why(release(FO, itemId))).toBe("ERR_VERSION_CONFLICT:consent_not_active");
    await consent(s.v, s.planId);
    expect(await why(release(FO, itemId, DOC.staffId))).toBe("ERR_INVALID_INPUT:collector"); // a doctor is not a collector
    expect(await why(release(FO, itemId, FOB2.staffId))).toBe("ERR_INVALID_INPUT:collector"); // FO of another branch
    expect(await why(release(FO, itemId, BFO.staffId))).toBe("ERR_INVALID_INPUT:collector"); // another tenant
    expect(await why(release(FOB2, itemId))).toBe("ERR_NOT_FOUND:addition not found"); // FO of another branch
    expect(await why(release(BFO, itemId))).toBe("ERR_NOT_FOUND:addition not found"); // another tenant
    for (const p of [DOC, NUR, BC, PH, OWN, FIN, AU]) expect(await code(release(p, itemId)), p.role).toBe("ERR_FORBIDDEN");
    expect(await why(release(FO, s.itemId))).toBe("ERR_NOT_FOUND:addition not found"); // an initial item is not an addition
    const k = key();
    const r1 = await release(FO, itemId, FO2.staffId, k);
    const r2 = await release(FO, itemId, FO2.staffId, k);
    expect([r2.releaseId, r2.replayed]).toEqual([r1.releaseId, true]);
    expect(await why(release(MGR, itemId))).toBe("ERR_VERSION_CONFLICT:addition_already_released");
    expect(Number((await h.admin.query(`select count(*) c from audit_events where reason_code = 'addition_released' and object_id = $1`, [r1.releaseId])).rows[0].c)).toBe(1);
    // A manager holding both branches, acting at branch 2: the branch-1 addition is not theirs to release.
    const s4 = await visitReady();
    const a4 = await addition(s4);
    expect(await why(release(MGR12, a4.itemId, MGR12.staffId))).toBe("ERR_NOT_FOUND:addition not found");
    // A plan change replacing the addition: the removed addition and the new plan-change item are not additions.
    const pc = await as(DOC, (db) => createRequest(db, key(), s4.v, { kind: "plan_change", planId: s4.planId, targetItemId: a4.itemId, catalogVersionId: fillerV,
      stage: 1, qty: 2, reason: "Jumlah diubah" }));
    const d = await as(FH, (db) => decideRequest(db, key(), pc.requestId, true, null));
    const pcItem = (d as { item_id: string }).item_id;
    await consent(s4.v, s4.planId);
    expect(await why(release(FO, a4.itemId))).toBe("ERR_NOT_FOUND:addition not found");
    expect(await why(release(FO, pcItem))).toBe("ERR_NOT_FOUND:addition not found");
    const { invoiceId: pcInv } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: s4.pid, visitId: s4.v }));
    expect(await why(as(FO, (db) => issueKasirInvoice(db, key(), pcInv, [{ itemId: filler, quantity: 1, planItemId: a4.itemId }])))).toBe("ERR_NOT_FOUND:addition not found");
    expect(await why(as(FO, (db) => issueKasirInvoice(db, key(), pcInv, [{ itemId: filler, quantity: 2, planItemId: pcItem }])))).toBe("ERR_NOT_FOUND:addition not found");
    expect((await as(FO, (db) => visitAdditions(db, s4.v))).additions).toEqual([]);
    // A closed visit: refused.
    const s2 = await visitReady();
    const a2 = await addition(s2);
    await h.admin.query(`update visits set closed_at = now(), closed_by = $2 where id = $1`, [s2.v, FO.staffId]);
    expect(await why(release(FO, a2.itemId))).toBe("ERR_VERSION_CONFLICT:visit_closed");
  });

  it("the record is insert-only; the table is read by the cashier readers at the branch only, and never across tenants", async () => {
    const s = await visitReady();
    const { itemId } = await addition(s);
    const { releaseId } = await release(FO, itemId);
    expect(await code(h.admin.query(`update addition_releases set collector_staff_id = $2 where id = $1`, [releaseId, MGR.staffId]))).toMatch(/raw:42501/);
    expect(await code(h.admin.query(`delete from addition_releases where id = $1`, [releaseId]))).toMatch(/raw:42501/);
    const sees = async (p: P) => (await as(p, (db) => db.query(`select id from addition_releases where id = $1`, [releaseId]))).rowCount;
    expect([await sees(FO), await sees(MGR), await sees(OWN), await sees(FIN), await sees(AU)]).toEqual([1, 1, 1, 1, 1]);
    expect([await sees(FOB2), await sees(DOC), await sees(NUR), await sees(PH), await sees(BFO)]).toEqual([0, 0, 0, 0, 0]);
    // The reader: the auditor sees the patient masked; another branch's FO and another tenant get not-found.
    const au = await as(AU, (db) => visitAdditions(db, s.v));
    expect(au.patient?.name ?? null).not.toBe("Pasien Tambahan");
    expect(au.additions).toHaveLength(1);
    expect(await code(as(FOB2, (db) => visitAdditions(db, s.v)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BFO, (db) => visitAdditions(db, s.v)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(DOC, (db) => visitAdditions(db, s.v)))).toBe("ERR_FORBIDDEN");
  });
});

describe("the addition invoice (plan r1 P1-3)", () => {
  it("only addition lines of this visit, matching item and quantity, billed once, never mixed, never on a counter sale", async () => {
    const s = await visitReady();
    const { itemId } = await addition(s);
    const other = await visitReady();
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: s.pid, visitId: s.v }));
    expect(await why(as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: filler, quantity: 1, planItemId: itemId }, { itemId: facial, quantity: 1 }]))))
      .toBe("ERR_INVALID_INPUT:mixed_addition_lines");
    expect(await why(as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: facial, quantity: 1, planItemId: itemId }])))).toBe("ERR_INVALID_INPUT:addition_item_or_quantity");
    expect(await why(as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: facial, quantity: 1, planItemId: s.itemId }])))).toBe("ERR_NOT_FOUND:addition not found");
    expect(await why(as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: filler, quantity: 1, planItemId: itemId }, { itemId: filler, quantity: 1, planItemId: itemId }]))))
      .toBe("ERR_INVALID_INPUT:an addition is billed once");
    // Another visit's addition: not found on this visit's invoice.
    const { invoiceId: otherInv } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: other.pid, visitId: other.v }));
    expect(await why(as(FO, (db) => issueKasirInvoice(db, key(), otherInv, [{ itemId: filler, quantity: 1, planItemId: itemId }])))).toBe("ERR_NOT_FOUND:addition not found");
    // An ordinary second invoice is still refused (one initial bill per visit).
    expect(await why(as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: facial, quantity: 1 }])))).toBe("ERR_VERSION_CONFLICT:visit_already_invoiced");
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: filler, quantity: 1, planItemId: itemId }]));
    const { invoiceId: again } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: s.pid, visitId: s.v }));
    expect(await why(as(FO, (db) => issueKasirInvoice(db, key(), again, [{ itemId: filler, quantity: 1, planItemId: itemId }])))).toBe("ERR_VERSION_CONFLICT:addition_already_invoiced");
    // A counter sale: no visit.
    const { invoiceId: counter } = await as(FO, (db) => openKasirInvoice(db, key(), { counter: true }));
    expect(await why(as(FO, (db) => issueKasirInvoice(db, key(), counter, [{ itemId: filler, quantity: 1, planItemId: itemId }])))).toBe("ERR_INVALID_INPUT:addition_on_visit_only");
    // The line's plan item is frozen and only on a visit invoice (the guard, below the writer).
    const line = (await h.admin.query(`select id from invoice_lines where invoice_id = $1`, [invoiceId])).rows[0].id;
    expect(await code(h.admin.query(`update invoice_lines set plan_item_id = null where id = $1`, [line]))).toMatch(/raw:42501/);
    expect(await code(h.admin.query(
      `insert into invoice_lines (tenant_id, branch_id, invoice_id, item_id, catalog_version_id, quantity, unit_price, discount, line_total, tax_category, tax_basis, vat_base, vat_amount, plan_item_id)
       select tenant_id, branch_id, $1, item_id, catalog_version_id, 1, 1, 0, 1, tax_category, tax_basis, 0, 0, plan_item_id from invoice_lines where id = $2`, [counter, line]))).toMatch(/raw:42501/);
  });
});
