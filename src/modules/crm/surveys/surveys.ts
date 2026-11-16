// Satisfaction surveys (PR-78; T-098, migration 0113, DEC-110). One survey per closed visit, a score 1–5 and nothing else (no free text:
// no clinical content). A score of 2 or less opens the visit branch manager's "Skor survei rendah" follow-up in the same transaction and is
// never review-eligible; a score of 4 or more is review-eligible (no review request is sent in T-098). The database decides who records
// and who reads (and the identity each reader sees); the readers give K26 (average score and % ≤ 2 by visit branch).
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode } from "../../../lib/command";
import { assertProductionGoLive } from "../../vendor/profile/profile";

export class SurveyError extends CommandError {
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
    if (m && KNOWN.has(m[1])) throw new SurveyError(m[1] as ErrorCode, m[2] || undefined);
    throw e;
  }
}

export type SurveyScore = 1 | 2 | 3 | 4 | 5;
// Keyed (runCommand + command_key): a replay of the same key answers the first survey; another key on a surveyed visit is refused.
export async function recordSurvey(db: pg.ClientBase, key: string, input: { visitId: string; score: SurveyScore }) {
  await assertProductionGoLive(db);
  const body = { visit_id: input.visitId, score: input.score };
  const out = await call(() => runCommand<string>(db, { command: "survey_record", key, body },
    async (c) => (await c.query(`select survey_record($1, $2::jsonb) r`, [key, JSON.stringify(body)])).rows[0].r as string));
  if (!out.ok) throw out.error;
  return { surveyId: out.result, replayed: out.replayed };
}

export type SurveyRow = { id: string; branch_id: string; branch_name: string; day: string; score: SurveyScore; review_eligible: boolean;
  followup_state: "open" | "done" | "dismissed" | null; consent_masked: boolean; patient_name: string | null; patient_mrn: string | null;
  recorded_at: string };
export type SurveyRange = { branchId?: string; from?: string; to?: string };
export const surveyList = (db: pg.ClientBase, r: SurveyRange = {}) =>
  call(async () => (await db.query(`select survey_list($1, $2::date, $3::date) r`, [r.branchId ?? null, r.from ?? null, r.to ?? null])).rows[0].r as
    { role: string; rows: SurveyRow[] });

// K26: per visit branch — total, low_count (score ≤ 2), avg_score and low_pct computed in SQL numeric and rounded to 2 places there
// (no float arithmetic in the database; JSON carries the rounded values).
export type SurveySummary = { branch_id: string; total: number; low_count: number; avg_score: number; low_pct: number };
export const surveySummary = (db: pg.ClientBase, r: SurveyRange = {}) =>
  call(async () => (await db.query(`select survey_summary($1, $2::date, $3::date) r`, [r.branchId ?? null, r.from ?? null, r.to ?? null])).rows[0].r as
    SurveySummary[]);
