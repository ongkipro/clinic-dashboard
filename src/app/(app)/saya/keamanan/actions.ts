"use server";
// Profil & Keamanan › Sesi Aktif: end one of this account's other sessions. The account
// comes from the request cookies; the id only picks among its own sessions
// (endOwnSession refuses the current session and anyone else's).
import { headers } from "next/headers";
import { getAuth } from "../../../../auth/instance";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function endOwnSessionAction(id: string): Promise<boolean> {
  if (typeof id !== "string" || !UUID.test(id)) return false;
  const auth = await getAuth();
  const h = await headers();
  if ((await auth.checkSession(h)).gate !== "ok") return false;
  return auth.endOwnSession(h, id);
}
