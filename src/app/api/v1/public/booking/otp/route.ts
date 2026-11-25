// Public booking OTP request & resend endpoint (PR-67, UX-24, OD-1 Option B; T-126).
// BOOKING_HOST only; enforces same-origin Origin/Host, Turnstile (fail-closed when configured or in production),
// fail-closed TRUSTED_IP_HEADER in production (both env var and non-empty header value required),
// strict no-store/no-referrer/noindex headers, signed HttpOnly masked-phone cookie (zero phone in URL),
// and fail-closed OTP sender availability before any PII/DB write.
import { randomBytes, randomInt } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { appPool } from "../../../../../../modules/org/context/store";
import {
  requestPublicBookingOtp,
  resendPublicBookingOtp,
  signBookingCookiePayload,
} from "../../../../../../modules/public-site/booking/db";
import { envOf } from "../../../../../../modules/platform/residency";
import { normalizeSourceHint } from "../../../../../(public)/[slug]/booking/model";

const INTENT_COOKIE = "cd_pub_booking_intent";
const MASK_COOKIE = "cd_pub_booking_mask";
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const SEC_HEADERS = {
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
  "x-content-type-options": "nosniff",
} as const;

function sameOrigin(req: NextRequest): boolean {
  const host = req.headers.get("host")?.toLowerCase();
  const origin = req.headers.get("origin");
  if (!host || !origin) return false;
  try {
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

function normalizePhoneId(raw: string): string | null {
  const digits = raw.replace(/[\s().-]/g, "");
  const m = /^(?:\+?62|0)(8\d{7,12})$/.exec(digits);
  return m ? `+62${m[1]}` : null;
}

function maskPhone(e164: string): string {
  return `${e164.slice(0, 6)}••••${e164.slice(-3)}`;
}

// S4: In production, require BOTH TRUSTED_IP_HEADER configured AND a non-empty header value (never fall back to loopback).
function clientIpFrom(req: NextRequest): string | null {
  const isProd = envOf(process.env.DEPLOY_ENV) === "production";
  const configured = (process.env.TRUSTED_IP_HEADER ?? "").trim();
  if (isProd) {
    if (!configured) return null;
    const raw = (req.headers.get(configured) ?? "").split(",")[0]?.trim();
    return raw || null;
  }
  const hdr = configured || "x-real-ip";
  return (req.headers.get(hdr) ?? "127.0.0.1").split(",")[0]?.trim() || "127.0.0.1";
}

function clearBookingCookies(resp: NextResponse): NextResponse {
  const opts = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  };
  resp.cookies.set(INTENT_COOKIE, "", opts);
  resp.cookies.set(MASK_COOKIE, "", opts);
  return resp;
}

async function verifyTurnstile(token: string, remoteIp: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    return envOf(process.env.DEPLOY_ENV) !== "production";
  }
  if (!token) return false;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token, remoteip: remoteIp }),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return new NextResponse(null, { status: 403, headers: SEC_HEADERS });
  }

  const slug = (request.nextUrl.searchParams.get("slug") ?? "").trim().toLowerCase();
  if (!SLUG_RE.test(slug)) {
    return new NextResponse(null, { status: 404, headers: SEC_HEADERS });
  }

  const redirectTo = (qs: string) =>
    NextResponse.redirect(new URL(`/${encodeURIComponent(slug)}/booking?${qs}`, request.url), {
      status: 303,
      headers: SEC_HEADERS,
    });

  const clientIp = clientIpFrom(request);
  if (!clientIp) {
    return new NextResponse(null, { status: 403, headers: SEC_HEADERS });
  }
  const isResend = request.nextUrl.searchParams.get("ulang") === "1";

  if (isResend) {
    const intentToken = request.cookies.get(INTENT_COOKIE)?.value?.trim() ?? "";
    if (!intentToken) {
      return redirectTo("langkah=1&galat=tidak_tersedia");
    }
    const newOtpCode = String(randomInt(100000, 1000000));
    try {
      const db = await appPool();
      const res = await resendPublicBookingOtp(db, {
        slug,
        intentToken,
        newOtpCode,
        clientIp,
      });
      if (res.state === "not_found") {
        return new NextResponse(null, { status: 404, headers: SEC_HEADERS });
      }
      if (res.state === "otp_locked") {
        return clearBookingCookies(redirectTo("langkah=1&galat=otp_terkunci"));
      }
      if (res.state === "otp_expired") {
        return clearBookingCookies(redirectTo("langkah=1&galat=otp_kedaluwarsa"));
      }
      if (res.state === "send_failed") {
        return redirectTo("langkah=4&galat=kirim_gagal");
      }
      const resp = redirectTo("langkah=4");
      resp.cookies.set(INTENT_COOKIE, intentToken, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 300,
      });
      return resp;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("ERR_RATE_LIMITED")) {
        return redirectTo("langkah=4&galat=batas_permintaan");
      }
      return redirectTo("langkah=1&galat=tidak_tersedia");
    }
  }

  const form = await request.formData().catch(() => null);
  if (!form) {
    return new NextResponse(null, { status: 400, headers: SEC_HEADERS });
  }

  const turnstileToken = String(form.get("cf-turnstile-response") ?? "").trim();
  if (!(await verifyTurnstile(turnstileToken, clientIp))) {
    return new NextResponse(null, { status: 403, headers: SEC_HEADERS });
  }

  const treatmentSlug = String(form.get("layanan") ?? "").trim().toLowerCase();
  const branchSlug = String(form.get("cabang") ?? "").trim().toLowerCase();
  const doctorSlug = String(form.get("dokter") ?? "").trim().toLowerCase() || null;
  const slotStartIso = String(form.get("mulai") ?? "").trim();
  const patientName = String(form.get("nama") ?? "").trim();
  const phoneE164 = normalizePhoneId(String(form.get("hp") ?? ""));
  const birthDate = String(form.get("tanggal_lahir") ?? "").trim();
  const sexRaw = String(form.get("jenis_kelamin") ?? "").trim().toLowerCase();
  const sourceTag = normalizeSourceHint(String(form.get("sumber") ?? ""));

  if (
    !treatmentSlug ||
    !branchSlug ||
    !slotStartIso ||
    patientName.length < 2 ||
    patientName.length > 120 ||
    !phoneE164 ||
    !DATE_RE.test(birthDate) ||
    (sexRaw !== "female" && sexRaw !== "male")
  ) {
    return redirectTo("langkah=3&galat=tidak_tersedia");
  }

  const intentToken = randomBytes(24).toString("base64url");
  const otpCode = String(randomInt(100000, 1000000));

  try {
    const db = await appPool();
    const res = await requestPublicBookingOtp(db, {
      slug,
      treatmentSlug,
      branchSlug,
      slotStartIso,
      doctorSlug,
      sourceTag,
      phoneE164,
      patientName,
      birthDate,
      sex: sexRaw,
      otpCode,
      intentToken,
      clientIp,
    });

    if (res.state === "not_found") {
      return new NextResponse(null, { status: 404, headers: SEC_HEADERS });
    }
    if (res.state === "send_failed") {
      return redirectTo("langkah=3&galat=kirim_gagal");
    }

    const p = new URLSearchParams({
      langkah: "4",
      layanan: treatmentSlug,
      cabang: branchSlug,
      sumber: sourceTag,
    });
    if (doctorSlug) p.set("dokter", doctorSlug);

    const cookieOpts = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 300,
    };
    const resp = redirectTo(p.toString());
    resp.cookies.set(INTENT_COOKIE, intentToken, cookieOpts);
    resp.cookies.set(
      MASK_COOKIE,
      signBookingCookiePayload({
        slug,
        maskedPhone: maskPhone(phoneE164),
        exp: Math.floor(Date.now() / 1000) + 300,
      }),
      cookieOpts,
    );
    return resp;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("ERR_RATE_LIMITED")) {
      return redirectTo("langkah=3&galat=batas_permintaan");
    }
    if (msg.includes("ERR_VERSION_CONFLICT")) {
      return redirectTo("langkah=2&galat=slot_penuh");
    }
    return redirectTo("langkah=3&galat=tidak_tersedia");
  }
}
