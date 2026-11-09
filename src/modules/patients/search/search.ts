// Daftar Pasien search and saved segments (PR-76; T-041, DEC-060). Every call runs inside
// withTenantContext. The query is an argument only: never put in a URL, a log line or a stored row. The
// rate limit is a committed outcome: the database counts every search, raises the hourly alert and
// answers ERR_RATE_LIMITED without raising, and searchPatients returns it as a value — throwing inside
// withTenantContext would roll back the count and the alert (found by the test). Callers throw, if they
// want to, after the transaction. Segment writers go through runCommand (the go-live gate first).
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../../lib/command";
import { assertProductionGoLive } from "../../vendor/profile/profile";

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_TENANT_SUSPENDED"]);

export class SearchError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CommandError) throw e;
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new SearchError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}

export type Filters = { branch_id?: string; last_visit?: "30d" | "90d" | "never"; visiting_now?: boolean };
export type Row = {
  id: string; mrn: string; fullName: string; birthYear: number; maskedPhone: string | null; registeredBranchId: string; registeredBranch: string;
  openVisitBranch: string | null; lastVisitAt: Date | null;
};
export type Page = { ok: true; rows: Row[]; more: boolean } | { ok: false; code: "ERR_RATE_LIMITED" };

// One page of results; `after` is the last row's id of the previous page. A rate-limited search is a
// value, not an exception (see above).
export async function searchPatients(db: pg.ClientBase, query: string, filters: Filters = {}, after: string | null = null): Promise<Page> {
  const r = (await call(() => db.query(`select patient_search($1, $2::jsonb, $3) as r`, [query, JSON.stringify(filters), after]))).rows[0].r as
    { ok: boolean; code?: string; rows?: Record<string, unknown>[]; more?: boolean };
  if (!r.ok) return { ok: false, code: "ERR_RATE_LIMITED" };
  return {
    ok: true,
    more: Boolean(r.more),
    rows: (r.rows ?? []).map((x) => ({
      id: x.id as string, mrn: x.mrn as string, fullName: x.full_name as string, birthYear: x.birth_year as number,
      maskedPhone: (x.masked_phone as string | null) ?? null, registeredBranchId: x.registered_branch_id as string, registeredBranch: x.registered_branch as string,
      openVisitBranch: (x.open_visit_branch as string | null) ?? null, lastVisitAt: x.last_visit_at ? new Date(x.last_visit_at as string) : null,
    })),
  };
}

export type Segment = { id: string; name: string; filters: Filters; updatedAt: Date };
export async function mySegments(db: pg.ClientBase): Promise<Segment[]> {
  const r = await db.query(`select id, name, filters, updated_at from patient_segments order by name, id`);
  return r.rows.map((x) => ({ id: x.id, name: x.name, filters: x.filters as Filters, updatedAt: x.updated_at }));
}

async function command<T extends Json>(db: pg.ClientBase, command: string, key: string, body: Record<string, Json>, sql: string, args: unknown[]) {
  await assertProductionGoLive(db);
  const out = await call(() => runCommand<T>(db, { command, key, body }, async (c) => ((await c.query(sql, args)).rows[0]?.r ?? null) as T));
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}
export async function saveSegment(db: pg.ClientBase, key: string, name: string, filters: Filters) {
  const out = await command<string>(db, "patients.segment_save", key, { name, filters: filters as Json }, `select segment_save($1, $2::jsonb) as r`, [name, JSON.stringify(filters)]);
  return { segmentId: out.result as string, replayed: out.replayed };
}
export const deleteSegment = (db: pg.ClientBase, key: string, id: string) =>
  command<null>(db, "patients.segment_delete", key, { id }, `select segment_delete($1) as r`, [id]);

// Marketing's view (TEN-18, DEC-052): consented contacts only, the phone masked here so the raw number
// never reaches the page (plan r1 P2-2).
export const maskPhone = (p: string | null) => (p ? `${p.slice(0, 3)}${"•".repeat(Math.max(p.length - 7, 0))}${p.slice(-4)}` : null);
