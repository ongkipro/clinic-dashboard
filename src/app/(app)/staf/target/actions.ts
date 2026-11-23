"use server";
// Target & Scorecard Staf action (PR-47, DEC-100; HYG-NAV-1): Tetapkan Target. The owner sets a staff member's closing-value target (and
// optional plans target) for a period; a new value supersedes the active one (staff_target_set). Refuses a form rendered in another
// context first (HYG-009 B2-1), carries the form's idempotency key, and lets the database decide authority (owner only).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { setStaffTarget } from "../../../../modules/commission/targets/targets";
import { STALE_CONTEXT, staleContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { GoLiveBlockedError } from "../../../../modules/vendor/profile/profile";
import { parseRupiah } from "./parse";

export type TargetState = { error?: string; ok?: string; n?: number };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2]|Q[1-4])$/;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Hanya Owner yang dapat menetapkan target.",
  ERR_NOT_FOUND: "Staf tidak ditemukan. Muat ulang halaman.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
  ERR_TENANT_SUSPENDED: "Klinik sedang tidak dapat mengubah konfigurasi.",
  ERR_IDEMPOTENCY_CONFLICT: "Isian ini sudah dikirim dengan isi lain. Muat ulang halaman.",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const next = (p: TargetState, s: TargetState): TargetState => ({ ...s, n: (p.n ?? 0) + 1 });

export async function setTargetAction(p: TargetState, f: FormData): Promise<TargetState> {
  const staff = str(f, "staff");
  const period = str(f, "period");
  const key = str(f, "key");
  const closing = parseRupiah(str(f, "closing"));
  const plansRaw = str(f, "plans");
  const plans = plansRaw === "" ? null : /^\d{1,4}$/.test(plansRaw) ? Number(plansRaw) : Number.NaN;
  if (!UUID.test(staff) || !PERIOD.test(period) || !UUID.test(key)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  if (!Number.isSafeInteger(closing) || closing < 0) return next(p, { error: "Isi target nilai closing dalam rupiah." });
  if (plans !== null && !Number.isSafeInteger(plans)) return next(p, { error: "Isi target rencana sebagai angka, atau kosongkan." });
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return next(p, { error: COPY.ERR_FORBIDDEN });
  if (staleContext(f, rc.active.context)) return next(p, { error: STALE_CONTEXT });
  try {
    await withTenantContext(await appPool(), rc.active.context, (db) => setStaffTarget(db, key, staff, period, { closingValueTarget: closing, plansTarget: plans }));
  } catch (e) {
    if (e instanceof GoLiveBlockedError) return next(p, { error: "Klinik belum boleh menerima data sungguhan (persyaratan go-live belum lengkap)." });
    if (e instanceof CommandError) return next(p, { error: COPY[e.code] ?? COPY.ERR_FORBIDDEN });
    console.error("staf/target: action failed", { error: e instanceof Error ? e.name : "unknown" });
    return next(p, { error: "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya." });
  }
  revalidatePath("/staf/target");
  return next(p, { ok: "Target disimpan." });
}
