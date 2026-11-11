// T-045 Done-when: scenario PR-83 "no-show without DP" (state no-show, no money moves); plus the plan
// review: cancel, confirm, reschedule (atomic), the calendar reader, the live helper in booking and
// roster, SET-15, lifecycle (suspended keeps existing appointments), roles, idempotency, guards, tenancy.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { decideApproval } from "../../src/modules/approvals/approvals";
import { publish } from "../../src/modules/catalog/catalog";
import { setHours, setServices, upsertDevice, upsertRoom } from "../../src/modules/org/branches/branches";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { book, confirm, slots } from "../../src/modules/scheduling/booking/booking";
import { changeSetting } from "../../src/modules/settings/settings";
import { calendar, cancelAppointment, confirmAttendance, markNoShow, reschedule } from "../../src/modules/scheduling/appointments/appointments";
import { addLeave, setWeek } from "../../src/modules/scheduling/rosters/rosters";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local"; // synthetic data (MIG-2)

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "purchasing", "marketing", "central_cs", "auditor"];

async function tenant(state = "live"): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ($1) returning id`, [state])).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Jadwal Janji Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("K1"), b2: await br("K2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`apt${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Janji ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  const bs = TENANT_WIDE.includes(role) ? [] : branches.length ? branches : [t.b1];
  for (const b of bs) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: bs[0] };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>, branch?: string) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: branch ?? p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const reason = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason}` : `raw:${e.message}`));
const key = () => crypto.randomUUID();
const localDay = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(Date.now() + days * 86_400_000));
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+07:00`);
const monday = (d: string) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
};
const hhmm = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

// The full-week rows of one staff member (09:00-20:00 every day) with one date overridden: a roster save
// replaces the whole week of the listed staff, so a test that changes one day must post the others too.
const weekDays = (week: string) => [0, 1, 2, 3, 4, 5, 6].map((i) => { const x = new Date(`${week}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + i); return x.toISOString().slice(0, 10); });

async function patient(t: T, name = "Pasien Booking"): Promise<string> {
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
     select $1, 'RM-' || lpad((count(*) + 1)::text, 6, '0'), $2, '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture sintetis', 'islam', 'Karyawan', 's1', 'kawin', $3,
            (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier' from patients where tenant_id = $1 returning id`,
    [t.tenantId, name, t.b1],
  )).rows[0].id as string;
}

let A: T;
let B: T;
let OWN: P; let FH: P; let MGR: P; let FO: P; let FO2: P; let CS: P; let BC: P; let DOC: P; let DOC2: P; let NUR: P; let FIN: P; let MK: P;
let consult: { itemId: string; versionId: string }; // doctor + consultation room, no device (scenario PR-6)
let laser: { itemId: string; versionId: string }; // doctor + treatment room + laser (scenario PR-88)

async function service(code: string, f: Record<string, unknown>) {
  const v = await as(OWN, (db) => publish(db, { kind: "service", code }, {
    name: `Layanan ${code}`, tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 300_000, category: "consultation",
    prep_min: 10, treatment_min: 30, buffer_min: 10, indications: "Indikasi", contraindications: "Kontra", consent_template: "Templat", delegation: "Dokter",
    aftercare_text: "Perawatan setelah tindakan", eligibility: [{ role: "doctor", mode: "performs" }], ...f,
  } as never, "Layanan baru"));
  if (v.approvalId) await as(FH, (db) => decideApproval(db, v.approvalId!, true));
  return { itemId: v.itemId, versionId: v.versionId };
}

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 8 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); FH = await person(A, "facility_head", A.b1);
  MGR = await person(A, "manager", A.b1); FO = await person(A, "fo_cashier", A.b1); FO2 = await person(A, "fo_cashier", A.b2); CS = await person(A, "central_cs");
  BC = await person(A, "bc", A.b1); DOC = await person(A, "doctor", A.b1, A.b2); DOC2 = await person(A, "doctor", A.b1); NUR = await person(A, "nurse", A.b1);
  FIN = await person(A, "finance"); MK = await person(A, "marketing");
  const open = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "09:00", closes: "20:00" }));
  for (const b of [A.b1, A.b2]) await as(OWN, (db) => setHours(db, b, open));
  await as(OWN, (db) => upsertRoom(db, A.b1, { name: "Konsul 1", kind: "consultation" }));
  await as(OWN, (db) => upsertRoom(db, A.b1, { name: "Tindakan 1", kind: "treatment" }));
  await as(OWN, (db) => upsertDevice(db, A.b1, { type: "laser", label: "Laser 1" }));
  await as(OWN, (db) => upsertRoom(db, A.b2, { name: "Konsul B2", kind: "consultation" }));
  await as(OWN, (db) => upsertRoom(db, A.b2, { name: "Tindakan B2", kind: "treatment" })); // B2 has no laser
  consult = await service("KONSUL", { resources: [{ kind: "room", code: "consultation" }] });
  laser = await service("LASER", { category: "laser_non_ablative", treatment_min: 45, resources: [{ kind: "room", code: "treatment" }, { kind: "device", code: "laser" }] });
  for (const b of [A.b1, A.b2]) await as(OWN, (db) => setServices(db, b, [consult.itemId, laser.itemId]));
  // Every test date is D+8 .. D+24: roster the three weeks those dates fall in (the fixture weeks).
  const shift = (staffId: string, date: string) => ({ staffId, date, starts: "09:00", ends: "20:00", kind: "work" as const });
  for (const week of [...new Set([8, 15, 22, 24].map((d) => monday(localDay(d))))]) {
    const days = [0, 1, 2, 3, 4, 5, 6].map((i) => { const x = new Date(`${week}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + i); return x.toISOString().slice(0, 10); });
    await as(OWN, (db) => setWeek(db, A.b1, week, [DOC.staffId, DOC2.staffId, NUR.staffId], days.flatMap((d) => [shift(DOC2.staffId, d), shift(NUR.staffId, d)])));
    await as(OWN, (db) => setWeek(db, A.b2, week, [DOC.staffId], days.map((d) => shift(DOC.staffId, d))));
  }
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});


// A booking in the past is impossible through booking_create (the start must be in the future), so a
// past appointment for the no-show tests is made directly with the guards off (a fixture).
async function pastAppointment(t: T, branch: string, staffId: string, pt: string, minutesAgo: number, versionId = consult.versionId) {
  const s = new Date(Math.floor((Date.now() - minutesAgo * 60_000) / 900_000) * 900_000);
  const e = new Date(s.getTime() + 50 * 60_000);
  await h.admin.query(`alter table appointments disable trigger appointments_guard`);
  await h.admin.query(`alter table resource_reservations disable trigger resource_reservations_guard`);
  try {
    const id = (await h.admin.query(
      `insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state, channel, created_by, created_as)
       values ($1, $2, $3, $4, $5, $6, $7, 'booked', 'phone', $5, 'fo_cashier') returning id`,
      [t.tenantId, branch, pt, versionId, staffId, s, e],
    )).rows[0].id as string;
    await h.admin.query(`insert into resource_reservations (tenant_id, branch_id, appointment_id, kind, resource_id, starts_at, ends_at) values ($1, $2, $3, 'staff', $4, $5, $6)`,
      [t.tenantId, branch, id, staffId, s, e]);
    return id;
  } finally {
    await h.admin.query(`alter table appointments enable always trigger appointments_guard`);
    await h.admin.query(`alter table resource_reservations enable always trigger resource_reservations_guard`);
  }
}
const stateOf = async (id: string) => (await h.admin.query(`select state, state_reason, rescheduled_to, state_changed_by from appointments where id = $1`, [id])).rows[0];
const activeRes = async (id: string) => Number((await h.admin.query(`select count(*) from resource_reservations where appointment_id = $1 and active`, [id])).rows[0].count);

describe("Done-when: scenario PR-83 no-show without DP", () => {
  it("FO marks Tidak Datang after the appointment time: state no-show, no money moves, the slot is released, an event is recorded", async () => {
    const pt = await patient(A);
    const id = await pastAppointment(A, A.b1, DOC2.staffId, pt, 60);
    const moneyTables = (await h.admin.query(`select table_name from information_schema.tables where table_schema = 'public' and table_name ~ '(payment|invoice|deposit|balance|ledger_entr)'`)).rows.map((r) => r.table_name as string);
    const before = await Promise.all(moneyTables.map(async (t) => Number((await h.admin.query(`select count(*) from ${t}`)).rows[0].count)));
    await as(FO, (db) => markNoShow(db, key(), id));
    expect(await stateOf(id)).toMatchObject({ state: "no_show", state_changed_by: FO.staffId });
    expect(await activeRes(id)).toBe(0);
    const after = await Promise.all(moneyTables.map(async (t) => Number((await h.admin.query(`select count(*) from ${t}`)).rows[0].count)));
    expect(after).toEqual(before);
    const ev = (await h.admin.query(`select type, payload from domain_events where aggregate_id = $1`, [id])).rows;
    expect(ev.map((e) => e.type)).toEqual(["AppointmentNoShow"]);
    expect(Object.keys(ev[0].payload).sort()).toEqual(["appointment_id", "branch_id", "patient_id"]);
    expect((await h.admin.query(`select reason_code from audit_events where object_id = $1`, [id])).rows.map((r) => r.reason_code)).toEqual(["appointment_no_show"]);
  });

  it("not before the appointment time, nor before start + SET-15 when set; never twice", async () => {
    const pt = await patient(A);
    const future = await as(FO, (db) => book(db, key(), { branchId: A.b1, patientId: pt, versionId: consult.versionId, startsAt: at(localDay(8), "10:00"), channel: "phone" }));
    expect(await reason(as(FO, (db) => markNoShow(db, key(), future.appointmentId)))).toBe("ERR_INVALID_INPUT:before_no_show_time");
    // SET-15 = 30 minutes at B1: an appointment that began 10 minutes ago is not yet a no-show; 60 minutes ago is.
    await as(MGR, (db) => changeSetting(db, { key: "SET-15", branchId: A.b1, value: 30, reason: "Uji keterlambatan" }));
    const p2 = await patient(A);
    const recent = await pastAppointment(A, A.b1, DOC2.staffId, p2, 10);
    expect(await reason(as(FO, (db) => markNoShow(db, key(), recent)))).toBe("ERR_INVALID_INPUT:before_no_show_time");
    const p3 = await patient(A);
    const old = await pastAppointment(A, A.b1, DOC.staffId, p3, 60);
    await as(FO, (db) => markNoShow(db, key(), old));
    expect(await reason(as(FO, (db) => markNoShow(db, key(), old)))).toBe("ERR_VERSION_CONFLICT:not_scheduled");
  });
});

describe("cancel, confirm, reschedule", () => {
  it("Batalkan needs a reason, releases the slot (bookable again), keeps the reason on the row only", async () => {
    const [p1, p2] = [await patient(A), await patient(A)];
    const D = localDay(9);
    const b = await as(CS, (db) => book(db, key(), { branchId: A.b1, patientId: p1, versionId: consult.versionId, startsAt: at(D, "11:00"), staffId: DOC2.staffId, channel: "phone" }));
    expect(await reason(as(CS, (db) => cancelAppointment(db, key(), b.appointmentId, "x")))).toBe("ERR_INVALID_INPUT:reason");
    await as(CS, (db) => cancelAppointment(db, key(), b.appointmentId, "Pasien sakit flu"));
    expect(await stateOf(b.appointmentId)).toMatchObject({ state: "cancelled", state_reason: "Pasien sakit flu" });
    expect(await activeRes(b.appointmentId)).toBe(0);
    expect(await code(as(CS, (db) => book(db, key(), { branchId: A.b1, patientId: p2, versionId: consult.versionId, startsAt: at(D, "11:00"), staffId: DOC2.staffId, channel: "phone" })))).toBe("ok");
    const all = JSON.stringify((await h.admin.query(`select payload from domain_events where aggregate_id = $1`, [b.appointmentId])).rows)
      + JSON.stringify((await h.admin.query(`select reason from audit_events where object_id = $1`, [b.appointmentId])).rows);
    expect(all).not.toContain("flu");
    expect(await reason(as(CS, (db) => cancelAppointment(db, key(), b.appointmentId, "Lagi")))).toBe("ERR_VERSION_CONFLICT:not_scheduled");
  });

  it("confirm: booked → confirmed; a confirmed appointment still holds its slot (live) and can be cancelled or rescheduled", async () => {
    const p1 = await patient(A);
    const D = localDay(10);
    const b = await as(FO, (db) => book(db, key(), { branchId: A.b1, patientId: p1, versionId: consult.versionId, startsAt: at(D, "10:00"), staffId: DOC2.staffId, channel: "phone" }));
    await as(FO, (db) => confirmAttendance(db, key(), b.appointmentId));
    expect((await stateOf(b.appointmentId)).state).toBe("confirmed");
    expect(await reason(as(FO, (db) => confirmAttendance(db, key(), b.appointmentId)))).toBe("ERR_VERSION_CONFLICT:not_booked");
    // Still live: the doctor is busy, the patient cannot double-book, the roster cannot drop the shift.
    expect((await as(FO, (db) => slots(db, { branchId: A.b1, versionId: consult.versionId, date: D, staffId: DOC2.staffId }))).some((x) => hhmm(x.startsAt) === "10:00")).toBe(false);
    expect(await reason(as(FO, (db) => book(db, key(), { branchId: A.b1, patientId: p1, versionId: consult.versionId, startsAt: at(D, "10:30"), channel: "phone" })))).toBe("ERR_VERSION_CONFLICT:patient_overlap");
    expect(await reason(as(MGR, (db) => addLeave(db, { branchId: A.b1, staffId: DOC2.staffId, kind: "leave", from: D, to: D, reason: "Cuti" })))).toBe("ERR_VERSION_CONFLICT:appointment_conflict");
    // booking_confirm refuses a confirmed appointment with a conflict, not a raw guard error.
    expect(await reason(as(FO, (db) => confirm(db, key(), b.appointmentId)))).toBe("ERR_VERSION_CONFLICT:already_booked");
  });

  it("Ubah Jadwal moves the booking atomically: old rescheduled → new booked, the old slot free, a clash changes nothing", async () => {
    const [p1, p2] = [await patient(A), await patient(A)];
    const D = localDay(11);
    const b = await as(FO, (db) => book(db, key(), { branchId: A.b1, patientId: p1, versionId: consult.versionId, startsAt: at(D, "10:00"), staffId: DOC2.staffId, channel: "whatsapp", source: "ig-ad" }));
    // Overlapping its own old slot is fine (the old reservations are released first).
    const r = await as(FO, (db) => reschedule(db, key(), b.appointmentId, at(D, "10:30"), DOC2.staffId));
    expect(await stateOf(b.appointmentId)).toMatchObject({ state: "rescheduled", rescheduled_to: r.appointmentId });
    expect(await activeRes(b.appointmentId)).toBe(0);
    const nw = (await h.admin.query(`select state, patient_id, source, channel, catalog_version_id from appointments where id = $1`, [r.appointmentId])).rows[0];
    expect(nw).toEqual({ state: "booked", patient_id: p1, source: "ig-ad", channel: "whatsapp", catalog_version_id: consult.versionId });
    // A clash with another booking: nothing changes.
    const other = await as(FO, (db) => book(db, key(), { branchId: A.b1, patientId: p2, versionId: consult.versionId, startsAt: at(D, "14:00"), staffId: DOC2.staffId, channel: "phone" }));
    expect(await reason(as(FO, (db) => reschedule(db, key(), r.appointmentId, at(D, "14:00"), DOC2.staffId)))).toBe("ERR_VERSION_CONFLICT:slot_taken");
    expect((await stateOf(r.appointmentId)).state).toBe("booked");
    expect(await activeRes(r.appointmentId)).toBeGreaterThan(0);
    expect((await stateOf(other.appointmentId)).state).toBe("booked");
    // The patient's own other appointment blocks a move onto it (patient overlap, itself excluded).
    await as(CS, (db) => book(db, key(), { branchId: A.b2, patientId: p1, versionId: consult.versionId, startsAt: at(D, "16:00"), staffId: DOC.staffId, channel: "phone" }));
    expect(await reason(as(FO, (db) => reschedule(db, key(), r.appointmentId, at(D, "16:00"), null)))).toBe("ERR_VERSION_CONFLICT:patient_overlap");
    // A past start on the 15-minute grid (two hours ago, rounded down) is refused.
    const past = new Date(Math.floor((Date.now() - 2 * 3_600_000) / 900_000) * 900_000);
    expect(await reason(as(FO, (db) => reschedule(db, key(), r.appointmentId, past, null)))).toBe("ERR_INVALID_INPUT:start");
    const ev = (await h.admin.query(`select type, payload from domain_events where aggregate_id = $1 order by occurred_at`, [b.appointmentId])).rows;
    expect(ev.map((e) => e.type)).toEqual(["AppointmentBooked", "AppointmentRescheduled"]);
    expect(ev[1].payload.new_appointment_id).toBe(r.appointmentId);
  });

  it("the calendar shows every state with names, rooms and the no-show time; expired holds are left out", async () => {
    const D = localDay(11);
    const c = await as(CS, (db) => calendar(db, A.b1, D, D));
    const states = new Set(c.appointments.map((x) => x.state));
    expect(states.has("rescheduled") && states.has("booked")).toBe(true);
    const row = c.appointments.find((x) => x.state === "rescheduled")!;
    expect(row).toMatchObject({ serviceName: "Layanan KONSUL", performerId: DOC2.staffId });
    expect(row.rooms.length).toBe(1);
    expect(row.noShowFrom.getTime()).toBeGreaterThanOrEqual(row.startsAt.getTime());
    expect(c.performers.map((p) => p.id)).toEqual(expect.arrayContaining([DOC2.staffId]));
    expect(await code(as(FO2, (db) => calendar(db, A.b1, D, D)))).toBe("ERR_NOT_FOUND");
    for (const p of [FIN, MK]) expect(await code(as(p, (db) => calendar(db, A.b1, D, D))), p.role).toBe("ERR_FORBIDDEN");
    for (const p of [BC, DOC2, NUR]) expect((await as(p, (db) => calendar(db, A.b1, D, D))).appointments.length, p.role).toBeGreaterThan(0);
  });
});

describe("authority, lifecycle, idempotency, guards, cross-tenant", () => {
  it("writers only; a branch outside the role's set is not found", async () => {
    const pt = await patient(A);
    const b = await as(FO, (db) => book(db, key(), { branchId: A.b1, patientId: pt, versionId: consult.versionId, startsAt: at(localDay(12), "10:00"), channel: "phone" }));
    for (const p of [BC, DOC2, NUR, FIN, MK]) expect(await code(as(p, (db) => cancelAppointment(db, key(), b.appointmentId, "Bukan penulis"))), p.role).toBe("ERR_FORBIDDEN");
    expect(await code(as(FO2, (db) => cancelAppointment(db, key(), b.appointmentId, "Cabang lain")))).toBe("ERR_NOT_FOUND");
    expect(await code(as(FO, (db) => cancelAppointment(db, key(), crypto.randomUUID(), "Tidak ada")))).toBe("ERR_NOT_FOUND");
  });

  it("a suspended tenant keeps its existing appointments (confirm, reschedule, cancel, no-show) but takes no new booking; exit refuses all", async () => {
    const S = await tenant();
    const sOwn = await person(S, "owner");
    const sFo = await person(S, "fo_cashier", S.b1);
    const sDoc = await person(S, "doctor", S.b1);
    const sFh = await person(S, "facility_head", S.b1);
    await as(sOwn, (db) => setHours(db, S.b1, [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "09:00", closes: "20:00" }))));
    await as(sOwn, (db) => upsertRoom(db, S.b1, { name: "Konsul S", kind: "consultation" }));
    const v = await as(sOwn, (db) => publish(db, { kind: "service", code: "KONSUL-S" }, {
      name: "Konsultasi S", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 300_000, category: "consultation",
      prep_min: 10, treatment_min: 30, buffer_min: 10, indications: "I", contraindications: "K", consent_template: "T", delegation: "D",
      aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }], resources: [{ kind: "room", code: "consultation" }],
    } as never, "Layanan baru"));
    if (v.approvalId) await as(sFh, (db) => decideApproval(db, v.approvalId!, true));
    await as(sOwn, (db) => setServices(db, S.b1, [v.itemId]));
    const D = localDay(13);
    await as(sOwn, (db) => setWeek(db, S.b1, monday(D), [sDoc.staffId], weekDays(monday(D)).map((d) => ({ staffId: sDoc.staffId, date: d, starts: "09:00", ends: "20:00", kind: "work" as const }))));
    const mk = async (t: string) => (await as(sFo, async (db) => book(db, key(), { branchId: S.b1, patientId: await patient(S), versionId: v.versionId, startsAt: at(D, t), channel: "phone" }))).appointmentId;
    const x1 = await mk("09:00"); const x2 = await mk("10:00"); const x3 = await mk("11:00");
    const x4 = await pastAppointment(S, S.b1, sDoc.staffId, await patient(S), 60, v.versionId);
    await h.admin.query(`update tenants_registry set lifecycle_state = 'suspended' where id = $1`, [S.tenantId]);
    expect(await code(as(sFo, (db) => confirmAttendance(db, key(), x1)))).toBe("ok");
    expect(await code(as(sFo, (db) => reschedule(db, key(), x2, at(D, "13:00"), null)))).toBe("ok");
    expect(await code(as(sFo, (db) => cancelAppointment(db, key(), x3, "Klinik tutup sementara")))).toBe("ok");
    expect(await code(as(sFo, (db) => markNoShow(db, key(), x4)))).toBe("ok");
    expect(await code(as(sFo, async (db) => book(db, key(), { branchId: S.b1, patientId: await patient(S), versionId: v.versionId, startsAt: at(D, "15:00"), channel: "phone" })))).toBe("ERR_TENANT_SUSPENDED");
    await h.admin.query(`update tenants_registry set lifecycle_state = 'exit' where id = $1`, [S.tenantId]);
    expect(await code(as(sFo, (db) => cancelAppointment(db, key(), x1, "Keluar")))).toBe("ERR_TENANT_SUSPENDED");
  });

  it("production with go-live blockers refuses every change before anything is written (ARCH-10)", async () => {
    const pt = await patient(A);
    const b = await as(FO, (db) => book(db, key(), { branchId: A.b1, patientId: pt, versionId: consult.versionId, startsAt: at(localDay(17), "10:00"), channel: "phone" }));
    process.env.DEPLOY_ENV = "production";
    try {
      for (const run of [
        (db: pg.PoolClient): Promise<unknown> => confirmAttendance(db, key(), b.appointmentId),
        (db: pg.PoolClient) => cancelAppointment(db, key(), b.appointmentId, "Belum boleh"),
        (db: pg.PoolClient) => markNoShow(db, key(), b.appointmentId),
        (db: pg.PoolClient) => reschedule(db, key(), b.appointmentId, at(localDay(17), "11:00"), null),
      ] as ((db: pg.PoolClient) => Promise<unknown>)[]) await expect(as(FO, run)).rejects.toThrow(/go-live blocked/);
    } finally {
      process.env.DEPLOY_ENV = "local";
    }
    expect((await stateOf(b.appointmentId)).state).toBe("booked");
  });

  it("the same key replays; a refusal leaves no record", async () => {
    const pt = await patient(A);
    const b = await as(FO, (db) => book(db, key(), { branchId: A.b1, patientId: pt, versionId: consult.versionId, startsAt: at(localDay(14), "10:00"), channel: "phone" }));
    const k = key();
    await as(FO, (db) => cancelAppointment(db, k, b.appointmentId, "Pasien minta batal"));
    expect((await as(FO, (db) => cancelAppointment(db, k, b.appointmentId, "Pasien minta batal"))).replayed).toBe(true);
    const k2 = key();
    expect(await as(FO, (db) => code(cancelAppointment(db, k2, crypto.randomUUID(), "Tidak ada")))).toBe("ERR_NOT_FOUND");
    expect(Number((await h.admin.query(`select count(*) from idempotency_records where key = $1`, [k2])).rows[0].count)).toBe(0);
  });

  it("guards: created held or booked only; no skipped or reversed transition; releasing states need released reservations", async () => {
    const pt = await patient(A);
    const b = await as(FO, (db) => book(db, key(), { branchId: A.b1, patientId: pt, versionId: consult.versionId, startsAt: at(localDay(15), "10:00"), channel: "phone" }));
    await expect(h.admin.query(`update appointments set state = 'cancelled', state_reason = 'langsung', state_changed_at = now(), state_changed_by = $2 where id = $1`, [b.appointmentId, FO.staffId])).rejects.toThrow(/release the reservations/);
    await expect(h.admin.query(`update appointments set state = 'held', hold_until = now() + interval '1 hour' where id = $1`, [b.appointmentId])).rejects.toThrow(/only change/);
    await expect(h.admin.query(
      `insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state, channel, created_by, created_as, state_changed_at, state_changed_by)
       values ($1, $2, $3, $4, $5, now() + interval '9 days', now() + interval '9 days 1 hour', 'confirmed', 'phone', $5, 'fo_cashier', now(), $5)`,
      [A.tenantId, A.b1, pt, consult.versionId, FO.staffId],
    )).rejects.toThrow(/created held or booked/);
    await expect(h.admin.query(`update appointments set state = 'rescheduled', rescheduled_to = id, state_changed_at = now(), state_changed_by = $2 where id = $1`, [b.appointmentId, FO.staffId])).rejects.toThrow();
  });

  it("tenant B neither reads nor changes A's appointments", async () => {
    const bOwn = await person(B, "owner");
    const pt = await patient(A, "Rahasia A");
    const b = await as(FO, (db) => book(db, key(), { branchId: A.b1, patientId: pt, versionId: consult.versionId, startsAt: at(localDay(16), "10:00"), channel: "phone" }));
    expect(await code(as(bOwn, (db) => cancelAppointment(db, key(), b.appointmentId, "Dari B")))).toBe("ERR_NOT_FOUND");
    expect(await code(as(bOwn, (db) => markNoShow(db, key(), b.appointmentId)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(bOwn, (db) => calendar(db, A.b1, localDay(16), localDay(16))))).toBe("ERR_NOT_FOUND");
  });
});
