"use server";
// Gudang & Depot actions (PR-89, T-061; HYG-NAV-2): Tambah Depot and Pindah Antar Depot (pharmacist, purchasing; the database decides
// authority, branch and availability under a row lock). Each refuses a form rendered in another context first (HYG-009 B2-1); every write
// carries the form's per-mount idempotency key. Inter-branch transfers stay in Pembelian ▸ Transfer.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { createDepot, type DepotKind, transferBetweenDepots } from "../../../../modules/inventory/depots/depots";
import { STALE_CONTEXT, staleContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { GoLiveBlockedError } from "../../../../modules/vendor/profile/profile";
import { DEPOT_WRITERS } from "./data";
import { checkMove } from "./model";

export type DepotState = { error?: string; ok?: string; n?: number };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Peran Anda tidak dapat mengubah depot.",
  ERR_NOT_FOUND: "Depot atau batch tidak ditemukan di cabang ini. Muat ulang halaman.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
  ERR_VERSION_CONFLICT: "Stok sudah berubah. Muat ulang halaman.",
  ERR_STOCK_INSUFFICIENT: "Stok tidak cukup di depot asal.",
  ERR_STOCK_UNFIT: "Batch ini tidak layak dipakai (kedaluwarsa, ditarik, atau karantina).",
  ERR_TENANT_SUSPENDED: "Klinik sedang tidak dapat mengubah ini.",
  ERR_IDEMPOTENCY_CONFLICT: "Permintaan ini sudah dikirim dengan isi lain. Muat ulang halaman.",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");

async function run(prev: DepotState, f: FormData, ok: string, work: (db: Parameters<Parameters<typeof withTenantContext>[2]>[0], key: string) => Promise<unknown>): Promise<DepotState> {
  const n = (prev.n ?? 0) + 1;
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return { error: COPY.ERR_FORBIDDEN, n };
  if (staleContext(f, rc.active.context)) return { error: STALE_CONTEXT, n };
  // this surface is PH / PU only (19 §2.9, nav); the database also admits admin_pusat for depot_create, so the page boundary is enforced
  // here before any command (review r1 P1)
  if (!DEPOT_WRITERS.includes(rc.active.context.actingRole)) return { error: COPY.ERR_FORBIDDEN, n };
  const key = str(f, "key");
  if (!UUID.test(key)) return { error: COPY.ERR_VERSION_CONFLICT, n };
  try {
    await withTenantContext(await appPool(), rc.active.context, (db) => work(db, key));
  } catch (e) {
    if (e instanceof GoLiveBlockedError) return { error: "Klinik belum boleh menerima data pasien sungguhan (persyaratan go-live belum lengkap).", n };
    if (e instanceof CommandError) return { error: COPY[e.code] ?? COPY.ERR_FORBIDDEN, n };
    console.error("depot: action failed", { error: e instanceof Error ? e.name : "unknown" });
    return { error: "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.", n };
  }
  revalidatePath("/stok/depot");
  return { ok, n };
}

export async function createDepotAction(prev: DepotState, f: FormData): Promise<DepotState> {
  const name = str(f, "name");
  const kind = str(f, "kind") as DepotKind;
  const branch = str(f, "branch");
  if (name.length < 2 || name.length > 60 || !["gudang", "ruang", "apotek"].includes(kind)) return { error: "Isi nama depot (2–60 huruf) dan pilih jenisnya.", n: (prev.n ?? 0) + 1 };
  return run(prev, f, "Depot ditambahkan.", (db, key) => createDepot(db, key, { branchId: UUID.test(branch) ? branch : null, name, kind }));
}

export async function moveAction(prev: DepotState, f: FormData): Promise<DepotState> {
  const i = { from: str(f, "from"), to: str(f, "to"), batch: str(f, "batch"), quantity: str(f, "quantity") };
  const chk = checkMove(i, null);
  if (!chk.ok || !UUID.test(i.from) || !UUID.test(i.to) || !UUID.test(i.batch)) return { error: chk.ok ? COPY.ERR_INVALID_INPUT : chk.error, n: (prev.n ?? 0) + 1 };
  return run(prev, f, "Stok dipindahkan antar depot.", (db, key) => transferBetweenDepots(db, key, { fromDepotId: i.from, toDepotId: i.to, lines: [{ batchId: i.batch, quantity: i.quantity }] }));
}
