// T-071 tax-policy unit checks (Done-when: "tax-policy unit checks for the PKP boundary and VAT tax point pass"):
// the integer VAT split of a VAT-inclusive amount (BILL-6) against the T-070 fixture's figures and non-multiples of 111;
// the tax point (A-12); the PKP state at an instant per branch timezone; the tax-point guard; the PR-24 warning.
// The full money scenarios 16 and 19 belong to the packages task; both readings of scenario 16 are pinned here.
import { describe, expect, it } from "vitest";
import { isTaxable, localDate, pkpAt, taxPoint, turnoverWarning, vatDueAtTaxPoint, vatSplit } from "../../src/modules/tax/policy";

describe("VAT split (BILL-6; T-070 fixture)", () => {
  it("PKP taxable: base + VAT = price; the fixture's multiples of 111 are exact", () => {
    expect(vatSplit(333_000, "taxable_goods", true)).toEqual({ base: 300_000, vat: 33_000 });
    expect(vatSplit(222_000, "taxable_goods", true)).toEqual({ base: 200_000, vat: 22_000 });
    expect(vatSplit(3_330_000, "taxable_service", true)).toEqual({ base: 3_000_000, vat: 330_000 });
    expect(vatSplit(666_000, "taxable_service", true)).toEqual({ base: 600_000, vat: 66_000 });
    expect(vatSplit(222_000, "taxable_service", true)).toEqual({ base: 200_000, vat: 22_000 }); // scenario 6 PKP DP
  });
  it("non-multiples of 111 round half up to the rupiah and still add up (rounding rule PENDING Q-05)", () => {
    for (const p of [1, 2, 55, 56, 100, 110, 111, 112, 150_000, 999_999, 1_234_567, 10_000_000_001]) {
      const { base, vat } = vatSplit(p, "taxable_goods", true);
      expect(base + vat, String(p)).toBe(p);
      expect(Number.isInteger(base) && Number.isInteger(vat), String(p)).toBe(true);
      expect(Math.abs(base * 111 - p * 100), String(p)).toBeLessThanOrEqual(55); // the nearest rupiah, half up
    }
    expect(vatSplit(150_000, "taxable_goods", true)).toEqual({ base: 135_135, vat: 14_865 });
    expect(vatSplit(111, "taxable_goods", true)).toEqual({ base: 100, vat: 11 });
    expect(vatSplit(1, "taxable_goods", true)).toEqual({ base: 1, vat: 0 }); // 0.9009… rounds to 1
    expect(vatSplit(0, "taxable_goods", true)).toEqual({ base: 0, vat: 0 });
  });
  it("exempt and non-object never carry VAT; a non-PKP tenant never charges VAT", () => {
    for (const c of ["exempt_medical", "non_object"] as const) expect(vatSplit(333_000, c, true)).toEqual({ base: 333_000, vat: 0 });
    for (const c of ["taxable_goods", "taxable_service"] as const) expect(vatSplit(333_000, c, false)).toEqual({ base: 333_000, vat: 0 });
    expect([isTaxable("taxable_goods"), isTaxable("taxable_service"), isTaxable("exempt_medical"), isTaxable("non_object")]).toEqual([true, true, false, false]);
  });
  it("only whole non-negative rupiah", () => {
    for (const p of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 10_000_000_000_001]) expect(() => vatSplit(p, "taxable_goods", true), String(p)).toThrow(RangeError);
  });
});

describe("tax point and PKP boundary (A-12, PR-24)", () => {
  const d = (s: string) => new Date(s);
  it("the tax point is the earlier of payment and delivery", () => {
    expect(taxPoint(d("2026-07-02T03:00:00Z"), d("2026-07-05T03:00:00Z"))).toEqual(d("2026-07-02T03:00:00Z"));
    expect(taxPoint(d("2026-07-05T03:00:00Z"), d("2026-07-02T03:00:00Z"))).toEqual(d("2026-07-02T03:00:00Z"));
    expect(taxPoint(null, d("2026-07-02T03:00:00Z"))).toEqual(d("2026-07-02T03:00:00Z"));
    expect(taxPoint(d("2026-07-02T03:00:00Z"), null)).toEqual(d("2026-07-02T03:00:00Z"));
    expect(taxPoint(null, null)).toBeNull();
  });
  it("PKP from a date is judged on the branch-local date: 16:30 UTC on 30 June is 1 July in WITA, not in WIB", () => {
    const profile = { isPkp: true, effectiveFrom: "2026-07-01" };
    const at = d("2026-06-30T16:30:00Z");
    expect(localDate(at, "Asia/Jakarta")).toBe("2026-06-30");
    expect(localDate(at, "Asia/Makassar")).toBe("2026-07-01");
    expect(pkpAt(profile, at, "Asia/Jakarta")).toBe(false);
    expect(pkpAt(profile, at, "Asia/Makassar")).toBe(true);
    expect(pkpAt(profile, d("2026-06-30T17:00:00Z"), "Asia/Jakarta")).toBe(true); // 00:00 WIB on 1 July
    expect(pkpAt({ isPkp: false, effectiveFrom: null }, d("2027-01-01T00:00:00Z"), "Asia/Jakarta")).toBe(false);
  });
  it("the tax-point guard: VAT not yet recognised, only when PKP at the tax point", () => {
    expect(vatDueAtTaxPoint({ vatAmount: 33_000, vatRecognised: 0 }, true)).toBe(33_000);
    expect(vatDueAtTaxPoint({ vatAmount: 33_000, vatRecognised: 33_000 }, true)).toBe(0); // paid first: no second VAT at delivery
    expect(vatDueAtTaxPoint({ vatAmount: 33_000, vatRecognised: 10_000 }, true)).toBe(23_000);
    expect(vatDueAtTaxPoint({ vatAmount: 33_000, vatRecognised: 0 }, false)).toBe(0);
  });
  it("scenario 16 (PENDING Q-05), both readings: a package paid before the PKP date, a session counted after", () => {
    const profile = { isPkp: true, effectiveFrom: "2026-07-01" };
    const paid = d("2026-06-15T03:00:00Z");
    const counted = d("2026-07-10T03:00:00Z");
    const session = 666_000;
    // Reading A (the tax-point guard as written): payment before PKP recognised nothing; at delivery, PKP, VAT due.
    const vatAtPayment = pkpAt(profile, paid, "Asia/Jakarta") ? vatSplit(session, "taxable_service", true).vat : 0;
    const lineVat = vatSplit(session, "taxable_service", pkpAt(profile, counted, "Asia/Jakarta")).vat;
    expect(vatAtPayment).toBe(0);
    expect(vatDueAtTaxPoint({ vatAmount: lineVat, vatRecognised: vatAtPayment }, pkpAt(profile, counted, "Asia/Jakarta"))).toBe(66_000);
    // Reading B (consideration received before PKP is outside VAT): the earlier tax point (payment) was non-PKP.
    expect(pkpAt(profile, taxPoint(paid, counted)!, "Asia/Jakarta")).toBe(false);
  });
});

describe("PR-24 turnover warning (fixed display thresholds)", () => {
  it("non-PKP tenants only: none below Rp4.0 billion, near from 4.0, over from 4.8", () => {
    expect(turnoverWarning(false, 3_999_999_999)).toBe("none");
    expect(turnoverWarning(false, 4_000_000_000)).toBe("near");
    expect(turnoverWarning(false, 4_799_999_999)).toBe("near");
    expect(turnoverWarning(false, 4_800_000_000)).toBe("over");
    expect(turnoverWarning(true, 9_000_000_000)).toBe("none");
  });
});
