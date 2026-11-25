// T-122 (PR-52, UX-32, TEN-18, RATE-5, SEC-5; R3) — PostgreSQL integration tests proving Scenario PR-52
// and closing all 9 findings of t122/PLAN-REVIEW-codex-panel3.md under least-privilege clinic_app.
// Synthetic data only (MIG-2).
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, OPERATOR_GROUP_ROLE, VENDOR_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { encryptField, newWrappedDek, type KekRing } from "../../src/lib/keys/envelope";
import { setKekRingForTests } from "../../src/lib/keys/runtime";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import {
  buildManifest,
  ExportRuleError,
  manifestJsonString,
  sha256,
  unzipStore,
  type StepUp,
} from "../../src/modules/export/export";
import { listTenantExports, releaseTenantExport, requestTenantExport } from "../../src/modules/export/tenant.export";
import { openSession, withSupportSession } from "../../src/modules/vendor/support/support";
import { bootstrapVendor, createVendorStaff } from "../../src/modules/vendor/staff/staff";
import { runExportExpireBatch, runExportWorkerOnce } from "../../src/workers/export";
import { createHarness, testPool, type Harness } from "../rls/harness";
import { stepUpForTests } from "../support/step-up";

type Actor = { acc: string; staffId: string; role: Role; tenantId: string; branchId?: string };
type TenantEnv = {
  tenantId: string;
  branchId: string;
  own: Actor;
  ownNo2fa: Actor;
  ap: Actor;
  doc: Actor;
  fo: Actor;
};

const VENDOR_IP = "203.0.113.10";
const KEK_KEY = randomBytes(32);
const KEK_RING: KekRing = { current: 1, keys: new Map([[1, KEK_KEY]]) };

async function errCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (e) {
    if (e instanceof ExportRuleError) return `${e.code}:${e.reason}`;
    return (e as { message?: string }).message ?? String(e);
  }
}

describe("T-122 tenant export PostgreSQL integration (PR-52, Findings #1–#9)", () => {
  let h: Harness;
  let app: pg.Pool;
  let owner: pg.Pool;
  let consoleDb: pg.Pool;
  let opDb: pg.Pool;
  let vendorClient: pg.Client;
  let operatorClient: pg.Client;
  let supportTok: string;
  let A: TenantEnv;
  let B: TenantEnv;
  let seedA: { ptId: string; visitId: string; examId: string; rec1Id: string; rec2Id: string; media1Id: string; media2Id: string; mediaHash: string };
  let seq = 0;

  const as = async <R>(who: Actor, fn: (db: pg.ClientBase) => Promise<R>) => {
    const ctx = await resolveContext(app, who.acc, {
      tenantId: who.tenantId,
      actingRole: who.role,
      activeBranchId: who.branchId,
    });
    return withTenantContext(app, ctx, fn);
  };

  async function setupTenant(tag: string): Promise<TenantEnv> {
    const tenantId = (await h.admin.query<{ id: string }>(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id;
    await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, `PT Klinik Ekspor ${tag}`]);
    const branchId = (await h.admin.query<{ id: string }>(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $3, 'Asia/Jakarta') returning id`, [tenantId, `B${tag}`, `Cabang ${tag}`])).rows[0].id;
    const dek = newWrappedDek(KEK_RING, tenantId, 1);
    await h.admin.query(`insert into tenant_data_keys (tenant_id, version, wrapped, is_current) values ($1, 1, $2, true)`, [tenantId, dek.wrapped]);

    const mk = async (k: string, role: Role, twoFa: boolean, branchScoped: boolean): Promise<Actor> => {
      const acc = (
        await h.admin.query<{ id: string }>(
          `insert into auth_user (name, email, two_factor_enabled) values ($1, $2, $3) returning id`,
          [`${tag}-${k}`, `${tag.toLowerCase()}-${k}-${++seq}@ekspor.test`, twoFa],
        )
      ).rows[0].id;
      const { staffId } = await createMembership(owner, { tenantId, accountId: acc, displayName: `${tag} ${k}` });
      const rid = await assignRole(h.admin, { tenantId, staffId, role });
      if (branchScoped) await assignBranch(h.admin, { tenantId, staffRoleId: rid, branchId });
      return { acc, staffId, role, tenantId, branchId: branchScoped ? branchId : undefined };
    };

    return {
      tenantId,
      branchId,
      own: await mk("own", "owner", true, false),
      ownNo2fa: await mk("no2fa", "owner", false, false),
      ap: await mk("ap", "admin_pusat", true, false),
      doc: await mk("doc", "doctor", true, true),
      fo: await mk("fo", "fo_cashier", true, true),
    };
  }

  async function seedTenantData(t: TenantEnv, sentinel: string) {
    const dekRow = (await h.admin.query<{ wrapped: string }>(`select wrapped from tenant_data_keys where tenant_id = $1 and is_current`, [t.tenantId])).rows[0];
    const keys = { tenantId: t.tenantId, current: { tenantId: t.tenantId, version: 1, wrapped: dekRow.wrapped }, byVersion: (v: number) => (v === 1 ? { tenantId: t.tenantId, version: 1, wrapped: dekRow.wrapped } : undefined) };

    const ptId = (
      await h.admin.query<{ id: string }>(
        `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
         values ($1, 'RM-000001', $2, '1993-04-10', 'female', 'newborn_via_guardian', 'Sintetis', 'islam', 'Karyawan', 's1', 'kawin', $3, $4, 'fo_cashier')
         returning id`,
        [t.tenantId, `Pasien ${sentinel}`, t.branchId, t.fo.staffId],
      )
    ).rows[0].id;

    const visitId = (
      await h.admin.query<{ id: string }>(
        `insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
        [t.tenantId, t.branchId, ptId, t.fo.staffId],
      )
    ).rows[0].id;

    const examId = (
      await h.admin.query<{ id: string }>(
        `insert into examinations (tenant_id, branch_id, visit_id, patient_id, author_id, state, subjective, icd10_codes)
         values ($1, $2, $3, $4, $5, 'draft', $6, '{L70.0}') returning id`,
        [t.tenantId, t.branchId, visitId, ptId, t.doc.staffId, `Keluhan ${sentinel}`],
      )
    ).rows[0].id;

    await h.admin.query(
      `update examinations set state = 'signed', signed_at = clock_timestamp(), signed_by = $2, signed_as = 'doctor', content_hash = repeat('a', 64) where id = $1`,
      [examId, t.doc.staffId],
    );
    const rec1Id = (
      await h.admin.query<{ id: string }>(
        `insert into record_versions (tenant_id, branch_id, examination_id, version, kind, content, content_hash, created_by, created_as)
         values ($1, $2, $3, 1, 'original', $4::jsonb, repeat('a', 64), $5, 'doctor') returning id`,
        [t.tenantId, t.branchId, examId, JSON.stringify({ subjective: `Catatan ${sentinel}`, icd10_codes: ["L70.0"], vitals: { nadi: 72 } }), t.doc.staffId],
      )
    ).rows[0].id;

    // R3 P0-1 regression: second visit + examination + record_version + second clinical_media in the exact same second (same UUIDv7 8-hex prefix!)
    await h.admin.query(`update visits set closed_at = clock_timestamp(), closed_by = $2 where id = $1`, [visitId, t.fo.staffId]);
    const visit2Id = (
      await h.admin.query<{ id: string }>(
        `insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
        [t.tenantId, t.branchId, ptId, t.fo.staffId],
      )
    ).rows[0].id;
    const exam2Id = (
      await h.admin.query<{ id: string }>(
        `insert into examinations (tenant_id, branch_id, visit_id, patient_id, author_id, state, subjective, icd10_codes)
         values ($1, $2, $3, $4, $5, 'draft', $6, '{L70.0}') returning id`,
        [t.tenantId, t.branchId, visit2Id, ptId, t.doc.staffId, `Keluhan lanjutan ${sentinel}`],
      )
    ).rows[0].id;
    await h.admin.query(
      `update examinations set state = 'signed', signed_at = clock_timestamp(), signed_by = $2, signed_as = 'doctor', content_hash = repeat('b', 64) where id = $1`,
      [exam2Id, t.doc.staffId],
    );
    const rec2Id = (
      await h.admin.query<{ id: string }>(
        `insert into record_versions (tenant_id, branch_id, examination_id, version, kind, content, content_hash, created_by, created_as)
         values ($1, $2, $3, 1, 'original', $4::jsonb, repeat('b', 64), $5, 'doctor') returning id`,
        [t.tenantId, t.branchId, exam2Id, JSON.stringify({ subjective: `Catatan kedua ${sentinel}`, icd10_codes: ["L70.0"] }), t.doc.staffId],
      )
    ).rows[0].id;

    // Burst clinical media (two photos of the same patient uploaded within the same second; R3 P0-1)
    const mediaBytes = Buffer.from(`PNG-SYNTHETIC-${sentinel}`, "utf8");
    const mediaHash = sha256(mediaBytes);
    await h.admin.query(
      `insert into clinical_media_blobs (tenant_id, sha256, content_type, size_bytes, content) values ($1, $2, 'image/png', $3, $4)`,
      [t.tenantId, mediaHash, mediaBytes.byteLength, mediaBytes],
    );
    const media1Id = (
      await h.admin.query<{ id: string }>(
        `insert into clinical_media (tenant_id, branch_id, patient_id, visit_id, examination_id, kind, angle, content_type, size_bytes, width, height, sha256, object_key, file_name, taken_at, uploaded_by, uploaded_as)
         values ($1, $2, $3, $4, $5, 'photo', 'depan', 'image/png', $6, 100, 100, $7, $8, 'foto-depan.png', now(), $9, 'doctor') returning id`,
        [t.tenantId, t.branchId, ptId, visitId, examId, mediaBytes.byteLength, mediaHash, `tenants/${t.tenantId}/clinical-media/${mediaHash}`, t.doc.staffId],
      )
    ).rows[0].id;
    const media2Id = (
      await h.admin.query<{ id: string }>(
        `insert into clinical_media (tenant_id, branch_id, patient_id, visit_id, examination_id, kind, angle, content_type, size_bytes, width, height, sha256, object_key, file_name, taken_at, uploaded_by, uploaded_as)
         values ($1, $2, $3, $4, $5, 'photo', 'samping', 'image/png', $6, 100, 100, $7, $8, 'foto-samping.png', now(), $9, 'doctor') returning id`,
        [t.tenantId, t.branchId, ptId, visitId, examId, mediaBytes.byteLength, mediaHash, `tenants/${t.tenantId}/clinical-media/${mediaHash}`, t.doc.staffId],
      )
    ).rows[0].id;

    // R3 P0-2: synthetic producer-compatible encrypted lead ("lead.contact") and WhatsApp conversation ("message.contact") + message ("message.body")
    const leadEnc = encryptField(KEK_RING, keys, "lead.contact", `Lead ${sentinel}`);
    await h.admin.query(
      `insert into leads (tenant_id, branch_id, source, patient_id, contact_name_enc, contact_name_dek_ref, contact_phone, stage, created_by, created_as, command_key)
       values ($1, $2, 'whatsapp', $3, $4, 'dek:v1', '+628120000111', 'new', $5, 'fo_cashier', $6)`,
      [t.tenantId, t.branchId, ptId, leadEnc, t.fo.staffId, `lead-exp-${++seq}`],
    );

    const wabaId = (
      await h.admin.query<{ id: string }>(
        `insert into waba_accounts (tenant_id, state, onboarding_channel, meta_waba_id, started_by, started_as, command_key)
         values ($1, 'active', 'cloud_api', $2, $3, 'owner', $4) returning id`,
        [t.tenantId, `${100000 + ++seq}`, t.own.staffId, `waba-exp-${++seq}`],
      )
    ).rows[0].id;
    const pinEnc = encryptField(KEK_RING, keys, "waba.pin", "123456");
    const waNumId = (
      await h.admin.query<{ id: string }>(
        `insert into wa_numbers (tenant_id, waba_id, branch_id, phone_number, phone_number_id, display_name, state, registration_pin_enc, pin_dek_ref, added_by, added_as, registered_at, command_key)
         values ($1, $2, $3, $4, $5, 'Klinik WA Sintetis', 'active', $6, 'dek:v1', $7, 'owner', now(), $8) returning id`,
        [t.tenantId, wabaId, t.branchId, `+6281299900${10 + ++seq}`, `${200000 + ++seq}`, pinEnc, t.own.staffId, `wanum-exp-${++seq}`],
      )
    ).rows[0].id;
    const convNameEnc = encryptField(KEK_RING, keys, "message.contact", `KontakWA ${sentinel}`);
    const convId = (
      await h.admin.query<{ id: string }>(
        `insert into conversations (tenant_id, waba_id, wa_number_id, branch_id, contact_wa_id, contact_name_enc, contact_name_dek_ref, patient_id, state)
         values ($1, $2, $3, $4, $5, $6, 'dek:v1', $7, 'open') returning id`,
        [t.tenantId, wabaId, waNumId, t.branchId, `628130000${100 + ++seq}`, convNameEnc, ptId],
      )
    ).rows[0].id;
    const msgBodyEnc = encryptField(KEK_RING, keys, "message.body", `PesanWA ${sentinel}`);
    await h.admin.query(
      `insert into messages (tenant_id, conversation_id, direction, sent_via, kind, body_enc, body_dek_ref, status)
       values ($1, $2, 'in', 'cloud_api', 'text', $3, 'dek:v1', 'received')`,
      [t.tenantId, convId, msgBodyEnc],
    );

    return { ptId, visitId, examId, rec1Id, rec2Id, media1Id, media2Id, mediaHash };
  }

  beforeAll(async () => {
    h = await createHarness();
    app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 8 });
    owner = testPool({ connectionString: h.ownerUrl(), max: 3 });
    consoleDb = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [VENDOR_GROUP_ROLE])), max: 3 }, VENDOR_GROUP_ROLE);
    opDb = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [OPERATOR_GROUP_ROLE])), max: 3 }, OPERATOR_GROUP_ROLE);
    vendorClient = await h.connectAs(await h.createLoginRole("", [VENDOR_GROUP_ROLE]));
    operatorClient = await h.connectAs(await h.createLoginRole("", [OPERATOR_GROUP_ROLE]));

    const poAcc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('PO', 'po-exp@vendor.test', true) returning id`)).rows[0].id as string;
    const supAcc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('SUP', 'sup-exp@vendor.test', true) returning id`)).rows[0].id as string;
    const c = await owner.connect();
    try {
      await bootstrapVendor(c, poAcc, "Pemilik Platform", "203.0.113.0/24", "Kantor vendor");
      await createVendorStaff(c, { accountId: poAcc, ip: VENDOR_IP, mfaAt: new Date() }, supAcc, "Dukungan Ekspor", ["support"]);
    } finally {
      c.release();
    }
    supportTok = `tok_exp_${randomBytes(12).toString("hex")}`;
    await h.admin.query(
      `insert into auth_session (user_id, token, expires_at, surface, second_factor_at) values ($1, $2, now() + interval '8 hours', 'vendor', now())`,
      [supAcc, supportTok],
    );

    A = await setupTenant("A");
    B = await setupTenant("B");
    seedA = await seedTenantData(A, "SENTINEL_ALPHA_901");
    await seedTenantData(B, "SENTINEL_BETA_902");
  }, 180_000);

  afterAll(async () => {
    await vendorClient?.end();
    await operatorClient?.end();
    await opDb?.end();
    await consoleDb?.end();
    await owner?.end();
    await app?.end();
    await h?.close();
  });

  it("Scenario PR-52 + Findings #1, #4, #6, #8, #9: owner requests with HYG-026 StepUp, least-privilege worker builds archive, guarded release verifies manifest/ZIP & cross-tenant isolation", async () => {
    const proof = stepUpForTests();
    const forged = { verified: true } as unknown as StepUp;

    // Non-owner, forged step-up, and no-2FA owner all refused
    expect(await errCode(as(A.ap, (db) => requestTenantExport(db, `exp-ap-${++seq}`, proof)))).toBe("ERR_FORBIDDEN:owner_only");
    expect(await errCode(as(A.own, (db) => requestTenantExport(db, `exp-forged-${++seq}`, forged)))).toBe("ERR_FORBIDDEN:step_up_required");
    expect(await errCode(as(A.ownNo2fa, (db) => requestTenantExport(db, `exp-no2fa-${++seq}`, proof)))).toBe("ERR_FORBIDDEN:second_factor_required");

    // Bound connection calling unbound worker functions refused (Finding #1 & R3 P2-1: app.roles checked too)
    await expect(as(A.own, (db) => db.query(`select public.export_claim(300)`))).rejects.toThrow("export worker runs unbound");
    const roleOnlyClient = await app.connect();
    try {
      await roleOnlyClient.query(`begin`);
      await roleOnlyClient.query(`select set_config('app.roles', 'owner', true)`);
      await expect(roleOnlyClient.query(`select public.export_claim(300)`)).rejects.toThrow("export worker runs unbound");
      await roleOnlyClient.query(`rollback`);
    } finally {
      roleOnlyClient.release();
    }

    // R3 P1-1: missing key ring fails closed with decrypt_failed instead of publishing "[encrypted]"!
    const failKeyReq = await as(A.own, (db) => requestTenantExport(db, `exp-noring-${++seq}`, proof));
    setKekRingForTests(null);
    try {
      const noRingRes = await runExportWorkerOnce(app);
      expect(noRingRes).toMatchObject({ kind: "failed", exportId: failKeyReq.id, errorCode: "decrypt_failed" });
      const failDbRow = (await h.admin.query<{ state: string; error_code: string }>(`select state, error_code from tenant_exports where id = $1`, [failKeyReq.id])).rows[0];
      expect(failDbRow).toEqual({ state: "failed", error_code: "decrypt_failed" });
    } finally {
      setKekRingForTests(undefined);
    }

    // Owner requests export (with idempotent replay)
    const key = `exp-pr52-${++seq}`;
    const req1 = await as(A.own, (db) => requestTenantExport(db, key, proof));
    expect(req1.replayed).toBe(false);
    const req2 = await as(A.own, (db) => requestTenantExport(db, key, proof));
    expect(req2).toEqual({ id: req1.id, replayed: true });
    // Second distinct request while in-flight refused
    expect(await errCode(as(A.own, (db) => requestTenantExport(db, `exp-dup-${++seq}`, proof)))).toBe("ERR_VERSION_CONFLICT:export_in_progress");

    // Least-privilege clinic_app worker runs using runtime kekRing() default (R3 P1-1)!
    setKekRingForTests(KEK_RING);
    const built = await runExportWorkerOnce(app).finally(() => setKekRingForTests(undefined));
    expect(built.kind).toBe("ready");
    if (built.kind !== "ready") throw new Error("expected ready");
    expect(built.exportId).toBe(req1.id);

    // Owner list shows metadata only
    const listed = await as(A.own, (db) => listTenantExports(db));
    expect(listed.jobs[0].id).toBe(req1.id);
    expect(listed.jobs[0].state).toBe("ready");
    expect(listed.jobs[0].manifestSha256).toBe(built.manifestSha256);

    // Tenant B owner cannot release Tenant A's export (cross-tenant negative)
    const ctxB = await resolveContext(app, B.own.acc, { tenantId: B.tenantId, actingRole: "owner" });
    expect(await errCode(releaseTenantExport(app, ctxB, req1.id, proof))).toBe("ERR_NOT_FOUND:export");

    // Forged step-up on release refused & persists denial audit (Finding #4 & #8)
    const ctxA = await resolveContext(app, A.own.acc, { tenantId: A.tenantId, actingRole: "owner" });
    expect(await errCode(releaseTenantExport(app, ctxA, req1.id, forged))).toBe("ERR_FORBIDDEN:step_up_required");
    const denials = (await h.admin.query(`select count(*)::int as c from audit_events where tenant_id = $1 and object_id = $2 and outcome = 'denied'`, [A.tenantId, req1.id])).rows[0].c;
    expect(denials).toBeGreaterThanOrEqual(1);

    // Valid release succeeds, produces valid ZIP with manifest.json, FHIR, BOTH burst PDFs & media (R3 P0-1),
    // and producer-compatible decrypted lead + WhatsApp sentinels (R3 P0-2) with ZERO "[encrypted]" and ZERO Tenant B!
    const released = await releaseTenantExport(app, ctxA, req1.id, proof);
    const entries = unzipStore(released.zip);
    expect(entries.has("manifest.json")).toBe(true);
    expect(entries.has("fhir/pasien-00001.json")).toBe(true);
    expect(entries.has("csv/pasien.csv")).toBe(true);
    expect(entries.has("csv/lead.csv")).toBe(true);
    expect(entries.has("csv/percakapan.csv")).toBe(true);
    expect(entries.has("csv/pesan_wa.csv")).toBe(true);
    expect(entries.has(`rekam-medis/pasien-00001/rekam-${seedA.rec1Id}-v1.pdf`)).toBe(true);
    expect(entries.has(`rekam-medis/pasien-00001/rekam-${seedA.rec2Id}-v1.pdf`)).toBe(true);
    expect(entries.has(`media/pasien-00001/media-${seedA.media1Id}.png`)).toBe(true);
    expect(entries.has(`media/pasien-00001/media-${seedA.media2Id}.png`)).toBe(true);

    const allText = [...entries.values()].map((b) => Buffer.from(b).toString("utf8")).join("\n");
    expect(allText).toContain("SENTINEL_ALPHA_901");
    expect(allText).toContain("Lead SENTINEL_ALPHA_901");
    expect(allText).toContain("KontakWA SENTINEL_ALPHA_901");
    expect(allText).toContain("PesanWA SENTINEL_ALPHA_901");
    expect(allText).not.toContain("[encrypted]");
    expect(allText).not.toContain("SENTINEL_BETA_902");

    // Verify success audit recorded and download_count incremented
    const okAudits = (await h.admin.query(`select count(*)::int as c from audit_events where tenant_id = $1 and object_id = $2 and outcome = 'success' and reason_code = 'export_released'`, [A.tenantId, req1.id])).rows[0].c;
    expect(okAudits).toBe(1);

    // Expire ready export past 24h -> bytes nulled, state='expired', purged_at set, release refused ERR_EXPIRED!
    // Capture clock_timestamp() once so expires_at = completed_at + interval '24 hours' holds to the microsecond.
    await h.admin.query(`alter table tenant_exports disable trigger tenant_exports_guard`);
    await h.admin.query(
      `with ts as (select clock_timestamp() as t)
       update tenant_exports
          set completed_at = ts.t - interval '25 hours',
              expires_at = ts.t - interval '1 hour'
         from ts
        where id = $1`,
      [req1.id],
    );
    await h.admin.query(`alter table tenant_exports enable always trigger tenant_exports_guard`);

    // Direct SQL definer export_release_load MUST refuse before returning any expired file bytes (Finding #5 & #7)
    expect(await errCode(as(A.own, (db) => db.query(`select * from public.export_release_load($1)`, [req1.id])))).toBe("ERR_EXPIRED: expired");
    expect(await errCode(releaseTenantExport(app, ctxA, req1.id, proof))).toBe("ERR_EXPIRED:expired");
    const expRes = await runExportExpireBatch(app);
    expect(expRes.expiredReady).toBe(1);
    const afterExp = (await h.admin.query<{ state: string; purged_at: string | null }>(`select state, purged_at from tenant_exports where id = $1`, [req1.id])).rows[0];
    expect(afterExp.state).toBe("expired");
    expect(afterExp.purged_at).not.toBeNull();
    const nonNullBytes = (await h.admin.query<{ c: number }>(`select count(*)::int as c from tenant_export_files where export_id = $1 and bytes is not null`, [req1.id])).rows[0].c;
    expect(nonNullBytes).toBe(0);
  });

  it("Finding #2 (generation fencing), #3 (closed tenant), #5 (failed purge), #6 (tamper), and #1 (TEN-19 never)", async () => {
    const proof = stepUpForTests();
    const ctxB = await resolveContext(app, B.own.acc, { tenantId: B.tenantId, actingRole: "owner" });

    // 1. Finding #2: Worker A puts stale gen-1 file -> lease expires -> Worker B claims gen-2 -> A's stale put/finish refused -> B publishes ONLY gen-2 bytes & gen-1 bytes reclaimed!
    const { id: genExpId } = await as(B.own, (db) => requestTenantExport(db, `exp-gen-${++seq}`, proof));
    const c1 = await app.connect();
    try {
      const claim1 = (await c1.query<{ r: { id: string; generation: number } }>(`select public.export_claim(60) as r`)).rows[0].r;
      expect(claim1.id).toBe(genExpId);
      expect(claim1.generation).toBe(1);
      const staleBytes = Buffer.from("STALE-GEN-1", "utf8");
      await c1.query(`select public.export_put_file($1, 1, 'csv/stale.csv', 'csv', $2, $3)`, [genExpId, sha256(staleBytes), staleBytes]);

      // Expire gen-1 lease -> Worker B claims gen-2
      await h.admin.query(`update tenant_exports set lease_until = clock_timestamp() - interval '1 second' where id = $1`, [genExpId]);
      const claim2 = (await c1.query<{ r: { id: string; generation: number } }>(`select public.export_claim(300) as r`)).rows[0].r;
      expect(claim2.id).toBe(genExpId);
      expect(claim2.generation).toBe(2);

      // Worker A's stale gen-1 put & finish MUST be refused!
      await expect(c1.query(`select public.export_put_file($1, 1, 'csv/late.csv', 'csv', $2, $3)`, [genExpId, sha256(staleBytes), staleBytes])).rejects.toThrow("lease_lost");

      const goodBytes = Buffer.from("GOOD-GEN-2", "utf8");
      await c1.query(`select public.export_put_file($1, 2, 'csv/good.csv', 'csv', $2, $3)`, [genExpId, sha256(goodBytes), goodBytes]);
      // R3 P2-3: skewed completed_at (> 60s off DB wall clock) MUST be refused!
      const skewedAt = new Date(Date.now() + 5 * 60_000);
      const mSkew = buildManifest({ tenantId: B.tenantId, exportId: genExpId, generation: 2, completedAt: skewedAt, files: [{ path: "csv/good.csv", kind: "csv", bytes: goodBytes }] });
      const mSkewJson = manifestJsonString(mSkew);
      await expect(
        c1.query(`select public.export_finish($1, 2, $2, $3, $4)`, [genExpId, skewedAt, mSkewJson, sha256(mSkewJson)]),
      ).rejects.toThrow("completed_at_skew");

      const completedAt = (await c1.query<{ now: Date }>(`select clock_timestamp() as now`)).rows[0].now;
      const m = buildManifest({ tenantId: B.tenantId, exportId: genExpId, generation: 2, completedAt, files: [{ path: "csv/good.csv", kind: "csv", bytes: goodBytes }] });
      const mJson = manifestJsonString(m);
      await c1.query(`select public.export_finish($1, 2, $2, $3, $4)`, [genExpId, completedAt, mJson, sha256(mJson)]);
    } finally {
      c1.release();
    }

    // Gen-1 bytes were reclaimed immediately on finish; released ZIP contains ONLY gen-2!
    const gen1Alive = (await h.admin.query<{ c: number }>(`select count(*)::int as c from tenant_export_files where export_id = $1 and generation = 1 and bytes is not null`, [genExpId])).rows[0].c;
    expect(gen1Alive).toBe(0);
    const zipB = unzipStore((await releaseTenantExport(app, ctxB, genExpId, proof)).zip);
    expect([...zipB.keys()]).toEqual(["manifest.json", "csv/good.csv"]);

    // 2. Finding #6: coordinated byte+row-hash tamper refused BEFORE streaming with zero new success audit & surviving denial audit!
    const beforeOk = (await h.admin.query<{ c: number }>(`select count(*)::int as c from audit_events where tenant_id = $1 and object_id = $2 and outcome = 'success' and reason_code = 'export_released'`, [B.tenantId, genExpId])).rows[0].c;
    const tampered = Buffer.from("EVIL-GEN-2", "utf8");
    await h.admin.query(`alter table tenant_export_files disable trigger tenant_export_files_guard`);
    await h.admin.query(`update tenant_export_files set bytes = $2, sha256 = $3, size = $4 where export_id = $1 and generation = 2`, [genExpId, tampered, sha256(tampered), tampered.byteLength]);
    await h.admin.query(`alter table tenant_export_files enable always trigger tenant_export_files_guard`);
    expect(await errCode(releaseTenantExport(app, ctxB, genExpId, proof))).toContain("ERR_VERSION_CONFLICT:manifest_integrity");
    const afterOk = (await h.admin.query<{ c: number }>(`select count(*)::int as c from audit_events where tenant_id = $1 and object_id = $2 and outcome = 'success' and reason_code = 'export_released'`, [B.tenantId, genExpId])).rows[0].c;
    expect(afterOk).toBe(beforeOk);

    // 3. Finding #3: suspended & exit allowed; closed tenant refused on list, request/replay, and release (even with ready archive!), while export_expire still purges!
    await h.admin.query(`update tenants_registry set lifecycle_state = 'suspended' where id = $1`, [B.tenantId]);
    expect((await as(B.own, (db) => listTenantExports(db))).jobs.length).toBeGreaterThan(0);
    await h.admin.query(`update tenants_registry set lifecycle_state = 'exit' where id = $1`, [B.tenantId]);
    expect((await as(B.own, (db) => listTenantExports(db))).jobs.length).toBeGreaterThan(0);
    await h.admin.query(`update tenants_registry set lifecycle_state = 'closed' where id = $1`, [B.tenantId]);
    expect(await errCode(as(B.own, (db) => listTenantExports(db)))).toBe("ERR_VERSION_CONFLICT:tenant_closed");
    expect(await errCode(as(B.own, (db) => requestTenantExport(db, `exp-closed-${++seq}`, proof)))).toBe("ERR_VERSION_CONFLICT:tenant_closed");
    expect(await errCode(releaseTenantExport(app, ctxB, genExpId, proof))).toBe("ERR_VERSION_CONFLICT:tenant_closed");
    await h.admin.query(`update tenants_registry set lifecycle_state = 'live' where id = $1`, [B.tenantId]);

    // 4. Finding #5: failed export past 24h keeps state='failed' + error_code while purging bytes & setting purged_at!
    const { id: failExpId } = await as(B.own, (db) => requestTenantExport(db, `exp-fail-${++seq}`, proof));
    const c2 = await app.connect();
    try {
      const cl = (await c2.query<{ r: { id: string; generation: number } }>(`select public.export_claim(60) as r`)).rows[0].r;
      const part = Buffer.from("PARTIAL-FAILED", "utf8");
      await c2.query(`select public.export_put_file($1, $2, 'csv/part.csv', 'csv', $3, $4)`, [cl.id, cl.generation, sha256(part), part]);
      await c2.query(`select public.export_fail($1, $2, 'simulated_boom')`, [cl.id, cl.generation]);
    } finally {
      c2.release();
    }
    await h.admin.query(`alter table tenant_exports disable trigger tenant_exports_guard`);
    await h.admin.query(`update tenant_exports set requested_at = clock_timestamp() - interval '25 hours' where id = $1`, [failExpId]);
    await h.admin.query(`alter table tenant_exports enable always trigger tenant_exports_guard`);

    const pFail = await runExportExpireBatch(app);
    expect(pFail.purgedFailed).toBe(1);
    const fRow = (await h.admin.query<{ state: string; error_code: string; purged_at: string | null }>(`select state, error_code, purged_at from tenant_exports where id = $1`, [failExpId])).rows[0];
    expect(fRow.state).toBe("failed");
    expect(fRow.error_code).toBe("simulated_boom");
    expect(fRow.purged_at).not.toBeNull();
    expect((await h.admin.query<{ c: number }>(`select count(*)::int as c from tenant_export_files where export_id = $1 and bytes is not null`, [failExpId])).rows[0].c).toBe(0);

    // 5. Finding #1: TEN-19 'never' + zero direct table grants to clinic_app, clinic_vendor, clinic_operator (even in active support session!)
    const sok = (await h.admin.query<{ table_name: string; support_class: string }>(`select table_name, support_class from support_object_kinds where table_name in ('public.tenant_exports','public.tenant_export_files') order by 1`)).rows;
    expect(sok).toEqual([
      { table_name: "public.tenant_export_files", support_class: "never" },
      { table_name: "public.tenant_exports", support_class: "never" },
    ]);
    for (const [label, q] of [
      ["app", (sql: string) => as(A.own, (db) => db.query(sql))],
      ["vendor", (sql: string) => vendorClient.query(sql)],
      ["operator", (sql: string) => operatorClient.query(sql)],
    ] as const) {
      await expect(q(`select * from tenant_exports`), `${label} tenant_exports`).rejects.toMatchObject({ code: "42501" });
      await expect(q(`select * from tenant_export_files`), `${label} tenant_export_files`).rejects.toMatchObject({ code: "42501" });
    }
    const sess = await openSession(consoleDb, { token: supportTok, ip: VENDOR_IP }, {
      tenantId: A.tenantId,
      purpose: "Uji negatif TEN-19 never pada ekspor tenant",
      scope: ["public.branches"],
      minutes: 30,
    });
    expect(sess.ok).toBe(true);
    if (sess.ok) {
      await expect(
        withSupportSession(consoleDb, opDb, { token: supportTok, ip: VENDOR_IP }, sess.data.id, (db) => db.query(`select * from tenant_exports`)),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        withSupportSession(consoleDb, opDb, { token: supportTok, ip: VENDOR_IP }, sess.data.id, (db) => db.query(`select * from tenant_export_files`)),
      ).rejects.toMatchObject({ code: "42501" });
    }
  });
});
