// Insiden labels (UX-28 ▸ Insiden, 17:188, 19:96, PR-82; T-068).
type Tone = "neutral" | "warning" | "success" | "danger";
export const CLASS_LABEL: Record<string, { short: string; long: string }> = {
  ktd: { short: "KTD", long: "Kejadian Tidak Diharapkan" },
  knc: { short: "KNC", long: "Kejadian Nyaris Cedera" },
  ktc: { short: "KTC", long: "Kejadian Tidak Cedera" },
  kpc: { short: "KPC", long: "Kondisi Potensial Cedera" },
  sentinel: { short: "Sentinel", long: "Kejadian sentinel" },
};
export const STATE: Record<string, { tone: Tone; label: string }> = {
  reported: { tone: "warning", label: "Dilaporkan" },
  investigating: { tone: "neutral", label: "Investigasi" },
  closed: { tone: "success", label: "Ditutup" },
};
export const EVENT: Record<string, string> = {
  reported: "Dilaporkan", taken: "Mulai ditangani", investigated: "Investigasi selesai", determined: "Keputusan pelaporan", submitted: "Laporan dikirim", closed: "Ditutup",
};
export const ROLE_LABEL: Record<string, string> = {
  doctor: "Dokter", nurse: "Perawat", therapist: "Terapis", pharmacist: "Apoteker", bc: "Beauty Consultant", manager: "Manajer Cabang",
  facility_head: "Penanggung Jawab Klinik", owner: "Owner", auditor: "Auditor Internal",
};
export const REPORTERS = new Set(["doctor", "nurse", "therapist", "pharmacist", "bc", "manager", "facility_head"]);
export const READERS = new Set([...REPORTERS, "owner", "auditor"]);
const fmtAt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });
const fmtDay = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "UTC" });
export const when = (iso: string) => fmtAt.format(new Date(iso));
export const day = (d: string) => fmtDay.format(new Date(`${d.slice(0, 10)}T00:00:00Z`));
