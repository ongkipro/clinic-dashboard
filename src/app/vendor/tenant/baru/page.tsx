// Konsol Vendor › Tenant › Buat Tenant (UX-40, PR-1, DEC-033): legal entity, first branch
// and the person who becomes the clinic's first Owner (contract contact). Onboarding staff
// and platform owners only; the database checks role, IP and the 10-minute step-up again.
import { redirect } from "next/navigation";
import { consoleGate } from "../../_lib/server";
import { ConsoleShell, RefusedScreen } from "../../_lib/shell";
import { CreateTenantForm } from "./create-form";
import s from "../../_lib/console.module.css";

export default async function BuatTenantPage() {
  const gate = await consoleGate();
  if (gate.kind === "signed-out") redirect("/vendor/masuk");
  if (gate.kind === "enrol-totp") redirect("/vendor/aktifkan-2fa");
  if (gate.kind === "refused") return <RefusedScreen reason={gate.reason} />;
  const may = gate.user.roles.some((r) => r === "onboarding" || r === "platform_owner");
  return (
    <ConsoleShell user={gate.user} current="/vendor/tenant">
      <div className={`${s.page} ${s.narrow}`}>
        <h1 className={s.title}>Buat Tenant</h1>
        {may ? (
          <>
            <p className={s.lead}>Tenant dibuat dalam status Penyiapan. Undangan Owner perlu disetujui Pemilik Platform lain sebelum tautannya bisa dikirim.</p>
            <CreateTenantForm />
          </>
        ) : (
          <div className={s.box} role="status">
            <p className={s.boxText}>
              <strong>Hanya Onboarding atau Pemilik Platform yang bisa membuat tenant.</strong> Minta Pemilik Platform menambahkan peran Onboarding untuk Anda.
            </p>
          </div>
        )}
      </div>
    </ConsoleShell>
  );
}
