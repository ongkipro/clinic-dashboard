// Layout for the staff sign-in screens. Language and colour scheme come from the root
// layout; this adds the screen title, keeps the pages out of search engines, and renders
// per request so Next.js stamps the per-response APP_HOST CSP nonce onto every script.
import type { Metadata } from "next";
import { connection } from "next/server";

export const instant = false;

export const metadata: Metadata = {
  title: "Masuk — Clinic Dashboard",
  robots: { index: false, follow: false },
};

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  await connection();
  return children;
}
