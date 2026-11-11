// Stok ▸ Hitungan (17:294–296): per batch the counted quantity; a blind count hides the system quantity until
// submitted. Ajukan Hitungan applies within the SET-43 threshold or waits in Persetujuan (PR-44).
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DetailPage } from "../../../../../components/templates/templates";
import { LoadingList } from "../../../../../components/ui/states";
import { StatusBadge } from "../../../../../components/ui/status-badge";
import { loadCount } from "../../data";
import { NotOkState } from "../../frame";
import { CancelCountForm, CountLineForm, SubmitCountForm } from "../../forms";
import { COUNT_STATE, date, qty, when } from "../../labels";

export const metadata: Metadata = { title: "Hitungan — Stok — Clinic Dashboard" };

async function Body({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await loadCount(id);
  if (d.kind !== "ok") return <NotOkState d={d} title="Hitungan" />;
  const c = d.count;
  const st = COUNT_STATE[c.state];
  return (
    <DetailPage as="section" title={`Hitung ${when(c.started_at)}`} subtitle={`${c.blind ? "Hitung buta · " : ""}${c.lines.length} batch`} status={{ tone: st.tone, label: st.label }}
      related={[{ label: "Semua hitungan", href: "/stok/opname" }, ...(c.state === "pending_approval" && c.approval_id ? [{ label: "Lihat di Persetujuan", href: `/persetujuan/${c.approval_id}` }] : [])]}
      sections={[
        { id: "baris", label: "Batch", content: (
          <ul aria-label="Batch dihitung" className="m-0 grid min-w-0 list-none gap-3 p-0">
            {c.lines.map((l) => (
              <li key={l.id} className="grid min-w-0 gap-2 rounded-[var(--radius-field)] bg-[var(--surface-2)] p-3">
                <span className="font-semibold [overflow-wrap:anywhere]">{`${l.name} · Batch ${l.batch_no}`}</span>
                <span className="text-[0.94rem] tabular-nums">
                  {`ED ${date(l.expiry)}${l.system_qty !== null ? ` · sistem ${qty(l.system_qty, l.unit)}` : ""}${l.counted_qty !== null ? ` · terhitung ${qty(l.counted_qty, l.unit)}` : ""}`}
                  {l.difference !== null && l.difference !== 0 && <> · <StatusBadge tone="warning">{`Selisih ${l.difference > 0 ? "+" : ""}${qty(l.difference)}`}</StatusBadge></>}
                </span>
                {c.can_count && <CountLineForm ctx={d.ctx} count={c.id} line={l.id} counted={l.counted_qty} unit={l.unit} label={`${l.name} batch ${l.batch_no}`} />}
              </li>
            ))}
          </ul>
        ) },
        ...(d.stock.can_count && d.stock.active_branch_id === c.branch_id
          ? [{ id: "ajukan", label: "Ajukan", content: <SubmitCountForm ctx={d.ctx} count={c.id} open={c.can_count} /> }] : []),
        ...(c.reason ? [{ id: "ket", label: "Keterangan", content: <p className="m-0 [overflow-wrap:anywhere]">{`${c.reason}${c.threshold_pct !== null ? ` · ambang ${qty(c.threshold_pct)} %` : ""}`}</p> }] : []),
        ...(c.can_cancel ? [{ id: "batal", label: "Batalkan", content: <CancelCountForm ctx={d.ctx} count={c.id} /> }] : []),
      ]}
    >
      <Link href="/stok/opname" className="inline-flex min-h-[44px] items-center text-[var(--tint)]">‹ Hitung Stok</Link>
    </DetailPage>
  );
}

export default function CountPage(props: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}><Body {...props} /></Suspense>
    </main>
  );
}
