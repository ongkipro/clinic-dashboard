"use server";
// Templat Paket action (PR-93, T-082; HYG-NAV-2): switch family sharing of a package template (package_sharing_set: owner only; reason
// 3–500 characters). Refuses a form rendered in another context first (HYG-009 B2-1); per-mount idempotency key.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { STALE_CONTEXT, staleContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { setPackageSharing } from "../../../../modules/packages/sharing/sharing";
import { GoLiveBlockedError } from "../../../../modules/vendor/profile/profile";

export type SharingState = { error?: string; ok?: string; n?: number };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Hanya Owner yang dapat mengubah berbagi keluarga.",
  ERR_NOT_FOUND: "Paket tidak ditemukan. Muat ulang halaman.",
  ERR_INVALID_INPUT: "Tulis alasan 3–500 huruf.",
  ERR_TENANT_SUSPENDED: "Klinik sedang tidak dapat mengubah ini.",
  ERR_IDEMPOTENCY_CONFLICT: "Permintaan ini sudah dikirim dengan isi lain. Muat ulang halaman.",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");

export async function sharingAction(prev: SharingState, f: FormData): Promise<SharingState> {
  const n = (prev.n ?? 0) + 1;
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return { error: COPY.ERR_FORBIDDEN, n };
  if (staleContext(f, rc.active.context)) return { error: STALE_CONTEXT, n };
  const item = str(f, "item");
  const key = str(f, "key");
  const reason = str(f, "reason");
  const enabled = str(f, "enabled") === "1";
  if (!UUID.test(item) || !UUID.test(key)) return { error: COPY.ERR_NOT_FOUND, n };
  if (reason.length < 3 || reason.length > 500) return { error: COPY.ERR_INVALID_INPUT, n };
  try {
    await withTenantContext(await appPool(), rc.active.context, (db) => setPackageSharing(db, key, item, enabled, reason));
  } catch (e) {
    if (e instanceof GoLiveBlockedError) return { error: "Klinik belum boleh menerima data pasien sungguhan (persyaratan go-live belum lengkap).", n };
    if (e instanceof CommandError) return { error: COPY[e.code] ?? COPY.ERR_FORBIDDEN, n };
    console.error("templat-paket: action failed", { error: e instanceof Error ? e.name : "unknown" });
    return { error: "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.", n };
  }
  revalidatePath("/layanan/paket");
  return { ok: enabled ? "Paket ini sekarang boleh dibagi ke keluarga." : "Berbagi keluarga dimatikan untuk penjualan berikutnya.", n };
}
