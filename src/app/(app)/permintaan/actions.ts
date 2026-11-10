"use server";
// Permintaan Klinis actions (UX-27, PR-45; T-056): Usul Permintaan, Setujui / Tolak, Batalkan. Each refuses a form
// rendered in another context first (HYG-009 B2-1), carries the form's idempotency key (rotated after every
// answer: n), and lets the database decide authority and validity.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../db/rls/context";
import { CommandError } from "../../../lib/command";
import { cancelRequest, createRequest, decideRequest, type DoseUnit, type RequestKind } from "../../../modules/clinical/requests/requests";
import { STALE_CONTEXT, staleContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { GoLiveBlockedError } from "../../../modules/vendor/profile/profile";
import { KIND_LABEL, UNIT_LABEL } from "./labels";

export type RequestFormState = { error?: string; ok?: string; n?: number; id?: string; consentOpened?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COPY: Record<string, string> = {
  ERR_FORBIDDEN: "Peran ini tidak dapat melakukan aksi ini pada permintaan klinis.",
  ERR_NOT_FOUND: "Permintaan, pasien, atau rencana tidak ditemukan di cabang ini. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Permintaan atau rencana sudah berubah. Muat ulang halaman.",
  ERR_INVALID_INPUT: "Periksa kembali isian.",
  ERR_TENANT_SUSPENDED: "Klinik sedang tidak melayani kunjungan.",
  ERR_IDEMPOTENCY_CONFLICT: "Permintaan ini sudah dikirim dengan isi lain. Muat ulang halaman.",
  ERR_APPROVER_IS_REQUESTER: "Anda pengaju — tidak dapat memutuskan permintaan sendiri.",
};
const REASON: Record<string, string> = {
  nurse_delegation_not_configured: "Delegasi keputusan untuk perawat belum diatur. Minta dokter atau penanggung jawab klinik memutuskan.",
  bc_may_not_set_dose: "Beauty Consultant tidak menentukan dosis.",
  version_changed: "Ubah Rencana memakai item yang sama; untuk item lain pilih Tukar Treatment.",
  no_change: "Tidak ada yang berubah dari item rencana.",
  same_item: "Tukar Treatment harus memilih item lain.",
  item_request_pending: "Item ini sudah punya permintaan yang menunggu keputusan.",
  item_removed: "Item rencana ini sudah dihapus.",
  visit_closed: "Kunjungan sudah ditutup.",
  plan_closed: "Rencana sudah ditutup.",
  no_examination: "Pemeriksaan untuk kunjungan ini belum dimulai.",
  decided: "Permintaan ini sudah diputuskan.",
  reason: "Tulis alasan penolakan (minimal 3 huruf).",
};
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const next = (p: RequestFormState, s: RequestFormState): RequestFormState => ({ ...s, n: (p.n ?? 0) + 1 });
const message = (e: unknown) => {
  if (e instanceof GoLiveBlockedError) return "Klinik belum boleh menerima data pasien sungguhan (persyaratan go-live belum lengkap).";
  if (e instanceof CommandError) return REASON[(e as { reason?: string }).reason ?? ""] ?? COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  console.error("permintaan: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Perubahan belum pasti tersimpan. Muat ulang untuk melihat keadaannya.";
};
type Db = Parameters<Parameters<typeof withTenantContext>[2]>[0];
async function run<R>(p: RequestFormState, f: FormData, ok: string, fn: (db: Db, key: string) => Promise<R>, extra?: (r: R) => Partial<RequestFormState>): Promise<RequestFormState> {
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
  revalidatePath("/permintaan", "layout");
  return next(p, { ok, ...(extra ? extra(r) : {}) });
}

const int = (s: string) => (/^[0-9]{1,4}$/.test(s) ? Number(s) : NaN);
// Usul Permintaan. The dose is entered in its unit with up to six decimals and stored in micro-units.
export async function createRequestAction(p: RequestFormState, f: FormData): Promise<RequestFormState> {
  const visit = str(f, "visit");
  const plan = str(f, "plan");
  const kind = str(f, "kind") as RequestKind;
  const version = str(f, "version");
  const target = str(f, "target");
  const stage = int(str(f, "stage"));
  const qty = int(str(f, "qty"));
  const reason = str(f, "reason");
  const doseText = str(f, "dose").replace(",", ".");
  const unit = str(f, "dose_unit");
  if (!UUID.test(visit) || !UUID.test(plan)) return next(p, { error: "Pilih pasien dan rencana." });
  if (!(kind in KIND_LABEL)) return next(p, { error: "Pilih jenis permintaan." });
  if (!UUID.test(version)) return next(p, { error: "Pilih item." });
  if (kind !== "addition" && !UUID.test(target)) return next(p, { error: "Pilih item rencana yang diubah." });
  if (!(stage >= 1 && stage <= 20) || !(qty >= 1 && qty <= 1000)) return next(p, { error: "Tahap 1–20 dan jumlah 1–1000." });
  if (reason.length < 3) return next(p, { error: "Tulis alasan (minimal 3 huruf)." });
  let dose: { doseMicro: number; doseUnit: DoseUnit } | null = null;
  if (doseText || unit) {
    if (!/^[0-9]{1,4}(\.[0-9]{1,6})?$/.test(doseText) || !(unit in UNIT_LABEL)) return next(p, { error: "Tulis dosis dan satuannya." });
    const [i, d = ""] = doseText.split(".");
    dose = { doseMicro: Number(i) * 1_000_000 + Number(d.padEnd(6, "0")), doseUnit: unit as DoseUnit };
  }
  return run(p, f, "Permintaan dikirim ke dokter.", (db, key) => createRequest(db, key, visit, {
    kind, planId: plan, catalogVersionId: version, stage, qty, reason, ...(kind !== "addition" ? { targetItemId: target } : {}), ...(dose ?? {}),
  }), (r) => ({ id: r.requestId }));
}

export async function decideRequestAction(p: RequestFormState, f: FormData): Promise<RequestFormState> {
  const request = str(f, "request");
  const decision = str(f, "decision");
  const reason = str(f, "reason");
  if (!UUID.test(request)) return next(p, { error: COPY.ERR_NOT_FOUND });
  if (decision !== "approve" && decision !== "decline") return next(p, { error: COPY.ERR_INVALID_INPUT });
  if (decision === "decline" && reason.length < 3) return next(p, { error: REASON.reason });
  const visit = str(f, "visit");
  return run(p, f, decision === "approve" ? "Permintaan disetujui; rencana diperbarui dan kasir diberi tahu." : "Permintaan ditolak.",
    (db, key) => decideRequest(db, key, request, decision === "approve", decision === "decline" ? reason : null),
    (r) => (r.state === "approved" && r.consent !== "active" && UUID.test(visit) ? { consentOpened: visit } : {}));
}

export async function cancelRequestAction(p: RequestFormState, f: FormData): Promise<RequestFormState> {
  const request = str(f, "request");
  if (!UUID.test(request)) return next(p, { error: COPY.ERR_NOT_FOUND });
  return run(p, f, "Permintaan dibatalkan.", (db, key) => cancelRequest(db, key, request));
}
