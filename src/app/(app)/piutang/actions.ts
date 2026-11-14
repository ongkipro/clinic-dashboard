"use server";
// Piutang & Refund actions (UX-14; T-078): Ajukan Refund (balance default, cash exception), Bayar Refund, Jadikan Piutang,
// Terima Pembayaran, Ajukan Hapus Buku and Hapus Buku. Each refuses a form rendered in another context first (HYG-009),
// carries the form's idempotency key (rotated after every answer: n), and lets the database decide authority and money.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import {
  collectReceivable, convertToReceivable, payRefund, requestRefund, requestWriteOff, writeOffAsOwner,
} from "../../../modules/cashier/receivables/receivables";
import { STALE_CONTEXT, staleContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { GoLiveBlockedError } from "../../../modules/vendor/profile/profile";

export type PiutangState = { error?: string; ok?: string; n?: number; go?: string }; // go: a server redirect, never returned
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Peran ini tidak dapat melakukan aksi ini.",
  ERR_NOT_FOUND: "Data tidak ditemukan. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Data sudah diubah orang lain. Muat ulang lalu coba lagi.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
  ERR_TENANT_SUSPENDED: "Kasir klinik sedang tidak dapat dipakai.",
  ERR_IDEMPOTENCY_CONFLICT: "Isian ini sudah dikirim dengan isi lain. Muat ulang halaman.",
  ERR_NOT_AVAILABLE: "Metode ini dimatikan di Pengaturan › Uang & Kasir.",
  ERR_APPROVER_IS_REQUESTER: "Persetujuan harus oleh orang lain.",
  ERR_BALANCE_INSUFFICIENT: "Saldo pasien tidak cukup.",
};
const REASON: Record<string, string> = {
  refund_above_paid: "Jumlah refund melebihi yang sudah dibayar.",
  line_unpaid: "Baris ini masih ada sisa tagihan.",
  package_line: "Batalkan paket di Paket & Saldo untuk mengembalikan nilai paket.",
  line_on_receivable: "Baris ini sudah menjadi piutang.",
  invoice_without_patient: "Penjualan tanpa nama pasien tidak dapat direfund ke saldo.",
  nothing_to_convert: "Tidak ada sisa tagihan yang sudah diberikan untuk dijadikan piutang.",
  unbilled_addition: "Tindakan tambahan yang sudah dikerjakan belum ditagih. Terbitkan tagihannya dulu.",
  void_pending: "Ada pengajuan pembatalan tagihan yang belum diputuskan.",
  write_off_pending_or_settled: "Hapus buku sudah diajukan atau piutang sudah selesai.",
  receivable_settled: "Piutang sudah selesai.",
  overpayment: "Jumlah melebihi sisa piutang.",
  method_disabled: "Metode ini dimatikan di Pengaturan › Uang & Kasir.",
  returned_quantity: "Jumlah barang kembali melebihi yang diserahkan.",
  reason: "Tulis alasan (3–500 karakter).",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const money = (s: string) => Number(s.replace(/[.\s]/g, "").replace(/^Rp/i, ""));
const okMoney = (n: number) => Number.isInteger(n) && n >= 1 && n <= 1_000_000_000_000;
const rp = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n).replace(/\s/g, "");
const next = (p: PiutangState, s: PiutangState): PiutangState => ({ ...s, n: (p.n ?? 0) + 1 });
const message = (e: unknown) => {
  if (e instanceof GoLiveBlockedError) return "Klinik belum boleh menerima data pasien sungguhan (persyaratan go-live belum lengkap).";
  if (e instanceof CommandError) {
    const r = (e as { reason?: string }).reason ?? "";
    if (/owner refunds to balance/.test(r)) return "Owner merefund ke saldo; refund tunai diajukan staf lain.";
    if (/only the owner/.test(r)) return "Hanya Owner yang dapat menghapus buku piutang.";
    if (/reason of at least 10/.test(r)) return "Tulis alasan minimal 10 karakter.";
    return REASON[r.split(" ")[0]] ?? COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  }
  console.error("piutang: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.";
};
type Db = Parameters<Parameters<typeof withTenantContext>[2]>[0];
async function run<R>(p: PiutangState, f: FormData, fn: (db: Db, key: string) => Promise<R>, done: (r: R) => PiutangState): Promise<PiutangState> {
  const key = str(f, "key");
  if (!UUID.test(key)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return next(p, { error: COPY.ERR_FORBIDDEN });
  if (staleContext(f, rc.active.context)) return next(p, { error: STALE_CONTEXT });
  let r: R;
  try {
    r = await withTenantContext(await appPool(), rc.active.context, (db) => fn(db, key));
  } catch (e) {
    return next(p, { error: message(e) });
  }
  revalidatePath("/piutang", "layout");
  const out = done(r);
  // A write that opens its result page redirects on the server: the form that sent it may unmount on revalidation
  // (the last refundable line, the converted visit), so a client-side push would be lost.
  if (out.go) redirect(out.go);
  return next(p, out);
}

export async function refundAction(p: PiutangState, f: FormData): Promise<PiutangState> {
  const line = str(f, "line");
  const amount = money(str(f, "amount"));
  const destination = str(f, "destination") === "cash" ? "cash" : "balance";
  const reason = str(f, "reason");
  const qty = str(f, "returned") === "on" ? Number(str(f, "qty") || "1") : undefined;
  if (!UUID.test(line)) return next(p, { error: "Pilih baris tagihan." });
  if (!okMoney(amount)) return next(p, { error: "Isi jumlah refund." });
  if (reason.length < 3 || reason.length > 500) return next(p, { error: REASON.reason });
  if (qty !== undefined && (!Number.isInteger(qty) || qty < 1 || qty > 10000)) return next(p, { error: "Isi jumlah barang kembali." });
  return run(p, f, (db, key) => requestRefund(db, key, line, { amount, destination, reason, returnedQuantity: qty }),
    (r) => r.state === "paid"
      ? { ok: `Refund ${rp(amount)} masuk ke saldo pasien.`, go: `/piutang/refund/${r.refund_id}` }
      : { ok: "Refund tunai diajukan. Menunggu persetujuan.", go: `/piutang/refund/${r.refund_id}` });
}
export async function payRefundAction(p: PiutangState, f: FormData): Promise<PiutangState> {
  const refund = str(f, "refund");
  const method = str(f, "method") === "transfer" ? "transfer" : "cash";
  const bank = str(f, "bank");
  const reference = str(f, "reference");
  if (!UUID.test(refund)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  if (method === "transfer" && (!bank || !reference)) return next(p, { error: "Isi bank dan nomor referensi transfer." });
  return run(p, f, (db, key) => payRefund(db, key, refund, method, method === "transfer" ? { bank, reference } : undefined), () => ({ ok: "Refund tunai dibayar." }));
}
export async function convertAction(p: PiutangState, f: FormData): Promise<PiutangState> {
  const visit = str(f, "visit");
  if (!UUID.test(visit)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  return run(p, f, (db, key) => convertToReceivable(db, key, visit),
    (r) => ({ ok: "Sisa tagihan dijadikan piutang. Kunjungan dapat ditutup.", go: `/piutang/${r.receivable_id}` }));
}
export async function collectAction(p: PiutangState, f: FormData): Promise<PiutangState> {
  const receivable = str(f, "receivable");
  const method = str(f, "method");
  const amount = money(str(f, "amount"));
  if (!UUID.test(receivable) || !["cash", "edc", "transfer", "balance"].includes(method)) return next(p, { error: "Pilih metode bayar." });
  if (!okMoney(amount)) return next(p, { error: "Isi jumlah pembayaran." });
  const tendered = method === "cash" ? money(str(f, "tendered") || String(amount)) : undefined;
  if (tendered !== undefined && (!okMoney(tendered) || tendered < amount)) return next(p, { error: "Uang diterima kurang dari jumlah." });
  return run(p, f, (db, key) => collectReceivable(db, key, receivable, { method: method as "cash" | "edc" | "transfer" | "balance", amount, cashTendered: tendered }),
    (r) => ({ ok: `Pembayaran piutang diterima. Struk ${r.number}.${r.change > 0 ? ` Kembalian ${rp(r.change)}.` : ""}` }));
}
export async function requestWriteOffAction(p: PiutangState, f: FormData): Promise<PiutangState> {
  const receivable = str(f, "receivable");
  const reason = str(f, "reason");
  if (!UUID.test(receivable)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  if (reason.length < 3 || reason.length > 500) return next(p, { error: REASON.reason });
  return run(p, f, (db, key) => requestWriteOff(db, key, receivable, reason), () => ({ ok: "Hapus buku diajukan. Menunggu keputusan Owner di Persetujuan." }));
}
export async function writeOffAction(p: PiutangState, f: FormData): Promise<PiutangState> {
  const receivable = str(f, "receivable");
  const reason = str(f, "reason");
  if (!UUID.test(receivable)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  if (reason.length < 10 || reason.length > 500) return next(p, { error: "Tulis alasan minimal 10 karakter." });
  return run(p, f, (db, key) => writeOffAsOwner(db, key, receivable, reason), () => ({ ok: "Piutang dihapus buku." }));
}
