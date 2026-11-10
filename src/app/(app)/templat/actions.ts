"use server";
// Templat Dokumen and Surat actions (UX-54, PR-74; T-058): Simpan Versi, Pensiunkan, Buat Surat, Simpan Draf and
// Koreksi. Each refuses a form rendered in another context first (HYG-009 B2-1), carries the form's idempotency key
// (rotated after every answer: n), and lets the database decide authority and validity. Signing is not here: it
// needs the second-factor step-up whose producer arrives with the clinical signing UI (T-053).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import {
  correctLetter, createLetter, type LetterType, type Paper, retireTemplate, saveLetter, saveTemplate, type TemplateKind,
} from "../../../modules/documents/documents";
import { STALE_CONTEXT, staleContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { GoLiveBlockedError } from "../../../modules/vendor/profile/profile";
import { KIND_LABEL, LETTER_TYPE_LABEL, PAPER_LABEL } from "./labels";

export type DocFormState = { error?: string; ok?: string; n?: number; id?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Peran ini tidak dapat mengubah dokumen ini.",
  ERR_NOT_FOUND: "Dokumen tidak ditemukan. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Dokumen sudah berubah. Muat ulang halaman untuk melihat keadaan terbaru.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
  ERR_TENANT_SUSPENDED: "Klinik sedang tidak dapat mengubah dokumen.",
  ERR_IDEMPOTENCY_CONFLICT: "Permintaan ini sudah dikirim dengan isi lain. Muat ulang halaman.",
};
const REASON: Record<string, string> = {
  missing_placeholder: "Isian wajib belum ada di templat. Tambahkan semua isian bertanda wajib.",
  unknown_placeholder: "Ada isian yang tidak dikenal. Gunakan isian dari daftar.",
  malformed_placeholder: "Penulisan isian tidak tepat. Tulis seperti {{pasien.nama}}, tanpa spasi.",
  patient_data_in_template: "Templat tidak boleh memuat data pasien (nomor RM atau NIK). Gunakan isian.",
  template_retired: "Templat ini sudah dipensiunkan.",
  paper: "Ukuran kertas 58/80 mm hanya untuk struk.",
  unresolved_placeholder: "Masih ada isian yang belum terisi. Ganti teks {{…}} dengan isi surat.",
  visit_closed: "Kunjungan sudah ditutup sebelum hari ini.",
  no_change: "Isi koreksi sama dengan versi sekarang.",
  correction_pending: "Masih ada koreksi yang menunggu persetujuan.",
  signed: "Surat sudah ditandatangani; ubah dengan koreksi.",
  not_signed: "Surat belum ditandatangani.",
  "only the examining doctor writes a letter for this visit": "Surat untuk kunjungan ini dibuat oleh dokter yang memeriksa.",
  "only the doctor who wrote the letter changes it": "Hanya dokter penulis yang dapat mengubah surat ini.",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const raw = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string) : "");
const next = (p: DocFormState, s: DocFormState): DocFormState => ({ ...s, n: (p.n ?? 0) + 1 });
const message = (e: unknown) => {
  if (e instanceof GoLiveBlockedError) return "Klinik belum boleh menerima data pasien sungguhan (persyaratan go-live belum lengkap).";
  if (e instanceof CommandError) return REASON[(e as { reason?: string }).reason ?? ""] ?? COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  console.error("templat: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.";
};
type Db = Parameters<Parameters<typeof withTenantContext>[2]>[0];
async function run<R>(p: DocFormState, f: FormData, ok: string, fn: (db: Db, key: string) => Promise<R>, id?: (r: R) => string): Promise<DocFormState> {
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
  revalidatePath("/templat", "layout");
  return next(p, { ok, ...(id ? { id: id(r) } : {}) });
}

// Simpan Versi: a new template (kind, name, letter type) or a new version of `template`.
export async function saveTemplateAction(p: DocFormState, f: FormData): Promise<DocFormState> {
  const template = str(f, "template");
  const body = raw(f, "body");
  const paper = str(f, "paper") as Paper;
  if (template && !UUID.test(template)) return next(p, { error: COPY.ERR_NOT_FOUND });
  if (body.trim().length < 10) return next(p, { error: "Tulis isi templat (minimal 10 huruf)." });
  if (!(paper in PAPER_LABEL)) return next(p, { error: "Pilih ukuran kertas." });
  if (template) return run(p, f, "Versi baru tersimpan dan kini dipakai.", (db, key) => saveTemplate(db, key, template, { body, paper }), (r) => r.templateId);
  const kind = str(f, "kind") as TemplateKind;
  const name = str(f, "name");
  const letterType = str(f, "letter_type") as LetterType;
  if (!(kind in KIND_LABEL)) return next(p, { error: "Pilih jenis templat." });
  if (name.length < 3) return next(p, { error: "Tulis nama templat (minimal 3 huruf)." });
  if (kind === "letter" && !(letterType in LETTER_TYPE_LABEL)) return next(p, { error: "Pilih jenis surat." });
  return run(p, f, "Templat tersimpan.", (db, key) => saveTemplate(db, key, null, { kind, name, body, paper, ...(kind === "letter" ? { letterType } : {}) }),
    (r) => r.templateId);
}

export async function retireTemplateAction(p: DocFormState, f: FormData): Promise<DocFormState> {
  const template = str(f, "template");
  if (!UUID.test(template)) return next(p, { error: COPY.ERR_NOT_FOUND });
  return run(p, f, "Templat dipensiunkan; surat yang sudah dibuat tetap tersimpan.", (db, key) => retireTemplate(db, key, template));
}

export async function createLetterAction(p: DocFormState, f: FormData): Promise<DocFormState> {
  const visit = str(f, "visit");
  const version = str(f, "template_version");
  if (!UUID.test(visit)) return next(p, { error: "Pilih pasien dari kunjungan hari ini." });
  if (!UUID.test(version)) return next(p, { error: "Pilih templat surat." });
  return run(p, f, "Draf surat dibuat.", (db, key) => createLetter(db, key, visit, version), (r) => r.letterId);
}

export async function saveLetterAction(p: DocFormState, f: FormData): Promise<DocFormState> {
  const letter = str(f, "letter");
  const body = raw(f, "body");
  if (!UUID.test(letter)) return next(p, { error: COPY.ERR_NOT_FOUND });
  if (body.trim().length < 10) return next(p, { error: "Isi surat minimal 10 huruf." });
  return run(p, f, "Draf tersimpan.", (db, key) => saveLetter(db, key, letter, body));
}

export async function correctLetterAction(p: DocFormState, f: FormData): Promise<DocFormState> {
  const letter = str(f, "letter");
  const body = raw(f, "body");
  const reason = str(f, "reason");
  if (!UUID.test(letter)) return next(p, { error: COPY.ERR_NOT_FOUND });
  if (body.trim().length < 10) return next(p, { error: "Isi surat minimal 10 huruf." });
  if (reason.length < 3) return next(p, { error: "Tulis alasan koreksi (minimal 3 huruf)." });
  const s = await run(p, f, "Koreksi tersimpan sebagai versi baru.", (db, key) => correctLetter(db, key, letter, body, reason), (r) => r.kind);
  // After 48 hours the correction waits for the record-correction approval (records officer or facility head).
  return s.id === "pending" ? { ...s, ok: "Koreksi dikirim untuk persetujuan petugas rekam medis atau penanggung jawab klinik." } : s;
}
