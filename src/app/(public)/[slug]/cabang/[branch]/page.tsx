// Public branch detail page (/{slug}/cabang/{branch}; PR-2, PR-64, UX-51; T-123).
// Finding #5: displays live reason-free branch_closures overlaid at serve time.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { loadPublicSite, NEUTRAL_NOT_FOUND_META, PublicShell, safeJsonLd, weekdayLabel } from "../../_shared";

// Blocking dynamic route so unknown/unpublished/revoked tenants return a real HTTP 404 (not streamed 200).
export const instant = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; branch: string }>;
}): Promise<Metadata> {
  await connection();
  const { slug, branch } = await params;
  const resolved = await loadPublicSite(slug);
  if (resolved.state !== "published" || !resolved.dto.sections.branches) return NEUTRAL_NOT_FOUND_META;
  const item = resolved.dto.branches.find((b) => b.slug === branch);
  if (!item) return NEUTRAL_NOT_FOUND_META;
  return {
    title: `${item.name} — ${resolved.dto.brand}`,
    description: item.address ?? `Informasi jam operasional dan lokasi ${item.name}.`,
    referrer: "no-referrer",
  };
}

export default async function BranchDetailPage({
  params,
}: {
  params: Promise<{ slug: string; branch: string }>;
}) {
  await connection();
  const { slug, branch } = await params;
  const resolved = await loadPublicSite(slug);
  if (resolved.state !== "published" || !resolved.dto.sections.branches) notFound();

  const item = resolved.dto.branches.find((b) => b.slug === branch);
  if (!item) notFound();

  const { dto } = resolved;
  const base = `/${dto.slug}`;
  const treatments = dto.treatments.filter((t) => t.branchSlugs.includes(item.slug));
  const ld = {
    "@context": "https://schema.org",
    "@type": "MedicalClinic",
    name: `${dto.brand} — ${item.name}`,
    address: item.address ?? undefined,
  };

  return (
    <PublicShell site={dto} active="cabang">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(ld) }}
      />

      <article className="grid max-w-[760px] gap-6">
        <nav aria-label="Breadcrumb" className="text-[0.875rem] text-[var(--label-2)]">
          <a href={`${base}/cabang`} className="text-[var(--tint)] no-underline hover:underline">
            Cabang
          </a>
          <span aria-hidden="true"> / </span>
          <span>{item.name}</span>
        </nav>

        <header className="grid gap-2">
          <h1 className="m-0 text-[2rem] font-bold tracking-tight">{item.name}</h1>
          {item.address && <p className="m-0 text-[1rem] text-[var(--label-2)]">{item.address}</p>}
          <div className="flex flex-wrap gap-3 pt-2">
            {item.mapUrl && (
              <a
                href={item.mapUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[var(--target)] items-center rounded-full bg-[var(--surface-2)] px-4 text-[0.9375rem] font-semibold text-[var(--label)] no-underline"
              >
                Buka Peta
              </a>
            )}
            {item.whatsapp && (
              <a
                href={`https://wa.me/${item.whatsapp}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[var(--target)] items-center rounded-full bg-[var(--tint)] px-4 text-[0.9375rem] font-semibold text-white no-underline"
              >
                Hubungi WhatsApp Cabang
              </a>
            )}
          </div>
        </header>

        <section className="grid gap-3 rounded-[var(--radius-group)] bg-[var(--bg-grouped)] p-5">
          <h2 className="m-0 text-[1.125rem] font-semibold">Jam Operasional ({item.timezone})</h2>
          {item.hours.length === 0 ? (
            <p className="m-0 text-[0.9375rem] text-[var(--label-2)]">Hubungi cabang untuk informasi jam operasional.</p>
          ) : (
            <ul className="m-0 grid list-none gap-1.5 p-0 text-[0.9375rem]">
              {item.hours.map((h) => (
                <li key={`${h.weekday}-${h.opens}`} className="flex justify-between gap-4 border-b border-[var(--separator)] py-1.5 last:border-none">
                  <span className="font-medium">{weekdayLabel(h.weekday)}</span>
                  <span className="tabular-nums text-[var(--label-2)]">{h.opens} – {h.closes}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {item.closures.length > 0 && (
          <section className="grid gap-2.5 rounded-[var(--radius-group)] bg-[var(--warning-soft)] p-5 text-[var(--warning)]">
            <h2 className="m-0 text-[1.0625rem] font-semibold">Penyesuaian Jadwal Operasional</h2>
            <ul className="m-0 grid list-none gap-1.5 p-0 text-[0.9375rem]">
              {item.closures.map((c, idx) => (
                <li key={`${c.date}-${idx}`} className="flex justify-between gap-4">
                  <span className="font-medium tabular-nums">{c.date}</span>
                  <span className="tabular-nums">
                    {c.opens && c.closes ? `Tutup sementara ${c.opens} – ${c.closes}` : "Tutup sepanjang hari"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {treatments.length > 0 && (
          <section className="grid gap-3">
            <h2 className="m-0 text-[1.125rem] font-semibold">Perawatan di Cabang Ini</h2>
            <ul className="m-0 grid list-none gap-2.5 p-0">
              {treatments.map((t) => {
                const bt = t.branchTariffs.find((x) => x.branchSlug === item.slug);
                return (
                  <li
                    key={t.slug}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-group)] border border-[var(--separator)] bg-[var(--surface)] px-4 py-3 text-[0.9375rem]"
                  >
                    <a
                      href={`${base}/perawatan/${t.slug}`}
                      className="font-semibold text-[var(--tint)] no-underline hover:underline"
                    >
                      {t.name}
                    </a>
                    <span className="text-[var(--label-2)]">{bt?.tariff.text ?? t.tariff.text}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </article>
    </PublicShell>
  );
}
