// Pembelian ▸ PO (UX-52, 19:143): purchase orders at a branch by state; Buat PO (draft) for purchasing, admin pusat,
// owner and manager; each → its detail (send, cancel, receive). Totals for cost readers only.
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ListPage } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { loadPos } from "../data";
import { PoForm } from "../forms";
import { BranchChips, Main, NotOkState, branchQ, wideRole } from "../frame";
import { canSee, date, PO_STATE, rp, SEGMENTS } from "../labels";

export const metadata: Metadata = { title: "Purchase Order — Pembelian — Clinic Dashboard" };

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const d = await loadPos(typeof q.cabang === "string" ? q.cabang : undefined);
  if (d.kind !== "ok") return <NotOkState d={d} title="Purchase Order" />;
  if (!canSee(d.p.role, "po")) return <NotOkState d={{ kind: "forbidden" }} title="Purchase Order" />;
  const open = d.pos.filter((p) => ["draft", "sent", "partially_received"].includes(p.state));
  const rest = d.pos.filter((p) => !open.includes(p));
  const row = (p: (typeof d.pos)[number]) => (
    <li key={p.id} className="min-w-0 rounded-[var(--radius-field)] bg-[var(--surface)]">
      <Link href={`/pembelian/po/${p.id}`} className="grid min-h-[52px] min-w-0 gap-1 p-4 text-[var(--label)] no-underline">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-semibold">{p.number}</span>
          <StatusBadge tone={PO_STATE[p.state].tone}>{PO_STATE[p.state].label}</StatusBadge>
        </span>
        <span className="text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]">
          {[p.supplier_name, `dibuat ${date(p.created_at)}`, p.expected_date && `tiba ${date(p.expected_date)}`, p.total != null && rp(p.total)].filter(Boolean).join(" · ")}
        </span>
      </Link>
    </li>
  );
  return (
    <>
      <ListPage as="section" title={`Purchase Order · ${d.branch.name}`} filters={SEGMENTS(d.p.role, "po", branchQ(d.p.role, d.branch.id))}
        state={d.pos.length === 0 ? { kind: "empty", message: d.p.can_po ? "Belum ada PO. Buat PO untuk memesan ke pemasok." : "Belum ada PO di cabang ini." } : { kind: "rows" }}>
        <div className="grid min-w-0 gap-4">
          {open.length > 0 && <section aria-label="PO berjalan" className="grid min-w-0 gap-2"><h2 className="m-0 text-[1.25rem] font-semibold">Berjalan</h2>
            <ul className="m-0 grid min-w-0 list-none gap-2 p-0">{open.map(row)}</ul></section>}
          {rest.length > 0 && <section aria-label="PO selesai" className="grid min-w-0 gap-2"><h2 className="m-0 text-[1.25rem] font-semibold">Selesai</h2>
            <ul className="m-0 grid min-w-0 list-none gap-2 p-0">{rest.slice(0, 30).map(row)}</ul></section>}
        </div>
      </ListPage>
      {d.p.can_po && <PoForm ctx={d.ctx} branch={wideRole(d.p.role) ? d.branch.id : null} suppliers={d.p.suppliers.filter((s) => s.active)} items={d.p.items} money={d.p.money} />}
      <BranchChips path="/pembelian/po" branches={d.p.branches} active={d.branch.id} />
    </>
  );
}

export default function PoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Main><Suspense fallback={<LoadingList rows={4} />}><Body searchParams={searchParams} /></Suspense></Main>;
}
