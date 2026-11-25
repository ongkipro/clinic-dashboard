// Authoritative public doctor portrait handler (PR-66, T-125 r4).
// Extracted into a sibling module so Next.js App Router route.ts exports ONLY HTTP GET.
// Binds every request to exact issued asset version (?v=<24-hex>) via unbound public_doctor_photo();
// serves private/no-store + CDN-Cache-Control: no-store so withdrawal, replacement, or slug reuse
// keeps the exact old URL permanently HTTP 404.
import type { Pool, PoolClient } from "pg";
import { NextResponse, type NextRequest } from "next/server";
import { resolvePublicDoctorPhoto } from "../../../../../../../modules/public-site/doctors/db";

type Db = Pick<Pool, "query"> | Pick<PoolClient, "query">;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const DOC_RE = /^[a-z0-9][a-z0-9-]{1,59}$/;
const VER_RE = /^[0-9a-f]{24}$/;

const NO_STORE_HEADERS = {
  "cache-control": "private, no-store",
  "cdn-cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "same-origin",
} as const;

export async function handleDoctorPhotoGet(
  request: NextRequest,
  params: { slug: string; doctor: string },
  deps?: { db?: Db },
): Promise<NextResponse> {
  const slug = params.slug.trim().toLowerCase();
  const doctor = params.doctor.trim().toLowerCase();
  const version = (request.nextUrl.searchParams.get("v") ?? "").trim().toLowerCase();
  if (!SLUG_RE.test(slug) || !DOC_RE.test(doctor) || !VER_RE.test(version)) {
    return new NextResponse(null, { status: 404, headers: NO_STORE_HEADERS });
  }
  const db = deps?.db ?? (await (await import("../../../../../../../modules/org/context/store")).appPool());
  const photo = await resolvePublicDoctorPhoto(slug, doctor, version, db);
  if (photo.state !== "found") {
    return new NextResponse(null, { status: 404, headers: NO_STORE_HEADERS });
  }
  return new NextResponse(new Uint8Array(photo.bytes), {
    status: 200,
    headers: {
      ...NO_STORE_HEADERS,
      "content-type": photo.mediaType,
      "content-length": String(photo.bytes.byteLength),
    },
  });
}
