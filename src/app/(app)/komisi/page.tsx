// Rekap Komisi & Batch (UX-16, 17:214-217, PR-23; T-087): month batches by state with their recipients and net payable; the commission
// accrued and not yet in a batch; staff receivables of members who left (B-21). Buka Batch and Tandai Dibayar (finance); Setujui Batch
// in Persetujuan (owner; never the requester). Readers: owner, finance, auditor (DEC-099). No patient data.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage, Row, RowList } from "../../../components/templates/templates";
import { LoadingList, SuccessNotice } from "../../../components/ui/states";
import { StatusBadge } from "../../../components/ui/status-badge";
import { lastMonth, loadBatches } from "./data";
import { OpenBatchForm, ReceivableForm } from "./forms";
import { BATCH, month, RECEIVABLE, rp } from "./labels";

export const metadata: Metadata = { title: "Rekap Komisi & Batch — Clinic Dashboard" };
const TITLE = "Rekap Komisi & Batch";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
const panel = "grid gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4";

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const d = await loadBatches();
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "rekap komisi" }} />;
  if (d.kind !== "ok") return <ListPage as="section" title={TITLE} state={{ kind: "error", message: "Rekap komisi belum bisa dimuat.", retryHref: "/komisi" }} />;
  const l = d.d;
  const state = typeof sp.status === "string" && sp.status in BATCH ? sp.status : null;
  const rows = state ? l.batches.filter((b) => b.state === state) : l.batches;
  const chips = [{ label: "Semua", href: "/komisi", active: !state }, ...Object.entries(BATCH).map(([k, [label]]) => ({ label, href: `/komisi?status=${k}`, active: state === k }))];
  const open = l.receivables.filter((r) => r.state === "open");
  return (
    <ListPage as="section" title={TITLE} filters={chips} state={{ kind: "rows" }}>
      <section aria-label="Komisi belum masuk batch" className="grid min-w-0 gap-1 rounded-[var(--radius-field)] bg-[var(--surface)] p-4">
        <p className="m-0 text-[0.94rem] text-[var(--label-2)]">Komisi berjalan, belum masuk batch</p>
        <p className="m-0 text-[1.5rem] font-semibold tabular-nums">{rp(l.unbatched.gross + l.unbatched.adjustments)}</p>
        <p className={`${muted} tabular-nums`}>{`Komisi ${rp(l.unbatched.gross)} · Penyesuaian ${rp(l.unbatched.adjustments)}`}</p>
        <p className={muted}>Komisi tercatat saat pembayaran diterima dan tindakan selesai dihitung; refund, hapus buku dan paket yang ditutup menjadi penyesuaian.</p>
      </section>
      {sp.piutang === "lunas" && <SuccessNotice message="Piutang staf ditandai lunas." />}
      {sp.piutang === "dihapuskan" && <SuccessNotice message="Piutang staf dihapuskan." />}
      {l.can_open && <div className="flex min-w-0 flex-wrap items-start gap-2"><OpenBatchForm ctx={d.ctx} period={lastMonth()} max={lastMonth()} /></div>}
      {l.role === "auditor" && <p className={muted}>Mode baca: auditor melihat batch tanpa mengubahnya.</p>}
      {l.role === "owner" && l.batches.some((b) => b.state === "pending_approval") && (
        <Link href="/persetujuan" className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]">Setujui batch di Persetujuan</Link>
      )}
      {rows.length > 0 ? (
        <RowList label="Batch komisi">
          {rows.map((b) => (
            <Row key={b.id} href={`/komisi/batch/${b.id}`} title={`${month(b.period)} · ${rp(Number(b.net_payable))}`}
              subtitle={[`${b.recipients} penerima`, b.closing_day === "month_end" ? "Tutup akhir bulan" : `Tutup tanggal ${b.closing_day}`,
                b.open_period && "Bulan belum selesai", b.submitted_by && `Diajukan ${b.submitted_by}`].filter(Boolean).join(" · ")}>
              <StatusBadge tone={BATCH[b.state][1]}>{BATCH[b.state][0]}</StatusBadge>
            </Row>
          ))}
        </RowList>
      ) : state ? (
        <div className={panel} role="status">
          <p className="m-0 text-[var(--label-2)]">Tidak ada batch dengan status ini.</p>
          <Link href="/komisi" className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]">Hapus Filter</Link>
        </div>
      ) : (
        <div className={panel} role="status">
          <p className="m-0 text-[var(--label-2)]">Belum ada batch komisi.</p>
          {l.can_open && <p className={muted}>Buka batch bulan lalu setelah tanggal tutupnya lewat.</p>}
        </div>
      )}
      {l.receivables.length > 0 && (
        <section aria-labelledby="piutang-staf" className="grid min-w-0 gap-2">
          <h2 id="piutang-staf" className="m-0 text-[1.18rem] font-semibold">Piutang Staf</h2>
          <p className={muted}>Sisa potongan komisi staf yang sudah keluar. Owner memutuskan lunas atau dihapuskan.</p>
          <ul className="m-0 grid min-w-0 list-none gap-3 p-0">
            {l.receivables.map((r) => (
              <li key={r.id} className={panel}>
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <p className="m-0 min-w-0 font-semibold [overflow-wrap:anywhere]">{`${r.staff} · ${rp(Number(r.amount))}`}</p>
                  <StatusBadge tone={RECEIVABLE[r.state][1]}>{RECEIVABLE[r.state][0]}</StatusBadge>
                </div>
                {r.decision_reason && <p className={muted}>{r.decision_reason}</p>}
                {l.role === "owner" && r.state === "open" && <ReceivableForm ctx={d.ctx} id={r.id} staff={r.staff} amount={Number(r.amount)} />}
              </li>
            ))}
          </ul>
          {open.length > 0 && l.role !== "owner" && <p className={muted}>Menunggu keputusan Owner.</p>}
        </section>
      )}
      <Link href="/komisi/aturan" className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]">Buka Aturan Komisi</Link>
    </ListPage>
  );
}

export default function KomisiPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
