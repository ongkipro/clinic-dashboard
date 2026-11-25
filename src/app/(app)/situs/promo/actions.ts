"use server";
// Kode Promo & Voucher actions (/situs/promo; PR-77, UX-50; T-123).
// Promo codes apply at cashier and direct consented messages ONLY — never published on public pages.
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { STALE_CONTEXT, staleContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { createPromoCode, setPromoCode } from "../../../../modules/promo/promo";

export type PromoActionState = { error?: string; ok?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function runPromoAction(
  f: FormData,
  fn: (db: Parameters<Parameters<typeof withTenantContext>[2]>[0]) => Promise<PromoActionState>,
): Promise<PromoActionState> {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return { error: "Anda tidak memiliki akses ke kode promo." };
  if (staleContext(f, rc.active.context)) return { error: STALE_CONTEXT };
  try {
    return await withTenantContext(await appPool(), rc.active.context, fn);
  } catch (e) {
    if (e instanceof CommandError) return { error: e.message || "Gagal menyimpan kode promo." };
    return { error: "Belum pasti tersimpan. Muat ulang halaman untuk memeriksa status." };
  }
}

export async function createPromoAction(_prev: PromoActionState, f: FormData): Promise<PromoActionState> {
  const code = String(f.get("code") ?? "").trim().toUpperCase();
  const quota = Number.parseInt(String(f.get("quota") ?? ""), 10);
  const validFrom = String(f.get("validFrom") ?? "").trim();
  const validTo = String(f.get("validTo") ?? "").trim();
  const discountKind = String(f.get("discountKind") ?? "percent");
  const discountValue = Number.parseInt(String(f.get("discountValue") ?? ""), 10);
  const itemId = String(f.get("itemId") ?? "").trim();
  const key = String(f.get("idempotencyKey") ?? "").trim() || randomUUID();

  if (!/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(code)) return { error: "Kode promo harus 3–32 huruf kapital/angka." };
  if (!Number.isSafeInteger(quota) || quota < 1) return { error: "Kuota minimal 1." };
  if (!DATE.test(validFrom) || !DATE.test(validTo) || validTo < validFrom) return { error: "Rentang tanggal berlaku tidak valid." };
  if (discountKind !== "percent" && discountKind !== "rupiah") return { error: "Jenis potongan tidak valid." };
  if (!Number.isSafeInteger(discountValue) || discountValue < 1) return { error: "Nilai potongan harus lebih dari 0." };
  if (!UUID.test(itemId)) return { error: "Pilih minimal satu layanan." };

  const res = await runPromoAction(f, async (db) => {
    await createPromoCode(db, key, code, quota, {
      validFrom,
      validTo,
      discountKind,
      discountValue,
      itemIds: [itemId],
    });
    return { ok: `Kode promo ${code} tersimpan (khusus kasir & pesan langsung).` };
  });
  if (res.ok) revalidatePath("/situs/promo");
  return res;
}

export async function togglePromoAction(_prev: PromoActionState, f: FormData): Promise<PromoActionState> {
  const promoId = String(f.get("promoId") ?? "").trim();
  const active = f.get("nextActive") === "true";
  const key = String(f.get("idempotencyKey") ?? "").trim() || randomUUID();
  if (!UUID.test(promoId)) return { error: "Kode promo tidak ditemukan." };
  const res = await runPromoAction(f, async (db) => {
    await setPromoCode(db, key, promoId, { active });
    return { ok: active ? "Kode promo diaktifkan." : "Kode promo dinonaktifkan." };
  });
  if (res.ok) revalidatePath("/situs/promo");
  return res;
}
