// Shared Apple-style light-only chrome and safe metadata/JSON-LD helpers for BOOKING_HOST public pages (UX-51, PR-64, PR-65; T-123).
// Finding #4: reads ONLY PublicSiteDto (zero tenantId, zero raw UUIDs, zero hidden prices/priceNote, zero third-party URLs).
// Finding #8: neutralNotFoundMeta() is byte-identical across unknown, unpublished, suspended, revoked-counsel, and expired-branch states.
import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { appPool } from "../../../modules/org/context/store";
import { resolvePublicSiteBySlug, type PublicSiteDto, type ResolvedPublicSite } from "../../../modules/public-site";

export const NEUTRAL_NOT_FOUND_META: Metadata = {
  title: "Halaman Tidak Ditemukan",
  description: "Halaman yang Anda cari tidak tersedia.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export async function loadPublicSite(slug: string): Promise<ResolvedPublicSite> {
  return resolvePublicSiteBySlug(slug, await appPool());
}

export function safeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

const WEEKDAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"] as const;
export function weekdayLabel(w: number): string {
  return WEEKDAYS[w] ?? "";
}

export function PublicShell({
  site,
  active,
  children,
}: {
  site: PublicSiteDto;
  active: "home" | "perawatan" | "cabang" | "dokter" | "legal";
  children: ReactNode;
}) {
  const accentStyle: CSSProperties | undefined =
    site.accent && /^#[0-9A-Fa-f]{6}$/.test(site.accent)
      ? ({ "--tint": site.accent } as CSSProperties)
      : undefined;

  const base = `/${site.slug}`;
  const nav = [
    { id: "home", label: "Beranda", href: base, show: true },
    { id: "perawatan", label: "Perawatan", href: `${base}/perawatan`, show: site.sections.treatments },
    { id: "cabang", label: "Cabang", href: `${base}/cabang`, show: site.sections.branches },
    { id: "dokter", label: "Dokter", href: `${base}/dokter`, show: site.sections.doctors },
  ].filter((n) => n.show);

  return (
    <div
      className="min-h-dvh bg-[var(--bg)] text-[var(--label)] antialiased"
      style={accentStyle}
    >
      <header className="sticky top-0 z-20 border-b border-[var(--separator)] bg-[var(--bg)]/92 backdrop-blur-[8px]">
        <div className="mx-auto flex max-w-[1040px] flex-wrap items-center justify-between gap-3 px-4 py-3.5 min-[700px]:px-6">
          {/* Plain <a> full-document links across public pages so T-127 marketing pixels never survive SPA nav onto health routes. */}
          <a
            href={base}
            className="text-[1.125rem] font-semibold tracking-tight text-[var(--label)] no-underline"
          >
            {site.brand}
          </a>
          <nav aria-label="Navigasi situs klinik" className="flex flex-wrap items-center gap-1.5">
            {nav.map((item) => (
              <a
                key={item.id}
                href={item.href}
                aria-current={active === item.id ? "page" : undefined}
                className={
                  active === item.id
                    ? "inline-flex min-h-[var(--target)] items-center rounded-full bg-[var(--surface-2)] px-3.5 text-[0.9375rem] font-semibold text-[var(--tint)] no-underline"
                    : "inline-flex min-h-[var(--target)] items-center rounded-full px-3.5 text-[0.9375rem] font-medium text-[var(--label-2)] no-underline hover:bg-[var(--surface-2)]"
                }
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1040px] px-4 py-8 min-[700px]:px-6 min-[700px]:py-12">
        {children}
      </main>

      <footer className="mt-16 border-t border-[var(--separator)] bg-[var(--bg-grouped)]">
        <div className="mx-auto flex max-w-[1040px] flex-col gap-4 px-4 py-8 text-[0.875rem] text-[var(--label-2)] min-[700px]:flex-row min-[700px]:items-center min-[700px]:justify-between min-[700px]:px-6">
          <p className="m-0 font-medium text-[var(--label)]">{site.brand}</p>
          <nav aria-label="Informasi kebijakan" className="flex flex-wrap gap-x-5 gap-y-2">
            <a href={`${base}/kebijakan-privasi`} className="text-[var(--label-2)] underline-offset-4 hover:underline">
              Kebijakan Privasi
            </a>
            <a href={`${base}/syarat-ketentuan`} className="text-[var(--label-2)] underline-offset-4 hover:underline">
              Syarat &amp; Ketentuan
            </a>
            <a href={`${base}/kebijakan-pembatalan`} className="text-[var(--label-2)] underline-offset-4 hover:underline">
              Kebijakan Pembatalan
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
