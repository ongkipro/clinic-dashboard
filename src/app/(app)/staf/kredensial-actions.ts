"use server";
// Kredensial actions (UX-3, PR-73, IAM-4; T-050): Tambah Kredensial (Owner, Admin Pusat), Verifikasi / Tolak
// (facility head; the Owner only when no other facility head may), Tangguhkan / Cabut. Each runs in the
// request's active context, refuses a stale context (two tabs), and carries the form's idempotency key;
// the database decides who may. Every answer bumps `n`, so the form renders a fresh key for the next attempt
// (review r1 P1-2: a key is spent by a success and by a refusal alike).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { decideCredential, endCredential, recordCredential, type CredentialKind, type Profession } from "../../../modules/org/licences/licences";
import { CREDENTIAL_KINDS, PROFESSIONS } from "../../../modules/org/licences/schema";
import { STALE_CONTEXT, staleContext } from "../../../modules/org/context/context";
import { KIND_PROFESSIONS } from "./kredensial-labels";
import { appPool, requestContext } from "../../../modules/org/context/store";

export type CredentialActionState = { error?: string; ok?: string; n?: number };

const MESSAGES: Record<string, string> = {
  ERR_FORBIDDEN: "Anda tidak punya akses untuk tindakan ini.",
  ERR_NOT_FOUND: "Data tidak ditemukan.",
  ERR_INVALID_INPUT: "Periksa kembali isian kredensial.",
  ERR_VERSION_CONFLICT: "Kredensial sudah berubah atau masih ada yang aktif. Muat ulang lalu coba lagi.",
  ERR_APPROVER_IS_REQUESTER: "Pemegang, pencatat atau pengundang tidak boleh memverifikasi kredensial ini.",
  ERR_CREDENTIAL_INVALID: "Izin praktik tenaga kesehatan tidak berlaku.",
  ERR_TENANT_SUSPENDED: "Klinik sedang ditangguhkan; tindakan ini belum bisa dilakukan.",
  ERR_IDEMPOTENCY_CONFLICT: "Permintaan ini sudah dikirim dengan isi berbeda. Muat ulang lalu coba lagi.",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const next = (p: CredentialActionState, s: CredentialActionState): CredentialActionState => ({ ...s, n: (p.n ?? 0) + 1 });

async function inContext(f: FormData, fn: (db: Parameters<Parameters<typeof withTenantContext>[2]>[0], key: string) => Promise<unknown>): Promise<CredentialActionState | null> {
  const key = str(f, "key");
  if (!UUID.test(key)) return { error: MESSAGES.ERR_INVALID_INPUT };
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return { error: MESSAGES.ERR_FORBIDDEN };
  if (staleContext(f, rc.active.context)) return { error: STALE_CONTEXT };
  try {
    await withTenantContext(await appPool(), rc.active.context, (db) => fn(db, key));
    return null;
  } catch (e) {
    if (e instanceof CommandError) return { error: MESSAGES[e.code] ?? MESSAGES.ERR_FORBIDDEN };
    throw e;
  }
}

export async function recordCredentialAction(p: CredentialActionState, f: FormData): Promise<CredentialActionState> {
  const staffId = str(f, "staff_id");
  const kind = str(f, "kind") as CredentialKind;
  const profession = str(f, "profession") as Profession;
  const branchId = str(f, "branch_id") || null;
  const validFrom = str(f, "valid_from");
  const expiresOn = str(f, "expires_on") || null;
  const replaces = str(f, "replaces") || null;
  const number = str(f, "number");
  const issuer = str(f, "issuer");
  if (!UUID.test(staffId) || !CREDENTIAL_KINDS.includes(kind) || !PROFESSIONS.includes(profession) || !DATE.test(validFrom)
      || (expiresOn !== null && !DATE.test(expiresOn)) || (branchId !== null && !UUID.test(branchId)) || (replaces !== null && !UUID.test(replaces))
      || number.length < 3 || number.length > 60 || issuer.length < 3 || issuer.length > 120) {
    return next(p, { error: MESSAGES.ERR_INVALID_INPUT });
  }
  if (kind !== "str" && (branchId === null || expiresOn === null)) return next(p, { error: "SIP, SIPP dan SIPA wajib punya cabang dan tanggal berakhir." });
  if (kind === "str" && branchId !== null) return next(p, { error: MESSAGES.ERR_INVALID_INPUT });
  if (!KIND_PROFESSIONS[kind].includes(profession)) return next(p, { error: "Profesi tidak cocok dengan jenis kredensial." });
  if (expiresOn !== null && expiresOn < validFrom) return next(p, { error: "Tanggal berakhir tidak boleh sebelum tanggal mulai berlaku." });
  const r = await inContext(f, (db, key) => recordCredential(db, key, staffId, {
    kind, profession, number, issuer, scope: str(f, "scope") || null, branchId, validFrom, expiresOn,
    evidenceNote: str(f, "evidence_note") || null, replaces,
  }));
  if (r) return next(p, r);
  revalidatePath(`/staf/${staffId}`);
  revalidatePath("/staf");
  return next(p, { ok: "Kredensial dicatat. Menunggu verifikasi Penanggung Jawab Klinik." });
}

export async function decideCredentialAction(p: CredentialActionState, f: FormData): Promise<CredentialActionState> {
  const id = str(f, "id");
  const staffId = str(f, "staff_id");
  const verdict = str(f, "verdict");
  const reason = str(f, "reason");
  if (!UUID.test(id) || !UUID.test(staffId) || (verdict !== "verified" && verdict !== "rejected")) return next(p, { error: MESSAGES.ERR_INVALID_INPUT });
  if (verdict === "rejected" && (reason.length < 3 || reason.length > 500)) return next(p, { error: "Tulis alasan penolakan (3–500 karakter)." });
  const r = await inContext(f, (db, key) => decideCredential(db, key, id, verdict === "verified", verdict === "rejected" ? reason : null));
  if (r) return next(p, r);
  revalidatePath(`/staf/${staffId}`);
  revalidatePath("/staf");
  return next(p, { ok: verdict === "verified" ? "Kredensial diverifikasi." : "Kredensial ditolak." });
}

export async function endCredentialAction(p: CredentialActionState, f: FormData): Promise<CredentialActionState> {
  const id = str(f, "id");
  const staffId = str(f, "staff_id");
  const state = str(f, "state");
  const reason = str(f, "reason");
  if (!UUID.test(id) || !UUID.test(staffId) || (state !== "suspended" && state !== "revoked")) return next(p, { error: MESSAGES.ERR_INVALID_INPUT });
  if (reason.length < 3 || reason.length > 500) return next(p, { error: "Tulis alasannya (3–500 karakter)." });
  const r = await inContext(f, (db, key) => endCredential(db, key, id, state, reason));
  if (r) return next(p, r);
  revalidatePath(`/staf/${staffId}`);
  revalidatePath("/staf");
  return next(p, { ok: state === "suspended" ? "Kredensial ditangguhkan." : "Kredensial dicabut." });
}
