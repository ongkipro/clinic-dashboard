// Pemeriksaan labels (UX-8, 19:85–91, PR-10; T-052): shared by the pages, the actions and the client forms.
// A plain module (constants in a "use client" module reach a Server Component only as references).
export const TEMPLATE_LABEL: Record<string, string> = {
  kulit_umum: "Kulit umum", jerawat: "Jerawat", pigmentasi: "Pigmentasi", penuaan: "Penuaan",
};
// The structured fields of each SOAP template with their choices (the database checks the same patterns).
const FITZ = ["I", "II", "III", "IV", "V", "VI"];
const SCALE = ["1", "2", "3", "4", "5"];
export const TEMPLATE_FIELDS: Record<string, { key: string; label: string; options?: string[]; numeric?: boolean }[]> = {
  kulit_umum: [{ key: "fitzpatrick", label: "Fitzpatrick", options: FITZ }, { key: "kelembapan", label: "Kelembapan (1–5)", options: SCALE },
    { key: "sebum", label: "Sebum (1–5)", options: SCALE }, { key: "sensitivitas", label: "Sensitivitas (1–5)", options: SCALE }],
  jerawat: [{ key: "fitzpatrick", label: "Fitzpatrick", options: FITZ }, { key: "lesi_inflamasi", label: "Lesi inflamasi", numeric: true },
    { key: "lesi_noninflamasi", label: "Lesi non-inflamasi", numeric: true }, { key: "derajat", label: "Derajat", options: ["ringan", "sedang", "berat"] }],
  pigmentasi: [{ key: "fitzpatrick", label: "Fitzpatrick", options: FITZ },
    { key: "area", label: "Area", options: ["dahi", "pipi", "hidung", "dagu", "leher", "seluruh_wajah"] }, { key: "intensitas", label: "Intensitas (1–5)", options: SCALE }],
  penuaan: [{ key: "fitzpatrick", label: "Fitzpatrick", options: FITZ }, { key: "kerutan", label: "Kerutan (1–5)", options: SCALE },
    { key: "elastisitas", label: "Elastisitas (1–5)", options: SCALE }],
};
export const VITALS: { key: string; label: string; unit: string }[] = [
  { key: "td_sistolik", label: "Tekanan darah sistolik", unit: "mmHg" }, { key: "td_diastolik", label: "Tekanan darah diastolik", unit: "mmHg" },
  { key: "nadi", label: "Nadi", unit: "x/menit" }, { key: "suhu_c10", label: "Suhu (×10, mis. 365 = 36,5 °C)", unit: "°C×10" }, { key: "berat_kg", label: "Berat badan", unit: "kg" },
];
// A small seeded picker (plan r1 point 2); the closed code system arrives with SATUSEHAT (T-102).
export const ICD10: [string, string][] = [
  ["L70.0", "Akne vulgaris"], ["L70.1", "Akne konglobata"], ["L71.9", "Rosasea"], ["L81.1", "Kloasma / melasma"], ["L81.4", "Hiperpigmentasi melanin lain"],
  ["L90.5", "Jaringan parut"], ["L57.4", "Kulit menua (elastosis)"], ["L30.9", "Dermatitis"], ["L20.9", "Dermatitis atopik"], ["B35.1", "Tinea unguium"],
];
export const SECTION_LABEL = { subjective: "Subjektif", objective: "Objektif", assessment: "Asesmen", plan_note: "Catatan rencana" } as const;
export const MAP_LABEL: Record<string, string> = { face_front: "Wajah depan", face_left: "Wajah kiri", face_right: "Wajah kanan", body: "Tubuh" };
export const LAYER_LABEL: Record<string, string> = { keluhan: "Keluhan", pemeriksaan: "Pemeriksaan", tindakan: "Tindakan" };
export const LAYER_COLOR: Record<string, string> = { keluhan: "var(--warning)", pemeriksaan: "var(--tint)", tindakan: "var(--danger)" };
export const UNIT_LABEL: Record<string, string> = { unit: "unit", ml: "ml", mg: "mg", cm2: "cm²" };
export const FACT_LABEL: Record<string, string> = {
  allergy: "Alergi", medication: "Obat yang sedang dipakai", pregnancy: "Kehamilan / menyusui", condition: "Kondisi kesehatan",
  skincare: "Perawatan kulit di rumah", prior_treatment: "Perawatan sebelumnya", note: "Catatan lain",
};
export const QUEUE_STATE: Record<string, { tone: "neutral" | "warning" | "success" | "locked"; label: string }> = {
  waiting: { tone: "neutral", label: "Menunggu intake" },
  ready: { tone: "warning", label: "Siap diperiksa" },
  draft: { tone: "locked", label: "Sedang diperiksa" },
};
// Doses: integer micro-units in the database; shown and entered with up to six decimals (no float maths).
export function formatDose(micro: number): string {
  const s = String(micro).padStart(7, "0");
  const int = s.slice(0, -6).replace(/^0+(?=\d)/, "");
  const frac = s.slice(-6).replace(/0+$/, "");
  return frac ? `${int},${frac}` : int;
}
export function parseDose(text: string): number | null {
  const m = /^(\d{1,4})(?:[.,](\d{1,6}))?$/.exec(text.trim());
  if (!m) return null;
  const v = Number(m[1]) * 1_000_000 + Number((m[2] ?? "").padEnd(6, "0"));
  return v >= 1 && v <= 1_000_000_000 ? v : null;
}
export const rupiah = (n: number | null) => (n == null ? "Harga belum ada" : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n));
