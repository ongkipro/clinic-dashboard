// Ringkasan Admin Pusat (UX-57, PR-33g; T-115). Presentational server component: setup completeness per branch (each
// gap named, with Lengkapi to the exact section), pending configuration, and what waits for the Owner; then the branch
// status list. One state per screen via ListPage. Layout follows the CONTAINER, not the viewport (200 % text): one column; from a
// 64em-wide content box branches left, pending right; branch cards two-up from a 40em-wide branch column. PR-63: no money, price, commission or patient / clinical figure exists in the props.
import { cn } from "cn";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { ListPage, Row, RowList } from "../../../../components/templates/templates";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { type AdminHomeProps, type BranchSetup, type Pending, TZ } from "./model";

const panel = "grid min-w-0 content-start gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-4";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
const h2 = "m-0 text-[1.2rem] font-semibold";

function BranchCard({ b }: { b: BranchSetup }) {
  const done = b.issues.length === 0;
  return (
    <li data-branch={b.id} data-complete={done} className={panel}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <h3 className="m-0 min-w-0 text-[1.05rem] font-semibold [overflow-wrap:anywhere]">{b.name}</h3>
        {done ? <StatusBadge tone="success">Lengkap</StatusBadge> : <StatusBadge tone="warning">{`${b.issues.length} belum lengkap`}</StatusBadge>}
      </div>
      <p className={muted}>{`${b.code} · ${TZ[b.timezone] ?? b.timezone} · ${b.published ? "Tayang di situs" : "Belum tayang di situs"}`}</p>
      {!done && (
        <ul aria-label={`Yang belum lengkap di ${b.name}`} className="m-0 grid list-none gap-0 p-0">
          {b.issues.map((i) => (
            <li key={i.key} data-issue={i.key} className="border-t border-[var(--separator)] [border-top-width:0.5px]">
              {/* T-115 mount defect (200 % text): the text and "Lengkapi" wrap onto their own lines in a narrow card instead of squeezing the text to a letter per line */}
              <Link href={i.href} className="flex min-h-[var(--target)] min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1 text-[var(--label)] no-underline">
                <span className="min-w-[min(100%,12em)] flex-1 [overflow-wrap:break-word]">{i.text}</span>
                <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-[var(--tint)]">Lengkapi<span className="sr-only"> {i.text} di {b.name}</span><ChevronRight aria-hidden="true" className="size-4" /></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link href={b.href} className="inline-flex min-h-[var(--target)] items-center gap-1 self-start font-semibold text-[var(--tint)] no-underline">Buka cabang<span className="sr-only"> {b.name}</span><ChevronRight aria-hidden="true" className="size-4" /></Link>
    </li>
  );
}

function PendingList({ id, title, rows, empty }: { id: string; title: string; rows: Pending[]; empty: string }) {
  return (
    <section aria-labelledby={id} className="grid min-w-0 content-start gap-2">
      <h2 id={id} className={h2}>{title} <span className="font-normal text-[var(--label-2)]">({rows.length})</span></h2>
      {rows.length === 0 ? <p role="status" className={cn(panel, "text-[var(--label-2)]")}>{empty}</p> : (
        <RowList label={title}>{rows.map((r) => <Row key={r.key} href={r.href} title={r.title} subtitle={r.subtitle} />)}</RowList>
      )}
    </section>
  );
}

export function AdminHome(p: AdminHomeProps) {
  const title = "Ringkasan";
  if (p.state.kind !== "ready") return <ListPage as={p.as} title={title} state={p.state} />;
  const d = p.state.data;
  if (d.branches.length === 0) {
    return <ListPage as={p.as} title={title} state={{ kind: "empty", message: "Belum ada cabang.", action: "Tambah Cabang", actionHref: "/pengaturan/cabang" }} />;
  }
  const incomplete = d.branches.filter((b) => b.issues.length > 0).length;
  return (
    <ListPage as={p.as} title={title} state={{ kind: "rows" }}>
      <p className={muted}>{incomplete === 0 ? `Semua ${d.branches.length} cabang lengkap` : `${incomplete} dari ${d.branches.length} cabang belum lengkap`}</p>
      <div className="@container grid min-w-0"><div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 @min-[64em]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="cabang" className="@container grid min-w-0 content-start gap-2">
          <h2 id="cabang" className={h2}>Kelengkapan cabang</h2>
          <ul aria-label="Status cabang" className="m-0 grid list-none gap-3 p-0 @min-[40em]:grid-cols-2">
            {d.branches.map((b) => <BranchCard key={b.id} b={b} />)}
          </ul>
        </section>
        <div className="grid min-w-0 content-start gap-5">
          <PendingList id="menunggu-owner" title="Menunggu Owner" rows={d.waitingOwner} empty="Tidak ada yang menunggu Owner." />
          <PendingList id="konfigurasi" title="Konfigurasi tertunda" rows={d.pendingConfig} empty="Tidak ada konfigurasi tertunda." />
        </div>
      </div></div>
    </ListPage>
  );
}
