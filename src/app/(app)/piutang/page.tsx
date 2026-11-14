// Piutang & Refund (UX-14, 19:116; T-078): three views — Piutang (aging per SET-41 buckets, state), Refund (incl. the clinic
// DP refunds, read-only) and Siap Dijadikan Piutang (open visits with a delivered unpaid remainder).
import type { Metadata } from "next";
import { Suspense } from "react";
import { ListPage, Row, RowList } from "../../../components/templates/templates";
import { LoadingList } from "../../../components/ui/states";
import { StatusBadge } from "../../../components/ui/status-badge";
import { loadPiutang } from "./data";
import { ConvertForm } from "./forms";
import { Main, NotOkState, RECEIVABLE_STATE, REFUND_STATE, rp, who } from "./frame";

export const metadata: Metadata = { title: "Piutang & Refund — Clinic Dashboard" };
const VIEWS = [["piutang", "Piutang"], ["refund", "Refund"], ["siap", "Siap Dijadikan Piutang"]] as const;
const BUCKETS = ["0-30", "31-60", "61-90", ">90"] as const;

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const view = VIEWS.some(([v]) => v === sp.lihat) ? (sp.lihat as string) : "piutang";
  const umur = typeof sp.umur === "string" && (BUCKETS as readonly string[]).includes(sp.umur) ? sp.umur : undefined;
  const d = await loadPiutang();
  if (d.kind !== "ok") return <NotOkState d={d} title="Piutang & Refund" />;
  const writer = d.role !== "auditor";
  const filters = VIEWS.map(([v, l]) => ({ label: l, href: `/piutang?lihat=${v}`, active: v === view }));
  if (view === "refund") {
    const rows = d.d.refunds;
    return (
      <ListPage as="section" title="Piutang & Refund" filters={filters}
        primaryAction={writer ? { label: "Ajukan Refund", href: "/piutang/refund/baru" } : undefined}
        state={rows.length === 0 ? { kind: "empty", message: "Belum ada refund." } : { kind: "rows" }}>
        <RowList label="Refund">
          {rows.map((f) => (
            <Row key={`${f.kind}-${f.id}`} href={f.kind === "line" ? `/piutang/refund/${f.id}` : "/piutang?lihat=refund"} title={`${who(f.patient)} · ${rp(f.amount)}`}
              subtitle={f.kind === "deposit" ? "DP booking dikembalikan (klinik membatalkan)" : f.destination === "balance" ? "Ke saldo pasien" : "Tunai (perlu persetujuan)"}>
              <StatusBadge tone={REFUND_STATE[f.state][1]}>{REFUND_STATE[f.state][0]}</StatusBadge>
            </Row>
          ))}
        </RowList>
      </ListPage>
    );
  }
  if (view === "siap") {
    const rows = d.d.convertible;
    return (
      <ListPage as="section" title="Piutang & Refund" filters={filters}
        state={rows.length === 0 ? { kind: "empty", message: "Tidak ada kunjungan dengan sisa tagihan." } : { kind: "rows" }}>
        <RowList label="Kunjungan dengan sisa tagihan">
          {rows.map((v) => (
            // Not a Row: a row is one link whose overlay would cover the form's button; this row has no page of its own.
            <li key={v.visit_id} className="grid min-w-0 gap-2 border-b border-[var(--separator)] px-4 py-[11px] last:border-b-0 [border-bottom-width:0.5px]">
              <span className="font-semibold [overflow-wrap:anywhere]">{who(v.patient)}</span>
              <span className="text-[0.88rem] text-[var(--label-2)]">{`Sisa tagihan ${rp(v.amount)}`}</span>
              {writer && d.role !== "finance" && <ConvertForm ctx={d.ctx} visit={v.visit_id} amount={v.amount} />}
            </li>
          ))}
        </RowList>
      </ListPage>
    );
  }
  const all = d.d.receivables;
  const rows = umur ? all.filter((r) => r.state === "open" && r.bucket === umur) : all;
  const open = all.filter((r) => r.state === "open").reduce((s, r) => s + r.open, 0);
  return (
    <ListPage as="section" title="Piutang & Refund" filters={[...filters, ...BUCKETS.map((b) => ({ label: `${b} hari`, href: `/piutang?umur=${encodeURIComponent(b)}`, active: b === umur }))]}
      state={all.length === 0 ? { kind: "empty", message: "Belum ada piutang." }
        : rows.length === 0 ? { kind: "filtered-empty", message: "Tidak ada piutang yang cocok dengan filter.", clearHref: "/piutang" } : { kind: "rows" }}>
      <p className="m-0 text-[0.94rem]">{`Total piutang terbuka ${rp(open)}`}</p>
      <RowList label="Piutang">
        {rows.map((r) => (
          <Row key={r.id} href={`/piutang/${r.id}`} title={who(r.patient)}
            subtitle={`${rp(r.open)} sisa · ${r.age_days} hari${r.collector ? ` · Penanggung tagih: ${r.collector}` : ""}`}>
            <StatusBadge tone={RECEIVABLE_STATE[r.state][1]}>{RECEIVABLE_STATE[r.state][0]}</StatusBadge>
          </Row>
        ))}
      </RowList>
    </ListPage>
  );
}

export default function PiutangPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Main><Suspense fallback={<LoadingList rows={5} />}><Body searchParams={searchParams} /></Suspense></Main>;
}
