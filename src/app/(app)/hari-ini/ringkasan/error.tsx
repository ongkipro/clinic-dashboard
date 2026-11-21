"use client";
// Error state of Ringkasan Shift (10 State Copy Patterns: message + "Coba Lagi"); nothing changed. PARKED with page.tsx (target: src/app/(app)/hari-ini/ringkasan/error.tsx).
import { ErrorState } from "../../../../components/ui/states";

export default function RingkasanShiftError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <h1 className="m-0 text-[2rem] font-bold leading-tight">Ringkasan Shift</h1>
      <ErrorState message="Ringkasan shift belum bisa dimuat. Tidak ada yang berubah." onRetry={retry} />
    </main>
  );
}
