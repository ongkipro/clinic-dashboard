"use client";
// Error state of Pajak (10 State Copy Patterns: message + "Coba Lagi"); nothing changed.
import { ErrorState } from "../../../../components/ui/states";

export default function PajakError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <h1 className="m-0 text-[2rem] font-bold leading-tight">Pajak</h1>
      <ErrorState message="Data pajak belum bisa dimuat. Tidak ada yang berubah." onRetry={retry} />
    </main>
  );
}
