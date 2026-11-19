// Ringkasan per peran (UX-60, 19 §2.1; T-107): one route for the six role homes. The navigation (src/components/shell/nav.ts)
// links Ringkasan Klinis, Marketing, Apotek, Pembelian, Audit and Ruang Saya all to /ringkasan/peran; this page picks the home by the
// server-resolved acting role. Any other role gets the permission state (NAV-1); each home's readers re-check the role in SQL.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import type { Role } from "../../../../auth/policy";
import { PageTitle } from "../../../../components/templates/templates";
import Link from "next/link";
import { LoadingList, PermissionState } from "../../../../components/ui/states";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import type { ActingContext } from "../../../../modules/org/identity";
import { type RoleHome, roleHome } from "../../../../modules/reporting/dashboards/dashboards";
import { RoleHomeView } from "./role-home-view";
import { RuangSayaHome } from "./ruang-saya/home";

export const metadata: Metadata = { title: "Ringkasan — Clinic Dashboard" };

// The five dashboard_home homes: one reader call in the request's context. A refusal from the database (the role check in SQL) is the
// permission state; any other failure is the error state, logged without content.
async function load(context: ActingContext): Promise<RoleHome | "permission" | "error"> {
  try {
    return await withTenantContext(await appPool(), context, (db) => roleHome(db));
  } catch (e) {
    if (e instanceof CommandError && (e.code === "ERR_FORBIDDEN" || e.code === "ERR_NOT_FOUND")) return "permission";
    console.error("ringkasan/peran: reader failed", { error: e instanceof Error ? e.name : "unknown" });
    return "error";
  }
}
async function DashboardHome({ context, title }: { context: ActingContext; title: string }) {
  const d = await load(context);
  if (d === "permission") return <><PageTitle title={title} /><PermissionState object="ringkasan ini" /></>;
  if (d === "error") {
    return (
      <>
        <PageTitle title={title} />
        <div role="alert" className="grid gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
          <p className="m-0 text-[var(--danger)]">Ringkasan belum dapat ditampilkan. Tidak ada yang berubah.</p>
          <Link href="/ringkasan/peran" className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]">Coba Lagi</Link>
        </div>
      </>
    );
  }
  return <RoleHomeView data={d} />;
}

type Home = { title: string; render: (c: ActingContext) => React.ReactNode };
// 19 §2.1 rows (titles as in the navigation).
const dash = (title: string): Home => ({ title, render: (c) => <DashboardHome context={c} title={title} /> });
const HOMES: Partial<Record<Role, Home>> = {
  facility_head: dash("Ringkasan Klinis"),
  marketing: dash("Ringkasan Marketing"),
  pharmacist: dash("Ringkasan Apotek"),
  purchasing: dash("Ringkasan Pembelian"),
  auditor: dash("Ringkasan Audit"),
  nurse: { title: "Ruang Saya", render: (c) => <RuangSayaHome context={c} /> },
  therapist: { title: "Ruang Saya", render: (c) => <RuangSayaHome context={c} /> },
};
async function Body() {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return <><PageTitle title="Ringkasan" /><PermissionState object="ringkasan ini" /></>;
  const c = rc.active.context;
  const home = HOMES[c.actingRole];
  if (!home) return <><PageTitle title="Ringkasan" /><PermissionState object="ringkasan ini" /></>;
  return home.render(c);
}

export default function RingkasanPeranPage() {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body />
      </Suspense>
    </main>
  );
}
