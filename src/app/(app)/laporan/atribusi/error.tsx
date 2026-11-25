"use client";

import Link from "next/link";
import { PageTitle } from "../../../../components/templates/templates";

export default function LaporanAtribusiError({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <PageTitle title="Atribusi & Sumber Rujukan" />
      <div role="alert" className="grid gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
        <p className="m-0 text-[var(--danger)]">
          Laporan atribusi belum dapat ditampilkan. Tidak ada data yang berubah.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            className="min-h-[var(--target)] rounded-full bg-[var(--secondary)] px-4 font-semibold text-[var(--label)]"
          >
            Coba Lagi
          </button>
          <Link href="/laporan/atribusi" className="inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--tint)]">
            Muat ulang
          </Link>
        </div>
      </div>
    </main>
  );
}
