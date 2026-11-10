"use server";
// Persetujuan Tindakan actions (UX-39, PR-11, CLIN-022; T-054): Tanda Tangani (the patient's or guardian's
// signature over the text shown), Tarik Persetujuan, and the examining doctor's contraindication review. Each
// refuses a form rendered in another context first (HYG-009 B2-1), carries the form's idempotency key (rotated
// after every answer: n), and lets the database decide authority and validity.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { captureConsent, type GuardianRelation, reviewContraindication, withdrawConsent } from "../../../modules/clinical/consent/consent";
import { STALE_CONTEXT, staleContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { GoLiveBlockedError } from "../../../modules/vendor/profile/profile";

export type ConsentFormState = { error?: string; ok?: string; n?: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Hanya dokter atau perawat cabang ini yang mencatat persetujuan tindakan.",
  ERR_NOT_FOUND: "Data tidak ditemukan di cabang ini. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Rencana atau kunjungan sudah berubah. Muat ulang halaman, lalu bacakan teks yang baru.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
  ERR_TENANT_SUSPENDED: "Klinik sedang tidak melayani kunjungan.",
  ERR_IDEMPOTENCY_CONFLICT: "Permintaan ini sudah dikirim dengan isi lain. Muat ulang halaman.",
};
const REASON: Record<string, string> = {
  plan_changed: "Rencana berubah setelah teks ditampilkan. Muat ulang halaman dan bacakan teks yang baru sebelum tanda tangan.",
  guardian_required: "Pasien di bawah 18 tahun atau bayi: persetujuan ditandatangani wali.",
  signature: "Tanda tangan belum terbaca. Minta pasien menandatangani di kotak, lalu simpan lagi.",
  empty_plan: "Rencana belum berisi item.",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const next = (p: ConsentFormState, s: ConsentFormState): ConsentFormState => ({ ...s, n: (p.n ?? 0) + 1 });
const message = (e: unknown) => {
  if (e instanceof GoLiveBlockedError) return "Klinik belum boleh menerima data pasien sungguhan (persyaratan go-live belum lengkap).";
  if (e instanceof CommandError) return REASON[(e as { reason?: string }).reason ?? ""] ?? COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  console.error("persetujuan-tindakan: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.";
};
type Db = Parameters<Parameters<typeof withTenantContext>[2]>[0];
async function run(p: ConsentFormState, f: FormData, ok: string, fn: (db: Db, key: string) => Promise<unknown>): Promise<ConsentFormState> {
  const key = str(f, "key");
  const visit = str(f, "visit");
  if (!UUID.test(key) || !UUID.test(visit)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return next(p, { error: COPY.ERR_FORBIDDEN });
  if (staleContext(f, rc.active.context)) return next(p, { error: STALE_CONTEXT });
  try {
    await withTenantContext(await appPool(), rc.active.context, (db) => fn(db, key));
  } catch (e) {
    return next(p, { error: message(e) });
  }
  revalidatePath(`/persetujuan-tindakan/${visit}`);
  revalidatePath("/persetujuan-tindakan");
  return next(p, { ok });
}

// The signature arrives as a PNG data URL from the pad; the bytes are checked here and by the database.
export async function captureAction(p: ConsentFormState, f: FormData): Promise<ConsentFormState> {
  const plan = str(f, "plan");
  const hash = str(f, "hash");
  const sig = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(str(f, "signature"));
  if (!UUID.test(plan) || !/^[0-9a-f]{64}$/.test(hash)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  if (!sig) return next(p, { error: REASON.signature });
  const signer = str(f, "signer") === "guardian" ? "guardian" : "patient";
  return run(p, f, "Persetujuan tercatat.", (db, key) => captureConsent(db, key, {
    visitId: str(f, "visit"), planId: plan, signer, expectedHash: hash, signature: Buffer.from(sig[1], "base64"),
    ...(signer === "guardian" ? { guardianName: str(f, "guardian_name"), guardianRelation: str(f, "guardian_relation") as GuardianRelation } : {}),
  }));
}

export async function withdrawAction(p: ConsentFormState, f: FormData): Promise<ConsentFormState> {
  const consent = str(f, "consent");
  const reason = str(f, "reason");
  if (!UUID.test(consent)) return next(p, { error: COPY.ERR_NOT_FOUND });
  if (reason.length < 3) return next(p, { error: "Tulis alasan penarikan (minimal 3 huruf)." });
  return run(p, f, "Persetujuan ditarik.", (db, key) => withdrawConsent(db, key, consent, reason));
}

export async function reviewAction(p: ConsentFormState, f: FormData): Promise<ConsentFormState> {
  const exam = str(f, "exam");
  const item = str(f, "item");
  const decision = str(f, "decision");
  if (!UUID.test(exam) || !UUID.test(item) || (decision !== "cleared" && decision !== "blocked")) return next(p, { error: COPY.ERR_INVALID_INPUT });
  const reason = str(f, "reason") || null;
  if (decision === "blocked" && !reason) return next(p, { error: "Tulis alasan kontraindikasi." });
  return run(p, f, decision === "cleared" ? "Kontraindikasi dinyatakan aman." : "Item ditahan karena kontraindikasi.",
    (db, key) => reviewContraindication(db, key, exam, item, decision, reason));
}
