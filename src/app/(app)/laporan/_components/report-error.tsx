// Error state of a Laporan page (10 State Copy Patterns: message + "Coba Lagi"); nothing changed. Plain component: each route's error.tsx ("use client") renders it with its own title.
import { ErrorState } from "../../../../components/ui/states";

export function ReportError({ title, retry }: { title: string; retry: () => void }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <h1 className="m-0 text-[2rem] font-bold leading-tight">{title}</h1>
      <ErrorState message="Laporan belum bisa dimuat. Tidak ada yang berubah." onRetry={retry} />
    </main>
  );
}
