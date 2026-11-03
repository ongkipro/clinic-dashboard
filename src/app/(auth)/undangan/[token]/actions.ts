"use server";
// Accept a staff invitation (UX-3, IAM-1: staff accounts by invitation only). The token
// names the invitation; a new account is created for the invited email with the IAM-1
// password policy, then the membership with the invited roles and branches
// (acceptWithNewAccount). An email that already has an account signs in first and accepts
// from the same page (future: T-024). TOTP roles enrol at the first sign-in (T-006 gate).
// The inviter sends the link personally (DEC-031 D1); it works once until it expires.
import { redirect } from "next/navigation";
import { getAuth } from "../../../../auth/instance";
import { AccountExistsError, PasswordPolicyError } from "../../../../auth/server";
import { appPool } from "../../../../modules/org/context/store";
import { acceptWithNewAccount } from "../../../../modules/org/staff/staff";

export type AcceptState = { error?: string };

const GONE = "Undangan sudah tidak berlaku. Minta undangan baru ke klinik Anda.";

export async function acceptAction(_prev: AcceptState, form: FormData): Promise<AcceptState> {
  const token = form.get("token");
  const password = form.get("password");
  const confirm = form.get("confirm");
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return { error: "Undangan tidak valid." };
  if (typeof password !== "string" || typeof confirm !== "string" || password.length > 128) return { error: "Masukkan kata sandi." };
  if (password !== confirm) return { error: "Kedua kata sandi tidak sama." };
  let accepted;
  try {
    accepted = await acceptWithNewAccount(await appPool(), await getAuth(), token, password);
  } catch (e) {
    if (e instanceof PasswordPolicyError) return { error: e.message };
    if (e instanceof AccountExistsError) return { error: "Email ini sudah punya akun. Masuk dulu, lalu buka tautan undangan lagi." };
    throw e;
  }
  if (!accepted) return { error: GONE };
  redirect("/masuk?undangan=diterima");
}
