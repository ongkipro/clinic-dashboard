// T-102 increment 3 gate (UX-23, 17:62 / :174, 07:63; plan r4 §9): the page reader's projection per role and its negatives. Owner, manager,
// facility head and records officer read the branch monitor with codes only (no provider body, no clinical content); only the facility head
// gets the way to the record (patient id) and the provider's error body (clinical class, audited); facility head and records officer read the
// identity queue and no-room visits; owner and facility head the practitioner and ICD-9 CM lists; Admin Pusat reads counts only; a doctor only
// his own signed visits. Every other role is refused; another branch, another tenant and the vendor read nothing. Mock port, synthetic data
// (MIG-2), fetch never called.
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Role } from "../../../src/auth/policy";
import { APP_GROUP_ROLE, VENDOR_GROUP_ROLE, withTenantContext } from "../../../src/db/rls/context";
import { openAppPool } from "../../../src/db/rls/pool";
import { CommandError } from "../../../src/lib/command";
import { encryptField, newWrappedDek, type KekRing } from "../../../src/lib/keys/envelope";
import { setKekRingForTests } from "../../../src/lib/keys/runtime";
import { openExam, saveExam } from "../../../src/modules/clinical/exam/exam";
import { signRecord, type StepUp } from "../../../src/modules/clinical/records/records";
import { mockSatusehatPort, type MockSatusehat } from "../../../src/modules/integrations/satusehat/mock";
import { errorBody, linkPractitioner, resend, runSatusehatSync, satusehatPage, setCredentials } from "../../../src/modules/integrations/satusehat/satusehat";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { IDENTITY_PURPOSE } from "../../../src/modules/patients/patients";
import { resendable } from "../../../src/app/(app)/satusehat/labels";
import { createHarness, type Harness, testPool } from "../../rls/harness";
import { stepUpForTests } from "../../support/step-up";

process.env.DEPLOY_ENV = "local";

let h: Harness;
let app: pg.Pool;
let worker: pg.Pool;
let owner: pg.Pool;
let n = 0;
const RING: KekRing = { current: 1, keys: new Map([[1, Buffer.alloc(32, 5)]]) };
const STEP: StepUp = stepUpForTests();
type T = { tenantId: string; b1: string; b2: string; org1: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "admin_pusat", "finance", "marketing", "central_cs", "auditor", "purchasing"];

async function tenant(name: string): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, name]);
  const org1 = `5000${String(++n).padStart(4, "0")}`;
  const br = async (c: string, org: string | null) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone, satusehat_org_id) values ($1, $2, $2, 'Asia/Jakarta', $3) returning id`,
    [tenantId, c, org])).rows[0].id as string;
  return { tenantId, b1: await br("P1", org1), b2: await br("P2", null), org1 };
}
async function person(t: T, role: Role, branch?: string): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`sp${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf SP ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  const b = TENANT_WIDE.includes(role) ? undefined : branch ?? t.b1;
  if (b) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: b };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const key = () => crypto.randomUUID();
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const keyRows = new Map<string, { version: number; wrapped: string }>();
async function keysFor(t: T) {
  if (!keyRows.has(t.tenantId)) {
    const w = newWrappedDek(RING, t.tenantId, 1);
    await h.admin.query(`insert into tenant_data_keys (tenant_id, version, wrapped, is_current) values ($1, 1, $2, true) on conflict do nothing`, [t.tenantId, w.wrapped]);
    keyRows.set(t.tenantId, (await h.admin.query(`select version, wrapped from tenant_data_keys where tenant_id = $1 and version = 1`, [t.tenantId])).rows[0]);
  }
  const d = { tenantId: t.tenantId, ...keyRows.get(t.tenantId)! };
  return { tenantId: t.tenantId, current: d, byVersion: (v: number) => (v === d.version ? d : undefined) };
}
async function credential(t: T, p: P, rec: P, ver: P) {
  for (const [kind, b] of [["str", null], ["sip", t.b1]] as const) {
    const id = (await h.admin.query(`insert into staff_credentials (tenant_id, staff_id, kind, number, issuer, profession, branch_id, valid_from, expires_on, recorded_by)
       values ($1, $2, $3, $4, 'Konsil Kesehatan', 'dokter', $5, '2024-01-01', $6, $7) returning id`,
      [t.tenantId, p.staffId, kind, `NO-SP-${++n}`, b, b ? "2099-12-31" : null, rec.staffId])).rows[0].id as string;
    await h.admin.query(`update staff_credentials set state = 'verified', decided_by = $2, decided_at = now() where id = $1`, [id, ver.staffId]);
  }
}
async function patient(t: T, nik: string | null, name = "Siti Rahma") {
  return (await h.admin.query(`insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, no_identity_reason, religion,
      occupation, education, marital_status, registered_branch_id, created_by, created_as)
    values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $2, '1990-06-15', 'female', $3, $4, $5, $6, 'islam', 'Karyawan', 's1', 'kawin', $7,
      (select id from staff where tenant_id = $1 limit 1), 'fo_cashier') returning id`,
    [t.tenantId, name, nik ? "nik" : "newborn_via_guardian", nik ? encryptField(RING, await keysFor(t), IDENTITY_PURPOSE, nik) : null,
     nik ? `bidx${String(++n).padStart(39, "0")}` : null, nik ? null : "Fixture sintetis", t.b1])).rows[0].id as string;
}
// A signed, closed visit by `doc` called to `roomId` (null: no room chosen).
async function signedVisit(t: T, doc: P, pt: string, roomId: string | null) {
  const by = (await h.admin.query(`select id from staff where tenant_id = $1 limit 1`, [t.tenantId])).rows[0].id;
  const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by, checked_in_at) values ($1, $2, $3, 'walk_in', $4, now() - interval '2 hours') returning id`,
    [t.tenantId, t.b1, pt, by])).rows[0].id as string;
  const tk = (await h.admin.query(`insert into queue_tickets (tenant_id, branch_id, queue_date, seq, prefix, visit_id) values ($1, $2, current_date, $3, 'P', $4) returning id`,
    [t.tenantId, t.b1, ++n, v])).rows[0].id as string;
  if (roomId) await h.admin.query(`update queue_tickets set state = 'called', called_at = now(), called_by = $2, room_id = $3 where id = $1`, [tk, by, roomId]);
  const { examId } = await as(doc, (db) => openExam(db, key(), v));
  await as(doc, (db) => saveExam(db, key(), examId, { assessment: "Akne rahasia klinis", icd10_codes: ["L70.0"], vitals: { nadi: 80 } }));
  await as(doc, (db) => signRecord(db, key(), examId, STEP));
  await h.admin.query(`update visits set closed_at = now() - interval '1 minute', closed_by = checked_in_by where id = $1`, [v]);
  return v;
}
const sync = (port: MockSatusehat, min = 0) => runSatusehatSync(worker, { port, now: new Date(Date.now() + min * 60_000) });

const fetchSpy = vi.fn();
let A: T; let B: T;
let OWN: P; let AP: P; let MGR: P; let FH: P; let RO: P; let DOC: P; let DOC2: P; let NUR: P; let FO: P; let MKT: P; let AUD: P; let FIN: P; let RO2: P; let BOWN: P;
let room1: string;
let rejected: string; let rejectedPt: string; let review: string; let reviewPt: string; let noRoom: string; let other: string; let attempt: string;

beforeAll(async () => {
  setKekRingForTests(RING);
  vi.stubGlobal("fetch", fetchSpy);
  h = await createHarness();
  const login = h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE]));
  app = await openAppPool({ connectionString: login, max: 6 });
  worker = await openAppPool({ connectionString: login, max: 2 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant("PT Klinik Halaman SATUSEHAT");
  B = await tenant("PT Klinik Lain Halaman");
  OWN = await person(A, "owner"); AP = await person(A, "admin_pusat"); MGR = await person(A, "manager"); FH = await person(A, "facility_head");
  RO = await person(A, "records_officer"); DOC = await person(A, "doctor"); DOC2 = await person(A, "doctor"); NUR = await person(A, "nurse");
  FO = await person(A, "fo_cashier"); MKT = await person(A, "marketing"); AUD = await person(A, "auditor"); FIN = await person(A, "finance");
  RO2 = await person(A, "records_officer", A.b2); BOWN = await person(B, "owner");
  await credential(A, DOC, OWN, FH); await credential(A, DOC2, OWN, FH);
  room1 = (await h.admin.query(`insert into rooms (tenant_id, branch_id, name, kind, satusehat_location_id) values ($1, $2, 'Ruang P', 'consultation', 'loc-p-0001') returning id`,
    [A.tenantId, A.b1])).rows[0].id as string;
  await keysFor(A);
  await as(OWN, (db) => setCredentials(db, key(), { branchId: A.b1, environment: "sandbox", organizationId: A.org1, clientId: "client-p1", clientSecret: "rahasia-sintetis-p1" }));
  await as(OWN, (db) => linkPractitioner(db, key(), { staffId: DOC.staffId, ihs: "N60000001" }));
  await as(OWN, (db) => linkPractitioner(db, key(), { staffId: DOC2.staffId, ihs: "N60000002" }));
  const port = mockSatusehatPort();
  // 1. rejected by the provider (4xx with a body that must stay with the facility head)
  const nik1 = `3174${String(++n).padStart(12, "0")}`;
  rejectedPt = await patient(A, nik1);
  port.patients.set(nik1, [{ ihs: "P60000001", name: "Siti Rahma", birthDate: "1990-06-15", gender: "female" }]);
  rejected = await signedVisit(A, DOC, rejectedPt, room1);
  port.next("create", { kind: "http_4xx", code: "invalid", path: "Encounter.period" });
  await sync(port);
  attempt = (await h.admin.query(`select a.id from satusehat_attempts a join satusehat_links l on l.id = a.link_id where l.visit_id = $1`, [rejected])).rows[0].id as string;
  // 2. a patient without NIK: identity review, the item held
  reviewPt = await patient(A, null, "Bayi Sintetis");
  review = await signedVisit(A, DOC2, reviewPt, room1);
  // 3. a visit with no room chosen
  noRoom = await signedVisit(A, DOC2, await patient(A, `3174${String(++n).padStart(12, "0")}`), null);
  // 4. a confirmed visit of DOC
  const nik4 = `3174${String(++n).padStart(12, "0")}`;
  const p4 = await patient(A, nik4);
  port.patients.set(nik4, [{ ihs: "P60000004", name: "Siti Rahma", birthDate: "1990-06-15", gender: "female" }]);
  other = await signedVisit(A, DOC, p4, room1);
  await sync(port, 1);
  await sync(port, 2);
  // a service for the code map
  await h.admin.query(`insert into catalog_items (tenant_id, kind, code, created_by) values ($1, 'service', 'SP-LASER', $2)`, [A.tenantId, OWN.staffId]);
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

const PROVIDER_BODY = /OperationOutcome|diagnostics|issue/;
const CLINICAL = /Akne rahasia klinis|L70\.0|assessment|icd10/;

describe("T-102 increment 3: the UX-23 page projection per role (07 :63)", () => {
  it("fixture: one rejected item, one identity review, one no-room visit, one confirmed visit", async () => {
    const st = async (v: string) => (await h.admin.query(`select state, hold_reason from satusehat_outbox where visit_id = $1 and state <> 'superseded' order by created_at desc limit 1`, [v])).rows[0];
    expect((await h.admin.query(`select status, status_reason from satusehat_links where visit_id = $1 and fhir_type = 'Encounter'`, [rejected])).rows[0])
      .toEqual({ status: "failed", status_reason: "http_4xx" });
    expect(await st(review)).toEqual({ state: "held", hold_reason: "identity_review" });
    expect(await st(noRoom)).toEqual({ state: "held", hold_reason: "no_room" });
    expect((await h.admin.query(`select status from satusehat_links where visit_id = $1 and fhir_type = 'Encounter'`, [other])).rows[0].status).toBe("confirmed");
  });

  it("the facility head: counts, exceptions with codes and the patient (the way to the record), identity queue, no-room, practitioners, services; no body", async () => {
    const p = await as(FH, (db) => satusehatPage(db, A.b1));
    expect(p).toMatchObject({ role: "facility_head", branch_id: A.b1, environment: "sandbox", credential_active: true });
    expect(p.counts!.links).toMatchObject({ "failed:http_4xx": 1 });
    expect(p.exceptions).toEqual([expect.objectContaining({ visit_id: rejected, type: "Encounter", status: "failed", reason: "http_4xx", attempt_id: attempt,
      error_code: "invalid", error_path: "Encounter.period", patient_id: rejectedPt })]);
    expect(p.held_items!.map((x) => [x.visit_id, x.reason]).sort()).toEqual([[noRoom, "no_room"], [review, "identity_review"]].sort());
    expect(p.identity_queue).toEqual([expect.objectContaining({ patient_id: reviewPt, name: "Bayi Sintetis", state: "review", reason: "no_nik" })]);
    expect(p.no_room).toEqual([expect.objectContaining({ visit_id: noRoom })]);
    expect(p.rooms).toEqual([{ id: room1, name: "Ruang P" }]);
    expect(p.practitioners!.filter((x) => x.ihs).map((x) => x.ihs).sort()).toEqual(["N60000001", "N60000002"]);
    expect(p.services).toEqual([expect.objectContaining({ code: "SP-LASER", map: null })]);
    expect(p.mine).toBeUndefined();
    expect(JSON.stringify(p)).not.toMatch(PROVIDER_BODY);
    expect(JSON.stringify(p)).not.toMatch(CLINICAL);
    expect(JSON.stringify(p)).not.toMatch(/rahasia-sintetis|secret|3174\d{12}/); // no secret, no NIK
  });

  it("the records officer: monitor, identity queue and no-room; no practitioner or service list, no way to the record", async () => {
    const p = await as(RO, (db) => satusehatPage(db, A.b1));
    expect(p.exceptions!.map((e) => e.patient_id)).toEqual([null]);
    expect(p.identity_queue!.map((x) => x.patient_id)).toEqual([reviewPt]);
    expect(p.no_room!.map((x) => x.visit_id)).toEqual([noRoom]);
    expect(p.practitioners).toBeUndefined();
    expect(p.services).toBeUndefined();
    expect(JSON.stringify(p)).not.toMatch(PROVIDER_BODY);
    expect(JSON.stringify(p)).not.toMatch(CLINICAL);
  });

  it("owner and manager: monitor with codes only and the identity queue; the owner also the practitioner list, both the service list; neither the record nor no-room", async () => {
    const o = await as(OWN, (db) => satusehatPage(db, A.b1));
    expect(o.exceptions!.map((e) => [e.error_code, e.patient_id])).toEqual([["invalid", null]]);
    expect(o.practitioners).toBeDefined(); expect(o.services).toBeDefined();
    expect(o.identity_queue!.map((x) => x.patient_id)).toEqual([reviewPt]); // plan r4 §9: the owner sees the queue (resolving is RO / FH)
    expect(o.no_room).toBeUndefined(); expect(o.rooms).toBeUndefined();
    const m = await as(MGR, (db) => satusehatPage(db, A.b1));
    expect(m.exceptions!.map((e) => [e.error_code, e.patient_id])).toEqual([["invalid", null]]);
    expect(m.identity_queue!.map((x) => x.patient_id)).toEqual([reviewPt]);
    expect(m.services!.map((x) => x.code)).toEqual(["SP-LASER"]); // read only: the map writer refuses a manager
    for (const k of ["no_room", "rooms", "practitioners", "mine"] as const) expect(m[k], k).toBeUndefined();
    for (const p of [o, m]) { expect(JSON.stringify(p)).not.toMatch(PROVIDER_BODY); expect(JSON.stringify(p)).not.toMatch(CLINICAL); }
  });

  it("Admin Pusat: counts and the credential flag only", async () => {
    const p = await as(AP, (db) => satusehatPage(db, A.b1));
    expect(Object.keys(p).sort()).toEqual(["branch_id", "counts", "credential_active", "environment", "role"]);
    expect(p.counts!.links).toMatchObject({ "failed:http_4xx": 1 });
  });

  it("a doctor: only his own signed visits with states (codes only), never another doctor's, never counts or exceptions", async () => {
    const p = await as(DOC, (db) => satusehatPage(db, A.b1));
    expect(Object.keys(p).sort()).toEqual(["branch_id", "credential_active", "environment", "mine", "role"]);
    expect(p.mine!.map((x) => x.visit_id).sort()).toEqual([other, rejected].sort());
    expect(p.mine!.map((x) => x.patient_name)).toEqual(["Siti Rahma", "Siti Rahma"]); // his own patients (the doctor is clinical)
    // the rejected code (plan r4 §9) — the code only, never the provider body
    expect(p.mine!.find((x) => x.visit_id === rejected)!.links).toEqual([{ type: "Condition", status: "queued", reason: null, error_code: null },
      { type: "Encounter", status: "failed", reason: "http_4xx", error_code: "invalid" }, { type: "Observation", status: "queued", reason: null, error_code: null }]);
    expect(p.mine!.find((x) => x.visit_id === other)!.links.find((l) => l.type === "Encounter")!.status).toBe("confirmed");
    const q = await as(DOC2, (db) => satusehatPage(db, A.b1));
    expect(q.mine!.map((x) => x.visit_id).sort()).toEqual([noRoom, review].sort());
    for (const x of [p, q]) { expect(JSON.stringify(x)).not.toMatch(PROVIDER_BODY); expect(JSON.stringify(x)).not.toMatch(CLINICAL); }
  });

  it("every other role is refused (nurse, FO, marketing, auditor, finance)", async () => {
    for (const p of [NUR, FO, MKT, AUD, FIN]) expect(await code(as(p, (db) => satusehatPage(db, A.b1))), p.role).toBe("ERR_FORBIDDEN");
  });

  it("another branch's records officer, another tenant's owner and an unknown branch read nothing", async () => {
    expect(await code(as(RO2, (db) => satusehatPage(db, A.b1)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BOWN, (db) => satusehatPage(db, A.b1)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(OWN, (db) => satusehatPage(db, B.b1)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(OWN, (db) => satusehatPage(db, "00000000-0000-7000-8000-000000000000")))).toBe("ERR_NOT_FOUND");
    // a branch-2 records officer reads branch 2 (no items there)
    const p = await as(RO2, (db) => satusehatPage(db, A.b2));
    expect({ exceptions: p.exceptions, identity: p.identity_queue, credential: p.credential_active }).toEqual({ exceptions: [], identity: [], credential: false });
  });

  it("the vendor reads nothing: the vendor role cannot execute either reader, and no support session reaches SATUSEHAT (support class never)", async () => {
    const vendor = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [VENDOR_GROUP_ROLE])), max: 1 }, VENDOR_GROUP_ROLE);
    try {
      for (const sql of [`select satusehat_page($1)`, `select satusehat_error_body($1)`]) {
        expect(await vendor.query(sql, [A.b1]).then(() => "ok", (e) => `raw:${e.code}`), sql).toBe("raw:42501");
      }
    } finally {
      await vendor.end();
    }
    expect((await h.admin.query(`select count(*)::int c from support_object_kinds where table_name like 'public.satusehat_%' and support_class <> 'never'`)).rows[0].c).toBe(0);
  });
});

describe("T-102 increment 3: the provider's error body is the facility head's only", () => {
  it("the facility head reads the body and the read is audited as a clinical read", async () => {
    const b = await as(FH, (db) => errorBody(db, attempt));
    expect(b).toMatchObject({ resourceType: "OperationOutcome" });
    expect((await h.admin.query(`select action, outcome, reason_code from audit_events where tenant_id = $1 and object_kind = 'satusehat_error' and staff_id = $2`,
      [A.tenantId, FH.staffId])).rows).toEqual([{ action: "clinical_read", outcome: "success", reason_code: "satusehat_error_body" }]);
  });
  it("every other role is refused; another tenant and an unknown attempt read nothing", async () => {
    for (const p of [OWN, AP, MGR, RO, DOC, NUR, FO]) expect(await code(as(p, (db) => errorBody(db, attempt))), p.role).toBe("ERR_FORBIDDEN");
    const BFH = await person(B, "facility_head");
    expect(await code(as(BFH, (db) => errorBody(db, attempt)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(FH, (db) => errorBody(db, "00000000-0000-7000-8000-000000000000")))).toBe("ERR_NOT_FOUND");
  });
  it("a facility head of another branch reads nothing", async () => {
    const FH2 = await person(A, "facility_head", A.b2);
    expect(await code(as(FH2, (db) => errorBody(db, attempt)))).toBe("ERR_NOT_FOUND");
  });
});

// Review r1 (Sol 13649c04) P2: the page offers Kirim Ulang exactly where satusehat_resend acts. Each link state the page can show is put on
// one visit; one resend runs; the links the command re-queued must be exactly those the page's predicate offers Kirim Ulang for, and the
// others (duplicate_remote, organization_changed, a held link) stay unchanged — no false success.
describe("T-102 increment 3: Kirim Ulang eligibility equals what satusehat_resend changes", () => {
  it("the predicate and the command agree on every exception / failed / held state", async () => {
    const CASES: [string, string, string][] = [["Procedure", "exception", "duplicate_remote"], ["MedicationRequest", "exception", "organization_changed"],
      ["Medication", "exception", "reconcile_unresolved"], ["MedicationDispense", "exception", "update_unresolved"], ["Observation", "failed", "http_4xx"],
      ["Condition", "failed", "retry_exhausted"], ["Observation", "held", "terminology_unmapped"]];
    const ids: string[] = [];
    for (const [i, [type, status, why]] of CASES.entries()) {
      const start = status === "failed" ? "queued" : status;
      const id = (await h.admin.query(`insert into satusehat_links (tenant_id, branch_id, environment, visit_id, fhir_type, local_key, organization_id, current_revision,
          status, status_reason) values ($1, $2, 'sandbox', $3, $4, $5, $6, 1, $7, $8) returning id`,
        [A.tenantId, A.b1, other, type, `rv:${i}`, A.org1, start, start === "queued" ? null : why])).rows[0].id as string;
      if (status === "failed") {
        await h.admin.query(`update satusehat_links set status = 'sending' where id = $1`, [id]);
        await h.admin.query(`update satusehat_links set status = 'failed', status_reason = $2 where id = $1`, [id, why]);
      }
      ids.push(id);
    }
    const shown = await as(RO, (db) => satusehatPage(db, A.b1));
    for (const [type, status, why] of CASES) {
      expect(shown.exceptions!.some((e) => e.visit_id === other && e.type === type && e.status === status && e.reason === why), `${type} shown`).toBe(true);
    }
    expect(await as(RO, (db) => resend(db, other, "remote_checked"))).toBe(CASES.filter(([, st, why]) => resendable(st, why)).length); // the real command (env bound)
    for (const [i, [type, status, why]] of CASES.entries()) {
      const after = (await h.admin.query(`select status, status_reason from satusehat_links where id = $1`, [ids[i]])).rows[0];
      const requeued = after.status === "queued";
      expect({ type, why, requeued }).toEqual({ type, why, requeued: resendable(status, why) });
      if (!requeued) expect(after).toEqual({ status, status_reason: why }); // unchanged: no false success
    }
    expect(CASES.filter(([, st, why]) => resendable(st, why)).map(([, , why]) => why).sort())
      .toEqual(["http_4xx", "reconcile_unresolved", "retry_exhausted", "update_unresolved"]);
  });
});
