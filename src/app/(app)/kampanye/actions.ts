"use server";
// Kampanye actions (UX-19; T-100): Simpan Segmen, Jadwalkan, Kembalikan ke Draf / Batalkan, Kirim. Each refuses a form rendered in another
// context first (HYG-009 B2-1); the database decides authority, lifecycle and the Q-15 gate (DEC-112). Every write carries the form's
// idempotency key.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { saveSegment, scheduleCampaign, SEND_LOCKED, type SegmentRules, sendCampaign, unscheduleCampaign } from "../../../modules/crm/campaigns/campaigns";
import { STALE_CONTEXT, staleContext } from "../../../modules/org/context/context";
import { sentQuery } from "./labels";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { GoLiveBlockedError } from "../../../modules/vendor/profile/profile";

export type KampanyeState = { error?: string; ok?: string; n?: number };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Peran ini tidak dapat melakukan aksi ini.",
  ERR_NOT_FOUND: "Data tidak ditemukan. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Kampanye sudah berubah. Muat ulang halaman.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
  ERR_TENANT_SUSPENDED: "Klinik sedang tidak dapat melakukan aksi ini.",
  ERR_IDEMPOTENCY_CONFLICT: "Permintaan ini sudah diproses. Muat ulang halaman.",
  ERR_GATE_CLOSED: `${SEND_LOCKED}.`,
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const next = (p: KampanyeState, s: KampanyeState): KampanyeState => ({ ...s, n: (p.n ?? 0) + 1 });
const message = (e: unknown) => {
  if (e instanceof GoLiveBlockedError) return "Klinik belum boleh menerima data sungguhan (persyaratan go-live belum lengkap).";
  if (e instanceof CommandError) return COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  console.error("kampanye: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.";
};
type Db = Parameters<Parameters<typeof withTenantContext>[2]>[0];
// go: /kampanye?ok=<code> for a form that changes the list (schedule, cancel, send): the page shows the notice from a fixed map
// (lead/actions.ts pattern); the redirect runs after the command committed and outside the catch.
async function run<R>(p: KampanyeState, f: FormData, fn: (db: Db) => Promise<R>, ok: string, go?: string | ((r: R) => string)): Promise<KampanyeState> {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return next(p, { error: COPY.ERR_FORBIDDEN });
  if (staleContext(f, rc.active.context)) return next(p, { error: STALE_CONTEXT });
  let r: R;
  try {
    r = await withTenantContext(await appPool(), rc.active.context, (db) => fn(db));
  } catch (e) {
    return next(p, { error: message(e) });
  }
  revalidatePath("/kampanye");
  if (go) redirect(`/kampanye?ok=${typeof go === "function" ? go(r) : go}`);
  return next(p, { ok });
}
const int = (f: FormData, k: string) => { const v = str(f, k); return v === "" ? undefined : Number(v); };
// The segment rules from the form (the closed set; empty fields omitted). null when a number is not an integer.
function rules(f: FormData): SegmentRules | null {
  const r: SegmentRules = {};
  const branch = str(f, "branch_id");
  if (branch) { if (!UUID.test(branch)) return null; r.branch_id = branch; }
  const visit = str(f, "visit_mode");
  const days = int(f, "visit_days");
  if (visit === "within" || visit === "not_within") {
    if (days === undefined || !Number.isInteger(days)) return null;
    if (visit === "within") r.visit_within_days = days; else r.no_visit_within_days = days;
  }
  for (const k of ["birthday_month", "age_min", "age_max"] as const) {
    const v = int(f, k);
    if (v !== undefined) { if (!Number.isInteger(v)) return null; r[k] = v; }
  }
  const sex = str(f, "sex");
  if (sex === "female" || sex === "male") r.sex = sex;
  return r;
}

export async function saveSegmentAction(p: KampanyeState, f: FormData): Promise<KampanyeState> {
  const key = str(f, "key");
  const id = str(f, "id");
  const name = str(f, "name");
  const r = rules(f);
  if (!UUID.test(key) || (id && !UUID.test(id))) return next(p, { error: COPY.ERR_INVALID_INPUT });
  if (name.length < 2) return next(p, { error: "Tulis nama segmen (minimal 2 karakter)." });
  if (!r || Object.keys(r).length === 0) return next(p, { error: "Pilih minimal satu kriteria segmen." });
  return run(p, f, (db) => saveSegment(db, key, { id: id || undefined, name, rules: r }), "Segmen disimpan.");
}
export async function scheduleAction(p: KampanyeState, f: FormData): Promise<KampanyeState> {
  const [key, campaign, segment, template, date] = ["key", "campaign", "segment", "template", "date"].map((k) => str(f, k));
  if (![key, campaign, segment, template].every((x) => UUID.test(x)) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return next(p, { error: "Pilih segmen, templat dan tanggal." });
  return run(p, f, (db) => scheduleCampaign(db, key, campaign, { segmentId: segment, templateId: template, scheduledFor: date }), "Kampanye dijadwalkan.", "dijadwalkan");
}
export async function unscheduleAction(p: KampanyeState, f: FormData): Promise<KampanyeState> {
  const key = str(f, "key");
  const campaign = str(f, "campaign");
  const to = str(f, "to");
  if (!UUID.test(key) || !UUID.test(campaign) || (to !== "draft" && to !== "cancelled")) return next(p, { error: COPY.ERR_INVALID_INPUT });
  return run(p, f, (db) => unscheduleCampaign(db, key, campaign, to), to === "draft" ? "Kampanye dikembalikan ke draf." : "Kampanye dibatalkan.",
    to === "draft" ? "draf" : "dibatalkan");
}
export async function sendAction(p: KampanyeState, f: FormData): Promise<KampanyeState> {
  const key = str(f, "key");
  const campaign = str(f, "campaign");
  if (!UUID.test(key) || !UUID.test(campaign)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  // Sol 75a1a20a P2: the send result (counts only — no member identity) goes to the notice: queued and excluded at send.
  return run(p, f, (db) => sendCampaign(db, key, campaign), "Kampanye diproses.",
    sentQuery);
}
