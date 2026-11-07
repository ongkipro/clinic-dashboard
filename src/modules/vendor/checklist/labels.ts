// Onboarding checklist labels (T-027, UX-41): item keys and the database's blocker strings as
// Indonesian text. No server imports: used by server pages and by the console's client code.
export const CHECKLIST_ITEMS = ["entity_tax", "catalog", "staff_credentials", "money_settings", "payment_port", "waba", "satusehat", "branch_setup"] as const;
export type ChecklistItemKey = (typeof CHECKLIST_ITEMS)[number];

// The blocker string the database names (`agreement:processor_agreement_signed`, `checklist:<item>[@<branch code>]`,
// `vendor:<reason>`, `clinical:<obligation>`) as Indonesian text for the console.
export const ITEM_LABEL: Record<ChecklistItemKey, string> = {
  entity_tax: "Badan usaha & status pajak",
  catalog: "Katalog layanan",
  staff_credentials: "Staf & kredensial",
  money_settings: "Pengaturan uang & kasir",
  payment_port: "Gerbang pembayaran",
  waba: "WhatsApp Business (WABA)",
  satusehat: "SATUSEHAT",
  branch_setup: "Data cabang",
};
const VENDOR_LABEL: Record<string, string> = {
  vendor_staff_maker_checker: "Tim vendor belum dua orang (platform owner dan keuangan vendor aktif dengan 2FA)",
  profile_missing: "Profil vendor belum diisi",
  residency_opinion_required: "Opini residensi data belum ada",
  residency_opinion_negative: "Opini residensi data negatif",
};
// The clinical_go_live obligations (0030 labels; PR-97, Q-07), approved by the clinic in Kepatuhan.
const CLINICAL_LABEL: Record<string, string> = {
  clinical_authority_matrix: "Matriks kewenangan klinis",
  appointment_responsible_person: "Penunjukan Penanggung Jawab klinik",
  appointment_pharmacist: "Penunjukan apoteker penanggung jawab",
  sop_downtime: "SOP gangguan sistem",
  sop_incident: "SOP insiden",
  sop_waste: "SOP limbah medis",
};
export function blockerLabel(b: string): string {
  const at = b.indexOf(":");
  const kind = at < 0 ? b : b.slice(0, at);
  const rest = at < 0 ? "" : b.slice(at + 1);
  if (kind === "checklist") {
    if (rest === "not_seeded") return "Ceklis onboarding belum dibuat";
    const [item, branch] = rest.split("@");
    const label = ITEM_LABEL[item as ChecklistItemKey] ?? item;
    return branch ? `${label} (cabang ${branch}) belum selesai` : `${label} belum selesai`;
  }
  if (kind === "vendor") return VENDOR_LABEL[rest] ?? (rest.startsWith("placeholder:") ? `Profil vendor masih placeholder: ${rest.slice(12)}` : rest.startsWith("storage_undeclared:") ? `Lokasi penyimpanan belum dinyatakan: ${rest.slice(19)}` : `Profil vendor: ${rest}`);
  if (kind === "clinical") return `${CLINICAL_LABEL[rest] ?? rest} belum disetujui (Kepatuhan klinik)`;
  // HYG-014 (PR-59, DEC-045): the processor agreement is checked again at go-live.
  if (kind === "agreement") return "Perjanjian pengolahan data belum berlaku (disetujui klinik di Kepatuhan)";
  return b;
}

