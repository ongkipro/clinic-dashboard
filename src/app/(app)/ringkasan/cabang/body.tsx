// Ringkasan Cabang (UX-21, PR-33b; T-110): the page body, in a module of its own because a Next page file may export nothing but its default and metadata: the tests run exactly
// this function, with `next/navigation` stood in for (redirect and notFound throw, as in a request). loadCabangPage gates the role (the nav row M O AP) BEFORE the tenant
// transaction opens; this maps its answer: sign-in redirect; owner / admin_pusat routed (ROUTE_FOR: /ringkasan/owner/cabang, /pengaturan/cabang); the permission state;
// Next's not-found when the active branch is not the caller's tenant's (TEN-1); otherwise the summary for the manager's active branch. Only ?tampilan= is read.
import { notFound, redirect } from "next/navigation";
import { loadCabangPage } from "./data";
import { BranchSummaryView } from "./view";

export type SearchParams = Record<string, string | string[] | undefined>;

export async function cabangBody(searchParams: Promise<SearchParams>) {
  const sp = await searchParams;
  const r = await loadCabangPage({ tampilan: typeof sp.tampilan === "string" ? sp.tampilan : undefined });
  if (r.kind === "redirect") redirect(r.to);
  if (r.kind === "route") redirect(r.to); // owner → T-109's league, admin_pusat → branch settings (Panel 2 decision 2)
  if (r.kind === "not-found") notFound(); // the active branch is another tenant's (TEN-1)
  if (r.kind === "forbidden") return <BranchSummaryView state={{ kind: "permission" }} />;
  return <BranchSummaryView state={r.state} />;
}
