// T-102 increment 2 gate (addendum r2, Sol dab12887; plan r4 §2 / §5): Observation, Procedure, Medication, MedicationRequest,
// MedicationDispense — builders and identifiers from the official pages; dependency order; per-type reconciliation with the documented searches
// only (Medication: none — an uncertain create becomes an exception, never searched or re-created); uncertain update by the projection
// fingerprint; provider-added versus writer-controlled fields per type; amendment during send per type (fingerprint equality before any
// no-send advance: a changed vital, a Procedure map A → B, a practitioner re-link, an unchanged Medication); per-link holds (unmapped,
// unvalidated, practitioner) without blocking the rest; the code-map writer's roles. Mock port, synthetic data, fetch never called. The clinical
// source rows (treatment executions, prescriptions, dispensings) are inserted by the database owner as stand-ins for the M3 writers.
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Role } from "../../../src/auth/policy";
import { APP_GROUP_ROLE, VENDOR_GROUP_ROLE, withTenantContext } from "../../../src/db/rls/context";
import { openAppPool } from "../../../src/db/rls/pool";
import { CommandError } from "../../../src/lib/command";
import { encryptField, newWrappedDek, type KekRing } from "../../../src/lib/keys/envelope";
import { setKekRingForTests } from "../../../src/lib/keys/runtime";
import { publish } from "../../../src/modules/catalog/catalog";
import { openExam, saveExam } from "../../../src/modules/clinical/exam/exam";
import { correctRecord, signRecord, type StepUp } from "../../../src/modules/clinical/records/records";
import { medication, medicationDispense, medicationRequest, observation, procedure } from "../../../src/modules/integrations/satusehat/fhir";
import { mockSatusehatPort, type MockSatusehat } from "../../../src/modules/integrations/satusehat/mock";
import type { Fhir } from "../../../src/modules/integrations/satusehat/port";
import { bodyFingerprint, linkPractitioner, resend, runSatusehatSync, setCodeMap, setCredentials } from "../../../src/modules/integrations/satusehat/satusehat";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { IDENTITY_PURPOSE } from "../../../src/modules/patients/patients";
import { createHarness, type Harness, testPool } from "../../rls/harness";

process.env.DEPLOY_ENV = "local";

let h: Harness;
let app: pg.Pool;
let worker: pg.Pool;
let owner: pg.Pool;
let n = 0;
const RING: KekRing = { current: 1, keys: new Map([[1, Buffer.alloc(32, 9)]]) };
const STEP: StepUp = { verified: true };
type T = { tenantId: string; b1: string; org1: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "admin_pusat", "finance", "marketing", "central_cs", "auditor", "purchasing"];

async function tenant(name: string): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, name]);
  const org1 = `3000${String(++n).padStart(4, "0")}`;
  const b1 = (await h.admin.query(`insert into branches (tenant_id, code, name, timezone, satusehat_org_id) values ($1, 'R1', 'R1', 'Asia/Jakarta', $2) returning id`,
    [tenantId, org1])).rows[0].id as string;
  return { tenantId, b1, org1 };
}
async function person(t: T, role: Role): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`ssr${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf SR ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: t.b1 });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const key = () => crypto.randomUUID();
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
async function paused<R>(tables: string[], fn: () => Promise<R>) {
  for (const t of tables) await h.admin.query(`alter table ${t} disable trigger ${t}_guard`);
  try {
    return await fn();
  } finally {
    for (const t of tables) await h.admin.query(`alter table ${t} enable always trigger ${t}_guard`);
  }
}
const keys = new Map<string, { tenantId: string; version: number; wrapped: string }>();
async function keysFor(t: T) {
  if (!keys.has(t.tenantId)) {
    const w = newWrappedDek(RING, t.tenantId, 1);
    await h.admin.query(`insert into tenant_data_keys (tenant_id, version, wrapped, is_current) values ($1, 1, $2, true) on conflict do nothing`, [t.tenantId, w.wrapped]);
    const r = (await h.admin.query(`select version, wrapped from tenant_data_keys where tenant_id = $1 and version = 1`, [t.tenantId])).rows[0];
    keys.set(t.tenantId, { tenantId: t.tenantId, ...r });
  }
  const d = keys.get(t.tenantId)!;
  return { tenantId: t.tenantId, current: d, byVersion: (v: number) => (v === d.version ? d : undefined) };
}
async function credential(t: T, p: P, rec: P, ver: P) {
  for (const [kind, b] of [["str", null], ["sip", t.b1]] as const) {
    const id = (await h.admin.query(`insert into staff_credentials (tenant_id, staff_id, kind, number, issuer, profession, branch_id, valid_from, expires_on, recorded_by)
       values ($1, $2, $3, $4, 'Konsil Kesehatan', 'dokter', $5, '2024-01-01', $6, $7) returning id`,
      [t.tenantId, p.staffId, kind, `NO-SR-${++n}`, b, b ? "2099-12-31" : null, rec.staffId])).rows[0].id as string;
    await h.admin.query(`update staff_credentials set state = 'verified', decided_by = $2, decided_at = now() where id = $1`, [id, ver.staffId]);
  }
}
const outbox = async (v: string) => (await h.admin.query(`select state, hold_reason, revision from satusehat_outbox where visit_id = $1 order by created_at, id`, [v])).rows;
const links = async (v: string) => (await h.admin.query(`select fhir_type, local_key, status, status_reason, remote_id, current_revision, confirmed_revision
  from satusehat_links where visit_id = $1 order by fhir_type, local_key`, [v])).rows as { fhir_type: string; local_key: string; status: string;
  status_reason: string | null; remote_id: string | null; current_revision: number; confirmed_revision: number | null }[];
// the link of a type, or the one with an exact local key
const link = async (v: string, type: string, localKey?: string) => (await links(v)).find((l) => l.fhir_type === type && (localKey === undefined || l.local_key === localKey))!;
const attempts = async (v: string, type: string) => (await h.admin.query(`select a.verb, a.outcome, a.revision from satusehat_attempts a join satusehat_links l on l.id = a.link_id
  where l.visit_id = $1 and l.fhir_type = $2 order by a.started_at, a.id`, [v, type])).rows;
const at = (min: number) => new Date(Date.now() + min * 60_000);
const sync = (port: MockSatusehat, min = 0) => runSatusehatSync(worker, { port, now: at(min) });
const remote = (port: MockSatusehat, id: string | null) => port.store.get(id!)!;

const fetchSpy = vi.fn();
let A: T;
let OWN: P; let FH: P; let RO: P; let DOC: P; let NUR: P; let APT: P; let MGR: P;
let room1: string; let depot: string; let svc: { itemId: string; versionId: string }; let drug: { stockItemId: string; versionId: string };

beforeAll(async () => {
  setKekRingForTests(RING);
  vi.stubGlobal("fetch", fetchSpy);
  h = await createHarness();
  const login = h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE]));
  app = await openAppPool({ connectionString: login, max: 6 });
  worker = await openAppPool({ connectionString: login, max: 2 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant("PT Klinik Resource SATUSEHAT");
  OWN = await person(A, "owner"); FH = await person(A, "facility_head"); RO = await person(A, "records_officer"); DOC = await person(A, "doctor");
  NUR = await person(A, "nurse"); APT = await person(A, "pharmacist"); MGR = await person(A, "manager");
  await credential(A, DOC, OWN, FH);
  room1 = (await h.admin.query(`insert into rooms (tenant_id, branch_id, name, kind, satusehat_location_id) values ($1, $2, 'Ruang R', 'consultation', 'loc-r-0001') returning id`,
    [A.tenantId, A.b1])).rows[0].id as string;
  await keysFor(A);
  depot = (await h.admin.query(`insert into depots (tenant_id, branch_id, name, kind) values ($1, $2, 'Apotek R', 'apotek') returning id`, [A.tenantId, A.b1])).rows[0].id as string;
  await as(OWN, (db) => setCredentials(db, key(), { branchId: A.b1, environment: "sandbox", organizationId: A.org1, clientId: "client-r1", clientSecret: "rahasia-sintetis-r1" }));
  for (const p of [DOC, NUR, APT]) await as(OWN, (db) => linkPractitioner(db, key(), { staffId: p.staffId, ihs: `N9${String(++n).padStart(7, "0")}` }));
  const v = await as(OWN, (db) => publish(db, { kind: "service", code: "SR-SVC" }, {
    name: "Layanan Laser", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 300_000, category: "facial",
    prep_min: 0, treatment_min: 30, buffer_min: 0, indications: "Indikasi", consent_template: "Templat", delegation: "Dokter",
    aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }] } as never, "Layanan baru"));
  if (v.approvalId) {
    const { decideApproval } = await import("../../../src/modules/approvals/approvals");
    await as(FH, (db) => decideApproval(db, v.approvalId!, true));
  }
  svc = { itemId: v.itemId, versionId: v.versionId };
  const cat = (await h.admin.query(`insert into catalog_items (tenant_id, kind, code, created_by) values ($1, 'product', 'SR-OBAT', $2) returning id`, [A.tenantId, OWN.staffId])).rows[0].id as string;
  const cv = (await h.admin.query(`insert into catalog_versions (tenant_id, item_id, version, state, name, tax_category, tax_basis, normal_price, created_by, created_as)
    values ($1, $2, 1, 'published', 'Obat Sintetis', 'vat_exempt_goods', 'Obat', 10000, $3, 'owner') returning id`, [A.tenantId, cat, OWN.staffId]).catch(async () =>
    h.admin.query(`select id from catalog_versions where tenant_id = $1 limit 1`, [A.tenantId]))).rows[0].id as string;
  const si = (await h.admin.query(`insert into stock_items (tenant_id, catalog_item_id, unit, created_by, updated_by) values ($1, $2, 'tab', $3, $3) returning id`,
    [A.tenantId, cat, OWN.staffId])).rows[0].id as string;
  drug = { stockItemId: si, versionId: cv };
});
afterEach(() => expect(fetchSpy).not.toHaveBeenCalled());
afterAll(async () => {
  vi.unstubAllGlobals();
  setKekRingForTests(undefined);
  await app?.end();
  await worker?.end();
  await owner?.end();
  await h?.close();
});

// A signed visit with vitals, a counted finished treatment, a signed prescription item (KFA or none) and a handed dispensing.
async function fullVisit(port: MockSatusehat, ihs: string, o: { kfa?: string | null; vitals?: Record<string, number>; prescriber?: P; dispenser?: P; performer?: P } = {}) {
  const nik = `3174${String(++n).padStart(12, "0")}`;
  const pt = (await h.admin.query(`insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation,
      education, marital_status, registered_branch_id, created_by, created_as)
    values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Siti Rahma', '1990-06-15', 'female', 'nik', $2, $3, 'islam', 'Karyawan', 's1', 'kawin', $4,
      $5, 'fo_cashier') returning id`, [A.tenantId, encryptField(RING, await keysFor(A), IDENTITY_PURPOSE, nik), `bidx${String(++n).padStart(39, "0")}`, A.b1, OWN.staffId])).rows[0].id as string;
  port.patients.set(nik, [{ ihs, name: "Siti Rahma", birthDate: "1990-06-15", gender: "female" }]);
  const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by, checked_in_at) values ($1, $2, $3, 'walk_in', $4, now() - interval '2 hours') returning id`,
    [A.tenantId, A.b1, pt, OWN.staffId])).rows[0].id as string;
  const tk = (await h.admin.query(`insert into queue_tickets (tenant_id, branch_id, queue_date, seq, prefix, visit_id) values ($1, $2, current_date, $3, 'R', $4) returning id`,
    [A.tenantId, A.b1, ++n, v])).rows[0].id as string;
  await h.admin.query(`update queue_tickets set state = 'called', called_at = now(), called_by = $2, room_id = $3 where id = $1`, [tk, OWN.staffId, room1]);
  const { examId } = await as(DOC, (db) => openExam(db, key(), v));
  await as(DOC, (db) => saveExam(db, key(), examId, { assessment: "Akne", icd10_codes: ["L70.0"], vitals: o.vitals ?? { nadi: 80, td_sistolik: 120 } }));
  // stand-ins for the M3 writers: a plan item, a counted finished execution, a signed prescription with one item, a handed dispensing
  const plan = await paused(["care_plans"], async () => (await h.admin.query(`insert into care_plans (tenant_id, branch_id, patient_id, title, condition, created_exam_id, created_by)
    values ($1, $2, $3, 'Rencana', 'Kondisi', $4, $5) returning id`, [A.tenantId, A.b1, pt, examId, DOC.staffId])).rows[0].id as string);
  const pi = await paused(["plan_items"], async () => (await h.admin.query(`insert into plan_items (tenant_id, branch_id, plan_id, examination_id, stage, catalog_version_id, qty)
    values ($1, $2, $3, $4, 1, $5, 1) returning id`, [A.tenantId, A.b1, plan, examId, svc.versionId])).rows[0].id as string);
  const perf = o.performer ?? DOC;
  const exec = await paused(["treatment_executions"], async () => (await h.admin.query(`insert into treatment_executions (tenant_id, branch_id, visit_id, plan_item_id,
      performer_staff_id, identity_confirmed, state, started_by, started_as, start_command_key, started_at, finished_at, finished_by, finished_as, finish_command_key, outcome)
    values ($1, $2, $3, $4, $5, true, 'finished', $5, 'doctor', $6, now() - interval '50 minutes', now() - interval '20 minutes', $5, 'doctor', $7, 'completed') returning id`,
    [A.tenantId, A.b1, v, pi, perf.staffId, `k-${key()}`, `k-${key()}`])).rows[0].id as string);
  const presc = o.prescriber ?? DOC;
  const rx = await paused(["prescriptions"], async () => (await h.admin.query(`insert into prescriptions (tenant_id, branch_id, visit_id, patient_id, prescriber_staff_id, state,
      command_key, signed_at, valid_until, set48_snapshot) values ($1, $2, $3, $4, $5, 'signed', $6, now() - interval '40 minutes', now() + interval '30 days', '{}'::jsonb) returning id`,
    [A.tenantId, A.b1, v, pt, presc.staffId, `k-${key()}`])).rows[0].id as string);
  const it = await paused(["prescription_items"], async () => (await h.admin.query(`insert into prescription_items (tenant_id, branch_id, visit_id, prescription_id, catalog_version_id,
      stock_item_id, kfa_code, signa, quantity) values ($1, $2, $3, $4, $5, $6, $7, '3 x 1 tablet', 10) returning id`,
    [A.tenantId, A.b1, v, rx, drug.versionId, drug.stockItemId, o.kfa === undefined ? "93001019" : o.kfa])).rows[0].id as string);
  const disp = o.dispenser ?? APT;
  const d = await paused(["dispensings"], async () => (await h.admin.query(`insert into dispensings (tenant_id, branch_id, visit_id, patient_id, prescription_item_id, stock_item_id,
      quantity, state, prepared_at, prepared_by, prepare_key, depot_id, handed_at, handed_by, hand_key, checks)
    values ($1, $2, $3, $4, $5, $6, 10, 'handed', now() - interval '15 minutes', $7, $8, $10, now() - interval '10 minutes', $7, $9, '{}'::jsonb) returning id`,
    [A.tenantId, A.b1, v, pt, it, drug.stockItemId, disp.staffId, `k-${key()}`, `k-${key()}`, depot]).catch(async (e) => { throw e; })).rows[0].id as string);
  await as(DOC, (db) => signRecord(db, key(), examId, STEP));
  await h.admin.query(`update visits set closed_at = now() - interval '1 minute', closed_by = checked_in_by where id = $1`, [v]);
  return { v, pt, examId, exec, rx, it, d };
}

describe("T-102 increment 2: all resource types end to end, dependency order, identifiers from the guide", () => {
  it("a closed visit with vitals, a mapped treatment, a signed KFA item and a handed dispensing sends every type, parents before children", async () => {
    const port = mockSatusehatPort();
    await as(FH, (db) => setCodeMap(db, key(), { itemId: svc.itemId, code: "99.29", display: "Injeksi terapi lain" }));
    const f = await fullVisit(port, "P50000001");
    await sync(port);
    await sync(port, 1); // the Encounter update naming its diagnosis, any second pass
    const ls = await links(f.v);
    expect(ls.filter((l) => l.fhir_type === "Observation").map((l) => l.local_key)).toEqual(["exam:nadi", "exam:td_sistolik"]);
    expect(ls.map((l) => [l.fhir_type, l.status])).toEqual([
      ["Condition", "confirmed"], ["Encounter", "confirmed"], ["Medication", "confirmed"], ["MedicationDispense", "confirmed"], ["MedicationRequest", "confirmed"],
      ["Observation", "confirmed"], ["Observation", "confirmed"], ["Procedure", "confirmed"]]);
    const enc = (await link(f.v, "Encounter")).remote_id!;
    const obs = remote(port, (await link(f.v, "Observation", "exam:nadi")).remote_id);
    expect(obs).toMatchObject({ status: "final", identifier: [{ system: `http://sys-ids.kemkes.go.id/observation/${A.org1}`, value: `${f.v}:nadi` }],
      code: { coding: [{ system: "http://loinc.org", code: "8867-4" }] }, encounter: { reference: `Encounter/${enc}` },
      valueQuantity: { value: 80, system: "http://unitsofmeasure.org", code: "/min" } });
    const prc = remote(port, (await link(f.v, "Procedure")).remote_id);
    expect(prc).toMatchObject({ status: "completed", identifier: [{ system: `http://sys-ids.kemkes.go.id/procedure/${A.org1}`, value: f.exec }],
      code: { coding: [{ system: "http://hl7.org/fhir/sid/icd-9-cm", code: "99.29" }] }, encounter: { reference: `Encounter/${enc}` } });
    const med = (await link(f.v, "Medication")).remote_id!;
    expect(remote(port, med)).toMatchObject({ identifier: [{ system: `http://sys-ids.kemkes.go.id/medication/${A.org1}`, value: f.it }],
      code: { coding: [{ system: "http://sys-ids.kemkes.go.id/kfa", code: "93001019" }] },
      extension: [{ url: "https://fhir.kemkes.go.id/r4/StructureDefinition/MedicationType", valueCodeableConcept: { coding: [{ code: "NC" }] } }] });
    const req = (await link(f.v, "MedicationRequest")).remote_id!;
    expect(remote(port, req)).toMatchObject({ status: "completed", intent: "order", medicationReference: { reference: `Medication/${med}` },
      identifier: [{ system: `http://sys-ids.kemkes.go.id/prescription/${A.org1}`, value: f.rx }, { system: `http://sys-ids.kemkes.go.id/prescription-item/${A.org1}`, value: f.it }],
      dosageInstruction: [{ text: "3 x 1 tablet" }], dispenseRequest: { quantity: { value: 10 } }, substitution: { allowedBoolean: false } });
    expect(remote(port, (await link(f.v, "MedicationDispense")).remote_id)).toMatchObject({ status: "completed",
      identifier: [{ system: `http://sys-ids.kemkes.go.id/medicationdispense/${A.org1}`, value: f.d }], context: { reference: `Encounter/${enc}` },
      authorizingPrescription: [{ reference: `MedicationRequest/${req}` }], medicationReference: { reference: `Medication/${med}` }, substitution: { wasSubstituted: false } });
    // parents before children: every child's create came after its parent's
    const order = port.calls.filter((c) => c.kind === "create").map((c) => c.type);
    expect(order.indexOf("Encounter")).toBeLessThan(order.indexOf("Observation"));
    expect(order.indexOf("Medication")).toBeLessThan(order.indexOf("MedicationRequest"));
    expect(order.indexOf("MedicationRequest")).toBeLessThan(order.indexOf("MedicationDispense"));
    expect((await outbox(f.v)).at(-1)!.state).toBe("done");
  });

  it("per-link holds: no KFA code, an unmapped service, an unlinked dispenser — held per link while the rest of the visit sends; a map or link releases them", async () => {
    const port = mockSatusehatPort();
    const S2 = await as(OWN, (db) => publish(db, { kind: "service", code: "SR-SVC2" }, {
      name: "Layanan Lain", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 100_000, category: "facial",
      prep_min: 0, treatment_min: 30, buffer_min: 0, indications: "Indikasi", consent_template: "Templat", delegation: "Dokter",
      aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }] } as never, "Layanan baru"));
    if (S2.approvalId) {
      const { decideApproval } = await import("../../../src/modules/approvals/approvals");
      await as(FH, (db) => decideApproval(db, S2.approvalId!, true));
    }
    const old = svc; svc = { itemId: S2.itemId, versionId: S2.versionId };
    const APT2 = await person(A, "pharmacist");
    let f: Awaited<ReturnType<typeof fullVisit>>;
    try {
      f = await fullVisit(port, "P50000002", { kfa: null, dispenser: APT2 });
    } finally {
      svc = old;
    }
    await sync(port, 10); await sync(port, 11);
    expect((await link(f.v, "Procedure"))).toMatchObject({ status: "held", status_reason: "terminology_unmapped" });
    expect((await link(f.v, "Medication"))).toMatchObject({ status: "held", status_reason: "terminology_unmapped" });
    expect((await link(f.v, "Observation", "exam:nadi")).status).toBe("confirmed");
    expect((await link(f.v, "Condition")).status).toBe("confirmed");
    expect((await link(f.v, "MedicationDispense"))).toMatchObject({ status: "held", status_reason: "practitioner_unresolved" });
    expect((await outbox(f.v)).at(-1)!.state).toBe("done"); // nothing that can progress keeps the item busy
    // the map writer: facility head or owner only; a map releases the Procedure; a link releases the dispense (still behind the held Medication)
    expect(await code(as(MGR, (db) => setCodeMap(db, key(), { itemId: S2.itemId, code: "99.29", display: "Injeksi" })))).toBe("ERR_FORBIDDEN");
    expect(await code(as(FH, (db) => setCodeMap(db, key(), { itemId: S2.itemId, code: "abc", display: "Injeksi" })))).toBe("ERR_INVALID_INPUT");
    // the map alone re-queues the visit and releases the Procedure; the dispenser stays held
    await as(FH, (db) => setCodeMap(db, key(), { itemId: S2.itemId, code: "99.29", display: "Injeksi terapi lain" }));
    await sync(port, 12);
    expect((await link(f.v, "Procedure")).status).toBe("confirmed");
    expect(await link(f.v, "MedicationDispense")).toMatchObject({ status: "held", status_reason: "practitioner_unresolved" });
    // the link alone re-queues the visit and releases the dispense, which then waits for its held Medication (nothing sent)
    await as(FH, (db) => linkPractitioner(db, key(), { staffId: APT2.staffId, ihs: "N99000777" }));
    await sync(port, 13);
    expect((await link(f.v, "MedicationDispense")).status).toBe("queued");
    expect(port.count("create", "MedicationDispense")).toBe(0);
  });
});

describe("T-102 increment 2: per-type reconciliation (documented searches only)", () => {
  it("an uncertain create of each searchable type is found by its exact identifier with the documented search — no duplicate", async () => {
    const port = mockSatusehatPort();
    await as(FH, (db) => setCodeMap(db, key(), { itemId: svc.itemId, code: "99.29", display: "Injeksi terapi lain" }));
    const f = await fullVisit(port, "P50000003");
    // the first create of every searchable child type commits remotely but its answer is lost (Encounter, Condition, Medication normal)
    const create = port.create;
    const seen = new Set<string>();
    port.create = async (tok, env, body) => {
      if (["Observation", "Procedure", "MedicationRequest", "MedicationDispense"].includes(body.resourceType) && !seen.has(body.resourceType)) {
        seen.add(body.resourceType);
        await create(tok, env, body);
        return { kind: "timeout" };
      }
      return create(tok, env, body);
    };
    await sync(port, 20); await sync(port, 21);
    port.create = create;
    for (let m = 22; m < 30; m++) await sync(port, m);
    const expectOne = (type: string, value: string) =>
      expect([...port.store.values()].filter((x) => x.resourceType === type && (x.identifier as { value: string }[]).some((i) => i.value === value)).length, `${type} ${value}`).toBe(1);
    for (const l of (await links(f.v)).filter((x) => x.fhir_type !== "Encounter")) expect(l.status, `${l.fhir_type} ${l.local_key}`).toBe("confirmed");
    expectOne("Observation", `${f.v}:nadi`); expectOne("Observation", `${f.v}:td_sistolik`);
    expectOne("Procedure", f.exec); expectOne("MedicationRequest", f.it); expectOne("MedicationDispense", f.d);
    // each was reconciled by search (the documented parameter), never re-created
    for (const t of ["Observation", "Procedure", "MedicationRequest", "MedicationDispense"]) {
      expect((await attempts(f.v, t)).map((a) => a.verb), t).toContain("search");
    }
    expect(port.calls.filter((c) => c.kind === "search").map((c) => c.type)).not.toContain("Medication");
  });

  it("Medication has no search: an uncertain Medication create becomes an exception at once — never searched, never re-created; its request and dispense wait; Kirim Ulang creates it anew and they follow", async () => {
    const port = mockSatusehatPort();
    await as(FH, (db) => setCodeMap(db, key(), { itemId: svc.itemId, code: "99.29", display: "Injeksi terapi lain" }));
    const f = await fullVisit(port, "P50000013");
    const create = port.create;
    let once = false;
    port.create = async (tok, env, body) => {
      if (body.resourceType === "Medication" && !once) { once = true; return { kind: "timeout" }; } // the commit never happened
      return create(tok, env, body);
    };
    for (let m = 60; m < 66; m++) await sync(port, m);
    port.create = create;
    expect(await link(f.v, "Medication")).toMatchObject({ status: "exception", status_reason: "reconcile_unresolved", remote_id: null });
    expect(port.count("search", "Medication")).toBe(0);
    expect((await attempts(f.v, "Medication")).map((a) => [a.verb, a.outcome])).toEqual([["create", "timeout"]]);
    expect((await link(f.v, "MedicationRequest")).status).toBe("queued");
    expect((await link(f.v, "MedicationDispense")).status).toBe("queued");
    expect([port.count("create", "MedicationRequest"), port.count("create", "MedicationDispense")]).toEqual([0, 0]);
    expect((await outbox(f.v)).at(-1)!.state).toBe("done"); // nothing can progress without a person
    await as(RO, (db) => resend(db, f.v, "remote_checked"));
    for (let m = 66; m < 70; m++) await sync(port, m);
    expect((await links(f.v)).filter((l) => l.fhir_type.startsWith("Medication")).map((l) => l.status)).toEqual(["confirmed", "confirmed", "confirmed"]);
    expect(port.count("create", "Medication")).toBe(1); // the first never committed: one Medication remotely
  });
});

describe("T-102 increment 2: uncertain update and the projection per type", () => {
  it("provider-added fields never change a type's fingerprint; every writer-controlled field does", () => {
    const base = { org: "10000001", patientIhs: "P1", practitionerIhs: "N1", encounterId: "e-1" };
    const types: [Fhir, (string | number)[][]][] = [
      [observation({ ...base, visitId: "v", field: "nadi", code: "8867-4", display: "Heart rate", value: 80, unit: "beats/minute", ucum: "/min", effective: "2026-11-17T01:00:00Z" }),
        [["valueQuantity", "value"], ["code", "coding", 0, "code"], ["code", "coding", 0, "display"], ["performer", 0, "reference"], ["effectiveDateTime"], ["status"]]],
      [procedure({ ...base, executionId: "x-1", code: "99.29", display: "Injeksi", start: "2026-11-17T01:00:00Z", end: "2026-11-17T01:30:00Z" }),
        [["code", "coding", 0, "code"], ["code", "coding", 0, "display"], ["performer", 0, "actor", "reference"], ["performedPeriod", "end"], ["identifier", 0, "value"]]],
      [medication({ org: "10000001", itemId: "i-1", kfa: "93001019" }),
        [["code", "coding", 0, "code"], ["extension", 0, "valueCodeableConcept", "coding", 0, "code"], ["extension", 0, "valueCodeableConcept", "coding", 0, "display"], ["status"]]],
      [medicationRequest({ ...base, prescriptionId: "r-1", itemId: "i-1", medicationId: "m-1", authoredOn: "2026-11-17T01:00:00Z", signa: "3 x 1", quantity: 10 }),
        [["requester", "reference"], ["medicationReference", "reference"], ["dosageInstruction", 0, "text"], ["dispenseRequest", "quantity", "value"], ["identifier", 1, "value"],
         ["category", 0, "coding", 0, "display"], ["substitution", "allowedBoolean"]]],
      [medicationDispense({ ...base, dispensingId: "d-1", medicationId: "m-1", requestId: "q-1", handedOver: "2026-11-17T01:00:00Z", quantity: 10 }),
        [["authorizingPrescription", 0, "reference"], ["performer", 0, "actor", "reference"], ["quantity", "value"], ["whenHandedOver"], ["context", "reference"],
         ["category", "coding", 0, "display"], ["substitution", "wasSubstituted"]]],
    ];
    const set = (o: Fhir, path: (string | number)[], v: unknown): Fhir => {
      const c = structuredClone(o) as Record<string | number, unknown>;
      let x = c;
      for (const k of path.slice(0, -1)) x = x[k] as Record<string | number, unknown>;
      x[path[path.length - 1]] = v;
      return c as Fhir;
    };
    for (const [r, paths] of types) {
      for (const p of paths) expect(bodyFingerprint(set(r, p, "changed-x")), `${r.resourceType} ${p.join(".")}`).not.toBe(bodyFingerprint(r));
      const server = { ...structuredClone(r), id: "srv-1", meta: { versionId: "7" }, text: { div: "x" }, subject: { ...(r.subject as object ?? {}), display: "Nama" } } as Fhir;
      if (!r.subject) delete (server as Record<string, unknown>).subject;
      expect(bodyFingerprint(server), r.resourceType).toBe(bodyFingerprint(r));
    }
  });
});

describe("T-102 increment 2: amendment during send (fingerprint equality before any no-send advance)", () => {
  it("a changed vital is updated; an unchanged Medication advances without a send; a removed vital becomes withdrawal_pending", async () => {
    const port = mockSatusehatPort();
    await as(FH, (db) => setCodeMap(db, key(), { itemId: svc.itemId, code: "99.29", display: "Injeksi terapi lain" }));
    const f = await fullVisit(port, "P50000004", { vitals: { nadi: 80, td_sistolik: 120 } });
    await sync(port, 30); await sync(port, 31);
    const before = { obsUpd: port.count("update", "Observation"), medUpd: port.count("update", "Medication"), medCr: port.count("create", "Medication") };
    await as(DOC, (db) => correctRecord(db, key(), f.examId, { vitals: { nadi: 88 } }, "Koreksi nadi"));
    await sync(port, 32); await sync(port, 33);
    expect(port.count("update", "Observation") - before.obsUpd).toBe(1);
    expect(remote(port, (await link(f.v, "Observation", "exam:nadi")).remote_id).valueQuantity).toMatchObject({ value: 88 });
    expect(await link(f.v, "Observation", "exam:nadi")).toMatchObject({ status: "confirmed", confirmed_revision: 2 });
    expect(await link(f.v, "Observation", "exam:td_sistolik")).toMatchObject({ status: "withdrawal_pending", status_reason: "source_removed" });
    expect(await link(f.v, "Medication")).toMatchObject({ status: "confirmed", confirmed_revision: 2 });
    expect([port.count("update", "Medication"), port.count("create", "Medication")]).toEqual([before.medUpd, before.medCr]);
  });

  it("a Procedure map changed A → B between revisions: revision 1's attempt keeps A, revision 2 pins B and is confirmed only after its update", async () => {
    const port = mockSatusehatPort();
    await as(FH, (db) => setCodeMap(db, key(), { itemId: svc.itemId, code: "99.29", display: "Peta A" }));
    const f = await fullVisit(port, "P50000005");
    await sync(port, 40); await sync(port, 41);
    const p1 = await link(f.v, "Procedure");
    expect(remote(port, p1.remote_id).code).toMatchObject({ coding: [{ code: "99.29" }] });
    await as(FH, (db) => setCodeMap(db, key(), { itemId: svc.itemId, code: "99.21", display: "Peta B" }));
    await as(DOC, (db) => correctRecord(db, key(), f.examId, { assessment: "Akne koreksi" }, "Koreksi"));
    port.next("update", { kind: "timeout", commit: "never" });
    await sync(port, 42);
    expect(await link(f.v, "Procedure")).toMatchObject({ current_revision: 2, confirmed_revision: 1 });
    const pins = (await h.admin.query(`select r.revision, r.materialized ->> 'code' code from satusehat_link_revisions r join satusehat_links l on l.id = r.link_id
      where l.visit_id = $1 and l.fhir_type = 'Procedure' order by r.revision`, [f.v])).rows;
    expect(pins).toEqual([{ revision: 1, code: "99.29" }, { revision: 2, code: "99.21" }]);
    expect(remote(port, p1.remote_id).code).toMatchObject({ coding: [{ code: "99.29" }] }); // still A remotely: never confirmed at 2
    await sync(port, 43); await sync(port, 74); // read back shows A → not revision 2's body → update_unresolved, never confirmed at 2
    expect(await link(f.v, "Procedure")).toMatchObject({ status: "exception", status_reason: "update_unresolved", confirmed_revision: 1 });
    await as(RO, (db) => resend(db, f.v, "provider_recovered"));
    await sync(port, 75);
    expect(await link(f.v, "Procedure")).toMatchObject({ status: "confirmed", confirmed_revision: 2 });
    expect(remote(port, p1.remote_id).code).toMatchObject({ coding: [{ code: "99.21" }] });
  });

  it("a prescriber's IHS id re-linked between revisions: the MedicationRequest is updated with the new requester", async () => {
    const port = mockSatusehatPort();
    const DOC2 = await person(A, "doctor");
    await as(OWN, (db) => linkPractitioner(db, key(), { staffId: DOC2.staffId, ihs: "N70000001" }));
    const f = await fullVisit(port, "P50000006", { prescriber: DOC2 });
    await sync(port, 50); await sync(port, 51);
    const req = await link(f.v, "MedicationRequest");
    expect(remote(port, req.remote_id).requester).toMatchObject({ reference: "Practitioner/N70000001" });
    await as(OWN, (db) => linkPractitioner(db, key(), { staffId: DOC2.staffId, ihs: "N70000002" }));
    await as(DOC, (db) => correctRecord(db, key(), f.examId, { assessment: "Akne koreksi" }, "Koreksi"));
    await sync(port, 52); await sync(port, 53);
    expect(await link(f.v, "MedicationRequest")).toMatchObject({ status: "confirmed", confirmed_revision: 2 });
    expect(remote(port, req.remote_id).requester).toMatchObject({ reference: "Practitioner/N70000002" });
  });
});

describe("T-102 increment 2: only counted, finished executions are reported", () => {
  it("a treatment stopped by the clinic (not counted) is never a Procedure", async () => {
    const port = mockSatusehatPort();
    await as(FH, (db) => setCodeMap(db, key(), { itemId: svc.itemId, code: "99.29", display: "Injeksi terapi lain" }));
    const f = await fullVisit(port, "P50000020");
    await paused(["treatment_executions"], () => h.admin.query(`update treatment_executions set outcome = 'clinic_stop', stop_reason = 'Alat rusak' where id = $1`, [f.exec]));
    for (let m = 90; m < 93; m++) await sync(port, m);
    expect((await links(f.v)).filter((l) => l.fhir_type === "Procedure")).toEqual([]);
    expect(port.count("create", "Procedure")).toBe(0);
  });
});

describe("T-102 increment 2 review r1 repairs (Sol 522dedbc)", () => {
  it("P1: a provider-added extension on a Medication leaves the fingerprint; removing or changing the MedicationType extension changes it", () => {
    const m = medication({ org: "10000001", itemId: "i-1", kfa: "93001019" });
    const ext = (m.extension as unknown[]) ?? [];
    const withOther = { ...m, extension: [...ext, { url: "https://fhir.kemkes.go.id/r4/StructureDefinition/Other", valueString: "x" }] } as Fhir;
    expect(bodyFingerprint(withOther)).toBe(bodyFingerprint(m));
    expect(bodyFingerprint({ ...m, extension: [] } as Fhir)).not.toBe(bodyFingerprint(m));
    const changed = structuredClone(m) as Record<string, unknown>;
    ((changed.extension as { valueCodeableConcept: { coding: { code: string }[] } }[])[0].valueCodeableConcept.coding[0]).code = "SD";
    expect(bodyFingerprint(changed as Fhir)).not.toBe(bodyFingerprint(m));
  });

  // P2-1: per type, an update that committed but whose answer was lost while a newer revision is materialized: the read-back confirms only the
  // attempted revision and the newer write waits behind the barrier, then is sent; a mismatching read-back is never confirmed.
  for (const t of ["Observation", "Procedure", "Medication", "MedicationRequest", "MedicationDispense"] as const) {
    it(`P2-1 ${t}: a lost committed update with a newer revision pending confirms only its own revision, then the newer one is sent; a mismatch never confirms`, async () => {
      const port = mockSatusehatPort();
      await as(FH, (db) => setCodeMap(db, key(), { itemId: svc.itemId, code: "99.29", display: "Peta A" }));
      const DOC2 = await person(A, "doctor"); const APT2 = await person(A, "pharmacist"); const PERF2 = await person(A, "doctor");
      for (const p of [DOC2, APT2, PERF2]) await as(OWN, (db) => linkPractitioner(db, key(), { staffId: p.staffId, ihs: `N8${String(++n).padStart(7, "0")}` }));
      const f = await fullVisit(port, `P51${String(++n).padStart(6, "0")}`, { prescriber: DOC2, dispenser: APT2, performer: PERF2 });
      for (let m = 0; m < 3; m++) await sync(port, 100 + m);
      const l0 = await link(f.v, t, t === "Observation" ? "exam:nadi" : undefined);
      expect(l0.status).toBe("confirmed");
      // revision n+1 re-pins this type's inputs: a vital; the service map; the prescriber's / dispenser's IHS id; the KFA register row
      const change = async (to: number) => {
        if (t === "Observation") await as(DOC, (db) => correctRecord(db, key(), f.examId, { vitals: { nadi: 80 + to * 5, td_sistolik: 120 } }, "Koreksi"));
        else if (t === "Procedure") {
          await as(FH, (db) => setCodeMap(db, key(), { itemId: svc.itemId, code: to === 1 ? "99.21" : "99.22", display: "Peta lain" }));
          await as(DOC, (db) => correctRecord(db, key(), f.examId, { assessment: `Koreksi ${to}` }, "Koreksi"));
        } else if (t === "MedicationRequest") {
          await as(OWN, (db) => linkPractitioner(db, key(), { staffId: DOC2.staffId, ihs: `N7${String(++n).padStart(7, "0")}` }));
          await as(DOC, (db) => correctRecord(db, key(), f.examId, { assessment: `Koreksi ${to}` }, "Koreksi"));
        } else if (t === "MedicationDispense") {
          await as(OWN, (db) => linkPractitioner(db, key(), { staffId: APT2.staffId, ihs: `N6${String(++n).padStart(7, "0")}` }));
          await as(DOC, (db) => correctRecord(db, key(), f.examId, { assessment: `Koreksi ${to}` }, "Koreksi"));
        } else {
          // Medication's pinned values: item id, KFA, register, organization — the register row is re-pinned when it is replaced
          await h.admin.query(`update satusehat_code_systems set effective_to = effective_from + 1 where kind = 'kfa' and code = '*' and effective_to is null`);
          await h.admin.query(`insert into satusehat_code_systems (kind, system_uri, code, display, release_ref, provenance_url, effective_from)
            values ('kfa', 'http://sys-ids.kemkes.go.id/kfa', '*', 'KFA ${to}', 'v-${to}', 'https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/medication/', current_date + ${to + 30 + n})`);
          await as(DOC, (db) => correctRecord(db, key(), f.examId, { assessment: `Koreksi ${to}` }, "Koreksi"));
        }
      };
      // every type re-pins on its input change (Medication: a replaced KFA register row — the fingerprint covers the pinned register, so an
      // update is sent, per the addendum's rule, even though the emitted body is the same)
      // revision 2: its update commits remotely, the answer is lost; revision 3 is materialized before the reconciliation
      await change(1);
      const upd = port.update;
      let lost = false;
      port.update = async (tok, env, id, body) => {
        const r = await upd(tok, env, id, body);
        if (body.resourceType === t && !lost) { lost = true; return { kind: "lost" }; }
        return r;
      };
      await sync(port, 110);
      port.update = upd;
      const l1 = await link(f.v, t, t === "Observation" ? "exam:nadi" : undefined);
      expect(l1).toMatchObject({ status: "outcome_unknown", confirmed_revision: 1, current_revision: 2 });
      await change(2);
      const before = port.count("update", t);
      await sync(port, 111); // revision 3 materialized; the barrier: no newer update while revision 2 is unresolved; the read-back confirms 2 only
      const l2 = await link(f.v, t, t === "Observation" ? "exam:nadi" : undefined);
      expect(l2).toMatchObject({ status: "queued", confirmed_revision: 2, current_revision: 3 });
      expect(port.count("update", t)).toBe(before);
      await sync(port, 112); // revision 3 sent
      expect(await link(f.v, t, t === "Observation" ? "exam:nadi" : undefined)).toMatchObject({ status: "confirmed", confirmed_revision: 3 });
      expect(port.count("update", t)).toBe(before + 1);
      // a mismatch: an update lost and the remote holds something else → never confirmed
      await change(3);
      const upd2 = port.update;
      port.update = async (tok, env, id, body) => {
        if (body.resourceType === t) {
          await upd2(tok, env, id, body);
          // the resource that landed differs in a writer-controlled field (Medication carries no subject: its KFA code)
          const cur = port.store.get(id)!;
          port.store.set(id, t === "Medication" ? { ...cur, code: { coding: [{ system: "http://sys-ids.kemkes.go.id/kfa", code: "99999999" }] } }
            : { ...cur, subject: { reference: "Patient/P-OTHER" } });
          return { kind: "timeout" };
        }
        return upd2(tok, env, id, body);
      };
      await sync(port, 120);
      port.update = upd2;
      await sync(port, 121); await sync(port, 152);
      expect(await link(f.v, t, t === "Observation" ? "exam:nadi" : undefined)).toMatchObject({ status: "exception", status_reason: "update_unresolved", confirmed_revision: 3 });
    });
  }

  it("P2-2: the code-map writer is tenant-scoped (another tenant's service is not found, maps stay apart) and refused to a vendor connection", async () => {
    const B = await tenant("PT Klinik Lain Peta");
    const BOWN = await person(B, "owner"); const BFH = await person(B, "facility_head");
    const bs = await as(BOWN, (db) => publish(db, { kind: "service", code: "SRB-SVC" }, {
      name: "Layanan B", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 100_000, category: "facial",
      prep_min: 0, treatment_min: 30, buffer_min: 0, indications: "Indikasi", consent_template: "Templat", delegation: "Dokter",
      aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }] } as never, "Layanan baru"));
    if (bs.approvalId) {
      const { decideApproval } = await import("../../../src/modules/approvals/approvals");
      await as(BFH, (db) => decideApproval(db, bs.approvalId!, true));
    }
    const mapsOf = async (tenantId: string) => (await h.admin.query(`select item_id, code, effective_to is null cur from satusehat_code_maps where tenant_id = $1 order by effective_from`, [tenantId])).rows;
    const auditOk = async (tenantId: string) => (await h.admin.query(`select count(*)::int c from audit_events where tenant_id = $1 and reason_code = 'satusehat_code_map_set'`, [tenantId])).rows[0].c as number;
    // the victim's re-queue state: its outbox items (count, states, next due times) and held links
    const queueOf = async (tenantId: string) => (await h.admin.query(`select id, state, hold_reason, next_at::text from satusehat_outbox where tenant_id = $1 order by id`, [tenantId])).rows;
    const heldOf = async (tenantId: string) => (await h.admin.query(`select id, status, status_reason from satusehat_links where tenant_id = $1 order by id`, [tenantId])).rows;
    const [mapsA, mapsB, audA, audB] = [await mapsOf(A.tenantId), await mapsOf(B.tenantId), await auditOk(A.tenantId), await auditOk(B.tenantId)];
    const [qA, qB, lA, lB] = [await queueOf(A.tenantId), await queueOf(B.tenantId), await heldOf(A.tenantId), await heldOf(B.tenantId)];
    // tenant A's facility head and owner cannot map tenant B's service; tenant B's owner cannot map tenant A's
    expect(await code(as(FH, (db) => setCodeMap(db, key(), { itemId: bs.itemId, code: "99.29", display: "Injeksi" })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(OWN, (db) => setCodeMap(db, key(), { itemId: bs.itemId, code: "99.29", display: "Injeksi" })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BOWN, (db) => setCodeMap(db, key(), { itemId: svc.itemId, code: "11.11", display: "Lain" })))).toBe("ERR_NOT_FOUND");
    // the refused calls changed nothing in either tenant: maps, audit successes, outbox items, links
    expect([await mapsOf(A.tenantId), await mapsOf(B.tenantId), await auditOk(A.tenantId), await auditOk(B.tenantId)]).toEqual([mapsA, mapsB, audA, audB]);
    expect([await queueOf(A.tenantId), await queueOf(B.tenantId), await heldOf(A.tenantId), await heldOf(B.tenantId)]).toEqual([qA, qB, lA, lB]);
    // a replayed key from another tenant answers nothing of tenant A
    const kA = key();
    await as(FH, (db) => setCodeMap(db, kA, { itemId: svc.itemId, code: "99.29", display: "Injeksi terapi lain" }));
    expect(await code(as(BOWN, (db) => setCodeMap(db, kA, { itemId: bs.itemId, code: "99.29", display: "Injeksi" })))).toBe("ok"); // its own new row
    expect((await mapsOf(B.tenantId)).filter((m) => m.cur).length).toBe(1);
    expect((await mapsOf(A.tenantId)).length).toBe(mapsA.length + 1);
    expect(await auditOk(A.tenantId)).toBe(audA + 1);
    expect(await auditOk(B.tenantId)).toBe(audB + 1);
    void mapsB;
    // a vendor connection reaches no tenant function: tenant A (the target) is snapshotted right before the call and compared in full after
    const vendorBefore = [await mapsOf(A.tenantId), await auditOk(A.tenantId), await queueOf(A.tenantId), await heldOf(A.tenantId)];
    const vendor = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [VENDOR_GROUP_ROLE])), max: 1 }, VENDOR_GROUP_ROLE);
    try {
      const c = await vendor.connect();
      try {
        expect(await c.query(`select satusehat_code_map_set($1, $2, '99.29', 'Injeksi')`, [`k-${key()}`, svc.itemId]).then(() => "ok", (e) => `raw:${e.code}`)).toMatch(/^raw:42501$/);
      } finally {
        c.release();
      }
    } finally {
      await vendor.end();
    }
    // the vendor's refused call changed nothing of tenant A: maps (contents), audit successes, outbox items and links
    expect([await mapsOf(A.tenantId), await auditOk(A.tenantId), await queueOf(A.tenantId), await heldOf(A.tenantId)]).toEqual(vendorBefore);
  });
});

