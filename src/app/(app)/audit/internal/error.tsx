"use client";

import Link from "next/link";
import { PageTitle } from "../../../../components/templates/templates";
import { AUDIT_INTERNAL_TITLE } from "./labels";

export default function AuditInternalError({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <PageTitle title={AUDIT_INTERNAL_TITLE} />
      <div role="alert" className="grid gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
        <p className="m-0 text-[var(--danger)]">
          Data audit internal belum dapat ditampilkan. Tidak ada data yang berubah.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            className="min-h-[var(--target)] rounded-full bg-[var(--secondary)] px-4 font-semibold text-[var(--label)]"
          >
            Coba Lagi
          </button>
          <Link
            href="/audit/internal"
            className="inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--tint)]"
          >
            Muat ulang filter
          </Link>
        </div>
      </div>
    </main>
  );
}
