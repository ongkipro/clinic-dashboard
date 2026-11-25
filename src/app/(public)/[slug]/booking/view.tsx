// Booking publik (UX-24, PR-67; T-126) — presentational server components.
// Zero internal UUIDs (opaque public slugs only), zero tracking/pixels (PR-39), identical neutral screen for closed/unpublished/unknown tenants.
import {
  dpNote,
  NEUTRAL,
  otpSender,
  type Prefill,
  type PublishedBookingCatalog,
  type Step,
  STEPS,
  type WaLink,
} from "./model";

const shell =
  "min-h-dvh bg-[#F5F5F7] px-4 pb-28 pt-8 text-[#1D1D1F] min-[700px]:px-5 min-[700px]:pb-10";
const column = "mx-auto grid w-full max-w-[640px] min-w-0 gap-6";
const panel = "grid min-w-0 gap-3 rounded-2xl border border-[#D2D2D7]/70 bg-white p-5";
const field =
  "min-h-[44px] w-full min-w-0 rounded-xl border border-[#D2D2D7] bg-white px-3 text-[15px] text-[#1D1D1F]";
const primary =
  "min-h-[48px] w-full rounded-full bg-[var(--tint,#0071E3)] px-5 text-[15px] font-semibold text-white min-[700px]:w-auto";
const muted = "m-0 text-[14px] text-[#6E6E73] [overflow-wrap:anywhere]";

export function BookingUnavailable() {
  return (
    <main className={shell} data-booking="unavailable">
      <div className={column}>
        <h1 className="m-0 text-[28px] font-bold leading-tight [overflow-wrap:anywhere]">{NEUTRAL.title}</h1>
        <p role="status" className={`${panel} text-[#6E6E73]`}>
          {NEUTRAL.body}
        </p>
      </div>
    </main>
  );
}

export type SlotOption = { value: string; label: string };
export type BookingViewState =
  | { kind: "loading" }
  | { kind: "error"; message: string; retryHref: string }
  | { kind: "blocked"; reason: string; unblock: string }
  | { kind: "confirmed"; bookingCode: string; summary: string }
  | { kind: "ready" };

export type BookingViewProps = {
  brand: string;
  whatsapp: string | null;
  catalog: PublishedBookingCatalog;
  prefill: Prefill;
  step: Step;
  chosenDate: string;
  chosenSlot: string | null;
  slots: SlotOption[];
  maskedPhone: string | null;
  intentId?: string | null;
  wa: WaLink;
  actions: { step1: string; step2: string; step3: string; step4: string; resend: string };
  state: BookingViewState;
};

function Steps({ step }: { step: Step }) {
  return (
    <ol aria-label="Langkah booking" className="m-0 grid list-none grid-cols-2 gap-2 p-0 min-[700px]:grid-cols-4">
      {STEPS.map((label, i) => {
        const n = (i + 1) as Step;
        return (
          <li
            key={label}
            aria-current={n === step ? "step" : undefined}
            className={`rounded-xl px-3 py-2 text-[13px] [overflow-wrap:anywhere] ${
              n === step
                ? "bg-[#0071E3]/10 font-semibold text-[#0071E3]"
                : "bg-white text-[#6E6E73]"
            }`}
          >
            <span className="tabular-nums">{`${n}. `}</span>
            {label}
            {n < step && <span className="sr-only"> (selesai)</span>}
          </li>
        );
      })}
    </ol>
  );
}

function HiddenContext({
  prefill,
  chosenSlot,
  intentId,
}: {
  prefill: Prefill;
  chosenSlot?: string | null;
  intentId?: string | null;
}) {
  return (
    <>
      {prefill.treatmentSlug && <input type="hidden" name="layanan" value={prefill.treatmentSlug} />}
      {prefill.branchSlug && <input type="hidden" name="cabang" value={prefill.branchSlug} />}
      {prefill.doctorSlug && <input type="hidden" name="dokter" value={prefill.doctorSlug} />}
      {chosenSlot && <input type="hidden" name="mulai" value={chosenSlot} />}
      {intentId && <input type="hidden" name="intent" value={intentId} />}
      <input type="hidden" name="sumber" value={prefill.source} />
    </>
  );
}

function PrimaryAction({ label }: { label: string }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t border-[#D2D2D7] bg-white px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 min-[700px]:static min-[700px]:border-0 min-[700px]:bg-transparent min-[700px]:p-0">
      <button type="submit" className={primary}>
        {label}
      </button>
    </div>
  );
}

function StepBody({ p }: { p: BookingViewProps }) {
  const chosenTreatment = p.catalog.treatments.find((x) => x.slug === p.prefill.treatmentSlug);
  const branches = chosenTreatment
    ? p.catalog.branches.filter((b) => chosenTreatment.branchSlugs.includes(b.slug))
    : p.catalog.branches;

  switch (p.step) {
    case 1:
      return (
        <form method="get" action={p.actions.step1} className={panel} aria-labelledby="h-layanan">
          <h2 id="h-layanan" className="m-0 text-[18px] font-semibold">
            Pilih layanan
          </h2>
          {p.catalog.treatments.length === 0 ? (
            <p role="status" className={muted}>
              Belum ada layanan yang tersedia untuk booking online.
            </p>
          ) : (
            <fieldset className="m-0 grid gap-2 border-0 p-0">
              <legend className="sr-only">Layanan</legend>
              {p.catalog.treatments.map((x) => (
                <label
                  key={x.slug}
                  className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border border-[#D2D2D7] px-3 py-2 text-[15px] transition-colors has-[:checked]:border-[#0071E3] has-[:checked]:bg-[#0071E3]/10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#0071E3]"
                >
                  <input type="radio" name="layanan" value={x.slug} required className="size-5 shrink-0 accent-[#0071E3]" />
                  <span className="[overflow-wrap:anywhere]">{x.name}</span>
                </label>
              ))}
            </fieldset>
          )}
          {p.prefill.branchSlug && <input type="hidden" name="cabang" value={p.prefill.branchSlug} />}
          <input type="hidden" name="sumber" value={p.prefill.source} />
          <PrimaryAction label="Lanjut" />
        </form>
      );

    case 2:
      return (
        <div className="grid min-w-0 gap-4">
          <form method="get" action={p.actions.step1} className={panel} aria-labelledby="h-filter-waktu">
            <h2 id="h-filter-waktu" className="m-0 text-[18px] font-semibold">
              Pilih cabang dan tanggal
            </h2>
            {chosenTreatment && (
              <p className="m-0 font-semibold [overflow-wrap:anywhere]" data-prefill="layanan">
                {chosenTreatment.name}
              </p>
            )}
            <div className="grid min-w-0 gap-3 min-[700px]:grid-cols-2">
              <label className="grid min-w-0 gap-1 text-[14px]">
                Cabang
                <select
                  name="cabang"
                  defaultValue={p.prefill.branchSlug ?? branches[0]?.slug ?? ""}
                  required
                  className={field}
                  data-prefill="cabang"
                >
                  <option value="" disabled>
                    Pilih cabang
                  </option>
                  {branches.map((b) => (
                    <option key={b.slug} value={b.slug}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid min-w-0 gap-1 text-[14px]">
                Tanggal
                <input
                  type="date"
                  name="tanggal"
                  defaultValue={p.chosenDate}
                  required
                  className={field}
                />
              </label>
            </div>
            {p.prefill.treatmentSlug && <input type="hidden" name="layanan" value={p.prefill.treatmentSlug} />}
            {p.prefill.doctorSlug && <input type="hidden" name="dokter" value={p.prefill.doctorSlug} />}
            <input type="hidden" name="langkah" value="2" />
            <input type="hidden" name="sumber" value={p.prefill.source} />
            <div>
              <button
                type="submit"
                className="inline-flex min-h-[44px] items-center rounded-full bg-[#E5E5EA] px-4 text-[14px] font-semibold text-[#1D1D1F]"
              >
                Lihat Waktu Tersedia
              </button>
            </div>
          </form>

          <form method="get" action={p.actions.step2} className={panel} aria-labelledby="h-waktu">
            <h2 id="h-waktu" className="m-0 text-[18px] font-semibold">
              Pilih waktu kunjungan
            </h2>
            {p.slots.length === 0 ? (
              <p role="status" className={muted}>
                Belum ada waktu kosong pada tanggal ini. Pilih tanggal atau cabang lain.
              </p>
            ) : (
              <fieldset className="m-0 grid grid-cols-2 gap-2 border-0 p-0 min-[700px]:grid-cols-3">
                <legend className="mb-1 text-[14px]">Waktu tersedia</legend>
                {p.slots.map((slot) => (
                  <label
                    key={slot.value}
                    className="flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#D2D2D7] px-2 text-center text-[14px] transition-colors has-[:checked]:border-[#0071E3] has-[:checked]:bg-[#0071E3]/10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#0071E3]"
                  >
                    <input
                      type="radio"
                      name="mulai"
                      value={slot.value}
                      defaultChecked={p.chosenSlot === slot.value}
                      required
                      className="size-4 shrink-0 accent-[#0071E3]"
                    />
                    <span className="tabular-nums">{slot.label}</span>
                  </label>
                ))}
              </fieldset>
            )}
            {chosenTreatment?.dpRequired && dpNote(chosenTreatment.dpAmount) && (
              <p className={muted} data-dp="">
                {dpNote(chosenTreatment.dpAmount)}
              </p>
            )}
            <input type="hidden" name="langkah" value="3" />
            <input type="hidden" name="tanggal" value={p.chosenDate} />
            <HiddenContext prefill={p.prefill} />
            <PrimaryAction label="Lanjut" />
          </form>
        </div>
      );

    case 3:
      return (
        <form method="post" action={p.actions.step3} className={panel} aria-labelledby="h-data">
          <h2 id="h-data" className="m-0 text-[18px] font-semibold">
            Data diri
          </h2>
          <label className="grid min-w-0 gap-1 text-[14px]">
            Nama lengkap
            <input name="nama" autoComplete="name" required minLength={2} maxLength={120} className={field} />
          </label>
          <label className="grid min-w-0 gap-1 text-[14px]">
            Nomor WhatsApp
            <input name="hp" type="tel" inputMode="tel" autoComplete="tel" required maxLength={20} className={field} />
          </label>
          <div className="grid min-w-0 gap-3 min-[700px]:grid-cols-2">
            <label className="grid min-w-0 gap-1 text-[14px]">
              Tanggal lahir
              <input name="tanggal_lahir" type="date" autoComplete="bday" required className={field} />
            </label>
            <label className="grid min-w-0 gap-1 text-[14px]">
              Jenis kelamin
              <select name="jenis_kelamin" required defaultValue="" className={field}>
                <option value="" disabled>
                  Pilih jenis kelamin
                </option>
                <option value="female">Perempuan</option>
                <option value="male">Laki-laki</option>
              </select>
            </label>
          </div>
          <p className={muted}>{otpSender(p.brand, p.whatsapp)}</p>
          <HiddenContext prefill={p.prefill} chosenSlot={p.chosenSlot} />
          <PrimaryAction label="Kirim Kode" />
        </form>
      );

    case 4:
      return (
        <div className="grid min-w-0 gap-4">
          <form method="post" action={p.actions.step4} className={panel} aria-labelledby="h-otp">
            <h2 id="h-otp" className="m-0 text-[18px] font-semibold">
              Masukkan kode OTP
            </h2>
            <p className={muted}>
              {otpSender(p.brand, p.whatsapp)}
              {p.maskedPhone ? ` (${p.maskedPhone})` : ""}
            </p>
            <label className="grid min-w-0 gap-1 text-[14px]">
              Kode 6 digit
              <input
                name="kode"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                className={`${field} tabular-nums tracking-[0.25em]`}
              />
            </label>
            <HiddenContext prefill={p.prefill} intentId={p.intentId} />
            <PrimaryAction label="Konfirmasi Jadwal" />
          </form>

          <form method="post" action={p.actions.resend} className="flex justify-start">
            <button
              type="submit"
              className="inline-flex min-h-[44px] items-center rounded-full border border-[#D2D2D7] bg-white px-4 text-[14px] font-semibold text-[#1D1D1F]"
            >
              Kirim Ulang Kode
            </button>
          </form>
        </div>
      );
  }
}

export function BookingView(p: BookingViewProps) {
  return (
    <main className={shell} data-booking="open" data-step={p.step}>
      <div className={column}>
        <header className="grid min-w-0 gap-1">
          <p className={muted}>{p.brand}</p>
          <h1 className="m-0 text-[28px] font-bold leading-tight [overflow-wrap:anywhere]">Buat Janji</h1>
        </header>

        <Steps step={p.step} />

        {p.state.kind === "loading" && (
          <p role="status" aria-busy="true" className={panel}>
            Memuat jadwal…
          </p>
        )}

        {p.state.kind === "blocked" && (
          <div role="status" className={panel}>
            <p className="m-0 font-semibold">{p.state.reason}</p>
            <p className={muted}>{p.state.unblock}</p>
          </div>
        )}

        {p.state.kind === "error" && (
          <div role="alert" className={`${panel} border-[#FF3B30]/40 bg-[#FF3B30]/5`}>
            <p className="m-0 font-semibold text-[#D70015]">{p.state.message}</p>
            <a
              href={p.state.retryHref}
              className="inline-flex min-h-[44px] items-center font-semibold text-[#0071E3] no-underline"
            >
              Ulangi dari awal
            </a>
          </div>
        )}

        {p.state.kind === "confirmed" ? (
          <section role="status" className={panel} aria-labelledby="h-confirmed">
            <h2 id="h-confirmed" className="m-0 text-[20px] font-semibold text-[#248A3D]">
              Jadwal Diterima
            </h2>
            <p className="m-0 text-[15px] [overflow-wrap:anywhere]">{p.state.summary}</p>
            <p className="m-0 font-mono text-[14px] text-[#6E6E73]">Referensi: {p.state.bookingCode}</p>
          </section>
        ) : (
          p.state.kind !== "blocked" && p.state.kind !== "loading" && <StepBody p={p} />
        )}

        {p.wa && (
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[#D2D2D7]/70 pt-4 text-[14px]">
            <span className="text-[#6E6E73]">Butuh bantuan memilih jadwal?</span>
            <a
              href={p.wa.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center font-semibold text-[#0071E3] no-underline"
            >
              {p.wa.label}
            </a>
          </footer>
        )}
      </div>
    </main>
  );
}
