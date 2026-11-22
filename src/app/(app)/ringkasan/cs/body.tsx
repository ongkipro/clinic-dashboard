// Ringkasan CS (UX-36, PR-33e; T-113): the page body, in a module of its own because a Next page file may export nothing but its default and metadata: the tests run exactly this function, with
// `next/navigation` stood in for (redirect and notFound throw, as in a request). loadCsPage gates the role (central CS only: the nav row) BEFORE the tenant transaction opens; this maps its answer:
// redirect, the permission state (a title and a message: no figure, no link), Next's not-found for another tenant's ?cabang= (TEN-1, neutral, noindex), or the summary with the branch scope chips.
// The chips are local, not the Kasir's BranchChips: that one lists only branches, and this page is valid WITHOUT ?cabang= (Semua Cabang), so a branch chip alone would leave no way back to the whole clinic.
// lazy: a fourth copy of the capsule markup (kasir, stok, pembelian have theirs); hoisting one shared chip group is a shared-component task, not this mount.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ListPage } from "../../../../components/templates/templates";
import { loadCsPage } from "./data";
import { PATH } from "./load";
import { CsSummary } from "./view";

export type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export function ScopeChips({ branches, active }: { branches: { id: string; name: string }[]; active: string | null }) {
  if (branches.length < 2) return null;
  const chips = [{ id: null, name: "Semua Cabang", href: PATH }, ...branches.map((b) => ({ id: b.id, name: b.name, href: `${PATH}?cabang=${b.id}` }))];
  return (
    <div role="group" aria-label="Cabang" className="flex min-w-0 flex-wrap gap-1 justify-self-start rounded-[var(--radius-capsule)] bg-[var(--surface-2)] p-1">
      {chips.map((c) => (
        <Link key={c.id ?? "semua"} href={c.href} aria-current={c.id === active ? "true" : undefined}
          className={`inline-flex min-h-[var(--target)] items-center rounded-full px-4 text-[0.94rem] text-[var(--label)] no-underline ${c.id === active ? "bg-[var(--surface)] font-semibold shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : ""}`}>
          {c.name}
        </Link>
      ))}
    </div>
  );
}

export async function csBody(searchParams: Promise<SearchParams>) {
  const sp = await searchParams;
  const r = await loadCsPage({ cabang: one(sp.cabang) });
  if (r.kind === "redirect") redirect(r.to);
  if (r.kind === "not-found") notFound(); // another tenant's branch id (TEN-1)
  if (r.kind === "forbidden") return <ListPage as="section" title="Ringkasan CS" state={{ kind: "permission", object: "ringkasan CS" }} />;
  return (
    <>
      <CsSummary as="section" {...r.props} />
      <ScopeChips branches={r.branches} active={r.branchId} />
    </>
  );
}
