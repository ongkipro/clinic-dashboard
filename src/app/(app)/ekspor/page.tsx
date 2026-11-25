// UX-32 Ekspor Data Klinik page (PR-52; T-122).
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LoadingList } from "../../../components/ui/states";
import { withTenantContext } from "../../../db/rls/context";
import { listTenantExports } from "../../../modules/export/tenant.export";
import { renderedContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { OWNER_ONLY, projectEkspor } from "./model";
import { EksporView } from "./view";

export const metadata: Metadata = { title: "Ekspor Data Klinik — Clinic Dashboard" };

async function Body() {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") {
    return <EksporView model={{ kind: "blocked", ...OWNER_ONLY }} />;
  }
  const { context } = rc.active;
  if (context.actingRole !== "owner") {
    return <EksporView model={{ kind: "blocked", ...OWNER_ONLY }} />;
  }
  const ctx = renderedContext(context);
  let model: ReturnType<typeof projectEkspor> = { kind: "error" };
  try {
    const data = await withTenantContext(await appPool(), context, (db) => listTenantExports(db));
    model = projectEkspor({ actingRole: context.actingRole, reader: { jobs: data.jobs }, now: new Date(data.now) });
  } catch {
    model = { kind: "error" };
  }
  return <EksporView model={model} ctx={ctx} />;
}

export default function Page() {
  return (
    <main className="w-full min-w-0">
      <Suspense fallback={<LoadingList label="Memuat riwayat ekspor data" />}>
        <Body />
      </Suspense>
    </main>
  );
}
