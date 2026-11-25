// UX-51 consent banner & withdrawal controls (PR-39, PRIV-10; T-127 r2).
// Shown ONLY on pixel-eligible routes (/{slug} home and /{slug}/cabang/{branch} detail) when the tenant has a
// valid pixel config and the visitor has not made a verified choice yet ("unset").
// Pure server components: plain HTML POST forms with equal-weight Tolak / Terima buttons (no dark pattern, works without JS).
export type PixelConsentBannerProps = {
  clinicName: string;
  slug: string;
  action: string;
  returnTo: string;
  privacyHref: string;
  presentationToken: string;
};

const btnCls =
  "inline-flex min-h-[44px] min-w-[8rem] flex-1 items-center justify-center rounded-full border border-[#D2D2D7] bg-white px-5 text-[15px] font-semibold text-[#1D1D1F] transition hover:bg-[#F5F5F7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0071E3]";

export function PixelConsentBanner({
  clinicName,
  slug,
  action,
  returnTo,
  privacyHref,
  presentationToken,
}: PixelConsentBannerProps) {
  return (
    <section
      role="region"
      aria-labelledby="persetujuan-pixel-judul"
      className="fixed inset-x-0 bottom-0 z-30 grid gap-3 border-t border-[#D2D2D7] bg-white p-4 shadow-[0_-2px_12px_rgba(0,0,0,0.08)] min-[820px]:inset-x-auto min-[820px]:right-4 min-[820px]:bottom-4 min-[820px]:max-w-[28rem] min-[820px]:rounded-2xl min-[820px]:border"
    >
      <h2 id="persetujuan-pixel-judul" className="m-0 text-[16px] font-semibold text-[#1D1D1F]">
        Izin pengukuran iklan
      </h2>
      <p className="m-0 text-[14px] leading-relaxed text-[#6E6E73] [overflow-wrap:anywhere]">
        {clinicName} ingin memakai pengukuran iklan pihak ketiga hanya di halaman beranda dan detail cabang. Halaman
        daftar cabang, perawatan, dokter, keluhan, dan booking tidak pernah memakai pengukuran ini. Anda dapat menolak
        tanpa kehilangan fitur apa pun.
      </p>
      <a
        href={privacyHref}
        className="inline-flex min-h-[44px] items-center self-start text-[14px] font-semibold text-[#0071E3] underline-offset-2 hover:underline"
      >
        Baca Kebijakan Privasi
      </a>
      <form action={action} method="post" className="flex flex-wrap gap-3">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="kembali" value={returnTo} />
        <input type="hidden" name="t" value={presentationToken} />
        <button type="submit" name="pilihan" value="tolak" className={btnCls}>
          Tolak
        </button>
        <button type="submit" name="pilihan" value="terima" className={btnCls}>
          Terima
        </button>
      </form>
    </section>
  );
}

export function PixelConsentWithdraw({
  slug,
  action,
  returnTo,
  choice,
}: {
  slug: string;
  action: string;
  returnTo: string;
  choice: "terima" | "tolak";
}) {
  return (
    <aside
      aria-label="Pengaturan izin pengukuran iklan"
      className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-group)] border border-[var(--separator)] bg-[var(--bg-grouped)] px-4 py-3 text-[0.875rem] text-[var(--label-2)]"
    >
      <span>
        {choice === "terima"
          ? "Pengukuran iklan pihak ketiga aktif hanya di halaman beranda dan detail cabang."
          : "Pengukuran iklan pihak ketiga dinonaktifkan pada perangkat ini."}
      </span>
      <form action={action} method="post">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="kembali" value={returnTo} />
        <button
          type="submit"
          name="pilihan"
          value="cabut"
          className="inline-flex min-h-[44px] items-center rounded-full border border-[var(--separator)] bg-[var(--surface)] px-4 text-[0.875rem] font-semibold text-[var(--label)] transition hover:bg-[var(--surface-2)]"
        >
          Cabut izin pengukuran
        </button>
      </form>
    </aside>
  );
}
