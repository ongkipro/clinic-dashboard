// Stok ▸ Kartu (UX-11, 19 §2.9 Kartu Stok): the movements of one item at a branch, newest first, with the balance
// after each. Purchasing and auditor see patient-linked movements without reason or source (IAM-12).
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ListPage } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { loadCard } from "../data";
import { BranchChips, NotOkState, segments } from "../frame";
import { date, MOVE_LABEL, qty, REASON_LABEL, ROLE_LABEL, when } from "../labels";

export const metadata: Metadata = { title: "Kartu Stok — Clinic Dashboard" };

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const d = await loadCard(typeof q.item === "string" ? q.item : undefined, typeof q.cabang === "string" ? q.cabang : undefined);
  if (d.kind !== "ok") return <NotOkState d={d} title="Kartu Stok" />;
  const wide = !["manager", "pharmacist"].includes(d.stock.role);
  const p = d.pick;
  return (
    <>
      <ListPage as="section" title={`Kartu Stok · ${d.branch.name}`} filters={segments("kartu", d.branch.id, wide)}
        state={d.items.length === 0 ? { kind: "empty", message: "Belum ada item di Master Item." } : !p || d.rows.length === 0 ? { kind: "empty", message: "Belum ada mutasi untuk item ini di cabang ini." } : { kind: "rows" }}>
        <div className="grid min-w-0 gap-3">
          {p && (
            <div className="grid min-w-0 gap-1">
              <h2 className="m-0 text-[1.18rem] font-semibold [overflow-wrap:anywhere]">{p.name}</h2>
              <p className="m-0 tabular-nums text-[var(--label-2)]">{`Total ${qty(p.quantity, p.unit)} · layak ${qty(p.fit_quantity, p.unit)}`}</p>
            </div>
          )}
          <ul aria-label="Mutasi" className="m-0 grid min-w-0 list-none gap-2 p-0">
            {d.rows.map((m) => (
              <li key={m.id} className="grid min-w-0 gap-1 rounded-[var(--radius-field)] bg-[var(--surface)] p-4">
                <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
                  <strong>{MOVE_LABEL[m.kind] ?? m.kind}</strong>
                  <span className="tabular-nums">{`${m.quantity > 0 ? "+" : ""}${qty(m.quantity, p?.unit)} → ${qty(m.balance_after)}`}</span>
                </div>
                <span className="text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]">
                  {`Batch ${m.batch_no} · ED ${date(m.expiry)} · ${when(m.created_at)} · ${m.created_by_name ?? "—"} (${ROLE_LABEL[m.created_as] ?? m.created_as})${m.reason ? ` · ${REASON_LABEL[m.reason] ?? m.reason}` : ""}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </ListPage>
      {d.items.length > 1 && (
        <nav aria-label="Pilih item" className="flex min-w-0 flex-wrap gap-2">
          {d.items.map((i) => (
            <Link key={i.id} href={`/stok/kartu?item=${i.id}${wide ? `&cabang=${d.branch.id}` : ""}`} aria-current={p?.id === i.id ? "true" : undefined}
              className={`inline-flex min-h-[var(--target)] items-center rounded-full px-4 text-[0.94rem] no-underline [overflow-wrap:anywhere] ${p?.id === i.id ? "bg-[var(--surface)] font-semibold text-[var(--label)]" : "text-[var(--tint)]"}`}>{i.name}</Link>
          ))}
        </nav>
      )}
      {wide && <BranchChips path="/stok/kartu" branches={d.stock.branches} active={d.branch.id} extra={p ? `&item=${p.id}` : ""} />}
    </>
  );
}

export default function KartuPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={5} />}><Body searchParams={searchParams} /></Suspense>
    </main>
  );
}
