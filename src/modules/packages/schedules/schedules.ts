// Reminder-only instalment schedules (PR-96, BILL-9, DATA-67; T-083, migration 0099, DEC-096). FO/cashier, a manager, finance or the
// owner records the agreed dates and amounts for a package or a receivable; the schedule never unlocks a session, creates a debt, a
// journal, interest or an entitlement (BILL-9) — payments still unlock by paid value. A row overdue and not covered by what was paid since
// the schedule was set raises one reminder for FO/cashier (instalment_reminder_scan, scan.ts). Replacing a schedule makes a new version;
// a closing or fully paid target cancels it automatically.
import type pg from "pg";
import { runCommand, type Json } from "../../../lib/command";
import { assertProductionGoLive } from "../../vendor/profile/profile";
import { call } from "../packages";

async function command<T extends Json>(db: pg.ClientBase, name: string, key: string, body: Record<string, Json>, sql: string, args: unknown[]) {
  await assertProductionGoLive(db);
  const out = await call(() => runCommand<T>(db, { command: name, key, body }, async (c) => ((await c.query(sql, args)).rows[0]?.r ?? null) as T));
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}

export type ScheduleTarget = { packageId: string } | { receivableId: string };
export type ScheduleRowInput = { dueOn: string; amount: number };
export async function setInstalmentSchedule(db: pg.ClientBase, key: string, target: ScheduleTarget, rows: ScheduleRowInput[]) {
  const p = { ...("packageId" in target ? { package_id: target.packageId } : { receivable_id: target.receivableId }),
    rows: rows.map((r) => ({ due_on: r.dueOn, amount: r.amount })) };
  const out = await command<string>(db, "instalment_schedule_set", key, p, `select instalment_schedule_set($1, $2::jsonb) as r`, [key, JSON.stringify(p)]);
  return { scheduleId: out.result, replayed: out.replayed };
}
export async function cancelInstalmentSchedule(db: pg.ClientBase, key: string, scheduleId: string) {
  await command<null>(db, "instalment_schedule_cancel", key, { schedule_id: scheduleId }, `select instalment_schedule_cancel($1) as r`, [scheduleId]);
}

export type ScheduleRow = { seq: number; due_on: string; amount: number; reminded_on: string | null; covered: boolean; overdue: boolean; linked_payments: string[] };
export type ScheduleVersion = {
  id: string; version: number; state: "active" | "cancelled"; cancel_reason: "replaced" | "target_closed" | "paid" | "manual" | null;
  base_paid: number; created_at: string; rows: ScheduleRow[];
};
export type InstalmentSchedules = { paid: number; open: number; today: string; can_set: boolean; schedules: ScheduleVersion[] };
export const instalmentSchedules = (db: pg.ClientBase, target: ScheduleTarget) =>
  call(async () => (await db.query(`select instalment_schedule_get($1, $2) as r`,
    ["packageId" in target ? target.packageId : null, "receivableId" in target ? target.receivableId : null])).rows[0].r as InstalmentSchedules);
