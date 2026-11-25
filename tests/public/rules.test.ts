// Public treatment rules unit tests (PR-65, T-124) + canonical DTO/legal-template checks.
// Proves all 3/3 High findings of t124/WAVE2-PLAN-T124-T126-T127-REVISED-20261124.md:
// 1. Unpublished tariff emits strictly { kind: "consultation", text: CONSULTATION_PRICE } — no amount,
//    no priceNote, and secondary serializers (card, meta, JSON-LD) never leak raw price or promo;
//    published priceNote rejects bare numeric tariff smuggling.
// 2. Clinical review fail-closed binds the exact canonical artifact digest (computeArtifactDigest);
//    missing/null reviewedArtifactHash or editing ANY of the 12 canonical fields invalidates approval.
// 3. Permenkes 1787/2010 patterns block superlatives, comparisons, outcome guarantees, discounts/promos,
//    testimonials/stars, before-after claims, strikethrough pricing, zero-width evasion, and prose prices.
import { describe, expect, it } from "vitest";
import {
  CHECKLIST,
  CONSULTATION_PRICE,
  checkText,
  checklist,
  computeArtifactDigest,
  projectTreatment,
  toTreatmentCard,
  toTreatmentJsonLd,
  toTreatmentMeta,
  type TreatmentSource,
} from "../../src/modules/public-site/rules/rules";
import {
  DEFAULT_LEGAL_TEMPLATES,
  renderLegalTemplate,
  validateLegalTemplate,
} from "../../src/modules/public-site/legal-templates";
import {
  applyLiveBranchOverlay,
  buildPublicSiteDto,
  deriveSlug,
  slugEditable,
  validSlug,
} from "../../src/modules/public-site/snapshot";

function baseTreatment(over: Partial<TreatmentSource> = {}): TreatmentSource {
  const draft: TreatmentSource = {
    slug: "facial-oksigen",
    name: "Facial Oksigen",
    purpose: "Membersihkan pori dan menjaga kelembapan permukaan kulit wajah.",
    performedBy: "Terapis terlatih di bawah supervisi dokter",
    durationMin: 45,
    downtime: "Tidak ada masa pemulihan khusus",
    sessions: 3,
    intervalDays: 14,
    contraindications: "Tidak dianjurkan saat infeksi kulit aktif atau luka terbuka.",
    priceNote: "Termasuk pembersihan awal",
    heroPhoto: "/media/public/klinik-contoh/" + "a".repeat(64) + ".webp",
    heroAlt: "Ruang tindakan facial bersih dengan pencahayaan lembut",
    caption: "Tindakan dilakukan di ruang perawatan standar klinik.",
    clinicalReview: { state: "approved", reviewedVersion: 2, currentVersion: 2 },
    publishPrice: true,
    tariffListAllowed: true,
    branchPrice: 450_000,
    promo: { code: "HEMAT50", discountPct: 50, promoPrice: 225_000 },
    normalPrice: 500_000,
    rating: 4.9,
    ...over,
  };
  if (over.clinicalReview === undefined) {
    draft.clinicalReview = {
      state: "approved",
      reviewedVersion: 2,
      currentVersion: 2,
      reviewedArtifactHash: computeArtifactDigest(draft),
    };
  }
  return draft;
}

describe("T-124 public treatment rules (PR-65, Permenkes 1787/2010)", () => {
  it("Scenario: PR-65 no advertised discount — active promo, normalPrice, and rating never leak across page, card, meta, or JSON-LD", () => {
    const src = baseTreatment();
    const digest = computeArtifactDigest(src);

    const res = projectTreatment(src);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.artifactDigest).toBe(digest);
    expect(res.page.tariff).toEqual({
      kind: "amount",
      amount: 450_000,
      text: "Rp450.000",
      note: "Termasuk pembersihan awal",
    });

    const json = JSON.stringify({
      page: res.page,
      card: toTreatmentCard(res.page),
      meta: toTreatmentMeta(res.page, "Klinik Contoh"),
      ld: toTreatmentJsonLd(res.page, "Klinik Contoh", "https://booking.example/klinik-contoh/perawatan/facial-oksigen"),
    });
    expect(json).not.toContain("HEMAT50");
    expect(json).not.toContain("225000");
    expect(json).not.toContain("225.000");
    expect(json).not.toContain("500000");
    expect(json).not.toContain("4.9");
  });

  it("Scenario: PR-65 unpublished price — unpublished, counsel-blocked, or invalid branchPrice emits consultation fallback and strips BOTH amount AND priceNote", () => {
    const cases: Partial<TreatmentSource>[] = [
      { publishPrice: false, tariffListAllowed: true, branchPrice: 777_000 },
      { publishPrice: true, tariffListAllowed: false, branchPrice: 777_000 },
      { publishPrice: false, tariffListAllowed: false, branchPrice: 777_000 },
      { publishPrice: true, tariffListAllowed: true, branchPrice: null },
      { publishPrice: true, tariffListAllowed: true, branchPrice: 0 },
      { publishPrice: true, tariffListAllowed: true, branchPrice: -50_000 },
      { publishPrice: true, tariffListAllowed: true, branchPrice: Number.NaN },
      { publishPrice: true, tariffListAllowed: true, branchPrice: 450_000.5 },
    ];

    for (const flags of cases) {
      const src = baseTreatment({
        ...flags,
        priceNote: "RAHASIA_TARIF_999000",
      });
      const res = projectTreatment(src);
      expect(res.ok).toBe(true);
      if (!res.ok) continue;

      expect(res.page.tariff).toEqual({ kind: "consultation", text: CONSULTATION_PRICE });
      expect("amount" in res.page.tariff).toBe(false);
      expect("note" in res.page.tariff).toBe(false);

      const card = toTreatmentCard(res.page);
      const meta = toTreatmentMeta(res.page, "Klinik Contoh");
      const ld = toTreatmentJsonLd(res.page, "Klinik Contoh", "https://booking.example/klinik-contoh/perawatan/facial-oksigen");
      const serialized = JSON.stringify({ page: res.page, card, meta, ld });

      expect(card.tariffText).toBe(CONSULTATION_PRICE);
      expect(ld).not.toHaveProperty("offers");
      expect(serialized).not.toContain("777");
      expect(serialized).not.toContain("RAHASIA_TARIF_999000");
    }
  });

  it("Finding #1: published priceNote rejects bare numeric tariff smuggling without currency prefix", () => {
    for (const smuggled of ["Termasuk 500.000 paket awal", "Biaya 450000 bersih", "Mulai 350 per kunjungan", "Hanya 250 untuk sesi lanjutan"]) {
      const res = projectTreatment(baseTreatment({ publishPrice: true, tariffListAllowed: true, branchPrice: 450_000, priceNote: smuggled }));
      expect(res.ok, `smuggled=${smuggled}`).toBe(false);
      if (!res.ok) expect(res.violations.map((v) => v.rule)).toContain("harga_di_teks");
    }
    const clean = projectTreatment(baseTreatment({ publishPrice: true, tariffListAllowed: true, branchPrice: 450_000, priceNote: "Termasuk evaluasi awal 15 menit" }));
    expect(clean.ok).toBe(true);
  });

  it("blocks every forbidden Permenkes 1787/2010 category (ID & EN, zero-width evasion, symbols, strikethrough, prose price)", () => {
    const cases: [string, string][] = [
      ["Klinik terbaik di Jakarta Selatan", "superlatif"],
      ["Klinik ter\u200Bbaik dengan alat modern", "superlatif"],
      ["Satu-satunya alat tercanggih di Indonesia", "superlatif"],
      ["Lebih efektif daripada klinik lain", "perbandingan"],
      ["Dijamin hasil permanen tanpa efek samping", "janji_hasil"],
      ["Diskon 30% spesial bulan ini dengan kode promo HEMAT", "promo_diskon"],
      ["Dis\u200Bkon khusus bundling dan cicilan 0%", "promo_diskon"],
      ["Harga ~~500.000~~ jadi lebih ringan", "promo_diskon"],
      ["Harga <s>500.000</s> khusus hari ini", "promo_diskon"],
      ["Testimoni pasien puas rating 4.9/5", "testimoni"],
      ["Layanan bintang ★5 di kota", "testimoni"],
      ["Lihat foto sebelum dan sesudah tindakan", "sebelum_sesudah"],
      ["Biaya mulai Rp 350.000 per kedatangan", "harga_di_teks"],
      ["Tersedia paket 450rb saja", "harga_di_teks"],
    ];
    for (const [text, expectedRule] of cases) {
      const vs = checkText("purpose", text);
      expect(vs.map((v) => v.rule), `text=${text}`).toContain(expectedRule);
    }
  });

  it("Finding #2 fail-closed: refuses unreviewed treatment (even with empty purpose), missing/null artifact digest, and post-review drift on ANY of the 12 canonical fields", () => {
    const unreviewed = baseTreatment({
      purpose: "",
      contraindications: null,
      clinicalReview: { state: "pending", reviewedVersion: 1, currentVersion: 2 },
    });
    const rUnrev = projectTreatment(unreviewed);
    expect(rUnrev.ok).toBe(false);
    if (!rUnrev.ok) expect(rUnrev.violations.map((v) => v.rule)).toContain("belum_direview");

    // Approved version WITHOUT reviewedArtifactHash MUST fail closed!
    const missingDigest = baseTreatment({
      clinicalReview: { state: "approved", reviewedVersion: 2, currentVersion: 2 },
    });
    const rMissing = projectTreatment(missingDigest);
    expect(rMissing.ok).toBe(false);
    if (!rMissing.ok) expect(rMissing.violations.map((v) => v.rule)).toContain("artefak_berubah");

    const nullDigest = baseTreatment({
      clinicalReview: { state: "approved", reviewedVersion: 2, currentVersion: 2, reviewedArtifactHash: null },
    });
    const rNull = projectTreatment(nullDigest);
    expect(rNull.ok).toBe(false);
    if (!rNull.ok) expect(rNull.violations.map((v) => v.rule)).toContain("artefak_berubah");

    // Mutating ANY of the 12 canonical fields after approval MUST invalidate the digest!
    const approved = baseTreatment();
    const digest = computeArtifactDigest(approved);
    const mutations: [string, Partial<TreatmentSource>][] = [
      ["slug", { slug: "facial-oksigen-baru" }],
      ["name", { name: "Facial Oksigen Lanjut" }],
      ["purpose", { purpose: "Membersihkan pori wajah secara bertahap." }],
      ["performedBy", { performedBy: "Dokter estetika berizin praktik" }],
      ["durationMin", { durationMin: 60 }],
      ["downtime", { downtime: "Kemerahan ringan selama beberapa jam" }],
      ["sessions", { sessions: 4 }],
      ["intervalDays", { intervalDays: 21 }],
      ["contraindications", { contraindications: "Hindari pada kulit meradang." }],
      ["heroPhoto", { heroPhoto: "/media/public/klinik-contoh/" + "b".repeat(64) + ".webp" }],
      ["heroAlt", { heroAlt: "Meja perawatan bersih dengan pencahayaan alami" }],
      ["caption", { caption: "Dilakukan setelah evaluasi awal dokter." }],
    ];
    for (const [field, patch] of mutations) {
      const drifted = baseTreatment({
        ...patch,
        clinicalReview: { state: "approved", reviewedVersion: 2, currentVersion: 2, reviewedArtifactHash: digest },
      });
      const r = projectTreatment(drifted);
      expect(r.ok, `expected drift on ${field} to fail closed`).toBe(false);
      if (!r.ok) expect(r.violations.map((v) => v.rule), `field=${field}`).toContain("artefak_berubah");
    }
  });

  it("summarizes compliance checklist cleanly", () => {
    const bad = projectTreatment(baseTreatment({ name: "Facial Terbaik #1" }));
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    const summary = checklist([{ name: "Facial", violations: bad.violations }]);
    expect(summary).toHaveLength(CHECKLIST.length);
    expect(summary.find((c) => c.id === "superlatif")?.pass).toBe(false);
    expect(summary.find((c) => c.id === "diskon")?.pass).toBe(true);
  });
});

describe("T-123 legal templates & canonical PublicSiteDto guards", () => {
  it("validates plain-text legal templates and rejects HTML or unknown placeholders", () => {
    for (const kind of Object.keys(DEFAULT_LEGAL_TEMPLATES) as (keyof typeof DEFAULT_LEGAL_TEMPLATES)[]) {
      const check = validateLegalTemplate(DEFAULT_LEGAL_TEMPLATES[kind]);
      expect(check.ok).toBe(true);
    }
    expect(validateLegalTemplate("<script>alert(1)</script>").ok).toBe(false);
    expect(validateLegalTemplate("Halo {{unknown_var}} di klinik kami yang panjang teksnya mencukupi syarat.").ok).toBe(false);

    const rendered = renderLegalTemplate(DEFAULT_LEGAL_TEMPLATES["kebijakan-privasi"], {
      "klinik.nama": "Klinik Mawar",
      "klinik.alamat": "Jl. Senopati 10, Jakarta",
      "klinik.kontak": "+6281234567890",
      "klinik.email": "privasi@mawar.test",
      "vendor.nama": "PT Platform Klinik Nusantara",
    });
    expect(rendered).toContain("Klinik Mawar");
    expect(rendered).toContain("PT Platform Klinik Nusantara");
    expect(rendered).not.toContain("{{");
  });

  it("enforces slug immutability from firstPublishedAt and rejects reserved segments & third-party hero URLs", () => {
    expect(deriveSlug("PT Kasir Estetika")).toBe("kasir-estetika");
    expect(deriveSlug("PT Kasir")).toBe("kasir-klinik");
    expect(validSlug("kasir")).toBe(false);
    expect(validSlug("klinik-mawar")).toBe(true);
    expect(slugEditable({ firstPublishedAt: null })).toBe(true);
    expect(slugEditable({ firstPublishedAt: "2026-11-24T00:00:00Z" })).toBe(false);

    const badMedia = buildPublicSiteDto({
      brand: "Klinik Mawar",
      slug: "klinik-mawar",
      accent: "#0A84FF",
      heroPhoto: "https://evil.example/tracker.png",
      oneLine: "Perawatan kulit berbasis evaluasi dokter.",
      now: new Date("2026-11-24T05:00:00Z"),
      counselApproved: true,
      tariffListAllowed: false,
      sections: { treatments: true, branches: true, doctors: false },
      branches: [
        {
          slug: "senopati",
          name: "Cabang Senopati",
          city: "Jakarta Selatan",
          timezone: "Asia/Jakarta",
          address: "Jl. Senopati 10",
          mapUrl: "https://maps.google.com/?q=senopati",
          whatsapp: "+6281234567890",
          hours: [{ weekday: 1, opens: "09:00", closes: "18:00" }],
          publishFrom: "2026-01-01",
          publishUntil: null,
        },
      ],
      treatments: [],
      templateVars: {
        "klinik.nama": "Klinik Mawar",
        "klinik.alamat": "Jl. Senopati 10",
        "klinik.kontak": "+6281234567890",
        "klinik.email": "privasi@mawar.test",
        "vendor.nama": "PT Platform Klinik Nusantara",
      },
    });
    expect(badMedia.ok).toBe(false);
    if (!badMedia.ok) expect(badMedia.gateReason).toBe("invalid_media");
  });

  it("overlays live branch publish windows and reason-free closures, cascading removed branches from treatments", () => {
    const sampleTreatment = {
      slug: "facial-oksigen",
      name: "Facial Oksigen",
      category: "facial",
      purpose: "Membersihkan pori secara lembut.",
      performedBy: "Terapis terlatih",
      durationMin: 45,
      downtime: null,
      sessions: 1,
      intervalDays: null,
      contraindications: "Infeksi aktif",
      priceNote: null,
      heroPhoto: null,
      heroAlt: null,
      caption: null,
    };
    const built = buildPublicSiteDto({
      brand: "Klinik Mawar",
      slug: "klinik-mawar",
      accent: "#0A84FF",
      heroPhoto: null,
      oneLine: "Perawatan kulit terukur oleh tenaga medis.",
      now: new Date("2026-11-24T05:00:00Z"),
      counselApproved: true,
      tariffListAllowed: true,
      sections: { treatments: true, branches: true, doctors: false },
      branches: [
        {
          slug: "senopati",
          name: "Cabang Senopati",
          city: "Jakarta Selatan",
          timezone: "Asia/Jakarta",
          address: "Jl. Senopati 10",
          mapUrl: "https://maps.google.com/?q=senopati",
          whatsapp: "+6281234567890",
          hours: [{ weekday: 1, opens: "09:00", closes: "18:00" }],
          publishFrom: "2026-01-01",
          publishUntil: null,
        },
        {
          slug: "kemang",
          name: "Cabang Kemang",
          city: "Jakarta Selatan",
          timezone: "Asia/Jakarta",
          address: "Jl. Kemang 20",
          mapUrl: null,
          whatsapp: null,
          hours: [{ weekday: 1, opens: "09:00", closes: "18:00" }],
          publishFrom: "2026-01-01",
          publishUntil: "2026-11-25",
        },
      ],
      treatments: [
        {
          ...sampleTreatment,
          clinicalReview: {
            state: "approved",
            reviewedVersion: 1,
            currentVersion: 1,
            reviewedArtifactHash: computeArtifactDigest(sampleTreatment),
          },
          publishPrice: true,
          onlineBookable: true,
          published: true,
          branchPrices: { senopati: 400_000, kemang: 450_000 },
          branchSlugs: ["senopati", "kemang"],
        },
      ],
      templateVars: {
        "klinik.nama": "Klinik Mawar",
        "klinik.alamat": "Jl. Senopati 10",
        "klinik.kontak": "+6281234567890",
        "klinik.email": "privasi@mawar.test",
        "vendor.nama": "PT Platform Klinik Nusantara",
      },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.dto.doctors).toEqual([]);
    expect(built.dto.branches.map((b) => b.slug)).toEqual(["senopati", "kemang"]);

    // Next day: kemang expired, senopati has a closure
    const overlaid = applyLiveBranchOverlay(
      built.dto,
      new Set(["senopati"]),
      [{ branchSlug: "senopati", date: "2026-11-26", opens: null, closes: null }],
    );
    expect(overlaid).not.toBeNull();
    if (!overlaid) return;
    expect(overlaid.branches.map((b) => b.slug)).toEqual(["senopati"]);
    expect(overlaid.branches[0].closures).toEqual([{ date: "2026-11-26", opens: null, closes: null }]);
    expect(overlaid.treatments[0].branchSlugs).toEqual(["senopati"]);
    expect(overlaid.treatments[0].branchTariffs.map((x) => x.branchSlug)).toEqual(["senopati"]);
    expect(applyLiveBranchOverlay(built.dto, new Set(), [])).toBeNull();
  });
});
