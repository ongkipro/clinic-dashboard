import type pg from "pg";

// Manual discount limits per role (PR-72, BILL-28, SET-12 / CD-37; T-080, migration 0096). The database decides at issue:
// within the acting role's SET-12 limit the discount applies to the line at once; over it, the line is issued at full price
// and a manual_discount approval of the requested amount waits in Persetujuan (the line is not payable meanwhile); the
// decision applies the amount (or not) and opens a deferred package. A manager decides only within the manager limit,
// otherwise the owner. There is no TS writer: issue through issueKasirInvoice (lines[].discount), decide through
// decideApproval, withdraw through cancelApproval. This module is the TS twin of discount_within_limit, for the Kasir hint;
// tests/cashier/discounts.test.ts keeps the two equal.
export type DiscountRole = "owner" | "manager" | "fo_cashier" | "finance";
export type DiscountLimits = { fo_persen: number; manajer_persen: number; manajer_rupiah: number };
export const DEFAULT_LIMITS: DiscountLimits = { fo_persen: 0, manajer_persen: 10, manajer_rupiah: 500_000 };

// Integer rupiah; the percent test by cross-multiplication (no float, no rounding). Both manager caps apply: the lower wins.
export function withinDiscountLimit(role: string, gross: number, discount: number, limits: DiscountLimits = DEFAULT_LIMITS): boolean {
  if (discount <= 0) return true;
  if (role === "owner") return true;
  if (role === "manager") return discount * 100 <= gross * limits.manajer_persen && discount <= limits.manajer_rupiah;
  if (role === "fo_cashier" || role === "finance") return discount * 100 <= gross * limits.fo_persen;
  return false;
}

// The suspicious-activity report source (PR-72, SEC-19): every manual discount with requester, approver and amount; owner and
// auditor only (discount_manual_list, SECURITY DEFINER: the auditor reads neither approvals nor staff under RLS). No patient.
export type ManualDiscountRow = {
  line_id: string; invoice_id: string; invoice_number: string | null; invoice_state: "issued" | "void"; issued_at: string;
  branch: { id: string; name: string }; gross: number; discount: number; requested: number | null;
  state: "within_limit" | "pending" | "approved" | "rejected" | "cancelled";
  requester: { id: string; name: string; role: string; at: string };
  approver: { id: string; name: string; role: string; at: string } | null;
};
export async function listManualDiscounts(db: pg.ClientBase, branchId?: string): Promise<ManualDiscountRow[]> {
  const r = await db.query<{ r: ManualDiscountRow[] }>(`select discount_manual_list($1::uuid) as r`, [branchId ?? null]);
  return r.rows[0].r;
}
