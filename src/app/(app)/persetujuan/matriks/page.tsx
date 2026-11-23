// Matriks Persetujuan (19:210, UX-26 ▸ Matriks; HYG-NAV-1): read-only view of who approves each approval type and the setting values in
// force that tune it (setting_value_at, tenant-bound). Owner and Admin Pusat (nav "O AP"); every other role gets the permission state.
// Changes happen in Pengaturan (Owner; Admin Pusat drafts), never here.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { withTenantContext } from "../../../../db/rls/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { SETTING_BY_KEY } from "../../../../modules/settings/registry";
import { settingValue } from "../../../../modules/settings/settings";
import { formatValue, type Value } from "../../../../modules/settings/spec";
import { FIXED_RULES, matrix } from "./model";

export const metadata: Metadata = { title: "Matriks Persetujuan — Clinic Dashboard" };
const TITLE = "Matriks Persetujuan";
const READERS = ["owner", "admin_pusat"];
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";

async function Body() {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind !== "ok" || !READERS.includes(rc.active.context.actingRole)) return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "matriks persetujuan" }} />;
  const rows = matrix();
  const keys = [...new Set(rows.map((r) => r.setting).filter((k): k is string => !!k))];
  const values = await withTenantContext(await appPool(), rc.active.context, async (db) =>
    Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await settingValue<Value>(db, k)] as const))));
  const shown = (k: string) => {
    const def = SETTING_BY_KEY.get(k);
    return def && def.kind === "value" ? `${k} · ${formatValue(def.spec, values[k] ?? null)}` : k;
  };
  return (
    <ListPage as="section" title={TITLE} state={{ kind: "rows" }}>
      <p className={muted}>Hanya lihat. Ambang dan pilihan diubah di <Link href="/pengaturan/uang" className="inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--tint)]">Pengaturan › Uang & Kasir</Link>.</p>
      {/* WCAG 1.4.10: the table only when the container holds 40 em of its own text (≈ 640 px at 100 %); enlarged text or a narrow container
          gets the stacked list, never a two-dimensional scroll (Panel 2, 2026-11-19). em in a container query follows the container's font. */}
      <div className="@container min-w-0">
      <div tabIndex={0} role="region" aria-label="Matriks persetujuan" className="hidden min-w-0 overflow-x-auto rounded-[var(--radius-group)] bg-[var(--surface)] focus-visible:outline focus-visible:outline-3 focus-visible:outline-[var(--tint)] @min-[40em]:block">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">Jenis persetujuan, penyetuju dan pengaturan yang berlaku</caption>
          <thead><tr>
            {["Jenis", "Penyetuju", "Pengaturan berlaku"].map((c) => <th key={c} scope="col" className="px-4 py-3 text-[0.88rem] font-semibold text-[var(--label-2)]">{c}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.type} data-type={r.type} className="border-t border-[var(--separator)] [border-top-width:0.5px]">
                <th scope="row" className="px-4 py-3 font-semibold">{r.label}</th>
                <td className="px-4 py-3">{r.approvers}</td>
                <td className="px-4 py-3 text-[var(--label-2)]">{r.setting ? shown(r.setting) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul aria-label="Matriks persetujuan" className="m-0 grid list-none gap-0 rounded-[var(--radius-group)] bg-[var(--surface)] p-0 @min-[40em]:hidden">
        {rows.map((r) => (
          <li key={r.type} className="grid min-w-0 gap-0.5 border-b border-[var(--separator)] px-4 py-3 last:border-b-0 [border-bottom-width:0.5px]">
            <span className="font-semibold">{r.label}</span>
            <span className="text-[0.94rem]">{r.approvers}</span>
            {r.setting && <span className={muted}>{shown(r.setting)}</span>}
          </li>
        ))}
      </ul>
      </div>
      <section aria-labelledby="aturan-tetap" className="grid min-w-0 gap-2">
        <h2 id="aturan-tetap" className="m-0 text-[1.18rem] font-semibold">Aturan tetap</h2>
        <ul className="m-0 grid list-disc gap-1 pl-5">{FIXED_RULES.map((t) => <li key={t}>{t}</li>)}</ul>
      </section>
    </ListPage>
  );
}

export default function MatriksPage() {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={5} label="Memuat matriks" />}><Body /></Suspense>
    </main>
  );
}
