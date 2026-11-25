// Konsol Vendor › Integrasi (UX-42, 19 §3; T-129 vendor UI subset). Support only (19 §3); another vendor role gets the permission
// state. Read only and without a reader: the cross-tenant integration reader (WABA, SATUSEHAT, payment webhooks) is not built.
// The page says so and shows no figure, no status and no action.
// ?tenant= must be one well-formed tenant id or absent; anything else is not found (never read as "all tenants").
import { notFound, redirect } from "next/navigation";
import { consoleGate } from "../_lib/server";
import { ConsoleShell, mayOpen, NotAvailable, PermissionState, RefusedScreen, tenantParam } from "../_lib/shell";

const HREF = "/vendor/integrasi";
const TITLE = "Integrasi";

export default async function IntegrasiPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const gate = await consoleGate();
  if (gate.kind === "signed-out") redirect("/vendor/masuk");
  if (gate.kind === "enrol-totp") redirect("/vendor/aktifkan-2fa");
  if (gate.kind === "refused") return <RefusedScreen reason={gate.reason} />;
  const shell = (body: React.ReactNode) => <ConsoleShell user={gate.user} current={HREF}>{body}</ConsoleShell>;
  if (!mayOpen(gate.user.roles, HREF)) return shell(<PermissionState title={TITLE} />);
  if (tenantParam((await searchParams).tenant).kind === "invalid") notFound();
  return shell(<NotAvailable title={TITLE} lead="Status WABA, SATUSEHAT dan webhook pembayaran per klinik." why="Konsol Vendor belum punya pembaca status integrasi. Sampai pembaca itu dibangun, halaman ini tidak menampilkan angka atau status apa pun." />);
}
