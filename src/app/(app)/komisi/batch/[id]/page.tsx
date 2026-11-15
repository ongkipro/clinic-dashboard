// One commission batch (UX-16): per-recipient lines with contribution types, gross, adjustments, carry-forward in/out and net payable;
// Ajukan Persetujuan (finance, after the closing day), Setujui Batch in Persetujuan (owner, not the requester), Tandai Dibayar (finance),
// Ekspor per penerima (CSV, once submitted). No patient data.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DetailPage, ListPage } from "../../../../../components/templates/templates";
import { SuccessNotice } from "../../../../../components/ui/states";
import { loadBatch } from "../../data";
import { MarkPaidForm, SubmitBatchForm } from "../../forms";
import { BATCH, day, month, rp, TYPE } from "../../labels";

export const metadata: Metadata = { title: "Batch Komisi — Clinic Dashboard" };
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";

export default async function BatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const d = await loadBatch(id);
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") return <ListPage title="Batch Komisi" state={{ kind: "permission", object: "batch komisi" }} />;
  if (d.kind !== "ok") notFound();
  const { batch: b, lines } = d.d;
  const total = lines.reduce((s, l) => s + Number(l.net_payable), 0);
  const carry = lines.reduce((s, l) => s + Number(l.carry_forward_out), 0);
  const recipients = lines.length === 0 ? (
    <p className={muted}>{b.state === "draft" ? "Penerima dan nilainya dihitung saat batch diajukan." : "Tidak ada komisi di batch ini."}</p>
  ) : (
    <ul className="m-0 grid min-w-0 list-none gap-0 p-0">
      {lines.map((l) => (
        <li key={l.staff_id} className="grid min-w-0 gap-1 border-b border-[var(--separator)] py-3 first:pt-0 last:border-b-0 last:pb-0 [border-bottom-width:0.5px]">
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
            <p className="m-0 min-w-0 font-semibold [overflow-wrap:anywhere]">{l.staff}</p>
            <p className="m-0 font-semibold tabular-nums">{rp(Number(l.net_payable))}</p>
          </div>
          <p className={muted}>{l.types.map((t) => TYPE[t]).join(", ") || "Bawaan dari bulan sebelumnya"}</p>
          <p className={`${muted} tabular-nums`}>
            {[`Komisi ${rp(Number(l.gross))}`, Number(l.adjustments) !== 0 && `Penyesuaian ${rp(Number(l.adjustments))}`,
              Number(l.carry_forward_in) > 0 && `Bawaan masuk −${rp(Number(l.carry_forward_in))}`,
              Number(l.carry_forward_out) > 0 && `Dibawa ke bulan berikutnya ${rp(Number(l.carry_forward_out))}`].filter(Boolean).join(" · ")}
          </p>
        </li>
      ))}
    </ul>
  );
  const actions = (
    <div className="grid min-w-0 gap-3">
      {sp.diajukan === "1" && b.state !== "draft" && <SuccessNotice message="Batch diajukan. Owner menyetujuinya di Persetujuan." />}
      {sp.dibayar === "1" && b.state === "paid" && <SuccessNotice message="Batch ditandai dibayar." />}
      {d.d.can_submit && <SubmitBatchForm ctx={d.ctx} batch={b.id} />}
      {b.state === "draft" && b.open_period && <p className={muted}>Bulan ini belum selesai. Batch dapat diajukan setelah tanggal tutup.</p>}
      {b.state === "pending_approval" && (d.d.can_approve
        ? b.submitted_by_me
          ? <p className={muted}>Anda yang mengajukan batch ini; persetujuan oleh orang lain.</p>
          : <Link href="/persetujuan" className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]">Setujui di Persetujuan</Link>
        : <p className={muted}>Menunggu persetujuan Owner.</p>)}
      {d.d.can_pay && <MarkPaidForm ctx={d.ctx} batch={b.id} total={total} />}
      {b.state === "paid" && b.paid_at && <p className={muted}>{`Dibayar ${day(b.paid_at)} · ${b.paid_method === "cash" ? "Tunai" : "Transfer"}`}</p>}
      {b.state !== "draft" && (
        <a href={`/komisi/batch/${b.id}/ekspor`} className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]">Ekspor per penerima (CSV)</a>
      )}
      {d.d.role === "auditor" && <p className={muted}>Mode baca.</p>}
    </div>
  );
  return (
    <DetailPage
      title={`Batch ${month(b.period)}`}
      subtitle={`${day(b.period_start)} – ${day(new Date(new Date(b.period_end).getTime() - 1).toISOString())} · ${lines.length} penerima · ${rp(total)}${carry > 0 ? ` · dibawa ${rp(carry)}` : ""}`}
      status={{ tone: BATCH[b.state][1], label: BATCH[b.state][0] }}
      sections={[{ id: "penerima", label: "Penerima", content: recipients }, { id: "aksi", label: "Tindakan", content: actions }]}
      related={[{ label: "Rekap Komisi & Batch", href: "/komisi" }, { label: "Aturan Komisi", href: "/komisi/aturan" }]}
    />
  );
}
