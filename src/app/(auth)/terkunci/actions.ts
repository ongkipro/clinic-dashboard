"use server";
// IAM-7: unlock an idle-locked front-desk session by re-entering the password. The
// session comes from the request cookies; the action trusts nothing else from the
// client. Wrong passwords count toward the RATE-2 lockout (src/auth/server.ts).
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "../../../auth/instance";

export type UnlockState = { error?: string };

export async function unlockAction(_prev: UnlockState, form: FormData): Promise<UnlockState> {
  const password = form.get("password");
  if (typeof password !== "string" || password.length === 0 || password.length > 128) {
    return { error: "Masukkan kata sandi." };
  }
  const auth = await getAuth();
  const h = await headers();
  if ((await auth.checkSession(h, { activity: false })).gate === "anonymous") redirect("/masuk");
  if (!(await auth.unlock(h, password))) {
    const after = await auth.checkSession(h, { activity: false });
    if (after.gate === "anonymous") redirect("/masuk");
    return { error: "Kata sandi salah." };
  }
  redirect("/");
}
