// Calls the Better Auth API on the same origin. Errors map to the UI-5 copy patterns;
// raw server messages are never shown.
export type ApiResult = { ok: true; data: Record<string, unknown> } | { ok: false; message: string };

const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "Email atau kata sandi salah.",
  LOGIN_TEMPORARILY_LOCKED: "Terlalu banyak percobaan masuk. Coba lagi dalam 15 menit.",
  INVALID_CODE: "Kode tidak cocok. Periksa jam di ponsel Anda lalu coba lagi.",
  INVALID_PASSWORD: "Kata sandi salah.",
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: "Terlalu banyak percobaan. Masuk ulang untuk mencoba lagi.",
  ACCOUNT_LOCKED: "Akun dikunci sementara. Coba lagi dalam 15 menit.",
};

export async function callAuth(path: string, body: unknown): Promise<ApiResult> {
  let res: Response;
  try {
    res = await fetch(`/api/auth${path}`, {
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
  return { ok: false, message: MESSAGES[String(data.code)] ?? "Permintaan tidak dapat diproses. Coba Lagi." };
}
