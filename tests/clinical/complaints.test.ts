// T-057 Done-when: scenario PR-43 (a patient reports a reaction at the visit: a Klinis task with the SET-31
// triage time; a free control is recorded as the resolution; the FO sees the status only), CLIN-016 (worse
// symptoms → a clinical task with its due time) and CLIN-024 (the pharmacist flags a suspected adverse effect).
// Plus the plan review: due times (wall clock, working hours, closures, fallback), roles and projections,
// flaggers, take / triage / note / resolve / reopen, read-time escalation and notifications, guards, audit and
// events content-free, exit, cross-tenant.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import {
  flagComplaint, flagOptions, getComplaint, listComplaints, noteComplaint, reopenComplaint, resolveComplaint, takeComplaint, triageComplaint,
  type FlagInput,
} from "../../src/modules/clinical/complaints/complaints";
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
const TABLES = ["complaint_tasks", "complaint_events"];

async function tenant(state = "live", tz = "Asia/Jakarta"): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ($1) returning id`, [state])).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Keluhan Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, $3) returning id`, [tenantId, c, tz])).rows[0].id as string;
  return { tenantId, b1: await br("K1"), b2: await br("K2") };
}
async function person(t: T, roles: Role | Role[], ...branches: string[]): Promise<P> {
  const rs = Array.isArray(roles) ? roles : [roles];
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`klh${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Keluhan ${n}` });
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

async function patient(t: T, name = "Pasien Keluhan"): Promise<string> {
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
const flag = (who: P, i: Partial<FlagInput> & { patientId: string }) =>
  as(who, (db) => flagComplaint(db, key(), { kind: "klinis", source: "staff_flag", summary: "Kemerahan dan gatal setelah tindakan", ...i }));
const row = async (id: string) => (await h.admin.query(`select * from complaint_tasks where id = $1`, [id])).rows[0];
// The due time computed in the tenant's context at a given instant (branch-local hours, closures, settings).
// The helper is not executable by the app: called as the migration owner with the tenant bound for the settings.
async function dueAt(who: P, branch: string, kind: string, triage: string | null, from: string): Promise<Date> {
  await h.admin.query("begin");
  try {
    await h.admin.query(`select set_config('app.tenant_id', $1, true)`, [who.tenantId]);
    return (await h.admin.query(`select complaint_due_at($1, $2, $3, $4, $5::timestamptz) as d`, [who.tenantId, branch, kind, triage, from])).rows[0].d as Date;
  } finally {
    await h.admin.query("commit");
  }
}

let A: T;
let B: T;
let OWN: P; let FH: P; let MGR: P; let DOC: P; let NUR: P; let PH: P; let TH: P; let FO: P; let BC: P; let CS: P; let RO: P; let DOCB2: P; let FO2: P;
let BDOC: P;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = new pg.Pool({ connectionString: h.ownerUrl(), max: 2 });
  owner.on("error", () => {});
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); FH = await person(A, "facility_head", A.b1); MGR = await person(A, "manager", A.b1);
  DOC = await person(A, "doctor", A.b1); NUR = await person(A, "nurse", A.b1); PH = await person(A, "pharmacist", A.b1); TH = await person(A, "therapist", A.b1);
  FO = await person(A, "fo_cashier", A.b1); FO2 = await person(A, "fo_cashier", A.b1); BC = await person(A, "bc", A.b1); CS = await person(A, "central_cs");
  RO = await person(A, "records_officer", A.b1); DOCB2 = await person(A, "doctor", A.b2);
  BDOC = await person(B, "doctor", B.b1);
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

describe("scenario PR-43: a reaction reported at the visit", () => {
  it("a Klinis task with the SET-31 triage time; a free control recorded; the FO sees the status only", async () => {
    const pid = await patient(A, "Pasien Keluhan Satu");
    const v = await visit(A, pid);
    const before = Date.now();
    const { taskId } = await flag(FO, { patientId: pid, visitId: v, source: "visit_note", triage: "merah", summary: "Bengkak rahasia di pipi setelah filler" });
    const t = await row(taskId);
    expect([t.kind, t.source, t.triage, t.state, t.branch_id, t.flagged_as]).toEqual(["klinis", "visit_note", "merah", "open", A.b1, "fo_cashier"]);
    // SET-31 merah default 15 minutes (wall clock).
    const mins = (t.due_at.getTime() - t.created_at.getTime()) / 60_000;
    expect(mins).toBe(15);
    expect(t.created_at.getTime()).toBeGreaterThanOrEqual(before - 1000);
    // The clinical pool sees it with content; the doctor takes it and resolves with a free control.
    const list = await as(NUR, (db) => listComplaints(db, null, "klinis"));
    const mine = list.tasks.find((x) => x.id === taskId)!;
    expect([mine.content, mine.summary, mine.overdue]).toEqual([true, "Bengkak rahasia di pipi setelah filler", false]);
    await as(DOC, (db) => takeComplaint(db, key(), taskId));
    expect(await code(as(NUR, (db) => takeComplaint(db, key(), taskId)))).toBe("ERR_VERSION_CONFLICT");
    await as(DOC, (db) => noteComplaint(db, key(), taskId, "Kompres dingin, kontrol besok"));
    await as(DOC, (db) => resolveComplaint(db, key(), taskId, "kontrol_gratis", "Kontrol gratis dijadwalkan besok pagi"));
    const done = await as(DOC, (db) => getComplaint(db, taskId));
    expect([done.state, done.resolution_outcome, done.assigned_to, done.handler]).toEqual(["resolved", "kontrol_gratis", DOC.staffId, true]);
    expect(done.events.map((e) => e.kind)).toEqual(["flagged", "taken", "note", "resolved"]);
    // The FO who flagged: status only, no summary, resolution or notes.
    const fo = await as(FO, (db) => getComplaint(db, taskId));
    expect([fo.state, fo.content, fo.handler, fo.assigned_to_name]).toEqual(["resolved", false, false, done.assigned_to_name]);
    expect(JSON.stringify(fo)).not.toMatch(/rahasia|kompres|kontrol gratis|kontrol_gratis/i);
    expect(fo.events.every((e) => !("note" in e))).toBe(true);
    const foList = await as(FO, (db) => listComplaints(db, null, null));
    expect(foList.tasks.map((x) => x.id)).toContain(taskId);
    expect(JSON.stringify(foList)).not.toMatch(/rahasia/i);
    // Another FO did not flag it: nothing.
    expect((await as(FO2, (db) => listComplaints(db, null, null))).tasks.map((x) => x.id)).not.toContain(taskId);
    expect(await code(as(FO2, (db) => getComplaint(db, taskId)))).toBe("ERR_NOT_FOUND");
    // Notifications to the clinical roles of the branch; audit and events content-free.
    const no = (await h.admin.query(`select type, recipient_role, branch_id from notifications where subject_id = $1 order by recipient_role`, [taskId])).rows;
    expect(no.map((x) => `${x.type}:${x.recipient_role}`)).toEqual(["complaint_klinis:doctor", "complaint_klinis:facility_head", "complaint_klinis:nurse", "complaint_klinis:pharmacist"]);
    expect(no.every((x) => x.branch_id === A.b1)).toBe(true);
    const au = (await h.admin.query(`select action, reason_code, reason from audit_events where object_id = $1 order by seq`, [taskId])).rows;
    expect(au.map((r) => [r.action, r.reason_code])).toEqual([["settings_change", "complaint_flagged"], ["settings_change", "complaint_taken"], ["settings_change", "complaint_note"],
      ["settings_change", "complaint_resolved"], ["clinical_read", null]]);
    expect(au.every((r) => r.reason === null)).toBe(true);
    const ev = (await h.admin.query(`select type, payload from domain_events where aggregate_id = $1 order by occurred_at, id`, [taskId])).rows;
    expect(ev.map((e) => e.type)).toEqual(["ComplaintFlagged", "ComplaintTaken", "ComplaintResolved"]);
    expect(JSON.stringify(ev)).not.toMatch(/rahasia|bengkak|kompres|kontrol gratis/i);
    const idem = (await h.admin.query(`select result::text as r from idempotency_records where command like 'complaint_%'`)).rows;
    expect(idem.every((r) => (r.r ?? "").length < 80)).toBe(true);
  });
});

describe("CLIN-016 and CLIN-024: worse symptoms; a pharmacist's adverse-effect flag", () => {
  it("worse symptoms → a clinical task due by SET-31 (kuning by default); the pharmacist source is the pharmacist's", async () => {
    const pid = await patient(A);
    const { taskId } = await flag(DOC, { patientId: pid, summary: "Gejala memburuk setelah dua hari" });
    const t = await row(taskId);
    expect([t.triage, (t.due_at.getTime() - t.created_at.getTime()) / 60_000]).toEqual(["kuning", 120]);
    const ph = await flag(PH, { patientId: pid, source: "pharmacist", summary: "Dugaan efek samping obat oral" });
    expect([(await row(ph.taskId)).source, (await row(ph.taskId)).flagged_as]).toEqual(["pharmacist", "pharmacist"]);
    expect(await reason(flag(NUR, { patientId: pid, source: "pharmacist" }))).toMatch(/may not raise/);
    expect(await reason(flag(PH, { patientId: pid, source: "pharmacist", kind: "layanan", category: "tagihan" }))).toMatch(/may not raise/);
    // A branch setting overrides the tenant default; re-triage recomputes from the flag time.
    await h.admin.query(`insert into setting_versions (tenant_id, branch_id, key, value, effective_from, state, changed_by, changed_as, changed_name, reason)
                         values ($1, $2, 'SET-31', '{"merah":5,"kuning":60,"hijau":8}', now() - interval '1 day', 'active', $3, 'owner', 'X', 'Uji cabang')`, [A.tenantId, A.b1, OWN.staffId]);
    const k = await flag(NUR, { patientId: pid, triage: "kuning" });
    const kt = await row(k.taskId);
    expect((kt.due_at.getTime() - kt.created_at.getTime()) / 60_000).toBe(60);
    await as(DOC, (db) => triageComplaint(db, key(), k.taskId, "merah"));
    const kt2 = await row(k.taskId);
    expect([kt2.triage, (kt2.due_at.getTime() - kt2.created_at.getTime()) / 60_000]).toEqual(["merah", 5]);
    expect(await code(as(MGR, (db) => triageComplaint(db, key(), k.taskId, "hijau")))).toBe("ERR_NOT_FOUND");
    await h.admin.query(`insert into setting_versions (tenant_id, branch_id, key, value, effective_from, state, changed_by, changed_as, changed_name, reason)
                         values ($1, $2, 'SET-31', '{"merah":15,"kuning":120,"hijau":8}', now(), 'active', $3, 'owner', 'X', 'Kembali bawaan')`, [A.tenantId, A.b1, OWN.staffId]);
  });
});

describe("due times: working hours", () => {
  it("hijau and layanan walk branch hours minus closures in the branch timezone; no hours → wall clock; bounded", async () => {
    const t = await tenant("live", "Asia/Makassar");
    const fh = await person(t, "facility_head", t.b1);
    // No branch hours: 8 working hours = 8 wall-clock hours.
    expect((await dueAt(fh, t.b1, "klinis", "hijau", "2030-11-04T10:00:00+08:00")).toISOString()).toBe("2030-11-04T10:00:00.000Z");
    // Mon–Fri 09:00–17:00 local (WITA, +08), Saturday 09:00–12:00; Sunday closed.
    for (const d of [1, 2, 3, 4, 5]) await h.admin.query(`insert into branch_hours (tenant_id, branch_id, weekday, opens, closes) values ($1, $2, $3, '09:00', '17:00')`, [t.tenantId, t.b1, d]);
    await h.admin.query(`insert into branch_hours (tenant_id, branch_id, weekday, opens, closes) values ($1, $2, 6, '09:00', '12:00')`, [t.tenantId, t.b1]);
    const iso = async (kind: string, tri: string | null, from: string) => (await dueAt(fh, t.b1, kind, tri, from)).toISOString();
    // Monday 2030-11-04 15:00 WITA + 8 h: 2 h Monday, 6 h Tuesday from 09:00 → Tuesday 15:00 WITA = 07:00Z.
    expect(await iso("klinis", "hijau", "2030-11-04T15:00:00+08:00")).toBe("2030-11-05T07:00:00.000Z");
    // Before opening: Monday 07:00 → Monday 17:00 WITA.
    expect(await iso("layanan", null, "2030-11-04T07:00:00+08:00")).toBe("2030-11-04T09:00:00.000Z");
    // Friday 16:00 + 8 h: 1 h Friday, 3 h Saturday, Sunday closed, 4 h Monday → Monday 13:00 WITA.
    expect(await iso("klinis", "hijau", "2030-11-08T16:00:00+08:00")).toBe("2030-11-11T05:00:00.000Z");
    // A full-day closure on Tuesday and a partial one on Wednesday 10:00–12:00.
    await h.admin.query(`insert into branch_closures (tenant_id, branch_id, closed_on, reason, created_by) values ($1, $2, '2030-11-05', 'Libur uji', $3)`, [t.tenantId, t.b1, fh.staffId]);
    await h.admin.query(`insert into branch_closures (tenant_id, branch_id, closed_on, from_time, until_time, reason, created_by) values ($1, $2, '2030-11-06', '10:00', '12:00', 'Rapat uji', $3)`, [t.tenantId, t.b1, fh.staffId]);
    // Monday 15:00 + 8 h: 2 h Monday, Tuesday closed, Wednesday 09–10 (1 h), 12–17 (5 h) → Wednesday 17:00 WITA.
    expect(await iso("klinis", "hijau", "2030-11-04T15:00:00+08:00")).toBe("2030-11-06T09:00:00.000Z");
    // Wall-clock triage ignores hours.
    expect(await iso("klinis", "merah", "2030-11-10T03:00:00+08:00")).toBe("2030-11-09T19:15:00.000Z");
    // A closing time of 23:59:59.999999 counts to midnight.
    await h.admin.query(`insert into branch_hours (tenant_id, branch_id, weekday, opens, closes) values ($1, $2, 0, '20:00', '23:59:59.999999')`, [t.tenantId, t.b2]);
    expect((await dueAt(fh, t.b2, "layanan", null, "2030-11-03T20:00:00+08:00")).toISOString()).toBe("2030-11-10T16:00:00.000Z");
    // Hours that never come (only a closed weekday): the walk ends after 60 days and adds the rest.
    const z = await tenant("live", "Asia/Jayapura");
    const zfh = await person(z, "facility_head", z.b1);
    await h.admin.query(`insert into branch_hours (tenant_id, branch_id, weekday, opens, closes) values ($1, $2, 3, '09:00', '10:00')`, [z.tenantId, z.b1]);
    for (let i = 0; i < 70; i++) {
      await h.admin.query(`insert into branch_closures (tenant_id, branch_id, closed_on, reason, created_by) values ($1, $2, date '2030-11-04' + $3::int, 'Tutup uji', $4)`, [z.tenantId, z.b1, i, zfh.staffId]);
    }
    expect((await dueAt(zfh, z.b1, "layanan", null, "2030-11-04T08:00:00+09:00")).toISOString()).toBe("2031-01-02T23:00:00.000Z") // 60 local days end at 2031-01-03 00:00 WIT; the 8 h default then runs on the wall clock; the start is 23:00Z the day before, so a UTC day would end a day early;
  });
});

describe("roles, flaggers and projections", () => {
  it("layanan for the manager and the facility head; manager flags layanan only; central CS names a branch; therapist never", async () => {
    const pid = await patient(A);
    const lay = await flag(CS, { patientId: pid, kind: "layanan", category: "waktu_tunggu", summary: "Menunggu terlalu lama di kasir", branchId: A.b1 });
    const lt = await row(lay.taskId);
    expect([lt.branch_id, lt.triage, lt.category, lt.flagged_as, (lt.due_at.getTime() - lt.created_at.getTime()) / 3_600_000]).toEqual([A.b1, null, "waktu_tunggu", "central_cs", 8]);
    expect(await reason(flag(CS, { patientId: pid, kind: "layanan", category: "tagihan" }))).toMatch(/branch not found/);
    expect(await reason(flag(MGR, { patientId: pid }))).toMatch(/may not raise/);
    const mg = await flag(MGR, { patientId: pid, kind: "layanan", category: "sikap_staf", summary: "Staf kurang ramah" });
    expect(await code(flag(TH, { patientId: pid }))).toBe("ERR_FORBIDDEN");
    expect(await code(flag(RO, { patientId: pid }))).toBe("ERR_FORBIDDEN");
    expect(await reason(flag(DOC, { patientId: pid, source: "message" }))).toMatch(/message_source_not_ready/);
    expect(await reason(flag(DOC, { patientId: pid, source: "visit_note" }))).toMatch(/complaint/);
    expect(await reason(flag(DOC, { patientId: pid, kind: "layanan" }))).toMatch(/complaint/);
    expect(await reason(flag(DOC, { patientId: pid, category: "tagihan" }))).toMatch(/complaint/);
    expect(await reason(flag(DOC, { patientId: pid, summary: "  " }))).toMatch(/complaint/);
    // A visit at another branch, or another patient's visit: not found.
    const v2 = await visit(A, pid, A.b2);
    expect(await code(flag(DOC, { patientId: pid, visitId: v2, source: "visit_note" }))).toBe("ERR_NOT_FOUND");
    const other = await visit(A, await patient(A, "Pasien Lain"));
    expect(await code(flag(DOC, { patientId: pid, visitId: other, source: "visit_note" }))).toBe("ERR_NOT_FOUND");
    expect(await code(flag(DOC, { patientId: pid, branchId: A.b2 }))).toBe("ERR_FORBIDDEN");
    // Layanan content: manager and facility head; clinicians do not see layanan; klinis is not the manager's.
    const kl = await flag(BC, { patientId: pid, summary: "Ruam rahasia di dahi" });
    const ids = async (who: P) => (await as(who, (db) => listComplaints(db, null, null))).tasks.map((x) => x.id);
    expect(await ids(MGR)).toEqual(expect.arrayContaining([lay.taskId, mg.taskId]));
    expect(await ids(MGR)).not.toContain(kl.taskId);
    expect(await ids(FH)).toEqual(expect.arrayContaining([lay.taskId, mg.taskId, kl.taskId]));
    for (const who of [DOC, NUR, PH]) {
      expect(await ids(who), who.role).toContain(kl.taskId);
      expect(await ids(who), who.role).not.toContain(lay.taskId);
    }
    expect(await code(as(MGR, (db) => getComplaint(db, kl.taskId)))).toBe("ERR_NOT_FOUND");
    // Triage belongs to klinis only, even for the facility head who handles both.
    expect(await code(as(FH, (db) => triageComplaint(db, key(), mg.taskId, "merah")))).toBe("ERR_INVALID_INPUT");
    // A doctor of both branches acting at b2 (b1 still allowed in the session): b1's task and visits are not here.
    const both = await person(A, "doctor", A.b2, A.b1);
    const bothB2 = await resolveContext(app, both.acc, { tenantId: A.tenantId, actingRole: "doctor", activeBranchId: A.b2 });
    const wide = { ...bothB2, allowedBranchIds: [A.b2, A.b1] };
    expect(await code(withTenantContext(app, wide, (db) => getComplaint(db, kl.taskId)))).toBe("ERR_NOT_FOUND");
    // Nor can it act on b1's task (impl review P2-1).
    for (const [name, fn] of [["take", (db: pg.PoolClient) => takeComplaint(db, key(), kl.taskId)], ["triage", (db: pg.PoolClient) => triageComplaint(db, key(), kl.taskId, "merah")],
      ["note", (db: pg.PoolClient) => noteComplaint(db, key(), kl.taskId, "Catatan lintas cabang")], ["resolve", (db: pg.PoolClient) => resolveComplaint(db, key(), kl.taskId, "edukasi", "Lintas cabang")]] as const) {
      expect(await code(withTenantContext(app, wide, fn)), name).toBe("ERR_NOT_FOUND");
    }
    const pb1 = await patient(A, "Pasien Cabang Satu");
    const vb1 = await visit(A, pb1);
    expect(await code(withTenantContext(app, wide, (db) => flagComplaint(db, key(), { patientId: pb1, visitId: vb1, kind: "klinis", source: "visit_note", summary: "Lintas cabang" }))))
      .toBe("ERR_NOT_FOUND");
    // A session that still allows b1 for a doctor whose b1 role was removed reads nothing at b1 directly.
    const gone = await person(A, "doctor", A.b2);
    const goneB2 = await resolveContext(app, gone.acc, { tenantId: A.tenantId, actingRole: "doctor", activeBranchId: A.b2 });
    const stale = { ...goneB2, allowedBranchIds: [A.b2, A.b1] };
    expect(await withTenantContext(app, stale, async (db) => (await db.query(`select count(*)::int as n from complaint_tasks where id = $1`, [kl.taskId])).rows[0].n)).toBe(0);
    expect(await withTenantContext(app, stale, async (db) => (await db.query(`select count(*)::int as n from complaint_events where task_id = $1`, [kl.taskId])).rows[0].n)).toBe(0);
    expect(await code(as(MGR, (db) => takeComplaint(db, key(), kl.taskId)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(DOC, (db) => takeComplaint(db, key(), lay.taskId)))).toBe("ERR_NOT_FOUND");
    await as(MGR, (db) => resolveComplaint(db, key(), lay.taskId, "penjelasan", "Penjelasan antrean diberikan"));
    // The central CS sees its own flag's status, with no content; the BC its own klinis flag likewise.
    const cs = await as(CS, (db) => getComplaint(db, lay.taskId));
    expect([cs.state, cs.content, cs.assigned_to, "summary" in cs]).toEqual(["resolved", false, MGR.staffId, false]);
    const bc = await as(BC, (db) => listComplaints(db, null, null));
    expect(bc.tasks.map((x) => x.id)).toEqual([kl.taskId]);
    expect(JSON.stringify(bc)).not.toMatch(/rahasia/i);
    // Therapist and records officer are refused on every reader; a doctor of the other branch sees nothing here.
    for (const who of [TH, RO]) {
      expect(await code(as(who, (db) => listComplaints(db, null, null))), who.role).toBe("ERR_FORBIDDEN");
      expect(await code(as(who, (db) => getComplaint(db, kl.taskId))), who.role).toBe("ERR_FORBIDDEN");
      expect(await code(as(who, (db) => flagOptions(db, null))), who.role).toBe("ERR_FORBIDDEN");
    }
    expect(await ids(DOCB2)).not.toContain(kl.taskId);
    expect(await code(as(DOCB2, (db) => getComplaint(db, kl.taskId)))).toBe("ERR_NOT_FOUND");
    // Direct reads: handlers through RLS by kind; flaggers outside the handlers read nothing.
    const direct = (who: P) => as(who, async (db) => (await db.query(`select count(*)::int as n from complaint_tasks where id = any($1::uuid[])`, [[kl.taskId, lay.taskId]])).rows[0].n as number);
    expect([await direct(DOC), await direct(MGR), await direct(FH)]).toEqual([1, 1, 2]);
    for (const who of [FO, BC, CS, TH, RO, OWN, DOCB2]) expect(await direct(who), who.role).toBe(0);
    const ev = (who: P) => as(who, async (db) => (await db.query(`select count(*)::int as n from complaint_events where task_id = $1`, [kl.taskId])).rows[0].n as number);
    expect([await ev(NUR), await ev(BC), await ev(MGR)]).toEqual([1, 0, 0]);
    // Flag options: today's visits at the branch; the central CS names the branch.
    const vt = await visit(A, pid);
    expect((await as(FO, (db) => flagOptions(db, null))).visits.map((x) => x.visit_id)).toContain(vt);
    expect((await as(CS, (db) => flagOptions(db, A.b1))).visits.map((x) => x.visit_id)).toContain(vt);
    expect(await code(as(CS, (db) => flagOptions(db, null)))).toBe("ERR_NOT_FOUND");
    // A Level 2 session allows every id: another tenant's or an unknown branch is still not found (impl review P2-2).
    for (const b of [B.b1, crypto.randomUUID()]) expect(await code(as(CS, (db) => listComplaints(db, b, null)))).toBe("ERR_NOT_FOUND");
    expect((await as(CS, (db) => listComplaints(db, A.b1, null))).role).toBe("central_cs");
    expect(await code(as(FO, (db) => flagOptions(db, A.b2)))).toBe("ERR_NOT_FOUND");
  });
});

describe("resolve, reopen, escalation", () => {
  it("resolve assigns an open task; reopen clears the resolution and keeps history; overdue escalates once on read", async () => {
    const pid = await patient(A);
    const { taskId } = await flag(FO, { patientId: pid, triage: "merah" });
    await as(NUR, (db) => resolveComplaint(db, key(), taskId, "edukasi", "Edukasi perawatan diberikan"));
    let t = await row(taskId);
    expect([t.state, t.assigned_to, t.assigned_as, t.resolved_by]).toEqual(["resolved", NUR.staffId, "nurse", NUR.staffId]);
    expect(await code(as(NUR, (db) => resolveComplaint(db, key(), taskId, "edukasi", "Sekali lagi")))).toBe("ERR_VERSION_CONFLICT");
    expect(await code(as(NUR, (db) => triageComplaint(db, key(), taskId, "hijau")))).toBe("ERR_VERSION_CONFLICT");
    expect(await code(as(DOC, (db) => resolveComplaint(db, key(), taskId, "bukan" as never, "Hasil")))).toBe("ERR_INVALID_INPUT");
    await as(DOC, (db) => reopenComplaint(db, key(), taskId, "Keluhan kembali muncul"));
    t = await row(taskId);
    expect([t.state, t.resolved_at, t.resolution_outcome, t.resolution_note, t.assigned_to]).toEqual(["in_progress", null, null, null, NUR.staffId]);
    expect(await code(as(DOC, (db) => reopenComplaint(db, key(), taskId, "Lagi")))).toBe("ERR_VERSION_CONFLICT");
    expect(await code(as(FO, (db) => reopenComplaint(db, key(), taskId, "Coba buka")))).toBe("ERR_NOT_FOUND");
    expect(await code(as(FO, (db) => noteComplaint(db, key(), taskId, "Catatan FO")))).toBe("ERR_NOT_FOUND");
    const evs = (await as(DOC, (db) => getComplaint(db, taskId))).events;
    expect(evs.map((e) => [e.kind, e.note])).toEqual([["flagged", null], ["resolved", "Edukasi perawatan diberikan"], ["reopened", "Keluhan kembali muncul"]]);
    // Overdue: move the due time back (the owner session bypasses the guard's frozen list: due_at is not frozen).
    await h.admin.query(`update complaint_tasks set due_at = created_at + interval '1 second' where id = $1`, [taskId]);
    await new Promise((r) => setTimeout(r, 1100));
    const lay = await flag(MGR, { patientId: pid, kind: "layanan", category: "tagihan", summary: "Tagihan ganda" });
    await h.admin.query(`update complaint_tasks set due_at = created_at + interval '1 millisecond' where id = $1`, [lay.taskId]);
    // A status reader (FO) triggers the escalation too.
    const fo = await as(FO, (db) => getComplaint(db, taskId));
    expect([fo.overdue, fo.escalated_at !== null]).toEqual([true, true]);
    await as(DOC, (db) => listComplaints(db, null, null));
    await as(FH, (db) => listComplaints(db, null, null));
    for (const id of [taskId, lay.taskId]) {
      expect((await h.admin.query(`select count(*)::int as n from complaint_events where task_id = $1 and kind = 'escalated'`, [id])).rows[0].n).toBe(1);
      expect((await h.admin.query(`select count(*)::int as n from domain_events where aggregate_id = $1 and type = 'ComplaintEscalated'`, [id])).rows[0].n).toBe(1);
    }
    const no = (id: string) => h.admin.query(`select recipient_role from notifications where subject_id = $1 and type = 'complaint_overdue'`, [id]).then((r) => r.rows.map((x) => x.recipient_role));
    expect([await no(taskId), await no(lay.taskId)]).toEqual([["facility_head"], ["owner"]]);
    // Resolved tasks never escalate; the escalation is set once.
    const quiet = await flag(DOC, { patientId: pid, triage: "merah" });
    // Overdue but resolved before anyone read it (due moved while open; a resolved task changes only by reopening).
    await h.admin.query(`update complaint_tasks set due_at = created_at + interval '1 millisecond' where id = $1`, [quiet.taskId]);
    await h.admin.query(`update complaint_tasks set state = 'resolved', assigned_to = $2, assigned_as = 'doctor', resolved_at = now(), resolved_by = $2, resolved_as = 'doctor',
                         resolution_outcome = 'edukasi', resolution_note = 'Selesai sebelum dibaca' where id = $1`, [quiet.taskId, DOC.staffId]);
    await as(FH, (db) => listComplaints(db, null, null));
    expect((await row(quiet.taskId)).escalated_at).toBeNull();
    await expect(h.admin.query(`update complaint_tasks set escalated_at = now() where id = $1`, [taskId])).rejects.toThrow(/set once/);
    // Exit: reads (no escalation), no writes.
    const late = await flag(DOC, { patientId: pid, triage: "merah" });
    await h.admin.query(`update complaint_tasks set due_at = created_at + interval '1 millisecond' where id = $1`, [late.taskId]);
    await h.admin.query(`update tenants_registry set lifecycle_state = 'exit' where id = $1`, [A.tenantId]);
    try {
      const x = await as(DOC, (db) => getComplaint(db, late.taskId));
      expect([x.overdue, x.escalated_at]).toEqual([true, null]);
      expect(await code(as(DOC, (db) => takeComplaint(db, key(), late.taskId)))).toBe("ERR_TENANT_SUSPENDED");
      expect(await code(flag(DOC, { patientId: pid }))).toBe("ERR_TENANT_SUSPENDED");
    } finally {
      await h.admin.query(`update tenants_registry set lifecycle_state = 'live' where id = $1`, [A.tenantId]);
    }
    // Without clinical_read (onboarding) nothing is read.
    await h.admin.query(`update tenants_registry set lifecycle_state = 'onboarding' where id = $1`, [A.tenantId]);
    try {
      expect(await code(as(DOC, (db) => listComplaints(db, null, null)))).toBe("ERR_TENANT_SUSPENDED");
    } finally {
      await h.admin.query(`update tenants_registry set lifecycle_state = 'live' where id = $1`, [A.tenantId]);
    }
  }, 120_000); // ~25 context round-trips and a 1.1 s wait; the 30 s default timed out under host load
});

describe("guards, helpers, support classes, cross-tenant", () => {
  it("never deleted; identity frozen; opens open; resolved only reopens; history insert-only; triggers always", async () => {
    const pid = await patient(A);
    const { taskId } = await flag(DOC, { patientId: pid });
    await expect(h.admin.query(`delete from complaint_tasks where id = $1`, [taskId])).rejects.toThrow(/never deleted/);
    await expect(h.admin.query(`update complaint_tasks set summary = 'Diubah' where id = $1`, [taskId])).rejects.toThrow(/keeps its patient/);
    await expect(h.admin.query(`update complaint_tasks set kind = 'layanan', triage = null, category = 'tagihan' where id = $1`, [taskId])).rejects.toThrow(/keeps its patient/);
    await expect(h.admin.query(`update complaint_events set note = 'x' where task_id = $1`, [taskId])).rejects.toThrow(/never changes/);
    await expect(h.admin.query(`delete from complaint_events where task_id = $1`, [taskId])).rejects.toThrow(/never deleted/);
    await expect(h.admin.query(
      `insert into complaint_tasks (tenant_id, branch_id, patient_id, kind, source, triage, summary, due_at, flagged_by, flagged_as, state, assigned_to, assigned_as)
       values ($1, $2, $3, 'klinis', 'staff_flag', 'merah', 'Langsung', now() + interval '1 hour', $4, 'doctor', 'in_progress', $4, 'doctor')`,
      [A.tenantId, A.b1, pid, DOC.staffId])).rejects.toThrow(/opens open/);
    await as(DOC, (db) => resolveComplaint(db, key(), taskId, "rujuk", "Dirujuk ke spesialis"));
    await expect(h.admin.query(`update complaint_tasks set state = 'open', assigned_to = null, assigned_as = null, resolved_at = null, resolved_by = null, resolved_as = null, resolution_outcome = null, resolution_note = null where id = $1`, [taskId])).rejects.toThrow(/only reopens/);
    await expect(h.admin.query(`update complaint_tasks set resolution_note = null where id = $1`, [taskId])).rejects.toThrow(/only reopens/);
    for (const t of TABLES) await expect(h.admin.query(`truncate ${t} cascade`)).rejects.toThrow();
    const trig = (await h.admin.query(`select tgname, tgenabled from pg_trigger where tgrelid = any($1::regclass[]) and not tgisinternal order by 1`, [TABLES])).rows;
    expect(trig.map((r) => `${r.tgname}:${r.tgenabled}`)).toEqual(["complaint_events_guard:A", "complaint_events_no_truncate:A", "complaint_tasks_guard:A", "complaint_tasks_no_truncate:A"]);
  });

  it("support classes; helpers not executable; cross-tenant reads and writes nothing", async () => {
    const kinds = (await h.admin.query(`select support_class from support_object_kinds where table_name = any($1::text[])`, [TABLES.map((t) => `public.${t}`)])).rows;
    expect(kinds.map((k) => k.support_class)).toEqual(["clinical", "clinical"]);
    for (const f of ["complaint_guard()", "complaint_handler(text,text)", "complaint_due_at(uuid,uuid,text,text,timestamptz)", "complaint_escalate_due(uuid,uuid)",
      "complaint_actor()", "complaint_reader()", "complaint_handled(record,uuid)", "complaint_logged(record,complaint_tasks,text,text,text,jsonb)", "complaint_json(complaint_tasks,boolean)"]) {
      for (const r of ["clinic_app", "clinic_vendor", "clinic_operator"]) {
        expect((await h.admin.query(`select has_function_privilege($1, $2, 'execute') as ok`, [r, `public.${f}`])).rows[0].ok, `${r} ${f}`).toBe(false);
      }
    }
    const pid = await patient(A);
    const v = await visit(A, pid);
    const { taskId } = await flag(DOC, { patientId: pid, visitId: v, source: "visit_note" });
    for (const t of TABLES) expect(await as(BDOC, async (db) => (await db.query(`select count(*)::int as n from ${t}`)).rows[0].n)).toBe(0);
    expect(await code(flag(BDOC, { patientId: pid }))).toBe("ERR_NOT_FOUND");
    expect(await code(flag(BDOC, { patientId: await patient(B), visitId: v, source: "visit_note" }))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BDOC, (db) => getComplaint(db, taskId)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BDOC, (db) => takeComplaint(db, key(), taskId)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BDOC, (db) => noteComplaint(db, key(), taskId, "Catatan lintas")))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BDOC, (db) => resolveComplaint(db, key(), taskId, "edukasi", "Lintas tenant")))).toBe("ERR_NOT_FOUND");
    expect((await as(BDOC, (db) => listComplaints(db, null, null))).tasks.map((x) => x.id)).not.toContain(taskId);
    expect(await code(as(BDOC, (db) => listComplaints(db, A.b1, null)))).toBe("ERR_NOT_FOUND");
  });
});
