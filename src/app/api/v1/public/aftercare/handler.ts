// Public aftercare OTP request & verification handler (PR-70, ARCH-3, DEC-117 Rows 1/7).
// Separated from route.ts so Next.js route exports remain strictly HTTP methods while tests
// exercise the real handler with injected pool/env/port.
import type pg from "pg";
import { NextResponse, type NextRequest } from "next/server";
import { isSameBookingOrigin } from "../../../../../lib/public-origin";
import { sendAftercareOtp, TOKEN, verifyAftercareOtp } from "../../../../../modules/crm/aftercare/aftercare";
import type { InboxPort } from "../../../../../modules/messaging/inbox/port";
import { SESSION_COOKIE, type OtpState } from "../../../../(public)/aftercare/[token]/labels";

const SEC_HEADERS = {
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
  "x-content-type-options": "nosniff",
} as const;

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

export async function handleAftercarePost(
  request: NextRequest,
  db: pg.Pool | pg.ClientBase,
  opts: { env?: Record<string, string | undefined>; port?: InboxPort } = {},
): Promise<NextResponse> {
  const env = opts.env ?? process.env;
  if (!isSameBookingOrigin(request, env)) {
    return new NextResponse(null, { status: 403, headers: SEC_HEADERS });
  }
  const mediaType = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (mediaType !== "application/json") {
    return NextResponse.json({ step: "send", error: "Format permintaan tidak valid." } satisfies OtpState, {
      status: 415,
      headers: SEC_HEADERS,
    });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ step: "send", error: "Permintaan tidak valid." } satisfies OtpState, {
      status: 400,
      headers: SEC_HEADERS,
    });
  }
  const action = typeof body.action === "string" ? body.action : "";
  const token = typeof body.token === "string" ? body.token : "";
  if (!TOKEN.test(token)) {
    return NextResponse.json({ step: "send", ...SEND_COPY.not_found } satisfies OtpState, { headers: SEC_HEADERS });
  }

  if (action === "send") {
    const name = (env.TRUSTED_IP_HEADER ?? "x-real-ip").toLowerCase();
    const ip = (/^[a-z0-9-]{1,64}$/.test(name) ? request.headers.get(name) : null) ?? "unknown";
    const r = await sendAftercareOtp(db, token, ip, { port: opts.port });
    const out: OtpState = r.ok ? { step: "code", message: "Kode verifikasi dikirim." } : { step: "send", ...SEND_COPY[r.reason] };
    return NextResponse.json(out, { headers: SEC_HEADERS });
  }

  if (action === "verify") {
    const code = String(body.code ?? "").replace(/\s+/g, "");
    if (!/^[0-9]{6}$/.test(code)) {
      return NextResponse.json({ step: "code", error: "Masukkan 6 angka kode verifikasi." } satisfies OtpState, {
        headers: SEC_HEADERS,
      });
    }
    const r = await verifyAftercareOtp(db, token, code);
    if (!r.ok) {
      const c = VERIFY_COPY[r.reason];
      const left = r.reason === "otp_invalid" && r.attempts_remaining != null ? ` Sisa ${r.attempts_remaining} percobaan.` : "";
      return NextResponse.json(
        { step: r.reason === "otp_expired" ? "send" : "code", error: c.error + left, blocked: c.blocked } satisfies OtpState,
        { headers: SEC_HEADERS },
      );
    }
    const res = NextResponse.json({ step: "done", message: "Identitas terverifikasi." } satisfies OtpState, {
      headers: SEC_HEADERS,
    });
    res.cookies.set(SESSION_COOKIE, r.sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/aftercare",
      secure: env.APP_URL?.startsWith("https://") ?? env.NODE_ENV === "production",
      maxAge: 30 * 60,
    });
    return res;
  }

  return NextResponse.json({ step: "send", error: "Aksi tidak dikenali." } satisfies OtpState, {
    status: 400,
    headers: SEC_HEADERS,
  });
}
