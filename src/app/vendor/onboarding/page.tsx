// Konsol Vendor › Onboarding (UX-41, PR-59): the tenants in onboarding, each opening its checklist.
// Platform page: lifecycle state, legal name and branch count only (vendor_console_tenants); never
// patient, staff or clinical data (PR-60). Tenant names are React text (SEC-21).
import Link from "next/link";
import { redirect } from "next/navigation";
import { call, consoleGate } from "../_lib/server";
import { ConsoleShell, RefusedScreen } from "../_lib/shell";
import type { TenantRow } from "../tenant/tenant-list";
import s from "../_lib/console.module.css";

const count = new Intl.NumberFormat("id-ID");

export default async function OnboardingPage() {
  const gate = await consoleGate();
  if (gate.kind === "signed-out") redirect("/vendor/masuk");
  if (gate.kind === "enrol-totp") redirect("/vendor/aktifkan-2fa");
  if (gate.kind === "refused") return <RefusedScreen reason={gate.reason} />;
  const r = await call<{ rows: TenantRow[] }>("vendor_console_tenants", gate.caller);
  if (!r.ok) throw new Error("vendor_console_tenants refused");
  const rows = r.data.rows.filter((t) => t.state === "onboarding");
  return (
    <ConsoleShell user={gate.user} current="/vendor/onboarding">
      <div className={s.page}>
        <div className={s.header}>
          <h1 className={s.title}>Onboarding</h1>
        </div>
        {rows.length === 0 ? (
          <div className={s.box} role="status">
            <p className={s.boxText}>Tidak ada klinik dalam onboarding.</p>
            <p className={s.boxMuted}>Klinik masuk ke sini setelah Mulai Onboarding di halaman Tenant.</p>
          </div>
        ) : (
          <>
            <p className={s.lead}>{count.format(rows.length)} klinik dalam onboarding</p>
            <ul className={`${s.cards} ${s.cardsAlways}`} aria-label="Klinik dalam onboarding">
              {rows.map((t) => (
                <li key={t.id} className={s.card}>
                  <Link prefetch={false} className={s.cardLink} href={`/vendor/onboarding/${t.id}`}>
                    {t.name ?? "Belum ada nama badan usaha"}
                  </Link>
                  <dl className={s.cardMeta}>
                    <dt>Cabang</dt>
                    <dd>{count.format(t.branches)}</dd>
                  </dl>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </ConsoleShell>
  );
}
