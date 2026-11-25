// Konsol Vendor › Audit Vendor (UX-47, 19 §3; T-129 vendor UI subset). Platform owner and vendor auditor open it; another vendor role gets the permission
// state. Read only and without a reader: the vendor-action list and its export are not built.
// The page says so and shows no figure, no status and no action.
// ?tenant= must be one well-formed tenant id or absent; anything else is not found (never read as "all tenants").
import { notFound, redirect } from "next/navigation";
import { consoleGate } from "../_lib/server";
import { ConsoleShell, mayOpen, NotAvailable, PermissionState, RefusedScreen, tenantParam } from "../_lib/shell";

const HREF = "/vendor/audit";
const TITLE = "Audit Vendor";

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const gate = await consoleGate();
  if (gate.kind === "signed-out") redirect("/vendor/masuk");
  if (gate.kind === "enrol-totp") redirect("/vendor/aktifkan-2fa");
  if (gate.kind === "refused") return <RefusedScreen reason={gate.reason} />;
  const shell = (body: React.ReactNode) => <ConsoleShell user={gate.user} current={HREF}>{body}</ConsoleShell>;
  if (!mayOpen(gate.user.roles, HREF)) return shell(<PermissionState title={TITLE} />);
  if (tenantParam((await searchParams).tenant).kind === "invalid") notFound();
  return shell(<NotAvailable title={TITLE} lead="Semua aksi vendor." why="Konsol Vendor belum punya pembaca log aksi vendor dan ekspornya. Sampai pembaca itu dibangun, halaman ini tidak menampilkan aksi apa pun." />);
}
