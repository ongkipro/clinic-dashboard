// Public doctor detail page (/{slug}/dokter/{doctor}; PR-64, UX-51; T-123).
// Ships zero doctors until T-125: always returns neutral 404.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { loadPublicSite, NEUTRAL_NOT_FOUND_META } from "../../_shared";

// Blocking dynamic route so unknown/unpublished/revoked tenants return a real HTTP 404 (not streamed 200).
export const instant = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; doctor: string }>;
}): Promise<Metadata> {
  await connection();
  const { slug } = await params;
  await loadPublicSite(slug);
  return NEUTRAL_NOT_FOUND_META;
}

export default async function DoctorDetailPage({
  params,
}: {
  params: Promise<{ slug: string; doctor: string }>;
}) {
  await connection();
  const { slug } = await params;
  await loadPublicSite(slug);
  notFound();
}
