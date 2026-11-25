// Public booking OTP verify & book endpoint (PR-67, UX-24, OD-1 Option B; T-126).
// BOOKING_HOST only; enforces same-origin Origin/Host, strict no-store/no-referrer/noindex headers,
// consumes HttpOnly intent cookie + 6-digit OTP atomically via public_booking_otp_verify_and_book,
// and issues an HMAC-signed short-lived HttpOnly confirmation cookie (never spoofable via URL query params).
import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { appPool } from "../../../../../../modules/org/context/store";
import {
  signBookingCookiePayload,
  verifyPublicBookingOtpAndBook,
} from "../../../../../../modules/public-site/booking/db";

const INTENT_COOKIE = "cd_pub_booking_intent";
const MASK_COOKIE = "cd_pub_booking_mask";
const CONFIRM_COOKIE = "cd_pub_booking_confirm";
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const OTP_RE = /^[0-9]{6}$/;

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

function clearIntentCookies(resp: NextResponse): NextResponse {
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

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return new NextResponse(null, { status: 403, headers: SEC_HEADERS });
  }

  const slug = (request.nextUrl.searchParams.get("slug") ?? "").trim().toLowerCase();
  if (!SLUG_RE.test(slug)) {
    return new NextResponse(null, { status: 404, headers: SEC_HEADERS });
  }

  const intentToken = request.cookies.get(INTENT_COOKIE)?.value?.trim() ?? "";
  const form = await request.formData().catch(() => null);
  const otpCode = String(form?.get("kode") ?? "").trim();

  const redirectTo = (qs: string) =>
    NextResponse.redirect(new URL(`/${encodeURIComponent(slug)}/booking?${qs}`, request.url), {
      status: 303,
      headers: SEC_HEADERS,
    });

  if (!intentToken || !OTP_RE.test(otpCode)) {
    return redirectTo("langkah=4&galat=otp_salah");
  }

  const commandKey = `pubbook:${createHash("sha256").update(`${slug}:${intentToken}`, "utf8").digest("hex").slice(0, 32)}`;

  try {
    const db = await appPool();
    const res = await verifyPublicBookingOtpAndBook(db, {
      slug,
      intentToken,
      otpCode,
      commandKey,
    });

    if (res.state === "not_found") {
      return new NextResponse(null, { status: 404, headers: SEC_HEADERS });
    }
    if (res.state === "otp_mismatch") {
      return redirectTo("langkah=4&galat=otp_salah");
    }
    if (res.state === "otp_expired") {
      return clearIntentCookies(redirectTo("langkah=1&galat=otp_kedaluwarsa"));
    }
    if (res.state === "otp_locked") {
      return clearIntentCookies(redirectTo("langkah=1&galat=otp_terkunci"));
    }
    if (res.state === "inactive") {
      return clearIntentCookies(redirectTo("langkah=1&galat=tidak_tersedia"));
    }

    const code = createHash("sha256")
      .update(`${slug}:${res.startsAt}:${commandKey}`, "utf8")
      .digest("hex")
      .slice(0, 8)
      .toUpperCase();

    const resp = clearIntentCookies(redirectTo("selesai=1"));
    resp.cookies.set(
      CONFIRM_COOKIE,
      signBookingCookiePayload({
        slug,
        code,
        status: res.state,
        exp: Math.floor(Date.now() / 1000) + 300,
      }),
      {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 300,
      },
    );
    return resp;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("ERR_GATE_CLOSED") || msg.includes("real_patient_gate") || msg.includes("ERR_NOT_FOUND")) {
      return clearIntentCookies(redirectTo("langkah=1&galat=tidak_tersedia"));
    }
    if (msg.includes("ERR_VERSION_CONFLICT")) {
      return clearIntentCookies(redirectTo("langkah=2&galat=slot_penuh"));
    }
    return redirectTo("langkah=4&galat=otp_salah");
  }
}
