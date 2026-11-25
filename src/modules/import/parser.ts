// Opening-data import strict parser, BigInt arithmetic, canonical fingerprints & dry-run validator (PR-85, DATA-58, MIG-3; T-128).
// - Strictly BigInt integer rupiah parsing (no Number coercion on decimals/aggregates, max 10^12 per row).
// - Deterministic exact remaining-session allocation (sum === paidRemaining with 0 drift).
// - Tenant-keyed HMAC-SHA256 source_key_hash + nik_hash + sorted-key canonical_payload_sha256.
// - Safe allowlisted error codes ONLY (zero raw cell values, filenames, NIK, phone, or patient names in errors/summaries).
// - Bounded pilot batch cap (<= 2,000 rows per atomic apply transaction). // lazy: >2,000 rows requires chunk state machine
import { createHash, createHmac } from "node:crypto";

export const MAX_BATCH_ROWS = 2_000;
export const MAX_ROW_RUPIAH = BigInt("1000000000000");
// Canonical package session bound from migration 0091 (package_contents 20x50, package_sessions.seq between 1 and 1000).
export const MAX_PACKAGE_SESSIONS = 1_000;

export const IMPORT_ENTITIES = [
  "patients",
  "packages",
  "balances",
  "receivables",
  "booking_dps",
] as const;
export type ImportEntityKind = (typeof IMPORT_ENTITIES)[number];

export type ImportErrorCode =
  | "batch_empty"
  | "batch_too_large"
  | "invalid_source_system"
  | "invalid_cutover_date"
  | "missing_external_id"
  | "duplicate_external_id_in_batch"
  | "duplicate_nik_in_batch"
  | "invalid_name"
  | "invalid_birth_date"
  | "invalid_sex"
  | "invalid_nik"
  | "invalid_phone"
  | "invalid_amount"
  | "amount_out_of_range"
  | "invalid_branch_code"
  | "unknown_patient_ref"
  | "unknown_catalog_code"
  | "invalid_session_counts"
  | "overcollected_package"
  | "invalid_expiry_date"
  | "invalid_due_date";

export type RowIssue = {
  entity: ImportEntityKind;
  rowNo: number;
  code: ImportErrorCode;
};

const SOURCE_SYSTEM = /^[a-z0-9][a-z0-9_-]{1,39}$/;
const INT_RUPIAH = /^[0-9]{1,13}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EXT_ID = /^[A-Za-z0-9_.:/-]{1,120}$/;
const NIK_16 = /^[0-9]{16}$/;
const PHONE_E164 = /^\+[1-9][0-9]{7,14}$/;

export function isValidIsoDate(s: string | null | undefined): s is string {
  if (!s || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function parseRupiahBigInt(
  raw: string | number | bigint | null | undefined,
): { ok: true; value: bigint } | { ok: false; code: "invalid_amount" | "amount_out_of_range" } {
  if (raw === null || raw === undefined) return { ok: false, code: "invalid_amount" };
  let s: string;
  if (typeof raw === "bigint") {
    s = raw.toString();
  } else if (typeof raw === "number") {
    if (!Number.isSafeInteger(raw)) return { ok: false, code: "invalid_amount" };
    s = String(raw);
  } else {
    s = raw.trim();
  }
  if (!INT_RUPIAH.test(s)) return { ok: false, code: "invalid_amount" };
  const val = BigInt(s);
  if (val < BigInt("0") || val > MAX_ROW_RUPIAH) return { ok: false, code: "amount_out_of_range" };
  return { ok: true, value: val };
}

// Exact deterministic integer allocation across remaining unredeemed sessions (0 rupiah drift).
export function allocateRemainingSessions(paidRemaining: bigint, remainingCount: number): bigint[] {
  if (
    paidRemaining < BigInt("0") ||
    !Number.isSafeInteger(remainingCount) ||
    remainingCount < 1 ||
    remainingCount > MAX_PACKAGE_SESSIONS
  ) {
    throw new RangeError("invalid_session_allocation");
  }
  const count = BigInt(remainingCount);
  const base = paidRemaining / count;
  const rem = Number(paidRemaining % count);
  const out: bigint[] = [];
  for (let i = 0; i < remainingCount; i++) {
    out.push(i < rem ? base + BigInt("1") : base);
  }
  return out;
}

function assertHmacKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.byteLength < 32) {
    throw new RangeError("tenantHmacKey must be a Buffer of at least 32 bytes");
  }
}

export function computeSourceKeyHash(
  tenantHmacKey: Buffer,
  sourceSystem: string,
  entity: ImportEntityKind,
  externalId: string,
): string {
  assertHmacKey(tenantHmacKey);
  const norm = `${sourceSystem.trim().toLowerCase()}|${entity}|${externalId.trim()}`;
  return createHmac("sha256", tenantHmacKey).update(norm, "utf8").digest("hex");
}

export function computeNikHash(tenantHmacKey: Buffer, nik: string): string {
  assertHmacKey(tenantHmacKey);
  return createHmac("sha256", tenantHmacKey).update(`nik|${nik.trim()}`, "utf8").digest("hex");
}

function canonicalStringify(v: unknown): string {
  if (v === null || typeof v !== "object") {
    return typeof v === "bigint" ? JSON.stringify(v.toString()) : JSON.stringify(v);
  }
  if (Array.isArray(v)) {
    return `[${v.map(canonicalStringify).join(",")}]`;
  }
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`).join(",")}}`;
}

export function computeCanonicalPayloadSha256(row: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalStringify(row), "utf8").digest("hex");
}

// ── Raw input row shapes (synthetic Numa-shaped opening data) ──
export type RawPatientRow = {
  externalId: string;
  fullName: string;
  birthDate: string;
  sex: string;
  nik?: string | null;
  phone?: string | null;
  branchCode: string;
};

export type RawPackageRow = {
  externalId: string;
  patientExternalId: string;
  branchCode: string;
  catalogCode: string;
  totalSessions: number;
  historicalUsedCount: number;
  contractValueIdr: string;
  paidValueIdr: string;
  usedValueIdr: string;
  expiresOn?: string | null;
};

export type RawBalanceRow = {
  externalId: string;
  patientExternalId: string;
  branchCode: string;
  amountIdr: string;
};

export type RawReceivableRow = {
  externalId: string;
  patientExternalId: string;
  branchCode: string;
  amountIdr: string;
  dueOn: string;
};

export type RawBookingDpRow = {
  externalId: string;
  patientExternalId: string;
  branchCode: string;
  amountIdr: string;
};

export type ImportBatchInput = {
  sourceSystem: string;
  cutoverDate: string;
  tenantHmacKey: Buffer;
  knownBranchCodes: ReadonlySet<string>;
  knownServiceCodes: ReadonlySet<string>;
  existingPatientExternalIds?: ReadonlySet<string>;
  patients: RawPatientRow[];
  packages: RawPackageRow[];
  balances: RawBalanceRow[];
  receivables: RawReceivableRow[];
  bookingDps: RawBookingDpRow[];
};

export type NormalizedRow = {
  entity: ImportEntityKind;
  rowNo: number;
  sourceKeyHash: string;
  canonicalPayloadSha256: string;
  nikHash?: string | null;
  branchCode: string;
  amountIdr: bigint;
  payload: Record<string, unknown>;
};

export type ReconciliationSummary = {
  cutoverDate: string;
  totalRows: number;
  counts: Record<ImportEntityKind, number>;
  totalsIdr: {
    packagesPaidRemaining: string;
    balances: string;
    receivables: string;
    bookingDps: string;
    totalLiabilities: string;
    totalAssets: string;
  };
  byBranch: Record<
    string,
    {
      packagesPaidRemaining: string;
      balances: string;
      receivables: string;
      bookingDps: string;
    }
  >;
  validatedManifestSha256: string;
};

export type DryRunResult =
  | { ok: true; rows: NormalizedRow[]; summary: ReconciliationSummary }
  | { ok: false; issues: RowIssue[] };

export function dryRunValidateImport(input: ImportBatchInput): DryRunResult {
  assertHmacKey(input.tenantHmacKey);
  const issues: RowIssue[] = [];
  const sourceSystem = (input.sourceSystem ?? "").trim().toLowerCase();
  if (!SOURCE_SYSTEM.test(sourceSystem)) {
    issues.push({ entity: "patients", rowNo: 0, code: "invalid_source_system" });
  }
  if (!isValidIsoDate(input.cutoverDate)) {
    issues.push({ entity: "patients", rowNo: 0, code: "invalid_cutover_date" });
  }

  const totalRaw =
    input.patients.length +
    input.packages.length +
    input.balances.length +
    input.receivables.length +
    input.bookingDps.length;

  if (totalRaw === 0) {
    return { ok: false, issues: [{ entity: "patients", rowNo: 0, code: "batch_empty" }] };
  }
  if (totalRaw > MAX_BATCH_ROWS) {
    return { ok: false, issues: [{ entity: "patients", rowNo: 0, code: "batch_too_large" }] };
  }

  const knownBranches = new Set([...input.knownBranchCodes].map((c) => c.trim().toUpperCase()));
  const knownServices = new Set([...input.knownServiceCodes].map((c) => c.trim().toUpperCase()));

  const normalized: NormalizedRow[] = [];
  const seenKeys = new Set<string>();
  const seenNiks = new Set<string>();
  const batchPatientIds = new Set<string>(
    [...(input.existingPatientExternalIds ?? [])].map((id) => id.trim()),
  );

  const branchTotals = new Map<string, { pkg: bigint; bal: bigint; rec: bigint; dp: bigint }>();
  const addBranch = (code: string) => {
    let entry = branchTotals.get(code);
    if (!entry) {
      entry = { pkg: BigInt("0"), bal: BigInt("0"), rec: BigInt("0"), dp: BigInt("0") };
      branchTotals.set(code, entry);
    }
    return entry;
  };

  let sumPkg = BigInt("0");
  let sumBal = BigInt("0");
  let sumRec = BigInt("0");
  let sumDp = BigInt("0");

  const checkKey = (entity: ImportEntityKind, rowNo: number, extId: string): string | null => {
    const clean = (extId ?? "").trim();
    if (!EXT_ID.test(clean)) {
      issues.push({ entity, rowNo, code: "missing_external_id" });
      return null;
    }
    const h = computeSourceKeyHash(input.tenantHmacKey, sourceSystem, entity, clean);
    if (seenKeys.has(h)) {
      issues.push({ entity, rowNo, code: "duplicate_external_id_in_batch" });
      return null;
    }
    seenKeys.add(h);
    return h;
  };

  // 1. Patients
  input.patients.forEach((p, idx) => {
    const rowNo = idx + 1;
    const keyHash = checkKey("patients", rowNo, p.externalId);
    const branchCode = (p.branchCode ?? "").trim().toUpperCase();
    if (!knownBranches.has(branchCode)) issues.push({ entity: "patients", rowNo, code: "invalid_branch_code" });
    const fullName = (p.fullName ?? "").trim();
    if (fullName.length < 2 || fullName.length > 150) issues.push({ entity: "patients", rowNo, code: "invalid_name" });
    if (!isValidIsoDate(p.birthDate) || p.birthDate > input.cutoverDate) {
      issues.push({ entity: "patients", rowNo, code: "invalid_birth_date" });
    }
    const sex = (p.sex ?? "").trim().toLowerCase();
    if (sex !== "male" && sex !== "female") issues.push({ entity: "patients", rowNo, code: "invalid_sex" });
    const nik = p.nik?.trim() || null;
    let nikHash: string | null = null;
    if (nik !== null) {
      if (!NIK_16.test(nik)) {
        issues.push({ entity: "patients", rowNo, code: "invalid_nik" });
      } else {
        nikHash = computeNikHash(input.tenantHmacKey, nik);
        if (seenNiks.has(nikHash)) {
          issues.push({ entity: "patients", rowNo, code: "duplicate_nik_in_batch" });
        } else {
          seenNiks.add(nikHash);
        }
      }
    }
    const phone = p.phone?.trim() || null;
    if (phone !== null && !PHONE_E164.test(phone)) issues.push({ entity: "patients", rowNo, code: "invalid_phone" });

    if (keyHash) {
      batchPatientIds.add(p.externalId.trim());
      const payload = { fullName, birthDate: p.birthDate, sex, nik, phone, branchCode };
      normalized.push({
        entity: "patients",
        rowNo,
        sourceKeyHash: keyHash,
        canonicalPayloadSha256: computeCanonicalPayloadSha256(payload),
        nikHash,
        branchCode,
        amountIdr: BigInt("0"),
        payload,
      });
    }
  });

  // 2. Packages
  input.packages.forEach((pk, idx) => {
    const rowNo = idx + 1;
    const keyHash = checkKey("packages", rowNo, pk.externalId);
    const branchCode = (pk.branchCode ?? "").trim().toUpperCase();
    if (!knownBranches.has(branchCode)) issues.push({ entity: "packages", rowNo, code: "invalid_branch_code" });
    if (!batchPatientIds.has((pk.patientExternalId ?? "").trim())) {
      issues.push({ entity: "packages", rowNo, code: "unknown_patient_ref" });
    }
    const catalogCode = (pk.catalogCode ?? "").trim().toUpperCase();
    if (!knownServices.has(catalogCode)) issues.push({ entity: "packages", rowNo, code: "unknown_catalog_code" });
    const validSessionCounts =
      Number.isSafeInteger(pk.totalSessions) &&
      Number.isSafeInteger(pk.historicalUsedCount) &&
      pk.totalSessions >= 1 &&
      pk.totalSessions <= MAX_PACKAGE_SESSIONS &&
      pk.historicalUsedCount >= 0 &&
      pk.historicalUsedCount < pk.totalSessions;
    if (!validSessionCounts) {
      issues.push({ entity: "packages", rowNo, code: "invalid_session_counts" });
    }
    const contract = parseRupiahBigInt(pk.contractValueIdr);
    const paid = parseRupiahBigInt(pk.paidValueIdr);
    const used = parseRupiahBigInt(pk.usedValueIdr);
    if (!contract.ok) issues.push({ entity: "packages", rowNo, code: contract.code });
    if (!paid.ok) issues.push({ entity: "packages", rowNo, code: paid.code });
    if (!used.ok) issues.push({ entity: "packages", rowNo, code: used.code });
    if (pk.expiresOn && !isValidIsoDate(pk.expiresOn)) {
      issues.push({ entity: "packages", rowNo, code: "invalid_expiry_date" });
    }

    if (contract.ok && paid.ok && used.ok) {
      if (paid.value > contract.value || used.value > paid.value) {
        issues.push({ entity: "packages", rowNo, code: "overcollected_package" });
      } else if (keyHash && validSessionCounts) {
        const remainingCount = pk.totalSessions - pk.historicalUsedCount;
        const paidRemaining = paid.value - used.value;
        if (paidRemaining <= BigInt("0")) {
          issues.push({ entity: "packages", rowNo, code: "invalid_amount" });
        } else {
          const allocated = allocateRemainingSessions(paidRemaining, remainingCount).map((x) => x.toString());
          sumPkg += paidRemaining;
          addBranch(branchCode).pkg += paidRemaining;
          const payload = {
            patientExternalId: pk.patientExternalId.trim(),
            branchCode,
            catalogCode,
            totalSessions: pk.totalSessions,
            historicalUsedCount: pk.historicalUsedCount,
            remainingCount,
            paidRemainingIdr: paidRemaining.toString(),
            sessionAllocationsIdr: allocated,
            expiresOn: pk.expiresOn ?? null,
          };
          normalized.push({
            entity: "packages",
            rowNo,
            sourceKeyHash: keyHash,
            canonicalPayloadSha256: computeCanonicalPayloadSha256(payload),
            branchCode,
            amountIdr: paidRemaining,
            payload,
          });
        }
      }
    }
  });

  // 3. Balances
  input.balances.forEach((b, idx) => {
    const rowNo = idx + 1;
    const keyHash = checkKey("balances", rowNo, b.externalId);
    const branchCode = (b.branchCode ?? "").trim().toUpperCase();
    if (!knownBranches.has(branchCode)) issues.push({ entity: "balances", rowNo, code: "invalid_branch_code" });
    if (!batchPatientIds.has((b.patientExternalId ?? "").trim())) {
      issues.push({ entity: "balances", rowNo, code: "unknown_patient_ref" });
    }
    const amt = parseRupiahBigInt(b.amountIdr);
    if (!amt.ok || amt.value <= BigInt("0")) {
      issues.push({ entity: "balances", rowNo, code: amt.ok ? "invalid_amount" : amt.code });
    } else if (keyHash) {
      sumBal += amt.value;
      addBranch(branchCode).bal += amt.value;
      const payload = { patientExternalId: b.patientExternalId.trim(), branchCode, amountIdr: amt.value.toString() };
      normalized.push({
        entity: "balances",
        rowNo,
        sourceKeyHash: keyHash,
        canonicalPayloadSha256: computeCanonicalPayloadSha256(payload),
        branchCode,
        amountIdr: amt.value,
        payload,
      });
    }
  });

  // 4. Receivables
  input.receivables.forEach((r, idx) => {
    const rowNo = idx + 1;
    const keyHash = checkKey("receivables", rowNo, r.externalId);
    const branchCode = (r.branchCode ?? "").trim().toUpperCase();
    if (!knownBranches.has(branchCode)) issues.push({ entity: "receivables", rowNo, code: "invalid_branch_code" });
    if (!batchPatientIds.has((r.patientExternalId ?? "").trim())) {
      issues.push({ entity: "receivables", rowNo, code: "unknown_patient_ref" });
    }
    if (!isValidIsoDate(r.dueOn)) issues.push({ entity: "receivables", rowNo, code: "invalid_due_date" });
    const amt = parseRupiahBigInt(r.amountIdr);
    if (!amt.ok || amt.value <= BigInt("0")) {
      issues.push({ entity: "receivables", rowNo, code: amt.ok ? "invalid_amount" : amt.code });
    } else if (keyHash) {
      sumRec += amt.value;
      addBranch(branchCode).rec += amt.value;
      const payload = {
        patientExternalId: r.patientExternalId.trim(),
        branchCode,
        amountIdr: amt.value.toString(),
        dueOn: r.dueOn,
      };
      normalized.push({
        entity: "receivables",
        rowNo,
        sourceKeyHash: keyHash,
        canonicalPayloadSha256: computeCanonicalPayloadSha256(payload),
        branchCode,
        amountIdr: amt.value,
        payload,
      });
    }
  });

  // 5. Booking DPs
  input.bookingDps.forEach((d, idx) => {
    const rowNo = idx + 1;
    const keyHash = checkKey("booking_dps", rowNo, d.externalId);
    const branchCode = (d.branchCode ?? "").trim().toUpperCase();
    if (!knownBranches.has(branchCode)) issues.push({ entity: "booking_dps", rowNo, code: "invalid_branch_code" });
    if (!batchPatientIds.has((d.patientExternalId ?? "").trim())) {
      issues.push({ entity: "booking_dps", rowNo, code: "unknown_patient_ref" });
    }
    const amt = parseRupiahBigInt(d.amountIdr);
    if (!amt.ok || amt.value <= BigInt("0")) {
      issues.push({ entity: "booking_dps", rowNo, code: amt.ok ? "invalid_amount" : amt.code });
    } else if (keyHash) {
      sumDp += amt.value;
      addBranch(branchCode).dp += amt.value;
      const payload = { patientExternalId: d.patientExternalId.trim(), branchCode, amountIdr: amt.value.toString() };
      normalized.push({
        entity: "booking_dps",
        rowNo,
        sourceKeyHash: keyHash,
        canonicalPayloadSha256: computeCanonicalPayloadSha256(payload),
        branchCode,
        amountIdr: amt.value,
        payload,
      });
    }
  });

  if (issues.length > 0) return { ok: false, issues };

  const byBranch: ReconciliationSummary["byBranch"] = {};
  for (const code of [...branchTotals.keys()].sort()) {
    const b = branchTotals.get(code)!;
    byBranch[code] = {
      packagesPaidRemaining: b.pkg.toString(),
      balances: b.bal.toString(),
      receivables: b.rec.toString(),
      bookingDps: b.dp.toString(),
    };
  }

  const manifestBasis = {
    sourceSystem,
    cutoverDate: input.cutoverDate,
    rows: normalized.map((r) => ({
      entity: r.entity,
      rowNo: r.rowNo,
      sourceKeyHash: r.sourceKeyHash,
      canonicalPayloadSha256: r.canonicalPayloadSha256,
    })),
  };
  const validatedManifestSha256 = createHash("sha256")
    .update(canonicalStringify(manifestBasis), "utf8")
    .digest("hex");

  return {
    ok: true,
    rows: normalized,
    summary: {
      cutoverDate: input.cutoverDate,
      totalRows: normalized.length,
      counts: {
        patients: input.patients.length,
        packages: input.packages.length,
        balances: input.balances.length,
        receivables: input.receivables.length,
        booking_dps: input.bookingDps.length,
      },
      totalsIdr: {
        packagesPaidRemaining: sumPkg.toString(),
        balances: sumBal.toString(),
        receivables: sumRec.toString(),
        bookingDps: sumDp.toString(),
        totalLiabilities: (sumPkg + sumBal + sumDp).toString(),
        totalAssets: sumRec.toString(),
      },
      byBranch,
      validatedManifestSha256,
    },
  };
}
