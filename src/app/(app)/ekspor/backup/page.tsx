// UX-32 ▸ Backup status page (PR-52, DR-1; T-122 D7).
// Owner-only; reports honest "not_measured" until vendor backup/drill telemetry lands in T-131.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LoadingList } from "../../../../components/ui/states";
import { requestContext } from "../../../../modules/org/context/store";
import { projectBackup } from "./model";
import { BackupView } from "./view";

export const metadata: Metadata = { title: "Status Backup — Clinic Dashboard" };

async function Body() {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  const actingRole = rc.kind === "blocked" ? "" : rc.active.context.actingRole;
  const model = projectBackup({ actingRole, source: null, now: new Date() });
  return <BackupView model={model} />;
}

export default function Page() {
  return (
    <main className="w-full min-w-0">
      <Suspense fallback={<LoadingList label="Memuat status backup" />}>
        <Body />
      </Suspense>
    </main>
  );
}
