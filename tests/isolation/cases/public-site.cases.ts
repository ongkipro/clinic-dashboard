// DEL-2 cross-tenant negative cases for all 10 T-123 public site routes (PR-64, PR-65, Finding #8).
// Explicitly reserves /[slug]/booking for T-126.
// Exercises Tenant A's slug with Tenant B's treatment/branch detail handles and asserts zero cross-tenant leakage.
import { NextRequest } from "next/server";
import { handleDoctorPhotoGet } from "../../../src/app/api/v1/public/doctor-photo/[slug]/[doctor]/handler";
import { withTenantContext } from "../../../src/db/rls/context";
import { assignBranch, assignRole, createMembership } from "../../../src/modules/org/identity";
import {
  grantDoctorListingConsent,
  resolvePublicDoctorDetail,
  resolvePublicDoctorsBySlug,
  resolvePublicSiteBySlug,
  toTreatmentMeta,
} from "../../../src/modules/public-site";
import type { Json } from "../../../src/lib/command";
import { defineCases, type IsolationEnv } from "../case";
import { ensurePublishedSiteSeed, ensureSitusOwner } from "./situs.cases";

const asJson = (v: unknown): Json => JSON.parse(JSON.stringify(v)) as Json;

async function ensureConsentedDoctor(env: IsolationEnv, tenantId: string, branchId: string) {
  const own = await ensureSitusOwner(env, tenantId);
  const short = tenantId.replace(/-/g, "").slice(-10).toLowerCase();
  const docSlug = `dr-${short}`;
  const docName = `dr. SITUS-BRAND-${short.toUpperCase()}`;
  await env.owner.query(`update public_sites set show_doctors = true where tenant_id = $1`, [tenantId]);
  const existing = await env.owner.query<{ staff_id: string; photo_ref: string | null }>(
    `select staff_id, photo_ref from doctor_listing_consents where tenant_id = $1 and state = 'granted' and public_slug = $2 limit 1`,
    [tenantId, docSlug],
  );
  if ((existing.rowCount ?? 0) > 0) return { docSlug, docName, photoUrl: existing.rows[0].photo_ref ?? "" };
  const acc = (
    await env.owner.query<{ id: string }>(
      `insert into auth_user (name, email, two_factor_enabled) values ($1, $2, true) returning id`,
      [docName, `doc.${short}@isolation.test`],
    )
  ).rows[0].id;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: docName });
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId, staffId, role: "doctor" });
    await assignBranch(c, { tenantId, staffRoleId: rid, branchId });
  } finally {
    c.release();
  }
  const granted = await withTenantContext(env.app, { tenantId, staffId: own.staffId, roles: ["owner"], allowedBranchIds: "*" }, (db) =>
    grantDoctorListingConsent(db, {
      staffId,
      publicSlug: docSlug,
      displayName: docName,
      showPhoto: true,
      photoBytes: Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from(`PHOTO-${docName}`, "utf8"),
      ]),
      photoMediaType: "image/png",
      acknowledgementRef: `ISO-ACK-${short}`,
    }),
  );
  return { docSlug, docName, photoUrl: granted.photoUrl ?? "" };
}

async function prepareBoth(env: IsolationEnv) {
  const victim = await ensurePublishedSiteSeed(env, env.victim.tenantId, env.victim.branchId);
  const actor = await ensurePublishedSiteSeed(env, env.actor.tenantId, env.actor.branchId);
  env.victimSecret(victim.brandMarker);
  return { actor, victim };
}

export default defineCases(
  {
    kind: "route",
    id: "/[slug]",
    expect: "filtered",
    marker: (env) => `SITUS-BRAND-${env.victim.tenantId.replace(/-/g, "").slice(-10).toUpperCase()}`,
    async run(env) {
      const { actor } = await prepareBoth(env);
      const res = await resolvePublicSiteBySlug(actor.slug, env.app);
      return { status: res.state === "published" ? 200 : 404, body: asJson(res) };
    },
  },
  {
    kind: "route",
    id: "/[slug]/perawatan",
    expect: "filtered",
    marker: (env) => `SITUS-BRAND-${env.victim.tenantId.replace(/-/g, "").slice(-10).toUpperCase()}`,
    async run(env) {
      const { actor } = await prepareBoth(env);
      const res = await resolvePublicSiteBySlug(actor.slug, env.app);
      if (res.state !== "published") return { status: 404, body: res };
      return { status: 200, body: { brand: res.dto.brand, treatments: res.dto.treatments } };
    },
  },
  {
    kind: "route",
    id: "/[slug]/perawatan/[treatment]",
    expect: "not-found",
    marker: (env) => `SITUS-BRAND-${env.victim.tenantId.replace(/-/g, "").slice(-10).toUpperCase()}`,
    async run(env) {
      const { actor, victim } = await prepareBoth(env);
      // Request actor's slug with victim's treatment handle: succeeds ONLY when actor === victim!
      const res = await resolvePublicSiteBySlug(actor.slug, env.app);
      if (res.state !== "published") return { status: 404, body: null };
      const item = res.dto.treatments.find((t) => t.slug === victim.treatmentSlug);
      if (!item) return { status: 404, body: null };
      return { status: 200, body: { item, meta: toTreatmentMeta(item, res.dto.brand) } };
    },
  },
  {
    kind: "route",
    id: "/[slug]/cabang",
    expect: "filtered",
    marker: (env) => `SITUS-BRAND-${env.victim.tenantId.replace(/-/g, "").slice(-10).toUpperCase()}`,
    async run(env) {
      const { actor } = await prepareBoth(env);
      const res = await resolvePublicSiteBySlug(actor.slug, env.app);
      if (res.state !== "published") return { status: 404, body: res };
      return { status: 200, body: { brand: res.dto.brand, branches: res.dto.branches } };
    },
  },
  {
    kind: "route",
    id: "/[slug]/cabang/[branch]",
    expect: "filtered",
    marker: (env) => `SITUS-BRAND-${env.victim.tenantId.replace(/-/g, "").slice(-10).toUpperCase()}`,
    async run(env) {
      const { actor, victim } = await prepareBoth(env);
      const res = await resolvePublicSiteBySlug(actor.slug, env.app);
      if (res.state !== "published") return { status: 404, body: null };
      const branch = res.dto.branches.find((b) => b.slug === victim.branchSlug);
      return { status: branch ? 200 : 404, body: branch ? { brand: res.dto.brand, branch } : null };
    },
  },
  {
    kind: "route",
    id: "/[slug]/dokter",
    expect: "filtered",
    marker: (env) => `SITUS-BRAND-${env.victim.tenantId.replace(/-/g, "").slice(-10).toUpperCase()}`,
    async run(env) {
      const { actor } = await prepareBoth(env);
      await ensureConsentedDoctor(env, env.victim.tenantId, env.victim.branchId);
      await ensureConsentedDoctor(env, env.actor.tenantId, env.actor.branchId);
      const res = await resolvePublicSiteBySlug(actor.slug, env.app);
      if (res.state !== "published") return { status: 404, body: asJson(res) };
      const doctors = await resolvePublicDoctorsBySlug(actor.slug, env.app);
      return { status: 200, body: asJson({ brand: res.dto.brand, doctors }) };
    },
  },
  {
    kind: "route",
    id: "/[slug]/dokter/[doctor]",
    expect: "not-found",
    marker: (env) => `SITUS-BRAND-${env.victim.tenantId.replace(/-/g, "").slice(-10).toUpperCase()}`,
    async run(env) {
      const { actor } = await prepareBoth(env);
      const vDoc = await ensureConsentedDoctor(env, env.victim.tenantId, env.victim.branchId);
      await ensureConsentedDoctor(env, env.actor.tenantId, env.actor.branchId);
      // Request actor's slug with victim's doctor handle: succeeds ONLY on positive control (actor === victim)!
      const detail = await resolvePublicDoctorDetail(actor.slug, vDoc.docSlug, env.app);
      if (detail.state !== "found") return { status: 404, body: null };
      return { status: 200, body: asJson(detail) };
    },
  },
  {
    kind: "route",
    id: "/api/v1/public/doctor-photo/[slug]/[doctor]#route",
    expect: "not-found",
    marker: (env) => `SITUS-BRAND-${env.victim.tenantId.replace(/-/g, "").slice(-10).toUpperCase()}`,
    async run(env) {
      const { actor } = await prepareBoth(env);
      const vDoc = await ensureConsentedDoctor(env, env.victim.tenantId, env.victim.branchId);
      await ensureConsentedDoctor(env, env.actor.tenantId, env.actor.branchId);
      const ver = new URL(`http://booking.test.local${vDoc.photoUrl}`).searchParams.get("v") ?? "";
      const resp = await handleDoctorPhotoGet(
        new NextRequest(`http://booking.test.local/api/v1/public/doctor-photo/${actor.slug}/${vDoc.docSlug}?v=${ver}`),
        { slug: actor.slug, doctor: vDoc.docSlug },
        { db: env.app },
      );
      if (resp.status !== 200) return { status: resp.status, body: null };
      const bytes = Buffer.from(await resp.arrayBuffer()).toString("utf8");
      return { status: 200, body: { photo: bytes } };
    },
  },
  {
    kind: "route",
    id: "/[slug]/kebijakan-privasi",
    expect: "filtered",
    marker: (env) => `SITUS-BRAND-${env.victim.tenantId.replace(/-/g, "").slice(-10).toUpperCase()}`,
    async run(env) {
      const { actor } = await prepareBoth(env);
      const res = await resolvePublicSiteBySlug(actor.slug, env.app);
      if (res.state !== "published") return { status: 404, body: null };
      return { status: 200, body: res.dto.legalPages["kebijakan-privasi"] };
    },
  },
  {
    kind: "route",
    id: "/[slug]/syarat-ketentuan",
    expect: "filtered",
    marker: (env) => `SITUS-BRAND-${env.victim.tenantId.replace(/-/g, "").slice(-10).toUpperCase()}`,
    async run(env) {
      const { actor } = await prepareBoth(env);
      const res = await resolvePublicSiteBySlug(actor.slug, env.app);
      if (res.state !== "published") return { status: 404, body: null };
      return { status: 200, body: res.dto.legalPages["syarat-ketentuan"] };
    },
  },
  {
    kind: "route",
    id: "/[slug]/kebijakan-pembatalan",
    expect: "filtered",
    marker: (env) => `SITUS-BRAND-${env.victim.tenantId.replace(/-/g, "").slice(-10).toUpperCase()}`,
    async run(env) {
      const { actor } = await prepareBoth(env);
      const res = await resolvePublicSiteBySlug(actor.slug, env.app);
      if (res.state !== "published") return { status: 404, body: null };
      return { status: 200, body: res.dto.legalPages["kebijakan-pembatalan"] };
    },
  },
);
