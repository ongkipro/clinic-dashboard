// Public site root segment (PR-64, PR-67, H-02c; T-123).
// Every public tenant page renders per request (build output ƒ, never a prerendered ◐ shell):
// unknown, unpublished, suspended, or revoked-counsel tenants return a real HTTP 404 before
// any shell flushes, and per-request headers/CSP nonces (T-127) apply cleanly to every response.
import type { ReactNode } from "react";
import { connection } from "next/server";

export const instant = false;

export default async function PublicSiteLayout({ children }: { children: ReactNode }) {
  await connection();
  return children;
}
