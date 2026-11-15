"use server";
// Pesan actions (UX-17; T-090): Balas, Pilih Template, Tugaskan, Ambil, Arahkan ke Cabang, Selesai / Buka Lagi; Templat: Simpan Draf,
// Sinkronkan dari Meta. Each refuses a form rendered in another context first (HYG-009 B2-1), carries the form's idempotency key where the
// command is keyed (rotated after every answer: n) and lets the database decide authority, the 24 h window and consent (DEC-102).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { saveTemplate, sendInboxMessage, syncTemplates, updateConversation } from "../../../modules/messaging/inbox/inbox";
import { STALE_CONTEXT, staleContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { GoLiveBlockedError } from "../../../modules/vendor/profile/profile";

export type PesanState = { error?: string; ok?: string; n?: number; values?: Record<string, string> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Peran ini tidak dapat melakukan aksi ini.",
  ERR_NOT_FOUND: "Percakapan tidak ditemukan. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Data sudah diubah orang lain. Muat ulang lalu coba lagi.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
  ERR_TENANT_SUSPENDED: "Klinik sedang tidak dapat mengirim pesan ini.",
  ERR_IDEMPOTENCY_CONFLICT: "Pesan ini sudah dikirim dengan isi lain. Muat ulang halaman.",
  ERR_NOT_AVAILABLE: "Koneksi WhatsApp belum tersedia di lingkungan ini.",
};
const REASON: Record<string, string> = {
  window_closed: "Jendela 24 jam habis — pilih template.",
  template_not_approved: "Template ini belum disetujui Meta.",
  marketing_consent_required: "Pasien tidak setuju promosi. Template promosi tidak dapat dikirim.",
  number_not_sending: "Nomor WhatsApp ini sedang tidak dapat mengirim.",
  already_routed: "Percakapan ini sudah diarahkan ke cabang.",
  "branch not found": "Cabang tidak ditemukan.",
  "staff not found": "Staf tidak ditemukan atau tidak melayani cabang ini.",
  clinical_content: "Template tidak boleh berisi diagnosis, tindakan, obat atau foto.",
  template_name_taken: "Nama template sudah dipakai.",
  no_waba: "Hubungkan WhatsApp Business terlebih dahulu.",
  body: "Tulis pesan (maksimal 4.096 karakter).",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const next = (p: PesanState, s: PesanState): PesanState => ({ ...s, n: (p.n ?? 0) + 1 });
const keep = (f: FormData) => Object.fromEntries([...f.entries()].filter(([k, v]) => typeof v === "string" && !k.startsWith("ctx_") && !k.startsWith("$") && k !== "key")) as Record<string, string>;
const message = (e: unknown) => {
  if (e instanceof GoLiveBlockedError) return "Klinik belum boleh menerima data sungguhan (persyaratan go-live belum lengkap).";
  if (e instanceof CommandError) return REASON[(e as { reason?: string }).reason ?? ""] ?? COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  // never the body or the error text: they may carry message content (W-10)
  console.error("pesan: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.";
};
type Db = Parameters<Parameters<typeof withTenantContext>[2]>[0];
async function run(p: PesanState, f: FormData, fn: (db: Db, key: string) => Promise<unknown>, ok: string, keyed: boolean, path: string, go?: string): Promise<PesanState> {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return next(p, { error: COPY.ERR_FORBIDDEN });
  if (staleContext(f, rc.active.context)) return next(p, { error: STALE_CONTEXT });
  const key = str(f, "key");
  if (keyed && !UUID.test(key)) return next(p, { error: COPY.ERR_INVALID_INPUT, values: keep(f) });
  try {
    await withTenantContext(await appPool(), rc.active.context, (db) => fn(db, key));
  } catch (e) {
    return next(p, { error: message(e), values: keep(f) });
  }
  revalidatePath(path);
  // a form that disappears on success (Ambil, Arahkan) cannot show its own notice: the page shows it from the flag
  if (go) redirect(go);
  return next(p, { ok });
}

export async function replyAction(p: PesanState, f: FormData): Promise<PesanState> {
  const c = str(f, "conversation");
  const body = str(f, "body");
  if (!UUID.test(c)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  if (!body || body.length > 4096) return next(p, { error: REASON.body, values: keep(f) });
  return run(p, f, (db, key) => sendInboxMessage(db, key, c, { kind: "text", body }), "Pesan terkirim.", true, `/pesan/${c}`);
}
export async function templateSendAction(p: PesanState, f: FormData): Promise<PesanState> {
  const c = str(f, "conversation");
  const t = str(f, "template");
  const params = f.getAll("param").map((v) => (typeof v === "string" ? v.trim() : ""));
  if (!UUID.test(c) || !UUID.test(t)) return next(p, { error: "Pilih template." });
  if (params.some((x) => !x || x.length > 200)) return next(p, { error: "Isi semua bagian template.", values: keep(f) });
  return run(p, f, (db, key) => sendInboxMessage(db, key, c, { kind: "template", templateId: t, params }), "Template terkirim.", true, `/pesan/${c}`);
}
export async function conversationAction(p: PesanState, f: FormData): Promise<PesanState> {
  const c = str(f, "conversation");
  const action = str(f, "action");
  const target = str(f, "target");
  if (!UUID.test(c)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  const a =
    action === "assign" && UUID.test(target) ? { action: "assign" as const, staffId: target }
    : action === "unassign" ? { action: "unassign" as const }
    : action === "route" && UUID.test(target) ? { action: "route" as const, branchId: target }
    : action === "close" ? { action: "close" as const }
    : action === "reopen" ? { action: "reopen" as const }
    : null;
  if (!a) return next(p, { error: action === "route" ? "Pilih cabang." : COPY.ERR_INVALID_INPUT });
  return run(p, f, (db) => updateConversation(db, c, a), "", false, `/pesan/${c}`, `/pesan/${c}?ok=${a.action}`);
}
export async function saveTemplateAction(p: PesanState, f: FormData): Promise<PesanState> {
  const name = str(f, "name");
  const category = str(f, "category");
  const body = str(f, "body");
  const params = (body.match(/\{\{\d+\}\}/g) ?? []).length;
  if (!/^[a-z][a-z0-9_]{1,127}$/.test(name)) return next(p, { error: "Nama: huruf kecil, angka dan garis bawah (contoh: pengingat_janji).", values: keep(f) });
  if (!["utility", "marketing", "authentication"].includes(category)) return next(p, { error: "Pilih kategori.", values: keep(f) });
  if (!body || body.length > 1024) return next(p, { error: "Tulis isi template (maksimal 1.024 karakter).", values: keep(f) });
  return run(p, f, (db, key) => saveTemplate(db, key, { name, category, body, paramCount: params }), "Draf template disimpan.", true, "/pesan/templat");
}
export async function syncTemplatesAction(p: PesanState, f: FormData): Promise<PesanState> {
  return run(p, f, (db) => syncTemplates(db), "Template disinkronkan dari Meta.", false, "/pesan/templat");
}
