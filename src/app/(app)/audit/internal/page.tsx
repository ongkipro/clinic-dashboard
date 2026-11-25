// Audit Internal page (UX-53, PR-63, PR-72; 19 §2.14).
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { todayJakarta } from "./data";
import { AUDIT_INTERNAL_TITLE } from "./labels";
import { loadAuditInternalPage } from "./server";
import { AuditInternalView } from "./view";

export const metadata: Metadata = { title: `${AUDIT_INTERNAL_TITLE} — Clinic Dashboard` };

async function Body({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const res = await loadAuditInternalPage(await searchParams);
  if (res.kind === "redirect") redirect(res.to);
  if (res.kind === "not-found") notFound();
  if (res.kind === "forbidden") {
    return (
      <ListPage
        as="section"
        title={AUDIT_INTERNAL_TITLE}
        state={{ kind: "permission", object: "audit internal" }}
      />
    );
  }
  return <AuditInternalView data={res.data} today={todayJakarta()} />;
}

export default function AuditInternalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={6} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
