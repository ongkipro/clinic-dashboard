// Indonesian UI labels for UX-1 / UX-41 Impor Data Awal (NFR-8, TEST-LOC-1; T-128).
export const BATCH_STATE_LABEL: Record<string, string> = {
  staged: "Tersimpan sementara",
  validated: "Tervalidasi",
  approved: "Disetujui Owner",
  applying: "Sedang diterapkan",
  applied: "Diterapkan",
  apply_failed: "Gagal diterapkan",
  rolled_back: "Dibatalkan (reversing)",
  rejected: "Ditolak",
};

export const ISSUE_LABEL: Record<string, string> = {
  batch_empty: "Berkas tidak berisi baris data.",
  batch_too_large: "Jumlah baris melebihi batas maksimal 2.000 baris per batch.",
  invalid_cutover_date: "Tanggal cutover tidak valid (gunakan YYYY-MM-DD).",
  missing_external_id: "ID sumber eksternal wajib diisi dan valid.",
  duplicate_external_id_in_batch: "ID sumber eksternal duplikat di dalam batch.",
  duplicate_nik_in_batch: "NIK duplikat terdeteksi pada ID pasien berbeda di dalam batch.",
  invalid_name: "Nama pasien tidak memenuhi batas panjang.",
  invalid_birth_date: "Tanggal lahir tidak valid.",
  invalid_sex: "Jenis kelamin tidak valid.",
  invalid_nik: "Format NIK harus 16 digit angka.",
  invalid_phone: "Nomor telepon harus berformat E.164.",
  invalid_amount: "Nominal rupiah harus bilangan bulat tanpa desimal.",
  amount_out_of_range: "Nominal rupiah berada di luar batas yang diizinkan.",
  invalid_branch_code: "Kode cabang tidak dikenal pada klinik ini.",
  unknown_patient_ref: "Referensi ID pasien tidak ditemukan.",
  unknown_catalog_code: "Kode layanan tidak ditemukan pada katalog aktif.",
  invalid_session_counts: "Jumlah sesi terpakai dan total sesi tidak konsisten.",
  overcollected_package: "Nilai terpakai paket melebihi nilai terbayar.",
  invalid_expiry_date: "Tanggal kedaluwarsa paket tidak valid.",
  invalid_due_date: "Tanggal jatuh tempo piutang tidak valid.",
};

export const ENTITY_LABEL: Record<string, string> = {
  patients: "Pasien",
  packages: "Paket",
  balances: "Saldo pasien",
  receivables: "Piutang",
  booking_dps: "DP janji",
};

export const ROLLBACK_REASON_LABEL: Record<string, string> = {
  cutover_correction: "Koreksi angka cutover",
  duplicate_batch: "Batch duplikat",
  mapping_error: "Kesalahan pemetaan cabang/layanan",
  owner_cancelled: "Dibatalkan oleh Owner",
};
