// Target (PR-47, K19, DEC-100; HYG-NAV-1): pure helpers shared by Target Saya (/saya/target) and Target & Scorecard Staf (/staf/target).
// The readers (target_mine / target_list, migration 0103) decide who sees what; these only format. No patient data.
import type { MyTarget, TargetRow } from "../../../../modules/commission/targets/targets";

export const PERIOD = /^\d{4}-(0[1-9]|1[0-2]|Q[1-4])$/;
const idr = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const pf = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });
export const rp = (n: number) => idr.format(n).replace(/\s/g, "");

// "2026-11" → "November 2026"; "2026-Q4" → "Triwulan 4 2026".
export function periodLabel(p: string): string {
  const q = /^(\d{4})-Q([1-4])$/.exec(p);
  if (q) return `Triwulan ${q[2]} ${q[1]}`;
  return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${p}-01T00:00:00Z`));
}
// The period before / after, same kind.
export function shiftPeriod(p: string, by: number): string {
  const q = /^(\d{4})-Q([1-4])$/.exec(p);
  if (q) {
    const t = Number(q[1]) * 4 + (Number(q[2]) - 1) + by;
    return `${Math.floor(t / 4)}-Q${(t % 4) + 1}`;
  }
  const [y, m] = p.split("-").map(Number);
  const t = y * 12 + (m - 1) + by;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

// Attainment from the reader's basis points (null = no target or a zero target): never 0% for "no target".
export function attainment(r: Pick<TargetRow, "target" | "attainment_bps">): { text: string; pct: number | null } {
  if (!r.target) return { text: "Target belum ditetapkan", pct: null };
  if (r.attainment_bps === null) return { text: "Target belum ditetapkan", pct: null };
  const pct = r.attainment_bps / 100;
  return { text: `${pf.format(pct)}% dari target`, pct };
}
export const utilization = (bps: number | null) => (bps === null ? "Belum ada jadwal kerja" : `${pf.format(bps / 100)}%`);
export const plans = (r: Pick<TargetRow, "plans_actual" | "target">) =>
  r.target?.plans_target == null ? `${r.plans_actual} rencana terpilih penuh` : `${r.plans_actual} dari ${r.target.plans_target} rencana terpilih penuh`;
export const minutes = (m: number) => `${new Intl.NumberFormat("id-ID").format(Math.round(m / 60))} jam`;

// The figures shown for one row, in display order (shared by both pages so they never disagree).
export function figures(r: TargetRow | MyTarget): [string, string][] {
  const s = r.scorecard;
  return [
    ["Nilai closing", rp(Number(r.closing_value_actual))],
    ["Target", r.target ? rp(Number(r.target.closing_value_target)) : "Belum ditetapkan"],
    ["Rencana", plans(r)],
    ["Layanan selesai", String(s.completed_services)],
    ["Utilisasi (K15)", utilization(s.utilization_bps)],
    ["Komisi bersih", rp(Number(s.commission_net))],
  ];
}
