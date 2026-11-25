// Public doctor detail page (/{slug}/dokter/{doctor}; PR-66, PR-67, UX-51; T-125).
// Returns real HTTP 404 (neutral metadata) immediately upon consent withdrawal, deactivation,
// or unpublished site state — zero stale serving, zero internal UUIDs, zero ratings/promos.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { appPool } from "../../../../../modules/org/context/store";
import { resolvePublicDoctorDetail } from "../../../../../modules/public-site";
import { bookingHref, whatsappLink } from "../../booking/model";
import { loadPublicSite, NEUTRAL_NOT_FOUND_META, PublicShell, safeJsonLd } from "../../_shared";

// Blocking dynamic route so unknown/unpublished/revoked/withdrawn doctors return a real HTTP 404.
export const instant = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; doctor: string }>;
}): Promise<Metadata> {
  await connection();
  const { slug, doctor } = await params;
  const resolved = await loadPublicSite(slug);
  if (resolved.state !== "published" || !resolved.dto.sections.doctors) return NEUTRAL_NOT_FOUND_META;
  const detail = await resolvePublicDoctorDetail(resolved.dto.slug, doctor, await appPool());
  if (detail.state !== "found") return NEUTRAL_NOT_FOUND_META;
  return {
    title: `${detail.doctor.name} — ${resolved.dto.brand}`,
    description: `Profil dokter praktik ${detail.doctor.name} di ${resolved.dto.brand}.`,
    referrer: "no-referrer",
  };
}

export default async function DoctorDetailPage({
  params,
}: {
  params: Promise<{ slug: string; doctor: string }>;
}) {
  await connection();
  const { slug, doctor } = await params;
  const resolved = await loadPublicSite(slug);
  if (resolved.state !== "published" || !resolved.dto.sections.doctors) notFound();

  const { dto } = resolved;
  const detail = await resolvePublicDoctorDetail(dto.slug, doctor, await appPool());
  if (detail.state !== "found") notFound();

  const doc = detail.doctor;
  const branchNameBySlug = new Map(dto.branches.map((b) => [b.slug, b.name]));
  const preferredBranch = doc.branchSlugs.length === 1 ? doc.branchSlugs[0] : undefined;
  const waPhone =
    (preferredBranch ? dto.branches.find((b) => b.slug === preferredBranch)?.whatsapp : null) ??
    dto.branches.find((b) => doc.branchSlugs.includes(b.slug) && b.whatsapp)?.whatsapp ??
    dto.branches.find((b) => b.whatsapp)?.whatsapp ??
    null;
  const wa = whatsappLink(waPhone, { brand: dto.brand, page: "dokter" });

  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Physician",
    name: doc.name,
    ...(doc.title ? { jobTitle: doc.title } : {}),
    ...(doc.focusAreas.length > 0 ? { medicalSpecialty: doc.focusAreas } : {}),
    worksFor: { "@type": "MedicalClinic", name: dto.brand },
  };

  return (
    <PublicShell site={dto} active="dokter">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />
      <article className="grid gap-8">
        <nav aria-label="Breadcrumb" className="text-[0.875rem] text-[var(--label-2)]">
          <a href={`/${dto.slug}/dokter`} className="text-[var(--tint)] no-underline hover:underline">
            Dokter
          </a>{" "}
          / <span>{doc.name}</span>
        </nav>

        <header className="flex flex-wrap items-start gap-5">
          {doc.photoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- local first-party media ref only
            <img
              src={doc.photoUrl}
              alt={`Foto ${doc.name}`}
              width={96}
              height={96}
              className="h-24 w-24 shrink-0 rounded-full object-cover"
            />
          )}
          <div className="grid gap-2">
            <h1 className="m-0 text-[2rem] font-bold tracking-tight">{doc.name}</h1>
            {doc.title && <p className="m-0 text-[1rem] text-[var(--label-2)]">{doc.title}</p>}
            {doc.branchSlugs.length > 0 && (
              <p className="m-0 text-[0.9375rem] text-[var(--label-2)]">
                Cabang praktik:{" "}
                {doc.branchSlugs.map((bs) => branchNameBySlug.get(bs) ?? bs).join(", ")}
              </p>
            )}
          </div>
        </header>

        {doc.scheduleSummary && (
          <section className="grid gap-2 rounded-[var(--radius-group)] bg-[var(--bg-grouped)] p-5">
            <h2 className="m-0 text-[1.0625rem] font-semibold">Jadwal Praktik</h2>
            <p className="m-0 text-[0.9375rem] text-[var(--label)]">{doc.scheduleSummary}</p>
          </section>
        )}

        {doc.focusAreas.length > 0 && (
          <section className="grid gap-3">
            <h2 className="m-0 text-[1.0625rem] font-semibold">Fokus Layanan</h2>
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {doc.focusAreas.map((area) => (
                <li
                  key={area}
                  className="rounded-full bg-[var(--surface-2)] px-3.5 py-1.5 text-[0.875rem] text-[var(--label)]"
                >
                  {area}
                </li>
              ))}
            </ul>
          </section>
        )}

        {doc.sipNumbers.length > 0 && (
          <section className="grid gap-2 rounded-[var(--radius-group)] border border-[var(--separator)] p-5">
            <h2 className="m-0 text-[1.0625rem] font-semibold">Nomor SIP Aktif</h2>
            <ul className="m-0 grid list-none gap-1.5 p-0 text-[0.9375rem] text-[var(--label-2)]">
              {doc.sipNumbers.map((s) => (
                <li key={`${s.branchSlug}-${s.sip}`}>
                  {s.branchName}: <span className="font-medium text-[var(--label)]">{s.sip}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <a
            href={bookingHref(dto.slug, {
              page: "dokter",
              doctor: doc.slug,
              branch: preferredBranch,
            })}
            className="inline-flex min-h-[var(--target)] items-center justify-center rounded-full bg-[var(--tint)] px-6 text-[0.9375rem] font-semibold text-white no-underline hover:bg-[var(--tint-pressed)]"
          >
            Buat Janji
          </a>
          {wa && (
            <a
              href={wa.href}
              rel="noopener noreferrer"
              className="inline-flex min-h-[var(--target)] items-center justify-center rounded-full border border-[var(--separator)] px-5 text-[0.9375rem] font-medium text-[var(--label)] no-underline hover:bg-[var(--surface-2)]"
            >
              {wa.label}
            </a>
          )}
        </div>
      </article>
    </PublicShell>
  );
}
