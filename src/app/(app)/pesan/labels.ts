// Pesan copy (UX-17, 17:56, 19:163/167/223; T-090): segments Percakapan · Templat · Nomor per role, filters, states, in Bahasa Indonesia.
import type { StatusTone } from "../../../components/ui/status-badge";

type Seg = "percakapan" | "templat" | "nomor";
const SEGS: Record<Seg, { label: string; href: string; roles: string[] }> = {
  percakapan: { label: "Percakapan", href: "/pesan", roles: ["central_cs", "fo_cashier", "bc", "manager", "owner"] },
  templat: { label: "Templat", href: "/pesan/templat", roles: ["owner", "admin_pusat", "marketing", "central_cs", "fo_cashier", "bc", "manager", "auditor"] },
  nomor: { label: "Nomor", href: "/pesan/nomor", roles: ["owner", "admin_pusat", "central_cs", "marketing", "manager", "fo_cashier", "bc", "auditor"] },
};
export const canSee = (role: string, s: Seg) => SEGS[s].roles.includes(role);
export const SEGMENTS = (role: string, active: Seg) =>
  (Object.keys(SEGS) as Seg[]).filter((s) => canSee(role, s)).map((s) => ({ label: SEGS[s].label, href: SEGS[s].href, active: s === active }));

// The notice after a conversation action (the page shows it from ?ok=).
export const DONE: Record<string, string> = {
  assign: "Percakapan ditugaskan.", unassign: "Penugasan dilepas.", route: "Percakapan diarahkan ke cabang.",
  close: "Percakapan ditandai selesai.", reopen: "Percakapan dibuka lagi.",
};
export const FILTERS = [
  ["all", "Semua"], ["unassigned", "Belum Ditugaskan"], ["mine", "Milikku"], ["closed", "Selesai"],
] as const;
export const STATUS: Record<string, [string, StatusTone]> = {
  received: ["Diterima", "neutral"], queued: ["Antre", "warning"], sent: ["Terkirim", "neutral"], delivered: ["Sampai", "success"],
  read: ["Dibaca", "success"], failed: ["Gagal", "danger"],
};
export const TEMPLATE_STATUS: Record<string, [string, StatusTone]> = {
  draft: ["Draf", "neutral"], pending: ["Ditinjau Meta", "warning"], approved: ["Disetujui", "success"], rejected: ["Ditolak", "danger"],
};
export const CATEGORY: Record<string, string> = { utility: "Utilitas", marketing: "Promosi", authentication: "Autentikasi" };
export const NUMBER_STATE: Record<string, [string, StatusTone]> = {
  number_pending_registration: ["Menunggu registrasi", "warning"], number_registered: ["Terdaftar", "neutral"],
  display_name_pending: ["Nama tampil ditinjau", "warning"], active: ["Aktif", "success"], quality_restricted: ["Kualitas dibatasi", "danger"],
  revoked: ["Dicabut", "locked"],
};
export const WABA_STATE: Record<string, string> = {
  not_connected: "Belum terhubung", signup_started: "Pendaftaran dimulai", token_exchanged: "Token tersimpan", app_subscribed: "Aplikasi terhubung",
  number_pending_registration: "Nomor menunggu registrasi", number_registered: "Nomor terdaftar", display_name_pending: "Nama tampil ditinjau",
  active: "Aktif", verification_required: "Perlu verifikasi bisnis Meta", quality_restricted: "Kualitas dibatasi", revoked: "Dicabut",
};
const fmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });
export const when = (iso: string | null) => (iso ? fmt.format(new Date(iso)) : "—");
export const phone = (waId: string) => `+${waId}`;
// "sisa 3 jam 12 menit" until the 24 h window closes.
export function windowLeft(expires: string | null, now: string) {
  if (!expires) return null;
  const ms = new Date(expires).getTime() - new Date(now).getTime();
  if (ms <= 0) return null;
  const m = Math.floor(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} jam ${m % 60} menit` : `${m} menit`;
}
