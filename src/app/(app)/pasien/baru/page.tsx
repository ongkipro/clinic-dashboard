// Pendaftaran Pasien (UX-4, 19:53, PR-5, T-037): search first, then register. FO/cashier and central CS
// only (the database decides as well); central CS on "Semua Cabang" chooses the registration branch.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../../components/ui/states";
import { renderedContext } from "../../../../modules/org/context/context";
import { requestContext } from "../../../../modules/org/context/store";
import { RegisterForm, SearchFirst } from "./forms";

export const metadata: Metadata = { title: "Pendaftaran Pasien — Clinic Dashboard" };
const REGISTRARS = ["fo_cashier", "central_cs"];

async function Body() {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  // The title stays (NAV-1): only the page's controls are absent for a role that may not register.
  if (rc.kind === "blocked" || !REGISTRARS.includes(rc.active.context.actingRole)) {
    return (
      <main className="mx-auto grid w-full max-w-[760px] min-w-0 gap-5">
        <PageTitle title="Pendaftaran Pasien" />
        <PermissionState object="pendaftaran pasien" />
      </main>
    );
  }
  const ctx = renderedContext(rc.active.context);
  const needsBranch = !rc.active.context.activeBranchId;
  return (
    <main className="mx-auto grid w-full max-w-[760px] min-w-0 gap-5">
      <PageTitle title="Pendaftaran Pasien" />
      <section aria-labelledby="cari-dulu" className="grid min-w-0 gap-2">
        <h2 id="cari-dulu" className="m-0 text-[1.18rem] font-semibold">Cari dulu</h2>
        <div className="rounded-[var(--radius-group)] bg-[var(--surface)] p-4"><SearchFirst ctx={ctx} /></div>
      </section>
      <section aria-labelledby="pasien-baru" className="grid min-w-0 gap-2">
        <h2 id="pasien-baru" className="m-0 text-[1.18rem] font-semibold">Pasien baru</h2>
        <RegisterForm ctx={ctx} branches={rc.active.branches} needsBranch={needsBranch} />
      </section>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingList label="Memuat" />}>
      <Body />
    </Suspense>
  );
}
