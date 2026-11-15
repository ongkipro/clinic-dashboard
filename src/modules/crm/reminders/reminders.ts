// Appointment reminders (PR-69; T-095, migration 0110, DEC-107). An unbound worker scan queues an H-1 and a same-day reminder per booked or
// confirmed appointment through the T-094 outbound queue (SET-18 send times per branch, never 21:00–07:00; budget, consent and suspension
// from the queue), with a neutral template: clinic, branch, date and time — never a service (PRIV-15). The patient's Konfirmasi reply
// confirms the appointment and Ubah Jadwal opens a CS follow-up (PR-83); the webhook calls reminder_reply_handle (inbox.ts). The platform
// worker runs the scan every few minutes, then the outbound dispatch.
import type pg from "pg";

export type ReminderScanResult = { queued: number; refused: number };

export async function runReminderScan(worker: pg.Pool | pg.ClientBase, now?: Date): Promise<ReminderScanResult> {
  const r = await worker.query<{ r: ReminderScanResult }>(`select reminder_scan($1::timestamptz) r`, [now?.toISOString() ?? null]);
  return r.rows[0].r;
}
