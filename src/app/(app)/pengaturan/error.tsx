"use client";
// Error state of Pengaturan (10 State Copy Patterns: message + "Coba Lagi"). Next 16
// passes `retry`; the error itself is not shown.
import { ErrorState } from "../../../components/ui/states";

export default function PengaturanError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="mx-auto grid w-full max-w-[880px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <h1 className="m-0 text-[2rem] font-bold leading-tight">Pengaturan</h1>
      <ErrorState message="Pengaturan belum dapat ditampilkan. Tidak ada nilai yang berubah." onRetry={retry} />
    </main>
  );
}
