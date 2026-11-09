"use server";
// Privasi actions (UX-30 ▸ Privasi, PR-92, T-039): Terbitkan Versi Baru (consent text, T-038's writer),
// Tambah / Ubah / Nonaktifkan pemroses, Catat Kebocoran, Nilai, Simpulkan, Tutup, Tambah Pemberitahuan
// (with its evidence file). Each refuses a form rendered in another context first (HYG-009 B2-1); the
// database decides who may (the privacy officers). Every write carries the form's per-mount key.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { MAX_BYTES } from "../../../modules/compliance/compliance";
import { STALE_CONTEXT, staleContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { publishConsentText } from "../../../modules/patients/consents/consents";
import {
  addNotice, assessBreach, closeBreach, concludeBreach, NoticeFileError, recordBreach, saveProcessor, setProcessorActive,
} from "../../../modules/privacy/privacy";

export type PrivState = { error?: string; ok?: string; values?: Record<string, string>; n?: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PURPOSES = ["care_notice", "clinical_photo", "marketing_wa", "publication"];
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Hanya Owner atau pemegang tugas pelindungan data yang dapat mengubah ini.",
  ERR_NOT_FOUND: "Data tidak ditemukan. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Data sudah berubah. Muat ulang halaman.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
  ERR_TENANT_SUSPENDED: "Klinik sedang tidak dapat mengubah ini.",
  ERR_IDEMPOTENCY_CONFLICT: "Permintaan ini sudah dikirim dengan isi lain. Muat ulang halaman.",
  not_open: "Kebocoran ini sudah dinilai.",
  not_assessed: "Nilai kebocoran ini dulu.",
  not_concluded: "Simpulkan dulu: diberitahukan atau tidak wajib diberitahukan.",
  notice_required: "Tambahkan bukti pemberitahuan sebelum menandai diberitahukan.",
  reason: "Tulis alasan tidak wajib diberitahukan (10–1000 huruf).",
  breach: "Isi waktu diketahui (tidak di masa depan), uraian (10–2000 huruf) dan kategori data.",
  notice: "Isi penerima, waktu kirim (setelah diketahui, tidak di masa depan), saluran dan ringkasan isi (10–2000 huruf).",
  processor: "Lengkapi nama, layanan, kategori data dan lokasi; pemroses lintas negara wajib punya dasar transfer.",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const done = (prev: PrivState, s: PrivState): PrivState => ({ ...s, n: (prev.n ?? 0) + 1 });
const keep = (f: FormData) => Object.fromEntries([...f.entries()].filter(([k, v]) => typeof v === "string" && !k.startsWith("ctx_") && !k.startsWith("$") && k !== "key")) as Record<string, string>;
const message = (e: unknown) => {
  if (e instanceof NoticeFileError) return e.message === "file missing, too large or checksum mismatch" ? "Berkas tidak dapat dibaca. Unggah ulang." : e.message.startsWith("only") ? "Berkas harus PDF, PNG atau JPEG." : e.message;
  if (e instanceof CommandError) return COPY[(e as { reason?: string }).reason ?? ""] ?? COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  console.error("privasi: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.";
};
// datetime-local values are Jakarta wall time (the page shows WIB).
const wib = (v: string) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? new Date(`${v}:00+07:00`) : null);

async function write(prev: PrivState, f: FormData, work: (db: Parameters<Parameters<typeof withTenantContext>[2]>[0], key: string) => Promise<unknown>, ok: string) {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return done(prev, { error: COPY.ERR_FORBIDDEN });
  if (staleContext(f, rc.active.context)) return done(prev, { error: STALE_CONTEXT });
  const key = str(f, "key");
  if (!UUID.test(key)) return done(prev, { error: COPY.ERR_VERSION_CONFLICT, values: keep(f) });
  try {
    await withTenantContext(await appPool(), rc.active.context, (db) => work(db, key));
  } catch (e) {
    return done(prev, { error: message(e), values: keep(f) });
  }
  revalidatePath("/privasi");
  return done(prev, { ok });
}

export async function publishTextAction(prev: PrivState, f: FormData): Promise<PrivState> {
  const purpose = str(f, "purpose");
  const body = str(f, "body");
  if (!PURPOSES.includes(purpose) || body.length < 10 || body.length > 5000) return done(prev, { error: "Pilih jenis persetujuan dan tulis teksnya (10–5000 huruf).", values: keep(f) });
  return write(prev, f, (db) => publishConsentText(db, { purpose: purpose as never, body }), "Versi baru diterbitkan.");
}

export async function processorAction(prev: PrivState, f: FormData): Promise<PrivState> {
  const id = str(f, "id");
  const role = str(f, "role");
  if (id && !UUID.test(id)) return done(prev, { error: COPY.ERR_NOT_FOUND });
  if (role !== "processor" && role !== "sub_processor") return done(prev, { error: COPY.processor, values: keep(f) });
  const cross = f.get("cross_border") === "on";
  return write(prev, f, (db, key) => saveProcessor(db, key, id || null, {
    name: str(f, "name"), service: str(f, "service"), data_categories: str(f, "data_categories"), location: str(f, "location"), role,
    cross_border: cross, transfer_basis: cross ? str(f, "transfer_basis") : null, agreement_ref: str(f, "agreement_ref") || null,
  }), id ? "Pemroses diperbarui." : "Pemroses ditambahkan.");
}

export async function processorActiveAction(prev: PrivState, f: FormData): Promise<PrivState> {
  const id = str(f, "id");
  if (!UUID.test(id)) return done(prev, { error: COPY.ERR_NOT_FOUND });
  const active = str(f, "active") === "true";
  return write(prev, f, (db, key) => setProcessorActive(db, key, id, active), active ? "Pemroses diaktifkan." : "Pemroses dinonaktifkan.");
}

export async function recordBreachAction(prev: PrivState, f: FormData): Promise<PrivState> {
  const aware = wib(str(f, "aware_at"));
  const affected = str(f, "affected_count");
  const count = affected === "" ? null : Number(affected);
  if (!aware || (count !== null && (!Number.isInteger(count) || count < 0))) return done(prev, { error: COPY.breach, values: keep(f) });
  return write(prev, f, (db, key) => recordBreach(db, key, { awareAt: aware, description: str(f, "description"), affectedCount: count, dataCategories: str(f, "data_categories") }), "Kebocoran dicatat. Batas 3×24 jam berjalan dari waktu diketahui.");
}

export async function assessAction(prev: PrivState, f: FormData): Promise<PrivState> {
  const id = str(f, "id");
  if (!UUID.test(id)) return done(prev, { error: COPY.ERR_NOT_FOUND });
  return write(prev, f, (db, key) => assessBreach(db, key, id), "Kebocoran dinilai.");
}

export async function concludeAction(prev: PrivState, f: FormData): Promise<PrivState> {
  const id = str(f, "id");
  const notifiable = str(f, "notifiable");
  if (!UUID.test(id) || (notifiable !== "yes" && notifiable !== "no")) return done(prev, { error: COPY.ERR_NOT_FOUND });
  return write(prev, f, (db, key) => concludeBreach(db, key, id, notifiable === "yes", notifiable === "yes" ? null : str(f, "reason")),
    notifiable === "yes" ? "Ditandai diberitahukan." : "Ditandai tidak wajib diberitahukan.");
}

export async function closeAction(prev: PrivState, f: FormData): Promise<PrivState> {
  const id = str(f, "id");
  if (!UUID.test(id)) return done(prev, { error: COPY.ERR_NOT_FOUND });
  return write(prev, f, (db, key) => closeBreach(db, key, id), "Kebocoran ditutup.");
}

export async function noticeAction(prev: PrivState, f: FormData): Promise<PrivState> {
  const id = str(f, "id");
  const kind = str(f, "recipient_kind");
  const sent = wib(str(f, "sent_at"));
  const file = f.get("file");
  if (!UUID.test(id)) return done(prev, { error: COPY.ERR_NOT_FOUND });
  if (!["data_subjects", "authority", "other"].includes(kind) || !sent) return done(prev, { error: COPY.notice, values: keep(f) });
  if (!(file instanceof File) || file.size === 0) return done(prev, { error: "Pilih berkas bukti (PDF, PNG atau JPEG).", values: keep(f) });
  if (file.size > MAX_BYTES) return done(prev, { error: "Berkas lebih dari 5 MB.", values: keep(f) });
  const content = Buffer.from(await file.arrayBuffer());
  return write(prev, f, (db, key) => addNotice(db, key, id, {
    recipientKind: kind as never, recipient: str(f, "recipient"), sentAt: sent, channel: str(f, "channel"), contentSummary: str(f, "content_summary"), fileName: file.name, content,
  }), "Bukti pemberitahuan disimpan.");
}
