// Matriks Persetujuan model (19:210, UX-26 ▸ Matriks; HYG-NAV-1): who approves what, from the code registries — APPROVAL_TYPES (the
// approvals engine's types and approver roles, kept equal to the database by tests/approvals/inbox.test.ts) and the settings rows that set a
// threshold or a choice for them (SET-11, SET-12, SET-13, SET-43). Pure; tested in tests/ui/hyg-nav-1.test.ts.
import { ROLE_LABEL } from "../../../../components/shell/nav";
import type { Role } from "../../../../auth/policy";
import { APPROVAL_TYPES } from "../../../../modules/approvals/inbox";

// The setting that tunes an approval type (19 §5), when one exists.
export const TYPE_SETTING: Record<string, string> = {
  refund_exception: "SET-11", manual_discount: "SET-12", cash_shift_variance: "SET-13", invoice_void: "SET-43", stock_adjustment: "SET-43", disposal: "SET-43",
};
// Fixed rules (class F, never settings) shown beside the matrix.
export const FIXED_RULES = [
  "Pengaju tidak pernah menyetujui permintaannya sendiri (PR-37).",
  "Hapus piutang oleh Owner sendiri boleh tanpa penyetuju kedua, dengan alasan wajib dan tercatat di audit (B-14).",
  "Owner memutuskan perubahan pengaturan klinis hanya bila tidak ada Penanggung Jawab Klinik lain (DEC-031).",
] as const;

export type MatrixRow = { type: string; label: string; approvers: string; setting: string | null };
const roleList = (roles: readonly Role[]) => roles.map((r) => ROLE_LABEL[r] ?? r).join(", ");

export function matrix(): MatrixRow[] {
  return Object.entries(APPROVAL_TYPES)
    .map(([type, t]) => ({ type, label: t.label, approvers: roleList(t.approverRoles), setting: TYPE_SETTING[type] ?? null }))
    .sort((a, b) => a.label.localeCompare(b.label, "id"));
}
