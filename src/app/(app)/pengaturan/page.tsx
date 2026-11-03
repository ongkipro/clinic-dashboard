// Pengaturan (19 §2.17): the setting groups the acting role has rows in.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle, Row, RowList } from "../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../components/ui/states";
import { loadIndex } from "./data";

export const metadata: Metadata = { title: "Pengaturan — Clinic Dashboard" };

async function Body() {
  const p = await loadIndex();
  if (p.kind === "redirect") redirect(p.to);
  if (p.kind === "forbidden") return <PermissionState object="pengaturan" />;
  return (
    <RowList label="Kelompok pengaturan">
      {p.groups.map((g) => <Row key={g.slug} href={`/pengaturan/${g.slug}`} title={g.label} subtitle={`${g.count} pengaturan`} />)}
    </RowList>
  );
}

export default function PengaturanPage() {
  return (
    <main className="mx-auto grid w-full max-w-[880px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <PageTitle title="Pengaturan" />
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body />
      </Suspense>
    </main>
  );
}
