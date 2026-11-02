import type { Metadata, Viewport } from "next";
import "./globals.css";

// UI is Bahasa Indonesia and light only (DESIGN.md, D-15). Screens set their own titles.
// Indexing is decided per area: staff and auth layouts set noindex; the public site
// (PR-39) sets its own.
export const metadata: Metadata = { title: "Clinic Dashboard" };

export const viewport: Viewport = { colorScheme: "only light", themeColor: "#FFFFFF" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="id">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
