// VisitTrack states for a room visit (10:70): the visit's steps as segments; a blocked step names its blocker.
import type { StepState, VisitStep } from "../../../components/visit-track/visit-track";
import type { Steps } from "../../../modules/treatment/treatment";

const SEGMENT = { intake: "Pendampingan", doctor: "Dokter", selection: "Pilihan", consent: "Persetujuan", payment: "Bayar", preparation: "Persiapan", treatment: "Tindakan", dispensing: "Serahkan" } as const;
const TRACK: Record<string, StepState> = { not_started: "belum", in_progress: "berjalan", done: "selesai", not_needed: "tidak_perlu", blocked: "terblokir" };
export function track(v: { steps: Steps; closed: boolean; blocker: string | null }): { states: Partial<Record<VisitStep, StepState>>; blocker?: string } {
  const states: Partial<Record<VisitStep, StepState>> = { Daftar: "selesai", Selesai: v.closed ? "selesai" : "belum" };
  for (const [k, seg] of Object.entries(SEGMENT)) states[seg] = TRACK[v.steps[k as keyof typeof SEGMENT]] ?? "belum";
  const anyBlocked = Object.values(states).includes("terblokir");
  const text = v.blocker?.trim() || (anyBlocked ? "Menunggu penyelesaian kendala" : "");
  return text ? { states, blocker: text } : { states };
}
