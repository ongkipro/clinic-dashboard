// Laporan › Kamus KPI (UX-59, PR-95; T-116): the page body, in a module of its own because a Next page file may export nothing but its default and metadata — the tests run exactly this
// function, with `next/navigation` stood in for (redirect throws, as in a request). The dictionary is static: the role gate (data.ts) is the only thing read. In the "ok" state the entry
// named by the URL's hash is scrolled into view once mounted (scroll-to-hash.tsx: the body streams, so the router's own hash scroll finds no target).
import { redirect } from "next/navigation";
import { loadKamus } from "./data";
import { ScrollToHash } from "./scroll-to-hash";
import { KamusKpiView } from "./view";

export type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export async function kamusBody(searchParams: Promise<SearchParams>) {
  const sp = await searchParams;
  const r = await loadKamus({ laporan: one(sp.laporan) });
  if (r.kind === "redirect") redirect(r.to);
  if (r.kind === "forbidden") return <KamusKpiView state={{ kind: "permission" }} />;
  return (
    <>
      <ScrollToHash />
      <KamusKpiView state={{ kind: "ok", report: r.report }} />
    </>
  );
}
