// Booking publik (UX-24, PR-67, PR-6; T-126) — pure model, zero internal UUIDs.
// Closes Findings #1, #3, #4 of t124/WAVE2-PLAN-T124-T126-T127-REVISED-20261124.md §2:
// 1. Opaque public slugs ONLY (treatmentSlug, branchSlug, doctorSlug — never raw staff/branch/item UUIDs).
// 2. prefill() drops unknown/unpublished/other-tenant/mismatched parameters silently (cannot probe existence).
// 3. sourceTag() emits canonical `situs-<page>` or `situs` matching appointments_source_check (`^[a-z0-9][a-z0-9_-]{0,39}$`).
// 4. whatsappLink() emits neutral wording + coarse ref ONLY (omits treatment/medical specifics & PII).
// 5. publicState() returns one frozen NEUTRAL object for every closed/unpublished/unknown tenant.

export type PublishedBookingCatalog = {
  treatments: { slug: string; name: string; durationMin: number | null; dpRequired: boolean; dpAmount: number | null; branchSlugs: string[] }[];
  branches: { slug: string; name: string; timezone: string; whatsapp: string | null }[];
  doctors: { slug: string; name: string; branchSlugs: string[] }[];
};

export type Query = Record<string, string | string[] | undefined>;
export const PAGES = ["beranda", "perawatan", "cabang", "dokter"] as const;
export type Page = (typeof PAGES)[number];
export type Prefill = {
  treatmentSlug: string | null;
  branchSlug: string | null;
  doctorSlug: string | null;
  source: string;
};

const one = (v: string | string[] | undefined) =>
  typeof v === "string" ? v.trim() : Array.isArray(v) ? (v[0] ?? "").trim() : "";

const SLUG_TOKEN = /^[a-z0-9][a-z0-9-]{0,79}$/;
const findBySlug = <T extends { slug: string }>(list: T[], raw: string): T | undefined => {
  const s = raw.toLowerCase();
  return SLUG_TOKEN.test(s) ? list.find((x) => x.slug === s) : undefined;
};

export function normalizeSourceHint(page: string | null | undefined): string {
  const p = (page ?? "").trim().toLowerCase();
  const stripped = p.startsWith("situs-") ? p.slice("situs-".length) : p;
  return (PAGES as readonly string[]).includes(stripped) ? `situs-${stripped}` : "situs";
}
export const sourceTag = normalizeSourceHint;
export const SOURCE_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export function prefill(q: Query, pub: PublishedBookingCatalog): Prefill {
  const t = findBySlug(pub.treatments, one(q.layanan) || one(q.perawatan));
  let b = findBySlug(pub.branches, one(q.cabang));
  const d = findBySlug(pub.doctors, one(q.dokter));
  if (t && b && !t.branchSlugs.includes(b.slug)) b = undefined;
  const doctor = d && (!b || d.branchSlugs.includes(b.slug)) ? d : undefined;
  return {
    treatmentSlug: t?.slug ?? null,
    branchSlug: b?.slug ?? null,
    doctorSlug: doctor?.slug ?? null,
    source: normalizeSourceHint(one(q.sumber)),
  };
}

export function bookingHref(
  slug: string,
  ctx: { page: Page; treatment?: string | null; branch?: string | null; doctor?: string | null },
): string {
  const p = new URLSearchParams();
  if (ctx.treatment) p.set("layanan", ctx.treatment);
  if (ctx.branch) p.set("cabang", ctx.branch);
  if (ctx.doctor) p.set("dokter", ctx.doctor);
  p.set("sumber", ctx.page);
  return `/${encodeURIComponent(slug)}/booking?${p}`;
}

export function waNumber(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/[\s().-]/g, "");
  const m = /^(?:\+?62|0)(8\d{7,12})$/.exec(d);
  return m ? `62${m[1]}` : null;
}

export type WaLink = { href: string; label: string } | null;

// Finding #3: neutral wording + coarse page ref ONLY (never leaks treatment/medical specifics or PII).
export function whatsappLink(
  raw: string | null | undefined,
  ctx: { brand: string; page: Page },
): WaLink {
  const n = waNumber(raw);
  if (!n) return null;
  const cleanBrand = ctx.brand.trim() || "Klinik";
  const text = `Halo ${cleanBrand}, saya ingin menanyakan jadwal kunjungan (ref: ${normalizeSourceHint(ctx.page)})`;
  return { href: `https://wa.me/${n}?text=${encodeURIComponent(text)}`, label: "Tanya lewat WhatsApp" };
}

export type TenantState = "provisioning" | "onboarding" | "live" | "suspended" | "exit" | "closed";
export type TenantPublic = { state: TenantState; sitePublished: boolean; brand: string; whatsapp: string | null } | null;

export const NEUTRAL = Object.freeze({
  kind: "unavailable" as const,
  title: "Halaman tidak ditemukan",
  body: "Halaman yang Anda cari tidak tersedia.",
});

export type PublicState = { kind: "open"; brand: string; whatsapp: string | null } | typeof NEUTRAL;
export function publicState(t: TenantPublic): PublicState {
  return t && t.state === "live" && t.sitePublished ? { kind: "open", brand: t.brand, whatsapp: t.whatsapp } : NEUTRAL;
}

export const STEPS = ["Layanan", "Cabang & Waktu", "Data Diri", "Kode OTP"] as const;
export type Step = 1 | 2 | 3 | 4;
export const firstStep = (p: Prefill): Step => (p.treatmentSlug ? 2 : 1);

export function otpSender(brand: string, tenantWhatsapp: string | null): string {
  return waNumber(tenantWhatsapp) ? `Kode dikirim lewat WhatsApp ${brand}.` : `Kode dikirim dari nomor layanan ${brand}`;
}

const idr = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
export function dpNote(dp: number | null | undefined): string | null {
  if (!dp || !Number.isSafeInteger(dp) || dp <= 0) return null;
  return `DP booking ${idr.format(dp).replace(/\s/g, "")}. Dipakai saat Anda datang; berpindah ke saldo bila jadwal diubah paling lambat 24 jam sebelumnya.`;
}
