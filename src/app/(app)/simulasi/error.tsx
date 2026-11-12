"use client";
// Error state of Simulasi Pembayaran (10 State Copy Patterns); nothing changed.
import { ErrorState } from "../../../components/ui/states";

export default function SimulasiError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <h1 className="m-0 text-[2rem] font-bold leading-tight">Simulasi Pembayaran</h1>
      <ErrorState message="Simulasi belum dapat ditampilkan. Tidak ada yang berubah." onRetry={retry} />
    </main>
  );
}
