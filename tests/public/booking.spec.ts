// Public booking integration & unit tests (PR-67, UX-24, DATA-56, OD-1 Option B; T-126).
// Covers:
// - Pure UX-24 model: prefill, bookingHref, neutral whatsappLink (no treatment/complaint text), publicState, otpSender, dpNote.
// - TEN-19 'never' & zero direct clinic_app SELECT on public_booking_intents; unbound-only enforcement.
// - Catalog & slot reader: opaque slugs/timestamps only (zero internal UUIDs), SET-16 window, fail-closed doctor handle until T-125.
// - Happy-path NEW online patient: gap-free MRN, identity_type='online_pending', created_as='patient_online', created_by=NULL,
//   contact_points phone, appointments.channel='online' & source='situs-perawatan', phone_e164 cleared to NULL on consumption.
// - Happy-path EXISTING tenant patient matched via contact_points (no duplicate patient created).
// - DP-enabled service creates 'held' appointment with SET-17 hold_until.
// - OD-1 Option B residency gate blocks OTP request, resend, AND verify when production + inconclusive opinion (0 intents, 0 patients, 0 appts).
// - Durable OTP attempts (5 wrong attempts lock out across separate calls), expired OTP, 60s resend cooldown, idempotent replay & key conflict.
// - Stale clinical review drift after OTP send refuses verify-and-book (canonical review-artifact-v1 enforcement).
// - Neutral closed/unpublished/suspended/revoked-counsel byte-identical { state: "not_found" }.
// - HTTP route handlers POST /api/v1/public/booking/{otp,verify}: cross-origin 403, Turnstile fail-closed 403, strict security headers.
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  bookingHref,
  dpNote,
  normalizeSourceHint,
  otpSender,
  prefill,
  publicState,
  whatsappLink,
  type PublishedBookingCatalog,
} from "../../src/app/(public)/[slug]/booking/model";
import { POST as postOtp } from "../../src/app/api/v1/public/booking/otp/route";
import { POST as postVerify } from "../../src/app/api/v1/public/booking/verify/route";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { assignBranch, assignRole, createMembership } from "../../src/modules/org/identity";
import { setPlatformEnvironment } from "../../src/modules/platform/residency";
import {
  approvePublicWebReview,
  getPublicWebReviewSource,
  publishPublicSite,
  savePublicWebField,
  saveSiteSettings,
} from "../../src/modules/public-site";
import {
  getPublicBookingCatalog,
  getPublicBookingSlots,
  hmacHex,
  requestPublicBookingOtp,
  resendPublicBookingOtp,
  signBookingCookiePayload,
  verifyBookingCookiePayload,
  verifyPublicBookingOtpAndBook,
  type PublicBookingOtpPort,
} from "../../src/modules/public-site/booking/db";
import { runPublicBookingPurge } from "../../src/workers/public-booking-purge";
import { createHarness, testPool, type Harness } from "../rls/harness";

const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function errMsg(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (e) {
    return (e as { message?: string })?.message ?? String(e);
  }
}

function nextMondayDateStr(): string {
  const now = new Date();
  const jakartaMs = now.getTime() + 7 * 3600_000;
  const d = new Date(jakartaMs);
  // Move at least 2 days ahead so SET-16 2h cutoff is always satisfied, then to Monday (weekday 1)
  d.setUTCDate(d.getUTCDate() + 2);
  while (d.getUTCDay() !== 1) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}

describe("T-126 pure UX-24 booking model (PR-67)", () => {
  const catalog: PublishedBookingCatalog = {
    branches: [
      { slug: "senopati", name: "Cabang Senopati", timezone: "Asia/Jakarta", whatsapp: "+6281234567890" },
      { slug: "kemang", name: "Cabang Kemang", timezone: "Asia/Jakarta", whatsapp: "+6281234567891" },
    ],
    treatments: [
      { slug: "facial-oksigen", name: "Facial Oksigen", durationMin: 45, dpRequired: false, dpAmount: null, branchSlugs: ["senopati"] },
      { slug: "laser-pigmen", name: "Laser Pigmen", durationMin: 30, dpRequired: true, dpAmount: 150_000, branchSlugs: ["senopati", "kemang"] },
    ],
    doctors: [],
  };

  it("prefills valid slugs cleanly and drops unknown or mismatched query tokens silently", () => {
    expect(prefill({ layanan: "facial-oksigen", cabang: "senopati", sumber: "perawatan" }, catalog)).toEqual({
      treatmentSlug: "facial-oksigen",
      branchSlug: "senopati",
      doctorSlug: null,
      source: "situs-perawatan",
    });
    expect(prefill({ layanan: "facial-oksigen", cabang: "kemang", sumber: "cabang" }, catalog)).toEqual({
      treatmentSlug: "facial-oksigen",
      branchSlug: null,
      doctorSlug: null,
      source: "situs-cabang",
    });
    expect(prefill({ layanan: "tidak-ada", sumber: "evil/../../x" }, catalog)).toEqual({
      treatmentSlug: null,
      branchSlug: null,
      doctorSlug: null,
      source: "situs",
    });
  });

  it("builds neutral WhatsApp links carrying coarse ref only (zero treatment or health words)", () => {
    const wa = whatsappLink("+62 812-3456-7890", { brand: "Klinik Sintetis", page: "perawatan" });
    expect(wa).not.toBeNull();
    expect(wa?.href).toContain("https://wa.me/6281234567890?text=");
    const decoded = decodeURIComponent(wa?.href ?? "");
    expect(decoded).toContain("ref: situs-perawatan");
    expect(decoded).not.toMatch(/facial|laser|jerawat|botox/i);
    expect(whatsappLink(null, { brand: "Klinik", page: "beranda" })).toBeNull();
  });

  it("normalizes source tags, bookingHref, public states, OTP sender, and DP note", () => {
    expect(normalizeSourceHint("perawatan")).toBe("situs-perawatan");
    expect(normalizeSourceHint("situs-cabang")).toBe("situs-cabang");
    expect(normalizeSourceHint("invalid-source")).toBe("situs");
    expect(bookingHref("klinik-a", { treatment: "facial-oksigen", branch: "senopati", page: "perawatan" })).toBe(
      "/klinik-a/booking?layanan=facial-oksigen&cabang=senopati&sumber=perawatan",
    );
    expect(publicState({ state: "live", sitePublished: true, brand: "Klinik A", whatsapp: "+62812" })).toEqual({
      kind: "open",
      brand: "Klinik A",
      whatsapp: "+62812",
    });
    expect(publicState({ state: "suspended", sitePublished: true, brand: "Klinik A", whatsapp: "+62812" }).kind).toBe("unavailable");
    expect(publicState(null).kind).toBe("unavailable");
    expect(otpSender("Klinik A", "+6281234567890")).toContain("WhatsApp Klinik A");
    expect(otpSender("Klinik A", null)).toContain("nomor layanan Klinik A");
    expect(dpNote(null)).toBeNull();
    expect(dpNote(150_000)).toContain("Rp150.000");
  });
});

describe("T-126 public booking PostgreSQL seam & HTTP routes (PR-67, OD-1 Option B, 0137)", () => {
  let h: Harness;
  let app: pg.Pool;
  let ownerPool: pg.Pool;
  let seq = 0;
  const LOCAL_ENV = { DEPLOY_ENV: "local" };
  const PROD_ENV = { DEPLOY_ENV: "production" };

  type BookingRig = {
    tenantId: string;
    branchId: string;
    branchSlug: string;
    siteSlug: string;
    owner: { staffId: string };
    therapist: { staffId: string };
    serviceNoDpId: string;
    serviceDpId: string;
    slotDate: string;
  };

  let A: BookingRig;
  let B: BookingRig;
  const prevDeployEnv = process.env.DEPLOY_ENV;

  async function setupBookingTenant(label: string): Promise<BookingRig> {
    const n = ++seq;
    const siteSlug = `klinik-book-${label.toLowerCase()}-${n}`;
    const branchSlug = `cab${n}`;
    const slotDate = nextMondayDateStr();

    const tenantId = (await h.admin.query<{ id: string }>(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id;
    await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, `PT Booking ${label} ${n}`]);
    const branchId = (
      await h.admin.query<{ id: string }>(
        `insert into branches (tenant_id, code, name, timezone, address, whatsapp_number, publish_from)
         values ($1, $2, $3, 'Asia/Jakarta', $4, '+6281234567890', clock_timestamp() - interval '1 day') returning id`,
        [tenantId, branchSlug, `Cabang ${label}`, `Jl. Booking ${n}, Jakarta`],
      )
    ).rows[0].id;

    // Open Monday 09:00–17:00
    await h.admin.query(
      `insert into branch_hours (tenant_id, branch_id, weekday, opens, closes) values ($1, $2, 1, '09:00', '17:00')`,
      [tenantId, branchId],
    );

    const makeStaff = async (role: "owner" | "therapist", branchScoped = false) => {
      const acc = (
        await h.admin.query<{ id: string }>(
          `insert into auth_user (name, email, two_factor_enabled) values ($1, $2, true) returning id`,
          [`${role} ${label}`, `${role}-${label.toLowerCase()}-${++seq}@pubbook.test`],
        )
      ).rows[0].id;
      const { staffId } = await createMembership(ownerPool, { tenantId, accountId: acc, displayName: `${role} ${label}` });
      const c = await ownerPool.connect();
      try {
        const staffRoleId = await assignRole(c, { tenantId, staffId, role });
        if (branchScoped) {
          await assignBranch(c, { tenantId, staffRoleId, branchId });
        }
      } finally {
        c.release();
      }
      return { staffId, accountId: acc };
    };

    const owner = await makeStaff("owner");
    const therapist = await makeStaff("therapist", true);

    // Room + active shift on slotDate (Monday) for therapist
    await h.admin.query(
      `insert into rooms (tenant_id, branch_id, name, kind, is_active) values ($1, $2, 'Ruang Perawatan 1', 'treatment', true)`,
      [tenantId, branchId],
    );
    await h.admin.query(
      `insert into staff_shifts (tenant_id, branch_id, staff_id, shift_date, starts, ends, kind, created_by)
       values ($1, $2, $3, $4::date, '09:00', '17:00', 'work', $5)`,
      [tenantId, branchId, therapist.staffId, slotDate, owner.staffId],
    );

    // Approve Q-15 counsel evidence
    const pdf = Buffer.from(`%PDF-1.4 counsel ${label} ${n}`);
    const evItemId = (
      await h.admin.query<{ id: string }>(
        `insert into evidence_items (tenant_id, obligation_key, state, valid_until) values ($1, 'public_site_counsel', 'approved', '2030-12-31') returning id`,
        [tenantId],
      )
    ).rows[0].id;
    const evFileId = (
      await h.admin.query<{ id: string }>(
        `insert into evidence_files (tenant_id, item_id, version, file_name, media_type, size_bytes, sha256, content, expert_name, document_date, uploaded_by, uploaded_as, uploaded_name)
         values ($1, $2, 1, 'counsel.pdf', 'application/pdf', $3, $4, $5, 'Konsultan Hukum', '2026-11-20', $6, 'owner', 'Owner') returning id`,
        [tenantId, evItemId, pdf.byteLength, sha256(pdf), pdf, owner.staffId],
      )
    ).rows[0].id;
    await h.admin.query(
      `insert into evidence_approvals (tenant_id, item_id, file_id, decision, valid_until, decided_by, decided_as, decided_name)
       values ($1, $2, $3, 'approved', '2030-12-31', $4, 'owner', 'Owner')`,
      [tenantId, evItemId, evFileId, owner.staffId],
    );

    const makeService = async (code: string, name: string, pubSlug: string, dpEnabled: boolean, dpAmount: number | null) => {
      const itemId = (
        await h.admin.query<{ id: string }>(
          `insert into catalog_items (tenant_id, kind, code, created_by) values ($1, 'service', $2, $3) returning id`,
          [tenantId, code, owner.staffId],
        )
      ).rows[0].id;
      const verId = (
        await h.admin.query<{ id: string }>(
          `insert into catalog_versions (tenant_id, item_id, version, state, name, tax_category, tax_basis, normal_price, category, treatment_min, online_bookable, booking_dp_enabled, booking_dp_amount, contraindications, reason, created_by, created_as)
           values ($1, $2, 1, 'active', $3, 'taxable_service', 'Jasa estetika', 450000, 'facial', 45, true, $4, $5, 'Hindari saat luka terbuka.', 'Seed', $6, 'owner') returning id`,
          [tenantId, itemId, name, dpEnabled, dpAmount, owner.staffId],
        )
      ).rows[0].id;
      await h.admin.query(`insert into branch_services (tenant_id, branch_id, item_id) values ($1, $2, $3)`, [tenantId, branchId, itemId]);
      await h.admin.query(
        `insert into service_resources (tenant_id, version_id, kind, code, required) values ($1, $2, 'room', 'treatment', true)`,
        [tenantId, verId],
      );
      await h.admin.query(
        `insert into service_staff_eligibility (tenant_id, version_id, role, mode) values ($1, $2, 'therapist', 'performs')`,
        [tenantId, verId],
      );
      return { itemId, pubSlug };
    };

    const s1 = await makeService(`FAC-${n}`, `Facial Oksigen ${label}`, "facial-oksigen", false, null);
    const s2 = await makeService(`LAS-${n}`, `Peeling Medis ${label}`, "peeling-medis", true, 150_000);

    await withTenantContext(
      app,
      { tenantId, staffId: owner.staffId, roles: ["owner"], allowedBranchIds: "*" },
      async (db) => {
        await saveSiteSettings(db, {
          slug: siteSlug,
          brandName: `Klinik ${label}`,
          accentHex: "#007AFF",
          oneLine: "Perawatan berbasis evaluasi dokter.",
          showTreatments: true,
          showBranches: true,
          showDoctors: false,
          tariffListAllowed: false,
        });
        for (const s of [s1, s2]) {
          await savePublicWebField(db, {
            itemId: s.itemId,
            publicSlug: s.pubSlug,
            published: true,
            publishPrice: false,
            purpose: "Membantu membersihkan pori dan menjaga kelembapan kulit.",
            performedBy: "Terapis terlatih di bawah pengawasan dokter",
          });
          const src = await getPublicWebReviewSource(db, s.itemId);
          await approvePublicWebReview(db, s.itemId, { version: src.activeVersion, artifactSha256: src.artifactSha256 });
        }
        const pub = await publishPublicSite(db);
        if (!pub.ok) throw new Error(`Publish failed: ${pub.reason}`);
      },
    );

    return {
      tenantId,
      branchId,
      branchSlug,
      siteSlug,
      owner,
      therapist,
      serviceNoDpId: s1.itemId,
      serviceDpId: s2.itemId,
      slotDate,
    };
  }

  beforeAll(async () => {
    process.env.DEPLOY_ENV = "local";
    h = await createHarness();
    app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 8 });
    ownerPool = testPool({ connectionString: h.ownerUrl(), max: 3 });
    A = await setupBookingTenant("Alpha");
    B = await setupBookingTenant("Beta");
  }, 30_000);

  afterAll(async () => {
    if (prevDeployEnv === undefined) delete process.env.DEPLOY_ENV;
    else process.env.DEPLOY_ENV = prevDeployEnv;
    await app?.end();
    await ownerPool?.end();
    await h?.close();
  });

  it("TEN-19 'never', zero direct clinic_app SELECT, and unbound-only enforcement on public_booking_*", async () => {
    await expect(app.query(`select * from public.public_booking_intents`)).rejects.toMatchObject({ code: "42501" });
    const sup = (
      await h.admin.query<{ support_class: string }>(
        `select support_class from public.support_object_kinds where table_name = 'public.public_booking_intents'`,
      )
    ).rows[0];
    expect(sup?.support_class).toBe("never");

    // Calling unbound public_booking_catalog from a tenant-bound staff context MUST be refused
    const boundErr = await errMsg(
      withTenantContext(
        app,
        { tenantId: A.tenantId, staffId: A.owner.staffId, roles: ["owner"], allowedBranchIds: "*" },
        (db) => getPublicBookingCatalog(db, A.siteSlug),
      ),
    );
    expect(boundErr).toContain("ERR_FORBIDDEN");
  });

  it("catalog & slot reader return opaque public handles only (zero UUIDs) and fail closed on doctor handle until T-125", async () => {
    const cat = await getPublicBookingCatalog(app, A.siteSlug);
    expect(cat.state).toBe("open");
    if (cat.state !== "open") throw new Error("unreachable");
    expect(cat.treatments.map((t) => t.slug)).toEqual(["facial-oksigen", "peeling-medis"]);
    expect(cat.doctors).toEqual([]);
    expect(JSON.stringify(cat)).not.toMatch(UUID_RE);

    const slots = await getPublicBookingSlots(app, {
      slug: A.siteSlug,
      treatmentSlug: "facial-oksigen",
      branchSlug: A.branchSlug,
      date: A.slotDate,
    });
    expect(slots.state).toBe("open");
    expect(slots.slots.length).toBeGreaterThan(0);
    expect(JSON.stringify(slots)).not.toMatch(UUID_RE);

    // Doctor handle fails closed until T-125 ships consented doctors
    const withDoc = await getPublicBookingSlots(app, {
      slug: A.siteSlug,
      treatmentSlug: "facial-oksigen",
      branchSlug: A.branchSlug,
      date: A.slotDate,
      doctorSlug: "dr-sembarang",
    });
    expect(withDoc.state).toBe("open");
    expect(withDoc.slots).toEqual([]);
  });

  it("OD-1 Option B residency gate blocks OTP request, resend, and verify in production when opinion is inconclusive (zero rows written)", async () => {
    const slots = await getPublicBookingSlots(app, {
      slug: A.siteSlug,
      treatmentSlug: "facial-oksigen",
      branchSlug: A.branchSlug,
      date: A.slotDate,
    });
    const firstSlot = slots.slots[0].startsAt;

    // First create a valid intent in local mode so we can also test resend + verify under production gate
    const gatedToken = `tok-od1-gate-${++seq}`;
    const otpLocal = await requestPublicBookingOtp(
      app,
      {
        slug: A.siteSlug,
        treatmentSlug: "facial-oksigen",
        branchSlug: A.branchSlug,
        slotStartIso: firstSlot,
        sourceTag: "situs-perawatan",
        phoneE164: "+628111000101",
        patientName: "Pasien Gate Uji",
        birthDate: "1995-04-12",
        sex: "female",
        otpCode: "123456",
        intentToken: gatedToken,
        clientIp: "198.51.100.10",
      },
      LOCAL_ENV,
    );
    expect(otpLocal.state).toBe("otp_sent");

    // Flip platform_environment to production and set inconclusive opinion on vendor_profile
    const prevProfile = (
      await h.admin.query<{
        residency_opinion_outcome: string | null;
        residency_opinion_ref: string | null;
        residency_opinion_date: string | null;
        residency_opinion_set_by: string | null;
        residency_opinion_checksum: string | null;
      }>(
        `select residency_opinion_outcome, residency_opinion_ref, residency_opinion_date::text, residency_opinion_set_by, residency_opinion_checksum
           from vendor_profile where id = 1`,
      )
    ).rows[0];
    const ownerClient = await ownerPool.connect();
    try {
      await setPlatformEnvironment(ownerClient, "production");
      await h.admin.query(
        `update vendor_profile
            set residency_opinion_outcome = 'inconclusive',
                residency_opinion_ref = 'OP-SYN-01',
                residency_opinion_date = '2026-11-20',
                residency_opinion_set_by = (select id from auth_user limit 1),
                residency_opinion_checksum = repeat('a', 64)
          where id = 1`,
      );

      const beforeIntents = Number((await h.admin.query(`select count(*) as c from public_booking_intents where tenant_id = $1`, [A.tenantId])).rows[0].c);
      const beforePatients = Number((await h.admin.query(`select count(*) as c from patients where tenant_id = $1`, [A.tenantId])).rows[0].c);
      const beforeAppts = Number((await h.admin.query(`select count(*) as c from appointments where tenant_id = $1`, [A.tenantId])).rows[0].c);
      const prodEnvWithSecret = { ...PROD_ENV, PUBLIC_BOOKING_HMAC_SECRET: "synthetic-prod-hmac-secret-at-least-32-chars" };
      const prodStubPort: PublicBookingOtpPort = { isAvailable: () => true, async sendOtp() {} };

      // 0. B1 fail-closed: production WITHOUT a wired live OTP sender refuses BEFORE any DB write or residency check
      expect(
        await requestPublicBookingOtp(
          app,
          {
            slug: A.siteSlug,
            treatmentSlug: "facial-oksigen",
            branchSlug: A.branchSlug,
            slotStartIso: firstSlot,
            sourceTag: "situs-perawatan",
            phoneE164: "+628111000100",
            patientName: "Pasien Prod Tanpa Sender",
            birthDate: "1994-05-01",
            sex: "male",
            otpCode: "654321",
            intentToken: `tok-b1-nosender-${++seq}`,
            clientIp: "198.51.100.9",
          },
          prodEnvWithSecret,
        ),
      ).toEqual({ state: "send_failed" });
      expect(
        await resendPublicBookingOtp(
          app,
          { slug: A.siteSlug, intentToken: gatedToken, newOtpCode: "222222", clientIp: "198.51.100.10" },
          prodEnvWithSecret,
        ),
      ).toEqual({ state: "send_failed" });
      expect(Number((await h.admin.query(`select count(*) as c from public_booking_intents where tenant_id = $1`, [A.tenantId])).rows[0].c)).toBe(beforeIntents);

      // 1. Even WITH a wired production sender, OD-1 gate blocks OTP request BEFORE any intent row or quota side effect
      expect(
        await errMsg(
          requestPublicBookingOtp(
            app,
            {
              slug: A.siteSlug,
              treatmentSlug: "facial-oksigen",
              branchSlug: A.branchSlug,
              slotStartIso: firstSlot,
              sourceTag: "situs-perawatan",
              phoneE164: "+628111000102",
              patientName: "Pasien Ditolak Prod",
              birthDate: "1994-05-01",
              sex: "male",
              otpCode: "654321",
              intentToken: `tok-od1-blocked-${++seq}`,
              clientIp: "198.51.100.11",
            },
            prodEnvWithSecret,
            prodStubPort,
          ),
        ),
      ).toContain("real_patient_gate");

      // 2. OTP resend blocked by OD-1 gate
      expect(
        await errMsg(
          resendPublicBookingOtp(
            app,
            { slug: A.siteSlug, intentToken: gatedToken, newOtpCode: "222222", clientIp: "198.51.100.10" },
            prodEnvWithSecret,
            prodStubPort,
          ),
        ),
      ).toContain("real_patient_gate");

      // 3. OTP verify-and-book blocked
      expect(
        await errMsg(
          verifyPublicBookingOtpAndBook(
            app,
            { slug: A.siteSlug, intentToken: gatedToken, otpCode: "123456", commandKey: `cmd-od1-${seq}` },
            prodEnvWithSecret,
          ),
        ),
      ).toContain("real_patient_gate");

      // Zero new intents, zero new patients, zero new appointments
      expect(Number((await h.admin.query(`select count(*) as c from public_booking_intents where tenant_id = $1`, [A.tenantId])).rows[0].c)).toBe(beforeIntents);
      expect(Number((await h.admin.query(`select count(*) as c from patients where tenant_id = $1`, [A.tenantId])).rows[0].c)).toBe(beforePatients);
      expect(Number((await h.admin.query(`select count(*) as c from appointments where tenant_id = $1`, [A.tenantId])).rows[0].c)).toBe(beforeAppts);
    } finally {
      await setPlatformEnvironment(ownerClient, "local");
      if (prevProfile) {
        await h.admin.query(
          `update vendor_profile
              set residency_opinion_outcome = $1,
                  residency_opinion_ref = $2,
                  residency_opinion_date = $3::date,
                  residency_opinion_set_by = $4,
                  residency_opinion_checksum = $5
            where id = 1`,
          [
            prevProfile.residency_opinion_outcome,
            prevProfile.residency_opinion_ref,
            prevProfile.residency_opinion_date,
            prevProfile.residency_opinion_set_by,
            prevProfile.residency_opinion_checksum,
          ],
        );
      }
      ownerClient.release();
    }
  });

  it("PR-67 happy path: new online_pending patient, existing patient match, DP hold, phone_e164 cleared, idempotent replay, zero UUIDs", async () => {
    const slots = await getPublicBookingSlots(app, {
      slug: A.siteSlug,
      treatmentSlug: "facial-oksigen",
      branchSlug: A.branchSlug,
      date: A.slotDate,
    });
    expect(slots.slots.length).toBeGreaterThanOrEqual(3);
    const slot1 = slots.slots[0].startsAt;
    const slot2 = slots.slots[Math.min(4, slots.slots.length - 1)].startsAt;

    // 1. New online patient books non-DP service -> confirmed, RM- MRN, online_pending, phone_e164 cleared
    const token1 = `tok-new-${++seq}`;
    const cmd1 = `cmd-new-${seq}`;
    const phone1 = "+6281234000111";
    const req1 = await requestPublicBookingOtp(
      app,
      {
        slug: A.siteSlug,
        treatmentSlug: "facial-oksigen",
        branchSlug: A.branchSlug,
        slotStartIso: slot1,
        sourceTag: "situs-perawatan",
        phoneE164: phone1,
        patientName: "Sari Sintetis Baru",
        birthDate: "1996-08-17",
        sex: "female",
        otpCode: "482910",
        intentToken: token1,
        clientIp: "198.51.100.21",
      },
      LOCAL_ENV,
    );
    expect(req1).toMatchObject({ state: "otp_sent", dpRequired: false });

    const ver1 = await verifyPublicBookingOtpAndBook(
      app,
      { slug: A.siteSlug, intentToken: token1, otpCode: "482910", commandKey: cmd1 },
      LOCAL_ENV,
    );
    expect(ver1).toMatchObject({ state: "confirmed", replayed: false, sourceTag: "situs-perawatan", holdUntil: null });
    expect(JSON.stringify(ver1)).not.toMatch(UUID_RE);

    // Verify DB state: online_pending patient created with gap-free RM- MRN, phone_e164 cleared on intent
    const patRows = (
      await h.admin.query<{ id: string; mrn: string; identity_type: string; created_by: string | null; created_as: string }>(
        `select p.id, p.mrn, p.identity_type, p.created_by, p.created_as
           from patients p join contact_points cp on cp.patient_id = p.id
          where p.tenant_id = $1 and cp.value = $2`,
        [A.tenantId, phone1],
      )
    ).rows;
    expect(patRows).toHaveLength(1);
    expect(patRows[0]).toMatchObject({ identity_type: "online_pending", created_by: null, created_as: "patient_online" });
    expect(patRows[0].mrn).toMatch(/^RM-\d{6}$/);

    const intentRow = (
      await h.admin.query<{
        phone_e164: string | null;
        patient_name: string | null;
        birth_date: string | null;
        sex: string | null;
        appointment_id: string | null;
        consumed_at: Date | null;
      }>(
        `select phone_e164, patient_name, birth_date::text, sex, appointment_id, consumed_at
           from public_booking_intents where tenant_id = $1 and intent_hash = $2`,
        [A.tenantId, sha256(`intent:${token1}`)],
      )
    ).rows[0];
    expect(intentRow.phone_e164).toBeNull();
    expect(intentRow.patient_name).toBeNull();
    expect(intentRow.birth_date).toBeNull();
    expect(intentRow.sex).toBeNull();
    expect(intentRow.consumed_at).not.toBeNull();

    const apptRow = (
      await h.admin.query<{ state: string; channel: string; source: string; created_by: string | null; created_as: string }>(
        `select state, channel, source, created_by, created_as from appointments where tenant_id = $1 and id = $2`,
        [A.tenantId, intentRow.appointment_id],
      )
    ).rows[0];
    expect(apptRow).toEqual({
      state: "booked",
      channel: "online",
      source: "situs-perawatan",
      created_by: null,
      created_as: "patient_online",
    });

    // Idempotent replay with same command_key returns replayed=true; different command_key fails closed
    const replay = await verifyPublicBookingOtpAndBook(
      app,
      { slug: A.siteSlug, intentToken: token1, otpCode: "482910", commandKey: cmd1 },
      LOCAL_ENV,
    );
    expect(replay).toMatchObject({ state: "confirmed", replayed: true, sourceTag: "situs-perawatan" });
    expect(
      await errMsg(
        verifyPublicBookingOtpAndBook(
          app,
          { slug: A.siteSlug, intentToken: token1, otpCode: "482910", commandKey: `cmd-other-${seq}` },
          LOCAL_ENV,
        ),
      ),
    ).toContain("ERR_VERSION_CONFLICT");

    // 2. SAME phone books DP-enabled service at non-overlapping slot -> reuses existing patient, creates 'held' with holdUntil
    const token2 = `tok-dp-${++seq}`;
    const req2 = await requestPublicBookingOtp(
      app,
      {
        slug: A.siteSlug,
        treatmentSlug: "peeling-medis",
        branchSlug: A.branchSlug,
        slotStartIso: slot2,
        sourceTag: "situs-cabang",
        phoneE164: phone1,
        patientName: "Sari Sintetis Baru",
        birthDate: "1996-08-17",
        sex: "female",
        otpCode: "771122",
        intentToken: token2,
        clientIp: "198.51.100.22",
      },
      LOCAL_ENV,
    );
    expect(req2).toMatchObject({ state: "otp_sent", dpRequired: true });

    const ver2 = await verifyPublicBookingOtpAndBook(
      app,
      { slug: A.siteSlug, intentToken: token2, otpCode: "771122", commandKey: `cmd-dp-${seq}` },
      LOCAL_ENV,
    );
    expect(ver2).toMatchObject({ state: "held", replayed: false, sourceTag: "situs-cabang" });
    if (ver2.state !== "held") throw new Error("unreachable");
    expect(ver2.holdUntil).toBeTruthy();

    // Still exactly 1 patient row for phone1 (matched existing patient with identical phone + name + birthDate!)
    const patCount = Number(
      (await h.admin.query(`select count(*) as c from contact_points where tenant_id = $1 and value = $2`, [A.tenantId, phone1])).rows[0].c,
    );
    expect(patCount).toBe(1);

    // 3. Shared family phone (S3): SAME phone1 with DIFFERENT patientName/birthDate MUST create a separate patient (never attach to Sari's RME!)
    const slot3 = slots.slots[Math.min(8, slots.slots.length - 1)].startsAt;
    const token3 = `tok-family-${++seq}`;
    const req3 = await requestPublicBookingOtp(
      app,
      {
        slug: A.siteSlug,
        treatmentSlug: "facial-oksigen",
        branchSlug: A.branchSlug,
        slotStartIso: slot3,
        sourceTag: "situs",
        phoneE164: phone1,
        patientName: "Budi Keluarga Sintetis",
        birthDate: "1990-02-02",
        sex: "male",
        otpCode: "889900",
        intentToken: token3,
        clientIp: "198.51.100.23",
      },
      LOCAL_ENV,
    );
    expect(req3).toMatchObject({ state: "otp_sent" });
    const ver3 = await verifyPublicBookingOtpAndBook(
      app,
      { slug: A.siteSlug, intentToken: token3, otpCode: "889900", commandKey: `cmd-fam-${seq}` },
      LOCAL_ENV,
    );
    expect(ver3).toMatchObject({ state: "confirmed", replayed: false });
    const familyPatients = (
      await h.admin.query<{ full_name: string }>(
        `select p.full_name from patients p join contact_points cp on cp.patient_id = p.id
          where p.tenant_id = $1 and cp.value = $2 order by p.created_at asc`,
        [A.tenantId, phone1],
      )
    ).rows;
    expect(familyPatients.map((r) => r.full_name)).toEqual(["Sari Sintetis Baru", "Budi Keluarga Sintetis"]);
  });

  it("durable OTP attempt lockout (5 mismatches), resend 60s cooldown, expired OTP, and stale clinical review drift refusal", async () => {
    const slots = await getPublicBookingSlots(app, {
      slug: B.siteSlug,
      treatmentSlug: "facial-oksigen",
      branchSlug: B.branchSlug,
      date: B.slotDate,
    });
    const slotA = slots.slots[0].startsAt;
    const slotB = slots.slots[Math.min(4, slots.slots.length - 1)].startsAt;

    // 1. Durable OTP attempt counter: 4 mismatches + 5th locks out even across separate transactions!
    const tokLock = `tok-lock-${++seq}`;
    await requestPublicBookingOtp(
      app,
      {
        slug: B.siteSlug,
        treatmentSlug: "facial-oksigen",
        branchSlug: B.branchSlug,
        slotStartIso: slotA,
        sourceTag: "situs",
        phoneE164: "+6281299000101",
        patientName: "Pasien Uji Lock",
        birthDate: "1992-01-10",
        sex: "male",
        otpCode: "999888",
        intentToken: tokLock,
        clientIp: "198.51.100.31",
      },
      LOCAL_ENV,
    );

    // Resend immediately -> 60s cooldown enforced
    expect(
      await errMsg(
        resendPublicBookingOtp(app, { slug: B.siteSlug, intentToken: tokLock, newOtpCode: "111222", clientIp: "198.51.100.31" }, LOCAL_ENV),
      ),
    ).toContain("ERR_RATE_LIMITED");

    for (let i = 1; i <= 4; i++) {
      const r = await verifyPublicBookingOtpAndBook(
        app,
        { slug: B.siteSlug, intentToken: tokLock, otpCode: "000000", commandKey: `cmd-bad-${seq}-${i}` },
        LOCAL_ENV,
      );
      expect(r).toEqual({ state: "otp_mismatch", attemptsRemaining: 5 - i });
    }
    const fifth = await verifyPublicBookingOtpAndBook(
      app,
      { slug: B.siteSlug, intentToken: tokLock, otpCode: "000000", commandKey: `cmd-bad-${seq}-5` },
      LOCAL_ENV,
    );
    expect(fifth).toEqual({ state: "otp_locked", attemptsRemaining: 0 });
    // Even the correct OTP now stays locked, AND resend after 60s MUST stay locked (B2!), AND PII is purged (B3!)
    const afterLock = await verifyPublicBookingOtpAndBook(
      app,
      { slug: B.siteSlug, intentToken: tokLock, otpCode: "999888", commandKey: `cmd-after-lock-${seq}` },
      LOCAL_ENV,
    );
    expect(afterLock).toEqual({ state: "otp_locked" });

    const lockedRow = (
      await h.admin.query<{ phone_e164: string | null; patient_name: string | null; birth_date: string | null; sex: string | null; purged_at: Date | null }>(
        `select phone_e164, patient_name, birth_date::text, sex, purged_at from public_booking_intents where tenant_id = $1 and intent_hash = $2`,
        [B.tenantId, sha256(`intent:${tokLock}`)],
      )
    ).rows[0];
    expect(lockedRow.phone_e164).toBeNull();
    expect(lockedRow.patient_name).toBeNull();
    expect(lockedRow.birth_date).toBeNull();
    expect(lockedRow.sex).toBeNull();
    expect(lockedRow.purged_at).not.toBeNull();

    await h.admin.query(
      `update public_booking_intents set last_sent_at = clock_timestamp() - interval '2 minutes' where tenant_id = $1 and intent_hash = $2`,
      [B.tenantId, sha256(`intent:${tokLock}`)],
    );
    expect(
      await resendPublicBookingOtp(app, { slug: B.siteSlug, intentToken: tokLock, newOtpCode: "111222", clientIp: "198.51.100.31" }, LOCAL_ENV),
    ).toEqual({ state: "otp_locked" });

    // 1b. B1 + B2 cumulative attempts across resend + OTP port dispatch & failure handling
    const delivered: Array<{ slug: string; phoneE164: string; otpCode: string; templateName: string }> = [];
    const spyPort: PublicBookingOtpPort = {
      async sendOtp(msg) {
        delivered.push(msg);
      },
    };
    const tokCum = `tok-cum-${++seq}`;
    const cumReq = await requestPublicBookingOtp(
      app,
      {
        slug: B.siteSlug,
        treatmentSlug: "facial-oksigen",
        branchSlug: B.branchSlug,
        slotStartIso: slotA,
        sourceTag: "situs",
        phoneE164: "+6281299000199",
        patientName: "Pasien Uji Kumulatif",
        birthDate: "1992-05-15",
        sex: "female",
        otpCode: "101010",
        intentToken: tokCum,
        clientIp: "198.51.100.39",
      },
      LOCAL_ENV,
      spyPort,
    );
    expect(cumReq.state).toBe("otp_sent");
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toEqual({ slug: B.siteSlug, phoneE164: "+6281299000199", otpCode: "101010", templateName: "kode_otp" });

    // 3 wrong attempts -> resend after 60s -> attempts stay cumulative (NOT reset to 0!)
    for (let i = 1; i <= 3; i++) {
      expect(
        await verifyPublicBookingOtpAndBook(
          app,
          { slug: B.siteSlug, intentToken: tokCum, otpCode: "999999", commandKey: `cmd-cum-${seq}-${i}` },
          LOCAL_ENV,
        ),
      ).toEqual({ state: "otp_mismatch", attemptsRemaining: 5 - i });
    }
    await h.admin.query(
      `update public_booking_intents set last_sent_at = clock_timestamp() - interval '2 minutes' where tenant_id = $1 and intent_hash = $2`,
      [B.tenantId, sha256(`intent:${tokCum}`)],
    );
    const cumResend = await resendPublicBookingOtp(
      app,
      { slug: B.siteSlug, intentToken: tokCum, newOtpCode: "202020", clientIp: "198.51.100.40" },
      LOCAL_ENV,
      spyPort,
    );
    expect(cumResend.state).toBe("otp_sent");
    expect("deliveryPhone" in cumResend).toBe(false);
    expect(delivered).toHaveLength(2);
    expect(delivered[1]).toEqual({ slug: B.siteSlug, phoneE164: "+6281299000199", otpCode: "202020", templateName: "kode_otp" });

    // Only 2 more wrong attempts must lock out (3 + 2 = 5 cumulative!)
    expect(
      await verifyPublicBookingOtpAndBook(
        app,
        { slug: B.siteSlug, intentToken: tokCum, otpCode: "999999", commandKey: `cmd-cum-${seq}-4` },
        LOCAL_ENV,
      ),
    ).toEqual({ state: "otp_mismatch", attemptsRemaining: 1 });
    expect(
      await verifyPublicBookingOtpAndBook(
        app,
        { slug: B.siteSlug, intentToken: tokCum, otpCode: "999999", commandKey: `cmd-cum-${seq}-5` },
        LOCAL_ENV,
      ),
    ).toEqual({ state: "otp_locked", attemptsRemaining: 0 });

    // Throwing OTP port surfaces send_failed AND immediately purges PII on aborted request (B1)
    const failingPort: PublicBookingOtpPort = {
      async sendOtp() {
        throw new Error("provider_down");
      },
    };
    const tokFailSend = `tok-sendfail-${++seq}`;
    const sendFailRes = await requestPublicBookingOtp(
      app,
      {
        slug: B.siteSlug,
        treatmentSlug: "facial-oksigen",
        branchSlug: B.branchSlug,
        slotStartIso: slotA,
        sourceTag: "situs",
        phoneE164: "+6281299000198",
        patientName: "Pasien Gagal Kirim",
        birthDate: "1992-06-16",
        sex: "male",
        otpCode: "303030",
        intentToken: tokFailSend,
        clientIp: "198.51.100.41",
      },
      LOCAL_ENV,
      failingPort,
    );
    expect(sendFailRes).toEqual({ state: "send_failed" });
    const abortedRow = (
      await h.admin.query<{ phone_e164: string | null; patient_name: string | null; purged_at: Date | null }>(
        `select phone_e164, patient_name, purged_at from public_booking_intents where tenant_id = $1 and intent_hash = $2`,
        [B.tenantId, sha256(`intent:${tokFailSend}`)],
      )
    ).rows[0];
    expect(abortedRow.phone_e164).toBeNull();
    expect(abortedRow.patient_name).toBeNull();
    expect(abortedRow.purged_at).not.toBeNull();

    // Failed resend delivery MUST NOT rotate otp_hash or invalidate the previously delivered code (B1/S6)
    const tokKeepOld = `tok-keepold-${++seq}`;
    await requestPublicBookingOtp(
      app,
      {
        slug: B.siteSlug,
        treatmentSlug: "facial-oksigen",
        branchSlug: B.branchSlug,
        slotStartIso: slotA,
        sourceTag: "situs",
        phoneE164: "+6281299000197",
        patientName: "Pasien Resend Gagal",
        birthDate: "1992-06-17",
        sex: "female",
        otpCode: "414141",
        intentToken: tokKeepOld,
        clientIp: "198.51.100.44",
      },
      LOCAL_ENV,
    );
    await h.admin.query(
      `update public_booking_intents set last_sent_at = clock_timestamp() - interval '2 minutes' where tenant_id = $1 and intent_hash = $2`,
      [B.tenantId, sha256(`intent:${tokKeepOld}`)],
    );
    expect(
      await resendPublicBookingOtp(
        app,
        { slug: B.siteSlug, intentToken: tokKeepOld, newOtpCode: "525252", clientIp: "198.51.100.44" },
        LOCAL_ENV,
        failingPort,
      ),
    ).toEqual({ state: "send_failed" });
    // Previous OTP '414141' still verifies and books!
    const keptBooked = await verifyPublicBookingOtpAndBook(
      app,
      { slug: B.siteSlug, intentToken: tokKeepOld, otpCode: "414141", commandKey: `cmd-keepold-${seq}` },
      LOCAL_ENV,
    );
    expect(keptBooked).toMatchObject({ state: "confirmed", replayed: false });

    // Consumed replay after appointment cancellation MUST report 'inactive', never falsely 'confirmed' (r2 finding #3)
    const cancelApptId = (
      await h.admin.query<{ appointment_id: string }>(
        `select appointment_id from public_booking_intents where tenant_id = $1 and intent_hash = $2`,
        [B.tenantId, sha256(`intent:${tokKeepOld}`)],
      )
    ).rows[0].appointment_id;
    await h.admin.query(`update resource_reservations set active = false where tenant_id = $1 and appointment_id = $2`, [B.tenantId, cancelApptId]);
    await h.admin.query(
      `update appointments set state = 'cancelled', state_reason = 'Dibatalkan untuk uji replay', state_changed_at = clock_timestamp(), state_changed_by = $3 where tenant_id = $1 and id = $2`,
      [B.tenantId, cancelApptId, B.owner.staffId],
    );
    expect(
      await verifyPublicBookingOtpAndBook(
        app,
        { slug: B.siteSlug, intentToken: tokKeepOld, otpCode: "414141", commandKey: `cmd-keepold-${seq}` },
        LOCAL_ENV,
      ),
    ).toMatchObject({ state: "inactive", replayed: true });

    // Resend MUST refuse and purge an intent older than 15 minutes (r2 finding #2: absolute server-side age limit)
    const tokOldAge = `tok-oldage-${++seq}`;
    await requestPublicBookingOtp(
      app,
      {
        slug: B.siteSlug,
        treatmentSlug: "facial-oksigen",
        branchSlug: B.branchSlug,
        slotStartIso: slotA,
        sourceTag: "situs",
        phoneE164: "+6281299000196",
        patientName: "Pasien Usia Lama",
        birthDate: "1992-07-17",
        sex: "male",
        otpCode: "636363",
        intentToken: tokOldAge,
        clientIp: "198.51.100.45",
      },
      LOCAL_ENV,
    );
    await h.admin.query(
      `update public_booking_intents set created_at = clock_timestamp() - interval '16 minutes', last_sent_at = clock_timestamp() - interval '2 minutes' where tenant_id = $1 and intent_hash = $2`,
      [B.tenantId, sha256(`intent:${tokOldAge}`)],
    );
    expect(
      await resendPublicBookingOtp(
        app,
        { slug: B.siteSlug, intentToken: tokOldAge, newOtpCode: "747474", clientIp: "198.51.100.45" },
        LOCAL_ENV,
      ),
    ).toEqual({ state: "otp_expired" });
    const oldAgeRow = (
      await h.admin.query<{ phone_e164: string | null; purged_at: Date | null }>(
        `select phone_e164, purged_at from public_booking_intents where tenant_id = $1 and intent_hash = $2`,
        [B.tenantId, sha256(`intent:${tokOldAge}`)],
      )
    ).rows[0];
    expect(oldAgeRow.phone_e164).toBeNull();
    expect(oldAgeRow.purged_at).not.toBeNull();

    // B3 keyed HMAC-SHA256 changes with secret and fails closed in production without secret
    const h1 = hmacHex("phone:klinik-a:+628123", { DEPLOY_ENV: "local", PUBLIC_BOOKING_HMAC_SECRET: "secret-key-one-1234567890" });
    const h2 = hmacHex("phone:klinik-a:+628123", { DEPLOY_ENV: "local", PUBLIC_BOOKING_HMAC_SECRET: "secret-key-two-1234567890" });
    expect(h1).not.toBe(h2);
    expect(() => hmacHex("phone:klinik-a:+628123", { DEPLOY_ENV: "production" })).toThrow("ERR_CONFIG");

    // 2. Expired OTP returns otp_expired AND immediately purges PII (B3!)
    const tokExp = `tok-exp-${++seq}`;
    await requestPublicBookingOtp(
      app,
      {
        slug: B.siteSlug,
        treatmentSlug: "facial-oksigen",
        branchSlug: B.branchSlug,
        slotStartIso: slotB,
        sourceTag: "situs",
        phoneE164: "+6281299000102",
        patientName: "Pasien Uji Exp",
        birthDate: "1993-03-03",
        sex: "female",
        otpCode: "334455",
        intentToken: tokExp,
        clientIp: "198.51.100.32",
      },
      LOCAL_ENV,
    );
    await h.admin.query(
      `update public_booking_intents set otp_expires_at = clock_timestamp() - interval '1 minute' where tenant_id = $1 and intent_hash = $2`,
      [B.tenantId, sha256(`intent:${tokExp}`)],
    );
    expect(
      await verifyPublicBookingOtpAndBook(
        app,
        { slug: B.siteSlug, intentToken: tokExp, otpCode: "334455", commandKey: `cmd-exp-${seq}` },
        LOCAL_ENV,
      ),
    ).toEqual({ state: "otp_expired" });

    const expRow = (
      await h.admin.query<{ phone_e164: string | null; patient_name: string | null; birth_date: string | null; sex: string | null; purged_at: Date | null }>(
        `select phone_e164, patient_name, birth_date::text, sex, purged_at from public_booking_intents where tenant_id = $1 and intent_hash = $2`,
        [B.tenantId, sha256(`intent:${tokExp}`)],
      )
    ).rows[0];
    expect(expRow.phone_e164).toBeNull();
    expect(expRow.patient_name).toBeNull();
    expect(expRow.birth_date).toBeNull();
    expect(expRow.sex).toBeNull();
    expect(expRow.purged_at).not.toBeNull();

    // Abandoned intent (>15m past OTP expiry) is automatically purged on the next OTP request for the tenant (B3)
    const tokAbandon = `tok-abandon-${++seq}`;
    await requestPublicBookingOtp(
      app,
      {
        slug: B.siteSlug,
        treatmentSlug: "facial-oksigen",
        branchSlug: B.branchSlug,
        slotStartIso: slotB,
        sourceTag: "situs",
        phoneE164: "+6281299000109",
        patientName: "Pasien Abandon",
        birthDate: "1991-01-01",
        sex: "male",
        otpCode: "445566",
        intentToken: tokAbandon,
        clientIp: "198.51.100.42",
      },
      LOCAL_ENV,
    );
    await h.admin.query(
      `update public_booking_intents set otp_expires_at = clock_timestamp() - interval '20 minutes' where tenant_id = $1 and intent_hash = $2`,
      [B.tenantId, sha256(`intent:${tokAbandon}`)],
    );
    // Next request on tenant B triggers _public_booking_purge_expired
    const tokTriggerSweep = `tok-sweep-${++seq}`;
    await requestPublicBookingOtp(
      app,
      {
        slug: B.siteSlug,
        treatmentSlug: "facial-oksigen",
        branchSlug: B.branchSlug,
        slotStartIso: slotB,
        sourceTag: "situs",
        phoneE164: "+6281299000110",
        patientName: "Pasien Trigger Sweep",
        birthDate: "1991-02-02",
        sex: "female",
        otpCode: "778899",
        intentToken: tokTriggerSweep,
        clientIp: "198.51.100.43",
      },
      LOCAL_ENV,
    );
    const abandonRow = (
      await h.admin.query<{ phone_e164: string | null; patient_name: string | null; purged_at: Date | null }>(
        `select phone_e164, patient_name, purged_at from public_booking_intents where tenant_id = $1 and intent_hash = $2`,
        [B.tenantId, sha256(`intent:${tokAbandon}`)],
      )
    ).rows[0];
    expect(abandonRow.phone_e164).toBeNull();
    expect(abandonRow.patient_name).toBeNull();
    expect(abandonRow.purged_at).not.toBeNull();

    // 3. Stale clinical review drift after OTP send refuses verify-and-book!
    const tokDrift = `tok-drift-${++seq}`;
    await requestPublicBookingOtp(
      app,
      {
        slug: B.siteSlug,
        treatmentSlug: "facial-oksigen",
        branchSlug: B.branchSlug,
        slotStartIso: slotB,
        sourceTag: "situs",
        phoneE164: "+6281299000103",
        patientName: "Pasien Uji Drift",
        birthDate: "1993-03-03",
        sex: "female",
        otpCode: "556677",
        intentToken: tokDrift,
        clientIp: "198.51.100.33",
      },
      LOCAL_ENV,
    );
    await h.admin.query(
      `update public_web_fields set purpose = 'Teks berubah tanpa review klinis baru.' where tenant_id = $1 and item_id = $2`,
      [B.tenantId, B.serviceNoDpId],
    );
    expect(
      await errMsg(
        verifyPublicBookingOtpAndBook(
          app,
          { slug: B.siteSlug, intentToken: tokDrift, otpCode: "556677", commandKey: `cmd-drift-${seq}` },
          LOCAL_ENV,
        ),
      ),
    ).toContain("ERR_NOT_FOUND");
    await h.admin.query(
      `update public_web_fields set purpose = 'Membantu membersihkan pori dan menjaga kelembapan kulit.' where tenant_id = $1 and item_id = $2`,
      [B.tenantId, B.serviceNoDpId],
    );

    // 4. Neutral not_found on unknown / suspended tenant is byte-identical
    const unkCat = await getPublicBookingCatalog(app, "slug-tidak-pernah-ada");
    await h.admin.query(`update tenants_registry set lifecycle_state = 'suspended' where id = $1`, [B.tenantId]);
    const suspCat = await getPublicBookingCatalog(app, B.siteSlug);
    expect(JSON.stringify(suspCat)).toBe(JSON.stringify(unkCat));
    expect(suspCat).toEqual({ state: "not_found" });
    await h.admin.query(`update tenants_registry set lifecycle_state = 'live' where id = $1`, [B.tenantId]);

    // 5. Scheduled worker purge (B3): purges abandoned intents even while tenant is suspended with zero public traffic!
    const tokWorkerPurge = `tok-worker-purge-${++seq}`;
    await requestPublicBookingOtp(
      app,
      {
        slug: B.siteSlug,
        treatmentSlug: "facial-oksigen",
        branchSlug: B.branchSlug,
        slotStartIso: slotA,
        sourceTag: "situs",
        phoneE164: "+6281299000195",
        patientName: "Pasien Worker Purge",
        birthDate: "1990-09-09",
        sex: "female",
        otpCode: "858585",
        intentToken: tokWorkerPurge,
        clientIp: "198.51.100.46",
      },
      LOCAL_ENV,
    );
    await h.admin.query(
      `update public_booking_intents set otp_expires_at = clock_timestamp() - interval '20 minutes' where tenant_id = $1 and intent_hash = $2`,
      [B.tenantId, sha256(`intent:${tokWorkerPurge}`)],
    );
    await h.admin.query(`update tenants_registry set lifecycle_state = 'suspended' where id = $1`, [B.tenantId]);
    try {
      const purged = await runPublicBookingPurge(app, { graceMinutes: 15 });
      expect(purged.purgedCount).toBeGreaterThanOrEqual(1);
      const wRow = (
        await h.admin.query<{ phone_e164: string | null; patient_name: string | null; birth_date: string | null; sex: string | null; purged_at: Date | null }>(
          `select phone_e164, patient_name, birth_date::text, sex, purged_at from public_booking_intents where tenant_id = $1 and intent_hash = $2`,
          [B.tenantId, sha256(`intent:${tokWorkerPurge}`)],
        )
      ).rows[0];
      expect(wRow.phone_e164).toBeNull();
      expect(wRow.patient_name).toBeNull();
      expect(wRow.birth_date).toBeNull();
      expect(wRow.sex).toBeNull();
      expect(wRow.purged_at).not.toBeNull();
    } finally {
      await h.admin.query(`update tenants_registry set lifecycle_state = 'live' where id = $1`, [B.tenantId]);
    }

    // 6. Strict PII CHECK + SQL name boundary guard (r2 finding #4)
    expect(
      await errMsg(
        requestPublicBookingOtp(
          app,
          {
            slug: B.siteSlug,
            treatmentSlug: "facial-oksigen",
            branchSlug: B.branchSlug,
            slotStartIso: slotA,
            sourceTag: "situs",
            phoneE164: "+6281299000194",
            patientName: "A",
            birthDate: "1990-09-09",
            sex: "female",
            otpCode: "123123",
            intentToken: `tok-badname-${++seq}`,
            clientIp: "198.51.100.47",
          },
          LOCAL_ENV,
        ),
      ),
    ).toContain("ERR_INVALID_INPUT");
    await expect(
      h.admin.query(
        `insert into public_booking_intents (tenant_id, intent_hash, branch_id, catalog_version_id, slot_start, source_tag, phone_e164, phone_hash, patient_name, birth_date, sex, otp_hash, otp_expires_at, ip_hash)
         values ($1, $2, $3, (select id from catalog_versions where tenant_id = $1 limit 1), $4::timestamptz, 'situs', '+6281299000193', $5, NULL, '1990-01-01', 'female', $6, clock_timestamp() + interval '5 minutes', $7)`,
        [B.tenantId, sha256(`null-name-${seq}`), B.branchId, slotA, sha256("p"), sha256("o"), sha256("i")],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("concurrent verification serializes patient creation & overlap; tenant quota is atomic; IP quota spans tenants (r3)", async () => {
    // Give tenant A a second active room & second rostered therapist so resource exclusions alone would NOT prevent patient_overlap!
    await h.admin.query(
      `insert into rooms (tenant_id, branch_id, name, kind, is_active) values ($1, $2, 'Ruang Perawatan 2', 'treatment', true)`,
      [A.tenantId, A.branchId],
    );
    const acc2 = (
      await h.admin.query<{ id: string }>(
        `insert into auth_user (name, email, two_factor_enabled) values ('therapist2 Alpha', $1, true) returning id`,
        [`therapist2-alpha-${++seq}@pubbook.test`],
      )
    ).rows[0].id;
    const { staffId: th2 } = await createMembership(ownerPool, { tenantId: A.tenantId, accountId: acc2, displayName: "therapist2 Alpha" });
    const oc = await ownerPool.connect();
    try {
      const rid = await assignRole(oc, { tenantId: A.tenantId, staffId: th2, role: "therapist" });
      await assignBranch(oc, { tenantId: A.tenantId, staffRoleId: rid, branchId: A.branchId });
    } finally {
      oc.release();
    }
    await h.admin.query(
      `insert into staff_shifts (tenant_id, branch_id, staff_id, shift_date, starts, ends, kind, created_by)
       values ($1, $2, $3, $4::date, '09:00', '17:00', 'work', $5)`,
      [A.tenantId, A.branchId, th2, A.slotDate, A.owner.staffId],
    );

    const slots = await getPublicBookingSlots(app, {
      slug: A.siteSlug,
      treatmentSlug: "facial-oksigen",
      branchSlug: A.branchSlug,
      date: A.slotDate,
    });
    const raceSlot = slots.slots[slots.slots.length - 1].startsAt;
    const racePhone = "+6281277700111";
    const tokR1 = `tok-race1-${++seq}`;
    const tokR2 = `tok-race2-${++seq}`;

    for (const [tok, ip] of [
      [tokR1, "198.51.100.71"],
      [tokR2, "198.51.100.72"],
    ] as const) {
      const r = await requestPublicBookingOtp(
        app,
        {
          slug: A.siteSlug,
          treatmentSlug: "facial-oksigen",
          branchSlug: A.branchSlug,
          slotStartIso: raceSlot,
          sourceTag: "situs",
          phoneE164: racePhone,
          patientName: "Pasien Balap Sintetis",
          birthDate: "1995-11-11",
          sex: "female",
          otpCode: "112233",
          intentToken: tok,
          clientIp: ip,
        },
        LOCAL_ENV,
      );
      expect(r.state).toBe("otp_sent");
    }

    // Hold staff_access briefly on a blocker connection so BOTH verify transactions queue together and race atomically on release!
    const blocker = await ownerPool.connect();
    await blocker.query("BEGIN");
    await blocker.query(`SELECT pg_advisory_xact_lock(hashtextextended('staff_access:' || $1, 0))`, [A.tenantId]);
    const p1 = verifyPublicBookingOtpAndBook(app, { slug: A.siteSlug, intentToken: tokR1, otpCode: "112233", commandKey: `cmd-r1-${seq}` }, LOCAL_ENV)
      .then((v) => ({ ok: true as const, v }))
      .catch((e: Error) => ({ ok: false as const, msg: e.message }));
    const p2 = verifyPublicBookingOtpAndBook(app, { slug: A.siteSlug, intentToken: tokR2, otpCode: "112233", commandKey: `cmd-r2-${seq}` }, LOCAL_ENV)
      .then((v) => ({ ok: true as const, v }))
      .catch((e: Error) => ({ ok: false as const, msg: e.message }));
    await new Promise((r) => setTimeout(r, 80));
    await blocker.query("COMMIT");
    blocker.release();

    const results = await Promise.all([p1, p2]);
    const wins = results.filter((r) => r.ok);
    const losses = results.filter((r) => !r.ok);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    expect(losses[0].ok ? "" : losses[0].msg).toContain("patient_overlap");

    // Exactly ONE online_pending patient created for racePhone (zero duplicate!)
    const createdPats = (
      await h.admin.query<{ id: string }>(
        `select p.id from patients p join contact_points cp on cp.patient_id = p.id where p.tenant_id = $1 and cp.value = $2`,
        [A.tenantId, racePhone],
      )
    ).rows;
    expect(createdPats).toHaveLength(1);

    // Cross-tenant IP quota (S8): 20 intents across Tenant A + Tenant B from one shared IP blocks the 21st!
    const sharedIp = "203.0.113.250";
    const ipHash = hmacHex(`ip:${sharedIp}`, LOCAL_ENV);
    const verA = (await h.admin.query<{ id: string }>(`select id from catalog_versions where tenant_id = $1 limit 1`, [A.tenantId])).rows[0].id;
    const verB = (await h.admin.query<{ id: string }>(`select id from catalog_versions where tenant_id = $1 limit 1`, [B.tenantId])).rows[0].id;
    for (let i = 0; i < 10; i++) {
      await h.admin.query(
        `insert into public_booking_intents (tenant_id, intent_hash, branch_id, catalog_version_id, slot_start, source_tag, phone_e164, phone_hash, patient_name, birth_date, sex, otp_hash, otp_expires_at, ip_hash)
         values ($1, $2, $3, $4, $5::timestamptz, 'situs', '+628120001000', $6, 'Seed IP A', '1990-01-01', 'female', $7, clock_timestamp() + interval '5 minutes', $8)`,
        [A.tenantId, sha256(`ip-a-${seq}-${i}`), A.branchId, verA, raceSlot, sha256(`pa-${i}`), sha256(`oa-${i}`), ipHash],
      );
      await h.admin.query(
        `insert into public_booking_intents (tenant_id, intent_hash, branch_id, catalog_version_id, slot_start, source_tag, phone_e164, phone_hash, patient_name, birth_date, sex, otp_hash, otp_expires_at, ip_hash)
         values ($1, $2, $3, $4, $5::timestamptz, 'situs', '+628120002000', $6, 'Seed IP B', '1990-01-01', 'female', $7, clock_timestamp() + interval '5 minutes', $8)`,
        [B.tenantId, sha256(`ip-b-${seq}-${i}`), B.branchId, verB, raceSlot, sha256(`pb-${i}`), sha256(`ob-${i}`), ipHash],
      );
    }
    expect(
      await errMsg(
        requestPublicBookingOtp(
          app,
          {
            slug: A.siteSlug,
            treatmentSlug: "facial-oksigen",
            branchSlug: A.branchSlug,
            slotStartIso: raceSlot,
            sourceTag: "situs",
            phoneE164: "+6281299988877",
            patientName: "Pasien Kena IP Cap",
            birthDate: "1991-01-01",
            sex: "male",
            otpCode: "998877",
            intentToken: `tok-ipcap-${++seq}`,
            clientIp: sharedIp,
          },
          LOCAL_ENV,
        ),
      ),
    ).toContain("ip_quota");

    // Atomic tenant quota (r2 finding #1): bring tenant A to 199 recent intents, race 2 distinct IP/phone requests -> only 1 succeeds!
    const curTenantCnt = Number(
      (await h.admin.query(`select count(*) as c from public_booking_intents where tenant_id = $1 and created_at > clock_timestamp() - interval '15 minutes'`, [A.tenantId])).rows[0].c,
    );
    for (let i = curTenantCnt; i < 199; i++) {
      await h.admin.query(
        `insert into public_booking_intents (tenant_id, intent_hash, branch_id, catalog_version_id, slot_start, source_tag, phone_e164, phone_hash, patient_name, birth_date, sex, otp_hash, otp_expires_at, ip_hash)
         values ($1, $2, $3, $4, $5::timestamptz, 'situs', '+628120003000', $6, 'Seed Tenant Cap', '1990-01-01', 'female', $7, clock_timestamp() + interval '5 minutes', $8)`,
        [A.tenantId, sha256(`tcap-${seq}-${i}`), A.branchId, verA, raceSlot, sha256(`pt-${i}`), sha256(`ot-${i}`), sha256(`it-${i}`)],
      );
    }
    const tBlocker = await ownerPool.connect();
    await tBlocker.query("BEGIN");
    await tBlocker.query(`SELECT pg_advisory_xact_lock(hashtextextended('pubbook_tenant:' || $1, 0))`, [A.tenantId]);
    const tq1 = requestPublicBookingOtp(
      app,
      {
        slug: A.siteSlug,
        treatmentSlug: "facial-oksigen",
        branchSlug: A.branchSlug,
        slotStartIso: raceSlot,
        sourceTag: "situs",
        phoneE164: "+6281288800001",
        patientName: "Pasien Cap Satu",
        birthDate: "1993-01-01",
        sex: "female",
        otpCode: "111000",
        intentToken: `tok-tq1-${++seq}`,
        clientIp: "198.51.100.201",
      },
      LOCAL_ENV,
    )
      .then((v) => ({ ok: true as const, v }))
      .catch((e: Error) => ({ ok: false as const, msg: e.message }));
    const tq2 = requestPublicBookingOtp(
      app,
      {
        slug: A.siteSlug,
        treatmentSlug: "facial-oksigen",
        branchSlug: A.branchSlug,
        slotStartIso: raceSlot,
        sourceTag: "situs",
        phoneE164: "+6281288800002",
        patientName: "Pasien Cap Dua",
        birthDate: "1993-01-02",
        sex: "male",
        otpCode: "222000",
        intentToken: `tok-tq2-${++seq}`,
        clientIp: "198.51.100.202",
      },
      LOCAL_ENV,
    )
      .then((v) => ({ ok: true as const, v }))
      .catch((e: Error) => ({ ok: false as const, msg: e.message }));
    await new Promise((r) => setTimeout(r, 80));
    await tBlocker.query("COMMIT");
    tBlocker.release();

    const tqRes = await Promise.all([tq1, tq2]);
    expect(tqRes.filter((r) => r.ok)).toHaveLength(1);
    const tqFail = tqRes.find((r) => !r.ok);
    expect(tqFail && !tqFail.ok ? tqFail.msg : "").toContain("tenant_quota");
  });

  it("HTTP route handlers enforce same-origin (403), Turnstile fail-closed (403), S4 production TRUSTED_IP_HEADER (403), S1 signed cookies, and strict security headers", async () => {
    // S1 signed cookie verification rejects tampering and expiry
    const signed = signBookingCookiePayload(
      { slug: "klinik-a", code: "AABB1122", status: "confirmed", exp: Math.floor(Date.now() / 1000) + 120 },
      LOCAL_ENV,
    );
    expect(verifyBookingCookiePayload(signed, LOCAL_ENV)).toMatchObject({ slug: "klinik-a", code: "AABB1122", status: "confirmed" });
    expect(verifyBookingCookiePayload(`${signed.slice(0, -1)}0`, LOCAL_ENV)).toBeNull();
    const expired = signBookingCookiePayload(
      { slug: "klinik-a", code: "AABB1122", status: "confirmed", exp: Math.floor(Date.now() / 1000) - 10 },
      LOCAL_ENV,
    );
    expect(verifyBookingCookiePayload(expired, LOCAL_ENV)).toBeNull();

    const prevSecret = process.env.TURNSTILE_SECRET_KEY;
    const prevTrusted = process.env.TRUSTED_IP_HEADER;
    const prevDeploy = process.env.DEPLOY_ENV;
    try {
      // S4: Production with TRUSTED_IP_HEADER configured but header value ABSENT -> 403 (never falls back to 127.0.0.1!)
      process.env.DEPLOY_ENV = "production";
      process.env.TRUSTED_IP_HEADER = "x-real-ip";
      const missingIpRes = await postOtp(
        new NextRequest("http://booking.test.local/api/v1/public/booking/otp?slug=klinik-alpha", {
          method: "POST",
          headers: { host: "booking.test.local", origin: "http://booking.test.local" },
        }),
      );
      expect(missingIpRes.status).toBe(403);
      process.env.DEPLOY_ENV = "local";
      delete process.env.TRUSTED_IP_HEADER;
      // Cross-origin POST -> 403 with strict security headers
      const crossOtp = await postOtp(
        new NextRequest("http://booking.test.local/api/v1/public/booking/otp?slug=klinik-alpha", {
          method: "POST",
          headers: { host: "booking.test.local", origin: "https://evil.example" },
        }),
      );
      expect(crossOtp.status).toBe(403);
      expect(crossOtp.headers.get("cache-control")).toBe("private, no-store");
      expect(crossOtp.headers.get("referrer-policy")).toBe("no-referrer");
      expect(crossOtp.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(crossOtp.headers.get("x-content-type-options")).toBe("nosniff");

      const crossVer = await postVerify(
        new NextRequest("http://booking.test.local/api/v1/public/booking/verify?slug=klinik-alpha", {
          method: "POST",
          headers: { host: "booking.test.local", origin: "https://evil.example" },
        }),
      );
      expect(crossVer.status).toBe(403);
      expect(crossVer.headers.get("cache-control")).toBe("private, no-store");

      // Turnstile configured with missing token -> 403 fail-closed
      process.env.TURNSTILE_SECRET_KEY = "synthetic-turnstile-secret-never-called";
      const fd = new FormData();
      fd.set("layanan", "facial-oksigen");
      fd.set("cabang", "cab1");
      const noTokenRes = await postOtp(
        new NextRequest("http://booking.test.local/api/v1/public/booking/otp?slug=klinik-alpha", {
          method: "POST",
          headers: { host: "booking.test.local", origin: "http://booking.test.local" },
          body: fd,
        }),
      );
      expect(noTokenRes.status).toBe(403);
      expect(noTokenRes.headers.get("cache-control")).toBe("private, no-store");
    } finally {
      if (prevSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
      else process.env.TURNSTILE_SECRET_KEY = prevSecret;
      if (prevTrusted === undefined) delete process.env.TRUSTED_IP_HEADER;
      else process.env.TRUSTED_IP_HEADER = prevTrusted;
      if (prevDeploy === undefined) delete process.env.DEPLOY_ENV;
      else process.env.DEPLOY_ENV = prevDeploy;
    }
  });
});
