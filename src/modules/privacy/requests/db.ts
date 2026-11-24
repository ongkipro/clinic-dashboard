// Server database adapters for Data-Subject Requests (PR-50, UX-30 ▸ Permintaan; T-121, migration 0134).
// Every call runs inside withTenantContext; the database enforces privacy_actor('data_request'),
// SQL-level input-digest idempotency, merge-cluster revalidation, D3/D4/correction rules, and zero raw SELECT.
import type pg from "pg";
import { CommandError, type ErrorCode } from "../../../lib/command";
import type {
  Channel,
  CorrectionScope,
  IdentityMethod,
  LinkKind,
  Outcome,
  OutcomeBasisCode,
  Requester,
  Request,
  RequestLink,
  RestrictionPurpose,
  RestrictionPurposeStatus,
  Right,
  State,
} from "./requests";

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set([
  "ERR_FORBIDDEN",
  "ERR_NOT_FOUND",
  "ERR_INVALID_INPUT",
  "ERR_VERSION_CONFLICT",
  "ERR_TENANT_SUSPENDED",
  "ERR_IDEMPOTENCY_CONFLICT",
  "ERR_IMMUTABLE",
]);

export class DsrError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CommandError) throw e;
    const msg = (e as { message?: string }).message ?? "";
    const m = CODE.exec(msg);
    if (m && KNOWN.has(m[1])) throw new DsrError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}

const d = (x: unknown): Date | null => (x ? new Date(x as string) : null);

export type DsrListRow = {
  id: string;
  right: Right;
  correctionScope: CorrectionScope | null;
  requestedPurposes: RestrictionPurpose[] | null;
  requester: Requester;
  channel: Channel;
  receivedAt: Date;
  deadlineAt: Date;
  state: State;
  identityVerifiedAt: Date | null;
  outcome: Outcome | null;
  outcomeBasisCode: OutcomeBasisCode | null;
  deliveryConfirmedAt: Date | null;
  closedAt: Date | null;
  mrn: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeActive: boolean;
};

export type DsrListResult = {
  now: Date;
  rows: DsrListRow[];
};

export type DsrOfficerOption = {
  staffId: string;
  displayName: string;
  role: "owner" | "admin_pusat";
};

export type DsrDetail = Request & {
  now: Date;
  mrn: string | null;
  assigneeName: string | null;
  hasClinicalRecords: boolean;
  restrictionStatuses: RestrictionPurposeStatus[];
  officers: DsrOfficerOption[];
};

export type DsrLinkOptions = {
  recordCopies: { id: string; requestedAt: Date; recordCount: number; handoffRef: string; handedOffAt: Date }[];
  unconfirmedRecordCopies: { id: string; requestedAt: Date; recordCount: number }[];
  recordVersions: { id: string; version: number; createdAt: Date }[];
  recordCorrections: { id: string; decidedAt: Date | null; versionId: string }[];
  consentWithdrawals: { id: string; purpose: string; withdrawnAt: Date }[];
};

export async function confirmCopyHandoff(
  db: pg.ClientBase,
  requestId: string,
  input: { copyRequestId: string; artifactSha256: string; channel: Channel; handedOffAt: Date; handoffRef: string },
): Promise<string> {
  return (
    await call(() =>
      db.query<{ id: string }>(
        `select public.dsr_confirm_copy_handoff($1, $2, $3, $4, $5, $6) as id`,
        [requestId, input.copyRequestId, input.artifactSha256, input.channel, input.handedOffAt, input.handoffRef],
      ),
    )
  ).rows[0].id;
}

export async function logDsr(
  db: pg.ClientBase,
  key: string,
  input: {
    patientId: string | null;
    requester: Requester;
    right: Right;
    channel: Channel;
    receivedAt: Date;
    correctionScope?: CorrectionScope | null;
    requestedPurposes?: RestrictionPurpose[] | null;
  },
): Promise<{ id: string; replayed: boolean }> {
  const r = (
    await call(() =>
      db.query<{ r: { id: string; replayed: boolean } }>(
        `select public.dsr_log($1, $2, $3, $4, $5, $6, $7, $8) as r`,
        [
          key,
          input.patientId,
          input.requester,
          input.right,
          input.channel,
          input.receivedAt,
          input.correctionScope ?? null,
          input.requestedPurposes ?? null,
        ],
      ),
    )
  ).rows[0].r;
  return { id: r.id, replayed: r.replayed };
}

export async function bindDsrSubject(db: pg.ClientBase, id: string, patientId: string): Promise<void> {
  await call(() => db.query(`select public.dsr_bind_subject($1, $2)`, [id, patientId]));
}

export async function verifyDsrIdentity(db: pg.ClientBase, id: string, method: IdentityMethod): Promise<void> {
  await call(() => db.query(`select public.dsr_verify($1, $2)`, [id, method]));
}

export async function assignDsr(db: pg.ClientBase, id: string, staffId: string | null): Promise<void> {
  await call(() => db.query(`select public.dsr_assign($1, $2)`, [id, staffId]));
}

export async function linkDsrEvidence(
  db: pg.ClientBase,
  id: string,
  input: { kind: LinkKind; linkId: string; handoffRef?: string | null; addressesRequest?: boolean },
): Promise<string> {
  return (
    await call(() =>
      db.query<{ id: string }>(
        `select public.dsr_link($1, $2, $3, $4, $5) as id`,
        [id, input.kind, input.linkId, input.handoffRef ?? null, input.addressesRequest ?? false],
      ),
    )
  ).rows[0].id;
}

export async function closeDsr(
  db: pg.ClientBase,
  id: string,
  input: {
    outcome: Outcome;
    basisCode: OutcomeBasisCode;
    note?: string | null;
    deliveryChannel?: Channel | null;
    deliveryConfirmedAt?: Date | null;
    deliveryRef?: string | null;
    withdrawalSource?: Channel | null;
    withdrawalAttestation?: string | null;
  },
): Promise<void> {
  await call(() =>
    db.query(`select public.dsr_close($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
      id,
      input.outcome,
      input.basisCode,
      input.note ?? null,
      input.deliveryChannel ?? null,
      input.deliveryConfirmedAt ?? null,
      input.deliveryRef ?? null,
      input.withdrawalSource ?? null,
      input.withdrawalAttestation ?? null,
    ]),
  );
}

export async function listDsrs(
  db: pg.ClientBase,
  filter: { state?: "open" | "closed" | "all"; right?: Right | null } = {},
): Promise<DsrListResult> {
  const raw = (
    await call(() =>
      db.query<{ r: { now: string; rows: Record<string, unknown>[] } }>(
        `select public.dsr_list($1, $2) as r`,
        [filter.state ?? "all", filter.right ?? null],
      ),
    )
  ).rows[0].r;
  return {
    now: new Date(raw.now),
    rows: raw.rows.map((x) => ({
      id: x.id as string,
      right: x.right as Right,
      correctionScope: (x.correction_scope as CorrectionScope | null) ?? null,
      requestedPurposes: (x.requested_purposes as RestrictionPurpose[] | null) ?? null,
      requester: x.requester_kind as Requester,
      channel: x.channel as Channel,
      receivedAt: new Date(x.received_at as string),
      deadlineAt: new Date(x.deadline_at as string),
      state: x.state as State,
      identityVerifiedAt: d(x.identity_verified_at),
      outcome: (x.outcome as Outcome | null) ?? null,
      outcomeBasisCode: (x.outcome_basis_code as OutcomeBasisCode | null) ?? null,
      deliveryConfirmedAt: d(x.delivery_confirmed_at),
      closedAt: d(x.closed_at),
      mrn: (x.mrn as string | null) ?? null,
      assigneeId: (x.assignee_id as string | null) ?? null,
      assigneeName: (x.assignee_name as string | null) ?? null,
      assigneeActive: Boolean(x.assignee_active),
    })),
  };
}

export async function getDsr(db: pg.ClientBase, id: string): Promise<DsrDetail> {
  const raw = (await call(() => db.query<{ r: Record<string, unknown> }>(`select public.dsr_get($1) as r`, [id]))).rows[0].r;
  return {
    now: new Date(raw.now as string),
    id: raw.id as string,
    right: raw.right as Right,
    correctionScope: (raw.correction_scope as CorrectionScope | null) ?? null,
    requestedPurposes: (raw.requested_purposes as RestrictionPurpose[] | null) ?? null,
    requester: raw.requester_kind as Requester,
    channel: raw.channel as Channel,
    patientId: (raw.patient_id as string | null) ?? null,
    mrn: (raw.mrn as string | null) ?? null,
    receivedAt: new Date(raw.received_at as string),
    deadlineAt: new Date(raw.deadline_at as string),
    state: raw.state as State,
    identityVerifiedAt: d(raw.identity_verified_at),
    identityMethod: (raw.identity_method as IdentityMethod | null) ?? null,
    assignedTo: (raw.assigned_to as string | null) ?? null,
    assigneeName: (raw.assignee_name as string | null) ?? null,
    assigneeActive: Boolean(raw.assignee_active),
    hasClinicalRecords: Boolean(raw.has_clinical_records),
    restrictionStatuses: ((raw.restriction_statuses as Record<string, unknown>[]) ?? []).map((s) => ({
      purpose: s.purpose as RestrictionPurpose,
      status: s.status as RestrictionPurposeStatus["status"],
    })),
    links: ((raw.links as Record<string, unknown>[]) ?? []).map(
      (l): RequestLink => ({
        id: l.id as string,
        kind: l.link_kind as LinkKind,
        linkId: l.link_id as string,
        handoffRef: (l.handoff_ref as string | null) ?? null,
        addressesRequest: Boolean(l.addresses_request),
        clusterValid: Boolean(l.cluster_valid),
        purpose: (l.purpose as string | null) ?? null,
        createdAt: new Date(l.created_at as string),
      }),
    ),
    outcome: (raw.outcome as Outcome | null) ?? null,
    outcomeBasisCode: (raw.outcome_basis_code as OutcomeBasisCode | null) ?? null,
    outcomeNote: (raw.outcome_note as string | null) ?? null,
    deliveryChannel: (raw.delivery_channel as Channel | null) ?? null,
    deliveryConfirmedAt: d(raw.delivery_confirmed_at),
    deliveryRef: (raw.delivery_ref as string | null) ?? null,
    withdrawalSource: (raw.withdrawal_source as Channel | null) ?? null,
    withdrawalAttestation: (raw.withdrawal_attestation as string | null) ?? null,
    closedAt: d(raw.closed_at),
    officers: ((raw.officers as Record<string, unknown>[]) ?? []).map((o) => ({
      staffId: o.staff_id as string,
      displayName: o.display_name as string,
      role: o.role as "owner" | "admin_pusat",
    })),
  };
}

export async function getDsrLinkOptions(db: pg.ClientBase, id: string): Promise<DsrLinkOptions> {
  const raw = (await call(() => db.query<{ r: Record<string, Record<string, unknown>[]> }>(`select public.dsr_link_options($1) as r`, [id]))).rows[0].r;
  return {
    recordCopies: (raw.record_copies ?? []).map((x) => ({
      id: x.id as string,
      requestedAt: new Date(x.requested_at as string),
      recordCount: Number(x.record_count),
      handoffRef: x.handoff_ref as string,
      handedOffAt: new Date(x.handed_off_at as string),
    })),
    unconfirmedRecordCopies: (raw.unconfirmed_record_copies ?? []).map((x) => ({
      id: x.id as string,
      requestedAt: new Date(x.requested_at as string),
      recordCount: Number(x.record_count),
    })),
    recordVersions: (raw.record_versions ?? []).map((x) => ({
      id: x.id as string,
      version: Number(x.version),
      createdAt: new Date(x.created_at as string),
    })),
    recordCorrections: (raw.record_corrections ?? []).map((x) => ({
      id: x.id as string,
      decidedAt: d(x.decided_at),
      versionId: x.version_id as string,
    })),
    consentWithdrawals: (raw.consent_withdrawals ?? []).map((x) => ({
      id: x.id as string,
      purpose: x.purpose as string,
      withdrawnAt: new Date(x.withdrawn_at as string),
    })),
  };
}
