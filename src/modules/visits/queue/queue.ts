// Queue numbers, walk-in and paired displays (PR-71, NAV-8; T-048, DEC-058). Every staff call runs inside
// withTenantContext; writers go through runCommand with the caller's idempotency key (production needs
// the go-live gate first) and database errors are mapped outside it. The display feed runs outside any
// tenant context with the token's hash and carries numbers and room names only.
import { randomBytes } from "node:crypto";
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../../lib/command";
import { hashToken } from "../../org/staff/staff";
import { assertProductionGoLive } from "../../vendor/profile/profile";

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED"]);

export class QueueError extends CommandError {
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
    if (m && KNOWN.has(m[1])) throw new QueueError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}
async function command<T extends Json>(db: pg.ClientBase, command: string, key: string, body: Record<string, unknown>, sql: string, args: unknown[]) {
  await assertProductionGoLive(db);
  const out = await call(() => runCommand<T>(db, { command, key, body: body as never }, async (c) => ((await c.query(sql, args)).rows[0]?.r ?? null) as T));
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}

export type TicketState = "waiting" | "called" | "skipped" | "done";
export type Ticket = {
  id: string; number: string; seq: number; state: TicketState; calledAt: Date | null; roomId: string | null; roomName: string | null;
  visitId: string; kind: "booked" | "walk_in"; patientId: string; patientName: string; patientMrn: string;
};
export type Board = {
  now: Date; timezone: string; today: string; branchId: string; tickets: Ticket[];
  rooms: { id: string; name: string }[]; displays: { id: string; label: string; createdAt: Date }[];
};

// Antrean of the branch acted on: the active branch, or the named one for Owner and Admin Pusat.
export async function queueBoard(db: pg.ClientBase, branchId: string | null): Promise<Board> {
  const r = (await call(() => db.query(`select queue_board($1) as r`, [branchId]))).rows[0].r as Record<string, unknown>;
  return {
    now: new Date(r.now as string), timezone: r.timezone as string, today: r.today as string, branchId: r.branch_id as string,
    tickets: (r.tickets as Record<string, unknown>[]).map((x) => ({
      id: x.id as string, number: x.number as string, seq: x.seq as number, state: x.state as TicketState, calledAt: x.called_at ? new Date(x.called_at as string) : null,
      roomId: (x.room_id as string | null) ?? null, roomName: (x.room_name as string | null) ?? null, visitId: x.visit_id as string, kind: x.kind as Ticket["kind"],
      patientId: x.patient_id as string, patientName: x.patient_name as string, patientMrn: x.patient_mrn as string,
    })),
    rooms: r.rooms as { id: string; name: string }[],
    displays: (r.displays as Record<string, unknown>[]).map((x) => ({ id: x.id as string, label: x.label as string, createdAt: new Date(x.created_at as string) })),
  };
}

export type Found = { id: string; mrn: string; fullName: string; birthYear: number; maskedPhone: string | null };
export async function searchPatients(db: pg.ClientBase, query: string): Promise<Found[]> {
  const r = (await call(() => db.query(`select queue_patient_search($1) as r`, [query]))).rows[0].r as Record<string, unknown>[];
  return r.map((x) => ({ id: x.id as string, mrn: x.mrn as string, fullName: x.full_name as string, birthYear: x.birth_year as number, maskedPhone: (x.masked_phone as string | null) ?? null }));
}

// Pasien Datang tanpa janji (scenario PR-71): a walk-in visit with the next number of the day.
export async function walkIn(db: pg.ClientBase, key: string, patientId: string, branchId: string | null) {
  const out = await command<{ [k: string]: Json }>(db, "visit.walk_in", key, { patient: patientId, branch: branchId }, `select visit_walk_in($1, $2) as r`, [patientId, branchId]);
  return { visitId: out.result!.visit_id as string, number: out.result!.number as string, replayed: out.replayed };
}
export const callTicket = (db: pg.ClientBase, key: string, ticketId: string, roomId: string) =>
  command<null>(db, "queue.call", key, { ticket: ticketId, room: roomId }, `select queue_call($1, $2) as r`, [ticketId, roomId]);
export const skipTicket = (db: pg.ClientBase, key: string, ticketId: string) =>
  command<null>(db, "queue.skip", key, { ticket: ticketId }, `select queue_skip($1) as r`, [ticketId]);

// Pasangkan Layar TV: the token is made here and never stored (only its hash, plan r1 P1-1); the
// idempotent result holds only the display id, so a replay cannot show the token again.
export async function pairDisplay(db: pg.ClientBase, key: string, branchId: string | null, label: string) {
  const token = randomBytes(32).toString("base64url");
  const out = await command<string>(db, "queue.display_pair", key, { branch: branchId, label }, `select queue_display_pair($1, $2, $3) as r`, [branchId, label, hashToken(token)]);
  return { displayId: out.result as string, token: out.replayed ? null : token, replayed: out.replayed };
}
export const revokeDisplay = (db: pg.ClientBase, key: string, displayId: string) =>
  command<null>(db, "queue.display_revoke", key, { display: displayId }, `select queue_display_revoke($1) as r`, [displayId]);

export type Feed = { branch: string; orientation: "landscape" | "portrait"; voice: boolean; current: { number: string; room: string }[]; next: string[] };
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
// The display's feed, outside any tenant context (the pool's own connection): null for a bad, unknown or
// revoked token.
export async function displayFeed(app: pg.Pool, token: string): Promise<Feed | null> {
  if (!TOKEN.test(token)) return null;
  const r = (await app.query(`select queue_display_feed($1) as r`, [hashToken(token)])).rows[0].r as Feed | null;
  return r ?? null;
}
