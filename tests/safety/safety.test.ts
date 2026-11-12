// T-068 Done-when: scenario PR-82 — a device due for calibration; the due date passes without an entry; it appears in
// Perlu Ditangani for the branch manager (the manager's notification, raised once by the daily due scan, and the
// overdue device first in the logbook overview). Plus PR-82's registers: sterilization, calibration and maintenance
// entries (an entry moves the due date), the B3 waste handover register, corrections as new entries; the incident
// register reported → investigating → closed with the reporting determination and submission evidence; roles, branches,
// reporters seeing their own reports only, tenants, replays, guards. Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { list as notifications } from "../../src/modules/notifications/notifications";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import {
  handleIncident, incidentGet, incidentList, incidentPatientOptions, logbookOverview, recordEntry, reportIncident, runDueScan, setSchedule, SafetyError,
} from "../../src/modules/safety/safety";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "purchasing", "marketing", "central_cs", "auditor"];

async function tenant(state = "live"): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ($1) returning id`, [state])).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Logbook Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("L1"), b2: await br("L2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`lgb${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Logbook ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const why = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof SafetyError ? `${e.code}:${e.reason}` : e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const key = () => crypto.randomUUID();
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
const plus = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const raw = (sql: string, args: unknown[]) => h.admin.query(sql, args).then(() => "ok", (e) => `raw:${e.code}`);
const dueNotes = async (schedule: string) =>
  (await h.admin.query(`select type, recipient_role, branch_id from notifications where subject_id = $1 order by created_at`, [schedule])).rows;
async function patient(t: T, branch: string): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "");
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Pasien Insiden', '1990-01-01', 'female', 'nik', $3, $4, 'islam', 'Karyawan', 's1', 'kawin', $2,
             (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id`,
    [t.tenantId, branch, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43)])).rows[0].id as string;
}

let A: T; let B: T;
let OWN: P; let AU: P; let FH: P; let FH2: P; let MGR: P; let MGR2: P; let NUR: P; let DOC: P; let TH: P; let PH: P; let FO: P; let BMGR: P;
let LASER: string; let IPL: string; let LASER2: string; let ROOM: string; let BLASER: string;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); AU = await person(A, "auditor");
  FH = await person(A, "facility_head", A.b1); FH2 = await person(A, "facility_head", A.b2);
  MGR = await person(A, "manager", A.b1); MGR2 = await person(A, "manager", A.b2);
  NUR = await person(A, "nurse", A.b1); DOC = await person(A, "doctor", A.b1); TH = await person(A, "therapist", A.b1); PH = await person(A, "pharmacist", A.b1);
  FO = await person(A, "fo_cashier", A.b1);
  BMGR = await person(B, "manager", B.b1);
  const dev = async (t: T, b: string, type: string, label: string) =>
    (await h.admin.query(`insert into branch_devices (tenant_id, branch_id, device_type, label) values ($1, $2, $3, $4) returning id`, [t.tenantId, b, type, label])).rows[0].id as string;
  LASER = await dev(A, A.b1, "laser", "Laser Pico 1");
  IPL = await dev(A, A.b1, "ipl", "IPL Utama");
  LASER2 = await dev(A, A.b2, "laser", "Laser Cabang 2");
  BLASER = await dev(B, B.b1, "laser", "Laser B");
  ROOM = (await h.admin.query(`insert into rooms (tenant_id, branch_id, name, kind) values ($1, $2, 'Ruang Steril', 'treatment') returning id`, [A.tenantId, A.b1])).rows[0].id;
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

describe("scenario PR-82: a device past its calibration due date", () => {
  it("the due date passes without an entry: the branch manager sees it in Perlu Ditangani, once; an entry moves the due date", async () => {
    const t = today();
    const { scheduleId } = await as(MGR, (db) => setSchedule(db, key(), A.b1, { deviceId: LASER, kind: "calibration", intervalDays: 180, nextDueOn: plus(t, 1) }));
    // Not yet due: nothing raised; the overview shows it on time.
    expect(await runDueScan(app, t)).toBe(0);
    expect(await dueNotes(scheduleId)).toEqual([]);
    // On the due date itself nothing is raised yet; the day after, the due date has passed without an entry.
    await runDueScan(app, plus(t, 1));
    expect(await dueNotes(scheduleId)).toEqual([]);
    await runDueScan(app, plus(t, 2));
    expect(await dueNotes(scheduleId)).toEqual([{ type: "logbook_calibration_due", recipient_role: "manager", branch_id: A.b1 }]);
    expect((await as(MGR, (db) => notifications(db))).filter((x) => x.subjectId === scheduleId).map((x) => x.label)).toEqual(["Alat lewat jatuh tempo kalibrasi"]);
    expect((await as(MGR2, (db) => notifications(db))).filter((x) => x.subjectId === scheduleId)).toHaveLength(0); // the other branch's manager
    expect((await as(NUR, (db) => notifications(db))).filter((x) => x.subjectId === scheduleId)).toHaveLength(0);
    // Once per due date: the next scans raise nothing more.
    await runDueScan(app, plus(t, 2));
    await runDueScan(app, plus(t, 9));
    expect(await dueNotes(scheduleId)).toHaveLength(1);
    // The overview (read on the real clock) lists the device first when it is overdue.
    await h.admin.query(`update device_schedules set next_due_on = $2 where id = $1`, [scheduleId, plus(t, -1)]);
    const ov = await as(MGR, (db) => logbookOverview(db, A.b1, "calibration"));
    expect(ov.devices[0]).toMatchObject({ id: LASER, schedules: [{ kind: "calibration", overdue: true, next_due_on: plus(t, -1) }] });
    expect(ov.can_schedule && ov.can_write).toBe(true);
    // The calibration entry moves the due date to the entry date + interval; the device is no longer overdue.
    await as(NUR, (db) => recordEntry(db, key(), A.b1, { kind: "calibration", performedOn: t, deviceId: LASER, result: "ok", performerName: "PT Teknisi Medis", certificateNo: "CAL-001" }));
    expect((await h.admin.query(`select next_due_on::text d from device_schedules where id = $1`, [scheduleId])).rows[0].d).toBe(plus(t, 180));
    expect((await as(MGR, (db) => logbookOverview(db, A.b1, "calibration"))).devices.find((d) => d.id === LASER)!.schedules[0].overdue).toBe(false);
    // A later due date raises a new alert once it passes.
    await runDueScan(app, plus(t, 181));
    expect(await dueNotes(scheduleId)).toHaveLength(2);
  });

  it("schedules: the manager of the branch only; bounds; an inactive device or schedule raises nothing", async () => {
    const t = today();
    for (const p of [NUR, DOC, FH, OWN]) expect(await code(as(p, (db) => setSchedule(db, key(), A.b1, { deviceId: IPL, kind: "maintenance", intervalDays: 30, nextDueOn: t })))).toBe("ERR_FORBIDDEN");
    expect(await code(as(MGR, (db) => setSchedule(db, key(), A.b2, { deviceId: LASER2, kind: "maintenance", intervalDays: 30, nextDueOn: t })))).toBe("ERR_FORBIDDEN"); // not the active branch
    expect(await code(as(MGR, (db) => setSchedule(db, key(), A.b1, { deviceId: LASER2, kind: "maintenance", intervalDays: 30, nextDueOn: t })))).toBe("ERR_NOT_FOUND"); // another branch's device
    expect(await code(as(MGR, (db) => setSchedule(db, key(), A.b1, { deviceId: BLASER, kind: "maintenance", intervalDays: 30, nextDueOn: t })))).toBe("ERR_NOT_FOUND"); // another tenant's
    for (const d of [0, 1826, 1.5]) expect(await code(as(MGR, (db) => setSchedule(db, key(), A.b1, { deviceId: IPL, kind: "maintenance", intervalDays: d, nextDueOn: t }))), String(d)).toBe("ERR_INVALID_INPUT");
    expect(await code(as(MGR, (db) => setSchedule(db, key(), A.b1, { deviceId: IPL, kind: "maintenance", intervalDays: 30, nextDueOn: "2026-02-30" })))).toBe("ERR_INVALID_INPUT");
    const { scheduleId } = await as(MGR, (db) => setSchedule(db, key(), A.b1, { deviceId: IPL, kind: "maintenance", intervalDays: 30, nextDueOn: plus(t, -3) }));
    // Upsert: the same device and kind keeps one schedule.
    const again = await as(MGR, (db) => setSchedule(db, key(), A.b1, { deviceId: IPL, kind: "maintenance", intervalDays: 60, nextDueOn: plus(t, -3), active: false }));
    expect(again.scheduleId).toBe(scheduleId);
    await runDueScan(app, t);
    expect(await dueNotes(scheduleId)).toEqual([]); // inactive
    await as(MGR, (db) => setSchedule(db, key(), A.b1, { deviceId: IPL, kind: "maintenance", intervalDays: 60, nextDueOn: plus(t, -3) }));
    await h.admin.query(`update branch_devices set is_active = false where id = $1`, [IPL]);
    await runDueScan(app, t);
    expect(await dueNotes(scheduleId)).toEqual([]); // the device is inactive
    await h.admin.query(`update branch_devices set is_active = true where id = $1`, [IPL]);
    await runDueScan(app, t);
    expect(await dueNotes(scheduleId)).toEqual([{ type: "logbook_maintenance_due", recipient_role: "manager", branch_id: A.b1 }]);
    // The scan runs only on an unbound worker connection; closed tenants are skipped.
    await expect(as(MGR, (db) => runDueScan(db))).rejects.toMatchObject({ code: "42501" });
    const C = await tenant();
    const cm = await person(C, "manager", C.b1);
    const cdev = (await h.admin.query(`insert into branch_devices (tenant_id, branch_id, device_type, label) values ($1, $2, 'rf', 'RF C') returning id`, [C.tenantId, C.b1])).rows[0].id;
    const { scheduleId: cs } = await as(cm, (db) => setSchedule(db, key(), C.b1, { deviceId: cdev, kind: "calibration", intervalDays: 30, nextDueOn: plus(t, -1) }));
    await h.admin.query(`update tenants_registry set lifecycle_state = 'closed' where id = $1`, [C.tenantId]);
    await runDueScan(app, t);
    expect(await dueNotes(cs)).toEqual([]);
    expect(await runDueScan(app)).toBeGreaterThanOrEqual(0); // without a date: each branch's own today
  });
});

describe("PR-82 logbooks: sterilization, calibration, maintenance, B3 waste", () => {
  it("entries by the room roles and the manager at their branch; corrections are new entries; never changed or deleted", async () => {
    const t = today();
    const { entryId: st } = await as(NUR, (db) => recordEntry(db, key(), A.b1, { kind: "sterilization", performedOn: t, method: "autoclave", items: "Set tindakan 1-5", passed: true, cycleNo: "AC-17", roomId: ROOM }));
    const { entryId: w } = await as(TH, (db) => recordEntry(db, key(), A.b1, { kind: "b3_waste", performedOn: t, wasteCategory: "sharps", quantityGrams: 1250, handlerName: "PT Pengolah Limbah Berizin", handoverRef: "MNF-0042" }));
    await as(DOC, (db) => recordEntry(db, key(), A.b1, { kind: "maintenance", performedOn: plus(t, -2), deviceId: LASER, result: "adjusted", performerName: "Teknisi Internal" }));
    await as(MGR, (db) => recordEntry(db, key(), A.b1, { kind: "sterilization", performedOn: t, method: "chemical", items: "Pinset", passed: false, deviceId: IPL }));
    // A correction names the corrected entry of the same kind; the original stays.
    const { entryId: fix } = await as(NUR, (db) => recordEntry(db, key(), A.b1, { kind: "b3_waste", performedOn: t, wasteCategory: "sharps", quantityGrams: 1300, handlerName: "PT Pengolah Limbah Berizin", handoverRef: "MNF-0042", corrects: w, note: "Timbangan ulang" }));
    expect(await code(as(NUR, (db) => recordEntry(db, key(), A.b1, { kind: "sterilization", performedOn: t, method: "uv", items: "Gunting", passed: true, corrects: w })))).toBe("ERR_NOT_FOUND");
    const ov = await as(FH, (db) => logbookOverview(db, A.b1, "b3_waste"));
    expect(ov.entries.map((e) => [e.id, e.corrected, e.corrects ?? null])).toEqual(expect.arrayContaining([[w, true, null], [fix, false, w]]));
    expect(ov.can_write).toBe(false); // the facility head reads
    const all = await as(AU, (db) => logbookOverview(db, A.b1, null));
    expect(all.entries.find((e) => e.id === st)).toMatchObject({ kind: "sterilization", method: "autoclave", passed: true, cycle_no: "AC-17", room_name: "Ruang Steril" });
    const cal = await as(OWN, (db) => logbookOverview(db, A.b1, "calibration"));
    expect(cal.entries.every((e) => e.kind === "calibration" || e.kind === "maintenance")).toBe(true);
    expect(cal.entries.some((e) => e.kind === "maintenance")).toBe(true); // the Kalibrasi & Perawatan tab lists both
    // Roles: not FO, pharmacist, facility head, owner or auditor; another branch's nurse is refused at A.b1.
    for (const p of [FO, PH, FH, OWN, AU]) expect(await code(as(p, (db) => recordEntry(db, key(), A.b1, { kind: "sterilization", performedOn: t, method: "uv", items: "Gunting", passed: true })))).toBe("ERR_FORBIDDEN");
    expect(await code(as(MGR, (db) => recordEntry(db, key(), A.b2, { kind: "sterilization", performedOn: t, method: "uv", items: "Gunting", passed: true })))).toBe("ERR_FORBIDDEN");
    for (const p of [FO, PH]) expect(await code(as(p, (db) => logbookOverview(db, A.b1, null)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(MGR, (db) => logbookOverview(db, A.b2, null)))).toBe("ERR_NOT_FOUND"); // not the manager's branch
    // Guards on the owner connection.
    expect(await raw(`update logbook_entries set passed = false where id = $1`, [st])).toBe("raw:42501");
    expect(await raw(`delete from logbook_entries where id = $1`, [st])).toBe("raw:42501");
  });

  it("each kind's fields are required and bounded; dates not in the future nor older than a year", async () => {
    const t = today();
    const bad = [
      { kind: "sterilization", performedOn: plus(t, 1), method: "uv", items: "Gunting", passed: true },
      { kind: "sterilization", performedOn: plus(t, -367), method: "uv", items: "Gunting", passed: true },
      { kind: "sterilization", performedOn: t, method: "boil", items: "Gunting", passed: true },
      { kind: "sterilization", performedOn: t, method: "uv", items: "", passed: true },
      { kind: "calibration", performedOn: t, deviceId: LASER, result: "ok", performerName: "" },
      { kind: "calibration", performedOn: t, deviceId: LASER, result: "broken", performerName: "Teknisi" },
      { kind: "b3_waste", performedOn: t, wasteCategory: "radioactive", quantityGrams: 10, handlerName: "PT X", handoverRef: "M1" },
      { kind: "b3_waste", performedOn: t, wasteCategory: "sharps", quantityGrams: 0, handlerName: "PT X", handoverRef: "M1" },
      { kind: "b3_waste", performedOn: t, wasteCategory: "sharps", quantityGrams: 100_000_001, handlerName: "PT X", handoverRef: "M1" },
      { kind: "b3_waste", performedOn: t, wasteCategory: "sharps", quantityGrams: 10, handlerName: "PT X", handoverRef: "" },
      { kind: "sterilization", performedOn: "2026-13-01", method: "uv", items: "Gunting", passed: true },
    ];
    for (const e of bad) expect(await code(as(NUR, (db) => recordEntry(db, key(), A.b1, e as never))), JSON.stringify(e)).toBe("ERR_INVALID_INPUT");
    expect(await code(as(NUR, (db) => recordEntry(db, key(), A.b1, { kind: "calibration", performedOn: t, deviceId: LASER2, result: "ok", performerName: "Teknisi" })))).toBe("ERR_NOT_FOUND"); // another branch's device
    expect(await code(as(NUR, (db) => recordEntry(db, key(), A.b1, { kind: "calibration", performedOn: t, deviceId: BLASER, result: "ok", performerName: "Teknisi" })))).toBe("ERR_NOT_FOUND");
    // A replay returns the same entry; the same key with another body is refused.
    const k = key();
    const e1 = await as(NUR, (db) => recordEntry(db, k, A.b1, { kind: "sterilization", performedOn: t, method: "uv", items: "Gunting", passed: true }));
    const e2 = await as(NUR, (db) => recordEntry(db, k, A.b1, { kind: "sterilization", performedOn: t, method: "uv", items: "Gunting", passed: true }));
    expect([e2.entryId, e2.replayed]).toEqual([e1.entryId, true]);
    expect(await code(as(NUR, (db) => recordEntry(db, k, A.b1, { kind: "sterilization", performedOn: t, method: "uv", items: "Pinset", passed: true })))).toBe("ERR_IDEMPOTENCY_CONFLICT");
  });
});

describe("PR-82 incident register (UX-28 ▸ Insiden)", () => {
  it("reported → investigating → closed; closing needs the investigation and the reporting decision (and its submission)", async () => {
    const pid = await patient(A, A.b1);
    const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`, [A.tenantId, A.b1, pid, FO.staffId])).rows[0].id;
    expect((await as(NUR, (db) => incidentPatientOptions(db, A.b1))).some((o) => o.visit_id === v)).toBe(true);
    for (const p of [FO, MGR]) expect(await code(as(p, (db) => incidentPatientOptions(db, A.b1))), p.role).toBe("ERR_FORBIDDEN");
    const old = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by, checked_in_at) values ($1, $2, $3, 'walk_in', $4, now() - interval '10 days') returning id`,
      [A.tenantId, A.b1, await patient(A, A.b1), FO.staffId])).rows[0].id;
    expect((await as(NUR, (db) => incidentPatientOptions(db, A.b1))).some((o) => o.visit_id === old)).toBe(false); // visits of the last 7 days only
    const at = new Date(Date.now() - 3_600_000).toISOString();
    const { incidentId } = await as(NUR, (db) => reportIncident(db, key(), A.b1, { classification: "ktd", occurredAt: at, patientId: pid, visitId: v, summary: "Luka bakar ringan pasca laser", immediateResponse: "Kompres dingin, salep" }));
    // The facility head of the branch is notified (ids only); the other branch's is not.
    expect((await as(FH, (db) => notifications(db))).filter((x) => x.subjectId === incidentId).map((x) => x.label)).toEqual(["Insiden keselamatan pasien dilaporkan"]);
    expect((await as(FH2, (db) => notifications(db))).filter((x) => x.subjectId === incidentId)).toHaveLength(0);
    const ev = (await h.admin.query(`select payload from domain_events where aggregate_id = $1`, [incidentId])).rows[0].payload;
    expect(Object.keys(ev).sort()).toEqual(["branch_id", "classification", "incident_id"]); // no clinical content
    // Guards on the owner connection while the incident is open: what was reported never changes; a recorded submission
    // never changes; closed is final (an incident of its own, closed and reopened on the owner connection).
    expect(await raw(`update clinical_incidents set summary = 'x' where id = $1`, [incidentId])).toBe("raw:42501");
    // Steps in order: not before take; not by others.
    expect(await why(as(FH, (db) => handleIncident(db, key(), incidentId, { step: "investigate", investigation: "Setelan energi", rootCause: "Kalibrasi" })))).toBe("ERR_VERSION_CONFLICT:not_taken");
    for (const p of [NUR, DOC, MGR, FH2]) expect(await code(as(p, (db) => handleIncident(db, key(), incidentId, { step: "take" }))), p.role).toBe(p === FH2 ? "ERR_FORBIDDEN" : "ERR_FORBIDDEN");
    await as(FH, (db) => handleIncident(db, key(), incidentId, { step: "take" }));
    expect(await why(as(FH, (db) => handleIncident(db, key(), incidentId, { step: "close", correctiveAction: "Kalibrasi ulang" })))).toBe("ERR_VERSION_CONFLICT:investigation_unfinished");
    await as(FH, (db) => handleIncident(db, key(), incidentId, { step: "investigate", investigation: "Energi laser di atas protokol", rootCause: "Alat belum dikalibrasi" }));
    expect(await why(as(FH, (db) => handleIncident(db, key(), incidentId, { step: "investigate", investigation: "Lagi", rootCause: "Lagi" })))).toBe("ERR_VERSION_CONFLICT:already investigated");
    expect(await why(as(FH, (db) => handleIncident(db, key(), incidentId, { step: "close", correctiveAction: "Kalibrasi ulang" })))).toBe("ERR_VERSION_CONFLICT:report_not_submitted");
    expect(await why(as(FH, (db) => handleIncident(db, key(), incidentId, { step: "submit", reference: "X" })))).toBe("ERR_VERSION_CONFLICT:no_report_required");
    await as(FH, (db) => handleIncident(db, key(), incidentId, { step: "determine", reportRequired: true, recipient: "Komite Mutu dan Keselamatan Pasien", dueOn: plus(today(), 2) }));
    expect(await why(as(FH, (db) => handleIncident(db, key(), incidentId, { step: "close", correctiveAction: "Kalibrasi ulang" })))).toBe("ERR_VERSION_CONFLICT:report_not_submitted");
    await as(FH, (db) => handleIncident(db, key(), incidentId, { step: "submit", reference: "LAP-2026-001" }));
    expect(await raw(`update clinical_incidents set submission_ref = 'LAP-lain' where id = $1`, [incidentId])).toBe("raw:42501");
    await as(FH, (db) => handleIncident(db, key(), incidentId, { step: "close", correctiveAction: "Kalibrasi ulang dan pelatihan protokol energi" }));
    expect(await why(as(FH, (db) => handleIncident(db, key(), incidentId, { step: "take" })))).toBe("ERR_VERSION_CONFLICT:incident closed");
    const d = await as(FH, (db) => incidentGet(db, incidentId));
    expect(d).toMatchObject({ state: "closed", report_required: true, submission_ref: "LAP-2026-001", patient_name: "Pasien Insiden", root_cause: "Alat belum dikalibrasi" });
    expect(d.events.map((e) => e.kind)).toEqual(["reported", "taken", "investigated", "determined", "submitted", "closed"]);
    // The reporter sees their report and its state, not the investigation; the owner and auditor see all (no patient name for them).
    const mine = await as(NUR, (db) => incidentGet(db, incidentId));
    expect(mine).toMatchObject({ state: "closed", mine: true });
    expect(mine.investigation).toBeUndefined();
    const au = await as(AU, (db) => incidentGet(db, incidentId));
    expect(au.investigation).toBe("Energi laser di atas protokol");
    expect(au.patient_name).toBeUndefined();
    // Guards: what was reported and recorded never changes; never deleted.
    expect(await raw(`update clinical_incidents set summary = 'x' where id = $1`, [incidentId])).toBe("raw:42501");
    expect(await raw(`update clinical_incidents set submission_ref = 'y' where id = $1`, [incidentId])).toBe("raw:42501");
    expect(await raw(`delete from clinical_incidents where id = $1`, [incidentId])).toBe("raw:42501");
    expect(await raw(`update clinical_incidents set corrective_action = 'diganti' where id = $1`, [incidentId])).toBe("raw:42501"); // closed is final
    expect(await raw(`update clinical_incident_events set kind = 'closed' where incident_id = $1`, [incidentId])).toBe("raw:42501");
  });

  it("no report required: closes after the investigation; KPC has no patient; reporters see only their own; roles and tenants", async () => {
    const at = new Date().toISOString();
    const someone = await patient(A, A.b1);
    const { incidentId: k } = await as(DOC, (db) => reportIncident(db, key(), A.b1, { classification: "kpc", occurredAt: at, summary: "Lantai licin di ruang tunggu", immediateResponse: "Dipasang rambu" }));
    expect(await code(as(DOC, (db) => reportIncident(db, key(), A.b1, { classification: "kpc", occurredAt: at, patientId: someone, summary: "Uji", immediateResponse: "Uji" })))).toBe("ERR_INVALID_INPUT");
    await as(FH, (db) => handleIncident(db, key(), k, { step: "take" }));
    await as(FH, (db) => handleIncident(db, key(), k, { step: "investigate", investigation: "Pel tanpa rambu", rootCause: "SOP kebersihan" }));
    await as(FH, (db) => handleIncident(db, key(), k, { step: "determine", reportRequired: false }));
    await as(FH, (db) => handleIncident(db, key(), k, { step: "close", correctiveAction: "Rambu wajib saat mengepel" }));
    // Who reports: not FO; PH and MGR yes; another branch is refused; bad input refused.
    expect(await code(as(FO, (db) => reportIncident(db, key(), A.b1, { classification: "knc", occurredAt: at, summary: "Uji", immediateResponse: "Uji" })))).toBe("ERR_FORBIDDEN");
    const { incidentId: p2 } = await as(PH, (db) => reportIncident(db, key(), A.b1, { classification: "knc", occurredAt: at, summary: "Obat hampir salah serah", immediateResponse: "Dicek ulang" }));
    expect(await code(as(NUR, (db) => reportIncident(db, key(), A.b2, { classification: "knc", occurredAt: at, summary: "Uji", immediateResponse: "Uji" })))).toBe("ERR_FORBIDDEN");
    for (const bad of [{ classification: "x" }, { occurredAt: "kemarin" }, { occurredAt: new Date(Date.now() + 3_600_000).toISOString() }, { summary: "x" }, { immediateResponse: "" }])
      expect(await code(as(NUR, (db) => reportIncident(db, key(), A.b1, { classification: "knc", occurredAt: at, summary: "Uji", immediateResponse: "Uji", ...bad } as never))), JSON.stringify(bad)).toBe("ERR_INVALID_INPUT");
    expect(await code(as(NUR, (db) => reportIncident(db, key(), A.b1, { classification: "ktd", occurredAt: at, patientId: crypto.randomUUID(), summary: "Uji", immediateResponse: "Uji" })))).toBe("ERR_NOT_FOUND");
    // Lists: the facility head sees the register; a reporter only their own; the other branch's facility head none of A.b1.
    const reg = await as(FH, (db) => incidentList(db, A.b1));
    expect(reg.register && reg.can_handle).toBe(true);
    expect(reg.incidents.map((i) => i.id)).toEqual(expect.arrayContaining([k, p2]));
    const ph = await as(PH, (db) => incidentList(db, A.b1));
    expect(ph.incidents.map((i) => i.id)).toEqual([p2]);
    expect(await code(as(PH, (db) => incidentGet(db, k)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(FH2, (db) => incidentList(db, A.b1)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(FH2, (db) => incidentGet(db, k)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(FO, (db) => incidentList(db, A.b1)))).toBe("ERR_FORBIDDEN");
    // Another tenant sees nothing; direct table reads follow the same rule (RLS).
    expect(await code(as(BMGR, (db) => incidentGet(db, k)))).toBe("ERR_NOT_FOUND");
    expect((await as(PH, (db) => db.query(`select id from clinical_incidents`))).rows.map((r) => r.id)).toEqual([p2]);
    expect((await as(FO, (db) => db.query(`select id from clinical_incidents`))).rows).toEqual([]);
    expect((await as(FO, (db) => db.query(`select id from logbook_entries`))).rows).toEqual([]);
    expect((await as(BMGR, (db) => db.query(`select id from logbook_entries`))).rows).toEqual([]);
    expect(await code(as(MGR, (db) => db.query(`select * from logbook_due_alerts`)))).toBe("raw:42501");
  });
});
