// Jalur Kunjungan (10 Component Contract: VisitTrack; DESIGN.md signature). One capsule on
// every patient screen: ten independent visit steps as segments that fill in, each with
// its word label, and the one blocking item written beneath. Each segment has a symbol
// and an accessible name ("Langkah 4 dari 10: Dokter — menunggu"), so colour is never
// the only signal (UI-3). Compact width wraps the ten segments into two rows of five so
// every label stays readable (Caption 2, 11 px minimum). Server component.
// `summary` (list rows inside a link): segments are hidden from assistive technology and
// one sentence names the current step, so a row's link name stays short.
import { cn } from "cn";
import { Check, Minus, TriangleAlert } from "lucide-react";

export const VISIT_STEPS = [
  "Daftar",
  "Pendampingan",
  "Dokter",
  "Pilihan",
  "Persetujuan",
  "Bayar",
  "Persiapan",
  "Tindakan",
  "Serahkan",
  "Selesai",
] as const;
export type VisitStep = (typeof VISIT_STEPS)[number];

// Two labels outgrow a segment at 11 px; they break at a syllable with a visible hyphen
// (never mid-word without one). The accessible name keeps the full word.
const LABEL_BREAKS: Partial<Record<VisitStep, string>> = {
  Pendampingan: "Pendam\u00adpingan",
  Persetujuan: "Perse\u00adtujuan",
};

// selesai = done, berjalan = in progress (waiting), terblokir = blocked,
// tidak_perlu = not needed for this visit, belum = not started yet.
export type StepState = "selesai" | "berjalan" | "terblokir" | "tidak_perlu" | "belum";

const STATE_WORD: Record<StepState, string> = {
  selesai: "selesai",
  berjalan: "menunggu",
  terblokir: "terblokir",
  tidak_perlu: "tidak perlu",
  belum: "belum dimulai",
};

type States = Partial<Record<VisitStep, StepState>>; // missing = belum

// A blocked step must name its blocker (one blocking item written beneath the track).
export type VisitTrackProps = (
  | { states: States; blocker?: undefined }
  | { states: States; blocker: string }
) & { className?: string; summary?: boolean };

export function stepLabel(step: VisitStep, state: StepState): string {
  return `Langkah ${VISIT_STEPS.indexOf(step) + 1} dari ${VISIT_STEPS.length}: ${step} — ${STATE_WORD[state]}`;
}

// The one step to name: the blocked one, else the one in progress, else the first not
// started, else the visit is done.
export function currentStep(states: States): { step: VisitStep; state: StepState } | null {
  for (const want of ["terblokir", "berjalan", "belum"] as const) {
    const step = VISIT_STEPS.find((s) => (states[s] ?? "belum") === want);
    if (step) return { step, state: want };
  }
  return null;
}

export function VisitTrack({ states, blocker, className, summary }: VisitTrackProps) {
  const current = currentStep(states);
  if (process.env.NODE_ENV !== "production" && VISIT_STEPS.some((s) => states[s] === "terblokir") && !blocker) {
    throw new Error("VisitTrack: a blocked step needs its blocker text");
  }
  return (
    <div data-slot="visit-track" className={cn("grid min-w-0 gap-1.5", className)}>
      {summary && (
        <span className="sr-only">
          {current ? stepLabel(current.step, current.state) : "Kunjungan selesai"}
        </span>
      )}
      <ol
        aria-label={summary ? undefined : "Jalur Kunjungan"}
        aria-hidden={summary ? true : undefined}
        className="m-0 grid min-w-0 list-none grid-cols-5 gap-x-[3px] gap-y-2 p-0 min-[700px]:grid-cols-10"
      >
        {VISIT_STEPS.map((step) => {
          const state = states[step] ?? "belum";
          const isCurrent = current?.step === step && (state === "berjalan" || state === "terblokir");
          return (
            <li
              key={step}
              data-state={state}
              aria-current={isCurrent ? "step" : undefined}
              className="grid min-w-0 justify-items-center gap-1"
            >
              <span className="sr-only">{stepLabel(step, state)}</span>
              <span
                aria-hidden="true"
                data-slot="segment"
                className={cn(
                  "grid h-[18px] w-full place-items-center rounded-full",
                  state === "selesai" && "bg-[var(--tint)] text-[var(--on-tint)]",
                  state === "berjalan" && "bg-[var(--tint-soft)] text-[var(--tint)] outline outline-1 -outline-offset-1 outline-[var(--tint)]",
                  state === "terblokir" && "bg-[var(--danger-soft)] text-[var(--danger)] outline outline-1 -outline-offset-1 outline-[var(--danger)]",
                  state === "tidak_perlu" && "bg-transparent text-[var(--label-3)] outline outline-1 -outline-offset-1 outline-dashed outline-[var(--separator)]",
                  state === "belum" && "bg-[var(--surface-2)]",
                )}
              >
                {state === "selesai" && <Check data-symbol="selesai" className="size-3" strokeWidth={3} />}
                {state === "terblokir" && <TriangleAlert data-symbol="terblokir" className="size-3" strokeWidth={2.5} />}
                {state === "tidak_perlu" && <Minus data-symbol="tidak_perlu" className="size-3" strokeWidth={2.5} />}
                {state === "berjalan" && <span data-symbol="berjalan" className="size-1.5 rounded-full bg-[var(--tint)]" />}
              </span>
              <span
                aria-hidden="true"
                data-slot="segment-label"
                className={cn(
                  "max-w-full text-center text-[11px] leading-[13px] hyphens-manual [overflow-wrap:normal]",
                  isCurrent ? "font-semibold text-[var(--label)]" : "text-[var(--label-2)]",
                )}
              >
                {LABEL_BREAKS[step] ?? step}
              </span>
            </li>
          );
        })}
      </ol>
      {blocker && (
        <p className="m-0 text-[0.88rem] leading-5 text-[var(--danger)]" data-slot="visit-track-blocker">
          {blocker}
        </p>
      )}
    </div>
  );
}
