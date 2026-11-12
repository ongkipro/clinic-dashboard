// Pembelian ▸ Transfer (UX-52, 19:144; r1 P1-1): inter-branch transfers to and from the branch (T-061's writers):
// send fit sealed stock from a depot to another branch; the receiving branch receives into a depot; the sender may
// cancel while in transit. Pharmacist and purchasing write; stock readers read.
import type { Metadata } from "next";
import { Suspense } from "react";
import { ListPage } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { loadTransfers } from "../data";
import { TransferActions, TransferForm } from "../forms";
import { BranchChips, Main, NotOkState, branchQ } from "../frame";
import { canSee, date, qty, SEGMENTS, TRANSFER_STATE } from "../labels";

export const metadata: Metadata = { title: "Transfer Antar Cabang — Pembelian — Clinic Dashboard" };

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const d = await loadTransfers(typeof q.cabang === "string" ? q.cabang : undefined);
  if (d.kind !== "ok") return <NotOkState d={d} title="Transfer" />;
  if (!canSee(d.p.role, "transfer")) return <NotOkState d={{ kind: "forbidden" }} title="Transfer" />;
  const inter = d.transfers.filter((t) => t.kind === "inter");
  const sendable = d.p.can_transfer && (d.p.role === "purchasing" || d.p.role === "pharmacist");
  return (
    <>
      <ListPage as="section" title={`Transfer · ${d.branch.name}`} filters={SEGMENTS(d.p.role, "transfer", branchQ(d.p.role, d.branch.id))}
        state={inter.length === 0 ? { kind: "empty", message: "Belum ada transfer antar cabang untuk cabang ini." } : { kind: "rows" }}>
        <ul aria-label="Daftar transfer" className="m-0 grid min-w-0 list-none gap-2 p-0">
          {inter.map((t) => {
            const incoming = t.to_branch_id === d.branch.id;
            return (
              <li key={t.id} className="grid min-w-0 gap-2 rounded-[var(--radius-field)] bg-[var(--surface)] p-4">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-semibold [overflow-wrap:anywhere]">{incoming ? `Dari ${t.from_branch}` : `Ke ${t.to_branch}`}</span>
                  <StatusBadge tone={TRANSFER_STATE[t.state]?.tone ?? "neutral"}>{TRANSFER_STATE[t.state]?.label ?? t.state}</StatusBadge>
                </span>
                <span className="text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]">{[date(t.created_at), t.from_depot, t.to_depot].filter(Boolean).join(" · ")}</span>
                <ul className="m-0 grid gap-1 pl-5">
                  {t.lines.map((l) => <li key={l.id} className="[overflow-wrap:anywhere]">{`${l.name} · batch ${l.batch_no} · ${qty(l.quantity)} ${l.unit}`}</li>)}
                </ul>
                {sendable && t.state === "sent" && (
                  <TransferActions ctx={d.ctx} transfer={t.id} canReceive={incoming} canCancel={!incoming}
                    depots={incoming ? d.depots.filter((x) => x.kind !== "ruang").map((x) => ({ id: x.id, name: x.name })) : []} />
                )}
              </li>
            );
          })}
        </ul>
      </ListPage>
      {sendable && d.holdings.length > 0 && (
        <TransferForm ctx={d.ctx} depots={d.depots.filter((x) => x.kind !== "ruang").map((x) => ({ id: x.id, name: x.name }))}
          branches={d.p.branches.filter((b) => b.id !== d.branch.id)}
          batches={d.holdings.map((h) => ({ depot_id: h.depot_id, batch_id: h.batch_id, label: `${h.name} · ${h.batch_no} · ${qty(h.quantity)} ${h.unit}` }))} />
      )}
      <BranchChips path="/pembelian/transfer" branches={d.p.branches} active={d.branch.id} />
    </>
  );
}

export default function TransferPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Main><Suspense fallback={<LoadingList rows={4} />}><Body searchParams={searchParams} /></Suspense></Main>;
}
