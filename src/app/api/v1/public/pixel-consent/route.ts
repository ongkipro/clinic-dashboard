// Next.js App Router POST route for public pixel consent & withdrawal (PR-39, UX-51; T-127 r4).
// Exports ONLY HTTP POST; core logic lives in sibling ./handler.ts for clean Next.js build validation.
import type { NextRequest } from "next/server";
import { handlePixelConsentPost } from "./handler";

export async function POST(request: NextRequest) {
  return handlePixelConsentPost(request);
}
