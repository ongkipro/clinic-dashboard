// Lead copy (UX-18, 17:171, 19:164; T-092): stages, sources, lost reasons, segments, in Bahasa Indonesia.
import type { StatusTone } from "../../../components/ui/status-badge";

export const STAGE: Record<string, [string, StatusTone]> = {
  new: ["Baru", "neutral"], contacted: ["Dihubungi", "neutral"], booked: ["Booking", "warning"], arrived: ["Datang", "warning"],
  converted: ["Bayar", "success"], lost: ["Hilang", "locked"],
};
export const NEXT: Record<string, { to: string; label: string } | undefined> = {
  new: { to: "contacted", label: "Tandai Dihubungi" }, contacted: { to: "booked", label: "Tandai Booking" },
  booked: { to: "arrived", label: "Tandai Datang" }, arrived: { to: "converted", label: "Tandai Bayar" },
};
export const SOURCE: Record<string, string> = {
  whatsapp: "WhatsApp", walk_in: "Datang langsung", phone: "Telepon", instagram: "Instagram", tiktok: "TikTok", website: "Situs web",
  referral: "Rujukan", ads: "Iklan", other: "Lainnya",
};
export const LOST: Record<string, string> = {
  harga: "Harga", jadwal: "Jadwal tidak cocok", lokasi: "Lokasi", tidak_merespons: "Tidak merespons", memilih_klinik_lain: "Memilih klinik lain",
  tidak_cocok: "Tidak cocok dengan layanan", duplikat: "Duplikat", lainnya: "Lainnya",
};
export const CHANNEL: Record<string, string> = {
  whatsapp: "WhatsApp", instagram: "Instagram", tiktok: "TikTok", website: "Situs web", referral: "Rujukan", ads: "Iklan", event: "Acara", other: "Lainnya",
};
export const STAGE_FILTERS = [["open", "Terbuka"], ["new", "Baru"], ["contacted", "Dihubungi"], ["booked", "Booking"], ["arrived", "Datang"],
  ["converted", "Bayar"], ["lost", "Hilang"], ["all", "Semua"]] as const;
export const SCOPE_FILTERS = [["all", "Semua"], ["mine", "Milikku"], ["unassigned", "Belum Ditugaskan"]] as const;
export const SEGMENTS = (segment: string) => [
  { label: "Lead", href: "/lead", active: segment === "lead" },
  { label: "Tindak Lanjut", href: "/lead?segmen=tindak-lanjut", active: segment === "tindak-lanjut" },
  { label: "Kampanye", href: "/lead?segmen=kampanye", active: segment === "kampanye" },
];
const fmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });
export const when = (iso: string | null) => (iso ? fmt.format(new Date(iso)) : "—");
