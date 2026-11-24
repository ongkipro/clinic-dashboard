"use server";
// UX-30 ▸ Permintaan server actions (PR-50; T-121). Every action checks rendered context first
// (HYG-009 B2-1) and delegates authority, idempotency, chronology, cluster revalidation, and D3/D4
// enforcement to the database definers of migration 0134.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTenantContext } from "../../../../db/rls/context";
import { CommandError } from "../../../../lib/command";
import { STALE_CONTEXT, staleContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import {
  assignDsr,
  bindDsrSubject,
  CHANNELS,
  closeDsr,
  confirmCopyHandoff,
  CORRECTION_SCOPES,
  IDENTITY_METHODS,
  LINK_KINDS,
  linkDsrEvidence,
  logDsr,
  OUTCOME_BASES,
  OUTCOMES,
  REFUSAL_COPY,
  REQUESTERS,
  RESTRICTION_PURPOSES,
  RIGHTS,
  verifyDsrIdentity,
  type Channel,
  type CorrectionScope,
  type IdentityMethod,
  type LinkKind,
  type Outcome,
  type OutcomeBasisCode,
  type Requester,
  type RestrictionPurpose,
  type Right,
} from "../../../../modules/privacy/requests";

export type DsrActionState = { error?: string; ok?: string; createdId?: string; values?: Record<string, string>; n?: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COPY: Record<string, string> = {
  ...REFUSAL_COPY,
  ERR_FORBIDDEN: "Hanya Owner atau Admin Pusat dengan tugas pelindungan data yang dapat memproses permintaan ini.",
  ERR_NOT_FOUND: "Permintaan atau data terkait tidak ditemukan. Muat ulang halaman.",
  ERR_VERSION_CONFLICT: "Status permintaan sudah berubah. Muat ulang halaman.",
  ERR_INVALID_INPUT: "Periksa kembali seluruh isian formulir.",
  ERR_TENANT_SUSPENDED: "Klinik dalam status tertutup tidak dapat memproses permintaan data.",
  ERR_IDEMPOTENCY_CONFLICT: "Permintaan dengan kunci sama sudah dikirim dengan isi berbeda. Muat ulang halaman.",
  ERR_IMMUTABLE: "Data permintaan yang sudah tercatat tidak dapat diubah.",
  patient_not_found: "Pasien tidak ditemukan pada klinik ini.",
  subject_locked_after_verify: "Subjek pasien tidak dapat diubah setelah identitas diverifikasi.",
  subject_already_bound: "Subjek pasien sudah terikat pada permintaan ini.",
  assignee_not_privacy_officer: "Petugas tujuan bukan petugas privasi aktif pada klinik ini.",
  handoff_ref_required: "Isi nomor referensi atau catatan serah terima salinan (3–200 huruf).",
  copy_handoff_unconfirmed: "Salinan RME belum memiliki konfirmasi artefak dan serah terima yang sah (atau referensi serah terima tidak cocok).",
  handoff_already_confirmed: "Serah terima salinan RME sudah dikonfirmasi sebelumnya dengan detail berbeda.",
  addresses_request_required: "Konfirmasi bahwa revisi RME tersebut menjawab permintaan pasien.",
  link_invalid_for_request: "Bukti yang dipilih tidak sesuai hak, status persetujuan, atau klaster pasien saat ini.",
  correction_scope_required: "Pilih ruang lingkup perbaikan (demografi atau klinis).",
  requested_purposes_required: "Pilih minimal satu tujuan pemrosesan yang diminta pembatasannya.",
  subject_required: "Ikat permintaan ke pasien terlebih dahulu sebelum menautkan bukti atau menutup pembatasan.",
};

const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const done = (prev: DsrActionState, s: DsrActionState): DsrActionState => ({ ...s, n: (prev.n ?? 0) + 1 });
const keep = (f: FormData) =>
  Object.fromEntries([...f.entries()].filter(([k, v]) => typeof v === "string" && !k.startsWith("ctx_") && !k.startsWith("$") && k !== "key")) as Record<string, string>;

// Explicit WIB wall-time parser (Finding #7: never silently default to "now").
const parseWib = (v: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(v)) return null;
  const iso = v.length === 16 ? `${v}:00+07:00` : `${v}+07:00`;
  const dt = new Date(iso);
  return Number.isFinite(dt.getTime()) ? dt : null;
};

const errMsg = (e: unknown): string => {
  if (e instanceof CommandError) {
    const r = (e as { reason?: string }).reason ?? "";
    return COPY[r] ?? COPY[e.code] ?? COPY.ERR_FORBIDDEN;
  }
  console.error("privasi-permintaan: action failed", { error: e instanceof Error ? e.name : "unknown" });
  return "Perubahan belum pasti tersimpan. Muat ulang halaman untuk memeriksa status terbaru.";
};

async function runWrite<T>(
  prev: DsrActionState,
  f: FormData,
  work: (db: Parameters<Parameters<typeof withTenantContext>[2]>[0]) => Promise<T>,
  onOk: (res: T) => DsrActionState,
  revalidateId?: string,
): Promise<DsrActionState> {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") return done(prev, { error: COPY.ERR_FORBIDDEN });
  if (staleContext(f, rc.active.context)) return done(prev, { error: STALE_CONTEXT });
  try {
    const res = await withTenantContext(await appPool(), rc.active.context, work);
    revalidatePath("/privasi/permintaan");
    if (revalidateId) revalidatePath(`/privasi/permintaan/${revalidateId}`);
    return done(prev, onOk(res));
  } catch (e) {
    return done(prev, { error: errMsg(e), values: keep(f) });
  }
}

export async function logDsrAction(prev: DsrActionState, f: FormData): Promise<DsrActionState> {
  const key = str(f, "key");
  if (!UUID.test(key)) return done(prev, { error: COPY.ERR_VERSION_CONFLICT, values: keep(f) });
  const requester = str(f, "requester_kind") as Requester;
  const right = str(f, "right") as Right;
  const channel = str(f, "channel") as Channel;
  const receivedAt = parseWib(str(f, "received_at"));
  const confirmedReceipt = f.get("confirm_received_at") === "on";
  const patientRaw = str(f, "patient_id");
  const patientId = patientRaw ? patientRaw : null;

  if (!REQUESTERS.includes(requester) || !RIGHTS.includes(right) || !CHANNELS.includes(channel)) {
    return done(prev, { error: COPY.ERR_INVALID_INPUT, values: keep(f) });
  }
  if (!receivedAt || !confirmedReceipt) {
    return done(prev, { error: "Isi dan konfirmasi waktu pertama permintaan diterima (WIB, tidak di masa depan).", values: keep(f) });
  }
  if (patientId && !UUID.test(patientId)) {
    return done(prev, { error: COPY.patient_not_found, values: keep(f) });
  }

  let correctionScope: CorrectionScope | null = null;
  if (right === "correction") {
    const sc = str(f, "correction_scope") as CorrectionScope;
    if (!CORRECTION_SCOPES.includes(sc)) return done(prev, { error: COPY.correction_scope_required, values: keep(f) });
    correctionScope = sc;
  }

  let requestedPurposes: RestrictionPurpose[] | null = null;
  if (right === "restriction") {
    const picked = f.getAll("requested_purposes").filter((v): v is RestrictionPurpose => typeof v === "string" && (RESTRICTION_PURPOSES as readonly string[]).includes(v));
    if (picked.length === 0) return done(prev, { error: COPY.requested_purposes_required, values: keep(f) });
    requestedPurposes = [...new Set(picked)];
  }

  return runWrite(
    prev,
    f,
    (db) => logDsr(db, key, { patientId, requester, right, channel, receivedAt, correctionScope, requestedPurposes }),
    (r) => ({ ok: "Permintaan dicatat. Tenggat 3×24 jam berjalan dari waktu diterima.", createdId: r.id }),
  );
}

export async function bindSubjectAction(prev: DsrActionState, f: FormData): Promise<DsrActionState> {
  const id = str(f, "id");
  const patientId = str(f, "patient_id");
  if (!UUID.test(id)) return done(prev, { error: COPY.ERR_NOT_FOUND });
  if (!UUID.test(patientId)) return done(prev, { error: COPY.patient_not_found, values: keep(f) });
  return runWrite(prev, f, (db) => bindDsrSubject(db, id, patientId), () => ({ ok: "Subjek pasien berhasil diikat." }), id);
}

export async function verifyIdentityAction(prev: DsrActionState, f: FormData): Promise<DsrActionState> {
  const id = str(f, "id");
  const method = str(f, "method") as IdentityMethod;
  if (!UUID.test(id)) return done(prev, { error: COPY.ERR_NOT_FOUND });
  if (!IDENTITY_METHODS.includes(method)) return done(prev, { error: COPY.identity_method, values: keep(f) });
  return runWrite(prev, f, (db) => verifyDsrIdentity(db, id, method), () => ({ ok: "Identitas pemohon terverifikasi. Permintaan kini dapat diproses." }), id);
}

export async function assignDsrAction(prev: DsrActionState, f: FormData): Promise<DsrActionState> {
  const id = str(f, "id");
  const staffRaw = str(f, "staff_id");
  const staffId = staffRaw ? staffRaw : null;
  if (!UUID.test(id)) return done(prev, { error: COPY.ERR_NOT_FOUND });
  if (staffId && !UUID.test(staffId)) return done(prev, { error: COPY.assignee_not_privacy_officer, values: keep(f) });
  return runWrite(prev, f, (db) => assignDsr(db, id, staffId), () => ({ ok: staffId ? "Petugas penanggung jawab diperbarui." : "Penugasan dikosongkan." }), id);
}

export async function confirmCopyHandoffAction(prev: DsrActionState, f: FormData): Promise<DsrActionState> {
  const id = str(f, "id");
  const copyRequestId = str(f, "copy_request_id");
  const artifactSha256 = str(f, "artifact_sha256").toLowerCase();
  const channel = str(f, "handoff_channel") as Channel;
  const handedOffAt = parseWib(str(f, "handed_off_at"));
  const handoffRef = str(f, "handoff_ref");
  if (!UUID.test(id)) return done(prev, { error: COPY.ERR_NOT_FOUND });
  if (
    !UUID.test(copyRequestId) ||
    !/^[0-9a-f]{64}$/.test(artifactSha256) ||
    !CHANNELS.includes(channel) ||
    !handedOffAt ||
    handoffRef.length < 3 ||
    handoffRef.length > 200
  ) {
    return done(prev, {
      error: "Lengkapi ID salinan RME, hash SHA-256 artefak (64 hex), saluran, waktu serah terima (WIB), dan referensi (3–200 huruf).",
      values: keep(f),
    });
  }
  return runWrite(
    prev,
    f,
    (db) => confirmCopyHandoff(db, id, { copyRequestId, artifactSha256, channel, handedOffAt, handoffRef }),
    () => ({ ok: "Konfirmasi artefak & serah terima salinan RME tercatat. Salinan kini dapat ditautkan." }),
    id,
  );
}

export async function linkEvidenceAction(prev: DsrActionState, f: FormData): Promise<DsrActionState> {
  const id = str(f, "id");
  const kind = str(f, "link_kind") as LinkKind;
  const linkId = str(f, "link_id");
  const handoffRef = str(f, "handoff_ref") || null;
  const addressesRequest = f.get("addresses_request") === "on";
  if (!UUID.test(id)) return done(prev, { error: COPY.ERR_NOT_FOUND });
  if (!LINK_KINDS.includes(kind) || !UUID.test(linkId)) return done(prev, { error: COPY.link_invalid_for_request, values: keep(f) });
  return runWrite(
    prev,
    f,
    (db) => linkDsrEvidence(db, id, { kind, linkId, handoffRef, addressesRequest }),
    () => ({ ok: "Bukti pemenuhan ditautkan." }),
    id,
  );
}

export async function closeDsrAction(prev: DsrActionState, f: FormData): Promise<DsrActionState> {
  const id = str(f, "id");
  const outcome = str(f, "outcome") as Outcome;
  const basisCode = str(f, "outcome_basis_code") as OutcomeBasisCode;
  const note = str(f, "outcome_note") || null;
  if (!UUID.test(id)) return done(prev, { error: COPY.ERR_NOT_FOUND });
  if (!OUTCOMES.includes(outcome)) return done(prev, { error: COPY.outcome_required, values: keep(f) });
  if (!OUTCOME_BASES.includes(basisCode)) return done(prev, { error: COPY.basis_required, values: keep(f) });

  if (outcome === "withdrawn") {
    const withdrawalSource = str(f, "withdrawal_source") as Channel;
    const withdrawalAttestation = str(f, "withdrawal_attestation");
    if (!CHANNELS.includes(withdrawalSource) || withdrawalAttestation.length < 5) {
      return done(prev, { error: COPY.withdrawal_required, values: keep(f) });
    }
    return runWrite(
      prev,
      f,
      (db) => closeDsr(db, id, { outcome, basisCode, note, withdrawalSource, withdrawalAttestation }),
      () => ({ ok: "Permintaan ditutup sebagai dibatalkan pemohon." }),
      id,
    );
  }

  const deliveryChannel = str(f, "delivery_channel") as Channel;
  const deliveryConfirmedAt = parseWib(str(f, "delivery_confirmed_at"));
  const deliveryRef = str(f, "delivery_ref");
  if (!CHANNELS.includes(deliveryChannel) || !deliveryConfirmedAt || deliveryRef.length < 3) {
    return done(prev, { error: COPY.delivery_required, values: keep(f) });
  }
  return runWrite(
    prev,
    f,
    (db) => closeDsr(db, id, { outcome, basisCode, note, deliveryChannel, deliveryConfirmedAt, deliveryRef }),
    () => ({ ok: "Permintaan ditutup dan konfirmasi serah terima tercatat." }),
    id,
  );
}
