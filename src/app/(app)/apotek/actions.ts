"use server";
// Siapkan & Serahkan actions (UX-10, PR-18; T-065): Petakan Resep, Siapkan Bahan (+ Keluarkan), Siapkan Produk,
// Serahkan (seven checks), Cetak Etiket, Batalkan. Each refuses a form rendered in another context first (HYG-009
// B2-1), carries the form's idempotency key (rotated after every answer: n) and lets the database decide authority.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { issueMaterials } from "../../../modules/inventory/materials/materials";
import { STALE_CONTEXT, staleContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import {
  cancelDispensing, CHECKS, type Check, handOver, mapRecipe, prepareDispensing, prepareMaterials, printLabel,
} from "../../../modules/pharmacy/pharmacy";
import { GoLiveBlockedError } from "../../../modules/vendor/profile/profile";
import { BLOCKER_LABEL } from "./labels";

export type PharmacyFormState = { error?: string; ok?: string; n?: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QTY = /^\d{1,10}(\.\d{1,4})?$/;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Peran ini tidak dapat melakukan aksi apotek ini.",
  ERR_NOT_FOUND: "Data tidak ditemukan di cabang ini. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Data sudah berubah. Muat ulang halaman.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
  ERR_TENANT_SUSPENDED: "Klinik sedang tidak melayani kunjungan.",
  ERR_IDEMPOTENCY_CONFLICT: "Aksi ini sudah dikirim dengan isi lain. Muat ulang halaman.",
  ERR_STOCK_INSUFFICIENT: "Stok layak pakai di depot ini tidak cukup.",
  ERR_STOCK_UNFIT: "Batch kedaluwarsa, ditahan (karantina/suhu menyimpang), atau ditarik.",
};
const REASON: Record<string, string> = {
  ...BLOCKER_LABEL,
  checks_incomplete: "Centang ketujuh cek, atau tulis catatan pengecualian untuk cek yang tidak dicentang.",
  label_not_printed: "Cetak etiket biru (obat luar) sebelum menyerahkan.",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const next = (p: PharmacyFormState, s: PharmacyFormState): PharmacyFormState => ({ ...s, n: (p.n ?? 0) + 1 });
const message = (e: unknown) => {
  if (e instanceof GoLiveBlockedError) return "Klinik belum boleh menerima data pasien sungguhan (persyaratan go-live belum lengkap).";
  if (e instanceof CommandError) return REASON[(e as { reason?: string }).reason ?? ""] ?? COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  console.error("apotek: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.";
};
type Db = Parameters<Parameters<typeof withTenantContext>[2]>[0];
async function run(p: PharmacyFormState, f: FormData, ok: string, fn: (db: Db, key: string) => Promise<unknown>): Promise<PharmacyFormState> {
  const key = str(f, "key");
  if (!UUID.test(key)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return next(p, { error: COPY.ERR_FORBIDDEN });
  if (staleContext(f, rc.active.context)) return next(p, { error: STALE_CONTEXT });
  try {
    await withTenantContext(await appPool(), rc.active.context, (db) => fn(db, key));
  } catch (e) {
    return next(p, { error: message(e) });
  }
  revalidatePath("/apotek", "layout");
  return next(p, { ok });
}

// Petakan: a recipe row of a service version → a stock item and its quantity per treatment.
export async function mapAction(p: PharmacyFormState, f: FormData): Promise<PharmacyFormState> {
  const version = str(f, "version");
  const row = Number(str(f, "row"));
  const item = str(f, "item");
  const qty = str(f, "qty").replace(",", ".");
  if (!UUID.test(version) || !Number.isInteger(row) || row < 0 || row > 49) return next(p, { error: COPY.ERR_NOT_FOUND });
  if (!UUID.test(item)) return next(p, { error: "Pilih item stok." });
  if (!QTY.test(qty) || Number(qty) <= 0) return next(p, { error: "Tulis jumlah per tindakan." });
  return run(p, f, "Baris resep dipetakan.", (db, key) => mapRecipe(db, key, version, row, { stockItemId: item, quantity: qty }));
}

// Siapkan Bahan: the selected treatment's request (pharmacist), then issued from the chosen depot in one step.
export async function prepareMaterialsAction(p: PharmacyFormState, f: FormData): Promise<PharmacyFormState> {
  const item = str(f, "item");
  const from = str(f, "from");
  if (!UUID.test(item)) return next(p, { error: COPY.ERR_NOT_FOUND });
  if (!UUID.test(from)) return next(p, { error: "Pilih depot asal bahan." });
  return run(p, f, "Bahan disiapkan dan dikeluarkan ke depot ruang.", async (db, key) => {
    const { requestId } = await prepareMaterials(db, key, item);
    // the issue's key derives from the form's key so a retried submit replays both steps
    await issueMaterials(db, `${key}:issue`, requestId, { fromDepotId: from });
  });
}

// Siapkan (product): the depot to dispense from; no stock moves (CLIN-017).
export async function prepareAction(p: PharmacyFormState, f: FormData): Promise<PharmacyFormState> {
  const id = str(f, "dispensing");
  const depot = str(f, "depot");
  if (!UUID.test(id)) return next(p, { error: COPY.ERR_NOT_FOUND });
  return run(p, f, "Disiapkan; menunggu diserahkan.", (db, key) => prepareDispensing(db, key, id, UUID.test(depot) ? depot : null));
}

// Cetak Etiket: records the print (the browser prints the label view).
export async function labelAction(p: PharmacyFormState, f: FormData): Promise<PharmacyFormState> {
  const id = str(f, "dispensing");
  if (!UUID.test(id)) return next(p, { error: COPY.ERR_NOT_FOUND });
  return run(p, f, "Etiket dicetak.", (db, key) => printLabel(db, key, id));
}

// Serahkan: the seven checks (checkboxes c:<check>), an exception note covering unchecked ones.
export async function handOverAction(p: PharmacyFormState, f: FormData): Promise<PharmacyFormState> {
  const id = str(f, "dispensing");
  if (!UUID.test(id)) return next(p, { error: COPY.ERR_NOT_FOUND });
  const checks = Object.fromEntries(CHECKS.map((c) => [c, str(f, `c:${c}`) === "on"])) as Record<Check, boolean>;
  const note = str(f, "note");
  const missing = CHECKS.some((c) => !checks[c]);
  if (missing && note.length < 3) return next(p, { error: REASON.checks_incomplete });
  return run(p, f, "Diserahkan kepada pasien.", (db, key) => handOver(db, key, id, { checks, exceptionNote: missing ? note : null }));
}

export async function cancelAction(p: PharmacyFormState, f: FormData): Promise<PharmacyFormState> {
  const id = str(f, "dispensing");
  const reason = str(f, "reason");
  if (!UUID.test(id)) return next(p, { error: COPY.ERR_NOT_FOUND });
  if (reason.length < 3) return next(p, { error: "Tulis alasan pembatalan (minimal 3 huruf)." });
  return run(p, f, "Penyerahan dibatalkan.", (db, key) => cancelDispensing(db, key, id, reason));
}
