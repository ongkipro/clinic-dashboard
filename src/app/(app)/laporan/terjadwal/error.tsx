"use client";

import Link from "next/link";
import { PageTitle } from "../../../../components/templates/templates";

export default function LaporanTerjadwalError({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <PageTitle title="Kirim Laporan Terjadwal" />
      <div role="alert" className="grid gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
        <p className="m-0 text-[var(--danger)]">
          Pengaturan laporan terjadwal belum dapat ditampilkan. Tidak ada data yang berubah.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            className="min-h-[var(--target)] rounded-full bg-[var(--secondary)] px-4 font-semibold text-[var(--label)]"
          >
            Coba Lagi
          </button>
          <Link href="/laporan/terjadwal" className="inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--tint)]">
            Muat ulang
          </Link>
        </div>
      </div>
    </main>
  );
}
