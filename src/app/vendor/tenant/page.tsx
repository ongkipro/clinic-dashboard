// Konsol Vendor › Tenant (UX-40, first columns; the rest of the row — monthly fee,
// go-live, payment status, health — and the tenant detail arrive with T-023, T-103,
// T-118). Lifecycle state, legal name and branch count only: platform pages never show
// patient, staff or clinical data (PR-60). Tenant names are tenant-controlled: rendered
// as React text (escaped, SEC-21).
import Link from "next/link";
import { redirect } from "next/navigation";
import { call, consoleGate } from "../_lib/server";
import { ConsoleShell, RefusedScreen } from "../_lib/shell";
import { type TenantRow, TenantList } from "./tenant-list";
import s from "../_lib/console.module.css";

export default async function TenantPage() {
  const gate = await consoleGate();
  if (gate.kind === "signed-out") redirect("/vendor/masuk");
  if (gate.kind === "enrol-totp") redirect("/vendor/aktifkan-2fa");
  if (gate.kind === "refused") return <RefusedScreen reason={gate.reason} />;
  // A refusal here (role or session changed since the gate) or a database error shows the
  // error state (error.tsx) with Coba Lagi.
  const r = await call<{ rows: TenantRow[] }>("vendor_console_tenants", gate.caller);
  if (!r.ok) throw new Error("vendor_console_tenants refused");
  const rows = r.data.rows;
  return (
    <ConsoleShell user={gate.user} current="/vendor/tenant">
      <div className={s.page}>
        <div className={s.header}>
          <h1 className={s.title}>Tenant</h1>
          {gate.user.roles.some((r) => r === "onboarding" || r === "platform_owner") && (
            <Link prefetch={false} className={s.primary} href="/vendor/tenant/baru">
              Buat Tenant
            </Link>
          )}
        </div>
        <TenantList rows={rows} />
      </div>
    </ConsoleShell>
  );
}
