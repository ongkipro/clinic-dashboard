// T-036 Done-when: the branch master is saved and audited (PR-2, SET-2, SET-3, SET-46). Plus the plan
// review: authority per section (Owner and Admin Pusat everything, even with another branch selected;
// the manager of the branch its hours, closures, rooms and devices only), adding a branch, validation,
// branch_is_open for instants and intervals in three timezones (the scenario PR-2 fixture), the closure
// date rule in branch time, services only, the responsible person, every guard, readers, the vendor
// support class and cross-tenant isolation.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { publish } from "../../src/modules/catalog/catalog";
import {
  addClosure, branchDevices, branchRooms, closures, createBranch, getBranch, isOpen, licenceComplete, listBranches, offeredServices, removeClosure,
  setDeviceActive, setHours, setRoomActive, setServices, updateProfile, upsertDevice, upsertRoom, weeklyHours,
} from "../../src/modules/org/branches/branches";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { createHarness, type Harness } from "../rls/harness";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string; mks: string; jyp: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "purchasing", "marketing", "central_cs", "auditor"];

async function tenant(state = "live"): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ($1) returning id`, [state])).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Cabang Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string, tz = "Asia/Jakarta") =>
    (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, $3) returning id`, [tenantId, c, tz])).rows[0].id as string;
  return { tenantId, b1: await br("C1"), b2: await br("C2"), mks: await br("CM", "Asia/Makassar"), jyp: await br("CJ", "Asia/Jayapura") };
}
async function person(t: T, role: Role, branch?: string): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`cbg${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Cabang ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  const b = TENANT_WIDE.includes(role) ? undefined : branch ?? t.b1;
  if (b) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: b };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>, branch?: string) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: branch ?? p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const reason = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason}` : `raw:${e.message}`));
// A local date in a zone, n days from today.
const localDay = (tz: string, days = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.now() + days * 86_400_000));
// An instant at a local wall-clock time on a local date in a zone (offsets are fixed in Indonesia).
const OFFSET: Record<string, string> = { "Asia/Jakarta": "+07:00", "Asia/Makassar": "+08:00", "Asia/Jayapura": "+09:00" };
const at = (tz: string, date: string, hhmm: string) => new Date(`${date}T${hhmm}:00${OFFSET[tz]}`);
const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

let A: T;
let B: T;
let OWN: P; let AP: P; let MGR: P; let MGR2: P; let FH: P; let FO: P; let FIN: P; let DOC: P;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = new pg.Pool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner");
  AP = await person(A, "admin_pusat");
  MGR = await person(A, "manager", A.b1);
  MGR2 = await person(A, "manager", A.b2);
  FH = await person(A, "facility_head", A.b1);
  FO = await person(A, "fo_cashier", A.b1);
  FIN = await person(A, "finance");
  DOC = await person(A, "doctor", A.b1);
});

afterAll(async () => {
  await owner?.end();
  await app?.end();
  await h?.close();
});

describe("T-036 Done-when: the branch master is saved and audited", () => {
  it("profile, hours, closures, rooms, devices and services are saved; each change is audited with a BranchChanged event (ids only)", async () => {
    await as(OWN, (db) => updateProfile(db, A.b1, { name: "Cabang Kemang", address: "Jl. Kemang Raya 1", whatsapp_number: "+6281211112222", map_url: "https://maps.example/kemang",
      licence_number: "503/123/KLINIK", nib: "1234567890123", facility_code: "F-01", satusehat_org_id: "org-123", responsible_staff_id: FH.staffId }));
    await as(OWN, (db) => setHours(db, A.b1, [{ weekday: 1, opens: "09:00", closes: "20:00" }, { weekday: 2, opens: "09:00", closes: "12:00" }, { weekday: 2, opens: "13:00", closes: "20:00" }]));
    const today = localDay("Asia/Jakarta", 3);
    const c = await as(MGR, (db) => addClosure(db, A.b1, { date: today, reason: "Renovasi lantai" }));
    const room = await as(MGR, (db) => upsertRoom(db, A.b1, { name: "Ruang Tindakan 1", kind: "treatment" }));
    const dev = await as(MGR, (db) => upsertDevice(db, A.b1, { type: "laser_non_ablative", label: "Laser A" }));
    const svc = (await as(OWN, (db) => publish(db, { kind: "service", code: "CB-S1" }, { name: "Facial", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 100_000 }, "Layanan"))).itemId;
    await as(AP, (db) => setServices(db, A.b1, [svc]));
    const b = await as(FO, (db) => getBranch(db, A.b1));
    expect(b).toMatchObject({ name: "Cabang Kemang", whatsappNumber: "+6281211112222", nib: "1234567890123", responsibleStaffId: FH.staffId });
    expect(licenceComplete(b!)).toBe(true);
    // Every SET-46 field counts (mutation run: ts-licence-partial).
    for (const k of ["licenceNumber", "nib", "responsibleStaffId", "satusehatOrgId"] as const) expect(licenceComplete({ ...b!, [k]: null }), k).toBe(false);
    expect(await as(FO, (db) => weeklyHours(db, A.b1))).toEqual([{ weekday: 1, opens: "09:00", closes: "20:00" }, { weekday: 2, opens: "09:00", closes: "12:00" }, { weekday: 2, opens: "13:00", closes: "20:00" }]);
    expect(await as(FO, (db) => closures(db, A.b1))).toEqual([{ id: c, date: today, from: null, until: null, reason: "Renovasi lantai" }]);
    expect(await as(FO, (db) => branchRooms(db, A.b1))).toEqual([{ id: room, name: "Ruang Tindakan 1", kind: "treatment", satusehatLocationId: null, active: true }]);
    expect(await as(FO, (db) => branchDevices(db, A.b1))).toEqual([{ id: dev, type: "laser_non_ablative", label: "Laser A", active: true }]);
    expect(await as(FO, (db) => offeredServices(db, A.b1))).toEqual([svc]);
    const audit = (await h.admin.query(`select reason_code from audit_events where tenant_id = $1 and reason_code like 'branch_%' order by seq`, [A.tenantId])).rows.map((r) => r.reason_code);
    expect(audit).toEqual(["branch_profile", "branch_hours", "branch_closures", "branch_rooms", "branch_devices", "branch_services"]);
    const ev = (await h.admin.query(`select payload from domain_events where type = 'BranchChanged' and aggregate_id = $1 order by occurred_at, id`, [A.b1])).rows.map((r) => r.payload.section);
    expect(ev).toEqual(["profile", "hours", "closures", "rooms", "devices", "services"]);
  });

  it("Owner and Admin Pusat add a branch (the onboarding checklist follows); others cannot; codes are unique", async () => {
    const id = await as(AP, (db) => createBranch(db, { code: "bsd-1", name: "Cabang BSD", timezone: "Asia/Jakarta" }));
    expect(await as(FO, (db) => getBranch(db, id))).toMatchObject({ code: "BSD-1", name: "Cabang BSD" });
    expect(await code(as(OWN, (db) => createBranch(db, { code: "BSD-1", name: "Lagi", timezone: "Asia/Jakarta" })))).toBe("ERR_VERSION_CONFLICT");
    expect(await code(as(OWN, (db) => createBranch(db, { code: "X", name: "Pendek", timezone: "Asia/Jakarta" })))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(OWN, (db) => createBranch(db, { code: "SG-1", name: "Singapura", timezone: "Asia/Singapore" })))).toBe("ERR_INVALID_INPUT");
    for (const p of [MGR, FH, FO, FIN, DOC]) expect(await code(as(p, (db) => createBranch(db, { code: `Z-${p.role.slice(0, 4).toUpperCase()}`, name: "Coba", timezone: "Asia/Jakarta" }))), p.role).toBe("ERR_FORBIDDEN");
    // An onboarding tenant gets its branch_setup checklist item by the existing trigger (0051).
    const t = await tenant("onboarding");
    const o = await person(t, "owner");
    const nb = await as(o, (db) => createBranch(db, { code: "NEW-1", name: "Cabang Baru", timezone: "Asia/Makassar" }));
    expect((await h.admin.query(`select item from onboarding_checklist_items where branch_id = $1`, [nb])).rows).toEqual([{ item: "branch_setup" }]);
  });
});

describe("authority per section (plan r1 open point 2, P1-4)", () => {
  it("the manager changes hours, closures, rooms and devices of their own branch only, and never the profile or services", async () => {
    expect(await code(as(MGR, (db) => setHours(db, A.b1, [{ weekday: 3, opens: "10:00", closes: "18:00" }])))).toBe("ok");
    expect(await code(as(MGR, (db) => setHours(db, A.b2, [{ weekday: 3, opens: "10:00", closes: "18:00" }])))).toBe("ERR_NOT_FOUND");
    expect(await code(as(MGR, (db) => updateProfile(db, A.b1, { name: "Ganti Nama" })))).toBe("ERR_FORBIDDEN");
    expect(await code(as(MGR, (db) => setServices(db, A.b1, [])))).toBe("ERR_FORBIDDEN");
    for (const p of [FH, FO, FIN, DOC]) {
      expect(await code(as(p, (db) => setHours(db, A.b1, []))), p.role).toBe("ERR_FORBIDDEN");
      expect(await code(as(p, (db) => updateProfile(db, A.b1, { name: "X Y" }))), p.role).toBe("ERR_FORBIDDEN");
    }
  });

  it("a manager of another branch is refused on this branch's rows by id; an upsert cannot move a room or device to another branch", async () => {
    const room = await as(MGR, (db) => upsertRoom(db, A.b1, { name: "Ruang Konsul", kind: "consultation" }));
    const dev = await as(MGR, (db) => upsertDevice(db, A.b1, { type: "ipl", label: "IPL 1" }));
    const cl = await as(MGR, (db) => addClosure(db, A.b1, { date: localDay("Asia/Jakarta", 5), reason: "Pelatihan staf" }));
    expect(await code(as(MGR2, (db) => setRoomActive(db, room, false)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(MGR2, (db) => setDeviceActive(db, dev, false)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(MGR2, (db) => removeClosure(db, cl)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(MGR2, (db) => upsertRoom(db, A.b1, { id: room, name: "Ambil Alih", kind: "treatment" })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(MGR2, (db) => upsertDevice(db, A.b1, { id: dev, type: "ipl", label: "Ambil Alih" })))).toBe("ERR_NOT_FOUND");
    // Naming their own branch with this branch's row id is still not-found (impl review r1 P3-2).
    expect(await code(as(MGR2, (db) => upsertRoom(db, A.b2, { id: room, name: "Ambil Alih", kind: "treatment" })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(MGR2, (db) => upsertDevice(db, A.b2, { id: dev, type: "ipl", label: "Ambil Alih" })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(OWN, (db) => upsertRoom(db, A.b2, { id: room, name: "Pindah", kind: "treatment" })))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(OWN, (db) => upsertDevice(db, A.b2, { id: dev, type: "ipl", label: "Pindah" })))).toBe("ERR_INVALID_INPUT");
    expect(await as(FO, (db) => branchRooms(db, A.b1, { kind: "consultation" }))).toMatchObject([{ id: room, active: true }]);
  });

  it("Owner and Admin Pusat with branch C1 selected change branch C2 (HYG-009 N2)", async () => {
    expect(await code(as(OWN, (db) => updateProfile(db, A.b2, { address: "Jl. Cabang Dua" }), A.b1))).toBe("ok");
    expect(await code(as(AP, (db) => setHours(db, A.b2, [{ weekday: 0, opens: "10:00", closes: "16:00" }]), A.b1))).toBe("ok");
    expect(await code(as(AP, (db) => upsertRoom(db, A.b2, { name: "Ruang Farmasi", kind: "pharmacy" }), A.b1))).toBe("ok");
  });
});

describe("validation", () => {
  it("hours: overlap, opens >= closes, a bad weekday or format are refused; 24:00 is allowed", async () => {
    expect(await reason(as(OWN, (db) => setHours(db, A.mks, [{ weekday: 1, opens: "09:00", closes: "13:00" }, { weekday: 1, opens: "12:00", closes: "17:00" }])))).toBe("ERR_INVALID_INPUT:hours_overlap");
    expect(await reason(as(OWN, (db) => setHours(db, A.mks, [{ weekday: 1, opens: "13:00", closes: "13:00" }])))).toBe("ERR_INVALID_INPUT:hours_range");
    expect(await reason(as(OWN, (db) => setHours(db, A.mks, [{ weekday: 7, opens: "09:00", closes: "13:00" }])))).toBe("ERR_INVALID_INPUT:hours_range");
    expect(await reason(as(OWN, (db) => setHours(db, A.mks, [{ weekday: 1, opens: "9:00", closes: "13:00" }])))).toBe("ERR_INVALID_INPUT:hours_format");
    expect(await code(as(OWN, (db) => setHours(db, A.mks, [{ weekday: 6, opens: "18:00", closes: "24:00" }])))).toBe("ok");
    expect(await as(FO, (db) => weeklyHours(db, A.mks))).toEqual([{ weekday: 6, opens: "18:00", closes: "24:00" }]);
  });

  it("profile: WhatsApp format, https map links, 13-digit NIB, a publish window that ends after it starts, a responsible person active in this tenant", async () => {
    for (const [f, why] of [
      [{ whatsapp_number: "08123" }, "branches_whatsapp_check"], [{ map_url: "http://maps.example/x" }, "branches_map_url_check"], [{ nib: "12345" }, "branches_nib_check"],
      [{ publish_from: "2027-01-02T00:00:00Z", publish_until: "2027-01-01T00:00:00Z" }, "branches_publish_check"], [{ name: "X" }, "name"],
      [{ timezone: null }, "timezone"], [{ timezone: "Asia/Singapore" }, "timezone"],
    ] as [Record<string, string | null>, string][]) {
      expect(await reason(as(OWN, (db) => updateProfile(db, A.mks, f))), why).toBe(`ERR_INVALID_INPUT:${why}`);
    }
    const bDoc = await person(B, "doctor", B.b1);
    expect(await reason(as(OWN, (db) => updateProfile(db, A.mks, { responsible_staff_id: bDoc.staffId })))).toBe("ERR_INVALID_INPUT:responsible_staff");
    const gone = await person(A, "facility_head", A.mks);
    await h.admin.query(`update memberships set effective_to = now() where id = (select membership_id from staff where id = $1)`, [gone.staffId]);
    expect(await reason(as(OWN, (db) => updateProfile(db, A.mks, { responsible_staff_id: gone.staffId })))).toBe("ERR_INVALID_INPUT:responsible_staff");
    // Clearing an optional field with an empty string; omitted keys keep their value.
    await as(OWN, (db) => updateProfile(db, A.mks, { whatsapp_number: "+6281299998888", address: "Jl. Makassar" }));
    await as(OWN, (db) => updateProfile(db, A.mks, { whatsapp_number: "" }));
    expect(await as(FO, (db) => getBranch(db, A.mks))).toMatchObject({ whatsappNumber: null, address: "Jl. Makassar" });
  });

  it("services: only catalog services with an active version, from this tenant, through the writer and directly", async () => {
    const prod = (await as(OWN, (db) => publish(db, { kind: "product", code: "CB-P1" }, { name: "Serum", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 50_000 }, "Produk"))).itemId;
    const pending = (await as(OWN, (db) => publish(db, { kind: "service", code: "CB-S2" }, { name: "Peeling", tax_category: "exempt_medical", tax_basis: "Jasa", normal_price: 80_000, indications: "Jerawat" }, "Layanan"))).itemId;
    const bSvc = (await as(await person(B, "owner"), (db) => publish(db, { kind: "service", code: "CB-B1" }, { name: "Facial B", tax_category: "exempt_medical", tax_basis: "Jasa", normal_price: 1 }, "Layanan B"))).itemId;
    for (const [item, label] of [[prod, "product"], [pending, "no active version"], [bSvc, "other tenant"]]) {
      expect(await code(as(OWN, (db) => setServices(db, A.b2, [item]))), label).toBe("ERR_INVALID_INPUT");
    }
    await expect(h.admin.query(`insert into branch_services (tenant_id, branch_id, item_id) values ($1, $2, $3)`, [A.tenantId, A.b2, prod])).rejects.toThrow(/services_only/);
    expect(await as(FO, (db) => offeredServices(db, A.b2))).toEqual([]);
  });
});

describe("closures in branch time (owner-approved rule: today or later)", () => {
  it("today in the branch timezone can be added and removed; yesterday is refused; a past closure is kept; overlaps are refused", async () => {
    for (const [branch, tz] of [[A.jyp, "Asia/Jayapura"], [A.mks, "Asia/Makassar"]] as const) {
      const today = localDay(tz);
      const id = await as(OWN, (db) => addClosure(db, branch, { date: today, from: "12:00", until: "13:00", reason: "Rapat darurat" }));
      expect(await reason(as(OWN, (db) => addClosure(db, branch, { date: today, from: "12:30", until: "14:00", reason: "Bentrok" })))).toBe("ERR_VERSION_CONFLICT:closure_overlap");
      expect(await reason(as(OWN, (db) => addClosure(db, branch, { date: today, reason: "Sehari penuh bentrok" })))).toBe("ERR_VERSION_CONFLICT:closure_overlap");
      expect(await code(as(OWN, (db) => addClosure(db, branch, { date: today, from: "13:00", until: "14:00", reason: "Bersebelahan" })))).toBe("ok");
      expect(await code(as(OWN, (db) => removeClosure(db, id)))).toBe("ok");
      expect(await reason(as(OWN, (db) => addClosure(db, branch, { date: localDay(tz, -1), reason: "Kemarin" })))).toBe("ERR_INVALID_INPUT:closure_date");
    }
    // A past closure (inserted with the guard off, as history would be) cannot be removed or edited.
    await h.admin.query(`alter table branch_closures disable trigger branch_closures_guard`);
    const past = (await h.admin.query(`insert into branch_closures (tenant_id, branch_id, closed_on, reason, created_by) values ($1, $2, current_date - 10, 'Libur lama', $3) returning id`, [A.tenantId, A.b2, OWN.staffId])).rows[0].id;
    await h.admin.query(`alter table branch_closures enable trigger branch_closures_guard`);
    expect(await reason(as(OWN, (db) => removeClosure(db, past)))).toBe("ERR_VERSION_CONFLICT:closure_past");
    await expect(h.admin.query(`delete from branch_closures where id = $1`, [past])).rejects.toThrow(/in the past is kept/);
    await expect(h.admin.query(`update branch_closures set reason = 'ubah' where id = $1`, [past])).rejects.toThrow(/never edited/);
    expect(await reason(as(OWN, (db) => addClosure(db, A.b2, { date: localDay("Asia/Jakarta", 2), from: "12:00", reason: "Separuh" })))).toBe("ERR_INVALID_INPUT:branch_closures_range_check");
    expect(await reason(as(OWN, (db) => addClosure(db, A.b2, { date: localDay("Asia/Jakarta", 2), reason: "x" })))).toBe("ERR_INVALID_INPUT:branch_closures_reason_check");
  });
});

describe("branch_is_open (plan r1 P1-2; scenario PR-2 fixture)", () => {
  it("09:00-20:00 with a midday break and a closure date, in WIB, WITA and WIT: instants, intervals and boundaries", async () => {
    for (const [branch, tz] of [[A.b2, "Asia/Jakarta"], [A.mks, "Asia/Makassar"], [A.jyp, "Asia/Jayapura"]] as const) {
      const d1 = localDay(tz, 7); // an open day
      const d2 = localDay(tz, 8); // its closure day
      const wd1 = weekdayOf(d1);
      const wd2 = weekdayOf(d2);
      await as(OWN, (db) => setHours(db, branch, [
        { weekday: wd1, opens: "09:00", closes: "12:00" }, { weekday: wd1, opens: "13:00", closes: "20:00" }, { weekday: wd2, opens: "09:00", closes: "20:00" },
      ]));
      await as(OWN, (db) => addClosure(db, branch, { date: d2, reason: "Libur nasional" }));
      await as(OWN, (db) => addClosure(db, branch, { date: d1, from: "15:00", until: "16:00", reason: "Rapat" }));
      const open = (a: string, b?: string, d = d1) => as(FO, (db) => isOpen(db, branch, at(tz, d, a), b ? at(tz, d, b) : undefined));
      expect(await open("09:00"), tz).toBe(true);
      expect(await open("08:59"), tz).toBe(false);
      expect(await open("12:00"), tz).toBe(false); // the break
      expect(await open("20:00"), tz).toBe(false);
      expect(await open("09:00", "12:00"), tz).toBe(true);
      expect(await open("11:30", "13:30"), tz).toBe(false); // across the break
      expect(await open("19:30", "20:20"), tz).toBe(false); // past closing
      expect(await open("14:00", "15:00"), tz).toBe(true); // up to the partial closure
      expect(await open("14:30", "15:30"), tz).toBe(false); // into the partial closure
      expect(await open("16:00", "17:00"), tz).toBe(true);
      expect(await open("10:00", undefined, d2), tz).toBe(false); // scenario PR-2: no slot on the closure date
    }
  });

  it("a slot ending at midnight is open with 24:00; an interval across midnight is not; unknown and foreign branches are false, never null", async () => {
    const d = localDay("Asia/Jakarta", 9);
    await as(OWN, (db) => setHours(db, A.b1, [{ weekday: weekdayOf(d), opens: "18:00", closes: "24:00" }]));
    expect(await as(FO, (db) => isOpen(db, A.b1, at("Asia/Jakarta", d, "23:00"), new Date(at("Asia/Jakarta", d, "23:00").getTime() + 3_600_000)))).toBe(true);
    expect(await as(FO, (db) => isOpen(db, A.b1, at("Asia/Jakarta", d, "23:30"), new Date(at("Asia/Jakarta", d, "23:30").getTime() + 3_600_000)))).toBe(false);
    expect(await as(FO, (db) => isOpen(db, A.b1, at("Asia/Jakarta", d, "19:00"), at("Asia/Jakarta", d, "18:00")))).toBe(false);
    // Tenant B's branch is open then by its own hours, yet A's caller gets false (mutation run: open-foreign).
    const bOwner = await person(B, "owner");
    await as(bOwner, (db) => setHours(db, B.b1, [{ weekday: weekdayOf(d), opens: "18:00", closes: "22:00" }]));
    expect(await as(bOwner, (db) => isOpen(db, B.b1, at("Asia/Jakarta", d, "19:00")))).toBe(true);
    expect(await as(FO, (db) => isOpen(db, B.b1, at("Asia/Jakarta", d, "19:00")))).toBe(false);
    expect(await as(FO, (db) => isOpen(db, "00000000-0000-7000-8000-000000000000", at("Asia/Jakarta", d, "19:00")))).toBe(false);
  });
});

describe("guards, readers, vendor support, cross-tenant", () => {
  it("branches, rooms and devices are never deleted; codes and a resource's branch never change; hours and services change only through writers", async () => {
    const room = await as(OWN, (db) => upsertRoom(db, A.b2, { name: "Ruang Guard", kind: "treatment" }));
    const dev = await as(OWN, (db) => upsertDevice(db, A.b2, { type: "rf", label: "RF Guard" }));
    await expect(h.admin.query(`delete from branches where id = $1`, [A.b2])).rejects.toThrow(/never deleted/);
    await expect(h.admin.query(`update branches set code = 'ZZ' where id = $1`, [A.b2])).rejects.toThrow(/keeps its id, tenant and code/);
    await expect(h.admin.query(`delete from rooms where id = $1`, [room])).rejects.toThrow(/never deleted/);
    await expect(h.admin.query(`update rooms set branch_id = $2 where id = $1`, [room, A.b1])).rejects.toThrow(/keeps its branch/);
    await expect(h.admin.query(`update branch_devices set branch_id = $2 where id = $1`, [dev, A.b1])).rejects.toThrow(/keeps its branch/);
    for (const t of ["branches", "rooms", "branch_devices", "branch_closures", "branch_hours", "branch_services"]) {
      await expect(h.admin.query(`truncate ${t} cascade`), t).rejects.toThrow();
    }
    await expect(as(OWN, (db) => db.query(`insert into branch_hours (tenant_id, branch_id, weekday, opens, closes) values ($1, $2, 1, '09:00', '10:00')`, [A.tenantId, A.b2]))).rejects.toThrow(/permission denied/);
    await expect(as(OWN, (db) => db.query(`update branches set name = 'langsung' where id = $1`, [A.b2]))).rejects.toThrow(/permission denied/);
    // Deactivated, not deleted; reactivated.
    await as(OWN, (db) => setRoomActive(db, room, false));
    expect(await as(FO, (db) => branchRooms(db, A.b2, { activeOnly: true }))).not.toContainEqual(expect.objectContaining({ id: room }));
    await as(OWN, (db) => setRoomActive(db, room, true));
    expect(await as(FO, (db) => branchRooms(db, A.b2, { activeOnly: true }))).toContainEqual(expect.objectContaining({ id: room }));
  });

  it("every member reads the branch master; the support class is config with one operator policy per table; rooms and devices are branch-scoped", async () => {
    for (const p of [FO, FIN, DOC, FH]) expect((await as(p, (db) => listBranches(db))).length, p.role).toBeGreaterThanOrEqual(4);
    const classes = (await h.admin.query(`select support_class from support_object_kinds where table_name in ('public.branch_hours','public.branch_closures','public.rooms','public.branch_devices','public.branch_services')`)).rows;
    expect(classes.map((c) => c.support_class)).toEqual(["config", "config", "config", "config", "config"]);
    expect((await h.admin.query(`select count(*)::int as n from pg_policies where 'clinic_operator' = any (roles) and tablename in ('branch_hours','branch_closures','rooms','branch_devices','branch_services')`)).rows[0].n).toBe(5);
    expect((await h.admin.query(`select table_name, policy_kind from scope_map where table_name in ('public.rooms','public.branch_devices') order by 1`)).rows)
      .toEqual([{ table_name: "public.branch_devices", policy_kind: "branch-scoped" }, { table_name: "public.rooms", policy_kind: "branch-scoped" }]);
  });

  it("tenant B neither reads nor changes A's branches, rows or hours", async () => {
    const bOwn = await person(B, "owner");
    const room = await as(OWN, (db) => upsertRoom(db, A.b1, { name: "Ruang Rahasia", kind: "treatment" }));
    expect(await as(bOwn, (db) => getBranch(db, A.b1))).toBeNull();
    expect(await as(bOwn, (db) => branchRooms(db, A.b1))).toEqual([]);
    expect(await as(bOwn, (db) => weeklyHours(db, A.b1))).toEqual([]);
    expect(await code(as(bOwn, (db) => updateProfile(db, A.b1, { name: "Diambil" })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(bOwn, (db) => setHours(db, A.b1, [])))).toBe("ERR_NOT_FOUND");
    expect(await code(as(bOwn, (db) => setRoomActive(db, room, false)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(bOwn, (db) => addClosure(db, A.b1, { date: localDay("Asia/Jakarta", 1), reason: "Diambil alih" })))).toBe("ERR_NOT_FOUND");
    expect((await as(OWN, (db) => branchRooms(db, A.b1))).find((r) => r.id === room)?.active).toBe(true);
  });
});
