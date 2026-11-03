"use client";
// Error state of Persetujuan (10 State Copy Patterns: message + "Coba Lagi"). Next 16
// passes `retry` (stable since 16.3, node_modules/next/dist/docs error.md). The error
// itself is not shown (it may carry database detail).
import { ErrorState } from "../../../components/ui/states";

export default function PersetujuanError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <h1 className="m-0 text-[2rem] font-bold leading-tight">Persetujuan</h1>
      <ErrorState message="Persetujuan belum dapat ditampilkan. Muat ulang untuk melihat keadaan terbaru." onRetry={retry} />
    </main>
  );
}
