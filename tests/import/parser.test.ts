// T-128 synthetic dry-run validation + source-ID duplicate/replay/conflict/tombstone/NIK tests (PR-85, DATA-58).
import { describe, expect, it } from "vitest";
import {
  allocateRemainingSessions,
  computeNikHash,
  computeSourceKeyHash,
  detectBatchOverlap,
  dryRunValidateImport,
  evaluateSourceIdPlan,
  MAX_PACKAGE_SESSIONS,
  parseRupiahBigInt,
  type ImportBatchInput,
} from "../../src/modules/import";

const KEY_A = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
const KEY_B = Buffer.from("fedcba9876543210fedcba9876543210", "utf8");

function makeSyntheticInput(overrides: Partial<ImportBatchInput> = {}): ImportBatchInput {
  return {
    sourceSystem: "numa-legacy",
    cutoverDate: "2026-01-31",
    tenantHmacKey: KEY_A,
    knownBranchCodes: new Set(["kmg", "snp"]), // lower-case input normalized cleanly
    knownServiceCodes: new Set(["fac-01"]),
    patients: [
      {
        externalId: "NUMA-P-001",
        fullName: "Pasien Sintetis Satu",
        birthDate: "1990-04-12",
        sex: "female",
        nik: "3174011204900001",
        phone: "+6281234567890",
        branchCode: "KMG",
      },
    ],
    packages: [
      {
        externalId: "NUMA-PKG-001",
        patientExternalId: "NUMA-P-001",
        branchCode: "KMG",
        catalogCode: "FAC-01",
        totalSessions: 5,
        historicalUsedCount: 2,
        contractValueIdr: "2500000",
        paidValueIdr: "2500000",
        usedValueIdr: "1000000",
        expiresOn: "2026-12-31",
      },
    ],
    balances: [
      { externalId: "NUMA-BAL-001", patientExternalId: "NUMA-P-001", branchCode: "KMG", amountIdr: "350000" },
    ],
    receivables: [
      { externalId: "NUMA-AR-001", patientExternalId: "NUMA-P-001", branchCode: "SNP", amountIdr: "200000", dueOn: "2026-02-28" },
    ],
    bookingDps: [
      { externalId: "NUMA-DP-001", patientExternalId: "NUMA-P-001", branchCode: "KMG", amountIdr: "150000" },
    ],
    ...overrides,
  };
}

describe("T-128 synthetic dry-run parser & BigInt arithmetic", () => {
  it("parses strict integer rupiah via BigInt and rejects decimals, symbols, negatives, and overflow", () => {
    expect(parseRupiahBigInt("100000")).toEqual({ ok: true, value: BigInt("100000") });
    expect(parseRupiahBigInt("1000000000000")).toEqual({ ok: true, value: BigInt("1000000000000") });
    expect(parseRupiahBigInt("1000.50")).toEqual({ ok: false, code: "invalid_amount" });
    expect(parseRupiahBigInt("Rp 100000")).toEqual({ ok: false, code: "invalid_amount" });
    expect(parseRupiahBigInt("-50000")).toEqual({ ok: false, code: "invalid_amount" });
    expect(parseRupiahBigInt("1000000000001")).toEqual({ ok: false, code: "amount_out_of_range" });
  });

  it("allocates odd remaining package rupiah with zero drift and enforces canonical 0091 session bound", () => {
    const split = allocateRemainingSessions(BigInt("100000"), 3);
    expect(split).toEqual([BigInt("33334"), BigInt("33333"), BigInt("33333")]);
    expect(split.reduce((a, b) => a + b, BigInt("0"))).toBe(BigInt("100000"));

    expect(MAX_PACKAGE_SESSIONS).toBe(1000);
    const maxSplit = allocateRemainingSessions(BigInt("1000005"), MAX_PACKAGE_SESSIONS);
    expect(maxSplit).toHaveLength(MAX_PACKAGE_SESSIONS);
    expect(maxSplit.reduce((a, b) => a + b, BigInt("0"))).toBe(BigInt("1000005"));

    for (const bad of [0, -1, 1.5, MAX_PACKAGE_SESSIONS + 1, 1_000_000_000]) {
      expect(() => allocateRemainingSessions(BigInt("100000"), bad)).toThrow(/invalid_session_allocation/);
    }
  });

  it("rejects malformed or over-limit package session counts structurally without throwing or unbounded allocation", () => {
    const invalidCases: { label: string; totalSessions: number; historicalUsedCount: number }[] = [
      { label: "negative historicalUsedCount", totalSessions: 5, historicalUsedCount: -1 },
      { label: "non-integer totalSessions", totalSessions: 5.5, historicalUsedCount: 2 },
      { label: "non-integer historicalUsedCount", totalSessions: 5, historicalUsedCount: 1.5 },
      { label: "over 0091 canonical 1000-session limit", totalSessions: MAX_PACKAGE_SESSIONS + 1, historicalUsedCount: 0 },
      { label: "huge unbounded totalSessions", totalSessions: 1_000_000_000, historicalUsedCount: 0 },
      { label: "all sessions already used", totalSessions: 5, historicalUsedCount: 5 },
    ];

    for (const c of invalidCases) {
      const res = dryRunValidateImport(
        makeSyntheticInput({
          packages: [
            {
              externalId: "NUMA-PKG-BAD",
              patientExternalId: "NUMA-P-001",
              branchCode: "KMG",
              catalogCode: "FAC-01",
              totalSessions: c.totalSessions,
              historicalUsedCount: c.historicalUsedCount,
              contractValueIdr: "2500000",
              paidValueIdr: "2500000",
              usedValueIdr: "1000000",
              expiresOn: "2026-12-31",
            },
          ],
          balances: [],
          receivables: [],
          bookingDps: [],
        }),
      );
      expect(res.ok, c.label).toBe(false);
      if (!res.ok) {
        expect(res.issues, c.label).toContainEqual({ entity: "packages", rowNo: 1, code: "invalid_session_counts" });
      }
    }

    // Exact canonical 0091 boundary (1000 total sessions, 0 used) passes cleanly.
    const atLimit = dryRunValidateImport(
      makeSyntheticInput({
        packages: [
          {
            externalId: "NUMA-PKG-1000",
            patientExternalId: "NUMA-P-001",
            branchCode: "KMG",
            catalogCode: "FAC-01",
            totalSessions: MAX_PACKAGE_SESSIONS,
            historicalUsedCount: 0,
            contractValueIdr: "10000000",
            paidValueIdr: "10000000",
            usedValueIdr: "0",
            expiresOn: "2026-12-31",
          },
        ],
        balances: [],
        receivables: [],
        bookingDps: [],
      }),
    );
    expect(atLimit.ok).toBe(true);
    if (atLimit.ok) {
      const pkgRow = atLimit.rows.find((r) => r.entity === "packages");
      expect((pkgRow?.payload.sessionAllocationsIdr as string[])).toHaveLength(MAX_PACKAGE_SESSIONS);
    }
  });

  it("validates a synthetic Numa-shaped batch across all 5 entities with exact BigInt reconciliation", () => {
    const res = dryRunValidateImport(makeSyntheticInput());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary.totalRows).toBe(5);
    expect(res.summary.totalsIdr).toEqual({
      packagesPaidRemaining: "1500000",
      balances: "350000",
      receivables: "200000",
      bookingDps: "150000",
      totalLiabilities: "2000000",
      totalAssets: "200000",
    });
    expect(res.summary.byBranch).toEqual({
      KMG: { packagesPaidRemaining: "1500000", balances: "350000", receivables: "0", bookingDps: "150000" },
      SNP: { packagesPaidRemaining: "0", balances: "0", receivables: "200000", bookingDps: "0" },
    });
    expect(res.summary.validatedManifestSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("flags in-batch duplicate external IDs and duplicate NIKs while leaking zero PII sentinels", () => {
    const sentinelNik = "3174011204909999";
    const sentinelName = "RAHASIA_PASIEN_NIK_DUP";
    const sentinelExt = "EXT-RAHASIA-DUP-1";
    const res = dryRunValidateImport(
      makeSyntheticInput({
        patients: [
          { externalId: sentinelExt, fullName: sentinelName, birthDate: "1990-01-01", sex: "female", nik: sentinelNik, branchCode: "KMG" },
          { externalId: sentinelExt, fullName: "Nama Kedua", birthDate: "1990-01-01", sex: "female", nik: sentinelNik, branchCode: "KMG" },
        ],
        packages: [],
        balances: [],
        receivables: [],
        bookingDps: [],
      }),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(["duplicate_external_id_in_batch", "duplicate_nik_in_batch"]),
    );
    const serialized = JSON.stringify(res.issues);
    expect(serialized).not.toContain(sentinelNik);
    expect(serialized).not.toContain(sentinelName);
    expect(serialized).not.toContain(sentinelExt);
  });

  it("refuses short HMAC key (<32 bytes) and malformed sourceSystem", () => {
    expect(() =>
      dryRunValidateImport(makeSyntheticInput({ tenantHmacKey: Buffer.from("short-key") })),
    ).toThrow(/32 bytes/);
    const badSrc = dryRunValidateImport(makeSyntheticInput({ sourceSystem: "INVALID SYSTEM!" }));
    expect(badSrc.ok).toBe(false);
    if (!badSrc.ok) expect(badSrc.issues[0].code).toBe("invalid_source_system");
  });
});

describe("T-128 source-ID duplicate / replay / conflict / reversal-tombstone / NIK collision checks", () => {
  it("classifies identical re-import as idempotent replay with 0 new rows and 0 conflicts", () => {
    const first = dryRunValidateImport(makeSyntheticInput());
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const existingMaps = first.rows.map((r, i) => ({
      entity: r.entity,
      sourceKeyHash: r.sourceKeyHash,
      canonicalPayloadSha256: r.canonicalPayloadSha256,
      localId: `019a0000-0000-7000-8000-00000000000${i + 1}`,
      state: "active" as const,
    }));

    const plan = evaluateSourceIdPlan(first.rows, existingMaps);
    expect(plan.ok).toBe(true);
    expect(plan.counts).toEqual({ new: 0, replay: 5, reimportAfterReversal: 0, conflict: 0, nikConflict: 0 });
    expect(plan.conflicts).toEqual([]);
  });

  it("refuses same external ID with mutated rupiah payload as explicit ERR_SOURCE_CONFLICT (never silently skipped)", () => {
    const first = dryRunValidateImport(makeSyntheticInput());
    const changed = dryRunValidateImport(
      makeSyntheticInput({
        balances: [
          { externalId: "NUMA-BAL-001", patientExternalId: "NUMA-P-001", branchCode: "KMG", amountIdr: "999000" },
        ],
      }),
    );
    expect(first.ok && changed.ok).toBe(true);
    if (!first.ok || !changed.ok) return;

    const existingMaps = first.rows.map((r, i) => ({
      entity: r.entity,
      sourceKeyHash: r.sourceKeyHash,
      canonicalPayloadSha256: r.canonicalPayloadSha256,
      localId: `019a0000-0000-7000-8000-00000000000${i + 1}`,
      state: "active" as const,
    }));

    const plan = evaluateSourceIdPlan(changed.rows, existingMaps);
    expect(plan.ok).toBe(false);
    expect(plan.counts).toEqual({ new: 0, replay: 4, reimportAfterReversal: 0, conflict: 1, nikConflict: 0 });
    expect(plan.conflicts[0]).toMatchObject({
      kind: "conflict",
      code: "ERR_SOURCE_CONFLICT",
      entity: "balances",
      rowNo: 1,
    });
    expect(JSON.stringify(plan)).not.toContain("NUMA-BAL-001");
    expect(JSON.stringify(plan)).not.toContain("999000");
  });

  it("explicitly distinguishes post-reversal tombstones (reimport_after_reversal) from active replays", () => {
    const batch = dryRunValidateImport(makeSyntheticInput());
    expect(batch.ok).toBe(true);
    if (!batch.ok) return;

    const tombstones = batch.rows.map((r, i) => ({
      entity: r.entity,
      sourceKeyHash: r.sourceKeyHash,
      canonicalPayloadSha256: r.canonicalPayloadSha256,
      localId: `019a0000-0000-7000-8000-00000000001${i + 1}`,
      state: "reversed" as const,
    }));

    const plan = evaluateSourceIdPlan(batch.rows, tombstones);
    expect(plan.ok).toBe(true);
    expect(plan.counts).toEqual({ new: 0, replay: 0, reimportAfterReversal: 5, conflict: 0, nikConflict: 0 });
    expect(plan.decisions.every((d) => d.kind === "reimport_after_reversal")).toBe(true);
  });

  it("blocks duplicate NIK under a different external ID against existing tenant patients (ERR_DUPLICATE_NIK)", () => {
    const sentinelNik = "3174011204900001";
    const batch = dryRunValidateImport(
      makeSyntheticInput({
        patients: [
          {
            externalId: "NUMA-P-NEW-EXT",
            fullName: "Pasien Duplikat NIK",
            birthDate: "1990-04-12",
            sex: "female",
            nik: sentinelNik,
            branchCode: "KMG",
          },
        ],
        packages: [],
        balances: [],
        receivables: [],
        bookingDps: [],
      }),
    );
    expect(batch.ok).toBe(true);
    if (!batch.ok) return;

    const plan = evaluateSourceIdPlan(batch.rows, [], [
      {
        nikHash: computeNikHash(KEY_A, sentinelNik),
        localId: "019a0000-0000-7000-8000-000000000099",
        sourceKeyHash: computeSourceKeyHash(KEY_A, "numa-legacy", "patients", "NUMA-P-001"),
      },
    ]);
    expect(plan.ok).toBe(false);
    expect(plan.counts.nikConflict).toBe(1);
    expect(plan.conflicts[0]).toMatchObject({
      kind: "nik_conflict",
      code: "ERR_DUPLICATE_NIK",
      entity: "patients",
      rowNo: 1,
    });
    expect(JSON.stringify(plan)).not.toContain(sentinelNik);
  });

  it("isolates tenant HMAC sourceKeyHash and detects cross-batch overlap conflicts", () => {
    const hashA = computeSourceKeyHash(KEY_A, "numa-legacy", "balances", "NUMA-BAL-001");
    const hashB = computeSourceKeyHash(KEY_B, "numa-legacy", "balances", "NUMA-BAL-001");
    expect(hashA).not.toBe(hashB);

    const b1 = dryRunValidateImport(makeSyntheticInput());
    const b2 = dryRunValidateImport(
      makeSyntheticInput({
        bookingDps: [
          { externalId: "NUMA-DP-001", patientExternalId: "NUMA-P-001", branchCode: "KMG", amountIdr: "175000" },
        ],
      }),
    );
    expect(b1.ok && b2.ok).toBe(true);
    if (!b1.ok || !b2.ok) return;

    const overlaps = detectBatchOverlap(b1.rows, b2.rows);
    expect(overlaps).toHaveLength(5);
    expect(overlaps.filter((o) => o.kind === "identical_replay")).toHaveLength(4);
    expect(overlaps.filter((o) => o.kind === "ERR_SOURCE_CONFLICT")).toEqual([
      expect.objectContaining({ entity: "booking_dps", kind: "ERR_SOURCE_CONFLICT" }),
    ]);
  });
});
