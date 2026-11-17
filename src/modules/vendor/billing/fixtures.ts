// Guide-shaped AutoLaris responses (T-103). SOURCE: the sanitized public Postman collection snapshot of the autolaris-h2h skill (reviewed
// 2026-09-03; references/docs/reference/h2h-api.md and guides/payment-gateway.md): create_payment success / rc 01 / rc 07, list_payment, and
// the observed Advice "02 PENDING". Synthetic values; NOT recorded sandbox responses — the vendor account's real Advice statuses are pending
// Q-13. The "settled" / "expired" Advice bodies below are test fixtures flagged pending_q13: their status words are placeholders that match
// only a rule a test inserts as confirmed; the seeded rule is unconfirmed (no invoice is marked paid automatically).
import type { Exchange } from "./port";

export const SOURCE = "guide-shaped, not recorded; Advice settlement pending Q-13" as const;

export const listPaymentOk = (): Exchange => ({
  http: 200,
  body: {
    rc: "00", ket: "Sukses",
    data: [
      { channel_code: "COD", name: "COD", admin: "0.0", tipe_admin: "fix" },
      { channel_code: "QRIS", name: "QRIS", admin: "0.7", tipe_admin: "persen" },
      { channel_code: "VABNI", name: "Bank BNI", admin: "3000.0", tipe_admin: "fix" },
      { channel_code: "VAMANDIRI", name: "Bank Mandiri", admin: "3000.0", tipe_admin: "fix" },
    ],
  },
});

// create_payment success (VA): admin 3000, total = amount + admin.
export const createVaOk = (trxId: string, amount: number): Exchange => ({
  http: 200,
  body: { rc: "00", ket: "Sukses", data: { trx_id: trxId, virtual_account: "8779611150001393", qr: "", payment_code: "", url: "", amount, admin: 3000, total: amount + 3000 } },
});
// create_payment success (QRIS): admin 0.7 % (the guide's 10000 → 70 example), the EMVCo payload kept verbatim.
export const createQrisOk = (trxId: string, amount: number): Exchange => ({
  http: 200,
  body: { rc: "00", ket: "Sukses", data: { trx_id: trxId, virtual_account: "", qr: "00020101021226670016COM.SINTETIS.WWW0118936000000000000000215SINTETIS0303UMI51440014ID.CO.QRIS.WWW0215ID00000000000000303UMI5204581253033605802ID5914KLINIK SINTETIS6007JAKARTA61051234062070703A016304ABCD", payment_code: "", url: "", amount, admin: Math.floor(amount * 7 / 1000), total: amount + Math.floor(amount * 7 / 1000) } },
});
export const createRc01 = (): Exchange => ({ http: 200, body: { rc: "01", ket: "Invalid parameter", data: [] } });
export const createRc07 = (): Exchange => ({ http: 200, body: { rc: "07", ket: "Channel tidak aktif", data: [] } });
export const timeout = (): Exchange => ({ http: null, body: null });

// Advice: the observed pending answer (guide), and the pending-Q-13 fixtures.
export const advicePending = (): Exchange => ({ http: 200, body: { rc: "02", ket: "PENDING", data: { awb: "" } } });
export const SETTLED_STATUS = "FIXTURE_SETTLED_Q13";
export const EXPIRED_STATUS = "FIXTURE_EXPIRED_Q13";
export const adviceSettled = (amount: number): Exchange => ({ http: 200, body: { rc: "00", ket: "Sukses", data: { status: SETTLED_STATUS, amount: String(amount) } } });
export const adviceExpired = (): Exchange => ({ http: 200, body: { rc: "00", ket: "Sukses", data: { status: EXPIRED_STATUS } } });
// A non-success envelope carrying settled-looking fields (TD-42: never consumed).
export const adviceRc02WithSettledFields = (amount: number): Exchange => ({ http: 200, body: { rc: "02", ket: "PENDING", data: { status: SETTLED_STATUS, amount: String(amount) } } });
// Shipping vocabulary is never proof of payment (skill rule 8).
export const adviceDelivered = (): Exchange => ({ http: 200, body: { rc: "00", ket: "DELIVERED", data: { awb: "", status: "DELIVERED" } } });
