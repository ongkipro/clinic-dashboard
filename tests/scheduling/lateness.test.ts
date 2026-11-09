// T-046 Done-when: scenario PR-8 (lateness default off: a new branch keeps a late patient's slot unless the
// branch enabled SET-15). Plus: with the rule on, release = no-show through the T-045 writer (slot freed,
// no money, no session), the minutes count, branch scope, repeat-safe, future and held never, roles.
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
import { book } from "../../src/modules/scheduling/booking/booking";
import { changeSetting } from "../../src/modules/settings/settings";
import { lateness, lateReleasable, releaseLate } from "../../src/modules/scheduling/lateness";
import { setWeek } from "../../src/modules/scheduling/rosters/rosters";
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
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Terlambat Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("K1"), b2: await br("K2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`lat${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Terlambat ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  const bs = TENANT_WIDE.includes(role) ? [] : branches.length ? branches : [t.b1];
  for (const b of bs) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: bs[0] };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>, branch?: string) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: branch ?? p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const key = () => crypto.randomUUID();
const localDay = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(Date.now() + days * 86_400_000));
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+07:00`);
const monday = (d: string) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
};

async function patient(t: T, name = "Pasien Booking"): Promise<string> {
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
     select $1, 'RM-' || lpad((count(*) + 1)::text, 6, '0'), $2, '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture sintetis', 'islam', 'Karyawan', 's1', 'kawin', $3,
            (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier' from patients where tenant_id = $1 returning id`,
    [t.tenantId, name, t.b1],
  )).rows[0].id as string;
}

let A: T;
let OWN: P; let FH: P; let MGR: P; let MGR2: P; let FO: P; let FO2: P; let DOC: P; let DOC2: P; let NUR: P; let FIN: P;
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
  owner = new pg.Pool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  OWN = await person(A, "owner"); FH = await person(A, "facility_head", A.b1);
  MGR = await person(A, "manager", A.b1); MGR2 = await person(A, "manager", A.b2); FO = await person(A, "fo_cashier", A.b1); FO2 = await person(A, "fo_cashier", A.b2);
  FIN = await person(A, "finance"); DOC = await person(A, "doctor", A.b1, A.b2); DOC2 = await person(A, "doctor", A.b1); NUR = await person(A, "nurse", A.b1);
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


describe("scenario PR-8: lateness default off", () => {
  it("a new branch, a patient 30 minutes late: the slot is not auto-released; nothing changes", async () => {
    const pt = await patient(A);
    const id = await pastAppointment(A, A.b1, DOC2.staffId, pt, 30);
    expect(await as(MGR, (db) => lateness(db, A.b1))).toBeNull();
    expect(await as(MGR, (db) => lateReleasable(db, A.b1))).toEqual([]);
    expect(await as(FO, (db) => releaseLate(db, A.b1))).toEqual([]);
    expect(await stateOf(id)).toMatchObject({ state: "booked" });
    expect(await activeRes(id)).toBeGreaterThan(0);
  });

  it("with the rule on (15 min) the late appointment is released: no-show, reservations freed, the slot bookable again, no money moves", async () => {
    const pt = await patient(A);
    const id = await pastAppointment(A, A.b2, DOC.staffId, pt, 30);
    await as(MGR2, (db) => changeSetting(db, { key: "SET-15", branchId: A.b2, value: 15, reason: "Aturan keterlambatan" }));
    expect(await as(MGR2, (db) => lateness(db, A.b2))).toBe(15);
    const moneyTables = (await h.admin.query(`select table_name from information_schema.tables where table_schema = 'public' and table_name ~ '(payment|invoice|deposit|balance|ledger_entr|session)'`)).rows.map((r) => r.table_name as string);
    const before = await Promise.all(moneyTables.map(async (t) => Number((await h.admin.query(`select count(*) from ${t}`)).rows[0].count)));
    expect(await as(FO2, (db) => releaseLate(db, A.b2))).toEqual([id]);
    expect(await stateOf(id)).toMatchObject({ state: "no_show", state_changed_by: FO2.staffId });
    expect(await activeRes(id)).toBe(0);
    const after = await Promise.all(moneyTables.map(async (t) => Number((await h.admin.query(`select count(*) from ${t}`)).rows[0].count)));
    expect(after).toEqual(before);
    // A repeated run releases nothing new and does not fail.
    expect(await as(FO2, (db) => releaseLate(db, A.b2))).toEqual([]);
    // Each release uses the key lateness:<id>: a second run racing the first (same appointment, its
    // claim already stored) replays instead of failing on its own work.
    expect(Number((await h.admin.query(`select count(*) from idempotency_records where key = $1`, [`lateness:${id}`])).rows[0].count)).toBe(1);
  });

  it("the minutes count: 45 minutes set, 30 minutes late is kept; confirmed appointments are released too; another branch's setting does not apply", async () => {
    await as(MGR, (db) => changeSetting(db, { key: "SET-15", branchId: A.b1, value: 45, reason: "Aturan keterlambatan" }));
    const [p1, p2, p3] = [await patient(A), await patient(A), await patient(A)];
    // Fresh performers: the fixture appointments of other tests occupy DOC/DOC2 at these times.
    const d4 = await person(A, "doctor", A.b1);
    const d5 = await person(A, "doctor", A.b1);
    const recent = await pastAppointment(A, A.b1, d4.staffId, p1, 30);
    const old = await pastAppointment(A, A.b1, d5.staffId, p2, 90);
    await h.admin.query(`alter table appointments disable trigger appointments_guard`);
    await h.admin.query(`update appointments set state = 'confirmed', state_changed_at = now(), state_changed_by = $2 where id = $1`, [old, FO.staffId]);
    await h.admin.query(`alter table appointments enable always trigger appointments_guard`);
    const released = await as(FO, (db) => releaseLate(db, A.b1));
    expect(released).toContain(old);
    expect(released).not.toContain(recent);
    expect((await stateOf(recent)).state).toBe("booked");
    // B2's 15 minutes never reach a B1 appointment: a fresh branch without the rule keeps a 90-minute-late one.
    const b3 = (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'L3', 'L3', 'Asia/Jakarta') returning id`, [A.tenantId])).rows[0].id as string;
    const fo3 = await person(A, "fo_cashier", b3);
    const doc3 = await person(A, "doctor", b3);
    const far = await pastAppointment(A, b3, doc3.staffId, p3, 90);
    expect(await as(fo3, (db) => releaseLate(db, b3))).toEqual([]);
    expect((await stateOf(far)).state).toBe("booked");
  });

  it("future and held appointments are never released; a role without the writer is refused", async () => {
    const pt = await patient(A);
    const future = await as(FO2, (db) => book(db, key(), { branchId: A.b2, patientId: pt, versionId: consult.versionId, startsAt: at(localDay(9), "13:00"), channel: "phone" }));
    expect(await as(FO2, (db) => lateReleasable(db, A.b2))).not.toContain(future.appointmentId);
    // A hold whose start passed long ago is not a booked appointment: never released by the rule.
    const ph = await patient(A);
    const dh = await person(A, "doctor", A.b2);
    const held = await pastAppointment(A, A.b2, dh.staffId, ph, 120);
    await h.admin.query(`alter table appointments disable trigger appointments_guard`);
    await h.admin.query(`update appointments set state = 'held', hold_until = now() + interval '10 minutes' where id = $1`, [held]);
    await h.admin.query(`alter table appointments enable always trigger appointments_guard`);
    expect(await as(FO2, (db) => lateReleasable(db, A.b2))).not.toContain(held);
    const p2 = await patient(A);
    const d6 = await person(A, "doctor", A.b2);
    const late = await pastAppointment(A, A.b2, d6.staffId, p2, 60);
    expect(await code(as(DOC, (db) => releaseLate(db, A.b2), A.b2))).toBe("ERR_FORBIDDEN");
    expect((await stateOf(late)).state).toBe("booked");
  });

  it("scope and roles apply whether the rule is on or off (review r1 P1-1)", async () => {
    // FO of B1 asks about B2 (rule on there): not found, never a silent "off".
    for (const fn of [lateness, lateReleasable, releaseLate] as ((db: pg.PoolClient, b: string) => Promise<unknown>)[]) {
      expect(await code(as(FO, (db) => fn(db, A.b2))), fn.name).toBe("ERR_NOT_FOUND");
      expect(await code(as(FO, (db) => fn(db, crypto.randomUUID()))), `${fn.name} unknown`).toBe("ERR_NOT_FOUND");
    }
    // Finance reads no calendar: forbidden even where the rule is off.
    const b4 = (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'L4', 'L4', 'Asia/Jakarta') returning id`, [A.tenantId])).rows[0].id as string;
    expect(await code(as(FIN, (db) => lateReleasable(db, b4)))).toBe("ERR_FORBIDDEN");
    // A doctor reads the calendar but may not release, even when nothing is late.
    expect(await code(as(DOC, (db) => releaseLate(db, A.b1), A.b1))).toBe("ERR_FORBIDDEN");
  });

  it("an appointment from yesterday evening is still released after midnight (review r1 P2-1)", async () => {
    const b5 = (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'L5', 'L5', 'Asia/Jakarta') returning id`, [A.tenantId])).rows[0].id as string;
    const fo5 = await person(A, "fo_cashier", b5);
    const doc5 = await person(A, "doctor", b5);
    const mgr5 = await person(A, "manager", b5);
    await as(mgr5, (db) => changeSetting(db, { key: "SET-15", branchId: b5, value: 15, reason: "Aturan keterlambatan" }));
    // Started 20 hours ago: yesterday in branch time whenever the suite runs before 20:00 WIB, today
    // otherwise; either way inside the yesterday-today window.
    const id = await pastAppointment(A, b5, doc5.staffId, await patient(A), 20 * 60);
    expect(await as(fo5, (db) => releaseLate(db, b5))).toEqual([id]);
  });

  it("production with go-live blockers refuses the release before anything changes (ARCH-10)", async () => {
    const pt = await patient(A);
    const d7 = await person(A, "doctor", A.b2);
    const id = await pastAppointment(A, A.b2, d7.staffId, pt, 60);
    process.env.DEPLOY_ENV = "production";
    try {
      await expect(as(FO2, (db) => releaseLate(db, A.b2))).rejects.toThrow(/go-live blocked/);
      // Refused even where nothing is late (the gate is the release's own, not only the writer's).
      const b6 = (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'L6', 'L6', 'Asia/Jakarta') returning id`, [A.tenantId])).rows[0].id as string;
      const fo6 = await person(A, "fo_cashier", b6);
      await expect(as(fo6, (db) => releaseLate(db, b6))).rejects.toThrow(/go-live blocked/);
    } finally {
      process.env.DEPLOY_ENV = "local";
    }
    expect((await stateOf(id)).state).toBe("booked");
  });
});

