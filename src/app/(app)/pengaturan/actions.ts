"use server";
// Pengaturan changes (PR-38): Simpan (a new version, effective now or from a date),
// Kembalikan ke default, and withdrawing one's own draft. Runs in the request's active
// context; setting_set refuses roles, branches and values the registry does not allow.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { SETTING_BY_KEY } from "../../../modules/settings/registry";
import { cancelDraft, changeSetting, SettingBoundsError } from "../../../modules/settings/settings";
import { boundsText, fromForm } from "../../../modules/settings/spec";

export type SaveState = { error?: string; ok?: string; values?: Record<string, string[]> };

const MESSAGES: Record<string, string> = {
  ERR_SETTING_NOT_ALLOWED: "Pengaturan ini tidak tersedia.",
  ERR_SETTING_OUT_OF_BOUNDS: "Nilai di luar batas yang diizinkan.",
  ERR_FORBIDDEN: "Anda tidak punya akses untuk mengubah pengaturan ini.",
  ERR_NOT_FOUND: "Cabang tidak ditemukan.",
  ERR_IDEMPOTENCY_CONFLICT: "Usulan untuk pengaturan ini masih menunggu persetujuan.",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JAKARTA_OFFSET = "+07:00"; // the date field is a clinic date; branch zones follow with SET-3

// Keep what the person typed so a refused value is not lost (React resets the form).
function echo(f: FormData): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of f.entries()) if (typeof v === "string") (out[k] ??= []).push(v);
  return out;
}

export async function saveAction(_p: SaveState, f: FormData): Promise<SaveState> {
  const key = String(f.get("key") ?? "");
  const def = SETTING_BY_KEY.get(key);
  if (!def || def.kind !== "value") return { error: MESSAGES.ERR_SETTING_NOT_ALLOWED };
  const branch = String(f.get("branch") ?? "");
  if (branch && !UUID.test(branch)) return { error: MESSAGES.ERR_NOT_FOUND };
  const restore = f.get("intent") === "restore";
  const reason = String(f.get("reason") ?? "").trim();
  if (reason.length < 3 || reason.length > 500) return { error: "Tulis alasan perubahan (3–500 karakter).", values: echo(f) };
  const date = restore ? "" : String(f.get("effective") ?? "");
  let effectiveFrom: Date | undefined;
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Tanggal berlaku tidak valid.", values: echo(f) };
    effectiveFrom = new Date(`${date}T00:00:00${JAKARTA_OFFSET}`);
    const today = new Date(`${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" })}T00:00:00${JAKARTA_OFFSET}`);
    if (Number.isNaN(effectiveFrom.getTime()) || effectiveFrom < today) return { error: "Tanggal berlaku tidak boleh di masa lalu.", values: echo(f) };
    if (effectiveFrom.getTime() === today.getTime()) effectiveFrom = undefined; // today = now
    else if (effectiveFrom.getTime() > Date.now() + 365 * 86400_000) return { error: "Tanggal berlaku paling lama setahun ke depan.", values: echo(f) };
  }
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return { error: MESSAGES.ERR_FORBIDDEN };
  let r;
  try {
    // fromForm never throws (unparseable input comes back as text the validator refuses).
    const value = restore ? undefined : fromForm(def.spec, (n) => (typeof f.get(n) === "string" ? (f.get(n) as string) : null), (n) => f.getAll(n).filter((x): x is string => typeof x === "string"), "v");
    r = await withTenantContext(await appPool(), rc.active.context, (db) =>
      changeSetting(db, { key, branchId: branch || null, value, restore, effectiveFrom, reason }),
    );
  } catch (e) {
    if (e instanceof SettingBoundsError) return { error: e.message, values: echo(f) };
    if (e instanceof CommandError) {
      // The server validator names the bound first; if the database still refuses, name it here.
      const msg = e.code === "ERR_SETTING_OUT_OF_BOUNDS" ? `Nilai di luar batas: ${boundsText(def.spec)}.` : MESSAGES[e.code];
      return { error: msg ?? "Perubahan belum tersimpan. Coba lagi.", values: echo(f) };
    }
    console.error("pengaturan: change failed", { key, error: e instanceof Error ? e.message : String(e) });
    return { error: "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.", values: echo(f) };
  }
  revalidatePath(`/pengaturan/${def.group}`);
  if (r.state === "draft") return { ok: "Usulan dikirim ke Persetujuan." };
  return { ok: restore ? "Dikembalikan ke default." : effectiveFrom ? "Perubahan terjadwal." : "Disimpan." };
}

export async function withdrawAction(_p: SaveState, f: FormData): Promise<SaveState> {
  const approval = String(f.get("approval") ?? "");
  const group = String(f.get("group") ?? "");
  if (!UUID.test(approval)) return { error: "Usulan tidak ditemukan." };
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return { error: MESSAGES.ERR_FORBIDDEN };
  try {
    await withTenantContext(await appPool(), rc.active.context, (db) => cancelDraft(db, approval));
  } catch (e) {
    if (e instanceof CommandError) return { error: "Usulan tidak ditemukan." };
    throw e;
  }
  if (/^[a-z]+$/.test(group)) revalidatePath(`/pengaturan/${group}`);
  return { ok: "Usulan ditarik." };
}
