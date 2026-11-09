// Privacy workspace (PR-92, UX-30 ▸ Privasi; T-039, DEC-059). Every call runs inside withTenantContext; the
// database decides who may (the privacy officers) and the lifecycle. Writers go through runCommand with
// the caller's idempotency key; database errors are mapped outside it (a raised error rolls the claim
// back). The notice file is identified in the idempotent body by its checksum, name, type and size (a
// retry with other bytes is a different request); runCommand stores only the body's fingerprint.
// No go-live gate: recording a breach is a statutory duty whenever the tenant holds data.
import { createHash } from "node:crypto";
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../lib/command";
import { MAX_BYTES, sniffType } from "../compliance/compliance";

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED"]);

export class PrivacyError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
// A file the database refused (missing, too large, wrong type or checksum): shown as a field error.
export class NoticeFileError extends Error {}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CommandError) throw e;
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m?.[1] === "ERR_INVALID_FILE") throw new NoticeFileError(m[2]);
    if (m && KNOWN.has(m[1])) throw new PrivacyError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}
async function command<T extends Json>(db: pg.ClientBase, command: string, key: string, body: Record<string, Json>, sql: string, args: unknown[]) {
  const out = await call(() => runCommand<T>(db, { command, key, body }, async (c) => ((await c.query(sql, args)).rows[0]?.r ?? null) as T));
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}

export type BreachState = "open" | "assessed" | "notified" | "not_notifiable" | "closed";
export type Notice = {
  id: string; recipientKind: "data_subjects" | "authority" | "other"; recipient: string; sentAt: Date; channel: string; contentSummary: string;
  fileName: string; mediaType: string; sizeBytes: number; sha256: string;
};
export type Breach = {
  id: string; awareAt: Date; deadlineAt: Date; description: string; affectedCount: number | null; dataCategories: string; state: BreachState;
  notNotifiableReason: string | null; assessedAt: Date | null; concludedAt: Date | null; closedAt: Date | null; createdAt: Date; notices: Notice[];
};
export type Processor = {
  id: string; name: string; service: string; dataCategories: string; location: string; role: "processor" | "sub_processor"; crossBorder: boolean;
  transferBasis: string | null; agreementRef: string | null; active: boolean; updatedAt: Date;
};
export type ConsentTextRow = { id: string; purpose: string; version: number; body: string; effectiveFrom: Date };
export type ConsentEvent = {
  id: string; patientId: string; patientMrn: string; patientName: string; purpose: string; textVersion: number; state: "active" | "withdrawn";
  grantedAt: Date; grantChannel: string; withdrawnAt: Date | null; withdrawChannel: string | null;
};
export type Overview = {
  now: Date; texts: ConsentTextRow[]; counts: { purpose: string; active: number; withdrawn: number }[]; recent: ConsentEvent[];
  processors: Processor[]; breaches: Breach[];
};

const d = (x: unknown) => (x ? new Date(x as string) : null);
export async function overview(db: pg.ClientBase): Promise<Overview> {
  const r = (await call(() => db.query(`select privacy_overview() as r`))).rows[0].r as Record<string, Record<string, unknown>[]> & { now: string };
  return {
    now: new Date(r.now),
    texts: r.texts.map((x) => ({ id: x.id as string, purpose: x.purpose as string, version: x.version as number, body: x.body as string, effectiveFrom: new Date(x.effective_from as string) })),
    counts: r.counts.map((x) => ({ purpose: x.purpose as string, active: Number(x.active), withdrawn: Number(x.withdrawn) })),
    recent: r.recent.map((x) => ({
      id: x.id as string, patientId: x.patient_id as string, patientMrn: x.patient_mrn as string, patientName: x.patient_name as string, purpose: x.purpose as string,
      textVersion: x.text_version as number, state: x.state as ConsentEvent["state"], grantedAt: new Date(x.granted_at as string), grantChannel: x.grant_channel as string,
      withdrawnAt: d(x.withdrawn_at), withdrawChannel: (x.withdraw_channel as string | null) ?? null,
    })),
    processors: r.processors.map((x) => ({
      id: x.id as string, name: x.name as string, service: x.service as string, dataCategories: x.data_categories as string, location: x.location as string,
      role: x.role as Processor["role"], crossBorder: x.cross_border as boolean, transferBasis: (x.transfer_basis as string | null) ?? null,
      agreementRef: (x.agreement_ref as string | null) ?? null, active: x.active as boolean, updatedAt: new Date(x.updated_at as string),
    })),
    breaches: r.breaches.map((x) => ({
      id: x.id as string, awareAt: new Date(x.aware_at as string), deadlineAt: new Date(x.deadline_at as string), description: x.description as string,
      affectedCount: (x.affected_count as number | null) ?? null, dataCategories: x.data_categories as string, state: x.state as BreachState,
      notNotifiableReason: (x.not_notifiable_reason as string | null) ?? null, assessedAt: d(x.assessed_at), concludedAt: d(x.concluded_at), closedAt: d(x.closed_at),
      createdAt: new Date(x.created_at as string),
      notices: (x.notices as Record<string, unknown>[]).map((n) => ({
        id: n.id as string, recipientKind: n.recipient_kind as Notice["recipientKind"], recipient: n.recipient as string, sentAt: new Date(n.sent_at as string),
        channel: n.channel as string, contentSummary: n.content_summary as string, fileName: n.file_name as string, mediaType: n.media_type as string,
        sizeBytes: Number(n.size_bytes), sha256: n.sha256 as string,
      })),
    })),
  };
}

export type ProcessorInput = {
  name: string; service: string; data_categories: string; location: string; role: "processor" | "sub_processor"; cross_border: boolean;
  transfer_basis?: string | null; agreement_ref?: string | null;
};
export async function saveProcessor(db: pg.ClientBase, key: string, id: string | null, p: ProcessorInput) {
  const body = { id, ...p, transfer_basis: p.transfer_basis ?? null, agreement_ref: p.agreement_ref ?? null } as unknown as Record<string, Json>;
  const out = await command<string>(db, "privacy.processor_upsert", key, body, `select processor_upsert($1, $2::jsonb) as r`, [id, JSON.stringify(p)]);
  return { processorId: out.result as string, replayed: out.replayed };
}
export const setProcessorActive = (db: pg.ClientBase, key: string, id: string, active: boolean) =>
  command<null>(db, "privacy.processor_set_active", key, { id, active }, `select processor_set_active($1, $2) as r`, [id, active]);

export async function recordBreach(db: pg.ClientBase, key: string, b: { awareAt: Date; description: string; affectedCount: number | null; dataCategories: string }) {
  const out = await command<string>(db, "privacy.breach_record", key, { aware_at: b.awareAt.toISOString(), description: b.description, affected: b.affectedCount, categories: b.dataCategories },
    `select breach_record($1, $2, $3, $4) as r`, [b.awareAt, b.description, b.affectedCount, b.dataCategories]);
  return { breachId: out.result as string, replayed: out.replayed };
}
export const assessBreach = (db: pg.ClientBase, key: string, id: string) =>
  command<null>(db, "privacy.breach_assess", key, { id }, `select breach_assess($1) as r`, [id]);
export const concludeBreach = (db: pg.ClientBase, key: string, id: string, notifiable: boolean, reason: string | null) =>
  command<null>(db, "privacy.breach_conclude", key, { id, notifiable, reason }, `select breach_conclude($1, $2, $3) as r`, [id, notifiable, reason]);
export const closeBreach = (db: pg.ClientBase, key: string, id: string) =>
  command<null>(db, "privacy.breach_close", key, { id }, `select breach_close($1) as r`, [id]);

export type NoticeInput = {
  recipientKind: Notice["recipientKind"]; recipient: string; sentAt: Date; channel: string; contentSummary: string; fileName: string; content: Buffer;
};
// The bytes go to the database only as an argument; the idempotent body names them by checksum (plan r1
// P2-1: a Buffer is not a valid command body).
export async function addNotice(db: pg.ClientBase, key: string, breachId: string, n: NoticeInput) {
  if (n.content.length === 0 || n.content.length > MAX_BYTES) throw new NoticeFileError("Berkas kosong atau lebih dari 5 MB.");
  const type = sniffType(n.content);
  if (!type) throw new NoticeFileError("Berkas harus PDF, PNG atau JPEG.");
  const name = n.fileName.replace(/[/\\]/g, "_").trim().slice(0, 200) || "bukti";
  const sha = createHash("sha256").update(n.content).digest("hex");
  const p = { recipient_kind: n.recipientKind, recipient: n.recipient, sent_at: n.sentAt.toISOString(), channel: n.channel, content_summary: n.contentSummary };
  const out = await command<string>(db, "privacy.breach_notice_add", key,
    { breach: breachId, ...p, file_name: name, media_type: type, size_bytes: n.content.length, sha256: sha },
    `select breach_notice_add($1, $2::jsonb, $3, $4, $5, $6) as r`, [breachId, JSON.stringify(p), name, type, n.content, sha]);
  return { noticeId: out.result as string, replayed: out.replayed };
}

export async function noticeFile(db: pg.ClientBase, id: string): Promise<{ fileName: string; mediaType: string; content: Buffer; sha256: string }> {
  const r = (await call(() => db.query(`select * from breach_notice_file($1)`, [id]))).rows[0];
  return { fileName: r.file_name, mediaType: r.media_type, content: r.content, sha256: r.sha256 };
}

// Time left to the 3×24 h deadline, in whole minutes (negative when overdue).
export const minutesLeft = (b: Pick<Breach, "deadlineAt">, now: Date) => Math.floor((b.deadlineAt.getTime() - now.getTime()) / 60_000);
