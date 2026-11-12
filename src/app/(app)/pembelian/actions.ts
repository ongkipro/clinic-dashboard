"use server";
// Pembelian actions (UX-52; T-066 / T-067): Pemasok, PO (simpan, kirim, batal), Terima Barang, Retur, Transfer
// (kirim, terima, batal), Faktur, Bayar, Nota Kredit (catat, terapkan). Each refuses a form rendered in another
// context first (HYG-009 B2-1), carries the form's idempotency key (rotated after every answer: n), and lets the
// database decide authority and validity.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { cancelTransfer, receiveTransfer, sendToBranch } from "../../../modules/inventory/depots/depots";
import { STALE_CONTEXT, staleContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import {
  applyCredit, cancelPurchaseOrder, recordCreditNote, recordInvoice, recordPayment, receiveGoods, savePurchaseOrder, sendPurchaseOrder, type PaymentMethod,
  type ReceiptLine,
} from "../../../modules/purchasing/payables/payables";
import { returnToSupplier, saveSupplier, type ReturnReason } from "../../../modules/purchasing/suppliers/suppliers";
import { GoLiveBlockedError } from "../../../modules/vendor/profile/profile";
import { RETURN_REASON } from "./labels";

export type BuyFormState = { error?: string; ok?: string; n?: number; id?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QTY = /^\d{1,10}(\.\d{1,4})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY = /^\d{1,15}$/;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Peran ini tidak dapat melakukan aksi pembelian ini.",
  ERR_NOT_FOUND: "Data tidak ditemukan di cabang ini. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Data sudah berubah. Muat ulang halaman.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
  ERR_TENANT_SUSPENDED: "Klinik sedang tidak dapat melakukan pembelian.",
  ERR_IDEMPOTENCY_CONFLICT: "Isian ini sudah dikirim dengan isi lain. Muat ulang halaman.",
  ERR_STOCK_UNFIT: "Batch kedaluwarsa, ditahan, atau ditarik.",
  ERR_STOCK_INSUFFICIENT: "Stok tidak cukup.",
};
const REASON: Record<string, string> = {
  duplicate_name: "Nama pemasok sudah ada.",
  duplicate_invoice_number: "Nomor faktur sudah ada untuk pemasok ini.",
  duplicate_credit_note_number: "Nomor nota kredit sudah ada untuk pemasok ini.",
  receipt_already_invoiced: "Sebagian penerimaan sudah difakturkan.",
  expiry_missing: "Batch tanpa tanggal kedaluwarsa tidak dapat diterima.",
  "a batch without expiry cannot be received": "Batch tanpa tanggal kedaluwarsa tidak dapat diterima.",
  expired: "Batch sudah kedaluwarsa dan tidak dapat diterima.",
  more_than_ordered: "Jumlah diterima melebihi jumlah di PO.",
  item_not_ordered: "Item ini tidak ada di PO.",
  empty_purchase_order: "PO belum berisi item.",
  not_delivered: "Jumlah retur melebihi yang dikirim pemasok ini.",
  nothing_outstanding: "Faktur ini sudah lunas.",
  nothing_to_apply: "Tidak ada yang dapat diterapkan.",
  "the supplier is inactive": "Pemasok nonaktif.",
  "the depot is inactive": "Depot nonaktif.",
  "same branch": "Pilih cabang tujuan yang lain.",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const dec = (s: string) => s.replace(",", ".");
const money = (s: string) => s.replace(/[.\s]/g, "");
const next = (p: BuyFormState, s: BuyFormState): BuyFormState => ({ ...s, n: (p.n ?? 0) + 1 });
const message = (e: unknown) => {
  if (e instanceof GoLiveBlockedError) return "Klinik belum boleh menerima data pasien sungguhan (persyaratan go-live belum lengkap).";
  if (e instanceof CommandError) {
    const r = (e as { reason?: string }).reason ?? "";
    return REASON[r] ?? REASON[r.replace(/^.*: /, "")] ?? COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  }
  console.error("pembelian: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.";
};
type Db = Parameters<Parameters<typeof withTenantContext>[2]>[0];
async function run<R>(p: BuyFormState, f: FormData, ok: string, fn: (db: Db, key: string) => Promise<R>, id?: (r: R) => string): Promise<BuyFormState> {
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
  revalidatePath("/pembelian", "layout");
  return next(p, { ok, ...(id ? { id: id(r) } : {}) });
}
const branchOf = (f: FormData) => (UUID.test(str(f, "branch")) ? str(f, "branch") : null);

// ── Pemasok ────────────────────────────────────────────────────────────────────────────────────────────
export async function supplierAction(p: BuyFormState, f: FormData): Promise<BuyFormState> {
  const id = str(f, "supplier");
  const name = str(f, "name");
  const terms = str(f, "terms");
  if (name.length < 2) return next(p, { error: "Tulis nama pemasok." });
  if (terms && !/^\d{1,3}$/.test(terms)) return next(p, { error: "Syarat bayar dalam hari (0–180)." });
  return run(p, f, id ? "Pemasok disimpan." : "Pemasok ditambahkan.", (db, key) => saveSupplier(db, key, UUID.test(id) ? id : null, {
    name, npwp: str(f, "npwp") || null, contactName: str(f, "contact") || null, phone: str(f, "phone") || null, email: str(f, "email") || null,
    address: str(f, "address") || null, paymentTermsDays: terms ? Number(terms) : 30, active: UUID.test(id) ? f.get("active") === "on" : true, // an unchecked box is absent from the form (review 2665ab81 P1-2)
  }), (r) => r.supplierId);
}

// ── PO ─────────────────────────────────────────────────────────────────────────────────────────────────
// Lines arrive as item:<n>, qty:<n>, price:<n>.
function poLines(f: FormData) {
  const out: { itemId: string; quantity: string; unitPrice: number }[] = [];
  for (let i = 0; i < 20; i++) {
    const item = str(f, `item:${i}`);
    if (!item) continue;
    const q = dec(str(f, `qty:${i}`));
    const pr = money(str(f, `price:${i}`));
    if (!UUID.test(item) || !QTY.test(q) || Number(q) <= 0 || !MONEY.test(pr)) return null;
    out.push({ itemId: item, quantity: q, unitPrice: Number(pr) });
  }
  return out;
}
export async function poSaveAction(p: BuyFormState, f: FormData): Promise<BuyFormState> {
  const po = str(f, "po");
  const supplier = str(f, "supplier");
  const lines = poLines(f);
  if (!UUID.test(supplier)) return next(p, { error: "Pilih pemasok." });
  if (!lines || lines.length === 0) return next(p, { error: "Isi item, jumlah, dan harga satuan." });
  const expected = str(f, "expected");
  if (expected && !DATE.test(expected)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  return run(p, f, po ? "PO disimpan." : "PO dibuat sebagai draf.", (db, key) => savePurchaseOrder(db, key, UUID.test(po) ? po : null, {
    supplierId: supplier, branchId: branchOf(f), expectedDate: expected || null, note: str(f, "note") || null, lines,
  }), (r) => r.poId);
}
export async function poTransitionAction(p: BuyFormState, f: FormData): Promise<BuyFormState> {
  const po = str(f, "po");
  const action = str(f, "action");
  if (!UUID.test(po)) return next(p, { error: COPY.ERR_NOT_FOUND });
  if (action === "send") return run(p, f, "PO dikirim ke pemasok.", (db, key) => sendPurchaseOrder(db, key, po));
  if (action !== "cancel") return next(p, { error: COPY.ERR_INVALID_INPUT });
  const reason = str(f, "reason");
  if (reason.length < 3) return next(p, { error: "Tulis alasan pembatalan (minimal 3 huruf)." });
  return run(p, f, "PO dibatalkan.", (db, key) => cancelPurchaseOrder(db, key, po, reason));
}

// ── Terima Barang ──────────────────────────────────────────────────────────────────────────────────────
// Lines arrive as item:<n>, batch:<n>, expiry:<n>, qty:<n>, cost:<n> (cost optional against a PO).
export async function receiveAction(p: BuyFormState, f: FormData): Promise<BuyFormState> {
  const supplier = str(f, "supplier");
  const po = str(f, "po");
  if (!UUID.test(supplier)) return next(p, { error: "Pilih pemasok." });
  const lines: ReceiptLine[] = [];
  for (let i = 0; i < 20; i++) {
    const item = str(f, `item:${i}`);
    const q = dec(str(f, `qty:${i}`));
    if (!item || !q) continue;
    const expiry = str(f, `expiry:${i}`);
    if (!expiry) return next(p, { error: REASON.expiry_missing });
    const cost = money(str(f, `cost:${i}`));
    if (!UUID.test(item) || !QTY.test(q) || Number(q) <= 0 || !DATE.test(expiry) || !str(f, `batch:${i}`) || (cost && !MONEY.test(cost))) return next(p, { error: COPY.ERR_INVALID_INPUT });
    if (!cost && !UUID.test(po)) return next(p, { error: "Isi harga satuan (penerimaan tanpa PO)." });
    lines.push({ itemId: item, batchNo: str(f, `batch:${i}`), expiry, quantity: q, unitCost: cost ? Number(cost) : null });
  }
  if (lines.length === 0) return next(p, { error: "Isi setidaknya satu baris yang diterima." });
  return run(p, f, "Barang diterima ke gudang.", (db, key) => receiveGoods(db, key, branchOf(f), {
    supplierId: supplier, poId: UUID.test(po) ? po : null, deliveryNote: str(f, "note") || null, lines,
  }), (r) => r.receiptId);
}

// ── Retur ──────────────────────────────────────────────────────────────────────────────────────────────
export async function returnAction(p: BuyFormState, f: FormData): Promise<BuyFormState> {
  const supplier = str(f, "supplier");
  const batch = str(f, "batch");
  const q = dec(str(f, "qty"));
  const reason = str(f, "reason") as ReturnReason;
  const note = str(f, "note");
  if (!UUID.test(supplier) || !UUID.test(batch)) return next(p, { error: "Pilih pemasok dan batch." });
  if (!QTY.test(q) || Number(q) <= 0) return next(p, { error: "Tulis jumlah retur." });
  if (!(reason in RETURN_REASON)) return next(p, { error: "Pilih alasan retur." });
  if (note.length < 3) return next(p, { error: "Tulis catatan retur (minimal 3 huruf)." });
  return run(p, f, "Retur dicatat; nota kredit ditunggu dari pemasok.", (db, key) => returnToSupplier(db, key, branchOf(f), {
    supplierId: supplier, batchId: batch, quantity: q, reason, note, depotId: UUID.test(str(f, "depot")) ? str(f, "depot") : null,
  }), (r) => r.returnId);
}

// ── Transfer antar cabang (T-061's writers) ────────────────────────────────────────────────────────────
export async function transferSendAction(p: BuyFormState, f: FormData): Promise<BuyFormState> {
  const from = str(f, "from");
  const to = str(f, "to");
  const batch = str(f, "batch");
  const q = dec(str(f, "qty"));
  if (!UUID.test(from) || !UUID.test(to) || !UUID.test(batch)) return next(p, { error: "Pilih depot asal, cabang tujuan, dan batch." });
  if (!QTY.test(q) || Number(q) <= 0) return next(p, { error: "Tulis jumlah." });
  return run(p, f, "Transfer dikirim.", (db, key) => sendToBranch(db, key, { fromDepotId: from, toBranchId: to, lines: [{ batchId: batch, quantity: q }] }), (r) => r.transferId);
}
export async function transferActAction(p: BuyFormState, f: FormData): Promise<BuyFormState> {
  const t = str(f, "transfer");
  const action = str(f, "action");
  if (!UUID.test(t)) return next(p, { error: COPY.ERR_NOT_FOUND });
  if (action === "receive") return run(p, f, "Transfer diterima.", (db, key) => receiveTransfer(db, key, t, UUID.test(str(f, "depot")) ? str(f, "depot") : null));
  if (action === "cancel") return run(p, f, "Transfer dibatalkan; stok kembali ke depot asal.", (db, key) => cancelTransfer(db, key, t));
  return next(p, { error: COPY.ERR_INVALID_INPUT });
}

// ── Utang ──────────────────────────────────────────────────────────────────────────────────────────────
export async function invoiceAction(p: BuyFormState, f: FormData): Promise<BuyFormState> {
  const supplier = str(f, "supplier");
  const number = str(f, "number");
  const date = str(f, "date");
  const due = str(f, "due");
  const receipts = f.getAll("receipt").map(String).filter((x) => UUID.test(x));
  if (!UUID.test(supplier)) return next(p, { error: "Pilih pemasok." });
  if (!number) return next(p, { error: "Tulis nomor faktur." });
  if (!DATE.test(date) || (due && !DATE.test(due))) return next(p, { error: "Tulis tanggal faktur." });
  if (receipts.length === 0) return next(p, { error: "Pilih penerimaan yang difakturkan." });
  return run(p, f, "Faktur dicatat.", (db, key) => recordInvoice(db, key, branchOf(f), {
    supplierId: supplier, number, invoiceDate: date, dueDate: due || null, lines: receipts.map((receiptId) => ({ receiptId })),
  }), (r) => r.invoiceId);
}
export async function payAction(p: BuyFormState, f: FormData): Promise<BuyFormState> {
  const supplier = str(f, "supplier");
  const amount = money(str(f, "amount"));
  const method = str(f, "method") as PaymentMethod;
  const paidOn = str(f, "date");
  const invoice = str(f, "invoice");
  if (!UUID.test(supplier)) return next(p, { error: "Pilih pemasok." });
  if (!MONEY.test(amount) || Number(amount) <= 0) return next(p, { error: "Tulis jumlah pembayaran." });
  if (method !== "cash" && method !== "bank_transfer") return next(p, { error: "Pilih cara bayar." });
  if (!DATE.test(paidOn)) return next(p, { error: "Tulis tanggal bayar." });
  return run(p, f, "Pembayaran dicatat.", (db, key) => recordPayment(db, key, branchOf(f), {
    supplierId: supplier, amount: Number(amount), method, paidOn, reference: str(f, "reference") || null,
    allocations: UUID.test(invoice) ? [{ invoiceId: invoice }] : undefined,
  }), (r) => r.paymentId);
}
export async function creditNoteAction(p: BuyFormState, f: FormData): Promise<BuyFormState> {
  const supplier = str(f, "supplier");
  const ret = str(f, "return");
  const number = str(f, "number");
  const amount = money(str(f, "amount"));
  const date = str(f, "date");
  if (!UUID.test(supplier) || !UUID.test(ret)) return next(p, { error: "Pilih retur yang dibalas nota kredit." });
  if (!number || !MONEY.test(amount) || Number(amount) <= 0 || !DATE.test(date)) return next(p, { error: "Isi nomor, jumlah, dan tanggal nota kredit." });
  return run(p, f, "Nota kredit dicatat.", (db, key) => recordCreditNote(db, key, branchOf(f), { supplierId: supplier, number, amount: Number(amount), issuedOn: date, returnId: ret }),
    (r) => r.creditNoteId);
}
export async function applyCreditAction(p: BuyFormState, f: FormData): Promise<BuyFormState> {
  const note = str(f, "credit");
  const invoice = str(f, "invoice");
  if (!UUID.test(note) || !UUID.test(invoice)) return next(p, { error: "Pilih faktur." });
  return run(p, f, "Nota kredit diterapkan.", (db, key) => applyCredit(db, key, note, invoice));
}
