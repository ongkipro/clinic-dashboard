// Public site database adapter (PR-64, PR-65, UX-50, UX-51; T-123).
// Wraps SECURITY DEFINER SQL functions from migration 0136:
// - site_admin_view(): staff admin workspace state (site settings, counsel gate, catalog services + web fields, promos read-only).
// - site_save_settings(...): saves slug (refused after first_published_at), brand, accent, heroPhoto, oneLine, section toggles, counsel permissions.
// - site_save_web_field(...): saves per-service public copy/slug/publish flags; clears clinical review if artifact changes.
// - site_approve_web_review(...): clinical lead (facility_head / owner) stamps clinical_reviewed_version + artifact sha256.
// - site_publish_facts() + site_commit_publish(...): transactional locked projection via T-124 rules.ts + SQL re-validation.
// - site_unpublish(): sets state='unpublished', published_version=NULL while preserving first_published_at (slug stays immutable!).
// - public_site_by_slug(slug): unbound read for BOOKING_HOST; checks live tenant, live counsel approval, live branch windows & reason-free closures.
import type { Pool, PoolClient } from "pg";
import type { LegalTemplateKind, TemplateVars } from "./legal-templates";
import type { Violation } from "./rules/rules";
import {
  applyLiveBranchOverlay,
  buildPublicSiteDto,
  type BranchMaster,
  type LiveBranchClosure,
  type PublicSiteDto,
  type TreatmentMaster,
} from "./snapshot";

type Db = Pick<Pool, "query"> | Pick<PoolClient, "query">;

export type SiteSettingsRow = {
  slug: string;
  state: "draft" | "published" | "unpublished";
  firstPublishedAt: string | null;
  publishedVersion: number | null;
  brandName: string;
  accentHex: string | null;
  heroPhoto: string | null;
  oneLine: string | null;
  showTreatments: boolean;
  showBranches: boolean;
  showDoctors: boolean;
  tariffListAllowed: boolean;
  doctorTitlesAllowed: boolean;
  counselApprovalId: string | null;
  metaPixelId: string | null;
  gaMeasurementId: string | null;
};

export type AdminServiceWebRow = {
  itemId: string;
  code: string;
  name: string;
  category: string | null;
  activeVersion: number;
  onlineBookable: boolean;
  contraindications: string | null;
  durationMin: number | null;
  webField: {
    publicSlug: string;
    published: boolean;
    publishPrice: boolean;
    purpose: string;
    performedBy: string;
    downtime: string | null;
    sessions: number | null;
    intervalDays: number | null;
    priceNote: string | null;
    heroPhoto: string | null;
    heroAlt: string | null;
    caption: string | null;
    clinicalReviewedVersion: number | null;
    clinicalReviewedArtifactSha: string | null;
    clinicalReviewedAt: string | null;
    currentArtifactSha: string;
    clinicalReviewCurrent: boolean;
  } | null;
};

export type PublicWebReviewSource = {
  slug: string;
  name: string;
  purpose: string;
  performedBy: string;
  durationMin: number | null;
  downtime: string | null;
  sessions: number | null;
  intervalDays: number | null;
  contraindications: string | null;
  heroPhoto: string | null;
  heroAlt: string | null;
  caption: string | null;
  activeVersion: number;
  artifactSha256: string;
};

export type SiteAdminView = {
  site: SiteSettingsRow | null;
  suggestedSlug: string;
  counselGateOpen: boolean;
  currentCounselApprovalId: string | null;
  counselMissingLabels: string[];
  branches: {
    code: string;
    slug: string;
    name: string;
    timezone: string;
    inPublishWindow: boolean;
    publishFrom: string | null;
    publishUntil: string | null;
  }[];
  services: AdminServiceWebRow[];
  recentVersions: {
    version: number;
    slug: string;
    publishedAt: string;
    tariffListAllowed: boolean;
  }[];
};

export type SaveSiteSettingsInput = {
  slug: string;
  brandName: string;
  accentHex?: string | null;
  heroPhoto?: string | null;
  oneLine?: string | null;
  showTreatments: boolean;
  showBranches: boolean;
  showDoctors?: boolean;
  tariffListAllowed?: boolean;
  doctorTitlesAllowed?: boolean;
};

export type SaveWebFieldInput = {
  itemId: string;
  publicSlug: string;
  published: boolean;
  publishPrice: boolean;
  purpose: string;
  performedBy: string;
  downtime?: string | null;
  sessions?: number | null;
  intervalDays?: number | null;
  priceNote?: string | null;
  heroPhoto?: string | null;
  heroAlt?: string | null;
  caption?: string | null;
};

export type PublishResult =
  | { ok: true; version: number; slug: string; dto: PublicSiteDto }
  | {
      ok: false;
      reason: "counsel_evidence" | "slug" | "no_branch" | "invalid_media" | "invalid_template" | "violations";
      violations: Violation[];
    };

export type ResolvedPublicSite =
  | { state: "not_found" }
  | {
      state: "published";
      slug: string;
      version: number;
      dto: PublicSiteDto;
      metaPixelId: string | null;
      gaMeasurementId: string | null;
    };

export async function getSiteAdminView(db: Db): Promise<SiteAdminView> {
  const { rows } = await db.query<{ view: SiteAdminView }>(`SELECT public.site_admin_view() AS view`);
  return rows[0].view;
}

export async function saveSiteSettings(db: Db, input: SaveSiteSettingsInput): Promise<SiteSettingsRow> {
  const { rows } = await db.query<{ site: SiteSettingsRow }>(
    `SELECT public.site_save_settings($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) AS site`,
    [
      input.slug,
      input.brandName,
      input.accentHex ?? null,
      input.heroPhoto ?? null,
      input.oneLine ?? null,
      input.showTreatments,
      input.showBranches,
      input.showDoctors ?? false,
      input.tariffListAllowed ?? false,
      input.doctorTitlesAllowed ?? false,
    ],
  );
  return rows[0].site;
}

export async function savePublicWebField(db: Db, input: SaveWebFieldInput): Promise<{ itemId: string; publicSlug: string }> {
  const { rows } = await db.query<{ res: { itemId: string; publicSlug: string } }>(
    `SELECT public.site_save_web_field($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) AS res`,
    [
      input.itemId,
      input.publicSlug,
      input.published,
      input.publishPrice,
      input.purpose,
      input.performedBy,
      input.downtime ?? null,
      input.sessions ?? null,
      input.intervalDays ?? null,
      input.priceNote ?? null,
      input.heroPhoto ?? null,
      input.heroAlt ?? null,
      input.caption ?? null,
    ],
  );
  return rows[0].res;
}

export async function getPublicWebReviewSource(db: Db, itemId: string): Promise<PublicWebReviewSource> {
  const { rows } = await db.query<{ src: PublicWebReviewSource }>(
    `SELECT public.site_web_review_source($1::uuid) AS src`,
    [itemId],
  );
  return rows[0].src;
}

// Binds clinical approval to the exact version & canonical artifact digest reviewed by the officer;
// SQL locks authoritative rows and rejects ERR_CONFLICT if content or catalog version changed.
export async function approvePublicWebReview(
  db: Db,
  itemId: string,
  expected: { version: number; artifactSha256: string },
): Promise<{ version: number; artifactSha256: string }> {
  const { rows } = await db.query<{ res: { version: number; artifactSha256: string } }>(
    `SELECT public.site_approve_web_review($1::uuid, $2::int, $3::text) AS res`,
    [itemId, expected.version, expected.artifactSha256],
  );
  return rows[0].res;
}

type LockedPublishFacts = {
  factsSha256: string;
  nowIso: string;
  counselApproved: boolean;
  tariffListAllowed: boolean;
  brand: string;
  slug: string;
  accent: string | null;
  heroPhoto: string | null;
  oneLine: string | null;
  sections: { treatments: boolean; branches: boolean; doctors: boolean };
  branches: BranchMaster[];
  treatments: TreatmentMaster[];
  legalTemplates: Partial<Record<LegalTemplateKind, { version: number; body: string }>>;
  templateVars: TemplateVars;
};

export async function publishPublicSite(db: Db): Promise<PublishResult> {
  const { rows: factRows } = await db.query<{ facts: LockedPublishFacts }>(`SELECT public.site_publish_facts() AS facts`);
  const f = factRows[0].facts;

  const built = buildPublicSiteDto({
    brand: f.brand,
    slug: f.slug,
    accent: f.accent,
    heroPhoto: f.heroPhoto,
    oneLine: f.oneLine,
    now: new Date(f.nowIso),
    counselApproved: f.counselApproved,
    tariffListAllowed: f.tariffListAllowed,
    sections: f.sections,
    branches: f.branches,
    treatments: f.treatments,
    legalTemplates: f.legalTemplates,
    templateVars: f.templateVars,
  });

  if (!built.ok) {
    return {
      ok: false,
      reason: built.gateReason ?? "violations",
      violations: built.violations,
    };
  }

  const { rows } = await db.query<{ res: { version: number; slug: string } }>(
    `SELECT public.site_commit_publish($1::jsonb, $2::text) AS res`,
    [JSON.stringify(built.dto), f.factsSha256],
  );
  return {
    ok: true,
    version: rows[0].res.version,
    slug: rows[0].res.slug,
    dto: built.dto,
  };
}

export async function unpublishPublicSite(db: Db): Promise<{ state: "unpublished"; slug: string }> {
  const { rows } = await db.query<{ res: { state: "unpublished"; slug: string } }>(
    `SELECT public.site_unpublish() AS res`,
  );
  return rows[0].res;
}

type RawPublicSiteRow =
  | { state: "not_found" }
  | {
      state: "published";
      slug: string;
      version: number;
      snapshot: PublicSiteDto;
      liveBranchSlugs: string[];
      liveClosures: LiveBranchClosure[];
      metaPixelId: string | null;
      gaMeasurementId: string | null;
    };

// Unbound public site lookup for BOOKING_HOST (Finding #2, #4, #5).
// Executes directly against the unbound Pool/PoolClient without tenant context; returns neutral
// { state: "not_found" } for unknown, unpublished, suspended, revoked/expired counsel, or zero-live-branch tenants.
export async function resolvePublicSiteBySlug(slug: string, db: Db): Promise<ResolvedPublicSite> {
  const { rows } = await db.query<{ res: RawPublicSiteRow }>(
    `SELECT public.public_site_by_slug($1::text) AS res`,
    [slug],
  );
  const r = rows[0]?.res;
  if (!r || r.state !== "published") return { state: "not_found" };
  const overlaid = applyLiveBranchOverlay(
    r.snapshot,
    new Set(r.liveBranchSlugs),
    r.liveClosures,
  );
  if (!overlaid) return { state: "not_found" };
  return {
    state: "published",
    slug: r.slug,
    version: r.version,
    dto: overlaid,
    metaPixelId: r.metaPixelId,
    gaMeasurementId: r.gaMeasurementId,
  };
}
