// VAT policy (BILL-6, A-12, SET-39; T-071). Pure functions, integer rupiah only; mirrored in SQL by tax_vat_split and
// tax_pkp_at (migration 0086) so the database snapshots exactly what this computes.
//
// - Taxable = taxable_service or taxable_goods; exempt_medical and non_object never carry VAT.
// - A PKP taxable VAT-inclusive amount P splits into base = round half up (P × 100 / 111) and VAT = P − base
//   (= 12 % × DPP 11/12 of the base); base + VAT = P always. Rounding to the rupiah (SET-39); the tax adviser's rule
//   for amounts that are not multiples of 111 is PENDING (Q-05; docs/spec/fixtures/money-scenarios.md).
// - The tax point is the earlier of payment and delivery (A-12); VAT is due only when the tenant is PKP then.
import type { TAX_CATEGORIES } from "../catalog/schema";

export type TaxCategory = (typeof TAX_CATEGORIES)[number];
export const isTaxable = (c: TaxCategory) => c === "taxable_service" || c === "taxable_goods";

export function vatSplit(amount: number, category: TaxCategory, pkp: boolean): { base: number; vat: number } {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError("amount must be a non-negative whole rupiah");
  if (!pkp || !isTaxable(category)) return { base: amount, vat: 0 };
  // amount ≤ 1e13 keeps amount × 100 + 55 well inside the safe-integer range; integer division by 111.
  if (amount > 10_000_000_000_000) throw new RangeError("amount out of range");
  const base = Math.floor((amount * 100 + 55) / 111);
  return { base, vat: amount - base };
}

/** The tax point: the earlier of payment and delivery; null while neither has happened. */
export function taxPoint(paidAt: Date | null, deliveredAt: Date | null): Date | null {
  if (!paidAt) return deliveredAt;
  if (!deliveredAt) return paidAt;
  return paidAt <= deliveredAt ? paidAt : deliveredAt;
}

/** The local date (YYYY-MM-DD) of an instant in a branch timezone (DATA-7). */
export const localDate = (at: Date, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(at);

/** PKP at an instant: the profile in force then says PKP and its effective date is on or before the local date. */
export function pkpAt(profile: { isPkp: boolean; effectiveFrom: string | null }, at: Date, timeZone: string): boolean {
  return profile.isPkp && profile.effectiveFrom !== null && profile.effectiveFrom <= localDate(at, timeZone);
}

/**
 * VAT still to recognise at a tax point (the tax-point guard, `11`): only the part of a line's VAT not already
 * recognised, and only when the tenant is PKP at the tax point.
 */
export function vatDueAtTaxPoint(line: { vatAmount: number; vatRecognised: number }, pkpAtTaxPoint: boolean): number {
  if (!pkpAtTaxPoint) return 0;
  return Math.max(0, line.vatAmount - line.vatRecognised);
}

/** The PR-24 turnover warning for a non-PKP tenant: fixed display thresholds, not settings. */
export const TURNOVER_NEAR = 4_000_000_000;
export const TURNOVER_LIMIT = 4_800_000_000;
export function turnoverWarning(isPkp: boolean, turnover12m: number): "none" | "near" | "over" {
  if (isPkp) return "none";
  if (turnover12m >= TURNOVER_LIMIT) return "over";
  if (turnover12m >= TURNOVER_NEAR) return "near";
  return "none";
}
