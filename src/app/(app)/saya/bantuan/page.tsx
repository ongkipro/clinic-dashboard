// Bantuan (Saya › Bantuan, 19:229; HYG-NAV-1): short operational help — moving around the app, keyboard shortcuts, the state words, and
// who to ask. Static; no tenant data. Clinic glossary (no store words).
import type { Metadata } from "next";
import Link from "next/link";
import { PageTitle } from "../../../../components/templates/templates";

export const metadata: Metadata = { title: "Bantuan — Clinic Dashboard" };

export const HELP: { title: string; items: [string, string][] }[] = [
  { title: "Berpindah halaman", items: [
    ["Tab bawah (ponsel)", "Empat tab utama peran Anda; Menu berisi semua halaman lain dan Saya."],
    ["Menu samping (tablet & komputer)", "Grup halaman sesuai peran; halaman yang tidak bisa Anda pakai tidak ditampilkan."],
    ["Cari halaman", "Ketik nama halaman, pasien atau aksi di kolom cari."],
    ["Ganti cabang atau peran", "Saya › Ganti Cabang / Ganti Peran, bila Anda memegang lebih dari satu."],
  ] },
  { title: "Pintasan papan ketik", items: [
    ["Ctrl + K (⌘ + K)", "Buka pencarian dari halaman mana pun."],
    ["Esc", "Tutup menu, pencarian atau lembar."],
    ["Tab / Shift + Tab", "Pindah antar tombol dan isian."],
  ] },
  { title: "Arti status", items: [
    ["Menunggu persetujuan {peran}", "Permintaan Anda sudah terkirim; peran tersebut yang memutuskan di Persetujuan."],
    ["Belum tersedia", "Angka belum bisa dihitung (bukan nol). Keterangan di bawahnya menyebut alasannya."],
    ["Anda tidak memiliki akses", "Peran aktif Anda tidak memegang halaman atau data ini."],
    ["Halaman ini sudah berganti klinik, peran atau cabang di tab lain", "Muat ulang halaman, lalu ulangi."],
  ] },
  { title: "Perlu bantuan lebih lanjut", items: [
    ["Akses atau peran", "Hubungi Owner atau Admin Pusat klinik Anda."],
    ["Data pasien atau rekam medis", "Hubungi Penanggung Jawab Klinik atau Perekam Medis."],
    ["Kendala aplikasi", "Hubungi Owner; Owner dapat membuka sesi dukungan vendor di Saya › Akses Vendor."],
  ] },
];

export default function BantuanPage() {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
      <PageTitle title="Bantuan" />
      {HELP.map((g, i) => (
        <section key={g.title} aria-labelledby={`bantuan-${i}`} className="grid min-w-0 gap-2">
          <h2 id={`bantuan-${i}`} className="m-0 text-[1.18rem] font-semibold">{g.title}</h2>
          <dl className="m-0 grid min-w-0 gap-0 rounded-[var(--radius-group)] bg-[var(--surface)] p-0">
            {g.items.map(([k, v]) => (
              <div key={k} className="grid min-w-0 gap-0.5 border-b border-[var(--separator)] px-4 py-3 last:border-b-0 [border-bottom-width:0.5px]">
                <dt className="font-semibold [overflow-wrap:anywhere]">{k}</dt><dd className="m-0 text-[var(--label-2)] [overflow-wrap:anywhere]">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <p className="m-0"><Link href="/saya/tampilan" className="inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--tint)]">Atur tampilan</Link></p>
    </main>
  );
}
