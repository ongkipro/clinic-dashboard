// Layout for the staff sign-in screens. Language and colour scheme come from the root
// layout; this only adds the screen title and keeps the pages out of search engines.
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Masuk — Clinic Dashboard",
  robots: { index: false, follow: false },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
