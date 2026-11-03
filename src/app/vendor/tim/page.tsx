// Konsol Vendor › Tim Vendor (UX-46 minimal, HYG-003, DEC-036): vendor staff with roles,
// state and TOTP enrolment; open invitations; Undang; Nonaktifkan / Aktifkan Kembali.
// Platform owner only (19 §3); other roles see a permission state. Names and emails are
// rendered as React text only.
import { redirect } from "next/navigation";
import { listTeam } from "../../../modules/vendor/team/team";
import { consoleGate, vendorPool } from "../_lib/server";
import { ConsoleShell, RefusedScreen } from "../_lib/shell";
import { TeamView } from "./team-view";
import s from "../_lib/console.module.css";

const when = new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "Asia/Jakarta" });

export default async function TimVendorPage() {
  const gate = await consoleGate();
  if (gate.kind === "signed-out") redirect("/vendor/masuk");
  if (gate.kind === "enrol-totp") redirect("/vendor/aktifkan-2fa");
  if (gate.kind === "refused") return <RefusedScreen reason={gate.reason} />;
  if (!gate.user.roles.includes("platform_owner")) {
    return (
      <ConsoleShell user={gate.user} current="/vendor/tim">
        <div className={`${s.page} ${s.narrow}`}>
          <h1 className={s.title}>Tim Vendor</h1>
          <div className={s.box} role="status">
            <p className={s.boxText}>
              <strong>Hanya Pemilik Platform yang mengelola Tim Vendor.</strong> Hubungi Pemilik Platform untuk menambah atau mengubah anggota.
            </p>
          </div>
        </div>
      </ConsoleShell>
    );
  }
  const r = await listTeam(await vendorPool(), gate.caller);
  if (!r.ok) throw new Error("vendor_console_staff_list refused");
  return (
    <ConsoleShell user={gate.user} current="/vendor/tim">
      <div className={s.page}>
        <h1 className={s.title}>Tim Vendor</h1>
        <TeamView
          me={r.data.me}
          staff={r.data.staff}
          invitations={r.data.invitations.map((i) => ({ ...i, expires: when.format(new Date(i.expires_at)) }))}
        />
      </div>
    </ConsoleShell>
  );
}
