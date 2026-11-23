// Tampilan (Saya › Tampilan, 19:229, DESIGN.md Materials; HYG-NAV-1): device-local appearance. Light only (D-15); increased contrast
// follows the device setting (prefers-contrast); "Kurangi transparansi" is the one switch, because Safari has no
// prefers-reduced-transparency. No tenant data.
import type { Metadata } from "next";
import { PageTitle } from "../../../../components/templates/templates";
import { ReduceTransparency } from "./toggle";

export const metadata: Metadata = { title: "Tampilan — Clinic Dashboard" };
const muted = "m-0 px-4 text-[0.88rem] text-[var(--label-2)]";

export default function TampilanPage() {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <PageTitle title="Tampilan" />
      <section aria-label="Pilihan tampilan" className="grid min-w-0 gap-2">
        <div className="grid min-w-0 rounded-[var(--radius-group)] bg-[var(--surface)] py-1"><ReduceTransparency /></div>
        <p className={muted}>Disimpan di perangkat ini saja.</p>
      </section>
      <section aria-labelledby="tampilan-perangkat" className="grid min-w-0 gap-2">
        <h2 id="tampilan-perangkat" className="m-0 text-[1.18rem] font-semibold">Mengikuti pengaturan perangkat</h2>
        <ul className="m-0 grid min-w-0 list-none gap-0 rounded-[var(--radius-group)] bg-[var(--surface)] p-0">
          {[["Ukuran teks", "Ikuti ukuran teks perangkat atau peramban; halaman tetap terbaca sampai 200%."],
            ["Kontras tinggi", "Aktif bila perangkat meminta kontras lebih (Tingkatkan Kontras)."],
            ["Kurangi gerakan", "Aktif bila perangkat meminta gerakan dikurangi; transisi menjadi pudar saja."],
            ["Mode terang", "Aplikasi selalu tampil terang."]].map(([k, v]) => (
            <li key={k} className="grid min-w-0 gap-0.5 border-b border-[var(--separator)] px-4 py-3 last:border-b-0 [border-bottom-width:0.5px]">
              <span>{k}</span><span className="text-[0.88rem] text-[var(--label-2)]">{v}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
