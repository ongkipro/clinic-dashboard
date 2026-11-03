"use client";
import { SecurityPanel, type SessionView } from "../../(auth)/security-panel";

async function endSession(id: string): Promise<boolean> {
  const r = await fetch("/vendor/api/console/session-end", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: id }),
  }).catch(() => null);
  return Boolean(r?.ok);
}

export function VendorSecurity({ email, totpEnabled, sessions }: { email: string; totpEnabled: boolean; sessions: SessionView[] }) {
  return (
    <SecurityPanel
      base="/vendor/api/auth"
      here="/vendor/keamanan"
      enrolPath="/vendor/aktifkan-2fa"
      email={email}
      totpEnabled={totpEnabled}
      totpRequired
      sessions={sessions}
      endSession={endSession}
    />
  );
}
