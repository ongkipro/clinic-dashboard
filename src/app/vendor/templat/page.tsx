// Konsol Vendor › Templat Global (UX-54, 19 §3; T-129 vendor UI subset). Platform owner only open it; another vendor role gets the permission
// state. Read only and without a reader: the template reader and writers are not built.
// The page says so and shows no figure, no status and no action.
// ?tenant= must be one well-formed tenant id or absent; anything else is not found (never read as "all tenants").
import { notFound, redirect } from "next/navigation";
import { consoleGate } from "../_lib/server";
import { ConsoleShell, mayOpen, NotAvailable, PermissionState, RefusedScreen, tenantParam } from "../_lib/shell";

const HREF = "/vendor/templat";
const TITLE = "Templat Global";

export default async function TemplatPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const gate = await consoleGate();
  if (gate.kind === "signed-out") redirect("/vendor/masuk");
  if (gate.kind === "enrol-totp") redirect("/vendor/aktifkan-2fa");
  if (gate.kind === "refused") return <RefusedScreen reason={gate.reason} />;
  const shell = (body: React.ReactNode) => <ConsoleShell user={gate.user} current={HREF}>{body}</ConsoleShell>;
  if (!mayOpen(gate.user.roles, HREF)) return shell(<PermissionState title={TITLE} />);
  if (tenantParam((await searchParams).tenant).kind === "invalid") notFound();
  return shell(<NotAvailable title={TITLE} lead="Templat halaman legal situs dan pesan sistem." why="Konsol Vendor belum punya pembaca dan penyunting templat. Sampai itu dibangun, halaman ini tidak menampilkan atau mengubah templat apa pun." />);
}
