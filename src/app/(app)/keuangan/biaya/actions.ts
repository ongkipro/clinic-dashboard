"use server";
// Biaya Operasional & Kas Kecil actions (UX-22 ▸ Biaya; T-084): Catat Biaya (with the receipt file), Batalkan Biaya, Simpan Kategori.
// Each refuses a form rendered in another context first (HYG-009 B2-1), carries the form's idempotency key (rotated after every
// answer: n) and lets the database decide authority and money (DEC-097).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { MAX_BYTES } from "../../../../modules/compliance/compliance";
import { type ExpenseFunding, recordExpense, reverseExpense, saveExpenseCategory } from "../../../../modules/expenses/expenses";
import { STALE_CONTEXT, staleContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { GoLiveBlockedError } from "../../../../modules/vendor/profile/profile";

export type BiayaState = { error?: string; ok?: string; n?: number; values?: Record<string, string>; go?: string }; // go: a server redirect
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const FUNDINGS = ["petty_cash", "cash", "bank", "unpaid"];
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Peran ini tidak dapat melakukan aksi ini.",
  ERR_NOT_FOUND: "Data tidak ditemukan. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Data sudah diubah orang lain. Muat ulang lalu coba lagi.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
  ERR_TENANT_SUSPENDED: "Klinik sedang tidak dapat mencatat biaya.",
  ERR_IDEMPOTENCY_CONFLICT: "Isian ini sudah dikirim dengan isi lain. Muat ulang halaman.",
};
const REASON: Record<string, string> = {
  receipt_required: "Biaya kas kecil dan tunai wajib dilampiri bukti.",
  receipt: "Bukti harus foto (JPEG/PNG) atau PDF, maksimal 5 MB.",
  supplier_required: "Pilih pemasok untuk biaya yang belum dibayar.",
  business_date: "Tanggal biaya tidak boleh di masa depan.",
  category: "Pilih kategori biaya.",
  expense: "Periksa jumlah dan keterangan biaya (3–200 karakter).",
  reason: "Tulis alasan (3–300 karakter).",
  category_name_taken: "Nama kategori sudah dipakai.",
  duplicate_invoice_number: "Nomor faktur pemasok ini sudah tercatat.",
  expense_paid: "Utang biaya ini sudah dibayar sebagian atau lunas, jadi biaya tidak dapat dibatalkan.",
  expense_reversed: "Biaya ini sudah dibatalkan.",
  "category not found": "Kategori tidak ditemukan atau sudah nonaktif.",
  "supplier not found": "Pemasok tidak ditemukan atau sudah nonaktif.",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const money = (s: string) => Number(s.replace(/[.\s]/g, "").replace(/^Rp/i, ""));
const next = (p: BiayaState, s: BiayaState): BiayaState => ({ ...s, n: (p.n ?? 0) + 1 });
const keep = (f: FormData) => Object.fromEntries([...f.entries()].filter(([k, v]) => typeof v === "string" && !k.startsWith("ctx_") && !k.startsWith("$") && k !== "key")) as Record<string, string>;
const message = (e: unknown) => {
  if (e instanceof GoLiveBlockedError) return "Klinik belum boleh menerima data sungguhan (persyaratan go-live belum lengkap).";
  if (e instanceof CommandError) {
    const r = (e as { reason?: string }).reason ?? "";
    return REASON[r] ?? REASON[r.split(" ")[0]] ?? COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  }
  console.error("biaya: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.";
};
type Db = Parameters<Parameters<typeof withTenantContext>[2]>[0];
async function run<R>(p: BiayaState, f: FormData, fn: (db: Db, key: string) => Promise<R>, done: (r: R) => BiayaState): Promise<BiayaState> {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return next(p, { error: COPY.ERR_FORBIDDEN });
  if (staleContext(f, rc.active.context)) return next(p, { error: STALE_CONTEXT });
  const key = str(f, "key");
  if (!UUID.test(key)) return next(p, { error: COPY.ERR_INVALID_INPUT, values: keep(f) });
  let r: R;
  try {
    r = await withTenantContext(await appPool(), rc.active.context, (db) => fn(db, key));
  } catch (e) {
    return next(p, { error: message(e), values: keep(f) });
  }
  revalidatePath("/keuangan/biaya", "layout");
  const out = done(r);
  if (out.go) redirect(out.go);
  return next(p, out);
}

export async function recordAction(p: BiayaState, f: FormData): Promise<BiayaState> {
  const branch = str(f, "branch");
  const category = str(f, "category");
  const date = str(f, "date");
  const amount = money(str(f, "amount"));
  const funding = str(f, "funding");
  const supplier = str(f, "supplier");
  const invoiceNo = str(f, "invoice_number");
  const description = str(f, "description");
  const file = f.get("receipt");
  const bad = (error: string) => next(p, { error, values: keep(f) });
  if (branch && !UUID.test(branch)) return bad("Pilih cabang.");
  if (!UUID.test(category)) return bad(REASON.category);
  if (!DAY.test(date)) return bad("Isi tanggal biaya.");
  if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000_000_000) return bad("Isi jumlah biaya.");
  if (!FUNDINGS.includes(funding)) return bad("Pilih sumber dana.");
  if (description.length < 3 || description.length > 200) return bad("Tulis keterangan (3–200 karakter).");
  if (funding === "unpaid" && !UUID.test(supplier)) return bad(REASON.supplier_required);
  if (invoiceNo.length > 60) return bad("Nomor faktur maksimal 60 karakter.");
  const hasFile = file instanceof File && file.size > 0;
  if (hasFile && (file as File).size > MAX_BYTES) return bad("Berkas lebih dari 5 MB.");
  if (!hasFile && (funding === "petty_cash" || funding === "cash")) return bad(REASON.receipt_required);
  const receipt = hasFile ? { fileName: (file as File).name, content: Buffer.from(await (file as File).arrayBuffer()) } : null;
  return run(p, f, (db, key) => recordExpense(db, key, branch || null, {
    categoryId: category, businessDate: date, amount, funding: funding as ExpenseFunding, description,
    supplierId: funding === "unpaid" ? supplier : null, supplierInvoiceNumber: funding === "unpaid" && invoiceNo ? invoiceNo : null, receipt,
  }), (r) => ({ ok: "Biaya dicatat.", go: `/keuangan/biaya/${r.expenseId}?tanggal=${date}&baru=1` }));
}
export async function reverseAction(p: BiayaState, f: FormData): Promise<BiayaState> {
  const expense = str(f, "expense");
  const reason = str(f, "reason");
  if (!UUID.test(expense)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  if (reason.length < 3 || reason.length > 300) return next(p, { error: REASON.reason });
  return run(p, f, (db, key) => reverseExpense(db, key, expense, reason), () => ({ ok: "Biaya dibatalkan. Utangnya ikut dibatalkan bila ada." }));
}
export async function saveCategoryAction(p: BiayaState, f: FormData): Promise<BiayaState> {
  const id = str(f, "category");
  const name = str(f, "name");
  const active = str(f, "active");
  if (id && !UUID.test(id)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  if (name.length < 2 || name.length > 60) return next(p, { error: "Tulis nama kategori (2–60 karakter).", values: keep(f) });
  return run(p, f, (db, key) => saveExpenseCategory(db, key, id || null, { name, active: active === "" ? undefined : active === "1" }),
    () => ({ ok: id ? "Kategori disimpan." : "Kategori ditambahkan." }));
}
