// Public clinic home page (/{slug}; PR-64, UX-51; T-123).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { toTreatmentCard } from "../../../modules/public-site";
import { loadPublicSite, NEUTRAL_NOT_FOUND_META, PublicShell, safeJsonLd } from "./_shared";
import { PublicPixelGate } from "./_pixel-gate";
import { bookingHref, whatsappLink } from "./booking/model";

// Blocking dynamic route so unknown/unpublished/revoked tenants return a real HTTP 404 (not streamed 200).
export const instant = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  await connection();
  const { slug } = await params;
  const resolved = await loadPublicSite(slug);
  if (resolved.state !== "published") return NEUTRAL_NOT_FOUND_META;
  const { dto } = resolved;
  return {
    title: dto.brand,
    description: dto.oneLine ?? `Informasi layanan dan cabang resmi ${dto.brand}.`,
    referrer: "no-referrer",
  };
}

export default async function ClinicHomePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await connection();
  const { slug } = await params;
  const resolved = await loadPublicSite(slug);
  if (resolved.state !== "published") notFound();

  const { dto } = resolved;
  const base = `/${dto.slug}`;
  const cards = dto.treatments.map(toTreatmentCard);
  const primaryWa = whatsappLink(dto.branches.find((b) => b.whatsapp)?.whatsapp ?? null, {
    brand: dto.brand,
    page: "beranda",
  });
  const ld = {
    "@context": "https://schema.org",
    "@type": "MedicalClinic",
    name: dto.brand,
    description: dto.oneLine ?? undefined,
  };

  return (
    <PublicShell site={dto} active="home">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(ld) }}
      />

      <section className="grid min-w-0 gap-6 pb-10">
        <div className="grid min-w-0 max-w-[680px] gap-3">
          <h1 className="m-0 text-[2.25rem] font-bold leading-[1.12] tracking-tight [overflow-wrap:anywhere] min-[700px]:text-[2.75rem]">
            {dto.brand}
          </h1>
          {dto.oneLine && (
            <p className="m-0 text-[1.125rem] leading-relaxed text-[var(--label-2)] [overflow-wrap:anywhere]">
              {dto.oneLine}
            </p>
          )}
          <div className="flex flex-wrap gap-3 pt-2">
            <a
              href={bookingHref(dto.slug, { page: "beranda" })}
              className="inline-flex min-h-[var(--target)] items-center rounded-full bg-[var(--tint)] px-5 text-[0.9375rem] font-semibold text-white no-underline"
            >
              Buat Janji
            </a>
            {dto.sections.treatments && (
              <a
                href={`${base}/perawatan`}
                className="inline-flex min-h-[var(--target)] items-center rounded-full bg-[var(--surface-2)] px-5 text-[0.9375rem] font-semibold text-[var(--label)] no-underline"
              >
                Lihat Perawatan
              </a>
            )}
            {dto.sections.branches && (
              <a
                href={`${base}/cabang`}
                className="inline-flex min-h-[var(--target)] items-center rounded-full bg-[var(--surface-2)] px-5 text-[0.9375rem] font-semibold text-[var(--label)] no-underline"
              >
                Lihat Cabang
              </a>
            )}
            {primaryWa && (
              <a
                href={primaryWa.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[var(--target)] items-center rounded-full border border-[var(--separator)] bg-[var(--surface)] px-5 text-[0.9375rem] font-semibold text-[var(--label)] no-underline"
              >
                {primaryWa.label}
              </a>
            )}
          </div>
        </div>

        {dto.heroPhoto && (
          <div className="overflow-hidden rounded-[var(--radius-group)] bg-[var(--surface-2)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={dto.heroPhoto}
              alt={dto.brand}
              className="aspect-[16/9] w-full object-cover"
            />
          </div>
        )}
      </section>

      {dto.sections.treatments && (
        <section aria-labelledby="sec-perawatan" className="grid min-w-0 gap-4 border-t border-[var(--separator)] py-10">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="sec-perawatan" className="m-0 text-[1.5rem] font-bold tracking-tight [overflow-wrap:anywhere]">
              Perawatan
            </h2>
            <a href={`${base}/perawatan`} className="text-[0.9375rem] font-medium text-[var(--tint)] no-underline">
              Semua perawatan
            </a>
          </div>
          {cards.length === 0 ? (
            <p className="m-0 rounded-[var(--radius-group)] bg-[var(--bg-grouped)] p-5 text-[0.9375rem] text-[var(--label-2)]">
              Daftar perawatan belum dipublikasikan.
            </p>
          ) : (
            <div className="grid gap-4 min-[700px]:grid-cols-2 min-[1024px]:grid-cols-3">
              {cards.map((t) => (
                <a
                  key={t.slug}
                  href={`${base}/perawatan/${t.slug}`}
                  className="grid content-between gap-3 rounded-[var(--radius-group)] border border-[var(--separator)] bg-[var(--surface)] p-5 text-[var(--label)] no-underline transition hover:border-[var(--tint)]"
                >
                  <div className="grid gap-1.5">
                    <h3 className="m-0 text-[1.0625rem] font-semibold leading-snug">{t.name}</h3>
                    <p className="m-0 text-[0.9375rem] leading-relaxed text-[var(--label-2)]">{t.purpose}</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--separator)] pt-3 text-[0.875rem]">
                    <span className="font-medium text-[var(--label)]">{t.tariffText}</span>
                    {t.duration && <span className="text-[var(--label-2)]">{t.duration}</span>}
                  </div>
                </a>
              ))}
            </div>
          )}
        </section>
      )}

      {dto.sections.branches && (
        <section aria-labelledby="sec-cabang" className="grid min-w-0 gap-4 border-t border-[var(--separator)] py-10">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="sec-cabang" className="m-0 text-[1.5rem] font-bold tracking-tight [overflow-wrap:anywhere]">
              Cabang
            </h2>
            <a href={`${base}/cabang`} className="text-[0.9375rem] font-medium text-[var(--tint)] no-underline">
              Semua cabang
            </a>
          </div>
          <div className="grid gap-4 min-[700px]:grid-cols-2">
            {dto.branches.map((b) => (
              <a
                key={b.slug}
                href={`${base}/cabang/${b.slug}`}
                className="grid gap-2 rounded-[var(--radius-group)] border border-[var(--separator)] bg-[var(--surface)] p-5 text-[var(--label)] no-underline transition hover:border-[var(--tint)]"
              >
                <h3 className="m-0 text-[1.0625rem] font-semibold">{b.name}</h3>
                {b.address && <p className="m-0 text-[0.9375rem] text-[var(--label-2)]">{b.address}</p>}
                {b.closures.length > 0 && (
                  <p className="m-0 text-[0.8125rem] font-medium text-[var(--warning)]">
                    Ada penyesuaian jadwal operasional mendatang
                  </p>
                )}
              </a>
            ))}
          </div>
        </section>
      )}

      <PublicPixelGate
        slug={dto.slug}
        pathname={base}
        clinicName={dto.brand}
        metaPixelId={resolved.metaPixelId}
        gaMeasurementId={resolved.gaMeasurementId}
        pixelConfigRevision={resolved.pixelConfigRevision}
      />
    </PublicShell>
  );
}
