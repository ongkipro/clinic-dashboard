"use server";
// Keluhan actions (UX-28, PR-43, CLIN-016, CLIN-024; T-057): Laporkan Keluhan, Tangani, Ubah Triase, Catatan,
// Selesaikan and Buka Kembali. Each refuses a form rendered in another context first (HYG-009 B2-1), carries the
// form's idempotency key (rotated after every answer: n), and lets the database decide authority and validity.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import {
  type ComplaintKind, type ComplaintSource, flagComplaint, noteComplaint, type Outcome, reopenComplaint, resolveComplaint, type ServiceCategory, takeComplaint,
  type Triage, triageComplaint,
} from "../../../modules/clinical/complaints/complaints";
import { STALE_CONTEXT, staleContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { GoLiveBlockedError } from "../../../modules/vendor/profile/profile";
import { CATEGORY_LABEL, OUTCOME_LABEL, TRIAGE } from "./labels";

export type ComplaintFormState = { error?: string; ok?: string; n?: number; taskId?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Peran ini tidak dapat mengubah keluhan ini.",
  ERR_NOT_FOUND: "Keluhan, pasien, atau kunjungan tidak ditemukan di cabang ini. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Keluhan sudah berubah. Muat ulang halaman untuk melihat keadaan terbaru.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
  ERR_TENANT_SUSPENDED: "Klinik sedang tidak melayani kunjungan.",
  ERR_IDEMPOTENCY_CONFLICT: "Permintaan ini sudah dikirim dengan isi lain. Muat ulang halaman.",
};
const REASON: Record<string, string> = {
  already_taken: "Keluhan ini sudah ditangani staf lain. Muat ulang halaman.",
  resolved: "Keluhan ini sudah selesai.",
  not_resolved: "Keluhan ini belum selesai.",
  message_source_not_ready: "Keluhan dari pesan pasien belum tersedia.",
  "role may not raise this complaint": "Peran ini tidak dapat melaporkan keluhan jenis ini.",
  "complaint for another branch": "Keluhan hanya dapat dilaporkan untuk cabang aktif.",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const next = (p: ComplaintFormState, s: ComplaintFormState): ComplaintFormState => ({ ...s, n: (p.n ?? 0) + 1 });
const message = (e: unknown) => {
  if (e instanceof GoLiveBlockedError) return "Klinik belum boleh menerima data pasien sungguhan (persyaratan go-live belum lengkap).";
  if (e instanceof CommandError) return REASON[(e as { reason?: string }).reason ?? ""] ?? COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  console.error("keluhan: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.";
};
type Db = Parameters<Parameters<typeof withTenantContext>[2]>[0];
async function run<R>(p: ComplaintFormState, f: FormData, ok: string, fn: (db: Db, key: string) => Promise<R>, task?: (r: R) => string): Promise<ComplaintFormState> {
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
  revalidatePath("/keluhan", "layout");
  return next(p, { ok, ...(task ? { taskId: task(r) } : {}) });
}

// Laporkan Keluhan: a patient (from today's visit list) or a visit; klinis with triage, layanan with a category.
export async function flagAction(p: ComplaintFormState, f: FormData): Promise<ComplaintFormState> {
  const target = str(f, "target"); // "<patient>:<visit>"
  const [patientId, visitId] = target.split(":");
  const kind = str(f, "kind") as ComplaintKind;
  const summary = str(f, "summary");
  const branch = str(f, "branch");
  if (!UUID.test(patientId ?? "") || !UUID.test(visitId ?? "")) return next(p, { error: "Pilih pasien dari kunjungan hari ini." });
  if (kind !== "klinis" && kind !== "layanan") return next(p, { error: "Pilih jenis keluhan." });
  if (summary.length < 3) return next(p, { error: "Tulis ringkasan keluhan (minimal 3 huruf)." });
  const triage = str(f, "triage");
  const category = str(f, "category");
  if (kind === "klinis" && !(triage in TRIAGE)) return next(p, { error: "Pilih triase." });
  if (kind === "layanan" && !(category in CATEGORY_LABEL)) return next(p, { error: "Pilih kategori keluhan layanan." });
  const source: ComplaintSource = str(f, "source") === "pharmacist" ? "pharmacist" : "visit_note";
  return run(p, f, "Keluhan dilaporkan.", (db, key) => flagComplaint(db, key, {
    patientId, visitId, kind, source, summary,
    ...(kind === "klinis" ? { triage: triage as Triage } : { category: category as ServiceCategory }),
    ...(UUID.test(branch) ? { branchId: branch } : {}),
  }), (r) => r.taskId);
}

function task(f: FormData) {
  const t = str(f, "task");
  return UUID.test(t) ? t : null;
}
export async function takeAction(p: ComplaintFormState, f: FormData): Promise<ComplaintFormState> {
  const t = task(f);
  if (!t) return next(p, { error: COPY.ERR_NOT_FOUND });
  return run(p, f, "Keluhan Anda tangani.", (db, key) => takeComplaint(db, key, t));
}
export async function triageAction(p: ComplaintFormState, f: FormData): Promise<ComplaintFormState> {
  const t = task(f);
  const triage = str(f, "triage");
  if (!t) return next(p, { error: COPY.ERR_NOT_FOUND });
  if (!(triage in TRIAGE)) return next(p, { error: "Pilih triase." });
  return run(p, f, "Triase diperbarui; target waktu dihitung ulang.", (db, key) => triageComplaint(db, key, t, triage as Triage));
}
export async function noteAction(p: ComplaintFormState, f: FormData): Promise<ComplaintFormState> {
  const t = task(f);
  const note = str(f, "note");
  if (!t) return next(p, { error: COPY.ERR_NOT_FOUND });
  if (note.length < 3) return next(p, { error: "Tulis catatan (minimal 3 huruf)." });
  return run(p, f, "Catatan tersimpan.", (db, key) => noteComplaint(db, key, t, note));
}
export async function resolveAction(p: ComplaintFormState, f: FormData): Promise<ComplaintFormState> {
  const t = task(f);
  const outcome = str(f, "outcome");
  const note = str(f, "note");
  if (!t) return next(p, { error: COPY.ERR_NOT_FOUND });
  if (!(outcome in OUTCOME_LABEL)) return next(p, { error: "Pilih hasil penanganan." });
  if (note.length < 3) return next(p, { error: "Tulis catatan penyelesaian (minimal 3 huruf)." });
  return run(p, f, "Keluhan diselesaikan.", (db, key) => resolveComplaint(db, key, t, outcome as Outcome, note));
}
export async function reopenAction(p: ComplaintFormState, f: FormData): Promise<ComplaintFormState> {
  const t = task(f);
  const note = str(f, "note");
  if (!t) return next(p, { error: COPY.ERR_NOT_FOUND });
  if (note.length < 3) return next(p, { error: "Tulis alasan membuka kembali (minimal 3 huruf)." });
  return run(p, f, "Keluhan dibuka kembali.", (db, key) => reopenComplaint(db, key, t, note));
}
