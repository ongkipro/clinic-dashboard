// T-120 (PR-36, ARCH-9, ARCH-10, PRIV-5, MIG-2; R4) — Residency configuration, deploy-time
// attestation, dual-marker environment boundary, HYG-024 inconclusive opinion fold-in, and the
// real-patient gate across patient registration, online booking, and online hold confirmation.
// Covers every revised plan requirement and all 8 findings of t120/PLAN-REVIEW-codex-panel3.md.
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, OPERATOR_GROUP_ROLE, VENDOR_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { type KekRing } from "../../src/lib/keys/envelope";
import { setKekRingForTests } from "../../src/lib/keys/runtime";
import { decideApproval } from "../../src/modules/approvals/approvals";
import { publish } from "../../src/modules/catalog/catalog";
import { setHours, setServices, upsertRoom } from "../../src/modules/org/branches/branches";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { registerPatient, sealIdentity, type RegistrationFields } from "../../src/modules/patients/patients";
import {
  attestResidency,
  blockerCode,
  blockerText,
  deployedLocations,
  effectiveResidencyConfig,
  envKey,
  envOf,
  evaluateGate,
  matchDeclared,
  realPatientGateStatus,
  refusalText,
  releaseDigest,
  setPlatformEnvironment,
  TENANT_OBLIGATIONS,
  VENDOR_OBLIGATIONS,
  type GateInput,
  type Location,
  type Obligation,
  type StorageKind,
} from "../../src/modules/platform/residency";
import { book, confirm } from "../../src/modules/scheduling/booking/booking";
import { setWeek } from "../../src/modules/scheduling/rosters/rosters";
import { changeSetting } from "../../src/modules/settings/settings";
import { receiveDeposit } from "../../src/modules/cashier/deposits/deposits";
import { setResidencyOpinion, updateProfile } from "../../src/modules/vendor/profile/profile";
import { blockerLabel } from "../../src/modules/vendor/checklist/labels";
import { bootstrapVendor, createVendorStaff } from "../../src/modules/vendor/staff/staff";
import { openSession, withSupportSession } from "../../src/modules/vendor/support/support";
import { createHarness, type Harness, testClient, testPool } from "../rls/harness";

const KINDS: StorageKind[] = ["database", "object_storage", "backups", "logs", "error_tracking"];
const RELEASE_A = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const RELEASE_B = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";

const mkEnv = (
  country: Partial<Record<StorageKind, string>> = {},
  over: Record<string, string | undefined> = {},
): Record<string, string | undefined> => {
  const e: Record<string, string | undefined> = { DEPLOY_ENV: "production", APP_RELEASE_DIGEST: RELEASE_A };
  for (const k of KINDS) {
    e[envKey(k, "provider")] = "vultr";
    e[envKey(k, "region")] = k === "backups" ? "sgp-2" : "sgp";
    e[envKey(k, "country")] = country[k] ?? "SG";
  }
  return { ...e, ...over };
};

const declaredFrom = (e: Record<string, string | undefined>): Location[] =>
  KINDS.map((k) => ({ kind: k, provider: e[envKey(k, "provider")]!, region: e[envKey(k, "region")]!, country: e[envKey(k, "country")]! }));

const ALL: Obligation[] = [...VENDOR_OBLIGATIONS, ...TENANT_OBLIGATIONS];
const gateInput = (o: Partial<GateInput> & { e?: Record<string, string | undefined> } = {}): GateInput => {
  const e = o.e ?? mkEnv();
  return {
    env: "production",
    dbEnv: "production",
    deployed: deployedLocations(e),
    declared: declaredFrom(e),
    opinion: { outcome: "positive", evidenceApproved: true, checksumMatches: true },
    approved: new Set(ALL),
    attested: true,
    ...o,
  };
};

// ── 1. Pure specification & ARCH-9 tests ─────────────────────────────────────────────────────
describe("deployed locations come from configuration only (ARCH-9)", () => {
  it("reads every kind and release digest from env", () => {
    const cfg = effectiveResidencyConfig(mkEnv());
    expect(cfg.issues).toEqual([]);
    expect(cfg.locations.map((l) => l.kind)).toEqual(KINDS);
    expect(cfg.releaseDigest).toBe(RELEASE_A);
    expect(cfg.releaseDigestValid).toBe(true);
    expect(releaseDigest({ APP_RELEASE_DIGEST: "bad" })).toBeNull();
  });

  it("a missing or malformed variable is an issue, never a default", () => {
    const d = deployedLocations(mkEnv({}, { [envKey("backups", "country")]: undefined, [envKey("logs", "country")]: "Indonesia", [envKey("database", "region")]: "x" }));
    expect(d.issues).toEqual([
      { kind: "database", field: "region", problem: "invalid" },
      { kind: "backups", field: "country", problem: "missing" },
      { kind: "logs", field: "country", problem: "invalid" },
    ]);
    expect(deployedLocations({}).issues).toHaveLength(15);
  });

  it("no region, provider or country is hard-coded in residency module (ARCH-9)", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["config.ts", "gate.ts"]) {
      const src = readFileSync(`src/modules/platform/residency/${f}`, "utf8")
        .split("\n")
        .filter((l) => !l.trim().startsWith("//"))
        .join("\n");
      expect(src, f).not.toMatch(/vultr|sgp|singapore|"SG"|ap-southeast|jakarta-1/i);
    }
  });
});

describe("Scenario PR-36 pure evaluator", () => {
  it("matches declared vs deployed and reports mismatches, unattested, checksum mismatch, and inconclusive", () => {
    const e = mkEnv();
    expect(matchDeclared(deployedLocations(e).locations, declaredFrom(e))).toEqual([]);
    expect(evaluateGate(gateInput({ e }))).toEqual({ open: true, blockers: [] });
    expect(evaluateGate(gateInput({ e, attested: false })).blockers).toEqual([{ code: "unattested" }]);
    expect(evaluateGate(gateInput({ e, opinion: { outcome: "inconclusive", evidenceApproved: true } })).blockers[0]).toMatchObject({ code: "opinion_inconclusive" });
    expect(evaluateGate(gateInput({ e, opinion: { outcome: "positive", evidenceApproved: true, checksumMatches: false } })).blockers[0]).toMatchObject({ code: "opinion_unapproved" });
    expect(evaluateGate(gateInput({ env: "local", dbEnv: "production", approved: new Set() })).open).toBe(false);
    expect(evaluateGate(gateInput({ env: "local", dbEnv: "local", approved: new Set() })).open).toBe(true);
    expect(envOf(undefined)).toBe("production");
    expect(blockerLabel("vendor:residency_opinion_inconclusive")).toContain("tidak tegas");
    expect(refusalText("patient", evaluateGate(gateInput({ e, attested: false })))).toContain("belum terverifikasi");
    expect(blockerCode({ code: "unattested" })).toBe("residency:unattested");
    expect(blockerText({ code: "opinion_inconclusive", outside: ["backups"] })).toContain("tidak tegas");
  });
});

// ── 2. PostgreSQL integration tests (Findings #1–#8 + PR-36 scenarios) ───────────────────────
describe("T-120 PostgreSQL real_patient_gate, residency_attest, dual env marker & locks", () => {
  let h: Harness;
  let app: pg.Pool;
  let owner: pg.Pool;
  let consoleDb: pg.Pool;
  let opDb: pg.Pool;
  let vendorClient: pg.Client;
  let operatorClient: pg.Client;
  let platformOwnerAcc: string;
  let vendorFinanceAcc: string;
  let supportAcc: string;
  let supportTok: string;
  let n = 0;
  const VENDOR_IP = "203.0.113.10";

  const RING: KekRing = { current: 1, keys: new Map([[1, randomBytes(32)]]) };
  const OPINION_A = Buffer.alloc(2048, "A");
  const OPINION_B = Buffer.alloc(2048, "B");
  const OPINION_A_SHA = createHash("sha256").update(OPINION_A).digest("hex");
  const OPINION_B_SHA = createHash("sha256").update(OPINION_B).digest("hex");

  const localDay = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(Date.now() + days * 86_400_000));
  const monday = (d: string) => {
    const x = new Date(`${d}T12:00:00Z`);
    x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
    return x.toISOString().slice(0, 10);
  };

  type T = { tenantId: string; branchId: string; ownerStaff: string; foStaff: string; foAcc: string; ownerAcc: string; doctorStaff: string; serviceVersionId: string };
  let A: T;
  let B: T;

  async function setupTenant(codePrefix: string): Promise<T> {
    const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
    await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, `PT ${codePrefix} Sintetis`]);
    const branchId = (await h.admin.query(
      `insert into branches (tenant_id, code, name, timezone) values ($1, $2, $3, 'Asia/Jakarta') returning id`,
      [tenantId, `${codePrefix}1`, `Cabang ${codePrefix}`],
    )).rows[0].id as string;

    const addStaff = async (role: Role, bindBranch = false) => {
      const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ($1, $2, true) returning id`, [`U${++n}`, `t120_${n}@sintetis.test`])).rows[0].id as string;
      const { staffId } = await createMembership(owner, { tenantId, accountId: acc, displayName: `Staf ${n}` });
      const rid = await assignRole(h.admin, { tenantId, staffId, role });
      if (bindBranch) await assignBranch(h.admin, { tenantId, staffRoleId: rid, branchId });
      return { acc, staffId };
    };
    const ow = await addStaff("owner");
    const fh = await addStaff("facility_head", true);
    const fo = await addStaff("fo_cashier", true);
    const doc = await addStaff("doctor", true);

    const asOwner = async <R>(fn: (db: pg.PoolClient) => Promise<R>) =>
      withTenantContext(app, await resolveContext(app, ow.acc, { tenantId, actingRole: "owner" }), fn);
    const asFh = async <R>(fn: (db: pg.PoolClient) => Promise<R>) =>
      withTenantContext(app, await resolveContext(app, fh.acc, { tenantId, actingRole: "facility_head", activeBranchId: branchId }), fn);

    // Active online-bookable service with DP enabled + branch hours/room/roster via real writers.
    const pub = await asOwner((db) =>
      publish(db, { kind: "service", code: `SRV-${codePrefix}` }, {
        name: "Konsultasi Online",
        tax_category: "exempt_medical",
        tax_basis: "Jasa medis",
        normal_price: 200_000,
        category: "consultation",
        prep_min: 0,
        treatment_min: 30,
        buffer_min: 0,
        online_bookable: true,
        booking_dp_enabled: true,
        booking_dp_amount: 50_000,
        indications: "Indikasi sintetis",
        contraindications: "Kontra sintetis",
        consent_template: "Templat sintetis",
        delegation: "Dokter",
        aftercare_text: "Perawatan sintetis",
        resources: [{ kind: "room", code: "consultation" }],
        eligibility: [{ role: "doctor", mode: "performs" }],
      }, "Layanan uji T-120"),
    );
    if (pub.approvalId) await asFh((db) => decideApproval(db, pub.approvalId!, true));

    await asOwner((db) => setHours(db, branchId, [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "07:00", closes: "22:00" }))));
    await asOwner((db) => upsertRoom(db, branchId, { name: "Ruang Konsul 1", kind: "consultation" }));
    await asOwner((db) => setServices(db, branchId, [pub.itemId]));
    for (const week of [...new Set([1, 7, 14].map((d) => monday(localDay(d))))]) {
      const days = [0, 1, 2, 3, 4, 5, 6]
        .map((i) => {
          const x = new Date(`${week}T12:00:00Z`);
          x.setUTCDate(x.getUTCDate() + i);
          return x.toISOString().slice(0, 10);
        })
        .filter((d) => d >= localDay(0));
      if (days.length) {
        await asOwner((db) =>
          setWeek(db, branchId, week, [doc.staffId], days.map((d) => ({ staffId: doc.staffId, date: d, starts: "08:00", ends: "21:00", kind: "work" as const }))),
        );
      }
    }
    await asOwner((db) => changeSetting(db, { key: "SET-10", branchId: null, value: { dp_booking: true, batas_ubah: 24 }, reason: "Aktifkan DP uji T-120" }));

    return { tenantId, branchId, ownerStaff: ow.staffId, foStaff: fo.staffId, foAcc: fo.acc, ownerAcc: ow.acc, doctorStaff: doc.staffId, serviceVersionId: pub.versionId };
  }

  async function approveVendorProfileAllReal(locs: Location[], outcome: "positive" | "negative" | "inconclusive" | null, file: Buffer = OPINION_A) {
    await updateProfile(h.admin, { accountId: platformOwnerAcc, vendorRole: "platform_owner" }, {
      legal_name: "PT Klinikmu Platform Sintetis",
      nib: "1234567890123",
      pse_number: "PSE-2026-0001",
      npwp: "1234567890123456",
      meta_business_id: "1234567890",
      website: "https://klinikmu-sintetis.test",
      privacy_url: "https://klinikmu-sintetis.test/privasi",
      support_email: "dukungan@klinikmu-sintetis.test",
      support_phone: "+6281234567890",
      storageLocations: locs,
    }, "Isi profil vendor sintetis lengkap");
    if (outcome !== null) {
      await setResidencyOpinion(
        h.admin,
        { accountId: platformOwnerAcc, vendorRole: "platform_owner" },
        { ref: "OP-2026-01", date: "2026-11-01", outcome, file },
        "Catat pendapat hukum residensi",
      );
    } else {
      await h.admin.query(
        `update vendor_profile set residency_opinion_outcome = null, residency_opinion_ref = null, residency_opinion_date = null,
                residency_opinion_set_by = null, residency_opinion_checksum = null where id = 1`,
      );
    }
  }

  async function setVendorEvidence(key: string, opts: { state?: string; validUntil?: string | null; configVersion?: string | null; sha256?: string | null } = {}) {
    const cfgVer = opts.configVersion !== undefined
      ? opts.configVersion
      : (await h.admin.query<{ v: string | null }>(`select compliance_config_version(null, (select config_kind from compliance_obligations where key = $1)) as v`, [key])).rows[0].v;
    await h.admin.query(
      `insert into vendor_evidence_items (obligation_key, state, valid_until, config_version, file_sha256, decided_by, updated_at)
       values ($1, $2, $3, $4, $5, 'Pemilik Platform', now())
       on conflict (obligation_key) do update set state = excluded.state, valid_until = excluded.valid_until,
         config_version = excluded.config_version, file_sha256 = excluded.file_sha256, updated_at = now()`,
      [key, opts.state ?? "approved", opts.validUntil ?? null, cfgVer, opts.sha256 ?? null],
    );
  }

  async function setTenantObligation(t: T, key: string, opts: { state?: string; validUntil?: string | null } = {}) {
    const existing = (await h.admin.query<{ id: string }>(`select id from evidence_items where tenant_id = $1 and obligation_key = $2`, [t.tenantId, key])).rows[0];
    let itemId = existing?.id;
    if (!itemId) {
      itemId = (await h.admin.query<{ id: string }>(
        `insert into evidence_items (tenant_id, obligation_key, state, valid_until) values ($1, $2, $3, $4) returning id`,
        [t.tenantId, key, opts.state ?? "approved", opts.validUntil ?? null],
      )).rows[0].id;
      const fid = (await h.admin.query<{ id: string }>(
        `insert into evidence_files (tenant_id, item_id, version, file_name, media_type, size_bytes, sha256, content, expert_name, document_date, uploaded_by, uploaded_as, uploaded_name)
         values ($1, $2, 1, 'bukti.pdf', 'application/pdf', $3, $4, $5, 'Konsultan Sintetis', '2026-11-01', $6, 'owner', 'Owner') returning id`,
        [t.tenantId, itemId, OPINION_A.length, OPINION_A_SHA, OPINION_A, t.ownerStaff],
      )).rows[0].id;
      await h.admin.query(
        `insert into evidence_approvals (tenant_id, item_id, file_id, decision, reason, decided_by, decided_as, decided_name)
         values ($1, $2, $3, $4, 'Disetujui sintetis', $5, 'owner', 'Owner')`,
        [t.tenantId, itemId, fid, opts.state === "revoked" ? "revoked" : "approved", t.ownerStaff],
      );
    } else {
      await h.admin.query(`update evidence_items set state = $3, valid_until = $4 where tenant_id = $1 and id = $2`, [t.tenantId, itemId, opts.state ?? "approved", opts.validUntil ?? null]);
      const fid = (await h.admin.query<{ id: string }>(`select id from evidence_files where item_id = $1 order by version desc limit 1`, [itemId])).rows[0].id;
      await h.admin.query(
        `insert into evidence_approvals (tenant_id, item_id, file_id, decision, reason, decided_by, decided_as, decided_name)
         values ($1, $2, $3, $4, 'Pembaruan sintetis', $5, 'owner', 'Owner')`,
        [t.tenantId, itemId, fid, opts.state === "revoked" ? "revoked" : "approved", t.ownerStaff],
      );
    }
  }

  async function openGateFullyFor(t: T, e = mkEnv()) {
    await setPlatformEnvironment(h.admin, "production");
    await approveVendorProfileAllReal(declaredFrom(e), "positive", OPINION_A);
    await attestResidency(h.admin, e);
    await setVendorEvidence("vendor_residency_opinion", { state: "approved", sha256: OPINION_A_SHA });
    await setVendorEvidence("vendor_processor_agreement_template", { state: "approved" });
    for (const ob of TENANT_OBLIGATIONS) await setTenantObligation(t, ob, { state: "approved" });
  }

  const ENV_KEYS = [
    "DEPLOY_ENV",
    "APP_RELEASE_DIGEST",
    ...KINDS.flatMap((k) => [envKey(k, "provider"), envKey(k, "region"), envKey(k, "country")]),
  ];
  const withEnv = async <R>(e: Record<string, string | undefined>, fn: () => Promise<R>): Promise<R> => {
    const prev: Record<string, string | undefined> = {};
    for (const k of ENV_KEYS) {
      prev[k] = process.env[k];
      if (e[k] === undefined) delete process.env[k];
      else process.env[k] = e[k];
    }
    try { return await fn(); } finally {
      for (const k of ENV_KEYS) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
    }
  };

  async function tryRegister(t: T, suffix: string, e: Record<string, string | undefined>) {
    const fields: RegistrationFields = {
      full_name: `Pasien ${suffix}`, birth_date: "1992-04-10", sex: "female", phone: `08129990${suffix.padStart(4, "0")}`,
      identity_type: "nik", religion: "islam", occupation: "Karyawan", education: "s1", marital_status: "kawin",
    };
    return withEnv(e, async () =>
      withTenantContext(app, await resolveContext(app, t.foAcc, { tenantId: t.tenantId, actingRole: "fo_cashier", activeBranchId: t.branchId }), async (db) => {
        const sealed = await sealIdentity(db, t.tenantId, "nik", `317101234567${suffix.padStart(4, "0")}`);
        return registerPatient(db, fields, sealed, "new");
      }),
    );
  }

  const futureSlot = (daysAhead: number, hourWib = 10) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + daysAhead);
    d.setUTCHours(hourWib - 7, 0, 0, 0);
    return d;
  };

  beforeAll(async () => {
    h = await createHarness({ platformEnv: "production" });
    setKekRingForTests(RING);
    app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
    owner = testPool({ connectionString: h.ownerUrl(), max: 3 });
    consoleDb = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [VENDOR_GROUP_ROLE])), max: 3 }, VENDOR_GROUP_ROLE);
    opDb = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [OPERATOR_GROUP_ROLE])), max: 3 }, OPERATOR_GROUP_ROLE);
    vendorClient = await h.connectAs(await h.createLoginRole("", [VENDOR_GROUP_ROLE]));
    operatorClient = await h.connectAs(await h.createLoginRole("", [OPERATOR_GROUP_ROLE]));

    // Seed active TOTP-enrolled platform_owner + vendor_finance + support staff via real bootstrap/staff writers.
    platformOwnerAcc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('PO', 'po@vendor-sintetis.test', true) returning id`)).rows[0].id as string;
    vendorFinanceAcc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('VF', 'vf@vendor-sintetis.test', true) returning id`)).rows[0].id as string;
    supportAcc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('SUP', 'sup@vendor-sintetis.test', true) returning id`)).rows[0].id as string;
    const c = await owner.connect();
    try {
      await bootstrapVendor(c, platformOwnerAcc, "Pemilik Platform", "203.0.113.0/24", "Kantor vendor");
      await createVendorStaff(c, { accountId: platformOwnerAcc, ip: VENDOR_IP, mfaAt: new Date() }, vendorFinanceAcc, "Keuangan Vendor", ["vendor_finance"]);
      await createVendorStaff(c, { accountId: platformOwnerAcc, ip: VENDOR_IP, mfaAt: new Date() }, supportAcc, "Dukungan Vendor", ["support"]);
    } finally {
      c.release();
    }
    supportTok = `tok_sup_${randomBytes(12).toString("hex")}`;
    await h.admin.query(
      `insert into auth_session (user_id, token, expires_at, surface, second_factor_at) values ($1, $2, now() + interval '8 hours', 'vendor', now())`,
      [supportAcc, supportTok],
    );

    A = await setupTenant("TA");
    B = await setupTenant("TB");
  }, 120_000);

  afterAll(async () => {
    setKekRingForTests(undefined);
    await vendorClient?.end();
    await operatorClient?.end();
    await opDb?.end();
    await consoleDb?.end();
    await owner?.end();
    await app?.end();
    await h?.close();
  });

  it("Finding #1: binds attestation to release_digest, runtime RESIDENCY_* locations digest, deploy_env; deploy-only execute", async () => {
    const e = mkEnv();
    await openGateFullyFor(A, e);

    // Passing case with matching release digest and matching runtime locations digest succeeds
    const cfg = effectiveResidencyConfig(e);
    const attRow = (await h.admin.query<{ d: string | null }>(`select deployed_locations_digest as d from residency_attestations where id = 1`)).rows[0];
    expect(attRow.d).toBe(cfg.locationsDigest);
    const ok = await tryRegister(A, "1001", e);
    expect(ok.ok).toBe(true);

    // Same APP_RELEASE_DIGEST, changed runtime RESIDENCY_BACKUPS_REGION -> refused (residency:unattested)
    const driftedEnv = { ...e, [envKey("backups", "region")]: "jkt-1" };
    await expect(tryRegister(A, "1001b", driftedEnv)).rejects.toMatchObject({ code: "ERR_FORBIDDEN", reason: "real_patient_gate:residency:unattested" });

    // Same APP_RELEASE_DIGEST, missing runtime RESIDENCY_LOGS_COUNTRY -> refused (residency:unattested)
    const incompleteEnv = { ...e, [envKey("logs", "country")]: undefined };
    await expect(tryRegister(A, "1001c", incompleteEnv)).rejects.toMatchObject({ code: "ERR_FORBIDDEN", reason: "real_patient_gate:residency:unattested" });

    // Different running release digest -> refused (residency:unattested)
    await expect(tryRegister(A, "1002", { ...e, APP_RELEASE_DIGEST: RELEASE_B })).rejects.toMatchObject({ code: "ERR_FORBIDDEN", reason: "real_patient_gate:residency:unattested" });

    // Missing release digest -> refused (residency:unattested)
    await expect(tryRegister(A, "1003", { ...e, APP_RELEASE_DIGEST: undefined })).rejects.toMatchObject({ code: "ERR_FORBIDDEN", reason: "real_patient_gate:residency:unattested" });

    // Local/staging attestation row cannot authorize production
    await attestResidency(h.admin, { ...e, DEPLOY_ENV: "staging" });
    await expect(tryRegister(A, "1004", e)).rejects.toMatchObject({ code: "ERR_FORBIDDEN", reason: "real_patient_gate:residency:unattested" });

    // clinic_app cannot call residency_attest
    await expect(app.query(`select residency_attest('[]'::jsonb, 'production', $1)`, [RELEASE_A])).rejects.toMatchObject({ code: "42501" });
  });

  it("Finding #2: residency_attest validates input strictly (duplicates, unknown kinds, NULL/blank fields) and locks vendor_profile", async () => {
    // Duplicate kind rejected
    await expect(
      h.admin.query(`select residency_attest($1::jsonb, 'production', $2)`, [
        JSON.stringify([
          { kind: "database", provider: "vultr", region: "sgp", country: "SG" },
          { kind: "database", provider: "vultr", region: "sgp", country: "SG" },
        ]),
        RELEASE_A,
      ]),
    ).rejects.toThrow(/ERR_INVALID_INPUT/);

    // Unknown kind rejected
    await expect(
      h.admin.query(`select residency_attest($1::jsonb, 'production', $2)`, [
        JSON.stringify([{ kind: "cache", provider: "vultr", region: "sgp", country: "SG" }]),
        RELEASE_A,
      ]),
    ).rejects.toThrow(/ERR_INVALID_INPUT/);

    // NULL / blank field rejected
    await expect(
      h.admin.query(`select residency_attest($1::jsonb, 'production', $2)`, [
        JSON.stringify([{ kind: "database", provider: null, region: "sgp", country: "SG" }]),
        RELEASE_A,
      ]),
    ).rejects.toThrow(/ERR_INVALID_INPUT/);

    // NULL env or bad digest rejected
    await expect(h.admin.query(`select residency_attest('[]'::jsonb, null, $1)`, [RELEASE_A])).rejects.toThrow(/ERR_INVALID_INPUT/);
    await expect(h.admin.query(`select residency_attest('[]'::jsonb, 'production', 'short')`)).rejects.toThrow(/ERR_INVALID_INPUT/);

    // Concurrent profile edit vs residency_attest: row lock guarantees attested config_version matches stored profile
    const e1 = mkEnv();
    const e2 = mkEnv({ backups: "ID" }, { [envKey("backups", "region")]: "jkt" });
    await approveVendorProfileAllReal(declaredFrom(e1), "positive", OPINION_A);
    const c1 = testClient({ connectionString: h.ownerUrl() });
    const c2 = testClient({ connectionString: h.ownerUrl() });
    await c1.connect();
    await c2.connect();
    try {
      await c1.query("begin");
      await c1.query(`select * from vendor_profile where id = 1 for update`);
      await c1.query(`update vendor_profile set storage_locations = $1::jsonb where id = 1`, [JSON.stringify(declaredFrom(e2))]);
      const attestPromise = c2.query<{ r: { matched: boolean; config_version: string } }>(
        `select residency_attest($1::jsonb, 'production', $2) as r`,
        [JSON.stringify(declaredFrom(e1)), RELEASE_A],
      );
      await new Promise((r) => setTimeout(r, 80));
      await c1.query("commit");
      const res = (await attestPromise).rows[0].r;
      // Attester waited for c1 commit, saw e2 in vendor_profile, so e1 did NOT falsely match e2!
      expect(res.matched).toBe(false);
    } finally {
      await c1.end();
      await c2.end();
    }
  });

  it("Finding #4: positive opinion requires vendor_residency_opinion file_sha256 === vendor_profile.residency_opinion_checksum", async () => {
    const e = mkEnv();
    await openGateFullyFor(A, e);

    // Mismatched checksum (file B approved in compliance, file A on profile) -> opinion_unapproved
    await setVendorEvidence("vendor_residency_opinion", { state: "approved", sha256: OPINION_B_SHA });
    await expect(tryRegister(A, "2001", e)).rejects.toMatchObject({ code: "ERR_FORBIDDEN", reason: "real_patient_gate:residency:opinion_unapproved" });

    // Missing checksum -> opinion_unapproved
    await setVendorEvidence("vendor_residency_opinion", { state: "approved", sha256: null });
    await expect(tryRegister(A, "2002", e)).rejects.toMatchObject({ code: "ERR_FORBIDDEN", reason: "real_patient_gate:residency:opinion_unapproved" });

    // Restore matching checksum -> opens
    await setVendorEvidence("vendor_residency_opinion", { state: "approved", sha256: OPINION_A_SHA });
    expect((await tryRegister(A, "2003", e)).ok).toBe(true);
  });

  it("Finding #5: dual env marker — app.deploy_env='local' cannot bypass production DB or missing marker", async () => {
    const e = mkEnv();
    await openGateFullyFor(A, e);
    // Close gate by revoking DPIA
    await setTenantObligation(A, "dpia", { state: "revoked" });

    // DB='production' + app='local' -> STILL GATED!
    await setPlatformEnvironment(h.admin, "production");
    await expect(tryRegister(A, "3001", { ...e, DEPLOY_ENV: "local" })).rejects.toMatchObject({ code: "ERR_FORBIDDEN", reason: "real_patient_gate:obligation:dpia" });

    // Missing DB row + app='local' -> STILL GATED (fail closed)!
    await h.admin.query(`delete from platform_environment`);
    await expect(tryRegister(A, "3002", { ...e, DEPLOY_ENV: "local" })).rejects.toMatchObject({ code: "ERR_FORBIDDEN", reason: "real_patient_gate:obligation:dpia" });

    // Both DB='local' AND app='local' -> exempt!
    await setPlatformEnvironment(h.admin, "local");
    expect((await tryRegister(A, "3003", { ...e, DEPLOY_ENV: "local" })).ok).toBe(true);

    // DB='local' + app='production' -> STILL GATED (production app cannot bypass)!
    await expect(tryRegister(A, "3004", { ...e, DEPLOY_ENV: "production" })).rejects.toMatchObject({ code: "ERR_FORBIDDEN", reason: "real_patient_gate:obligation:dpia" });
  });

  it("Finding #3: tenant isolation, post-lock concurrent revocation & Jakarta wall-clock expiry", async () => {
    const e = mkEnv();
    await openGateFullyFor(A, e);
    // Tenant B has NO tenant obligations approved -> Tenant A's approvals never open Tenant B!
    await expect(tryRegister(B, "4001", e)).rejects.toMatchObject({ code: "ERR_FORBIDDEN", reason: "real_patient_gate:obligation:processor_agreement_signed" });

    // Expired yesterday on Asia/Jakarta date -> refused
    const yesterday = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    await setTenantObligation(A, "dpia", { state: "approved", validUntil: yesterday });
    await expect(tryRegister(A, "4002", e)).rejects.toMatchObject({ code: "ERR_FORBIDDEN", reason: "real_patient_gate:obligation:dpia" });
    await setTenantObligation(A, "dpia", { state: "approved", validUntil: null });

    // Concurrent revocation: owner locks vendor_profile, switches opinion to inconclusive & commits while registerPatient waits
    const blocker = testClient({ connectionString: h.ownerUrl() });
    await blocker.connect();
    try {
      await blocker.query("begin");
      await blocker.query(`select * from vendor_profile where id = 1 for update`);
      await blocker.query(`update vendor_profile set residency_opinion_outcome = 'inconclusive' where id = 1`);

      const regPromise = tryRegister(A, "4003", e);
      await new Promise((r) => setTimeout(r, 80));
      await blocker.query("commit");

      await expect(regPromise).rejects.toMatchObject({ code: "ERR_FORBIDDEN", reason: "real_patient_gate:vendor:residency_opinion_inconclusive" });
      // Zero partial patient rows written
      expect((await h.admin.query<{ n: number }>(`select count(*)::int as n from patients where full_name = 'Pasien 4003'`)).rows[0].n).toBe(0);
    } finally {
      await blocker.end();
    }
  });

  it("Finding #6: online booking creation AND online hold confirmation (booking_confirm & deposit_receive) are gated", async () => {
    const e = mkEnv();
    await openGateFullyFor(A, e);
    const pat = await tryRegister(A, "5001", e);
    expect(pat.ok).toBe(true);
    const patientId = (pat as { ok: true; patientId: string }).patientId;

    // 1) Create online hold while gate is OPEN -> succeeds
    const hold1 = await withEnv(e, async () =>
      withTenantContext(app, await resolveContext(app, A.foAcc, { tenantId: A.tenantId, actingRole: "fo_cashier", activeBranchId: A.branchId }), (db) =>
        book(db, `k-hold-1-${++n}`, { branchId: A.branchId, patientId, versionId: A.serviceVersionId, startsAt: futureSlot(3, 10), channel: "online", hold: true }),
      ),
    );
    expect(hold1.state).toBe("held");

    // Also create a second online hold for deposit_receive test
    const hold2 = await withEnv(e, async () =>
      withTenantContext(app, await resolveContext(app, A.foAcc, { tenantId: A.tenantId, actingRole: "fo_cashier", activeBranchId: A.branchId }), (db) =>
        book(db, `k-hold-2-${++n}`, { branchId: A.branchId, patientId, versionId: A.serviceVersionId, startsAt: futureSlot(4, 10), channel: "online", hold: true }),
      ),
    );
    expect(hold2.state).toBe("held");

    // 2) Revoke DPIA AFTER holds were created!
    await setTenantObligation(A, "dpia", { state: "revoked" });

    // Online booking_create -> refused
    await expect(
      withEnv(e, async () =>
        withTenantContext(app, await resolveContext(app, A.foAcc, { tenantId: A.tenantId, actingRole: "fo_cashier", activeBranchId: A.branchId }), (db) =>
          book(db, `k-online-blocked-${++n}`, { branchId: A.branchId, patientId, versionId: A.serviceVersionId, startsAt: futureSlot(5, 10), channel: "online" }),
        ),
      ),
    ).rejects.toMatchObject({ code: "ERR_FORBIDDEN", reason: "real_patient_gate:obligation:dpia" });

    // Online hold booking_confirm -> refused (zero AppointmentBooked event!)
    await expect(
      withEnv(e, async () =>
        withTenantContext(app, await resolveContext(app, A.foAcc, { tenantId: A.tenantId, actingRole: "fo_cashier", activeBranchId: A.branchId }), (db) =>
          confirm(db, `k-confirm-blocked-${++n}`, hold1.appointmentId),
        ),
      ),
    ).rejects.toMatchObject({ code: "ERR_FORBIDDEN", reason: "real_patient_gate:obligation:dpia" });
    expect((await h.admin.query<{ n: number }>(`select count(*)::int as n from domain_events where aggregate_id = $1 and type = 'AppointmentBooked'`, [hold1.appointmentId])).rows[0].n).toBe(0);

    // Online hold deposit_receive -> refused (zero deposit, zero AppointmentBooked event!)
    await expect(
      withEnv(e, async () =>
        withTenantContext(app, await resolveContext(app, A.foAcc, { tenantId: A.tenantId, actingRole: "fo_cashier", activeBranchId: A.branchId }), (db) =>
          receiveDeposit(db, `k-dp-blocked-${++n}`, hold2.appointmentId, { method: "cash", cashTendered: 50000 }),
        ),
      ),
    ).rejects.toMatchObject({ code: "ERR_FORBIDDEN", reason: "real_patient_gate:obligation:dpia" });
    expect((await h.admin.query<{ n: number }>(`select count(*)::int as n from domain_events where aggregate_id = $1 and type = 'AppointmentBooked'`, [hold2.appointmentId])).rows[0].n).toBe(0);

    // Restore DPIA, then drift runtime RESIDENCY_* with SAME APP_RELEASE_DIGEST -> online booking, hold confirm & hold deposit ALL refused!
    await setTenantObligation(A, "dpia", { state: "approved" });
    const driftedEnv = { ...e, [envKey("backups", "country")]: "ID", [envKey("backups", "region")]: "jkt" };
    await expect(
      withEnv(driftedEnv, async () =>
        withTenantContext(app, await resolveContext(app, A.foAcc, { tenantId: A.tenantId, actingRole: "fo_cashier", activeBranchId: A.branchId }), (db) =>
          book(db, `k-online-drift-${++n}`, { branchId: A.branchId, patientId, versionId: A.serviceVersionId, startsAt: futureSlot(5, 10), channel: "online" }),
        ),
      ),
    ).rejects.toMatchObject({ code: "ERR_FORBIDDEN", reason: "real_patient_gate:residency:unattested" });
    await expect(
      withEnv(driftedEnv, async () =>
        withTenantContext(app, await resolveContext(app, A.foAcc, { tenantId: A.tenantId, actingRole: "fo_cashier", activeBranchId: A.branchId }), (db) =>
          confirm(db, `k-confirm-drift-${++n}`, hold1.appointmentId),
        ),
      ),
    ).rejects.toMatchObject({ code: "ERR_FORBIDDEN", reason: "real_patient_gate:residency:unattested" });
    await expect(
      withEnv(driftedEnv, async () =>
        withTenantContext(app, await resolveContext(app, A.foAcc, { tenantId: A.tenantId, actingRole: "fo_cashier", activeBranchId: A.branchId }), (db) =>
          receiveDeposit(db, `k-dp-drift-${++n}`, hold2.appointmentId, { method: "cash", cashTendered: 50000 }),
        ),
      ),
    ).rejects.toMatchObject({ code: "ERR_FORBIDDEN", reason: "real_patient_gate:residency:unattested" });

    // With matching runtime env -> booking_confirm AND deposit_receive succeed!
    await withEnv(e, async () =>
      withTenantContext(app, await resolveContext(app, A.foAcc, { tenantId: A.tenantId, actingRole: "fo_cashier", activeBranchId: A.branchId }), (db) =>
        confirm(db, `k-confirm-ok-${++n}`, hold1.appointmentId),
      ),
    );
    const dpOk = await withEnv(e, async () =>
      withTenantContext(app, await resolveContext(app, A.foAcc, { tenantId: A.tenantId, actingRole: "fo_cashier", activeBranchId: A.branchId }), (db) =>
        receiveDeposit(db, `k-dp-ok-${++n}`, hold2.appointmentId, { method: "cash", cashTendered: 50000 }),
      ),
    );
    expect(dpOk.deposit_id).toBeTruthy();
  });

  it("Finding #7: vendor_go_live_blockers (PR-59 declared posture) names required, negative, inconclusive and clears on all-ID", async () => {
    const sgLocs = declaredFrom(mkEnv());
    await approveVendorProfileAllReal(sgLocs, null);
    expect((await h.admin.query<{ b: string[] }>(`select vendor_go_live_blockers() as b`)).rows[0].b).toEqual(["residency_opinion_required"]);

    await approveVendorProfileAllReal(sgLocs, "negative", OPINION_A);
    expect((await h.admin.query<{ b: string[] }>(`select vendor_go_live_blockers() as b`)).rows[0].b).toEqual(["residency_opinion_negative"]);

    await approveVendorProfileAllReal(sgLocs, "inconclusive", OPINION_A);
    expect((await h.admin.query<{ b: string[] }>(`select vendor_go_live_blockers() as b`)).rows[0].b).toEqual(["residency_opinion_inconclusive"]);

    const idLocs = declaredFrom(mkEnv({ database: "ID", object_storage: "ID", backups: "ID", logs: "ID", error_tracking: "ID" }));
    await approveVendorProfileAllReal(idLocs, null);
    expect((await h.admin.query<{ b: string[] }>(`select vendor_go_live_blockers() as b`)).rows[0].b).toEqual([]);
  });

  it("Finding #8: scope_map platform classification + direct denial for clinic_app, clinic_vendor, and clinic_operator (even with support session)", async () => {
    const sm = (await h.admin.query<{ table_name: string; policy_kind: string }>(
      `select table_name, policy_kind from scope_map where table_name in ('public.platform_environment', 'public.residency_attestations') order by 1`,
    )).rows;
    expect(sm).toEqual([
      { table_name: "public.platform_environment", policy_kind: "platform" },
      { table_name: "public.residency_attestations", policy_kind: "platform" },
    ]);

    // Absent from operator-readable support_object_kinds
    const sok = (await h.admin.query<{ n: number }>(
      `select count(*)::int as n from support_object_kinds where table_name in ('public.platform_environment', 'public.residency_attestations')`,
    )).rows[0].n;
    expect(sok).toBe(0);

    // Direct SELECT / EXECUTE denied across clinic_app, clinic_vendor, and clinic_operator
    for (const [label, q] of [
      ["app", (sql: string) => app.query(sql)],
      ["vendor", (sql: string) => vendorClient.query(sql)],
      ["operator", (sql: string) => operatorClient.query(sql)],
    ] as const) {
      await expect(q(`select * from platform_environment`), `${label} platform_environment`).rejects.toMatchObject({ code: "42501" });
      await expect(q(`select * from residency_attestations`), `${label} residency_attestations`).rejects.toMatchObject({ code: "42501" });
      await expect(q(`select residency_attest('[]'::jsonb, 'production', '${RELEASE_A}')`), `${label} residency_attest`).rejects.toMatchObject({ code: "42501" });
      await expect(q(`select real_patient_gate('${A.tenantId}')`), `${label} real_patient_gate`).rejects.toMatchObject({ code: "42501" });
      await expect(q(`select real_patient_gate_assert('${A.tenantId}')`), `${label} real_patient_gate_assert`).rejects.toMatchObject({ code: "42501" });
    }

    // real_patient_gate_status: allowed for owner, refused for fo_cashier / vendor / operator
    const e = mkEnv();
    await openGateFullyFor(A, e);
    const st = await withTenantContext(app, await resolveContext(app, A.ownerAcc, { tenantId: A.tenantId, actingRole: "owner" }), (db) =>
      realPatientGateStatus(db, e),
    );
    expect(st).toEqual([]);
    await expect(
      withTenantContext(app, await resolveContext(app, A.foAcc, { tenantId: A.tenantId, actingRole: "fo_cashier", activeBranchId: A.branchId }), (db) =>
        realPatientGateStatus(db, e),
      ),
    ).rejects.toThrow(/ERR_FORBIDDEN/);
    await expect(vendorClient.query(`select real_patient_gate_status()`)).rejects.toMatchObject({ code: "42501" });
    await expect(operatorClient.query(`select real_patient_gate_status()`)).rejects.toMatchObject({ code: "42501" });

    // Even inside an active bound support session for Tenant A, clinic_operator cannot read platform residency tables or invoke gate functions.
    const sess = await openSession(consoleDb, { token: supportTok, ip: VENDOR_IP }, {
      tenantId: A.tenantId,
      purpose: "Verifikasi negatif batas platform pada sesi dukungan",
      scope: ["public.branches"],
      minutes: 30,
    });
    expect(sess.ok).toBe(true);
    if (sess.ok) {
      await expect(
        withSupportSession(consoleDb, opDb, { token: supportTok, ip: VENDOR_IP }, sess.data.id, (db) => db.query(`select * from platform_environment`)),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        withSupportSession(consoleDb, opDb, { token: supportTok, ip: VENDOR_IP }, sess.data.id, (db) => db.query(`select * from residency_attestations`)),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        withSupportSession(consoleDb, opDb, { token: supportTok, ip: VENDOR_IP }, sess.data.id, (db) => db.query(`select real_patient_gate_status()`)),
      ).rejects.toMatchObject({ code: "42501" });
    }
  });
});
