// Vendor console root segment (SEC-21, UX-40–UX-49 shell). Every vendor page renders
// per request: the CSP nonce is fresh per response and Next.js stamps it on its scripts
// only during a request render, so no vendor page may have a prerendered shell (its
// inline scripts would carry no nonce and the CSP would block them).
// `await connection()` above the whole subtree makes every vendor route request-time
// (build output ƒ); `instant = false` records that this segment blocks on purpose.
// tests/platform/hosts.spec.ts fails if any vendor page serves a script without the nonce.
import type { Metadata } from "next";
import { connection } from "next/server";

export const instant = false;

export const metadata: Metadata = {
  title: "Konsol Vendor",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function VendorRoot({ children }: { children: React.ReactNode }) {
  await connection();
  return children;
}
