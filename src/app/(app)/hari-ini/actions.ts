"use server";
// Hari Ini actions (UX-6, PR-7, T-047): Pasien Datang and Tutup Kunjungan. Each refuses a form rendered
// in another context first (HYG-009 B2-1); the database decides authority, the check-in window and the
// close blockers. Every write carries the form's per-mount idempotency key.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { STALE_CONTEXT, staleContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { checkIn, closeVisit } from "../../../modules/visits/visits";
import { GoLiveBlockedError } from "../../../modules/vendor/profile/profile";

export type VisitState = { error?: string; ok?: string; n?: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Peran Anda tidak dapat mencatat kedatangan atau menutup kunjungan.",
  ERR_NOT_FOUND: "Janji atau kunjungan tidak ditemukan. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Data sudah berubah. Muat ulang halaman.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
  ERR_TENANT_SUSPENDED: "Klinik sedang tidak melayani kunjungan.",
  ERR_IDEMPOTENCY_CONFLICT: "Permintaan ini sudah dikirim dengan isi lain. Muat ulang halaman.",
  not_scheduled: "Janji ini sudah tidak terjadwal.",
  not_today: "Hanya janji hari ini yang dapat dicatat datang.",
  too_early: "Belum bisa dicatat datang: paling cepat 2 jam sebelum jam janji.",
  already_open: "Pasien ini masih punya kunjungan terbuka di cabang ini.",
  already_closed: "Kunjungan ini sudah ditutup.",
  unpaid_bill: "Belum bisa ditutup: tagihan belum lunas.",
  pending_dispensing: "Belum bisa ditutup: obat belum diserahkan.",
  pending_treatment: "Belum bisa ditutup: tindakan belum selesai.",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const done = (prev: VisitState, s: VisitState): VisitState => ({ ...s, n: (prev.n ?? 0) + 1 });
const message = (e: unknown) => {
  if (e instanceof GoLiveBlockedError) return "Klinik belum boleh menerima data pasien sungguhan (persyaratan go-live belum lengkap).";
  if (e instanceof CommandError) return COPY[(e as { reason?: string }).reason ?? ""] ?? COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  console.error("hari-ini: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.";
};

async function write(prev: VisitState, f: FormData, work: (db: Parameters<Parameters<typeof withTenantContext>[2]>[0], key: string, id: string) => Promise<unknown>, ok: string) {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return done(prev, { error: COPY.ERR_FORBIDDEN });
  if (staleContext(f, rc.active.context)) return done(prev, { error: STALE_CONTEXT });
  const key = str(f, "key");
  const id = str(f, "id");
  if (!UUID.test(id)) return done(prev, { error: COPY.ERR_NOT_FOUND });
  if (!UUID.test(key)) return done(prev, { error: COPY.ERR_VERSION_CONFLICT });
  try {
    await withTenantContext(await appPool(), rc.active.context, (db) => work(db, key, id));
  } catch (e) {
    return done(prev, { error: message(e) });
  }
  revalidatePath("/hari-ini");
  return done(prev, { ok });
}

export async function checkInAction(prev: VisitState, f: FormData): Promise<VisitState> {
  return write(prev, f, (db, key, id) => checkIn(db, key, id), "Pasien dicatat datang.");
}
export async function closeVisitAction(prev: VisitState, f: FormData): Promise<VisitState> {
  return write(prev, f, (db, key, id) => closeVisit(db, key, id), "Kunjungan ditutup.");
}
