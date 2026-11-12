// Proportional allocation (BILL-2, PR-19; T-072). Mirrors kasir_allocate in migration 0087: an amount over the lines'
// outstanding (after discount, VAT-inclusive; plan open point 1, PENDING the accountant), floor of the proportional
// share, then one rupiah each to the largest remainders (ties by line order). Σ = amount and 0 ≤ a_i ≤ o_i always.
// BigInt throughout (the BigInt() form: the TS target is below ES2020): amount × outstanding can exceed 2^53 at the schema bound (1e12 each).
export function allocate(amount: bigint, outstanding: readonly bigint[]): bigint[] {
  const total = outstanding.reduce((s, o) => s + o, BigInt(0));
  if (amount <= BigInt(0) || outstanding.length === 0) return outstanding.map(() => BigInt(0));
  if (amount > total) throw new RangeError("overpayment");
  const base = outstanding.map((o) => (amount * o) / total);
  const rem = outstanding.map((o, i) => amount * o - base[i] * total);
  let left = amount - base.reduce((s, b) => s + b, BigInt(0));
  const order = rem.map((r, i) => [r, i] as const).sort((x, y) => (x[0] === y[0] ? x[1] - y[1] : x[0] > y[0] ? -1 : 1));
  // One rupiah each to the largest remainders; no line passes its outstanding (amount ≤ total keeps every floor at or
  // below it, and a floor reaches it only when amount = total, where nothing is left over).
  for (const [, i] of order) {
    if (left <= BigInt(0)) break;
    base[i] += BigInt(1);
    left -= BigInt(1);
  }
  return base;
}

// The VAT a line has to have recognised once `paid` of its total is paid (the tax point is the payment, A-12): the
// paid share of the line VAT, rounded half up. Mirrors payment_receive.
export function vatDueOnPaid(vat: bigint, paid: bigint, lineTotal: bigint): bigint {
  if (vat === BigInt(0) || lineTotal === BigInt(0)) return BigInt(0);
  return (vat * paid * BigInt(2) + lineTotal) / (BigInt(2) * lineTotal);
}
