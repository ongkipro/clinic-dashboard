"use client";
// Error state of Kepatuhan (10 State Copy Patterns: message + "Coba Lagi"). Next 16 passes
// `retry`; the error itself is not shown.
import { ErrorState } from "../../../components/ui/states";

export default function KepatuhanError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <h1 className="m-0 text-[2rem] font-bold leading-tight">Kepatuhan & Pendapat Ahli</h1>
      <ErrorState message="Register kepatuhan belum dapat ditampilkan. Tidak ada bukti yang berubah." onRetry={retry} />
    </main>
  );
}
