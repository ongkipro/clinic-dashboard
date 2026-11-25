// Public cancellation policy page (/{slug}/kebijakan-pembatalan; PR-64, UX-51; T-123).
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
  if (resolved.state !== "published") return NEUTRAL_NOT_FOUND_META;
  return {
    title: `Kebijakan Pembatalan — ${resolved.dto.brand}`,
    description: `Ketentuan pembatalan dan perubahan jadwal kunjungan di ${resolved.dto.brand}.`,
    referrer: "no-referrer",
  };
}

export default async function CancellationPolicyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await connection();
  const { slug } = await params;
  const resolved = await loadPublicSite(slug);
  if (resolved.state !== "published") notFound();

  const page = resolved.dto.legalPages["kebijakan-pembatalan"];
  return (
    <PublicShell site={resolved.dto} active="legal">
      <article className="grid max-w-[720px] gap-4">
        <h1 className="m-0 text-[2rem] font-bold tracking-tight">Kebijakan Pembatalan</h1>
        <div className="grid gap-3 whitespace-pre-line text-[0.9375rem] leading-relaxed text-[var(--label-2)]">
          {page.body}
        </div>
      </article>
    </PublicShell>
  );
}
