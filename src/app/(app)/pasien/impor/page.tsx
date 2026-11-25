// UX-1 / UX-41 ▸ Impor Data Awal page (PR-85, DATA-58, ARCH-10; T-128).
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../../components/ui/states";
import { loadImportWorkspace } from "./data";
import { ImportWorkspaceView } from "./view";

export const metadata: Metadata = { title: "Impor Data Awal — Clinic Dashboard" };

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-5">{children}</main>;
}

async function Body() {
  const loaded = await loadImportWorkspace();
  if (loaded.kind === "redirect") redirect(loaded.to);
  if (loaded.kind === "forbidden") {
    return (
      <Shell>
        <PageTitle title="Impor Data Awal" />
        <PermissionState object="impor data awal" />
      </Shell>
    );
  }
  return (
    <Shell>
      <PageTitle title="Impor Data Awal" />
      <ImportWorkspaceView
        ctx={loaded.ctx}
        gateBlockers={loaded.gateBlockers}
        batches={loaded.batches}
      />
    </Shell>
  );
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <Shell>
          <PageTitle title="Impor Data Awal" />
          <LoadingList label="Memuat ruang kerja impor data awal" />
        </Shell>
      }
    >
      <Body />
    </Suspense>
  );
}
