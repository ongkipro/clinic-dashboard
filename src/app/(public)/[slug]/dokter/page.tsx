// Public doctors list page (/{slug}/dokter; PR-66, PR-64, UX-51; T-125).
// Evaluated live at serve time: only active doctors with recorded listing consent appear;
// withdrawal or deactivation removes the doctor immediately on the next read.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { appPool } from "../../../../modules/org/context/store";
import { resolvePublicDoctorsBySlug } from "../../../../modules/public-site";
import { bookingHref, whatsappLink } from "../booking/model";
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
  if (resolved.state !== "published" || !resolved.dto.sections.doctors) return NEUTRAL_NOT_FOUND_META;
  return {
    title: `Dokter — ${resolved.dto.brand}`,
    description: `Daftar dokter praktik resmi di ${resolved.dto.brand}.`,
    referrer: "no-referrer",
  };
}

export default async function DoctorsListPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await connection();
  const { slug } = await params;
  const resolved = await loadPublicSite(slug);
  if (resolved.state !== "published" || !resolved.dto.sections.doctors) notFound();

  const { dto } = resolved;
  const doctors = await resolvePublicDoctorsBySlug(dto.slug, await appPool());
  const branchNameBySlug = new Map(dto.branches.map((b) => [b.slug, b.name]));
  const wa = whatsappLink(dto.branches.find((b) => b.whatsapp)?.whatsapp ?? null, {
    brand: dto.brand,
    page: "dokter",
  });

  return (
    <PublicShell site={dto} active="dokter">
      <div className="grid gap-8">
        <header className="grid gap-2">
          <h1 className="m-0 text-[2rem] font-bold tracking-tight">Dokter</h1>
          <p className="m-0 text-[1rem] text-[var(--label-2)]">
            Informasi dokter praktik yang ditampilkan secara faktual berdasarkan persetujuan publikasi aktif.
          </p>
        </header>

        {doctors.length === 0 ? (
          <p className="m-0 rounded-[var(--radius-group)] bg-[var(--bg-grouped)] p-5 text-[0.9375rem] text-[var(--label-2)]">
            Belum ada profil dokter yang dipublikasikan.
          </p>
        ) : (
          <ul className="m-0 grid list-none gap-4 p-0 min-[700px]:grid-cols-2">
            {doctors.map((doc) => (
              <li
                key={doc.slug}
                className="flex flex-col justify-between gap-4 rounded-[var(--radius-group)] border border-[var(--separator)] bg-[var(--bg)] p-5"
              >
                <div className="grid gap-3">
                  <div className="flex items-start gap-4">
                    {doc.photoUrl && (
                      // eslint-disable-next-line @next/next/no-img-element -- local first-party media ref only
                      <img
                        src={doc.photoUrl}
                        alt={`Foto ${doc.name}`}
                        width={64}
                        height={64}
                        className="h-16 w-16 shrink-0 rounded-full object-cover"
                      />
                    )}
                    <div className="grid gap-1">
                      <h2 className="m-0 text-[1.125rem] font-semibold tracking-tight text-[var(--label)]">
                        <a
                          href={`/${dto.slug}/dokter/${doc.slug}`}
                          className="text-[var(--label)] no-underline hover:text-[var(--tint)]"
                        >
                          {doc.name}
                        </a>
                      </h2>
                      {doc.title && (
                        <p className="m-0 text-[0.875rem] text-[var(--label-2)]">{doc.title}</p>
                      )}
                      {doc.branchSlugs.length > 0 && (
                        <p className="m-0 text-[0.875rem] text-[var(--label-2)]">
                          Cabang:{" "}
                          {doc.branchSlugs.map((bs) => branchNameBySlug.get(bs) ?? bs).join(", ")}
                        </p>
                      )}
                    </div>
                  </div>

                  {doc.scheduleSummary && (
                    <p className="m-0 text-[0.9375rem] text-[var(--label)]">{doc.scheduleSummary}</p>
                  )}

                  {doc.focusAreas.length > 0 && (
                    <ul aria-label="Fokus praktik" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                      {doc.focusAreas.map((area) => (
                        <li
                          key={area}
                          className="rounded-full bg-[var(--surface-2)] px-3 py-1 text-[0.8125rem] text-[var(--label-2)]"
                        >
                          {area}
                        </li>
                      ))}
                    </ul>
                  )}

                  {doc.sipNumbers.length > 0 && (
                    <p className="m-0 text-[0.8125rem] text-[var(--label-2)]">
                      SIP: {doc.sipNumbers.map((s) => `${s.branchName} (${s.sip})`).join(" · ")}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <a
                    href={bookingHref(dto.slug, {
                      page: "dokter",
                      doctor: doc.slug,
                      branch: doc.branchSlugs.length === 1 ? doc.branchSlugs[0] : undefined,
                    })}
                    className="inline-flex min-h-[var(--target)] items-center justify-center rounded-full bg-[var(--tint)] px-5 text-[0.9375rem] font-semibold text-white no-underline hover:bg-[var(--tint-pressed)]"
                  >
                    Buat Janji
                  </a>
                  <a
                    href={`/${dto.slug}/dokter/${doc.slug}`}
                    className="inline-flex min-h-[var(--target)] items-center justify-center rounded-full border border-[var(--separator)] px-4 text-[0.9375rem] font-medium text-[var(--label)] no-underline hover:bg-[var(--surface-2)]"
                  >
                    Lihat Profil
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}

        {wa && (
          <div>
            <a
              href={wa.href}
              rel="noopener noreferrer"
              className="inline-flex min-h-[var(--target)] items-center justify-center rounded-full border border-[var(--separator)] px-5 text-[0.9375rem] font-medium text-[var(--label)] no-underline hover:bg-[var(--surface-2)]"
            >
              {wa.label}
            </a>
          </div>
        )}
      </div>
    </PublicShell>
  );
}
