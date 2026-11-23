// Target & Scorecard Staf (19:157, UX-35 ▸ Target, PR-47; HYG-NAV-1): the owner (tenant-wide or a branch) and a manager (its active
// branch) list staff with their target, attainment and scorecard through target_list (DEC-100); the owner sets targets (staff_target_set).
// Admin Pusat never (PR-63). No patient data.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { listTargets, type TargetList } from "../../../../modules/commission/targets/targets";
import { renderedContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { attainment, figures, PERIOD, periodLabel, shiftPeriod } from "../../saya/target/model";
import { SetTargetForm } from "./forms";

export const metadata: Metadata = { title: "Target & Scorecard Staf — Clinic Dashboard" };
const TITLE = "Target & Scorecard Staf";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const asked = typeof sp.periode === "string" && PERIOD.test(sp.periode) ? sp.periode : null;
  const branch = typeof sp.cabang === "string" && UUID.test(sp.cabang) ? sp.cabang : null;
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind !== "ok") return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "target staf" }} />;
  let d: TargetList;
  try {
    d = await withTenantContext(await appPool(), rc.active.context, (db) => listTargets(db, { period: asked, branchId: branch }));
  } catch (e) {
    if (e instanceof CommandError && e.code === "ERR_FORBIDDEN") return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "target staf" }} />;
    if (e instanceof CommandError) return <ListPage as="section" title={TITLE} state={{ kind: "filtered-empty", message: "Filter ini tidak dapat ditampilkan.", clearHref: "/staf/target" }} />;
    throw e;
  }
  const q = (o: Record<string, string>) => `/staf/target?${new URLSearchParams({ ...(branch ? { cabang: branch } : {}), ...o })}`;
  const chips = [
    { label: "Sebelumnya", href: q({ periode: shiftPeriod(d.period, -1) }), active: false },
    { label: "Periode ini", href: branch ? q({}) : "/staf/target", active: asked === null },
    ...(asked ? [{ label: "Berikutnya", href: q({ periode: shiftPeriod(d.period, 1) }), active: false }] : []),
  ];
  const ctx = renderedContext(rc.active.context);
  const state = d.rows.length > 0 ? { kind: "rows" as const }
    : branch ? { kind: "filtered-empty" as const, message: "Tidak ada staf untuk filter ini.", clearHref: "/staf/target" }
    : { kind: "empty" as const, message: "Belum ada staf dengan peran cabang atau BC." };
  return (
    <ListPage as="section" title={TITLE} filters={chips} state={state}>
      <p className={muted}>{`${periodLabel(d.period)} · ${d.period_kind === "triwulan" ? "Triwulan" : "Bulanan"}${d.can_set ? "" : " · hanya lihat"}`}</p>
      <ul aria-label="Target per staf" className="m-0 grid min-w-0 list-none gap-3 p-0 min-[900px]:grid-cols-2">
        {d.rows.map((r) => {
          const a = attainment(r);
          return (
            <li key={r.staff_id} className="grid min-w-0 content-start gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
              <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
                <h2 className="m-0 min-w-0 text-[1.05rem] font-semibold [overflow-wrap:anywhere]">{r.staff}</h2>
                <span className="font-semibold">{a.text}</span>
              </div>
              <dl className="m-0 grid min-w-0 gap-1">
                {figures(r).map(([k, v]) => (
                  <div key={k} className="flex min-w-0 flex-wrap justify-between gap-x-3"><dt className="text-[var(--label-2)]">{k}</dt><dd className="m-0 tabular-nums">{v}</dd></div>
                ))}
              </dl>
              {d.can_set && r.is_bc && (
                <SetTargetForm ctx={ctx} staffId={r.staff_id} staffName={r.staff} period={d.period}
                  current={r.target ? { closing: Number(r.target.closing_value_target), plans: r.target.plans_target } : null} />
              )}
            </li>
          );
        })}
      </ul>
    </ListPage>
  );
}

export default function TargetStafPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} label="Memuat target staf" />}><Body searchParams={searchParams} /></Suspense>
    </main>
  );
}
