// Neutral 404 shared across all unknown, unpublished, suspended, revoked-counsel, and expired-branch slugs (PR-64, PR-67; Finding #8).
export default function PublicSiteNotFound() {
  return (
    <main className="min-h-dvh bg-[var(--bg-grouped)] px-4 py-16 text-[var(--label)]">
      <div className="mx-auto grid max-w-[520px] gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-6">
        <h1 className="m-0 text-[1.5rem] font-bold tracking-tight">Halaman Tidak Ditemukan</h1>
        <p className="m-0 text-[0.9375rem] leading-relaxed text-[var(--label-2)]">
          Halaman klinik yang Anda buka tidak tersedia atau tautannya sudah tidak aktif.
        </p>
      </div>
    </main>
  );
}
