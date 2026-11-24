// Data-subject requests (PR-50, PRIV-2, UX-30 ▸ Permintaan; T-121, migration 0134).
// Pure domain rules mirroring the SQL CHECK constraints and SECURITY DEFINER functions in
// drizzle/0134_data_subject_requests.sql. Closes all 8 findings of t121/PLAN-REVIEW-codex-panel3.md.
//
// Statutory deadline (D1, class F fixed legal rule; PRIV-2 counsel matrix remains an open external gate):
// 72 hours (3 × 24 jam) from officer-confirmed received_at across all 5 rights (UU 27/2022).
// SLA stops at delivery_confirmed_at for fulfilled/partially_fulfilled/refused, and closed_at for withdrawn.
//
// D3 (no delete): clinical records, visits, financial rows, and patient identity rows are NEVER deleted.
// Erasure is NEVER 'fulfilled' (even with zero retained history); it closes as 'partially_fulfilled'
// (with linked optional marketing/publication consent withdrawal) or 'refused' with a typed retention basis.

export const RIGHTS = ["access", "correction", "consent_withdrawal", "restriction", "erasure"] as const;
export type Right = (typeof RIGHTS)[number];
export const RIGHT_LABEL: Record<Right, string> = {
  access: "Akses data",
  correction: "Perbaikan data",
  consent_withdrawal: "Penarikan persetujuan",
  restriction: "Pembatasan pemrosesan",
  erasure: "Penghapusan data",
};
export const LEGAL_BASIS: Record<Right, string> = {
  correction: "UU 27/2022 Pasal 30 ayat (1)",
  access: "UU 27/2022 Pasal 32 ayat (2)",
  consent_withdrawal: "UU 27/2022 Pasal 40 ayat (2)",
  restriction: "UU 27/2022 Pasal 41 ayat (1)",
  erasure: "UU 27/2022 Pasal 43–44",
};

export const CORRECTION_SCOPES = ["demographic", "clinical"] as const;
export type CorrectionScope = (typeof CORRECTION_SCOPES)[number];
export const CORRECTION_SCOPE_LABEL: Record<CorrectionScope, string> = {
  demographic: "Data demografi pasien",
  clinical: "Catatan klinis (adendum RME)",
};

export const RESTRICTION_PURPOSES = ["marketing_wa", "publication"] as const;
export type RestrictionPurpose = (typeof RESTRICTION_PURPOSES)[number];
export const RESTRICTION_PURPOSE_LABEL: Record<RestrictionPurpose, string> = {
  marketing_wa: "Promosi WhatsApp",
  publication: "Publikasi / testimoni",
};

export const CHANNELS = ["in_person", "paper", "whatsapp", "phone", "email"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABEL: Record<Channel, string> = {
  in_person: "Langsung di klinik",
  paper: "Formulir tertulis",
  whatsapp: "WhatsApp",
  phone: "Telepon",
  email: "Email",
};

export const REQUESTERS = ["patient", "guardian", "representative"] as const;
export type Requester = (typeof REQUESTERS)[number];
export const REQUESTER_LABEL: Record<Requester, string> = {
  patient: "Pasien",
  guardian: "Wali",
  representative: "Kuasa",
};

export const IDENTITY_METHODS = ["ktp_in_person", "ktp_video", "guardian_document", "power_of_attorney"] as const;
export type IdentityMethod = (typeof IDENTITY_METHODS)[number];
export const IDENTITY_METHOD_LABEL: Record<IdentityMethod, string> = {
  ktp_in_person: "KTP langsung di klinik",
  ktp_video: "KTP melalui panggilan video",
  guardian_document: "Dokumen perwalian resmi",
  power_of_attorney: "Surat kuasa tertulis & KTP kuasa",
};

export function identityMethodFits(requester: Requester, method: IdentityMethod): boolean {
  if (requester === "patient") return method === "ktp_in_person" || method === "ktp_video";
  if (requester === "guardian") return method === "guardian_document";
  return method === "power_of_attorney";
}

export const STATES = ["received", "in_progress", "closed"] as const;
export type State = (typeof STATES)[number];

export const OUTCOMES = ["fulfilled", "partially_fulfilled", "refused", "withdrawn"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_BASES = [
  "fulfilled_delivered",
  "fulfilled_corrected",
  "fulfilled_consent_withdrawn",
  "fulfilled_restricted",
  "partial_medical_record_retention_pmk24_2022",
  "partial_demographic_edit_pending",
  "partial_subset_applied",
  "refused_medical_record_retention_pmk24_2022",
  "refused_statutory_tax_accounting_retention",
  "refused_demographic_edit_unavailable",
  "refused_unverifiable_or_unauthorized",
  "refused_no_matching_data",
  "withdrawn_by_requester",
] as const;
export type OutcomeBasisCode = (typeof OUTCOME_BASES)[number];
export const OUTCOME_BASIS_LABEL: Record<OutcomeBasisCode, string> = {
  fulfilled_delivered: "Salinan data telah diserahkan kepada pemohon terverifikasi",
  fulfilled_corrected: "Koreksi klinis (adendum RME) telah disetujui dan diterapkan",
  fulfilled_consent_withdrawn: "Penarikan persetujuan telah dicatat pada buku besar persetujuan",
  fulfilled_restricted: "Seluruh tujuan pemrosesan opsional yang diminta sudah tidak aktif",
  partial_medical_record_retention_pmk24_2022: "Sebagian dipenuhi (persetujuan opsional ditarik); rekam medis wajib disimpan sesuai Permenkes 24/2022",
  partial_demographic_edit_pending: "Sebagian dipenuhi; pembaruan data demografi menunggu alur koreksi demografi terpisah",
  partial_subset_applied: "Sebagian tujuan pemrosesan yang diminta telah diterapkan",
  refused_medical_record_retention_pmk24_2022: "Ditolak berdasarkan kewajiban penyimpanan rekam medis (Permenkes 24/2022)",
  refused_statutory_tax_accounting_retention: "Ditolak berdasarkan kewajiban penyimpanan data pajak dan akuntansi",
  refused_demographic_edit_unavailable: "Ditolak sementara; alur perubahan data demografi belum tersedia pada rilis ini",
  refused_unverifiable_or_unauthorized: "Ditolak karena pemohon tidak berwenang atau tidak dapat diverifikasi",
  refused_no_matching_data: "Ditolak karena tidak ditemukan data yang sesuai pada catatan klinik",
  withdrawn_by_requester: "Permintaan dibatalkan oleh pemohon",
};

export const LINK_KINDS = ["record_copy", "record_version", "record_correction", "consent_withdrawal"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];
export const LINK_KIND_LABEL: Record<LinkKind, string> = {
  record_copy: "Serah terima salinan RME",
  record_version: "Versi koreksi RME",
  record_correction: "Koreksi RME disetujui & diterapkan",
  consent_withdrawal: "Penarikan persetujuan",
};

export const DEADLINE_HOURS = 72;
const HOUR = 3_600_000;
export const DUE_SOON_HOURS = 24;

export const deadlineAt = (receivedAt: Date) => new Date(receivedAt.getTime() + DEADLINE_HOURS * HOUR);
export type Urgency = "overdue" | "due_soon" | "on_track" | "closed";

export function slaStopAt(r: { deliveryConfirmedAt: Date | null; closedAt: Date | null; outcome: Outcome | null }): Date | null {
  if (!r.closedAt) return null;
  return r.outcome === "withdrawn" ? r.closedAt : (r.deliveryConfirmedAt ?? r.closedAt);
}

// Strictly after the 72h deadline is overdue; at the exact deadline instant (<= 72h) it is on time.
export function urgency(r: { receivedAt: Date; closedAt: Date | null }, now: Date): Urgency {
  if (r.closedAt) return "closed";
  const left = deadlineAt(r.receivedAt).getTime() - now.getTime();
  if (left < 0) return "overdue";
  return left <= DUE_SOON_HOURS * HOUR ? "due_soon" : "on_track";
}

export const minutesLeft = (receivedAt: Date, now: Date) =>
  Math.floor((deadlineAt(receivedAt).getTime() - now.getTime()) / 60_000);

export function closedLate(r: { receivedAt: Date; deliveryConfirmedAt: Date | null; closedAt: Date | null; outcome: Outcome | null }): boolean {
  const stopped = slaStopAt(r);
  return !!stopped && stopped.getTime() > deadlineAt(r.receivedAt).getTime();
}

export type RequestLink = {
  id: string;
  kind: LinkKind;
  linkId: string;
  handoffRef: string | null;
  addressesRequest: boolean;
  clusterValid: boolean;
  purpose?: string | null;
  createdAt: Date;
};

export type RestrictionPurposeStatus = {
  purpose: RestrictionPurpose;
  status: "already_inactive" | "applied" | "still_active";
};

export type Request = {
  id: string;
  right: Right;
  correctionScope: CorrectionScope | null;
  requestedPurposes: RestrictionPurpose[] | null;
  requester: Requester;
  channel: Channel;
  patientId: string | null;
  receivedAt: Date;
  deadlineAt: Date;
  state: State;
  identityVerifiedAt: Date | null;
  identityMethod: IdentityMethod | null;
  assignedTo: string | null;
  assigneeActive: boolean;
  links: RequestLink[];
  outcome: Outcome | null;
  outcomeBasisCode: OutcomeBasisCode | null;
  outcomeNote: string | null;
  deliveryChannel: Channel | null;
  deliveryConfirmedAt: Date | null;
  deliveryRef: string | null;
  withdrawalSource: Channel | null;
  withdrawalAttestation: string | null;
  closedAt: Date | null;
};

export type Refusal =
  | "identity_unverified"
  | "identity_method"
  | "closed"
  | "outcome_required"
  | "basis_required"
  | "delivery_required"
  | "withdrawal_required"
  | "chronology_invalid"
  | "link_required"
  | "cluster_changed"
  | "clinical_retention"
  | "demographic_unavailable"
  | "restriction_still_active"
  | "not_found";

export type Check = { ok: true } | { ok: false; reason: Refusal };
const no = (reason: Refusal): Check => ({ ok: false, reason });
const yes: Check = { ok: true };

export function canProgress(r: Pick<Request, "state" | "identityVerifiedAt">): Check {
  if (r.state === "closed") return no("closed");
  return r.identityVerifiedAt ? yes : no("identity_unverified");
}

export function canVerify(r: Pick<Request, "state" | "requester">, method: IdentityMethod): Check {
  if (r.state === "closed") return no("closed");
  return identityMethodFits(r.requester, method) ? yes : no("identity_method");
}

export function allowedLinkKinds(r: Pick<Request, "right" | "correctionScope">): readonly LinkKind[] {
  switch (r.right) {
    case "access": return ["record_copy"];
    case "correction": return r.correctionScope === "clinical" ? ["record_version", "record_correction"] : [];
    case "consent_withdrawal":
    case "restriction":
    case "erasure":
      return ["consent_withdrawal"];
  }
}

export function canLink(r: Pick<Request, "state" | "identityVerifiedAt" | "right" | "correctionScope">, kind: LinkKind): Check {
  const p = canProgress(r);
  if (!p.ok) return p;
  if (r.right === "correction" && r.correctionScope === "demographic") return no("demographic_unavailable");
  return allowedLinkKinds(r).includes(kind) ? yes : no("link_required");
}

// D3: Clinical, financial, and identity records are NEVER deleted (even with zero clinical history).
export const RETENTION_BASIS = "Rekam medis dan catatan hukum tidak dihapus (Permenkes 24/2022 & kewajiban retensi). Hanya persetujuan opsional (promosi WhatsApp / publikasi) yang dapat ditarik.";

export function erasurePlan(hasClinicalRecords: boolean): {
  optionalPurposes: readonly RestrictionPurpose[];
  retained: readonly string[];
  recommendedOutcome: "partially_fulfilled" | "refused";
  basis: string;
} {
  return {
    optionalPurposes: RESTRICTION_PURPOSES,
    retained: hasClinicalRecords ? ["identitas", "rekam_medis", "tagihan_dan_pembayaran"] : ["identitas", "riwayat_administrasi"],
    recommendedOutcome: "partially_fulfilled",
    basis: RETENTION_BASIS,
  };
}

export type CloseInput = {
  outcome: Outcome | null;
  basisCode: OutcomeBasisCode | null;
  deliveryChannel?: Channel | null;
  deliveryConfirmedAt?: Date | null;
  deliveryRef?: string | null;
  withdrawalSource?: Channel | null;
  withdrawalAttestation?: string | null;
  now?: Date;
  restrictionStatuses?: readonly RestrictionPurposeStatus[];
};

export function canClose(r: Request, o: CloseInput): Check {
  if (r.state === "closed") return no("closed");
  if (!o.outcome) return no("outcome_required");
  if (!o.basisCode) return no("basis_required");

  if (o.outcome === "withdrawn") {
    if (o.basisCode !== "withdrawn_by_requester") return no("basis_required");
    if (!o.withdrawalSource || (o.withdrawalAttestation ?? "").trim().length < 5) return no("withdrawal_required");
    return yes;
  }

  if (!r.identityVerifiedAt) return no("identity_unverified");
  if (!o.deliveryChannel || !o.deliveryConfirmedAt || !Number.isFinite(o.deliveryConfirmedAt.getTime()) || (o.deliveryRef ?? "").trim().length < 3) {
    return no("delivery_required");
  }
  const now = o.now ?? new Date();
  if (
    o.deliveryConfirmedAt.getTime() < r.identityVerifiedAt.getTime()
    || r.identityVerifiedAt.getTime() < r.receivedAt.getTime()
    || o.deliveryConfirmedAt.getTime() > now.getTime()
  ) {
    return no("chronology_invalid");
  }

  if (r.links.some((l) => !l.clusterValid)) return no("cluster_changed");

  // D3: erasure is NEVER 'fulfilled' even with zero retained history.
  if (r.right === "erasure") {
    if (o.outcome === "fulfilled") return no("clinical_retention");
    if (o.outcome === "partially_fulfilled" && !r.links.some((l) => l.kind === "consent_withdrawal" && l.clusterValid)) {
      return no("link_required");
    }
    return yes;
  }

  // Finding #1: demographic correction cannot close 'fulfilled' until D2 demographic-edit lands.
  if (r.right === "correction" && r.correctionScope === "demographic") {
    if (o.outcome === "fulfilled") return no("demographic_unavailable");
    return yes;
  }

  if (o.outcome === "refused") return yes;

  if (r.right === "restriction") {
    const statuses = o.restrictionStatuses ?? [];
    if (o.outcome === "fulfilled") {
      if (statuses.length === 0 || statuses.some((s) => s.status === "still_active")) return no("restriction_still_active");
    } else if (o.outcome === "partially_fulfilled") {
      if (!statuses.some((s) => s.status !== "still_active")) return no("restriction_still_active");
    }
    return yes;
  }

  const allowed = allowedLinkKinds(r);
  if (allowed.length > 0 && !r.links.some((l) => allowed.includes(l.kind) && l.clusterValid)) {
    return no("link_required");
  }
  return yes;
}

const ORDER: State[] = ["received", "in_progress", "closed"];
export const canMove = (from: State, to: State) => from !== "closed" && ORDER.indexOf(to) > ORDER.indexOf(from);

export const REFUSAL_COPY: Record<Refusal, string> = {
  identity_unverified: "Identitas pemohon belum diverifikasi",
  identity_method: "Cara verifikasi tidak sesuai pemohon. Wali perlu dokumen perwalian; kuasa perlu surat kuasa.",
  closed: "Permintaan sudah ditutup.",
  outcome_required: "Pilih hasil permintaan.",
  basis_required: "Pilih dasar hukum / alasan terstruktur yang sesuai hasil permintaan.",
  delivery_required: "Lengkapi saluran, waktu konfirmasi, dan referensi serah terima sebelum menutup.",
  withdrawal_required: "Untuk pembatalan pemohon, isi saluran dan catatan konfirmasi pembatalan (minimal 5 huruf).",
  chronology_invalid: "Urutan waktu tidak sah: diterima ≤ verifikasi identitas ≤ konfirmasi serah terima ≤ sekarang.",
  link_required: "Tautkan bukti pemenuhan yang sah sebelum menutup permintaan.",
  cluster_changed: "Sebagian bukti tertaut tidak lagi termasuk klaster pasien saat ini setelah pemisahan gabungan. Tinjau ulang sebelum menutup.",
  clinical_retention: "Data pasien dan rekam medis tidak dihapus (Permenkes 24/2022). Tutup sebagai sebagian dipenuhi (penarikan persetujuan opsional) atau ditolak dengan dasar penyimpanan.",
  demographic_unavailable: "Perbaikan data demografi belum tersedia pada rilis ini; tidak dapat ditutup sebagai dipenuhi melalui tautan klinis.",
  restriction_still_active: "Masih ada persetujuan aktif pada tujuan yang diminta pembatasannya. Tarik persetujuan terkait terlebih dahulu.",
  not_found: "Permintaan tidak ditemukan.",
};
