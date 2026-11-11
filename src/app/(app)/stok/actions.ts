"use server";
// Stok actions (UX-11, PR-17; T-060): Simpan Item, Terima Stok, Tahan / Tarik / Lepas batch, Buka Vial, Atur
// Min/Target, Hitung Stok (mulai, catat, ajukan, batalkan). Each refuses a form rendered in another context first
// (HYG-009 B2-1), carries the form's idempotency key (rotated after every answer: n), and lets the database decide
// authority and validity.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import {
  cancelCount, holdBatch, openVial, receiveStock, recordCount, saveItem, setLevel, startCount, submitCount, type BatchState, type ReceiveReason,
  type Storage,
} from "../../../modules/inventory/stock";
import { STALE_CONTEXT, staleContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { GoLiveBlockedError } from "../../../modules/vendor/profile/profile";

export type StockFormState = { error?: string; ok?: string; n?: number; id?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QTY = /^\d{1,10}(\.\d{1,4})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Peran ini tidak dapat mengubah stok.",
  ERR_NOT_FOUND: "Item, batch, atau hitungan tidak ditemukan di cabang ini. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Data stok sudah berubah. Muat ulang halaman.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
  ERR_TENANT_SUSPENDED: "Klinik sedang tidak dapat mengubah stok.",
  ERR_IDEMPOTENCY_CONFLICT: "Isian ini sudah dikirim dengan isi lain. Muat ulang halaman.",
  ERR_STOCK_UNFIT: "Stok kedaluwarsa, ditarik, atau melewati batas pakai.",
  ERR_STOCK_INSUFFICIENT: "Stok tidak cukup.",
};
const REASON: Record<string, string> = {
  "the unit is in use": "Satuan tidak dapat diubah: item sudah punya batch, batas stok, atau hitungan.",
  "vials of this item were opened": "Ukuran vial tidak dapat dihapus: vial item ini pernah dibuka.",
  "a batch without expiry cannot be received": "Batch tanpa tanggal kedaluwarsa tidak dapat diterima.",
  expired: "Batch sudah kedaluwarsa dan tidak dapat diterima.",
  recalled: "Batch ini sudah ditarik dan tidak dapat diterima lagi.",
  "a vial of this batch is already open": "Masih ada vial terbuka dari batch ini.",
  "not a vial item": "Item ini bukan vial.",
  "the batch is empty": "Batch ini kosong.",
  "a batch is already in an open count": "Sebagian batch masih dalam hitungan lain yang belum selesai.",
  "no stock to count": "Tidak ada stok untuk dihitung.",
  "every line must be counted": "Isi jumlah terhitung untuk setiap batch.",
  "stock moved since the count started": "Stok bergerak sejak hitungan dimulai. Batalkan dan mulai hitungan baru.",
  "the catalog item already has a stock item": "Item katalog ini sudah ada di Master Item.",
  "the item is inactive": "Item ini nonaktif.",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const dec = (s: string) => s.replace(",", ".");
const next = (p: StockFormState, s: StockFormState): StockFormState => ({ ...s, n: (p.n ?? 0) + 1 });
const message = (e: unknown) => {
  if (e instanceof GoLiveBlockedError) return "Klinik belum boleh menerima data pasien sungguhan (persyaratan go-live belum lengkap).";
  if (e instanceof CommandError) return REASON[(e as { reason?: string }).reason ?? ""] ?? COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  console.error("stok: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.";
};
type Db = Parameters<Parameters<typeof withTenantContext>[2]>[0];
async function run<R>(p: StockFormState, f: FormData, ok: string, fn: (db: Db, key: string) => Promise<R>, extra?: (r: R) => Partial<StockFormState>): Promise<StockFormState> {
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
  revalidatePath("/stok", "layout");
  return next(p, { ok, ...(extra ? extra(r) : {}) });
}
const branchOf = (f: FormData) => {
  const b = str(f, "branch");
  return UUID.test(b) ? b : null;
};

export async function saveItemAction(p: StockFormState, f: FormData): Promise<StockFormState> {
  const item = str(f, "item");
  const cat = str(f, "catalog_item");
  const unit = str(f, "unit");
  const vial = dec(str(f, "vial_size"));
  const hours = str(f, "opened_use_hours");
  const storage = str(f, "storage") as Storage;
  if (item && !UUID.test(item)) return next(p, { error: COPY.ERR_NOT_FOUND });
  if (!item && !UUID.test(cat)) return next(p, { error: "Pilih item katalog." });
  if (!/^[a-zA-Z][a-zA-Z0-9.]{0,11}$/.test(unit)) return next(p, { error: "Tulis satuan pakai (mis. ml, U, pcs)." });
  if ((vial === "") !== (hours === "") || (vial && !QTY.test(vial)) || (hours && !/^\d{1,4}$/.test(hours)))
    return next(p, { error: "Untuk vial isi ukuran vial dan batas pakai (jam) bersama; kosongkan keduanya untuk item lain." });
  if (!["ruang", "sejuk", "dingin"].includes(storage)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  return run(p, f, item ? "Item disimpan." : "Item ditambahkan ke Master Item.", (db, key) =>
    saveItem(db, key, item || null, {
      catalogItemId: item ? undefined : cat, unit, vialSize: vial || null, openedUseHours: hours ? Number(hours) : null, storage,
      registrationNo: str(f, "registration_no") || null, highValue: f.get("high_value") === "on", active: item ? f.get("active") === "on" : true,
    }), (r) => ({ id: r.itemId }));
}

export async function receiveAction(p: StockFormState, f: FormData): Promise<StockFormState> {
  const item = str(f, "item");
  const batchNo = str(f, "batch_no");
  const expiry = str(f, "expiry");
  const quantity = dec(str(f, "quantity"));
  const reason = str(f, "reason") as ReceiveReason;
  if (!UUID.test(item)) return next(p, { error: COPY.ERR_NOT_FOUND });
  if (!DATE.test(expiry)) return next(p, { error: REASON["a batch without expiry cannot be received"] });
  if (!/^[A-Za-z0-9][A-Za-z0-9./-]{0,39}$/.test(batchNo)) return next(p, { error: "Tulis nomor batch (huruf, angka, titik, garis miring atau tanda hubung)." });
  if (!QTY.test(quantity) || Number(quantity) <= 0) return next(p, { error: "Jumlah harus lebih dari 0." });
  if (reason !== "stok_awal" && reason !== "penerimaan") return next(p, { error: COPY.ERR_INVALID_INPUT });
  return run(p, f, "Stok diterima.", (db, key) => receiveStock(db, key, branchOf(f), { itemId: item, batchNo, expiry, quantity, reason }));
}

export async function holdAction(p: StockFormState, f: FormData): Promise<StockFormState> {
  const batch = str(f, "batch");
  const state = str(f, "state") as BatchState;
  const reason = str(f, "reason");
  if (!UUID.test(batch)) return next(p, { error: COPY.ERR_NOT_FOUND });
  if (!["quarantined", "temperature_excursion", "recalled", "active"].includes(state)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  // T-065 (PR-18): every hold and release carries the pharmacist's reason (kept in the batch's hold history).
  if (reason.length < 3) return next(p, { error: "Tulis alasan (minimal 3 huruf)." });
  const ok = state === "active" ? "Batch dilepas; dapat dipakai lagi." : state === "recalled" ? "Batch ditarik."
    : state === "temperature_excursion" ? "Batch ditahan: suhu menyimpang." : "Batch dikarantina.";
  return run(p, f, ok, (db, key) => holdBatch(db, key, batch, state, reason));
}

export async function openVialAction(p: StockFormState, f: FormData): Promise<StockFormState> {
  const batch = str(f, "batch");
  if (!UUID.test(batch)) return next(p, { error: COPY.ERR_NOT_FOUND });
  return run(p, f, "Vial dibuka; batas pakai mulai berjalan.", (db, key) => openVial(db, key, batch));
}

export async function levelAction(p: StockFormState, f: FormData): Promise<StockFormState> {
  const item = str(f, "item");
  const min = dec(str(f, "min"));
  const target = dec(str(f, "target"));
  if (!UUID.test(item)) return next(p, { error: COPY.ERR_NOT_FOUND });
  if (!QTY.test(min) || !QTY.test(target) || Number(target) < Number(min)) return next(p, { error: "Target harus sama atau lebih dari minimum." });
  return run(p, f, "Batas stok disimpan.", (db, key) => setLevel(db, key, branchOf(f), item, min, target));
}

export async function startCountAction(p: StockFormState, f: FormData): Promise<StockFormState> {
  const items = f.getAll("items").filter((x): x is string => typeof x === "string" && UUID.test(x));
  const r = await run(p, f, "Hitungan dimulai.", (db, key) => startCount(db, key, f.get("blind") === "on", items), (x) => ({ id: x.countId }));
  if (r.id) redirect(`/stok/opname/${r.id}`);
  return r;
}

export async function recordCountAction(p: StockFormState, f: FormData): Promise<StockFormState> {
  const count = str(f, "count");
  const line = str(f, "line");
  const counted = dec(str(f, "counted"));
  if (!UUID.test(count) || !UUID.test(line)) return next(p, { error: COPY.ERR_NOT_FOUND });
  if (!QTY.test(counted)) return next(p, { error: "Isi jumlah terhitung (0 atau lebih)." });
  return run(p, f, "Tercatat.", (db, key) => recordCount(db, key, count, line, counted));
}

export async function submitCountAction(p: StockFormState, f: FormData): Promise<StockFormState> {
  const count = str(f, "count");
  const reason = str(f, "reason");
  if (!UUID.test(count)) return next(p, { error: COPY.ERR_NOT_FOUND });
  if (reason.length < 3) return next(p, { error: "Tulis keterangan hitungan (minimal 3 huruf)." });
  return run(p, f, "", (db, key) => submitCount(db, key, count, reason), (r) => ({
    ok: r.state === "applied" ? "Selisih dalam batas; penyesuaian stok diterapkan." : "Selisih melewati batas; menunggu persetujuan di Persetujuan.",
  }));
}

export async function cancelCountAction(p: StockFormState, f: FormData): Promise<StockFormState> {
  const count = str(f, "count");
  if (!UUID.test(count)) return next(p, { error: COPY.ERR_NOT_FOUND });
  return run(p, f, "Hitungan dibatalkan.", (db, key) => cancelCount(db, key, count));
}
