"use client";
// Console write from the browser: JSON POST to /vendor/api/console/<action> (src/proxy.ts
// allows nothing else). Maps refusals to UI-5 copy; raw codes are never shown.
export type PostResult = { ok: true; data: Record<string, unknown> } | { ok: false; message: string };

const COPY: Record<string, string> = {
  totp_not_verified: "Verifikasi dua langkah Anda sudah lebih dari 10 menit. Keluar lalu masuk kembali untuk melanjutkan.",
  role_not_held: "Peran Anda tidak mengizinkan tindakan ini.",
  ip_not_allowed: "Tindakan ini hanya dari jaringan kantor vendor.",
  processor_agreement: "Owner klinik belum menyetujui Perjanjian Pengolahan Data. Onboarding belum bisa dimulai.",
  owner_or_invitation_exists: "Klinik ini sudah punya Owner atau undangan Owner yang masih berlaku.",
  owner_exists: "Klinik ini sudah punya Owner.",
  not_pending: "Undangan ini sudah tidak menunggu persetujuan.",
  not_a_step: "Status tenant sudah berubah. Muat ulang halaman.",
  ERR_APPROVER_IS_REQUESTER: "Undangan harus disetujui Pemilik Platform lain, bukan yang membuatnya.",
  ERR_INVALID_INPUT: "Periksa kembali isian yang ditandai.",
  ERR_NOT_FOUND: "Data ini sudah tidak ada. Muat ulang halaman.",
  ERR_UNAUTHENTICATED: "Sesi Anda berakhir. Masuk kembali.",
};

export async function post(action: string, body: unknown): Promise<PostResult> {
  let res: Response;
  try {
    res = await fetch(`/vendor/api/console/${action}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: "Koneksi terputus. Coba Lagi." };
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok && data.ok) return { ok: true, data };
  return { ok: false, message: COPY[String(data.reason)] ?? COPY[String(data.code)] ?? "Permintaan tidak dapat diproses. Coba Lagi." };
}
