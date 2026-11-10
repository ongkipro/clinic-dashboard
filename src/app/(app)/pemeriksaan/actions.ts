"use server";
// Pemeriksaan actions (UX-8, PR-10, CLIN-004, CLIN-012; T-052): Mulai Pemeriksaan, Simpan (SOAP, template,
// vitals, ICD-10), Benar / Koreksi of a BC fact, a face-map point and its removal, a plan, a plan item and its
// removal, closing a plan. Each refuses a form rendered in another context first (HYG-009 B2-1), carries the
// form's idempotency key (rotated after every answer: n), and lets the database decide authority and validity.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import {
  addPlanItem, closePlan, createPlan, openExam, removeMark, removePlanItem, saveExam, setMark, verifyFact, type DoseUnit, type MapLayer, type MapTemplate,
} from "../../../modules/clinical/exam/exam";
import { STALE_CONTEXT, staleContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { GoLiveBlockedError } from "../../../modules/vendor/profile/profile";
import { parseDose, SECTION_LABEL, TEMPLATE_FIELDS, VITALS } from "./labels";

export type ExamState = { error?: string; ok?: string; n?: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Hanya dokter cabang ini yang memeriksa, dan hanya dokter pemeriksanya yang mengubah.",
  ERR_NOT_FOUND: "Data tidak ditemukan di cabang ini. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Pemeriksaan, rencana atau kunjungan ini sudah tidak bisa diubah. Muat ulang halaman.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
  ERR_TENANT_SUSPENDED: "Klinik sedang tidak melayani kunjungan.",
  ERR_IDEMPOTENCY_CONFLICT: "Permintaan ini sudah dikirim dengan isi lain. Muat ulang halaman.",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const next = (p: ExamState, s: ExamState): ExamState => ({ ...s, n: (p.n ?? 0) + 1 });
const message = (e: unknown) => {
  if (e instanceof GoLiveBlockedError) return "Klinik belum boleh menerima data pasien sungguhan (persyaratan go-live belum lengkap).";
  if (e instanceof CommandError) return COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  console.error("pemeriksaan: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.";
};

type Db = Parameters<Parameters<typeof withTenantContext>[2]>[0];
async function inContext<T>(f: FormData, fn: (db: Db, key: string) => Promise<T>): Promise<{ value?: T; error?: string }> {
  const key = str(f, "key");
  if (!UUID.test(key)) return { error: COPY.ERR_INVALID_INPUT };
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return { error: COPY.ERR_FORBIDDEN };
  if (staleContext(f, rc.active.context)) return { error: STALE_CONTEXT };
  try {
    return { value: await withTenantContext(await appPool(), rc.active.context, (db) => fn(db, key)) };
  } catch (e) {
    return { error: message(e) };
  }
}
// Every sheet action names the visit (to revalidate) and the examination.
function ids(f: FormData) {
  const visit = str(f, "visit");
  const exam = str(f, "exam");
  return UUID.test(visit) && UUID.test(exam) ? { visit, exam } : null;
}
async function run(p: ExamState, f: FormData, ok: string, fn: (db: Db, key: string, exam: string) => Promise<unknown>): Promise<ExamState> {
  const x = ids(f);
  if (!x) return next(p, { error: COPY.ERR_NOT_FOUND });
  const r = await inContext(f, (db, key) => fn(db, key, x.exam));
  if (r.error) return next(p, { error: r.error });
  revalidatePath(`/pemeriksaan/${x.visit}`);
  return next(p, { ok });
}

export async function openAction(p: ExamState, f: FormData): Promise<ExamState> {
  const visit = str(f, "visit");
  if (!UUID.test(visit)) return next(p, { error: COPY.ERR_NOT_FOUND });
  const r = await inContext(f, (db, key) => openExam(db, key, visit));
  if (r.error) return next(p, { error: r.error });
  revalidatePath("/pemeriksaan");
  redirect(`/pemeriksaan/${visit}`);
}

// The SOAP form: four sections, the template and its fields (`tv_<field>`), vitals (`vital_<key>`, whole
// numbers), ICD-10 codes (`icd`, repeated). Empty values are left out; the database validates the rest.
export async function saveAction(p: ExamState, f: FormData): Promise<ExamState> {
  const payload: Record<string, unknown> = {};
  for (const k of Object.keys(SECTION_LABEL)) payload[k] = str(f, k) || null;
  const tpl = str(f, "template_key");
  payload.template_key = tpl || null;
  const values: Record<string, string> = {};
  for (const field of TEMPLATE_FIELDS[tpl] ?? []) {
    const v = str(f, `tv_${field.key}`);
    if (v) values[field.key] = v;
  }
  payload.template_values = values;
  const vitals: Record<string, number> = {};
  for (const v of VITALS) {
    const raw = str(f, `vital_${v.key}`);
    if (!raw) continue;
    if (!/^\d{1,4}$/.test(raw)) return next(p, { error: "Tanda vital diisi angka bulat." });
    vitals[v.key] = Number(raw);
  }
  payload.vitals = vitals;
  payload.icd10_codes = f.getAll("icd").filter((c): c is string => typeof c === "string" && c !== "");
  return run(p, f, "Pemeriksaan tersimpan.", (db, key, exam) => saveExam(db, key, exam, payload));
}

export async function verifyAction(p: ExamState, f: FormData): Promise<ExamState> {
  const fact = str(f, "fact");
  const decision = str(f, "decision");
  if (!UUID.test(fact) || (decision !== "confirmed" && decision !== "corrected")) return next(p, { error: COPY.ERR_INVALID_INPUT });
  const value = decision === "corrected" ? str(f, "value") : null;
  if (decision === "corrected" && !value) return next(p, { error: "Tulis koreksinya." });
  return run(p, f, decision === "confirmed" ? "Ditandai benar." : "Koreksi tersimpan.", (db, key, exam) => verifyFact(db, key, exam, fact, decision, value));
}

export async function markAction(p: ExamState, f: FormData): Promise<ExamState> {
  const x = Number(str(f, "x"));
  const y = Number(str(f, "y"));
  if (!/^\d{1,4}$/.test(str(f, "x")) || !/^\d{1,4}$/.test(str(f, "y")) || x > 1000 || y > 1000) return next(p, { error: "Pilih titik pada peta." });
  const layer = str(f, "layer") as MapLayer;
  const mark: Parameters<typeof setMark>[3] = { template: str(f, "template") as MapTemplate, layer, x, y, label: str(f, "label") };
  if (!mark.label) return next(p, { error: "Tulis keterangan titik." });
  if (layer === "tindakan") {
    const dose = parseDose(str(f, "dose"));
    if (dose === null) return next(p, { error: "Dosis titik tindakan diisi angka (mis. 4 atau 0,5)." });
    mark.dose_micro = dose;
    mark.dose_unit = str(f, "dose_unit") as DoseUnit;
    const version = str(f, "version");
    if (UUID.test(version)) mark.catalog_version_id = version;
  }
  return run(p, f, "Titik tersimpan.", (db, key, exam) => setMark(db, key, exam, mark));
}

export async function removeMarkAction(p: ExamState, f: FormData): Promise<ExamState> {
  const mark = str(f, "mark");
  if (!UUID.test(mark)) return next(p, { error: COPY.ERR_NOT_FOUND });
  return run(p, f, "Titik dihapus.", (db, key, exam) => removeMark(db, key, exam, mark));
}

export async function planAction(p: ExamState, f: FormData): Promise<ExamState> {
  const title = str(f, "title");
  const condition = str(f, "condition");
  if (title.length < 3 || condition.length < 3) return next(p, { error: "Isi nama rencana dan kondisi (minimal 3 huruf)." });
  return run(p, f, "Rencana dibuat.", (db, key, exam) => createPlan(db, key, exam, title, condition));
}

export async function itemAction(p: ExamState, f: FormData): Promise<ExamState> {
  const plan = str(f, "plan");
  const version = str(f, "version");
  if (!UUID.test(plan) || !UUID.test(version)) return next(p, { error: "Pilih item katalog." });
  if (!/^\d{1,2}$/.test(str(f, "stage")) || !/^\d{1,4}$/.test(str(f, "qty"))) return next(p, { error: "Tahap dan jumlah diisi angka bulat." });
  const item: Parameters<typeof addPlanItem>[4] = { stage: Number(str(f, "stage")), catalog_version_id: version, qty: Number(str(f, "qty")) };
  const doseText = str(f, "dose");
  if (doseText) {
    const dose = parseDose(doseText);
    if (dose === null) return next(p, { error: "Dosis diisi angka (mis. 4 atau 0,5)." });
    item.dose_micro = dose;
    item.dose_unit = str(f, "dose_unit") as DoseUnit;
  }
  const note = str(f, "note");
  if (note) item.note = note;
  return run(p, f, "Item ditambahkan.", (db, key, exam) => addPlanItem(db, key, exam, plan, item));
}

export async function removeItemAction(p: ExamState, f: FormData): Promise<ExamState> {
  const item = str(f, "item");
  if (!UUID.test(item)) return next(p, { error: COPY.ERR_NOT_FOUND });
  return run(p, f, "Item dihapus dari rencana.", (db, key, exam) => removePlanItem(db, key, exam, item));
}

export async function closePlanAction(p: ExamState, f: FormData): Promise<ExamState> {
  const plan = str(f, "plan");
  const state = str(f, "state");
  if (!UUID.test(plan) || (state !== "completed" && state !== "stopped")) return next(p, { error: COPY.ERR_INVALID_INPUT });
  return run(p, f, state === "completed" ? "Rencana selesai." : "Rencana dihentikan.", (db, key, exam) => closePlan(db, key, exam, plan, state));
}
