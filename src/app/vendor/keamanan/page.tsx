// Konsol Vendor › Keamanan (DEC-033): the same self-service as the clinic app's Profil &
// Keamanan, on the vendor surface (its own auth API, cookies and sessions). Every vendor
// account requires TOTP, so the authenticator can be replaced but never turned off.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { deviceLabel } from "../../../auth/policy";
import { consoleGate, vendorAuth } from "../_lib/server";
import { ConsoleShell, RefusedScreen } from "../_lib/shell";
import { VendorSecurity } from "./vendor-security";
import s from "../_lib/console.module.css";

const when = new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" });

export default async function VendorKeamananPage() {
  const gate = await consoleGate();
  if (gate.kind === "signed-out") redirect("/vendor/masuk");
  if (gate.kind === "enrol-totp") redirect("/vendor/aktifkan-2fa");
  if (gate.kind === "refused") return <RefusedScreen reason={gate.reason} />;
  const me = await (await vendorAuth()).ownSecurity(await headers());
  if (!me) redirect("/vendor/masuk");
  return (
    <ConsoleShell user={gate.user} current="/vendor/keamanan">
      <div className={`${s.page} ${s.narrow}`}>
        <h1 className={s.title}>Keamanan Akun</h1>
        <p className={s.lead}>{me.email}</p>
        <VendorSecurity
          email={me.email}
          totpEnabled={me.totpEnabled}
          sessions={me.sessions.map((x) => ({ id: x.id, device: deviceLabel(x.userAgent), ip: x.ipAddress, since: when.format(x.createdAt), current: x.current }))}
        />
      </div>
    </ConsoleShell>
  );
}
