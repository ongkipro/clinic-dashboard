// Pembelian ▸ Pemasok (UX-52, 19:141): the supplier master with contact and payment terms; purchasing, admin pusat and
// owner add or edit (T-066 writers). Detail per supplier with its receipts and returns.
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ListPage } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { loadSuppliers } from "../data";
import { SupplierForm } from "../forms";
import { BranchChips, Main, NotOkState, branchQ } from "../frame";
import { canSee, SEGMENTS } from "../labels";

export const metadata: Metadata = { title: "Pemasok — Pembelian — Clinic Dashboard" };

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const d = await loadSuppliers(typeof q.cabang === "string" ? q.cabang : undefined);
  if (d.kind !== "ok") return <NotOkState d={d} title="Pemasok" />;
  if (!canSee(d.p.role, "pemasok")) return <NotOkState d={{ kind: "forbidden" }} title="Pemasok" />;
  return (
    <>
      <ListPage as="section" title="Pemasok" filters={SEGMENTS(d.p.role, "pemasok", branchQ(d.p.role, d.branch.id))}
        state={d.suppliers.length === 0 ? { kind: "empty", message: "Belum ada pemasok." } : { kind: "rows" }}>
        <ul aria-label="Daftar pemasok" className="m-0 grid min-w-0 list-none gap-2 p-0">
          {d.suppliers.map((s) => (
            <li key={s.id} className="min-w-0 rounded-[var(--radius-field)] bg-[var(--surface)]">
              <Link href={`/pembelian/pemasok/${s.id}`} className="grid min-h-[52px] min-w-0 gap-1 p-4 text-[var(--label)] no-underline">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-semibold [overflow-wrap:anywhere]">{s.name}</span>
                  {!s.active && <StatusBadge tone="locked">Nonaktif</StatusBadge>}
                </span>
                <span className="text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]">
                  {[`Syarat bayar ${s.payment_terms_days} hari`, s.contact_name, s.phone].filter(Boolean).join(" · ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </ListPage>
      {d.p.can_supplier && <SupplierForm ctx={d.ctx} />}
      <BranchChips path="/pembelian/pemasok" branches={d.p.branches} active={d.branch.id} />
    </>
  );
}

export default function PemasokPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Main><Suspense fallback={<LoadingList rows={4} />}><Body searchParams={searchParams} /></Suspense></Main>;
}
