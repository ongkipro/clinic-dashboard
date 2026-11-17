// SATUSEHAT page labels (UX-23; T-102). Codes from the database mapped to Indonesian; any unknown code shows as itself (never clinical).
export const TYPE: Record<string, string> = {
  Encounter: "Kunjungan", Condition: "Diagnosis", Observation: "Tanda vital", Procedure: "Tindakan", Medication: "Obat",
  MedicationRequest: "Resep", MedicationDispense: "Penyerahan obat",
};
export const LINK: Record<string, string> = {
  queued: "Antre", sending: "Dikirim", confirmed: "Dikonfirmasi", failed: "Ditolak", outcome_unknown: "Menunggu kepastian", exception: "Perlu ditangani",
  held: "Ditahan", withdrawal_pending: "Perlu penarikan manual",
};
export const REASON: Record<string, string> = {
  http_4xx: "ditolak SATUSEHAT", retry_exhausted: "gagal setelah beberapa percobaan", reconcile_unresolved: "tidak ditemukan setelah jawaban hilang",
  update_unresolved: "perubahan belum terkonfirmasi", duplicate_remote: "ditemukan ganda di SATUSEHAT", organization_changed: "ID organisasi cabang berubah",
  source_removed: "data sumber sudah dihapus", terminology_unmapped: "kode belum dipetakan", mapping_unvalidated: "kode belum divalidasi di sandbox",
  practitioner_unresolved: "nomor IHS tenaga kesehatan belum diisi", identity_review: "identitas pasien perlu ditinjau", credentials_missing: "kredensial cabang belum aktif",
  facility_context: "data fasilitas tidak cocok", no_room: "ruang periksa belum dipilih", location_missing: "ruang belum punya ID lokasi SATUSEHAT",
  location_conflict: "ID lokasi dipakai cabang lain", practitioner_credential: "STR/SIP dokter tidak berlaku", no_nik: "pasien tanpa NIK",
  not_found: "tidak ditemukan", ambiguous: "lebih dari satu hasil", demographics_conflict: "data diri berbeda",
};
export const OUTBOX: Record<string, string> = { queued: "Antre", leased: "Sedang dikirim", done: "Selesai", held: "Ditahan" };
export const RESEND: Record<string, string> = {
  remote_checked: "Sudah dicek di portal SATUSEHAT", provider_recovered: "Gangguan SATUSEHAT sudah pulih", data_corrected: "Data sudah diperbaiki",
};
export const reason = (r: string | null | undefined) => (r ? REASON[r] ?? r : "");
// Kirim Ulang is offered exactly where satusehat_resend (0116) re-queues a link: failed links and the two unresolved-uncertainty exceptions.
// Any other exception (duplicate_remote, organization_changed, …) or held link needs a person or another fix — Kirim Ulang would change
// nothing (review r1, Sol 13649c04). tests/integrations/satusehat/page.test.ts proves this predicate against the command.
const RESENDABLE_EXCEPTION = new Set(["reconcile_unresolved", "update_unresolved"]);
export const resendable = (status: string, why: string | null) => status === "failed" || (status === "exception" && RESENDABLE_EXCEPTION.has(why ?? ""));
// "state:reason" counters into a label
export function counter(k: string, table: Record<string, string>) {
  const [s, r] = k.split(":");
  return r ? `${table[s] ?? s} — ${reason(r)}` : table[s] ?? s;
}
export const when = (t: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(t));
export const shortId = (id: string) => id.slice(-8);
