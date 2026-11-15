"use server";
// The aftercare link's two actions (PR-70; T-096): ask for a WhatsApp code, then enter it. No staff session: the link token in the path is
// the credential (only its hash is stored), the code is hashed before it reaches SQL, and a verified session lives in an httpOnly cookie
// scoped to /aftercare (the booking host only). The client's IP (TRUSTED_IP_HEADER, default x-real-ip, set by the proxy) only reaches SQL
// hashed (RATE-1).
import { cookies, headers } from "next/headers";
import { sendAftercareOtp, TOKEN, verifyAftercareOtp } from "../../../../modules/crm/aftercare/aftercare";
import { appPool } from "../../../../modules/org/context/store";

import { SESSION_COOKIE, type OtpState } from "./labels";

const SEND_COPY: Record<string, { error: string; blocked?: boolean }> = {
  not_found: { error: "Tautan ini tidak dikenali. Hubungi klinik untuk panduan perawatan Anda.", blocked: true },
  link_expired: { error: "Tautan ini sudah kedaluwarsa. Hubungi klinik untuk panduan perawatan Anda.", blocked: true },
  otp_locked: { error: "Terlalu banyak percobaan. Coba lagi dalam 15 menit atau hubungi klinik.", blocked: true },
  rate_limited: { error: "Kode sudah dikirim beberapa kali. Tunggu beberapa menit, lalu coba lagi." },
  number_not_sending: { error: "Kode tidak dapat dikirim saat ini. Hubungi klinik untuk panduan perawatan Anda.", blocked: true },
  send_failed: { error: "Kode belum terkirim. Coba Lagi." },
};
const VERIFY_COPY: Record<string, { error: string; blocked?: boolean }> = {
  not_found: SEND_COPY.not_found,
  link_expired: SEND_COPY.link_expired,
  otp_locked: SEND_COPY.otp_locked,
  otp_expired: { error: "Kode sudah kedaluwarsa. Kirim kode baru." },
  otp_invalid: { error: "Kode salah." },
};

export async function sendCodeAction(token: string): Promise<OtpState> {
  if (!TOKEN.test(token)) return { step: "send", ...SEND_COPY.not_found };
  // the proxy's trusted client-IP header, as the vendor console and auth read it (review r1 P3-3)
  const name = (process.env.TRUSTED_IP_HEADER ?? "x-real-ip").toLowerCase();
  const ip = (/^[a-z0-9-]{1,64}$/.test(name) ? (await headers()).get(name) : null) ?? "unknown";
  const r = await sendAftercareOtp(await appPool(), token, ip);
  if (!r.ok) return { step: "send", ...SEND_COPY[r.reason] };
  return { step: "code", message: "Kode verifikasi dikirim." };
}

export async function verifyCodeAction(token: string, _prev: OtpState, form: FormData): Promise<OtpState> {
  const code = String(form.get("code") ?? "").replace(/\s+/g, "");
  if (!/^[0-9]{6}$/.test(code)) return { step: "code", error: "Masukkan 6 angka kode verifikasi." };
  const r = await verifyAftercareOtp(await appPool(), token, code);
  if (!r.ok) {
    const c = VERIFY_COPY[r.reason];
    const left = r.reason === "otp_invalid" && r.attempts_remaining != null ? ` Sisa ${r.attempts_remaining} percobaan.` : "";
    return { step: r.reason === "otp_expired" ? "send" : "code", error: c.error + left, blocked: c.blocked };
  }
  (await cookies()).set(SESSION_COOKIE, r.sessionToken, { httpOnly: true, sameSite: "lax", path: "/aftercare",
    secure: process.env.APP_URL?.startsWith("https://") ?? false, maxAge: 30 * 60 });
  return { step: "done", message: "Identitas terverifikasi." };
}
