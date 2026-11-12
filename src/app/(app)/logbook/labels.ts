// Logbook labels (UX-9 ▸ Logbook, 17:189, 19:105, PR-82; T-068): shared by the page, the actions and the forms.
type Tone = "neutral" | "warning" | "success" | "danger";
export const SEG = [
  { key: "sterilization", label: "Sterilisasi" },
  { key: "calibration", label: "Kalibrasi & Perawatan" },
  { key: "b3_waste", label: "Limbah B3" },
] as const;
export type Seg = (typeof SEG)[number]["key"];
export const KIND_LABEL: Record<string, string> = { sterilization: "Sterilisasi", calibration: "Kalibrasi", maintenance: "Perawatan", b3_waste: "Limbah B3" };
export const METHOD: Record<string, string> = { autoclave: "Autoklaf", chemical: "Kimia", uv: "Sinar UV", other: "Lainnya" };
export const RESULT: Record<string, { tone: Tone; label: string }> = {
  ok: { tone: "success", label: "Baik" },
  adjusted: { tone: "warning", label: "Disetel ulang" },
  out_of_service: { tone: "danger", label: "Tidak dipakai" },
};
export const WASTE: Record<string, string> = { infectious: "Infeksius", sharps: "Benda tajam", pharmaceutical: "Farmasi", chemical: "Kimia", other: "Lainnya" };
export const DEVICE_TYPE: Record<string, string> = {
  laser: "Laser", laser_ablative: "Laser ablatif", laser_non_ablative: "Laser non-ablatif", ipl: "IPL", rf: "RF", hifu: "HIFU",
  microneedling_device: "Microneedling", centrifuge: "Sentrifus", facial_machine: "Mesin facial",
};
export const ROLE_LABEL: Record<string, string> = { doctor: "Dokter", nurse: "Perawat", therapist: "Terapis", manager: "Manajer" };
export const READERS = new Set(["doctor", "nurse", "therapist", "manager", "facility_head", "owner", "admin_pusat", "auditor"]);
export const WIDE = new Set(["owner", "admin_pusat", "auditor"]);
const fmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "UTC" });
export const date = (d: string) => fmt.format(new Date(`${d.slice(0, 10)}T00:00:00Z`));
export const grams = (g: number) => (g >= 1000 ? `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(g / 1000)} kg` : `${g} g`);
