// Bahasa Indonesia labels for the service master (PR-88, T-034), shared by Master Layanan and the
// Persetujuan detail.
export const CATEGORY_LABEL: Record<string, string> = {
  filler: "Filler",
  toxin: "Toksin botulinum",
  threads: "Tanam benang",
  laser_ablative: "Laser ablatif",
  injection: "Injeksi",
  infusion: "Infus",
  laser_non_ablative: "Laser non-ablatif",
  peeling_chemical: "Peeling kimia",
  microneedling: "Microneedling",
  facial: "Facial",
  body_treatment: "Perawatan tubuh",
  consultation: "Konsultasi",
};
export const ROOM_LABEL: Record<string, string> = { consultation: "Ruang konsultasi", treatment: "Ruang tindakan", pharmacy: "Ruang farmasi" };
export const DEVICE_LABEL: Record<string, string> = {
  laser: "Laser",
  laser_ablative: "Laser ablatif",
  laser_non_ablative: "Laser non-ablatif",
  ipl: "IPL",
  rf: "Radiofrekuensi (RF)",
  hifu: "HIFU",
  microneedling_device: "Alat microneedling",
  centrifuge: "Sentrifus",
  facial_machine: "Mesin facial",
};
export const PROFESSION_LABEL: Record<string, string> = { doctor: "Dokter", nurse: "Perawat", therapist: "Terapis" };
export const MODE_LABEL: Record<string, string> = {
  performs: "Melakukan",
  supervised: "Melakukan dengan pelimpahan tertulis",
  assists: "Membantu saja",
  none: "Tidak boleh",
};
export const resourceLabel = (kind: string, code: string) => (kind === "room" ? ROOM_LABEL[code] : DEVICE_LABEL[code]) ?? code;
