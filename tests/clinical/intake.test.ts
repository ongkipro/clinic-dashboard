// T-051 Done-when: scenario PR-9 (a score or Fitzpatrick field is rejected) and CLIN-001–003. Plus the plan
// review: committed, audited refusals; only new or changed facts (across a merged patient); the unverified
// allergy caution for the clinical roles only; authority (a BC of the visit's branch, the author edits, a draft
// only, never a closed visit); the visit's intake step; readers on the wall clock; guards; events ids only;
// vendor class; cross-tenant.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { openIntake, patientCautions, queue, saveIntake, sendIntake, visitIntake } from "../../src/modules/clinical/intake/intake";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { mergePatients } from "../../src/modules/patients/merge/merge";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local"; // synthetic data (MIG-2)

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "purchasing", "marketing", "central_cs", "auditor"];

async function tenant(state = "live"): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ($1) returning id`, [state])).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Pendampingan Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("P1"), b2: await br("P2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`pdm${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Pendampingan ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  const bs = TENANT_WIDE.includes(role) ? [] : branches.length ? branches : [t.b1];
  for (const b of bs) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: bs[0] };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>, branch?: string) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: branch ?? p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const key = () => crypto.randomUUID();

async function patient(t: T, name = "Pasien Pendampingan"): Promise<string> {
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
     select $1, 'RM-' || lpad((count(*) + 1)::text, 6, '0'), $2, '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture sintetis', 'islam', 'Karyawan', 's1', 'kawin', $3,
            (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier' from patients where tenant_id = $1 returning id`,
    [t.tenantId, name, t.b1],
  )).rows[0].id as string;
}
// A walk-in visit opened by the visits writer path (the database owner stands in for check-in, as T-047's tests).
async function visit(t: T, patientId: string, branch = t.b1): Promise<string> {
  return (await h.admin.query(
    `insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', (select s.id from staff s where s.tenant_id = $1 limit 1)) returning id`,
    [t.tenantId, branch, patientId],
  )).rows[0].id as string;
}
// The visit ends (the database owner stands in for the closing writer, T-047's close).
const close = (v: string) => h.admin.query(`update visits set closed_at = now(), closed_by = checked_in_by where id = $1`, [v]);
const facts = async (intakeId: string) => (await h.admin.query(`select kind, value, prior_fact_id from intake_facts where intake_id = $1 order by kind`, [intakeId])).rows;
const audits = async (id: string) => (await h.admin.query(`select action, outcome, reason_code from audit_events where object_kind = 'intake' and object_id = $1 order by seq`, [id])).rows;

let A: T;
let B: T;
let OWN: P; let BC: P; let BC2: P; let BCB2: P; let DOC: P; let NUR: P; let PH: P; let TH: P; let FH: P; let RO: P; let FO: P; let FIN: P; let MK: P;
let BBC: P;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner");
  BC = await person(A, "bc", A.b1); BC2 = await person(A, "bc", A.b1); BCB2 = await person(A, "bc", A.b2);
  DOC = await person(A, "doctor", A.b1); NUR = await person(A, "nurse", A.b1); PH = await person(A, "pharmacist", A.b1); TH = await person(A, "therapist", A.b1);
  FH = await person(A, "facility_head", A.b1); RO = await person(A, "records_officer", A.b1); FO = await person(A, "fo_cashier", A.b1);
  FIN = await person(A, "finance"); MK = await person(A, "marketing");
  BBC = await person(B, "bc", B.b1);
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

describe("scenario PR-9: no scores from BC", () => {
  it("a submission with a score, grade or Fitzpatrick field is rejected, audited, and writes nothing", async () => {
    const p = await patient(A);
    const v = await visit(A, p);
    const { intakeId } = await as(BC, (db) => openIntake(db, key(), v));
    for (const [payload, why] of [
      [{ complaint: "Kulit kusam", observation: { chips: ["kering"], fitzpatrick: 3 } }, "score_field"],
      [{ observation: { chips: ["kering"], skor: "4" } }, "score_field"],
      [{ observation: { chips: ["kering"], tipe_kulit: "III" } }, "score_field"],
      [{ facts: [{ kind: "note", value: "x", grade: "2" }] }, "score_field"],
      [{ observation: { chips: ["kering"], note: "ok", severity: 3 } }, "score_field"],
      [{ observation: { chips: [3] } }, "score_field"],
    ] as const) {
      expect(await as(BC, (db) => saveIntake(db, key(), intakeId, payload as never))).toMatchObject({ ok: false, code: why });
    }
    expect((await h.admin.query(`select count(*)::int as n from skin_observations where intake_id = $1`, [intakeId])).rows[0].n).toBe(0);
    expect((await h.admin.query(`select complaint from intakes where id = $1`, [intakeId])).rows[0].complaint).toBeNull();
    // The refusals are committed in the audit (content-free), six of them.
    const au = (await audits(intakeId)).filter((r) => r.outcome === "denied");
    expect(au).toHaveLength(6);
    expect(au.every((r) => r.action === "access_denied" && r.reason_code === "score_field")).toBe(true);
    // Chips and text are accepted; an unknown chip or key is invalid input.
    expect(await as(BC, (db) => saveIntake(db, key(), intakeId, { observation: { chips: ["kering", "flek"], note: "Area pipi" } }))).toMatchObject({ ok: true });
    expect(await code(as(BC, (db) => saveIntake(db, key(), intakeId, { observation: { chips: ["sangat_kering"] } } as never)))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(BC, (db) => saveIntake(db, key(), intakeId, { color: "x" } as never)))).toBe("ERR_INVALID_INPUT");
    expect((await h.admin.query(`select chips, note from skin_observations where intake_id = $1`, [intakeId])).rows[0]).toEqual({ chips: ["flek", "kering"], note: "Area pipi" });
    // The table has no score, grade or type column at all.
    const cols = (await h.admin.query(`select column_name from information_schema.columns where table_name = 'skin_observations'`)).rows.map((r) => r.column_name);
    expect(cols.filter((c: string) => /score|grade|fitz|type|nilai/.test(c))).toEqual([]);
  });

  it("a replayed refusal does not audit twice", async () => {
    const v = await visit(A, await patient(A));
    const { intakeId } = await as(BC, (db) => openIntake(db, key(), v));
    const k = key();
    const a1 = await as(BC, (db) => saveIntake(db, k, intakeId, { observation: { chips: [], fitzpatrick: "IV" } } as never));
    const a2 = await as(BC, (db) => saveIntake(db, k, intakeId, { observation: { chips: [], fitzpatrick: "IV" } } as never));
    expect(a1).toEqual({ ok: false, code: "score_field", replayed: false });
    expect(a2).toEqual({ ok: false, code: "score_field", replayed: true });
    expect((await audits(intakeId)).filter((r) => r.outcome === "denied")).toHaveLength(1);
  });
});

describe("CLIN-001: repeat visit — prior intake as history, only changes are new facts", () => {
  it("unchanged answers add no fact; changed ones do, linked to the prior; history spans a merged duplicate", async () => {
    const p = await patient(A, "Rina Riwayat");
    const v1 = await visit(A, p);
    const { intakeId: i1 } = await as(BC, (db) => openIntake(db, key(), v1));
    await as(BC, (db) => saveIntake(db, key(), i1, { complaint: "Jerawat di dagu", facts: [
      { kind: "allergy", value: "Amoksisilin" }, { kind: "skincare", value: "Sabun wajah X" }, { kind: "medication", value: "Tidak ada" }] }));
    await as(BC, (db) => sendIntake(db, key(), i1));
    await close(v1);
    // A duplicate record of the same person, merged into the first: its earlier intake counts as history too.
    const dup = await patient(A, "Rina Riwayat (ganda)");
    const vd = await visit(A, dup);
    const { intakeId: id0 } = await as(BC, (db) => openIntake(db, key(), vd));
    await as(BC, (db) => saveIntake(db, key(), id0, { complaint: "Konsultasi lama", facts: [{ kind: "pregnancy", value: "Tidak hamil" }] }));
    await as(BC, (db) => sendIntake(db, key(), id0));
    await close(vd);
    await as(RO, (db) => mergePatients(db, key(), p, dup, "Data ganda pasien yang sama"));
    // Visit 2: the BC sees the history and answers.
    const v2 = await visit(A, p);
    const { intakeId: i2 } = await as(BC, (db) => openIntake(db, key(), v2));
    const page = await as(BC, (db) => visitIntake(db, v2));
    const hist = Object.fromEntries(page.history.map((f) => [f.kind, f]));
    expect(Object.keys(hist).sort()).toEqual(["allergy", "medication", "pregnancy", "skincare"]);
    expect(page.visitsBefore.map((x) => x.complaint).sort()).toEqual(["Jerawat di dagu", "Konsultasi lama"]);
    expect(await as(BC, (db) => saveIntake(db, key(), i2, { complaint: "Kontrol jerawat", facts: [
      { kind: "allergy", same_as: hist.allergy.id },            // unchanged (marked same)
      { kind: "skincare", value: "Sabun wajah X" },             // unchanged (same text)
      { kind: "medication", value: "Krim retinoid malam" },     // changed
      { kind: "condition", value: "Mudah berkeringat" },        // new
    ] }))).toMatchObject({ ok: true });
    expect(await facts(i2)).toEqual([
      { kind: "condition", value: "Mudah berkeringat", prior_fact_id: null },
      { kind: "medication", value: "Krim retinoid malam", prior_fact_id: hist.medication.id },
    ]);
    expect(((await h.admin.query(`select reviewed_prior from intakes where id = $1`, [i2])).rows[0].reviewed_prior as string[]).sort())
      .toEqual([hist.allergy.id, hist.skincare.id].sort());
    // Re-saving the draft replaces its facts of that kind (no duplicates); a wrong same_as is invalid.
    await as(BC, (db) => saveIntake(db, key(), i2, { facts: [{ kind: "medication", value: "Krim retinoid pagi" }] }));
    expect((await facts(i2)).map((f) => f.value)).toEqual(["Mudah berkeringat", "Krim retinoid pagi"]);
    expect(await code(as(BC, (db) => saveIntake(db, key(), i2, { facts: [{ kind: "allergy", same_as: hist.skincare.id }] })))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(BC, (db) => saveIntake(db, key(), i2, { facts: [{ kind: "note", value: "a" }, { kind: "note", value: "b" }] })))).toBe("ERR_INVALID_INPUT");
  });
});

describe("CLIN-002: an unverified allergy flag reaches doctor, nurse and pharmacist as a caution", () => {
  it("the caution (kind, value, provenance) for the clinical roles only; it survives an unchanged repeat visit", async () => {
    const p = await patient(A, "Sari Alergi");
    const v1 = await visit(A, p);
    const { intakeId } = await as(BC, (db) => openIntake(db, key(), v1));
    await as(BC, (db) => saveIntake(db, key(), intakeId, { complaint: "Kemerahan", facts: [{ kind: "allergy", value: "Lateks" }, { kind: "note", value: "Rahasia kecil" }] }));
    expect(await as(DOC, (db) => patientCautions(db, p))).toEqual([]); // a draft is not yet a caution
    await as(BC, (db) => sendIntake(db, key(), intakeId));
    for (const who of [DOC, NUR, PH, TH, FH, BC]) {
      const c = await as(who, (db) => patientCautions(db, p));
      expect(c.map((x) => [x.kind, x.value, x.provenance])).toEqual([["allergy", "Lateks", "bc_captured_unverified"]]);
      expect(JSON.stringify(c)).not.toMatch(/Kemerahan|Rahasia/);
    }
    for (const who of [FO, FIN, MK, OWN]) expect(await code(as(who, (db) => patientCautions(db, p)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(BCB2, (db) => patientCautions(db, p)))).toBe("ERR_NOT_FOUND"); // no visit at the other branch
    // Visit 2 leaves the allergy unchanged: the caution remains.
    await close(v1);
    const v2 = await visit(A, p);
    const { intakeId: i2 } = await as(BC, (db) => openIntake(db, key(), v2));
    const hist = (await as(BC, (db) => visitIntake(db, v2))).history.find((f) => f.kind === "allergy")!;
    await as(BC, (db) => saveIntake(db, key(), i2, { complaint: "Kontrol", facts: [{ kind: "allergy", same_as: hist.id }] }));
    await as(BC, (db) => sendIntake(db, key(), i2));
    expect((await as(NUR, (db) => patientCautions(db, p))).map((x) => x.value)).toEqual(["Lateks"]);
    // An allergy recorded on a duplicate record reaches the survivor's caution once merged (the cluster).
    const dup = await patient(A, "Sari Alergi (ganda)");
    const vd = await visit(A, dup);
    const { intakeId: di } = await as(BC, (db) => openIntake(db, key(), vd));
    await as(BC, (db) => saveIntake(db, key(), di, { complaint: "Lama", facts: [{ kind: "allergy", value: "Nikel" }] }));
    await as(BC, (db) => sendIntake(db, key(), di));
    await close(vd);
    const p2 = await patient(A, "Dewi Tanpa Alergi");
    const v3 = await visit(A, p2);
    expect(await as(DOC, (db) => patientCautions(db, p2))).toEqual([]);
    await as(RO, (db) => mergePatients(db, key(), p2, dup, "Data ganda pasien yang sama"));
    expect((await as(DOC, (db) => patientCautions(db, p2))).map((x) => x.value)).toEqual(["Nikel"]);
    void v3;
    // The doctor is alerted that an intake is ready (system notification, the doctor role at the branch).
    expect((await h.admin.query(`select count(*)::int as n from notifications where type = 'intake_ready' and subject_id = $1 and recipient_role = 'doctor'`, [v1])).rows[0].n).toBe(1);
  });
});

describe("CLIN-003: a BC cannot diagnose or sign", () => {
  it("diagnosis and signing fields are refused as audited values; a BC has no write on the tables", async () => {
    const v = await visit(A, await patient(A));
    const { intakeId } = await as(BC, (db) => openIntake(db, key(), v));
    expect(await as(BC, (db) => saveIntake(db, key(), intakeId, { complaint: "Gatal", diagnosis: "Dermatitis" } as never))).toMatchObject({ ok: false, code: "diagnosis_forbidden" });
    expect(await as(BC, (db) => saveIntake(db, key(), intakeId, { facts: [{ kind: "note", value: "x", icd10: "L20" }] } as never))).toMatchObject({ ok: false, code: "diagnosis_forbidden" });
    expect(await as(BC, (db) => saveIntake(db, key(), intakeId, { complaint: "Gatal", signed_by: "dr" } as never))).toMatchObject({ ok: false, code: "sign_forbidden" });
    expect(await as(BC, (db) => saveIntake(db, key(), intakeId, { complaint: "Gatal", tanda_tangan: true } as never))).toMatchObject({ ok: false, code: "sign_forbidden" });
    expect((await audits(intakeId)).filter((r) => r.outcome === "denied").map((r) => r.reason_code)).toEqual(["diagnosis_forbidden", "diagnosis_forbidden", "sign_forbidden", "sign_forbidden"]);
    // No direct write on the clinical tables for the app role; and facts carry the unverified provenance only.
    for (const sql of [`update intakes set complaint = 'x'`, `insert into intake_facts (tenant_id) values (gen_random_uuid())`, `delete from skin_observations`]) {
      expect(await as(BC, (db) => db.query(sql).then(() => "ok", (e) => e.code))).toBe("42501");
    }
    await as(BC, (db) => saveIntake(db, key(), intakeId, { complaint: "Gatal", facts: [{ kind: "condition", value: "Ruam" }] }));
    expect((await h.admin.query(`select provenance from intake_facts where intake_id = $1`, [intakeId])).rows.map((r) => r.provenance)).toEqual(["bc_captured_unverified"]);
  });
});

describe("authority, lifecycle and the visit step", () => {
  it("a non-BC is refused before the intake is looked up (review r1 P3-1)", async () => {
    for (const who of [DOC, FO, OWN]) {
      expect(await code(as(who, (db) => saveIntake(db, key(), crypto.randomUUID(), { complaint: "x" })))).toBe("ERR_FORBIDDEN");
      expect(await code(as(who, (db) => sendIntake(db, key(), crypto.randomUUID())))).toBe("ERR_FORBIDDEN");
    }
    expect(await code(as(BC, (db) => saveIntake(db, key(), crypto.randomUUID(), { complaint: "x" })))).toBe("ERR_NOT_FOUND");
  });

  it("only a BC of the visit's branch opens; only the author edits and sends; a sent intake is final", async () => {
    const p = await patient(A);
    const v = await visit(A, p);
    for (const who of [DOC, NUR, FO, FH, OWN, FIN]) expect(await code(as(who, (db) => openIntake(db, key(), v)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(BCB2, (db) => openIntake(db, key(), v)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BBC, (db) => openIntake(db, key(), v)))).toBe("ERR_NOT_FOUND");
    expect((await h.admin.query(`select intake from visits where id = $1`, [v])).rows[0].intake).toBe("not_started");
    const { intakeId } = await as(BC, (db) => openIntake(db, key(), v));
    expect((await h.admin.query(`select intake from visits where id = $1`, [v])).rows[0].intake).toBe("in_progress");
    expect((await as(BC2, (db) => openIntake(db, key(), v))).intakeId).toBe(intakeId); // one per visit
    expect(await code(as(BC2, (db) => saveIntake(db, key(), intakeId, { complaint: "Bukan penulis" })))).toBe("ERR_FORBIDDEN");
    expect(await code(as(BC, (db) => sendIntake(db, key(), intakeId)))).toBe("ERR_INVALID_INPUT"); // complaint required
    await as(BC, (db) => saveIntake(db, key(), intakeId, { complaint: "Flek di pipi" }));
    expect(await code(as(BC2, (db) => sendIntake(db, key(), intakeId)))).toBe("ERR_FORBIDDEN");
    await as(BC, (db) => sendIntake(db, key(), intakeId));
    expect((await h.admin.query(`select state, sent_at is not null as s from intakes where id = $1`, [intakeId])).rows[0]).toEqual({ state: "sent", s: true });
    expect((await h.admin.query(`select intake from visits where id = $1`, [v])).rows[0].intake).toBe("done");
    expect(await code(as(BC, (db) => saveIntake(db, key(), intakeId, { complaint: "Ubah" })))).toBe("ERR_VERSION_CONFLICT");
    expect(await code(as(BC, (db) => sendIntake(db, key(), intakeId)))).toBe("ERR_VERSION_CONFLICT");
  });

  it("a closed visit refuses the intake; a tenant in exit refuses the writers (suspended still serves visits, as T-047)", async () => {
    const v = await visit(A, await patient(A));
    await h.admin.query(`update visits set intake = 'not_needed', payment = 'not_needed', closed_at = now(), closed_by = checked_in_by where id = $1`, [v]);
    expect(await code(as(BC, (db) => openIntake(db, key(), v)))).toBe("ERR_VERSION_CONFLICT");
    const S = await tenant();
    const sbc = await person(S, "bc", S.b1);
    const sv = await visit(S, await patient(S));
    await h.admin.query(`update tenants_registry set lifecycle_state = 'suspended' where id = $1`, [S.tenantId]);
    expect(await code(as(sbc, (db) => openIntake(db, key(), sv)))).toBe("ok");
    await h.admin.query(`update tenants_registry set lifecycle_state = 'exit' where id = $1`, [S.tenantId]);
    expect(await code(as(sbc, (db) => openIntake(db, key(), sv)))).toBe("ERR_TENANT_SUSPENDED");
  });

  it("guards: never deleted, a sent intake and its parts never change, no truncate, triggers always enabled", async () => {
    const v = await visit(A, await patient(A));
    const { intakeId } = await as(BC, (db) => openIntake(db, key(), v));
    await as(BC, (db) => saveIntake(db, key(), intakeId, { complaint: "Kusam", facts: [{ kind: "note", value: "Catatan" }], observation: { chips: ["kering"] } }));
    await expect(h.admin.query(`delete from intakes where id = $1`, [intakeId])).rejects.toThrow(/never deleted/);
    await expect(h.admin.query(`update intakes set author_id = $2 where id = $1`, [intakeId, BC2.staffId])).rejects.toThrow(/keeps its visit/);
    await as(BC, (db) => sendIntake(db, key(), intakeId));
    await expect(h.admin.query(`update intakes set complaint = 'x' where id = $1`, [intakeId])).rejects.toThrow(/sent intake is final/);
    await expect(h.admin.query(`update intake_facts set value = 'x' where intake_id = $1`, [intakeId])).rejects.toThrow(/sent intake is final/);
    await expect(h.admin.query(`delete from skin_observations where intake_id = $1`, [intakeId])).rejects.toThrow(/sent intake is final/);
    for (const t of ["intakes", "intake_facts", "skin_observations"]) await expect(h.admin.query(`truncate ${t} cascade`)).rejects.toThrow();
    const trig = (await h.admin.query(`select tgname, tgenabled from pg_trigger where tgrelid in ('intakes'::regclass, 'intake_facts'::regclass, 'skin_observations'::regclass) and not tgisinternal order by 1`)).rows;
    expect(trig.map((r) => `${r.tgname}:${r.tgenabled}`)).toEqual([
      "intake_facts_guard:A", "intake_facts_no_truncate:A", "intakes_guard:A", "intakes_no_truncate:A", "skin_observations_guard:A", "skin_observations_no_truncate:A"]);
  });

  it("audit and events carry ids and codes only", async () => {
    const v = await visit(A, await patient(A));
    const { intakeId } = await as(BC, (db) => openIntake(db, key(), v));
    await as(BC, (db) => saveIntake(db, key(), intakeId, { complaint: "Keluhan rahasia", facts: [{ kind: "allergy", value: "Kacang" }] }));
    await as(BC, (db) => sendIntake(db, key(), intakeId));
    expect((await audits(intakeId)).map((r) => r.reason_code)).toEqual(["intake_opened", "intake_saved", "intake_sent"]);
    const ev = (await h.admin.query(`select type, payload from domain_events where aggregate_id = $1 order by occurred_at`, [intakeId])).rows;
    expect(ev.map((e) => e.type)).toEqual(["IntakeOpened", "IntakeSent"]);
    expect(JSON.stringify(ev)).not.toMatch(/rahasia|Kacang/i);
    expect(Object.keys(ev[1].payload).sort()).toEqual(["author_id", "branch_id", "intake_id", "patient_id", "visit_id"]);
  });
});

describe("readers on the wall clock (plan r1 P1-3)", () => {
  it("BC, doctor, facility head and records officer read the intake at their branch; nurse, therapist, pharmacist, FO, finance, marketing do not", async () => {
    const v = await visit(A, await patient(A, "Tamu Baca"));
    const { intakeId } = await as(BC, (db) => openIntake(db, key(), v));
    await as(BC, (db) => saveIntake(db, key(), intakeId, { complaint: "Kulit berminyak", observation: { chips: ["berminyak"] } }));
    const rows = (who: P) => as(who, async (db) => (await db.query(`select count(*)::int as n from intakes where id = $1`, [intakeId])).rows[0].n as number);
    for (const who of [BC, BC2, DOC, FH, RO]) expect(await rows(who)).toBe(1);
    for (const who of [NUR, TH, PH, FO, FIN, MK, OWN, BCB2]) expect(await rows(who)).toBe(0);
    expect((await as(DOC, (db) => visitIntake(db, v))).intake?.complaint).toBe("Kulit berminyak");
    for (const who of [NUR, PH, FO, BCB2]) expect(await code(as(who, (db) => visitIntake(db, v)))).toBe("ERR_NOT_FOUND");
    // A doctor of both branches acting at b2 does not read b1's intake: the session's allowed branches decide too.
    const dBoth = await person(A, "doctor", A.b2, A.b1);
    const atB2 = await resolveContext(app, dBoth.acc, { tenantId: A.tenantId, actingRole: "doctor", activeBranchId: A.b2 });
    expect(await withTenantContext(app, { ...atB2, allowedBranchIds: [A.b2] }, async (db) => (await db.query(`select count(*)::int as n from intakes where id = $1`, [intakeId])).rows[0].n)).toBe(0);
    expect(await withTenantContext(app, { ...atB2, allowedBranchIds: [A.b2, A.b1] }, async (db) => (await db.query(`select count(*)::int as n from intakes where id = $1`, [intakeId])).rows[0].n)).toBe(1);
    // A doctor whose branch role is removed loses the read at once (the staff_branches row is gone on the wall clock).
    const d2 = await person(A, "doctor", A.b1);
    const ctx = await resolveContext(app, d2.acc, { tenantId: A.tenantId, actingRole: "doctor", activeBranchId: A.b1 });
    await h.admin.query(`delete from staff_branches where staff_id = $1`, [d2.staffId]);
    expect(await withTenantContext(app, ctx, async (db) => (await db.query(`select count(*)::int as n from intakes where id = $1`, [intakeId])).rows[0].n)).toBe(0);
    // The queue: the BC of the branch sees the visit with the intake state and author; others are refused.
    const q = await as(BC, (db) => queue(db, A.b1));
    expect(q.visits.find((x) => x.id === v)).toMatchObject({ intakeState: "draft", authorId: BC.staffId, patientName: "Tamu Baca" });
    for (const who of [DOC, FO, NUR]) expect(await code(as(who, (db) => queue(db, A.b1)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(BC, (db) => queue(db, A.b2)))).toBe("ERR_NOT_FOUND");
  });

  it("vendor class clinical; helpers not executable by app, vendor or operator; cross-tenant reads nothing", async () => {
    const kinds = (await h.admin.query(`select table_name, support_class from support_object_kinds where table_name in ('public.intakes','public.intake_facts','public.skin_observations') order by 1`)).rows;
    expect(kinds.map((k) => k.support_class)).toEqual(["clinical", "clinical", "clinical"]);
    for (const f of ["intakes_guard()", "intake_parts_guard()", "intake_history(uuid,uuid,uuid)", "intake_actor_visit(uuid)", "intake_draft(uuid)"]) {
      for (const r of ["clinic_app", "clinic_vendor", "clinic_operator"]) {
        expect((await h.admin.query(`select has_function_privilege($1, $2, 'execute') as ok`, [r, `public.${f}`])).rows[0].ok, `${r} ${f}`).toBe(false);
      }
    }
    const v = await visit(A, await patient(A));
    const { intakeId } = await as(BC, (db) => openIntake(db, key(), v));
    expect(await as(BBC, async (db) => (await db.query(`select count(*)::int as n from intakes where id = $1`, [intakeId])).rows[0].n)).toBe(0);
    expect(await code(as(BBC, (db) => saveIntake(db, key(), intakeId, { complaint: "Coba" })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BBC, (db) => sendIntake(db, key(), intakeId)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BBC, (db) => visitIntake(db, v)))).toBe("ERR_NOT_FOUND");
  });
});
