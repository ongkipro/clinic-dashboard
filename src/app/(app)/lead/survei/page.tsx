// Survei Kepuasan & Ulasan (19:166, UX-18 ▸ Survei, PR-78; HYG-NAV-1): K26 (average and % ≤ 2) per visit branch and the latest surveys,
// through survey_summary / survey_list. The readers admit owner, central CS, manager, marketing and auditor (DEC-110, for dashboards and
// reports); this page is Manager and Marketing only (19:169, nav M MK), checked before any read (review r1 P1).
// A score only — no free text, no clinical content. Low scores open the branch manager's follow-up (Tindak Lanjut).
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { KpiRow, ListPage } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { type SurveyRow, surveyList, type SurveySummary, surveySummary } from "../../../../modules/crm/surveys/surveys";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { avgText, FOLLOWUP, lowText, totals, who } from "./model";

export const metadata: Metadata = { title: "Survei Kepuasan & Ulasan — Clinic Dashboard" };
const TITLE = "Survei Kepuasan & Ulasan";
export const READERS = ["manager", "marketing"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
const jakarta = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
const ago = (n: number) => jakarta(new Date(Date.now() - n * 86_400_000));
const fmtDay = (d: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${d.slice(0, 10)}T00:00:00Z`));

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const to = typeof sp.sampai === "string" && DAY.test(sp.sampai) ? sp.sampai : jakarta(new Date());
  const from = typeof sp.dari === "string" && DAY.test(sp.dari) ? sp.dari : ago(29);
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind !== "ok" || !READERS.includes(rc.active.context.actingRole)) return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "survei" }} />;
  let sum: SurveySummary[];
  let list: { role: string; rows: SurveyRow[] };
  try {
    [sum, list] = await withTenantContext(await appPool(), rc.active.context, async (db) => [await surveySummary(db, { from, to }), await surveyList(db, { from, to })] as const);
  } catch (e) {
    if (e instanceof CommandError && e.code === "ERR_FORBIDDEN") return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "survei" }} />;
    if (e instanceof CommandError) return <ListPage as="section" title={TITLE} state={{ kind: "filtered-empty", message: "Rentang tanggal ini tidak dapat ditampilkan.", clearHref: "/lead/survei" }} />;
    throw e;
  }
  const t = totals(sum);
  const branchName = new Map(list.rows.map((r) => [r.branch_id, r.branch_name]));
  const filters = [
    { label: "30 hari", href: "/lead/survei", active: from === ago(29) },
    { label: "90 hari", href: `/lead/survei?dari=${ago(89)}`, active: from === ago(89) },
  ];
  if (t.total === 0) return <ListPage as="section" title={TITLE} filters={filters} state={{ kind: "empty", message: "Belum ada survei pada periode ini." }} />;
  return (
    <ListPage as="section" title={TITLE} filters={filters} state={{ kind: "rows" }}>
      <p className={muted}>{`${fmtDay(from)} – ${fmtDay(to)} · per cabang kunjungan`}</p>
      <KpiRow items={[
        { label: "Rata-rata skor (K26)", value: avgText(t), basis: `${t.total} survei` },
        { label: "Skor 2 atau kurang", value: lowText(t), basis: "Membuka tindak lanjut manajer cabang" },
      ]} />
      {sum.length > 1 && (
        <ul aria-label="Per cabang" className="m-0 grid list-none gap-0 rounded-[var(--radius-group)] bg-[var(--surface)] p-0">
          {sum.map((b) => (
            <li key={b.branch_id} className="flex min-h-[var(--target)] min-w-0 flex-wrap items-center justify-between gap-x-3 border-b border-[var(--separator)] px-4 last:border-b-0 [border-bottom-width:0.5px]">
              <span>{branchName.get(b.branch_id) ?? "Cabang"}</span>
              <span className="tabular-nums text-[var(--label-2)]">{avgText(totals([b]))} · {b.total} survei</span>
            </li>
          ))}
        </ul>
      )}
      <section aria-labelledby="survei-terbaru" className="grid min-w-0 gap-2">
        <h2 id="survei-terbaru" className="m-0 text-[1.18rem] font-semibold">Survei terbaru</h2>
        <ul className="m-0 grid list-none gap-0 rounded-[var(--radius-group)] bg-[var(--surface)] p-0">
          {list.rows.slice(0, 50).map((r) => (
            <li key={r.id} className="grid min-w-0 gap-0.5 border-b border-[var(--separator)] px-4 py-3 last:border-b-0 [border-bottom-width:0.5px]">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <span className="font-semibold tabular-nums">{`Skor ${r.score}`}</span>
                {r.score <= 2 ? <StatusBadge tone="danger">Rendah</StatusBadge> : r.review_eligible ? <StatusBadge tone="success">Layak minta ulasan</StatusBadge> : null}
              </div>
              <span className={muted}>{[fmtDay(r.day), r.branch_name, who(r), r.followup_state ? FOLLOWUP[r.followup_state] : null].filter(Boolean).join(" · ")}</span>
            </li>
          ))}
        </ul>
      </section>
      <p className="m-0"><Link href="/lead?segmen=tindak-lanjut" className="inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--tint)]">Buka Tindak Lanjut</Link></p>
    </ListPage>
  );
}

export default function SurveiPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} label="Memuat survei" />}><Body searchParams={searchParams} /></Suspense>
    </main>
  );
}
