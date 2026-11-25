// T-125 (PR-66, UX-50, UX-51, DEC-130): Doctor listing with affirmative consent & immediate purge on withdrawal.
// Tests run against real PostgreSQL with full RLS & migration 0138.
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleDoctorPhotoGet } from "../../src/app/api/v1/public/doctor-photo/[slug]/[doctor]/handler";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { assignBranch, assignRole, createMembership } from "../../src/modules/org/identity";
import {
  approvePublicWebReview,
  getPublicWebReviewSource,
  grantDoctorListingConsent,
  listDoctorListingConsents,
  publishPublicSite,
  resolvePublicDoctorDetail,
  resolvePublicDoctorsBySlug,
  savePublicWebField,
  saveSiteSettings,
  validateDoctorPublicCopy,
  withdrawDoctorListingConsent,
} from "../../src/modules/public-site";
import {
  createMockPublicBookingOtpPort,
  getPublicBookingCatalog,
  getPublicBookingSlots,
  requestPublicBookingOtp,
  verifyPublicBookingOtpAndBook,
} from "../../src/modules/public-site/booking/db";
import { createHarness, testPool } from "../rls/harness";

const VALID_PHOTO_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("synthetic-doctor-portrait-png-fixture-t125", "utf8"),
]);
const REPLACEMENT_PHOTO_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("replacement-doctor-portrait-png-fixture-t125-v2", "utf8"),
]);
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const LOCAL_ENV = { DEPLOY_ENV: "local" };

function nextMondayDateStr(): string {
  const now = new Date();
  const d = new Date(now.getTime() + 7 * 3600_000);
  d.setUTCDate(d.getUTCDate() + 2);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

describe("T-125: Doctor listing with consent & immediate purge (PR-66)", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  let appPool: pg.Pool;
  let ownerPool: pg.Pool;

  // Tenant A fixtures
  let tenantA: string;
  let slugA: string;
  let branchA1: string;
  let branchA2: string;
  let ownerA: string;
  let fhA1: string;
  let fhA2: string;
  let foA: string;
  let docA1: string;
  let docA1Membership: string;
  let docA2: string;
  let dualOwnerDocA: string;
  let evItemA: string;
  let issuedPhotoUrlA1 = "";
  const slotDate = nextMondayDateStr();

  // Tenant B fixtures (cross-tenant isolation)
  let tenantB: string;
  let ownerB: string;
  let docB1: string;

  async function seedClinic(tag: string) {
    const t = (
      await h.admin.query<{ id: string }>(
        `INSERT INTO tenants_registry (lifecycle_state) VALUES ('live') RETURNING id`,
      )
    ).rows[0].id;
    await h.admin.query(
      `INSERT INTO tenants (id, legal_name, sak_framework) VALUES ($1, $2, 'emkm')`,
      [t, `PT Klinik Dokter ${tag}`],
    );
    const b1 = (
      await h.admin.query<{ id: string }>(
        `INSERT INTO branches (tenant_id, code, name, timezone, address, whatsapp_number, publish_from)
         VALUES ($1, 'senopati', 'Cabang Senopati', 'Asia/Jakarta', 'Jl. Senopati 1', '+6281234567890', clock_timestamp() - interval '1 day')
         RETURNING id`,
        [t],
      )
    ).rows[0].id;
    const b2 = (
      await h.admin.query<{ id: string }>(
        `INSERT INTO branches (tenant_id, code, name, timezone, address, whatsapp_number, publish_from)
         VALUES ($1, 'bsd', 'Cabang BSD', 'Asia/Jakarta', 'Jl. BSD Raya 2', '+6281234567891', clock_timestamp() - interval '1 day')
         RETURNING id`,
        [t],
      )
    ).rows[0].id;
    for (const b of [b1, b2]) {
      await h.admin.query(
        `INSERT INTO branch_hours (tenant_id, branch_id, weekday, opens, closes) VALUES ($1, $2, 1, '09:00', '17:00')`,
        [t, b],
      );
      await h.admin.query(
        `INSERT INTO rooms (tenant_id, branch_id, name, kind, is_active) VALUES ($1, $2, 'Ruang Konsultasi 1', 'treatment', true)`,
        [t, b],
      );
    }

    const makeStaff = async (
      name: string,
      email: string,
      roles: ("owner" | "facility_head" | "fo_cashier" | "doctor")[],
      branchIds: string[] = [],
    ) => {
      const acc = (
        await h.admin.query<{ id: string }>(
          `INSERT INTO auth_user (name, email, two_factor_enabled) VALUES ($1, $2, true) RETURNING id`,
          [name, email],
        )
      ).rows[0].id;
      const { staffId, membershipId } = await createMembership(ownerPool, {
        tenantId: t,
        accountId: acc,
        displayName: name,
      });
      const c = await ownerPool.connect();
      try {
        for (const role of roles) {
          const rid = await assignRole(c, { tenantId: t, staffId, role });
          if (role !== "owner") {
            for (const bid of branchIds) {
              await assignBranch(c, { tenantId: t, staffRoleId: rid, branchId: bid });
            }
          }
        }
      } finally {
        c.release();
      }
      return { staffId, membershipId };
    };

    const ow = await makeStaff(`Owner ${tag}`, `owner.${tag}@dokter.test`, ["owner", "fo_cashier"], [b1]);
    const fh1 = await makeStaff(`PJ Senopati ${tag}`, `fh1.${tag}@dokter.test`, ["facility_head"], [b1]);
    const fh2 = await makeStaff(`PJ BSD ${tag}`, `fh2.${tag}@dokter.test`, ["facility_head"], [b2]);
    const fo = await makeStaff(`FO ${tag}`, `fo.${tag}@dokter.test`, ["fo_cashier"], [b1]);
    const d1 = await makeStaff(`dr. Nadia Santoso ${tag}`, `d1.${tag}@dokter.test`, ["doctor"], [b1]);
    const d2 = await makeStaff(`dr. Bima Pratama ${tag}`, `d2.${tag}@dokter.test`, ["doctor"], [b2]);
    const dual = await makeStaff(`dr. Owner Rangkap ${tag}`, `dual.${tag}@dokter.test`, ["owner", "doctor"], [b1]);

    // Shifts for doctor 1 on branch 1 for booking hook tests
    await h.admin.query(
      `INSERT INTO staff_shifts (tenant_id, branch_id, staff_id, shift_date, starts, ends, kind, created_by)
       VALUES ($1, $2, $3, $4::date, '09:00', '17:00', 'work', $5)`,
      [t, b1, d1.staffId, slotDate, ow.staffId],
    );

    // Credentials for doc 1: one verified active SIP on b1, one expired SIP on b1, one future-effective verified SIP on b1, one pending SIP on b1
    const credIds = (
      await h.admin.query<{ id: string; number: string }>(
        `INSERT INTO staff_credentials (tenant_id, staff_id, kind, number, issuer, profession, branch_id, valid_from, expires_on, state, recorded_by)
         VALUES
           ($1, $2, 'sip', 'SIP-503/DKI/2026/001', 'Dinkes DKI', 'dokter', $3, '2025-01-01', '2029-12-31', 'pending', $4),
           ($1, $2, 'sip', 'SIP-EXPIRED-999', 'Dinkes DKI', 'dokter', $3, '2020-01-01', '2024-01-01', 'pending', $4),
           ($1, $2, 'sip', 'SIP-FUTURE-888', 'Dinkes DKI', 'dokter', $3, '2029-01-01', '2032-12-31', 'pending', $4),
           ($1, $2, 'sip', 'SIP-PENDING-777', 'Dinkes DKI', 'dokter', $3, '2026-01-01', '2030-01-01', 'pending', $4)
         RETURNING id, number`,
        [t, d1.staffId, b1, fh1.staffId],
      )
    ).rows;
    const toVerify = credIds.filter((c) => c.number !== "SIP-PENDING-777").map((c) => c.id);
    await h.admin.query(
      `UPDATE staff_credentials SET state = 'verified', decided_by = $1, decided_at = clock_timestamp() WHERE id = ANY($2::uuid[])`,
      [ow.staffId, toVerify],
    );

    // Q-15 counsel approval
    const pdf = Buffer.from(`%PDF-1.4 counsel ${tag}`);
    const sha = createHash("sha256").update(pdf).digest("hex");
    const evItem = (
      await h.admin.query<{ id: string }>(
        `INSERT INTO evidence_items (tenant_id, obligation_key, state, valid_until)
         VALUES ($1, 'public_site_counsel', 'approved', '2030-12-31') RETURNING id`,
        [t],
      )
    ).rows[0].id;
    const evFile = (
      await h.admin.query<{ id: string }>(
        `INSERT INTO evidence_files (tenant_id, item_id, version, file_name, media_type, size_bytes, sha256, content, expert_name, document_date, uploaded_by, uploaded_as, uploaded_name)
         VALUES ($1, $2, 1, 'counsel.pdf', 'application/pdf', $3, $4, $5, 'Konsultan Hukum', '2026-11-20', $6, 'owner', 'Owner') RETURNING id`,
        [t, evItem, pdf.byteLength, sha, pdf, ow.staffId],
      )
    ).rows[0].id;
    await h.admin.query(
      `INSERT INTO evidence_approvals (tenant_id, item_id, file_id, decision, valid_until, decided_by, decided_as, decided_name)
       VALUES ($1, $2, $3, 'approved', '2030-12-31', $4, 'owner', 'Owner')`,
      [t, evItem, evFile, ow.staffId],
    );

    // Doctor-performed online-bookable service
    const svcId = (
      await h.admin.query<{ id: string }>(
        `INSERT INTO catalog_items (tenant_id, kind, code, created_by) VALUES ($1, 'service', $2, $3) RETURNING id`,
        [t, `KONS-${tag.toUpperCase()}`, ow.staffId],
      )
    ).rows[0].id;
    const verId = (
      await h.admin.query<{ id: string }>(
        `INSERT INTO catalog_versions (tenant_id, item_id, version, state, name, tax_category, tax_basis, normal_price, category, treatment_min, online_bookable, contraindications, reason, created_by, created_as)
         VALUES ($1, $2, 1, 'active', 'Konsultasi Dokter Kulit', 'taxable_service', 'Jasa medis', 250000, 'facial', 30, true, 'Tidak ada kontraindikasi khusus.', 'Seed T-125', $3, 'owner') RETURNING id`,
        [t, svcId, ow.staffId],
      )
    ).rows[0].id;
    await h.admin.query(`INSERT INTO branch_services (tenant_id, branch_id, item_id) VALUES ($1, $2, $3)`, [t, b1, svcId]);
    await h.admin.query(
      `INSERT INTO service_resources (tenant_id, version_id, kind, code, required) VALUES ($1, $2, 'room', 'treatment', true)`,
      [t, verId],
    );
    await h.admin.query(
      `INSERT INTO service_staff_eligibility (tenant_id, version_id, role, mode) VALUES ($1, $2, 'doctor', 'performs')`,
      [t, verId],
    );

    const slug = `klinik-dokter-${tag}`;
    await withTenantContext(appPool, { tenantId: t, staffId: ow.staffId, roles: ["owner"], allowedBranchIds: "*" }, async (db) => {
      await saveSiteSettings(db, {
        slug,
        brandName: `Klinik Estetika ${tag.toUpperCase()}`,
        accentHex: "#007AFF",
        oneLine: "Perawatan berbasis evaluasi dokter.",
        showTreatments: true,
        showBranches: true,
        showDoctors: true,
        tariffListAllowed: false,
        doctorTitlesAllowed: false,
      });
      await savePublicWebField(db, {
        itemId: svcId,
        publicSlug: "konsultasi-dokter",
        published: true,
        publishPrice: false,
        purpose: "Evaluasi kondisi kulit secara medis bersama dokter.",
        performedBy: "Dokter klinik berizin praktik",
      });
      const rev = await getPublicWebReviewSource(db, svcId);
      await approvePublicWebReview(db, svcId, { version: rev.activeVersion, artifactSha256: rev.artifactSha256 });
      const pub = await publishPublicSite(db);
      if (!pub.ok) throw new Error(`Publish ${tag} failed: ${pub.reason}`);
    });

    return { t, slug, b1, b2, ow: ow.staffId, fh1: fh1.staffId, fh2: fh2.staffId, fo: fo.staffId, d1, d2, dual: dual.staffId, svcId, evItem };
  }

  beforeAll(async () => {
    process.env.DEPLOY_ENV = "local";
    h = await createHarness();
    const appUrl = h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE]));
    appPool = await openAppPool({ connectionString: appUrl, max: 6 });
    ownerPool = testPool({ connectionString: h.ownerUrl(), max: 3 });

    const a = await seedClinic("alpha");
    tenantA = a.t;
    slugA = a.slug;
    branchA1 = a.b1;
    branchA2 = a.b2;
    ownerA = a.ow;
    fhA1 = a.fh1;
    fhA2 = a.fh2;
    foA = a.fo;
    docA1 = a.d1.staffId;
    docA1Membership = a.d1.membershipId;
    docA2 = a.d2.staffId;
    dualOwnerDocA = a.dual;
    evItemA = a.evItem;

    const b = await seedClinic("beta");
    tenantB = b.t;
    ownerB = b.ow;
    docB1 = b.d1.staffId;
  }, 60_000);

  afterAll(async () => {
    await ownerPool?.end();
    await appPool?.end();
    await h?.close();
  });

  it("PR-65 Permenkes 1787/2010 copy lint rejects promotional/superlative/evasion text and invalid photo refs", () => {
    expect(validateDoctorPublicCopy({
      publicSlug: "dr-nadia",
      displayName: "dr. Nadia Santoso",
      title: "Sp.DVE",
      scheduleSummary: "Senin–Jumat 09.00–17.00 WIB",
      focusAreas: ["Dermatologi medis", "Perawatan jerawat"],
      showPhoto: true,
      photoBytes: VALID_PHOTO_BYTES,
      photoMediaType: "image/png",
    })).toEqual({ ok: true });

    // Superlative + zero-width evasion
    expect(validateDoctorPublicCopy({
      publicSlug: "dr-nadia",
      displayName: "dr. Nadia T\u200berbaik",
    }).ok).toBe(false);
    // Promo & discount in focus area
    expect(validateDoctorPublicCopy({
      publicSlug: "dr-nadia",
      displayName: "dr. Nadia Santoso",
      focusAreas: ["Paket hemat konsultasi"],
    }).ok).toBe(false);
    // Testimonial / star rating
    expect(validateDoctorPublicCopy({
      publicSlug: "dr-nadia",
      displayName: "dr. Nadia Santoso",
      scheduleSummary: "Rating bintang 5 dari pasien",
    }).ok).toBe(false);
    // Price in text
    expect(validateDoctorPublicCopy({
      publicSlug: "dr-nadia",
      displayName: "dr. Nadia Santoso",
      scheduleSummary: "Konsultasi mulai Rp 250.000",
    }).ok).toBe(false);
    // photoBytes while showPhoto=false
    expect(validateDoctorPublicCopy({
      publicSlug: "dr-nadia",
      displayName: "dr. Nadia Santoso",
      showPhoto: false,
      photoBytes: VALID_PHOTO_BYTES,
      photoMediaType: "image/png",
    }).ok).toBe(false);
    // Invalid image magic bytes
    expect(validateDoctorPublicCopy({
      publicSlug: "dr-nadia",
      displayName: "dr. Nadia Santoso",
      showPhoto: true,
      photoBytes: Buffer.from("<html>not-an-image</html>", "utf8"),
      photoMediaType: "image/png",
    }).ok).toBe(false);
    // Promotional / superlative publicSlug handle rejected (PR-65 finding #5), factual handle accepted
    const badSlug1 = validateDoctorPublicCopy({
      publicSlug: "dokter-terbaik",
      displayName: "dr. Nadia Santoso",
    });
    expect(badSlug1.ok).toBe(false);
    if (!badSlug1.ok) {
      expect(badSlug1.code).toBe("forbidden_promotional_copy");
      expect(badSlug1.violations.some((v) => v.field === "publicSlug" && v.rule === "superlatif")).toBe(true);
    }
    expect(validateDoctorPublicCopy({
      publicSlug: "dr-paling-ampuh",
      displayName: "dr. Nadia Santoso",
    }).ok).toBe(false);
    expect(validateDoctorPublicCopy({
      publicSlug: "dr-nadia-santoso",
      displayName: "dr. Nadia Santoso",
    })).toEqual({ ok: true });
  });

  it("Scenario PR-66 doctor consent: doctor without listing consent does not appear anywhere publicly", async () => {
    const docs = await resolvePublicDoctorsBySlug(slugA, appPool);
    expect(docs).toEqual([]);

    const detail = await resolvePublicDoctorDetail(slugA, "dr-nadia", appPool);
    expect(detail).toEqual({ state: "not_found" });

    const cat = await getPublicBookingCatalog(appPool, slugA);
    expect(cat.state).toBe("open");
    if (cat.state === "open") {
      expect(cat.doctors).toEqual([]);
    }

    const slots = await getPublicBookingSlots(appPool, {
      slug: slugA,
      treatmentSlug: "konsultasi-dokter",
      branchSlug: "senopati",
      date: slotDate,
      doctorSlug: "dr-nadia",
    });
    expect(slots.slots).toEqual([]);
  });

  it("enforces acting-role, delegated acknowledgement, branch scope, unbound guard, and TEN-19/TEN-17 boundaries", async () => {
    // 1. Owner acting as front_office cannot grant doctor listing consent
    await expect(
      withTenantContext(
        appPool,
        { tenantId: tenantA, staffId: ownerA, roles: ["fo_cashier"], activeBranchId: branchA1, allowedBranchIds: [branchA1] },
        (db) =>
          grantDoctorListingConsent(db, {
            staffId: docA1,
            publicSlug: "dr-nadia",
            displayName: "dr. Nadia Santoso",
            acknowledgementRef: "CONSENT-DOC-001",
          }),
      ),
    ).rejects.toThrow(/ERR_FORBIDDEN/);

    // 2. Front office cannot grant or list consents
    await expect(
      withTenantContext(
        appPool,
        { tenantId: tenantA, staffId: foA, roles: ["fo_cashier"], activeBranchId: branchA1, allowedBranchIds: [branchA1] },
        (db) => listDoctorListingConsents(db),
      ),
    ).rejects.toThrow(/ERR_FORBIDDEN/);

    // 3. Delegated grant without acknowledgement_ref is refused
    await expect(
      withTenantContext(appPool, { tenantId: tenantA, staffId: ownerA, roles: ["owner"], allowedBranchIds: "*" }, (db) =>
        grantDoctorListingConsent(db, {
          staffId: docA1,
          publicSlug: "dr-nadia",
          displayName: "dr. Nadia Santoso",
        }),
      ),
    ).rejects.toThrow(/ERR_INVALID_INPUT: delegated consent requires acknowledgement_ref/);

    // 3b. Dual-role doctor+owner acting as 'owner' targeting own staff_id WITHOUT acknowledgement_ref is refused (finding #2),
    //     while acting as 'doctor' targeting own staff_id succeeds without acknowledgement_ref!
    await expect(
      withTenantContext(appPool, { tenantId: tenantA, staffId: dualOwnerDocA, roles: ["owner"], allowedBranchIds: "*" }, (db) =>
        grantDoctorListingConsent(db, {
          staffId: dualOwnerDocA,
          publicSlug: "dr-owner-rangkap",
          displayName: "dr. Owner Rangkap",
        }),
      ),
    ).rejects.toThrow(/ERR_INVALID_INPUT: delegated consent requires acknowledgement_ref/);

    const selfDualGrant = await withTenantContext(
      appPool,
      { tenantId: tenantA, staffId: dualOwnerDocA, roles: ["doctor"], activeBranchId: branchA1, allowedBranchIds: [branchA1] },
      (db) =>
        grantDoctorListingConsent(db, {
          staffId: dualOwnerDocA,
          publicSlug: "dr-owner-rangkap",
          displayName: "dr. Owner Rangkap",
        }),
    );
    expect(selfDualGrant.state).toBe("granted");
    // Immutability check (finding #4): rewriting consent id during withdrawal is rejected!
    await expect(
      h.admin.query(
        `UPDATE public.doctor_listing_consents
            SET id = uuid_generate_v7(),
                state = 'withdrawn',
                photo_ref = NULL,
                withdrawn_at = clock_timestamp(),
                withdrawn_by = $1,
                withdrawn_as = 'doctor'
          WHERE id = $2`,
        [dualOwnerDocA, selfDualGrant.id],
      ),
    ).rejects.toThrow(/ERR_IMMUTABLE: consent provenance is immutable/);
    await withTenantContext(
      appPool,
      { tenantId: tenantA, staffId: dualOwnerDocA, roles: ["doctor"], activeBranchId: branchA1, allowedBranchIds: [branchA1] },
      (db) => withdrawDoctorListingConsent(db, dualOwnerDocA, "cleanup_dual_role_test"),
    );

    // 4. Facility head of BSD (branchA2) cannot grant consent for Senopati doctor (docA1)
    await expect(
      withTenantContext(
        appPool,
        { tenantId: tenantA, staffId: fhA2, roles: ["facility_head"], activeBranchId: branchA2, allowedBranchIds: [branchA2] },
        (db) =>
          grantDoctorListingConsent(db, {
            staffId: docA1,
            publicSlug: "dr-nadia",
            displayName: "dr. Nadia Santoso",
            acknowledgementRef: "CONSENT-FH2",
          }),
      ),
    ).rejects.toThrow(/ERR_FORBIDDEN/);

    // 5. Reserved slug rejected by SQL (public_site_reserved_slugs)
    await expect(
      withTenantContext(
        appPool,
        { tenantId: tenantA, staffId: docA1, roles: ["doctor"], activeBranchId: branchA1, allowedBranchIds: [branchA1] },
        (db) =>
          grantDoctorListingConsent(db, {
            staffId: docA1,
            publicSlug: "vendor",
            displayName: "dr. Nadia Santoso",
          }),
      ),
    ).rejects.toThrow(/ERR_INVALID_INPUT: invalid_public_slug/);

    // 5b. Finding #4 (r3) + Parity Corpus (r4 Finding #2): Run a shared accepted/rejected corpus across ALL 7 PR-65
    //     Permenkes 1787/2010 rule families & ALL 5 fields against BOTH validateDoctorPublicCopy() AND direct SQL
    //     doctor_listing_grant (bypassing the TS adapter) to prove 100% parity!
    const parityCorpus: {
      label: string;
      accepted: boolean;
      slug: string;
      name: string;
      title: string | null;
      schedule: string | null;
      areas: string[];
    }[] = [
      { label: "superlatif-slug", accepted: false, slug: "dokter-terbaik", name: "dr. Nadia Santoso", title: null, schedule: null, areas: [] },
      { label: "superlatif-zero-width-name", accepted: false, slug: "dr-nadia-p1", name: "dr. Nadia T\u200berbaik", title: null, schedule: null, areas: [] },
      { label: "perbandingan-title", accepted: false, slug: "dr-nadia-p2", name: "dr. Nadia Santoso", title: "Lebih baik dari klinik lain", schedule: null, areas: [] },
      { label: "janji-hasil-schedule", accepted: false, slug: "dr-nadia-p3", name: "dr. Nadia Santoso", title: "Sp.DVE", schedule: "Dijamin hasil instan tanpa risiko", areas: [] },
      { label: "promo-diskon-area", accepted: false, slug: "dr-nadia-p4", name: "dr. Nadia Santoso", title: "Sp.DVE", schedule: "Senin 09.00 WIB", areas: ["Paket hemat konsultasi"] },
      { label: "promo-cicilan-0-pct", accepted: false, slug: "dr-nadia-p8", name: "dr. Nadia Santoso", title: "Sp.DVE", schedule: "Cicilan 0%", areas: [] },
      { label: "testimoni-area", accepted: false, slug: "dr-nadia-p5", name: "dr. Nadia Santoso", title: "Sp.DVE", schedule: "Senin 09.00 WIB", areas: ["Rating bintang 5 pasien"] },
      { label: "sebelum-sesudah-schedule", accepted: false, slug: "dr-nadia-p6", name: "dr. Nadia Santoso", title: "Sp.DVE", schedule: "Lihat foto sebelum dan sesudah", areas: [] },
      { label: "harga-di-teks-area", accepted: false, slug: "dr-nadia-p7", name: "dr. Nadia Santoso", title: "Sp.DVE", schedule: "Senin 09.00 WIB", areas: ["Mulai Rp 250.000"] },
      { label: "factual-all-fields", accepted: true, slug: "dr-nadia-faktual", name: "dr. Nadia Santoso", title: "Sp.DVE", schedule: "Senin–Jumat 09.00–17.00 WIB", areas: ["Dermatologi medis", "Evaluasi jerawat"] },
    ];
    for (const c of parityCorpus) {
      const tsRes = validateDoctorPublicCopy({
        publicSlug: c.slug,
        displayName: c.name,
        title: c.title,
        scheduleSummary: c.schedule,
        focusAreas: c.areas,
      });
      expect(tsRes.ok, `TS parity ${c.label}`).toBe(c.accepted);

      const sqlCall = withTenantContext(
        appPool,
        { tenantId: tenantA, staffId: docA1, roles: ["doctor"], activeBranchId: branchA1, allowedBranchIds: [branchA1] },
        (db) =>
          db.query(
            `SELECT public.doctor_listing_grant($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text[], false, NULL, NULL, false, NULL)`,
            [docA1, c.slug, c.name, c.title, c.schedule, c.areas],
          ),
      );
      if (c.accepted) {
        await expect(sqlCall, `SQL parity accept ${c.label}`).resolves.toBeTruthy();
        await withTenantContext(
          appPool,
          { tenantId: tenantA, staffId: docA1, roles: ["doctor"], activeBranchId: branchA1, allowedBranchIds: [branchA1] },
          (db) => withdrawDoctorListingConsent(db, docA1, "cleanup_parity_test"),
        );
      } else {
        await expect(sqlCall, `SQL parity reject ${c.label}`).rejects.toThrow(/ERR_INVALID_INPUT: forbidden_promotional_copy/);
      }
    }

    // 6. Public doctor readers refuse tenant-bound connections
    await expect(
      withTenantContext(appPool, { tenantId: tenantA, staffId: ownerA, roles: ["owner"], allowedBranchIds: "*" }, (db) =>
        resolvePublicDoctorsBySlug(slugA, db),
      ),
    ).rejects.toThrow(/ERR_FORBIDDEN: public doctors run unbound/);

    await expect(
      withTenantContext(appPool, { tenantId: tenantA, staffId: ownerA, roles: ["owner"], allowedBranchIds: "*" }, (db) =>
        resolvePublicDoctorDetail(slugA, "dr-nadia", db),
      ),
    ).rejects.toThrow(/ERR_FORBIDDEN: public doctors run unbound/);

    // 7. Cross-tenant: Tenant A owner cannot grant consent for Tenant B doctor
    await expect(
      withTenantContext(appPool, { tenantId: tenantA, staffId: ownerA, roles: ["owner"], allowedBranchIds: "*" }, (db) =>
        grantDoctorListingConsent(db, {
          staffId: docB1,
          publicSlug: "dr-beta-hijack",
          displayName: "dr. Beta",
          acknowledgementRef: "CROSS-TENANT",
        }),
      ),
    ).rejects.toThrow(/ERR_NOT_FOUND/);

    // 8. TEN-19 support_object_kinds = 'never' & zero direct clinic_app/vendor table grants
    const sup = await h.admin.query<{ support_class: string }>(
      `SELECT support_class FROM public.support_object_kinds WHERE table_name = 'public.doctor_listing_consents'`,
    );
    expect(sup.rows).toEqual([{ support_class: "never" }]);

    await expect(
      withTenantContext(appPool, { tenantId: tenantA, staffId: ownerA, roles: ["owner"], allowedBranchIds: "*" }, (db) =>
        db.query(`SELECT * FROM public.doctor_listing_consents`),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("grants consent, gates titles & SIP strictly on Q-15, exposes zero internal UUIDs/SIP expiry, and wires T-126 booking hook", async () => {
    // Doctor A1 grants own consent with showTitleAndSip=true and tenant+doctor-owned PNG photo
    const granted = await withTenantContext(
      appPool,
      { tenantId: tenantA, staffId: docA1, roles: ["doctor"], activeBranchId: branchA1, allowedBranchIds: [branchA1] },
      (db) =>
        grantDoctorListingConsent(db, {
          staffId: docA1,
          publicSlug: "dr-nadia",
          displayName: "dr. Nadia Santoso",
          title: "Sp.DVE",
          scheduleSummary: "Senin 09.00–17.00 WIB",
          focusAreas: ["Dermatologi medis", "Perawatan jerawat"],
          showPhoto: true,
          photoBytes: VALID_PHOTO_BYTES,
          photoMediaType: "image/png",
          showTitleAndSip: true,
        }),
    );
    expect(granted.state).toBe("granted");
    expect(granted.consentSha256).toMatch(/^[0-9a-f]{64}$/);
    const expectedPhotoVer = createHash("sha256")
      .update(Buffer.concat([Buffer.from(`${granted.id}:`, "utf8"), VALID_PHOTO_BYTES]))
      .digest("hex")
      .slice(0, 24);
    const expectedPhotoUrl = `/api/v1/public/doctor-photo/${slugA}/dr-nadia?v=${expectedPhotoVer}`;
    expect(granted.photoUrl).toBe(expectedPhotoUrl);
    issuedPhotoUrlA1 = expectedPhotoUrl;

    // Tenant B also grants doctor B1 (cross-tenant isolation check)
    await withTenantContext(appPool, { tenantId: tenantB, staffId: ownerB, roles: ["owner"], allowedBranchIds: "*" }, (db) =>
      grantDoctorListingConsent(db, {
        staffId: docB1,
        publicSlug: "dr-nadia",
        displayName: "dr. Beta Rahasia",
        acknowledgementRef: "BETA-ACK-1",
      }),
    );

    // 1. Q-15 doctorTitlesAllowed=false => title & SIP MUST be omitted even when showTitleAndSip=true!
    const docsNoQ15 = await resolvePublicDoctorsBySlug(slugA, appPool);
    expect(docsNoQ15).toHaveLength(1);
    expect(docsNoQ15[0]).toEqual({
      slug: "dr-nadia",
      name: "dr. Nadia Santoso",
      title: null,
      scheduleSummary: "Senin 09.00–17.00 WIB",
      sipNumbers: [],
      focusAreas: ["Dermatologi medis", "Perawatan jerawat"],
      photoUrl: expectedPhotoUrl,
      branchSlugs: ["senopati"],
    });
    // Authoritative photo endpoint serves exact bytes with private/no-store + CDN-Cache-Control: no-store while granted!
    const photoRespBefore = await handleDoctorPhotoGet(
      new NextRequest(`http://booking.test.local${expectedPhotoUrl}`),
      { slug: slugA, doctor: "dr-nadia" },
      { db: appPool },
    );
    expect(photoRespBefore.status).toBe(200);
    expect(photoRespBefore.headers.get("content-type")).toBe("image/png");
    expect(photoRespBefore.headers.get("cache-control")).toBe("private, no-store");
    expect(photoRespBefore.headers.get("cdn-cache-control")).toBe("no-store");
    expect(Buffer.from(await photoRespBefore.arrayBuffer()).equals(VALID_PHOTO_BYTES)).toBe(true);
    // Zero UUIDs and zero Tenant B leakage!
    const rawJson = JSON.stringify(docsNoQ15);
    expect(rawJson).not.toMatch(UUID_RE);
    expect(rawJson).not.toContain("Beta Rahasia");

    // 2. Enable doctorTitlesAllowed=true bound to approved Q-15 counsel => title & verified active SIP appear,
    //    expired/unverified SIPs and expiry dates NEVER appear!
    await withTenantContext(appPool, { tenantId: tenantA, staffId: ownerA, roles: ["owner"], allowedBranchIds: "*" }, async (db) => {
      await saveSiteSettings(db, {
        slug: slugA,
        brandName: "Klinik Estetika ALPHA",
        accentHex: "#007AFF",
        oneLine: "Perawatan berbasis evaluasi dokter.",
        showTreatments: true,
        showBranches: true,
        showDoctors: true,
        tariffListAllowed: false,
        doctorTitlesAllowed: true,
      });
      const pub = await publishPublicSite(db);
      expect(pub.ok).toBe(true);
    });

    const detailQ15 = await resolvePublicDoctorDetail(slugA, "dr-nadia", appPool);
    expect(detailQ15.state).toBe("found");
    if (detailQ15.state === "found") {
      expect(detailQ15.doctor.title).toBe("Sp.DVE");
      expect(detailQ15.doctor.sipNumbers).toEqual([
        { branchSlug: "senopati", branchName: "Cabang Senopati", sip: "SIP-503/DKI/2026/001" },
      ]);
      const serialized = JSON.stringify(detailQ15);
      expect(serialized).not.toContain("SIP-EXPIRED-999");
      expect(serialized).not.toContain("SIP-FUTURE-888");
      expect(serialized).not.toContain("SIP-PENDING-777");
      expect(serialized).not.toContain("2029-12-31");
      expect(serialized).not.toMatch(UUID_RE);
    }

    // 2b. Finding #3 (r3): Removing doctor's branch assignment removes that branch's SIP even when the branch
    //     remains published and the doctor stays listed via another branch!
    const docA1RoleId = (
      await h.admin.query<{ id: string }>(
        `SELECT id FROM public.staff_roles WHERE tenant_id = $1 AND staff_id = $2 AND role = 'doctor' LIMIT 1`,
        [tenantA, docA1],
      )
    ).rows[0].id;
    await h.admin.query(
      `INSERT INTO public.staff_branches (tenant_id, staff_id, role, branch_id, staff_role_id) VALUES ($1, $2, 'doctor', $3, $4)`,
      [tenantA, docA1, branchA2, docA1RoleId],
    );
    await h.admin.query(
      `DELETE FROM public.staff_branches WHERE tenant_id = $1 AND staff_id = $2 AND role = 'doctor' AND branch_id = $3`,
      [tenantA, docA1, branchA1],
    );
    const detailBranchRemoved = await resolvePublicDoctorDetail(slugA, "dr-nadia", appPool);
    expect(detailBranchRemoved.state).toBe("found");
    if (detailBranchRemoved.state === "found") {
      expect(detailBranchRemoved.doctor.branchSlugs).toEqual(["bsd"]);
      expect(detailBranchRemoved.doctor.sipNumbers).toEqual([]);
    }
    // Restore original senopati-only assignment
    await h.admin.query(
      `INSERT INTO public.staff_branches (tenant_id, staff_id, role, branch_id, staff_role_id) VALUES ($1, $2, 'doctor', $3, $4)`,
      [tenantA, docA1, branchA1, docA1RoleId],
    );
    await h.admin.query(
      `DELETE FROM public.staff_branches WHERE tenant_id = $1 AND staff_id = $2 AND role = 'doctor' AND branch_id = $3`,
      [tenantA, docA1, branchA2],
    );

    // 3. T-126 booking catalog, slots & OTP booking flow with doctorSlug
    const cat = await getPublicBookingCatalog(appPool, slugA);
    expect(cat.state).toBe("open");
    if (cat.state === "open") {
      expect(cat.doctors).toEqual([{ slug: "dr-nadia", name: "dr. Nadia Santoso", branchSlugs: ["senopati"] }]);
      expect(JSON.stringify(cat.doctors)).not.toMatch(UUID_RE);
    }

    // Slots for dr-nadia on senopati succeed; on bsd (wrong branch) return empty!
    const slotsOk = await getPublicBookingSlots(appPool, {
      slug: slugA,
      treatmentSlug: "konsultasi-dokter",
      branchSlug: "senopati",
      date: slotDate,
      doctorSlug: "dr-nadia",
    });
    expect(slotsOk.slots.length).toBeGreaterThan(0);

    const slotsWrongBranch = await getPublicBookingSlots(appPool, {
      slug: slugA,
      treatmentSlug: "konsultasi-dokter",
      branchSlug: "bsd",
      date: slotDate,
      doctorSlug: "dr-nadia",
    });
    expect(slotsWrongBranch.slots).toEqual([]);

    // Request OTP + verify with doctorSlug => books appointment assigned specifically to docA1
    const otpPort = createMockPublicBookingOtpPort(LOCAL_ENV);
    const intentToken1 = "t125-intent-token-doc-0001";
    const otpCode1 = "482913";
    const req1 = await requestPublicBookingOtp(
      appPool,
      {
        slug: slugA,
        treatmentSlug: "konsultasi-dokter",
        branchSlug: "senopati",
        slotStartIso: slotsOk.slots[0].startsAt,
        doctorSlug: "dr-nadia",
        sourceTag: "situs-dokter",
        phoneE164: "+6281299990001",
        patientName: "Pasien Dokter Satu",
        birthDate: "1992-05-10",
        sex: "female",
        otpCode: otpCode1,
        intentToken: intentToken1,
        clientIp: "198.51.100.10",
      },
      LOCAL_ENV,
      otpPort,
    );
    expect(req1.state).toBe("otp_sent");
    const ver1 = await verifyPublicBookingOtpAndBook(
      appPool,
      { slug: slugA, intentToken: intentToken1, otpCode: otpCode1, commandKey: "t125-book-doc-1" },
      LOCAL_ENV,
    );
    expect(ver1.state).toBe("confirmed");

    const apptRow = await h.admin.query<{ performer_staff_id: string; source: string }>(
      `SELECT performer_staff_id, source FROM public.appointments WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [tenantA],
    );
    expect(apptRow.rows[0]).toEqual({ performer_staff_id: docA1, source: "situs-dokter" });

    // Staff list scoping: facility_head of b1 sees docA1; facility_head of b2 does NOT see docA1
    const fh1Rows = await withTenantContext(
      appPool,
      { tenantId: tenantA, staffId: fhA1, roles: ["facility_head"], activeBranchId: branchA1, allowedBranchIds: [branchA1] },
      (db) => listDoctorListingConsents(db),
    );
    expect(fh1Rows.map((r) => r.staffId)).toContain(docA1);

    const fh2Rows = await withTenantContext(
      appPool,
      { tenantId: tenantA, staffId: fhA2, roles: ["facility_head"], activeBranchId: branchA2, allowedBranchIds: [branchA2] },
      (db) => listDoctorListingConsents(db),
    );
    expect(fh2Rows.map((r) => r.staffId)).not.toContain(docA1);
  });

  it("immediate purge on withdrawal: removes doctor on next read, blocks mid-flow OTP verify, clears photo_ref, preserves immutable audit history, and serializes with concurrent publish", async () => {
    // 1. Visitor starts booking with dr-nadia BEFORE withdrawal
    const slots = await getPublicBookingSlots(appPool, {
      slug: slugA,
      treatmentSlug: "konsultasi-dokter",
      branchSlug: "senopati",
      date: slotDate,
      doctorSlug: "dr-nadia",
    });
    expect(slots.slots.length).toBeGreaterThan(0);
    const otpPort = createMockPublicBookingOtpPort(LOCAL_ENV);
    const pendingToken = "t125-intent-token-midflow-0002";
    const pendingCode = "719204";
    const pendingReq = await requestPublicBookingOtp(
      appPool,
      {
        slug: slugA,
        treatmentSlug: "konsultasi-dokter",
        branchSlug: "senopati",
        slotStartIso: slots.slots[0].startsAt,
        doctorSlug: "dr-nadia",
        sourceTag: "situs-dokter",
        phoneE164: "+6281299990002",
        patientName: "Pasien Midflow Withdraw",
        birthDate: "1993-06-11",
        sex: "female",
        otpCode: pendingCode,
        intentToken: pendingToken,
        clientIp: "198.51.100.11",
      },
      LOCAL_ENV,
      otpPort,
    );
    expect(pendingReq.state).toBe("otp_sent");

    // 2. Concurrent withdraw + publish race (zero deadlock, zero resurrection)
    const [wRes, pRes] = await Promise.all([
      withTenantContext(
        appPool,
        { tenantId: tenantA, staffId: docA1, roles: ["doctor"], activeBranchId: branchA1, allowedBranchIds: [branchA1] },
        (db) => withdrawDoctorListingConsent(db, docA1, "doctor_requested_removal"),
      ),
      withTenantContext(appPool, { tenantId: tenantA, staffId: ownerA, roles: ["owner"], allowedBranchIds: "*" }, (db) =>
        publishPublicSite(db),
      ),
    ]);
    expect(wRes.state).toBe("withdrawn");
    expect(pRes.ok).toBe(true);

    // 3. IMMEDIATELY absent from public list, detail (neutral not_found), booking catalog, slots, AND exact previously issued photo URL returns 404 + no-store!
    expect(await resolvePublicDoctorsBySlug(slugA, appPool)).toEqual([]);
    expect(await resolvePublicDoctorDetail(slugA, "dr-nadia", appPool)).toEqual({ state: "not_found" });
    const photoRespAfter = await handleDoctorPhotoGet(
      new NextRequest(`http://booking.test.local${issuedPhotoUrlA1}`),
      { slug: slugA, doctor: "dr-nadia" },
      { db: appPool },
    );
    expect(photoRespAfter.status).toBe(404);
    expect(photoRespAfter.headers.get("cache-control")).toBe("private, no-store");
    expect(photoRespAfter.headers.get("cdn-cache-control")).toBe("no-store");
    expect((await photoRespAfter.arrayBuffer()).byteLength).toBe(0);

    // 3b. Finding #1 (r4): Even after same doctor re-grants under SAME slug with replacement photo, OR another doctor
    //     reuses the SAME slug, the exact old photo URL remains PERMANENTLY 404 (and missing ?v= returns 404)!
    const regrantSameSlug = await withTenantContext(
      appPool,
      { tenantId: tenantA, staffId: docA1, roles: ["doctor"], activeBranchId: branchA1, allowedBranchIds: [branchA1] },
      (db) =>
        grantDoctorListingConsent(db, {
          staffId: docA1,
          publicSlug: "dr-nadia",
          displayName: "dr. Nadia Santoso",
          showPhoto: true,
          photoBytes: REPLACEMENT_PHOTO_BYTES,
          photoMediaType: "image/png",
        }),
    );
    expect(regrantSameSlug.photoUrl).not.toBe(issuedPhotoUrlA1);
    const oldUrlAfterReplace = await handleDoctorPhotoGet(
      new NextRequest(`http://booking.test.local${issuedPhotoUrlA1}`),
      { slug: slugA, doctor: "dr-nadia" },
      { db: appPool },
    );
    expect(oldUrlAfterReplace.status).toBe(404);
    const missingVerResp = await handleDoctorPhotoGet(
      new NextRequest(`http://booking.test.local/api/v1/public/doctor-photo/${slugA}/dr-nadia`),
      { slug: slugA, doctor: "dr-nadia" },
      { db: appPool },
    );
    expect(missingVerResp.status).toBe(404);
    const newUrlResp = await handleDoctorPhotoGet(
      new NextRequest(`http://booking.test.local${regrantSameSlug.photoUrl}`),
      { slug: slugA, doctor: "dr-nadia" },
      { db: appPool },
    );
    expect(newUrlResp.status).toBe(200);
    expect(Buffer.from(await newUrlResp.arrayBuffer()).equals(REPLACEMENT_PHOTO_BYTES)).toBe(true);
    await withTenantContext(
      appPool,
      { tenantId: tenantA, staffId: docA1, roles: ["doctor"], activeBranchId: branchA1, allowedBranchIds: [branchA1] },
      (db) => withdrawDoctorListingConsent(db, docA1, "cleanup_photo_replace_test"),
    );

    // Another doctor (docA2) takes over slug "dr-nadia" with a photo -> old URL STILL 404!
    await withTenantContext(appPool, { tenantId: tenantA, staffId: ownerA, roles: ["owner"], allowedBranchIds: "*" }, (db) =>
      grantDoctorListingConsent(db, {
        staffId: docA2,
        publicSlug: "dr-nadia",
        displayName: "dr. Bima Pratama",
        showPhoto: true,
        photoBytes: VALID_PHOTO_BYTES,
        photoMediaType: "image/png",
        acknowledgementRef: "ACK-SLUG-REUSE",
      }),
    );
    const oldUrlAfterSlugReuse = await handleDoctorPhotoGet(
      new NextRequest(`http://booking.test.local${issuedPhotoUrlA1}`),
      { slug: slugA, doctor: "dr-nadia" },
      { db: appPool },
    );
    expect(oldUrlAfterSlugReuse.status).toBe(404);
    await withTenantContext(appPool, { tenantId: tenantA, staffId: ownerA, roles: ["owner"], allowedBranchIds: "*" }, (db) =>
      withdrawDoctorListingConsent(db, docA2, "cleanup_slug_reuse_test"),
    );
    const catAfter = await getPublicBookingCatalog(appPool, slugA);
    if (catAfter.state === "open") expect(catAfter.doctors).toEqual([]);
    const slotsAfter = await getPublicBookingSlots(appPool, {
      slug: slugA,
      treatmentSlug: "konsultasi-dokter",
      branchSlug: "senopati",
      date: slotDate,
      doctorSlug: "dr-nadia",
    });
    expect(slotsAfter.slots).toEqual([]);

    // 4. Mid-flow OTP verify for withdrawn doctor FAILS CLOSED!
    await expect(
      verifyPublicBookingOtpAndBook(
        appPool,
        { slug: slugA, intentToken: pendingToken, otpCode: pendingCode, commandKey: "t125-midflow-fail" },
        LOCAL_ENV,
      ),
    ).rejects.toThrow(/ERR_NOT_FOUND: doctor_unavailable/);

    // 4b. Finding #1 regression: even AFTER re-granting consent (under dr-nadia-v2), the OLD OTP intent
    //     bound to the withdrawn consent row MUST still fail closed!
    await withTenantContext(
      appPool,
      { tenantId: tenantA, staffId: docA1, roles: ["doctor"], activeBranchId: branchA1, allowedBranchIds: [branchA1] },
      (db) =>
        grantDoctorListingConsent(db, {
          staffId: docA1,
          publicSlug: "dr-nadia-regrant-check",
          displayName: "dr. Nadia Santoso",
        }),
    );
    await expect(
      verifyPublicBookingOtpAndBook(
        appPool,
        { slug: slugA, intentToken: pendingToken, otpCode: pendingCode, commandKey: "t125-midflow-regrant-fail" },
        LOCAL_ENV,
      ),
    ).rejects.toThrow(/ERR_NOT_FOUND: doctor_unavailable/);
    await withTenantContext(
      appPool,
      { tenantId: tenantA, staffId: docA1, roles: ["doctor"], activeBranchId: branchA1, allowedBranchIds: [branchA1] },
      (db) => withdrawDoctorListingConsent(db, docA1, "cleanup_regrant_test"),
    );

    // 5. DB row preserved as immutable 'withdrawn', photo_ref/photo_bytes/photo_media_type purged to NULL, audit + domain event emitted
    const dbRow = await h.admin.query<{
      state: string;
      photo_ref: string | null;
      photo_bytes: Buffer | null;
      photo_media_type: string | null;
      withdrawn_by: string | null;
      withdrawn_as: string | null;
    }>(
      `SELECT state, photo_ref, photo_bytes, photo_media_type, withdrawn_by, withdrawn_as FROM public.doctor_listing_consents WHERE id = $1`,
      [wRes.id],
    );
    expect(dbRow.rows[0]).toEqual({
      state: "withdrawn",
      photo_ref: null,
      photo_bytes: null,
      photo_media_type: null,
      withdrawn_by: docA1,
      withdrawn_as: "doctor",
    });

    // Immutability triggers: cannot delete, update withdrawn row, or truncate
    await expect(h.admin.query(`DELETE FROM public.doctor_listing_consents WHERE id = $1`, [wRes.id])).rejects.toThrow(/ERR_IMMUTABLE/);
    await expect(
      h.admin.query(`UPDATE public.doctor_listing_consents SET state = 'granted' WHERE id = $1`, [wRes.id]),
    ).rejects.toThrow(/ERR_IMMUTABLE/);

    const ev = await h.admin.query<{ type: string; payload: Record<string, unknown> }>(
      `SELECT type, payload FROM public.domain_events WHERE tenant_id = $1 AND type = 'DoctorListingConsentWithdrawn' AND aggregate_id = $2 ORDER BY occurred_at DESC LIMIT 1`,
      [tenantA, wRes.id],
    );
    expect(ev.rows[0]).toEqual({
      type: "DoctorListingConsentWithdrawn",
      payload: { consent_id: wRes.id, staff_id: docA1 },
    });
  });

  it("fail-closes immediately on doctor deactivation, branch unpublish, Q-15 revocation, and allows withdrawal during tenant suspension", async () => {
    // Re-grant consent for docA1 and docA2
    await withTenantContext(
      appPool,
      { tenantId: tenantA, staffId: docA1, roles: ["doctor"], activeBranchId: branchA1, allowedBranchIds: [branchA1] },
      (db) =>
        grantDoctorListingConsent(db, {
          staffId: docA1,
          publicSlug: "dr-nadia-v2",
          displayName: "dr. Nadia Santoso",
          showTitleAndSip: true,
        }),
    );
    await withTenantContext(appPool, { tenantId: tenantA, staffId: ownerA, roles: ["owner"], allowedBranchIds: "*" }, (db) =>
      grantDoctorListingConsent(db, {
        staffId: docA2,
        publicSlug: "dr-bima",
        displayName: "dr. Bima Pratama",
        acknowledgementRef: "ACK-BIMA-1",
      }),
    );
    expect((await resolvePublicDoctorsBySlug(slugA, appPool)).map((d) => d.slug)).toEqual(["dr-bima", "dr-nadia-v2"]);

    // 1. Deactivating docA1 membership immediately removes dr-nadia-v2 while dr-bima stays
    await h.admin.query(
      `UPDATE public.memberships
          SET effective_from = clock_timestamp() - interval '2 minutes',
              effective_to = clock_timestamp() - interval '1 minute'
        WHERE id = $1`,
      [docA1Membership],
    );
    expect((await resolvePublicDoctorsBySlug(slugA, appPool)).map((d) => d.slug)).toEqual(["dr-bima"]);
    expect(await resolvePublicDoctorDetail(slugA, "dr-nadia-v2", appPool)).toEqual({ state: "not_found" });

    // Restore docA1 membership
    await h.admin.query(`UPDATE public.memberships SET effective_to = NULL WHERE id = $1`, [docA1Membership]);
    expect((await resolvePublicDoctorsBySlug(slugA, appPool)).map((d) => d.slug)).toEqual(["dr-bima", "dr-nadia-v2"]);

    // 2. Unpublishing branchA2 immediately hides docA2 (only assigned to branchA2)
    await h.admin.query(`UPDATE public.branches SET publish_until = clock_timestamp() - interval '1 minute' WHERE id = $1`, [branchA2]);
    expect((await resolvePublicDoctorsBySlug(slugA, appPool)).map((d) => d.slug)).toEqual(["dr-nadia-v2"]);
    await h.admin.query(`UPDATE public.branches SET publish_until = NULL WHERE id = $1`, [branchA2]);

    // 3. Revoking Q-15 counsel immediately fail-closes public doctor listing
    await h.admin.query(`UPDATE public.evidence_items SET state = 'rejected' WHERE id = $1`, [evItemA]);
    expect(await resolvePublicDoctorsBySlug(slugA, appPool)).toEqual([]);
    await h.admin.query(`UPDATE public.evidence_items SET state = 'approved' WHERE id = $1`, [evItemA]);
    expect((await resolvePublicDoctorsBySlug(slugA, appPool)).map((d) => d.slug)).toEqual(["dr-bima", "dr-nadia-v2"]);

    // 4. Tenant suspended: public listing returns empty, new grant refused, BUT doctor self-withdrawal STILL works!
    await h.admin.query(`UPDATE public.tenants_registry SET lifecycle_state = 'suspended' WHERE id = $1`, [tenantA]);
    expect(await resolvePublicDoctorsBySlug(slugA, appPool)).toEqual([]);
    await expect(
      withTenantContext(appPool, { tenantId: tenantA, staffId: ownerA, roles: ["owner"], allowedBranchIds: "*" }, (db) =>
        grantDoctorListingConsent(db, {
          staffId: docA1,
          publicSlug: "dr-nadia-v3",
          displayName: "dr. Nadia",
          acknowledgementRef: "ACK-SUSP",
        }),
      ),
    ).rejects.toThrow(/ERR_FORBIDDEN: tenant_not_live/);

    const suspWithdraw = await withTenantContext(
      appPool,
      { tenantId: tenantA, staffId: docA1, roles: ["doctor"], activeBranchId: branchA1, allowedBranchIds: [branchA1] },
      (db) => withdrawDoctorListingConsent(db, docA1, "withdraw_during_suspension"),
    );
    expect(suspWithdraw.state).toBe("withdrawn");

    // 5. Finding #1 (r3): Post-lock clock refresh under staff_access lock — OTP expires while verification is blocked!
    await h.admin.query(`UPDATE public.tenants_registry SET lifecycle_state = 'live' WHERE id = $1`, [tenantA]);
    await withTenantContext(
      appPool,
      { tenantId: tenantA, staffId: docA1, roles: ["doctor"], activeBranchId: branchA1, allowedBranchIds: [branchA1] },
      (db) =>
        grantDoctorListingConsent(db, {
          staffId: docA1,
          publicSlug: "dr-nadia-clock",
          displayName: "dr. Nadia Santoso",
        }),
    );
    const clockSlots = await getPublicBookingSlots(appPool, {
      slug: slugA,
      treatmentSlug: "konsultasi-dokter",
      branchSlug: "senopati",
      date: slotDate,
      doctorSlug: "dr-nadia-clock",
    });
    expect(clockSlots.slots.length).toBeGreaterThan(0);
    const clockToken = "t125-intent-token-postlock-clock-0003";
    const clockCode = "339104";
    const clockReq = await requestPublicBookingOtp(
      appPool,
      {
        slug: slugA,
        treatmentSlug: "konsultasi-dokter",
        branchSlug: "senopati",
        slotStartIso: clockSlots.slots[0].startsAt,
        doctorSlug: "dr-nadia-clock",
        sourceTag: "situs-dokter",
        phoneE164: "+6281299990003",
        patientName: "Pasien Post Lock Clock",
        birthDate: "1994-03-14",
        sex: "female",
        otpCode: clockCode,
        intentToken: clockToken,
        clientIp: "198.51.100.12",
      },
      LOCAL_ENV,
      createMockPublicBookingOtpPort(LOCAL_ENV),
    );
    expect(clockReq.state).toBe("otp_sent");

    // Deterministic proof (r4 Finding #3):
    // 1. Acquire staff_access lock FIRST while otp_expires_at is still ~5 minutes in the future.
    // 2. Start verifyPublicBookingOtpAndBook() and WAIT until pg_stat_activity confirms it is actively
    //    blocked on the advisory lock (proving its pre-lock entry happened strictly BEFORE expiry).
    // 3. ONLY THEN advance otp_expires_at to clock_timestamp() + 100ms, sleep 200ms so expiry crosses while blocked,
    //    then release the lock -> post-lock v_now MUST observe expiry and return otp_expired!
    const blocker = await ownerPool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query(`SELECT pg_advisory_xact_lock(hashtextextended('staff_access:' || $1::text, 0))`, [tenantA]);
      const verifyPromise = verifyPublicBookingOtpAndBook(
        appPool,
        { slug: slugA, intentToken: clockToken, otpCode: clockCode, commandKey: "t125-postlock-expired" },
        LOCAL_ENV,
      );
      let blocked = false;
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const w = await h.admin.query<{ n: number }>(
          `SELECT count(*)::int AS n
             FROM pg_stat_activity
            WHERE datname = current_database()
              AND wait_event_type = 'Lock'
              AND wait_event = 'advisory'
              AND query LIKE '%public_booking_otp_verify_and_book%'`,
        );
        if ((w.rows[0]?.n ?? 0) >= 1) {
          blocked = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(blocked).toBe(true);

      const updClock = await h.admin.query<{ id: string }>(
        `UPDATE public.public_booking_intents
            SET otp_expires_at = clock_timestamp() + interval '100 milliseconds'
          WHERE id = (
            SELECT id FROM public.public_booking_intents
             WHERE tenant_id = $1 AND consumed_at IS NULL AND purged_at IS NULL
             ORDER BY created_at DESC LIMIT 1
          )
         RETURNING id`,
        [tenantA],
      );
      expect(updClock.rowCount).toBe(1);
      await new Promise((r) => setTimeout(r, 200));
      await blocker.query("COMMIT");
      const verifyRes = await verifyPromise;
      expect(verifyRes.state).toBe("otp_expired");
    } finally {
      blocker.release();
    }
  });
});
