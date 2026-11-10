// Clinical records (PR-13, CLIN-014, CLIN-023, PR-49, PR-3; T-053): signing with a second-factor step-up,
// corrections as versions (within 48 h directly, later through the approval record_late_correction), the
// patient record copy (logged, rendered as a PDF here) and retention. Every call runs inside
// withTenantContext; the database decides authority. Writers go through runCommand (idempotency key, go-live
// gate); their stored results hold ids and codes only.
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../../lib/command";
import { assertProductionGoLive } from "../../vendor/profile/profile";
import type { CORRECTION_STATES, RECORD_VERSION_KINDS } from "../schema";
import { renderPdf, type PdfLine } from "./pdf";

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED", "ERR_IDEMPOTENCY_CONFLICT"]);

export class RecordError extends CommandError {
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
    if (m && KNOWN.has(m[1])) throw new RecordError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}
async function command<T extends Json>(db: pg.ClientBase, name: string, key: string, body: Record<string, Json>, sql: string, args: unknown[]) {
  await assertProductionGoLive(db);
  const out = await call(() => runCommand<T>(db, { command: name, key, body }, async (c) => ((await c.query(sql, args)).rows[0]?.r ?? null) as T));
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}

// ── Signing (PR-13, PR-3) ────────────────────────────────────────────────────────────────────────
// The step-up proof (19:87 "PIN/OTP"): a server action produces it after Better Auth accepted a current TOTP
// code for the signed-in session. The producer belongs to the auth factory (`src/auth/server.ts`; raw Better
// Auth API use elsewhere is refused by SEC-21's guard) and arrives with the UI task that wires "Tanda Tangani".
// The database cannot verify a code: it requires the factor to be enrolled and the actor to act as Dokter.
export type StepUp = { readonly verified: true };
export async function signRecord(db: pg.ClientBase, key: string, examId: string, stepUp: StepUp) {
  if (stepUp?.verified !== true) throw new RecordError("ERR_FORBIDDEN", "step_up_required");
  const out = await command<string>(db, "record_sign", key, { examination_id: examId }, `select record_sign($1) as r`, [examId]);
  return { versionId: out.result, replayed: out.replayed };
}

// ── Corrections (PR-13, CLIN-023) ────────────────────────────────────────────────────────────────
export type CorrectionDelta = {
  subjective?: string | null; objective?: string | null; assessment?: string | null; plan_note?: string | null;
  template_key?: string | null; template_values?: Record<string, string>; vitals?: Record<string, number>; icd10_codes?: string[];
};
export type CorrectionOutcome = { kind: "version"; id: string } | { kind: "pending"; id: string; approval_id: string };
export async function correctRecord(db: pg.ClientBase, key: string, examId: string, delta: CorrectionDelta | Record<string, unknown>, reason: string) {
  const out = await command<CorrectionOutcome>(db, "record_correct", key, { examination_id: examId, delta: delta as Json, reason },
    `select record_correct($1, $2::jsonb, $3) as r`, [examId, JSON.stringify(delta), reason]);
  return { ...out.result, replayed: out.replayed };
}

// ── Readers ──────────────────────────────────────────────────────────────────────────────────────
export type RecordContent = {
  subjective: string | null; objective: string | null; assessment: string | null; plan_note: string | null; template_key: string | null;
  template_values: Record<string, string>; vitals: Record<string, number>; icd10_codes: string[]; marks: unknown[]; verifications: unknown[];
};
export type RecordVersion = {
  id: string; version: number; kind: (typeof RECORD_VERSION_KINDS)[number]; content: RecordContent; content_hash: string; delta?: Partial<RecordContent>;
  reason?: string; approval_id?: string; created_by: string; created_as: "doctor"; created_at: string;
};
export type RecordCorrection = {
  id: string; state: (typeof CORRECTION_STATES)[number]; delta: Partial<RecordContent>; reason: string; approval_id: string; requested_by: string;
  requested_at: string; decided_at?: string; version_id?: string;
};
export type SignedRecord = {
  id: string; visit_id: string; patient_id: string; author_id: string; signed_at: string; signed_by: string; signed_as: "doctor"; content_hash: string;
  current: RecordContent; versions: RecordVersion[]; corrections: RecordCorrection[];
};
// A signed record with every version (audited clinical read).
export async function getRecord(db: pg.ClientBase, examId: string): Promise<SignedRecord> {
  return (await call(() => db.query(`select record_get($1) as r`, [examId]))).rows[0].r as SignedRecord;
}

// The earliest disposal date (local date of the last visit + 25 years), as YYYY-MM-DD.
export async function retentionUntil(db: pg.ClientBase, patientId: string): Promise<string> {
  return (await call(() => db.query(`select retention_until($1)::text as r`, [patientId]))).rows[0].r as string;
}

// ── Patient copy (PR-49) ─────────────────────────────────────────────────────────────────────────
type CopyData = {
  request_id: string; requested_at: string; clinic: string;
  patient: { name: string; mrn: string; birth_date: string };
  records: { checked_in_at: string; branch_name: string; author_name: string; signed_at: string; version: number; content: Omit<RecordContent, "marks" | "verifications"> }[];
};
const SECTIONS: ["subjective" | "objective" | "assessment" | "plan_note", string][] = [["subjective", "Subjektif"], ["objective", "Objektif"], ["assessment", "Asesmen"], ["plan_note", "Rencana"]];
const VITAL_LABEL: Record<string, string> = { td_sistolik: "TD sistolik", td_diastolik: "TD diastolik", nadi: "Nadi", suhu_c10: "Suhu (x10 C)", berat_kg: "Berat (kg)" };
const day = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "Asia/Jakarta" }).format(new Date(iso));

function copyLines(d: CopyData): PdfLine[] {
  const lines: PdfLine[] = [
    { text: `Salinan Rekam Medis - ${d.clinic}`, bold: true },
    { text: `Pasien: ${d.patient.name} (${d.patient.mrn}), lahir ${d.patient.birth_date}` },
    { text: `Dibuat ${day(d.requested_at)} - nomor permintaan ${d.request_id}` },
    { text: "" },
  ];
  if (d.records.length === 0) lines.push({ text: "Belum ada rekam medis yang ditandatangani." });
  for (const r of d.records) {
    lines.push({ text: `Kunjungan ${day(r.checked_in_at)} - ${r.branch_name} - ${r.author_name}`, bold: true });
    lines.push({ text: `Ditandatangani ${day(r.signed_at)}, versi ${r.version}` });
    for (const [k, label] of SECTIONS) if (r.content[k]) lines.push({ text: `${label}: ${r.content[k]}` });
    const vit = Object.entries(r.content.vitals ?? {});
    if (vit.length) lines.push({ text: `Tanda vital: ${vit.map(([k, v]) => `${VITAL_LABEL[k] ?? k} ${v}`).join(", ")}` });
    if (r.content.icd10_codes?.length) lines.push({ text: `Diagnosis (ICD-10): ${r.content.icd10_codes.join(", ")}` });
    lines.push({ text: "" });
  }
  return lines;
}

// Logs the request (content-free), then renders the signed records of the patient's merge cluster. A retry with
// the same key replays the logged request and renders it again.
export async function requestRecordCopy(db: pg.ClientBase, key: string, patientId: string, reason: string) {
  const out = await command<{ request_id: string; record_count: number }>(db, "record_copy_request", key, { patient_id: patientId, reason },
    `select record_copy_request($1, $2) as r`, [patientId, reason]);
  const data = (await call(() => db.query(`select record_copy_data($1) as r`, [out.result.request_id]))).rows[0].r as CopyData;
  return { requestId: out.result.request_id, recordCount: out.result.record_count, pdf: renderPdf(copyLines(data)), replayed: out.replayed };
}
