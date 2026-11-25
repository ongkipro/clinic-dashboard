// Konsol Vendor › Profil Vendor (UX-34, 19 §3; T-129 vendor UI subset). Platform owner only (19 §3); another vendor role gets the
// permission state. Read only and without a reader: the vendor
// login (clinic_vendor) holds no function that answers the legal identity or the residency gate — vendor_identity() is granted to
// the clinic app and vendor_go_live_blockers() to no login. The page says so and shows no identity field and no gate status.
// What exists today is named instead: the go-live blockers the database reports per clinic on its onboarding checklist.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { consoleGate } from "../_lib/server";
import { ConsoleShell, mayOpen, NotAvailable, PermissionState, RefusedScreen, tenantParam } from "../_lib/shell";
import s from "../_lib/console.module.css";

const HREF = "/vendor/profil";
const TITLE = "Profil Vendor";

export default async function ProfilPage({ searchParams }: { searchParams: Promise<{ tenant?: string | string[] }> }) {
  const gate = await consoleGate();
  if (gate.kind === "signed-out") redirect("/vendor/masuk");
  if (gate.kind === "enrol-totp") redirect("/vendor/aktifkan-2fa");
  if (gate.kind === "refused") return <RefusedScreen reason={gate.reason} />;
  const shell = (body: React.ReactNode) => <ConsoleShell user={gate.user} current={HREF}>{body}</ConsoleShell>;
  if (!mayOpen(gate.user.roles, HREF)) return shell(<PermissionState title={TITLE} />);
  if (tenantParam((await searchParams).tenant).kind === "invalid") notFound();
  return shell(
    <NotAvailable
      title={TITLE}
      lead="Badan usaha, NIB, PSE, NPWP, lokasi data dan pendapat hukum."
      why="Konsol Vendor belum punya pembaca profil vendor dan status gerbang residensi. Sampai pembaca itu dibangun, halaman ini tidak menampilkan identitas badan usaha atau status gerbang."
    >
      <p className={s.boxMuted}>Penghalang go-live yang berasal dari profil vendor tetap tercantum per klinik pada ceklis Onboarding.</p>
      <Link prefetch={false} href="/vendor/onboarding" className={s.plain}>
        Buka Onboarding
      </Link>
    </NotAvailable>,
  );
}
