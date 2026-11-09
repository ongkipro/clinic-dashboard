// Privasi labels (T-039). A plain module: the server page imports values from here, never from the client
// forms module (T-036 lesson).
import type { StatusTone } from "../../../components/ui/status-badge";

export const PURPOSE: Record<string, string> = {
  care_notice: "Layanan & rekam medis", procedure: "Tindakan", clinical_photo: "Foto klinis (internal)", marketing_wa: "Pesan promo WhatsApp", publication: "Publikasi foto/testimoni",
};
export const CHANNEL: Record<string, string> = { in_person: "Langsung", paper: "Formulir kertas", whatsapp: "WhatsApp", phone: "Telepon" };
export const BREACH_STATE: Record<string, { label: string; tone: StatusTone }> = {
  open: { label: "Terbuka", tone: "warning" },
  assessed: { label: "Dinilai", tone: "warning" },
  notified: { label: "Diberitahukan", tone: "success" },
  not_notifiable: { label: "Tidak wajib diberitahukan", tone: "neutral" },
  closed: { label: "Ditutup", tone: "locked" },
};
export const RECIPIENT: Record<string, string> = { data_subjects: "Subjek data (pasien)", authority: "Otoritas", other: "Lainnya" };
export const ROLE: Record<string, string> = { processor: "Pemroses", sub_processor: "Sub-pemroses" };
export const SECTIONS = { persetujuan: "Persetujuan", pemroses: "Pemroses", kebocoran: "Kebocoran" } as const;
export type Section = keyof typeof SECTIONS;
export const at = (d: Date) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(d);
// "Batas 3×24 jam: {sisa waktu}" (17:191): hours and minutes left, or how long overdue.
export function timeLeft(minutes: number): string {
  const m = Math.abs(minutes);
  const text = `${Math.floor(m / 60)} jam ${m % 60} menit`;
  return minutes >= 0 ? `${text} lagi` : `lewat ${text}`;
}
