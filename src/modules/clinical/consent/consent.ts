// Procedure consent (UX-39) and the treatment start gate (PR-11, CLIN-005, CLIN-022; T-054). Every call runs
// inside withTenantContext; the database decides authority (DEC-065: doctor or nurse captures and withdraws;
// the examining doctor reviews contraindications), generates the consent text and checks that the signature binds
// to the text shown. The signature is a PNG (≥ 320 × 160) kept in the row and never in command records.
import { createHash } from "node:crypto";
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../../lib/command";
import { assertProductionGoLive } from "../../vendor/profile/profile";
import { sniff } from "../media/image";
import type { GUARDIAN_RELATIONS } from "../../patients/schema";
import type { CONSENT_SIGNERS, CONSENT_STATES, DOSE_UNITS, REVIEW_DECISIONS } from "../schema";

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED", "ERR_IDEMPOTENCY_CONFLICT"]);

export class ConsentError extends CommandError {
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
    if (m && KNOWN.has(m[1])) throw new ConsentError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}
async function command<T extends Json>(db: pg.ClientBase, name: string, key: string, body: Record<string, Json>, fn: (c: pg.ClientBase) => Promise<T>) {
  await assertProductionGoLive(db);
  const out = await call(() => runCommand<T>(db, { command: name, key, body }, fn));
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}

export type Signer = (typeof CONSENT_SIGNERS)[number];
export type GuardianRelation = (typeof GUARDIAN_RELATIONS)[number];
export type ConsentState = (typeof CONSENT_STATES)[number];
export type DoseUnit = (typeof DOSE_UNITS)[number];
export const SIGNATURE_MIN = { width: 320, height: 160 } as const;
export const SIGNATURE_MAX_BYTES = 204_800;

// ── The text shown before signing ─────────────────────────────────────────────────────────────────
export type ConsentText = {
  text: string; content_hash: string;
  items: { plan_item_id: string; stage: number; catalog_version_id: string; name: string; qty: number; dose_micro?: number; dose_unit?: DoseUnit }[];
};
export async function consentText(db: pg.ClientBase, visitId: string, planId: string): Promise<ConsentText> {
  return (await call(() => db.query(`select procedure_consent_text($1, $2) as r`, [visitId, planId]))).rows[0].r as ConsentText;
}

// ── Capture (UX-39) ──────────────────────────────────────────────────────────────────────────────
export type CaptureInput = {
  visitId: string; planId: string; signer: Signer; guardianName?: string; guardianRelation?: GuardianRelation;
  expectedHash: string; signature: Buffer;
};
// The signature must be a PNG of at least 320 × 160 px and at most 200 KB. The command record holds its sha256.
export async function captureConsent(db: pg.ClientBase, key: string, i: CaptureInput) {
  if (!Buffer.isBuffer(i.signature) || i.signature.length > SIGNATURE_MAX_BYTES) throw new ConsentError("ERR_INVALID_INPUT", "signature");
  const s = sniff(i.signature);
  if (!s || s.contentType !== "image/png" || s.width < SIGNATURE_MIN.width || s.height < SIGNATURE_MIN.height) throw new ConsentError("ERR_INVALID_INPUT", "signature");
  const p: Record<string, Json> = { signer: i.signer, expected_hash: i.expectedHash };
  if (i.signer === "guardian") {
    p.guardian_name = i.guardianName ?? "";
    p.guardian_relation = i.guardianRelation ?? "";
  }
  const sigHash = createHash("sha256").update(i.signature).digest("hex");
  const out = await command<string>(db, "procedure_consent_capture", key, { visit_id: i.visitId, plan_id: i.planId, consent: p, signature_sha256: sigHash }, async (c) =>
    (await c.query(`select procedure_consent_capture($1, $2, $3::jsonb, $4) as r`, [i.visitId, i.planId, JSON.stringify(p), i.signature])).rows[0].r);
  return { consentId: out.result, replayed: out.replayed };
}

export async function withdrawConsent(db: pg.ClientBase, key: string, consentId: string, reason: string) {
  const out = await command(db, "procedure_consent_withdraw", key, { consent_id: consentId, reason }, async (c) => {
    await c.query(`select procedure_consent_withdraw($1, $2)`, [consentId, reason]);
    return null;
  });
  return { replayed: out.replayed };
}

export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
// The examining doctor clears or blocks one plan item; returns the review's version.
export async function reviewContraindication(db: pg.ClientBase, key: string, examId: string, planItemId: string, decision: ReviewDecision, reason: string | null = null) {
  const out = await command<number>(db, "contraindication_review", key, { examination_id: examId, plan_item_id: planItemId, decision, reason }, async (c) =>
    (await c.query(`select contraindication_review($1, $2, $3, $4) as r`, [examId, planItemId, decision, reason])).rows[0].r);
  return { version: out.result, replayed: out.replayed };
}

// ── The start gate (PR-11, CLIN-005, CLIN-022) ───────────────────────────────────────────────────
export type Blocker =
  | "examination_unsigned" | "credential_missing" | "credential_expired" | "not_eligible" | "contraindication_unresolved"
  | "consent_missing" | "consent_mismatch";
export type StartCheck = { ok: boolean; blockers: Blocker[]; plan_id: string; consent_id: string | null };
export async function checkTreatmentStart(db: pg.ClientBase, visitId: string, planItemIds: string[], performerId: string, supervisorId: string | null = null): Promise<StartCheck> {
  return (await call(() => db.query(`select treatment_start_check($1, $2::uuid[], $3, $4) as r`, [visitId, planItemIds, performerId, supervisorId]))).rows[0].r as StartCheck;
}
// Throws the 18 error of the first blocker class: credentials → ERR_CREDENTIAL_INVALID, consent →
// ERR_CONSENT_MISSING, otherwise ERR_FORBIDDEN with the first blocker as the reason.
export async function assertCanStart(db: pg.ClientBase, visitId: string, planItemIds: string[], performerId: string, supervisorId: string | null = null) {
  const r = await checkTreatmentStart(db, visitId, planItemIds, performerId, supervisorId);
  if (r.ok) return r;
  const first = r.blockers[0];
  if (r.blockers.some((b) => b === "credential_missing" || b === "credential_expired")) throw new ConsentError("ERR_CREDENTIAL_INVALID", first);
  if (r.blockers.some((b) => b === "consent_missing" || b === "consent_mismatch")) throw new ConsentError("ERR_CONSENT_MISSING", first);
  throw new ConsentError("ERR_FORBIDDEN", first);
}

// ── Readers for UX-39 ────────────────────────────────────────────────────────────────────────────
export type PlanConsent = "none" | "active" | "outdated";
export type ConsentQueue = {
  today: string; branch_name: string;
  visits: { visit_id: string; checked_in_at: string; closed: boolean; patient_name: string; patient_mrn: string; exam_state: "draft" | "signed";
    plans: { plan_id: string; title: string; consent: PlanConsent }[] }[];
};
export async function consentQueue(db: pg.ClientBase, branchId: string): Promise<ConsentQueue> {
  return (await call(() => db.query(`select consent_visits($1) as r`, [branchId]))).rows[0].r as ConsentQueue;
}
export type ConsentPage = {
  visit: { id: string; closed: boolean; consent: string };
  patient: { id: string; name: string; mrn: string; guardian_required: boolean };
  examination: null | { id: string; state: "draft" | "signed"; author_id: string };
  plans: {
    plan_id: string; title: string; consent: PlanConsent;
    items: { plan_item_id: string; stage: number; name: string; qty: number; dose_micro?: number; dose_unit?: DoseUnit; has_contraindications: boolean; review?: ReviewDecision }[];
    history: { consent_id: string; version: number; state: ConsentState; signer: Signer; guardian_name?: string; captured_as: "doctor" | "nurse"; captured_at: string;
      captured_by_name?: string; superseded_at?: string; withdrawn_at?: string; withdraw_reason?: string }[];
  }[];
};
export async function consentPage(db: pg.ClientBase, visitId: string): Promise<ConsentPage> {
  return (await call(() => db.query(`select consent_visit($1) as r`, [visitId]))).rows[0].r as ConsentPage;
}
export async function consentSignature(db: pg.ClientBase, consentId: string): Promise<Buffer> {
  return (await call(() => db.query(`select consent_signature($1) as r`, [consentId]))).rows[0].r as Buffer;
}
