// Pembelian ▸ Penerimaan (UX-52, 19:143): the goods receipts at a branch; Terima Barang without a PO (cash purchase) for
// pharmacist and purchasing. GRNI and unit cost for cost readers only.
import type { Metadata } from "next";
import { Suspense } from "react";
import { ListPage } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { loadReceipts } from "../data";
import { ReceiveForm } from "../forms";
import { BranchChips, Main, NotOkState, branchQ, wideRole } from "../frame";
import { canSee, date, qty, rp, SEGMENTS } from "../labels";

export const metadata: Metadata = { title: "Penerimaan — Pembelian — Clinic Dashboard" };

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const d = await loadReceipts(typeof q.cabang === "string" ? q.cabang : undefined);
  if (d.kind !== "ok") return <NotOkState d={d} title="Penerimaan" />;
  if (!canSee(d.p.role, "penerimaan")) return <NotOkState d={{ kind: "forbidden" }} title="Penerimaan" />;
  return (
    <>
      <ListPage as="section" title={`Penerimaan · ${d.branch.name}`} filters={SEGMENTS(d.p.role, "penerimaan", branchQ(d.p.role, d.branch.id))}
        state={d.receipts.length === 0 ? { kind: "empty", message: "Belum ada penerimaan barang di cabang ini." } : { kind: "rows" }}>
        <ul aria-label="Daftar penerimaan" className="m-0 grid min-w-0 list-none gap-2 p-0">
          {d.receipts.map((r) => (
            <li key={r.id} className="grid min-w-0 gap-1 rounded-[var(--radius-field)] bg-[var(--surface)] p-4">
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="font-semibold [overflow-wrap:anywhere]">{r.supplier_name}</span>
                <StatusBadge tone="neutral">{r.po_number ?? "Tanpa PO"}</StatusBadge>
              </span>
              <span className="text-[0.88rem] text-[var(--label-2)]">{[date(r.received_at), r.delivery_note && `surat jalan ${r.delivery_note}`].filter(Boolean).join(" · ")}</span>
              <ul className="m-0 grid gap-1 pl-5">
                {r.lines.map((l) => (
                  <li key={l.receipt_id} className="[overflow-wrap:anywhere]">{`${l.item} · batch ${l.batch_no} · ${qty(l.quantity)} ${l.unit}${l.grni != null ? ` · ${rp(l.grni)}` : ""}${l.invoiced ? " · sudah difakturkan" : ""}`}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </ListPage>
      {d.p.can_receive && <ReceiveForm ctx={d.ctx} branch={wideRole(d.p.role) ? d.branch.id : null} suppliers={d.p.suppliers.filter((s) => s.active)} items={d.p.items} />}
      <BranchChips path="/pembelian/penerimaan" branches={d.p.branches} active={d.branch.id} />
    </>
  );
}

export default function PenerimaanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Main><Suspense fallback={<LoadingList rows={4} />}><Body searchParams={searchParams} /></Suspense></Main>;
}
