// Compliance register server code (PR-97, DATA-71): the register as a role sees it,
// evidence upload and decisions, the audited download, and the feature-gate evaluator
// every gated action calls (assertFeatureGate). Runs on the caller's client inside
// withTenantContext; the compliance functions (migration 0030) enforce roles and scope.
import { createHash } from "node:crypto";
import type pg from "pg";
import { CommandError, type ErrorCode } from "../../lib/command";

const CODE = /^(ERR_[A-Z_]+):/;
const KNOWN = new Set<string>(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_VERSION_CONFLICT", "ERR_APPROVER_IS_REQUESTER", "ERR_INVALID_INPUT", "ERR_INVALID_FILE"]);

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new CommandError(m[1] as ErrorCode);
    throw e;
  }
}

// Gated features (PR-97) as the screens name them.
export const GATE_LABEL: Record<string, string> = {
  vat_on_invoices: "PPN pada invoice",
  journal_export: "Ekspor jurnal",
  public_site_publish: "Terbitkan situs klinik",
  campaign_sending: "Pengiriman kampanye",
  clinical_go_live: "Layanan klinis",
  real_patient_go_live: "Data pasien nyata",
  test_gate: "Fitur uji",
};

export const STATUS_LABEL: Record<EvidenceStatus, { tone: "neutral" | "warning" | "success" | "danger" | "blocked"; label: string }> = {
  missing: { tone: "neutral", label: "Belum ada" },
  submitted: { tone: "warning", label: "Menunggu persetujuan" },
  approved: { tone: "success", label: "Disetujui" },
  rejected: { tone: "danger", label: "Ditolak" },
  revoked: { tone: "danger", label: "Dicabut" },
  expired: { tone: "blocked", label: "Kedaluwarsa" },
};

export const AREA_LABEL: Record<string, string> = {
  legal: "Hukum", tax: "Pajak", accounting: "Akuntansi", clinical: "Klinis", privacy: "Pelindungan data", operations: "Operasional",
};

export type EvidenceStatus = "missing" | "submitted" | "approved" | "rejected" | "revoked" | "expired";

export type RegisterRow = {
  obligationKey: string;
  scope: "vendor" | "tenant";
  label: string;
  area: string;
  itemId: string | null; // tenant items only
  status: EvidenceStatus;
  validUntil: string | null;
  gates: string[];
  latestVersion: number | null;
  mayAct: boolean; // the acting role uploads and decides items of this area
  mayRead: boolean; // the acting role sees this item's files and decisions (07: its areas)
  mayDecide: boolean; // ... and may decide the newest file (it did not upload it)
  latestFileId: string | null; // the newest file (the one a decision covers)
};

export async function register(db: pg.ClientBase): Promise<RegisterRow[]> {
  return call(async () =>
    (await db.query(`select * from compliance_register()`)).rows.map((r) => ({
      obligationKey: r.obligation_key, scope: r.scope, label: r.label, area: r.area, itemId: r.item_id, status: r.status,
      validUntil: r.valid_until ? String(r.valid_until instanceof Date ? r.valid_until.toISOString().slice(0, 10) : r.valid_until) : null,
      gates: r.gates, latestVersion: r.latest_version, mayAct: r.may_act, mayRead: r.may_read, mayDecide: r.may_decide, latestFileId: r.latest_file,
    })),
  );
}

export type EvidenceFile = { id: string; uploadedBy: string | null; version: number; fileName: string; mediaType: string; sizeBytes: number; sha256: string; expertName: string; documentDate: string; uploadedName: string; uploadedAs: string; uploadedAt: Date };
export type EvidenceDecision = { fileId: string; decision: "approved" | "rejected" | "revoked"; reason: string | null; validUntil: string | null; decidedName: string; decidedAs: string; decidedAt: Date; configVersion: string | null };

export async function itemDetail(db: pg.ClientBase, itemId: string): Promise<{ files: EvidenceFile[]; decisions: EvidenceDecision[] }> {
  const files = (await db.query(
    `select id, uploaded_by, version, file_name, media_type, size_bytes, sha256, expert_name, document_date::text, uploaded_name, uploaded_as, uploaded_at
       from evidence_files where item_id = $1 order by version desc`, [itemId])).rows.map((r) => ({
    id: r.id, uploadedBy: r.uploaded_by, version: r.version, fileName: r.file_name, mediaType: r.media_type, sizeBytes: Number(r.size_bytes), sha256: r.sha256,
    expertName: r.expert_name, documentDate: r.document_date, uploadedName: r.uploaded_name, uploadedAs: r.uploaded_as, uploadedAt: r.uploaded_at,
  }));
  // Newest first in the gate's order (seq), which the app may not read (HYG-008a, B-03):
  // evidence_decisions() orders by it inside and applies the same read rule.
  const decisions = (await db.query(
    `select file_id, decision, reason, valid_until::text, decided_name, decided_as, decided_at, config_version
       from evidence_decisions($1)`, [itemId])).rows.map((r) => ({
    fileId: r.file_id, decision: r.decision, reason: r.reason, validUntil: r.valid_until, decidedName: r.decided_name, decidedAs: r.decided_as,
    decidedAt: r.decided_at, configVersion: r.config_version,
  }));
  return { files, decisions };
}

export const MAX_BYTES = 5 * 1024 * 1024;
export const MEDIA_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;

// The file's own bytes decide its type (a PDF, PNG or JPEG signature), not the name.
export function sniffType(b: Buffer): (typeof MEDIA_TYPES)[number] | null {
  if (b.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return null;
}

export type Upload = { obligationKey: string; fileName: string; content: Buffer; expertName: string; documentDate: string };

export class EvidenceFileError extends Error {}

// Returns the file id and whether it is a new version (the same bytes as the newest
// version add none).
export async function uploadEvidence(db: pg.ClientBase, u: Upload): Promise<{ fileId: string; created: boolean }> {
  if (u.content.length === 0 || u.content.length > MAX_BYTES) throw new EvidenceFileError("Berkas kosong atau lebih dari 5 MB.");
  const type = sniffType(u.content);
  if (!type) throw new EvidenceFileError("Berkas harus PDF, PNG atau JPEG.");
  const name = u.fileName.replace(/[/\\]/g, "_").trim().slice(0, 200) || "bukti";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(u.documentDate) || new Date(`${u.documentDate}T00:00:00Z`).toISOString().slice(0, 10) !== u.documentDate) {
    throw new EvidenceFileError("Tanggal dokumen tidak valid.");
  }
  if (u.expertName.trim().length < 2 || u.expertName.trim().length > 120) throw new EvidenceFileError("Tulis nama penyusun dokumen (2–120 karakter).");
  const sha = createHash("sha256").update(u.content).digest("hex");
  return call(async () => {
    const fileId = (await db.query<{ id: string }>(`select evidence_upload($1, $2, $3, $4, $5, $6, $7) as id`, [
      u.obligationKey, name, type, u.content, sha, u.expertName.trim(), u.documentDate,
    ])).rows[0].id;
    // A file written in this transaction carries its start time; a duplicate is older.
    const r = (await db.query<{ created: boolean }>(`select uploaded_at = now() as created from evidence_files where id = $1`, [fileId])).rows[0];
    return { fileId, created: Boolean(r?.created) };
  });
}

// Decides the file the decider reviewed (fileId = the newest when the page was rendered);
// a newer upload since then is ERR_VERSION_CONFLICT.
export async function decideEvidence(db: pg.ClientBase, itemId: string, fileId: string, decision: "approved" | "rejected" | "revoked", reason?: string, validUntil?: string): Promise<void> {
  await call(() => db.query(`select evidence_decide($1, $2, $3, $4, $5)`, [itemId, fileId, decision, reason ?? null, validUntil ?? null]));
}

export async function downloadEvidence(db: pg.ClientBase, fileId: string): Promise<{ fileName: string; mediaType: string; content: Buffer; sha256: string }> {
  return call(async () => {
    const r = (await db.query(`select * from evidence_file_content($1)`, [fileId])).rows[0];
    if (!r) throw new CommandError("ERR_NOT_FOUND");
    return { fileName: r.file_name, mediaType: r.media_type, content: r.content, sha256: r.sha256 };
  });
}

// PR-97: a gated action calls this first; a closed gate is refused naming the missing
// evidence ("Fitur {x} terkunci sampai bukti {y} disetujui").
export class GateClosedError extends Error {
  constructor(readonly gate: string, readonly missing: string[]) {
    super(`Fitur ${GATE_LABEL[gate] ?? gate} terkunci sampai bukti ${missing.join(", ")} disetujui.`);
  }
}

export async function gateOpen(db: pg.ClientBase, gate: string): Promise<boolean> {
  return (await db.query<{ ok: boolean }>(`select feature_gate_open($1) as ok`, [gate])).rows[0].ok;
}

// Call inside the gated action's own transaction (withTenantContext): the evidence the gate reads is locked
// (FOR SHARE) until it commits, so a revocation cannot slip between check and action.
export async function assertFeatureGate(db: pg.ClientBase, gate: string): Promise<void> {
  // The lock-and-check runs first; the names of what is missing are read only when closed.
  // (feature_gate_open itself never raises, so the transaction stays usable.)
  await db.query(`select feature_gate_lock($1)`, [gate]);
  if (await gateOpen(db, gate)) return;
  const missing = (await db.query<{ label: string }>(`select label from feature_gate_missing($1)`, [gate])).rows.map((r) => r.label);
  throw new GateClosedError(gate, missing.length ? missing : ["yang diperlukan"]);
}
