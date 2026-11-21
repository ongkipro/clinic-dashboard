// Rekonsiliasi (UX-22 ▸ Rekon, PR-34; T-108). Presentational server component: the engine's report in, markup out; no data access
// (page.tsx and the `recon_report` reader land after T-107). Verdict first, then every difference with its document reference (worst
// first), inter-branch clearing per day, handover exceptions, and the day × branch table of KPI vs ledger per metric. Days without
// activity and without differences collapse into one line so the table stays readable. Cards below a 48 em CONTAINER (so 200 % text
// reflows to cards, WCAG 1.4.10, as Ringkasan Shift), table at or above it.
// One state per screen via ListPage; unavailable reads "Belum tersedia", never Rp0. No clinical content.
import { cn } from "cn";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { ListPage } from "../../../../components/templates/templates";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { METRIC_LABEL, METRICS, type ReconReport, type Row } from "../../../../modules/accounting/recon/recon";
import { amount, day, explain, KIND, type RekonProps, scopeHref, signed, STATUS, UNAVAILABLE, VERDICT } from "./model";

const panel = "grid min-w-0 content-start gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-4";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
const h2 = "m-0 text-[1.2rem] font-semibold";
const link = "inline-flex min-h-[var(--target)] items-center gap-1 self-start font-semibold text-[var(--tint)] no-underline";

const active = (r: Row) => r.status !== "cocok" || r.cells.some((c) => (c.fact ?? 0) !== 0 || (c.ledger ?? 0) !== 0);

function cellText(c: Row["cells"][number]) {
  if (c.status === "tidak_tersedia") return UNAVAILABLE;
  return c.difference === 0 ? amount(c.fact) : `${amount(c.fact)} / ${amount(c.ledger)}`;
}

function Items({ d, p }: { d: ReconReport; p: RekonProps }) {
  const name = (id: string) => p.scope.branches.find((b) => b.id === id)?.name ?? "Cabang";
  if (d.items.length === 0) return null;
  return (
    <section aria-labelledby="rincian" className="grid min-w-0 gap-2">
      <h2 id="rincian" className={h2}>{`Rincian (${d.items.length})`}</h2>
      <ul aria-label="Rincian selisih" className="m-0 grid list-none overflow-hidden rounded-[var(--radius-group)] bg-[var(--surface)] p-0">
        {d.items.map((i, n) => {
          const href = p.hrefFor(i.ref);
          const body = (
            <span className="grid min-w-0 gap-0.5">
              <span className="font-semibold [overflow-wrap:anywhere]">{explain(i)}</span>
              <span className={muted}>{`${METRIC_LABEL[i.metric]} · ${day(i.day)} · ${name(i.branchId)} · operasional ${amount(i.fact)} · buku besar ${amount(i.ledger)}`}</span>
            </span>
          );
          return (
            <li key={`${i.kind}-${i.ref.kind}-${i.ref.id}-${i.branchId}-${n}`} data-item={i.kind} data-ref={i.ref.id}
              className="border-b border-[var(--separator)] px-4 py-[11px] last:border-b-0 [border-bottom-width:0.5px]">
              {href ? (
                <Link href={href} className="flex min-h-[var(--target)] min-w-0 items-center justify-between gap-3 text-[var(--label)] no-underline">
                  {body}<ChevronRight aria-hidden="true" className="size-5 shrink-0 text-[var(--label-3)]" />
                </Link>
              ) : body}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Table({ d, p }: { d: ReconReport; p: RekonProps }) {
  const name = (id: string) => p.scope.branches.find((b) => b.id === id)?.name ?? "Cabang";
  const rows = d.rows.filter(active);
  const quiet = d.rows.length - rows.length;
  return (
    <section aria-labelledby="harian" className="@container grid min-w-0 gap-2">
      <h2 id="harian" className={h2}>Per hari dan cabang</h2>
      <p className={muted}>Angka operasional / buku besar; satu angka berarti keduanya sama.</p>
      {rows.length === 0 ? <p role="status" className={cn(panel, "text-[var(--label-2)]")}>Belum ada transaksi pada periode ini.</p> : (
        <>
          <div tabIndex={0} role="region" aria-label="Rekonsiliasi per hari dan cabang" className="hidden min-w-0 overflow-x-auto rounded-[var(--radius-group)] @min-[48em]:block bg-[var(--surface)] focus-visible:outline focus-visible:outline-3 focus-visible:outline-[var(--tint)]">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">KPI operasional dibanding buku besar per hari dan cabang</caption>
              <thead><tr>
                <th scope="col" className="px-4 py-3 text-[0.88rem] font-semibold text-[var(--label-2)]">Hari · Cabang</th>
                {METRICS.map((m) => <th key={m} scope="col" className="px-4 py-3 text-right text-[0.88rem] font-semibold text-[var(--label-2)]">{METRIC_LABEL[m]}</th>)}
                <th scope="col" className="px-4 py-3 text-[0.88rem] font-semibold text-[var(--label-2)]">Status</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.day}-${r.branchId}`} data-row={`${r.day}:${r.branchId}`} data-status={r.status} className="border-t border-[var(--separator)] [border-top-width:0.5px]">
                    <th scope="row" className="px-4 py-3 font-normal">{`${day(r.day)} · ${name(r.branchId)}`}</th>
                    {r.cells.map((c) => <td key={c.metric} data-cell={c.status} className={cn("tabular px-4 py-3 text-right", c.status === "selisih" && "font-semibold")}>{cellText(c)}</td>)}
                    <td className="px-4 py-3"><StatusBadge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</StatusBadge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul aria-label="Rekonsiliasi per hari dan cabang" className="m-0 grid list-none gap-3 p-0 @min-[48em]:hidden">
            {rows.map((r) => (
              <li key={`${r.day}-${r.branchId}`} className={panel}>
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{`${day(r.day)} · ${name(r.branchId)}`}</span>
                  <StatusBadge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</StatusBadge>
                </div>
                <dl className="m-0 grid gap-y-1">
                  {r.cells.map((c) => (
                    <div key={c.metric} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
                      <dt className="text-[0.88rem] text-[var(--label-2)]">{METRIC_LABEL[c.metric]}</dt>
                      <dd className="tabular m-0 text-right">{cellText(c)}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
      {quiet > 0 && <p className={muted}>{`${quiet} hari-cabang tanpa transaksi dan tanpa selisih tidak ditampilkan.`}</p>}
    </section>
  );
}

export function Rekon(p: RekonProps) {
  const title = "Rekonsiliasi";
  const s = p.scope;
  const filters = [{ label: "Semua Cabang", href: scopeHref(s, null), active: s.branch === null },
    ...s.branches.map((b) => ({ label: b.name, href: scopeHref(s, b.id), active: s.branch === b.id }))];
  if (p.state.kind !== "ready") return <ListPage as={p.as} title={title} filters={p.state.kind === "permission" ? undefined : filters} state={p.state} />;
  const d = p.state.data;
  const v = VERDICT[d.verdict];
  const name = (id: string) => s.branches.find((b) => b.id === id)?.name ?? "Cabang";
  const counts = (["missing", "amount", "placement", "orphan", "queued", "timing"] as const).map((k) => [k, d.items.filter((i) => i.kind === k).length] as const).filter(([, n]) => n > 0);
  return (
    <ListPage as={p.as} title={title} filters={filters} state={{ kind: "rows" }}>
      <section aria-labelledby="hasil" data-verdict={d.verdict} className={panel}>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <h2 id="hasil" className={h2}>{s.period}</h2>
          <StatusBadge tone={v.tone}>{v.label}</StatusBadge>
        </div>
        {counts.length > 0 && <ul className="m-0 grid list-none gap-1 p-0">{counts.map(([k, n]) => <li key={k} className="tabular">{`${n} · ${KIND[k]}`}</li>)}</ul>}
        {d.unavailable.map((u) => <p key={`${u.metric}-${u.branchId}`} className={muted}>{`${METRIC_LABEL[u.metric]}${u.branchId ? ` · ${name(u.branchId)}` : ""}: ${u.reason}`}</p>)}
        <p className={muted}>Pembukuan masih pratinjau sampai peta posting ditandatangani.</p>
        <Link href={p.ledgerHref} className={link}>Jurnal & Buku Besar<ChevronRight aria-hidden="true" className="size-4" /></Link>
      </section>

      <Items d={d} p={p} />

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 min-[900px]:grid-cols-2">
        <section aria-labelledby="kliring" className={panel}>
          <h2 id="kliring" className={h2}>Kliring antarcabang</h2>
          {d.clearing.length === 0 ? <p className={muted}>Tidak ada transaksi antarcabang.</p> : (
            <ul className="m-0 grid list-none gap-1 p-0">
              {d.clearing.map((c) => (
                <li key={c.day} data-clearing={c.day} data-net={c.net} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
                  {/* the net is tenant-wide; only the selected branches' legs are listed (none: the difference sits at other branches) */}
                  <span>{`${day(c.day)} · ${c.byBranch.length ? c.byBranch.map((b) => `${name(b.branchId)} ${signed(b.amount)}`).join(" · ") : "di cabang lain"}`}</span>
                  {c.net === 0 ? <StatusBadge tone="success">Seimbang</StatusBadge> : <StatusBadge tone="danger">{`Tidak seimbang ${signed(c.net)}`}</StatusBadge>}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="penyerahan" className={panel}>
          <h2 id="penyerahan" className={h2}>Selisih penyerahan produk</h2>
          {d.exceptions.length === 0 ? <p className={muted}>Tidak ada penyerahan tanpa tautan baris invoice.</p> : (
            <ul className="m-0 grid list-none gap-1 p-0">
              {d.exceptions.map((h) => (
                <li key={h.branchId} data-handover={h.branchId}>{`${name(h.branchId)} · ${h.unlinked} tanpa tautan · ${h.fractional} pecahan`}</li>
              ))}
            </ul>
          )}
          <p className={muted}>Tidak dinilai di K2 maupun buku besar; perlu ditautkan ke baris invoice.</p>
        </section>
      </div>

      <Table d={d} p={p} />
    </ListPage>
  );
}
