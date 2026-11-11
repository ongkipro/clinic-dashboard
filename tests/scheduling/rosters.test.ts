// T-043 Done-when: roster shifts and leave persist per branch; module-level availability excludes a
// doctor on leave (the full scenario PR-48 completes in T-044). Plus the plan review: authority per
// branch, the past kept, one person never in two places at once across timezones, breaks inside shifts,
// availability (hours, closures, shifts, breaks, leave, membership, assignment), readers (leave private),
// roster_window, guards, audit and events ids only, vendor classes, cross-tenant.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { addClosure, setHours } from "../../src/modules/org/branches/branches";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { addLeave, branchLeave, cancelLeave, isStaffAvailable, rosterWindow, setWeek, weekShifts, type ShiftRow } from "../../src/modules/scheduling/rosters/rosters";
import { createHarness, type Harness, testPool } from "../rls/harness";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string; mks: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "purchasing", "marketing", "central_cs", "auditor"];

async function tenant(): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Jadwal Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string, tz = "Asia/Jakarta") =>
    (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, $3) returning id`, [tenantId, c, tz])).rows[0].id as string;
  return { tenantId, b1: await br("J1"), b2: await br("J2"), mks: await br("JM", "Asia/Makassar") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`jdw${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Jadwal ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  const bs = TENANT_WIDE.includes(role) ? [] : branches.length ? branches : [t.b1];
  for (const b of bs) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: bs[0] };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>, branch?: string) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: branch ?? p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const reason = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason}` : `raw:${e.message}`));
const OFFSET: Record<string, string> = { "Asia/Jakarta": "+07:00", "Asia/Makassar": "+08:00" };
const localDay = (tz: string, days = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.now() + days * 86_400_000));
const at = (tz: string, date: string, hhmm: string) => new Date(`${date}T${hhmm}:00${OFFSET[tz]}`);
// The Monday of the ISO week holding a local date, and a weekday offset from it.
const monday = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
const plus = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "07:00", closes: "24:00" }));

let A: T;
let B: T;
let OWN: P; let AP: P; let MGR: P; let MGR2: P; let FO: P; let CS: P; let BC: P; let DOC: P; let DOC2: P; let NUR: P; let FIN: P; let MK: P; let AU: P;
// Next week (all dates in the future in every Indonesian zone).
let W: string;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); AP = await person(A, "admin_pusat");
  MGR = await person(A, "manager", A.b1); MGR2 = await person(A, "manager", A.b2);
  FO = await person(A, "fo_cashier", A.b1); CS = await person(A, "central_cs"); BC = await person(A, "bc", A.b1);
  DOC = await person(A, "doctor", A.b1, A.b2, A.mks); DOC2 = await person(A, "doctor", A.b1);
  NUR = await person(A, "nurse", A.b1); FIN = await person(A, "finance"); MK = await person(A, "marketing"); AU = await person(A, "auditor");
  for (const b of [A.b1, A.b2, A.mks]) await as(OWN, (db) => setHours(db, b, ALL_DAYS));
  W = monday(plus(localDay("Asia/Jakarta"), 7));
  ALL = [DOC, DOC2, NUR].map((p) => p.staffId);
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

// The staff the editor lists: every roster person of the tenant (rows decide what is written).
let ALL: string[] = [];
const work = (staffId: string, date: string, starts: string, ends: string): ShiftRow => ({ staffId, date, starts, ends, kind: "work" });
const brk = (staffId: string, date: string, starts: string, ends: string): ShiftRow => ({ staffId, date, starts, ends, kind: "break" });

describe("Done-when: shifts and leave persist per branch; availability excludes a doctor on leave", () => {
  it("a week is saved and read back per branch; a doctor on leave on a date is not available that date", async () => {
    const mon = W, tue = plus(W, 1);
    expect(await as(MGR, (db) => setWeek(db, A.b1, W, ALL, [work(DOC.staffId, mon, "09:00", "17:00"), brk(DOC.staffId, mon, "12:00", "13:00"), work(DOC.staffId, tue, "09:00", "17:00")]))).toBe(3);
    expect(await as(MGR, (db) => weekShifts(db, A.b1, W))).toEqual([
      work(DOC.staffId, mon, "09:00", "17:00"), brk(DOC.staffId, mon, "12:00", "13:00"), work(DOC.staffId, tue, "09:00", "17:00"),
    ].sort((x, y) => (x.date + x.starts < y.date + y.starts ? -1 : 1)));
    expect(await as(MGR2, (db) => weekShifts(db, A.b2, W))).toEqual([]);
    const ok = (from: string, until: string, date = mon) => as(FO, (db) => isStaffAvailable(db, { staffId: DOC.staffId, branchId: A.b1, from: at("Asia/Jakarta", date, from), until: at("Asia/Jakarta", date, until) }));
    expect(await ok("09:00", "10:00")).toBe(true);
    expect(await ok("16:00", "17:00")).toBe(true);
    expect(await ok("11:30", "12:30")).toBe(false); // into the break
    expect(await ok("08:30", "09:30")).toBe(false); // before the shift
    expect(await ok("16:30", "17:30")).toBe(false); // after the shift
    expect(await ok("10:00", "11:00", tue)).toBe(true);
    const leave = await as(MGR, (db) => addLeave(db, { branchId: A.b1, staffId: DOC.staffId, kind: "leave", from: tue, to: tue, reason: "Cuti tahunan" }));
    expect(await ok("10:00", "11:00", tue)).toBe(false); // on leave
    expect(await ok("09:00", "10:00")).toBe(true); // the day before is untouched
    expect((await as(MGR, (db) => branchLeave(db, A.b1, mon, plus(W, 6)))).map((l) => [l.id, l.kind, l.from, l.to])).toEqual([[leave, "leave", tue, tue]]);
    await as(MGR, (db) => cancelLeave(db, leave, "Batal cuti"));
    expect(await ok("10:00", "11:00", tue)).toBe(true);
    expect((await as(MGR, (db) => branchLeave(db, A.b1, mon, plus(W, 6))))[0].cancelledAt).not.toBeNull();
  });

  it("leave is per branch: leave at C1 does not block C2", async () => {
    const wed = plus(W, 2);
    await as(OWN, (db) => setWeek(db, A.b2, W, ALL, [work(DOC.staffId, wed, "09:00", "12:00")]));
    await as(OWN, (db) => setWeek(db, A.b1, W, ALL, [work(DOC.staffId, wed, "13:00", "17:00")]));
    await as(MGR, (db) => addLeave(db, { branchId: A.b1, staffId: DOC.staffId, kind: "sick", from: wed, to: wed, reason: "Sakit" }));
    expect(await as(CS, (db) => isStaffAvailable(db, { staffId: DOC.staffId, branchId: A.b2, from: at("Asia/Jakarta", wed, "09:00"), until: at("Asia/Jakarta", wed, "10:00") }))).toBe(true);
    expect(await as(CS, (db) => isStaffAvailable(db, { staffId: DOC.staffId, branchId: A.b1, from: at("Asia/Jakarta", wed, "13:00"), until: at("Asia/Jakarta", wed, "14:00") }))).toBe(false);
  });
});

describe("structure", () => {
  it("one person is never in two places: overlapping work shifts across branches and timezones are refused", async () => {
    const thu = plus(W, 3);
    await as(OWN, (db) => setWeek(db, A.b1, W, ALL, [work(DOC2.staffId, thu, "09:00", "12:00")]));
    await assignBranch(h.admin, { tenantId: A.tenantId, staffRoleId: (await h.admin.query(`select id from staff_roles where staff_id = $1`, [DOC2.staffId])).rows[0].id, branchId: A.mks });
    // 11:00 WITA = 10:00 WIB: overlaps the WIB shift.
    expect(await reason(as(OWN, (db) => setWeek(db, A.mks, W, ALL, [work(DOC2.staffId, thu, "11:00", "14:00")])))).toBe("ERR_INVALID_INPUT:shift_overlap");
    // 12:30 WITA = 11:30 WIB: the local times do not overlap (12:30 > 12:00), the instants do.
    expect(await reason(as(OWN, (db) => setWeek(db, A.mks, W, ALL, [work(DOC2.staffId, thu, "12:30", "14:00")])))).toBe("ERR_INVALID_INPUT:shift_overlap");
    // 13:00 WITA = 12:00 WIB: touches, does not overlap.
    expect(await as(OWN, (db) => setWeek(db, A.mks, W, ALL, [work(DOC2.staffId, thu, "13:00", "16:00")]))).toBe(1);
    // Within one branch and one save, two overlapping shifts are refused too.
    expect(await reason(as(OWN, (db) => setWeek(db, A.b2, W, ALL, [work(DOC.staffId, plus(W, 4), "09:00", "12:00"), work(DOC.staffId, plus(W, 4), "11:00", "13:00")])))).toBe("ERR_INVALID_INPUT:shift_overlap");
    // A shift ending at midnight and one starting at midnight the next day do not overlap.
    expect(await as(OWN, (db) => setWeek(db, A.b2, W, ALL, [work(DOC.staffId, plus(W, 4), "20:00", "24:00"), work(DOC.staffId, plus(W, 5), "00:00", "02:00")]))).toBe(2);
    expect((await as(OWN, (db) => weekShifts(db, A.b2, W))).find((r) => r.date === plus(W, 4))).toEqual(work(DOC.staffId, plus(W, 4), "20:00", "24:00"));
  });

  it("a break lies inside a work shift; breaks never overlap; removing a shift cannot leave its break", async () => {
    const fri = plus(W, 4);
    expect(await reason(as(OWN, (db) => setWeek(db, A.b1, W, ALL, [brk(NUR.staffId, fri, "12:00", "13:00")])))).toBe("ERR_INVALID_INPUT:break_outside_shift");
    expect(await reason(as(OWN, (db) => setWeek(db, A.b1, W, ALL, [work(NUR.staffId, fri, "09:00", "12:30"), brk(NUR.staffId, fri, "12:00", "13:00")])))).toBe("ERR_INVALID_INPUT:break_outside_shift");
    expect(await reason(as(OWN, (db) => setWeek(db, A.b1, W, ALL, [work(NUR.staffId, fri, "09:00", "17:00"), brk(NUR.staffId, fri, "12:00", "13:00"), brk(NUR.staffId, fri, "12:30", "13:30")])))).toBe("ERR_INVALID_INPUT:break_overlap");
    expect(await reason(as(OWN, (db) => setWeek(db, A.b1, W, ALL, [work(NUR.staffId, fri, "17:00", "09:00")])))).toBe("ERR_INVALID_INPUT:staff_shifts_range_check");
    expect(await as(OWN, (db) => setWeek(db, A.b1, W, ALL, [work(NUR.staffId, fri, "09:00", "17:00"), brk(NUR.staffId, fri, "12:00", "13:00")]))).toBe(2);
    // A direct delete of the work shift alone would orphan the break: refused by the statement check.
    const w = (await h.admin.query(`select id from staff_shifts where staff_id = $1 and kind = 'work' and shift_date = $2`, [NUR.staffId, fri])).rows[0].id;
    await expect(h.admin.query(`delete from staff_shifts where id = $1`, [w])).rejects.toThrow(/break_outside_shift/);
  });

  it("a save replaces only the listed staff: a role-filtered editor keeps the other roles' shifts (impl review r1 P1)", async () => {
    const sun = plus(W, 6);
    await as(OWN, (db) => setWeek(db, A.b1, W, ALL, [work(DOC.staffId, sun, "09:00", "12:00"), work(NUR.staffId, sun, "09:00", "12:00")]));
    // The editor filtered to doctors lists DOC and DOC2 and saves new hours for DOC.
    await as(MGR, (db) => setWeek(db, A.b1, W, [DOC.staffId, DOC2.staffId], [work(DOC.staffId, sun, "13:00", "16:00")]));
    const rows = (await as(MGR, (db) => weekShifts(db, A.b1, W))).filter((r) => r.date === sun);
    expect(rows.map((r) => [r.staffId, r.starts])).toEqual(expect.arrayContaining([[DOC.staffId, "13:00"], [NUR.staffId, "09:00"]]));
    expect(rows).toHaveLength(2);
    // A row for someone not listed is refused (the list bounds what is replaced).
    expect(await reason(as(MGR, (db) => setWeek(db, A.b1, W, [DOC.staffId], [work(NUR.staffId, sun, "13:00", "14:00")])))).toBe("ERR_INVALID_INPUT:staff_not_listed");
  });

  it("input: a Monday, inside the week, from today on, staff assigned to the branch, a known kind and time format", async () => {
    expect(await reason(as(OWN, (db) => setWeek(db, A.b1, plus(W, 1), [], [])))).toBe("ERR_INVALID_INPUT:week");
    expect(await reason(as(OWN, (db) => setWeek(db, A.b1, W, ALL, [work(DOC.staffId, plus(W, 7), "09:00", "10:00")])))).toBe("ERR_INVALID_INPUT:outside_week");
    expect(await reason(as(OWN, (db) => setWeek(db, A.b1, W, [...ALL, FIN.staffId], [work(FIN.staffId, W, "09:00", "10:00")])))).toBe("ERR_INVALID_INPUT:staff_not_at_branch");
    expect(await reason(as(OWN, (db) => setWeek(db, A.b1, W, ALL, [{ ...work(DOC.staffId, W, "9:00", "10:00") }])))).toBe("ERR_INVALID_INPUT:rows");
    expect(await reason(as(OWN, (db) => setWeek(db, A.b1, W, ALL, [{ ...work(DOC.staffId, W, "09:00", "10:00"), kind: "nap" as never }])))).toBe("ERR_INVALID_INPUT:rows");
    const past = monday(plus(localDay("Asia/Jakarta"), -14));
    expect(await reason(as(OWN, (db) => setWeek(db, A.b1, past, [], [])))).toBe("ERR_INVALID_INPUT:shift_past");
    // This week: a row dated yesterday is refused (when yesterday is in this week).
    const today = localDay("Asia/Jakarta");
    const thisWeek = monday(today);
    if (today !== thisWeek) {
      expect(await reason(as(OWN, (db) => setWeek(db, A.b1, thisWeek, ALL, [work(DOC.staffId, plus(today, -1), "09:00", "10:00")])))).toBe("ERR_INVALID_INPUT:shift_past");
    }
  });

  it("the past is kept: a direct insert, delete or update of a past shift is refused; shifts are never updated", async () => {
    const yesterday = plus(localDay("Asia/Jakarta"), -1);
    await expect(h.admin.query(
      `insert into staff_shifts (tenant_id, branch_id, staff_id, shift_date, starts, ends, kind, created_by) values ($1, $2, $3, $4, '09:00', '10:00', 'work', $3)`,
      [A.tenantId, A.b1, DOC.staffId, yesterday],
    )).rejects.toThrow(/shift_past/);
    // Seed a past shift with the guard off (fixture), then check delete and update stay refused.
    await h.admin.query(`alter table staff_shifts disable trigger staff_shifts_guard`);
    await h.admin.query(`alter table staff_shifts disable trigger staff_shifts_check_ins`);
    const id = (await h.admin.query(
      `insert into staff_shifts (tenant_id, branch_id, staff_id, shift_date, starts, ends, kind, created_by) values ($1, $2, $3, $4, '09:00', '10:00', 'work', $3) returning id`,
      [A.tenantId, A.b1, DOC.staffId, yesterday],
    )).rows[0].id;
    await h.admin.query(`alter table staff_shifts enable always trigger staff_shifts_guard`);
    await h.admin.query(`alter table staff_shifts enable always trigger staff_shifts_check_ins`);
    await expect(h.admin.query(`delete from staff_shifts where id = $1`, [id])).rejects.toThrow(/shift_past/);
    await expect(h.admin.query(`update staff_shifts set starts = '08:00' where id = $1`, [id])).rejects.toThrow(/never edited/);
    await expect(h.admin.query(`truncate staff_shifts`)).rejects.toThrow();
    // Saving this week keeps the past shift (only today on is replaced).
    await as(OWN, (db) => setWeek(db, A.b1, monday(localDay("Asia/Jakarta")), [], []));
    expect(Number((await h.admin.query(`select count(*) from staff_shifts where id = $1`, [id])).rows[0].count)).toBe(1);
  });
});

describe("availability", () => {
  it("a closed branch, a closure date, an ended membership or a removed assignment make the doctor unavailable; never null", async () => {
    const sat = plus(W, 5);
    const d3 = await person(A, "doctor", A.b2);
    await as(OWN, (db) => setWeek(db, A.b2, W, [d3.staffId], [work(d3.staffId, sat, "09:00", "17:00")]));
    expect(await as(CS, (db) => isStaffAvailable(db, { staffId: d3.staffId, branchId: A.b2, from: at("Asia/Jakarta", sat, "10:00"), until: at("Asia/Jakarta", sat, "11:00") }))).toBe(true);
    await as(OWN, (db) => addClosure(db, A.b2, { date: sat, from: "10:00", until: "10:30", reason: "Rapat" }));
    expect(await as(CS, (db) => isStaffAvailable(db, { staffId: d3.staffId, branchId: A.b2, from: at("Asia/Jakarta", sat, "10:00"), until: at("Asia/Jakarta", sat, "11:00") }))).toBe(false);
    expect(await as(CS, (db) => isStaffAvailable(db, { staffId: d3.staffId, branchId: A.b2, from: at("Asia/Jakarta", sat, "11:00"), until: at("Asia/Jakarta", sat, "12:00") }))).toBe(true);
    await h.admin.query(`delete from staff_branches where staff_id = $1`, [d3.staffId]);
    expect(await as(CS, (db) => isStaffAvailable(db, { staffId: d3.staffId, branchId: A.b2, from: at("Asia/Jakarta", sat, "11:00"), until: at("Asia/Jakarta", sat, "12:00") }))).toBe(false);
    const d5 = await person(A, "doctor", A.b2);
    const d4 = await person(A, "doctor", A.b2);
    await as(OWN, (db) => setWeek(db, A.b2, W, [d4.staffId, d5.staffId], [work(d4.staffId, sat, "09:00", "17:00"), work(d5.staffId, sat, "09:00", "17:00")]));
    await h.admin.query(`update memberships set effective_to = now() where id = (select membership_id from staff where id = $1)`, [d4.staffId]);
    expect(await as(CS, (db) => isStaffAvailable(db, { staffId: d4.staffId, branchId: A.b2, from: at("Asia/Jakarta", sat, "11:00"), until: at("Asia/Jakarta", sat, "12:00") }))).toBe(false);
    // Nulls and an empty interval: false, for a staff member who is available for a real interval.
    const t0 = at("Asia/Jakarta", sat, "11:00");
    expect(await as(CS, (db) => isStaffAvailable(db, { staffId: d5.staffId, branchId: A.b2, from: t0, until: new Date(t0.getTime() + 3_600_000) }))).toBe(true);
    const r = (await as(CS, (db) => db.query(
      `select staff_available(null, $1::uuid, $3::timestamptz, $3::timestamptz + interval '1 hour') a, staff_available($2::uuid, $1::uuid, $3::timestamptz, $3::timestamptz) b,
              staff_available($2::uuid, $1::uuid, null, $3::timestamptz) c, staff_available($2::uuid, $1::uuid, $3::timestamptz, null) d`,
      [A.b2, d5.staffId, t0],
    ))).rows[0];
    expect(r).toEqual({ a: false, b: false, c: false, d: false });
  });

  it("instants in the branch timezone (WITA) and a shift ending at 24:00", async () => {
    const sun = plus(W, 6);
    await as(OWN, (db) => setWeek(db, A.mks, W, ALL, [work(DOC.staffId, sun, "20:00", "24:00")]));
    const ok = (from: string, until: string, tz = "Asia/Makassar") =>
      as(CS, (db) => isStaffAvailable(db, { staffId: DOC.staffId, branchId: A.mks, from: at(tz, sun, from), until: at(tz, sun, until) }));
    expect(await as(CS, (db) => isStaffAvailable(db, { staffId: DOC.staffId, branchId: A.mks, from: at("Asia/Makassar", sun, "23:00"), until: new Date(at("Asia/Makassar", sun, "23:00").getTime() + 3_600_000) }))).toBe(true);
    expect(await ok("19:30", "20:30")).toBe(false);
    // 20:00 WIB = 21:00 WITA: inside; 19:30 WIB = 20:30 WITA: inside.
    expect(await ok("19:30", "20:00", "Asia/Jakarta")).toBe(true);
    expect(await ok("18:30", "19:30", "Asia/Jakarta")).toBe(false);
  });
});

describe("authority and readers", () => {
  it("Owner and Admin Pusat write every branch; the manager only their own; other roles never", async () => {
    const d = plus(W, 6);
    expect(await code(as(AP, (db) => setWeek(db, A.b2, W, ALL, [work(DOC.staffId, d, "09:00", "10:00")])))).toBe("ok");
    expect(await code(as(MGR, (db) => setWeek(db, A.b2, W, [], [])))).toBe("ERR_NOT_FOUND");
    expect(await code(as(MGR, (db) => addLeave(db, { branchId: A.b2, staffId: DOC.staffId, kind: "leave", from: d, to: d, reason: "Coba" })))).toBe("ERR_NOT_FOUND");
    const lv = await as(MGR2, (db) => addLeave(db, { branchId: A.b2, staffId: DOC.staffId, kind: "leave", from: d, to: d, reason: "Cuti C2" }));
    expect(await code(as(MGR, (db) => cancelLeave(db, lv, "Bukan cabang saya")))).toBe("ERR_NOT_FOUND");
    for (const p of [FO, CS, BC, DOC, NUR, FIN, MK, AU]) {
      expect(await code(as(p, (db) => setWeek(db, A.b1, W, [], []))), p.role).toBe("ERR_FORBIDDEN");
      expect(await code(as(p, (db) => addLeave(db, { branchId: A.b1, staffId: DOC.staffId, kind: "leave", from: d, to: d, reason: "Coba" }))), p.role).toBe("ERR_FORBIDDEN");
    }
    // A non-writer gets forbidden for an existing and an unknown leave alike (impl review r1 P3).
    expect(await code(as(FO, (db) => cancelLeave(db, lv, "Bukan penulis")))).toBe("ERR_FORBIDDEN");
    expect(await code(as(FO, (db) => cancelLeave(db, crypto.randomUUID(), "Bukan penulis")))).toBe("ERR_FORBIDDEN");
    expect(await code(as(MGR2, (db) => cancelLeave(db, lv, "Batal")))).toBe("ok");
    expect(await code(as(MGR2, (db) => cancelLeave(db, lv, "Lagi")))).toBe("ERR_VERSION_CONFLICT");
  });

  it("leave: a past start is refused; a leave is never deleted or edited; cancellation once", async () => {
    const yesterday = plus(localDay("Asia/Jakarta"), -1);
    expect(await reason(as(MGR, (db) => addLeave(db, { branchId: A.b1, staffId: DOC.staffId, kind: "leave", from: yesterday, to: plus(W, 1), reason: "Mundur" })))).toBe("ERR_INVALID_INPUT:leave_past");
    expect(await reason(as(MGR, (db) => addLeave(db, { branchId: A.b1, staffId: DOC.staffId, kind: "nap" as never, from: W, to: W, reason: "Coba" })))).toBe("ERR_INVALID_INPUT:kind");
    expect(await reason(as(MGR, (db) => addLeave(db, { branchId: A.b1, staffId: DOC.staffId, kind: "leave", from: plus(W, 1), to: W, reason: "Terbalik" })))).toBe("ERR_INVALID_INPUT:dates");
    expect(await reason(as(MGR, (db) => addLeave(db, { branchId: A.b1, staffId: FIN.staffId, kind: "leave", from: W, to: W, reason: "Bukan staf cabang" })))).toBe("ERR_INVALID_INPUT:staff_not_at_branch");
    const id = await as(MGR, (db) => addLeave(db, { branchId: A.b1, staffId: NUR.staffId, kind: "absent", from: W, to: W, reason: "Izin keluarga" }));
    await expect(h.admin.query(`delete from staff_leave where id = $1`, [id])).rejects.toThrow(/never deleted/);
    await expect(h.admin.query(`update staff_leave set to_date = to_date + 1 where id = $1`, [id])).rejects.toThrow(/never edited/);
    await expect(h.admin.query(`truncate staff_leave`)).rejects.toThrow();
    expect(await reason(as(MGR, (db) => cancelLeave(db, id, "x")))).toBe("ERR_INVALID_INPUT:reason");
  });

  it("readers: shifts for booking roles at the branch and the staff themselves; leave only for writers and self", async () => {
    const own = await as(MGR, (db) => addLeave(db, { branchId: A.b1, staffId: DOC2.staffId, kind: "sick", from: plus(W, 2), to: plus(W, 2), reason: "Alasan kesehatan" }));
    for (const p of [OWN, AP, MGR, FO, CS, BC, DOC, NUR]) {
      expect(Number((await as(p, (db) => db.query(`select count(*) from staff_shifts where branch_id = $1`, [A.b1]))).rows[0].count), p.role).toBeGreaterThan(0);
    }
    for (const p of [FIN, MK, AU]) expect(Number((await as(p, (db) => db.query(`select count(*) from staff_shifts`))).rows[0].count), p.role).toBe(0);
    // MGR2 (C2) does not read C1's shifts.
    expect(Number((await as(MGR2, (db) => db.query(`select count(*) from staff_shifts where branch_id = $1`, [A.b1]))).rows[0].count)).toBe(0);
    for (const p of [OWN, AP, MGR]) expect((await as(p, (db) => branchLeave(db, A.b1, W, plus(W, 6)))).some((l) => l.id === own), p.role).toBe(true);
    // Others see none of another person's leave (the nurse sees only her own).
    for (const p of [FO, CS, BC, NUR, FIN, MK, AU]) {
      expect((await as(p, (db) => branchLeave(db, A.b1, W, plus(W, 6)))).filter((l) => l.staffId !== p.staffId).length, p.role).toBe(0);
    }
    expect((await as(DOC2, (db) => branchLeave(db, A.b1, W, plus(W, 6)))).map((l) => l.id)).toContain(own);
    // roster_window: booking roles at the branch; leave ranges without kind or reason.
    const w = await as(FO, (db) => rosterWindow(db, A.b1, W, plus(W, 6)));
    expect(w.leave.find((l) => l.staffId === DOC2.staffId)).toEqual({ staffId: DOC2.staffId, from: plus(W, 2), to: plus(W, 2) });
    expect(JSON.stringify(w)).not.toContain("kesehatan");
    expect(JSON.stringify(w)).not.toContain("sick");
    // The definer's own output (not only the TS mapping) carries no kind or reason.
    const raw = JSON.stringify((await as(FO, (db) => db.query(`select roster_window($1, $2::date, $3::date) as w`, [A.b1, W, plus(W, 6)]))).rows[0].w);
    expect(raw).not.toContain("sick");
    expect(raw).not.toContain("kesehatan");
    expect(raw).not.toContain('"kind":"leave"');
    // A cancelled leave leaves the window.
    const gone = await as(MGR, (db) => addLeave(db, { branchId: A.b1, staffId: NUR.staffId, kind: "leave", from: plus(W, 6), to: plus(W, 6), reason: "Akan dibatalkan" }));
    expect((await as(FO, (db) => rosterWindow(db, A.b1, W, plus(W, 6)))).leave.some((l) => l.staffId === NUR.staffId && l.from === plus(W, 6))).toBe(true);
    await as(MGR, (db) => cancelLeave(db, gone, "Batal"));
    expect((await as(FO, (db) => rosterWindow(db, A.b1, W, plus(W, 6)))).leave.some((l) => l.staffId === NUR.staffId && l.from === plus(W, 6))).toBe(false);
    expect(await code(as(FO, (db) => rosterWindow(db, A.b2, W, plus(W, 6))))).toBe("ERR_NOT_FOUND");
    for (const p of [FIN, MK, AU]) expect(await code(as(p, (db) => rosterWindow(db, A.b1, W, plus(W, 6)))), p.role).toBe("ERR_FORBIDDEN");
    expect(await code(as(FO, (db) => rosterWindow(db, A.b1, W, plus(W, 90))))).toBe("ERR_INVALID_INPUT");
  });
});

describe("audit, events, vendor classes, cross-tenant", () => {
  it("one audit row and one RosterChanged event per change, ids and codes only", async () => {
    const before = Number((await h.admin.query(`select count(*) from domain_events where tenant_id = $1 and type = 'RosterChanged'`, [A.tenantId])).rows[0].count);
    await as(OWN, (db) => setWeek(db, A.b1, W, ALL, [work(DOC.staffId, W, "09:00", "10:00"), work(DOC2.staffId, W, "09:00", "10:00")]));
    const ev = (await h.admin.query(`select payload from domain_events where tenant_id = $1 and type = 'RosterChanged' order by occurred_at desc limit 1`, [A.tenantId])).rows[0];
    expect(Number((await h.admin.query(`select count(*) from domain_events where tenant_id = $1 and type = 'RosterChanged'`, [A.tenantId])).rows[0].count)).toBe(before + 1);
    expect(ev.payload).toEqual({ branch_id: A.b1, change: "roster_week_set" });
    const id = await as(MGR, (db) => addLeave(db, { branchId: A.b1, staffId: NUR.staffId, kind: "sick", from: plus(W, 3), to: plus(W, 3), reason: "Rahasia sakit" }));
    const le = (await h.admin.query(`select payload from domain_events where aggregate_id = $1`, [id])).rows[0];
    expect(le.payload).toEqual({ branch_id: A.b1, change: "leave_added", staff_id: NUR.staffId, leave_id: id });
    const au = (await h.admin.query(`select reason_code, reason from audit_events where object_id = $1`, [id])).rows;
    expect(au).toEqual([{ reason_code: "leave_added", reason: null }]);
    const all = JSON.stringify((await h.admin.query(`select payload from domain_events where tenant_id = $1`, [A.tenantId])).rows);
    expect(all).not.toContain("Rahasia");
    expect(all).not.toContain("sick");
  });

  it("vendor classes: shifts config, leave personal; one operator policy each; both branch-scoped", async () => {
    const k = (await h.admin.query(`select table_name, support_class from support_object_kinds where table_name in ('public.staff_shifts','public.staff_leave')`)).rows
      .sort((x, y) => (x.table_name < y.table_name ? -1 : 1));
    expect(k).toEqual([{ table_name: "public.staff_leave", support_class: "personal" }, { table_name: "public.staff_shifts", support_class: "config" }]);
    const pol = (await h.admin.query(`select tablename, count(*)::int n from pg_policies where tablename in ('staff_shifts','staff_leave') and 'clinic_operator' = any(roles) group by 1`)).rows
      .sort((x, y) => (x.tablename < y.tablename ? -1 : 1));
    expect(pol).toEqual([{ tablename: "staff_leave", n: 1 }, { tablename: "staff_shifts", n: 1 }]);
    const sm = (await h.admin.query(`select table_name, policy_kind from scope_map where table_name in ('public.staff_shifts','public.staff_leave')`)).rows;
    expect(sm.every((r) => r.policy_kind === "branch-scoped")).toBe(true);
  });

  it("tenant B neither reads nor changes A's rosters or leave", async () => {
    const bOwn = await person(B, "owner");
    const bFo = await person(B, "fo_cashier", B.b1);
    const lv = await as(MGR, (db) => addLeave(db, { branchId: A.b1, staffId: DOC.staffId, kind: "leave", from: plus(W, 5), to: plus(W, 5), reason: "Rahasia A" }));
    expect(Number((await as(bOwn, (db) => db.query(`select count(*) from staff_shifts where tenant_id = $1`, [A.tenantId]))).rows[0].count)).toBe(0);
    expect(Number((await as(bOwn, (db) => db.query(`select count(*) from staff_leave where tenant_id = $1`, [A.tenantId]))).rows[0].count)).toBe(0);
    expect(await code(as(bOwn, (db) => setWeek(db, A.b1, W, [], [])))).toBe("ERR_NOT_FOUND");
    expect(await code(as(bOwn, (db) => addLeave(db, { branchId: A.b1, staffId: DOC.staffId, kind: "leave", from: W, to: W, reason: "Dari B" })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(bOwn, (db) => cancelLeave(db, lv, "Dari B")))).toBe("ERR_NOT_FOUND");
    expect(await code(as(bFo, (db) => rosterWindow(db, A.b1, W, plus(W, 6))))).toBe("ERR_NOT_FOUND");
    expect(await as(bFo, (db) => isStaffAvailable(db, { staffId: DOC.staffId, branchId: A.b1, from: at("Asia/Jakarta", W, "09:00"), until: at("Asia/Jakarta", W, "09:30") }))).toBe(false);
    // B's own staff on A's branch: not at branch.
    expect(await reason(as(bOwn, (db) => setWeek(db, B.b1, W, [DOC.staffId], [work(DOC.staffId, W, "09:00", "10:00")])))).toBe("ERR_INVALID_INPUT:staff_not_at_branch");
  });
});
