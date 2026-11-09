// Duplicate patient merge (PR-85; T-042, DEC-061): a redirect, never a move of rows. The records officer
// merges a duplicate into a survivor and can undo it; while active, the readers resolve the duplicate to
// the survivor and the writers refuse it. Writers go through runCommand (the go-live gate first) and map
// database errors outside it (a raised error rolls back the claim, as consents).
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../../lib/command";
import { assertProductionGoLive } from "../../vendor/profile/profile";

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED"]);

export class MergeError extends CommandError {
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
    if (m && KNOWN.has(m[1])) throw new MergeError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}
async function command<T extends Json>(db: pg.ClientBase, command: string, key: string, body: Record<string, Json>, sql: string, args: unknown[]) {
  await assertProductionGoLive(db);
  const out = await call(() => runCommand<T>(db, { command, key, body }, async (c) => ((await c.query(sql, args)).rows[0]?.r ?? null) as T));
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}

export async function mergePatients(db: pg.ClientBase, key: string, survivorId: string, mergedId: string, reason: string) {
  const out = await command<string>(db, "patients.merge", key, { survivor: survivorId, merged: mergedId, reason },
    `select patient_merge($1, $2, $3) as r`, [survivorId, mergedId, reason]);
  return { mergeId: out.result as string, replayed: out.replayed };
}
export const unmergePatients = (db: pg.ClientBase, key: string, mergeId: string, reason: string) =>
  command<null>(db, "patients.unmerge", key, { merge: mergeId, reason }, `select patient_unmerge($1, $2) as r`, [mergeId, reason]);

export type Merge = {
  id: string; survivorId: string; mergedId: string; reason: string; mergedBy: string; mergedAt: Date;
  undoneAt: Date | null; undoneBy: string | null; undoReason: string | null;
};
// The merges a patient took part in, newest first (read under RLS: the identity readers).
export async function mergesOf(db: pg.ClientBase, patientId: string): Promise<Merge[]> {
  const r = await db.query(
    `select id, survivor_id, merged_id, reason, merged_by, merged_at, undone_at, undone_by, undo_reason from patient_merges
      where survivor_id = $1 or merged_id = $1 order by merged_at desc, id desc`, [patientId]);
  return r.rows.map((x) => ({
    id: x.id, survivorId: x.survivor_id, mergedId: x.merged_id, reason: x.reason, mergedBy: x.merged_by, mergedAt: x.merged_at,
    undoneAt: x.undone_at, undoneBy: x.undone_by, undoReason: x.undo_reason,
  }));
}
// The survivor of an actively merged id, else the id itself.
export async function canonicalPatient(db: pg.ClientBase, id: string): Promise<string> {
  const r = await db.query(`select survivor_id from patient_merges where merged_id = $1 and undone_at is null`, [id]);
  return (r.rows[0]?.survivor_id as string | undefined) ?? id;
}
