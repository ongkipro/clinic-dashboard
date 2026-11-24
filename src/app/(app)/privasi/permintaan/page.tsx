// UX-30 ▸ Permintaan list page (PR-50; T-121).
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../../components/ui/states";
import { loadDsrList } from "./data";
import { LogDsrForm } from "./forms";
import { parseFilter } from "./model";
import { RequestListView } from "./view";

export const metadata: Metadata = { title: "Permintaan Data Pasien — Clinic Dashboard" };
type Q = { status?: string; hak?: string };

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-5">{children}</main>;
}

async function Body({ searchParams }: { searchParams: Promise<Q> }) {
  const q = await searchParams;
  const loaded = await loadDsrList();
  if (loaded.kind === "redirect") redirect(loaded.to);
  if (loaded.kind === "forbidden") {
    return (
      <Shell>
        <PageTitle title="Permintaan Data Pasien" />
        <PermissionState object="permintaan data pasien" />
      </Shell>
    );
  }
  const filter = parseFilter(q);
  return (
    <Shell>
      <PageTitle title="Permintaan Data Pasien" />
      <RequestListView rows={loaded.data.rows} filter={filter} now={loaded.data.now} />
      <LogDsrForm ctx={loaded.ctx} />
    </Shell>
  );
}

export default function Page({ searchParams }: { searchParams: Promise<Q> }) {
  return (
    <Suspense
      fallback={
        <Shell>
          <PageTitle title="Permintaan Data Pasien" />
          <LoadingList label="Memuat daftar permintaan data pasien" />
        </Shell>
      }
    >
      <Body searchParams={searchParams} />
    </Suspense>
  );
}
