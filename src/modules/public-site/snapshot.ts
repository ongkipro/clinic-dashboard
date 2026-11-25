// Public site canonical DTO & snapshot builder (PR-64, UX-50, UX-51; T-123).
// Closes Findings #1, #2, #4, #5, #6 of t123/WAVE1-PLAN-REVISED-20261124.md:
// - Uses T-124's canonical rules.ts chokepoint (projectTreatment + checkText).
// - Zero raw tenantId, staff/branch/item UUIDs in PublicSiteDto (canonical public slugs/handles only!).
// - Strips BOTH numeric prices AND priceNote when tariffListAllowed=false or publishPrice=false.
// - Rejects arbitrary third-party hero URLs (only allowlisted relative/tenant public media refs).
// - Drives slug immutability strictly from firstPublishedAt !== null (never publishedVersion === null).
// - Live serve-time filtering against branch publish windows (branch timezone) + reason-free live closures.
// - Ships zero doctors until T-125.
import { RESERVED_SEGMENTS as RESERVED } from "../../lib/hosts";
import {
  DEFAULT_LEGAL_TEMPLATES,
  renderLegalTemplate,
  validateLegalTemplate,
  type LegalTemplateKind,
  type TemplateVars,
} from "./legal-templates";
import {
  checkText,
  projectTreatment,
  type ClinicalReview,
  type PublicTreatment,
  type Violation,
} from "./rules/rules";

export const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
export const HANDLE = /^[a-z0-9][a-z0-9-]{0,127}$/;
const LEGAL_FORM = /^(pt|cv|koperasi|yayasan|perum|persero)\.?\s+/i;
const PUBLIC_MEDIA_REF = /^\/media\/public\/[a-z0-9-]+\/[a-f0-9]{64}\.(?:jpg|jpeg|png|webp)$/;
const SAFE_MAP_URL = /^https:\/\/(?:maps\.google\.com|www\.google\.com\/maps|maps\.app\.goo\.gl)\/[^\s"'<>]{1,400}$/;
const WA_E164 = /^[1-9][0-9]{7,14}$/;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function deriveSlug(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(LEGAL_FORM, "")
    .replace(/,?\s*tbk\.?$/i, "")
    .toLowerCase()
    .replace(/&/g, " dan ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  const s = base || "klinik";
  return RESERVED.has(s) ? `${s}-klinik` : s;
}

export const validSlug = (s: string): boolean => SLUG.test(s) && !RESERVED.has(s);

// Finding #6: slug becomes permanently immutable after the FIRST publish (even if later unpublished!).
export function slugEditable(site: { firstPublishedAt: string | Date | null }): boolean {
  return site.firstPublishedAt === null;
}

export function safePublicMediaRef(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  return PUBLIC_MEDIA_REF.test(trimmed) ? trimmed : null;
}

export function safeMapUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  return SAFE_MAP_URL.test(trimmed) ? trimmed : null;
}

export function safeWhatsappDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return WA_E164.test(digits) ? digits : null;
}

export type BranchMaster = {
  slug: string;
  name: string;
  city: string;
  timezone: string;
  address: string | null;
  mapUrl: string | null;
  whatsapp: string | null;
  hours: { weekday: number; opens: string; closes: string }[];
  publishFrom: string | null;
  publishUntil: string | null;
};

export type TreatmentMaster = {
  slug: string;
  name: string;
  category: string | null;
  purpose: string;
  performedBy: string;
  durationMin: number | null;
  downtime: string | null;
  sessions: number | null;
  intervalDays: number | null;
  contraindications: string | null;
  priceNote: string | null;
  heroPhoto: string | null;
  heroAlt: string | null;
  caption: string | null;
  clinicalReview: ClinicalReview;
  publishPrice: boolean;
  onlineBookable: boolean;
  published: boolean;
  branchPrices: Record<string, number | null>; // keyed by branch slug (never internal UUID!)
  branchSlugs: string[];
};

export type LiveBranchClosure = {
  branchSlug: string;
  date: string; // YYYY-MM-DD (never includes internal reason!)
  opens: string | null;
  closes: string | null;
};

export type PublicBranchDto = Readonly<{
  slug: string;
  name: string;
  city: string;
  timezone: string;
  address: string | null;
  mapUrl: string | null;
  whatsapp: string | null;
  hours: { weekday: number; opens: string; closes: string }[];
  closures: { date: string; opens: string | null; closes: string | null }[];
}>;

export type PublicTreatmentDto = Readonly<
  PublicTreatment & {
    category: string | null;
    bookable: boolean;
    branchSlugs: string[];
    branchTariffs: { branchSlug: string; tariff: PublicTreatment["tariff"] }[];
  }
>;

export type PublicLegalPageDto = Readonly<{
  kind: LegalTemplateKind;
  version: number;
  templateSha256: string;
  body: string;
}>;

// Strict PublicSiteDto shared by HTML, RSC, <meta>, and JSON-LD (Finding #4: zero tenantId or internal UUIDs!).
export type PublicSiteDto = Readonly<{
  brand: string;
  slug: string;
  accent: string | null;
  heroPhoto: string | null;
  oneLine: string | null;
  sections: { treatments: boolean; branches: boolean; doctors: boolean };
  branches: PublicBranchDto[];
  treatments: PublicTreatmentDto[];
  doctors: readonly never[]; // Zero doctors until T-125
  legalPages: Record<LegalTemplateKind, PublicLegalPageDto>;
  builtAt: string;
}>;

export function branchInWindow(b: Pick<BranchMaster, "publishFrom" | "publishUntil" | "timezone">, now: Date): boolean {
  const localDay = new Intl.DateTimeFormat("en-CA", { timeZone: b.timezone || "Asia/Jakarta" }).format(now);
  if (!b.publishFrom || b.publishFrom > localDay) return false;
  if (b.publishUntil && b.publishUntil <= localDay) return false;
  return true;
}

export type PublishInput = {
  brand: string;
  slug: string;
  accent: string | null;
  heroPhoto: string | null;
  oneLine: string | null;
  now: Date;
  counselApproved: boolean;
  tariffListAllowed: boolean;
  sections: { treatments: boolean; branches: boolean; doctors: boolean };
  branches: BranchMaster[];
  treatments: TreatmentMaster[];
  legalTemplates?: Partial<Record<LegalTemplateKind, { version: number; body: string }>>;
  templateVars: TemplateVars;
};

export type PublishBuildResult =
  | { ok: true; dto: PublicSiteDto }
  | { ok: false; gateReason?: "counsel_evidence" | "slug" | "no_branch" | "invalid_media" | "invalid_template"; violations: Violation[] };

export function buildPublicSiteDto(i: PublishInput): PublishBuildResult {
  if (!i.counselApproved) return { ok: false, gateReason: "counsel_evidence", violations: [] };
  if (!validSlug(i.slug)) return { ok: false, gateReason: "slug", violations: [] };
  if (i.heroPhoto && !safePublicMediaRef(i.heroPhoto)) {
    return { ok: false, gateReason: "invalid_media", violations: [] };
  }

  const activeBranches = i.branches.filter((b) => branchInWindow(b, i.now));
  if (activeBranches.length === 0) return { ok: false, gateReason: "no_branch", violations: [] };

  const liveBranchSlugs = new Set(activeBranches.map((b) => b.slug));
  const violations: Violation[] = [
    ...checkText("brand", i.brand),
    ...checkText("oneLine", i.oneLine),
  ];

  const publishedTreatments: PublicTreatmentDto[] = [];
  for (const t of i.treatments) {
    if (!t.published) continue;
    const validBranches = t.branchSlugs.filter((bs) => liveBranchSlugs.has(bs));
    if (validBranches.length === 0) continue;
    if (t.heroPhoto && !safePublicMediaRef(t.heroPhoto)) {
      return { ok: false, gateReason: "invalid_media", violations: [] };
    }
    const baseProj = projectTreatment({
      slug: t.slug,
      name: t.name,
      purpose: t.purpose,
      performedBy: t.performedBy,
      durationMin: t.durationMin,
      downtime: t.downtime,
      sessions: t.sessions,
      intervalDays: t.intervalDays,
      contraindications: t.contraindications,
      priceNote: t.priceNote,
      heroPhoto: safePublicMediaRef(t.heroPhoto),
      heroAlt: t.heroAlt,
      caption: t.caption,
      clinicalReview: t.clinicalReview,
      publishPrice: t.publishPrice,
      tariffListAllowed: i.tariffListAllowed,
      branchPrice: validBranches.map((bs) => t.branchPrices[bs] ?? null).find((p) => p !== null) ?? null,
    });
    if (!baseProj.ok) {
      violations.push(...baseProj.violations.map((v) => ({ ...v, field: `${t.slug}.${v.field}` })));
      continue;
    }
    const branchTariffs = validBranches.map((bs) => {
      const p = projectTreatment({
        slug: t.slug,
        name: t.name,
        purpose: t.purpose,
        performedBy: t.performedBy,
        durationMin: t.durationMin,
        downtime: t.downtime,
        sessions: t.sessions,
        intervalDays: t.intervalDays,
        contraindications: t.contraindications,
        priceNote: t.priceNote,
        heroPhoto: safePublicMediaRef(t.heroPhoto),
        heroAlt: t.heroAlt,
        caption: t.caption,
        clinicalReview: t.clinicalReview,
        publishPrice: t.publishPrice,
        tariffListAllowed: i.tariffListAllowed,
        branchPrice: t.branchPrices[bs] ?? null,
      });
      return { branchSlug: bs, tariff: p.ok ? p.page.tariff : baseProj.page.tariff };
    });
    publishedTreatments.push(
      Object.freeze({
        ...baseProj.page,
        category: t.category?.trim() || null,
        bookable: t.onlineBookable,
        branchSlugs: validBranches,
        branchTariffs,
      }),
    );
  }

  if (violations.length > 0) return { ok: false, violations };

  // Pin legal templates with version + sha256 (T-129 Finding #9)
  const legalPages = {} as Record<LegalTemplateKind, PublicLegalPageDto>;
  for (const kind of ["kebijakan-privasi", "syarat-ketentuan", "kebijakan-pembatalan"] as const) {
    const tpl = i.legalTemplates?.[kind] ?? { version: 1, body: DEFAULT_LEGAL_TEMPLATES[kind] };
    const v = validateLegalTemplate(tpl.body);
    if (!v.ok) return { ok: false, gateReason: "invalid_template", violations: [] };
    legalPages[kind] = Object.freeze({
      kind,
      version: tpl.version,
      templateSha256: v.sha256,
      body: renderLegalTemplate(tpl.body, i.templateVars),
    });
  }

  return {
    ok: true,
    dto: Object.freeze({
      brand: i.brand.trim(),
      slug: i.slug,
      accent: i.accent && HEX_COLOR.test(i.accent) ? i.accent : null,
      heroPhoto: safePublicMediaRef(i.heroPhoto),
      oneLine: i.oneLine?.trim() || null,
      sections: i.sections,
      branches: activeBranches.map((b) =>
        Object.freeze({
          slug: b.slug,
          name: b.name.trim(),
          city: b.city.trim(),
          timezone: b.timezone || "Asia/Jakarta",
          address: b.address?.trim() || null,
          mapUrl: safeMapUrl(b.mapUrl),
          whatsapp: safeWhatsappDigits(b.whatsapp),
          hours: b.hours,
          closures: [],
        }),
      ),
      treatments: i.sections.treatments ? publishedTreatments : [],
      doctors: [] as readonly never[],
      legalPages,
      builtAt: i.now.toISOString(),
    }),
  };
}

// Serve-time live branch window filtering + reason-free closure overlay (Finding #5 / D7).
export function applyLiveBranchOverlay(
  dto: PublicSiteDto,
  liveBranchSlugs: ReadonlySet<string>,
  liveClosures: readonly LiveBranchClosure[],
): PublicSiteDto | null {
  const branches = dto.branches
    .filter((b) => liveBranchSlugs.has(b.slug))
    .map((b) =>
      Object.freeze({
        ...b,
        closures: liveClosures
          .filter((c) => c.branchSlug === b.slug)
          .map((c) => ({ date: c.date, opens: c.opens, closes: c.closes })),
      }),
    );
  if (branches.length === 0) return null;
  const kept = new Set(branches.map((b) => b.slug));
  const treatments = dto.treatments
    .map((t) => {
      const bs = t.branchSlugs.filter((s) => kept.has(s));
      if (bs.length === 0) return null;
      return Object.freeze({
        ...t,
        branchSlugs: bs,
        branchTariffs: t.branchTariffs.filter((bt) => kept.has(bt.branchSlug)),
      });
    })
    .filter((t): t is PublicTreatmentDto => t !== null);
  return Object.freeze({ ...dto, branches, treatments });
}
