// Pasienku — BC home (UX-35, PR-33d; T-112). Presentational server component: props in, markup out; no data access
// (load.ts reads the own-scope readers; page.tsx mounts it at integration). Sections in contract order: Perlu Dihubungi, Menunggu Dokter,
// Belum Memilih, Paket Hampir Habis; then the target card (K19) and own commission (K17). One state per screen via
// ListPage; every row and figure links through a caller-supplied href when that page exists (PR-33; a row or card whose destination is not built is
// shown without a link, never a dead one); unavailable reads "Belum tersedia", never Rp0. Compact (< 700 px): one column; regular: lists left, target and commission right (≥ 1180 px). No clinical content.
import { cn } from "cn";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { ListPage, Row, RowList } from "../../../components/templates/templates";
import { StatusBadge } from "../../../components/ui/status-badge";
import { attainment, count, money, type PasienkuData, type PasienkuProps, ratio, REASON, type Rows, sortContact, sortPackages, sortUnselected, UNAVAILABLE } from "./model";

const panel = "grid min-w-0 content-start gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-4";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
const h2 = "m-0 text-[1.2rem] font-semibold";
const link = "inline-flex min-h-[var(--target)] items-center gap-1 self-start font-semibold text-[var(--tint)] no-underline";

// One section. An unavailable list is "Belum tersedia" with its reason and NO count in the heading (a missing answer is not "0"); an incomplete one says "n+" and never claims
// that nothing is left; a section note names a fact the reader does not carry, once, instead of on every row.
function Section<T>({ id, title, list, empty, children }: { id: string; title: string; list: Rows<T>; empty: string; children: (rows: T[]) => React.ReactNode }) {
  const head = list.state === "value" ? ` (${count(list.rows.length)}${list.incomplete ? "+" : ""})` : "";
  return (
    <section aria-labelledby={id} className="grid min-w-0 gap-2">
      <h2 id={id} className={h2}>{title}{head && <span className="font-normal text-[var(--label-2)]">{head}</span>}</h2>
      {list.state === "unavailable" ? (
        <div role="status" data-section="unavailable" className={cn(panel, "text-[var(--label-2)]")}><span data-kpi="unavailable" className="font-semibold">{UNAVAILABLE}</span><p className={muted}>{list.reason}</p></div>
      ) : (
        <>
          {list.rows.length === 0 && !list.incomplete ? <p role="status" className={cn(panel, "text-[var(--label-2)]")}>{empty}</p> : children(list.rows)}
          {list.incomplete && <p role="status" data-section="incomplete" className={muted}>{list.incomplete}</p>}
          {list.note && <p data-section="note" className={muted}>{list.note}</p>}
        </>
      )}
    </section>
  );
}

// A destination link, absent when its page is not built (the caller passes null): no dead link.
function Go({ href, children }: { href: string | null; children: React.ReactNode }) {
  return href ? <Link href={href} className={link}>{children}<ChevronRight aria-hidden="true" className="size-4" /></Link> : null;
}
// A row that is a link when its page exists and plain text otherwise (the shared Row needs a destination).
// The badge ("Terlambat") sits UNDER the title as part of the row's text, never beside it: beside a narrow title it cannot shrink and crushes the title to a letter per line at 200 % text.
function Line({ href, title, subtitle, trailing }: { href: string | null; title: string; subtitle: string; trailing?: React.ReactNode }) {
  const sub = trailing ? <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"><span className="min-w-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]">{subtitle}</span>{trailing}</span> : subtitle;
  if (href) return <Row href={href} title={title} subtitle={trailing ? undefined : subtitle}>{trailing ? sub : null}</Row>;
  return (
    <li className="flex min-h-[var(--target)] min-w-0 items-center gap-3 border-b border-[var(--separator)] px-4 py-[11px] last:border-b-0 [border-bottom-width:0.5px]">
      <div className="grid min-w-0 flex-1 gap-1">
        <span className="font-semibold [overflow-wrap:anywhere]">{title}</span>
        {typeof sub === "string" ? <span className="text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]">{sub}</span> : sub}
      </div>
    </li>
  );
}

function Unavailable({ reason }: { reason: string }) {
  return <><span data-kpi="unavailable" className="text-[1.05rem] font-semibold text-[var(--label-2)]">{UNAVAILABLE}</span><p className={muted}>{reason}</p></>;
}

function TargetCard({ d }: { d: PasienkuData }) {
  const t = d.target;
  const a = attainment(t);
  const width = a.state === "value" ? Math.min(100, Math.max(0, a.pct)) : 0;
  return (
    <section aria-labelledby="kpi-k19" className={panel}>
      <h2 id="kpi-k19" className="m-0 text-[0.94rem] font-normal text-[var(--label-2)]">{`Target ${t.period} (K19)`}</h2>
      {t.closing.state === "value"
        ? <span data-kpi="value" className="tabular whitespace-nowrap text-[1.65rem] font-bold leading-tight @max-[22em]:text-[1.3rem]">{money(t.closing)}</span>
        : <Unavailable reason={t.closing.reason} />}
      {t.target !== null && <p className={muted}>{`Target ${money(t.target)}`}</p>}
      {a.state === "value" && (
        <div role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(width)} aria-label="Pencapaian target" className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
          <div className="h-full rounded-full bg-[var(--tint)]" style={{ width: `${width}%` }} />
        </div>
      )}
      <p data-attainment={a.state} className="m-0 font-semibold">{a.text}</p>
      <p className={muted}>{t.plansActual === null ? `Rencana terpilih penuh: ${UNAVAILABLE}` : t.plansTarget === null ? `${count(t.plansActual)} rencana terpilih penuh` : `${count(t.plansActual)} dari ${count(t.plansTarget)} rencana terpilih penuh`}</p>
      <Go href={t.href}>Target Saya</Go>
    </section>
  );
}

function Side({ d }: { d: PasienkuData }) {
  return (
    <div className="grid min-w-0 content-start gap-3">
      <TargetCard d={d} />
      <section aria-labelledby="kpi-k17" className={panel}>
        <h2 id="kpi-k17" className="m-0 text-[0.94rem] font-normal text-[var(--label-2)]">Komisi saya bulan ini (K17)</h2>
        {d.commission.amount.state === "value"
          ? <span data-kpi="value" className="tabular whitespace-nowrap text-[1.3rem] font-bold @max-[22em]:text-[1.1rem]">{money(d.commission.amount)}</span>
          : <Unavailable reason={d.commission.amount.reason} />}
        <Go href={d.commission.href}>Komisi Saya</Go>
      </section>
      <section aria-labelledby="kpi-k9" className={panel}>
        <h2 id="kpi-k9" className="m-0 text-[0.94rem] font-normal text-[var(--label-2)]">Rencana dipilih (K9)</h2>
        {"state" in d.k9 ? <Unavailable reason={d.k9.reason} /> : (
          <>
            <span data-kpi={d.k9.recommended > 0 ? "value" : "unavailable"} className="tabular text-[1.3rem] font-bold">{ratio(d.k9.selected, d.k9.recommended)}</span>
            <p className={muted}>{`${count(d.k9.selected)} dari ${count(d.k9.recommended)} item dalam ${d.k9.window} hari`}</p>
          </>
        )}
        <Go href={d.k9.href}>Lihat rincian<span className="sr-only"> Rencana dipilih</span></Go>
      </section>
      <section aria-labelledby="kpi-dormant" className={panel}>
        <h2 id="kpi-dormant" className="m-0 text-[0.94rem] font-normal text-[var(--label-2)]">Pasien lama tidak datang</h2>
        {"state" in d.dormant ? <Unavailable reason={d.dormant.reason} /> : <span data-kpi="value" className="tabular text-[1.3rem] font-bold">{count(d.dormant.count)}</span>}
        <Go href={d.dormant.href}>Lihat pasien</Go>
      </section>
    </div>
  );
}

export function Pasienku(p: PasienkuProps) {
  const title = "Pasienku";
  if (p.state.kind !== "ready") return <ListPage as={p.as} title={title} state={p.state} />;
  const d = p.state.data;
  return (
    <ListPage as={p.as} title={title} state={{ kind: "rows" }}>
      <p className={muted}>{`${p.staff} · ${p.branch}`}</p>
      <div className="@container min-w-0">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 @min-[64em]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 content-start gap-5">
          <Section id="hubungi" title="Perlu Dihubungi" list={d.contact} empty="Tidak ada pasien yang perlu dihubungi hari ini.">
            {(rows) => (
              <RowList label="Perlu Dihubungi">
                {sortContact(rows).map((r) => (
                  <Line key={r.id} href={r.href} title={`${r.patient} · ${r.mrn}`} subtitle={`${REASON[r.reason]} · jatuh tempo ${r.dueOn}`}
                    trailing={r.overdue ? <StatusBadge tone="warning">Terlambat</StatusBadge> : undefined} />
                ))}
              </RowList>
            )}
          </Section>
          <Section id="menunggu" title="Menunggu Dokter" list={d.waiting} empty="Tidak ada pasien yang menunggu dokter.">
            {(rows) => (
              <RowList label="Menunggu Dokter">
                {rows.map((r) => <Line key={r.visitId} href={r.href} title={`${r.patient} · ${r.mrn}`} subtitle={`Datang ${r.arrived}`} />)}
              </RowList>
            )}
          </Section>
          <Section id="belum-memilih" title="Belum Memilih" list={d.unselected} empty="Belum ada tindak lanjut rencana.">
            {(rows) => (
              <RowList label="Belum Memilih">
                {sortUnselected(rows).map((r) => (
                  <Line key={r.id} href={r.href} title={`${r.patient} · ${r.mrn}`}
                    subtitle={[r.items && `${count(r.items.selected)} dari ${count(r.items.recommended)} item dipilih`, r.value !== null && money({ state: "value", rp: r.value }), `tindak lanjut ${r.dueOn}`, r.overdueDays > 0 && `terlambat ${count(r.overdueDays)} hari`].filter(Boolean).join(" · ")} />
                ))}
              </RowList>
            )}
          </Section>
          <Section id="paket" title="Paket Hampir Habis" list={d.packages} empty="Belum ada pengingat paket.">
            {(rows) => (
              <RowList label="Paket Hampir Habis">
                {sortPackages(rows).map((r) => (
                  <Line key={r.id} href={r.href} title={`${r.patient} · ${r.mrn}`}
                    subtitle={[r.sessionsLeft !== null && `Sisa ${count(r.sessionsLeft)} sesi`, r.validUntil !== null && `berlaku sampai ${r.validUntil}`, `pengingat ${r.dueOn}`].filter(Boolean).join(" · ")} />
                ))}
              </RowList>
            )}
          </Section>
        </div>
        <Side d={d} />
      </div>
      </div>
    </ListPage>
  );
}
