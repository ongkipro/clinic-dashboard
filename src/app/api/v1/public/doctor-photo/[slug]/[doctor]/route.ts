// Next.js App Router GET route for public doctor portraits (PR-66, T-125 r4).
// Exports ONLY HTTP GET; core logic lives in sibling ./handler.ts for clean Next.js build validation.
import type { NextRequest } from "next/server";
import { handleDoctorPhotoGet } from "./handler";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ slug: string; doctor: string }> },
) {
  return handleDoctorPhotoGet(request, await ctx.params);
}
