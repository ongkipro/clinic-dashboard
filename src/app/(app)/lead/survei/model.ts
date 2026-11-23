// Survei model (PR-78, K26, DEC-110; HYG-NAV-1): totals across the visit branches the reader returned, and the label of a score. Pure;
// tested in tests/ui/hyg-nav-1.test.ts. A total with no survey has no average (never 0).
import type { SurveyRow, SurveySummary } from "../../../../modules/crm/surveys/surveys";

export type Total = { total: number; low: number; avg: number | null; lowPct: number | null };
export function totals(rows: SurveySummary[]): Total {
  const total = rows.reduce((s, r) => s + Number(r.total), 0);
  const low = rows.reduce((s, r) => s + Number(r.low_count), 0);
  if (total === 0) return { total: 0, low: 0, avg: null, lowPct: null };
  // weighted by each branch's count (the reader rounds per branch; re-weighting keeps the tenant figure honest)
  const avg = rows.reduce((s, r) => s + Number(r.avg_score) * Number(r.total), 0) / total;
  return { total, low, avg: Math.round(avg * 100) / 100, lowPct: Math.round((low * 10000) / total) / 100 };
}
const nf = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });
export const avgText = (t: Total) => (t.avg === null ? "Belum ada survei" : `${nf.format(t.avg)} dari 5`);
export const lowText = (t: Total) => (t.lowPct === null ? "—" : `${nf.format(t.lowPct)}% (${t.low})`);
export const FOLLOWUP: Record<NonNullable<SurveyRow["followup_state"]>, string> = { open: "Tindak lanjut terbuka", done: "Tindak lanjut selesai", dismissed: "Tindak lanjut ditutup" };
// Marketing sees no identity for non-consented patients (consent_masked); the reader already blanks the name.
export const who = (r: SurveyRow) => (r.consent_masked ? "Pasien (tanpa persetujuan promosi)" : [r.patient_name, r.patient_mrn].filter(Boolean).join(" · ") || "Pasien");
