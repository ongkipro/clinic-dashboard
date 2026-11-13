"use server";
// Kasir actions (UX-12; T-072): Buat Tagihan (visit), Jual Cepat (counter), Terima (split tender), Ajukan Void. Each
// refuses a form rendered in another context first (HYG-009 B2-1), carries the form's idempotency key (rotated after
// every answer: n), and lets the database decide authority, the methods in force and the allocation.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { issueKasirInvoice, openKasirInvoice, receivePayment, requestVoid, TENDER_METHODS, type KasirLine, type Tender, type TenderMethod } from "../../../modules/cashier/kasir/kasir";
import { STALE_CONTEXT, staleContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { cancelCharge, createCharge, pollCharge } from "../../../modules/payments/payments";
import { GoLiveBlockedError } from "../../../modules/vendor/profile/profile";

export type KasirFormState = { error?: string; ok?: string; n?: number; id?: string; receipt?: string; change?: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONEY = /^\d{1,13}$/;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Peran ini tidak dapat melakukan aksi kasir ini.",
  ERR_NOT_FOUND: "Tagihan tidak ditemukan di cabang ini. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Tagihan sudah berubah. Muat ulang halaman.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
  ERR_TENANT_SUSPENDED: "Kasir klinik sedang tidak dapat dipakai.",
  ERR_IDEMPOTENCY_CONFLICT: "Isian ini sudah dikirim dengan isi lain. Muat ulang halaman.",
  ERR_GATE_CLOSED: "PPN belum dapat dihitung: saran pajak belum disetujui. Owner dapat melengkapinya di Kepatuhan.",
  ERR_NOT_AVAILABLE: "Metode bayar ini belum tersedia.",
  ERR_BALANCE_INSUFFICIENT: "Saldo pasien tidak cukup untuk jumlah ini.",
};
const REASON: Record<string, string> = {
  overpayment: "Jumlah melebihi sisa tagihan.",
  void_pending: "Tagihan sedang diajukan void. Tunggu keputusan di Persetujuan.",
  invoice_paid: "Sudah ada pembayaran — gunakan refund.",
  visit_already_invoiced: "Kunjungan ini sudah punya tagihan.",
  visit_closed: "Kunjungan sudah ditutup.",
  counter_products_only: "Jual Cepat hanya untuk produk.",
  special_item: "Produk ini tidak dijual bebas (daftar khusus apotek).",
  product_without_stock_item: "Produk ini belum punya item stok. Apoteker dapat menambahkannya di Stok.",
  payment_port: "QRIS dan link bayar menunggu port pembayaran.",
  balance: "Pasien ini belum punya saldo.",
  insufficient: "Saldo pasien tidak cukup untuk jumlah ini.",
  method_disabled: "Metode ini dimatikan di Pengaturan › Uang & Kasir.",
  patient_merged: "Pasien ini sudah digabung. Pilih rekam utama.",
  reason: "Tulis alasan void (3–500 karakter).",
  discount: "Diskon melebihi harga.",
  "only the owner may decide this void": "Hanya owner yang dapat memutuskan void ini.",
  "charge pending": "Tagihan port sudah berubah. Muat ulang halaman.",
  mock_in_production: "Simulasi tidak tersedia di produksi.",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const money = (s: string) => s.replace(/[.\s]/g, "").replace(/^Rp/i, "");
const next = (p: KasirFormState, s: KasirFormState): KasirFormState => ({ ...s, n: (p.n ?? 0) + 1 });
const message = (e: unknown) => {
  if (e instanceof GoLiveBlockedError) return "Klinik belum boleh menerima data pasien sungguhan (persyaratan go-live belum lengkap).";
  if (e instanceof CommandError) {
    const r = (e as { reason?: string }).reason ?? "";
    return REASON[r] ?? REASON[r.replace(/^.*: /, "")] ?? COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  }
  console.error("kasir: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.";
};
type Db = Parameters<Parameters<typeof withTenantContext>[2]>[0];
async function run<R>(p: KasirFormState, f: FormData, fn: (db: Db, key: string) => Promise<R>, done: (r: R) => KasirFormState): Promise<KasirFormState> {
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
  revalidatePath("/kasir", "layout");
  return next(p, done(r));
}
const branchOf = (f: FormData) => (UUID.test(str(f, "branch")) ? str(f, "branch") : null);

// Lines arrive as item:<n> and qty:<n> (1–20 rows; a removed row is absent).
function lines(f: FormData): KasirLine[] | null {
  const out: KasirLine[] = [];
  for (let i = 0; i < 40; i++) {
    const item = str(f, `item:${i}`);
    if (!item) continue;
    const q = str(f, `qty:${i}`);
    if (!UUID.test(item) || !/^\d{1,5}$/.test(q) || Number(q) < 1) return null;
    out.push({ itemId: item, quantity: Number(q) });
  }
  return out.length ? out : null;
}

// ── Buat Tagihan (visit) and Jual Cepat (counter): open a draft and issue it in one step (two keys from one) ────────
export async function issueAction(p: KasirFormState, f: FormData): Promise<KasirFormState> {
  const ls = lines(f);
  if (!ls) return next(p, { error: "Pilih item dan jumlah (bilangan bulat ≥ 1)." });
  const visit = str(f, "visit");
  const patient = str(f, "patient");
  const counter = !visit;
  if (visit && (!UUID.test(visit) || !UUID.test(patient))) return next(p, { error: COPY.ERR_INVALID_INPUT });
  if (patient && !UUID.test(patient)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  return run(p, f, async (db, key) => {
    const { invoiceId } = await openKasirInvoice(db, key, { branchId: branchOf(f), patientId: patient || null, visitId: visit || null, counter });
    return issueKasirInvoice(db, `${key}:i`, invoiceId, ls);
  }, (r) => ({ ok: `Tagihan ${r.number} diterbitkan.`, id: r.invoice_id }));
}

// ── Terima: tenders arrive as m:<n>, a:<n>, t:<n> (cash tendered), d:<n>:<field> ─────────────────────────────────────
export async function receiveAction(p: KasirFormState, f: FormData): Promise<KasirFormState> {
  const invoice = str(f, "invoice");
  if (!UUID.test(invoice)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  const tenders: Tender[] = [];
  for (let i = 0; i < 6; i++) {
    const m = str(f, `m:${i}`) as TenderMethod;
    if (!m) continue;
    const a = money(str(f, `a:${i}`));
    if (!(TENDER_METHODS as readonly string[]).includes(m) || !MONEY.test(a) || Number(a) < 1) return next(p, { error: "Isi jumlah setiap metode dalam rupiah." });
    const t: Tender = { method: m, amount: Number(a) };
    if (m === "cash") {
      const c = money(str(f, `t:${i}`)) || a;
      if (!MONEY.test(c) || Number(c) < Number(a)) return next(p, { error: "Uang diterima kurang dari jumlah tunai." });
      t.cashTendered = Number(c);
    }
    if (m === "edc" || m === "transfer") {
      const d: NonNullable<Tender["details"]> = {};
      for (const k of ["card_type", "bank", "trace", "approval_code", "reference"] as const) {
        const v = str(f, `d:${i}:${k}`);
        if (v) d[k] = v.slice(0, 60);
      }
      if (Object.keys(d).length) t.details = d;
    }
    tenders.push(t);
  }
  if (!tenders.length) return next(p, { error: "Pilih metode bayar." });
  if (tenders.filter((t) => t.method === "cash").length > 1) return next(p, { error: "Tunai cukup satu baris." });
  return run(p, f, (db, key) => receivePayment(db, key, invoice, tenders), (r) => ({ ok: `Pembayaran diterima. Struk ${r.number}.`, receipt: r.receipt_id, change: r.change }));
}

// ── Ajukan Void ──────────────────────────────────────────────────────────────────────────────────────────────────────
export async function voidAction(p: KasirFormState, f: FormData): Promise<KasirFormState> {
  const invoice = str(f, "invoice");
  const reason = str(f, "reason");
  if (!UUID.test(invoice)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  if (reason.length < 3) return next(p, { error: REASON.reason });
  return run(p, f, (db, key) => requestVoid(db, key, invoice, reason), () => ({ ok: "Void diajukan. Menunggu persetujuan di Persetujuan." }));
}

// ── Bayar Lewat Port (T-073): create a charge, Cek Status, Batalkan ──────────────────────────────────────────────────
const SETTLED: Record<string, string> = {
  applied: "Pembayaran diterima lewat port.",
  flagged: "Pembayaran diterima tetapi perlu ditinjau (masuk saldo pasien setelah saldo aktif).",
  duplicate: "Belum ada perubahan dari port.",
  rejected_amount: "Jumlah dari port tidak sama dengan tagihan. Ditolak dan dicatat.",
};
export async function chargeAction(p: KasirFormState, f: FormData): Promise<KasirFormState> {
  const invoice = str(f, "invoice");
  const channel = str(f, "channel");
  if (!UUID.test(invoice) || !["qris", "va", "payment_link"].includes(channel)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  return run(p, f, (db, key) => createCharge(db, key, invoice, { channel: channel as "qris" | "va" | "payment_link" }),
    (r) => ({ ok: r.reused ? "Tagihan port yang masih menunggu ditampilkan." : "Tagihan port dibuat. Menunggu pembayaran." }));
}
export async function pollAction(p: KasirFormState, f: FormData): Promise<KasirFormState> {
  const charge = str(f, "charge");
  if (!UUID.test(charge)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  return run(p, f, (db) => pollCharge(db, charge), (r) => ({ ok: SETTLED[r.outcome] ?? SETTLED.duplicate }));
}
export async function cancelChargeAction(p: KasirFormState, f: FormData): Promise<KasirFormState> {
  const charge = str(f, "charge");
  if (!UUID.test(charge)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  return run(p, f, async (db) => { await cancelCharge(db, charge); return null; }, () => ({ ok: "Tagihan port dibatalkan." }));
}

