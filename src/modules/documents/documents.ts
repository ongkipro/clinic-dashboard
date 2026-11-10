// Document templates (UX-54, SET-32) and signed medical letters (PR-74; T-058, DEC-067). Every call runs inside
// withTenantContext; the database decides authority (templates: owner and admin pusat, the facility head for
// consent and letter templates; letters: the doctor of the visit's branch, the examining doctor when there is an
// examination), validates placeholders and refuses patient data in templates. Writers go through runCommand
// (idempotency key, go-live gate); the command body is kept only as a fingerprint and the stored results hold ids.
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../lib/command";
import { renderPdf } from "../clinical/records/pdf";
import type { StepUp } from "../clinical/records/records";
import { assertProductionGoLive } from "../vendor/profile/profile";
import type { LETTER_STATES, LETTER_TYPES, LETTER_VERSION_KINDS, PAPER_SIZES, TEMPLATE_KINDS, TEMPLATE_STATES } from "./schema";

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED", "ERR_IDEMPOTENCY_CONFLICT"]);

export class DocumentError extends CommandError {
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
    if (m && KNOWN.has(m[1])) throw new DocumentError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}
async function command<T extends Json>(db: pg.ClientBase, name: string, key: string, body: Record<string, Json>, sql: string, args: unknown[]) {
  await assertProductionGoLive(db);
  const out = await call(() => runCommand<T>(db, { command: name, key, body }, async (c) => ((await c.query(sql, args)).rows[0]?.r ?? null) as T));
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}

export type TemplateKind = (typeof TEMPLATE_KINDS)[number];
export type LetterType = (typeof LETTER_TYPES)[number];
export type Paper = (typeof PAPER_SIZES)[number];
export type TemplateState = (typeof TEMPLATE_STATES)[number];
export type LetterState = (typeof LETTER_STATES)[number];
export type LetterVersionKind = (typeof LETTER_VERSION_KINDS)[number];

// ── Templates (UX-54) ────────────────────────────────────────────────────────────────────────────
export type NewTemplate = { kind: TemplateKind; letterType?: LetterType; name: string; body: string; paper: Paper };
// Simpan Versi: a new template, or a new version of an existing one (the previous active version retires).
export async function saveTemplate(db: pg.ClientBase, key: string, templateId: string | null, t: NewTemplate | { body: string; paper: Paper }) {
  const p: Record<string, Json> = { body: t.body, paper: t.paper };
  if (!templateId) {
    const n = t as NewTemplate;
    p.kind = n.kind;
    p.name = n.name;
    if (n.letterType !== undefined) p.letter_type = n.letterType;
  }
  const out = await command<{ template_id: string; version_id: string }>(db, "template_save", key, { template_id: templateId, template: p },
    `select template_save($1, $2::jsonb) as r`, [templateId, JSON.stringify(p)]);
  return { templateId: out.result.template_id, versionId: out.result.version_id, replayed: out.replayed };
}
export async function retireTemplate(db: pg.ClientBase, key: string, templateId: string) {
  const out = await command(db, "template_retire", key, { template_id: templateId }, `select template_retire($1) as r`, [templateId]);
  return { replayed: out.replayed };
}

export type TemplateRow = {
  id: string; kind: TemplateKind; letter_type: LetterType | null; name: string; state: TemplateState;
  version: number | null; version_id: string | null; used: boolean; updated_at: string | null;
};
export type TemplateDetail = {
  id: string; kind: TemplateKind; letter_type: LetterType | null; name: string; state: TemplateState; writable: boolean;
  required: string[]; allowed: string[];
  versions: { id: string; version: number; state: TemplateState; paper: Paper; body: string; used: boolean; created_at: string; created_by_name: string; preview: string }[];
};
export async function listTemplates(db: pg.ClientBase, kind: TemplateKind | null): Promise<{ role: string; templates: TemplateRow[] }> {
  return (await call(() => db.query(`select template_list($1) as r`, [kind]))).rows[0].r;
}
export async function getTemplate(db: pg.ClientBase, templateId: string): Promise<TemplateDetail> {
  return (await call(() => db.query(`select template_get($1) as r`, [templateId]))).rows[0].r;
}

// ── Letters (PR-74) ──────────────────────────────────────────────────────────────────────────────
export async function createLetter(db: pg.ClientBase, key: string, visitId: string, templateVersionId: string) {
  const out = await command<string>(db, "letter_create", key, { visit_id: visitId, template_version_id: templateVersionId },
    `select letter_create($1, $2) as r`, [visitId, templateVersionId]);
  return { letterId: out.result, replayed: out.replayed };
}
export async function saveLetter(db: pg.ClientBase, key: string, letterId: string, body: string) {
  const out = await command(db, "letter_save", key, { letter_id: letterId, body }, `select letter_save($1, $2) as r`, [letterId, body]);
  return { replayed: out.replayed };
}
// Signing needs the same step-up proof as the examination (T-053): the producer arrives with the clinical signing UI.
export async function signLetter(db: pg.ClientBase, key: string, letterId: string, stepUp: StepUp) {
  if (stepUp?.verified !== true) throw new DocumentError("ERR_FORBIDDEN", "step_up_required");
  const out = await command<string>(db, "letter_sign", key, { letter_id: letterId }, `select letter_sign($1) as r`, [letterId]);
  return { versionId: out.result, replayed: out.replayed };
}
export type LetterCorrection = { kind: "version"; id: string } | { kind: "pending"; id: string; approval_id: string };
export async function correctLetter(db: pg.ClientBase, key: string, letterId: string, body: string, reason: string) {
  const out = await command<LetterCorrection>(db, "letter_correct", key, { letter_id: letterId, body, reason },
    `select letter_correct($1, $2, $3) as r`, [letterId, body, reason]);
  return { ...out.result, replayed: out.replayed };
}

export type LetterRow = {
  id: string; visit_id: string; patient_id: string; letter_type: LetterType; state: LetterState; patient_name: string; patient_mrn: string;
  author_id: string; author_name: string; template_name: string; created_at: string; signed_at: string | null; version: number | null;
};
export type LetterDetail = LetterRow & {
  branch_name: string; own: boolean; body: string; correctable_direct: boolean; pending_correction: boolean;
  versions: { id: string; version: number; kind: LetterVersionKind; body: string; reason: string | null; created_at: string; approved: boolean }[];
};
export type LetterOptions = {
  branch_name: string;
  visits: { visit_id: string; patient_name: string; patient_mrn: string; checked_in_at: string; examined_by_other: boolean }[];
  templates: { version_id: string; name: string; letter_type: LetterType }[];
};
export async function listLetters(db: pg.ClientBase, filter: { patientId?: string; visitId?: string } = {}): Promise<{ role: string; letters: LetterRow[] }> {
  return (await call(() => db.query(`select letter_list($1, $2) as r`, [filter.patientId ?? null, filter.visitId ?? null]))).rows[0].r;
}
export async function getLetter(db: pg.ClientBase, letterId: string): Promise<LetterDetail> {
  return (await call(() => db.query(`select letter_get($1) as r`, [letterId]))).rows[0].r;
}
export async function letterOptions(db: pg.ClientBase, visitId: string | null): Promise<LetterOptions> {
  return (await call(() => db.query(`select letter_options($1) as r`, [visitId]))).rows[0].r;
}

export const LETTER_TITLE: Record<LetterType, string> = { surat_keterangan: "Surat Keterangan", rujukan: "Surat Rujukan", resume: "Resume Medis" };
// The PDF of a signed letter (its current version): title, body, signature line. Drafts have no PDF.
export function letterPdf(l: LetterDetail): Buffer {
  if (l.state !== "signed") throw new DocumentError("ERR_VERSION_CONFLICT", "not_signed");
  const v = l.versions[0];
  return renderPdf([
    { text: LETTER_TITLE[l.letter_type].toUpperCase(), bold: true },
    { text: "" },
    { text: l.body },
    { text: "" },
    { text: `Ditandatangani secara elektronik oleh ${l.author_name} pada ${l.signed_at} · versi ${v?.version ?? 1}` },
  ]);
}
