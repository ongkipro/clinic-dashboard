// Konsol Vendor › Feature Flag Platform (UX-40 ▸ Flag, 19 §3, ADR-7; T-129 vendor UI subset). Platform owner only; another vendor
// role gets the permission state. Release 1 has no tender feature and no flag table: the catalogue is empty, and the page has no
// control that could change anything.
import { notFound, redirect } from "next/navigation";
import { consoleGate } from "../_lib/server";
import { ConsoleShell, mayOpen, PermissionState, RefusedScreen, tenantParam } from "../_lib/shell";
import s from "../_lib/console.module.css";

const HREF = "/vendor/flag";
const TITLE = "Feature Flag Platform";

export default async function FlagPage({ searchParams }: { searchParams: Promise<{ tenant?: string | string[] }> }) {
  const gate = await consoleGate();
  if (gate.kind === "signed-out") redirect("/vendor/masuk");
  if (gate.kind === "enrol-totp") redirect("/vendor/aktifkan-2fa");
  if (gate.kind === "refused") return <RefusedScreen reason={gate.reason} />;
  const shell = (body: React.ReactNode) => <ConsoleShell user={gate.user} current={HREF}>{body}</ConsoleShell>;
  if (!mayOpen(gate.user.roles, HREF)) return shell(<PermissionState title={TITLE} />);
  if (tenantParam((await searchParams).tenant).kind === "invalid") notFound();
  return shell(
    <div className={s.page}>
      <h1 className={s.title}>{TITLE}</h1>
      <p className={s.lead}>Fitur khusus tender per klinik.</p>
      <div className={s.box} role="status" data-state="empty">
        <p className={s.boxText}>Belum ada fitur khusus tender.</p>
        <p className={s.boxMuted}>Rilis 1 tidak memiliki fitur khusus tender, jadi tidak ada yang dapat diaktifkan dari halaman ini.</p>
      </div>
    </div>,
  );
}
