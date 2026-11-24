// T-121 (PR-50, PRIV-2, UX-30 ▸ Permintaan; R3) — Pure domain rules + PostgreSQL integration tests
// proving Scenario PR-50 and closing all 8 findings of t121/PLAN-REVIEW-codex-panel3.md.
// Synthetic data only (MIG-2).
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, OPERATOR_GROUP_ROLE, VENDOR_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { grantConsent, publishConsentText, withdrawConsent } from "../../src/modules/patients/consents/consents";
import { mergePatients, unmergePatients } from "../../src/modules/patients/merge/merge";
import {
  assignDsr,
  bindDsrSubject,
  canClose,
  canLink,
  canProgress,
  canVerify,
  closedLate,
  closeDsr,
  confirmCopyHandoff,
  deadlineAt,
  DsrError,
  getDsr,
  getDsrLinkOptions,
  linkDsrEvidence,
  listDsrs,
  logDsr,
  minutesLeft,
  slaStopAt,
  urgency,
  verifyDsrIdentity,
  type Request,
} from "../../src/modules/privacy/requests";
import { bootstrapVendor, createVendorStaff } from "../../src/modules/vendor/staff/staff";
import { openSession, withSupportSession } from "../../src/modules/vendor/support/support";
import { createHarness, type Harness, testClient, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local";

const mkReq = (over: Partial<Request> = {}): Request => {
  const receivedAt = new Date("2026-11-20T02:00:00Z"); // 09:00 WIB
  return {
    id: "00000000-0000-7000-8000-000000000001",
    right: "access",
    correctionScope: null,
    requestedPurposes: null,
    requester: "patient",
    channel: "in_person",
    patientId: "00000000-0000-7000-8000-000000000010",
    receivedAt,
    deadlineAt: deadlineAt(receivedAt),
    state: "in_progress",
    identityVerifiedAt: new Date("2026-11-20T03:00:00Z"),
    identityMethod: "ktp_in_person",
    assignedTo: null,
    assigneeActive: true,
    links: [],
    outcome: null,
    outcomeBasisCode: null,
    outcomeNote: null,
    deliveryChannel: null,
    deliveryConfirmedAt: null,
    deliveryRef: null,
    withdrawalSource: null,
    withdrawalAttestation: null,
    closedAt: null,
    ...over,
  };
};

// ── 1. Pure domain rules (72h boundary, SLA stop, D3/D4, demographic correction) ─────────────
describe("T-121 pure domain rules", () => {
  it("enforces exact 72h deadline boundaries (-1s, =0, +1s) and SLA stop event", () => {
    const t0 = new Date("2026-11-20T02:00:00.000Z");
    const due = deadlineAt(t0);
    expect(due.toISOString()).toBe("2026-11-23T02:00:00.000Z");

    const minus1s = new Date(due.getTime() - 1000);
    const plus1s = new Date(due.getTime() + 1000);
    expect(urgency({ receivedAt: t0, closedAt: null }, minus1s)).toBe("due_soon");
    expect(urgency({ receivedAt: t0, closedAt: null }, due)).toBe("due_soon");
    expect(urgency({ receivedAt: t0, closedAt: null }, plus1s)).toBe("overdue");
    expect(minutesLeft(t0, due)).toBe(0);
    expect(minutesLeft(t0, plus1s)).toBe(-1);

    // Non-withdrawn SLA stops at deliveryConfirmedAt (even if closedAt is recorded later)
    const deliveredOnTime = { receivedAt: t0, deliveryConfirmedAt: due, closedAt: plus1s, outcome: "fulfilled" as const };
    expect(slaStopAt(deliveredOnTime)).toEqual(due);
    expect(closedLate(deliveredOnTime)).toBe(false);
    expect(closedLate({ receivedAt: t0, deliveryConfirmedAt: plus1s, closedAt: plus1s, outcome: "fulfilled" })).toBe(true);
    // Withdrawn SLA stops at closedAt
    expect(closedLate({ receivedAt: t0, deliveryConfirmedAt: null, closedAt: plus1s, outcome: "withdrawn" })).toBe(true);
  });

  it("enforces D3 erasure never fulfilled, demographic correction refusal, and verification gating", () => {
    const unverified = mkReq({ state: "received", identityVerifiedAt: null, identityMethod: null });
    expect(canProgress(unverified)).toEqual({ ok: false, reason: "identity_unverified" });
    expect(canVerify(unverified, "guardian_document")).toEqual({ ok: false, reason: "identity_method" });
    expect(canVerify(unverified, "ktp_in_person")).toEqual({ ok: true });

    const erasure = mkReq({ right: "erasure" });
    expect(
      canClose(erasure, {
        outcome: "fulfilled",
        basisCode: "fulfilled_delivered",
        deliveryChannel: "in_person",
        deliveryConfirmedAt: new Date("2026-11-20T04:00:00Z"),
        deliveryRef: "REF-1",
        now: new Date("2026-11-20T05:00:00Z"),
      }),
    ).toEqual({ ok: false, reason: "clinical_retention" });

    const demoCorr = mkReq({ right: "correction", correctionScope: "demographic" });
    expect(canLink(demoCorr, "record_version")).toEqual({ ok: false, reason: "demographic_unavailable" });
    expect(
      canClose(demoCorr, {
        outcome: "fulfilled",
        basisCode: "fulfilled_corrected",
        deliveryChannel: "in_person",
        deliveryConfirmedAt: new Date("2026-11-20T04:00:00Z"),
        deliveryRef: "REF-2",
        now: new Date("2026-11-20T05:00:00Z"),
      }),
    ).toEqual({ ok: false, reason: "demographic_unavailable" });
  });
});

// ── 2. PostgreSQL integration tests (Scenario PR-50 + Findings #1–#8) ────────────────────────
describe("T-121 PostgreSQL data-subject requests (PR-50 + Findings #1–#8)", () => {
  let h: Harness;
  let app: pg.Pool;
  let owner: pg.Pool;
  let consoleDb: pg.Pool;
  let opDb: pg.Pool;
  let vendorClient: pg.Client;
  let operatorClient: pg.Client;
  let supportTok: string;
  let n = 0;
  const VENDOR_IP = "203.0.113.10";

  type P = { acc: string; staffId: string; tenantId: string; role: Role; branchId?: string };
  type T = {
    tenantId: string;
    branchId: string;
    own: P;
    apDuty: P;
    apPlain: P;
    fo: P;
    ro: P;
    doc: P;
    texts: Record<"clinical_photo" | "marketing_wa" | "publication", string>;
  };
  let A: T;
  let B: T;

  const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
    withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branchId }), fn);
  const errCode = (p: Promise<unknown>) =>
    p.then(() => "ok", (e) => (e instanceof DsrError ? `${e.code}:${e.reason ?? ""}` : `raw:${(e as { code?: string; message?: string }).code ?? (e as Error).message}`));

  async function setupTenant(prefix: string): Promise<T> {
    const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
    await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, `PT DSR ${prefix}`]);
    const branchId = (await h.admin.query(
      `insert into branches (tenant_id, code, name, timezone) values ($1, $2, $3, 'Asia/Jakarta') returning id`,
      [tenantId, `${prefix}1`, `Cabang ${prefix}`],
    )).rows[0].id as string;

    const add = async (role: Role, bindBranch = false, withDpDuty = false): Promise<P> => {
      const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ($1, $2, true) returning id`, [`U${++n}`, `dsr_${n}@sintetis.test`])).rows[0].id as string;
      const { staffId } = await createMembership(owner, { tenantId, accountId: acc, displayName: `Staf ${prefix} ${role} ${n}` });
      const rid = await assignRole(h.admin, { tenantId, staffId, role });
      if (bindBranch) await assignBranch(h.admin, { tenantId, staffRoleId: rid, branchId });
      if (withDpDuty) {
        await h.admin.query(
          `insert into staff_duties (tenant_id, staff_id, duty, assigned_by) values ($1, $2, 'data_protection', $2)`,
          [tenantId, staffId],
        );
      }
      return { acc, staffId, tenantId, role, branchId: bindBranch ? branchId : undefined };
    };

    const own = await add("owner");
    const apDuty = await add("admin_pusat", false, true);
    const apPlain = await add("admin_pusat", false, false);
    const fo = await add("fo_cashier", true);
    const ro = await add("records_officer", true);
    const doc = await add("doctor", true);

    const texts = {} as Record<"clinical_photo" | "marketing_wa" | "publication", string>;
    for (const purpose of ["clinical_photo", "marketing_wa", "publication"] as const) {
      const pub = await as(own, (db) => publishConsentText(db, { purpose, body: `Teks persetujuan ${purpose} sintetis untuk uji DSR T-121.` }));
      texts[purpose] = pub.id;
    }
    return { tenantId, branchId, own, apDuty, apPlain, fo, ro, doc, texts };
  }

  async function seedPatient(t: T, name: string): Promise<{ id: string; mrn: string }> {
    const r = (await h.admin.query<{ id: string; mrn: string }>(
      `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
       select $1, 'RM-' || lpad((count(*) + 1)::text, 6, '0'), $2, '1991-05-12', 'female', 'newborn_via_guardian', 'Sintetis', 'islam', 'Karyawan', 's1', 'kawin', $3, $4, 'fo_cashier'
         from patients where tenant_id = $1 returning id, mrn`,
      [t.tenantId, name, t.branchId, t.fo.staffId],
    )).rows[0];
    return r;
  }

  async function seedSignedExamAndCorrection(t: T, patientId: string): Promise<{ examId: string; origVersionId: string; corrVersionId: string; pendingCorrId: string; approvedCorrId: string; copyReqId: string }> {
    const visitId = (await h.admin.query<{ id: string }>(
      `insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by)
       values ($1, $2, $3, 'walk_in', $4) returning id`,
      [t.tenantId, t.branchId, patientId, t.fo.staffId],
    )).rows[0].id;
    const examId = (await h.admin.query<{ id: string }>(
      `insert into examinations (tenant_id, branch_id, visit_id, patient_id, author_id, state, subjective)
       values ($1, $2, $3, $4, $5, 'draft', 'RAHASIA_KLINIS_SENTINEL') returning id`,
      [t.tenantId, t.branchId, visitId, patientId, t.doc.staffId],
    )).rows[0].id;
    await h.admin.query(
      `update examinations set state = 'signed', signed_at = clock_timestamp(), signed_by = $2, signed_as = 'doctor', content_hash = repeat('a', 64) where id = $1`,
      [examId, t.doc.staffId],
    );
    const origVersionId = (await h.admin.query<{ id: string }>(
      `insert into record_versions (tenant_id, branch_id, examination_id, version, kind, content, content_hash, created_by, created_as)
       values ($1, $2, $3, 1, 'original', '{"s":"RAHASIA_KLINIS_SENTINEL"}'::jsonb, repeat('a', 64), $4, 'doctor') returning id`,
      [t.tenantId, t.branchId, examId, t.doc.staffId],
    )).rows[0].id;
    const corrVersionId = (await h.admin.query<{ id: string }>(
      `insert into record_versions (tenant_id, branch_id, examination_id, version, kind, content, content_hash, delta, reason, created_by, created_as)
       values ($1, $2, $3, 2, 'correction', '{"s":"adendum"}'::jsonb, repeat('b', 64), '{"s":"adendum"}'::jsonb, 'Adendum atas permintaan pasien', $4, 'doctor') returning id`,
      [t.tenantId, t.branchId, examId, t.doc.staffId],
    )).rows[0].id;

    // Seed one approved+applied correction first, then one pending correction (respecting record_corrections_one_pending)
    const approvedCorrId = crypto.randomUUID();
    const ap2 = (await h.admin.query<{ id: string }>(
      `insert into approvals (tenant_id, branch_id, type, subject_kind, subject_id, state, requested_by, requested_as, decided_by, decided_as, decided_at)
       values ($1, $2, 'record_late_correction', 'record_correction', $3, 'approved', $4, 'doctor', $5, 'records_officer', clock_timestamp()) returning id`,
      [t.tenantId, t.branchId, approvedCorrId, t.doc.staffId, t.ro.staffId],
    )).rows[0].id;
    await h.admin.query(
      `insert into record_corrections (id, tenant_id, branch_id, examination_id, delta, reason, state, approval_id, requested_by, requested_as)
       values ($1, $2, $3, $4, '{"s":"adendum disetujui"}'::jsonb, 'Koreksi disetujui', 'pending', $5, $6, 'doctor')`,
      [approvedCorrId, t.tenantId, t.branchId, examId, ap2, t.doc.staffId],
    );
    await h.admin.query(
      `update record_corrections set state = 'approved', decided_at = clock_timestamp(), version_id = $2 where id = $1`,
      [approvedCorrId, corrVersionId],
    );

    const pendingCorrId = crypto.randomUUID();
    const ap1 = (await h.admin.query<{ id: string }>(
      `insert into approvals (tenant_id, branch_id, type, subject_kind, subject_id, state, requested_by, requested_as)
       values ($1, $2, 'record_late_correction', 'record_correction', $3, 'pending', $4, 'doctor') returning id`,
      [t.tenantId, t.branchId, pendingCorrId, t.doc.staffId],
    )).rows[0].id;
    await h.admin.query(
      `insert into record_corrections (id, tenant_id, branch_id, examination_id, delta, reason, state, approval_id, requested_by, requested_as)
       values ($1, $2, $3, $4, '{"s":"belum disetujui"}'::jsonb, 'Koreksi pending', 'pending', $5, $6, 'doctor')`,
      [pendingCorrId, t.tenantId, t.branchId, examId, ap1, t.doc.staffId],
    );

    const copyReqId = (await h.admin.query<{ id: string }>(
      `insert into record_copy_requests (tenant_id, branch_id, patient_id, record_count, reason, requested_by, requested_as, requested_at)
       values ($1, $2, $3, 1, 'Salinan rekam medis untuk pasien', $4, 'records_officer', clock_timestamp() - interval '1 hour') returning id`,
      [t.tenantId, t.branchId, patientId, t.ro.staffId],
    )).rows[0].id;

    return { examId, origVersionId, corrVersionId, pendingCorrId, approvedCorrId, copyReqId };
  }

  beforeAll(async () => {
    h = await createHarness();
    app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 8 });
    owner = testPool({ connectionString: h.ownerUrl(), max: 3 });
    consoleDb = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [VENDOR_GROUP_ROLE])), max: 3 }, VENDOR_GROUP_ROLE);
    opDb = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [OPERATOR_GROUP_ROLE])), max: 3 }, OPERATOR_GROUP_ROLE);
    vendorClient = await h.connectAs(await h.createLoginRole("", [VENDOR_GROUP_ROLE]));
    operatorClient = await h.connectAs(await h.createLoginRole("", [OPERATOR_GROUP_ROLE]));

    const poAcc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('PO', 'po-dsr@vendor-sintetis.test', true) returning id`)).rows[0].id as string;
    const supAcc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('SUP', 'sup-dsr@vendor-sintetis.test', true) returning id`)).rows[0].id as string;
    const c = await owner.connect();
    try {
      await bootstrapVendor(c, poAcc, "Pemilik Platform", "203.0.113.0/24", "Kantor vendor");
      await createVendorStaff(c, { accountId: poAcc, ip: VENDOR_IP, mfaAt: new Date() }, supAcc, "Dukungan DSR", ["support"]);
    } finally {
      c.release();
    }
    supportTok = `tok_dsr_${randomBytes(12).toString("hex")}`;
    await h.admin.query(
      `insert into auth_session (user_id, token, expires_at, surface, second_factor_at) values ($1, $2, now() + interval '8 hours', 'vendor', now())`,
      [supAcc, supportTok],
    );

    A = await setupTenant("A");
    B = await setupTenant("B");
  }, 180_000);

  afterAll(async () => {
    await vendorClient?.end();
    await operatorClient?.end();
    await opDb?.end();
    await consoleDb?.end();
    await owner?.end();
    await app?.end();
    await h?.close();
  });

  it("Scenario PR-50 + Finding #4: full access lifecycle, unverified refusal, handoff_ref & delivery confirmation, attested withdrawal", async () => {
    const pt = await seedPatient(A, "Siti Rahasia Nama");
    const clinical = await seedSignedExamAndCorrection(A, pt.id);
    const received = new Date(Date.now() - 2 * 3_600_000);

    const { id } = await as(A.own, (db) =>
      logDsr(db, `dsr-pr50-${++n}`, { patientId: pt.id, requester: "patient", right: "access", channel: "in_person", receivedAt: received }),
    );

    // Unverified: cannot assign, confirm copy handoff, link, or close fulfilled (R3 r3 boundary check)
    expect(await errCode(as(A.own, (db) => assignDsr(db, id, A.apDuty.staffId)))).toBe("ERR_VERSION_CONFLICT:identity_unverified");
    expect(
      await errCode(as(A.own, (db) => confirmCopyHandoff(db, id, {
        copyRequestId: clinical.copyReqId,
        artifactSha256: "d".repeat(64),
        channel: "in_person",
        handedOffAt: new Date(),
        handoffRef: "SR-UNVERIFIED",
      }))),
    ).toBe("ERR_VERSION_CONFLICT:identity_unverified");
    expect(await errCode(as(A.own, (db) => linkDsrEvidence(db, id, { kind: "record_copy", linkId: clinical.copyReqId, handoffRef: "SR-001" })))).toBe("ERR_VERSION_CONFLICT:identity_unverified");
    expect(
      await errCode(as(A.own, (db) => closeDsr(db, id, {
        outcome: "fulfilled",
        basisCode: "fulfilled_delivered",
        deliveryChannel: "in_person",
        deliveryConfirmedAt: new Date(),
        deliveryRef: "TT-001",
      }))),
    ).toBe("ERR_VERSION_CONFLICT:identity_unverified");

    // Wrong verification method for patient refused; valid KTP passes
    expect(await errCode(as(A.own, (db) => verifyDsrIdentity(db, id, "guardian_document")))).toBe("ERR_INVALID_INPUT:identity_method");
    await as(A.own, (db) => verifyDsrIdentity(db, id, "ktp_in_person"));

    // R3 r1 P1-1 + Finding #4: a merely requested copy (no confirmed record_copy_handoffs row)
    // NEVER appears in dsr_link_options, is refused by dsr_link, and cannot close an access DSR!
    const optsBefore = await as(A.own, (db) => getDsrLinkOptions(db, id));
    expect(optsBefore.recordCopies.map((c) => c.id)).not.toContain(clinical.copyReqId);
    expect(optsBefore.unconfirmedRecordCopies.map((c) => c.id)).toContain(clinical.copyReqId);
    expect(await errCode(as(A.own, (db) => linkDsrEvidence(db, id, { kind: "record_copy", linkId: clinical.copyReqId })))).toBe("ERR_INVALID_INPUT:handoff_ref_required");
    expect(await errCode(as(A.own, (db) => linkDsrEvidence(db, id, { kind: "record_copy", linkId: clinical.copyReqId, handoffRef: "Tanda terima #SR-2026-01" })))).toBe("ERR_INVALID_INPUT:copy_handoff_unconfirmed");
    expect(
      await errCode(as(A.own, (db) => closeDsr(db, id, {
        outcome: "fulfilled",
        basisCode: "fulfilled_delivered",
        deliveryChannel: "in_person",
        deliveryConfirmedAt: new Date(),
        deliveryRef: "TT-UNCONFIRMED",
      }))),
    ).toBe("ERR_VERSION_CONFLICT:link_required");

    // 0-record copy request cannot be confirmed as an access artifact
    const zeroCopyId = (await h.admin.query<{ id: string }>(
      `insert into record_copy_requests (tenant_id, branch_id, patient_id, record_count, reason, requested_by, requested_as)
       values ($1, $2, $3, 0, 'Salinan kosong', $4, 'records_officer') returning id`,
      [A.tenantId, A.branchId, pt.id, A.ro.staffId],
    )).rows[0].id;
    expect(
      await errCode(as(A.own, (db) => confirmCopyHandoff(db, id, {
        copyRequestId: zeroCopyId,
        artifactSha256: "c".repeat(64),
        channel: "in_person",
        handedOffAt: new Date(),
        handoffRef: "SR-ZERO-01",
      }))),
    ).toBe("ERR_INVALID_INPUT:copy_handoff_unconfirmed");

    // R3 r3: Pre-verification handoff timestamp (after copy.requested_at = -1h, before identity_verified_at = now)
    // is rejected BEFORE writing record_copy_handoffs, leaving the copy available in unconfirmedRecordCopies!
    expect(
      await errCode(as(A.own, (db) => confirmCopyHandoff(db, id, {
        copyRequestId: clinical.copyReqId,
        artifactSha256: "d".repeat(64),
        channel: "in_person",
        handedOffAt: new Date(Date.now() - 30 * 60_000),
        handoffRef: "SR-PRE-VERIFY",
      }))),
    ).toBe("ERR_INVALID_INPUT:chronology_invalid");
    // Non-access DSR also refused without bricking the copy
    const { id: corrDsrId } = await as(A.own, (db) =>
      logDsr(db, `dsr-non-access-${++n}`, { patientId: pt.id, requester: "patient", right: "correction", correctionScope: "clinical", channel: "in_person", receivedAt: received }),
    );
    await as(A.own, (db) => verifyDsrIdentity(db, corrDsrId, "ktp_in_person"));
    expect(
      await errCode(as(A.own, (db) => confirmCopyHandoff(db, corrDsrId, {
        copyRequestId: clinical.copyReqId,
        artifactSha256: "d".repeat(64),
        channel: "in_person",
        handedOffAt: new Date(),
        handoffRef: "SR-WRONG-RIGHT",
      }))),
    ).toBe("ERR_INVALID_INPUT:link_invalid_for_request");
    // Verify copy is STILL unconfirmed and available for valid confirmation!
    expect((await as(A.own, (db) => getDsrLinkOptions(db, id))).unconfirmedRecordCopies.map((c) => c.id)).toContain(clinical.copyReqId);

    // Confirm real copy artifact SHA-256 + handoff (after identity verification); idempotent on exact replay, refuses mismatch
    const handoffAt = new Date();
    const hId1 = await as(A.own, (db) =>
      confirmCopyHandoff(db, id, {
        copyRequestId: clinical.copyReqId,
        artifactSha256: "d".repeat(64),
        channel: "in_person",
        handedOffAt: handoffAt,
        handoffRef: "Tanda terima #SR-2026-01",
      }),
    );
    const hId2 = await as(A.own, (db) =>
      confirmCopyHandoff(db, id, {
        copyRequestId: clinical.copyReqId,
        artifactSha256: "d".repeat(64),
        channel: "in_person",
        handedOffAt: handoffAt,
        handoffRef: "Tanda terima #SR-2026-01",
      }),
    );
    expect(hId2).toBe(hId1);
    expect(
      await errCode(as(A.own, (db) => confirmCopyHandoff(db, id, {
        copyRequestId: clinical.copyReqId,
        artifactSha256: "e".repeat(64),
        channel: "in_person",
        handedOffAt: handoffAt,
        handoffRef: "Tanda terima #SR-2026-01",
      }))),
    ).toBe("ERR_VERSION_CONFLICT:handoff_already_confirmed");

    // Now confirmed copy appears in dsr_link_options; mismatched handoffRef refused; matching ref links cleanly
    const optsAfter = await as(A.own, (db) => getDsrLinkOptions(db, id));
    expect(optsAfter.recordCopies.map((c) => c.id)).toContain(clinical.copyReqId);
    expect(optsAfter.unconfirmedRecordCopies.map((c) => c.id)).not.toContain(clinical.copyReqId);
    expect(await errCode(as(A.own, (db) => linkDsrEvidence(db, id, { kind: "record_copy", linkId: clinical.copyReqId, handoffRef: "REF-SALAH" })))).toBe("ERR_INVALID_INPUT:copy_handoff_unconfirmed");
    await as(A.own, (db) => linkDsrEvidence(db, id, { kind: "record_copy", linkId: clinical.copyReqId, handoffRef: "Tanda terima #SR-2026-01" }));

    // Impossible chronology (delivery before identity_verified_at) refused
    expect(
      await errCode(as(A.own, (db) => closeDsr(db, id, {
        outcome: "fulfilled",
        basisCode: "fulfilled_delivered",
        deliveryChannel: "in_person",
        deliveryConfirmedAt: new Date(received.getTime() + 1000),
        deliveryRef: "TT-001",
      }))),
    ).toBe("ERR_INVALID_INPUT:chronology_invalid");

    // Valid delivery confirmation closes request
    await as(A.own, (db) =>
      closeDsr(db, id, {
        outcome: "fulfilled",
        basisCode: "fulfilled_delivered",
        deliveryChannel: "in_person",
        deliveryConfirmedAt: new Date(),
        deliveryRef: "Tanda terima serah terima #TT-001",
      }),
    );

    const detail = await as(A.own, (db) => getDsr(db, id));
    expect(detail.state).toBe("closed");
    expect(detail.outcome).toBe("fulfilled");
    expect(detail.mrn).toBe(pt.mrn);
    // Patient full name and clinical sentinel NEVER appear in projections!
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain("Siti Rahasia Nama");
    expect(serialized).not.toContain("RAHASIA_KLINIS_SENTINEL");

    // Bare withdrawn without source/attestation refused; attested withdrawn before verification succeeds
    const { id: wId } = await as(A.own, (db) =>
      logDsr(db, `dsr-withdraw-${++n}`, { patientId: pt.id, requester: "guardian", right: "access", channel: "whatsapp", receivedAt: received }),
    );
    expect(await errCode(as(A.own, (db) => closeDsr(db, wId, { outcome: "withdrawn", basisCode: "withdrawn_by_requester" })))).toBe("ERR_INVALID_INPUT:withdrawal_required");
    await as(A.own, (db) =>
      closeDsr(db, wId, {
        outcome: "withdrawn",
        basisCode: "withdrawn_by_requester",
        withdrawalSource: "whatsapp",
        withdrawalAttestation: "Wali membatalkan via pesan WA resmi",
      }),
    );
    expect((await as(A.own, (db) => getDsr(db, wId))).outcome).toBe("withdrawn");
  });

  it("Finding #1: clinical vs demographic correction — original/pending rejected, approved+applied accepted only with addresses_request=true", async () => {
    const pt = await seedPatient(A, "Pasien Koreksi");
    const clin = await seedSignedExamAndCorrection(A, pt.id);
    const received = new Date(Date.now() - 3_600_000);

    // Demographic correction refuses clinical link AND refuses fulfilled
    const { id: demoId } = await as(A.own, (db) =>
      logDsr(db, `dsr-demo-${++n}`, { patientId: pt.id, requester: "patient", right: "correction", correctionScope: "demographic", channel: "in_person", receivedAt: received }),
    );
    await as(A.own, (db) => verifyDsrIdentity(db, demoId, "ktp_in_person"));
    expect(await errCode(as(A.own, (db) => linkDsrEvidence(db, demoId, { kind: "record_version", linkId: clin.corrVersionId, addressesRequest: true })))).toBe("ERR_INVALID_INPUT:demographic_unavailable");
    expect(
      await errCode(as(A.own, (db) => closeDsr(db, demoId, {
        outcome: "fulfilled",
        basisCode: "fulfilled_corrected",
        deliveryChannel: "in_person",
        deliveryConfirmedAt: new Date(),
        deliveryRef: "REF-DEMO",
      }))),
    ).toBe("ERR_VERSION_CONFLICT:demographic_unavailable");

    // Clinical correction: original version refused, pending correction refused, addresses_request=false refused
    const { id: clinId } = await as(A.own, (db) =>
      logDsr(db, `dsr-clin-${++n}`, { patientId: pt.id, requester: "patient", right: "correction", correctionScope: "clinical", channel: "paper", receivedAt: received }),
    );
    await as(A.own, (db) => verifyDsrIdentity(db, clinId, "ktp_video"));
    expect(await errCode(as(A.own, (db) => linkDsrEvidence(db, clinId, { kind: "record_version", linkId: clin.origVersionId, addressesRequest: true })))).toBe("ERR_INVALID_INPUT:link_invalid_for_request");
    expect(await errCode(as(A.own, (db) => linkDsrEvidence(db, clinId, { kind: "record_correction", linkId: clin.pendingCorrId, addressesRequest: true })))).toBe("ERR_INVALID_INPUT:link_invalid_for_request");
    expect(await errCode(as(A.own, (db) => linkDsrEvidence(db, clinId, { kind: "record_correction", linkId: clin.approvedCorrId, addressesRequest: false })))).toBe("ERR_INVALID_INPUT:addresses_request_required");

    // Approved+applied correction with addresses_request=true succeeds and closes fulfilled
    await as(A.own, (db) => linkDsrEvidence(db, clinId, { kind: "record_correction", linkId: clin.approvedCorrId, addressesRequest: true }));
    await as(A.own, (db) =>
      closeDsr(db, clinId, {
        outcome: "fulfilled",
        basisCode: "fulfilled_corrected",
        deliveryChannel: "email",
        deliveryConfirmedAt: new Date(),
        deliveryRef: "Email konfirmasi adendum #01",
      }),
    );
    // Original RME version untouched
    const orig = (await h.admin.query(`select kind, version from record_versions where id = $1`, [clin.origVersionId])).rows[0];
    expect(orig).toEqual({ kind: "original", version: 1 });
  });

  it("Finding #2: D3 erasure never fulfilled (even zero history) + D4 restriction checks live cluster consent state (re-grant blocks!)", async () => {
    const ptZero = await seedPatient(A, "Pasien Tanpa Riwayat");
    const received = new Date(Date.now() - 3_600_000);

    // Zero-history patient erasure STILL refuses fulfilled (D3)
    const { id: erId } = await as(A.own, (db) =>
      logDsr(db, `dsr-erasure-${++n}`, { patientId: ptZero.id, requester: "patient", right: "erasure", channel: "in_person", receivedAt: received }),
    );
    await as(A.own, (db) => verifyDsrIdentity(db, erId, "ktp_in_person"));
    expect(
      await errCode(as(A.own, (db) => closeDsr(db, erId, {
        outcome: "fulfilled",
        basisCode: "fulfilled_delivered",
        deliveryChannel: "in_person",
        deliveryConfirmedAt: new Date(),
        deliveryRef: "REF-ER",
      }))),
    ).toBe("ERR_VERSION_CONFLICT:clinical_retention");

    const grantOk = async (patientId: string, purpose: "clinical_photo" | "marketing_wa" | "publication") => {
      const g = await as(A.fo, (db) => grantConsent(db, crypto.randomUUID(), { patientId, purpose, textId: A.texts[purpose], channel: "in_person" }));
      if (!g.ok) throw new Error(`grantConsent failed: ${g.code}`);
      return g.consentId;
    };

    // Grant & withdraw clinical_photo (wrong purpose for erasure) vs marketing_wa (valid optional purpose)
    const photoConsentId = await grantOk(ptZero.id, "clinical_photo");
    await as(A.fo, (db) => withdrawConsent(db, crypto.randomUUID(), { consentId: photoConsentId, channel: "in_person", reason: "Uji tarik foto" }));
    expect(await errCode(as(A.own, (db) => linkDsrEvidence(db, erId, { kind: "consent_withdrawal", linkId: photoConsentId })))).toBe("ERR_INVALID_INPUT:link_invalid_for_request");

    const mktConsentId = await grantOk(ptZero.id, "marketing_wa");
    await as(A.fo, (db) => withdrawConsent(db, crypto.randomUUID(), { consentId: mktConsentId, channel: "in_person", reason: "Permintaan hapus data opsional" }));
    await as(A.own, (db) => linkDsrEvidence(db, erId, { kind: "consent_withdrawal", linkId: mktConsentId }));
    await as(A.own, (db) =>
      closeDsr(db, erId, {
        outcome: "partially_fulfilled",
        basisCode: "partial_medical_record_retention_pmk24_2022",
        deliveryChannel: "in_person",
        deliveryConfirmedAt: new Date(),
        deliveryRef: "Berita acara penghapusan parsial #1",
      }),
    );
    // Patient row still exists (D3: never deleted!)
    expect((await h.admin.query<{ n: number }>(`select count(*)::int as n from patients where id = $1`, [ptZero.id])).rows[0].n).toBe(1);

    // D4 Restriction: old withdrawal re-granted later MUST block closure!
    const ptRestr = await seedPatient(A, "Pasien Batas");
    const g1Id = await grantOk(ptRestr.id, "marketing_wa");
    await as(A.fo, (db) => withdrawConsent(db, crypto.randomUUID(), { consentId: g1Id, channel: "in_person", reason: "Tarik lama" }));
    // Re-grant marketing_wa so it is ACTIVE again!
    const g2Id = await grantOk(ptRestr.id, "marketing_wa");

    const { id: rId } = await as(A.own, (db) =>
      logDsr(db, `dsr-restr-${++n}`, {
        patientId: ptRestr.id,
        requester: "patient",
        right: "restriction",
        requestedPurposes: ["marketing_wa", "publication"],
        channel: "email",
        receivedAt: received,
      }),
    );
    await as(A.own, (db) => verifyDsrIdentity(db, rId, "ktp_in_person"));
    // Linking the historical withdrawn g1 still cannot close fulfilled because g2 is active!
    await as(A.own, (db) => linkDsrEvidence(db, rId, { kind: "consent_withdrawal", linkId: g1Id }));
    const before = await as(A.own, (db) => getDsr(db, rId));
    expect(before.restrictionStatuses).toEqual([
      { purpose: "marketing_wa", status: "still_active" },
      { purpose: "publication", status: "already_inactive" },
    ]);
    expect(
      await errCode(as(A.own, (db) => closeDsr(db, rId, {
        outcome: "fulfilled",
        basisCode: "fulfilled_restricted",
        deliveryChannel: "email",
        deliveryConfirmedAt: new Date(),
        deliveryRef: "Email konfirmasi",
      }))),
    ).toBe("ERR_VERSION_CONFLICT:restriction_still_active");

    // Withdraw g2 -> now BOTH marketing_wa and publication are inactive -> closes fulfilled!
    await as(A.fo, (db) => withdrawConsent(db, crypto.randomUUID(), { consentId: g2Id, channel: "in_person", reason: "Tarik pembatasan" }));
    await as(A.own, (db) =>
      closeDsr(db, rId, {
        outcome: "fulfilled",
        basisCode: "fulfilled_restricted",
        deliveryChannel: "email",
        deliveryConfirmedAt: new Date(),
        deliveryRef: "Email konfirmasi pembatasan #2",
      }),
    );
  });

  it("Finding #3: NULL-to-subject bind once before verification + merge after log + unmerge after link blocks close", async () => {
    const pSurv = await seedPatient(A, "Pasien Survivor");
    const pDup = await seedPatient(A, "Pasien Duplikat");
    const dupCopy = await seedSignedExamAndCorrection(A, pDup.id);
    const received = new Date(Date.now() - 3_600_000);

    // Log with NULL patient_id, then bind once to pSurv before verification
    const { id } = await as(A.own, (db) =>
      logDsr(db, `dsr-bind-${++n}`, { patientId: null, requester: "patient", right: "access", channel: "phone", receivedAt: received }),
    );
    await as(A.own, (db) => bindDsrSubject(db, id, pSurv.id));
    // Re-binding to a different patient refused
    expect(await errCode(as(A.own, (db) => bindDsrSubject(db, id, pDup.id)))).toBe("ERR_VERSION_CONFLICT:subject_already_bound");

    await as(A.own, (db) => verifyDsrIdentity(db, id, "ktp_in_person"));

    // Before merge: confirming pDup's copy against pSurv's DSR is refused (wrong cluster) AND leaves pDup's copy unconfirmed!
    expect(
      await errCode(as(A.own, (db) => confirmCopyHandoff(db, id, {
        copyRequestId: dupCopy.copyReqId,
        artifactSha256: "f".repeat(64),
        channel: "in_person",
        handedOffAt: new Date(),
        handoffRef: "SR-MERGED-01",
      }))),
    ).toBe("ERR_INVALID_INPUT:link_invalid_for_request");

    // Before merge: pDup's unconfirmed copy cannot be linked to pSurv's request
    expect(await errCode(as(A.own, (db) => linkDsrEvidence(db, id, { kind: "record_copy", linkId: dupCopy.copyReqId, handoffRef: "SR-MERGED-01" })))).toBe("ERR_INVALID_INPUT:copy_handoff_unconfirmed");

    // Merge pDup into pSurv -> now dynamic cluster includes pDup's copy -> confirm handoff AND link succeed!
    const { mergeId } = await as(A.ro, (db) => mergePatients(db, crypto.randomUUID(), pSurv.id, pDup.id, "Data ganda sintetis"));
    expect((await as(A.own, (db) => getDsrLinkOptions(db, id))).unconfirmedRecordCopies.map((c) => c.id)).toContain(dupCopy.copyReqId);
    await as(A.own, (db) =>
      confirmCopyHandoff(db, id, {
        copyRequestId: dupCopy.copyReqId,
        artifactSha256: "f".repeat(64),
        channel: "in_person",
        handedOffAt: new Date(),
        handoffRef: "SR-MERGED-01",
      }),
    );
    const opts = await as(A.own, (db) => getDsrLinkOptions(db, id));
    expect(opts.recordCopies.map((c) => c.id)).toContain(dupCopy.copyReqId);
    await as(A.own, (db) => linkDsrEvidence(db, id, { kind: "record_copy", linkId: dupCopy.copyReqId, handoffRef: "SR-MERGED-01" }));

    // Unmerge pDup -> previously linked row is detached from current cluster -> close MUST refuse with cluster_changed!
    await as(A.ro, (db) => unmergePatients(db, crypto.randomUUID(), mergeId, "Pisahkan gabungan uji"));
    const det = await as(A.own, (db) => getDsr(db, id));
    expect(det.links[0].clusterValid).toBe(false);
    expect(
      await errCode(as(A.own, (db) => closeDsr(db, id, {
        outcome: "fulfilled",
        basisCode: "fulfilled_delivered",
        deliveryChannel: "in_person",
        deliveryConfirmedAt: new Date(),
        deliveryRef: "TT-UNMERGED",
      }))),
    ).toBe("ERR_VERSION_CONFLICT:cluster_changed");
  });

  it("Finding #5, #6, #7, #8: zero raw SELECT, TEN-19 never, assignee concurrency + revocation flag, non-finite timestamps, SQL replay conflict & revoked replay", async () => {
    const ptA = await seedPatient(A, "Pasien Rahasia A");
    const ptB = await seedPatient(B, "Pasien Rahasia B");
    const received = new Date(Date.now() - 3_600_000);

    // Finding #7: non-finite & future timestamps rejected
    await expect(
      as(A.own, (db) => db.query(`select public.dsr_log('key-inf-test', $1, 'patient', 'access', 'in_person', '-infinity'::timestamptz, null, null)`, [ptA.id])),
    ).rejects.toThrow(/ERR_INVALID_INPUT/);
    await expect(
      as(A.own, (db) => db.query(`select public.dsr_log('key-fut-test', $1, 'patient', 'access', 'in_person', clock_timestamp() + interval '1 hour', null, null)`, [ptA.id])),
    ).rejects.toThrow(/ERR_INVALID_INPUT/);

    // Finding #8: SQL-level idempotent replay vs changed-body conflict
    const key = `dsr-idem-${++n}`;
    const first = await as(A.apDuty, (db) =>
      logDsr(db, key, { patientId: ptA.id, requester: "patient", right: "access", channel: "in_person", receivedAt: received }),
    );
    expect(first.replayed).toBe(false);
    const replay = await as(A.apDuty, (db) =>
      logDsr(db, key, { patientId: ptA.id, requester: "patient", right: "access", channel: "in_person", receivedAt: received }),
    );
    expect(replay).toEqual({ id: first.id, replayed: true });
    // Changed body with same key -> ERR_IDEMPOTENCY_CONFLICT!
    expect(
      await errCode(as(A.apDuty, (db) =>
        logDsr(db, key, { patientId: ptA.id, requester: "guardian", right: "access", channel: "in_person", receivedAt: received }),
      )),
    ).toBe("ERR_IDEMPOTENCY_CONFLICT:dsr_log");

    // Finding #6: non-officer assignment refused; valid apDuty assigned; revoking duty flags assigneeActive=false & blocks apDuty replay!
    await as(A.own, (db) => verifyDsrIdentity(db, first.id, "ktp_in_person"));
    expect(await errCode(as(A.own, (db) => assignDsr(db, first.id, A.apPlain.staffId)))).toBe("ERR_FORBIDDEN:assignee_not_privacy_officer");
    await as(A.own, (db) => assignDsr(db, first.id, A.apDuty.staffId));
    expect((await as(A.own, (db) => getDsr(db, first.id))).assigneeActive).toBe(true);

    // Two-session concurrency race on dsr_assign vs duty revocation
    const blocker = testClient({ connectionString: h.ownerUrl() });
    await blocker.connect();
    try {
      await blocker.query("begin");
      await blocker.query(`select pg_advisory_xact_lock(hashtextextended('staff_access:' || $1, 0))`, [A.tenantId]);
      await blocker.query(`update staff_duties set ended_at = clock_timestamp(), ended_by = $3 where tenant_id = $1 and staff_id = $2 and duty = 'data_protection'`, [A.tenantId, A.apDuty.staffId, A.own.staffId]);
      const assignPromise = as(A.own, (db) => assignDsr(db, first.id, A.apDuty.staffId));
      await new Promise((r) => setTimeout(r, 80));
      await blocker.query("commit");
      expect(await errCode(assignPromise)).toBe("ERR_FORBIDDEN:assignee_not_privacy_officer");
    } finally {
      await blocker.end();
    }

    // Revoked apDuty is flagged inactive on list/get AND denied replay on dsr_log!
    const listed = await as(A.own, (db) => listDsrs(db, { state: "open" }));
    const row = listed.rows.find((r) => r.id === first.id)!;
    expect(row.assigneeActive).toBe(false);
    expect(
      await errCode(as(A.apDuty, (db) =>
        logDsr(db, key, { patientId: ptA.id, requester: "patient", right: "access", channel: "in_person", receivedAt: received }),
      )),
    ).toBe("ERR_FORBIDDEN:only the privacy officers manage the privacy registers");

    // Cross-tenant isolation: B's owner cannot see or act on A's DSR, nor log with A's patient
    expect(await errCode(as(B.own, (db) => getDsr(db, first.id)))).toBe("ERR_NOT_FOUND:not_found");
    expect(await errCode(as(B.own, (db) => logDsr(db, `dsr-xt-${++n}`, { patientId: ptA.id, requester: "patient", right: "access", channel: "in_person", receivedAt: received })))).toBe("ERR_NOT_FOUND:patient_not_found");
    const bReq = await as(B.own, (db) => logDsr(db, `dsr-b-${++n}`, { patientId: ptB.id, requester: "patient", right: "access", channel: "in_person", receivedAt: received }));
    expect((await as(A.own, (db) => listDsrs(db, { state: "all" }))).rows.some((r) => r.id === bReq.id)).toBe(false);

    // Finding #5: TEN-19 'never' + zero direct SELECT for clinic_app, clinic_vendor, clinic_operator (even in active support session!)
    const sok = (await h.admin.query<{ table_name: string; support_class: string }>(
      `select table_name, support_class from support_object_kinds where table_name in ('public.data_subject_requests','public.data_subject_request_links','public.record_copy_handoffs') order by 1`,
    )).rows;
    expect(sok).toEqual([
      { table_name: "public.data_subject_request_links", support_class: "never" },
      { table_name: "public.data_subject_requests", support_class: "never" },
      { table_name: "public.record_copy_handoffs", support_class: "never" },
    ]);

    for (const [label, q] of [
      ["app", (sql: string) => as(A.own, (db) => db.query(sql))],
      ["vendor", (sql: string) => vendorClient.query(sql)],
      ["operator", (sql: string) => operatorClient.query(sql)],
    ] as const) {
      await expect(q(`select * from data_subject_requests`), `${label} dsr`).rejects.toMatchObject({ code: "42501" });
      await expect(q(`select * from data_subject_request_links`), `${label} dsr_links`).rejects.toMatchObject({ code: "42501" });
      await expect(q(`select * from record_copy_handoffs`), `${label} record_copy_handoffs`).rejects.toMatchObject({ code: "42501" });
    }

    const sess = await openSession(consoleDb, { token: supportTok, ip: VENDOR_IP }, {
      tenantId: A.tenantId,
      purpose: "Uji negatif TEN-19 never pada DSR",
      scope: ["public.branches"],
      minutes: 30,
    });
    expect(sess.ok).toBe(true);
    if (sess.ok) {
      await expect(
        withSupportSession(consoleDb, opDb, { token: supportTok, ip: VENDOR_IP }, sess.data.id, (db) => db.query(`select * from data_subject_requests`)),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        withSupportSession(consoleDb, opDb, { token: supportTok, ip: VENDOR_IP }, sess.data.id, (db) => db.query(`select * from data_subject_request_links`)),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        withSupportSession(consoleDb, opDb, { token: supportTok, ip: VENDOR_IP }, sess.data.id, (db) => db.query(`select * from record_copy_handoffs`)),
      ).rejects.toMatchObject({ code: "42501" });
    }

    // Lifecycle alignment (Finding #6): suspended & exit still allow data_request; closed refused
    await h.admin.query(`update tenants_registry set lifecycle_state = 'suspended' where id = $1`, [A.tenantId]);
    expect((await as(A.own, (db) => listDsrs(db, { state: "all" }))).rows.length).toBeGreaterThan(0);
    await h.admin.query(`update tenants_registry set lifecycle_state = 'closed' where id = $1`, [A.tenantId]);
    expect(await errCode(as(A.own, (db) => listDsrs(db, { state: "all" })))).toBe("ERR_TENANT_SUSPENDED:the tenant cannot change this now");
    await h.admin.query(`update tenants_registry set lifecycle_state = 'live' where id = $1`, [A.tenantId]);
  });

  it("R3 r1 P1-2: reader definers (dsr_get, dsr_list, dsr_link_options) lock FOR SHARE and serialize consistently against concurrent FOR UPDATE close", async () => {
    const pt = await seedPatient(A, "Pasien Konkurensi");
    const received = new Date(Date.now() - 3_600_000);
    const { id } = await as(A.own, (db) =>
      logDsr(db, `dsr-conc-${++n}`, { patientId: pt.id, requester: "patient", right: "access", channel: "in_person", receivedAt: received }),
    );
    await as(A.own, (db) => verifyDsrIdentity(db, id, "ktp_in_person"));

    // Session 1 acquires FOR UPDATE via dsr_close in an uncommitted transaction;
    // Session 2 readers (dsr_get, dsr_list, dsr_link_options) must wait for commit and then observe closed state consistently.
    let markMutReady!: () => void;
    const mutReady = new Promise<void>((r) => {
      markMutReady = r;
    });
    let releaseMut!: () => void;
    const mutHold = new Promise<void>((r) => {
      releaseMut = r;
    });
    let getResolved = false;
    let listResolved = false;
    let optsResolved = false;

    const mutTx = as(A.own, async (db) => {
      await closeDsr(db, id, {
        outcome: "withdrawn",
        basisCode: "withdrawn_by_requester",
        withdrawalSource: "in_person",
        withdrawalAttestation: "Konfirmasi pembatalan saat uji konkurensi",
      });
      markMutReady();
      await mutHold;
    });

    try {
      await mutReady;

      const pGet = as(A.own, (db) => getDsr(db, id)).then((r) => {
        getResolved = true;
        return r;
      });
      const pList = as(A.own, (db) => listDsrs(db, { state: "all" })).then((r) => {
        listResolved = true;
        return r;
      });
      const pOpts = as(A.own, (db) => getDsrLinkOptions(db, id)).then((r) => {
        optsResolved = true;
        return r;
      });

      await new Promise((r) => setTimeout(r, 120));
      expect(getResolved).toBe(false);
      expect(listResolved).toBe(false);
      expect(optsResolved).toBe(false);

      releaseMut();
      await mutTx;
      const [detail, listed, opts] = await Promise.all([pGet, pList, pOpts]);
      expect(detail.state).toBe("closed");
      expect(detail.outcome).toBe("withdrawn");
      expect(listed.rows.find((r) => r.id === id)?.state).toBe("closed");
      expect(opts.recordCopies).toEqual([]);
    } finally {
      releaseMut();
      await mutTx.catch(() => {});
    }
  });
});
