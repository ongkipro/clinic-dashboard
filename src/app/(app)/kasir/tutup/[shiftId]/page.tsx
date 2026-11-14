// One shift (UX-15; T-085): the expectation per tender (cash counted; EDC/transfer against slips and bank; QRIS/VA/link by Finance;
// balance not drawer money), the count form for the cashier or a branch manager while open or in recount, the counts with their
// approval state, the payments in the shift, the sales vs received of the shift (K23) and the branch's open tagihan.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DetailPage, ListPage } from "../../../../../components/templates/templates";
import { LoadingList, SuccessNotice } from "../../../../../components/ui/states";
import { loadShift } from "../data";
import { CountForm } from "../forms";
import { ROLE, rp, SHIFT_STATE, signed, TENDER, TENDER_NOTE, when } from "../labels";

export const metadata: Metadata = { title: "Shift Kasir — Clinic Dashboard" };
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
const card = "grid min-w-0 gap-1 rounded-[var(--radius-field)] bg-[var(--surface-2)] p-3";
const APPROVAL: Record<string, string> = { pending: "Menunggu persetujuan", approved: "Disetujui", rejected: "Ditolak", cancelled: "Dibatalkan" };

async function Body({ params, searchParams }: { params: Promise<{ shiftId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { shiftId } = await params;
  const sent = (await searchParams).dikirim === "1";
  const r = await loadShift(shiftId);
  if (r.kind === "redirect") redirect(r.to);
  if (r.kind === "forbidden") return <ListPage as="section" title="Shift Kasir" state={{ kind: "permission", object: "tutup kasir" }} />;
  if (r.kind !== "ok") return <ListPage as="section" title="Shift Kasir" state={{ kind: "empty", message: "Shift tidak ditemukan.", action: "Kembali ke Tutup Kasir", actionHref: "/kasir/tutup" }} />;
  const d = r.d;
  const s = d.shift;
  const cash = d.expected.find((e) => e.method === "cash");
  const last = d.counts[d.counts.length - 1];
  const waitingOwner = s.state === "pending_approval" && last?.escalated;
  return (
    <DetailPage as="section" title={`Shift ${s.cashier.name}`} subtitle={`${s.branch.name} · dibuka ${when(s.opened_at)}${s.closed_at ? ` · ditutup ${when(s.closed_at)}` : ""}`}
      status={{ tone: SHIFT_STATE[s.state].tone, label: SHIFT_STATE[s.state].label }}
      sections={[
        { id: "tender", label: "Ekspektasi per tender", content: (
          <div className="grid min-w-0 gap-2">
            {sent && <SuccessNotice message={s.state === "closed" ? "Hitungan dikirim. Kasir ditutup." : "Hitungan dikirim. Menunggu persetujuan."} />}
            <p className={muted}>{`Modal awal ${rp(s.opening_float)}${s.auto_opened ? " · kasir dibuka otomatis oleh pembayaran pertama" : ""}`}</p>
            <ul className="m-0 grid min-w-0 list-none grid-cols-[minmax(0,1fr)] gap-2 p-0 min-[700px]:grid-cols-2">
              {d.expected.map((e) => (
                <li key={e.method} className={card}>
                  <span className="font-semibold">{`${TENDER[e.method] ?? e.method} · ${rp(e.expected)}`}</span>
                  <span className={muted}>{e.method === "cash"
                    ? `${e.payments} pembayaran ${rp(e.received)}${e.paid_out ? ` · keluar ${rp(e.paid_out)}` : ""}${e.counted != null ? ` · dihitung ${rp(e.counted)}` : ""}`
                    : `${e.payments} pembayaran · ${TENDER_NOTE[e.method] ?? ""}`}</span>
                </li>
              ))}
            </ul>
          </div>
        ) },
        ...(d.can_count && cash ? [{ id: "hitung", label: s.state === "recount" ? "Hitung ulang" : "Tutup kasir", content: (
          <div className="grid min-w-0 gap-2">
            {s.state === "recount" && last?.approval?.state === "rejected" && (
              <p role="status" className="m-0 font-semibold [overflow-wrap:anywhere]">{`Hitungan ditolak${last.approval.decision_reason ? `: ${last.approval.decision_reason}` : ""}. Hitung ulang uang di laci.`}</p>
            )}
            <CountForm ctx={r.ctx} shift={s.id} expected={cash.expected} threshold={d.threshold} recount={s.state === "recount"} />
          </div>
        ) }] : []),
        ...(s.state === "pending_approval" ? [{ id: "persetujuan", label: "Persetujuan", content: (
          <div className="grid min-w-0 gap-1">
            <p className="m-0 [overflow-wrap:anywhere]">{waitingOwner ? "Menunggu persetujuan Owner." : "Menunggu persetujuan manajer."}</p>
            {waitingOwner && <p className={muted}>{`Selisih di atas ${rp(last.threshold)} — diteruskan ke Owner.`}</p>}
            {r.role === "manager" && !d.manager_decides && <p className={muted}>Di atas batas Anda — diteruskan ke Owner.</p>}
            {(r.role === "owner" || (r.role === "manager" && d.manager_decides)) && last?.approval && (
              <Link href={`/persetujuan/${last.approval.id}`} className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]">Buka di Persetujuan</Link>
            )}
          </div>
        ) }] : []),
        ...(d.counts.length ? [{ id: "riwayat", label: "Riwayat hitungan", content: (
          <ul className="m-0 grid min-w-0 list-none gap-2 p-0">
            {d.counts.map((c) => (
              <li key={c.id} className={card}>
                <span className="font-semibold tabular-nums">{`Hitungan ${c.seq} · ${rp(c.counted_cash)} · ${signed(c.variance)}`}</span>
                <span className={muted}>{`${c.counted_by} (${ROLE[c.counted_as] ?? c.counted_as}) · ${when(c.counted_at)}${c.reason ? ` · ${c.reason}` : ""}`}</span>
                {c.approval && (
                  <span className={muted}>{`${APPROVAL[c.approval.state]}${c.approval.decided_by ? ` oleh ${c.approval.decided_by} sebagai ${ROLE[c.approval.decided_as ?? ""] ?? c.approval.decided_as}` : ""}`}</span>
                )}
              </li>
            ))}
          </ul>
        ) }] : []),
        { id: "pembayaran", label: "Pembayaran di shift ini", content: d.payments.length === 0 ? <p className={muted}>Belum ada pembayaran.</p> : (
          <ul className="m-0 grid min-w-0 list-none gap-1 p-0">
            {d.payments.map((p) => (
              <li key={p.id} className="min-w-0 [overflow-wrap:anywhere]">
                <Link href={`/kasir/struk/${p.receipt_id}`} className="inline-flex min-h-[var(--target)] items-center text-[var(--tint)]">
                  {`${TENDER[p.method] ?? p.method} ${rp(p.amount)} · ${when(p.received_at)}${p.patient ? ` · ${p.patient.name ?? "Pasien"} ${p.patient.mrn}` : ""}${p.reference ? ` · ${p.reference}` : ""}`}
                </Link>
              </li>
            ))}
          </ul>
        ) },
        { id: "ringkasan", label: "Ringkasan shift", content: (
          <div className="grid min-w-0 gap-1">
            <p className="m-0 tabular-nums">{`Penjualan (tanpa PPN) ${rp(d.k23.sales)} · Uang diterima ${rp(d.k23.received)}`}</p>
            <p className={muted}>{`Tagihan terbuka di cabang: ${d.open_tagihan.count} (${rp(d.open_tagihan.total)})`}</p>
            {s.state === "closed" && <p className={muted}>Shift sudah ditutup. Pembayaran baru masuk ke shift berikutnya.</p>}
          </div>
        ) },
      ]}
      related={[{ label: "Semua shift", href: "/kasir/tutup" }, { label: "Tagihan terbuka", href: "/kasir/terbuka" }]} />
  );
}

export default function ShiftPage(props: { params: Promise<{ shiftId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4"><Suspense fallback={<LoadingList rows={4} />}><Body {...props} /></Suspense></main>;
}
