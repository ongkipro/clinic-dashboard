// Public doctors list page (/{slug}/dokter; PR-64, UX-51; T-123).
// Finding #4: ships ZERO doctors until T-125 (explicit doctor consent + immediate purge).
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

  return (
    <PublicShell site={dto} active="dokter">
      <div className="grid gap-6">
        <header className="grid gap-2">
          <h1 className="m-0 text-[2rem] font-bold tracking-tight">Dokter</h1>
          <p className="m-0 text-[1rem] text-[var(--label-2)]">
            Hanya dokter dengan persetujuan publikasi aktif yang ditampilkan pada halaman ini.
          </p>
        </header>
        <p className="m-0 rounded-[var(--radius-group)] bg-[var(--bg-grouped)] p-5 text-[0.9375rem] text-[var(--label-2)]">
          Belum ada profil dokter yang dipublikasikan.
        </p>
      </div>
    </PublicShell>
  );
}
