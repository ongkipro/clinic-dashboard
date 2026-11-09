// T-049 M1 exit flow (PLAN §1 M1; plan review r1 P1-1): book → check-in → board on a real database,
// through the real writers only (no trigger disabled, no row inserted around a writer, except one
// documented stand-in: the payment column, whose writer is the cashier of M4, DEC-057). One clinic:
// a branch open around the clock, a service published and clinically approved, a branch price override,
// the doctor's roster, a patient registered with an encrypted NIK and a consent; the front office books
// a slot from slots(), checks the patient in, sees the visit on Hari Ini and the number on Antrean, the
// TV shows the number without a name, an unpaid bill keeps the visit on "Belum dibayar" and blocks the
// close; once settled the visit closes, the slot is released and the ticket is done.
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../../src/db/rls/context";
import { openAppPool } from "../../../src/db/rls/pool";
import { type KekRing } from "../../../src/lib/keys/envelope";
import { setKekRingForTests } from "../../../src/lib/keys/runtime";
import { decideApproval } from "../../../src/modules/approvals/approvals";
import { publish } from "../../../src/modules/catalog/catalog";
import { effectivePrice, setBranchPrice } from "../../../src/modules/catalog/prices/prices";
import { setHours, setServices, upsertRoom } from "../../../src/modules/org/branches/branches";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { consentActive, grantConsent, publishConsentText } from "../../../src/modules/patients/consents/consents";
import { normaliseIdentity, registerPatient, sealIdentity } from "../../../src/modules/patients/patients";
import { book, slots } from "../../../src/modules/scheduling/booking/booking";
import { setWeek } from "../../../src/modules/scheduling/rosters/rosters";
import { callTicket, displayFeed, pairDisplay, queueBoard } from "../../../src/modules/visits/queue/queue";
import { checkIn, closeBlocker, closeVisit, today, trackStates, unpaid } from "../../../src/modules/visits/visits";
import { createHarness, type Harness } from "../../../tests/rls/harness";

process.env.DEPLOY_ENV = "local"; // synthetic data (MIG-2)

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
const RING: KekRing = { current: 1, keys: new Map([[1, randomBytes(32)]]) };
type P = { acc: string; staffId: string; role: Role; branch?: string };
let tenantId: string;
let branch: string;
let tz: string;

async function person(role: Role, onBranch = true): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`m1flow${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId, accountId: acc, displayName: `Staf Alur M1 ${n}` });
  const rid = await assignRole(h.admin, { tenantId, staffId, role });
  if (onBranch) await assignBranch(h.admin, { tenantId, staffRoleId: rid, branchId: branch });
  return { acc, staffId, role, branch: onBranch ? branch : undefined };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const key = () => crypto.randomUUID();
const local = (d: Date, zone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(d);
const monday = (d: string) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
};

let OWN: P; let FH: P; let MGR: P; let FO: P; let DOC: P;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = new pg.Pool({ connectionString: h.ownerUrl(), max: 2 });
  owner.on("error", () => {});
  setKekRingForTests(RING);
  // A zone where now and the whole next slot (30 minutes from the next quarter hour) share the local date:
  // book needs a future start inside the day (a slot may not cross midnight), check-in needs today and at
  // most two hours ahead. The midnights of WIB, WITA and WIT are an hour apart and the excluded window is
  // under 45 minutes, so at least two zones qualify at any time (review: 23:45 WIB is no 30-minute slot).
  const nextEnd = new Date(Math.ceil((Date.now() + 60_000) / 900_000) * 900_000 + 30 * 60_000 - 1);
  tz = ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"].find((z) => local(new Date(), z) === local(nextEnd, z))!;
  tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Klinik Alur M1', 'emkm')`, [tenantId]);
  branch = (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'M1', 'Cabang Alur', $2) returning id`, [tenantId, tz])).rows[0].id as string;
  OWN = await person("owner", false); FH = await person("facility_head"); MGR = await person("manager"); FO = await person("fo_cashier"); DOC = await person("doctor");
}, 300_000);
afterAll(async () => {
  setKekRingForTests(undefined);
  await app?.end();
  await owner?.end();
  await h?.close();
});

describe("M1 exit: book → check-in → board on a real database", () => {
  it("a booked patient is checked in, shown on Hari Ini and Antrean, blocked while unpaid, and closed once settled", async () => {
    // Set-up through the writers: hours, a room, a service (clinically approved), the branch offers it,
    // a branch price, the doctor's week, a consent text.
    await as(OWN, (db) => setHours(db, branch, [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "00:00", closes: "24:00" }))));
    await as(OWN, (db) => upsertRoom(db, branch, { name: "Ruang Konsul M1", kind: "consultation" }));
    const v = await as(OWN, (db) => publish(db, { kind: "service", code: "KONSULM1" }, {
      name: "Konsultasi Dokter", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 200_000, category: "consultation",
      prep_min: 0, treatment_min: 30, buffer_min: 0, indications: "Konsultasi", contraindications: "-", consent_template: "-", delegation: "Dokter",
      aftercare_text: "-", eligibility: [{ role: "doctor", mode: "performs" }], resources: [{ kind: "room", code: "consultation" }],
    } as never, "Layanan baru"));
    if (v.approvalId) await as(FH, (db) => decideApproval(db, v.approvalId!, true));
    await as(OWN, (db) => setServices(db, branch, [v.itemId]));
    await as(OWN, (db) => setBranchPrice(db, { itemId: v.itemId, branchId: branch, price: 180_000, effectiveFrom: null, reason: "Harga cabang alur M1" }));
    expect(await as(FO, (db) => effectivePrice(db, v.itemId, branch))).toBe(180_000);
    const day = local(new Date(), tz);
    const week = monday(day);
    const days = [0, 1, 2, 3, 4, 5, 6].map((i) => { const x = new Date(`${week}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + i); return x.toISOString().slice(0, 10); });
    await as(OWN, (db) => setWeek(db, branch, week, [DOC.staffId], days.filter((d) => d >= day).map((d) => ({ staffId: DOC.staffId, date: d, starts: "00:00", ends: "24:00", kind: "work" as const }))));
    const care = await as(OWN, (db) => publishConsentText(db, { purpose: "care_notice", body: "Pemberitahuan layanan dan rekam medis" }));

    // Registration with an encrypted NIK, and the care-notice consent.
    const reg = await as(FO, async (db) => {
      const nik = normaliseIdentity("nik", "3171019001900001")!;
      return registerPatient(db, {
        full_name: "Ayu Alur Satu", birth_date: "1990-01-09", sex: "female", phone: "0812-9000-1001", identity_type: "nik",
        religion: "islam", occupation: "Karyawan", education: "s1", marital_status: "kawin",
      }, await sealIdentity(db, tenantId, "nik", nik), null);
    });
    if (!reg.ok) throw new Error(`registration refused: ${reg.code}`);
    const g = await as(FO, (db) => grantConsent(db, key(), { patientId: reg.patientId, purpose: "care_notice", textId: care.id, channel: "in_person" }));
    expect(g.ok).toBe(true);
    expect(await as(FO, (db) => consentActive(db, reg.patientId, "care_notice"))).toBe(true);

    // Book: the first slot today from the engine (doctor + room reserved together).
    const free = await as(FO, (db) => slots(db, { branchId: branch, versionId: v.versionId, date: day }));
    const slot = free.find((s) => s.startsAt.getTime() > Date.now())!;
    expect(slot).toBeDefined();
    expect(slot.startsAt.getTime() - Date.now()).toBeLessThan(2 * 3_600_000); // the next quarter hour: check-in is open
    const booked = await as(FO, (db) => book(db, key(), { branchId: branch, patientId: reg.patientId, versionId: v.versionId, startsAt: slot.startsAt, channel: "phone", source: "telepon" }));
    const appt = booked.appointmentId;
    const res = (await h.admin.query(`select kind from resource_reservations where appointment_id = $1 and active order by kind`, [appt])).rows.map((r) => r.kind);
    expect(res).toEqual(["room", "staff"]);
    // The board lists the arrival, then check-in opens the visit with the first number of the day.
    expect((await as(FO, (db) => today(db, branch))).arrivals.map((a) => a.id)).toContain(appt);
    const { visitId } = await as(FO, (db) => checkIn(db, key(), appt));
    expect((await h.admin.query(`select state from appointments where id = $1`, [appt])).rows[0].state).toBe("arrived");
    const board = await as(FO, (db) => today(db, branch));
    const visit = board.visits.find((x) => x.id === visitId)!;
    expect(visit).toMatchObject({ patientId: reg.patientId, patientName: "Ayu Alur Satu", closedAt: null });
    expect(trackStates(visit).states).toMatchObject({ Daftar: "selesai", Selesai: "belum" });
    expect(board.arrivals.map((a) => a.id)).not.toContain(appt);
    const queue = await as(FO, (db) => queueBoard(db, null));
    const ticket = queue.tickets.find((t) => t.visitId === visitId)!;
    expect(ticket).toMatchObject({ number: "A-001", state: "waiting", kind: "booked", patientName: "Ayu Alur Satu" });

    // The TV: the called number and room, never a name.
    const tv = await as(MGR, (db) => pairDisplay(db, key(), null, "TV Lobi M1"));
    const room = (await h.admin.query(`select id from rooms where branch_id = $1`, [branch])).rows[0].id as string;
    await as(FO, (db) => callTicket(db, key(), ticket.id, room));
    const feed = await displayFeed(app, tv.token!);
    expect(feed).toMatchObject({ current: [{ number: "A-001", room: "Ruang Konsul M1" }] });
    expect(JSON.stringify(feed)).not.toMatch(/Ayu|Alur Satu|RM-|[0-9a-f]{8}-[0-9a-f]{4}-/);

    // An unpaid bill (the cashier's column, M4; set here by the database owner as its stand-in):
    // listed under Belum dibayar and the close is refused, naming the blocker.
    await h.admin.query(`update visits set payment = 'in_progress' where id = $1`, [visitId]);
    const owed = (await as(FO, (db) => today(db, branch))).visits.find((x) => x.id === visitId)!;
    expect(unpaid(owed)).toBe(true);
    expect(closeBlocker(owed)).toBe("unpaid_bill");
    await expect(as(FO, (db) => closeVisit(db, key(), visitId))).rejects.toMatchObject({ code: "ERR_VERSION_CONFLICT", reason: "unpaid_bill" });

    // Settled: the visit closes, the slot is released, the ticket is done.
    await h.admin.query(`update visits set payment = 'done' where id = $1`, [visitId]);
    await as(FO, (db) => closeVisit(db, key(), visitId));
    const closed = (await as(FO, (db) => today(db, branch))).visits.find((x) => x.id === visitId)!;
    expect(closed.closedAt).not.toBeNull();
    expect(trackStates(closed).states.Selesai).toBe("selesai");
    expect(Number((await h.admin.query(`select count(*) from resource_reservations where appointment_id = $1 and active`, [appt])).rows[0].count)).toBe(0);
    expect((await h.admin.query(`select state from queue_tickets where id = $1`, [ticket.id])).rows[0].state).toBe("done");
    // The trail: ids-only events in order.
    const ev = (await h.admin.query(
      `select type from domain_events where aggregate_id in ($1, $2) order by occurred_at, type`, [appt, visitId])).rows.map((r) => r.type);
    expect(ev).toEqual(expect.arrayContaining(["AppointmentBooked", "VisitCheckedIn", "VisitClosed"]));
  });
});
