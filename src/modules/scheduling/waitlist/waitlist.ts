// Waitlist (PR-81; T-099, migration 0114, DEC-111). A patient waits for a service (a catalog item) at a branch; when a scheduled future slot
// of that service at that branch is cancelled or rescheduled, the oldest waiting entry is offered that slot and the branch's FO, CS and
// manager are prompted (a trigger on appointments — staff then offer it to the patient; nothing is sent to the patient). Staff record the
// outcome: booked with the patient's own appointment for that service, or declined (back to waiting). No free text.
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../../lib/command";
import { assertProductionGoLive } from "../../vendor/profile/profile";

export class WaitlistError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
const CODE = /^(ERR_[A-Z_]+):?\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED", "ERR_IDEMPOTENCY_CONFLICT"]);
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CommandError) throw e;
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new WaitlistError(m[1] as ErrorCode, m[2] || undefined);
    throw e;
  }
}

// Keyed (runCommand + command_key): a replay answers the first entry; a second open entry for the same patient, branch and service is refused.
export async function addToWaitlist(db: pg.ClientBase, key: string, input: { branchId: string; patientId: string; itemId: string }) {
  await assertProductionGoLive(db);
  const body = { branch_id: input.branchId, patient_id: input.patientId, item_id: input.itemId };
  const out = await call(() => runCommand<string>(db, { command: "waitlist_add", key, body },
    async (c) => (await c.query(`select waitlist_add($1, $2::jsonb) r`, [key, JSON.stringify(body)])).rows[0].r as string));
  if (!out.ok) throw out.error;
  return { entryId: out.result, replayed: out.replayed };
}
// Keyed (runCommand, as the appointment writers): a replay of the same key and body answers the first result; the same key with another
// body is a conflict. runCommand answers a replay before the definer runs, so the entry is first re-authorized for the current actor
// (waitlist_entry_authorized: role, branch grant, active branch) — a replay never reaches an actor who could not run the command now.
async function keyed<T extends Json>(db: pg.ClientBase, command: string, key: string, entryId: string, body: Record<string, Json>, sql: string, args: unknown[]) {
  await assertProductionGoLive(db);
  await call(() => db.query(`select waitlist_entry_authorized($1)`, [entryId]));
  const out = await call(() => runCommand<T>(db, { command, key, body }, async (c) => ((await c.query(sql, args)).rows[0]?.r ?? null) as T));
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}
export const removeFromWaitlist = async (db: pg.ClientBase, key: string, entryId: string) =>
  (await keyed<null>(db, "waitlist_remove", key, entryId, { entry_id: entryId }, `select waitlist_remove($1) r`, [entryId])).replayed;
// The outcome of one offer: `offeredAppointmentId` names the offered slot the decision is about (a delayed decision for an earlier offer is
// refused once the entry holds a newer one — ERR_VERSION_CONFLICT); bookedAppointmentId null = the patient declined (the entry waits again).
export const recordOfferOutcome = async (db: pg.ClientBase, key: string, entryId: string, offeredAppointmentId: string, bookedAppointmentId: string | null) =>
  (await keyed<"booked" | "waiting">(db, "waitlist_offer_outcome", key, entryId, { entry_id: entryId, offered: offeredAppointmentId, booked: bookedAppointmentId },
    `select waitlist_offer_outcome($1, $2, $3) r`, [entryId, offeredAppointmentId, bookedAppointmentId])).result!;

export type WaitlistRow = { id: string; item_id: string; state: "waiting" | "offered"; patient_id: string; patient_name: string; patient_mrn: string;
  offered_appointment_id: string | null; offered_starts_at: string | null; created_at: string };
export const waitlistList = (db: pg.ClientBase, branchId: string, itemId?: string) =>
  call(async () => (await db.query(`select waitlist_list($1, $2) r`, [branchId, itemId ?? null])).rows[0].r as WaitlistRow[]);
