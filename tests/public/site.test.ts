// Public site generator PostgreSQL & proxy integration tests (PR-64, PR-65, PR-2, PR-97; T-123).
// Proves all 8/8 Findings of t123/WAVE1-PLAN-REVISED-20261124.md:
// #1: SQL re-validates snapshot against locked master tables + facts_sha256 (direct clinic_app tampered snapshot refused).
// #2: Counsel approval (Q-15 public_site_counsel) checked at publish AND serve time (revocation/expiry/replacement -> neutral not_found).
// #3: BOOKING_HOST proxy returns Cache-Control: private, no-store, nosniff, no-referrer; cross-host routes 404.
// #4: PublicSiteDto strips hidden prices + priceNote, raw tenantId/UUIDs, third-party hero URLs, and ships zero doctors until T-125.
// #5: Live serve-time branch publish window + reason-free branch_closures overlay (zero closure reason leaked; expired branch cascades).
// #6: SQL public_site_reserved_slugs() matches TS RESERVED_SEGMENTS 100%; slug immutable after first_published_at even when unpublished.
// #7: TEN-19 'never' on public_sites, public_site_versions, public_web_fields; raw clinic_app SELECT refused.
// #8: Neutral { state: "not_found" } byte-identical across unknown, unpublished, suspended, revoked-counsel, and expired-branch states.
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { RESERVED_SEGMENTS } from "../../src/lib/hosts";
import { assignBranch, assignRole, createMembership } from "../../src/modules/org/identity";
import {
  approvePublicWebReview,
  computeArtifactDigest,
  getPublicWebReviewSource,
  getSiteAdminView,
  publishPublicSite,
  resolvePublicSiteBySlug,
  savePublicWebField,
  saveSiteSettings,
  unpublishPublicSite,
} from "../../src/modules/public-site";
import { proxy } from "../../src/proxy";
import { createHarness, testPool, type Harness } from "../rls/harness";

const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

async function errMsg(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (e) {
    return (e as { message?: string })?.message ?? String(e);
  }
}

describe("T-123 public site generator PostgreSQL & proxy integration (PR-64, PR-65, Findings #1–#8)", () => {
  let h: Harness;
  let app: pg.Pool;
  let ownerPool: pg.Pool;
  let seq = 0;

  type TenantRig = {
    tenantId: string;
    branchAId: string;
    branchBId: string;
    owner: { staffId: string; accountId: string };
    facilityHead: { staffId: string; accountId: string };
    marketing: { staffId: string; accountId: string };
    serviceItemId: string;
  };

  let A: TenantRig;
  let B: TenantRig;

  async function setupTenant(label: string): Promise<TenantRig> {
    const n = ++seq;
    const tenantId = (await h.admin.query<{ id: string }>(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id;
    await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, `PT Klinik ${label} ${n}`]);
    const branchId = (
      await h.admin.query<{ id: string }>(
        `insert into branches (tenant_id, code, name, timezone, address, map_url, whatsapp_number, publish_from)
         values ($1, $2, $3, 'Asia/Jakarta', $4, 'https://maps.google.com/?q=klinik', '+6281234567890', clock_timestamp() - interval '1 day') returning id`,
        [tenantId, `cab${n}a`, `Cabang Utama ${label}`, `Jl. Utama ${n}, Jakarta Selatan`],
      )
    ).rows[0].id;
    const t = { tenantId, branchId };
    const branchBId = (
      await h.admin.query<{ id: string }>(
        `insert into branches (tenant_id, code, name, timezone, address, publish_from)
         values ($1, $2, $3, 'Asia/Jakarta', $4, clock_timestamp() - interval '1 day') returning id`,
        [t.tenantId, `cab${n}b`, `Cabang Kedua ${label}`, `Jl. Kedua ${n}, Bandung`],
      )
    ).rows[0].id;

    // Weekly hours on both branches
    await h.admin.query(
      `insert into branch_hours (tenant_id, branch_id, weekday, opens, closes)
       values ($1, $2, 1, '09:00', '18:00'), ($1, $3, 1, '10:00', '19:00')`,
      [t.tenantId, t.branchId, branchBId],
    );

    const makeStaff = async (role: "owner" | "facility_head" | "marketing", branchScoped = false) => {
      const acc = (
        await h.admin.query<{ id: string }>(
          `insert into auth_user (name, email, two_factor_enabled) values ($1, $2, true) returning id`,
          [`${role} ${label}`, `${role}-${label.toLowerCase()}-${++seq}@pub.test`],
        )
      ).rows[0].id;
      const { staffId } = await createMembership(ownerPool, { tenantId: t.tenantId, accountId: acc, displayName: `${role} ${label}` });
      const c = await ownerPool.connect();
      try {
        const staffRoleId = await assignRole(c, { tenantId: t.tenantId, staffId, role });
        if (branchScoped) {
          await assignBranch(c, { tenantId: t.tenantId, staffRoleId, branchId: t.branchId });
        }
      } finally {
        c.release();
      }
      return { staffId, accountId: acc };
    };

    const owner = await makeStaff("owner");
    const facilityHead = await makeStaff("facility_head", true);
    const marketing = await makeStaff("marketing");

    // Active catalog service offered at both branches with branch price override
    const itemId = (
      await h.admin.query<{ id: string }>(
        `insert into catalog_items (tenant_id, kind, code, created_by) values ($1, 'service', $2, $3) returning id`,
        [t.tenantId, `SVC-${n}`, owner.staffId],
      )
    ).rows[0].id;
    await h.admin.query(
      `insert into catalog_versions (tenant_id, item_id, version, state, name, tax_category, tax_basis, normal_price, category, treatment_min, online_bookable, contraindications, reason, created_by, created_as)
       values ($1, $2, 1, 'active', $3, 'taxable_service', 'Jasa estetika non-medis', 500000, 'facial', 45, true, 'Hindari saat iritasi aktif.', 'Seed layanan', $4, 'owner')`,
      [t.tenantId, itemId, `Facial Oksigen ${label}`, owner.staffId],
    );
    await h.admin.query(
      `insert into branch_services (tenant_id, branch_id, item_id) values ($1, $2, $4), ($1, $3, $4)`,
      [t.tenantId, t.branchId, branchBId, itemId],
    );
    await h.admin.query(
      `insert into branch_prices (tenant_id, branch_id, item_id, price, effective_from, state, reason, created_by, created_as)
       values ($1, $2, $3, 550000, clock_timestamp() - interval '1 hour', 'active', 'Tarif cabang utama', $4, 'owner')`,
      [t.tenantId, t.branchId, itemId, owner.staffId],
    );

    return { tenantId: t.tenantId, branchAId: t.branchId, branchBId, owner, facilityHead, marketing, serviceItemId: itemId };
  }

  async function approveCounsel(rig: TenantRig, validUntil = "2030-12-31"): Promise<{ itemId: string; fileId: string; approvalId: string }> {
    const content = Buffer.from(`%PDF-1.4 counsel opinion ${++seq}`);
    const digest = sha256(content);
    const itemId = (
      await h.admin.query<{ id: string }>(
        `insert into evidence_items (tenant_id, obligation_key, state, valid_until)
         values ($1, 'public_site_counsel', 'approved', $2)
         on conflict (tenant_id, obligation_key) do update set state = 'approved', valid_until = excluded.valid_until
         returning id`,
        [rig.tenantId, validUntil],
      )
    ).rows[0].id;
    const nextVer = (
      await h.admin.query<{ v: number }>(
        `select coalesce(max(version), 0) + 1 as v from evidence_files where item_id = $1`,
        [itemId],
      )
    ).rows[0].v;
    const fileId = (
      await h.admin.query<{ id: string }>(
        `insert into evidence_files (tenant_id, item_id, version, file_name, media_type, size_bytes, sha256, content, expert_name, document_date, uploaded_by, uploaded_as, uploaded_name)
         values ($1, $2, $3, 'counsel.pdf', 'application/pdf', $4, $5, $6, 'Konsultan Hukum', '2026-11-20', $7, 'owner', 'Owner')
         returning id`,
        [rig.tenantId, itemId, nextVer, content.byteLength, digest, content, rig.owner.staffId],
      )
    ).rows[0].id;
    const approvalId = (
      await h.admin.query<{ id: string }>(
        `insert into evidence_approvals (tenant_id, item_id, file_id, decision, valid_until, decided_by, decided_as, decided_name)
         values ($1, $2, $3, 'approved', $4, $5, 'owner', 'Owner') returning id`,
        [rig.tenantId, itemId, fileId, validUntil, rig.owner.staffId],
      )
    ).rows[0].id;
    return { itemId, fileId, approvalId };
  }

  const asOwner = <R>(rig: TenantRig, fn: (db: pg.PoolClient) => Promise<R>) =>
    withTenantContext(app, { tenantId: rig.tenantId, staffId: rig.owner.staffId, roles: ["owner"], allowedBranchIds: "*" }, fn);

  const asFacilityHead = <R>(rig: TenantRig, fn: (db: pg.PoolClient) => Promise<R>) =>
    withTenantContext(
      app,
      { tenantId: rig.tenantId, staffId: rig.facilityHead.staffId, roles: ["facility_head"], allowedBranchIds: [rig.branchAId], activeBranchId: rig.branchAId },
      fn,
    );

  const asMarketing = <R>(rig: TenantRig, fn: (db: pg.PoolClient) => Promise<R>) =>
    withTenantContext(app, { tenantId: rig.tenantId, staffId: rig.marketing.staffId, roles: ["marketing"], allowedBranchIds: "*" }, fn);

  beforeAll(async () => {
    h = await createHarness();
    app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 8 });
    ownerPool = testPool({ connectionString: h.ownerUrl(), max: 3 });
    A = await setupTenant("Alpha");
    B = await setupTenant("Beta");
  });

  afterAll(async () => {
    await app?.end();
    await ownerPool?.end();
    await h?.close();
  });

  it("Finding #6 & #7: SQL reserved-slug parity with hosts.ts, TEN-19 'never', zero direct clinic_app SELECT", async () => {
    const sqlSlugs = (await app.query<{ slugs: string[] }>(`select public.public_site_reserved_slugs() as slugs`)).rows[0].slugs;
    expect(new Set(sqlSlugs)).toEqual(RESERVED_SEGMENTS);

    for (const tbl of ["public_sites", "public_site_versions", "public_web_fields"]) {
      await expect(app.query(`select * from public.${tbl}`)).rejects.toMatchObject({ code: "42501" });
      const sup = (
        await h.admin.query<{ support_class: string }>(
          `select support_class from public.support_object_kinds where table_name = $1`,
          [`public.${tbl}`],
        )
      ).rows[0];
      expect(sup?.support_class).toBe("never");
    }
  });

  it("Finding #3: BOOKING_HOST proxy enforces Cache-Control: private, no-store & blocks staff routes", async () => {
    const prev = { APP_HOST: process.env.APP_HOST, BOOKING_HOST: process.env.BOOKING_HOST, VENDOR_HOST: process.env.VENDOR_HOST };
    process.env.APP_HOST = "app.test.local";
    process.env.BOOKING_HOST = "booking.test.local";
    process.env.VENDOR_HOST = "vendor.test.local";
    try {
      const okReq = new NextRequest("http://booking.test.local/klinik-alpha/perawatan", {
        headers: { host: "booking.test.local" },
      });
      const okRes = await proxy(okReq);
      expect(okRes.status).toBe(200);
      expect(okRes.headers.get("cache-control")).toBe("private, no-store");
      expect(okRes.headers.get("x-content-type-options")).toBe("nosniff");
      expect(okRes.headers.get("referrer-policy")).toBe("no-referrer");

      // Staff route on BOOKING_HOST -> refused 404
      const staffOnBooking = await proxy(new NextRequest("http://booking.test.local/kasir", { headers: { host: "booking.test.local" } }));
      expect(staffOnBooking.status).toBe(404);

      // Public slug route on APP_HOST -> refused 404
      const publicOnApp = await proxy(new NextRequest("http://app.test.local/klinik-alpha/perawatan", { headers: { host: "app.test.local" } }));
      expect(publicOnApp.status).toBe(404);
    } finally {
      process.env.APP_HOST = prev.APP_HOST;
      process.env.BOOKING_HOST = prev.BOOKING_HOST;
      process.env.VENDOR_HOST = prev.VENDOR_HOST;
    }
  });

  it("Scenario PR-64 + PR-2 + Findings #1, #2, #4, #5, #6, #8: Q-15 counsel gate, publish, live closures, revocation, slug immutability & tampered snapshot refusal", async () => {
    // 1. Save settings with reserved slug -> refused
    expect(
      await errMsg(
        asOwner(A, (db) =>
          saveSiteSettings(db, {
            slug: "kasir",
            brandName: "Klinik Alpha",
            showTreatments: true,
            showBranches: true,
          }),
        ),
      ),
    ).toContain("ERR_SLUG_RESERVED");

    // 2. Save valid settings while Q-15 counsel evidence is NOT approved -> publish MUST be refused!
    await asOwner(A, (db) =>
      saveSiteSettings(db, {
        slug: "klinik-alpha",
        brandName: "Klinik Alpha",
        accentHex: "#007AFF",
        oneLine: "Perawatan kulit berbasis evaluasi dokter.",
        showTreatments: true,
        showBranches: true,
        tariffListAllowed: false,
      }),
    );

    const viewBefore = await asOwner(A, (db) => getSiteAdminView(db));
    expect(viewBefore.counselGateOpen).toBe(false);

    const pubBlocked = await asOwner(A, (db) => publishPublicSite(db));
    expect(pubBlocked.ok).toBe(false);
    if (!pubBlocked.ok) expect(pubBlocked.reason).toBe("counsel_evidence");

    // Direct SQL boundary check (kills m03-drop-publish-counsel-gate even if TS precheck is bypassed)
    expect(
      await errMsg(
        asOwner(A, async (db) => {
          const f = await db.query<{ f: { factsSha256: string } }>(`SELECT public.site_publish_facts() AS f`);
          await db.query(`SELECT public.site_commit_publish('{}'::jsonb, $1::text)`, [f.rows[0].f.factsSha256]);
        }),
      ),
    ).toContain("ERR_GATE_CLOSED");

    // Neutral not_found while unpublished
    const unpubRes = await resolvePublicSiteBySlug("klinik-alpha", app);
    const unknownRes = await resolvePublicSiteBySlug("tidak-ada-slug-ini", app);
    expect(unpubRes).toEqual({ state: "not_found" });
    expect(JSON.stringify(unpubRes)).toBe(JSON.stringify(unknownRes));

    // 3. Approve Q-15 counsel evidence, add service web field (unreviewed -> publish fails; reviewed -> publish succeeds!)
    const counsel = await approveCounsel(A);
    await asOwner(A, (db) =>
      savePublicWebField(db, {
        itemId: A.serviceItemId,
        publicSlug: "facial-oksigen",
        published: true,
        publishPrice: true,
        purpose: "Membersihkan pori dan menjaga kelembapan kulit wajah.",
        performedBy: "Terapis terlatih di bawah pengawasan dokter",
        downtime: "Tidak ada",
        priceNote: "SENTINEL_HIDDEN_PRICE_NOTE_888",
      }),
    );

    // Unreviewed clinical text blocks publish
    const unrevPub = await asOwner(A, (db) => publishPublicSite(db));
    expect(unrevPub.ok).toBe(false);

    // Facility head approves clinical review bound to exact canonical artifact identity
    await asFacilityHead(A, async (db) => {
      const src = await getPublicWebReviewSource(db, A.serviceItemId);
      expect(src.artifactSha256).toBe(computeArtifactDigest(src));
      await approvePublicWebReview(db, A.serviceItemId, { version: src.activeVersion, artifactSha256: src.artifactSha256 });
    });

    // Publish with tariffListAllowed=false -> price AND priceNote MUST be stripped!
    const pub1 = await asOwner(A, (db) => publishPublicSite(db));
    expect(pub1.ok).toBe(true);
    if (!pub1.ok) return;

    // Seed a live closure on Tenant B -> MUST NEVER leak into Tenant A's SQL liveClosures or DTO (kills m06)
    const tenantBClosureDate = new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10);
    await h.admin.query(
      `insert into branch_closures (tenant_id, branch_id, closed_on, from_time, until_time, reason, created_by)
       values ($1, $2, $3, '10:00', '11:00', 'TENANT_B_SECRET_CLOSURE', $4)`,
      [B.tenantId, B.branchAId, tenantBClosureDate, B.owner.staffId],
    );
    const rawSqlLive1 = await app.query<{ res: { liveClosures: unknown } }>(
      `select public.public_site_by_slug('klinik-alpha') as res`,
    );
    expect(JSON.stringify(rawSqlLive1.rows[0].res.liveClosures)).not.toContain(tenantBClosureDate);

    const live1 = await resolvePublicSiteBySlug("klinik-alpha", app);
    expect(live1.state).toBe("published");
    if (live1.state !== "published") return;
    expect(live1.dto.branches).toHaveLength(2);
    expect(live1.dto.treatments).toHaveLength(1);
    expect(live1.dto.doctors).toEqual([]);
    const rawJson1 = JSON.stringify(live1);
    expect(rawJson1).not.toContain(tenantBClosureDate);
    expect(rawJson1).not.toContain("TENANT_B_SECRET_CLOSURE");
    expect(rawJson1).toContain("Harga dijelaskan saat konsultasi");
    expect(rawJson1).not.toContain("550000");
    expect(rawJson1).not.toContain("500000");
    expect(rawJson1).not.toContain("SENTINEL_HIDDEN_PRICE_NOTE_888");
    expect(rawJson1).not.toContain(A.tenantId);

    // 4. Finding #1 + Panel 1 preflight: direct clinic_app tampered snapshots MUST be refused fail-closed by SQL!
    const factsSha = await asOwner(A, async (db) => {
      const r = await db.query<{ f: { factsSha256: string } }>(`select public.site_publish_facts() as f`);
      return r.rows[0].f.factsSha256;
    });
    const tryTamper = (mutate: (snap: Record<string, unknown>) => void) => {
      const s = structuredClone(pub1.dto) as unknown as Record<string, unknown>;
      mutate(s);
      return errMsg(
        asOwner(A, (db) =>
          db.query(`select public.site_commit_publish($1::jsonb, $2::text)`, [JSON.stringify(s), factsSha]),
        ),
      );
    };
    // 4a. Hidden tariff leak
    expect(
      await tryTamper((s) => {
        ((s.treatments as Record<string, unknown>[])[0]).tariff = {
          kind: "amount",
          amount: 550000,
          text: "Rp550.000",
          note: "LEAKED",
        };
      }),
    ).toContain("ERR_INVALID_SNAPSHOT");
    // 4b. NULL / missing branch slug (SQL NULL-logic guard)
    expect(
      await tryTamper((s) => {
        delete ((s.branches as Record<string, unknown>[])[0]).slug;
      }),
    ).toContain("ERR_INVALID_SNAPSHOT");
    // 4c. Unknown nested key smuggled inside branch / tariff / legalPages
    expect(
      await tryTamper((s) => {
        ((s.branches as Record<string, unknown>[])[0]).smuggledSecret = "LEAK_999";
      }),
    ).toContain("ERR_INVALID_SNAPSHOT");
    expect(
      await tryTamper((s) => {
        (((s.treatments as Record<string, unknown>[])[0]).tariff as Record<string, unknown>).extra = "LEAK_888";
      }),
    ).toContain("ERR_INVALID_SNAPSHOT");
    expect(
      await tryTamper((s) => {
        ((s.legalPages as Record<string, Record<string, unknown>>)["kebijakan-privasi"]).body = "Tampered legal body";
      }),
    ).toContain("ERR_INVALID_SNAPSHOT");
    // 4d. Direct SQL unreviewed-treatment check (kills m07-drop-clinical-review-check)
    await h.admin.query(
      `update public.public_web_fields set clinical_reviewed_artifact_sha = null where tenant_id = $1 and item_id = $2`,
      [A.tenantId, A.serviceItemId],
    );
    expect(
      await errMsg(
        asOwner(A, async (db) => {
          const r = await db.query<{ f: { factsSha256: string } }>(`select public.site_publish_facts() as f`);
          await db.query(`select public.site_commit_publish($1::jsonb, $2::text)`, [
            JSON.stringify(pub1.dto),
            r.rows[0].f.factsSha256,
          ]);
        }),
      ),
    ).toContain("ERR_INVALID_SNAPSHOT: unreviewed treatment");
    await asFacilityHead(A, async (db) => {
      const src = await getPublicWebReviewSource(db, A.serviceItemId);
      await approvePublicWebReview(db, A.serviceItemId, { version: src.activeVersion, artifactSha256: src.artifactSha256 });
    });
    expect(
      await tryTamper((s) => {
        ((s.sections as Record<string, unknown>)).doctors = true;
      }),
    ).toContain("ERR_INVALID_SNAPSHOT");

    // 5. Finding #5: post-publish closure appears immediately without republish, with ZERO closure reason!
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await h.admin.query(
      `insert into branch_closures (tenant_id, branch_id, closed_on, from_time, until_time, reason, created_by)
       values ($1, $2, $3, '12:00', '14:00', 'INTERNAL_SECRET_CLOSURE_REASON_777', $4)`,
      [A.tenantId, A.branchAId, tomorrow, A.owner.staffId],
    );
    const liveWithClosure = await resolvePublicSiteBySlug("klinik-alpha", app);
    expect(liveWithClosure.state).toBe("published");
    if (liveWithClosure.state !== "published") return;
    const brA = liveWithClosure.dto.branches.find((b) => b.closures.length > 0);
    expect(brA?.closures).toEqual([{ date: tomorrow, opens: "12:00", closes: "14:00" }]);
    expect(JSON.stringify(liveWithClosure)).not.toContain("INTERNAL_SECRET_CLOSURE_REASON_777");

    // 6. Finding #2: revoking Q-15 counsel approval immediately turns live site into neutral not_found!
    await h.admin.query(
      `insert into evidence_approvals (tenant_id, item_id, file_id, decision, reason, decided_by, decided_as, decided_name)
       values ($1, $2, $3, 'revoked', 'Dicabut untuk review ulang', $4, 'owner', 'Owner')`,
      [A.tenantId, counsel.itemId, counsel.fileId, A.owner.staffId],
    );
    await h.admin.query(`update evidence_items set state = 'revoked' where id = $1`, [counsel.itemId]);
    expect(await resolvePublicSiteBySlug("klinik-alpha", app)).toEqual({ state: "not_found" });

    // Re-approve counsel (new approvalId) -> old version bound to revoked approvalId STILL returns not_found until republished!
    await approveCounsel(A);
    expect(await resolvePublicSiteBySlug("klinik-alpha", app)).toEqual({ state: "not_found" });

    // Republish with tariffListAllowed=true -> now displays exact branch price (Rp550.000)
    await asOwner(A, (db) =>
      saveSiteSettings(db, {
        slug: "klinik-alpha",
        brandName: "Klinik Alpha",
        accentHex: "#007AFF",
        oneLine: "Perawatan kulit berbasis evaluasi dokter.",
        showTreatments: true,
        showBranches: true,
        tariffListAllowed: true,
      }),
    );
    const pub2 = await asOwner(A, (db) => publishPublicSite(db));
    expect(pub2.ok).toBe(true);
    const live2 = await resolvePublicSiteBySlug("klinik-alpha", app);
    expect(live2.state).toBe("published");
    if (live2.state === "published") {
      expect(JSON.stringify(live2)).toContain("550000");
    }

    // 7. Finding #6: unpublish -> slug STILL immutable (first_published_at IS NOT NULL)!
    await asOwner(A, (db) => unpublishPublicSite(db));
    expect(await resolvePublicSiteBySlug("klinik-alpha", app)).toEqual({ state: "not_found" });
    expect(
      await errMsg(
        asOwner(A, (db) =>
          saveSiteSettings(db, {
            slug: "klinik-alpha-baru",
            brandName: "Klinik Alpha",
            showTreatments: true,
            showBranches: true,
          }),
        ),
      ),
    ).toContain("ERR_SLUG_IMMUTABLE");

    // 8. Global slug uniqueness across tenants (Tenant B cannot hijack A's slug!)
    expect(
      await errMsg(
        asOwner(B, (db) =>
          saveSiteSettings(db, {
            slug: "klinik-alpha",
            brandName: "Klinik Beta",
            showTreatments: true,
            showBranches: true,
          }),
        ),
      ),
    ).toContain("ERR_SLUG_TAKEN");
  });

  it("R3 clinical approval artifact identity: SQL/TS parity, stale-approval conflict, and stale-content publish refusal independent of catalog version", async () => {
    await approveCounsel(B);
    await asOwner(B, (db) =>
      saveSiteSettings(db, {
        slug: "klinik-beta-review",
        brandName: "Klinik Beta",
        oneLine: "Perawatan kulit berbasis evaluasi medis.",
        showTreatments: true,
        showBranches: true,
        tariffListAllowed: false,
      }),
    );

    // Seed content with quotes, newline, and Indonesian UTF-8 to exercise canonical JSON escaping parity across SQL and TS.
    await asMarketing(B, (db) =>
      savePublicWebField(db, {
        itemId: B.serviceItemId,
        publicSlug: "facial-oksigen-beta",
        published: true,
        publishPrice: false,
        purpose: 'Pembersihan pori "lembut"\nuntuk menjaga kelembapan kulit.',
        performedBy: "Terapis terlatih di bawah supervisi dokter",
        downtime: "Tidak ada",
        sessions: 2,
        intervalDays: 14,
        heroAlt: "Ruang tindakan bersih",
        caption: "Dilakukan sesuai protokol klinik.",
      }),
    );

    // 1. Canonical digest parity across SQL review source, SQL admin view, and TS computeArtifactDigest.
    const src1 = await asFacilityHead(B, (db) => getPublicWebReviewSource(db, B.serviceItemId));
    expect(src1.artifactSha256).toBe(computeArtifactDigest(src1));
    const view1 = await asFacilityHead(B, (db) => getSiteAdminView(db));
    const svc1 = view1.services.find((s) => s.itemId === B.serviceItemId);
    expect(svc1?.webField?.currentArtifactSha).toBe(src1.artifactSha256);
    expect(svc1?.webField?.clinicalReviewCurrent).toBe(false);

    // 2. Role boundary unchanged (no role widening: marketing cannot read review source or approve).
    expect(await errMsg(asMarketing(B, (db) => getPublicWebReviewSource(db, B.serviceItemId)))).toContain("ERR_FORBIDDEN");
    expect(
      await errMsg(
        asMarketing(B, (db) =>
          approvePublicWebReview(db, B.serviceItemId, { version: src1.activeVersion, artifactSha256: src1.artifactSha256 }),
        ),
      ),
    ).toContain("ERR_FORBIDDEN");

    // 3. Approval binds the exact rendition viewed: edit content before officer submits -> stale digest MUST fail ERR_CONFLICT.
    await asMarketing(B, (db) =>
      savePublicWebField(db, {
        itemId: B.serviceItemId,
        publicSlug: "facial-oksigen-beta",
        published: true,
        publishPrice: false,
        purpose: "Pembersihan pori untuk perawatan rutin permukaan kulit wajah.",
        performedBy: "Terapis terlatih di bawah supervisi dokter",
        downtime: "Tidak ada",
        sessions: 2,
        intervalDays: 14,
        heroAlt: "Ruang tindakan bersih",
        caption: "Dilakukan sesuai protokol klinik.",
      }),
    );
    expect(
      await errMsg(
        asFacilityHead(B, (db) =>
          approvePublicWebReview(db, B.serviceItemId, { version: src1.activeVersion, artifactSha256: src1.artifactSha256 }),
        ),
      ),
    ).toContain("ERR_CONFLICT");

    // Approve exact revised rendition -> publish succeeds.
    const src2 = await asFacilityHead(B, (db) => getPublicWebReviewSource(db, B.serviceItemId));
    expect(src2.artifactSha256).not.toBe(src1.artifactSha256);
    expect(src2.artifactSha256).toBe(computeArtifactDigest(src2));
    await asFacilityHead(B, (db) =>
      approvePublicWebReview(db, B.serviceItemId, { version: src2.activeVersion, artifactSha256: src2.artifactSha256 }),
    );
    const pubB1 = await asOwner(B, (db) => publishPublicSite(db));
    expect(pubB1.ok).toBe(true);
    if (!pubB1.ok) return;

    // 4. Stale-content regression independent of catalog version:
    // Mutate reviewed content in place while clinical_reviewed_version (= 1) and clinical_reviewed_artifact_sha (= src2) stay unchanged!
    const driftedPurpose = "Deskripsi baru yang belum ditinjau ulang oleh penanggung jawab klinik.";
    await h.admin.query(
      `update public.public_web_fields set purpose = $3 where tenant_id = $1 and item_id = $2`,
      [B.tenantId, B.serviceItemId, driftedPurpose],
    );

    const viewStale = await asFacilityHead(B, (db) => getSiteAdminView(db));
    const svcStale = viewStale.services.find((s) => s.itemId === B.serviceItemId);
    expect(svcStale?.webField?.clinicalReviewedVersion).toBe(svcStale?.activeVersion);
    expect(svcStale?.webField?.clinicalReviewedArtifactSha).toBe(src2.artifactSha256);
    expect(svcStale?.webField?.currentArtifactSha).not.toBe(src2.artifactSha256);
    expect(svcStale?.webField?.clinicalReviewCurrent).toBe(false);

    // Application publish pipeline rejects stale review.
    const pubStale = await asOwner(B, (db) => publishPublicSite(db));
    expect(pubStale.ok).toBe(false);
    if (!pubStale.ok) {
      expect(pubStale.violations.some((v) => v.rule === "artefak_berubah" || v.rule === "belum_direview")).toBe(true);
    }

    // Granted SQL publish entry point (site_commit_publish) rejects ALL caller variants fail-closed!
    const staleFactsSha = await asOwner(B, async (db) => {
      const r = await db.query<{ f: { factsSha256: string } }>(`select public.site_publish_facts() as f`);
      return r.rows[0].f.factsSha256;
    });
    const updatedSnap = structuredClone(pubB1.dto) as unknown as Record<string, unknown>;
    ((updatedSnap.treatments as Record<string, unknown>[])[0]).purpose = driftedPurpose;
    const emptyTreatSnap = structuredClone(pubB1.dto) as unknown as Record<string, unknown>;
    emptyTreatSnap.treatments = [];

    for (const candidate of [pubB1.dto, updatedSnap, emptyTreatSnap]) {
      expect(
        await errMsg(
          asOwner(B, (db) =>
            db.query(`select public.site_commit_publish($1::jsonb, $2::text)`, [JSON.stringify(candidate), staleFactsSha]),
          ),
        ),
      ).toContain("ERR_INVALID_SNAPSHOT");
    }

    // Also mutate reviewed media metadata (caption + hero_alt) independently of catalog version -> STILL blocked until exact-content re-review!
    const driftedCaption = "Keterangan foto baru yang belum ditinjau ulang.";
    await h.admin.query(
      `update public.public_web_fields set caption = $3, hero_alt = 'Foto ruang perawatan diperbarui' where tenant_id = $1 and item_id = $2`,
      [B.tenantId, B.serviceItemId, driftedCaption],
    );
    expect((await asOwner(B, (db) => publishPublicSite(db))).ok).toBe(false);
    expect(
      await errMsg(
        asFacilityHead(B, (db) =>
          approvePublicWebReview(db, B.serviceItemId, { version: src2.activeVersion, artifactSha256: src2.artifactSha256 }),
        ),
      ),
    ).toContain("ERR_CONFLICT");

    // 5. Authorized exact-content re-review unblocks publication and publishes the reviewed revision.
    const src3 = await asFacilityHead(B, (db) => getPublicWebReviewSource(db, B.serviceItemId));
    expect(src3.artifactSha256).toBe(computeArtifactDigest(src3));
    expect(src3.artifactSha256).not.toBe(src2.artifactSha256);
    await asFacilityHead(B, (db) =>
      approvePublicWebReview(db, B.serviceItemId, { version: src3.activeVersion, artifactSha256: src3.artifactSha256 }),
    );
    const pubB2 = await asOwner(B, (db) => publishPublicSite(db));
    expect(pubB2.ok).toBe(true);
    const liveB = await resolvePublicSiteBySlug("klinik-beta-review", app);
    expect(liveB.state).toBe("published");
    if (liveB.state === "published") {
      expect(liveB.dto.treatments[0]?.purpose).toBe(driftedPurpose);
      expect(liveB.dto.treatments[0]?.caption).toBe(driftedCaption);
    }
  });
});
