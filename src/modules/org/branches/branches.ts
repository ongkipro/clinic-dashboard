// Branch master (PR-2, DATA-11, DATA-46, SET-2, SET-3, SET-46; T-036). Every call runs inside
// withTenantContext; the database (migration 0058) decides authority per section (Owner and Admin Pusat
// everything; the manager of the branch its hours, closures, rooms and devices), validation, the
// closure date rule in branch time, services-only, and immutability.
import type pg from "pg";
import { CommandError, type ErrorCode } from "../../../lib/command";

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_VERSION_CONFLICT", "ERR_INVALID_INPUT"]);

export class BranchError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new BranchError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}

export const TIMEZONES = ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"] as const;
export type Timezone = (typeof TIMEZONES)[number];

export type Branch = {
  id: string; code: string; name: string; timezone: Timezone; address: string | null; mapUrl: string | null; whatsappNumber: string | null;
  licenceNumber: string | null; nib: string | null; facilityCode: string | null; satusehatOrgId: string | null; responsibleStaffId: string | null;
  publishFrom: Date | null; publishUntil: Date | null;
};
const branchRow = (r: Record<string, unknown>): Branch => ({
  id: r.id as string, code: r.code as string, name: r.name as string, timezone: r.timezone as Timezone, address: (r.address as string | null) ?? null,
  mapUrl: (r.map_url as string | null) ?? null, whatsappNumber: (r.whatsapp_number as string | null) ?? null, licenceNumber: (r.licence_number as string | null) ?? null,
  nib: (r.nib as string | null) ?? null, facilityCode: (r.facility_code as string | null) ?? null, satusehatOrgId: (r.satusehat_org_id as string | null) ?? null,
  responsibleStaffId: (r.responsible_staff_id as string | null) ?? null, publishFrom: (r.publish_from as Date | null) ?? null, publishUntil: (r.publish_until as Date | null) ?? null,
});

// SET-46: the licence data required before clinical go-live (plan r1 open point 3).
export const licenceComplete = (b: Branch) => !!(b.licenceNumber && b.nib && b.responsibleStaffId && b.satusehatOrgId);

export async function listBranches(db: pg.ClientBase): Promise<Branch[]> {
  return (await db.query(`select * from branches order by name, code`)).rows.map(branchRow);
}
export async function getBranch(db: pg.ClientBase, id: string): Promise<Branch | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const r = (await db.query(`select * from branches where id = $1`, [id])).rows[0];
  return r ? branchRow(r) : null;
}

export async function createBranch(db: pg.ClientBase, i: { code: string; name: string; timezone: string }): Promise<string> {
  return (await call(() => db.query(`select branch_create($1, $2, $3) as id`, [i.code, i.name, i.timezone]))).rows[0].id;
}

export type ProfileFields = Partial<{
  name: string; timezone: string; address: string; whatsapp_number: string; map_url: string; licence_number: string; nib: string;
  facility_code: string; satusehat_org_id: string; responsible_staff_id: string; publish_from: string; publish_until: string;
}>;
export async function updateProfile(db: pg.ClientBase, branchId: string, fields: ProfileFields): Promise<void> {
  await call(() => db.query(`select branch_update_profile($1, $2::jsonb)`, [branchId, JSON.stringify(fields)]));
}

// Weekly hours; weekday follows EXTRACT(DOW): 0 = Minggu … 6 = Sabtu; times "HH:MM", closes may be "24:00".
export type Interval = { weekday: number; opens: string; closes: string };
export async function setHours(db: pg.ClientBase, branchId: string, weekly: Interval[]): Promise<void> {
  await call(() => db.query(`select branch_set_hours($1, $2::jsonb)`, [branchId, JSON.stringify(weekly)]));
}
export async function weeklyHours(db: pg.ClientBase, branchId: string): Promise<Interval[]> {
  return (await db.query(
    `select weekday, to_char(opens, 'HH24:MI') as opens,
            case when closes = time '23:59:59.999999' then '24:00' else to_char(closes, 'HH24:MI') end as closes
       from branch_hours where branch_id = $1 order by weekday, opens`,
    [branchId],
  )).rows.map((r) => ({ weekday: r.weekday, opens: r.opens, closes: r.closes }));
}

export type Closure = { id: string; date: string; from: string | null; until: string | null; reason: string };
export async function addClosure(db: pg.ClientBase, branchId: string, c: { date: string; from?: string | null; until?: string | null; reason: string }): Promise<string> {
  return (await call(() => db.query(`select branch_closure_add($1, $2::date, $3::time, $4::time, $5) as id`, [branchId, c.date, c.from ?? null, c.until ?? null, c.reason]))).rows[0].id;
}
export async function removeClosure(db: pg.ClientBase, id: string): Promise<void> {
  await call(() => db.query(`select branch_closure_remove($1)`, [id]));
}
// Closures of a branch from a local date on (default: all), oldest first.
export async function closures(db: pg.ClientBase, branchId: string, fromDate?: string, toDate?: string): Promise<Closure[]> {
  return (await db.query(
    `select id, to_char(closed_on, 'YYYY-MM-DD') as d, to_char(from_time, 'HH24:MI') as f, to_char(until_time, 'HH24:MI') as u, reason
       from branch_closures where branch_id = $1 and ($2::date is null or closed_on >= $2::date) and ($3::date is null or closed_on <= $3::date)
      order by closed_on, from_time nulls first`,
    [branchId, fromDate ?? null, toDate ?? null],
  )).rows.map((r) => ({ id: r.id, date: r.d, from: r.f, until: r.u, reason: r.reason }));
}

export type Room = { id: string; name: string; kind: string; satusehatLocationId: string | null; active: boolean };
export type Device = { id: string; type: string; label: string; active: boolean };
export async function upsertRoom(db: pg.ClientBase, branchId: string, r: { id?: string | null; name: string; kind: string; satusehatLocationId?: string | null }): Promise<string> {
  return (await call(() => db.query(`select room_upsert($1, $2, $3, $4, $5) as id`, [branchId, r.id ?? null, r.name, r.kind, r.satusehatLocationId ?? null]))).rows[0].id;
}
export async function setRoomActive(db: pg.ClientBase, id: string, active: boolean): Promise<void> {
  await call(() => db.query(`select room_set_active($1, $2)`, [id, active]));
}
export async function upsertDevice(db: pg.ClientBase, branchId: string, d: { id?: string | null; type: string; label: string }): Promise<string> {
  return (await call(() => db.query(`select device_upsert($1, $2, $3, $4) as id`, [branchId, d.id ?? null, d.type, d.label]))).rows[0].id;
}
export async function setDeviceActive(db: pg.ClientBase, id: string, active: boolean): Promise<void> {
  await call(() => db.query(`select device_set_active($1, $2)`, [id, active]));
}
// Rooms (optionally active ones of a kind) and devices (optionally active ones of a type) — T-044 readers.
export async function branchRooms(db: pg.ClientBase, branchId: string, o: { kind?: string; activeOnly?: boolean } = {}): Promise<Room[]> {
  return (await db.query(
    `select id, name, kind, satusehat_location_id, is_active from rooms
      where branch_id = $1 and ($2::text is null or kind = $2) and (not $3 or is_active) order by name`,
    [branchId, o.kind ?? null, o.activeOnly ?? false],
  )).rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, satusehatLocationId: r.satusehat_location_id, active: r.is_active }));
}
export async function branchDevices(db: pg.ClientBase, branchId: string, o: { type?: string; activeOnly?: boolean } = {}): Promise<Device[]> {
  return (await db.query(
    `select id, device_type, label, is_active from branch_devices
      where branch_id = $1 and ($2::text is null or device_type = $2) and (not $3 or is_active) order by label`,
    [branchId, o.type ?? null, o.activeOnly ?? false],
  )).rows.map((r) => ({ id: r.id, type: r.device_type, label: r.label, active: r.is_active }));
}

export async function setServices(db: pg.ClientBase, branchId: string, itemIds: string[]): Promise<void> {
  await call(() => db.query(`select branch_set_services($1, $2::uuid[])`, [branchId, itemIds]));
}
export async function offeredServices(db: pg.ClientBase, branchId: string): Promise<string[]> {
  return (await db.query(`select item_id from branch_services where branch_id = $1 order by item_id`, [branchId])).rows.map((r) => r.item_id);
}

// T-044: is the branch open at an instant, or for the whole interval [from, until)?
export async function isOpen(db: pg.ClientBase, branchId: string, from: Date, until?: Date): Promise<boolean> {
  return (await db.query(`select branch_is_open($1, $2, $3) as ok`, [branchId, from, until ?? null])).rows[0].ok;
}
