"use server";
// Paket & Saldo actions (UX-13; T-076): Pesan Sesi, Batal Pesan, Isi Saldo, Batalkan Paket, Isi Paket. Each refuses a
// form rendered in another context first (HYG-009 B2-1), carries the form's idempotency key (rotated after every
// answer: n), and lets the database decide authority, unlocking by paid value and the money moves.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { STALE_CONTEXT, staleContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { cancelPackage, releaseSession, reserveSession, setPackageContents, topUpBalance } from "../../../../modules/packages/packages";
import { GoLiveBlockedError } from "../../../../modules/vendor/profile/profile";

export type PaketState = { error?: string; ok?: string; n?: number; receipt?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONEY = /^\d{1,13}$/;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Peran ini tidak dapat melakukan aksi ini.",
  ERR_NOT_FOUND: "Data tidak ditemukan. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Data sudah berubah. Muat ulang halaman.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
  ERR_TENANT_SUSPENDED: "Kasir klinik sedang tidak dapat dipakai.",
  ERR_IDEMPOTENCY_CONFLICT: "Isian ini sudah dikirim dengan isi lain. Muat ulang halaman.",
  ERR_NOT_AVAILABLE: "Metode bayar ini dimatikan di Pengaturan › Uang & Kasir.",
  ERR_SESSION_NOT_UNLOCKED: "Sesi belum bisa dipesan: pembayaran belum mencukupi nilai sesi.",
  ERR_PACKAGE_EXPIRED: "Paket sudah tidak berlaku.",
};
const REASON: Record<string, string> = {
  session_in_treatment: "Sesi sedang dipakai di ruang tindakan.",
  session_not_reserved: "Sesi ini tidak lagi dipesan. Muat ulang halaman.",
  package_closed: "Paket sudah ditutup.",
  package_sold: "Isi paket ini tidak dapat diubah: paket sudah terjual. Terbitkan versi baru di Katalog.",
  no_session: "Tidak ada sesi tersedia untuk layanan ini.",
  reason: "Tulis alasan (3–500 karakter).",
  contents: "Pilih layanan (tanpa duplikat) dan jumlah 1–50.",
  method_disabled: "Metode ini dimatikan di Pengaturan › Uang & Kasir.",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const money = (s: string) => s.replace(/[.\s]/g, "").replace(/^Rp/i, "");
const next = (p: PaketState, s: PaketState): PaketState => ({ ...s, n: (p.n ?? 0) + 1 });
const message = (e: unknown) => {
  if (e instanceof GoLiveBlockedError) return "Klinik belum boleh menerima data pasien sungguhan (persyaratan go-live belum lengkap).";
  if (e instanceof CommandError) {
    const r = (e as { reason?: string }).reason ?? "";
    const need = /^need (\d+)$/.exec(r);
    if (need) return `Perlu bayar ${new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(need[1])).replace(/\s/g, "")} lagi.`;
    return REASON[r] ?? COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  }
  console.error("paket-saldo: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.";
};
type Db = Parameters<Parameters<typeof withTenantContext>[2]>[0];
async function run<R>(p: PaketState, f: FormData, fn: (db: Db, key: string) => Promise<R>, done: (r: R) => PaketState): Promise<PaketState> {
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

export async function reserveAction(p: PaketState, f: FormData): Promise<PaketState> {
  const pkg = str(f, "package");
  const visit = str(f, "visit");
  const service = str(f, "service");
  if (!UUID.test(pkg) || !UUID.test(visit) || (service && !UUID.test(service))) return next(p, { error: "Pilih kunjungan hari ini." });
  return run(p, f, (db, key) => reserveSession(db, key, pkg, visit, service || undefined), () => ({ ok: "Sesi dipesan untuk kunjungan ini." }));
}
export async function releaseAction(p: PaketState, f: FormData): Promise<PaketState> {
  const session = str(f, "session");
  if (!UUID.test(session)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  return run(p, f, async (db, key) => { await releaseSession(db, key, session); return null; }, () => ({ ok: "Pesanan sesi dibatalkan." }));
}
export async function cancelAction(p: PaketState, f: FormData): Promise<PaketState> {
  const pkg = str(f, "package");
  const reason = str(f, "reason");
  if (!UUID.test(pkg)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  if (reason.length < 3 || reason.length > 500) return next(p, { error: REASON.reason });
  return run(p, f, (db, key) => cancelPackage(db, key, pkg, reason), (r) => ({ ok: r.to_balance > 0
    ? `Paket dibatalkan. Rp${r.to_balance.toLocaleString("id-ID")} masuk saldo pasien.` : "Paket dibatalkan. Tidak ada nilai yang masuk saldo." }));
}
export async function topUpAction(p: PaketState, f: FormData): Promise<PaketState> {
  const patient = str(f, "patient");
  const method = str(f, "method");
  const amount = money(str(f, "amount"));
  if (!UUID.test(patient) || !["cash", "edc", "transfer"].includes(method)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  if (!MONEY.test(amount) || Number(amount) < 1) return next(p, { error: "Isi jumlah dalam rupiah." });
  const tendered = method === "cash" ? money(str(f, "tendered")) || amount : null;
  if (tendered !== null && (!MONEY.test(tendered) || Number(tendered) < Number(amount))) return next(p, { error: "Uang diterima kurang dari jumlah." });
  const branch = UUID.test(str(f, "branch")) ? str(f, "branch") : null;
  return run(p, f, (db, key) => topUpBalance(db, key, patient, branch, { method: method as "cash" | "edc" | "transfer", amount: Number(amount),
    ...(tendered !== null ? { cashTendered: Number(tendered) } : {}) }),
    (r) => ({ ok: r.change > 0 ? `Saldo diisi. Struk ${r.number}. Kembalian Rp${r.change.toLocaleString("id-ID")}.` : `Saldo diisi. Struk ${r.number}.`, receipt: r.receipt_id }));
}
export async function contentsAction(p: PaketState, f: FormData): Promise<PaketState> {
  const version = str(f, "version");
  if (!UUID.test(version)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  const rows: { serviceItemId: string; count: number }[] = [];
  for (let i = 0; i < 20; i++) {
    const s = str(f, `svc:${i}`);
    if (!s) continue;
    const c = str(f, `cnt:${i}`);
    if (!UUID.test(s) || !/^\d{1,2}$/.test(c) || Number(c) < 1 || Number(c) > 50) return next(p, { error: REASON.contents });
    rows.push({ serviceItemId: s, count: Number(c) });
  }
  if (!rows.length) return next(p, { error: REASON.contents });
  return run(p, f, async (db, key) => { await setPackageContents(db, key, version, rows); return null; }, () => ({ ok: "Isi paket disimpan." }));
}
