// Pembelian ▸ Retur (UX-52, 19:145): the returns to suppliers at a branch (reason, batch, credit note state for cost
// readers); Retur ke Pemasok over the batches each supplier delivered (T-066 writer).
import type { Metadata } from "next";
import { Suspense } from "react";
import { ListPage } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { loadReturns } from "../data";
import { ReturnForm } from "../forms";
import { BranchChips, Main, NotOkState, branchQ, wideRole } from "../frame";
import { canSee, date, qty, RETURN_REASON, rp, SEGMENTS } from "../labels";

export const metadata: Metadata = { title: "Retur — Pembelian — Clinic Dashboard" };
const EXP: Record<string, string> = { expected: "Nota kredit ditunggu", received: "Nota kredit diterima", written_off: "Dihapusbukukan" };

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const d = await loadReturns(typeof q.cabang === "string" ? q.cabang : undefined);
  if (d.kind !== "ok") return <NotOkState d={d} title="Retur" />;
  if (!canSee(d.p.role, "retur")) return <NotOkState d={{ kind: "forbidden" }} title="Retur" />;
  return (
    <>
      <ListPage as="section" title={`Retur · ${d.branch.name}`} filters={SEGMENTS(d.p.role, "retur", branchQ(d.p.role, d.branch.id))}
        state={d.returns.length === 0 ? { kind: "empty", message: "Belum ada retur ke pemasok di cabang ini." } : { kind: "rows" }}>
        <ul aria-label="Daftar retur" className="m-0 grid min-w-0 list-none gap-2 p-0">
          {d.returns.map((r) => (
            <li key={r.id} className="grid min-w-0 gap-1 rounded-[var(--radius-field)] bg-[var(--surface)] p-4">
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="font-semibold [overflow-wrap:anywhere]">{`${r.item} · ${qty(r.quantity)} ${r.unit}`}</span>
                <StatusBadge tone="neutral">{RETURN_REASON[r.reason]}</StatusBadge>
                {r.expectation && <StatusBadge tone={r.expectation.state === "expected" ? "warning" : "success"}>{EXP[r.expectation.state]}</StatusBadge>}
              </span>
              <span className="text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]">
                {[r.supplier_name, `batch ${r.batch_no}`, date(r.returned_at), r.note, r.value != null && rp(r.value)].filter(Boolean).join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      </ListPage>
      {d.p.can_return && (
        <ReturnForm ctx={d.ctx} branch={wideRole(d.p.role) ? d.branch.id : null} suppliers={d.p.suppliers.filter((s) => s.active)}
          batches={d.returnable.map((b) => ({ supplier_id: b.supplier_id, batch_id: b.batch_id, label: `${b.item} · ${b.batch_no}`, open: Number(b.open) }))} />
      )}
      <BranchChips path="/pembelian/retur" branches={d.p.branches} active={d.branch.id} />
    </>
  );
}

export default function ReturPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Main><Suspense fallback={<LoadingList rows={4} />}><Body searchParams={searchParams} /></Suspense></Main>;
}
