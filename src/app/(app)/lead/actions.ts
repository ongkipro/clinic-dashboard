"use server";
// Lead actions (UX-18; T-092): Tambah Lead, Ubah Status (next step, Tandai Hilang, Buka Kembali), Penanganan (Ambil, Lepas, Arahkan, Pilih
// Kampanye), Simpan Kampanye. Each refuses a form rendered in another context first (HYG-009 B2-1), carries the form's idempotency key where
// the command is keyed (rotated after every answer: n) and lets the database decide authority and the facts behind each step (DEC-104).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { type CampaignChannel, createLead, type LeadSource, type LostReason, saveCampaign, setLeadStage, updateLead } from "../../../modules/crm/leads/leads";
import { STALE_CONTEXT, staleContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { GoLiveBlockedError } from "../../../modules/vendor/profile/profile";

export type LeadState = { error?: string; ok?: string; n?: number; values?: Record<string, string> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCES = ["walk_in", "phone", "instagram", "tiktok", "website", "referral", "ads", "other"];
const REASONS = ["harga", "jadwal", "lokasi", "tidak_merespons", "memilih_klinik_lain", "tidak_cocok", "duplikat", "lainnya"];
const CHANNELS = ["whatsapp", "instagram", "tiktok", "website", "referral", "ads", "event", "other"];
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Peran ini tidak dapat melakukan aksi ini.",
  ERR_NOT_FOUND: "Lead tidak ditemukan. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Data sudah diubah orang lain. Muat ulang lalu coba lagi.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
  ERR_TENANT_SUSPENDED: "Klinik sedang tidak dapat mengubah lead.",
  ERR_IDEMPOTENCY_CONFLICT: "Isian ini sudah dikirim dengan isi lain. Muat ulang halaman.",
};
const REASON: Record<string, string> = {
  payment_required: "Belum ada pembayaran untuk konversi.",
  appointment_required: "Belum ada janji temu untuk pasien ini. Buat janji di Jadwal lebih dulu.",
  visit_required: "Pasien belum check-in untuk janji ini.",
  match_patient_first: "Cocokkan lead dengan pasien lebih dulu.",
  stage_order: "Tahap ini tidak bisa dilompati.",
  open_lead_exists: "Sudah ada lead terbuka untuk pasien atau percakapan ini.",
  lead_closed: "Lead ini sudah selesai.",
  already_routed: "Lead ini sudah diarahkan ke cabang.",
  lost_reason: "Pilih alasan; untuk Lainnya tulis catatan (minimal 3 karakter).",
  campaign_code_taken: "Kode kampanye sudah dipakai.",
  "branch not found": "Cabang tidak ditemukan.",
  "patient not found": "Pasien tidak ditemukan.",
  "campaign not found": "Kampanye tidak ditemukan atau tidak aktif.",
  contact_name: "Nama kontak 2–120 karakter.",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const next = (p: LeadState, s: LeadState): LeadState => ({ ...s, n: (p.n ?? 0) + 1 });
const keep = (f: FormData) => Object.fromEntries([...f.entries()].filter(([k, v]) => typeof v === "string" && !k.startsWith("ctx_") && !k.startsWith("$") && k !== "key")) as Record<string, string>;
const message = (e: unknown) => {
  if (e instanceof GoLiveBlockedError) return "Klinik belum boleh menerima data sungguhan (persyaratan go-live belum lengkap).";
  if (e instanceof CommandError) return REASON[(e as { reason?: string }).reason ?? ""] ?? COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  console.error("lead: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.";
};
type Db = Parameters<Parameters<typeof withTenantContext>[2]>[0];
async function run<R>(p: LeadState, f: FormData, fn: (db: Db, key: string) => Promise<R>, ok: string, keyed: boolean, path: string, go?: (r: R) => string): Promise<LeadState> {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return next(p, { error: COPY.ERR_FORBIDDEN });
  if (staleContext(f, rc.active.context)) return next(p, { error: STALE_CONTEXT });
  const key = str(f, "key");
  if (keyed && !UUID.test(key)) return next(p, { error: COPY.ERR_INVALID_INPUT, values: keep(f) });
  let r: R;
  try {
    r = await withTenantContext(await appPool(), rc.active.context, (db) => fn(db, key));
  } catch (e) {
    return next(p, { error: message(e), values: keep(f) });
  }
  revalidatePath(path);
  // a form that unmounts on success (the next-step button, Ambil) cannot show its own notice: the page shows it from the flag
  if (go) redirect(go(r));
  return next(p, { ok });
}

export async function createLeadAction(p: LeadState, f: FormData): Promise<LeadState> {
  const source = str(f, "source");
  const name = str(f, "contact_name");
  const phone = str(f, "contact_phone").replace(/[\s-]/g, "");
  const campaign = str(f, "campaign");
  if (!SOURCES.includes(source)) return next(p, { error: "Pilih sumber lead.", values: keep(f) });
  if (name.length < 2 || name.length > 120) return next(p, { error: REASON.contact_name, values: keep(f) });
  if (phone && !/^\+[1-9][0-9]{7,14}$/.test(phone)) return next(p, { error: "Nomor telepon diawali +62, contoh +6281234567890.", values: keep(f) });
  if (campaign && !UUID.test(campaign)) return next(p, { error: COPY.ERR_INVALID_INPUT, values: keep(f) });
  return run(p, f, (db, key) => createLead(db, key, { source: source as LeadSource, contactName: name, contactPhone: phone || undefined, campaignId: campaign || undefined }),
    "", true, "/lead", (r) => `/lead/${r.leadId}?ok=created`);
}
export async function stageAction(p: LeadState, f: FormData): Promise<LeadState> {
  const lead = str(f, "lead");
  const to = str(f, "to");
  if (!UUID.test(lead)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  if (to === "lost") {
    const reason = str(f, "reason");
    const note = str(f, "note");
    if (!REASONS.includes(reason) || (reason === "lainnya" && note.length < 3)) return next(p, { error: REASON.lost_reason, values: keep(f) });
    return run(p, f, (db, key) => setLeadStage(db, key, lead, { to: "lost", reason: reason as LostReason, note: note || undefined }), "", true, `/lead/${lead}`, () => `/lead/${lead}?ok=lost`);
  }
  if (!["contacted", "booked", "arrived", "converted", "new"].includes(to)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  return run(p, f, (db, key) => setLeadStage(db, key, lead, { to } as never), "", true, `/lead/${lead}`, () => `/lead/${lead}?ok=${to}`);
}
export async function leadUpdateAction(p: LeadState, f: FormData): Promise<LeadState> {
  const lead = str(f, "lead");
  const action = str(f, "action");
  const target = str(f, "target");
  if (!UUID.test(lead)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  const u =
    action === "assign" && UUID.test(target) ? { action: "assign" as const, staffId: target }
    : action === "unassign" ? { action: "unassign" as const }
    : action === "route" && UUID.test(target) ? { action: "route" as const, branchId: target }
    : action === "match" && UUID.test(target) ? { action: "match" as const, patientId: target }
    : action === "campaign" ? { action: "campaign" as const, campaignId: UUID.test(target) ? target : null }
    : null;
  if (!u) return next(p, { error: action === "route" ? "Pilih cabang." : COPY.ERR_INVALID_INPUT });
  return run(p, f, (db) => updateLead(db, lead, u), "", false, `/lead/${lead}`, () => `/lead/${lead}?ok=${u.action}`);
}
export async function campaignAction(p: LeadState, f: FormData): Promise<LeadState> {
  const name = str(f, "name");
  const code = str(f, "code").toLowerCase();
  const channel = str(f, "channel");
  if (name.length < 2 || name.length > 120) return next(p, { error: "Nama kampanye 2–120 karakter.", values: keep(f) });
  if (!/^[a-z0-9][a-z0-9_-]{1,40}$/.test(code)) return next(p, { error: "Kode: huruf kecil, angka, garis bawah atau tanda hubung.", values: keep(f) });
  if (!CHANNELS.includes(channel)) return next(p, { error: "Pilih kanal.", values: keep(f) });
  return run(p, f, (db, key) => saveCampaign(db, key, { name, code, channel: channel as CampaignChannel }), "Kampanye disimpan.", true, "/lead");
}
