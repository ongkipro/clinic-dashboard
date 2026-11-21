"use client";
// Error state of Rekonsiliasi (10 State Copy Patterns: message + "Coba Lagi"); nothing changed. PARKED with page.tsx (target: src/app/(app)/keuangan/rekon/error.tsx).
import { ErrorState } from "../../../../components/ui/states";

export default function RekonError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <h1 className="m-0 text-[2rem] font-bold leading-tight">Rekonsiliasi</h1>
      <ErrorState message="Rekonsiliasi belum bisa dimuat. Tidak ada yang berubah." onRetry={retry} />
    </main>
  );
}
