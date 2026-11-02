import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Gallery } from "./gallery";

export const metadata: Metadata = { title: "Galeri Komponen", robots: { index: false, follow: false } };

export default function GaleriPage() {
  // Defence in depth: the proxy already refuses /dev in production.
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="min-h-dvh bg-[var(--bg-grouped)] px-4 pb-8 pt-[max(env(safe-area-inset-top),24px)] md:px-5">
      <div className="mx-auto grid max-w-[1100px] grid-cols-[minmax(0,1fr)] gap-6">
        <h1 className="m-0 text-[2rem] font-bold leading-tight [overflow-wrap:break-word] hyphens-auto">Galeri Komponen</h1>
        <Gallery />
      </div>
    </main>
  );
}
