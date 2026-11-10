// BC Pendampingan intake (PR-9, CLIN-001–003; T-051). Every call runs inside withTenantContext; the database
// decides who may (a BC of the visit's branch, the author for edits), what is a new fact (CLIN-001) and what is
// refused. Writers go through runCommand with the caller's idempotency key and the production go-live gate.
// A refused score / diagnosis / signing field (PR-9, CLIN-003) is a committed, audited value {ok: false, code}
// (never raised, so the audit row survives); database errors are mapped outside runCommand.
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../../lib/command";
import { assertProductionGoLive } from "../../vendor/profile/profile";
import type { FACT_KINDS, FACT_PROVENANCE, INTAKE_STATES, SKIN_CHIPS } from "../schema";

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED"]);

export class IntakeError extends CommandError {
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
    if (m && KNOWN.has(m[1])) throw new IntakeError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}
async function command<T extends Json>(db: pg.ClientBase, command: string, key: string, body: Record<string, Json>, sql: string, args: unknown[]) {
  await assertProductionGoLive(db);
  const out = await call(() => runCommand<T>(db, { command, key, body }, async (c) => ((await c.query(sql, args)).rows[0]?.r ?? null) as T));
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}

export type FactKind = (typeof FACT_KINDS)[number];
export type Provenance = (typeof FACT_PROVENANCE)[number];
export type SkinChip = (typeof SKIN_CHIPS)[number];
export type IntakeState = (typeof INTAKE_STATES)[number];
export type SaveRefusal = "score_field" | "diagnosis_forbidden" | "sign_forbidden";

// The draft of the visit (opens it on first use; visits.intake → in_progress).
export async function openIntake(db: pg.ClientBase, key: string, visitId: string): Promise<{ intakeId: string; replayed: boolean }> {
  const out = await command<string>(db, "intake_open", key, { visit_id: visitId }, `select intake_open($1) as r`, [visitId]);
  return { intakeId: out.result, replayed: out.replayed };
}

// What the BC sends: the complaint, facts (a new value, or "same as" the history fact of that kind) and the
// skin observation. The payload is passed as given: the database refuses unknown, score and diagnosis keys.
export type FactInput = { kind: FactKind; value: string } | { kind: FactKind; same_as: string };
export type IntakePayload = { complaint?: string | null; facts?: FactInput[]; observation?: { chips: SkinChip[]; note?: string | null } | null };
export type SaveOutcome = { ok: true; replayed: boolean } | { ok: false; code: SaveRefusal; replayed: boolean };

export async function saveIntake(db: pg.ClientBase, key: string, intakeId: string, payload: IntakePayload | Record<string, unknown>): Promise<SaveOutcome> {
  const out = await command<{ ok: boolean; code?: string }>(db, "intake_save", key, { intake_id: intakeId, payload: payload as Json },
    `select intake_save($1, $2::jsonb) as r`, [intakeId, JSON.stringify(payload)]);
  return out.result.ok ? { ok: true, replayed: out.replayed } : { ok: false, code: out.result.code as SaveRefusal, replayed: out.replayed };
}

// "Kirim ke Dokter": final; visits.intake → done; the doctor role at the branch is alerted.
export async function sendIntake(db: pg.ClientBase, key: string, intakeId: string): Promise<{ replayed: boolean }> {
  const out = await command(db, "intake_send", key, { intake_id: intakeId }, `select intake_send($1) as r`, [intakeId]);
  return { replayed: out.replayed };
}

export type QueueVisit = {
  id: string; kind: string; checkedInAt: Date; patientId: string; patientName: string; patientMrn: string; intake: string; doctor: string; closed: boolean;
  intakeId: string | null; intakeState: IntakeState | null; authorId: string | null; authorName: string | null;
};
export type Queue = { today: string; branchName: string; visits: QueueVisit[] };

export async function queue(db: pg.ClientBase, branchId: string): Promise<Queue> {
  const r = (await call(() => db.query(`select pendampingan_visits($1) as r`, [branchId]))).rows[0].r as { today: string; branch_name: string; visits: Record<string, unknown>[] };
  return {
    today: r.today, branchName: r.branch_name,
    visits: r.visits.map((v) => ({
      id: v.id as string, kind: v.kind as string, checkedInAt: new Date(v.checked_in_at as string), patientId: v.patient_id as string, patientName: v.patient_name as string,
      patientMrn: v.patient_mrn as string, intake: v.intake as string, doctor: v.doctor as string, closed: v.closed as boolean,
      intakeId: (v.intake_id as string | null) ?? null, intakeState: (v.intake_state as IntakeState | null) ?? null,
      authorId: (v.author_id as string | null) ?? null, authorName: (v.author_name as string | null) ?? null,
    })),
  };
}

export type Fact = { id: string; kind: FactKind; value: string; provenance: Provenance; priorFactId?: string | null; sentAt?: Date | null };
export type VisitIntake = {
  visit: { id: string; branchId: string; checkedInAt: Date; closed: boolean; intake: string; doctor: string; selection: string; payment: string };
  patient: { id: string; name: string; mrn: string; birthDate: string | null; sex: string };
  intake: null | {
    id: string; state: IntakeState; complaint: string | null; authorId: string; authorName: string; sentAt: Date | null; reviewedPrior: string[];
    facts: Fact[]; observation: { chips: SkinChip[]; note: string | null } | null;
  };
  history: Fact[];
  visitsBefore: { visitId: string; sentAt: Date; complaint: string | null }[];
};

const fact = (f: Record<string, unknown>): Fact => ({
  id: f.id as string, kind: f.kind as FactKind, value: f.value as string, provenance: f.provenance as Provenance,
  priorFactId: (f.prior_fact_id as string | null) ?? null, sentAt: f.sent_at ? new Date(f.sent_at as string) : null,
});

// The flow page's data (audited as a clinical read).
export async function visitIntake(db: pg.ClientBase, visitId: string): Promise<VisitIntake> {
  const r = (await call(() => db.query(`select pendampingan_visit($1) as r`, [visitId]))).rows[0].r as Record<string, Record<string, unknown> & Record<string, unknown>[]>;
  const v = r.visit as Record<string, unknown>;
  const p = r.patient as Record<string, unknown>;
  const i = r.intake as Record<string, unknown> | null;
  return {
    visit: { id: v.id as string, branchId: v.branch_id as string, checkedInAt: new Date(v.checked_in_at as string), closed: v.closed as boolean,
      intake: v.intake as string, doctor: v.doctor as string, selection: v.selection as string, payment: v.payment as string },
    patient: { id: p.id as string, name: p.name as string, mrn: p.mrn as string, birthDate: (p.birth_date as string | null) ?? null, sex: p.sex as string },
    intake: i ? {
      id: i.id as string, state: i.state as IntakeState, complaint: (i.complaint as string | null) ?? null, authorId: i.author_id as string,
      authorName: i.author_name as string, sentAt: i.sent_at ? new Date(i.sent_at as string) : null, reviewedPrior: (i.reviewed_prior as string[]) ?? [],
      facts: ((i.facts as Record<string, unknown>[]) ?? []).map(fact),
      observation: i.observation ? { chips: (i.observation as Record<string, unknown>).chips as SkinChip[], note: ((i.observation as Record<string, unknown>).note as string | null) ?? null } : null,
    } : null,
    history: ((r.history as unknown as Record<string, unknown>[]) ?? []).map(fact),
    visitsBefore: ((r.visits_before as unknown as Record<string, unknown>[]) ?? []).map((x) => ({ visitId: x.visit_id as string, sentAt: new Date(x.sent_at as string), complaint: (x.complaint as string | null) ?? null })),
  };
}

// CLIN-002: the patient's unverified allergy cautions (kind, short value, provenance), for the clinical roles.
export type Caution = { factId: string; kind: "allergy"; value: string; provenance: Provenance; sentAt: Date };
export async function patientCautions(db: pg.ClientBase, patientId: string): Promise<Caution[]> {
  const r = (await call(() => db.query(`select patient_cautions($1) as r`, [patientId]))).rows[0].r as Record<string, unknown>[];
  return r.map((c) => ({ factId: c.fact_id as string, kind: "allergy", value: c.value as string, provenance: c.provenance as Provenance, sentAt: new Date(c.sent_at as string) }));
}
