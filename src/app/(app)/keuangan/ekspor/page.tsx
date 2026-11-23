// Ekspor (19 §2.12, UX-22 ▸ Ekspor; HYG-NAV-2): Finance's export hub — sub-ledger and transaction-set CSVs for the month to date (A-14),
// the journal CSV only once the posting map is signed and the books activated (shown blocked otherwise, with who unblocks it), and the
// commission CSV per recipient of each submitted batch. Each link is an existing route handler that re-checks role and gate. No patient
// data in any export. Other periods: Piutang & Kewajiban and Buku Besar pages.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../../components/templates/templates";
import { BlockedState, LoadingList, PermissionState } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { loadEkspor } from "./data";
import { ALL_KINDS, batchHref, exportableBatch, exportLabel, journalGate, journalHref, monthToDate, subledgerHref } from "./model";

export const metadata: Metadata = { title: "Ekspor — Keuangan — Clinic Dashboard" };
const muted = "m-0 text-[0.88rem] text-[var(--label-2)]";
const dl = "inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--tint)]";
const card = "grid min-w-0 content-start gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-4";
const Main = ({ children }: { children: React.ReactNode }) => <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">{children}</main>;

async function Body() {
  const p = await loadEkspor();
  if (p.kind === "redirect") redirect(p.to);
  if (p.kind === "forbidden") return <Main><PageTitle title="Ekspor" /><PermissionState object="ekspor keuangan" /></Main>;
  const period = monthToDate(p.today);
  const gate = journalGate(p.ledger);
  const batches = p.batches.filter((b) => exportableBatch(b.state));
  return (
    <Main>
      <PageTitle title="Ekspor" />
      <p className={muted}>Periode {period.from} s.d. {period.to}. Periode lain: <Link href="/keuangan/kewajiban" className="inline-flex min-h-[var(--target)] items-center text-[var(--tint)]">Piutang & Kewajiban</Link> · <Link href="/keuangan/buku-besar" className="inline-flex min-h-[var(--target)] items-center text-[var(--tint)]">Buku Besar</Link>. Tidak ada data pasien dalam ekspor.</p>
      <div className="grid min-w-0 gap-4 min-[1180px]:grid-cols-2">
        <section aria-labelledby="sub" className={card}>
          <h2 id="sub" className="m-0 text-[1.18rem] font-semibold">Sub-ledger & transaksi (CSV)</h2>
          <ul className="m-0 grid list-none gap-0 p-0">
            {ALL_KINDS.map((k) => <li key={k}><a href={subledgerHref(k, period)} download className={dl}>{exportLabel(k)}</a></li>)}
          </ul>
        </section>
        <div className="grid min-w-0 content-start gap-4">
          <section aria-labelledby="jurnal" className={card}>
            <h2 id="jurnal" className="m-0 text-[1.18rem] font-semibold">Jurnal (CSV)</h2>
            {gate.kind === "open" && <a href={journalHref(period)} download className={dl}>Ekspor Jurnal</a>}
            {gate.kind === "blocked" && <BlockedState reason={gate.reason} unblock={gate.unblock} />}
            {gate.kind === "unknown" && <p className={muted}>Status buku besar belum tersedia.</p>}
          </section>
          <section aria-labelledby="komisi" className={card}>
            <h2 id="komisi" className="m-0 text-[1.18rem] font-semibold">Komisi per penerima (CSV)</h2>
            {batches.length === 0 ? <p className={muted}>Belum ada batch komisi yang diajukan.</p> : (
              <ul className="m-0 grid list-none gap-1 p-0">
                {batches.map((b) => (
                  <li key={b.id} className="flex min-w-0 flex-wrap items-center gap-2">
                    <a href={batchHref(b.id)} download className={dl}>Batch {b.period}</a>
                    <StatusBadge tone={b.state === "paid" ? "success" : b.state === "approved" ? "neutral" : "warning"}>{b.state === "paid" ? "Dibayar" : b.state === "approved" ? "Disetujui" : "Menunggu persetujuan"}</StatusBadge>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </Main>
  );
}

export default function EksporKeuanganPage() {
  return <Suspense fallback={<Main><LoadingList rows={4} label="Memuat ekspor" /></Main>}><Body /></Suspense>;
}
