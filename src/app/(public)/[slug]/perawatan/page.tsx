// Public treatments list page (/{slug}/perawatan; PR-64, PR-65, UX-51; T-123).
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { toTreatmentCard } from "../../../../modules/public-site";
import { loadPublicSite, NEUTRAL_NOT_FOUND_META, PublicShell } from "../_shared";

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
  if (resolved.state !== "published" || !resolved.dto.sections.treatments) return NEUTRAL_NOT_FOUND_META;
  return {
    title: `Perawatan — ${resolved.dto.brand}`,
    description: `Informasi perawatan klinis yang tersedia di ${resolved.dto.brand}.`,
    referrer: "no-referrer",
  };
}

export default async function TreatmentsListPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await connection();
  const { slug } = await params;
  const resolved = await loadPublicSite(slug);
  if (resolved.state !== "published" || !resolved.dto.sections.treatments) notFound();

  const { dto } = resolved;
  const base = `/${dto.slug}`;
  const cards = dto.treatments.map(toTreatmentCard);

  return (
    <PublicShell site={dto} active="perawatan">
      <div className="grid gap-6">
        <header className="grid gap-2">
          <h1 className="m-0 text-[2rem] font-bold tracking-tight">Perawatan</h1>
          <p className="m-0 text-[1rem] text-[var(--label-2)]">
            Informasi layanan klinis di {dto.brand}. Kelayakan tindakan ditentukan melalui evaluasi dokter.
          </p>
        </header>

        {cards.length === 0 ? (
          <p className="m-0 rounded-[var(--radius-group)] bg-[var(--bg-grouped)] p-5 text-[0.9375rem] text-[var(--label-2)]">
            Belum ada perawatan yang dipublikasikan.
          </p>
        ) : (
          <div className="grid gap-4 min-[700px]:grid-cols-2 min-[1024px]:grid-cols-3">
            {cards.map((t) => (
              <Link
                key={t.slug}
                href={`${base}/perawatan/${t.slug}`}
                className="grid content-between gap-3 rounded-[var(--radius-group)] border border-[var(--separator)] bg-[var(--surface)] p-5 text-[var(--label)] no-underline transition hover:border-[var(--tint)]"
              >
                <div className="grid gap-1.5">
                  <h2 className="m-0 text-[1.0625rem] font-semibold leading-snug">{t.name}</h2>
                  <p className="m-0 text-[0.9375rem] leading-relaxed text-[var(--label-2)]">{t.purpose}</p>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--separator)] pt-3 text-[0.875rem]">
                  <span className="font-medium text-[var(--label)]">{t.tariffText}</span>
                  {t.duration && <span className="text-[var(--label-2)]">{t.duration}</span>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </PublicShell>
  );
}
