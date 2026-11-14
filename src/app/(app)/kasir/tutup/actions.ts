"use server";
// Tutup Kasir actions (UX-15; T-085): Buka Kasir (with the float) and Tutup Kasir / Hitung Ulang (the counted cash, the reason when it
// differs). Each refuses a form rendered in another context first (HYG-009 B2-1), carries the form's idempotency key (rotated after every
// answer: n), and lets the database decide authority, the expectation and the routing (DEC-098).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { openShift, submitShiftCount } from "../../../../modules/cashier/shifts/shifts";
import { STALE_CONTEXT, staleContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { GoLiveBlockedError } from "../../../../modules/vendor/profile/profile";

export type ShiftState = { error?: string; ok?: string; n?: number; values?: Record<string, string>; go?: string }; // go: a server redirect
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Peran ini tidak dapat melakukan aksi ini.",
  ERR_NOT_FOUND: "Shift tidak ditemukan. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Data sudah diubah orang lain. Muat ulang lalu coba lagi.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
  ERR_TENANT_SUSPENDED: "Kasir klinik sedang tidak dapat dipakai.",
  ERR_IDEMPOTENCY_CONFLICT: "Isian ini sudah dikirim dengan isi lain. Muat ulang halaman.",
};
const REASON: Record<string, string> = {
  shift_open: "Kasir Anda di cabang ini sudah terbuka.",
  shift_pending: "Hitungan sedang menunggu persetujuan.",
  shift_closed: "Shift sudah ditutup. Pembayaran baru masuk ke shift berikutnya.",
  reason: "Tulis alasan selisih (3–500 karakter).",
  counted_cash: "Isi jumlah uang tunai di laci.",
  opening_float: "Isi modal awal (Rp0 atau lebih).",
  "branch not found": "Pilih cabang.",
  "only the cashier or a manager of the branch counts this shift": "Hanya kasir shift ini atau manajer cabang yang dapat menghitung.",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const money = (s: string) => (/^(Rp)?\s*\d[\d.\s]*$/i.test(s) ? Number(s.replace(/[.\s]/g, "").replace(/^Rp/i, "")) : NaN);
const next = (p: ShiftState, s: ShiftState): ShiftState => ({ ...s, n: (p.n ?? 0) + 1 });
const keep = (f: FormData) => Object.fromEntries([...f.entries()].filter(([k, v]) => typeof v === "string" && !k.startsWith("ctx_") && !k.startsWith("$") && k !== "key")) as Record<string, string>;
const message = (e: unknown) => {
  if (e instanceof GoLiveBlockedError) return "Klinik belum boleh menerima data sungguhan (persyaratan go-live belum lengkap).";
  if (e instanceof CommandError) {
    const r = (e as { reason?: string }).reason ?? "";
    return REASON[r] ?? REASON[r.split(" ")[0]] ?? COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  }
  console.error("tutup-kasir: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.";
};
type Db = Parameters<Parameters<typeof withTenantContext>[2]>[0];
async function run<R>(p: ShiftState, f: FormData, fn: (db: Db, key: string) => Promise<R>, done: (r: R) => ShiftState): Promise<ShiftState> {
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
  revalidatePath("/kasir/tutup", "layout");
  const out = done(r);
  if (out.go) redirect(out.go);
  return next(p, out);
}

export async function openAction(p: ShiftState, f: FormData): Promise<ShiftState> {
  const branch = str(f, "branch");
  const float = money(str(f, "opening_float") || "0");
  if (branch && !UUID.test(branch)) return next(p, { error: REASON["branch not found"] });
  if (!Number.isSafeInteger(float) || float < 0 || float > 10_000_000_000) return next(p, { error: REASON.opening_float, values: keep(f) });
  return run(p, f, (db, key) => openShift(db, key, { branchId: branch || null, openingFloat: float }), (r) => ({ ok: "Kasir dibuka.", go: `/kasir/tutup/${r.shiftId}` }));
}
export async function countAction(p: ShiftState, f: FormData): Promise<ShiftState> {
  const shift = str(f, "shift");
  const counted = money(str(f, "counted_cash"));
  const reason = str(f, "reason");
  if (!UUID.test(shift)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  if (!Number.isSafeInteger(counted) || counted < 0 || counted > 1_000_000_000_000) return next(p, { error: REASON.counted_cash, values: keep(f) });
  if (reason && (reason.length < 3 || reason.length > 500)) return next(p, { error: REASON.reason, values: keep(f) });
  // The form leaves the page once the shift waits or closes (revalidation), so the answer is a server redirect with the notice.
  return run(p, f, (db, key) => submitShiftCount(db, key, shift, { countedCash: counted, reason: reason || null }), () => ({ ok: "Hitungan dikirim.", go: `/kasir/tutup/${shift}?dikirim=1` }));
}
