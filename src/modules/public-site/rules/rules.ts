// Public treatment page rules (PR-65, PRIV-17, JUR-ID-7: Permenkes 1787/2010 Pasal 4, 5, 8; T-124).
// Pure canonical chokepoint consumed by T-123 public site generator.
// Closes all 3 High findings of t124/WAVE2-PLAN-T124-T126-T127-REVISED-20261124.md:
// 1. Hidden tariffs NEVER leak via priceNote or secondary outputs: consultation fallback is strictly
//    { kind: "consultation", text: CONSULTATION_PRICE } (no amount, no note). Single-DTO serializers
//    derive HTML card, <meta>, and JSON-LD strictly from PublicTreatment.
// 2. Approval binds the exact final projected public artifact (name, purpose, contraindications,
//    specs, heroPhoto, heroAlt, caption) via computeArtifactDigest(); any material edit invalidates approval.
// 3. No promo, discount, normalPrice, or rating fields exist on PublicTreatment or its serializers.
import { createHash } from "node:crypto";

export const CONSULTATION_PRICE = "Harga dijelaskan saat konsultasi" as const;

export type RuleId =
  | "superlatif"
  | "perbandingan"
  | "janji_hasil"
  | "promo_diskon"
  | "testimoni"
  | "sebelum_sesudah"
  | "harga_di_teks"
  | "belum_direview"
  | "artefak_berubah";

export const RULE_LABEL: Record<RuleId, string> = {
  superlatif: 'Kata superlatif atau "satu-satunya"',
  perbandingan: "Perbandingan dengan klinik lain",
  janji_hasil: "Janji atau jaminan hasil",
  promo_diskon: "Diskon atau promosi penjualan",
  testimoni: "Testimoni atau rating",
  sebelum_sesudah: "Klaim foto sebelum-sesudah",
  harga_di_teks: "Harga ditulis di teks (harga hanya dari tarif terbit)",
  belum_direview: "Teks klinis belum direview Penanggung Jawab Klinik",
  artefak_berubah: "Konten atau media publik berubah setelah review terakhir",
};

export type Violation = { field: string; rule: RuleId; match: string; message: string };

const RULES: { rule: RuleId; patterns: string[] }[] = [
  {
    rule: "superlatif",
    patterns: [
      "satu[- ]?satunya", "terbaik", "terbagus", "termurah", "tercanggih", "terampuh", "terhebat", "termutakhir", "terlengkap", "terpercaya", "terdepan",
      "paling (?:ampuh|bagus|baik|murah|efektif|aman|canggih|hebat|top|manjur|populer|laris)", "nomor (?:satu|1)", "no\\.? ?1", "#1",
      "the only", "best", "cheapest", "number one", "most (?:effective|advanced|trusted)", "world[- ]class", "leading",
    ],
  },
  {
    rule: "perbandingan",
    patterns: [
      "(?:lebih|jauh lebih) (?:baik|bagus|murah|ampuh|efektif|aman|canggih|cepat) (?:dari|daripada) (?:klinik|tempat|dokter) (?:lain|sebelah)",
      "dibanding(?:kan)? (?:dengan )?(?:klinik|tempat) (?:lain|sebelah)", "(?:tidak|tak) ada di (?:klinik|tempat) lain", "klinik (?:lain|sebelah) (?:tidak|tak|kalah)",
      "better than (?:other|any)", "compared (?:to|with) (?:other|competitors?)", "unlike other clinics",
    ],
  },
  {
    rule: "janji_hasil",
    patterns: [
      "dijamin", "garansi", "jaminan hasil", "pasti (?:berhasil|hilang|sembuh|putih|mulus)", "100 ?%", "seratus persen", "tanpa efek samping",
      "tanpa risiko", "bebas risiko", "hasil (?:instan|permanen|seketika)", "langsung (?:hilang|sembuh|putih)", "sekali (?:sesi|perawatan|tindakan) langsung",
      "guaranteed?", "permanent results?", "risk[- ]free", "no side effects?", "instant results?",
    ],
  },
  {
    rule: "promo_diskon",
    patterns: [
      "diskon", "potongan harga", "promo", "kode promo", "voucher", "cashback", "gratis", "harga (?:spesial|khusus|coret|promo|hemat)",
      "paket hemat", "bundling", "cicilan 0 ?%", "hemat (?:rp|\\d)", "beli \\d+ gratis \\d+", "\\d+ ?% ?(?:off|diskon)",
      "flash sale", "sale", "discount", "free (?:consult(?:ation)?|session|treatment)",
      "buy \\d+ get \\d+", "special price", "limited offer",
    ],
  },
  {
    rule: "testimoni",
    patterns: [
      "testimoni(?:al)?s?", "ulasan", "review pasien", "kata (?:pasien|mereka)", "pasien (?:kami )?puas", "rating", "bintang ?\\d", "\\d(?:[.,]\\d)? ?/ ?5",
      "(?:patient|customer|google) reviews?", "reviews? (?:from|by) (?:our )?(?:patients|customers)", "\\d ?stars?", "five[- ]star",
    ],
  },
  {
    rule: "sebelum_sesudah",
    patterns: ["(?:foto|hasil|gambar) sebelum ?(?:dan|&|-|/) ?sesudah", "before ?(?:and|&|-|/)? ?after"],
  },
  {
    rule: "harga_di_teks",
    patterns: [
      "rp ?\\.? ?\\d[\\d.,]*",
      "idr ?\\d[\\d.,]*",
      "\\d[\\d.,]* ?(?:rb|ribu|jt|juta|k\\b)",
      "(?:mulai|harga|tarif|biaya) ?[:\\-]? ?(?:dari )?(?:rp ?\\.? ?)?\\d[\\d.,]{3,}",
    ],
  },
];

export function normalise(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const bounded = (p: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${p})(?![\\p{L}\\p{N}])`, "u");
const COMPILED = RULES.flatMap((r) => r.patterns.map((p) => ({ rule: r.rule, re: bounded(p) })));
const SYMBOLS: { rule: RuleId; re: RegExp }[] = [
  { rule: "testimoni", re: /[\u2605\u2606\u2B50]/u },
  { rule: "promo_diskon", re: /~~|<\s*(?:s|del|strike)\b|\u0336/iu },
];
// Bare numeric tariff patterns disallowed inside priceNote (closes T-124 Finding #1 numeric smuggling).
const PRICE_NOTE_NUMERIC: RegExp[] = [
  /(?<![\p{L}\p{N}])\d{1,3}(?:[.,]\d{3})+(?![\p{L}\p{N}])/u,
  /(?<![\p{L}\p{N}])\d{5,}(?![\p{L}\p{N}])/u,
  /(?<![\p{L}\p{N}])(?:mulai|dari|hanya|cuma)\s+\d+(?![\p{L}\p{N}])/iu,
];

export function checkText(field: string, text: string | null | undefined): Violation[] {
  if (!text) return [];
  const t = normalise(text);
  const raw = text.normalize("NFKC");
  const checks = [
    ...COMPILED.map((c) => ({ rule: c.rule, re: c.re, on: t })),
    ...SYMBOLS.map((x) => ({ rule: x.rule, re: x.re, on: raw })),
    ...(field === "priceNote" ? PRICE_NOTE_NUMERIC.map((re) => ({ rule: "harga_di_teks" as RuleId, re, on: t })) : []),
  ];
  const out: Violation[] = [];
  for (const { rule, re, on } of checks) {
    if (out.some((v) => v.rule === rule)) continue;
    const m = re.exec(on);
    if (m) out.push({ field, rule, match: m[0], message: `${RULE_LABEL[rule]}: "${m[0]}"` });
  }
  return out;
}

export type ClinicalReview = {
  state: "approved" | "pending" | "none";
  reviewedVersion: number | null;
  currentVersion: number;
  // Finding #2: optional exact artifact digest approved by clinical reviewer; when provided, MUST equal computeArtifactDigest(source).
  reviewedArtifactHash?: string | null;
};

export type TreatmentSource = {
  slug: string;
  name: string;
  purpose: string;
  performedBy: string;
  durationMin: number | null;
  downtime: string | null;
  sessions: number | null;
  intervalDays: number | null;
  contraindications: string | null;
  priceNote: string | null;
  heroPhoto?: string | null;
  heroAlt?: string | null;
  caption?: string | null;
  clinicalReview: ClinicalReview;
  publishPrice: boolean;
  tariffListAllowed: boolean;
  branchPrice: number | null;
  // Present on source but NEVER projected (PR-65):
  promo?: { code: string; discountRupiah?: number; discountPct?: number; promoPrice?: number } | null;
  normalPrice?: number | null;
  rating?: number | null;
};

// Finding #1: strict discriminated tariff union — consultation mode carries NO amount and NO note!
export type Tariff =
  | { kind: "amount"; amount: number; text: string; note: string | null }
  | { kind: "consultation"; text: typeof CONSULTATION_PRICE };

export type PublicTreatment = Readonly<{
  slug: string;
  name: string;
  purpose: string;
  performedBy: string;
  duration: string | null;
  downtime: string | null;
  sessions: string | null;
  contraindications: string | null;
  heroPhoto: string | null;
  heroAlt: string | null;
  caption: string | null;
  tariff: Tariff;
}>;

export type Projection = { ok: true; page: PublicTreatment; artifactDigest: string } | { ok: false; violations: Violation[] };

const TEXT_FIELDS = ["name", "purpose", "performedBy", "downtime", "contraindications", "heroAlt", "caption"] as const;

const optTrim = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

// Canonical review artifact identity (shared 1:1 with SQL public._site_web_review_artifact_sha).
export function computeArtifactDigest(
  s: Pick<
    TreatmentSource,
    "slug" | "name" | "purpose" | "performedBy" | "durationMin" | "downtime" | "sessions" | "intervalDays" | "contraindications" | "heroPhoto" | "heroAlt" | "caption"
  >,
): string {
  const canonical = [
    "review-artifact-v1",
    `slug=${JSON.stringify(s.slug.trim().toLowerCase())}`,
    `name=${JSON.stringify(s.name.trim())}`,
    `purpose=${JSON.stringify(s.purpose.trim())}`,
    `performedBy=${JSON.stringify(s.performedBy.trim())}`,
    `durationMin=${JSON.stringify(s.durationMin ?? null)}`,
    `downtime=${JSON.stringify(optTrim(s.downtime))}`,
    `sessions=${JSON.stringify(s.sessions ?? null)}`,
    `intervalDays=${JSON.stringify(s.intervalDays ?? null)}`,
    `contraindications=${JSON.stringify(optTrim(s.contraindications))}`,
    `heroPhoto=${JSON.stringify(optTrim(s.heroPhoto))}`,
    `heroAlt=${JSON.stringify(optTrim(s.heroAlt))}`,
    `caption=${JSON.stringify(optTrim(s.caption))}`,
  ].join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export const reviewed = (r: ClinicalReview): boolean => r.state === "approved" && r.reviewedVersion === r.currentVersion;

export const showsAmount = (s: Pick<TreatmentSource, "publishPrice" | "tariffListAllowed" | "branchPrice">): boolean =>
  s.publishPrice === true && s.tariffListAllowed === true && Number.isSafeInteger(s.branchPrice) && (s.branchPrice as number) > 0;

export function checkTreatment(s: TreatmentSource): Violation[] {
  const out = TEXT_FIELDS.flatMap((f) => checkText(f, s[f]));
  // Lint priceNote strictly when it will actually be emitted (including bare numeric price smuggling).
  if (showsAmount(s)) {
    out.push(...checkText("priceNote", s.priceNote));
  }
  if (!reviewed(s.clinicalReview)) {
    out.push({ field: "purpose", rule: "belum_direview", match: "", message: RULE_LABEL.belum_direview });
  } else {
    // Fail-closed Finding #2: clinical approval MUST bind the exact canonical artifact digest (never silently optional).
    const current = computeArtifactDigest(s);
    if (!s.clinicalReview.reviewedArtifactHash || s.clinicalReview.reviewedArtifactHash !== current) {
      out.push({ field: "artifact", rule: "artefak_berubah", match: "", message: RULE_LABEL.artefak_berubah });
    }
  }
  return out;
}

const idr = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

export function tariff(s: Pick<TreatmentSource, "publishPrice" | "tariffListAllowed" | "branchPrice" | "priceNote">): Tariff {
  if (!showsAmount(s)) {
    return { kind: "consultation", text: CONSULTATION_PRICE };
  }
  const amount = s.branchPrice as number;
  const note = s.priceNote?.trim() || null;
  return { kind: "amount", amount, text: idr.format(amount).replace(/\s/g, ""), note };
}

const nf = new Intl.NumberFormat("id-ID");

export function projectTreatment(s: TreatmentSource): Projection {
  const violations = checkTreatment(s);
  if (violations.length > 0) return { ok: false, violations };
  const sessions = s.sessions ? `${nf.format(s.sessions)} sesi${s.intervalDays ? `, jarak ${nf.format(s.intervalDays)} hari` : ""}` : null;
  const artifactDigest = computeArtifactDigest(s);
  return {
    ok: true,
    artifactDigest,
    page: Object.freeze({
      slug: s.slug,
      name: s.name.trim(),
      purpose: s.purpose.trim(),
      performedBy: s.performedBy.trim(),
      duration: s.durationMin ? `${nf.format(s.durationMin)} menit` : null,
      downtime: s.downtime?.trim() || null,
      sessions,
      contraindications: s.contraindications?.trim() || null,
      heroPhoto: s.heroPhoto ?? null,
      heroAlt: s.heroAlt?.trim() || null,
      caption: s.caption?.trim() || null,
      tariff: tariff(s),
    }),
  };
}

// Single-DTO secondary serializers (Finding #1): HTML cards, <meta>, and JSON-LD NEVER read raw catalog/promo fields.
export function toTreatmentCard(dto: PublicTreatment) {
  return {
    slug: dto.slug,
    name: dto.name,
    purpose: dto.purpose,
    duration: dto.duration,
    tariffText: dto.tariff.text,
    heroPhoto: dto.heroPhoto,
    heroAlt: dto.heroAlt,
  };
}

export function toTreatmentMeta(dto: PublicTreatment, brand: string) {
  const desc = `${dto.name} di ${brand}. ${dto.purpose}`.slice(0, 155);
  return {
    title: `${dto.name} — ${brand}`,
    description: desc,
  };
}

export function toTreatmentJsonLd(dto: PublicTreatment, brand: string, pageUrl: string): Record<string, unknown> {
  const base: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "MedicalProcedure",
    name: dto.name,
    description: dto.purpose,
    url: pageUrl,
    provider: { "@type": "MedicalClinic", name: brand },
  };
  if (dto.tariff.kind === "amount") {
    base.offers = {
      "@type": "Offer",
      priceCurrency: "IDR",
      price: dto.tariff.amount,
    };
  }
  return base;
}

export const CHECKLIST = [
  { id: "testimoni", label: "Tanpa testimoni", rules: ["testimoni", "sebelum_sesudah"] },
  { id: "diskon", label: "Tanpa diskon atau promosi", rules: ["promo_diskon", "harga_di_teks"] },
  { id: "superlatif", label: "Tanpa superlatif, perbandingan, atau janji hasil", rules: ["superlatif", "perbandingan", "janji_hasil"] },
  { id: "review", label: "Teks klinis sudah direview", rules: ["belum_direview", "artefak_berubah"] },
] as const satisfies readonly { id: string; label: string; rules: readonly RuleId[] }[];

export function checklist(pages: { name: string; violations: Violation[] }[]) {
  return CHECKLIST.map((c) => {
    const failing = pages.flatMap((p) =>
      p.violations.filter((v) => (c.rules as readonly RuleId[]).includes(v.rule)).map((v) => `${p.name} · ${v.message}`),
    );
    return { id: c.id, label: c.label, pass: failing.length === 0, failing };
  });
}
