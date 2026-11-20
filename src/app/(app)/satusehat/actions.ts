"use server";
// SATUSEHAT actions (UX-23; T-102 increments 3–4): Kirim Ulang, identity resolve / unresolvable, the reporting room, the practitioner IHS id (by
// hand, or by a one-off NIK lookup — TD-31, increment 4: the NIK is sealed in the module, never echoed), the ICD-9 CM map, and the branch credentials (owner / Admin Pusat; the secret is sealed on the server
// and never shown back). Each refuses a form rendered in another context first (HYG-009 B2-1); the database decides authority and scope.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { LookupInputError } from "../../../modules/integrations/satusehat/practitioner-lookup";
import { linkPractitioner, requestPractitionerLookup, resend, RESEND_REASONS, resolveIdentity, revokeCredentials, setCodeMap, setContextRoom, setCredentials }
  from "../../../modules/integrations/satusehat/satusehat";
import { STALE_CONTEXT, staleContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { GoLiveBlockedError } from "../../../modules/vendor/profile/profile";

export type SatusehatState = { error?: string; ok?: string; n?: number };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IHS = /^[A-Za-z0-9-]{3,64}$/;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Peran ini tidak dapat melakukan aksi ini.",
  ERR_NOT_FOUND: "Data tidak ditemukan. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Data sudah berubah. Muat ulang halaman.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
  ERR_TENANT_SUSPENDED: "Klinik sedang tidak dapat melakukan aksi ini.",
  ERR_IDEMPOTENCY_CONFLICT: "Permintaan ini sudah diproses. Muat ulang halaman.",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const next = (p: SatusehatState, s: SatusehatState): SatusehatState => ({ ...s, n: (p.n ?? 0) + 1 });
const message = (e: unknown) => {
  if (e instanceof GoLiveBlockedError) return "Klinik belum boleh menerima data sungguhan (persyaratan go-live belum lengkap).";
  if (e instanceof CommandError) return COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  console.error("satusehat: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.";
};
type Db = Parameters<Parameters<typeof withTenantContext>[2]>[0];
// go: /satusehat?ok=<code>[&cabang=<branch>] after the command committed (outside the catch); the page shows the notice from a fixed map.
async function run<R>(p: SatusehatState, f: FormData, fn: (db: Db) => Promise<R>, ok: string): Promise<SatusehatState> {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return next(p, { error: COPY.ERR_FORBIDDEN });
  if (staleContext(f, rc.active.context)) return next(p, { error: STALE_CONTEXT });
  try {
    await withTenantContext(await appPool(), rc.active.context, (db) => fn(db));
  } catch (e) {
    return next(p, { error: message(e) });
  }
  revalidatePath("/satusehat");
  const cabang = str(f, "cabang");
  redirect(`/satusehat?ok=${ok}${UUID.test(cabang) ? `&cabang=${cabang}` : ""}`);
}

export async function resendAction(p: SatusehatState, f: FormData): Promise<SatusehatState> {
  const visit = str(f, "visit");
  const why = str(f, "reason") as (typeof RESEND_REASONS)[number];
  if (!UUID.test(visit) || !(RESEND_REASONS as readonly string[]).includes(why)) return next(p, { error: "Pilih alasan kirim ulang." });
  return run(p, f, (db) => resend(db, visit, why), "dikirim-ulang");
}
export async function resolveAction(p: SatusehatState, f: FormData): Promise<SatusehatState> {
  const patient = str(f, "patient");
  const mode = str(f, "mode");
  const ihs = str(f, "ihs");
  const evidence = str(f, "evidence");
  if (!UUID.test(patient) || (mode !== "resolve" && mode !== "unresolvable")) return next(p, { error: COPY.ERR_INVALID_INPUT });
  if (mode === "resolve" && !IHS.test(ihs)) return next(p, { error: "Isi nomor IHS pasien." });
  if (evidence.length < 3) return next(p, { error: "Tulis dasar keputusan (minimal 3 karakter)." });
  return run(p, f, (db) => resolveIdentity(db, patient, mode === "resolve" ? ihs : null, evidence), mode === "resolve" ? "identitas" : "tidak-terselesaikan");
}
export async function roomAction(p: SatusehatState, f: FormData): Promise<SatusehatState> {
  const visit = str(f, "visit");
  const room = str(f, "room");
  if (!UUID.test(visit) || !UUID.test(room)) return next(p, { error: "Pilih ruang periksa." });
  return run(p, f, (db) => setContextRoom(db, visit, room), "ruang");
}
export async function practitionerAction(p: SatusehatState, f: FormData): Promise<SatusehatState> {
  const key = str(f, "key");
  const staff = str(f, "staff");
  const ihs = str(f, "ihs");
  if (!UUID.test(key) || !UUID.test(staff)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  if (!IHS.test(ihs)) return next(p, { error: "Isi nomor IHS tenaga kesehatan (3–64 huruf, angka atau tanda hubung)." });
  return run(p, f, (db) => linkPractitioner(db, key, { staffId: staff, ihs }), "nakes");
}
// TD-31 lookup: the NIK is read once from the form, validated and sealed by the module; on any refusal the state carries a fixed message,
// never the value. The form is remounted after every answer, so the field is empty again.
export async function lookupAction(p: SatusehatState, f: FormData): Promise<SatusehatState> {
  const key = str(f, "key");
  const staff = str(f, "staff");
  const branch = str(f, "cabang");
  const nik = typeof f.get("nik") === "string" ? (f.get("nik") as string) : "";
  if (!UUID.test(key) || !UUID.test(staff) || !UUID.test(branch)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  if (!/^[0-9]{16}$/.test(nik.replace(/[\s-]/g, ""))) return next(p, { error: "NIK harus 16 angka." });
  return run(p, f, (db) => requestPractitionerLookup(db, key, { staffId: staff, branchId: branch, nik }).catch((e) => {
    if (e instanceof LookupInputError) throw new CommandError("ERR_INVALID_INPUT");
    throw e;
  }), "cari-nakes");
}
export async function codeMapAction(p: SatusehatState, f: FormData): Promise<SatusehatState> {
  const key = str(f, "key");
  const item = str(f, "item");
  const code = str(f, "code");
  const display = str(f, "display");
  if (!UUID.test(key) || !UUID.test(item)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  if (!/^[0-9]{2}(\.[0-9]{1,2})?$/.test(code)) return next(p, { error: "Kode ICD-9 CM berbentuk 2 angka, boleh diikuti titik dan 1–2 angka." });
  if (display.length < 2) return next(p, { error: "Tulis nama tindakan ICD-9 CM." });
  return run(p, f, (db) => setCodeMap(db, key, { itemId: item, code, display }), "peta");
}
export async function credentialAction(p: SatusehatState, f: FormData): Promise<SatusehatState> {
  const key = str(f, "key");
  const branch = str(f, "cabang");
  const environment = str(f, "environment");
  const organizationId = str(f, "organization");
  const clientId = str(f, "client");
  const secret = typeof f.get("secret") === "string" ? (f.get("secret") as string) : "";
  if (!UUID.test(key) || !UUID.test(branch) || (environment !== "sandbox" && environment !== "production")) return next(p, { error: COPY.ERR_INVALID_INPUT });
  if (!IHS.test(organizationId) || clientId.length < 3 || secret.length < 8) return next(p, { error: "Lengkapi ID organisasi, client ID dan client secret." });
  return run(p, f, (db) => setCredentials(db, key, { branchId: branch, environment, organizationId, clientId, clientSecret: secret }), "kredensial");
}
export async function revokeAction(p: SatusehatState, f: FormData): Promise<SatusehatState> {
  const id = str(f, "credential");
  if (!UUID.test(id)) return next(p, { error: COPY.ERR_INVALID_INPUT });
  return run(p, f, (db) => revokeCredentials(db, id), "dicabut");
}
