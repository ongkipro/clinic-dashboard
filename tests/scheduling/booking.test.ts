// T-044 Done-when: scenario PR-6 (only doctor and room reserved; source and branch stored), overlapping
// reservations refused by the exclusion constraint, scenario PR-88 (no device → no slot), bookings store
// the catalog version used, the slot half of scenario PR-2 (hours and closures), the full scenario PR-48
// (a doctor on leave → no slot). Plus the plan review: eligibility per branch, holds, the UX-33 conflict
// in the roster writers, roles, lifecycle, idempotency, events and audit, guards, vendor classes,
// cross-tenant.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { decideApproval } from "../../src/modules/approvals/approvals";
import { publish } from "../../src/modules/catalog/catalog";
import { addClosure, setHours, setRoomActive, setServices, upsertDevice, upsertRoom } from "../../src/modules/org/branches/branches";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { book, confirm, slots } from "../../src/modules/scheduling/booking/booking";
import { addLeave, setWeek } from "../../src/modules/scheduling/rosters/rosters";
import { createHarness, type Harness } from "../rls/harness";

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
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Booking Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("K1"), b2: await br("K2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`bkg${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Booking ${n}` });
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
const fullWeek = (staffId: string, date: string, rows: { starts: string; ends: string; kind: "work" | "break" }[]) =>
  weekDays(monday(date)).flatMap((d) => (d === date ? rows : [{ starts: "09:00", ends: "20:00", kind: "work" as const }]).map((r) => ({ staffId, date: d, ...r })));

// An isolated branch (no other test books there) with hours 09:00-20:00, a consultation room, the
// consultation service offered, and fresh staff; rosters of other tests never touch it.
async function quietBranch(code: string) {
  const id = (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [A.tenantId, code])).rows[0].id as string;
  await as(OWN, (db) => setHours(db, id, [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "09:00", closes: "20:00" }))));
  await as(OWN, (db) => upsertRoom(db, id, { name: `Konsul ${code}`, kind: "consultation" }));
  await as(OWN, (db) => setServices(db, id, [consult.itemId]));
  return id;
}

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
let OWN: P; let AP: P; let FH: P; let MGR: P; let FO: P; let FO2: P; let CS: P; let BC: P; let DOC: P; let DOC2: P; let NUR: P; let FIN: P; let MK: P;
let consult: { itemId: string; versionId: string }; // doctor + consultation room, no device (scenario PR-6)
let laser: { itemId: string; versionId: string }; // doctor + treatment room + laser (scenario PR-88)
let D1: string; // a weekday next week (all in the future)
let roomC1: string; let roomT1: string; let laserDev: string; let roomC2: string;

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
  owner = new pg.Pool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); AP = await person(A, "admin_pusat"); FH = await person(A, "facility_head", A.b1);
  MGR = await person(A, "manager", A.b1); FO = await person(A, "fo_cashier", A.b1); FO2 = await person(A, "fo_cashier", A.b2); CS = await person(A, "central_cs");
  BC = await person(A, "bc", A.b1); DOC = await person(A, "doctor", A.b1, A.b2); DOC2 = await person(A, "doctor", A.b1); NUR = await person(A, "nurse", A.b1);
  FIN = await person(A, "finance"); MK = await person(A, "marketing");
  const open = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "09:00", closes: "20:00" }));
  for (const b of [A.b1, A.b2]) await as(OWN, (db) => setHours(db, b, open));
  roomC1 = await as(OWN, (db) => upsertRoom(db, A.b1, { name: "Konsul 1", kind: "consultation" }));
  roomT1 = await as(OWN, (db) => upsertRoom(db, A.b1, { name: "Tindakan 1", kind: "treatment" }));
  laserDev = await as(OWN, (db) => upsertDevice(db, A.b1, { type: "laser", label: "Laser 1" }));
  roomC2 = await as(OWN, (db) => upsertRoom(db, A.b2, { name: "Konsul B2", kind: "consultation" }));
  await as(OWN, (db) => upsertRoom(db, A.b2, { name: "Tindakan B2", kind: "treatment" })); // B2 has no laser
  consult = await service("KONSUL", { resources: [{ kind: "room", code: "consultation" }] });
  laser = await service("LASER", { category: "laser_non_ablative", treatment_min: 45, resources: [{ kind: "room", code: "treatment" }, { kind: "device", code: "laser" }] });
  for (const b of [A.b1, A.b2]) await as(OWN, (db) => setServices(db, b, [consult.itemId, laser.itemId]));
  D1 = localDay(8);
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

describe("Done-when", () => {
  it("scenario PR-6: a doctor + room service booked from source ig-ad at B2 reserves only doctor and room; source, branch and version stored", async () => {
    const pt = await patient(A);
    const s = await as(CS, (db) => slots(db, { branchId: A.b2, versionId: consult.versionId, date: D1 }));
    expect(s.length).toBeGreaterThan(0);
    expect(s[0]).toMatchObject({ staffId: DOC.staffId, rooms: [roomC2], devices: [] });
    expect(s[0].endsAt.getTime() - s[0].startsAt.getTime()).toBe(50 * 60_000); // 10 + 30 + 10
    const b = await as(CS, (db) => book(db, key(), { branchId: A.b2, patientId: pt, versionId: consult.versionId, startsAt: at(D1, "10:00"), channel: "whatsapp", source: "ig-ad" }));
    expect(b).toMatchObject({ state: "booked", staffId: DOC.staffId, rooms: [roomC2], devices: [] });
    const ap = (await h.admin.query(`select branch_id, source, catalog_version_id, channel, state from appointments where id = $1`, [b.appointmentId])).rows[0];
    expect(ap).toEqual({ branch_id: A.b2, source: "ig-ad", catalog_version_id: consult.versionId, channel: "whatsapp", state: "booked" });
    const res = (await h.admin.query(`select kind, resource_id from resource_reservations where appointment_id = $1 order by kind`, [b.appointmentId])).rows;
    expect(res).toEqual([{ kind: "room", resource_id: roomC2 }, { kind: "staff", resource_id: DOC.staffId }]);
    expect((await h.admin.query(`select referenced_at is not null as r from catalog_versions where id = $1`, [consult.versionId])).rows[0].r).toBe(true);
  });

  it("scenario PR-88: a service needing a laser has slots at B1 and none at B2 (no laser there)", async () => {
    expect((await as(CS, (db) => slots(db, { branchId: A.b1, versionId: laser.versionId, date: D1 }))).length).toBeGreaterThan(0);
    expect(await as(CS, (db) => slots(db, { branchId: A.b2, versionId: laser.versionId, date: D1 }))).toEqual([]);
    const pt = await patient(A);
    expect(await reason(as(CS, (db) => book(db, key(), { branchId: A.b2, patientId: pt, versionId: laser.versionId, startsAt: at(D1, "11:00"), channel: "phone" })))).toBe("ERR_VERSION_CONFLICT:slot_taken");
    // An inactive device counts as missing.
    await as(OWN, (db) => setDeviceActiveSafe(db, laserDev, false));
    expect(await as(CS, (db) => slots(db, { branchId: A.b1, versionId: laser.versionId, date: D1 }))).toEqual([]);
    await as(OWN, (db) => setDeviceActiveSafe(db, laserDev, true));
  });

  it("the slot half of scenario PR-2: slots only inside branch hours, none on a closure date or in a closure range", async () => {
    const all = await as(CS, (db) => slots(db, { branchId: A.b1, versionId: consult.versionId, date: D1 }));
    // The doctors' shifts run 07:00-22:00 that day, wider than the branch hours: the hours decide.
    await as(OWN, (db) => setWeek(db, A.b1, monday(D1), [DOC2.staffId], fullWeek(DOC2.staffId, D1, [{ starts: "07:00", ends: "22:00", kind: "work" }])));
    const wide = await as(CS, (db) => slots(db, { branchId: A.b1, versionId: consult.versionId, date: D1, staffId: DOC2.staffId }));
    expect(hhmm(wide[0].startsAt)).toBe("09:00");
    expect(wide.every((x) => hhmm(x.endsAt) <= "20:00")).toBe(true);
    expect(hhmm(all[0].startsAt)).toBe("09:00");
    expect(hhmm(all[all.length - 1].endsAt) <= "20:00").toBe(true);
    expect(all.every((x) => x.startsAt.getUTCMinutes() % 15 === 0)).toBe(true);
    const D2 = localDay(9);
    await as(OWN, (db) => addClosure(db, A.b1, { date: D2, reason: "Libur" }));
    expect(await as(CS, (db) => slots(db, { branchId: A.b1, versionId: consult.versionId, date: D2 }))).toEqual([]);
    const D3 = localDay(10);
    await as(OWN, (db) => addClosure(db, A.b1, { date: D3, from: "12:00", until: "13:00", reason: "Rapat" }));
    const s3 = await as(CS, (db) => slots(db, { branchId: A.b1, versionId: consult.versionId, date: D3 }));
    expect(s3.some((x) => x.startsAt < at(D3, "13:00") && x.endsAt > at(D3, "12:00"))).toBe(false);
    expect(s3.length).toBeGreaterThan(0);
  });

  it("the full scenario PR-48: a doctor on leave on a date has no slot that date", async () => {
    const D4 = localDay(11);
    expect((await as(CS, (db) => slots(db, { branchId: A.b1, versionId: consult.versionId, date: D4, staffId: DOC2.staffId }))).length).toBeGreaterThan(0);
    await as(MGR, (db) => addLeave(db, { branchId: A.b1, staffId: DOC2.staffId, kind: "leave", from: D4, to: D4, reason: "Cuti" }));
    expect(await as(CS, (db) => slots(db, { branchId: A.b1, versionId: consult.versionId, date: D4, staffId: DOC2.staffId }))).toEqual([]);
    const pt = await patient(A);
    expect(await reason(as(CS, (db) => book(db, key(), { branchId: A.b1, patientId: pt, versionId: consult.versionId, startsAt: at(D4, "10:00"), staffId: DOC2.staffId, channel: "phone" })))).toBe("ERR_VERSION_CONFLICT:slot_taken");
  });

  it("overlapping reservations are refused by the exclusion constraint: two concurrent bookings of one doctor, and a direct insert", async () => {
    const [p1, p2] = [await patient(A), await patient(A)];
    const D5 = localDay(12);
    const one = (p: P, pt: string) => as(p, (db) => book(db, key(), { branchId: A.b1, patientId: pt, versionId: consult.versionId, startsAt: at(D5, "15:00"), staffId: DOC2.staffId, channel: "phone" })).then(() => "ok", (e) => (e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason}` : `raw:${e.message}`));
    const r = await Promise.all([one(FO, p1), one(CS, p2)]);
    expect(r.sort()).toEqual(["ERR_VERSION_CONFLICT:slot_taken", "ok"]);
    // Directly: a second appointment (guards off for the fixture) holding the same room at the same time
    // is refused by the exclusion constraint itself.
    const ap = (await h.admin.query(`select id, branch_id, starts_at, ends_at from appointments where performer_staff_id = $1 and starts_at = $2`, [DOC2.staffId, at(D5, "15:00")])).rows[0];
    const room = (await h.admin.query(`select resource_id from resource_reservations where appointment_id = $1 and kind = 'room'`, [ap.id])).rows[0].resource_id;
    await h.admin.query(`alter table appointments disable trigger appointments_guard`);
    await h.admin.query(`alter table resource_reservations disable trigger resource_reservations_guard`);
    try {
      const pt4 = await patient(A);
      const twin = (await h.admin.query(
        `insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state, channel, created_by, created_as)
         values ($1, $2, $3, $4, $5, $6, $7, 'booked', 'phone', $5, 'central_cs') returning id`,
        [A.tenantId, ap.branch_id, pt4, consult.versionId, DOC.staffId, ap.starts_at, ap.ends_at],
      )).rows[0].id;
      await expect(h.admin.query(
        `insert into resource_reservations (tenant_id, branch_id, appointment_id, kind, resource_id, starts_at, ends_at) values ($1, $2, $3, 'room', $4, $5, $6)`,
        [A.tenantId, ap.branch_id, twin, room, ap.starts_at, ap.ends_at],
      )).rejects.toThrow(/resource_reservations_no_overlap/);
    } finally {
      await h.admin.query(`alter table appointments enable always trigger appointments_guard`);
      await h.admin.query(`alter table resource_reservations enable always trigger resource_reservations_guard`);
    }
    // The same doctor at another branch at the same time: the constraint refuses it too (no branch in its key).
    await h.admin.query(`alter table appointments disable trigger appointments_guard`);
    await h.admin.query(`alter table resource_reservations disable trigger resource_reservations_guard`);
    try {
      const pt3 = await patient(A);
      const other = (await h.admin.query(
        `insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state, channel, created_by, created_as)
         values ($1, $2, $3, $4, $5, $6, $7, 'booked', 'phone', $5, 'central_cs') returning id`,
        [A.tenantId, A.b2, pt3, consult.versionId, DOC2.staffId, ap.starts_at, ap.ends_at],
      )).rows[0].id;
      await expect(h.admin.query(
        `insert into resource_reservations (tenant_id, branch_id, appointment_id, kind, resource_id, starts_at, ends_at) values ($1, $2, $3, 'staff', $4, $5, $6)`,
        [A.tenantId, A.b2, other, DOC2.staffId, ap.starts_at, ap.ends_at],
      )).rejects.toThrow(/resource_reservations_no_overlap/);
    } finally {
      await h.admin.query(`alter table appointments enable always trigger appointments_guard`);
      await h.admin.query(`alter table resource_reservations enable always trigger resource_reservations_guard`);
    }
    const c = (await h.admin.query(`select conname, contype from pg_constraint where conname = 'resource_reservations_no_overlap'`)).rows[0];
    expect(c).toEqual({ conname: "resource_reservations_no_overlap", contype: "x" });
  });
});

// setDeviceActive lives in the branches module; a thin alias keeps the imports honest.
async function setDeviceActiveSafe(db: pg.PoolClient, id: string, active: boolean) {
  const { setDeviceActive } = await import("../../src/modules/org/branches/branches");
  await setDeviceActive(db, id, active);
}

describe("resources and eligibility", () => {
  it("a doctor is reserved across branches: booked at B2, not offered at B1 at the same time", async () => {
    const pt = await patient(A);
    const D6 = localDay(13);
    const bx = await quietBranch("KX1");
    const by = await quietBranch("KX2");
    const DOC = await person(A, "doctor", bx, by);
    // DOC works at B2 in the morning and at B1 in the afternoon that day.
    await as(OWN, (db) => setWeek(db, by, monday(D6), [DOC.staffId], [{ staffId: DOC.staffId, date: D6, starts: "09:00", ends: "12:00", kind: "work" }]));
    await as(OWN, (db) => setWeek(db, bx, monday(D6), [DOC.staffId], [{ staffId: DOC.staffId, date: D6, starts: "13:00", ends: "18:00", kind: "work" }]));
    expect((await as(CS, (db) => slots(db, { branchId: bx, versionId: consult.versionId, date: D6, staffId: DOC.staffId }))).some((x) => hhmm(x.startsAt) === "14:00")).toBe(true);
    // A reservation at B2 at 14:00 (inserted with the guard satisfied) blocks DOC at B1 at that time.
    const ap = await as(CS, (db) => book(db, key(), { branchId: by, patientId: pt, versionId: consult.versionId, startsAt: at(D6, "09:00"), staffId: DOC.staffId, channel: "phone" }));
    void ap;
    await h.admin.query(`alter table appointments disable trigger appointments_guard`);
    await h.admin.query(`alter table resource_reservations disable trigger resource_reservations_guard`);
    const ghost = (await h.admin.query(
      `insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state, channel, created_by, created_as)
       values ($1, $2, $3, $4, $5, $6, $7, 'booked', 'phone', $5, 'central_cs') returning id`,
      [A.tenantId, by, pt, consult.versionId, DOC.staffId, at(D6, "14:00"), at(D6, "14:50")],
    )).rows[0].id;
    await h.admin.query(`insert into resource_reservations (tenant_id, branch_id, appointment_id, kind, resource_id, starts_at, ends_at) values ($1, $2, $3, 'staff', $4, $5, $6)`,
      [A.tenantId, by, ghost, DOC.staffId, at(D6, "14:00"), at(D6, "14:50")]);
    await h.admin.query(`alter table appointments enable always trigger appointments_guard`);
    await h.admin.query(`alter table resource_reservations enable always trigger resource_reservations_guard`);
    const b1 = await as(CS, (db) => slots(db, { branchId: bx, versionId: consult.versionId, date: D6, staffId: DOC.staffId }));
    expect(b1.some((x) => x.startsAt < at(D6, "14:50") && x.endsAt > at(D6, "14:00"))).toBe(false);
    expect(b1.some((x) => hhmm(x.startsAt) === "15:00")).toBe(true);
  });

  it("eligibility per branch: a role row needs that role at the branch; a named assists row demotes; a nurse cannot perform a doctor service", async () => {
    const D7 = localDay(14);
    // NUR is a nurse: never offered for the doctor-only consultation.
    expect(await as(CS, (db) => slots(db, { branchId: A.b1, versionId: consult.versionId, date: D7, staffId: NUR.staffId }))).toEqual([]);
    // A service performed by nurses (role row) and DOC2 demoted to assists by a named row.
    const nurseSvc = await service("NURSE", { category: "facial", eligibility: [{ role: "nurse", mode: "performs" }, { role: "doctor", mode: "performs" }, { staff_id: DOC2.staffId, mode: "assists" }], resources: [] });
    await as(OWN, (db) => setServices(db, A.b1, [consult.itemId, laser.itemId, nurseSvc.itemId]));
    expect((await as(CS, (db) => slots(db, { branchId: A.b1, versionId: nurseSvc.versionId, date: D7, staffId: NUR.staffId }))).length).toBeGreaterThan(0);
    expect(await as(CS, (db) => slots(db, { branchId: A.b1, versionId: nurseSvc.versionId, date: D7, staffId: DOC2.staffId }))).toEqual([]);
    // A role row with mode assists makes nobody of that role a performer.
    const assistSvc = await service("ASSIST", { category: "facial", eligibility: [{ role: "doctor", mode: "performs" }, { role: "nurse", mode: "assists" }], resources: [] });
    await as(OWN, (db) => setServices(db, A.b1, [consult.itemId, laser.itemId, nurseSvc.itemId, assistSvc.itemId]));
    expect(await as(CS, (db) => slots(db, { branchId: A.b1, versionId: assistSvc.versionId, date: D7, staffId: NUR.staffId }))).toEqual([]);
    expect((await as(CS, (db) => slots(db, { branchId: A.b1, versionId: assistSvc.versionId, date: D7, staffId: DOC2.staffId }))).length).toBeGreaterThan(0);
  });

  it("a service needing two device types and two room kinds reserves one of each (impl review r1 P1)", async () => {
    const D7b = localDay(14);
    const rf = await as(OWN, (db) => upsertDevice(db, A.b1, { type: "rf", label: "RF 1" }));
    const combo = await service("KOMBO", { category: "laser_non_ablative", treatment_min: 30, resources: [{ kind: "room", code: "treatment" }, { kind: "room", code: "consultation" }, { kind: "device", code: "laser" }, { kind: "device", code: "rf" }] });
    await as(OWN, (db) => setServices(db, A.b1, [consult.itemId, laser.itemId, combo.itemId]));
    const pt = await patient(A);
    const b = await as(FO, (db) => book(db, key(), { branchId: A.b1, patientId: pt, versionId: combo.versionId, startsAt: at(D7b, "18:00"), channel: "phone" }));
    expect([...b.devices].sort()).toEqual([laserDev, rf].sort());
    expect([...b.rooms].sort()).toEqual([roomC1, roomT1].sort());
    expect((await h.admin.query(`select count(*)::int n from resource_reservations where appointment_id = $1`, [b.appointmentId])).rows[0].n).toBe(5);
  });

  it("only services offered at the branch and active versions; rooms of the branch only; an inactive room is skipped", async () => {
    const D8 = localDay(15);
    const other = await service("BELUM", { resources: [] });
    expect(await as(CS, (db) => slots(db, { branchId: A.b1, versionId: other.versionId, date: D8 }))).toEqual([]); // not offered
    await as(OWN, (db) => setRoomActive(db, roomC1, false));
    expect(await as(CS, (db) => slots(db, { branchId: A.b1, versionId: consult.versionId, date: D8 }))).toEqual([]);
    await as(OWN, (db) => setRoomActive(db, roomC1, true));
    expect((await as(CS, (db) => slots(db, { branchId: A.b1, versionId: consult.versionId, date: D8 })))[0].rooms).toEqual([roomC1]);
    expect(await code(as(CS, (db) => slots(db, { branchId: A.b1, versionId: crypto.randomUUID(), date: D8 })))).toBe("ERR_NOT_FOUND");
  });
});

describe("performer choice", () => {
  it("the least-loaded performer that branch-local day is picked; load on another day does not count (impl review r1 P2)", async () => {
    // A fresh branch with two doctors (ids ordered) on a quiet day, each with a full shift.
    const b3 = (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'K3', 'K3', 'Asia/Jakarta') returning id`, [A.tenantId])).rows[0].id as string;
    await as(OWN, (db) => setHours(db, b3, [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "09:00", closes: "20:00" }))));
    await as(OWN, (db) => upsertRoom(db, b3, { name: "Konsul K3", kind: "consultation" }));
    await as(OWN, (db) => setServices(db, b3, [consult.itemId]));
    const [x, y] = [await person(A, "doctor", b3), await person(A, "doctor", b3)].sort((p, q) => (p.staffId < q.staffId ? -1 : 1));
    const day = localDay(25);
    const prev = localDay(24);
    const fo3 = await person(A, "fo_cashier", b3);
    const rows = [prev, day].flatMap((d) => [x, y].map((p) => ({ staffId: p.staffId, date: d, starts: "09:00", ends: "20:00", kind: "work" as const })));
    for (const wk of [...new Set([prev, day].map(monday))]) {
      await as(OWN, (db) => setWeek(db, b3, wk, [x.staffId, y.staffId], rows.filter((r) => monday(r.date) === wk)));
    }
    // Load x on the previous local day (late evening, just before midnight of "day" in UTC terms too).
    for (const t of ["18:00", "19:00"]) await as(fo3, async (db) => book(db, key(), { branchId: b3, patientId: await patient(A), versionId: consult.versionId, startsAt: at(prev, t), staffId: x.staffId, channel: "phone" }));
    // That day's first pick is x (lower id), not y: yesterday's load does not count.
    expect((await as(fo3, (db) => slots(db, { branchId: b3, versionId: consult.versionId, date: day }))).find((s) => hhmm(s.startsAt) === "09:00")?.staffId).toBe(x.staffId);
    // Load x that same day: the next free slot goes to y.
    await as(fo3, async (db) => book(db, key(), { branchId: b3, patientId: await patient(A), versionId: consult.versionId, startsAt: at(day, "15:00"), staffId: x.staffId, channel: "phone" }));
    expect((await as(fo3, (db) => slots(db, { branchId: b3, versionId: consult.versionId, date: day }))).find((s) => hhmm(s.startsAt) === "09:00")?.staffId).toBe(y.staffId);
  });
});

describe("holds", () => {
  it("a hold blocks the slot until it expires; a live hold is confirmed; an expired hold cannot be and no longer blocks", async () => {
    const [p1, p2, p3] = [await patient(A), await patient(A), await patient(A)];
    const D9 = localDay(16);
    const held = await as(FO, (db) => book(db, key(), { branchId: A.b1, patientId: p1, versionId: consult.versionId, startsAt: at(D9, "10:00"), staffId: DOC2.staffId, channel: "phone", hold: true }));
    expect(held.state).toBe("held");
    expect(held.holdUntil!.getTime() - Date.now()).toBeGreaterThan(9 * 60_000); // SET-17 default 10 min
    expect(await reason(as(FO, (db) => book(db, key(), { branchId: A.b1, patientId: p2, versionId: consult.versionId, startsAt: at(D9, "10:00"), staffId: DOC2.staffId, channel: "phone" })))).toBe("ERR_VERSION_CONFLICT:slot_taken");
    expect((await h.admin.query(`select count(*)::int n from domain_events where aggregate_id = $1`, [held.appointmentId])).rows[0].n).toBe(0);
    expect(await code(as(FO, (db) => confirm(db, key(), held.appointmentId)))).toBe("ok");
    expect((await h.admin.query(`select type from domain_events where aggregate_id = $1`, [held.appointmentId])).rows.map((r) => r.type)).toEqual(["AppointmentBooked"]);
    expect(await reason(as(FO, (db) => confirm(db, key(), held.appointmentId)))).toBe("ERR_VERSION_CONFLICT:already_booked");
    // A second hold, expired by hand.
    const h2 = await as(FO, (db) => book(db, key(), { branchId: A.b1, patientId: p2, versionId: consult.versionId, startsAt: at(D9, "13:00"), staffId: DOC2.staffId, channel: "phone", hold: true }));
    await h.admin.query(`alter table appointments disable trigger appointments_guard`);
    await h.admin.query(`update appointments set hold_until = now() - interval '1 minute' where id = $1`, [h2.appointmentId]);
    await h.admin.query(`alter table appointments enable always trigger appointments_guard`);
    expect(await reason(as(FO, (db) => confirm(db, key(), h2.appointmentId)))).toBe("ERR_VERSION_CONFLICT:hold_expired");
    expect((await as(FO, (db) => slots(db, { branchId: A.b1, versionId: consult.versionId, date: D9, staffId: DOC2.staffId }))).some((x) => hhmm(x.startsAt) === "13:00")).toBe(true);
    expect(await code(as(FO, (db) => book(db, key(), { branchId: A.b1, patientId: p3, versionId: consult.versionId, startsAt: at(D9, "13:00"), staffId: DOC2.staffId, channel: "phone" })))).toBe("ok");
    expect((await h.admin.query(`select bool_or(active) a from resource_reservations where appointment_id = $1`, [h2.appointmentId])).rows[0].a).toBe(false);
  });
});

describe("the UX-33 appointment conflict in the roster writers", () => {
  it("a shift change or leave that would leave a live appointment unserved is refused; an expired hold does not block", async () => {
    const pt = await patient(A);
    const D10 = localDay(17);
    const week = monday(D10);
    const bq = await quietBranch("KQ1");
    const doc = await person(A, "doctor", bq);
    const mgr = await person(A, "manager", bq);
    const nur = await person(A, "nurse", bq);
    const fo = await person(A, "fo_cashier", bq);
    const DOC2 = doc;
    await as(OWN, (db) => setWeek(db, bq, week, [doc.staffId, nur.staffId], [...fullWeek(doc.staffId, D10, [{ starts: "09:00", ends: "20:00", kind: "work" }]), ...fullWeek(nur.staffId, D10, [{ starts: "09:00", ends: "20:00", kind: "work" }])]));
    const FO = fo;
    const MGR = mgr;
    const NUR = nur;
    const A_b1 = bq;
    await as(FO, (db) => book(db, key(), { branchId: A_b1, patientId: pt, versionId: consult.versionId, startsAt: at(D10, "16:00"), staffId: DOC2.staffId, channel: "phone" }));
    expect(await reason(as(OWN, (db) => setWeek(db, A_b1, week, [DOC2.staffId], fullWeek(DOC2.staffId, D10, [{ starts: "09:00", ends: "15:00", kind: "work" }]))))).toBe("ERR_VERSION_CONFLICT:appointment_conflict");
    expect(await reason(as(OWN, (db) => setWeek(db, A_b1, week, [DOC2.staffId], fullWeek(DOC2.staffId, D10, [{ starts: "09:00", ends: "20:00", kind: "work" }, { starts: "16:00", ends: "17:00", kind: "break" }]))))).toBe("ERR_VERSION_CONFLICT:appointment_conflict");
    expect(await code(as(OWN, (db) => setWeek(db, A_b1, week, [DOC2.staffId], fullWeek(DOC2.staffId, D10, [{ starts: "08:00", ends: "20:00", kind: "work" }]))))).toBe("ok");
    expect(await reason(as(MGR, (db) => addLeave(db, { branchId: A_b1, staffId: DOC2.staffId, kind: "sick", from: D10, to: D10, reason: "Sakit" })))).toBe("ERR_VERSION_CONFLICT:appointment_conflict");
    // An expired hold of DOC2 on another day does not block shortening that day.
    const p9 = await patient(A);
    const D10b = weekDays(week).find((d) => d !== D10 && d > localDay(0))!;
    const eh = await as(FO, (db) => book(db, key(), { branchId: A_b1, patientId: p9, versionId: consult.versionId, startsAt: at(D10b, "18:00"), staffId: DOC2.staffId, channel: "phone", hold: true }));
    await h.admin.query(`alter table appointments disable trigger appointments_guard`);
    await h.admin.query(`update appointments set hold_until = now() - interval '1 minute' where id = $1`, [eh.appointmentId]);
    await h.admin.query(`alter table appointments enable always trigger appointments_guard`);
    const rows = fullWeek(DOC2.staffId, D10, [{ starts: "08:00", ends: "20:00", kind: "work" }]).map((r) => (r.date === D10b ? { ...r, ends: "12:00" } : r));
    expect(await code(as(OWN, (db) => setWeek(db, A_b1, week, [DOC2.staffId], rows)))).toBe("ok");
    // Another staff member's change is not blocked by this appointment.
    expect(await code(as(MGR, (db) => addLeave(db, { branchId: A_b1, staffId: NUR.staffId, kind: "leave", from: D10, to: D10, reason: "Cuti" })))).toBe("ok");
  });
});

describe("rules, roles, idempotency, events", () => {
  it("one patient, one appointment at a time; the start on the 15-minute grid, not in the past; channel and source formats", async () => {
    const pt = await patient(A);
    const D11 = localDay(18);
    await as(FO, (db) => book(db, key(), { branchId: A.b1, patientId: pt, versionId: consult.versionId, startsAt: at(D11, "10:00"), channel: "walk_in" }));
    expect(await reason(as(FO, (db) => book(db, key(), { branchId: A.b1, patientId: pt, versionId: consult.versionId, startsAt: at(D11, "10:30"), channel: "walk_in" })))).toBe("ERR_VERSION_CONFLICT:patient_overlap");
    const p2 = await patient(A);
    expect(await reason(as(FO, (db) => book(db, key(), { branchId: A.b1, patientId: p2, versionId: consult.versionId, startsAt: at(D11, "10:10"), channel: "walk_in" })))).toBe("ERR_INVALID_INPUT:start");
    // A start in the past on the 15-minute grid (two hours ago, rounded down).
    const past = new Date(Math.floor((Date.now() - 2 * 3_600_000) / 900_000) * 900_000);
    expect(await reason(as(FO, (db) => book(db, key(), { branchId: A.b1, patientId: p2, versionId: consult.versionId, startsAt: past, channel: "walk_in" })))).toBe("ERR_INVALID_INPUT:start");
    // Today's slots never start in the past (hours 00:00-24:00 at a fresh branch, doctor on all day).
    const today = localDay(0);
    await as(OWN, (db) => setHours(db, A.b2, [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "00:00", closes: "24:00" }))));
    await as(OWN, (db) => setWeek(db, A.b2, monday(today), [DOC.staffId], [{ staffId: DOC.staffId, date: today, starts: "00:00", ends: "24:00", kind: "work" }]));
    const now = await as(CS, (db) => slots(db, { branchId: A.b2, versionId: consult.versionId, date: today }));
    expect(now.every((x) => x.startsAt.getTime() >= Date.now() - 60_000)).toBe(true);
    await as(OWN, (db) => setHours(db, A.b2, [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "09:00", closes: "20:00" }))));
    expect(await reason(as(FO, (db) => book(db, key(), { branchId: A.b1, patientId: p2, versionId: consult.versionId, startsAt: at(D11, "12:00"), channel: "fax" as never })))).toBe("ERR_INVALID_INPUT:channel");
    expect(await reason(as(FO, (db) => book(db, key(), { branchId: A.b1, patientId: p2, versionId: consult.versionId, startsAt: at(D11, "12:00"), channel: "phone", source: "IG Ad!" })))).toBe("ERR_INVALID_INPUT:source");
    // Online: only online-bookable services (the consultation is not).
    expect(await reason(as(FO, (db) => book(db, key(), { branchId: A.b1, patientId: p2, versionId: consult.versionId, startsAt: at(D11, "12:00"), channel: "online" })))).toBe("ERR_INVALID_INPUT:online_window");
  });

  it("writers: Owner, Admin Pusat, Manager, FO, Central CS; readers add BC and clinicians; a branch outside the role's set is not found", async () => {
    const D12 = localDay(19);
    for (const p of [OWN, AP, MGR, FO, CS]) {
      const pt = await patient(A);
      expect(await code(as(p, (db) => book(db, key(), { branchId: A.b1, patientId: pt, versionId: consult.versionId, startsAt: at(D12, ["09:00", "10:00", "11:00", "13:00", "14:00"][[OWN, AP, MGR, FO, CS].indexOf(p)]), channel: "staff" }))), p.role).toBe("ok");
    }
    const pt = await patient(A);
    for (const p of [BC, DOC2, NUR, FIN, MK]) {
      expect(await code(as(p, (db) => book(db, key(), { branchId: A.b1, patientId: pt, versionId: consult.versionId, startsAt: at(D12, "16:00"), channel: "staff" }))), p.role).toBe("ERR_FORBIDDEN");
    }
    for (const p of [BC, DOC2, NUR]) expect((await as(p, (db) => slots(db, { branchId: A.b1, versionId: consult.versionId, date: D12 }))).length, p.role).toBeGreaterThanOrEqual(0);
    for (const p of [FIN, MK]) expect(await code(as(p, (db) => slots(db, { branchId: A.b1, versionId: consult.versionId, date: D12 }))), p.role).toBe("ERR_FORBIDDEN");
    for (const p of [FIN, MK]) expect(Number((await as(p, (db) => db.query(`select count(*) from appointments`))).rows[0].count), p.role).toBe(0);
    for (const p of [FO, CS, BC]) expect(Number((await as(p, (db) => db.query(`select count(*) from appointments`))).rows[0].count), p.role).toBeGreaterThan(0);
    // FO2 works at B2: B1 is not found for them.
    expect(await code(as(FO2, (db) => slots(db, { branchId: A.b1, versionId: consult.versionId, date: D12 })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(FO2, (db) => book(db, key(), { branchId: A.b1, patientId: pt, versionId: consult.versionId, startsAt: at(D12, "17:00"), channel: "staff" })))).toBe("ERR_NOT_FOUND");
  });

  it("lifecycle: a suspended tenant takes no new bookings", async () => {
    const S = await tenant();
    const sOwn = await person(S, "owner");
    await h.admin.query(`update tenants_registry set lifecycle_state = 'suspended' where id = $1`, [S.tenantId]);
    expect(await code(as(sOwn, (db) => book(db, key(), { branchId: S.b1, patientId: crypto.randomUUID(), versionId: crypto.randomUUID(), startsAt: at(localDay(20), "10:00"), channel: "staff" })))).toBe("ERR_TENANT_SUSPENDED");
  });

  it("the same key replays the booking; a different body conflicts; a refusal leaves no record", async () => {
    const pt = await patient(A);
    const D13 = localDay(21);
    const k = key();
    const i = { branchId: A.b1, patientId: pt, versionId: consult.versionId, startsAt: at(D13, "10:00"), channel: "phone" as const };
    const a = await as(FO, (db) => book(db, k, i));
    const b = await as(FO, (db) => book(db, k, i));
    expect(b).toMatchObject({ appointmentId: a.appointmentId, replayed: true });
    expect(await code(as(FO, (db) => book(db, k, { ...i, channel: "walk_in" })))).toBe("ERR_IDEMPOTENCY_CONFLICT");
    const k2 = key();
    expect(await as(FO, (db) => code(book(db, k2, { ...i, patientId: crypto.randomUUID() })))).toBe("ERR_NOT_FOUND");
    expect(Number((await h.admin.query(`select count(*) from idempotency_records where key = $1`, [k2])).rows[0].count)).toBe(0);
  });

  it("a null hold at the SQL boundary books and emits the event (impl review r1 P2); a sub-second start is off the grid (P3)", async () => {
    const pt = await patient(A);
    const D14 = localDay(22);
    const r = (await as(FO, (db) => db.query(`select booking_create($1, $2, $3, $4, null, 'phone', null, null, null, null) as r`, [A.b1, pt, consult.versionId, at(D14, "15:00")]))).rows[0].r;
    expect(r.state).toBe("booked");
    expect((await h.admin.query(`select type from domain_events where aggregate_id = $1`, [r.appointment_id])).rows.map((x) => x.type)).toEqual(["AppointmentBooked"]);
    const p2 = await patient(A);
    expect(await reason(as(FO, (db) => book(db, key(), { branchId: A.b1, patientId: p2, versionId: consult.versionId, startsAt: new Date(at(D14, "16:00").getTime() + 400), channel: "phone" })))).toBe("ERR_INVALID_INPUT:start");
  });

  it("events and audit carry ids and codes only: no source, campaign or note", async () => {
    const pt = await patient(A);
    const b = await as(FO, (db) => book(db, key(), { branchId: A.b1, patientId: pt, versionId: consult.versionId, startsAt: at(localDay(22), "10:00"), channel: "phone", source: "ig-ad", campaign: "promo-x", note: "Catatan rahasia" }));
    const ev = (await h.admin.query(`select type, payload from domain_events where aggregate_id = $1`, [b.appointmentId])).rows;
    expect(ev.map((e) => e.type)).toEqual(["AppointmentBooked"]);
    expect(Object.keys(ev[0].payload).sort()).toEqual(["appointment_id", "branch_id", "catalog_version_id", "channel", "patient_id", "performer_staff_id"]);
    const all = JSON.stringify(ev);
    for (const s of ["ig-ad", "promo-x", "rahasia"]) expect(all).not.toContain(s);
    const au = (await h.admin.query(`select reason_code, reason from audit_events where object_id = $1`, [b.appointmentId])).rows;
    expect(au).toEqual([{ reason_code: "appointment_booked", reason: null }]);
  });

  it("guards: appointments and reservations are never deleted; only a hold is confirmed; reservations only released", async () => {
    const pt = await patient(A);
    const b = await as(FO, (db) => book(db, key(), { branchId: A.b1, patientId: pt, versionId: consult.versionId, startsAt: at(localDay(23), "10:00"), channel: "phone" }));
    await expect(h.admin.query(`delete from appointments where id = $1`, [b.appointmentId])).rejects.toThrow(/never deleted/);
    await expect(h.admin.query(`update appointments set starts_at = starts_at + interval '1 hour' where id = $1`, [b.appointmentId])).rejects.toThrow(/keeps its/);
    await expect(h.admin.query(`update appointments set state = 'held', hold_until = now() where id = $1`, [b.appointmentId])).rejects.toThrow(/only change/);
    await expect(h.admin.query(`delete from resource_reservations where appointment_id = $1`, [b.appointmentId])).rejects.toThrow(/never deleted/);
    await expect(h.admin.query(`update resource_reservations set resource_id = $2 where appointment_id = $1 and kind = 'room'`, [b.appointmentId, roomT1])).rejects.toThrow(/only released/);
    await expect(h.admin.query(`truncate appointments cascade`)).rejects.toThrow();
  });

  it("both tables carry an always-enabled truncate guard", async () => {
    const r = (await h.admin.query(`select c.relname, t.tgenabled from pg_trigger t join pg_class c on c.oid = t.tgrelid
                                      where c.relname in ('appointments','resource_reservations') and t.tgname like '%no_truncate'`)).rows
      .sort((x, y) => (x.relname < y.relname ? -1 : 1));
    expect(r).toEqual([{ relname: "appointments", tgenabled: "A" }, { relname: "resource_reservations", tgenabled: "A" }]);
  });

  it("vendor classes personal; branch-scoped; one operator policy each", async () => {
    const k = (await h.admin.query(`select table_name, support_class from support_object_kinds where table_name in ('public.appointments','public.resource_reservations')`)).rows
      .sort((x, y) => (x.table_name < y.table_name ? -1 : 1));
    expect(k).toEqual([{ table_name: "public.appointments", support_class: "personal" }, { table_name: "public.resource_reservations", support_class: "personal" }]);
    const pol = (await h.admin.query(`select tablename, count(*)::int n from pg_policies where tablename in ('appointments','resource_reservations') and 'clinic_operator' = any(roles) group by 1`)).rows;
    expect(pol.length).toBe(2);
    expect((await h.admin.query(`select bool_and(policy_kind = 'branch-scoped') ok from scope_map where table_name in ('public.appointments','public.resource_reservations')`)).rows[0].ok).toBe(true);
  });

  it("tenant B neither reads nor books against A's branches, patients or services", async () => {
    const bOwn = await person(B, "owner");
    const pt = await patient(A, "Rahasia A");
    await as(FO, (db) => book(db, key(), { branchId: A.b1, patientId: pt, versionId: consult.versionId, startsAt: at(localDay(24), "10:00"), channel: "phone" }));
    expect(Number((await as(bOwn, (db) => db.query(`select count(*) from appointments where tenant_id = $1`, [A.tenantId]))).rows[0].count)).toBe(0);
    expect(await code(as(bOwn, (db) => slots(db, { branchId: A.b1, versionId: consult.versionId, date: localDay(24) })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(bOwn, (db) => book(db, key(), { branchId: A.b1, patientId: pt, versionId: consult.versionId, startsAt: at(localDay(24), "11:00"), channel: "phone" })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(bOwn, (db) => book(db, key(), { branchId: B.b1, patientId: pt, versionId: consult.versionId, startsAt: at(localDay(24), "11:00"), channel: "phone" })))).toBe("ERR_NOT_FOUND");
  });
});
