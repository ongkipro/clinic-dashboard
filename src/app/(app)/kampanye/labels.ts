// Kampanye & Segmen (UX-19; T-100): copy and codes.
import type { SegmentRules } from "../../../modules/crm/campaigns/campaigns";

export const STATE: Record<string, { label: string; tone: "neutral" | "success" | "warning" | "danger" }> = {
  draft: { label: "Draf", tone: "neutral" }, scheduled: { label: "Terjadwal", tone: "warning" },
  queued: { label: "Masuk antrean", tone: "success" }, cancelled: { label: "Dibatalkan", tone: "neutral" },
};
export const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
export const SKIP: Record<string, string> = {
  cap_horizon_exceeded: "batas pesan per pasien tercapai selama 7 hari",
  no_consent: "tanpa persetujuan pemasaran", patient_phone_required: "nomor telepon belum ada",
  number_not_sending: "nomor WhatsApp klinik belum dapat mengirim", template_not_usable: "templat belum disetujui",
};
export const day = (d: string | null) => d ? new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`)) : "—";
// A rule set in words (no patient data).
export function rulesText(r: SegmentRules, branches: { id: string; name: string }[]) {
  const t: string[] = [];
  if (r.branch_id) t.push(`terdaftar di ${branches.find((b) => b.id === r.branch_id)?.name ?? "cabang"}`);
  if (r.visit_within_days) t.push(`berkunjung dalam ${r.visit_within_days} hari terakhir`);
  if (r.no_visit_within_days) t.push(`tidak berkunjung dalam ${r.no_visit_within_days} hari terakhir`);
  if (r.birthday_month) t.push(`ulang tahun bulan ${MONTHS[r.birthday_month - 1]}`);
  if (r.age_min !== undefined || r.age_max !== undefined) t.push(`usia ${r.age_min ?? 0}–${r.age_max ?? 120} tahun`);
  if (r.sex) t.push(r.sex === "female" ? "perempuan" : "laki-laki");
  return t.join(" · ");
}

// The send outcome (Sol 75a1a20a P2), counts only — never a member: the redirect query from the send result, and the notice from it.
// The query is read back from the URL, so the notice accepts only small non-negative integers; anything else shows a neutral notice.
export const sentQuery = (r: { queued: number; skipped: Record<string, number> }) =>
  `terkirim&q=${r.queued}&x=${Object.values(r.skipped).reduce((a, b) => a + b, 0)}`;
const COUNT = /^(0|[1-9][0-9]{0,6})$/;
export function sentNotice(qs: unknown, xs: unknown): string {
  const q = typeof qs === "string" && COUNT.test(qs) ? Number(qs) : null;
  const x = typeof xs === "string" && COUNT.test(xs) ? Number(xs) : null;
  if (q === null || x === null) return "Kampanye diproses. Lihat jumlah antrean di daftar kampanye.";
  if (q === 0) return `Tidak ada pesan yang masuk antrean: ${x} pasien dikecualikan saat pengiriman.`;
  if (x === 0) return `${q} pesan masuk antrean pengiriman.`;
  return `${q} pesan masuk antrean pengiriman; ${x} pasien dikecualikan saat pengiriman.`;
}
