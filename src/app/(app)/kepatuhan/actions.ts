"use server";
// Kepatuhan actions (UX-58, PR-97): Unggah Bukti (a new file version) and Setujui / Tolak /
// Cabut on the newest version. The compliance functions refuse roles outside 07, the
// uploader deciding their own file, and other tenants' items.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { decideEvidence, EvidenceFileError, MAX_BYTES, uploadEvidence } from "../../../modules/compliance/compliance";
import { STALE_CONTEXT, staleContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";

export type EvidenceState = { error?: string; ok?: string };

const MESSAGES: Record<string, string> = {
  ERR_FORBIDDEN: "Anda tidak punya akses untuk bukti ini.",
  ERR_INVALID_INPUT: "Isian belum lengkap atau tanggalnya tidak sesuai.",
  ERR_INVALID_FILE: "Berkas harus PDF, PNG atau JPEG, paling besar 5 MB.",
  ERR_NOT_FOUND: "Bukti tidak ditemukan.",
  ERR_VERSION_CONFLICT: "Bukti ini sudah berubah (diputuskan atau ada berkas baru). Muat ulang lalu periksa lagi.",
  ERR_APPROVER_IS_REQUESTER: "Pengunggah berkas tidak dapat menyetujuinya sendiri.",
};
const KEY = /^[a-z][a-z0-9_]{2,60}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
// A real calendar date (2026-02-31 is not one).
const realDate = (s: string) => DATE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

async function inContext(f: FormData, fn: Parameters<typeof withTenantContext>[2]): Promise<EvidenceState | null> {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return { error: MESSAGES.ERR_FORBIDDEN };
  if (staleContext(f, rc.active.context)) return { error: STALE_CONTEXT };
  try {
    await withTenantContext(await appPool(), rc.active.context, fn);
    return null;
  } catch (e) {
    if (e instanceof EvidenceFileError) return { error: e.message };
    if (e instanceof CommandError) return { error: MESSAGES[e.code] ?? "Belum tersimpan. Coba lagi." };
    console.error("kepatuhan: action failed", { error: e instanceof Error ? e.message : String(e) });
    return { error: "Belum pasti tersimpan. Muat ulang untuk melihat keadaannya." };
  }
}

export async function uploadAction(_p: EvidenceState, f: FormData): Promise<EvidenceState> {
  const key = String(f.get("key") ?? "");
  const file = f.get("file");
  const expert = String(f.get("expert") ?? "").trim();
  const date = String(f.get("date") ?? "");
  if (!KEY.test(key)) return { error: MESSAGES.ERR_NOT_FOUND };
  if (!(file instanceof File) || file.size === 0) return { error: "Pilih berkas PDF, PNG atau JPEG." };
  if (file.size > MAX_BYTES) return { error: "Berkas lebih dari 5 MB." };
  if (expert.length < 2 || expert.length > 120) return { error: "Tulis nama penyusun dokumen (2–120 karakter)." };
  if (!realDate(date)) return { error: "Isi tanggal dokumen yang valid." };
  if (date > today()) return { error: "Tanggal dokumen tidak boleh di masa depan." };
  const content = Buffer.from(await file.arrayBuffer());
  let created = true;
  const r = await inContext(f, async (db) => {
    created = (await uploadEvidence(db, { obligationKey: key, fileName: file.name, content, expertName: expert, documentDate: date })).created;
  });
  if (r) return r;
  revalidatePath("/kepatuhan");
  revalidatePath(`/kepatuhan/${key}`);
  return created ? { ok: "Bukti diunggah. Menunggu persetujuan." } : { error: "Berkas sama dengan versi terbaru; tidak ada versi baru." };
}

export async function decideAction(_p: EvidenceState, f: FormData): Promise<EvidenceState> {
  const key = String(f.get("key") ?? "");
  const item = String(f.get("item") ?? "");
  const fileId = String(f.get("file") ?? "");
  const decision = String(f.get("decision") ?? "");
  const reason = String(f.get("reason") ?? "").trim();
  const valid = String(f.get("valid") ?? "");
  if (!KEY.test(key) || !UUID.test(item) || !UUID.test(fileId) || !["approved", "rejected", "revoked"].includes(decision)) return { error: MESSAGES.ERR_NOT_FOUND };
  if (decision !== "approved" && (reason.length < 3 || reason.length > 500)) return { error: "Tulis alasannya (3–500 karakter)." };
  if (valid && !realDate(valid)) return { error: "Tanggal berlaku tidak valid." };
  if (valid && valid < today()) return { error: "Tanggal berlaku tidak boleh di masa lalu." };
  const r = await inContext(f, (db) => decideEvidence(db, item, fileId, decision as "approved" | "rejected" | "revoked", reason || undefined, valid || undefined));
  if (r) return r;
  revalidatePath("/kepatuhan");
  revalidatePath(`/kepatuhan/${key}`);
  return { ok: decision === "approved" ? "Disetujui." : decision === "rejected" ? "Ditolak." : "Dicabut." };
}
