// T-094 Done-when: full Scenario PR-15 receivable (02-PRD:341) — an addition performed and billed but unpaid; FO sends the WhatsApp bill
// through the mock adapter (amount, reference, payment channel and a link; never the treatment name — BILL-22, PRIV-15); the visit stays
// blocked; FO converts the unpaid remainder to a patient receivable, so the bill is settled and the visit closes; at the next visit the
// receivable shows and is collected. The bill refusals: nothing unpaid, an addition not yet billed, a closed visit, roles, branches, a
// missing template. The fixtures follow tests/cashier/receivables.test.ts (no live call: the mock Meta port). Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { setKekRingForTests } from "../../src/lib/keys/runtime";
import { releaseAddition } from "../../src/modules/cashier/additions/additions";
import { issueKasirInvoice, openKasirInvoice, receivePayment } from "../../src/modules/cashier/kasir/kasir";
import { collectReceivable, convertToReceivable, piutang } from "../../src/modules/cashier/receivables/receivables";
import { publish } from "../../src/modules/catalog/catalog";
import { captureConsent, consentText } from "../../src/modules/clinical/consent/consent";
import { addPlanItem, createPlan, openExam } from "../../src/modules/clinical/exam/exam";
import { signRecord, type StepUp } from "../../src/modules/clinical/records/records";
import { createRequest, decideRequest } from "../../src/modules/clinical/requests/requests";
import { syncTemplates } from "../../src/modules/messaging/inbox/inbox";
import { mockInboxPort } from "../../src/modules/messaging/inbox/mock";
import { RECORDED_TEMPLATES } from "../../src/modules/messaging/inbox/fixtures";
import { runOutboundDispatch, sendWhatsappBill } from "../../src/modules/messaging/outbound/outbound";
import { mockWabaGraphPort } from "../../src/modules/messaging/waba/mock";
import { addWaNumber, completeWabaSignup, startWabaSignup } from "../../src/modules/messaging/waba/waba";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { confirmSelection } from "../../src/modules/pharmacy/pharmacy";
import { finishTreatment, startTreatment } from "../../src/modules/treatment/treatment";
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
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "auditor", "purchasing", "marketing", "central_cs"];
const STEP: StepUp = { verified: true };
// the WhatsApp bill template (BILL-22): synced from the mock adapter for these tests only (the shared recorded list is T-090's)
const BILL_TEMPLATES = [...RECORDED_TEMPLATES,
  { name: "tagihan_kunjungan", language: "id", category: "utility" as const, status: "approved" as const,
    body: "Halo {{1}}, tagihan {{2}} sebesar {{3}} dapat dibayar di {{4}}. Rincian: {{5}}", paramCount: 5 }];

async function tenant(name: string): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, name]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("RF1"), b2: await br("RF2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`rf${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf RF ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const key = () => crypto.randomUUID();
const why = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason ?? ""}` : `raw:${e.code ?? e.message}`));
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
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
async function patient(t: T, name: string): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "");
  const pid = (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $4, '1990-01-01', 'female', 'nik', $2, $3, 'islam', 'Karyawan', 's1', 'kawin', $5,
             (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id`,
    [t.tenantId, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43), name, t.b1])).rows[0].id as string;
  await h.admin.query(`insert into contact_points (tenant_id, patient_id, kind, value) values ($1, $2, 'phone', $3)`, [t.tenantId, pid, `+62858${String(10000000 + ++n)}`]);
  return pid;
}
const consent = async (v: string, planId: string) => {
  const t = await as(DOC, (db) => consentText(db, v, planId));
  await as(DOC, (db) => captureConsent(db, key(), { visitId: v, planId, signer: "patient", expectedHash: t.content_hash, signature: png() }));
};
// A visit with a signed exam, a plan of one initial item (facial ×1), the consent, the selection confirmed and the initial bill paid.
async function visitReady(pid: string) {
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
  await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 500_000, cashTendered: 500_000 }]));
  return { pid, v, planId };
}
// The nurse proposes an addition; the doctor approves; the patient agrees; FO releases it before payment; it is performed.
async function performedAddition(s: { v: string; planId: string }) {
  const { requestId } = await as(NUR, (db) => createRequest(db, key(), s.v, {
    kind: "addition", planId: s.planId, catalogVersionId: fillerV, stage: 1, qty: 1, reason: "Lipatan nasolabial dalam" }));
  const itemId = ((await as(DOC, (db) => decideRequest(db, key(), requestId, true, null))) as { item_id: string }).item_id;
  await consent(s.v, s.planId);
  await as(FO, (db) => releaseAddition(db, key(), itemId, MGR.staffId));
  const { executionId } = await as(DOC, (db) => startTreatment(db, key(), s.v, { planItemId: itemId, performerId: DOC.staffId, identityConfirmed: true }));
  await as(DOC, (db) => finishTreatment(db, key(), executionId, { outcome: "completed" }));
  return itemId;
}
const close = (v: string, who = FO) => why(as(who, (db) => closeVisit(db, key(), v)));

let A: T; let B: T;
let OWN: P; let FH: P; let DOC: P; let NUR: P; let BC: P; let FO: P; let FO2: P; let MGR: P; let CS: P; let AU: P; let BFO: P;
let facial: string; let facialV: string; let filler: string; let fillerV: string;

beforeAll(async () => {
  setKekRingForTests({ current: 1, keys: new Map([[1, Buffer.alloc(32, 6)]]) });
  h = await createHarness();
  const login = h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE]));
  app = await openAppPool({ connectionString: login, max: 6 });
  worker = await openAppPool({ connectionString: login, max: 2 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant("PT Klinik Tagihan WA Sintetis");
  B = await tenant("PT Klinik Lain Tagihan WA");
  OWN = await person(A, "owner"); FH = await person(A, "facility_head", A.b1); DOC = await person(A, "doctor", A.b1); NUR = await person(A, "nurse", A.b1);
  BC = await person(A, "bc", A.b1); FO = await person(A, "fo_cashier", A.b1); FO2 = await person(A, "fo_cashier", A.b2); MGR = await person(A, "manager", A.b1);
  CS = await person(A, "central_cs"); AU = await person(A, "auditor"); BFO = await person(B, "fo_cashier", B.b1);
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
  const f = await svc("RF-FAC", "Facial Dasar", 500_000); facial = f.itemId; facialV = f.versionId;
  const g = await svc("RF-FIL", "Filler Tambahan", 400_000); filler = g.itemId; fillerV = g.versionId;
  // the clinic's WhatsApp (mock Graph port) with a Kemang number and the bill template synced
  const gp = mockWabaGraphPort();
  const { wabaId } = await as(OWN, (db) => startWabaSignup(db, key(), { onboardingChannel: "cloud_api" }));
  await as(OWN, (db) => completeWabaSignup(db, wabaId, "code-verified", { port: gp }));
  await as(OWN, (db) => addWaNumber(db, key(), wabaId, { branchId: A.b1, phoneNumber: "+6281277770001", phoneNumberId: `7${String(Date.now()).slice(-9)}` }, { port: gp }));
  await as(OWN, (db) => syncTemplates(db, { port: { ...mockInboxPort(), fetchTemplates: async () => BILL_TEMPLATES.map((x) => ({ ...x })) } }));
}, 300_000);
afterAll(async () => {
  setKekRingForTests(undefined);
  await app?.end();
  await worker?.end();
  await owner?.end();
  await h?.close();
});
const fetchSpy = vi.fn();
beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("T-094 Scenario PR-15 receivable (WhatsApp bill fallback)", () => {
  it("the bill goes out through the mock adapter; the visit stays blocked; the receivable settles it; the visit closes; the next visit collects it", async () => {
    const pid = await patient(A, "Pasien Tagihan WA");
    const s = await visitReady(pid);
    const itemId = await performedAddition(s);
    // performed but not yet billed: no bill (the addition must be on an issued invoice first)
    expect(await why(as(FO, (db) => sendWhatsappBill(db, key(), s.v)))).toBe("ERR_VERSION_CONFLICT:unbilled_addition");
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: s.v }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: filler, quantity: 1, planItemId: itemId }]));
    // the WhatsApp bill through the mock adapter: amount, reference, payment channel and a link — never the treatment name
    const { outboundId } = await as(FO, (db) => sendWhatsappBill(db, key(), s.v));
    const sent: { templateName: string; params: string[]; to: string }[] = [];
    const port = { ...mockInboxPort(), sendMessage: async (i: { kind: string; templateName?: string; params?: string[]; to: string }) => {
      sent.push({ templateName: i.templateName!, params: i.params!, to: i.to });
      return { providerMessageId: `wamid.BILL${Date.now()}` };
    } };
    expect(await runOutboundDispatch(worker, { port: port as never })).toEqual({ sent: 1, failed: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0].templateName).toBe("tagihan_kunjungan");
    expect(sent[0].params[0]).toBe("Pasien Tagihan WA");
    expect(sent[0].params[2]).toBe("Rp400.000");
    expect(sent[0].params[4]).toBe(`/tagihan/${s.v}`);
    expect(sent[0].params.join(" ")).not.toMatch(/Filler|Facial|Kondisi|Program/);
    expect((await h.admin.query(`select state from outbound_messages where id = $1`, [outboundId])).rows[0].state).toBe("sent");
    // the unpaid visit stays blocked
    expect(await close(s.v)).toMatch(/^ERR_VERSION_CONFLICT:/);
    // FO converts the unpaid remainder to a patient receivable: the bill is settled and the visit closes
    const rc = await as(FO, (db) => convertToReceivable(db, key(), s.v));
    expect(rc.amount).toBe(400_000);
    expect(await close(s.v)).toBe("ok");
    // a closed visit takes no new bill
    expect(await why(as(FO, (db) => sendWhatsappBill(db, key(), s.v)))).toBe("ERR_VERSION_CONFLICT:visit_closed");
    // the next visit: the receivable shows for the patient and is collected there
    const next = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
      [A.tenantId, A.b1, pid, FO.staffId])).rows[0].id as string;
    const row = (await as(FO, (db) => piutang(db, null))).receivables.find((x) => x.id === rc.receivable_id)!;
    expect([row.open, row.state]).toEqual([400_000, "open"]);
    const c = await as(FO, (db) => collectReceivable(db, key(), rc.receivable_id, { method: "cash", amount: 400_000, cashTendered: 400_000 }));
    expect(c.open).toBe(0);
    expect(next).toBeTruthy();
  });

  it("refusals: nothing unpaid, roles, another branch, another tenant", async () => {
    const pid = await patient(A, "Pasien Lunas");
    const s = await visitReady(pid);
    expect(await why(as(FO, (db) => sendWhatsappBill(db, key(), s.v)))).toBe("ERR_VERSION_CONFLICT:nothing_unpaid");
    for (const p of [DOC, BC, CS, AU]) expect(await code(as(p, (db) => sendWhatsappBill(db, key(), s.v))), p.role).toBe("ERR_FORBIDDEN");
    expect(await code(as(FO2, (db) => sendWhatsappBill(db, key(), s.v)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BFO, (db) => sendWhatsappBill(db, key(), s.v)))).toBe("ERR_NOT_FOUND");
  });
});
