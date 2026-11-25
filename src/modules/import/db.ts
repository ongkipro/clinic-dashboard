// Opening-data import AEAD row envelope + PostgreSQL definer adapter (PR-85, DATA-58, MIG-3, DEC-133; T-128).
// - Trusted writer boundary (r3 P1 #1 & P2 #5): import_stage, import_staged_rows_for_apply, import_apply, and
//   import_purge_expired are granted STRICTLY to clinic_executor (revoked from PUBLIC and clinic_app).
// - Strict minimal projection (r4 P2 #3): buildRowApplyData projects ONLY the exact fields SQL consumes (zero nik
//   or unconsumed payload fields cross the wire), and sanitizeImportError strips pg detail/hint/where metadata.
// - Leap-day anniversary rule (r4 P2 #4): defaultOpeningPackageExpiry clamps Feb 29 -> Feb 28 in non-leap years and
//   validates every resolved calendar date before sealing.
// - Active service catalog version binding (r4 P2 #2): stageValidatedImportBatch binds exact active service
//   catalogVersionId into applyDigest and manifest; SQL import_apply rechecks active service eligibility.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { ClientBase, Pool } from "pg";
import { bindResidencyContext } from "../platform/residency";
import {
  computeCanonicalPayloadSha256,
  computeSourceKeyHash,
  dryRunValidateImport,
  type ImportBatchInput,
  type ImportEntityKind,
  type NormalizedRow,
  type ReconciliationSummary,
} from "./parser";
import type { ImportRollbackReason } from "./schema";

type Db = Pick<Pool, "query"> | Pick<ClientBase, "query">;

const ENVELOPE_RE = /^v1\.([1-9][0-9]{0,8})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]+)$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIXED_ERR_RE = /^(ERR_[A-Z_]+(?:: [A-Za-z0-9 _.:-]+)?)$/;

function isValidCalendarIsoDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const y = Number.parseInt(iso.slice(0, 4), 10);
  const m = Number.parseInt(iso.slice(5, 7), 10);
  const d = Number.parseInt(iso.slice(8, 10), 10);
  if (y < 1900 || y > 2100 || m < 1 || m > 12) return false;
  const maxDay =
    m === 2 ? (y % 400 === 0 || (y % 4 === 0 && y % 100 !== 0) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31;
  return d >= 1 && d <= maxDay;
}

// Calendar anniversary +1 year rule (r4 P2 #4): clamps Feb 29 -> Feb 28 in non-leap years and validates result.
export function defaultOpeningPackageExpiry(cutoverDate: string): string {
  if (!isValidCalendarIsoDate(cutoverDate)) {
    throw new Error("ERR_INVALID_INPUT: invalid cutover date");
  }
  const nextYear = Number.parseInt(cutoverDate.slice(0, 4), 10) + 1;
  const md = cutoverDate.slice(5);
  const targetLeap = nextYear % 400 === 0 || (nextYear % 4 === 0 && nextYear % 100 !== 0);
  const resolvedMd = md === "02-29" && !targetLeap ? "02-28" : md;
  const resolved = `${String(nextYear).padStart(4, "0")}-${resolvedMd}`;
  if (!isValidCalendarIsoDate(resolved)) {
    throw new Error("ERR_INVALID_INPUT: invalid resolved expiry date");
  }
  return resolved;
}

// Scrubs pg error metadata (detail, hint, where, parameters) so surfaced diagnostics never echo patient data (r4 P2 #3).
function sanitizeImportError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : "";
  if (FIXED_ERR_RE.test(msg)) return new Error(msg);
  if (msg.includes("real_patient_gate")) return new Error("ERR_FORBIDDEN: real_patient_gate");
  const prefix = /^(ERR_[A-Z_]+)/.exec(msg);
  if (prefix) return new Error(`${prefix[1]}: import operation failed`);
  return new Error("ERR_IMPORT_FAILED: import operation failed");
}

export function computeApplyDigest(params: {
  entity: ImportEntityKind;
  branchId: string;
  amountIdr: string;
  data: Record<string, unknown>;
}): string {
  let tuple: string;
  if (params.entity === "patients") {
    const fullName = String(params.data.fullName ?? "").trim();
    const birthDate = String(params.data.birthDate ?? "");
    const sex = String(params.data.sex ?? "");
    const phone = params.data.phone ? String(params.data.phone).trim() : "";
    tuple = `v1|patients|${params.branchId}|${fullName}|${birthDate}|${sex}|${phone}`;
  } else {
    const patientHash = String(params.data.patientSourceKeyHash ?? "");
    if (params.entity === "packages") {
      const catCode = String(params.data.catalogCode ?? "").trim().toUpperCase();
      const catVerId = String(params.data.catalogVersionId ?? "").trim().toLowerCase();
      const rem = String(params.data.remainingSessions ?? "");
      const hist = String(params.data.historicalUsedCount ?? "0");
      const exp = String(params.data.expiresOn ?? "");
      tuple = `v1|packages|${params.branchId}|${patientHash}|${params.amountIdr}|${catCode}|${catVerId}|${rem}|${hist}|${exp}`;
    } else {
      tuple = `v1|${params.entity}|${params.branchId}|${patientHash}|${params.amountIdr}`;
    }
  }
  return createHash("sha256").update(tuple, "utf8").digest("hex");
}

// Strict minimal allowlist projection (r4 P2 #3): ONLY fields SQL import_apply consumes ever enter applyData.
function buildRowApplyData(
  r: NormalizedRow,
  params: {
    tenantHmacKey: Buffer;
    sourceSystem: string;
    cutoverDate: string;
    serviceVersionLookup: ReadonlyMap<string, string>;
  },
): Record<string, unknown> {
  const src = params.sourceSystem.trim().toLowerCase();
  if (r.entity === "patients") {
    const birthDate = String(r.payload.birthDate ?? "");
    if (!isValidCalendarIsoDate(birthDate)) {
      throw new Error("ERR_INVALID_INPUT: invalid date");
    }
    return {
      fullName: String(r.payload.fullName ?? "").trim(),
      birthDate,
      sex: String(r.payload.sex ?? ""),
      phone: typeof r.payload.phone === "string" && r.payload.phone.trim() ? r.payload.phone.trim() : null,
    };
  }
  const patExt = typeof r.payload.patientExternalId === "string" ? r.payload.patientExternalId.trim() : "";
  if (!patExt) throw new Error("ERR_INVALID_INPUT: missing patient reference");
  const patientSourceKeyHash = computeSourceKeyHash(params.tenantHmacKey, src, "patients", patExt);

  if (r.entity === "packages") {
    const catCode = String(r.payload.catalogCode ?? "").trim().toUpperCase();
    const catalogVersionId = params.serviceVersionLookup.get(catCode)?.toLowerCase() ?? null;
    if (!catalogVersionId || !UUID_RE.test(catalogVersionId)) {
      throw new Error("ERR_NOT_FOUND: unmapped active catalog service version");
    }
    const rawExpiry = typeof r.payload.expiresOn === "string" && r.payload.expiresOn.trim() ? r.payload.expiresOn.trim() : null;
    const expiresOn = rawExpiry ?? defaultOpeningPackageExpiry(params.cutoverDate);
    if (!isValidCalendarIsoDate(expiresOn)) {
      throw new Error("ERR_INVALID_INPUT: invalid date");
    }
    return {
      patientSourceKeyHash,
      catalogCode: catCode,
      catalogVersionId,
      remainingSessions: r.payload.remainingCount,
      historicalUsedCount: r.payload.historicalUsedCount ?? 0,
      expiresOn,
    };
  }

  return { patientSourceKeyHash };
}

export function encryptImportRowPayload(
  dek: Buffer,
  aadContext: {
    tenantId: string;
    entity: ImportEntityKind;
    rowNo: number;
    sourceKeyHash: string;
    applyDigest: string;
    dekVersion: number;
  },
  payload: Record<string, unknown>,
): string {
  if (dek.byteLength !== 32) throw new Error("ERR_INVALID_DEK: expected 32-byte AES-256 key");
  if (!Number.isInteger(aadContext.dekVersion) || aadContext.dekVersion < 1) {
    throw new Error("ERR_INVALID_DEK: dekVersion must be positive integer");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dek, iv);
  const aad = `${aadContext.tenantId}|${aadContext.entity}|${aadContext.rowNo}|${aadContext.sourceKeyHash}|${aadContext.applyDigest}|${aadContext.dekVersion}`;
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const pt = Buffer.from(JSON.stringify(payload), "utf8");
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${aadContext.dekVersion}.${iv.toString("base64url")}.${tag.toString("base64url")}.${ct.toString("base64url")}`;
}

export function decryptImportRowPayload<T = Record<string, unknown>>(
  dek: Buffer,
  aadContext: {
    tenantId: string;
    entity: ImportEntityKind;
    rowNo: number;
    sourceKeyHash: string;
    applyDigest: string;
    dekVersion: number;
  },
  encoded: string,
): T {
  if (dek.byteLength !== 32) throw new Error("ERR_INVALID_DEK: expected 32-byte AES-256 key");
  const m = ENVELOPE_RE.exec(encoded);
  if (!m) throw new Error("ERR_INVALID_CIPHERTEXT");
  const ver = Number.parseInt(m[1], 10);
  if (ver !== aadContext.dekVersion) throw new Error("ERR_INVALID_CIPHERTEXT");
  const iv = Buffer.from(m[2], "base64url");
  const tag = Buffer.from(m[3], "base64url");
  const ct = Buffer.from(m[4], "base64url");
  if (iv.byteLength !== 12 || tag.byteLength !== 16 || ct.byteLength < 1) {
    throw new Error("ERR_INVALID_CIPHERTEXT");
  }
  const decipher = createDecipheriv("aes-256-gcm", dek, iv);
  const aad = `${aadContext.tenantId}|${aadContext.entity}|${aadContext.rowNo}|${aadContext.sourceKeyHash}|${aadContext.applyDigest}|${aadContext.dekVersion}`;
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(pt.toString("utf8")) as T;
}

export type StagedBatchResult = {
  batchId: string;
  state: "validated";
  validationRevision: number;
  rowCount: number;
  validatedManifestSha256: string;
};

// Trusted executor writer (clinic_executor): resolves active service catalogVersionId directly from PostgreSQL
// by (tenantId, upper(code)) (never accepts caller-supplied catalog UUIDs), suppresses PostgreSQL bind-parameter
// error logging (`SET LOCAL log_parameter_max_length_on_error = 0`), validates under tenantHmacKey,
// seals strict allowlisted applyData in versioned AEAD envelopes, and stages via SQL import_stage.
export async function stageValidatedImportBatch(
  execDb: ClientBase,
  params: {
    tenantId: string;
    actorStaffId: string;
    tenantHmacKey: Buffer;
    dek: Buffer;
    dekVersion: number;
    branchIdByCode: ReadonlyMap<string, string>;
    input: Omit<ImportBatchInput, "tenantHmacKey" | "knownBranchCodes" | "knownServiceCodes">;
    env?: NodeJS.ProcessEnv;
  },
): Promise<StagedBatchResult> {
  await execDb.query(`SET LOCAL log_parameter_max_length_on_error = 0`);
  await bindResidencyContext(execDb, params.env);
  const src = params.input.sourceSystem.trim().toLowerCase();
  const branchLookup = new Map<string, string>();
  for (const [k, v] of params.branchIdByCode.entries()) {
    branchLookup.set(k.trim().toUpperCase(), v);
  }

  let activeServicesRaw: Record<string, string>;
  try {
    const svcRes = await execDb.query<{ res: Record<string, string> }>(
      `SELECT public.import_active_catalog_services($1::uuid, $2::uuid) AS res`,
      [params.tenantId, params.actorStaffId],
    );
    activeServicesRaw = svcRes.rows[0]?.res ?? {};
  } catch (err) {
    throw sanitizeImportError(err);
  }

  const serviceVersionLookup = new Map<string, string>();
  for (const [k, v] of Object.entries(activeServicesRaw)) {
    serviceVersionLookup.set(k.trim().toUpperCase(), v.toLowerCase());
  }
  const validated = dryRunValidateImport({
    ...params.input,
    sourceSystem: src,
    tenantHmacKey: params.tenantHmacKey,
    knownBranchCodes: new Set(branchLookup.keys()),
    knownServiceCodes: new Set(serviceVersionLookup.keys()),
  });
  if (!validated.ok) {
    throw new Error("ERR_INVALID_INPUT: batch failed dry-run validation");
  }
  const rowsPayload = validated.rows.map((r: NormalizedRow) => {
    const branchId = r.branchCode ? (branchLookup.get(r.branchCode.trim().toUpperCase()) ?? null) : null;
    if (!branchId) throw new Error("ERR_NOT_FOUND: unmapped branch");
    const applyData = buildRowApplyData(r, {
      tenantHmacKey: params.tenantHmacKey,
      sourceSystem: src,
      cutoverDate: validated.summary.cutoverDate,
      serviceVersionLookup,
    });
    const applyDigest = computeApplyDigest({
      entity: r.entity,
      branchId,
      amountIdr: r.amountIdr.toString(),
      data: applyData,
    });
    const enc = encryptImportRowPayload(
      params.dek,
      {
        tenantId: params.tenantId,
        entity: r.entity,
        rowNo: r.rowNo,
        sourceKeyHash: r.sourceKeyHash,
        applyDigest,
        dekVersion: params.dekVersion,
      },
      { payload: r.payload, applyData },
    );
    return {
      entity: r.entity,
      rowNo: r.rowNo,
      sourceKeyHash: r.sourceKeyHash,
      canonicalPayloadSha256: r.canonicalPayloadSha256,
      applyDigest,
      branchId,
      amountIdr: r.amountIdr.toString(),
      payloadEnc: enc,
      dekVersion: params.dekVersion,
    };
  });

  try {
    const { rows } = await execDb.query<{ res: StagedBatchResult }>(
      `SELECT public.import_stage($1::uuid, $2::uuid, $3::text, $4::date, $5::jsonb) AS res`,
      [
        params.tenantId,
        params.actorStaffId,
        src,
        validated.summary.cutoverDate,
        JSON.stringify(rowsPayload),
      ],
    );
    return rows[0].res;
  } catch (err) {
    throw sanitizeImportError(err);
  }
}

// Owner UI approval (clinic_app): approves the exact SQL-derived validatedManifestSha256 of staged rows.
export async function approveImportBatch(
  db: ClientBase,
  batchId: string,
  validationRevision: number,
  manifestSha256: string,
  env?: NodeJS.ProcessEnv,
): Promise<{ batchId: string; state: "approved" }> {
  await bindResidencyContext(db, env);
  const { rows } = await db.query<{ res: { batchId: string; state: "approved" } }>(
    `SELECT public.import_approve($1::uuid, $2::int, $3::text) AS res`,
    [batchId, validationRevision, manifestSha256],
  );
  return rows[0].res;
}

type StagedRowForApply = {
  entity: ImportEntityKind;
  rowNo: number;
  sourceKeyHash: string;
  canonicalPayloadSha256: string;
  applyDigest: string;
  branchId: string;
  amountIdr: string;
  payloadEnc: string | null;
  dekVersion: number | null;
};

type StagedBatchForApply = {
  batchId: string;
  sourceSystem: string;
  cutoverDate: string;
  approvedRevision: number;
  approvedManifestSha256: string;
  rows: StagedRowForApply[];
};

export type ApplyBatchResult = {
  batchId: string;
  state: "applied";
  appliedCount: number;
  replayedCount: number;
  factCount: number;
  reimportedAfterReversalCount: number;
};

// Trusted executor apply (clinic_executor): loads authenticated AEAD staged rows from PostgreSQL,
// decrypts and verifies BOTH canonicalPayloadSha256 and applyDigest, sends ONLY strict allowlisted SQL fields,
// and sanitizes any DB diagnostic so raw patient fields are never surfaced.
export async function applyApprovedImportBatch(
  execDb: ClientBase,
  params: {
    tenantId: string;
    actorStaffId: string;
    batchId: string;
    validationRevision: number;
    manifestSha256: string;
    dek: Buffer;
    env?: NodeJS.ProcessEnv;
  },
): Promise<ApplyBatchResult> {
  // 1. Suppress error-time bind-parameter logging AND verify ordinary/sampled statement/duration logging cannot
  //    log decrypted patient bind parameters BEFORE sending any patient data over the DB wire (r7/r8 P2 #2).
  await execDb.query(`SET LOCAL log_parameter_max_length_on_error = 0`);
  const logCfg = (
    await execDb.query<{ ls: string; lmd: string; lms: string; ltsr: string; lpml: string }>(
      `SELECT current_setting('log_statement') AS ls,
              current_setting('log_min_duration_statement') AS lmd,
              current_setting('log_min_duration_sample') AS lms,
              current_setting('log_transaction_sample_rate') AS ltsr,
              current_setting('log_parameter_max_length') AS lpml`,
    )
  ).rows[0];
  const anyStatementOrDurationLogging =
    logCfg.ls !== "none" ||
    logCfg.lmd !== "-1" ||
    logCfg.lms !== "-1" ||
    Number(logCfg.ltsr) > 0;
  if (anyStatementOrDurationLogging && logCfg.lpml !== "0") {
    throw new Error("ERR_FORBIDDEN: unsafe server parameter logging configuration");
  }
  await bindResidencyContext(execDb, params.env);
  const { rows: stagedRes } = await execDb.query<{ res: StagedBatchForApply }>(
    `SELECT public.import_staged_rows_for_apply($1::uuid, $2::uuid, $3::uuid) AS res`,
    [params.tenantId, params.actorStaffId, params.batchId],
  );
  const staged = stagedRes[0].res;
  if (
    staged.approvedRevision !== params.validationRevision ||
    staged.approvedManifestSha256 !== params.manifestSha256
  ) {
    throw new Error("ERR_VERSION_CONFLICT: staged batch approval mismatch");
  }

  const entries = staged.rows.map((r) => {
    if (!r.payloadEnc || !r.dekVersion) throw new Error("ERR_VERSION_CONFLICT: staged payload purged");
    const decrypted = decryptImportRowPayload<{
      payload: Record<string, unknown>;
      applyData: Record<string, unknown>;
    }>(
      params.dek,
      {
        tenantId: params.tenantId,
        entity: r.entity,
        rowNo: r.rowNo,
        sourceKeyHash: r.sourceKeyHash,
        applyDigest: r.applyDigest,
        dekVersion: r.dekVersion,
      },
      r.payloadEnc,
    );
    const recomputedCanonical = computeCanonicalPayloadSha256(decrypted.payload);
    if (recomputedCanonical !== r.canonicalPayloadSha256) {
      throw new Error("ERR_VERSION_CONFLICT: decrypted canonical payload digest mismatch");
    }
    const recomputedApply = computeApplyDigest({
      entity: r.entity,
      branchId: r.branchId,
      amountIdr: r.amountIdr,
      data: decrypted.applyData,
    });
    if (recomputedApply !== r.applyDigest) {
      throw new Error("ERR_VERSION_CONFLICT: decrypted apply digest mismatch");
    }
    // Re-project ONLY exact SQL-consumed keys before sending over the DB wire (r4 P2 #3)
    const minimalData: Record<string, unknown> =
      r.entity === "patients"
        ? {
            fullName: decrypted.applyData.fullName,
            birthDate: decrypted.applyData.birthDate,
            sex: decrypted.applyData.sex,
            phone: decrypted.applyData.phone ?? null,
          }
        : r.entity === "packages"
          ? {
              patientSourceKeyHash: decrypted.applyData.patientSourceKeyHash,
              catalogCode: decrypted.applyData.catalogCode,
              catalogVersionId: decrypted.applyData.catalogVersionId,
              remainingSessions: decrypted.applyData.remainingSessions,
              historicalUsedCount: decrypted.applyData.historicalUsedCount ?? 0,
              expiresOn: decrypted.applyData.expiresOn,
            }
          : {
              patientSourceKeyHash: decrypted.applyData.patientSourceKeyHash,
            };
    return {
      entity: r.entity,
      rowNo: r.rowNo,
      data: minimalData,
    };
  });

  try {
    const { rows } = await execDb.query<{ res: ApplyBatchResult }>(
      `SELECT public.import_apply($1::uuid, $2::uuid, $3::uuid, $4::int, $5::text, $6::jsonb) AS res`,
      [
        params.tenantId,
        params.actorStaffId,
        params.batchId,
        params.validationRevision,
        params.manifestSha256,
        JSON.stringify(entries),
      ],
    );
    return rows[0].res;
  } catch (err) {
    throw sanitizeImportError(err);
  }
}

// One-time operational match for a held opening booking deposit to an appointment (r4 P1 #1).
export async function matchOpeningDeposit(
  db: Db,
  depositId: string,
  appointmentId: string,
): Promise<{ depositId: string; appointmentId: string; catalogVersionId: string }> {
  const { rows } = await db.query<{
    res: { depositId: string; appointmentId: string; catalogVersionId: string };
  }>(`SELECT public.import_opening_deposit_match($1::uuid, $2::uuid) AS res`, [depositId, appointmentId]);
  return rows[0].res;
}

export async function rollbackImportBatch(
  db: Db,
  batchId: string,
  reason: ImportRollbackReason,
): Promise<{ batchId: string; state: "rolled_back"; reversedFacts: number }> {
  const { rows } = await db.query<{ res: { batchId: string; state: "rolled_back"; reversedFacts: number } }>(
    `SELECT public.import_rollback($1::uuid, $2::text) AS res`,
    [batchId, reason],
  );
  return rows[0].res;
}

// Executor-only retention purge (requires clinic_executor login role; refused for clinic_app).
export async function purgeExpiredImportBatches(db: Db, limit = 50): Promise<{ purgedBatches: number }> {
  const { rows } = await db.query<{ res: { purgedBatches: number } }>(
    `SELECT public.import_purge_expired($1::int) AS res`,
    [limit],
  );
  return rows[0].res;
}

export async function listImportBatches(db: Db): Promise<BatchSummaryDto[]> {
  const { rows } = await db.query<{ rows: BatchSummaryDto[] }>(`SELECT public.import_batches_list() AS rows`);
  return rows[0]?.rows ?? [];
}

export type BatchSummaryDto = {
  batchId: string;
  sourceSystem: string;
  cutoverDate: string;
  state: string;
  rowCount: number;
  validationRevision: number;
  validatedManifestSha256: string;
  summary: ReconciliationSummary;
  stagedAt: string;
  approvedAt: string | null;
  appliedAt: string | null;
  rolledBackAt: string | null;
  purgeAfter: string;
  payloadPurgedAt: string | null;
};
