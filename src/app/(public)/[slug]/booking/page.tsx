// Booking publik (UX-24, PR-67, PR-6; T-126) — BOOKING_HOST only, zero pixels (PR-39), zero internal UUIDs.
// Closed, suspended, unpublished, and unknown tenants render the identical neutral <BookingUnavailable /> screen.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { appPool } from "../../../../modules/org/context/store";
import {
  getPublicBookingCatalog,
  getPublicBookingSlots,
  verifyBookingCookiePayload,
} from "../../../../modules/public-site/booking/db";
import {
  firstStep,
  prefill,
  type Query,
  type Step,
  whatsappLink,
} from "./model";
import { BookingUnavailable, BookingView, type BookingViewState, type SlotOption } from "./view";

// Blocking dynamic route so closed/unpublished/unknown tenants never stream stale/partial state.
export const instant = false;

export const metadata: Metadata = {
  title: "Buat Janji",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const INTENT_COOKIE = "cd_pub_booking_intent";
const MASK_COOKIE = "cd_pub_booking_mask";
const CONFIRM_COOKIE = "cd_pub_booking_confirm";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const one = (v: string | string[] | undefined) =>
  typeof v === "string" ? v.trim() : Array.isArray(v) ? (v[0] ?? "").trim() : "";

function todayJakarta(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}

function parseStep(raw: string, fallback: Step): Step {
  if (raw === "1") return 1;
  if (raw === "2") return 2;
  if (raw === "3") return 3;
  if (raw === "4") return 4;
  return fallback;
}

async function BookingContent({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Query>;
}) {
  await connection();
  const { slug } = await params;
  const q = await searchParams;
  const db = await appPool();

  const catalogRes = await getPublicBookingCatalog(db, slug);
  if (catalogRes.state !== "open") {
    return <BookingUnavailable />;
  }

  const pf = prefill(q, catalogRes);
  const defaultStep = firstStep(pf);
  const requestedStep = parseStep(one(q.langkah), defaultStep);
  const chosenDate = DATE_RE.test(one(q.tanggal)) ? one(q.tanggal) : todayJakarta();
  const chosenSlotRaw = one(q.mulai);
  const chosenSlot = ISO_TS_RE.test(chosenSlotRaw) ? chosenSlotRaw : null;

  const effectiveBranchSlug =
    pf.branchSlug ??
    (pf.treatmentSlug
      ? catalogRes.treatments.find((t) => t.slug === pf.treatmentSlug)?.branchSlugs[0] ?? null
      : catalogRes.branches[0]?.slug ?? null);

  let step: Step = requestedStep;
  if (step === 3 && (!pf.treatmentSlug || !effectiveBranchSlug || !chosenSlot)) {
    step = pf.treatmentSlug ? 2 : 1;
  }

  let slots: SlotOption[] = [];
  if (step === 2 && pf.treatmentSlug && effectiveBranchSlug) {
    const slotsRes = await getPublicBookingSlots(db, {
      slug: catalogRes.slug,
      treatmentSlug: pf.treatmentSlug,
      branchSlug: effectiveBranchSlug,
      date: chosenDate,
      doctorSlug: pf.doctorSlug,
    });
    if (slotsRes.state === "open") {
      slots = slotsRes.slots.map((s) => ({
        value: s.startsAt,
        label: s.localTime,
      }));
    }
  }

  const jar = await cookies();
  const hasIntent = Boolean(jar.get(INTENT_COOKIE)?.value);
  if (step === 4 && !hasIntent) {
    step = pf.treatmentSlug ? 2 : 1;
  }

  const errCode = one(q.galat);
  // S1: Confirmation state and masked phone are authenticated ONLY via server-signed HttpOnly cookies
  // bound to catalogRes.slug and an expiry timestamp — never spoofable via URL query parameters.
  const confirmPayload = verifyBookingCookiePayload<{ slug?: string; code?: string; status?: string }>(
    jar.get(CONFIRM_COOKIE)?.value,
  );
  const confirmedCode =
    confirmPayload?.slug === catalogRes.slug &&
    typeof confirmPayload.code === "string" &&
    /^[A-F0-9]{8}$/.test(confirmPayload.code)
      ? confirmPayload.code
      : "";
  const confirmedKind =
    confirmPayload?.slug === catalogRes.slug &&
    (confirmPayload.status === "held" || confirmPayload.status === "confirmed")
      ? confirmPayload.status
      : "";
  const maskPayload = verifyBookingCookiePayload<{ slug?: string; maskedPhone?: string }>(
    jar.get(MASK_COOKIE)?.value,
  );
  const safeMaskedPhone =
    maskPayload?.slug === catalogRes.slug &&
    typeof maskPayload.maskedPhone === "string" &&
    /^\+62\d{3}••••\d{3}$/.test(maskPayload.maskedPhone)
      ? maskPayload.maskedPhone
      : null;

  let state: BookingViewState = { kind: "ready" };
  if (confirmedCode && confirmedKind) {
    state = {
      kind: "confirmed",
      bookingCode: confirmedCode,
      summary:
        confirmedKind === "held"
          ? "Jadwal sementara Anda telah ditahan menunggu pembayaran uang muka (DP). Klinik akan mengirimkan informasi lanjutan melalui WhatsApp."
          : "Jadwal kunjungan Anda telah tercatat. Klinik akan mengirimkan pengingat melalui WhatsApp.",
    };
  } else if (errCode) {
    const messages: Record<string, string> = {
      otp_salah: "Kode OTP tidak sesuai. Periksa kembali kode 6 digit Anda.",
      otp_kedaluwarsa: "Kode OTP sudah kedaluwarsa. Minta kode baru untuk melanjutkan.",
      otp_terkunci: "Batas percobaan kode OTP tercapai. Mulai ulang pemesanan untuk mendapatkan kode baru.",
      batas_permintaan: "Terlalu banyak permintaan kode. Tunggu beberapa menit lalu coba lagi.",
      kirim_gagal: "Pengiriman kode OTP sedang mengalami kendala. Silakan coba lagi beberapa saat.",
      slot_penuh: "Waktu yang dipilih sudah terisi. Silakan pilih waktu lain.",
      tidak_tersedia: "Booking online sedang tidak tersedia untuk pilihan ini.",
    };
    state = {
      kind: "error",
      message: messages[errCode] ?? "Permintaan tidak dapat diproses. Silakan coba lagi.",
      retryHref: `/${encodeURIComponent(catalogRes.slug)}/booking`,
    };
  }

  const branchForWa =
    catalogRes.branches.find((b) => b.slug === effectiveBranchSlug) ?? catalogRes.branches[0] ?? null;
  const wa = whatsappLink(branchForWa?.whatsapp ?? null, {
    brand: catalogRes.brand,
    page: pf.source.startsWith("situs-")
      ? (pf.source.slice("situs-".length) as "beranda" | "perawatan" | "cabang" | "dokter")
      : "beranda",
  });

  const basePath = `/${encodeURIComponent(catalogRes.slug)}/booking`;
  return (
    <BookingView
      brand={catalogRes.brand}
      whatsapp={branchForWa?.whatsapp ?? null}
      catalog={catalogRes}
      prefill={{ ...pf, branchSlug: effectiveBranchSlug }}
      step={step}
      chosenDate={chosenDate}
      chosenSlot={chosenSlot}
      slots={slots}
      maskedPhone={safeMaskedPhone}
      intentId={hasIntent ? "active" : null}
      wa={wa}
      actions={{
        step1: basePath,
        step2: basePath,
        step3: `/api/v1/public/booking/otp?slug=${encodeURIComponent(catalogRes.slug)}`,
        step4: `/api/v1/public/booking/verify?slug=${encodeURIComponent(catalogRes.slug)}`,
        resend: `/api/v1/public/booking/otp?slug=${encodeURIComponent(catalogRes.slug)}&ulang=1`,
      }}
      state={state}
    />
  );
}

export default function PublicBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Query>;
}) {
  return (
    <Suspense
      fallback={
        <main className="min-h-dvh bg-[#F5F5F7] px-4 pt-8" aria-busy="true">
          <div className="mx-auto grid max-w-[640px] gap-4">
            <div className="h-9 w-48 rounded-xl bg-[#E5E5EA]" />
            <div className="h-44 rounded-2xl bg-[#E5E5EA]" />
          </div>
        </main>
      }
    >
      <BookingContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
