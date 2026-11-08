// Cabang labels (T-036). Kept outside the "use client" forms module: a server page importing a value
// from a client module gets a client reference, not the data ("undefined" in the subtitle, browser run 1).
export const DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
export const TZ_LABEL: Record<string, string> = { "Asia/Jakarta": "WIB (Jakarta)", "Asia/Makassar": "WITA (Makassar)", "Asia/Jayapura": "WIT (Jayapura)" };
export const ROOM_LABEL: Record<string, string> = { consultation: "Ruang konsultasi", treatment: "Ruang tindakan", pharmacy: "Ruang farmasi" };
export const DEVICE_LABEL: Record<string, string> = {
  laser: "Laser", laser_ablative: "Laser ablatif", laser_non_ablative: "Laser non-ablatif", ipl: "IPL", rf: "Radiofrekuensi (RF)", hifu: "HIFU",
  microneedling_device: "Alat microneedling", centrifuge: "Sentrifus", facial_machine: "Mesin facial",
};
