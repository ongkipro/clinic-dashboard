// Pemusnahan (19 §2.9 "Pemusnahan dengan saksi & persetujuan", UX-11 action, CD-21, SET-43; HYG-NAV-2). Pharmacist and owner. Lists the
// disposal candidates of one branch (unfit batches with stock: expired, recalled, quarantined, temperature excursion) and those expiring
// soon, with the SET-43 approval thresholds. Recording a disposal (witness, approval, waste movement) is not built on main (T-062 flagged
// gap): the step is shown blocked with who can unblock it, never as a working button.
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ListPage } from "../../../../components/templates/templates";
import { BlockedState, LoadingList } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { BranchChips, NotOkState } from "../frame";
import { UNFIT_LABEL } from "../labels";
import { loadPemusnahan } from "./data";
import { candidates, daysLabel, soon } from "./model";

export const metadata: Metadata = { title: "Pemusnahan — Stok — Clinic Dashboard" };
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
const rp = (n: number) => `Rp${new Intl.NumberFormat("id-ID").format(n)}`;
const qf = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const d = await loadPemusnahan(typeof q.cabang === "string" ? q.cabang : undefined);
  if (d.kind !== "ok") return <NotOkState d={d} title="Pemusnahan" />;
  const wide = d.role !== "pharmacist";
  const link = (item: string) => `/stok/item/${item}${wide ? `?cabang=${d.branch.id}` : ""}`;
  const cand = candidates(d.watch);
  const later = soon(d.watch);
  return (
    <ListPage as="section" title={`Pemusnahan · ${d.branch.name}`}
      state={cand.length === 0 && later.length === 0 ? { kind: "empty", message: "Tidak ada batch tidak layak atau hampir kedaluwarsa di cabang ini." } : { kind: "rows" }}>
      {wide && <BranchChips path="/stok/pemusnahan" branches={d.stock.branches} active={d.branch.id} />}
      <BlockedState reason="Pencatatan pemusnahan (saksi, persetujuan, pengurangan stok) belum tersedia" unblock="Tim pengembang menambahkannya pada tugas pemusnahan apotek" />
      {d.thresholds && (
        <section aria-labelledby="ambang" className="grid min-w-0 gap-1 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
          <h2 id="ambang" className="m-0 text-[1.05rem] font-semibold">Aturan persetujuan (Pengaturan › Uang & Kasir)</h2>
          <p className={muted}>Persetujuan kedua mulai {rp(d.thresholds.musnah_kedua_kejadian)} per kejadian atau {rp(d.thresholds.musnah_kedua_bulan)} per bulan; Owner mulai {rp(d.thresholds.musnah_owner)}. Pengaju tidak pernah menyetujui permintaannya sendiri.</p>
        </section>
      )}
      {cand.length > 0 && (
        <section aria-labelledby="calon" className="grid min-w-0 gap-2">
          <h2 id="calon" className="m-0 text-[1.18rem] font-semibold">Calon pemusnahan ({cand.length})</h2>
          <ul className="m-0 grid min-w-0 list-none gap-2 p-0">
            {cand.map((b) => (
              <li key={b.id} data-batch={b.id} className="grid min-w-0 gap-1 rounded-[var(--radius-field)] bg-[var(--surface)] p-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Link href={link(b.item_id)} className="inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--label)] [overflow-wrap:anywhere]">{b.name}</Link>
                  <StatusBadge tone="danger">{UNFIT_LABEL[b.unfit ?? ""] ?? "Tidak layak"}</StatusBadge>
                </div>
                <span className={muted}>Batch {b.batch_no} · ED {b.expiry} ({daysLabel(b)}) · sisa {qf.format(b.quantity)} {b.unit}{b.hold_reason ? ` · ${b.hold_reason}` : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {later.length > 0 && (
        <section aria-labelledby="segera" className="grid min-w-0 gap-2">
          <h2 id="segera" className="m-0 text-[1.18rem] font-semibold">Segera kedaluwarsa ({later.length})</h2>
          <ul className="m-0 grid min-w-0 list-none gap-2 p-0">
            {later.map((b) => (
              <li key={b.id} className="grid min-w-0 gap-1 rounded-[var(--radius-field)] bg-[var(--surface)] p-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2"><Link href={link(b.item_id)} className="inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--label)] [overflow-wrap:anywhere]">{b.name}</Link>
                  <StatusBadge tone="warning">{daysLabel(b)}</StatusBadge></div>
                <span className={muted}>Batch {b.batch_no} · ED {b.expiry} · sisa {qf.format(b.quantity)} {b.unit}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </ListPage>
  );
}

export default function PemusnahanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} label="Memuat calon pemusnahan" />}><Body searchParams={searchParams} /></Suspense>
    </main>
  );
}
