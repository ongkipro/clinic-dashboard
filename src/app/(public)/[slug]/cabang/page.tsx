// Public branches list page (/{slug}/cabang; PR-2, PR-64, UX-51; T-123).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
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
  if (resolved.state !== "published" || !resolved.dto.sections.branches) return NEUTRAL_NOT_FOUND_META;
  return {
    title: `Cabang — ${resolved.dto.brand}`,
    description: `Lokasi dan jam operasional cabang resmi ${resolved.dto.brand}.`,
    referrer: "no-referrer",
  };
}

export default async function BranchesListPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await connection();
  const { slug } = await params;
  const resolved = await loadPublicSite(slug);
  if (resolved.state !== "published" || !resolved.dto.sections.branches) notFound();

  const { dto } = resolved;
  const base = `/${dto.slug}`;

  return (
    <PublicShell site={dto} active="cabang">
      <div className="grid gap-6">
        <header className="grid gap-2">
          <h1 className="m-0 text-[2rem] font-bold tracking-tight">Cabang</h1>
          <p className="m-0 text-[1rem] text-[var(--label-2)]">
            Pilih cabang {dto.brand} untuk melihat alamat, jam operasional, dan penyesuaian jadwal.
          </p>
        </header>

        <div className="grid gap-4 min-[700px]:grid-cols-2">
          {dto.branches.map((b) => (
            <a
              key={b.slug}
              href={`${base}/cabang/${b.slug}`}
              className="grid gap-2 rounded-[var(--radius-group)] border border-[var(--separator)] bg-[var(--surface)] p-5 text-[var(--label)] no-underline transition hover:border-[var(--tint)]"
            >
              <h2 className="m-0 text-[1.125rem] font-semibold">{b.name}</h2>
              {b.address && <p className="m-0 text-[0.9375rem] text-[var(--label-2)]">{b.address}</p>}
              {b.closures.length > 0 && (
                <p className="m-0 text-[0.8125rem] font-medium text-[var(--warning)]">
                  {b.closures.length} penyesuaian jadwal dalam 30 hari ke depan
                </p>
              )}
            </a>
          ))}
        </div>
      </div>
    </PublicShell>
  );
}
