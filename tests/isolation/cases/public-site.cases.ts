// DEL-2 cross-tenant negative cases for all 10 T-123 public site routes (PR-64, PR-65, Finding #8).
// Explicitly reserves /[slug]/booking for T-126.
// Exercises Tenant A's slug with Tenant B's treatment/branch detail handles and asserts zero cross-tenant leakage.
import { resolvePublicSiteBySlug, toTreatmentMeta } from "../../../src/modules/public-site";
import type { Json } from "../../../src/lib/command";
import { defineCases, type IsolationEnv } from "../case";
import { ensurePublishedSiteSeed } from "./situs.cases";

const asJson = (v: unknown): Json => JSON.parse(JSON.stringify(v)) as Json;

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
      const res = await resolvePublicSiteBySlug(actor.slug, env.app);
      if (res.state !== "published") return { status: 404, body: asJson(res) };
      return { status: 200, body: asJson({ brand: res.dto.brand, doctors: res.dto.doctors }) };
    },
  },
  {
    kind: "route",
    id: "/[slug]/dokter/[doctor]",
    expect: "filtered",
    marker: (env) => `SITUS-BRAND-${env.victim.tenantId.replace(/-/g, "").slice(-10).toUpperCase()}`,
    async run(env) {
      const { actor } = await prepareBoth(env);
      const res = await resolvePublicSiteBySlug(actor.slug, env.app);
      // Zero doctors until T-125; returns actor brand metadata only on positive control or neutral 404.
      if (res.state !== "published") return { status: 404, body: null };
      return { status: 200, body: { brand: res.dto.brand, doctor: null } };
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
