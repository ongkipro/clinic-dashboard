"use server";
// Profil Pasien actions (UX-29, PR-49, T-040): Catat Persetujuan and Tarik Persetujuan. Each refuses a
// form rendered in another context first (HYG-009 B2-1); the database decides authority (the six
// recorders), the shown text and the rules (care notice not withdrawable). Every write carries the
// form's per-mount idempotency key.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { STALE_CONTEXT, staleContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { type ConsentChannel, type GrantablePurpose, grantConsent } from "../../../../modules/patients/consents/consents";
import { withdrawFromProfile } from "../../../../modules/patients/profile";
import { GoLiveBlockedError } from "../../../../modules/vendor/profile/profile";

export type ConsentState = { error?: string; ok?: string; values?: Record<string, string>; n?: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PURPOSES = ["care_notice", "clinical_photo", "marketing_wa", "publication"];
const CHANNELS = ["in_person", "paper", "whatsapp", "phone"];
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Peran Anda tidak dapat mencatat persetujuan.",
  ERR_NOT_FOUND: "Pasien, teks atau persetujuan tidak ditemukan. Muat ulang halaman.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
  ERR_TENANT_SUSPENDED: "Klinik sedang tidak menerima perubahan ini.",
  ERR_IDEMPOTENCY_CONFLICT: "Permintaan ini sudah dikirim dengan isi lain. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Data sudah berubah. Muat ulang halaman.",
  consent_text_changed: "Teks persetujuan baru saja diperbarui. Muat ulang dan tunjukkan teks terbaru ke pasien.",
  already_granted: "Persetujuan ini sudah aktif.",
  not_withdrawable: "Pemberitahuan layanan & rekam medis tidak dapat ditarik.",
  already_withdrawn: "Persetujuan ini sudah ditarik.",
  reason: "Tulis alasan penarikan (minimal 3 huruf).",
  choice: "Pilih jenis persetujuan dan salurannya.",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const done = (prev: ConsentState, s: ConsentState): ConsentState => ({ ...s, n: (prev.n ?? 0) + 1 });
const message = (e: unknown) => {
  if (e instanceof GoLiveBlockedError) return "Klinik belum boleh menerima data pasien sungguhan (persyaratan go-live belum lengkap).";
  if (e instanceof CommandError) return COPY[(e as { reason?: string }).reason ?? ""] ?? COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  console.error("profil-pasien: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.";
};

async function write(prev: ConsentState, f: FormData, work: (db: Parameters<Parameters<typeof withTenantContext>[2]>[0], key: string) => Promise<{ ok: boolean; code?: string }>, ok: string, values: Record<string, string>) {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return done(prev, { error: COPY.ERR_FORBIDDEN });
  if (staleContext(f, rc.active.context)) return done(prev, { error: STALE_CONTEXT });
  const key = str(f, "key");
  const patient = str(f, "patient");
  if (!UUID.test(key) || !UUID.test(patient)) return done(prev, { error: COPY.ERR_VERSION_CONFLICT, values });
  try {
    const r = await withTenantContext(await appPool(), rc.active.context, (db) => work(db, key));
    if (!r.ok) return done(prev, { error: COPY[r.code ?? ""] ?? COPY.ERR_FORBIDDEN, values });
  } catch (e) {
    return done(prev, { error: message(e), values });
  }
  revalidatePath(`/pasien/${patient}`);
  return done(prev, { ok });
}

export async function grantAction(prev: ConsentState, f: FormData): Promise<ConsentState> {
  const purpose = str(f, "purpose");
  const channel = str(f, "channel");
  const text = str(f, "text");
  const values = { purpose, channel };
  if (!PURPOSES.includes(purpose) || !CHANNELS.includes(channel)) return done(prev, { error: COPY.choice, values });
  if (!UUID.test(text)) return done(prev, { error: COPY.ERR_NOT_FOUND, values });
  return write(prev, f, (db, key) => grantConsent(db, key, {
    patientId: str(f, "patient"), purpose: purpose as GrantablePurpose, textId: text, channel: channel as ConsentChannel,
  }), "Persetujuan dicatat.", values);
}

export async function withdrawAction(prev: ConsentState, f: FormData): Promise<ConsentState> {
  const consent = str(f, "consent");
  const channel = str(f, "channel");
  const reason = str(f, "reason");
  const values = { channel, reason };
  if (!UUID.test(consent)) return done(prev, { error: COPY.ERR_NOT_FOUND });
  if (!CHANNELS.includes(channel)) return done(prev, { error: COPY.choice, values });
  if (reason.length < 3) return done(prev, { error: COPY.reason, values });
  return write(prev, f, (db, key) => withdrawFromProfile(db, key, { patientId: str(f, "patient"), consentId: consent, channel: channel as ConsentChannel, reason }), "Persetujuan ditarik.", values);
}
