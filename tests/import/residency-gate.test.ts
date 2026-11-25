// Real-DB verification of T-128 mandatory pre-staging residency gate wired directly to T-120 (0133_real_patient_gate.sql).
// Proves fail-closed behavior before any staging runs, without assuming unfinished SQL staging enforces the gate.
import { createHash } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import {
  assertImportStagingGate,
  ImportResidencyBlockedError,
  ImportSyntheticOnlyError,
  prepareImportDryRun,
  type ImportBatchInput,
} from "../../src/modules/import";
import { assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import {
  attestResidency,
  envKey,
  setPlatformEnvironment,
  TENANT_OBLIGATIONS,
  type StorageKind,
} from "../../src/modules/platform/residency";
import { setResidencyOpinion, updateProfile, type StorageLocation } from "../../src/modules/vendor/profile/profile";
import { createHarness, testPool } from "../rls/harness";

const KINDS: StorageKind[] = ["database", "object_storage", "backups", "logs", "error_tracking"];
const RELEASE_DIGEST = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const OPINION_BUF = Buffer.alloc(1500, "p");
const OPINION_SHA = createHash("sha256").update(OPINION_BUF).digest("hex");
const HMAC_KEY = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");

function makeProdEnv(overrides: Record<string, string | undefined> = {}): Record<string, string> {
  const e: Record<string, string> = {
    DEPLOY_ENV: "production",
    APP_RELEASE_DIGEST: RELEASE_DIGEST,
  };
  for (const k of KINDS) {
    e[envKey(k, "provider")] = "Vultr";
    e[envKey(k, "region")] = "sgp";
    e[envKey(k, "country")] = "SG";
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete e[k];
    else e[k] = v;
  }
  return e;
}

function declaredFrom(env: Record<string, string>): StorageLocation[] {
  return KINDS.map((kind) => ({
    kind,
    provider: env[envKey(kind, "provider")],
    region: env[envKey(kind, "region")],
    country: env[envKey(kind, "country")],
  }));
}

function makeBatchInput(overrides: Partial<ImportBatchInput> = {}): ImportBatchInput {
  return {
    sourceSystem: "numa-legacy",
    cutoverDate: "2026-01-31",
    tenantHmacKey: HMAC_KEY,
    knownBranchCodes: new Set(["JKT"]),
    knownServiceCodes: new Set(["FAC-01"]),
    patients: [
      {
        externalId: "PAT-001",
        fullName: "Pasien Sintetis Gate",
        birthDate: "1990-01-01",
        sex: "female",
        nik: "3174010101900001",
        phone: "+6281234567890",
        branchCode: "JKT",
      },
    ],
    packages: [
      {
        externalId: "PKG-001",
        patientExternalId: "PAT-001",
        branchCode: "JKT",
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
      { externalId: "BAL-001", patientExternalId: "PAT-001", branchCode: "JKT", amountIdr: "350000" },
    ],
    receivables: [
      { externalId: "AR-001", patientExternalId: "PAT-001", branchCode: "JKT", amountIdr: "200000", dueOn: "2026-02-28" },
    ],
    bookingDps: [
      { externalId: "DP-001", patientExternalId: "PAT-001", branchCode: "JKT", amountIdr: "150000" },
    ],
    ...overrides,
  };
}

describe("T-128 mandatory pre-staging residency gate (real PostgreSQL + 0133_real_patient_gate)", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  let appPool: pg.Pool;
  let ownerPool: pg.Pool;
  let tenantId: string;
  let ownerAcc: string;
  let ownerStaff: string;
  let financeAcc: string;
  let platformOwnerAcc: string;

  async function setVendorEvidence(
    key: string,
    opts: { state?: string; sha256?: string | null } = {},
  ) {
    const cfgVer = (
      await h.admin.query<{ v: string | null }>(
        `select compliance_config_version(null, (select config_kind from compliance_obligations where key = $1)) as v`,
        [key],
      )
    ).rows[0].v;
    await h.admin.query(
      `insert into vendor_evidence_items (obligation_key, state, valid_until, config_version, file_sha256, decided_by, updated_at)
       values ($1, $2, null, $3, $4, 'Pemilik Platform', now())
       on conflict (obligation_key) do update set state = excluded.state, config_version = excluded.config_version,
         file_sha256 = excluded.file_sha256, updated_at = now()`,
      [key, opts.state ?? "approved", cfgVer, opts.sha256 ?? null],
    );
  }

  async function setTenantObligation(key: string, state: "approved" | "revoked") {
    const existing = (
      await h.admin.query<{ id: string }>(
        `select id from evidence_items where tenant_id = $1 and obligation_key = $2`,
        [tenantId, key],
      )
    ).rows[0];
    let itemId = existing?.id;
    if (!itemId) {
      itemId = (
        await h.admin.query<{ id: string }>(
          `insert into evidence_items (tenant_id, obligation_key, state, valid_until) values ($1, $2, $3, null) returning id`,
          [tenantId, key, state],
        )
      ).rows[0].id;
      const fid = (
        await h.admin.query<{ id: string }>(
          `insert into evidence_files (tenant_id, item_id, version, file_name, media_type, size_bytes, sha256, content, expert_name, document_date, uploaded_by, uploaded_as, uploaded_name)
           values ($1, $2, 1, 'bukti.pdf', 'application/pdf', $3, $4, $5, 'Konsultan Sintetis', '2026-11-01', $6, 'owner', 'Owner') returning id`,
          [tenantId, itemId, OPINION_BUF.length, OPINION_SHA, OPINION_BUF, ownerStaff],
        )
      ).rows[0].id;
      await h.admin.query(
        `insert into evidence_approvals (tenant_id, item_id, file_id, decision, reason, decided_by, decided_as, decided_name)
         values ($1, $2, $3, $4, 'Sintetis', $5, 'owner', 'Owner')`,
        [tenantId, itemId, fid, state, ownerStaff],
      );
    } else {
      await h.admin.query(`update evidence_items set state = $3 where tenant_id = $1 and id = $2`, [
        tenantId,
        itemId,
        state,
      ]);
      const fid = (
        await h.admin.query<{ id: string }>(
          `select id from evidence_files where item_id = $1 order by version desc limit 1`,
          [itemId],
        )
      ).rows[0].id;
      await h.admin.query(
        `insert into evidence_approvals (tenant_id, item_id, file_id, decision, reason, decided_by, decided_as, decided_name)
         values ($1, $2, $3, $4, 'Pembaruan sintetis', $5, 'owner', 'Owner')`,
        [tenantId, itemId, fid, state, ownerStaff],
      );
    }
  }

  beforeAll(async () => {
    h = await createHarness();
    const appUrl = h.urlAs(await h.createLoginRole("NOSUPERUSER NOBYPASSRLS", [APP_GROUP_ROLE]));
    appPool = await openAppPool({ connectionString: appUrl, max: 4 }, APP_GROUP_ROLE);
    ownerPool = testPool({ connectionString: h.ownerUrl(), max: 2 });

    tenantId = (
      await h.admin.query<{ id: string }>(
        `insert into tenants_registry (lifecycle_state) values ('live') returning id`,
      )
    ).rows[0].id;
    await h.admin.query(
      `insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Klinik Impor Gate', 'emkm')`,
      [tenantId],
    );
    await h.admin.query(
      `insert into branches (tenant_id, code, name, timezone) values ($1, 'JKT', 'Cabang Jakarta', 'Asia/Jakarta')`,
      [tenantId],
    );

    const makeAcc = async (email: string, name: string) =>
      (
        await h.admin.query<{ id: string }>(
          `insert into auth_user (email, name, email_verified, two_factor_enabled)
           values ($1, $2, true, true) returning id`,
          [email, name],
        )
      ).rows[0].id;

    ownerAcc = await makeAcc("owner.gate@t128.test", "Owner Impor");
    financeAcc = await makeAcc("finance.gate@t128.test", "Finance Impor");
    platformOwnerAcc = await makeAcc("platform.gate@t128.test", "Pemilik Platform");

    ownerStaff = (
      await createMembership(ownerPool, { tenantId, accountId: ownerAcc, displayName: "Owner Impor" })
    ).staffId;
    await assignRole(h.admin, { tenantId, staffId: ownerStaff, role: "owner" });

    const finStaff = (
      await createMembership(ownerPool, { tenantId, accountId: financeAcc, displayName: "Finance Impor" })
    ).staffId;
    await assignRole(h.admin, { tenantId, staffId: finStaff, role: "finance" });
  }, 120_000);

  afterAll(async () => {
    await appPool?.end();
    await ownerPool?.end();
    await h?.close();
  });

  it("blocks production (and unset DEPLOY_ENV) before staging when residency/DPA gate is closed, even if synthetic=true", async () => {
    const ownerCtx = await resolveContext(appPool, ownerAcc, { tenantId, actingRole: "owner" });
    const prodEnv = makeProdEnv();

    // Closed gate in production -> ImportResidencyBlockedError
    await expect(
      withTenantContext(appPool, ownerCtx, (db) =>
        prepareImportDryRun(db, { synthetic: true, env: prodEnv, input: makeBatchInput() }),
      ),
    ).rejects.toBeInstanceOf(ImportResidencyBlockedError);

    // Unset DEPLOY_ENV fails closed as production
    await expect(
      withTenantContext(appPool, ownerCtx, (db) =>
        assertImportStagingGate(db, { synthetic: true, env: {} }),
      ),
    ).rejects.toBeInstanceOf(ImportResidencyBlockedError);

    // Non-owner/non-AP role (finance) is refused by 0133 real_patient_gate_status()
    const finCtx = await resolveContext(appPool, financeAcc, { tenantId, actingRole: "finance" });
    await expect(
      withTenantContext(appPool, finCtx, (db) =>
        assertImportStagingGate(db, { synthetic: true, env: { DEPLOY_ENV: "local" } }),
      ),
    ).rejects.toThrow(/ERR_FORBIDDEN/);
  });

  it("enforces MIG-2 synthetic-only guard in staging/local while still reporting live residency blockers honestly", async () => {
    const ownerCtx = await resolveContext(appPool, ownerAcc, { tenantId, actingRole: "owner" });

    // Real data (synthetic: false) refused in staging/local
    await expect(
      withTenantContext(appPool, ownerCtx, (db) =>
        assertImportStagingGate(db, { synthetic: false, env: { DEPLOY_ENV: "staging" } }),
      ),
    ).rejects.toBeInstanceOf(ImportSyntheticOnlyError);

    // Synthetic dry-run allowed in local, but honestly surfaces open residency blockers
    const res = await withTenantContext(appPool, ownerCtx, (db) =>
      prepareImportDryRun(db, {
        synthetic: true,
        env: { DEPLOY_ENV: "local" },
        input: makeBatchInput(),
      }),
    );
    expect(res.ok).toBe(true);
    expect(res.gate.deployEnv).toBe("local");
    expect(res.gate.residencyBlockers.length).toBeGreaterThan(0);
  });

  it("admits production dry-run + source-ID conflict check once all 0133 gates are open, and re-blocks immediately upon obligation revocation", async () => {
    const prodEnv = makeProdEnv();
    await setPlatformEnvironment(h.admin, "production");
    await updateProfile(
      h.admin,
      { accountId: platformOwnerAcc, vendorRole: "platform_owner" },
      {
        legal_name: "PT Platform Klinik Sintetis",
        nib: "1234567890123",
        pse_number: "PSE-2026-0001",
        npwp: "012345678901234",
        meta_business_id: "1234567890",
        website: "https://platform.klinik-sintetis.test",
        privacy_url: "https://platform.klinik-sintetis.test/privasi",
        support_email: "dukungan@klinik-sintetis.test",
        support_phone: "+6281234567890",
        storageLocations: declaredFrom(prodEnv),
      },
      "Profil vendor sintetis lengkap",
    );
    await setResidencyOpinion(
      h.admin,
      { accountId: platformOwnerAcc, vendorRole: "platform_owner" },
      { ref: "OP-2026-T128", date: "2026-11-01", outcome: "positive", file: OPINION_BUF },
      "Pendapat hukum residensi sintetis",
    );
    await attestResidency(h.admin, prodEnv);
    await setVendorEvidence("vendor_residency_opinion", { state: "approved", sha256: OPINION_SHA });
    await setVendorEvidence("vendor_processor_agreement_template", { state: "approved" });
    for (const ob of TENANT_OBLIGATIONS) {
      await setTenantObligation(ob, "approved");
    }

    const ownerCtx = await resolveContext(appPool, ownerAcc, { tenantId, actingRole: "owner" });
    const first = await withTenantContext(appPool, ownerCtx, (db) =>
      prepareImportDryRun(db, { synthetic: true, env: prodEnv, input: makeBatchInput() }),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.gate.residencyBlockers).toEqual([]);
    expect(first.sourcePlan.counts.new).toBe(5);

    // Same external ID with modified balance triggers ERR_SOURCE_CONFLICT even when gate is open
    const existingMaps = first.validation.rows.map((r, i) => ({
      entity: r.entity,
      sourceKeyHash: r.sourceKeyHash,
      canonicalPayloadSha256: r.canonicalPayloadSha256,
      localId: `019a0000-0000-7000-8000-00000000000${i + 1}`,
      state: "active" as const,
    }));
    const conflict = await withTenantContext(appPool, ownerCtx, (db) =>
      prepareImportDryRun(db, {
        synthetic: true,
        env: prodEnv,
        input: makeBatchInput({
          balances: [
            { externalId: "BAL-001", patientExternalId: "PAT-001", branchCode: "JKT", amountIdr: "777000" },
          ],
        }),
        existingMaps,
      }),
    );
    expect(conflict.ok).toBe(false);
    if (!conflict.ok && conflict.stage === "source_conflict") {
      expect(conflict.sourcePlan.conflicts[0]).toMatchObject({
        kind: "conflict",
        code: "ERR_SOURCE_CONFLICT",
        entity: "balances",
      });
    }

    // Revoking processor_agreement_signed immediately re-blocks production staging gate
    await setTenantObligation("processor_agreement_signed", "revoked");
    try {
      await withTenantContext(appPool, ownerCtx, (db) =>
        prepareImportDryRun(db, { synthetic: true, env: prodEnv, input: makeBatchInput() }),
      );
      expect.unreachable("expected ImportResidencyBlockedError after revocation");
    } catch (e) {
      expect(e).toBeInstanceOf(ImportResidencyBlockedError);
      expect((e as ImportResidencyBlockedError).blockers).toContain("obligation:processor_agreement_signed");
    }
  });
});
