// T-098 Done-when: Scenario PR-78 low score (02-PRD:735): a patient scores 2 of 5 → the survey is saved → a manager task is created and
// no review request is sent. Plus the plan (r1, Argon e513d8b5): score 5 eligible / 3 neither, one survey per visit (replay vs conflict),
// an open visit refused, bounds, roles (FO / BC refused; CS, owner, manager record; another branch's manager not found), a suspended tenant
// still records (care continues, PR-56), the follow-up listed by followup_list(…, 'survey_low') and assigned to the branch manager,
// readers' identity projection (marketing masked without consent, auditor MRN tail), K26 arithmetic, guards, tenants. No message is sent
// (no outbound row); synthetic data (MIG-2).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import type { KekRing } from "../../src/lib/keys/envelope";
import { setKekRingForTests } from "../../src/lib/keys/runtime";
import { followupList } from "../../src/modules/crm/followups/followups";
import { recordSurvey, surveyList, surveySummary } from "../../src/modules/crm/surveys/surveys";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { grantConsent, publishConsentText } from "../../src/modules/patients/consents/consents";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local";
const RING: KekRing = { current: 1, keys: new Map([[1, Buffer.alloc(32, 5)]]) };

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "admin_pusat", "auditor", "marketing", "central_cs"];

async function tenant(name: string): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, name]);
  const br = async (c: string, nm: string) =>
    (await h.admin.query(`insert into branches (tenant_id, code, name, timezone, address) values ($1, $2, $3, 'Asia/Jakarta', 'Jl. Uji') returning id`, [tenantId, c, nm])).rows[0].id as string;
  return { tenantId, b1: await br("SV1", "Kemang"), b2: await br("SV2", "Bintaro") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`sv${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf SV ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const key = () => crypto.randomUUID();
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const raw = (sql: string, args: unknown[] = []) => h.admin.query(sql, args).then(() => "ok", (e) => `raw:${e.code}`);
async function patient(t: T, name: string) {
  return (await h.admin.query(`insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation,
       education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $2, '1990-06-15', 'female', 'newborn_via_guardian', 'Fixture sintetis',
       'islam', 'Karyawan', 's1', 'kawin', $3, (select id from staff where tenant_id = $1 limit 1), 'fo_cashier') returning id`, [t.tenantId, name, t.b1])).rows[0].id as string;
}
// A visit at `branch`, closed unless `open` (fixture rows; the visit guard is paused for the close only).
async function visit(t: T, pt: string, by: P, branch = t.b1, open = false) {
  const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
    [t.tenantId, branch, pt, by.staffId])).rows[0].id as string;
  if (!open) {
    await h.admin.query(`alter table visits disable trigger visits_guard`);
    try {
      await h.admin.query(`update visits set closed_at = clock_timestamp(), closed_by = $2 where id = $1`, [v, by.staffId]);
    } finally {
      await h.admin.query(`alter table visits enable always trigger visits_guard`);
    }
  }
  return v;
}
const survey = async (id: string) => (await h.admin.query(`select * from surveys where id = $1`, [id])).rows[0];

let A: T; let B: T;
let OWN: P; let CS: P; let MGR1: P; let MGR1b: P; let MGR2: P; let FO: P; let BC: P; let MKT: P; let AU: P; let BOWN: P;
let marketingText: string;

beforeAll(async () => {
  setKekRingForTests(RING);
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant("PT Klinik Survei Sintetis");
  B = await tenant("PT Klinik Lain Survei");
  OWN = await person(A, "owner"); CS = await person(A, "central_cs"); MGR1 = await person(A, "manager", A.b1); MGR1b = await person(A, "manager", A.b1);
  MGR2 = await person(A, "manager", A.b2); FO = await person(A, "fo_cashier", A.b1); BC = await person(A, "bc", A.b1);
  MKT = await person(A, "marketing"); AU = await person(A, "auditor"); BOWN = await person(B, "owner");
  marketingText = (await as(OWN, (db) => publishConsentText(db, { purpose: "marketing_wa", body: "Saya setuju menerima promosi klinik." }))).id;
}, 300_000);
afterAll(async () => {
  setKekRingForTests(undefined);
  await app?.end();
  await owner?.end();
  await h?.close();
});

describe("T-098 Scenario PR-78 (low score)", () => {
  it("a patient scores 2 of 5 → a manager task is created and no review request is sent", async () => {
    const pt = await patient(A, "Pasien Skor Rendah");
    const v = await visit(A, pt, FO);
    const outboundBefore = Number((await h.admin.query(`select count(*) c from outbound_messages where tenant_id = $1`, [A.tenantId])).rows[0].c);
    const { surveyId } = await as(CS, (db) => recordSurvey(db, key(), { visitId: v, score: 2 }));
    const s = await survey(surveyId);
    expect(s).toMatchObject({ score: 2, review_eligible: false, branch_id: A.b1, visit_id: v, patient_id: pt, recorded_as: "central_cs" });
    // the manager's task: rule survey_low on the survey, the cs queue, assigned to the visit branch's first active manager (by staff id)
    const f = (await h.admin.query(`select * from followups where id = $1`, [s.followup_id])).rows[0];
    const firstMgr = [MGR1.staffId, MGR1b.staffId].sort()[0];
    expect(f).toMatchObject({ rule_code: "survey_low", source_kind: "survey", source_id: surveyId, step: "low", role_queue: "cs",
      state: "open", branch_id: A.b1, assignee_staff_id: firstMgr });
    // the branch manager reads it through the follow-up list filtered by the new rule
    const listed = await as(MGR1, (db) => followupList(db, "open", "all", "survey_low" as never));
    expect(listed.followups.map((x: { id: string }) => x.id)).toContain(f.id);
    // no review request: not eligible, and no outbound message of any kind
    expect(Number((await h.admin.query(`select count(*) c from outbound_messages where tenant_id = $1`, [A.tenantId])).rows[0].c)).toBe(outboundBefore);
    // the follow-up's event carries ids only
    const ev = (await h.admin.query(`select payload from domain_events where type = 'FollowUpCreated' and aggregate_id = $1`, [f.id])).rows[0].payload;
    expect(Object.values(ev).every((x) => typeof x === "string")).toBe(true);
  });
});

describe("T-098 survey rules", () => {
  it("score 5 eligible, 3 neither, 1 low; one survey per visit (same key replays, another key conflicts); open visit, bounds", async () => {
    const pt = await patient(A, "Pasien Skor Lain");
    const v5 = await visit(A, pt, FO); const v3 = await visit(A, pt, FO); const v1 = await visit(A, pt, FO);
    const k5 = key();
    const s5 = await as(MGR1, (db) => recordSurvey(db, k5, { visitId: v5, score: 5 }));
    expect(await survey(s5.surveyId)).toMatchObject({ score: 5, review_eligible: true, followup_id: null, recorded_as: "manager" });
    expect(await as(MGR1, (db) => recordSurvey(db, k5, { visitId: v5, score: 5 }))).toMatchObject({ surveyId: s5.surveyId, replayed: true });
    expect(await code(as(CS, (db) => recordSurvey(db, key(), { visitId: v5, score: 4 })))).toBe("ERR_IDEMPOTENCY_CONFLICT");
    // the definer's own replay (granted to clinic_app; runCommand answers TS replays before reaching it): a direct second call with the
    // same key answers the first id and writes nothing; another key on that visit conflicts
    const vd = await visit(A, pt, FO);
    const kd = `k-${key()}`;
    const direct = (k: string) => as(MGR1, async (db) => (await db.query(`select survey_record($1, $2::jsonb) r`, [k, JSON.stringify({ visit_id: vd, score: 4 })])).rows[0].r as string);
    const first = await direct(kd);
    expect(await direct(kd)).toBe(first);
    expect(Number((await h.admin.query(`select count(*) c from surveys where visit_id = $1`, [vd])).rows[0].c)).toBe(1);
    expect(await direct(`k-${key()}`).then(() => "ok", (e) => String(e.message).split(":")[0])).toBe("ERR_IDEMPOTENCY_CONFLICT");
    // review r1 P1: the same key replayed by a manager of another branch is not found — the replay never confirms a survey the caller
    // cannot see, whatever visit it names (its own branch's visit or the original one)
    const sqlCode = (x: Promise<unknown>) => x.then(() => "ok", (e) => String(e.message).split(":")[0]);
    const directAs = (p: P, k: string, visitId: string) => as(p, async (db) => (await db.query(`select survey_record($1, $2::jsonb) r`, [k, JSON.stringify({ visit_id: visitId, score: 4 })])).rows[0].r as string);
    expect(await sqlCode(directAs(MGR2, kd, vd))).toBe("ERR_NOT_FOUND");
    const vOther = await visit(A, pt, FO, A.b2);
    expect(await sqlCode(directAs(MGR2, kd, vOther))).toBe("ERR_NOT_FOUND");
    expect(await directAs(CS, kd, vd)).toBe(first); // tenant-wide CS still replays
    // revoked authority: a manager who recorded on Kemang and then lost Kemang (still a manager of Bintaro) no longer gets the replay
    const mgrMoved = await person(A, "manager", A.b1, A.b2);
    const vm = await visit(A, await patient(A, "Pasien Wewenang Dicabut"), FO);
    const km = `k-${key()}`;
    const recorded = await directAs(mgrMoved, km, vm);
    expect(await directAs(mgrMoved, km, vm)).toBe(recorded);
    // review r2: still allowed at both branches but acting at Bintaro — the active-branch restriction alone refuses the Kemang replay
    expect(await sqlCode(directAs({ ...mgrMoved, branch: A.b2 }, km, vm))).toBe("ERR_NOT_FOUND");
    await h.admin.query(`delete from staff_branches where staff_id = $1 and branch_id = $2`, [mgrMoved.staffId, A.b1]);
    const moved = { ...mgrMoved, branch: A.b2 };
    expect(await sqlCode(directAs(moved, km, vm))).toBe("ERR_NOT_FOUND");
    expect(await sqlCode(directAs(moved, km, await visit(A, await patient(A, "Pasien Cabang Baru"), FO, A.b2)))).toBe("ERR_NOT_FOUND");
    // review r1 P2: malformed, missing and null visit ids are invalid input (direct and through the service), never a raw cast error
    for (const body of [{ visit_id: "not-a-uuid", score: 4 }, { score: 4 }, { visit_id: null, score: 4 }, { visit_id: 42, score: 4 }]) {
      expect(await sqlCode(as(CS, async (db) => db.query(`select survey_record($1, $2::jsonb)`, [`k-${key()}`, JSON.stringify(body)]))), JSON.stringify(body)).toBe("ERR_INVALID_INPUT");
    }
    expect(await code(as(CS, (db) => recordSurvey(db, key(), { visitId: "not-a-uuid", score: 4 })))).toBe("ERR_INVALID_INPUT");
    const s3 = await as(OWN, (db) => recordSurvey(db, key(), { visitId: v3, score: 3 }));
    expect(await survey(s3.surveyId)).toMatchObject({ score: 3, review_eligible: false, followup_id: null, recorded_as: "owner" });
    const s1 = await as(CS, (db) => recordSurvey(db, key(), { visitId: v1, score: 1 }));
    expect((await survey(s1.surveyId)).followup_id).not.toBeNull();
    const open = await visit(A, await patient(A, "Pasien Kunjungan Terbuka"), FO, A.b1, true); // one open visit per patient (0063)
    expect(await code(as(CS, (db) => recordSurvey(db, key(), { visitId: open, score: 4 })))).toBe("ERR_VERSION_CONFLICT");
    const vb = await visit(A, pt, FO);
    for (const bad of [0, 6, 2.5]) expect(await code(as(CS, (db) => recordSurvey(db, key(), { visitId: vb, score: bad as never })))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(CS, (db) => recordSurvey(db, key(), { visitId: crypto.randomUUID(), score: 4 })))).toBe("ERR_NOT_FOUND");
  });

  it("roles: FO and BC refused; another branch's manager does not find the visit; a suspended tenant still records; no manager → unassigned", async () => {
    const pt = await patient(A, "Pasien Peran");
    const v = await visit(A, pt, FO);
    expect(await code(as(FO, (db) => recordSurvey(db, key(), { visitId: v, score: 4 })))).toBe("ERR_FORBIDDEN");
    expect(await code(as(BC, (db) => recordSurvey(db, key(), { visitId: v, score: 4 })))).toBe("ERR_FORBIDDEN");
    expect(await code(as(MKT, (db) => recordSurvey(db, key(), { visitId: v, score: 4 })))).toBe("ERR_FORBIDDEN");
    expect(await code(as(MGR2, (db) => recordSurvey(db, key(), { visitId: v, score: 4 })))).toBe("ERR_NOT_FOUND");
    // Bintaro has no manager other than MGR2; a low score there is assigned to MGR2; a branch with no manager → unassigned
    const b3 = (await h.admin.query(`insert into branches (tenant_id, code, name, timezone, address) values ($1, 'SV3', 'Kosong', 'Asia/Jakarta', 'Jl. Uji') returning id`, [A.tenantId])).rows[0].id as string;
    const fo3 = await person(A, "fo_cashier", b3);
    const v3 = await visit(A, pt, fo3, b3);
    const s3 = await as(CS, (db) => recordSurvey(db, key(), { visitId: v3, score: 2 }));
    expect((await h.admin.query(`select assignee_staff_id from followups where id = $1`, [(await survey(s3.surveyId)).followup_id])).rows[0].assignee_staff_id).toBeNull();
    // the manager choice reads membership validity: an ended membership (effective_to past) is not assigned
    const b4 = (await h.admin.query(`insert into branches (tenant_id, code, name, timezone, address) values ($1, 'SV4', 'Akhir', 'Asia/Jakarta', 'Jl. Uji') returning id`, [A.tenantId])).rows[0].id as string;
    const gone = await person(A, "manager", b4); const stay = await person(A, "manager", b4); const fo4 = await person(A, "fo_cashier", b4);
    const [early] = [gone, stay].sort((x, y) => (x.staffId < y.staffId ? -1 : 1));
    await h.admin.query(`update memberships set effective_to = now() - interval '1 day', effective_from = least(effective_from, now() - interval '2 days')
      where id = (select membership_id from staff where id = $1)`, [early.staffId]);
    const late = early === gone ? stay : gone;
    const v4 = await visit(A, pt, fo4, b4);
    const s4 = await as(CS, (db) => recordSurvey(db, key(), { visitId: v4, score: 1 }));
    expect((await h.admin.query(`select assignee_staff_id from followups where id = $1`, [(await survey(s4.surveyId)).followup_id])).rows[0].assignee_staff_id).toBe(late.staffId);
    // review r2: a membership not yet in force (effective_from in the future) is not assigned either
    const b5 = (await h.admin.query(`insert into branches (tenant_id, code, name, timezone, address) values ($1, 'SV5', 'Nanti', 'Asia/Jakarta', 'Jl. Uji') returning id`, [A.tenantId])).rows[0].id as string;
    const soon = await person(A, "manager", b5); const now5 = await person(A, "manager", b5); const fo5 = await person(A, "fo_cashier", b5);
    const [first5] = [soon, now5].sort((x, y) => (x.staffId < y.staffId ? -1 : 1));
    await h.admin.query(`update memberships set effective_from = now() + interval '1 day' where id = (select membership_id from staff where id = $1)`, [first5.staffId]);
    const active5 = first5 === soon ? now5 : soon;
    const v5b = await visit(A, pt, fo5, b5);
    const s5b = await as(CS, (db) => recordSurvey(db, key(), { visitId: v5b, score: 1 }));
    expect((await h.admin.query(`select assignee_staff_id from followups where id = $1`, [(await survey(s5b.surveyId)).followup_id])).rows[0].assignee_staff_id).toBe(active5.staffId);
    // suspended: care continues (care_message), the survey is recorded
    await h.admin.query(`update tenants_registry set lifecycle_state = 'suspended' where id = $1`, [A.tenantId]);
    try {
      const vs = await visit(A, pt, FO);
      expect((await as(CS, (db) => recordSurvey(db, key(), { visitId: vs, score: 4 }))).surveyId).toBeTruthy();
    } finally {
      await h.admin.query(`update tenants_registry set lifecycle_state = 'live' where id = $1`, [A.tenantId]);
    }
  });
});

describe("T-098 readers, K26, guards, tenants", () => {
  it("the list projects identity by role and consent; K26 average and % ≤ 2 by branch; insert-only; tenants stay apart", async () => {
    const t = await tenant("PT Klinik K26 Sintetis");
    const own = await person(t, "owner"); const cs = await person(t, "central_cs"); const fo = await person(t, "fo_cashier", t.b1);
    const mgr2 = await person(t, "manager", t.b2); const mkt = await person(t, "marketing"); const au = await person(t, "auditor");
    await person(t, "manager", t.b1);
    const pt = await patient(t, "Pasien K26 Rahasia");
    const ids: string[] = [];
    for (const s of [1, 2, 5, 5] as const) {
      const v = await visit(t, pt, fo);
      ids.push((await as(cs, (db) => recordSurvey(db, key(), { visitId: v, score: s }))).surveyId);
    }
    expect(await as(own, (db) => surveySummary(db))).toEqual([{ branch_id: t.b1, total: 4, low_count: 2, avg_score: 3.25, low_pct: 50 }]);
    // identity projection
    const find = async (p: P) => (await as(p, (db) => surveyList(db))).rows.find((r) => r.id === ids[0]);
    expect(await find(cs)).toMatchObject({ patient_name: "Pasien K26 Rahasia", consent_masked: false, score: 1 });
    expect(await find(mkt)).toMatchObject({ patient_name: null, patient_mrn: null, consent_masked: true, score: 1 });
    expect((await find(au))?.patient_mrn).toMatch(/^\*\*\*\d{3}$/);
    expect(await find(mgr2)).toBeUndefined(); // another branch
    expect(await as(mgr2, (db) => surveySummary(db))).toEqual([]);
    // fractional K26 (a second branch): scores 1, 4, 5 → avg 3.33, low_pct 33.33 — numeric rounded to 2 places; the manager of that
    // branch sees only its own row, the branch filter narrows the owner's view
    const fo2 = await person(t, "fo_cashier", t.b2);
    for (const s of [1, 4, 5] as const) {
      const v = await visit(t, await patient(t, "Pasien K26 Cabang 2"), fo2, t.b2);
      await as(cs, (db) => recordSurvey(db, key(), { visitId: v, score: s }));
    }
    expect((await as(own, (db) => surveySummary(db))).find((x) => x.branch_id === t.b2)).toEqual({ branch_id: t.b2, total: 3, low_count: 1, avg_score: 3.33, low_pct: 33.33 });
    expect(await as(mgr2, (db) => surveySummary(db))).toEqual([{ branch_id: t.b2, total: 3, low_count: 1, avg_score: 3.33, low_pct: 33.33 }]);
    expect((await as(own, (db) => surveySummary(db, { branchId: t.b1 }))).map((x) => x.branch_id)).toEqual([t.b1]);
    expect(await code(as(fo, (db) => surveyList(db)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(fo, (db) => surveySummary(db)))).toBe("ERR_FORBIDDEN");
    const consentText = (await as(own, (db) => publishConsentText(db, { purpose: "marketing_wa", body: "Saya setuju menerima promosi klinik." }))).id;
    await as(fo, (db) => grantConsent(db, key(), { patientId: pt, purpose: "marketing_wa", textId: consentText, channel: "in_person" }));
    expect(await find(mkt)).toMatchObject({ patient_name: "Pasien K26 Rahasia", consent_masked: false });
    expect(await code(as(cs, (db) => surveyList(db, { from: "2032-01-10", to: "2032-01-01" })))).toBe("ERR_INVALID_INPUT");
    // the branch-local day range: today's surveys are inside [today, today] and outside a range that ends yesterday
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
    const yesterday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(Date.now() - 86_400_000));
    expect((await as(cs, (db) => surveyList(db, { from: today, to: today }))).rows.map((r) => r.id)).toContain(ids[0]);
    expect((await as(cs, (db) => surveyList(db, { from: yesterday, to: yesterday }))).rows.map((r) => r.id)).not.toContain(ids[0]);
    expect(await as(cs, (db) => surveySummary(db, { branchId: t.b1, from: yesterday, to: yesterday }))).toEqual([]);
    // the lower bound alone: a range that starts tomorrow excludes today's survey (list and summary)
    const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(Date.now() + 86_400_000));
    expect((await as(cs, (db) => surveyList(db, { from: tomorrow, to: tomorrow }))).rows.map((r) => r.id)).not.toContain(ids[0]);
    expect(await as(cs, (db) => surveySummary(db, { branchId: t.b1, from: tomorrow, to: tomorrow }))).toEqual([]);
    // review r2: the branch-local day, not the UTC date — a survey recorded at 2032-01-01T18:00:00Z (01:00 on 2 January in Jakarta)
    const vB = await visit(t, await patient(t, "Pasien Batas Hari"), fo);
    const bound = (await h.admin.query(`insert into surveys (tenant_id, branch_id, visit_id, patient_id, score, review_eligible, command_key, recorded_by, recorded_as, recorded_at)
      select v.tenant_id, v.branch_id, v.id, v.patient_id, 3, false, $2, $3, 'central_cs', '2032-01-01T18:00:00Z' from visits v where v.id = $1 returning id`,
      [vB, `k-${key()}`, cs.staffId])).rows[0].id as string;
    const jan = async (d: string) => (await as(cs, (db) => surveyList(db, { from: d, to: d }))).rows;
    expect((await jan("2032-01-02")).find((r) => r.id === bound)).toMatchObject({ day: "2032-01-02", score: 3 });
    expect((await jan("2032-01-01")).map((r) => r.id)).not.toContain(bound);
    expect(await as(cs, (db) => surveySummary(db, { branchId: t.b1, from: "2032-01-02", to: "2032-01-02" }))).toEqual([{ branch_id: t.b1, total: 1, low_count: 0, avg_score: 3, low_pct: 0 }]);
    expect(await as(cs, (db) => surveySummary(db, { branchId: t.b1, from: "2032-01-01", to: "2032-01-01" }))).toEqual([]);
    // guards
    expect(await raw(`update surveys set score = 5 where id = $1`, [ids[0]])).toBe("raw:42501");
    expect(await raw(`delete from surveys where id = $1`, [ids[0]])).toBe("raw:42501");
    expect(await raw(`truncate surveys cascade`)).toBe("raw:42501");
    // tenants: B's owner sees none of t's or A's surveys; A's staff cannot record on B's visit
    expect((await as(BOWN, (db) => surveyList(db))).rows).toEqual([]);
    expect(await as(BOWN, (db) => surveySummary(db))).toEqual([]);
    expect((await as(BOWN, (db) => db.query(`select id from surveys where id = $1`, [ids[0]]))).rowCount).toBe(0);
    const bpt = await patient(B, "Pasien Tenant B");
    const bfo = await person(B, "fo_cashier", B.b1);
    const bv = await visit(B, bpt, bfo);
    expect(await code(as(CS, (db) => recordSurvey(db, key(), { visitId: bv, score: 2 })))).toBe("ERR_NOT_FOUND");
    void marketingText; void MGR1b; void AU;
  });
});
