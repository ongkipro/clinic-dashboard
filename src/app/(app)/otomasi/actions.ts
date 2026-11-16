"use server";
// Otomasi actions (UX-55; T-097): Simpan / Kembalikan ke default for SET-19 and SET-18 (owner, Admin Pusat — the settings writer and its
// own approval rules), Ajukan / Tarik Usulan for marketing's SET-19 draft, Setujui / Tolak for owner and Admin Pusat. Each refuses a form
// rendered in another context first (HYG-009 B2-1); the database decides authority (DEC-109).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { cancelScenarioDraft, decideScenarioDraft, proposeScenarioDraft } from "../../../modules/crm/automation/automation";
import { STALE_CONTEXT, staleContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { changeSetting, SettingBoundsError } from "../../../modules/settings/settings";
import { GoLiveBlockedError } from "../../../modules/vendor/profile/profile";

export type OtomasiState = { error?: string; ok?: string; n?: number };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEYS = ["pengingat", "aftercare", "kepuasan", "rencana", "belum_jadwal", "isi_ulang"] as const;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Peran ini tidak dapat melakukan aksi ini.",
  ERR_NOT_FOUND: "Usulan tidak ditemukan. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Usulan sudah diputuskan. Muat ulang halaman.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
  ERR_TENANT_SUSPENDED: "Klinik sedang tidak dapat mengubah pengaturan.",
  ERR_IDEMPOTENCY_CONFLICT: "Sudah ada usulan yang menunggu keputusan.",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const next = (p: OtomasiState, s: OtomasiState): OtomasiState => ({ ...s, n: (p.n ?? 0) + 1 });
const message = (e: unknown) => {
  if (e instanceof SettingBoundsError) return e.message;
  if (e instanceof GoLiveBlockedError) return "Klinik belum boleh menerima data sungguhan (persyaratan go-live belum lengkap).";
  if (e instanceof CommandError) return COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  console.error("otomasi: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.";
};
type Db = Parameters<Parameters<typeof withTenantContext>[2]>[0];
// go: a fixed /otomasi?ok=<code> for a form that unmounts on success (the draft decision): the page shows the notice from the code, as
// lead/actions.ts:66-68. The redirect runs only after the command committed and outside the catch (Next's redirect signal is a throw).
async function run(p: OtomasiState, f: FormData, fn: (db: Db) => Promise<unknown>, ok: string, go?: "disetujui" | "ditolak" | "ditarik"): Promise<OtomasiState> {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return next(p, { error: COPY.ERR_FORBIDDEN });
  if (staleContext(f, rc.active.context)) return next(p, { error: STALE_CONTEXT });
  try {
    await withTenantContext(await appPool(), rc.active.context, (db) => fn(db));
  } catch (e) {
    return next(p, { error: message(e) });
  }
  revalidatePath("/otomasi");
  if (go) redirect(`/otomasi?ok=${go}`);
  return next(p, { ok });
}
// The SET-19 value from the scenario form: each offset a number of days or "off" (null), the birthday on/off, the daily cap.
function scenarioValue(f: FormData): Record<string, unknown> | null {
  const v: Record<string, unknown> = {};
  for (const k of KEYS) {
    if (str(f, `${k}_on`) !== "on") { v[k] = null; continue; }
    const n = Number(str(f, k));
    if (!Number.isInteger(n)) return null;
    v[k] = n;
  }
  v.ulang_tahun = str(f, "ulang_tahun") === "on";
  const cap = Number(str(f, "batas_harian"));
  if (!Number.isInteger(cap)) return null;
  v.batas_harian = cap;
  return v;
}

export async function saveScenarioAction(p: OtomasiState, f: FormData): Promise<OtomasiState> {
  const reason = str(f, "reason");
  if (reason.length < 3) return next(p, { error: "Tulis alasan perubahan (minimal 3 karakter)." });
  if (str(f, "restore") === "1") return run(p, f, (db) => changeSetting(db, { key: "SET-19", branchId: null, restore: true, reason }), "Skenario dikembalikan ke default.");
  const value = scenarioValue(f);
  if (!value) return next(p, { error: COPY.ERR_INVALID_INPUT });
  return run(p, f, (db) => changeSetting(db, { key: "SET-19", branchId: null, value: value as never, reason }), "Skenario disimpan.");
}
export async function proposeScenarioAction(p: OtomasiState, f: FormData): Promise<OtomasiState> {
  const reason = str(f, "reason");
  const key = str(f, "key");
  if (reason.length < 3) return next(p, { error: "Tulis alasan usulan (minimal 3 karakter)." });
  if (!UUID.test(key)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  const value = scenarioValue(f);
  if (!value) return next(p, { error: COPY.ERR_INVALID_INPUT });
  return run(p, f, (db) => proposeScenarioDraft(db, key, value, reason), "Usulan dikirim ke Admin Pusat.");
}
export async function decideDraftAction(p: OtomasiState, f: FormData): Promise<OtomasiState> {
  const draft = str(f, "draft");
  const approve = str(f, "approve") === "1";
  const reason = str(f, "reason");
  if (!UUID.test(draft)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  if (!approve && reason.length < 3) return next(p, { error: "Tulis alasan penolakan (minimal 3 karakter)." });
  return run(p, f, (db) => decideScenarioDraft(db, draft, approve, reason || undefined), approve ? "Usulan disetujui." : "Usulan ditolak.",
    approve ? "disetujui" : "ditolak");
}
export async function cancelDraftAction(p: OtomasiState, f: FormData): Promise<OtomasiState> {
  const draft = str(f, "draft");
  if (!UUID.test(draft)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  return run(p, f, (db) => cancelScenarioDraft(db, draft), "Usulan ditarik.", "ditarik");
}
export async function saveReminderAction(p: OtomasiState, f: FormData): Promise<OtomasiState> {
  const branch = str(f, "branch");
  const reason = str(f, "reason");
  const h1 = str(f, "h1");
  const sebelum = Number(str(f, "sebelum"));
  if (!UUID.test(branch)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  if (reason.length < 3) return next(p, { error: "Tulis alasan perubahan (minimal 3 karakter)." });
  if (!/^[0-2][0-9]:[0-5][0-9]$/.test(h1) || !Number.isInteger(sebelum)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  return run(p, f, (db) => changeSetting(db, { key: "SET-18", branchId: branch, value: { h1, sebelum } as never, reason }), "Aturan pengingat cabang disimpan.");
}
