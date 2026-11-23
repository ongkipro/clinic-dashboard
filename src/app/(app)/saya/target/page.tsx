// Target Saya (Saya › Target Saya, 19:229, UX-35 ▸ Target, PR-47; HYG-NAV-1): the acting staff member's own target, attainment and
// scorecard of a period, through target_mine (DEC-100): only the eight own-target roles, only their own row. BC tab 4.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { type MyTarget, myTarget } from "../../../../modules/commission/targets/targets";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { attainment, figures, PERIOD, periodLabel, shiftPeriod } from "./model";

export const metadata: Metadata = { title: "Target Saya — Clinic Dashboard" };
const TITLE = "Target Saya";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const asked = typeof sp.periode === "string" && PERIOD.test(sp.periode) ? sp.periode : null;
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind !== "ok") return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "target" }} />;
  let t: MyTarget;
  try {
    t = await withTenantContext(await appPool(), rc.active.context, (db) => myTarget(db, asked));
  } catch (e) {
    if (e instanceof CommandError && e.code === "ERR_FORBIDDEN") return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "target" }} />;
    if (e instanceof CommandError) return <ListPage as="section" title={TITLE} state={{ kind: "filtered-empty", message: "Periode ini tidak dapat ditampilkan.", clearHref: "/saya/target" }} />;
    throw e;
  }
  const a = attainment(t);
  const chips = [
    { label: "Sebelumnya", href: `/saya/target?periode=${shiftPeriod(t.period, -1)}`, active: false },
    { label: "Periode ini", href: "/saya/target", active: asked === null },
    ...(asked ? [{ label: "Berikutnya", href: `/saya/target?periode=${shiftPeriod(t.period, 1)}`, active: false }] : []),
  ];
  return (
    <ListPage as="section" title={TITLE} filters={chips} state={{ kind: "rows" }}>
      <section aria-labelledby="target-periode" className="grid min-w-0 gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
        <h2 id="target-periode" className="m-0 text-[0.94rem] font-normal text-[var(--label-2)]">{periodLabel(t.period)}</h2>
        <p className="m-0 text-[1.65rem] font-bold tabular-nums">{figures(t)[0][1]}</p>
        {a.pct !== null && (
          <div role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(100, a.pct))} aria-label="Pencapaian target"
            className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div className="h-full rounded-full bg-[var(--tint)]" style={{ width: `${Math.min(100, Math.max(0, a.pct))}%` }} />
          </div>
        )}
        <p className="m-0 font-semibold">{a.text}</p>
        <p className={muted}>Nilai closing dihitung dari pembayaran penjualan yang Anda tutup, tanpa PPN, dikurangi refund pada periode ini.</p>
      </section>
      <dl className="m-0 grid min-w-0 gap-0 rounded-[var(--radius-group)] bg-[var(--surface)] p-0">
        {figures(t).slice(1).map(([k, v]) => (
          <div key={k} className="flex min-h-[var(--target)] min-w-0 flex-wrap items-center justify-between gap-x-3 border-b border-[var(--separator)] px-4 last:border-b-0 [border-bottom-width:0.5px]">
            <dt className="text-[var(--label-2)]">{k}</dt><dd className="m-0 tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </ListPage>
  );
}

export default function TargetSayaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={3} label="Memuat target" />}><Body searchParams={searchParams} /></Suspense>
    </main>
  );
}
