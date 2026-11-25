// T-129 + HYG-024 (PR-87, 19 §3, ADR-7, RATE-5; migration 0140): real PostgreSQL behavioral, privacy,
// rate-limit, template-validation, and privilege tests for all 7 new vendor_console_* functions + feature_flag_on.
import { randomBytes } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_GROUP_ROLE, OPERATOR_GROUP_ROLE, VENDOR_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { csvCell, exportVendorActionsCsv, formatVendorActionsCsv } from "../../src/modules/vendor/console/audit.export";
import {
  isFeatureFlagOn,
  listFeatureFlags,
  listLegalTemplates,
  listVendorActions,
  readIntegrations,
  readVendorProfile,
  saveLegalTemplate,
} from "../../src/modules/vendor/console/console";
import { bootstrapVendor, createVendorStaff, type VendorCaller } from "../../src/modules/vendor/staff/staff";
import { createHarness, type Harness, testPool } from "../rls/harness";

const IP = "203.0.113.42";
let h: Harness;
let ownerPool: pg.Pool;
let consoleDb: pg.Pool;
let appDb: pg.Pool;
let opDb: pg.Pool;
let n = 0;

let PO: string;
let SUP: string;
let AUD: string;
let FIN: string;
let ONB: string;

const callerOf = (accountId: string): VendorCaller => ({ accountId, ip: IP, mfaAt: new Date() });

async function account(totp = true): Promise<string> {
  return (
    await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('V', $1, $2) returning id`, [
      `cr${++n}@vendor-sintetis.test`,
      totp,
    ])
  ).rows[0].id as string;
}

async function session(acc: string, mfaAgo = "0 minutes"): Promise<string> {
  const tok = `cr${++n}${randomBytes(12).toString("hex")}`;
  await h.admin.query(
    `insert into auth_session (user_id, token, expires_at, surface, second_factor_at)
     values ($1, $2, now() + interval '8 hours', 'vendor', now() - $3::interval)`,
    [acc, tok, mfaAgo],
  );
  return tok;
}

async function clinic(legalName: string): Promise<string> {
  const id = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [id, legalName]);
  await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'B1', 'Cabang Utama', 'Asia/Jakarta')`, [id]);
  return id;
}

beforeAll(async () => {
  h = await createHarness();
  ownerPool = testPool({ connectionString: h.ownerUrl(), max: 3 });
  consoleDb = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [VENDOR_GROUP_ROLE])), max: 8 }, VENDOR_GROUP_ROLE);
  appDb = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 4 });
  opDb = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [OPERATOR_GROUP_ROLE])), max: 2 }, OPERATOR_GROUP_ROLE);
  const c = await ownerPool.connect();
  try {
    PO = await account();
    await bootstrapVendor(c, PO, "Pemilik Platform", "203.0.113.0/24", "Kantor vendor");
    SUP = await account();
    AUD = await account();
    FIN = await account();
    ONB = await account();
    await createVendorStaff(c, callerOf(PO), SUP, "Staf Dukungan", ["support"]);
    await createVendorStaff(c, callerOf(PO), AUD, "Auditor Vendor", ["vendor_auditor"]);
    await createVendorStaff(c, callerOf(PO), FIN, "Keuangan Vendor", ["vendor_finance"]);
    await createVendorStaff(c, callerOf(PO), ONB, "Staf Onboarding", ["onboarding"]);
  } finally {
    c.release();
  }
}, 300_000);

afterAll(async () => {
  await opDb?.end();
  await appDb?.end();
  await consoleDb?.end();
  await ownerPool?.end();
  await h?.close();
});

describe("T-129 + HYG-024 (0140): Integrasi closed vocabulary & role gate", () => {
  it("maps unknown/sentinel provider error codes strictly to 'lainnya', scopes ?tenant=, and enforces support-only role", async () => {
    const tA = await clinic("PT Integrasi Satu");
    const tB = await clinic("PT Integrasi Dua");
    // Insert a known closed code ('rejected_signature') AND an unmapped code ('rejected_window' -> 'lainnya'),
    // plus prove directly that any synthetic patient sentinel string passed to _vendor_closed_error_code maps to 'lainnya'!
    const sentinel = "PATIENT_BUDI_99887766";
    expect(
      (await h.admin.query<{ c: string }>(`select public._vendor_closed_error_code($1) as c`, [sentinel])).rows[0].c,
    ).toBe("lainnya");
    await h.admin.query(
      `insert into payment_webhook_events (tenant_id, provider, provider_account, environment, provider_event_id, order_ref, signature_ok, timestamp_ok, outcome, body_sha256, received_at)
       values ($1, 'mock', 'acct-1', 'local', 'evt-1', 'ORD-1', false, false, 'rejected_window', repeat('a', 64), clock_timestamp()),
              ($1, 'mock', 'acct-1', 'local', 'evt-2', 'ORD-2', false, true, 'rejected_signature', repeat('b', 64), clock_timestamp())`,
      [tA],
    );

    const supTok = await session(SUP);
    const poTok = await session(PO);

    // platform_owner is NOT in 19 §3 Integrasi roles -> refused
    expect(await readIntegrations(consoleDb, { token: poTok, ip: IP }, tA)).toMatchObject({ ok: false, reason: "role_not_held" });

    // Unknown tenant UUID fails closed with ERR_NOT_FOUND
    expect(await readIntegrations(consoleDb, { token: supTok, ip: IP }, "0193a000-0000-7000-8000-0000000000ff")).toMatchObject({
      ok: false,
      code: "ERR_NOT_FOUND",
    });

    // Support reads tA only: zero tB rows, zero sentinel leakage, closed vocabulary only!
    const r = await readIntegrations(consoleDb, { token: supTok, ip: IP }, tA);
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.data.rows).toHaveLength(1);
    expect(r.data.rows[0].tenantId).toBe(tA);
    const serialized = JSON.stringify(r.data);
    expect(serialized).not.toContain(sentinel);
    expect(serialized).not.toContain(tB);
    expect(r.data.rows[0].payments.rejected24h).toBe(2);
    expect(r.data.rows[0].payments.codes).toEqual([
      { code: "lainnya", count: 1 },
      { code: "rejected_signature", count: 1 },
    ]);
  });
});

describe("T-129 + HYG-024 (0140): Audit list, masked IP, RATE-5 parallel export & CSV formula neutralization", () => {
  it("masks IPv4 to /24, neutralizes spreadsheet formulas in CSV, and enforces <= 5 exports / 5 min under 6-way parallel race", async () => {
    const tMal = await clinic("=CMD|' /C calc'!A0");
    const audTok = await session(AUD);
    const supTok = await session(SUP);

    // Support cannot read or export audit logs
    expect(await listVendorActions(consoleDb, { token: supTok, ip: IP })).toMatchObject({ ok: false, reason: "role_not_held" });
    expect(await exportVendorActionsCsv(consoleDb, { token: supTok, ip: IP })).toMatchObject({ ok: false, reason: "role_not_held" });

    // Trigger one audited action targeting tMal so tMal appears in vendor_actions
    await h.admin.query(
      `insert into vendor_actions (acting_role, action, tenant_id, outcome, reason_code, client_ip)
       values ('platform_owner', 'tenant_review', $1, 'success', 'checked', '203.0.113.99')`,
      [tMal],
    );

    const list = await listVendorActions(consoleDb, { token: audTok, ip: IP }, { tenantId: tMal });
    if (!list.ok) throw new Error(JSON.stringify(list));
    expect(list.data.rows.length).toBeGreaterThanOrEqual(1);
    expect(list.data.rows[0].clientIp).toBe("203.0.113.0/24");
    expect(JSON.stringify(list.data.rows)).not.toContain("203.0.113.99");

    // 6-way parallel export race under RATE-5: AT MOST 5 succeed and at least 1 is rate_limited!
    const results = await Promise.all(
      Array.from({ length: 6 }, () => exportVendorActionsCsv(consoleDb, { token: audTok, ip: IP }, { tenantId: tMal })),
    );
    const okCount = results.filter((x) => x.ok).length;
    const limitedCount = results.filter((x) => !x.ok && x.reason === "rate_limited").length;
    expect(okCount).toBe(5);
    expect(limitedCount).toBe(1);

    const firstOk = results.find((x) => x.ok)!;
    if (!firstOk.ok) throw new Error("expected ok");
    // Formula-injection prefix neutralized with leading single quote
    expect(firstOk.data.csv).toContain(",'=CMD|' /C calc'!A0,");
    expect(firstOk.data.csv).not.toContain(",=CMD");
    expect(csvCell("+SUM(A1:A2)")).toBe("'+SUM(A1:A2)");
    expect(csvCell("-1+1")).toBe("'-1+1");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("\n=SUM(A1)")).toBe(`"'\n=SUM(A1)"`);
    expect(csvCell("  =1+1")).toBe("'  =1+1");
    expect(csvCell("  +cmd")).toBe("'  +cmd");
    expect(csvCell("\t-2")).toBe("'\t-2");
    expect(csvCell("\r@foo")).toBe(`"'\r@foo"`);
    expect(formatVendorActionsCsv([])).toBe("id,at,actor_role,action,tenant_id,tenant_name,outcome,reason_code,client_ip\r\n");

    // Reversed date range rejected at SQL boundary
    expect(
      await exportVendorActionsCsv(consoleDb, { token: audTok, ip: IP }, {
        tenantId: tMal,
        from: "2026-11-26T10:00:00Z",
        to: "2026-11-26T09:00:00Z",
      }),
    ).toMatchObject({ ok: false, code: "ERR_INVALID_INPUT", reason: "invalid_range" });

    // Stale 11-minute MFA refused on export (requires 10-minute step-up)
    const stalePoTok = await session(PO, "11 minutes");
    expect(await exportVendorActionsCsv(consoleDb, { token: stalePoTok, ip: IP })).toMatchObject({
      ok: false,
      code: "ERR_FORBIDDEN",
    });

    // Durable success audit rows written for integrations_read and actions_read
    const loggedActions = (
      await h.admin.query<{ action: string }>(
        `select distinct action from vendor_actions where outcome = 'success' and action in ('integrations_read', 'actions_read', 'vendor_actions_export')`,
      )
    ).rows.map((r) => r.action);
    expect(loggedActions.sort()).toEqual(["actions_read", "integrations_read", "vendor_actions_export"]);

    // Structural regression pin: vendor_console_actions_export reads at most 10,001 rows in a single CTE snapshot (no separate count+payload TOCTOU)
    const exportSrc = (
      await h.admin.query<{ prosrc: string }>(`select prosrc from pg_proc where proname = 'vendor_console_actions_export'`)
    ).rows[0]?.prosrc ?? "";
    expect(exportSrc).toContain("WITH slice AS");
    expect(exportSrc).toContain("LIMIT 10001");
    expect(exportSrc.match(/FROM public\.vendor_actions a\b/g)).toHaveLength(2); // 1 for RATE-5 quota + 1 for single-snapshot CTE
  });
});

describe("T-129 + HYG-024 (0140): Profil Vendor, Feature Flags (ADR-7) & Templat Global", () => {
  it("reads vendor_profile + 0133 go-live blockers for platform_owner only", async () => {
    const poTok = await session(PO);
    const audTok = await session(AUD);
    expect(await readVendorProfile(consoleDb, { token: audTok, ip: IP })).toMatchObject({ ok: false, reason: "role_not_held" });
    const prof = await readVendorProfile(consoleDb, { token: poTok, ip: IP });
    if (!prof.ok) throw new Error(JSON.stringify(prof));
    expect(prof.data.profile.legalName).toBeTruthy();
    expect(Array.isArray(prof.data.goLiveBlockers)).toBe(true);
    const profLog = await h.admin.query(
      `select 1 from vendor_actions where account_id = $1 and action = 'profile_read' and outcome = 'success' limit 1`,
      [PO],
    );
    expect(profLog.rowCount).toBe(1);
  });

  it("ships empty read-only Release 1 feature flag catalogue and isolates feature_flag_on(key) per tenant", async () => {
    const poTok = await session(PO);
    const finTok = await session(FIN);
    expect(await listFeatureFlags(consoleDb, { token: finTok, ip: IP })).toMatchObject({ ok: false, reason: "role_not_held" });
    const flags = await listFeatureFlags(consoleDb, { token: poTok, ip: IP });
    if (!flags.ok) throw new Error(JSON.stringify(flags));
    expect(flags.data.writesOpen).toBe(false);
    expect(flags.data.catalogue).toEqual([]);

    // Tenant isolation test on feature_flag_on(key): enable for tA only, verify tA=true, tB=false, unbound=false
    const tA = await clinic("PT Flag Satu");
    const tB = await clinic("PT Flag Dua");
    await h.admin.query(
      `insert into platform_feature_flags (key, label, description, tender_ref)
       values ('tender_demo_flag', 'Fitur Tender Demo', 'Deskripsi sintetis', 'TENDER-01')`,
    );
    await h.admin.query(
      `insert into tenant_feature_flags (tenant_id, flag_key, enabled, decision_ref, approved_by)
       values ($1, 'tender_demo_flag', true, 'DEC-132', $2)`,
      [tA, PO],
    );

    const accA = await account();
    const accB = await account();
    const mA = await createMembership(ownerPool, { tenantId: tA, accountId: accA, displayName: "Owner A" });
    const mB = await createMembership(ownerPool, { tenantId: tB, accountId: accB, displayName: "Owner B" });
    const oc = await ownerPool.connect();
    try {
      await assignRole(oc, { tenantId: tA, staffId: mA.staffId, role: "owner" });
      await assignRole(oc, { tenantId: tB, staffId: mB.staffId, role: "owner" });
    } finally {
      oc.release();
    }
    const ctxA = await resolveContext(appDb, accA, { tenantId: tA, actingRole: "owner" });
    const ctxB = await resolveContext(appDb, accB, { tenantId: tB, actingRole: "owner" });
    expect(await withTenantContext(appDb, ctxA, (db) => isFeatureFlagOn(db, "tender_demo_flag"))).toBe(true);
    expect(await withTenantContext(appDb, ctxB, (db) => isFeatureFlagOn(db, "tender_demo_flag"))).toBe(false);
    expect(await withTenantContext(appDb, ctxA, (db) => isFeatureFlagOn(db, "nonexistent_flag"))).toBe(false);

    // Zero raw table access for clinic_vendor, clinic_app, clinic_operator
    for (const pool of [consoleDb, appDb, opDb]) {
      await expect(pool.query(`select 1 from platform_feature_flags limit 1`)).rejects.toMatchObject({ code: "42501" });
      await expect(pool.query(`select 1 from tenant_feature_flags limit 1`)).rejects.toMatchObject({ code: "42501" });
      await expect(pool.query(`select 1 from vendor_legal_templates limit 1`)).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("validates plain-text legal templates, rejects HTML/unknown tokens/lone braces, and keeps single-active per kind under concurrency", async () => {
    const poTok = await session(PO);
    const onbTok = await session(ONB);
    expect(await listLegalTemplates(consoleDb, { token: onbTok, ip: IP })).toMatchObject({ ok: false, reason: "role_not_held" });
    expect(
      await saveLegalTemplate(consoleDb, { token: onbTok, ip: IP }, { kind: "kebijakan-privasi", body: "Kebijakan privasi resmi {{klinik.nama}} yang valid.", activate: true }),
    ).toMatchObject({ ok: false, reason: "role_not_held" });

    // Reject HTML, unknown placeholder, nested placeholder bypass (both directions, incl. earlier inner token exposing later outer token), lone brace, invalid kind
    for (const badBody of [
      "Kebijakan privasi <script>alert(1)</script> untuk {{klinik.nama}}",
      "Kebijakan privasi {{unknown.token}} untuk {{klinik.nama}}",
      "Kebijakan privasi {{vendor.{{klinik.nama}}nama}} tidak boleh lolos validasi.",
      "Kebijakan privasi {{klinik.{{vendor.nama}}nama}} tidak boleh lolos validasi.",
      "Kebijakan privasi {{klinik.nama tidak ditutup dengan benar",
      "Terlalu pendek",
    ]) {
      expect(
        await saveLegalTemplate(consoleDb, { token: poTok, ip: IP }, { kind: "kebijakan-privasi", body: badBody, activate: true }),
      ).toMatchObject({ ok: false, code: "ERR_INVALID_INPUT", reason: "invalid_body" });
    }
    expect(
      await saveLegalTemplate(consoleDb, { token: poTok, ip: IP }, { kind: "promo-ilegal", body: "Konten teks polos panjang minimal dua puluh karakter.", activate: true }),
    ).toMatchObject({ ok: false, code: "ERR_INVALID_INPUT", reason: "invalid_kind" });

    // Concurrent activations for the same kind MUST serialize cleanly and leave exactly 1 active row
    const valid1 = "Kebijakan Privasi {{klinik.nama}} di {{klinik.alamat}} kontak {{klinik.kontak}} email {{klinik.email}} bersama {{vendor.nama}} versi satu.";
    const valid2 = "Kebijakan Privasi {{klinik.nama}} di {{klinik.alamat}} kontak {{klinik.kontak}} email {{klinik.email}} bersama {{vendor.nama}} versi dua.";
    const [s1, s2] = await Promise.all([
      saveLegalTemplate(consoleDb, { token: poTok, ip: IP }, { kind: "kebijakan-privasi", body: valid1, activate: true }),
      saveLegalTemplate(consoleDb, { token: poTok, ip: IP }, { kind: "kebijakan-privasi", body: valid2, activate: true }),
    ]);
    expect(s1.ok && s2.ok).toBe(true);

    const list = await listLegalTemplates(consoleDb, { token: poTok, ip: IP });
    if (!list.ok) throw new Error(JSON.stringify(list));
    const active = list.data.rows.filter((x) => x.kind === "kebijakan-privasi" && x.isActive);
    expect(active).toHaveLength(1);
    expect(list.data.rows.filter((x) => x.kind === "kebijakan-privasi")).toHaveLength(2);

    // Durable success audit rows written for flags_read and templates_read
    const readLogs = (
      await h.admin.query<{ action: string }>(
        `select distinct action from vendor_actions where account_id = $1 and outcome = 'success' and action in ('flags_read', 'templates_read', 'vendor_template_save')`,
        [PO],
      )
    ).rows.map((r) => r.action);
    expect(readLogs.sort()).toEqual(["flags_read", "templates_read", "vendor_template_save"]);
  });
});
