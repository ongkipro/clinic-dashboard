// Layout for the staff sign-in screens (UI in Bahasa Indonesia, light only). The root
// layout (src/app/layout.tsx) owns <html>; it is outside T-006 and still says lang="en",
// so the screens mark their own language.
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Masuk — Clinic Dashboard",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { colorScheme: "only light", themeColor: "#FFFFFF" };

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div lang="id">{children}</div>;
}
