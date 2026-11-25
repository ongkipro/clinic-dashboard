// Atribusi & Sumber Rujukan page (19 §2.10, UX-38 report, K13; Marketing & Owner).
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { KpiRow, ListPage } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { definitionHref } from "../../../../modules/reporting/reports/dictionary";
import { loadAtribusiIn, parseAtribusiFilters, todayJakarta, type NamedFunnel } from "./data";

export const metadata: Metadata = { title: "Atribusi & Sumber Rujukan — Clinic Dashboard" };
const TITLE = "Atribusi & Sumber Rujukan";
const ROLES = new Set(["marketing", "owner"]);

const panel = "grid min-w-0 content-start gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4";
const input = "min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";

function pct(num: number, den: number): string {
  if (den <= 0) return "Belum ada data";
  return `${((num * 100) / den).toFixed(1).replace(".", ",")}%`;
}

function FunnelTable({ id, title, rows }: { id: string; title: string; rows: NamedFunnel[] }) {
  return (
    <section aria-labelledby={id} className={panel}>
      <h2 id={id} className="m-0 text-[1.15rem] font-semibold">
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className={muted}>Belum ada data atribusi pada periode ini.</p>
      ) : (
        <div className="w-full overflow-x-auto">
          <table className="w-full border-collapse text-left text-[0.9rem]">
            <thead>
              <tr className="border-b border-[var(--separator)] text-[var(--label-2)]">
                <th className="py-2 pr-3 font-medium">Kelompok</th>
                <th className="py-2 pr-3 text-right font-medium">Lead</th>
                <th className="py-2 pr-3 text-right font-medium">Janji</th>
                <th className="py-2 pr-3 text-right font-medium">Datang</th>
                <th className="py-2 pr-3 text-right font-medium">Bayar</th>
                <th className="py-2 text-right font-medium">Konversi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-[var(--separator)] last:border-b-0">
                  <td className="py-2 pr-3">{r.label}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.lead}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.booked}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.arrived}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.paid}</td>
                  <td className="py-2 text-right font-medium tabular-nums">{pct(r.paid, r.lead)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

async function Body({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  const ctx = rc.kind === "ok" ? rc.active.context : null;
  if (!ctx || !ROLES.has(ctx.actingRole)) {
    return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "atribusi dan sumber rujukan" }} />;
  }

  const parsed = parseAtribusiFilters(await searchParams);
  if (!parsed.ok) notFound();

  let data;
  try {
    data = await withTenantContext(await appPool(), ctx, (db) => loadAtribusiIn(db, parsed.filters));
  } catch (e) {
    if (e instanceof CommandError && e.code === "ERR_NOT_FOUND") notFound();
    if (e instanceof CommandError && e.code === "ERR_FORBIDDEN") {
      return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "atribusi dan sumber rujukan" }} />;
    }
    throw e;
  }

  const today = todayJakarta();
  return (
    <ListPage as="section" title={TITLE} state={{ kind: "rows" }}>
      <form
        method="get"
        action="/laporan/atribusi"
        aria-label="Filter periode atribusi"
        className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 @min-[44em]:grid-cols-[repeat(3,minmax(0,1fr))_auto] @min-[44em]:items-end"
      >
        <label className="grid min-w-0 gap-1">
          Dari
          <input name="dari" type="date" defaultValue={data.from} max={today} className={input} />
        </label>
        <label className="grid min-w-0 gap-1">
          Sampai
          <input name="sampai" type="date" defaultValue={data.to} max={today} className={input} />
        </label>
        <label className="grid min-w-0 gap-1">
          Cabang
          <select name="cabang" defaultValue={data.branchId ?? ""} className={input}>
            <option value="">Semua Cabang</option>
            {data.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="min-h-[var(--target)] rounded-full bg-[var(--secondary)] px-5 font-semibold text-[var(--label)]"
        >
          Terapkan
        </button>
      </form>

      <KpiRow
        items={[
          { label: "Lead masuk", value: String(data.totals.lead), basis: `${data.from} – ${data.to}` },
          { label: "Janji dibuat", value: String(data.totals.booked), basis: "Dari lead periode ini" },
          { label: "Kunjungan datang", value: String(data.totals.arrived), basis: "Dari janji periode ini" },
          {
            label: "Konversi bayar (K13)",
            value: pct(data.totals.paid, data.totals.lead),
            basis: `${data.totals.paid} bayar dari ${data.totals.lead} lead`,
          },
        ]}
      />

      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <p className={muted}>
          Definisi metrik mengikuti Kamus KPI K13. Sumber rujukan (pasien, staf, partner) dicatat sebagai sumber tanpa program poin atau hadiah.
        </p>
        <Link
          href={definitionHref("K13")}
          className="inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--tint)]"
        >
          Buka Kamus KPI K13
        </Link>
      </div>

      <FunnelTable id="h-sumber" title="Per sumber & rujukan" rows={data.bySource} />
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 @min-[56em]:grid-cols-2">
        <FunnelTable id="h-cabang" title="Per cabang" rows={data.byBranch} />
        <FunnelTable id="h-petugas" title="Per petugas" rows={data.byAssignee} />
      </div>
    </ListPage>
  );
}

export default function LaporanAtribusiPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={5} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
