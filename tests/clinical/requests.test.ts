// T-056 Done-when: scenario PR-45 (02:529) — a nurse proposes an additional treatment in the room; the doctor
// approves; the patient agreement step opens and FO is alerted. Plus the plan review: plan change and
// substitution applied to the plan (history kept), decline with a reason, cancel, who proposes and decides
// (BC without doses, nurse delegation refused, never the requester), visit and plan states, one pending request
// per item, price impact, projections (BC own requests without doses; FO nothing), the re-created plans_guard,
// guards, audit, events and notifications content-free, exit, cross-tenant.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { publish } from "../../src/modules/catalog/catalog";
import { captureConsent, checkTreatmentStart, consentText } from "../../src/modules/clinical/consent/consent";
import { addPlanItem, createPlan, openExam } from "../../src/modules/clinical/exam/exam";
import { signRecord, type StepUp } from "../../src/modules/clinical/records/records";
import { cancelRequest, createRequest, decideRequest, getRequest, listRequests, requestOptions } from "../../src/modules/clinical/requests/requests";
import { list as listNotifications } from "../../src/modules/notifications/notifications";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { createHarness, type Harness } from "../rls/harness";

process.env.DEPLOY_ENV = "local"; // synthetic data (MIG-2)

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "purchasing", "marketing", "central_cs", "auditor"];
const STEP: StepUp = { verified: true };

async function tenant(state = "live"): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ($1) returning id`, [state])).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Permintaan Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("Q1"), b2: await br("Q2") };
}
async function person(t: T, roles: Role | Role[], ...branches: string[]): Promise<P> {
  const rs = Array.isArray(roles) ? roles : [roles];
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`prm${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Permintaan ${n}` });
  for (const role of rs) {
    const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
    if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  }
  return { acc, staffId, tenantId: t.tenantId, role: rs[0], branch: TENANT_WIDE.includes(rs[0]) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>, role?: Role) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: role ?? p.role, activeBranchId: p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const reason = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e as { reason?: string }).reason ?? (e as Error).message);
const key = () => crypto.randomUUID();

function png(): Buffer {
  const b = Buffer.alloc(80);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(640, 16);
  b.writeUInt32BE(240, 20);
  return b;
}
async function patient(t: T, name = "Pasien Permintaan"): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "");
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     select $1, 'RM-' || lpad((count(*) + 1)::text, 6, '0'), $2, '1990-01-01', 'female', 'nik', $4, $5, 'islam', 'Karyawan', 's1', 'kawin', $3,
            (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier' from patients where tenant_id = $1 returning id`,
    [t.tenantId, name, t.b1, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43)],
  )).rows[0].id as string;
}
async function visit(t: T, patientId: string, branch = t.b1): Promise<string> {
  return (await h.admin.query(
    `insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', (select s.id from staff s where s.tenant_id = $1 limit 1)) returning id`,
    [t.tenantId, branch, patientId],
  )).rows[0].id as string;
}
// A signed examination by DOC with a plan of one toxin item (20 units) and an active consent.
async function planned(name = "Pasien Permintaan", consent = true) {
  const pid = await patient(A, name);
  const v = await visit(A, pid);
  const { examId } = await as(DOC, (db) => openExam(db, key(), v));
  const { planId } = await as(DOC, (db) => createPlan(db, key(), examId, "Program Kulit", "Kondisi rahasia pasien"));
  const { itemId } = await as(DOC, (db) => addPlanItem(db, key(), examId, planId, { stage: 1, catalog_version_id: toxin, qty: 1, dose_micro: 20_000_000, dose_unit: "unit" }));
  await as(DOC, (db) => signRecord(db, key(), examId, STEP));
  if (consent) {
    const t = await as(DOC, (db) => consentText(db, v, planId));
    await as(DOC, (db) => captureConsent(db, key(), { visitId: v, planId, signer: "patient", expectedHash: t.content_hash, signature: png() }));
  }
  return { pid, v, examId, planId, itemId };
}
const visitConsent = async (v: string) => (await h.admin.query(`select consent from visits where id = $1`, [v])).rows[0].consent as string;
const items = async (planId: string) => (await h.admin.query(`select id, catalog_version_id, qty, dose_micro, removed_at, request_id, removed_by_request_id from plan_items where plan_id = $1 order by created_at, id`, [planId])).rows;

let A: T;
let B: T;
let OWN: P; let FH: P; let DOC: P; let DOC2: P; let NUR: P; let TH: P; let BC: P; let FO: P; let RO: P; let PH: P; let MGR: P; let DOCB2: P; let BDOC: P;
let toxin: string; let filler: string; let peel: string;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = new pg.Pool({ connectionString: h.ownerUrl(), max: 2 });
  owner.on("error", () => {});
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); FH = await person(A, "facility_head", A.b1);
  DOC = await person(A, "doctor", A.b1); DOC2 = await person(A, "doctor", A.b1); NUR = await person(A, "nurse", A.b1); TH = await person(A, "therapist", A.b1);
  BC = await person(A, "bc", A.b1); FO = await person(A, "fo_cashier", A.b1); RO = await person(A, "records_officer", A.b1); PH = await person(A, "pharmacist", A.b1);
  MGR = await person(A, "manager", A.b1); DOCB2 = await person(A, "doctor", A.b2);
  BDOC = await person(B, "doctor", B.b1);
  const prod = async (c: string, name: string, price: number) => (await as(OWN, (db) => publish(db, { kind: "product", code: c }, { name, tax_category: "taxable_goods", tax_basis: "Barang", normal_price: price }, "Produk"))).versionId;
  toxin = await prod("PR-TOX", "Toksin Botulinum", 50_000);
  filler = await prod("PR-FIL", "Filler Asam Hialuronat", 300_000);
  peel = await prod("PR-PEL", "Serum Peeling", 80_000);
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

describe("scenario PR-45: clinician approves addition", () => {
  it("a nurse proposes an additional treatment in the room; the doctor approves; the agreement step opens and FO is alerted", async () => {
    const s = await planned("Pasien Rahasia Permintaan");
    expect(await visitConsent(s.v)).toBe("done");
    const { requestId } = await as(NUR, (db) => createRequest(db, key(), s.v, {
      kind: "addition", planId: s.planId, catalogVersionId: filler, stage: 1, qty: 2, doseMicro: 1_000_000, doseUnit: "ml", reason: "Lipatan nasolabial dalam",
    }));
    // The deciders are alerted; FO not yet.
    const pending = (await h.admin.query(`select type, recipient_role from notifications where subject_id = $1 order by recipient_role`, [requestId])).rows;
    expect(pending.map((x) => `${x.type}:${x.recipient_role}`)).toEqual(["clinical_request_pending:doctor", "clinical_request_pending:facility_head"]);
    // The card: type, patient, requester, reason, price impact (2 × Rp300.000).
    const card = (await as(DOC, (db) => listRequests(db, "pending"))).requests.find((x) => x.id === requestId)!;
    expect([card.kind, card.patient_name, card.requested_as, card.reason, card.price_impact, card.can_decide]).toEqual(
      ["addition", "Pasien Rahasia Permintaan", "nurse", "Lipatan nasolabial dalam", 600_000, true]);
    // The doctor approves: the plan gets the item, the consent no longer covers it, the step reopens; FO alerted.
    const d = await as(DOC, (db) => decideRequest(db, key(), requestId, true, null));
    expect([d.state, (d as { consent: string }).consent]).toEqual(["approved", "outdated"]);
    const it = await items(s.planId);
    expect(it.map((x) => [x.catalog_version_id, x.qty, x.removed_at === null, x.request_id])).toEqual([[toxin, 1, true, null], [filler, 2, true, requestId]]);
    expect(await visitConsent(s.v)).toBe("in_progress");
    const blockers = (await as(DOC, (db) => checkTreatmentStart(db, s.v, it.map((x) => x.id), DOC.staffId))).blockers;
    expect(blockers).toContain("consent_mismatch");
    const fo = await as(FO, (db) => listNotifications(db, { open: true }));
    expect(fo.some((x) => x.type === "clinical_request_approved" && x.subjectId === requestId)).toBe(true);
    // The agreement step: the new text covers both items; once signed the visit step is done again.
    const t = await as(NUR, (db) => consentText(db, s.v, s.planId));
    expect(t.items.map((x) => x.catalog_version_id).sort()).toEqual([toxin, filler].sort());
    await as(NUR, (db) => captureConsent(db, key(), { visitId: s.v, planId: s.planId, signer: "patient", expectedHash: t.content_hash, signature: png() }));
    expect(await visitConsent(s.v)).toBe("done");
    // Content-free: notifications, events, audit, idempotency.
    const no = JSON.stringify((await h.admin.query(`select * from notifications where subject_id = $1`, [requestId])).rows);
    expect(no).not.toMatch(/rahasia|nasolabial|filler/i);
    const ev = (await h.admin.query(`select type, payload from domain_events where aggregate_id = any($1::uuid[]) order by occurred_at, id`, [[requestId, s.planId]])).rows;
    expect(ev.map((e) => e.type)).toEqual(expect.arrayContaining(["ClinicalRequestCreated", "ClinicalRequestDecided", "CarePlanUpdated"]));
    expect(JSON.stringify(ev)).not.toMatch(/rahasia|nasolabial|filler|600000/i);
    const au = (await h.admin.query(`select action, reason_code, reason from audit_events where object_id = $1 order by seq`, [requestId])).rows;
    expect(au.map((r) => [r.action, r.reason_code])).toEqual(expect.arrayContaining([["settings_change", "clinical_request_created"], ["approval", "clinical_request_approved"]]));
    expect(au.every((r) => r.reason === null)).toBe(true);
    const idem = (await h.admin.query(`select result::text as r from idempotency_records where command like 'clinical_request_%'`)).rows;
    expect(JSON.stringify(idem)).not.toMatch(/rahasia|nasolabial/i);
  });
});

describe("plan change, substitution, decline, cancel", () => {
  it("a plan change and a substitution replace the item (history kept); a lower dose keeps the consent; decline needs a reason", async () => {
    const s = await planned();
    // Plan change lowering the dose: the consent still covers the plan; the visit step stays done.
    const pc = await as(TH, (db) => createRequest(db, key(), s.v, { kind: "plan_change", planId: s.planId, targetItemId: s.itemId, catalogVersionId: toxin,
      stage: 1, qty: 1, doseMicro: 15_000_000, doseUnit: "unit", reason: "Dosis diturunkan" }));
    expect(await reason(as(TH, (db) => createRequest(db, key(), s.v, { kind: "substitution", planId: s.planId, targetItemId: s.itemId, catalogVersionId: peel,
      stage: 1, qty: 1, reason: "Ganti" })))).toBe("item_request_pending");
    const d = await as(FH, (db) => decideRequest(db, key(), pc.requestId, true, null));
    expect((d as { consent: string }).consent).toBe("active");
    expect(await visitConsent(s.v)).toBe("done");
    let it = await items(s.planId);
    expect(it.map((x) => [x.qty, x.dose_micro, x.removed_at !== null, x.removed_by_request_id, x.request_id]))
      .toEqual([[1, "20000000", true, pc.requestId, null], [1, "15000000", false, null, pc.requestId]]);
    // Substitution: the new item replaces the current one; the consent is outdated.
    const cur = it[1].id;
    const sb = await as(NUR, (db) => createRequest(db, key(), s.v, { kind: "substitution", planId: s.planId, targetItemId: cur, catalogVersionId: peel,
      stage: 1, qty: 1, reason: "Pasien memilih serum" }));
    const card = await as(DOC, (db) => getRequest(db, sb.requestId));
    expect(card.price_impact).toBe(80_000 - 50_000);
    await as(DOC, (db) => decideRequest(db, key(), sb.requestId, true, null));
    it = await items(s.planId);
    expect(it.filter((x) => x.removed_at === null).map((x) => x.catalog_version_id)).toEqual([peel]);
    expect(await visitConsent(s.v)).toBe("in_progress");
    // Decline: a reason is required; nothing changes.
    const add = await as(BC, (db) => createRequest(db, key(), s.v, { kind: "addition", planId: s.planId, catalogVersionId: toxin, stage: 2, qty: 1, reason: "Pasien bertanya paket" }));
    expect(await code(as(DOC, (db) => decideRequest(db, key(), add.requestId, false, "")))).toBe("ERR_INVALID_INPUT");
    await as(DOC, (db) => decideRequest(db, key(), add.requestId, false, "Belum perlu"));
    expect((await items(s.planId)).length).toBe(3);
    expect(await code(as(DOC, (db) => decideRequest(db, key(), add.requestId, true, null)))).toBe("ERR_VERSION_CONFLICT");
    // Cancel by the requester only, while pending.
    const c2 = await as(NUR, (db) => createRequest(db, key(), s.v, { kind: "addition", planId: s.planId, catalogVersionId: filler, stage: 2, qty: 1, reason: "Tambahan" }));
    expect(await code(as(TH, (db) => cancelRequest(db, key(), c2.requestId)))).toBe("ERR_NOT_FOUND");
    await as(NUR, (db) => cancelRequest(db, key(), c2.requestId));
    expect(await code(as(DOC, (db) => decideRequest(db, key(), c2.requestId, true, null)))).toBe("ERR_VERSION_CONFLICT");
    expect((await h.admin.query(`select state from clinical_requests where id = $1`, [c2.requestId])).rows[0].state).toBe("cancelled");
    expect(await reason(as(NUR, (db) => cancelRequest(db, key(), c2.requestId)))).toBe("decided");
    // Audit: the decision and a clinical read are recorded, content-free.
    await as(RO, (db) => getRequest(db, add.requestId));
    const au = (await h.admin.query(`select action, reason_code, reason from audit_events where object_id = $1 order by seq`, [add.requestId])).rows;
    expect(au.map((r) => [r.action, r.reason_code])).toEqual(expect.arrayContaining([["approval", "clinical_request_declined"], ["clinical_read", "clinical_request_viewed"]]));
  });

  it("input rules: kinds, versions, no change, removed item, BC never sets a dose, plan and visit states", async () => {
    const s = await planned();
    const req = (who: P, r: Partial<Parameters<typeof createRequest>[3]>, visitId = s.v) =>
      as(who, (db) => createRequest(db, key(), visitId, { kind: "addition", planId: s.planId, catalogVersionId: filler, stage: 1, qty: 1, reason: "Alasan uji", ...r }));
    expect(await reason(req(NUR, { kind: "plan_change", targetItemId: s.itemId, catalogVersionId: filler }))).toBe("version_changed");
    expect(await reason(req(NUR, { kind: "plan_change", targetItemId: s.itemId, catalogVersionId: toxin, doseMicro: 20_000_000, doseUnit: "unit" }))).toBe("no_change");
    expect(await reason(req(NUR, { kind: "substitution", targetItemId: s.itemId, catalogVersionId: toxin }))).toBe("same_item");
    expect(await reason(req(NUR, { kind: "addition", targetItemId: s.itemId }))).toBe("request");
    expect(await reason(req(NUR, { reason: " " }))).toBe("request");
    expect(await reason(req(BC, { doseMicro: 1_000_000, doseUnit: "ml" }))).toBe("bc_may_not_set_dose");
    // A BC plan change keeps the target's dose.
    const bcpc = await req(BC, { kind: "plan_change", targetItemId: s.itemId, catalogVersionId: toxin, qty: 2 });
    expect((await h.admin.query(`select dose_micro, dose_unit from clinical_requests where id = $1`, [bcpc.requestId])).rows[0]).toEqual({ dose_micro: "20000000", dose_unit: "unit" });
    await as(BC, (db) => cancelRequest(db, key(), bcpc.requestId));
    // A material or unknown version is refused.
    expect(await code(req(NUR, { catalogVersionId: crypto.randomUUID() }))).toBe("ERR_NOT_FOUND");
    // A plan of another patient; a closed visit; a visit without an examination.
    const other = await planned("Pasien Lain");
    expect(await code(req(NUR, { planId: other.planId }))).toBe("ERR_NOT_FOUND");
    const noExam = await visit(A, await patient(A));
    expect(await reason(req(NUR, {}, noExam))).toBe("no_examination");
    const pending = await req(NUR, {});
    await h.admin.query(`update visits set closed_at = now(), closed_by = checked_in_by where id = $1`, [s.v]);
    expect(await reason(req(NUR, {}))).toBe("visit_closed");
    expect(await reason(as(DOC, (db) => decideRequest(db, key(), pending.requestId, true, null)))).toBe("visit_closed");
    // A target of another plan; a removed target at create; a closed plan.
    const o2 = await planned("Pasien Rencana Lain");
    // The visit's own plan, but a target item of another patient's plan.
    expect(await reason(req(NUR, { kind: "plan_change", planId: o2.planId, targetItemId: s.itemId, catalogVersionId: toxin, qty: 4 }, o2.v))).toBe("plan item not found");
    const r3 = await planned();
    await h.admin.query(`update plan_items set removed_at = now() where id = $1`, [r3.itemId]);
    expect(await reason(req(NUR, { kind: "plan_change", planId: r3.planId, targetItemId: r3.itemId, catalogVersionId: toxin, qty: 4 }, r3.v))).toBe("item_removed");
    await h.admin.query(`update care_plans set state = 'stopped', closed_exam_id = created_exam_id, closed_at = now() where id = $1`, [r3.planId]);
    expect(await reason(req(NUR, { planId: r3.planId }, r3.v))).toBe("plan_closed");
    // A removed target item is refused at decide.
    const t = await planned();
    const pc = await req(NUR, { kind: "plan_change", planId: t.planId, targetItemId: t.itemId, catalogVersionId: toxin, qty: 3, doseMicro: 20_000_000, doseUnit: "unit" }, t.v);
    await h.admin.query(`update plan_items set removed_at = now() where id = $1`, [t.itemId]);
    expect(await reason(as(DOC, (db) => decideRequest(db, key(), pc.requestId, true, null)))).toBe("item_removed");
  });
});

describe("who proposes and decides; projections", () => {
  it("BC, doctor, nurse, therapist propose; doctor or facility head decide; never the requester; nurse delegation refused", async () => {
    const s = await planned();
    const mk = (who: P, stage: number) => as(who, (db) => createRequest(db, key(), s.v, { kind: "addition", planId: s.planId, catalogVersionId: filler, stage, qty: 1, reason: "Alasan uji" }));
    for (const who of [FO, PH, MGR, RO, FH]) expect(await code(mk(who, 3)), who.role).toBe("ERR_FORBIDDEN");
    const own = await mk(DOC, 3);
    expect(await code(as(DOC, (db) => decideRequest(db, key(), own.requestId, true, null)))).toBe("ERR_APPROVER_IS_REQUESTER");
    expect(await reason(as(NUR, (db) => decideRequest(db, key(), own.requestId, true, null)))).toBe("nurse_delegation_not_configured");
    for (const who of [BC, TH, FO, RO]) expect(await code(as(who, (db) => decideRequest(db, key(), own.requestId, true, null))), who.role).toBe("ERR_FORBIDDEN");
    expect(await code(as(DOCB2, (db) => decideRequest(db, key(), own.requestId, true, null)))).toBe("ERR_NOT_FOUND");
    await as(DOC2, (db) => decideRequest(db, key(), own.requestId, true, null));
    expect((await h.admin.query(`select decided_by from clinical_requests where id = $1`, [own.requestId])).rows[0].decided_by).toBe(DOC2.staffId);
    // A multi-branch doctor acting at b2 (b1 still allowed in the session) neither decides, reads, lists nor proposes at b1.
    const both = await person(A, "doctor", A.b1, A.b2);
    const atB2 = await resolveContext(app, both.acc, { tenantId: A.tenantId, actingRole: "doctor", activeBranchId: A.b2 });
    const wide = { ...atB2, allowedBranchIds: [A.b2, A.b1] };
    const r2 = await mk(NUR, 4);
    expect(await code(withTenantContext(app, wide, (db) => decideRequest(db, key(), r2.requestId, true, null)))).toBe("ERR_NOT_FOUND");
    expect(await code(withTenantContext(app, wide, (db) => getRequest(db, r2.requestId)))).toBe("ERR_NOT_FOUND");
    expect((await withTenantContext(app, wide, (db) => listRequests(db, null))).requests.map((x) => x.id)).not.toContain(r2.requestId);
    expect((await withTenantContext(app, wide, (db) => requestOptions(db, s.v))).visits).toEqual([]);
    expect(await code(withTenantContext(app, wide, (db) => createRequest(db, key(), s.v, { kind: "addition", planId: s.planId, catalogVersionId: filler, stage: 5, qty: 1, reason: "Lintas cabang" }))))
      .toBe("ERR_NOT_FOUND");
    // RLS (as exam_readable): the acting role held at the request's branch now — any branch allowed in the session
    // where the role is held (the definer readers above bind the active branch); a role removed there reads nothing.
    const twoNurse = await person(A, "nurse", A.b2, A.b1);
    const nurseB2 = await resolveContext(app, twoNurse.acc, { tenantId: A.tenantId, actingRole: "nurse", activeBranchId: A.b1 });
    const asB1 = () => withTenantContext(app, nurseB2, async (db) => (await db.query(`select count(*)::int as n from clinical_requests where id = $1`, [r2.requestId])).rows[0].n as number);
    expect(await asB1()).toBe(1);
    await h.admin.query(`delete from staff_branches where staff_id = $1 and branch_id = $2`, [twoNurse.staffId, A.b1]);
    expect(await asB1()).toBe(0);
  });

  it("clinical readers see doses and reasons; a BC only its own requests without doses or the condition; FO and others nothing", async () => {
    const s = await planned();
    const nurseReq = await as(NUR, (db) => createRequest(db, key(), s.v, { kind: "addition", planId: s.planId, catalogVersionId: filler, stage: 2, qty: 1, doseMicro: 500_000, doseUnit: "ml",
      reason: "Alasan klinis rahasia" }));
    const bcReq = await as(BC, (db) => createRequest(db, key(), s.v, { kind: "addition", planId: s.planId, catalogVersionId: peel, stage: 3, qty: 1, reason: "Pasien bertanya" }));
    for (const who of [DOC, NUR, TH, FH, RO]) {
      const r = await as(who, (db) => getRequest(db, nurseReq.requestId));
      expect([r.full, r.dose_micro, r.reason, r.plan_condition], who.role).toEqual([true, 500_000, "Alasan klinis rahasia", "Kondisi rahasia pasien"]);
    }
    const bl = await as(BC, (db) => listRequests(db, null));
    // Only the BC's own requests (earlier tests made some too); never the nurse's.
    expect(bl.requests.map((x) => x.id)).toContain(bcReq.requestId);
    expect(bl.requests.map((x) => x.id)).not.toContain(nurseReq.requestId);
    expect(bl.requests.every((x) => x.requested_by === BC.staffId)).toBe(true);
    expect(JSON.stringify(bl)).not.toMatch(/rahasia|500000|dose_micro/);
    expect(await code(as(BC, (db) => getRequest(db, nurseReq.requestId)))).toBe("ERR_NOT_FOUND");
    const bo = await as(BC, (db) => requestOptions(db, s.v));
    expect(JSON.stringify(bo)).not.toMatch(/rahasia|dose_micro|condition/);
    for (const who of [FO, PH, MGR, OWN]) {
      expect(await code(as(who, (db) => listRequests(db, null))), who.role).toBe("ERR_FORBIDDEN");
      expect(await code(as(who, (db) => getRequest(db, nurseReq.requestId))), who.role).toBe("ERR_FORBIDDEN");
    }
    // Direct reads through RLS: the clinical readers of the branch only.
    const direct = (who: P) => as(who, async (db) => (await db.query(`select count(*)::int as n from clinical_requests where id = $1`, [nurseReq.requestId])).rows[0].n as number);
    for (const who of [DOC, NUR, TH, FH, RO]) expect(await direct(who), who.role).toBe(1);
    for (const who of [BC, FO, PH, MGR, OWN, DOCB2]) expect(await direct(who), who.role).toBe(0);
    // Options: today's open visits with an examination and their active plans and items.
    // Options list the present items only.
    await h.admin.query(`insert into plan_items (tenant_id, branch_id, plan_id, examination_id, stage, catalog_version_id, qty) values ($1, $2, $3, $4, 2, $5, 1)`, [A.tenantId, A.b1, s.planId, s.examId, peel]);
    await h.admin.query(`update plan_items set removed_at = now() where plan_id = $1 and catalog_version_id = $2`, [s.planId, peel]);
    const o = await as(NUR, (db) => requestOptions(db, s.v));
    expect(o.visits[0].plans[0].items.map((x) => x.catalog_version_id)).toEqual([toxin]);
    expect(o.catalog.map((x) => x.catalog_version_id)).toEqual(expect.arrayContaining([toxin, filler, peel]));
  });
});

describe("guards, exit, helpers, cross-tenant", () => {
  it("requests decided once and never deleted; plan items change only by removal; triggers always", async () => {
    const s = await planned();
    const r = await as(NUR, (db) => createRequest(db, key(), s.v, { kind: "addition", planId: s.planId, catalogVersionId: filler, stage: 2, qty: 1, reason: "Alasan uji" }));
    await expect(h.admin.query(`delete from clinical_requests where id = $1`, [r.requestId])).rejects.toThrow(/never deleted/);
    await expect(h.admin.query(`update clinical_requests set qty = 9 where id = $1`, [r.requestId])).rejects.toThrow(/decided once/);
    // A decision that also rewrites the request is refused.
    await expect(h.admin.query(`update clinical_requests set state = 'cancelled', decided_at = now(), reason = 'Diubah diam-diam' where id = $1`, [r.requestId])).rejects.toThrow(/decided once/);
    await as(DOC, (db) => decideRequest(db, key(), r.requestId, false, "Tidak sekarang"));
    await expect(h.admin.query(`update clinical_requests set state = 'cancelled' where id = $1`, [r.requestId])).rejects.toThrow(/decided once/);
    await expect(h.admin.query(
      `insert into clinical_requests (tenant_id, branch_id, visit_id, patient_id, examination_id, plan_id, kind, catalog_version_id, stage, qty, reason, requested_by, requested_as, state, decided_at)
       values ($1, $2, $3, $4, $5, $6, 'addition', $7, 1, 1, 'Langsung', $8, 'nurse', 'cancelled', now())`,
      [A.tenantId, A.b1, s.v, s.pid, s.examId, s.planId, filler, NUR.staffId])).rejects.toThrow(/opens pending/);
    // plans_guard: items open present; only removal (with the request) changes them.
    await expect(h.admin.query(`update plan_items set qty = 5 where id = $1`, [s.itemId])).rejects.toThrow(/only by removal/);
    await expect(h.admin.query(`update plan_items set qty = 5, removed_at = now() where id = $1`, [s.itemId])).rejects.toThrow(/only by removal/);
    await expect(h.admin.query(`update plan_items set removed_by_request_id = $2 where id = $1`, [s.itemId, r.requestId])).rejects.toThrow(/only by removal|check/);
    await expect(h.admin.query(
      `insert into plan_items (tenant_id, branch_id, plan_id, examination_id, stage, catalog_version_id, qty, removed_by_request_id, removed_at) values ($1, $2, $3, $4, 1, $5, 1, $6, now())`,
      [A.tenantId, A.b1, s.planId, s.examId, toxin, r.requestId])).rejects.toThrow(/opens present/);
    await expect(h.admin.query(`truncate clinical_requests cascade`)).rejects.toThrow();
    const trig = (await h.admin.query(`select tgname, tgenabled from pg_trigger where tgrelid = 'public.clinical_requests'::regclass and not tgisinternal order by 1`)).rows;
    expect(trig.map((x) => `${x.tgname}:${x.tgenabled}`)).toEqual(["clinical_requests_guard:A", "clinical_requests_no_truncate:A"]);
  });

  it("exit reads, never writes; support class; helpers not executable; cross-tenant reads and writes nothing", async () => {
    const s = await planned();
    const r = await as(NUR, (db) => createRequest(db, key(), s.v, { kind: "addition", planId: s.planId, catalogVersionId: filler, stage: 2, qty: 1, reason: "Alasan uji" }));
    await h.admin.query(`update tenants_registry set lifecycle_state = 'exit' where id = $1`, [A.tenantId]);
    try {
      expect((await as(DOC, (db) => getRequest(db, r.requestId))).state).toBe("pending");
      expect(await code(as(DOC, (db) => decideRequest(db, key(), r.requestId, true, null)))).toBe("ERR_TENANT_SUSPENDED");
      expect(await code(as(NUR, (db) => createRequest(db, key(), s.v, { kind: "addition", planId: s.planId, catalogVersionId: peel, stage: 3, qty: 1, reason: "Alasan" })))).toBe("ERR_TENANT_SUSPENDED");
    } finally {
      await h.admin.query(`update tenants_registry set lifecycle_state = 'live' where id = $1`, [A.tenantId]);
    }
    await h.admin.query(`update tenants_registry set lifecycle_state = 'onboarding' where id = $1`, [A.tenantId]);
    try {
      expect(await code(as(DOC, (db) => listRequests(db, null)))).toBe("ERR_TENANT_SUSPENDED");
    } finally {
      await h.admin.query(`update tenants_registry set lifecycle_state = 'live' where id = $1`, [A.tenantId]);
    }
    expect((await h.admin.query(`select support_class from support_object_kinds where table_name = 'public.clinical_requests'`)).rows[0].support_class).toBe("clinical");
    for (const f of ["request_price_impact(clinical_requests)", "clinical_requests_guard()", "request_actor(text[])", "request_reader()", "request_json(clinical_requests,boolean,uuid,text)"]) {
      for (const role of ["clinic_app", "clinic_vendor", "clinic_operator"]) {
        expect((await h.admin.query(`select has_function_privilege($1, $2, 'execute') as ok`, [role, `public.${f}`])).rows[0].ok, `${role} ${f}`).toBe(false);
      }
    }
    expect(await as(BDOC, async (db) => (await db.query(`select count(*)::int as n from clinical_requests`)).rows[0].n)).toBe(0);
    expect(await code(as(BDOC, (db) => getRequest(db, r.requestId)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BDOC, (db) => decideRequest(db, key(), r.requestId, true, null)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BDOC, (db) => cancelRequest(db, key(), r.requestId)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BDOC, (db) => createRequest(db, key(), s.v, { kind: "addition", planId: s.planId, catalogVersionId: filler, stage: 2, qty: 1, reason: "Lintas" })))).toBe("ERR_NOT_FOUND");
    expect((await as(BDOC, (db) => listRequests(db, null))).requests).toEqual([]);
    expect((await as(BDOC, (db) => requestOptions(db, s.v))).visits).toEqual([]);
  });
});
