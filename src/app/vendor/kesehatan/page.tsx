// Konsol Vendor › Kesehatan Platform (UX-45, PR-62, 19 §3; T-118). Platform owner and support (IAM-10); other vendor roles see the
// permission state (the database refuses and logs them too). Read only. Scenario PR-62: counts and ages are shown and no patient name or
// message text appears (the reader returns aggregates; model.ts projects an allowlist).
import { redirect } from "next/navigation";
import { consoleGate } from "../_lib/server";
import { ConsoleShell, RefusedScreen } from "../_lib/shell";
import { readHealth } from "./data";
import { HEALTH_ROLES, parseFilter, resolveView } from "./model";
import { HealthView } from "./view";

export default async function KesehatanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const gate = await consoleGate();
  if (gate.kind === "signed-out") redirect("/vendor/masuk");
  if (gate.kind === "enrol-totp") redirect("/vendor/aktifkan-2fa");
  if (gate.kind === "refused") return <RefusedScreen reason={gate.reason} />;
  const q = await searchParams;
  const allowed = gate.user.roles.some((r) => (HEALTH_ROLES as readonly string[]).includes(r));
  const r = allowed ? await readHealth(gate.caller) : null;
  // A role refusal after the gate (role changed since) is the permission state; any other failure the error state with Coba Lagi.
  const state = resolveView({
    allowed: allowed && !(r && !r.ok && r.reason === "role_not_held"),
    read: r && r.ok ? { ok: true, raw: r.data } : { ok: false },
    filter: parseFilter({ penyedia: q.penyedia, perlu: q.perlu }),
  });
  return <ConsoleShell user={gate.user} current="/vendor/kesehatan"><HealthView state={state} /></ConsoleShell>;
}
