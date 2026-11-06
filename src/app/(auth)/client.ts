// Calls the Better Auth API on the same origin. Errors map to the UI-5 copy patterns;
// raw server messages are never shown.
export type ApiResult = { ok: true; data: Record<string, unknown> } | { ok: false; message: string };

export const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "Email atau kata sandi salah.",
  LOGIN_TEMPORARILY_LOCKED: "Terlalu banyak percobaan masuk. Coba lagi dalam 15 menit.",
  INVALID_CODE: "Kode tidak cocok. Periksa jam di ponsel Anda lalu coba lagi.",
  INVALID_PASSWORD: "Kata sandi salah.",
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: "Terlalu banyak percobaan. Masuk ulang untuk mencoba lagi.",
  // Better Auth's second-factor lockout (DEC-010: 5 wrong codes, 15 minutes), at sign-in and
  // at a step-up (HYG-007).
  ACCOUNT_TEMPORARILY_LOCKED: "Akun dikunci sementara. Coba lagi dalam 15 menit.",
  ADDRESS_NOT_ALLOWED: "Masuk hanya dari jaringan kantor yang diizinkan.",
};

// `base`: the auth API of this surface (clinic app /api/auth; vendor console
// /vendor/api/auth, SEC-21).
export async function callAuth(path: string, body: unknown, base = "/api/auth"): Promise<ApiResult> {
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: "Koneksi terputus. Coba Lagi." };
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok) return { ok: true, data };
  if (res.status === 429) {
    return { ok: false, message: MESSAGES[String(data.code)] ?? "Terlalu banyak percobaan. Coba lagi sebentar lagi." };
  }
  // The password policy message is our own Indonesian copy (src/auth/policy.ts).
  if (data.code === "PASSWORD_POLICY" && typeof data.message === "string") return { ok: false, message: data.message };
  return { ok: false, message: MESSAGES[String(data.code)] ?? "Permintaan tidak dapat diproses. Coba Lagi." };
}
