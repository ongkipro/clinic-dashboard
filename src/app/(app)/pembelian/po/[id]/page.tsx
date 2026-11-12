// PO detail: lines (ordered, received; price for cost readers), send / cancel, Terima Barang against the open lines
// (batch, expiry, quantity; the unit cost is the PO's), the receipts.
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageTitle } from "../../../../../components/templates/templates";
import { BlockedState, LoadingList } from "../../../../../components/ui/states";
import { StatusBadge } from "../../../../../components/ui/status-badge";
import { loadPo } from "../../data";
import { PoActions, ReceiveForm } from "../../forms";
import { card, Main, muted, NotOkState, wideRole } from "../../frame";
import { canSee, date, PO_STATE, qty, rp } from "../../labels";

export const metadata: Metadata = { title: "Purchase Order — Pembelian — Clinic Dashboard" };

async function Body({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await loadPo(id);
  if (d.kind !== "ok") return <NotOkState d={d} title="Purchase Order" />;
  if (!canSee(d.p.role, "po")) return <NotOkState d={{ kind: "forbidden" }} title="Purchase Order" />;
  const po = d.po;
  const receivable = ["sent", "partially_received"].includes(po.state);
  const open = po.lines.filter((l) => l.active && Number(l.received) < Number(l.ordered));
  return (
    <>
      <PageTitle title={po.number} />
      <p className="m-0 flex min-w-0 flex-wrap items-center gap-2">
        <StatusBadge tone={PO_STATE[po.state].tone}>{PO_STATE[po.state].label}</StatusBadge>
        <span className={muted}>{[po.supplier_name, `dibuat ${date(po.created_at)}`, po.expected_date && `tiba ${date(po.expected_date)}`, po.total != null && `total ${rp(po.total)}`].filter(Boolean).join(" · ")}</span>
      </p>
      {po.state === "cancelled" && <BlockedState reason={`PO dibatalkan: ${po.cancel_reason}`} unblock="Buat PO baru bila masih perlu" />}
      <section aria-label="Item PO" className={card}>
        <h2 className="m-0 text-[1.25rem] font-semibold">Item</h2>
        <ul className="m-0 grid gap-1 pl-5">
          {po.lines.filter((l) => l.active).map((l) => (
            <li key={l.id} className="[overflow-wrap:anywhere]">{`${l.name}: dipesan ${qty(l.ordered)} ${l.unit}, diterima ${qty(l.received)}${l.unit_price != null ? ` · ${rp(l.unit_price)}/${l.unit}` : ""}`}</li>
          ))}
        </ul>
      </section>
      {d.p.can_po && ["draft", "sent"].includes(po.state) && <PoActions ctx={d.ctx} po={po.id} state={po.state} />}
      {d.p.can_receive && receivable && open.length > 0 && (
        <ReceiveForm ctx={d.ctx} branch={wideRole(d.p.role) ? po.branch_id : null} supplier={po.supplier_id} po={po.id}
          lines={open.map((l) => ({ item_id: l.item_id, name: l.name, unit: l.unit, open: Number(l.ordered) - Number(l.received) }))} />
      )}
      {po.receipts.length > 0 && (
        <section aria-label="Penerimaan PO" className={card}>
          <h2 className="m-0 text-[1.25rem] font-semibold">Penerimaan</h2>
          <ul className="m-0 grid gap-1 pl-5">
            {po.receipts.flatMap((r) => r.lines.map((l) => (
              <li key={l.receipt_id} className="[overflow-wrap:anywhere]">{`${date(r.received_at)} · ${l.item} · batch ${l.batch_no} (kedaluwarsa ${date(l.expiry)}) · ${qty(l.quantity)} ${l.unit}`}</li>
            )))}
          </ul>
        </section>
      )}
      <Link href="/pembelian/po" className="inline-flex min-h-[52px] items-center font-semibold text-[var(--tint)]">Kembali ke PO</Link>
    </>
  );
}

export default function PoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <Main><Suspense fallback={<LoadingList rows={4} />}><Body params={params} /></Suspense></Main>;
}
