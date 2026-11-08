"use server";
// Harga Cabang actions (UX-25, PR-42, T-035): the Owner sets a branch price (or returns it to the
// normal price) from a date in the branch's timezone, and cancels a scheduled one. Each refuses a form
// rendered in another context first (HYG-009 B2-1); the database decides the role, the bounds and the
// effective time.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { cancelBranchPrice, effectiveFromDate, setBranchPrice } from "../../../../modules/catalog/prices/prices";
import { STALE_CONTEXT, staleContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";

export type HargaState = { error?: string; ok?: string; values?: Record<string, string> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Hanya Owner yang dapat mengubah harga cabang.",
  ERR_NOT_FOUND: "Item atau cabang tidak ditemukan. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Sudah ada harga cabang yang berlaku mulai waktu itu, atau harga ini sudah berlaku. Muat ulang halaman.",
  ERR_INVALID_INPUT: "Periksa kembali isian: harga minimal Rp1, berlaku paling lambat setahun ke depan, dan alasan diisi.",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const keep = (f: FormData) => Object.fromEntries([...f.entries()].filter(([k, v]) => typeof v === "string" && !k.startsWith("ctx_") && !k.startsWith("$"))) as Record<string, string>;

export async function setPriceAction(_p: HargaState, f: FormData): Promise<HargaState> {
  const itemId = str(f, "item");
  const branchId = str(f, "branch");
  const mode = str(f, "mode");
  const reason = str(f, "reason");
  if (!UUID.test(itemId)) return { error: COPY.ERR_NOT_FOUND };
  if (!UUID.test(branchId)) return { error: "Pilih cabang.", values: keep(f) };
  let price: number | null = null;
  if (mode !== "normal") {
    const s = str(f, "price").replace(/[.\s]/g, "");
    if (!/^\d{1,13}$/.test(s) || Number(s) < 1) return { error: "Isi harga dalam rupiah, minimal Rp1. Untuk gratis, gunakan diskon atau pembebasan.", values: keep(f) };
    price = Number(s);
  }
  if (reason.length < 3) return { error: "Tulis alasan perubahan harga.", values: keep(f) };
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return { error: COPY.ERR_FORBIDDEN };
  if (staleContext(f, rc.active.context)) return { error: STALE_CONTEXT, values: keep(f) };
  try {
    const result = await withTenantContext(await appPool(), rc.active.context, async (db) => {
      const from = await effectiveFromDate(db, branchId, str(f, "from"));
      if (from === "invalid") return "Pilih tanggal berlaku.";
      if (from === "backdated") return "Tanggal berlaku tidak boleh sebelum hari ini di zona waktu cabang.";
      if (from === "no-branch") return COPY.ERR_NOT_FOUND;
      await setBranchPrice(db, { itemId, branchId, price, effectiveFrom: from, reason });
      return null;
    });
    if (result) return { error: result, values: keep(f) };
  } catch (e) {
    if (e instanceof CommandError) return { error: COPY[e.code] ?? COPY.ERR_FORBIDDEN, values: keep(f) };
    console.error("harga-cabang: set failed", { error: e instanceof Error ? e.message : String(e) });
    return { error: "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.", values: keep(f) };
  }
  revalidatePath("/katalog/harga-cabang");
  revalidatePath(`/katalog/harga-cabang/${itemId}`);
  // The branch stays selected for the next change (the form remounts from these values).
  return { ok: price === null ? "Harga cabang dijadwalkan kembali ke harga normal." : "Harga cabang tersimpan.", values: { branch: branchId } };
}

export async function cancelPriceAction(_p: HargaState, f: FormData): Promise<HargaState> {
  const id = str(f, "id");
  const itemId = str(f, "item");
  if (!UUID.test(id) || !UUID.test(itemId)) return { error: COPY.ERR_NOT_FOUND };
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return { error: COPY.ERR_FORBIDDEN };
  if (staleContext(f, rc.active.context)) return { error: STALE_CONTEXT };
  try {
    await withTenantContext(await appPool(), rc.active.context, (db) => cancelBranchPrice(db, id));
  } catch (e) {
    if (e instanceof CommandError) return { error: COPY[e.code] ?? COPY.ERR_FORBIDDEN };
    throw e;
  }
  revalidatePath("/katalog/harga-cabang");
  revalidatePath(`/katalog/harga-cabang/${itemId}`);
  return { ok: "Jadwal harga dibatalkan." };
}
