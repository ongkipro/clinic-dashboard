// Profil Pasien labels (UX-29, T-040). Plain constants for the server page and the client forms (a
// "use client" module cannot export constants to a server component).
export const SEX: Record<string, string> = { female: "Perempuan", male: "Laki-laki" };
export const IDENTITY: Record<string, string> = { nik: "NIK (KTP/KK)", passport: "Paspor", kitas: "KITAS/KITAP", newborn_via_guardian: "Bayi baru lahir (lewat wali)" };
export const RELIGION: Record<string, string> = { islam: "Islam", kristen: "Kristen", katolik: "Katolik", hindu: "Hindu", buddha: "Buddha", konghucu: "Konghucu", lainnya: "Lainnya" };
export const EDUCATION: Record<string, string> = { tidak_sekolah: "Tidak sekolah", sd: "SD", smp: "SMP", sma: "SMA/SMK", diploma: "Diploma", s1: "S1", s2: "S2", s3: "S3", lainnya: "Lainnya" };
export const MARITAL: Record<string, string> = { belum_kawin: "Belum kawin", kawin: "Kawin", cerai_hidup: "Cerai hidup", cerai_mati: "Cerai mati" };
export const RELATION: Record<string, string> = { ayah: "Ayah", ibu: "Ibu", wali: "Wali", lainnya: "Lainnya" };
// Grantable purposes; procedure consent belongs to Persetujuan Tindakan (T-054, DEC-052).
export const PURPOSE: Record<string, string> = {
  care_notice: "Layanan & rekam medis", clinical_photo: "Foto klinis (internal)", marketing_wa: "Pesan promo WhatsApp", publication: "Publikasi foto/testimoni",
};
export const CHANNEL: Record<string, string> = { in_person: "Langsung", paper: "Formulir kertas", whatsapp: "WhatsApp", phone: "Telepon" };
