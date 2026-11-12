// T-072 allocation (BILL-2, PR-19; plan §2): the pure mirror of kasir_allocate. Proportional to the outstanding after
// discount, floor then the largest remainder (ties by line order), Σ = amount, 0 ≤ a_i ≤ o_i; and the VAT due on what
// is paid (half up). Property check over random invoices up to the schema bound.
import { describe, expect, it } from "vitest";
import { allocate, vatDueOnPaid } from "../../src/modules/cashier/allocation";

const B = (xs: number[]) => xs.map((x) => BigInt(x));
const N = (xs: bigint[]) => xs.map((x) => Number(x));

describe("allocate", () => {
  it("scenario PR-19: 600,000 and 400,000; 500,000 → 300,000 and 200,000", () => {
    expect(N(allocate(BigInt(500_000), B([600_000, 400_000])))).toEqual([300_000, 200_000]);
  });
  it("the residual rupiah to the largest remainders, ties by line order", () => {
    expect(N(allocate(BigInt(1), B([333_000, 222_000, 150_000])))).toEqual([1, 0, 0]);
    expect(N(allocate(BigInt(2), B([1, 1, 1])))).toEqual([1, 1, 0]);
    expect(N(allocate(BigInt(10), B([3, 3, 4])))).toEqual([3, 3, 4]);
    expect(N(allocate(BigInt(5), B([3, 3, 4])))).toEqual([2, 1, 2]); // shares 1.5, 1.5, 2: floors 1, 1, 2; the one left goes to line 1 (tie on .5)
  });
  it("overpayment refused; nothing for zero; full payment equals the outstanding", () => {
    expect(() => allocate(BigInt(11), B([3, 3, 4]))).toThrow(RangeError);
    expect(N(allocate(BigInt(0), B([3, 4])))).toEqual([0, 0]);
    expect(N(allocate(BigInt(705_000), B([333_000, 222_000, 150_000])))).toEqual([333_000, 222_000, 150_000]);
  });
  it("property: Σ = amount, 0 ≤ a_i ≤ o_i, at amounts beyond 2^53 products", () => {
    let seed = 7;
    const rnd = (m: number) => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) % m;
    for (let t = 0; t < 2000; t++) {
      const n = 1 + rnd(8);
      const o = Array.from({ length: n }, () => BigInt(1 + rnd(1_000_000_000)) * BigInt(1 + rnd(1000)));
      const total = o.reduce((s, x) => s + x, BigInt(0));
      const p = (total * BigInt(rnd(1001))) / BigInt(1000);
      const a = allocate(p, o);
      expect(a.reduce((s, x) => s + x, BigInt(0))).toBe(p);
      a.forEach((x, i) => { expect(x >= BigInt(0)).toBe(true); expect(x <= o[i]).toBe(true); });
    }
  });
});

describe("vatDueOnPaid", () => {
  it("money scenario 1 PKP: half paid → half the VAT; full → all", () => {
    expect(Number(vatDueOnPaid(BigInt(33_000), BigInt(166_500), BigInt(333_000)))).toBe(16_500);
    expect(Number(vatDueOnPaid(BigInt(33_000), BigInt(333_000), BigInt(333_000)))).toBe(33_000);
    expect(Number(vatDueOnPaid(BigInt(0), BigInt(100), BigInt(100)))).toBe(0);
  });
  it("rounds half up and never exceeds the line VAT", () => {
    expect(Number(vatDueOnPaid(BigInt(11), BigInt(1), BigInt(2)))).toBe(6); // 5.5 → 6
    expect(Number(vatDueOnPaid(BigInt(11), BigInt(1), BigInt(3)))).toBe(4); // 3.67 → 4
    for (let p = 0; p <= 111; p++) expect(Number(vatDueOnPaid(BigInt(11), BigInt(p), BigInt(111)))).toBeLessThanOrEqual(11);
  });
});
