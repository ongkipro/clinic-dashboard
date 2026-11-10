// Templat Dokumen and Surat labels (UX-54, 19:92, PR-74; T-058): shared by the pages, the actions and the forms.
export const KIND_LABEL: Record<string, string> = { receipt: "Struk", consent: "Persetujuan Tindakan", letter: "Surat", legal: "Halaman Legal" };
export const LETTER_TYPE_LABEL: Record<string, string> = { surat_keterangan: "Surat Keterangan", rujukan: "Surat Rujukan", resume: "Resume Medis" };
export const PAPER_LABEL: Record<string, string> = { a4: "A4", "80mm": "Struk 80 mm", "58mm": "Struk 58 mm" };
export const TEMPLATE_WRITERS = new Set(["owner", "admin_pusat", "facility_head"]);
export const CLINICAL_KINDS = new Set(["consent", "letter"]);
export const LETTER_READERS = new Set(["doctor", "facility_head", "records_officer"]);
// The kinds a role edits on UX-54 (DEC-067): owner and admin pusat every kind, the facility head the clinical ones.
export const kindsFor = (role: string): string[] =>
  role === "owner" || role === "admin_pusat" ? ["receipt", "consent", "letter", "legal"] : role === "facility_head" ? ["consent", "letter"] : [];
export const PLACEHOLDER_HINT: Record<string, string> = {
  "klinik.nama": "Nama badan usaha klinik", "klinik.npwp": "NPWP klinik", tanggal: "Tanggal dokumen", "cabang.nama": "Nama cabang", "cabang.alamat": "Alamat cabang",
  "pasien.nama": "Nama pasien", "pasien.no_rm": "Nomor rekam medis", "pasien.tanggal_lahir": "Tanggal lahir", "pasien.jenis_kelamin": "Jenis kelamin",
  "kunjungan.tanggal": "Tanggal kunjungan", "dokter.nama": "Nama dokter", "dokter.sip": "Nomor SIP dokter di cabang",
  "pemeriksaan.keluhan": "Keluhan (subjektif)", "pemeriksaan.objektif": "Temuan (objektif)", "pemeriksaan.asesmen": "Asesmen",
  "pemeriksaan.rencana": "Rencana", "pemeriksaan.icd10": "Kode ICD-10", "struk.nomor": "Nomor struk", "struk.baris": "Baris tagihan",
  "struk.total": "Total", "struk.metode_bayar": "Metode bayar", "tindakan.daftar": "Daftar tindakan", "tindakan.risiko": "Risiko tindakan",
  tanda_tangan: "Tempat tanda tangan", "vendor.nama": "Nama vendor", "vendor.nib": "NIB vendor", "vendor.pse": "Nomor PSE vendor",
  "vendor.npwp": "NPWP vendor", "vendor.situs": "Situs vendor", "vendor.url_privasi": "Tautan privasi vendor",
  "vendor.email_dukungan": "Email dukungan", "vendor.telepon_dukungan": "Telepon dukungan",
};
