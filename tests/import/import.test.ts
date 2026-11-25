// Scenario PR-85 real-DB tests: opening-data import (DATA-58, MIG-3, ARCH-10, Option 1A, Option 2A, DEC-133; T-128).
// Covers:
// - r3 P1 #1: clinic_executor-only trusted writer boundary (import_stage, import_staged_rows_for_apply, import_apply,
//   import_purge_expired revoked from PUBLIC and clinic_app), SQL-derived validatedManifestSha256 over staged rows,
//   versioned AEAD envelope v1.<ver>.<iv>.<tag>.<ct>, and SQL apply_digest recomputation.
// - r3 P1 #2: null-safe NOT EXISTS rollback guard catching payment-backed balance debits (kind='use', NULL source_kind/source_id)
//   + one-way patients.opening_reversed = true retirement hiding rolled-back patients from patients_read RLS.
// - r3 P1 #3: opening_reversal matched directly to its original credit's branch outside ordinary FIFO (cross-branch parity with GL).
// - r3 P1 #4: opening package redemption and expiry/close lifecycle movements in subledger_movements reconciling with 0123 GL.
// - r3 P2 #5: versioned AEAD envelope rejects base64-encoded plaintext; semantic Gregorian date validator rejects '2026-02-31'
//   with fixed PII-free error strings without echoing raw input.
// - r2 P1 #3 & P2 #4: ledger_journal_export preserves historical 'draft-11-2026-11-19' alongside 'draft-11-2026-11-26-t128',
//   LEFT JOIN receipt completeness gate, and multi-balance same-patient rollback in descending seq order.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { LEDGER_MAP_VERSION } from "../../src/modules/accounting/schema";
import { decideEvidence, uploadEvidence } from "../../src/modules/compliance/compliance";
import {
  applyApprovedImportBatch,
  approveImportBatch,
  computeApplyDigest,
  encryptImportRowPayload,
  defaultOpeningPackageExpiry,
  matchOpeningDeposit,
  dryRunValidateImport,
  listImportBatches,
  purgeExpiredImportBatches,
  rollbackImportBatch,
  stageValidatedImportBatch,
} from "../../src/modules/import";
import { assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { bindResidencyContext } from "../../src/modules/platform/residency";
import { createHarness, testPool } from "../rls/harness";

async function withExecTx<T>(pool: pg.Pool, fn: (db: pg.ClientBase) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

describe("T-128 opening-data import real-DB contract (PR-85, DATA-58, Option 1A + 2A, R3)", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  let appPool: pg.Pool;
  let execPool: pg.Pool;
  let ownerPool: pg.Pool;
  let tenantA: string;
  let branchA1: string;
  let branchA2: string;
  let ownerAAcc: string;
  let ownerAStaff: string;
  let financeAAcc: string;
  let financeAStaff: string;
  let execRoleName: string;
  let facActiveVerId: string;
  let fac2ActiveVerId: string;
  let tenantB: string;
  let ownerBAcc: string;
  const dek = randomBytes(32);
  const hmacKey = randomBytes(32);
  const localEnv = { ...process.env, DEPLOY_ENV: "local" };

  beforeAll(async () => {
    h = await createHarness();
    const appUrl = h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE]));
    execRoleName = await h.createLoginRole("", ["clinic_executor"]);
    const execUrl = h.urlAs(execRoleName);
    appPool = await openAppPool({ connectionString: appUrl, max: 4 });
    execPool = testPool({ connectionString: execUrl, max: 2 });
    ownerPool = testPool({ connectionString: h.ownerUrl(), max: 2 });

    tenantA = (
      await h.admin.query<{ id: string }>(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)
    ).rows[0].id;
    await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Klinik Impor A', 'emkm')`, [
      tenantA,
    ]);
    branchA1 = (
      await h.admin.query<{ id: string }>(
        `insert into branches (tenant_id, code, name, timezone) values ($1, 'jkt', 'Cabang Jakarta', 'Asia/Jakarta') returning id`,
        [tenantA],
      )
    ).rows[0].id;
    branchA2 = (
      await h.admin.query<{ id: string }>(
        `insert into branches (tenant_id, code, name, timezone) values ($1, 'sby', 'Cabang Surabaya', 'Asia/Jakarta') returning id`,
        [tenantA],
      )
    ).rows[0].id;

    const makeAcc = async (email: string, name: string) =>
      (
        await h.admin.query<{ id: string }>(
          `insert into auth_user (email, name, email_verified, two_factor_enabled)
           values ($1, $2, true, true) returning id`,
          [email, name],
        )
      ).rows[0].id;

    ownerAAcc = await makeAcc("owner.impor@t128.test", "Owner Impor");
    financeAAcc = await makeAcc("finance.impor@t128.test", "Finance Impor");

    ownerAStaff = (
      await createMembership(ownerPool, { tenantId: tenantA, accountId: ownerAAcc, displayName: "Owner Impor" })
    ).staffId;
    await assignRole(h.admin, { tenantId: tenantA, staffId: ownerAStaff, role: "owner" });

    financeAStaff = (
      await createMembership(ownerPool, { tenantId: tenantA, accountId: financeAAcc, displayName: "Finance Impor" })
    ).staffId;
    await assignRole(h.admin, { tenantId: tenantA, staffId: financeAStaff, role: "finance" });

    // Seed real active catalog service FAC-01 (D5: opening packages resolve real catalog_items + catalog_versions)
    const itemId = (
      await h.admin.query<{ id: string }>(
        `insert into public.catalog_items (tenant_id, code, kind, created_by)
         values ($1, 'FAC-01', 'service', $2) returning id`,
        [tenantA, ownerAStaff],
      )
    ).rows[0].id;
    facActiveVerId = (
      await h.admin.query<{ id: string }>(
        `insert into public.catalog_versions (
           tenant_id, item_id, version, state, name, normal_price,
           tax_category, tax_basis, reason, created_by, created_as
         ) values (
           $1, $2, 1, 'active', 'Facial Dasar', 500000,
           'taxable_service', 'pmk', 'Seed layanan impor', $3, 'owner'
         ) returning id`,
        [tenantA, itemId, ownerAStaff],
      )
    ).rows[0].id;
    // Seed a newer pending_review version=2 on FAC-01 to prove r6 P2 #2: staging selects ONLY active version=1!
    const pendApprovalId = (
      await h.admin.query<{ id: string }>(
        `insert into public.approvals (tenant_id, type, subject_kind, subject_id, requested_by, requested_as, request_reason)
         values ($1, 'catalog_clinical_review', 'catalog_item', $2, $3, 'owner', 'Draft baru layanan') returning id`,
        [tenantA, itemId, ownerAStaff],
      )
    ).rows[0].id;
    await h.admin.query(
      `insert into public.catalog_versions (
         tenant_id, item_id, version, state, name, normal_price,
         tax_category, tax_basis, reason, created_by, created_as, approval_id
       ) values (
         $1, $2, 2, 'pending_review', 'Facial Dasar Draft v2', 999000,
         'taxable_service', 'pmk', 'Draft pending review', $3, 'owner', $4
       )`,
      [tenantA, itemId, ownerAStaff, pendApprovalId],
    );
    // Seed a non-service catalog item (kind='product') to prove r4 P2 #2: import_apply rejects non-service catalog versions!
    const prodItemId = (
      await h.admin.query<{ id: string }>(
        `insert into public.catalog_items (tenant_id, code, kind, created_by)
         values ($1, 'PRD-01', 'product', $2) returning id`,
        [tenantA, ownerAStaff],
      )
    ).rows[0].id;
    await h.admin.query(
      `insert into public.catalog_versions (
         tenant_id, item_id, version, state, name, normal_price,
         tax_category, tax_basis, reason, created_by, created_as
       ) values (
         $1, $2, 1, 'active', 'Krim Wajah', 200000,
         'taxable_goods', 'ppn', 'Seed produk non-layanan', $3, 'owner'
       )`,
      [tenantA, prodItemId, ownerAStaff],
    );
    // Seed a second active service FAC-02 to prove r5 P2 #1: wrong active service cannot be substituted for FAC-01!
    const fac2ItemId = (
      await h.admin.query<{ id: string }>(
        `insert into public.catalog_items (tenant_id, code, kind, created_by)
         values ($1, 'FAC-02', 'service', $2) returning id`,
        [tenantA, ownerAStaff],
      )
    ).rows[0].id;
    fac2ActiveVerId = (
      await h.admin.query<{ id: string }>(
        `insert into public.catalog_versions (
           tenant_id, item_id, version, state, name, normal_price,
           tax_category, tax_basis, reason, created_by, created_as
         ) values (
           $1, $2, 1, 'active', 'Facial Lanjutan', 750000,
           'taxable_service', 'pmk', 'Seed layanan lain', $3, 'owner'
         ) returning id`,
        [tenantA, fac2ItemId, ownerAStaff],
      )
    ).rows[0].id;
    // Seed second tenant B for cross-tenant negative test on matchOpeningDeposit (r5 P2 #3)
    tenantB = (
      await h.admin.query<{ id: string }>(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)
    ).rows[0].id;
    await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Klinik Impor B', 'emkm')`, [
      tenantB,
    ]);
    await h.admin.query(
      `insert into branches (tenant_id, code, name, timezone) values ($1, 'bdg', 'Cabang Bandung', 'Asia/Jakarta')`,
      [tenantB],
    );
    ownerBAcc = await makeAcc("owner.impor.b@t128.test", "Owner Impor B");
    const ownerBStaff = (
      await createMembership(ownerPool, { tenantId: tenantB, accountId: ownerBAcc, displayName: "Owner Impor B" })
    ).staffId;
    await assignRole(h.admin, { tenantId: tenantB, staffId: ownerBStaff, role: "owner" });
  }, 120_000);

  afterAll(async () => {
    await appPool?.end();
    await execPool?.end();
    await ownerPool?.end();
    await h?.close();
  });

  function makeSyntheticBatch(
    opts: {
      sourceSystem?: string;
      balanceAmount?: string;
      extraBalanceAmount?: string;
      balanceBranch?: string;
      balanceExtId?: string;
      onlyPatientAndBalance?: boolean;
      omitPackageExpiry?: boolean;
      onlyPatientAndDp?: boolean;
      dpExtId?: string;
      packageCatalogCode?: string;
      patientFullName?: string;
      patientPhone?: string;
      patientNik?: string;
      onlyPatientAndPkg?: boolean;
      pkgExtId?: string;
      cutoverDate?: string;
      patSuffix?: string;
    } = {},
  ) {
    const suf = opts.patSuffix ?? "001";
    const balBranch = opts.balanceBranch ?? "jkt";
    const balances = [
      {
        externalId: opts.balanceExtId ?? `BAL-${suf}`,
        patientExternalId: `PAT-${suf}`,
        branchCode: balBranch,
        amountIdr: opts.balanceAmount ?? "500000",
      },
      ...(opts.extraBalanceAmount
        ? [
            {
              externalId: `BAL2-${suf}`,
              patientExternalId: `PAT-${suf}`,
              branchCode: balBranch,
              amountIdr: opts.extraBalanceAmount,
            },
          ]
        : []),
    ];
    const input = {
      sourceSystem: opts.sourceSystem ?? "legacy_clinic_system",
      cutoverDate: opts.cutoverDate ?? "2026-11-25",
      patients: [
        {
          externalId: `PAT-${suf}`,
          fullName: opts.patientFullName ?? "Pasien Sintetis Impor",
          phone: opts.patientPhone ?? "+6281234567890",
          nik: opts.patientNik ?? "3171010101900001",
          birthDate: "1990-01-01",
          sex: "female",
          branchCode: "jkt",
        },
      ],
      balances: opts.onlyPatientAndDp || opts.onlyPatientAndPkg ? [] : balances,
      packages: opts.onlyPatientAndBalance || opts.onlyPatientAndDp
        ? []
        : [
            {
              externalId: opts.pkgExtId ?? `PKG-${suf}`,
              patientExternalId: `PAT-${suf}`,
              branchCode: "jkt",
              catalogCode: opts.packageCatalogCode ?? "FAC-01",
              totalSessions: 5,
              historicalUsedCount: 2,
              contractValueIdr: "2500000",
              paidValueIdr: "2500000",
              usedValueIdr: "1000000",
              ...(opts.omitPackageExpiry ? {} : { expiresOn: "2027-11-25" }),
            },
          ],
      bookingDps: opts.onlyPatientAndBalance || opts.onlyPatientAndPkg
        ? []
        : [
            {
              externalId: opts.dpExtId ?? `DP-${suf}`,
              patientExternalId: `PAT-${suf}`,
              branchCode: "jkt",
              amountIdr: "250000",
            },
          ],
      receivables: opts.onlyPatientAndBalance || opts.onlyPatientAndDp || opts.onlyPatientAndPkg
        ? []
        : [
            {
              externalId: `AR-${suf}`,
              patientExternalId: `PAT-${suf}`,
              branchCode: "jkt",
              amountIdr: "300000",
              dueOn: "2026-12-15",
            },
          ],
    };
    const res = dryRunValidateImport({
      ...input,
      tenantHmacKey: hmacKey,
      knownBranchCodes: new Set(["jkt", "sby"]),
      knownServiceCodes: new Set(["FAC-01", "FAC-02", "FAC-TMP"]),
    });
    if (!res.ok) throw new Error(`Expected valid synthetic batch: ${JSON.stringify(res.issues)}`);
    return { input, summary: res.summary };
  }

  it("enforces clinic_executor-only stage/read/apply/purge, owner authority, ARCH-10 gate, versioned AEAD envelope, and PII-free date errors", async () => {
    const batch = makeSyntheticBatch();
    const branchMap = new Map([
      ["jkt", branchA1],
      ["sby", branchA2],
    ]);
    const ownerCtx = await resolveContext(appPool, ownerAAcc, { tenantId: tenantA, actingRole: "owner" });
    const fakeId = "00000000-0000-7000-8000-000000000001";
    const fakeHash = "a".repeat(64);

    // r3 P1 #1: clinic_app CANNOT call import_stage, import_staged_rows_for_apply, import_apply, or import_purge_expired!
    await expect(
      withTenantContext(appPool, ownerCtx, (db) =>
        db.query(`SELECT public.import_stage($1::uuid, $2::uuid, 'legacy', '2026-11-25'::date, '[]'::jsonb)`, [
          tenantA,
          ownerAStaff,
        ]),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      withTenantContext(appPool, ownerCtx, (db) =>
        db.query(`SELECT public.import_staged_rows_for_apply($1::uuid, $2::uuid, $3::uuid)`, [
          tenantA,
          ownerAStaff,
          fakeId,
        ]),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      withTenantContext(appPool, ownerCtx, (db) =>
        db.query(`SELECT public.import_apply($1::uuid, $2::uuid, $3::uuid, 1, $4::text, '[]'::jsonb)`, [
          tenantA,
          ownerAStaff,
          fakeId,
          fakeHash,
        ]),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(purgeExpiredImportBatches(appPool, 10)).rejects.toThrow(/permission denied/i);

    // Non-owner actorStaffId refused inside _import_executor_owner
    await expect(
      withExecTx(execPool, (db) =>
        stageValidatedImportBatch(db, {
          tenantId: tenantA,
          actorStaffId: financeAStaff,
          tenantHmacKey: hmacKey,
          dek,
          dekVersion: 1,
          branchIdByCode: branchMap,
            input: batch.input,
          env: localEnv,
        }),
      ),
    ).rejects.toThrow(/ERR_FORBIDDEN/);

    // Production residency gate closed -> import_stage refuses with 0 durable rows
    await expect(
      withExecTx(execPool, (db) =>
        stageValidatedImportBatch(db, {
          tenantId: tenantA,
          actorStaffId: ownerAStaff,
          tenantHmacKey: hmacKey,
          dek,
          dekVersion: 1,
          branchIdByCode: branchMap,
            input: batch.input,
          env: { ...process.env, DEPLOY_ENV: "production" },
        }),
      ),
    ).rejects.toThrow(/real_patient_gate/i);

    // r3 P2 #5: base64-encoded plaintext JSON is REJECTED by SQL import_stage (must be v1.<ver>.<iv>.<tag>.<ct>)
    const base64Plaintext = Buffer.from('{"fullName":"Plaintext Leak"}', "utf8").toString("base64");
    await expect(
      withExecTx(execPool, async (db) => {
        await bindResidencyContext(db, localEnv);
        return db.query(`SELECT public.import_stage($1::uuid, $2::uuid, 'legacy_clinic_system', '2026-11-25'::date, $3::jsonb)`, [
          tenantA,
          ownerAStaff,
          JSON.stringify([
            {
              entity: "patients",
              rowNo: 1,
              sourceKeyHash: fakeHash,
              canonicalPayloadSha256: fakeHash,
              applyDigest: fakeHash,
              branchId: branchA1,
              amountIdr: "0",
              payloadEnc: base64Plaintext,
              dekVersion: 1,
            },
          ]),
        ]);
      }),
    ).rejects.toThrow(/ERR_INVALID_INPUT: staged payload must be versioned AEAD envelope/);

    const { rows } = await h.admin.query<{ cnt: string }>(
      `select count(*)::text as cnt from public.import_batches where tenant_id = $1`,
      [tenantA],
    );
    expect(Number(rows[0].cnt)).toBe(0);

    // clinic_executor can run purge
    const execPurge = await purgeExpiredImportBatches(execPool, 10);
    expect(execPurge.purgedBatches).toBe(0);
  });

  it("binds approval to SQL-derived manifest, rejects impossible dates without echoing input, reconciles 0121 + 0123 GL, retires patients, and re-imports Option 1A", async () => {
    const ownerCtx = await resolveContext(appPool, ownerAAcc, { tenantId: tenantA, actingRole: "owner" });
    const batch = makeSyntheticBatch();
    const branchMap = new Map([
      ["jkt", branchA1],
      ["sby", branchA2],
    ]);

    expect(LEDGER_MAP_VERSION).toBe("draft-11-2026-11-26-t128");
    expect((await h.admin.query<{ v: string }>(`select public.ledger_map_version() as v`)).rows[0].v).toBe(
      LEDGER_MAP_VERSION,
    );

    const staged = await withExecTx(execPool, (db) =>
      stageValidatedImportBatch(db, {
        tenantId: tenantA,
        actorStaffId: ownerAStaff,
        tenantHmacKey: hmacKey,
        dek,
        dekVersion: 1,
        branchIdByCode: branchMap,
        input: batch.input,
        env: localEnv,
      }),
    );
    expect(staged.validatedManifestSha256).toMatch(/^[0-9a-f]{64}$/);
    // SQL-derived manifest differs from pre-stage parser manifest because it binds exact staged branchId + applyDigest + ciphertext hashes!
    expect(staged.validatedManifestSha256).not.toBe(batch.summary.validatedManifestSha256);

    // Approving with a non-matching caller-supplied manifest is refused!
    await expect(
      withTenantContext(appPool, ownerCtx, (db) =>
        approveImportBatch(db, staged.batchId, staged.validationRevision, batch.summary.validatedManifestSha256, localEnv),
      ),
    ).rejects.toThrow(/ERR_VERSION_CONFLICT/);

    // Approve refuses when ARCH-10 gate is closed in production
    await expect(
      withTenantContext(appPool, ownerCtx, (db) =>
        approveImportBatch(db, staged.batchId, staged.validationRevision, staged.validatedManifestSha256, {
          ...process.env,
          DEPLOY_ENV: "production",
        }),
      ),
    ).rejects.toThrow(/real_patient_gate/i);

    const approved = await withTenantContext(appPool, ownerCtx, (db) =>
      approveImportBatch(db, staged.batchId, staged.validationRevision, staged.validatedManifestSha256, localEnv),
    );
    expect(approved.state).toBe("approved");

    // r3 P2 #5: impossible Gregorian date '2026-02-31' fails with fixed PII-free error without echoing '2026-02-31'!
    let dateErr = "";
    try {
      await withExecTx(execPool, async (db) => {
        await bindResidencyContext(db, localEnv);
        await db.query(`SELECT public.import_apply($1::uuid, $2::uuid, $3::uuid, $4::int, $5::text, $6::jsonb)`, [
          tenantA,
          ownerAStaff,
          staged.batchId,
          staged.validationRevision,
          staged.validatedManifestSha256,
          JSON.stringify([
            {
              entity: "patients",
              rowNo: 1,
              data: { fullName: "Pasien Sintetis Impor", birthDate: "2026-02-31", sex: "female", phone: "+6281234567890" },
            },
            { entity: "balances", rowNo: 1, data: { patientSourceKeyHash: "a".repeat(64) } },
            {
              entity: "packages",
              rowNo: 1,
              data: {
                patientSourceKeyHash: "a".repeat(64),
                catalogCode: "FAC-01",
                catalogVersionId: facActiveVerId,
                remainingSessions: 3,
                historicalUsedCount: 2,
                expiresOn: "2027-11-25",
              },
            },
            { entity: "booking_dps", rowNo: 1, data: { patientSourceKeyHash: "a".repeat(64) } },
            { entity: "receivables", rowNo: 1, data: { patientSourceKeyHash: "a".repeat(64) } },
          ]),
        ]);
      });
    } catch (e) {
      dateErr = e instanceof Error ? JSON.stringify({ message: e.message, ...Object.fromEntries(Object.getOwnPropertyNames(e).map((k) => [k, (e as unknown as Record<string, unknown>)[k]])) }) : String(e);
    }
    expect(dateErr).toContain("ERR_INVALID_INPUT: invalid date");
    for (const marker of ["2026-02-31", "Pasien Sintetis", "3171010101900001", "+6281234567890"]) {
      expect(dateErr).not.toContain(marker);
    }

    // Tampered valid-format payload fails closed with ERR_VERSION_CONFLICT (SQL apply_digest mismatch)
    await expect(
      withExecTx(execPool, async (db) => {
        await bindResidencyContext(db, localEnv);
        return db.query(`SELECT public.import_apply($1::uuid, $2::uuid, $3::uuid, $4::int, $5::text, $6::jsonb)`, [
          tenantA,
          ownerAStaff,
          staged.batchId,
          staged.validationRevision,
          staged.validatedManifestSha256,
          JSON.stringify([
            {
              entity: "patients",
              rowNo: 1,
              data: { fullName: "Tampered Name", birthDate: "1990-01-01", sex: "female", phone: "+6281234567890" },
            },
            { entity: "balances", rowNo: 1, data: { patientSourceKeyHash: "a".repeat(64) } },
            {
              entity: "packages",
              rowNo: 1,
              data: {
                patientSourceKeyHash: "a".repeat(64),
                catalogCode: "FAC-01",
                catalogVersionId: facActiveVerId,
                remainingSessions: 3,
                historicalUsedCount: 2,
                expiresOn: "2027-11-25",
              },
            },
            { entity: "booking_dps", rowNo: 1, data: { patientSourceKeyHash: "a".repeat(64) } },
            { entity: "receivables", rowNo: 1, data: { patientSourceKeyHash: "a".repeat(64) } },
          ]),
        ]);
      }),
    ).rejects.toThrow(/ERR_VERSION_CONFLICT/);

    // Authentic DB-backed AEAD apply via clinic_executor
    const applied = await withExecTx(execPool, (db) =>
      applyApprovedImportBatch(db, {
        tenantId: tenantA,
        actorStaffId: ownerAStaff,
        batchId: staged.batchId,
        validationRevision: staged.validationRevision,
        manifestSha256: staged.validatedManifestSha256,
        dek,
        env: localEnv,
      }),
    );
    expect(applied.state).toBe("applied");
    expect(applied.appliedCount).toBe(5);
    expect(applied.factCount).toBe(4);

    // Verify REAL operational records exist with server-derived IDs
    const patRows = (
      await h.admin.query<{ id: string; mrn: string; full_name: string }>(
        `select id, mrn, full_name from public.patients where tenant_id = $1 and opening_batch_id = $2`,
        [tenantA, staged.batchId],
      )
    ).rows;
    expect(patRows.length).toBe(1);
    expect(patRows[0].mrn).toMatch(/^RM-\d{6,}$/);

    const visibleBeforeRollback = (
      await withTenantContext(appPool, ownerCtx, (db) =>
        db.query<{ id: string }>(`select id from public.patients where id = $1`, [patRows[0].id]),
      )
    ).rows;
    expect(visibleBeforeRollback.length).toBe(1);

    const balAcc = (
      await h.admin.query<{ balance: string }>(
        `select balance::text from public.balance_accounts where tenant_id = $1 and patient_id = $2`,
        [tenantA, patRows[0].id],
      )
    ).rows;
    expect(Number(balAcc[0].balance)).toBe(500_000);

    const pkgSessions = (
      await h.admin.query<{ allocated_value: string; vat_amount: string }>(
        `select ps.allocated_value::text, ps.vat_amount::text
           from public.packages pk
           join public.package_sessions ps on ps.tenant_id = pk.tenant_id and ps.package_id = pk.id
          where pk.tenant_id = $1 and pk.opening_batch_id = $2 order by ps.seq`,
        [tenantA, staged.batchId],
      )
    ).rows;
    const pkgVerCheck = (
      await h.admin.query<{ catalog_version_id: string }>(
        `select catalog_version_id from public.packages where tenant_id = $1 and opening_batch_id = $2`,
        [tenantA, staged.batchId],
      )
    ).rows[0].catalog_version_id;
    expect(pkgVerCheck).toBe(facActiveVerId);
    expect(pkgSessions.length).toBe(3);
    expect(pkgSessions.every((s) => Number(s.vat_amount) === 0)).toBe(true);
    expect(pkgSessions.reduce((a, s) => a + Number(s.allocated_value), 0)).toBe(1_500_000);

    // Verify 0121 sub-ledger roll-forward matches operational tables AND zero stored_stock mismatches
    const rf = (
      await withTenantContext(appPool, ownerCtx, (db) =>
        db.query<{
          r: {
            ledgers: Record<string, { closing: number }>;
            checks: Record<string, { mismatches?: number }>;
          };
        }>(`select public.subledger_rollforward('2026-11-01'::date, '2026-11-30'::date, null) as r`),
      )
    ).rows[0].r;
    expect(rf.ledgers.patient_balance.closing).toBe(500_000);
    expect(rf.ledgers.package_liability.closing).toBe(1_500_000);
    expect(rf.ledgers.booking_dp.closing).toBe(250_000);
    expect(rf.ledgers.receivables.closing).toBe(300_000);
    expect(rf.ledgers.vat.closing).toBe(0);
    expect(rf.checks.patient_balance.mismatches).toBe(0);
    expect(rf.checks.booking_dp.mismatches).toBe(0);

    // ledger_period_lock refuses while OpeningImportApplied receipt is still unposted
    const finCtx = await resolveContext(appPool, financeAAcc, { tenantId: tenantA, actingRole: "finance" });
    await expect(
      withTenantContext(appPool, finCtx, (db) =>
        db.query(`select public.ledger_period_lock('lock-check-2026-08', '2026-08')`),
      ),
    ).rejects.toThrow(/ERR_POSTING_INCOMPLETE/);

    // Post OpeningImportApplied outbox events & mark ledger.posting receipts done
    const applyEvents = (
      await h.admin.query<{ id: string }>(
        `select id from public.domain_events where tenant_id = $1 and type = 'OpeningImportApplied' order by occurred_at`,
        [tenantA],
      )
    ).rows;
    expect(applyEvents.length).toBe(4);
    for (const ev of applyEvents) {
      await withTenantContext(appPool, ownerCtx, (db) =>
        db.query(`select public.ledger_post_event($1::uuid)`, [ev.id]),
      );
      await h.admin.query(
        `update public.event_receipts set done_at = clock_timestamp() where tenant_id = $1 and event_id = $2 and consumer = 'ledger.posting'`,
        [tenantA, ev.id],
      );
    }

    const glSummary = (
      await h.admin.query<{ key: string; map_version: string; debit: string; credit: string }>(
        `select a.key, e.map_version, sum(l.debit)::text as debit, sum(l.credit)::text as credit
           from public.journal_entries e
           join public.journal_lines l on l.tenant_id = e.tenant_id and l.entry_id = e.id
           join public.ledger_accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
          where e.tenant_id = $1 and e.event = 'OpeningImportApplied'
          group by a.key, e.map_version
          order by a.key`,
        [tenantA],
      )
    ).rows;
    expect(glSummary.every((r) => r.map_version === LEDGER_MAP_VERSION)).toBe(true);
    const byKey = new Map(glSummary.map((r) => [r.key, { dr: Number(r.debit), cr: Number(r.credit) }]));
    expect(byKey.get("liability_patient_balance")).toEqual({ dr: 0, cr: 500_000 });
    expect(byKey.get("liability_packages")).toEqual({ dr: 0, cr: 1_500_000 });
    expect(byKey.get("liability_booking_dp")).toEqual({ dr: 0, cr: 250_000 });
    expect(byKey.get("patient_receivable")).toEqual({ dr: 300_000, cr: 0 });
    expect(byKey.get("opening_balance_equity")).toEqual({ dr: 2_250_000, cr: 300_000 });

    // Re-importing identical batch creates 0 new duplicates (all 5 rows replay)
    const staged2 = await withExecTx(execPool, (db) =>
      stageValidatedImportBatch(db, {
        tenantId: tenantA,
        actorStaffId: ownerAStaff,
        tenantHmacKey: hmacKey,
        dek,
        dekVersion: 1,
        branchIdByCode: branchMap,
        input: batch.input,
        env: localEnv,
      }),
    );
    await withTenantContext(appPool, ownerCtx, (db) =>
      approveImportBatch(db, staged2.batchId, staged2.validationRevision, staged2.validatedManifestSha256, localEnv),
    );
    const replayed = await withExecTx(execPool, (db) =>
      applyApprovedImportBatch(db, {
        tenantId: tenantA,
        actorStaffId: ownerAStaff,
        batchId: staged2.batchId,
        validationRevision: staged2.validationRevision,
        manifestSha256: staged2.validatedManifestSha256,
        dek,
        env: localEnv,
      }),
    );
    expect(replayed.appliedCount).toBe(0);
    expect(replayed.replayedCount).toBe(5);
    expect(replayed.factCount).toBe(0);

    // Conflicting amount for active BAL-001 fails closed with ERR_SOURCE_CONFLICT
    const conflictBatch = makeSyntheticBatch({ balanceAmount: "600000" });
    const stagedConflict = await withExecTx(execPool, (db) =>
      stageValidatedImportBatch(db, {
        tenantId: tenantA,
        actorStaffId: ownerAStaff,
        tenantHmacKey: hmacKey,
        dek,
        dekVersion: 1,
        branchIdByCode: branchMap,
        input: conflictBatch.input,
        env: localEnv,
      }),
    );
    await withTenantContext(appPool, ownerCtx, (db) =>
      approveImportBatch(
        db,
        stagedConflict.batchId,
        stagedConflict.validationRevision,
        stagedConflict.validatedManifestSha256,
        localEnv,
      ),
    );
    await expect(
      withExecTx(execPool, (db) =>
        applyApprovedImportBatch(db, {
          tenantId: tenantA,
          actorStaffId: ownerAStaff,
          batchId: stagedConflict.batchId,
          validationRevision: stagedConflict.validationRevision,
          manifestSha256: stagedConflict.validatedManifestSha256,
          dek,
          env: localEnv,
        }),
      ),
    ).rejects.toThrow(/ERR_SOURCE_CONFLICT/);

    // Free-text rollback reason refused; closed enum reason accepted
    await expect(
      withTenantContext(appPool, ownerCtx, (db) =>
        db.query(`select public.import_rollback($1::uuid, 'free text with PII 3171010101900001')`, [staged.batchId]),
      ),
    ).rejects.toThrow(/ERR_INVALID_INPUT/);

    // D7 rollback of batch 1 -> unwinds operational rows + retires patient (opening_reversed = true) + OpeningImportReversed
    const rolled = await withTenantContext(appPool, ownerCtx, (db) =>
      rollbackImportBatch(db, staged.batchId, "cutover_correction"),
    );
    expect(rolled.state).toBe("rolled_back");
    expect(rolled.reversedFacts).toBe(4);

    // Rolled-back patient is retired (opening_reversed = true) and HIDDEN from clinic_app active reads
    const patAfter = (
      await h.admin.query<{ opening_reversed: boolean }>(
        `select opening_reversed from public.patients where tenant_id = $1 and id = $2`,
        [tenantA, patRows[0].id],
      )
    ).rows[0];
    expect(patAfter.opening_reversed).toBe(true);
    const visibleAfterRollback = (
      await withTenantContext(appPool, ownerCtx, (db) =>
        db.query<{ id: string }>(`select id from public.patients where id = $1`, [patRows[0].id]),
      )
    ).rows;
    expect(visibleAfterRollback.length).toBe(0);

    const revEvents = (
      await h.admin.query<{ id: string }>(
        `select id from public.domain_events where tenant_id = $1 and type = 'OpeningImportReversed' order by occurred_at`,
        [tenantA],
      )
    ).rows;
    for (const ev of revEvents) {
      await withTenantContext(appPool, ownerCtx, (db) =>
        db.query(`select public.ledger_post_event($1::uuid)`, [ev.id]),
      );
      await h.admin.query(
        `update public.event_receipts set done_at = clock_timestamp() where tenant_id = $1 and event_id = $2 and consumer = 'ledger.posting'`,
        [tenantA, ev.id],
      );
    }

    const rfAfterRev = (
      await withTenantContext(appPool, ownerCtx, (db) =>
        db.query<{ r: { ledgers: Record<string, { closing: number }> } }>(
          `select public.subledger_rollforward('2026-11-01'::date, '2026-11-30'::date, null) as r`,
        ),
      )
    ).rows[0].r;
    expect(rfAfterRev.ledgers.patient_balance.closing).toBe(0);
    expect(rfAfterRev.ledgers.package_liability.closing).toBe(0);
    expect(rfAfterRev.ledgers.booking_dp.closing).toBe(0);
    expect(rfAfterRev.ledgers.receivables.closing).toBe(0);

    // Option 1A: re-import corrected BAL-001 (Rp 550,000) in a fresh owner-approved batch succeeds while preserving old reversed tombstones
    const correctedBatch = makeSyntheticBatch({ balanceAmount: "550000" });
    const staged3 = await withExecTx(execPool, (db) =>
      stageValidatedImportBatch(db, {
        tenantId: tenantA,
        actorStaffId: ownerAStaff,
        tenantHmacKey: hmacKey,
        dek,
        dekVersion: 1,
        branchIdByCode: branchMap,
        input: correctedBatch.input,
        env: localEnv,
      }),
    );
    await withTenantContext(appPool, ownerCtx, (db) =>
      approveImportBatch(
        db,
        staged3.batchId,
        staged3.validationRevision,
        staged3.validatedManifestSha256,
        localEnv,
      ),
    );
    const reimported = await withExecTx(execPool, (db) =>
      applyApprovedImportBatch(db, {
        tenantId: tenantA,
        actorStaffId: ownerAStaff,
        batchId: staged3.batchId,
        validationRevision: staged3.validationRevision,
        manifestSha256: staged3.validatedManifestSha256,
        dek,
        env: localEnv,
      }),
    );
    expect(reimported.appliedCount).toBe(5);
    expect(reimported.reimportedAfterReversalCount).toBe(5);

    const mapCounts = (
      await h.admin.query<{ state: string; cnt: string }>(
        `select state, count(*)::text as cnt from public.source_id_map where tenant_id = $1 group by state order by state`,
        [tenantA],
      )
    ).rows;
    expect(mapCounts).toEqual([
      { state: "active", cnt: "5" },
      { state: "reversed", cnt: "5" },
    ]);

    // import_opening_facts.id is immutable
    const factId = (
      await h.admin.query<{ id: string }>(`select id from public.import_opening_facts where tenant_id = $1 limit 1`, [
        tenantA,
      ])
    ).rows[0].id;
    await expect(
      h.admin.query(`update public.import_opening_facts set id = public.uuid_generate_v7() where id = $1`, [factId]),
    ).rejects.toThrow(/ERR_IMMUTABLE/);

    // List batches never leaks raw PII
    const list = await withTenantContext(appPool, ownerCtx, (db) => listImportBatches(db));
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(list)).not.toContain("3171010101900001");
    expect(JSON.stringify(list)).not.toContain("Pasien Sintetis Impor");
  });

  it("handles cross-branch opening balance reversal outside FIFO, opening package redemption/close GL parity, payment-backed debit rollback refusal, and historical export", async () => {
    const ownerCtx = await resolveContext(appPool, ownerAAcc, { tenantId: tenantA, actingRole: "owner" });
    const branchMap = new Map([
      ["jkt", branchA1],
      ["sby", branchA2],
    ]);

    // r3 P1 #3: pre-existing credit at Branch A (jkt) + balance-only import at Branch B (sby) + rollback of Branch B
    // must keep Branch A intact and net Branch B to 0 in BOTH subledger_rollforward and GL!
    const xbrA = makeSyntheticBatch({
      sourceSystem: "legacy_xbr",
      balanceAmount: "400000",
      balanceBranch: "jkt",
      balanceExtId: "BAL-XBR-JKT",
      onlyPatientAndBalance: true,
      cutoverDate: "2026-07-15",
      patSuffix: "XBR",
    });
    const sxA = await withExecTx(execPool, (db) =>
      stageValidatedImportBatch(db, {
        tenantId: tenantA,
        actorStaffId: ownerAStaff,
        tenantHmacKey: hmacKey,
        dek,
        dekVersion: 1,
        branchIdByCode: branchMap,
        input: xbrA.input,
        env: localEnv,
      }),
    );
    await withTenantContext(appPool, ownerCtx, (db) =>
      approveImportBatch(db, sxA.batchId, sxA.validationRevision, sxA.validatedManifestSha256, localEnv),
    );
    await withExecTx(execPool, (db) =>
      applyApprovedImportBatch(db, {
        tenantId: tenantA,
        actorStaffId: ownerAStaff,
        batchId: sxA.batchId,
        validationRevision: sxA.validationRevision,
        manifestSha256: sxA.validatedManifestSha256,
        dek,
        env: localEnv,
      }),
    );

    // Batch B replays PAT-XBR and adds opening balance at Surabaya (sby)
    const xbrB = makeSyntheticBatch({
      sourceSystem: "legacy_xbr",
      balanceAmount: "250000",
      balanceBranch: "sby",
      balanceExtId: "BAL-XBR-SBY",
      onlyPatientAndBalance: true,
      cutoverDate: "2026-07-16",
      patSuffix: "XBR",
    });
    const sxB = await withExecTx(execPool, (db) =>
      stageValidatedImportBatch(db, {
        tenantId: tenantA,
        actorStaffId: ownerAStaff,
        tenantHmacKey: hmacKey,
        dek,
        dekVersion: 1,
        branchIdByCode: branchMap,
        input: xbrB.input,
        env: localEnv,
      }),
    );
    await withTenantContext(appPool, ownerCtx, (db) =>
      approveImportBatch(db, sxB.batchId, sxB.validationRevision, sxB.validatedManifestSha256, localEnv),
    );
    await withExecTx(execPool, (db) =>
      applyApprovedImportBatch(db, {
        tenantId: tenantA,
        actorStaffId: ownerAStaff,
        batchId: sxB.batchId,
        validationRevision: sxB.validationRevision,
        manifestSha256: sxB.validatedManifestSha256,
        dek,
        env: localEnv,
      }),
    );

    // Roll back Batch B (sby): must debit sby directly outside FIFO, leaving jkt at 400,000!
    await withTenantContext(appPool, ownerCtx, (db) => rollbackImportBatch(db, sxB.batchId, "cutover_correction"));
    const rfJkt = (
      await withTenantContext(appPool, ownerCtx, (db) =>
        db.query<{ r: { ledgers: Record<string, { closing: number }> } }>(
          `select public.subledger_rollforward('2026-07-01'::date, '2026-07-31'::date, $1::uuid) as r`,
          [branchA1],
        ),
      )
    ).rows[0].r;
    const rfSby = (
      await withTenantContext(appPool, ownerCtx, (db) =>
        db.query<{ r: { ledgers: Record<string, { closing: number }> } }>(
          `select public.subledger_rollforward('2026-07-01'::date, '2026-07-31'::date, $1::uuid) as r`,
          [branchA2],
        ),
      )
    ).rows[0].r;
    expect(rfJkt.ledgers.patient_balance.closing).toBe(400_000);
    expect(rfSby.ledgers.patient_balance.closing).toBe(0);

    // r3 P1 #4: Opening package redemption & close lifecycle movements reduce package_liability in subledger_movements
    // AND reconcile 1:1 with 0123 GL!
    const pkgBatch = makeSyntheticBatch({
      sourceSystem: "legacy_pkg",
      balanceAmount: "100000",
      cutoverDate: "2026-06-15",
      patSuffix: "PKG",
    });
    const sPkg = await withExecTx(execPool, (db) =>
      stageValidatedImportBatch(db, {
        tenantId: tenantA,
        actorStaffId: ownerAStaff,
        tenantHmacKey: hmacKey,
        dek,
        dekVersion: 1,
        branchIdByCode: branchMap,
        input: pkgBatch.input,
        env: localEnv,
      }),
    );
    await withTenantContext(appPool, ownerCtx, (db) =>
      approveImportBatch(db, sPkg.batchId, sPkg.validationRevision, sPkg.validatedManifestSha256, localEnv),
    );
    await withExecTx(execPool, (db) =>
      applyApprovedImportBatch(db, {
        tenantId: tenantA,
        actorStaffId: ownerAStaff,
        batchId: sPkg.batchId,
        validationRevision: sPkg.validationRevision,
        manifestSha256: sPkg.validatedManifestSha256,
        dek,
        env: localEnv,
      }),
    );
    const openPkg = (
      await h.admin.query<{ id: string; patient_id: string }>(
        `select id, patient_id from public.packages where tenant_id = $1 and opening_batch_id = $2`,
        [tenantA, sPkg.batchId],
      )
    ).rows[0];
    const openSessions = (
      await h.admin.query<{ id: string; allocated_value: string }>(
        `select id, allocated_value::text from public.package_sessions where tenant_id = $1 and package_id = $2 order by seq`,
        [tenantA, openPkg.id],
      )
    ).rows;
    // Verify package_paid(pk) returns 1,500,000 for opening package (enabling real live session reservation & close)
    const openPaid = (
      await h.admin.query<{ paid: string }>(
        `select public.package_paid(pk)::text as paid from public.packages pk where pk.tenant_id = $1 and pk.id = $2`,
        [tenantA, openPkg.id],
      )
    ).rows[0].paid;
    expect(Number(openPaid)).toBe(1_500_000);

    // Redeem session 1 (Rp 500,000) via legal available -> reserved -> redeemed transition,
    // then close/expire sessions 2-3 (Rp 1,000,000 -> patient balance)
    const pkgVisitId = (
      await h.admin.query<{ id: string }>(
        `insert into public.visits (tenant_id, branch_id, patient_id, kind, checked_in_by)
         values ($1, $2, $3, 'walk_in', $4) returning id`,
        [tenantA, branchA1, openPkg.patient_id, ownerAStaff],
      )
    ).rows[0].id;
    const pkgExamId = (
      await h.admin.query<{ id: string }>(
        `insert into public.examinations (tenant_id, branch_id, visit_id, patient_id, author_id)
         values ($1, $2, $3, $4, $5) returning id`,
        [tenantA, branchA1, pkgVisitId, openPkg.patient_id, ownerAStaff],
      )
    ).rows[0].id;
    const pkgPlanId = (
      await h.admin.query<{ id: string }>(
        `insert into public.care_plans (tenant_id, branch_id, patient_id, title, condition, created_exam_id, created_by)
         values ($1, $2, $3, 'Rencana Paket Impor', 'Perawatan kulit rutin', $4, $5) returning id`,
        [tenantA, branchA1, openPkg.patient_id, pkgExamId, ownerAStaff],
      )
    ).rows[0].id;
    const facVerId = (
      await h.admin.query<{ id: string }>(
        `select cv.id from public.catalog_versions cv join public.catalog_items ci on ci.tenant_id = cv.tenant_id and ci.id = cv.item_id
          where ci.tenant_id = $1 and ci.code = 'FAC-01' limit 1`,
        [tenantA],
      )
    ).rows[0].id;
    const pkgPlanItemId = (
      await h.admin.query<{ id: string }>(
        `insert into public.plan_items (tenant_id, branch_id, plan_id, examination_id, stage, catalog_version_id, qty)
         values ($1, $2, $3, $4, 1, $5, 1) returning id`,
        [tenantA, branchA1, pkgPlanId, pkgExamId, facVerId],
      )
    ).rows[0].id;
    const pkgExecId = (
      await h.admin.query<{ id: string }>(
        `insert into public.treatment_executions (
           tenant_id, branch_id, visit_id, plan_item_id, performer_staff_id,
           identity_confirmed, state, stage, started_by, started_as, start_command_key
         ) values ($1, $2, $3, $4, $5, true, 'started', 'preparation', $5, 'doctor', 'openpkg-exec-1') returning id`,
        [tenantA, branchA1, pkgVisitId, pkgPlanItemId, ownerAStaff],
      )
    ).rows[0].id;
    await h.admin.query(
      `update public.package_sessions
          set state = 'reserved', reserved_visit_id = $3, reserved_execution_id = $4, beneficiary_patient_id = $5, version = version + 1
        where tenant_id = $1 and id = $2`,
      [tenantA, openSessions[0].id, pkgVisitId, pkgExecId, openPkg.patient_id],
    );
    await h.admin.query(
      `update public.treatment_executions
          set state = 'finished', outcome = 'completed', finished_at = '2026-06-20T10:00:00Z',
              finished_by = $3, finished_as = 'doctor', finish_command_key = 'openpkg-exec-fin-1'
        where tenant_id = $1 and id = $2`,
      [tenantA, pkgExecId, ownerAStaff],
    );
    await h.admin.query(
      `update public.package_sessions
          set state = 'redeemed', redeemed_at = '2026-06-20T10:00:00Z',
              redeemed_branch_id = $3, version = version + 1
        where tenant_id = $1 and id = $2`,
      [tenantA, openSessions[0].id, branchA1],
    );
    const redeemEvtId = (
      await h.admin.query<{ id: string }>(
        `insert into public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload, occurred_at)
         values ($1, $2, 'SessionRedeemed', 'package_session', $3::uuid, $4, 'owner', jsonb_build_object('session_id', $3::text), '2026-06-20T10:00:00Z')
         returning id`,
        [tenantA, branchA1, openSessions[0].id, ownerAStaff],
      )
    ).rows[0].id;
    await withTenantContext(appPool, ownerCtx, (db) =>
      db.query(`select public.ledger_post_event($1::uuid)`, [redeemEvtId]),
    );

    const pkgAcc = (
      await h.admin.query<{ id: string; balance: string }>(
        `select id, balance::text from public.balance_accounts where tenant_id = $1 and patient_id = $2`,
        [tenantA, openPkg.patient_id],
      )
    ).rows[0];
    const expBalId = (
      await h.admin.query<{ id: string }>(
        `insert into public.balance_entries (
           tenant_id, account_id, branch_id, kind, amount, balance_after,
           vat_settled, source_kind, source_id, command_key, created_by, created_as, created_at
         ) values ($1, $2, $3, 'from_expiry', 1000000, $4, false, 'package', $5, 'openpkg-exp-1', $6, 'owner', '2026-06-25T10:00:00Z')
         returning id`,
        [tenantA, pkgAcc.id, branchA1, Number(pkgAcc.balance) + 1_000_000, openPkg.id, ownerAStaff],
      )
    ).rows[0].id;
    await h.admin.query(
      `update public.package_sessions set state = 'closed', version = version + 1
        where tenant_id = $1 and package_id = $2 and state = 'available'`,
      [tenantA, openPkg.id],
    );
    await h.admin.query(
      `update public.packages
          set state = 'expired', closed_at = '2026-06-25T10:00:00Z', closed_by = $3, closed_as = 'owner',
              close_reason = 'expired', moved_to_balance = 1000000, paid_unused_moved = 1000000, remainder_cancelled = 0
        where tenant_id = $1 and id = $2`,
      [tenantA, openPkg.id, ownerAStaff],
    );
    const expEvtId = (
      await h.admin.query<{ id: string }>(
        `insert into public.domain_events (tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload, occurred_at)
         values ($1, $2, 'BalanceMoved', 'balance_entry', $3::uuid, $4, 'owner', jsonb_build_object('entry_id', $3::text), '2026-06-25T10:00:00Z')
         returning id`,
        [tenantA, branchA1, expBalId, ownerAStaff],
      )
    ).rows[0].id;
    // Post opening fact for pkgBatch + expiry BalanceMoved and verify BOTH subledger and GL net package liability to 0!
    const pkgOpenEvt = (
      await h.admin.query<{ id: string }>(
        `select id from public.domain_events where tenant_id = $1 and type = 'OpeningImportApplied' and payload->>'batch_id' = $2 and payload->>'fact_kind' = 'package'`,
        [tenantA, sPkg.batchId],
      )
    ).rows[0].id;
    await withTenantContext(appPool, ownerCtx, (db) =>
      db.query(`select public.ledger_post_event($1::uuid)`, [pkgOpenEvt]),
    );
    await withTenantContext(appPool, ownerCtx, (db) =>
      db.query(`select public.ledger_post_event($1::uuid)`, [expEvtId]),
    );
    const rfJune = (
      await withTenantContext(appPool, ownerCtx, (db) =>
        db.query<{ r: { ledgers: Record<string, { closing: number }> } }>(
          `select public.subledger_rollforward('2026-06-01'::date, '2026-06-30'::date, null) as r`,
        ),
      )
    ).rows[0].r;
    expect(rfJune.ledgers.package_liability.closing).toBe(0);
    const glPkgJune = (
      await h.admin.query<{ net: string }>(
        `select coalesce(sum(l.credit - l.debit), 0)::text as net
           from public.journal_entries e
           join public.journal_lines l on l.tenant_id = e.tenant_id and l.entry_id = e.id
           join public.ledger_accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
          where e.tenant_id = $1 and e.period = '2026-06' and a.key = 'liability_packages'`,
        [tenantA],
      )
    ).rows[0].net;
    expect(Number(glPkgJune)).toBe(0);

    // Multi-balance same-patient rollback in descending seq order + out-of-order reversal attribution (2026-10)
    const octBatch = makeSyntheticBatch({
      sourceSystem: "legacy_oct",
      balanceAmount: "410000",
      extraBalanceAmount: "190000",
      cutoverDate: "2026-10-31",
      patSuffix: "OCT",
    });
    const s = await withExecTx(execPool, (db) =>
      stageValidatedImportBatch(db, {
        tenantId: tenantA,
        actorStaffId: ownerAStaff,
        tenantHmacKey: hmacKey,
        dek,
        dekVersion: 1,
        branchIdByCode: branchMap,
        input: octBatch.input,
        env: localEnv,
      }),
    );
    await withTenantContext(appPool, ownerCtx, (db) =>
      approveImportBatch(db, s.batchId, s.validationRevision, s.validatedManifestSha256, localEnv),
    );
    const octApplied = await withExecTx(execPool, (db) =>
      applyApprovedImportBatch(db, {
        tenantId: tenantA,
        actorStaffId: ownerAStaff,
        batchId: s.batchId,
        validationRevision: s.validationRevision,
        manifestSha256: s.validatedManifestSha256,
        dek,
        env: localEnv,
      }),
    );
    expect(octApplied.appliedCount).toBe(6);
    expect(octApplied.factCount).toBe(5);

    const octRolled = await withTenantContext(appPool, ownerCtx, (db) =>
      rollbackImportBatch(db, s.batchId, "owner_cancelled"),
    );
    expect(octRolled.reversedFacts).toBe(5);

    const revEvents = (
      await h.admin.query<{ id: string }>(
        `select id from public.domain_events where tenant_id = $1 and type = 'OpeningImportReversed' and payload->>'batch_id' = $2`,
        [tenantA, s.batchId],
      )
    ).rows;
    expect(revEvents.length).toBe(5);
    for (const ev of revEvents) {
      await withTenantContext(appPool, ownerCtx, (db) =>
        db.query(`select public.ledger_post_event($1::uuid)`, [ev.id]),
      );
    }
    const badAttr = (
      await h.admin.query<{ cnt: string }>(
        `select count(*)::text as cnt
           from public.journal_entries je
           join public.domain_events de on de.tenant_id = je.tenant_id and de.id = je.source_event_id
           join public.import_opening_facts f on f.tenant_id = je.tenant_id and f.id = je.source_id
          where je.tenant_id = $1 and f.batch_id = $2 and je.event = 'OpeningImportApplied' and de.type <> 'OpeningImportApplied'`,
        [tenantA, s.batchId],
      )
    ).rows[0].cnt;
    expect(Number(badAttr)).toBe(0);

    // r3 P1 #2: payment-backed balance debit (kind='use', payment_id IS NOT NULL, source_kind IS NULL, source_id IS NULL)
    // on a balance-only batch for an already-existing patient (PAT-XBR) MUST block rollback via the null-safe balance_entries NOT EXISTS check!
    const sepBatch = makeSyntheticBatch({
      sourceSystem: "legacy_xbr",
      balanceAmount: "310000",
      balanceExtId: "BAL-XBR-SEP",
      onlyPatientAndBalance: true,
      cutoverDate: "2026-09-30",
      patSuffix: "XBR",
    });
    const sSep = await withExecTx(execPool, (db) =>
      stageValidatedImportBatch(db, {
        tenantId: tenantA,
        actorStaffId: ownerAStaff,
        tenantHmacKey: hmacKey,
        dek,
        dekVersion: 1,
        branchIdByCode: branchMap,
        input: sepBatch.input,
        env: localEnv,
      }),
    );
    await withTenantContext(appPool, ownerCtx, (db) =>
      approveImportBatch(db, sSep.batchId, sSep.validationRevision, sSep.validatedManifestSha256, localEnv),
    );
    await withExecTx(execPool, (db) =>
      applyApprovedImportBatch(db, {
        tenantId: tenantA,
        actorStaffId: ownerAStaff,
        batchId: sSep.batchId,
        validationRevision: sSep.validationRevision,
        manifestSha256: sSep.validatedManifestSha256,
        dek,
        env: localEnv,
      }),
    );

    const sepPat = (
      await h.admin.query<{ id: string }>(
        `select id from public.patients where tenant_id = $1 and opening_batch_id = $2`,
        [tenantA, sxA.batchId],
      )
    ).rows[0].id;
    const sepAcc = (
      await h.admin.query<{ id: string; balance: string }>(
        `select id, balance::text from public.balance_accounts where tenant_id = $1 and patient_id = $2`,
        [tenantA, sepPat],
      )
    ).rows[0];
    // Insert a payment-backed balance debit (kind='use', payment_id IS NOT NULL, source_kind = NULL, source_id = NULL)
    // Because PAT-XBR belongs to sxA (not sSep), rollback of sSep hits the exact null-safe balance_entries NOT EXISTS guard!
    const invId = (
      await h.admin.query<{ id: string }>(
        `insert into public.invoices (
           tenant_id, branch_id, sold_branch_id, patient_id, state, command_key, created_by, created_as
         ) values (
           $1, $2, $2, $3, 'draft', 'inv-bal-use-sep-1', $4, 'owner'
         ) returning id`,
        [tenantA, branchA1, sepPat, ownerAStaff],
      )
    ).rows[0].id;
    const facItem = (
      await h.admin.query<{ item_id: string; ver_id: string }>(
        `select ci.id as item_id, cv.id as ver_id from public.catalog_items ci
           join public.catalog_versions cv on cv.tenant_id = ci.tenant_id and cv.item_id = ci.id
          where ci.tenant_id = $1 and ci.code = 'FAC-01' limit 1`,
        [tenantA],
      )
    ).rows[0];
    await h.admin.query(
      `insert into public.invoice_lines (
         tenant_id, branch_id, invoice_id, item_id, catalog_version_id,
         quantity, unit_price, discount, line_total, tax_category, tax_basis, vat_base, vat_amount
       ) values ($1, $2, $3, $4, $5, 1, 50000, 0, 50000, 'non_object', 'non_pkp', 50000, 0)`,
      [tenantA, branchA1, invId, facItem.item_id, facItem.ver_id],
    );
    await h.admin.query(
      `update public.invoices
          set state = 'issued', number = 'INV-JKT-202609-0001', is_pkp_at_issue = false,
              issued_at = clock_timestamp(), issued_by = $3, issued_as = 'owner'
        where tenant_id = $1 and id = $2`,
      [tenantA, invId, ownerAStaff],
    );
    const rcptId = (
      await h.admin.query<{ id: string }>(
        `insert into public.receipts (
           tenant_id, branch_id, invoice_id, number, total, body, paper, command_key, issued_by, issued_as
         ) values (
           $1, $2, $3, 'KW-JKT-202609-0001', 50000, 'Kwitansi pembayaran saldo', '80mm', 'rcpt-bal-use-sep-1', $4, 'owner'
         ) returning id`,
        [tenantA, branchA1, invId, ownerAStaff],
      )
    ).rows[0].id;
    const payId = (
      await h.admin.query<{ id: string }>(
        `insert into public.payments (
           tenant_id, branch_id, receipt_id, seq, invoice_id, patient_id, method, amount, environment, received_by, received_as
         ) values ($1, $2, $3, 1, $4, $5, 'balance', 50000, 'local', $6, 'owner') returning id`,
        [tenantA, branchA1, rcptId, invId, sepPat, ownerAStaff],
      )
    ).rows[0].id;
    await h.admin.query(
      `insert into public.balance_entries (
         tenant_id, account_id, branch_id, kind, amount, balance_after,
         vat_settled, payment_id, source_kind, source_id, command_key, created_by, created_as
       ) values ($1, $2, $3, 'use', -50000, $4, false, $5, NULL, NULL, 'use-bal-sep-1', $6, 'owner')`,
      [tenantA, sepAcc.id, branchA1, Number(sepAcc.balance) - 50000, payId, ownerAStaff],
    );

    await expect(
      withTenantContext(appPool, ownerCtx, (db) => rollbackImportBatch(db, sSep.batchId, "mapping_error")),
    ).rejects.toThrow(/ERR_DOWNSTREAM_ACTIVITY/);

    // r2 P1 #3: verify ledger_journal_export preserves BOTH historical 'draft-11-2026-11-19' AND 'draft-11-2026-11-26-t128' entries
    const allOpenEvents = (
      await h.admin.query<{ id: string }>(
        `select de.id from public.domain_events de
           left join public.event_receipts er on er.tenant_id = de.tenant_id and er.event_id = de.id and er.consumer = 'ledger.posting'
          where de.tenant_id = $1 and de.type in ('OpeningImportApplied', 'OpeningImportReversed') and (er.id is null or er.done_at is null)`,
        [tenantA],
      )
    ).rows;
    for (const ev of allOpenEvents) {
      await withTenantContext(appPool, ownerCtx, (db) => db.query(`select public.ledger_post_event($1::uuid)`, [ev.id]));
      await h.admin.query(
        `update public.event_receipts set done_at = clock_timestamp()
          where tenant_id = $1 and event_id = $2 and consumer = 'ledger.posting'`,
        [tenantA, ev.id],
      );
    }
    const histEvtId = (
      await h.admin.query<{ id: string }>(
        `insert into public.domain_events (
           tenant_id, branch_id, type, aggregate_kind, aggregate_id, staff_id, acting_role, payload, occurred_at
         ) values (
           $1, $2, 'BalanceLoaded', 'balance_account', $3::uuid, $4, 'owner', jsonb_build_object('patient_id', $3::text), '2026-11-10T10:00:00Z'
         ) returning id`,
        [tenantA, branchA1, sepPat, ownerAStaff],
      )
    ).rows[0].id;
    const cashAccId = (
      await h.admin.query<{ id: string }>(
        `select id from public.ledger_accounts where tenant_id = $1 and key = 'cash_shift'`,
        [tenantA],
      )
    ).rows[0].id;
    const balLiabId = (
      await h.admin.query<{ id: string }>(
        `select id from public.ledger_accounts where tenant_id = $1 and key = 'liability_patient_balance'`,
        [tenantA],
      )
    ).rows[0].id;
    const histKey = "hist-balance-load-2026-11-10";
    await h.admin.query(
      `with e as (
         insert into public.journal_entries (
           tenant_id, kind, posting_key, event, source_kind, source_id, source_event_id,
           business_date, period, original_period, map_version
         ) values (
           $1, 'auto', $2, 'BalanceLoaded', 'balance_entry', $3::uuid, $4,
           '2026-11-10', '2026-11', '2026-11', 'draft-11-2026-11-19'
         ) returning id
       ), arm as (
         select set_config('app.ledger_entry', id::text, true) from e
       )
       insert into public.journal_lines (tenant_id, entry_id, account_id, branch_id, debit, credit)
       select $1::uuid, e.id, $5::uuid, $7::uuid, 10000, 0 from e, arm
       union all
       select $1::uuid, e.id, $6::uuid, $7::uuid, 0, 10000 from e, arm`,
      [tenantA, histKey, sepPat, histEvtId, cashAccId, balLiabId, branchA1],
    );
    const finCtx = await resolveContext(appPool, financeAAcc, { tenantId: tenantA, actingRole: "finance" });
    const pdf = Buffer.from("%PDF-1.7\nposting map sign-off\n%%EOF\n");
    const { fileId } = await withTenantContext(appPool, ownerCtx, (db) =>
      uploadEvidence(db, {
        obligationKey: "posting_map_signoff",
        fileName: "map.pdf",
        content: pdf,
        expertName: "Akuntan Sintetis",
        documentDate: "2026-11-26",
      }),
    );
    const evItem = (await h.admin.query<{ item_id: string }>(`select item_id from evidence_files where id = $1`, [fileId])).rows[0].item_id;
    await withTenantContext(appPool, finCtx, (db) => decideEvidence(db, evItem, fileId, "approved"));
    await h.admin.query(
      `insert into public.ledger_activations (tenant_id, map_version) values ($1, $2)`,
      [tenantA, LEDGER_MAP_VERSION],
    );
    const exported = (
      await withTenantContext(appPool, finCtx, (db) =>
        db.query<{ r: { rows: Array<{ reference: string; account: string }> } }>(
          `select public.ledger_journal_export('2026-11-01'::date, '2026-11-30'::date) as r`,
        ),
      )
    ).rows[0].r;
    expect(exported.rows.some((r) => r.reference === histKey)).toBe(true);
    expect(exported.rows.some((r) => r.reference.startsWith("opening_import:apply:"))).toBe(true);
  });

  it("supports one-time matchOpeningDeposit for held opening deposits (blocking rollback) and leap-day Feb 29 cutover default expiry clamping", async () => {
    // r4 P2 #4: calendar anniversary rule clamps Feb 29 -> Feb 28 in non-leap years
    expect(defaultOpeningPackageExpiry("2024-02-29")).toBe("2025-02-28");
    expect(defaultOpeningPackageExpiry("2028-02-29")).toBe("2029-02-28");
    expect(defaultOpeningPackageExpiry("2027-02-28")).toBe("2028-02-28");

    const ownerCtx = await resolveContext(appPool, ownerAAcc, { tenantId: tenantA, actingRole: "owner" });
    const branchMap = new Map([
      ["jkt", branchA1],
      ["sby", branchA2],
    ]);

    // Stage, approve, and apply a leap-day cutover (2028-02-29) without explicit package expiresOn -> resolves cleanly to 2029-02-28!
    const leapBatch = makeSyntheticBatch({
      sourceSystem: "legacy_leap",
      cutoverDate: "2028-02-29",
      patSuffix: "LEAP",
      omitPackageExpiry: true,
    });
    const sLeap = await withExecTx(execPool, (db) =>
      stageValidatedImportBatch(db, {
        tenantId: tenantA,
        actorStaffId: ownerAStaff,
        tenantHmacKey: hmacKey,
        dek,
        dekVersion: 1,
        branchIdByCode: branchMap,
        input: leapBatch.input,
        env: localEnv,
      }),
    );
    await withTenantContext(appPool, ownerCtx, (db) =>
      approveImportBatch(db, sLeap.batchId, sLeap.validationRevision, sLeap.validatedManifestSha256, localEnv),
    );
    const appliedLeap = await withExecTx(execPool, (db) =>
      applyApprovedImportBatch(db, {
        tenantId: tenantA,
        actorStaffId: ownerAStaff,
        batchId: sLeap.batchId,
        validationRevision: sLeap.validationRevision,
        manifestSha256: sLeap.validatedManifestSha256,
        dek,
        env: localEnv,
      }),
    );
    expect(appliedLeap.appliedCount).toBe(5);

    const leapPkg = (
      await h.admin.query<{ validity_day: string; catalog_version_id: string }>(
        `select to_char(validity_end AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') as validity_day, catalog_version_id
           from public.packages where tenant_id = $1 and opening_batch_id = $2`,
        [tenantA, sLeap.batchId],
      )
    ).rows[0];
    expect(leapPkg.validity_day).toBe("2029-02-28");
    expect(leapPkg.catalog_version_id).toBe(facActiveVerId);

    // r4 P1 #1: one-time match of held opening deposit to a real appointment
    const leapPatId = (
      await h.admin.query<{ id: string }>(
        `select id from public.patients where tenant_id = $1 and opening_batch_id = $2`,
        [tenantA, sLeap.batchId],
      )
    ).rows[0].id;
    const leapDpId = (
      await h.admin.query<{ id: string }>(
        `select id from public.booking_deposits where tenant_id = $1 and opening_batch_id = $2`,
        [tenantA, sLeap.batchId],
      )
    ).rows[0].id;
    const apptId = (
      await h.admin.query<{ id: string }>(
        `insert into public.appointments (
           tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id,
           starts_at, ends_at, state, channel, created_by, created_as
         ) values (
           $1, $2, $3, $4, $5,
           '2028-03-05T03:00:00Z', '2028-03-05T04:00:00Z', 'booked', 'staff', $5, 'owner'
         ) returning id`,
        [tenantA, branchA1, leapPatId, facActiveVerId, ownerAStaff],
      )
    ).rows[0].id;

    // r5 P2 #3a: cross-tenant negative test — tenant B owner CANNOT match tenant A's opening deposit!
    const ownerBCtx = await resolveContext(appPool, ownerBAcc, { tenantId: tenantB, actingRole: "owner" });
    await expect(
      withTenantContext(appPool, ownerBCtx, (db) => matchOpeningDeposit(db, leapDpId, apptId)),
    ).rejects.toThrow(/ERR_NOT_FOUND/);

    // r5 P2 #3b: deposit-only batch on already-mapped patient (PAT-LEAP) proves deposit-specific rollback refusal!
    const leapDpOnly = makeSyntheticBatch({
      sourceSystem: "legacy_leap",
      cutoverDate: "2028-03-01",
      patSuffix: "LEAP",
      onlyPatientAndDp: true,
      dpExtId: "DP-LEAP-2",
    });
    const sLeapDp = await withExecTx(execPool, (db) =>
      stageValidatedImportBatch(db, {
        tenantId: tenantA,
        actorStaffId: ownerAStaff,
        tenantHmacKey: hmacKey,
        dek,
        dekVersion: 1,
        branchIdByCode: branchMap,
        input: leapDpOnly.input,
        env: localEnv,
      }),
    );
    await withTenantContext(appPool, ownerCtx, (db) =>
      approveImportBatch(db, sLeapDp.batchId, sLeapDp.validationRevision, sLeapDp.validatedManifestSha256, localEnv),
    );
    await withExecTx(execPool, (db) =>
      applyApprovedImportBatch(db, {
        tenantId: tenantA,
        actorStaffId: ownerAStaff,
        batchId: sLeapDp.batchId,
        validationRevision: sLeapDp.validationRevision,
        manifestSha256: sLeapDp.validatedManifestSha256,
        dek,
        env: localEnv,
      }),
    );
    const dp2Id = (
      await h.admin.query<{ id: string }>(
        `select id from public.booking_deposits where tenant_id = $1 and opening_batch_id = $2`,
        [tenantA, sLeapDp.batchId],
      )
    ).rows[0].id;

    const matched = await withTenantContext(appPool, ownerCtx, (db) => matchOpeningDeposit(db, dp2Id, apptId));
    expect(matched).toEqual({ depositId: dp2Id, appointmentId: apptId, catalogVersionId: facActiveVerId });

    // Second match attempt is refused (one-time match only)
    await expect(
      withTenantContext(appPool, ownerCtx, (db) => matchOpeningDeposit(db, dp2Id, apptId)),
    ).rejects.toThrow(/ERR_VERSION_CONFLICT/);

    // Rollback of deposit-only batch hits the EXACT deposit-specific guard (patient belongs to sLeap, not sLeapDp!)
    await expect(
      withTenantContext(appPool, ownerCtx, (db) => rollbackImportBatch(db, sLeapDp.batchId, "cutover_correction")),
    ).rejects.toThrow(/ERR_DOWNSTREAM_ACTIVITY: imported booking deposit already matched or decided/);

    // r5 P2 #1: ineligible product code (PRD-01) is refused BEFORE staging (server-side active service lookup)
    const badProdInput = {
      ...leapBatch.input,
      sourceSystem: "legacy_badprod",
      packages: [{ ...leapBatch.input.packages[0], catalogCode: "PRD-01" }],
    };
    await expect(
      withExecTx(execPool, (db) =>
        stageValidatedImportBatch(db, {
          tenantId: tenantA,
          actorStaffId: ownerAStaff,
          tenantHmacKey: hmacKey,
          dek,
          dekVersion: 1,
          branchIdByCode: branchMap,
          input: badProdInput,
          env: localEnv,
        }),
      ),
    ).rejects.toThrow(/ERR_INVALID_INPUT/);

    // r6 P2 #2a: package-only batch with valid preceding patient row + wrong active service UUID (FAC-02)
    // reaches the EXACT package row and fails closed (never failing on an earlier bogus balance row)!
    const wrongSvcBatch = makeSyntheticBatch({
      sourceSystem: "legacy_wsvc",
      cutoverDate: "2028-04-01",
      patSuffix: "WSVC",
      onlyPatientAndPkg: true,
    });
    const sWsvc = await withExecTx(execPool, (db) =>
      stageValidatedImportBatch(db, {
        tenantId: tenantA,
        actorStaffId: ownerAStaff,
        tenantHmacKey: hmacKey,
        dek,
        dekVersion: 1,
        branchIdByCode: branchMap,
        input: wrongSvcBatch.input,
        env: localEnv,
      }),
    );
    await withTenantContext(appPool, ownerCtx, (db) =>
      approveImportBatch(db, sWsvc.batchId, sWsvc.validationRevision, sWsvc.validatedManifestSha256, localEnv),
    );
    // Compute exact authentic patientSourceKeyHash so patient row succeeds and packages row itself is reached!
    const wsvcStagedRows = await withExecTx(execPool, async (db) => {
      await bindResidencyContext(db, localEnv);
      return (
        await db.query<{ res: { rows: Array<{ entity: string; sourceKeyHash: string }> } }>(
          `SELECT public.import_staged_rows_for_apply($1::uuid, $2::uuid, $3::uuid) AS res`,
          [tenantA, ownerAStaff, sWsvc.batchId],
        )
      ).rows[0].res.rows;
    });
    const wsvcPatHash = wsvcStagedRows.find((r) => r.entity === "patients")!.sourceKeyHash;
    await expect(
      withExecTx(execPool, async (db) => {
        await bindResidencyContext(db, localEnv);
        return db.query(`SELECT public.import_apply($1::uuid, $2::uuid, $3::uuid, $4::int, $5::text, $6::jsonb)`, [
          tenantA,
          ownerAStaff,
          sWsvc.batchId,
          sWsvc.validationRevision,
          sWsvc.validatedManifestSha256,
          JSON.stringify([
            {
              entity: "patients",
              rowNo: 1,
              data: { fullName: "Pasien Sintetis Impor", birthDate: "1990-01-01", sex: "female", phone: "+6281234567890" },
            },
            {
              entity: "packages",
              rowNo: 1,
              data: {
                patientSourceKeyHash: wsvcPatHash,
                catalogCode: "FAC-01",
                catalogVersionId: fac2ActiveVerId,
                remainingSessions: 3,
                historicalUsedCount: 2,
                expiresOn: "2027-11-25",
              },
            },
          ]),
        ]);
      }),
    ).rejects.toThrow(/ERR_VERSION_CONFLICT/);

    // r6 P2 #2b: apply-time active catalog service recheck — if an active service is superseded between approve and apply,
    // applyApprovedImportBatch reaches the exact SQL catalog check and throws the package-specific refusal!
    const tmpSvcItemId = (
      await h.admin.query<{ id: string }>(
        `insert into public.catalog_items (tenant_id, code, kind, created_by)
         values ($1, 'FAC-TMP', 'service', $2) returning id`,
        [tenantA, ownerAStaff],
      )
    ).rows[0].id;
    const tmpSvcVerId = (
      await h.admin.query<{ id: string }>(
        `insert into public.catalog_versions (
           tenant_id, item_id, version, state, name, normal_price,
           tax_category, tax_basis, reason, created_by, created_as
         ) values (
           $1, $2, 1, 'active', 'Facial Sementara', 500000,
           'taxable_service', 'pmk', 'Layanan sementara test', $3, 'owner'
         ) returning id`,
        [tenantA, tmpSvcItemId, ownerAStaff],
      )
    ).rows[0].id;
    const tmpSvcBatch = makeSyntheticBatch({
      sourceSystem: "legacy_tmpsvc",
      cutoverDate: "2028-04-02",
      patSuffix: "TMPSVC",
      onlyPatientAndPkg: true,
      packageCatalogCode: "FAC-TMP",
    });
    const sTmpSvc = await withExecTx(execPool, (db) =>
      stageValidatedImportBatch(db, {
        tenantId: tenantA,
        actorStaffId: ownerAStaff,
        tenantHmacKey: hmacKey,
        dek,
        dekVersion: 1,
        branchIdByCode: branchMap,
        input: tmpSvcBatch.input,
        env: localEnv,
      }),
    );
    await withTenantContext(appPool, ownerCtx, (db) =>
      approveImportBatch(db, sTmpSvc.batchId, sTmpSvc.validationRevision, sTmpSvc.validatedManifestSha256, localEnv),
    );
    // Supersede FAC-TMP version=1 before apply so the apply-time catalog check itself rejects the package!
    await h.admin.query(
      `update public.catalog_versions set state = 'superseded' where tenant_id = $1 and id = $2`,
      [tenantA, tmpSvcVerId],
    );
    await expect(
      withExecTx(execPool, (db) =>
        applyApprovedImportBatch(db, {
          tenantId: tenantA,
          actorStaffId: ownerAStaff,
          batchId: sTmpSvc.batchId,
          validationRevision: sTmpSvc.validationRevision,
          manifestSha256: sTmpSvc.validatedManifestSha256,
          dek,
          env: localEnv,
        }),
      ),
    ).rejects.toThrow(/ERR_NOT_FOUND: active catalog service version not found for opening package/);

    // r7 P2 #3: approved staged digest binding mismatched (catalogCode: 'FAC-01', catalogVersionId: fac2ActiveVerId)
    // passes apply_digest and hits the exact SQL code-match predicate -> package-specific ERR_NOT_FOUND!
    const mismatchPatHash = "b".repeat(64);
    const mismatchPkgHash = "c".repeat(64);
    const mismatchCanon = "d".repeat(64);
    const mismatchPatData = {
      fullName: "Pasien Mismatch Katalog",
      birthDate: "1991-02-03",
      sex: "female",
      phone: "+6281200001111",
    };
    const mismatchPkgData = {
      patientSourceKeyHash: mismatchPatHash,
      catalogCode: "FAC-01",
      catalogVersionId: fac2ActiveVerId,
      remainingSessions: 2,
      historicalUsedCount: 0,
      expiresOn: "2029-04-01",
    };
    const mismatchPatDigest = computeApplyDigest({ entity: "patients", branchId: branchA1, amountIdr: "0", data: mismatchPatData });
    const mismatchPkgDigest = computeApplyDigest({ entity: "packages", branchId: branchA1, amountIdr: "1000000", data: mismatchPkgData });
    const sMismatch = await withExecTx(execPool, async (db) => {
      await bindResidencyContext(db, localEnv);
      const patEnc = encryptImportRowPayload(
        dek,
        { tenantId: tenantA, entity: "patients", rowNo: 1, sourceKeyHash: mismatchPatHash, applyDigest: mismatchPatDigest, dekVersion: 1 },
        { payload: mismatchPatData, applyData: mismatchPatData },
      );
      const pkgEnc = encryptImportRowPayload(
        dek,
        { tenantId: tenantA, entity: "packages", rowNo: 1, sourceKeyHash: mismatchPkgHash, applyDigest: mismatchPkgDigest, dekVersion: 1 },
        { payload: mismatchPkgData, applyData: mismatchPkgData },
      );
      return (
        await db.query<{ res: { batchId: string; validationRevision: number; validatedManifestSha256: string } }>(
          `SELECT public.import_stage($1::uuid, $2::uuid, 'legacy_catmismatch', '2028-04-03'::date, $3::jsonb) AS res`,
          [
            tenantA,
            ownerAStaff,
            JSON.stringify([
              {
                entity: "patients",
                rowNo: 1,
                sourceKeyHash: mismatchPatHash,
                canonicalPayloadSha256: mismatchCanon,
                applyDigest: mismatchPatDigest,
                branchId: branchA1,
                amountIdr: "0",
                payloadEnc: patEnc,
                dekVersion: 1,
              },
              {
                entity: "packages",
                rowNo: 1,
                sourceKeyHash: mismatchPkgHash,
                canonicalPayloadSha256: mismatchCanon,
                applyDigest: mismatchPkgDigest,
                branchId: branchA1,
                amountIdr: "1000000",
                payloadEnc: pkgEnc,
                dekVersion: 1,
              },
            ]),
          ],
        )
      ).rows[0].res;
    });
    await withTenantContext(appPool, ownerCtx, (db) =>
      approveImportBatch(db, sMismatch.batchId, sMismatch.validationRevision, sMismatch.validatedManifestSha256, localEnv),
    );
    await expect(
      withExecTx(execPool, async (db) => {
        await bindResidencyContext(db, localEnv);
        return db.query(`SELECT public.import_apply($1::uuid, $2::uuid, $3::uuid, $4::int, $5::text, $6::jsonb)`, [
          tenantA,
          ownerAStaff,
          sMismatch.batchId,
          sMismatch.validationRevision,
          sMismatch.validatedManifestSha256,
          JSON.stringify([
            { entity: "patients", rowNo: 1, data: mismatchPatData },
            { entity: "packages", rowNo: 1, data: mismatchPkgData },
          ]),
        ]);
      }),
    ).rejects.toThrow(/ERR_NOT_FOUND: active catalog service version not found for opening package/);

    // r7 P2 #1 & #2: forced row-level CHECK failure on public.patients (which WITHOUT EXCEPTION handler logs
    // "DETAIL: Failing row contains (... full_name ...)") + ordinary bind-parameter logging protection!
    const procCfg = (
      await h.admin.query<{ proconfig: string[] | null }>(
        `select proconfig from pg_proc where proname = 'import_apply' and pronamespace = 'public'::regnamespace`,
      )
    ).rows[0].proconfig;
    expect(procCfg).toContain("log_parameter_max_length_on_error=0");

    const markerName = "Pasien Rahasia MarkerZ99";
    const markerPhone = "+6281299998888";
    const markerNik = "3171010101909876";
    const forcedFailBatch = makeSyntheticBatch({
      sourceSystem: "legacy_forcefail",
      cutoverDate: "2028-05-15",
      patSuffix: "FFAIL",
      onlyPatientAndBalance: true,
      patientFullName: markerName,
      patientPhone: markerPhone,
      patientNik: markerNik,
    });
    const sFail = await withExecTx(execPool, (db) =>
      stageValidatedImportBatch(db, {
        tenantId: tenantA,
        actorStaffId: ownerAStaff,
        tenantHmacKey: hmacKey,
        dek,
        dekVersion: 1,
        branchIdByCode: branchMap,
        input: forcedFailBatch.input,
        env: localEnv,
      }),
    );
    await withTenantContext(appPool, ownerCtx, (db) =>
      approveImportBatch(db, sFail.batchId, sFail.validationRevision, sFail.validatedManifestSha256, localEnv),
    );

    // Helper to capture BOTH stdout and stderr from the EXACT unambiguous PostgreSQL container bound to h.ownerUrl()'s host port (r9 P2 #1 & #2)
    const pgPort = new URL(h.ownerUrl()).port || "5432";
    const resolveExactPgContainerId = (): string => {
      const psAll = spawnSync("docker", ["ps", "-q"], { encoding: "utf8" });
      expect(psAll.status).toBe(0);
      const allIds = (psAll.stdout ?? "")
        .trim()
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      expect(allIds.length).toBeGreaterThan(0);
      const inspected = spawnSync(
        "docker",
        ["inspect", "--format", "{{.Id}}\t{{json .NetworkSettings.Ports}}", ...allIds],
        { encoding: "utf8" },
      );
      expect(inspected.status).toBe(0);
      const matched = (inspected.stdout ?? "")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [id, portsJson] = line.split("\t");
          const ports = JSON.parse(portsJson || "{}") as Record<
            string,
            Array<{ HostIp?: string; HostPort?: string }> | null
          >;
          const hostBindings = Object.values(ports).flatMap((v) => v ?? []);
          return hostBindings.some((b) => b.HostPort === pgPort) ? id : null;
        })
        .filter((id): id is string => id !== null);
      expect(matched).toHaveLength(1);
      return matched[0];
    };
    const pgContainerId = resolveExactPgContainerId();
    const capturePgLogsForPid = (sinceIso: string, backendPid: number): string => {
      const logs = spawnSync("docker", ["logs", "--since", sinceIso, pgContainerId], { encoding: "utf8" });
      expect(logs.status).toBe(0);
      const combined = `${logs.stdout ?? ""}\n${logs.stderr ?? ""}`;
      expect(combined).toContain(`[${backendPid}]`);
      return combined;
    };

    // r7/r8 P2 #1: Force a real row-level CHECK violation on public.patients via a temporary CHECK constraint
    await h.admin.query(
      `alter table public.patients add constraint patients_r7_marker_check check (full_name <> '${markerName}')`,
    );
    const logStartIso = new Date(Date.now() - 1000).toISOString();
    const observedSql: string[] = [];
    let adapterErrDump = "";
    let errBackendPid = 0;
    try {
      await withExecTx(execPool, async (db) => {
        errBackendPid = (await db.query<{ pid: number }>(`select pg_backend_pid() as pid`)).rows[0].pid;
        const origQuery = db.query.bind(db);
        const wrappedDb = Object.create(db) as pg.ClientBase;
        wrappedDb.query = ((...args: unknown[]) => {
          if (typeof args[0] === "string") observedSql.push(args[0]);
          return (origQuery as (...a: unknown[]) => unknown)(...args);
        }) as pg.ClientBase["query"];
        try {
          await applyApprovedImportBatch(wrappedDb, {
            tenantId: tenantA,
            actorStaffId: ownerAStaff,
            batchId: sFail.batchId,
            validationRevision: sFail.validationRevision,
            manifestSha256: sFail.validatedManifestSha256,
            dek,
            env: localEnv,
          });
        } catch (e) {
          adapterErrDump =
            e instanceof Error
              ? JSON.stringify({
                  message: e.message,
                  ...Object.fromEntries(
                    Object.getOwnPropertyNames(e).map((k) => [k, (e as unknown as Record<string, unknown>)[k]]),
                  ),
                })
              : String(e);
          throw e;
        }
      }).catch(() => {});
    } finally {
      await h.admin.query(`alter table public.patients drop constraint if exists patients_r7_marker_check`);
    }

    const idxSet = observedSql.findIndex((q) => q.includes("SET LOCAL log_parameter_max_length_on_error = 0"));
    const idxApply = observedSql.findIndex((q) => q.includes("public.import_apply("));
    expect(idxSet).toBeGreaterThanOrEqual(0);
    expect(idxApply).toBeGreaterThan(idxSet);
    expect(errBackendPid).toBeGreaterThan(0);
    expect(adapterErrDump).toContain("ERR_INVALID_INPUT: patient write failed");
    for (const marker of [markerName, markerPhone, markerNik]) {
      expect(adapterErrDump).not.toContain(marker);
    }

    // Unconditionally assert real PostgreSQL logs for this EXACT backend PID (no optional skip!)
    const errPgLogs = capturePgLogsForPid(logStartIso, errBackendPid);
    expect(errPgLogs).toMatch(new RegExp(`\\[${errBackendPid}\\].*ERR_INVALID_INPUT: patient write failed`));
    for (const marker of [markerName, markerPhone, markerNik]) {
      expect(errPgLogs).not.toContain(marker);
    }

    // r7/r8 P2 #2: ordinary + sampled statement/duration logging mode — when log_min_duration_statement=0 OR
    // log_min_duration_sample=0 WITHOUT log_parameter_max_length=0, applyApprovedImportBatch refuses BEFORE
    // sending any patient bind parameters; when log_parameter_max_length=0 is set, it succeeds cleanly with a
    // verified duration log entry for that EXACT backend PID and zero patient markers!
    const bindLogStart = new Date(Date.now() - 1000).toISOString();
    await h.admin.query(`alter role "${execRoleName}" set log_min_duration_sample = 0`);
    const sampleUnsafePool = testPool({ connectionString: h.urlAs(execRoleName), max: 1 });
    try {
      await expect(
        withExecTx(sampleUnsafePool, (db) =>
          applyApprovedImportBatch(db, {
            tenantId: tenantA,
            actorStaffId: ownerAStaff,
            batchId: sFail.batchId,
            validationRevision: sFail.validationRevision,
            manifestSha256: sFail.validatedManifestSha256,
            dek,
            env: localEnv,
          }),
        ),
      ).rejects.toThrow(/ERR_FORBIDDEN: unsafe server parameter logging configuration/);
    } finally {
      await sampleUnsafePool.end();
      await h.admin.query(`alter role "${execRoleName}" reset log_min_duration_sample`);
    }

    await h.admin.query(`alter role "${execRoleName}" set log_min_duration_statement = 0`);
    const unsafeExecPool = testPool({ connectionString: h.urlAs(execRoleName), max: 1 });
    try {
      await expect(
        withExecTx(unsafeExecPool, (db) =>
          applyApprovedImportBatch(db, {
            tenantId: tenantA,
            actorStaffId: ownerAStaff,
            batchId: sFail.batchId,
            validationRevision: sFail.validationRevision,
            manifestSha256: sFail.validatedManifestSha256,
            dek,
            env: localEnv,
          }),
        ),
      ).rejects.toThrow(/ERR_FORBIDDEN: unsafe server parameter logging configuration/);
    } finally {
      await unsafeExecPool.end();
    }

    // Now configure log_parameter_max_length = 0 alongside log_min_duration_statement = 0 -> apply succeeds with ZERO patient markers logged!
    await h.admin.query(`alter role "${execRoleName}" set log_parameter_max_length = 0`);
    const safeExecPool = testPool({ connectionString: h.urlAs(execRoleName), max: 1 });
    let safeBackendPid = 0;
    try {
      const safeApplied = await withExecTx(safeExecPool, async (db) => {
        safeBackendPid = (await db.query<{ pid: number }>(`select pg_backend_pid() as pid`)).rows[0].pid;
        return applyApprovedImportBatch(db, {
          tenantId: tenantA,
          actorStaffId: ownerAStaff,
          batchId: sFail.batchId,
          validationRevision: sFail.validationRevision,
          manifestSha256: sFail.validatedManifestSha256,
          dek,
          env: localEnv,
        });
      });
      expect(safeApplied.state).toBe("applied");
    } finally {
      await safeExecPool.end();
      await h.admin.query(`alter role "${execRoleName}" reset log_min_duration_statement`);
      await h.admin.query(`alter role "${execRoleName}" reset log_parameter_max_length`);
    }

    expect(safeBackendPid).toBeGreaterThan(0);
    const bindPgLogs = capturePgLogsForPid(bindLogStart, safeBackendPid);
    expect(bindPgLogs).toMatch(new RegExp(`\\[${safeBackendPid}\\].*duration:.*import_apply`));
    for (const marker of [markerName, markerPhone, markerNik]) {
      expect(bindPgLogs).not.toContain(marker);
    }
  });
});
