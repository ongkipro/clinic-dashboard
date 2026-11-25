// Tenant export service & archive builder (PR-52, UX-32, TEN-18, RATE-5, SEC-5; T-122).
// DEL-2 auto-discovered `export` surface (`*.export.ts`).
// Closes Findings #1, #2, #3, #4, #6, #7, #8, #9 of t122/PLAN-REVIEW-codex-panel3.md:
// - Consumes real HYG-026 StepUp (verifyStepUp) on BOTH export request AND release (never forgeable).
// - Enforces lifecycle IN ('live','suspended','exit') on request, list, and release (refuses closed).
// - Release boundary verifies canonical persisted manifest_json === manifest_sha256, checks 1-to-1
//   (path, kind, size, sha256) + byte SHA-256 + pilot ceilings BEFORE building ZIP and BEFORE calling
//   export_release_commit (which appends success audit); any failure rolls back with zero bytes,
//   zero success audit, and a surviving separate-transaction denial audit.
// - Never logs patient names, clinical content, WhatsApp bodies, media bytes, or secrets.
import type pg from "pg";
import { verifyStepUp, type StepUp } from "../../auth/server";
import { withTenantContext, type TenantContext } from "../../db/rls/context";
import { CommandError, type ErrorCode } from "../../lib/command";
import { decryptField, type KekRing, type TenantKeys, type WrappedDek } from "../../lib/keys/envelope";
import { toCsv } from "../accounting/subledgers/subledgers";
import { renderPdf, type PdfLine } from "../clinical/records/pdf";
import {
  assertPilotCeilings,
  csvPath,
  ExportRuleError,
  exportZip,
  fhirPath,
  MAX_ENTRIES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  mediaPath,
  parseVerifiedManifest,
  pdfPath,
  verifyManifest,
  type ExportFile,
  type ExportState,
  type FileKind,
} from "./export";

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set([
  "ERR_FORBIDDEN",
  "ERR_NOT_FOUND",
  "ERR_INVALID_INPUT",
  "ERR_VERSION_CONFLICT",
  "ERR_TENANT_SUSPENDED",
  "ERR_RATE_LIMITED",
  "ERR_EXPIRED",
  "ERR_IMMUTABLE",
]);

function mapDbError(e: unknown): never {
  if (e instanceof CommandError) throw e;
  const msg = (e as { message?: string }).message ?? "";
  const m = CODE.exec(msg);
  if (m && KNOWN.has(m[1])) throw new ExportRuleError(m[1] as ErrorCode, m[2]);
  throw e;
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    mapDbError(e);
  }
}

export type TenantExportSummary = {
  id: string;
  state: ExportState;
  requestedAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  sizeBytes: number | null;
  fileCount: number | null;
  manifestSha256: string | null;
  downloadCount: number;
  errorCode: string | null;
  purgedAt: string | null;
};

// ── Owner request (Mulai Ekspor): HYG-026 fresh step-up + SQL owner/2FA/lifecycle/RATE-5/in-flight ──
export async function requestTenantExport(
  db: pg.ClientBase,
  key: string,
  stepUp: StepUp,
): Promise<{ id: string; replayed: boolean }> {
  if (!(await verifyStepUp(db, stepUp))) {
    throw new ExportRuleError("ERR_FORBIDDEN", "step_up_required");
  }
  const r = (
    await call(() =>
      db.query<{ r: { id: string; replayed: boolean } }>(`select public.export_request($1) as r`, [key]),
    )
  ).rows[0].r;
  return { id: r.id, replayed: Boolean(r.replayed) };
}

// ── Owner list (UX-32): owner-only; metadata only; refuses closed tenants ──
export async function listTenantExports(db: pg.ClientBase): Promise<{ jobs: TenantExportSummary[]; now: string }> {
  const raw = (
    await call(() => db.query<{ r: { now: string; jobs: Record<string, unknown>[] } }>(`select public.export_list() as r`))
  ).rows[0].r;
  return {
    now: raw.now,
    jobs: (raw.jobs ?? []).map((x) => ({
      id: x.id as string,
      state: x.state as ExportState,
      requestedAt: x.requested_at as string,
      completedAt: (x.completed_at as string | null) ?? null,
      expiresAt: (x.expires_at as string | null) ?? null,
      sizeBytes: x.size_bytes == null ? null : Number(x.size_bytes),
      fileCount: x.file_count == null ? null : Number(x.file_count),
      manifestSha256: (x.manifest_sha256 as string | null) ?? null,
      downloadCount: Number(x.download_count ?? 0),
      errorCode: (x.error_code as string | null) ?? null,
      purgedAt: (x.purged_at as string | null) ?? null,
    })),
  };
}

// Persists a content-free denial audit in a separate non-rolled-back transaction (Finding #8).
export async function recordExportDenialAudit(
  pool: pg.Pool,
  ctx: TenantContext,
  exportId: string | null,
  reasonCode: string,
): Promise<void> {
  const safeReason = /^[a-z][a-z0-9_]{1,48}$/.test(reasonCode) ? reasonCode : "export_release_denied";
  try {
    await withTenantContext(pool, ctx, async (db) => {
      await db.query(`select public.export_audit_denial($1, $2)`, [exportId, safeReason]);
    });
  } catch {
    // Non-fatal if caller context itself is invalid/revoked; primary denial still throws.
  }
}

export type ReleaseExportResult = {
  zip: Uint8Array;
  fileName: string;
  manifestSha256: string;
  sizeBytes: number;
};

type LoadedReleaseRow = {
  export_id: string;
  tenant_id: string;
  published_generation: number;
  completed_at: string;
  manifest_json: string;
  manifest_sha256: string;
  path: string | null;
  kind: FileKind | null;
  sha256: string | null;
  size: string | number | null;
  bytes: Buffer | null;
};

// ── Single guarded release boundary (Findings #3, #4, #6, #7, #8) ──
// Acquires per-tenant export lock + row lock in SQL, verifies HYG-026 fresh step-up, lifecycle,
// expiry, canonical manifest_json === manifest_sha256, 1-to-1 file rows + byte SHA-256 + pilot
// ceilings, builds ZIP, and ONLY THEN calls export_release_commit (which increments download_count
// and appends audit_append 'success'). Any refusal rolls back and logs a surviving denial audit.
export async function releaseTenantExport(
  pool: pg.Pool,
  ctx: TenantContext,
  exportId: string,
  stepUp: StepUp,
): Promise<ReleaseExportResult> {
  try {
    return await withTenantContext(pool, ctx, async (db) => {
      if (!(await verifyStepUp(db, stepUp))) {
        throw new ExportRuleError("ERR_FORBIDDEN", "step_up_required");
      }

      const rows = (
        await call(() =>
          db.query<LoadedReleaseRow>(`select * from public.export_release_load($1)`, [exportId]),
        )
      ).rows;
      if (rows.length === 0) {
        throw new ExportRuleError("ERR_NOT_FOUND", "export");
      }

      const head = rows[0];
      if (head.tenant_id !== ctx.tenantId || head.export_id !== exportId) {
        throw new ExportRuleError("ERR_VERSION_CONFLICT", "manifest_identity_mismatch");
      }

      const manifest = parseVerifiedManifest(head.manifest_json, head.manifest_sha256, {
        tenantId: ctx.tenantId,
        exportId,
        generation: head.published_generation,
      });

      const files: ExportFile[] = [];
      for (const r of rows) {
        if (r.path === null) continue;
        if (!r.kind || !r.sha256 || r.bytes === null) {
          throw new ExportRuleError("ERR_VERSION_CONFLICT", "export_bytes_missing");
        }
        const bytes = new Uint8Array(r.bytes);
        if (bytes.byteLength !== Number(r.size)) {
          throw new ExportRuleError("ERR_VERSION_CONFLICT", "export_size_mismatch");
        }
        files.push({ path: r.path, kind: r.kind, bytes });
      }

      assertPilotCeilings(files);
      const problems = verifyManifest(manifest, files);
      if (problems.length > 0) {
        throw new ExportRuleError("ERR_VERSION_CONFLICT", `manifest_integrity:${problems[0]}`);
      }

      const zip = exportZip(manifest, files, new Date(head.completed_at));

      // Success audit and download_count increment happen ONLY AFTER full integrity & ZIP verification!
      await call(() => db.query(`select public.export_release_commit($1)`, [exportId]));

      return {
        zip,
        fileName: `ekspor-${exportId}.zip`,
        manifestSha256: head.manifest_sha256,
        sizeBytes: zip.byteLength,
      };
    });
  } catch (e) {
    const reason = e instanceof ExportRuleError ? e.reason.replace(/[^a-z0-9_]/gi, "_").toLowerCase().slice(0, 48) : "export_release_failed";
    await recordExportDenialAudit(pool, ctx, exportId, reason || "export_release_denied");
    throw e;
  }
}

// ── Snapshot-to-files builder (Finding #9: explicit data inventory, D2 local-ID FHIR, D3/D4 media & WA) ──
export type TenantSnapshot = {
  tenant: { id: string; legal_name: string };
  tenant_keys: { version: number; wrapped: string }[];
  patients: {
    id: string;
    mrn: string;
    full_name: string;
    birth_date: string;
    sex: string;
    identity_type: string;
    identity_enc: string | null;
    religion: string;
    occupation: string;
    education: string;
    marital_status: string;
    address: string | null;
    ihs_patient_id: string | null;
    registered_branch_id: string;
    created_at: string;
    phone: string | null;
  }[];
  visits: {
    id: string;
    branch_id: string;
    branch_name: string;
    patient_id: string;
    kind: string;
    checked_in_at: string;
    closed_at: string | null;
  }[];
  record_versions: {
    id: string;
    branch_id: string;
    branch_name: string;
    examination_id: string;
    visit_id: string;
    patient_id: string;
    version: number;
    kind: string;
    author_name: string;
    signed_at: string | null;
    created_at: string;
    content: Record<string, unknown>;
  }[];
  media: {
    id: string;
    patient_id: string;
    content_type: string;
    sha256: string;
    content_b64: string;
  }[];
  invoices: {
    id: string;
    branch_id: string;
    patient_id: string;
    visit_id: string | null;
    number: string | null;
    state: string;
    issued_at: string | null;
    created_at: string;
  }[];
  invoice_lines: {
    id: string;
    invoice_id: string;
    item_id: string;
    quantity: number;
    unit_price: number;
    discount: number;
    line_total: number;
    tax_category: string;
    vat_base: number;
    vat_amount: number;
    created_at: string;
  }[];
  payments: {
    id: string;
    branch_id: string;
    invoice_id: string;
    patient_id: string;
    method: string;
    amount: number;
    is_simulated: boolean;
    received_at: string;
  }[];
  packages: {
    id: string;
    sold_branch_id: string;
    patient_id: string;
    invoice_id: string;
    item_id: string;
    price: number;
    state: string;
    validity_end: string | null;
    created_at: string;
  }[];
  balance_entries: {
    id: string;
    account_id: string;
    patient_id: string;
    branch_id: string;
    kind: string;
    amount: number;
    balance_after: number;
    created_at: string;
  }[];
  receivables: {
    id: string;
    branch_id: string;
    patient_id: string;
    visit_id: string | null;
    amount: number;
    collected_amount: number;
    written_off_amount: number;
    state: string;
    created_at: string;
  }[];
  journal_entries: {
    id: string;
    kind: string;
    event: string;
    source_kind: string;
    source_id: string;
    business_date: string;
    period: string;
    posted_at: string;
  }[];
  journal_lines: {
    id: string;
    entry_id: string;
    account_id: string;
    branch_id: string | null;
    debit: number;
    credit: number;
  }[];
  leads: {
    id: string;
    branch_id: string | null;
    source: string;
    patient_id: string | null;
    contact_name_enc: string | null;
    contact_phone: string | null;
    stage: string;
    created_at: string;
  }[];
  conversations: {
    id: string;
    branch_id: string | null;
    patient_id: string | null;
    contact_wa_id: string;
    contact_name_enc: string | null;
    state: string;
    last_inbound_at: string | null;
    created_at: string;
  }[];
  messages: {
    id: string;
    conversation_id: string;
    direction: string;
    kind: string;
    body_enc: string | null;
    status: string;
    created_at: string;
  }[];
};

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

// Producers' canonical AEAD purpose identifiers (patients/identity, crm/leads/leads.ts, messaging/inbox/inbox.ts).
export const EXPORT_DECRYPT_PURPOSES = {
  patientIdentity: "patient.identity",
  leadContact: "lead.contact",
  conversationContact: "message.contact",
  messageBody: "message.body",
} as const;

// Fail-closed field decryption (R3 P1-1): if an encrypted column is present, missing keys or
// decryption errors MUST abort the export visibly instead of silently publishing "[encrypted]".
function requireDecrypt(
  ring: KekRing | undefined,
  keys: TenantKeys | undefined,
  purpose: string,
  enc: string | null,
): string {
  if (!enc) return "";
  if (!ring || !keys) {
    throw new ExportRuleError("ERR_INVALID_INPUT", "decrypt_failed");
  }
  try {
    return decryptField(ring, keys, purpose, enc);
  } catch {
    throw new ExportRuleError("ERR_INVALID_INPUT", "decrypt_failed");
  }
}

const s = (v: unknown): string | null => (v == null ? null : String(v));

function buildPatientFhirBundle(
  patient: TenantSnapshot["patients"][number],
  nikPlain: string,
  visits: TenantSnapshot["visits"],
  versions: TenantSnapshot["record_versions"],
): Uint8Array {
  const entries: Record<string, unknown>[] = [
    {
      fullUrl: `urn:uuid:${patient.id}`,
      resource: {
        resourceType: "Patient",
        id: patient.id,
        identifier: [
          { system: "urn:clinic-dashboard:mrn", value: patient.mrn },
          ...(nikPlain && nikPlain !== "[encrypted]"
            ? [{ system: "https://fhir.kemkes.go.id/id/nik", value: nikPlain }]
            : []),
          ...(patient.ihs_patient_id
            ? [{ system: "https://fhir.kemkes.go.id/id/ihs-number", value: patient.ihs_patient_id }]
            : []),
        ],
        name: [{ text: patient.full_name }],
        gender: patient.sex,
        birthDate: patient.birth_date,
        ...(patient.phone ? { telecom: [{ system: "phone", value: patient.phone }] } : {}),
        ...(patient.address ? { address: [{ text: patient.address }] } : {}),
      },
    },
  ];

  for (const v of visits) {
    entries.push({
      fullUrl: `urn:uuid:${v.id}`,
      resource: {
        resourceType: "Encounter",
        id: v.id,
        status: v.closed_at ? "finished" : "in-progress",
        subject: { reference: `Patient/${patient.id}` },
        period: { start: v.checked_in_at, ...(v.closed_at ? { end: v.closed_at } : {}) },
        serviceProvider: { display: v.branch_name },
      },
    });
  }

  for (const rv of versions) {
    const content = rv.content ?? {};
    const icd = Array.isArray(content.icd10_codes) ? (content.icd10_codes as string[]) : [];
    for (let i = 0; i < icd.length; i++) {
      entries.push({
        fullUrl: `urn:uuid:${rv.id}-cond-${i}`,
        resource: {
          resourceType: "Condition",
          id: `${rv.id}-cond-${i}`,
          subject: { reference: `Patient/${patient.id}` },
          encounter: { reference: `Encounter/${rv.visit_id}` },
          code: { coding: [{ system: "http://hl7.org/fhir/sid/icd-10", code: icd[i] }] },
          recordedDate: rv.signed_at ?? rv.created_at,
        },
      });
    }
    const vitals = (content.vitals && typeof content.vitals === "object" ? content.vitals : {}) as Record<string, unknown>;
    for (const [vk, vv] of Object.entries(vitals)) {
      if (typeof vv !== "number") continue;
      entries.push({
        fullUrl: `urn:uuid:${rv.id}-obs-${vk}`,
        resource: {
          resourceType: "Observation",
          id: `${rv.id}-obs-${vk}`,
          status: "final",
          subject: { reference: `Patient/${patient.id}` },
          encounter: { reference: `Encounter/${rv.visit_id}` },
          code: { text: vk },
          valueQuantity: { value: vv },
          effectiveDateTime: rv.signed_at ?? rv.created_at,
        },
      });
    }
  }

  return new TextEncoder().encode(
    JSON.stringify({ resourceType: "Bundle", type: "collection", entry: entries }, null, 2) + "\n",
  );
}

function buildRecordPdf(
  clinicName: string,
  patient: TenantSnapshot["patients"][number],
  rv: TenantSnapshot["record_versions"][number],
): Uint8Array {
  const c = rv.content ?? {};
  const lines: PdfLine[] = [
    { text: `Rekam Medis - ${clinicName}`, bold: true },
    { text: `Pasien: ${patient.full_name} (${patient.mrn}), lahir ${patient.birth_date}` },
    { text: `Cabang: ${rv.branch_name} | Penulis: ${rv.author_name} | Versi ${rv.version} (${rv.kind})` },
    { text: `Ditandatangani: ${rv.signed_at ?? rv.created_at}` },
    { text: "" },
  ];
  for (const [k, label] of [
    ["subjective", "Subjektif"],
    ["objective", "Objektif"],
    ["assessment", "Asesmen"],
    ["plan_note", "Rencana"],
  ] as const) {
    if (typeof c[k] === "string" && c[k]) lines.push({ text: `${label}: ${c[k]}` });
  }
  if (Array.isArray(c.icd10_codes) && c.icd10_codes.length > 0) {
    lines.push({ text: `Diagnosis (ICD-10): ${(c.icd10_codes as string[]).join(", ")}` });
  }
  return new Uint8Array(renderPdf(lines));
}

export function buildTenantExportFiles(
  snapshot: TenantSnapshot,
  opts: { kekRing?: KekRing } = {},
): ExportFile[] {
  const keyMap = new Map<number, WrappedDek>(
    snapshot.tenant_keys.map((k) => [k.version, { tenantId: snapshot.tenant.id, version: k.version, wrapped: k.wrapped }]),
  );
  const maxVer = snapshot.tenant_keys.length > 0 ? Math.max(...snapshot.tenant_keys.map((k) => k.version)) : 0;
  const keys: TenantKeys | undefined =
    opts.kekRing && maxVer > 0
      ? {
          tenantId: snapshot.tenant.id,
          current: keyMap.get(maxVer)!,
          byVersion: (v: number) => keyMap.get(v),
        }
      : undefined;

  const files: ExportFile[] = [];
  let totalBytes = 0;
  // DEC-117 Row 9 P2: enforce entry/file/total ceilings BEFORE allocating or buffering oversized
  // payloads (entry capacity check pre-generation, base64 decoded-length preflight, row-by-row CSV byte budget).
  const checkEntrySlot = () => {
    if (files.length >= MAX_ENTRIES) {
      throw new ExportRuleError("ERR_INVALID_INPUT", "export_too_many_entries");
    }
  };
  const checkByteBudget = (size: number) => {
    if (size > MAX_FILE_BYTES) {
      throw new ExportRuleError("ERR_INVALID_INPUT", "export_file_too_large");
    }
    if (totalBytes + size > MAX_TOTAL_BYTES) {
      throw new ExportRuleError("ERR_INVALID_INPUT", "export_total_too_large");
    }
  };
  const pushFile = (f: ExportFile) => {
    checkEntrySlot();
    checkByteBudget(f.bytes.byteLength);
    totalBytes += f.bytes.byteLength;
    files.push(f);
  };
  const estimateBase64Bytes = (b64: string): number => {
    const clean = b64.replace(/\s+/g, "");
    const pad = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((clean.length * 3) / 4) - pad);
  };
  const sortedPatients = [...snapshot.patients].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const patientIndex = new Map<string, number>();
  sortedPatients.forEach((p, idx) => patientIndex.set(p.id, idx + 1));

  // Per-patient FHIR R4 Bundle (local IDs, D2=a)
  for (const p of sortedPatients) {
    checkEntrySlot();
    const n = patientIndex.get(p.id)!;
    const nikPlain = requireDecrypt(opts.kekRing, keys, EXPORT_DECRYPT_PURPOSES.patientIdentity, p.identity_enc);
    const pVisits = snapshot.visits.filter((v) => v.patient_id === p.id);
    const pVersions = snapshot.record_versions.filter((rv) => rv.patient_id === p.id);
    pushFile({
      path: fhirPath(n),
      kind: "fhir",
      bytes: buildPatientFhirBundle(p, nikPlain, pVisits, pVersions),
    });
    for (const rv of pVersions) {
      checkEntrySlot();
      pushFile({
        path: pdfPath(n, rv.version, rv.id),
        kind: "pdf",
        bytes: buildRecordPdf(snapshot.tenant.legal_name, p, rv),
      });
    }
  }

  // Clinical media bytes stored separately (D3/D4, never logged); preflight decoded length BEFORE Buffer.from()
  for (const m of snapshot.media) {
    const n = patientIndex.get(m.patient_id);
    if (!n) continue;
    checkEntrySlot();
    checkByteBudget(estimateBase64Bytes(m.content_b64));
    const ext = EXT_BY_MIME[m.content_type] ?? "bin";
    pushFile({
      path: mediaPath(n, m.id, ext),
      kind: "media",
      bytes: new Uint8Array(Buffer.from(m.content_b64, "base64")),
    });
  }

  // 13 formula-safe CSV families (explicit inventory, zero runtime secrets/credentials/DEKs/auth hashes);
  // preflight entry slot BEFORE building rows and check remaining byte budget cell-by-cell BEFORE allocating row buffers.
  const csvCellBytes = (val: string | null): number => {
    if (val === null) return 0;
    let quoteCount = 0;
    for (let k = 0; k < val.length; k++) if (val.charCodeAt(k) === 34) quoteCount++;
    const raw = Buffer.byteLength(val, "utf8");
    // Exact RFC 4180 formula-safe size without allocating an escaped copy:
    // leading "'" + outer quotes + 1 extra byte per embedded '"'
    const needsQuote = quoteCount > 0 || /[,\r\n]/.test(val);
    const formulaPrefix = /^[=+\-@\t\r]/.test(val) ? 1 : 0;
    return raw + formulaPrefix + quoteCount + (needsQuote ? 2 : 0);
  };
  const addCsv = (family: string, buildRows: () => (string | null)[][]) => {
    checkEntrySlot();
    const rows = buildRows();
    const chunks: Buffer[] = [];
    let csvBytes = 3; // UTF-8 BOM on header row
    checkByteBudget(csvBytes);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      // Preflight estimated row byte size BEFORE serializing or allocating the Buffer
      let estRowBytes = Math.max(0, row.length - 1) + 2; // commas + CRLF
      for (let j = 0; j < row.length; j++) {
        estRowBytes += csvCellBytes(row[j]);
        checkByteBudget(csvBytes + estRowBytes);
      }
      const lineStr = i === 0 ? toCsv([row]) : toCsv([row]).replace(/^\uFEFF/, "");
      const buf = Buffer.from(lineStr, "utf8");
      const actualBytes = i === 0 ? buf.byteLength : csvBytes + buf.byteLength;
      csvBytes = actualBytes;
      checkByteBudget(csvBytes);
      chunks.push(buf);
    }
    pushFile({ path: csvPath(family), kind: "csv", bytes: new Uint8Array(Buffer.concat(chunks, csvBytes)) });
  };

  addCsv("pasien", () => [
    ["id", "mrn", "full_name", "birth_date", "sex", "identity_type", "identity_number", "phone", "address", "ihs_patient_id", "registered_branch_id", "created_at"],
    ...sortedPatients.map((p) => [
      p.id,
      p.mrn,
      p.full_name,
      p.birth_date,
      p.sex,
      p.identity_type,
      requireDecrypt(opts.kekRing, keys, EXPORT_DECRYPT_PURPOSES.patientIdentity, p.identity_enc),
      p.phone,
      p.address,
      p.ihs_patient_id,
      p.registered_branch_id,
      p.created_at,
    ]),
  ]);

  addCsv("kunjungan", () => [
    ["id", "branch_id", "patient_id", "kind", "checked_in_at", "closed_at"],
    ...snapshot.visits.map((v) => [v.id, v.branch_id, v.patient_id, v.kind, v.checked_in_at, v.closed_at]),
  ]);

  addCsv("tagihan", () => [
    ["id", "branch_id", "patient_id", "visit_id", "number", "state", "issued_at", "created_at"],
    ...snapshot.invoices.map((i) => [i.id, i.branch_id, i.patient_id, i.visit_id, i.number, i.state, i.issued_at, i.created_at]),
  ]);

  addCsv("baris_tagihan", () => [
    ["id", "invoice_id", "item_id", "quantity", "unit_price", "discount", "line_total", "tax_category", "vat_base", "vat_amount", "created_at"],
    ...snapshot.invoice_lines.map((l) => [l.id, l.invoice_id, l.item_id, s(l.quantity), s(l.unit_price), s(l.discount), s(l.line_total), l.tax_category, s(l.vat_base), s(l.vat_amount), l.created_at]),
  ]);

  addCsv("pembayaran", () => [
    ["id", "branch_id", "invoice_id", "patient_id", "method", "amount", "is_simulated", "received_at"],
    ...snapshot.payments.map((p) => [p.id, p.branch_id, p.invoice_id, p.patient_id, p.method, s(p.amount), s(p.is_simulated), p.received_at]),
  ]);

  addCsv("paket", () => [
    ["id", "sold_branch_id", "patient_id", "invoice_id", "item_id", "price", "state", "validity_end", "created_at"],
    ...snapshot.packages.map((p) => [p.id, p.sold_branch_id, p.patient_id, p.invoice_id, p.item_id, s(p.price), p.state, p.validity_end, p.created_at]),
  ]);

  addCsv("saldo", () => [
    ["id", "account_id", "patient_id", "branch_id", "kind", "amount", "balance_after", "created_at"],
    ...snapshot.balance_entries.map((b) => [b.id, b.account_id, b.patient_id, b.branch_id, b.kind, s(b.amount), s(b.balance_after), b.created_at]),
  ]);

  addCsv("piutang", () => [
    ["id", "branch_id", "patient_id", "visit_id", "amount", "collected_amount", "written_off_amount", "state", "created_at"],
    ...snapshot.receivables.map((r) => [r.id, r.branch_id, r.patient_id, r.visit_id, s(r.amount), s(r.collected_amount), s(r.written_off_amount), r.state, r.created_at]),
  ]);

  addCsv("jurnal", () => [
    ["id", "kind", "event", "source_kind", "source_id", "business_date", "period", "posted_at"],
    ...snapshot.journal_entries.map((j) => [j.id, j.kind, j.event, j.source_kind, j.source_id, j.business_date, j.period, j.posted_at]),
  ]);

  addCsv("baris_jurnal", () => [
    ["id", "entry_id", "account_id", "branch_id", "debit", "credit"],
    ...snapshot.journal_lines.map((jl) => [jl.id, jl.entry_id, jl.account_id, jl.branch_id, s(jl.debit), s(jl.credit)]),
  ]);

  addCsv("lead", () => [
    ["id", "branch_id", "source", "patient_id", "contact_name", "contact_phone", "stage", "created_at"],
    ...snapshot.leads.map((l) => [
      l.id,
      l.branch_id,
      l.source,
      l.patient_id,
      requireDecrypt(opts.kekRing, keys, EXPORT_DECRYPT_PURPOSES.leadContact, l.contact_name_enc),
      l.contact_phone,
      l.stage,
      l.created_at,
    ]),
  ]);

  addCsv("percakapan", () => [
    ["id", "branch_id", "patient_id", "contact_wa_id", "contact_name", "state", "last_inbound_at", "created_at"],
    ...snapshot.conversations.map((c) => [
      c.id,
      c.branch_id,
      c.patient_id,
      c.contact_wa_id,
      requireDecrypt(opts.kekRing, keys, EXPORT_DECRYPT_PURPOSES.conversationContact, c.contact_name_enc),
      c.state,
      c.last_inbound_at,
      c.created_at,
    ]),
  ]);

  addCsv("pesan_wa", () => [
    ["id", "conversation_id", "direction", "kind", "body", "status", "created_at"],
    ...snapshot.messages.map((m) => [
      m.id,
      m.conversation_id,
      m.direction,
      m.kind,
      requireDecrypt(opts.kekRing, keys, EXPORT_DECRYPT_PURPOSES.messageBody, m.body_enc),
      m.status,
      m.created_at,
    ]),
  ]);

  assertPilotCeilings(files);
  return files;
}
