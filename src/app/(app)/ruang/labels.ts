// Ruang Tindakan copy (UX-9; T-064): stage, outcome and blocker words in Bahasa Indonesia; no clinical text.
import type { Outcome, Stage } from "../../../modules/treatment/treatment";

export const READERS = new Set(["doctor", "nurse", "therapist"]);
export const STAGE_LABEL: Record<Stage, string> = { preparation: "Persiapan", anesthesia: "Anestesi Topikal", procedure: "Tindakan", recovery: "Pemulihan" };
export const OUTCOME_LABEL: Record<Outcome, string> = {
  completed: "Selesai sesuai rencana",
  medical_stop: "Dihentikan — alasan medis",
  clinic_stop: "Dihentikan — kendala klinik",
  patient_stop: "Dihentikan — pilihan pasien",
};
// What each outcome means for the session (PR-14), shown under the option.
export const OUTCOME_NOTE: Record<Outcome, string> = {
  completed: "Sesi terpakai.",
  medical_stop: "Sesi tidak terpakai; jadwal ulang tanpa biaya.",
  clinic_stop: "Sesi tidak terpakai; front office menjadwalkan ulang atau memindahkan ke saldo.",
  patient_stop: "Sesi terpakai.",
};
export const BLOCKER_LABEL: Record<string, string> = {
  payment_unpaid: "Pembayaran belum selesai",
  examination_unsigned: "Pemeriksaan belum ditandatangani dokter",
  credential_missing: "STR/SIP pelaksana belum ada",
  credential_expired: "STR/SIP pelaksana sudah habis",
  not_eligible: "Pelaksana tidak berwenang untuk tindakan ini",
  contraindication_unresolved: "Kontraindikasi belum ditinjau dokter",
  consent_missing: "Persetujuan tindakan belum ada",
  consent_mismatch: "Persetujuan tindakan tidak sesuai rencana",
};
export const STATE_LABEL = { started: "Berjalan", paused: "Dijeda", finished: "Selesai" } as const;
