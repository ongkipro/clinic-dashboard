// Kredensial labels and rules shown in the forms (UX-3; T-050), shared by the server pages, the server
// actions and the client forms. A plain module: a non-component export of a "use client" module reaches a
// Server Component only as a client reference, and a "use server" module may export only async functions.
export const KIND_LABEL: Record<string, string> = { str: "STR", sip: "SIP", sipp: "SIPP", sipa: "SIPA" };
export const PROFESSION_LABEL: Record<string, string> = {
  dokter: "Dokter", dokter_gigi: "Dokter gigi", perawat: "Perawat", bidan: "Bidan", apoteker: "Apoteker", tenaga_kesehatan_lain: "Tenaga kesehatan lain",
};
// The professions each kind may carry (the table check in migration 0068).
export const KIND_PROFESSIONS: Record<string, readonly string[]> = {
  str: ["dokter", "dokter_gigi", "perawat", "bidan", "apoteker", "tenaga_kesehatan_lain"],
  sip: ["dokter", "dokter_gigi", "bidan", "tenaga_kesehatan_lain"],
  sipp: ["perawat"],
  sipa: ["apoteker"],
};
// Why the viewer cannot verify a credential, in words (review r1 P2-1; plan r1 P3-1).
export const DECIDE_BLOCKED: Record<string, string> = {
  holder: "Anda pemegang kredensial ini; orang lain yang memverifikasi.",
  recorder: "Anda yang mencatat kredensial ini; orang lain yang memverifikasi.",
  inviter: "Anda yang mengundang staf ini; orang lain yang memverifikasi.",
  facility_head: "Penanggung Jawab Klinik cabang ini yang memverifikasi.",
};
