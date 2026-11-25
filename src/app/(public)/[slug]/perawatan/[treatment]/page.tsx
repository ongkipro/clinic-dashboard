// Public treatment detail page (/{slug}/perawatan/{treatment}; PR-64, PR-65, UX-51; T-123).
// Finding #1 & #4: HTML, <meta>, and JSON-LD derive strictly from PublicTreatmentDto via single-DTO serializers.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { toTreatmentJsonLd, toTreatmentMeta } from "../../../../../modules/public-site";
import { loadPublicSite, NEUTRAL_NOT_FOUND_META, PublicShell, safeJsonLd } from "../../_shared";
import { bookingHref, whatsappLink } from "../../booking/model";

// Blocking dynamic route so unknown/unpublished/revoked tenants return a real HTTP 404 (not streamed 200).
export const instant = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; treatment: string }>;
}): Promise<Metadata> {
  await connection();
  const { slug, treatment } = await params;
  const resolved = await loadPublicSite(slug);
  if (resolved.state !== "published" || !resolved.dto.sections.treatments) return NEUTRAL_NOT_FOUND_META;
  const item = resolved.dto.treatments.find((t) => t.slug === treatment);
  if (!item) return NEUTRAL_NOT_FOUND_META;
  const meta = toTreatmentMeta(item, resolved.dto.brand);
  return {
    title: meta.title,
    description: meta.description,
    referrer: "no-referrer",
  };
}

export default async function TreatmentDetailPage({
  params,
}: {
  params: Promise<{ slug: string; treatment: string }>;
}) {
  await connection();
  const { slug, treatment } = await params;
  const resolved = await loadPublicSite(slug);
  if (resolved.state !== "published" || !resolved.dto.sections.treatments) notFound();

  const item = resolved.dto.treatments.find((t) => t.slug === treatment);
  if (!item) notFound();

  const { dto } = resolved;
  const base = `/${dto.slug}`;
  const branchNameBySlug = new Map(dto.branches.map((b) => [b.slug, b.name]));
  const defaultBranchSlug = item.branchSlugs.length === 1 ? item.branchSlugs[0] : null;
  const treatmentWa = whatsappLink(
    dto.branches.find((b) => item.branchSlugs.includes(b.slug) && b.whatsapp)?.whatsapp ??
      dto.branches.find((b) => b.whatsapp)?.whatsapp ??
      null,
    { brand: dto.brand, page: "perawatan" },
  );
  const ld = toTreatmentJsonLd(item, dto.brand, `${base}/perawatan/${item.slug}`);

  return (
    <PublicShell site={dto} active="perawatan">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(ld) }}
      />

      <article className="grid max-w-[760px] gap-6">
        <nav aria-label="Breadcrumb" className="text-[0.875rem] text-[var(--label-2)]">
          <Link href={`${base}/perawatan`} className="text-[var(--tint)] no-underline hover:underline">
            Perawatan
          </Link>
          <span aria-hidden="true"> / </span>
          <span>{item.name}</span>
        </nav>

        <header className="grid gap-3">
          <h1 className="m-0 text-[2rem] font-bold tracking-tight">{item.name}</h1>
          <p className="m-0 text-[1.0625rem] leading-relaxed text-[var(--label-2)]">{item.purpose}</p>
          <div className="flex flex-wrap gap-3 pt-1">
            {item.bookable && (
              <a
                href={bookingHref(dto.slug, {
                  page: "perawatan",
                  treatment: item.slug,
                  branch: defaultBranchSlug,
                })}
                className="inline-flex min-h-[var(--target)] items-center rounded-full bg-[var(--tint)] px-5 text-[0.9375rem] font-semibold text-white no-underline"
              >
                Buat Janji
              </a>
            )}
            {treatmentWa && (
              <a
                href={treatmentWa.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[var(--target)] items-center rounded-full border border-[var(--separator)] bg-[var(--surface)] px-5 text-[0.9375rem] font-semibold text-[var(--label)] no-underline"
              >
                {treatmentWa.label}
              </a>
            )}
          </div>
        </header>

        {item.heroPhoto && (
          <figure className="m-0 grid gap-2">
            <div className="overflow-hidden rounded-[var(--radius-group)] bg-[var(--surface-2)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.heroPhoto}
                alt={item.heroAlt ?? item.name}
                className="aspect-[16/10] w-full object-cover"
              />
            </div>
            {item.caption && (
              <figcaption className="text-[0.875rem] text-[var(--label-2)]">{item.caption}</figcaption>
            )}
          </figure>
        )}

        <section className="grid gap-3 rounded-[var(--radius-group)] bg-[var(--bg-grouped)] p-5">
          <h2 className="m-0 text-[1.125rem] font-semibold">Ringkasan Tindakan</h2>
          <dl className="m-0 grid gap-3 text-[0.9375rem] min-[700px]:grid-cols-2">
            <div>
              <dt className="text-[0.8125rem] text-[var(--label-2)]">Dilakukan oleh</dt>
              <dd className="m-0 font-medium">{item.performedBy}</dd>
            </div>
            <div>
              <dt className="text-[0.8125rem] text-[var(--label-2)]">Tarif</dt>
              <dd className="m-0 font-medium">
                {item.tariff.text}
                {item.tariff.kind === "amount" && item.tariff.note && (
                  <span className="block text-[0.8125rem] font-normal text-[var(--label-2)]">
                    {item.tariff.note}
                  </span>
                )}
              </dd>
            </div>
            {item.duration && (
              <div>
                <dt className="text-[0.8125rem] text-[var(--label-2)]">Estimasi durasi</dt>
                <dd className="m-0 font-medium">{item.duration}</dd>
              </div>
            )}
            {item.sessions && (
              <div>
                <dt className="text-[0.8125rem] text-[var(--label-2)]">Rangkaian sesi</dt>
                <dd className="m-0 font-medium">{item.sessions}</dd>
              </div>
            )}
            {item.downtime && (
              <div className="min-[700px]:col-span-2">
                <dt className="text-[0.8125rem] text-[var(--label-2)]">Masa pemulihan</dt>
                <dd className="m-0 font-medium">{item.downtime}</dd>
              </div>
            )}
          </dl>
        </section>

        {item.contraindications && (
          <section className="grid gap-2 rounded-[var(--radius-group)] border border-[var(--separator)] bg-[var(--surface)] p-5">
            <h2 className="m-0 text-[1.125rem] font-semibold">Perhatian &amp; Kontraindikasi</h2>
            <p className="m-0 text-[0.9375rem] leading-relaxed text-[var(--label-2)]">{item.contraindications}</p>
          </section>
        )}

        {item.branchTariffs.length > 0 && (
          <section className="grid gap-3">
            <h2 className="m-0 text-[1.125rem] font-semibold">Tersedia di Cabang</h2>
            <ul className="m-0 grid list-none gap-2.5 p-0">
              {item.branchTariffs.map((bt) => (
                <li
                  key={bt.branchSlug}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-group)] border border-[var(--separator)] bg-[var(--surface)] px-4 py-3 text-[0.9375rem]"
                >
                  <Link
                    href={`${base}/cabang/${bt.branchSlug}`}
                    className="font-semibold text-[var(--tint)] no-underline hover:underline"
                  >
                    {branchNameBySlug.get(bt.branchSlug) ?? bt.branchSlug}
                  </Link>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-[var(--label-2)]">{bt.tariff.text}</span>
                    {item.bookable && (
                      <a
                        href={bookingHref(dto.slug, {
                          page: "perawatan",
                          treatment: item.slug,
                          branch: bt.branchSlug,
                        })}
                        className="inline-flex min-h-[var(--target)] items-center rounded-full bg-[var(--surface-2)] px-3.5 text-[0.875rem] font-semibold text-[var(--label)] no-underline"
                      >
                        Buat Janji
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
    </PublicShell>
  );
}
