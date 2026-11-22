// Ringkasan Keuangan (UX-22 ▸ Ringkasan, PR-33f; T-114): the page body. A Next page file may export nothing but its default and `metadata`, so the body the page
// renders lives here, where the tests can run it. data.ts gates the role (finance and owner: the nav row of /keuangan/ringkasan) BEFORE the tenant transaction;
// load.ts is the core the DEL-2 case runs; view.tsx renders. Redirect and not-found are Next's control flow; a foreign ?cabang= is the neutral not-found (TEN-1).
import { notFound, redirect } from "next/navigation";
import { ListPage } from "../../../../components/templates/templates";
import { loadFinancePage } from "./data";
import { FinanceSummary } from "./view";

export type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
export const TITLE = "Ringkasan Keuangan";

export async function financeBody(searchParams: Promise<SearchParams>) {
  const sp = await searchParams;
  const r = await loadFinancePage({ dari: one(sp.dari), sampai: one(sp.sampai), cabang: one(sp.cabang) });
  if (r.kind === "redirect") redirect(r.to);
  if (r.kind === "not-found") notFound(); // another tenant's branch id (TEN-1)
  if (r.kind === "forbidden") return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "ringkasan keuangan" }} />;
  return <FinanceSummary as="section" {...r.props} />;
}
