// Saya › Profil & Keamanan (19 §2.16, DEC-033): every staff member and owner changes the
// password, manages the authenticator and sees active sessions. No tenant data: the page
// reads only this account's auth rows (server side, by the request's session).
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getAuth } from "../../../../auth/instance";
import { LoadingList } from "../../../../components/ui/states";
import { deviceLabel } from "../../../../auth/policy";
import { SecurityPanel } from "../../../(auth)/security-panel";
import { endOwnSessionAction } from "./actions";

export const metadata: Metadata = { title: "Profil & Keamanan — Clinic Dashboard" };

const when = new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" });

async function Body() {
  await connection();
  const auth = await getAuth();
  const h = await headers();
  const gate = await auth.checkSession(h);
  if (gate.gate === "anonymous") redirect("/masuk");
  if (gate.gate === "enrol_totp") redirect("/aktifkan-2fa");
  if (gate.gate === "locked") redirect("/terkunci");
  const me = await auth.ownSecurity(h);
  if (!me) redirect("/masuk");
  return (
    <>
      <p className="m-0 text-[var(--label-2)] [overflow-wrap:anywhere]">{me.email}</p>
      <SecurityPanel
        here="/saya/keamanan"
        enrolPath="/aktifkan-2fa"
        email={me.email}
        totpEnabled={me.totpEnabled}
        totpRequired={me.totpRequired}
        sessions={me.sessions.map((x) => ({ id: x.id, device: deviceLabel(x.userAgent), ip: x.ipAddress, since: when.format(x.createdAt), current: x.current }))}
        endSession={endOwnSessionAction}
      />
    </>
  );
}

export default function Page() {
  return (
    <main className="mx-auto grid w-full max-w-[640px] min-w-0 gap-4">
      <h1 className="m-0 text-[2rem] font-bold leading-tight">Profil & Keamanan</h1>
      <Suspense fallback={<LoadingList rows={3} />}>
        <Body />
      </Suspense>
    </main>
  );
}
