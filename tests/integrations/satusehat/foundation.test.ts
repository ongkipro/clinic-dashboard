// T-102 increment 1 gate (plan r4 §Delivery; PR-35, TD-30–TD-33, DEC-113): Scenario PR-35 outage; the reporting context at signing; lease,
// fence and crash recovery; uncertain create (search by the stable identifier) and uncertain update (read back, content compared); the
// late-old-write barrier; organization binding; credentials (sealed, never readable, rotation, token cache keyed by tenant and generation);
// identity states incl. a demographics conflict; materializer pinning; transitions; roles, branches, tenants and the vendor. The port is the
// mock with guide-shaped synthetic fixtures (not recorded sandbox responses); fetch is stubbed and never called. Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Role } from "../../../src/auth/policy";
import { APP_GROUP_ROLE, VENDOR_GROUP_ROLE, withTenantContext } from "../../../src/db/rls/context";
import { openAppPool } from "../../../src/db/rls/pool";
import { CommandError } from "../../../src/lib/command";
import { decryptField, encryptField, type KekRing } from "../../../src/lib/keys/envelope";
import { setKekRingForTests } from "../../../src/lib/keys/runtime";
import { openExam, saveExam } from "../../../src/modules/clinical/exam/exam";
import { correctRecord, signRecord, type StepUp } from "../../../src/modules/clinical/records/records";
import { SOURCE } from "../../../src/modules/integrations/satusehat/fixtures";
import { mockSatusehatPort, type MockSatusehat } from "../../../src/modules/integrations/satusehat/mock";
import { condition, encounter } from "../../../src/modules/integrations/satusehat/fhir";
import type { Fhir } from "../../../src/modules/integrations/satusehat/port";
import { bodyFingerprint, clearTokenCache, credentialStatus, linkPractitioner, monitor, resend, resolveIdentity, revokeCredentials, runSatusehatSync,
  SECRET_PURPOSE, setContextRoom, setCredentials, tokenCacheKeys } from "../../../src/modules/integrations/satusehat/satusehat";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { IDENTITY_PURPOSE } from "../../../src/modules/patients/patients";
import { bootstrapVendor, createVendorStaff } from "../../../src/modules/vendor/staff/staff";
import { openSession } from "../../../src/modules/vendor/support/support";
import { createHarness, type Harness, testPool } from "../../rls/harness";

process.env.DEPLOY_ENV = "local"; // sandbox environment (satusehat_env), synthetic data

let h: Harness;
let app: pg.Pool;
let worker: pg.Pool;
let owner: pg.Pool;
let n = 0;
const RING: KekRing = { current: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) };
const STEP: StepUp = { verified: true };
type T = { tenantId: string; b1: string; b2: string; org1: string; org2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "admin_pusat", "finance", "marketing", "central_cs", "auditor", "purchasing"];

async function tenant(name: string): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, name]);
  const org1 = `1000${String(++n).padStart(4, "0")}`; const org2 = `2000${String(++n).padStart(4, "0")}`;
  const br = async (c: string, org: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone, satusehat_org_id) values ($1, $2, $2, 'Asia/Jakarta', $3) returning id`,
    [tenantId, c, org])).rows[0].id as string;
  return { tenantId, b1: await br("S1", org1), b2: await br("S2", org2), org1, org2 };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`ss${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf SS ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  const bs = TENANT_WIDE.includes(role) ? [] : branches.length ? branches : [t.b1];
  for (const b of bs) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: bs[0] };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const key = () => crypto.randomUUID();
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const raw = (sql: string, args: unknown[] = []) => h.admin.query(sql, args).then(() => "ok", (e) => `raw:${e.code}`);

// A verified STR + SIP for the branch (fixture: recorded by `rec`, verified by `ver` — never the holder, the verifier check).
async function credential(t: T, p: P, branch: string, rec: P, ver: P) {
  for (const [kind, b] of [["str", null], ["sip", branch]] as const) {
    const id = (await h.admin.query(
      `insert into staff_credentials (tenant_id, staff_id, kind, number, issuer, profession, branch_id, valid_from, expires_on, recorded_by)
       values ($1, $2, $3, $4, 'Konsil Kesehatan', 'dokter', $5, '2024-01-01', $6, $7) returning id`,
      [t.tenantId, p.staffId, kind, `NO-SS-${++n}`, b, b ? "2099-12-31" : null, rec.staffId])).rows[0].id as string;
    await h.admin.query(`update staff_credentials set state = 'verified', decided_by = $2, decided_at = now() where id = $1`, [id, ver.staffId]);
  }
}
// A patient with a sealed NIK (synthetic) or without one.
async function patient(t: T, o: { name?: string; nik?: string; birth?: string; sex?: "female" | "male" } = {}) {
  const enc = o.nik ? encryptField(RING, await keysFor(t), IDENTITY_PURPOSE, o.nik) : null;
  const bidx = o.nik ? `bidx${String(++n).padStart(39, "0")}` : null;
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, no_identity_reason, religion, occupation, education,
       marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $2, $3, $4, $5, $6, $7, $8, 'islam', 'Karyawan', 's1', 'kawin', $9,
       (select id from staff where tenant_id = $1 limit 1), 'fo_cashier') returning id`,
    [t.tenantId, o.name ?? "Siti Rahma", o.birth ?? "1990-06-15", o.sex ?? "female", o.nik ? "nik" : "newborn_via_guardian", enc, bidx,
     o.nik ? null : "Fixture sintetis", t.b1])).rows[0].id as string;
}
const keyRows = new Map<string, { version: number; wrapped: string }>();
async function dek(t: T) {
  if (!keyRows.has(t.tenantId)) {
    const { newWrappedDek } = await import("../../../src/lib/keys/envelope");
    const w = newWrappedDek(RING, t.tenantId, 1);
    await h.admin.query(`insert into tenant_data_keys (tenant_id, version, wrapped, is_current) values ($1, 1, $2, true) on conflict do nothing`, [t.tenantId, w.wrapped]);
    const r = (await h.admin.query(`select version, wrapped from tenant_data_keys where tenant_id = $1 and version = 1`, [t.tenantId])).rows[0];
    keyRows.set(t.tenantId, r);
  }
  return { tenantId: t.tenantId, ...keyRows.get(t.tenantId)! };
}
async function keysFor(t: T) {
  const d = await dek(t);
  return { tenantId: t.tenantId, current: d, byVersion: (v: number) => (v === d.version ? d : undefined) };
}
async function room(t: T, branch: string, loc: string | null) {
  return (await h.admin.query(`insert into rooms (tenant_id, branch_id, name, kind, satusehat_location_id) values ($1, $2, $3, 'consultation', $4) returning id`,
    [t.tenantId, branch, `Ruang ${++n}`, loc])).rows[0].id as string;
}
// A walk-in visit with a queue ticket called to `roomId` (the fixture stands in for check-in and Panggil: M1 writers).
async function visit(t: T, branch: string, pt: string, roomId: string | null) {
  const by = (await h.admin.query(`select id from staff where tenant_id = $1 limit 1`, [t.tenantId])).rows[0].id;
  const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by, checked_in_at)
     values ($1, $2, $3, 'walk_in', $4, now() - interval '2 hours') returning id`, [t.tenantId, branch, pt, by])).rows[0].id as string;
  const tk = (await h.admin.query(`insert into queue_tickets (tenant_id, branch_id, queue_date, seq, prefix, visit_id)
     values ($1, $2, current_date, $3, 'A', $4) returning id`, [t.tenantId, branch, ++n, v])).rows[0].id as string;
  if (roomId) await h.admin.query(`update queue_tickets set state = 'called', called_at = now(), called_by = $2, room_id = $3 where id = $1`, [tk, by, roomId]);
  return { v, tk };
}
const close = (v: string) => h.admin.query(`update visits set closed_at = now() - interval '1 minute', closed_by = checked_in_by where id = $1`, [v]);
async function signed(t: T, doc: P, branch: string, pt: string, roomId: string | null, codes = ["L70.0"]) {
  const { v, tk } = await visit(t, branch, pt, roomId);
  const { examId } = await as(doc, (db) => openExam(db, key(), v));
  await as(doc, (db) => saveExam(db, key(), examId, { assessment: "Akne", icd10_codes: codes, vitals: { nadi: 80 } }));
  await as(doc, (db) => signRecord(db, key(), examId, STEP));
  return { v, tk, examId };
}
const outbox = async (v: string) => (await h.admin.query(`select state, hold_reason, revision, kind from satusehat_outbox where visit_id = $1 order by created_at, id`, [v])).rows;
const links = async (v: string) => (await h.admin.query(`select fhir_type, local_key, status, status_reason, remote_id, current_revision, confirmed_revision, organization_id
  from satusehat_links where visit_id = $1 order by fhir_type <> 'Encounter', local_key`, [v])).rows;
const attempts = async (v: string) => (await h.admin.query(`select a.verb, a.outcome, a.revision from satusehat_attempts a join satusehat_links l on l.id = a.link_id
  where l.visit_id = $1 order by a.started_at, a.id`, [v])).rows;
const at = (min: number) => new Date(Date.now() + min * 60_000);
const FP = "a".repeat(64); // a write's body fingerprint for direct definer calls
// One worker statement in its own transaction with the deploy env bound (as the worker does), for the fence and barrier steps.
async function wq<R = unknown>(sql: string, args: unknown[] = []): Promise<R> {
  const c = await worker.connect();
  try {
    await c.query("begin");
    await c.query(`select set_config('app.deploy_env', 'local', true)`);
    const r = (await c.query(sql, args)).rows[0];
    await c.query("commit");
    return (r ? Object.values(r)[0] : null) as R;
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}
const sync = (port: MockSatusehat, min = 0) => runSatusehatSync(worker, { port, now: at(min) });

const fetchSpy = vi.fn();
let A: T; let B: T;
let OWN: P; let AP: P; let MGR: P; let FH: P; let RO: P; let DOC: P; let FO: P; let RO2: P; let BOWN: P; let BRO: P;
let room1: string; let room2: string;

beforeAll(async () => {
  setKekRingForTests(RING);
  vi.stubGlobal("fetch", fetchSpy);
  h = await createHarness();
  const login = h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE]));
  app = await openAppPool({ connectionString: login, max: 6 });
  worker = await openAppPool({ connectionString: login, max: 2 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant("PT Klinik SATUSEHAT Sintetis");
  B = await tenant("PT Klinik Lain SATUSEHAT");
  OWN = await person(A, "owner"); AP = await person(A, "admin_pusat"); MGR = await person(A, "manager"); FH = await person(A, "facility_head");
  RO = await person(A, "records_officer"); DOC = await person(A, "doctor"); FO = await person(A, "fo_cashier"); RO2 = await person(A, "records_officer", A.b2);
  BOWN = await person(B, "owner"); BRO = await person(B, "records_officer");
  await credential(A, DOC, A.b1, OWN, FH);
  room1 = await room(A, A.b1, "loc-a1-0001"); room2 = await room(A, A.b1, "loc-a1-0002");
  await as(OWN, (db) => setCredentials(db, key(), { branchId: A.b1, environment: "sandbox", organizationId: A.org1, clientId: "client-a1", clientSecret: "rahasia-sintetis-a1" }));
  await as(OWN, (db) => linkPractitioner(db, key(), { staffId: DOC.staffId, ihs: "N10000001" }));
});
afterEach(() => expect(fetchSpy).not.toHaveBeenCalled());
afterAll(async () => {
  vi.unstubAllGlobals();
  setKekRingForTests(undefined);
  await app?.end();
  await worker?.end();
  await owner?.end();
  await h?.close();
});

// A NIK patient the mock knows exactly once with the same demographics.
async function knownPatient(port: MockSatusehat, ihs: string, o: { name?: string } = {}) {
  const nik = `3174${String(++n).padStart(12, "0")}`;
  const pt = await patient(A, { nik, name: o.name ?? "Siti Rahma" });
  port.patients.set(nik, [{ ihs, name: "SITI  RAHMA", birthDate: "1990-06-15", gender: "female" }]);
  return { pt, nik };
}

describe("T-102 Scenario PR-35 (outage) and the reporting context", () => {
  it("SATUSEHAT unreachable: the doctor signs, the record is saved, an outbox item waits and the monitor shows it pending; it sends once reachable", async () => {
    const port = mockSatusehatPort();
    expect(port.source).toBe(SOURCE);
    const { pt } = await knownPatient(port, "P10000001");
    const { v } = await signed(A, DOC, A.b1, pt, room1);
    expect(await outbox(v)).toEqual([{ state: "queued", hold_reason: null, revision: 1, kind: "revision" }]);
    expect((await h.admin.query(`select state from examinations where visit_id = $1`, [v])).rows[0].state).toBe("signed");
    expect(await sync(port)).toMatchObject({ leased: 0 }); // not before the visit closes
    await close(v);
    port.next("token", { kind: "throw" }); // unreachable
    expect(await sync(port)).toMatchObject({ leased: 1, queued: 1, done: 0 });
    expect((await as(RO, (db) => monitor(db, A.b1))).outbox).toMatchObject({ queued: expect.any(Number) });
    // identity looked up and matched (one result, same birth date, gender and name after normalisation)
    port.next("token", { kind: "ok" });
    const r = await sync(port, 6);
    expect(r).toMatchObject({ done: 1 });
    expect(await links(v)).toEqual([
      expect.objectContaining({ fhir_type: "Encounter", status: "confirmed", confirmed_revision: 1, organization_id: A.org1 }),
      expect.objectContaining({ fhir_type: "Condition", local_key: "exam:L70.0", status: "confirmed", confirmed_revision: 1 }),
    ]);
    const enc = [...port.store.values()].find((x) => x.resourceType === "Encounter" && JSON.stringify(x.identifier).includes(v))!;
    expect(enc).toMatchObject({ class: { code: "AMB" }, subject: { reference: "Patient/P10000001" }, serviceProvider: { reference: `Organization/${A.org1}` },
      identifier: [{ system: `http://sys-ids.kemkes.go.id/encounter/${A.org1}`, value: v }], location: [{ location: { reference: "Location/loc-a1-0001" } }],
      participant: [{ individual: { reference: "Practitioner/N10000001" } }] });
    expect((enc.statusHistory as { status: string }[]).map((s) => s.status)).toEqual(["arrived", "in-progress", "finished"]);
    const cond = [...port.store.values()].find((x) => x.resourceType === "Condition" && JSON.stringify(x.identifier).includes(v))!;
    expect(cond).toMatchObject({ identifier: [{ system: `http://sys-ids.kemkes.go.id/condition/${A.org1}`, value: `${v}:L70.0` }], code: { coding: [{ code: "L70.0" }] },
      encounter: { reference: `Encounter/${enc.id}` } });
    // the Encounter now names its diagnosis (updated after the Condition was confirmed)
    expect(enc.diagnosis ?? port.store.get(enc.id!)!.diagnosis).toBeDefined();
    expect((port.store.get(enc.id!)!.diagnosis as { condition: { reference: string } }[])[0].condition.reference).toBe(`Condition/${cond.id}`);
    expect(await outbox(v)).toEqual([{ state: "done", hold_reason: null, revision: 1, kind: "revision" }]);
    // nothing clinical or identifying in events
    const ev = (await h.admin.query(`select payload::text p from domain_events where tenant_id = $1 and type like 'Satusehat%'`, [A.tenantId])).rows.map((r) => r.p).join();
    expect(ev).not.toMatch(/L70|Akne|Siti|3174/);
  });

  it("the room is the one called at signing; a later re-call does not change it; no called room → held no_room until a records officer sets one", async () => {
    const port = mockSatusehatPort();
    const { pt } = await knownPatient(port, "P10000002");
    const { v, tk } = await signed(A, DOC, A.b1, pt, room1);
    await h.admin.query(`update queue_tickets set room_id = $2 where id = $1`, [tk, room2]); // re-called after signing
    expect((await h.admin.query(`select room_id from satusehat_visit_context where visit_id = $1`, [v])).rows[0].room_id).toBe(room1);
    const pt2 = (await knownPatient(port, "P10000003")).pt;
    const s2 = await signed(A, DOC, A.b1, pt2, null);
    await close(v); await close(s2.v);
    await sync(port);
    expect(await outbox(s2.v)).toEqual([expect.objectContaining({ state: "held", hold_reason: "no_room" })]);
    expect(await code(as(FO, (db) => setContextRoom(db, s2.v, room2)))).toBe("ERR_FORBIDDEN");
    expect(await code(as(RO2, (db) => setContextRoom(db, s2.v, room2)))).toBe("ERR_NOT_FOUND");
    await as(RO, (db) => setContextRoom(db, s2.v, room2));
    expect(await code(as(RO, (db) => setContextRoom(db, s2.v, room1)))).toBe("ERR_VERSION_CONFLICT");
    await sync(port, 1);
    expect((await outbox(s2.v)).map((o) => o.state)).toEqual(["superseded", "done"]);
  });
});

describe("T-102 facility context, credentials and the token cache", () => {
  it("credentials: sealed, never readable by the app, never in a reader; owner / admin_pusat only; the organization must equal the branch's", async () => {
    const st = await as(OWN, (db) => credentialStatus(db));
    expect(JSON.stringify(st)).not.toMatch(/rahasia|secret_enc|v1\./);
    expect(await raw(`set role clinic_app; select secret_enc from satusehat_credentials`)).toMatch(/^raw:/);
    await h.admin.query(`reset role`);
    const sealed = (await h.admin.query(`select secret_enc from satusehat_credentials where tenant_id = $1 and branch_id = $2 and revoked_at is null`, [A.tenantId, A.b1])).rows[0].secret_enc;
    expect(sealed).not.toContain("rahasia");
    expect(decryptField(RING, await keysFor(A), SECRET_PURPOSE, sealed)).toBe("rahasia-sintetis-a1");
    for (const p of [MGR, FH, RO, DOC, FO]) expect(await code(as(p, (db) => credentialStatus(db))), p.role).toBe("ERR_FORBIDDEN");
    expect(await code(as(AP, (db) => setCredentials(db, key(), { branchId: A.b2, environment: "sandbox", organizationId: "99999999", clientId: "client-x", clientSecret: "rahasia-sintetis" }))))
      .toBe("ERR_INVALID_INPUT"); // organization_mismatch (a valid client id: only the organization is wrong)
    for (const p of [MGR, FH]) expect(await code(as(p, (db) => setCredentials(db, key(), { branchId: A.b1, environment: "sandbox", organizationId: A.org1,
      clientId: "client-x", clientSecret: "rahasia-sintetis-x" }))), p.role).toBe("ERR_FORBIDDEN");
    expect(await code(as(BOWN, (db) => setCredentials(db, key(), { branchId: A.b1, environment: "sandbox", organizationId: A.org1, clientId: "c", clientSecret: "rahasia-sintetis" }))))
      .toBe("ERR_NOT_FOUND");
  });

  it("two branches use their own credentials and organization; rotation and an organization change never reuse a cached token; tenants never share a cache entry", async () => {
    const port = mockSatusehatPort();
    clearTokenCache();
    await credential(A, DOC, A.b2, OWN, FH);
    const roomB2 = await room(A, A.b2, "loc-a2-0001");
    await as(OWN, (db) => setCredentials(db, key(), { branchId: A.b2, environment: "sandbox", organizationId: A.org2, clientId: "client-a2", clientSecret: "rahasia-sintetis-a2" }));
    const DOC2 = { ...DOC, branch: A.b2 };
    const rid = (await h.admin.query(`select id from staff_roles where staff_id = $1 and role = 'doctor'`, [DOC.staffId])).rows[0].id as string;
    await assignBranch(h.admin, { tenantId: A.tenantId, staffRoleId: rid, branchId: A.b2 });
    const p1 = (await knownPatient(port, "P10000010")).pt; const p2 = (await knownPatient(port, "P10000011")).pt;
    const s1 = await signed(A, DOC, A.b1, p1, room1); const s2 = await signed(A, DOC2, A.b2, p2, roomB2);
    await close(s1.v); await close(s2.v);
    await sync(port);
    const encs = [...port.store.values()].filter((x) => x.resourceType === "Encounter" && [s1.v, s2.v].some((v) => JSON.stringify(x.identifier).includes(v)));
    expect(encs.map((e) => (e.serviceProvider as { reference: string }).reference).sort()).toEqual([`Organization/${A.org1}`, `Organization/${A.org2}`].sort());
    expect(new Set(port.calls.filter((c) => c.kind === "token").map((c) => c.clientId))).toEqual(new Set(["client-a1", "client-a2"]));
    expect(tokenCacheKeys().every((k) => k.startsWith(`${A.tenantId}|`))).toBe(true);
    // rotation: a new generation → a new token, never the cached one
    const before = port.count("token");
    await as(OWN, (db) => setCredentials(db, key(), { branchId: A.b1, environment: "sandbox", organizationId: A.org1, clientId: "client-a1b", clientSecret: "rahasia-sintetis-a1b" }));
    const p3 = (await knownPatient(port, "P10000012")).pt;
    const s3 = await signed(A, DOC, A.b1, p3, room1); await close(s3.v);
    await sync(port, 1);
    expect(port.count("token")).toBeGreaterThan(before);
    expect(port.calls.filter((c) => c.kind === "token").at(-1)!.clientId).toBe("client-a1b");
    // a B1 visit whose room carries a location id registered on a B2 room → held location_conflict (audited as an event), nothing sent
    const roomBad = await room(A, A.b1, "loc-a2-0001x");
    await room(A, A.b2, "loc-a2-0001x");
    const p4 = (await knownPatient(port, "P10000013")).pt;
    const s4 = await signed(A, DOC, A.b1, p4, roomBad); await close(s4.v);
    const creates = port.count("create");
    await sync(port, 2);
    expect(await outbox(s4.v)).toEqual([expect.objectContaining({ state: "held", hold_reason: "location_conflict" })]);
    expect(port.count("create")).toBe(creates);
    expect((await h.admin.query(`select count(*)::int c from domain_events where type = 'SatusehatHeld' and aggregate_id in (select id from satusehat_outbox where visit_id = $1)`, [s4.v])).rows[0].c).toBe(1);
    // no credentials for the environment → held credentials_missing
    const st = await as(OWN, (db) => credentialStatus(db));
    await as(OWN, (db) => revokeCredentials(db, st.find((c) => c.branch_id === A.b2 && !c.revoked_at)!.id));
    const p5 = (await knownPatient(port, "P10000014")).pt;
    const s5 = await signed(A, DOC2, A.b2, p5, roomB2); await close(s5.v);
    await sync(port, 3);
    expect(await outbox(s5.v)).toEqual([expect.objectContaining({ state: "held", hold_reason: "credentials_missing" })]);
  });

  it("organization binding: a confirmed Encounter whose branch organization is replaced is not updated under the new one (exception organization_changed)", async () => {
    const port = mockSatusehatPort();
    const C = await tenant("PT Klinik Ganti Organisasi");
    const cOwn = await person(C, "owner"); const cDoc = await person(C, "doctor"); const cRo = await person(C, "records_officer");
    await credential(C, cDoc, C.b1, cOwn, cRo);
    const r = await room(C, C.b1, "loc-c1-0001");
    await withTenantContext(app, await resolveContext(app, cOwn.acc, { tenantId: C.tenantId, actingRole: "owner" }), (db) =>
      setCredentials(db, key(), { branchId: C.b1, environment: "sandbox", organizationId: C.org1, clientId: "client-c1", clientSecret: "rahasia-sintetis-c1" }));
    await withTenantContext(app, await resolveContext(app, cOwn.acc, { tenantId: C.tenantId, actingRole: "owner" }), (db) => linkPractitioner(db, key(), { staffId: cDoc.staffId, ihs: "N30000001" }));
    const nik = `3174${String(++n).padStart(12, "0")}`;
    const pt = await patient(C, { nik });
    port.patients.set(nik, [{ ihs: "P30000001", name: "Siti Rahma", birthDate: "1990-06-15", gender: "female" }]);
    const s = await signed(C, cDoc, C.b1, pt, r);
    await close(s.v);
    await sync(port);
    expect((await links(s.v)).every((l) => l.status === "confirmed")).toBe(true);
    // the organization is replaced (branch writer stand-in) with matching new credentials, then the record is corrected
    const newOrg = "10999999";
    await h.admin.query(`update branches set satusehat_org_id = $2 where id = $1`, [C.b1, newOrg]);
    await withTenantContext(app, await resolveContext(app, cOwn.acc, { tenantId: C.tenantId, actingRole: "owner" }), (db) =>
      setCredentials(db, key(), { branchId: C.b1, environment: "sandbox", organizationId: newOrg, clientId: "client-c1n", clientSecret: "rahasia-sintetis-c1n" }));
    await withTenantContext(app, await resolveContext(app, cDoc.acc, { tenantId: C.tenantId, actingRole: "doctor", activeBranchId: C.b1 }), (db) =>
      correctRecord(db, key(), s.examId, { icd10_codes: ["L70.0", "L71.0"] }, "Koreksi diagnosis"));
    const updates = port.count("update");
    await sync(port, 1);
    expect(port.count("update")).toBe(updates);
    expect((await links(s.v)).filter((l) => l.organization_id === C.org1).map((l) => [l.status, l.status_reason]))
      .toEqual([["exception", "organization_changed"], ["exception", "organization_changed"]]);
    void cRo;
  });
});

describe("T-102 lease, fence, crash recovery, uncertain create and update, the late-write barrier", () => {
  it("two workers at once: one lease per visit; the second pass leases nothing for that visit", async () => {
    const port = mockSatusehatPort();
    const { pt } = await knownPatient(port, "P10000020");
    const { v } = await signed(A, DOC, A.b1, pt, room1); await close(v);
    const [a, b] = await Promise.all([sync(port), sync(port)]);
    expect(a.leased + b.leased).toBeGreaterThanOrEqual(1);
    expect(port.count("create", "Encounter")).toBe(1);
    expect((await outbox(v)).at(-1)!.state).toBe("done");
  });

  it("crash after a remote commit: the expired lease turns the in-flight write into outcome_unknown; reconciliation finds it — no duplicate", async () => {
    const port = mockSatusehatPort();
    const { pt } = await knownPatient(port, "P10000021");
    const { v } = await signed(A, DOC, A.b1, pt, room1); await close(v);
    // a worker leases, materializes and begins the Encounter create, the remote commits, then the worker dies (no finish, no release)
    const wc = await worker.connect();
    try {
      await wc.query(`select set_config('app.deploy_env', 'local', false)`);
      const [c] = (await wc.query(`select satusehat_claim($1) r`, [at(0)])).rows[0].r as { id: string; gen: number }[];
      await wc.query(`select satusehat_identity_record($1, $2, '{"kind":"one","ihs":"P10000021","name":"Siti Rahma","birth_date":"1990-06-15","gender":"female"}'::jsonb, $3)`, [c.id, c.gen, at(0)]);
      const pk = (await wc.query(`select satusehat_prepare($1, $2, $3) r`, [c.id, c.gen, at(0)])).rows[0].r;
      const enc = pk.links.find((l: { fhir_type: string }) => l.fhir_type === "Encounter");
      expect((await wc.query(`select satusehat_begin($1, $2, $3, 'create', $4, $5) a`, [c.id, c.gen, enc.id, at(0), FP])).rows[0].a).toBeTruthy();
    } finally {
      await wc.query(`select set_config('app.deploy_env', '', false)`);
      wc.release();
    }
    const remote = await port.create("tok-x", "sandbox", { resourceType: "Encounter", identifier: [{ system: `http://sys-ids.kemkes.go.id/encounter/${A.org1}`, value: v }], subject: { reference: "Patient/P10000021" } });
    expect(remote.kind).toBe("ok");
    expect((await links(v))[0].status).toBe("sending");
    await sync(port, 6); // lease expired → outcome_unknown → search by the stable identifier → confirmed with that id
    expect(port.count("create", "Encounter")).toBe(1);
    expect((await links(v))[0]).toMatchObject({ status: "confirmed", remote_id: (remote as { value: { id: string } }).value.id });
    expect((await attempts(v)).map((a) => [a.verb, a.outcome])).toEqual(expect.arrayContaining([["create", "lost"], ["search", "ok"]]));
  });

  it("lost create, delayed commit: not found at once → searched again after 30 min → found; never re-created automatically", async () => {
    const port = mockSatusehatPort();
    const { pt } = await knownPatient(port, "P10000022");
    const { v } = await signed(A, DOC, A.b1, pt, room1); await close(v);
    port.next("create", { kind: "timeout", commit: "later" });
    await sync(port);
    expect((await links(v))[0].status).toBe("outcome_unknown");
    await sync(port, 1); // search: not found yet (the commit is late) → check again after 30 min
    expect((await links(v))[0].status).toBe("outcome_unknown");
    expect(port.commitLate()).toBe(1);
    await sync(port, 32);
    expect((await links(v))[0].status).toBe("confirmed");
    expect(port.count("create", "Encounter")).toBe(1);
  });

  it("lost create never committed: not found twice → exception reconcile_unresolved; Kirim Ulang by a records officer creates anew", async () => {
    const port = mockSatusehatPort();
    const { pt } = await knownPatient(port, "P10000023");
    const { v } = await signed(A, DOC, A.b1, pt, room1); await close(v);
    port.next("create", { kind: "lost", commit: "never" });
    await sync(port);
    await sync(port, 1);
    await sync(port, 32);
    expect((await links(v))[0]).toMatchObject({ status: "exception", status_reason: "reconcile_unresolved" });
    expect(await code(as(FO, (db) => resend(db, v, "remote_checked")))).toBe("ERR_FORBIDDEN");
    expect(await code(as(BRO, (db) => resend(db, v, "remote_checked")))).toBe("ERR_NOT_FOUND");
    expect(await code(as(RO, (db) => resend(db, v, "alasan bebas" as never)))).toBe("ERR_INVALID_INPUT");
    await as(RO, (db) => resend(db, v, "remote_checked"));
    expect((await h.admin.query(`select reason_code, reason from audit_events where object_id = $1 and reason_code like 'satusehat_resend%'`, [v])).rows)
      .toEqual([{ reason_code: "satusehat_resend_remote_checked", reason: null }]);
    await sync(port, 33);
    expect((await links(v))[0].status).toBe("confirmed");
    // the lost create never committed: exactly one Encounter for the visit exists remotely
    expect([...port.store.values()].filter((x) => x.resourceType === "Encounter" && JSON.stringify(x.identifier).includes(v)).length).toBe(1);
  });

  it("uncertain update: timeout before apply → read shows the old content twice → update_unresolved; timeout after apply → read shows the new → confirmed", async () => {
    for (const commit of ["never", "now"] as const) {
      const port = mockSatusehatPort();
      const { pt } = await knownPatient(port, `P1000003${commit === "now" ? 1 : 0}`);
      const s = await signed(A, DOC, A.b1, pt, room1); await close(s.v);
      await sync(port);
      expect((await links(s.v)).every((l) => l.status === "confirmed")).toBe(true);
      await as(DOC, (db) => correctRecord(db, key(), s.examId, { icd10_codes: ["L70.0", "L71.0"] }, "Tambah diagnosis"));
      // revision 2: the new Condition is created, then the Encounter update (its diagnoses) times out
      port.next("update", { kind: "timeout", commit });
      await sync(port, 1);
      const enc = () => links(s.v).then((ls) => ls.find((l) => l.fhir_type === "Encounter")!);
      expect((await enc()).status).toBe("outcome_unknown");
      await sync(port, 2);
      if (commit === "now") {
        expect(await enc()).toMatchObject({ status: "confirmed", confirmed_revision: 2 });
      } else {
        expect((await enc()).status).toBe("outcome_unknown"); // previous content: check again after 30 min
        await sync(port, 33);
        expect(await enc()).toMatchObject({ status: "exception", status_reason: "update_unresolved" });
      }
    }
  });

  it("the barrier: while an old update is unresolved no newer write is sent; after its late commit is read back the remote ends at the newest revision", async () => {
    const port = mockSatusehatPort();
    const { pt } = await knownPatient(port, "P10000040");
    const s = await signed(A, DOC, A.b1, pt, room1); await close(s.v);
    await sync(port);
    await as(DOC, (db) => correctRecord(db, key(), s.examId, { icd10_codes: ["L70.0", "L71.0"] }, "Tambah diagnosis"));
    port.next("update", { kind: "timeout", commit: "later" }); // revision 2's Encounter update: no answer, commits later
    await sync(port, 1);
    await as(DOC, (db) => correctRecord(db, key(), s.examId, { icd10_codes: ["L70.0", "L71.0", "L72.0"] }, "Tambah diagnosis lagi"));
    const writes = () => port.count("update", "Encounter") + port.count("create", "Condition");
    const before = writes();
    await sync(port, 7); // revision 3 materialized; the Encounter is outcome_unknown → read shows the old content → no write of any kind
    expect(writes()).toBe(before);
    expect((await links(s.v)).find((l) => l.local_key === "exam:L72.0")).toMatchObject({ status: "queued", remote_id: null });
    expect(port.commitLate()).toBe(1); // the old update lands now
    await sync(port, 40); // read back = revision 2's body → revision 2 confirmed, revision 3 queued behind it
    expect((await links(s.v)).find((l) => l.fhir_type === "Encounter")).toMatchObject({ status: "queued", confirmed_revision: 2, current_revision: 3 });
    await sync(port, 41); // revision 3: L72.0 created, the Encounter updated to name it
    const ls = await links(s.v);
    expect(ls.every((l) => l.status === "confirmed" && l.confirmed_revision === 3)).toBe(true);
    const enc = port.store.get(ls.find((l) => l.fhir_type === "Encounter")!.remote_id)!;
    const ids = ls.filter((l) => l.fhir_type === "Condition").map((l) => `Condition/${l.remote_id}`).sort();
    expect((enc.diagnosis as { condition: { reference: string } }[]).map((d) => d.condition.reference).sort()).toEqual(ids);
    expect((await attempts(s.v)).filter((a) => a.verb === "read").map((a) => a.outcome)).toEqual(["ok", "ok"]);
  });
});

describe("T-102 identity states (TD-31, CD-28)", () => {
  it("one NIK result with a different birth date, gender or name → review; none → review; several → review; without NIK → review at once; care never waits", async () => {
    const port = mockSatusehatPort();
    const cases: [string, Parameters<MockSatusehat["patients"]["set"]>[1], string][] = [
      ["birth", [{ ihs: "P2000002", name: "Siti Rahma", birthDate: "1991-06-15", gender: "female" }], "demographics_conflict"],
      ["gender", [{ ihs: "P3000003", name: "Siti Rahma", birthDate: "1990-06-15", gender: "male" }], "demographics_conflict"],
      ["name", [{ ihs: "P4000004", name: "Sita Rahma", birthDate: "1990-06-15", gender: "female" }], "demographics_conflict"],
      ["none", [], "not_found"],
      ["many", [{ ihs: "P5000005", name: "Siti Rahma", birthDate: "1990-06-15", gender: "female" }, { ihs: "P6000006", name: "Siti Rahma", birthDate: "1990-06-15", gender: "female" }], "ambiguous"],
    ];
    for (const [, hits, reason] of cases) {
      const nik = `3174${String(++n).padStart(12, "0")}`;
      const pt = await patient(A, { nik });
      port.patients.set(nik, hits);
      const s = await signed(A, DOC, A.b1, pt, room1); await close(s.v);
      await sync(port);
      expect(await outbox(s.v)).toEqual([expect.objectContaining({ state: "held", hold_reason: "identity_review" })]);
      expect((await h.admin.query(`select state, reason, ihs_patient_id from satusehat_patient_identity where patient_id = $1 and is_current`, [pt])).rows[0])
        .toEqual({ state: "review", reason, ihs_patient_id: null });
    }
    const nb = await patient(A, {});
    const s = await signed(A, DOC, A.b1, nb, room1); await close(s.v);
    const searches = port.count("patient");
    await sync(port);
    expect(port.count("patient")).toBe(searches); // never searched by anyone else's NIK
    expect((await h.admin.query(`select state, reason from satusehat_patient_identity where patient_id = $1 and is_current`, [nb])).rows[0]).toEqual({ state: "review", reason: "no_nik" });
    // a records officer resolves with evidence → the held item is requeued and sends; another branch's officer and other roles cannot
    expect(await code(as(FO, (db) => resolveIdentity(db, nb, "P90000001", "Dicek di portal SATUSEHAT")))).toBe("ERR_FORBIDDEN");
    expect(await code(as(RO2, (db) => resolveIdentity(db, nb, "P90000001", "Dicek di portal SATUSEHAT")))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BRO, (db) => resolveIdentity(db, nb, "P90000001", "Dicek di portal SATUSEHAT")))).toBe("ERR_NOT_FOUND");
    expect(await as(RO, (db) => resolveIdentity(db, nb, "P90000001", "Dicek di portal SATUSEHAT"))).toBe("resolved_manual");
    await sync(port, 1);
    expect((await outbox(s.v)).at(-1)!.state).toBe("done");
    expect((await h.admin.query(`select count(*)::int c from satusehat_patient_identity where patient_id = $1`, [nb])).rows[0].c).toBe(2); // history kept
  });
});

describe("T-102 pinning, transitions, guards, isolation and the vendor", () => {
  it("materialization pins the code and fingerprint per revision; production holds unvalidated terminology", async () => {
    const port = mockSatusehatPort();
    const { pt } = await knownPatient(port, "P10000050");
    const s = await signed(A, DOC, A.b1, pt, room1, ["L70.0", "L71.0"]); await close(s.v);
    await sync(port);
    const pins = (await h.admin.query(`select l.local_key, r.revision, r.materialized ->> 'code' code, r.organization_id from satusehat_link_revisions r join satusehat_links l on l.id = r.link_id
      where l.visit_id = $1 and l.fhir_type = 'Condition' order by l.local_key`, [s.v])).rows;
    expect(pins).toEqual([{ local_key: "exam:L70.0", revision: 1, code: "L70.0", organization_id: A.org1 }, { local_key: "exam:L71.0", revision: 1, code: "L71.0", organization_id: A.org1 }]);
    expect(await raw(`update satusehat_link_revisions set fingerprint = repeat('0', 64)`)).toBe("raw:42501");
    // production (unbound deploy env): the ICD-10 register row is unvalidated → Conditions held mapping_unvalidated
    {
      const PR = await tenant("PT Klinik Produksi Sintetis");
      const pOwn = await person(PR, "owner"); const pDoc = await person(PR, "doctor"); const pFh = await person(PR, "facility_head");
      await credential(PR, pDoc, PR.b1, pOwn, pFh);
      const r = await room(PR, PR.b1, "loc-p1-0001");
      await h.admin.query(`insert into satusehat_credentials (tenant_id, branch_id, environment, organization_id, client_id, secret_enc, dek_ref, generation, command_key, created_by, created_as)
        values ($1, $2, 'production', $3, 'client-p1', $4, 'dek:v1', 1, $5, $6, 'owner')`,
        [PR.tenantId, PR.b1, PR.org1, encryptField(RING, await keysFor(PR), SECRET_PURPOSE, "rahasia-sintetis-p1"), `k-${key()}`, pOwn.staffId]);
      await h.admin.query(`insert into satusehat_practitioner_links (tenant_id, staff_id, ihs_practitioner_id, source, command_key, recorded_by, recorded_as) values ($1, $2, 'N70000001', 'manual', $3, $4, 'owner')`,
        [PR.tenantId, pDoc.staffId, `k-${key()}`, pOwn.staffId]);
      const nik = `3174${String(++n).padStart(12, "0")}`;
      const pt2 = await patient(PR, { nik });
      port.patients.set(nik, [{ ihs: "P70000001", name: "Siti Rahma", birthDate: "1990-06-15", gender: "female" }]);
      await h.admin.query(`update tenants_registry set lifecycle_state = 'live' where id = $1`, [PR.tenantId]);
      const ctx = async (p: P) => resolveContext(app, p.acc, { tenantId: PR.tenantId, actingRole: p.role, activeBranchId: p.branch });
      const { v } = await visit(PR, PR.b1, pt2, r);
      const { examId } = await withTenantContext(app, await ctx(pDoc), (db) => openExam(db, key(), v));
      await withTenantContext(app, await ctx(pDoc), (db) => saveExam(db, key(), examId, { assessment: "Akne", icd10_codes: ["L70.0"] }));
      await withTenantContext(app, await ctx(pDoc), (db) => signRecord(db, key(), examId, STEP));
      await close(v);
      process.env.DEPLOY_ENV = "production"; // the worker binds production: the environment is never caller-chosen
      try {
        await runSatusehatSync(worker, { port, now: at(0) });
      } finally {
        process.env.DEPLOY_ENV = "local";
      }
      expect((await links(v)).find((l) => l.fhir_type === "Condition")).toMatchObject({ status: "held", status_reason: "mapping_unvalidated" });
      // the owner-gated sandbox step promotes the register row (the vendor-maintained platform row; the admin stands in); a records officer's
      // Kirim Ulang then sends the held Condition without a clinical correction (review r1 P2-7)
      await h.admin.query(`update satusehat_code_systems set validated = true where kind = 'icd10' and code = '*' and effective_to is null`);
      const pRo = await person(PR, "records_officer");
      await withTenantContext(app, await ctx(pRo), (db) => resend(db, v, "data_corrected"));
      process.env.DEPLOY_ENV = "production";
      try {
        await runSatusehatSync(worker, { port, now: at(1) });
      } finally {
        process.env.DEPLOY_ENV = "local";
      }
      expect((await links(v)).map((l) => [l.fhir_type, l.status])).toEqual([["Encounter", "confirmed"], ["Condition", "confirmed"]]);
    }
  });

  it("transitions: unlisted link and outbox edges are refused; nothing is ever deleted; finished attempts and revoked credentials are final", async () => {
    const l = (await h.admin.query(`select id from satusehat_links where tenant_id = $1 and status = 'confirmed' limit 1`, [A.tenantId])).rows[0].id;
    expect(await raw(`update satusehat_links set status = 'sending' where id = $1`, [l])).toBe("raw:40001");
    expect(await raw(`update satusehat_links set status = 'failed', status_reason = 'x' where id = $1`, [l])).toBe("raw:40001");
    expect(await raw(`update satusehat_links set remote_id = 'other-0001' where id = $1`, [l])).toBe("raw:42501");
    expect(await raw(`delete from satusehat_links where id = $1`, [l])).toBe("raw:42501");
    const o = (await h.admin.query(`select id from satusehat_outbox where tenant_id = $1 and state = 'done' limit 1`, [A.tenantId])).rows[0].id;
    expect(await raw(`update satusehat_outbox set state = 'queued' where id = $1`, [o])).toBe("raw:40001");
    expect(await raw(`insert into satusehat_outbox (tenant_id, branch_id, visit_id, revision, exam_version_id, state, lease_until)
      select tenant_id, branch_id, visit_id, 99, exam_version_id, 'leased', now() from satusehat_outbox where id = $1`, [o])).toBe("raw:22023");
    const a = (await h.admin.query(`select id from satusehat_attempts where tenant_id = $1 and outcome is not null limit 1`, [A.tenantId])).rows[0].id;
    expect(await raw(`update satusehat_attempts set outcome = 'ok' where id = $1`, [a])).toBe("raw:42501");
    const c = (await h.admin.query(`select id from satusehat_credentials where tenant_id = $1 and revoked_at is not null limit 1`, [A.tenantId])).rows[0].id;
    expect(await raw(`update satusehat_credentials set revoked_at = null where id = $1`, [c])).toBe("raw:42501");
    expect(await raw(`truncate satusehat_attempts`)).toMatch(/^raw:/);
  });

  it("isolation: another tenant's readers and commands see nothing; the worker refuses a bound connection; the app reads no table; the vendor's support never reaches SATUSEHAT rows", async () => {
    const v = (await h.admin.query(`select visit_id from satusehat_outbox where tenant_id = $1 limit 1`, [A.tenantId])).rows[0].visit_id;
    expect(await code(as(BOWN, (db) => monitor(db, A.b1)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BRO, (db) => resend(db, v, "remote_checked")))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BOWN, (db) => linkPractitioner(db, key(), { staffId: DOC.staffId, ihs: "N99999999" })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(RO2, (db) => monitor(db, A.b1)))).toBe("ERR_NOT_FOUND");
    for (const p of [DOC, FO, AP]) expect(await code(as(p, (db) => monitor(db, A.b1))), p.role).toBe("ERR_FORBIDDEN");
    expect(await code(as(OWN, (db) => db.query(`select satusehat_claim()`)))).toMatch(/^raw:/);
    for (const t of ["satusehat_outbox", "satusehat_links", "satusehat_errors", "satusehat_patient_identity", "satusehat_credentials", "satusehat_visit_context"]) {
      expect(await code(as(OWN, (db) => db.query(`select 1 from ${t} limit 1`))), t).toBe("raw:42501");
    }
    expect((await h.admin.query(`select count(*)::int c from support_object_kinds where table_name like 'public.satusehat_%' and support_class = 'never'`)).rows[0].c).toBe(11);
    const vendor = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [VENDOR_GROUP_ROLE])), max: 1 }, VENDOR_GROUP_ROLE);
    try {
      const acc = async () => (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('V', $1, true) returning id`, [`ssv${++n}@vendor-sintetis.test`])).rows[0].id as string;
      const PO = await acc(); const SUP = await acc();
      const c = await owner.connect();
      try {
        await bootstrapVendor(c, PO, "Pemilik Platform", "203.0.113.0/24", "Kantor vendor");
        await createVendorStaff(c, { accountId: PO, ip: "203.0.113.10", mfaAt: new Date() }, SUP, "Dukungan SS", ["support"]);
      } finally {
        c.release();
      }
      const tok = `tok${++n}${crypto.randomUUID().replace(/-/g, "")}`;
      await h.admin.query(`insert into auth_session (user_id, token, expires_at, surface, second_factor_at) values ($1, $2, now() + interval '8 hours', 'vendor', now())`, [SUP, tok]);
      const r = await openSession(vendor, { token: tok, ip: "203.0.113.10" }, { tenantId: A.tenantId, purpose: "Memeriksa antrean SATUSEHAT atas permintaan klinik", scope: ["public.satusehat_outbox"], minutes: 60 });
      expect(r.ok).toBe(false);
    } finally {
      await vendor.end();
    }
  });
});

describe("T-102 mutation probe 1 repairs (test gaps)", () => {
  it("the fence: a late finish is recorded stale and never confirms; a re-leased item refuses the old generation; the definer's barrier refuses a newer write behind an unresolved one; one lease per visit with two queued revisions", async () => {
    const port = mockSatusehatPort();
    const { pt } = await knownPatient(port, "P10000060");
    const s = await signed(A, DOC, A.b1, pt, room1); await close(s.v);
    const mine = (await h.admin.query(`select id from satusehat_outbox where visit_id = $1`, [s.v])).rows[0].id as string;
    const c = (await wq<{ id: string; gen: number }[]>(`select satusehat_claim($1)`, [at(0)])).find((x) => x.id === mine)!;
    await wq(`select satusehat_identity_record($1, $2, $3::jsonb, $4)`, [c.id, c.gen,
      JSON.stringify({ kind: "one", ihs: "P10000060", name: "Siti Rahma", birth_date: "1990-06-15", gender: "female" }), at(0)]);
    const pk = await wq<{ links: { id: string; fhir_type: string }[] }>(`select satusehat_prepare($1, $2, $3)`, [c.id, c.gen, at(0)]);
    const enc = pk.links.find((l) => l.fhir_type === "Encounter")!.id;
    const cond = pk.links.find((l) => l.fhir_type === "Condition")!.id;
    // 1. a create begun under generation g whose answer arrives after the lease ran out: stale, the remote id kept, the link outcome_unknown
    const a1 = await wq<string>(`select satusehat_begin($1, $2, $3, 'create', $4, $5)`, [c.id, c.gen, enc, at(0), FP]);
    expect(a1).toBeTruthy();
    expect(await wq(`select satusehat_finish($1, $2::jsonb, $3)`, [a1, JSON.stringify({ outcome: "ok", http_status: 201, remote_id: "enc-late-0001" }), at(6)])).toBe("stale");
    expect((await links(s.v))[0]).toMatchObject({ fhir_type: "Encounter", status: "outcome_unknown", remote_id: null });
    expect((await h.admin.query(`select outcome, remote_id from satusehat_attempts where id = $1`, [a1])).rows[0]).toEqual({ outcome: "stale", remote_id: "enc-late-0001" });
    // 2. the expired lease is taken again (generation g + 1): generation g is refused for any step
    const c2 = (await wq<{ id: string; gen: number }[]>(`select satusehat_claim($1)`, [at(6)])).find((x) => x.id === mine)!;
    expect(c2.gen).toBe(c.gen + 1);
    expect(await wq(`select satusehat_begin($1, $2, $3, 'search', $4)`, [c.id, c.gen, enc, at(6)])).toBeNull();
    expect(await wq(`select satusehat_release($1, $2, $3)`, [c.id, c.gen, at(6)])).toBe("stale");
    // 3. the barrier in the definer (behind the worker): reconcile the Encounter (found), confirm a Condition, the Encounter is queued to name
    // it; that update times out → outcome_unknown; no newer update or create can begin on the link
    const a2 = await wq<string>(`select satusehat_begin($1, $2, $3, 'search', $4)`, [c.id, c2.gen, enc, at(6)]);
    expect(await wq(`select satusehat_finish($1, $2::jsonb, $3)`, [a2, JSON.stringify({ outcome: "ok", http_status: 200, remote_id: "enc-late-0001", refs: [] }), at(6)])).toBe("confirmed");
    const a3 = await wq<string>(`select satusehat_begin($1, $2, $3, 'create', $4, $5)`, [c.id, c2.gen, cond, at(6), FP]);
    expect(await wq(`select satusehat_finish($1, $2::jsonb, $3)`, [a3, JSON.stringify({ outcome: "ok", http_status: 201, remote_id: "cnd-late-0001" }), at(6)])).toBe("confirmed");
    expect(await wq(`select satusehat_refs_check($1, $2, $3)`, [c.id, c2.gen, at(6)])).toBe(true);
    const a4 = await wq<string>(`select satusehat_begin($1, $2, $3, 'update', $4, $5)`, [c.id, c2.gen, enc, at(6), FP]);
    expect(await wq(`select satusehat_finish($1, $2::jsonb, $3)`, [a4, JSON.stringify({ outcome: "timeout" }), at(6)])).toBe("outcome_unknown");
    expect(await wq(`select satusehat_begin($1, $2, $3, 'update', $4, $5)`, [c.id, c2.gen, enc, at(6), FP])).toBeNull();
    expect(await wq(`select satusehat_begin($1, $2, $3, 'create', $4, $5)`, [c.id, c2.gen, enc, at(6), FP])).toBeNull();
    // 4. a correction while revision 1 is leased: revision 2 queued beside it; after the release both are queued — one lease per visit
    await as(DOC, (db) => correctRecord(db, key(), s.examId, { icd10_codes: ["L70.0", "L71.0"] }, "Tambah diagnosis"));
    expect((await outbox(s.v)).map((o) => [o.revision, o.state])).toEqual([[1, "leased"], [2, "queued"]]);
    expect(await wq(`select satusehat_release($1, $2, $3)`, [c.id, c2.gen, at(6)])).toBe("queued");
    await wq(`select satusehat_claim($1)`, [at(7)]);
    expect((await outbox(s.v)).filter((o) => o.state === "leased").length).toBe(1);
  });

  it("reconciliation adopts only the exact identifier: an earlier visit's Encounter of the same patient is never taken; two remote matches → duplicate_remote", async () => {
    const port = mockSatusehatPort();
    const { pt } = await knownPatient(port, "P10000061");
    const s1 = await signed(A, DOC, A.b1, pt, room1); await close(s1.v);
    await sync(port, 10);
    expect((await links(s1.v))[0].status).toBe("confirmed");
    const s2 = await signed(A, DOC, A.b1, pt, room1); await close(s2.v);
    port.next("create", { kind: "lost", commit: "never" });
    await sync(port, 11);
    await sync(port, 12); // Encounter?subject returns only visit 1's Encounter → not found (round 1)
    expect((await links(s2.v))[0]).toMatchObject({ status: "outcome_unknown", remote_id: null });
    const s3 = await signed(A, DOC, A.b1, pt, room1); await close(s3.v);
    port.next("create", { kind: "timeout", commit: "now" });
    await sync(port, 13);
    const first = [...port.store.values()].find((x) => x.resourceType === "Encounter" && JSON.stringify(x.identifier).includes(s3.v))!;
    port.store.set("enc-dup-0001", { ...structuredClone(first), id: "enc-dup-0001" });
    await sync(port, 14);
    expect((await links(s3.v))[0]).toMatchObject({ status: "exception", status_reason: "duplicate_remote", remote_id: null });
  });

  it("a correction before the first lease supersedes the queued revision; a doctor without an IHS link is held practitioner_unresolved until a facility head links one", async () => {
    const port = mockSatusehatPort();
    const DOC3 = await person(A, "doctor");
    await credential(A, DOC3, A.b1, OWN, FH);
    const { pt } = await knownPatient(port, "P10000062");
    const s = await signed(A, DOC3, A.b1, pt, room1);
    await as(DOC3, (db) => correctRecord(db, key(), s.examId, { icd10_codes: ["L70.0", "L71.0"] }, "Tambah diagnosis"));
    expect((await outbox(s.v)).map((o) => [o.revision, o.state])).toEqual([[1, "queued"], [2, "queued"]]); // the trigger only inserts
    await close(s.v);
    await sync(port, 20); // the claim supersedes revision 1
    expect((await outbox(s.v))[0]).toMatchObject({ revision: 1, state: "superseded", hold_reason: null });
    expect((await outbox(s.v)).at(-1)).toMatchObject({ state: "held", hold_reason: "practitioner_unresolved" });
    expect(await code(as(MGR, (db) => linkPractitioner(db, key(), { staffId: DOC3.staffId, ihs: "N10000003" })))).toBe("ERR_FORBIDDEN");
    await as(FH, (db) => linkPractitioner(db, key(), { staffId: DOC3.staffId, ihs: "N10000003" }));
    await sync(port, 21);
    expect((await outbox(s.v)).at(-1)!.state).toBe("done");
    expect((await links(s.v)).map((l) => [l.local_key, l.status, l.confirmed_revision])).toEqual([["visit", "confirmed", 2], ["exam:L70.0", "confirmed", 2], ["exam:L71.0", "confirmed", 2]]);
  });
});

describe("T-102 implementation review r1 repairs (Sol 2ab95b5c)", () => {
  it("P1-1: correcting a record whose item is held never fails; the claim supersedes the held revision and clears its reason", async () => {
    const port = mockSatusehatPort();
    const { pt } = await knownPatient(port, "P10000070");
    const s = await signed(A, DOC, A.b1, pt, null); await close(s.v);
    await sync(port, 50);
    expect(await outbox(s.v)).toEqual([expect.objectContaining({ state: "held", hold_reason: "no_room" })]);
    await as(DOC, (db) => correctRecord(db, key(), s.examId, { icd10_codes: ["L70.0", "L71.0"] }, "Tambah diagnosis")); // no CHECK violation
    await sync(port, 51);
    expect((await outbox(s.v)).map((o) => [o.revision, o.state, o.hold_reason])).toEqual([[1, "superseded", null], [2, "held", "no_room"]]);
  });

  it("P1-2: a lease that runs out during the worker's own remote call fences the answer (stale), then reconciliation confirms it once", async () => {
    const base = mockSatusehatPort();
    const { pt } = await knownPatient(base, "P10000071");
    const s = await signed(A, DOC, A.b1, pt, room1); await close(s.v);
    let late = false;
    const port = { ...base, create: async (...a: Parameters<MockSatusehat["create"]>) => { const r = await base.create(...a); late = true; return r; } };
    await runSatusehatSync(worker, { port: port as never, clock: () => (late ? at(56) : at(50)) });
    expect((await links(s.v))[0]).toMatchObject({ fhir_type: "Encounter", status: "outcome_unknown", remote_id: null });
    expect((await attempts(s.v)).map((a) => [a.verb, a.outcome])).toEqual([["create", "stale"]]);
    await sync(base, 57);
    expect((await links(s.v))[0]).toMatchObject({ status: "confirmed" });
    expect(base.count("create", "Encounter")).toBe(1);
  });

  it("P1-3: an update read back with the same diagnoses but another reference is not confirmed", async () => {
    const port = mockSatusehatPort();
    const { pt } = await knownPatient(port, "P10000072");
    const s = await signed(A, DOC, A.b1, pt, room1); await close(s.v);
    await sync(port, 60);
    await as(DOC, (db) => correctRecord(db, key(), s.examId, { icd10_codes: ["L70.0", "L71.0"] }, "Tambah diagnosis"));
    // the Encounter update commits remotely, but the resource that lands carries another location (the diagnoses are the intended ones);
    // its answer is lost — the read-back must not confirm it
    const upd = port.update;
    port.update = async (tok, env, id, body) => {
      const r = await upd(tok, env, id, body);
      if (body.resourceType === "Encounter") {
        port.store.set(id, { ...port.store.get(id)!, location: [{ location: { reference: "Location/loc-other-9999" } }] });
        return { kind: "timeout" };
      }
      return r;
    };
    await sync(port, 61);
    port.update = upd;
    // (the Encounter's pinned content is unchanged by the new diagnosis, so revision 2 is already its confirmed revision; the uncertain write
    // is the diagnosis update at that revision — the barrier holds on the write, not on the revision number)
    const enc = (await links(s.v)).find((l) => l.fhir_type === "Encounter")!;
    expect(enc.status).toBe("outcome_unknown");
    expect((port.store.get(enc.remote_id)!.diagnosis as unknown[]).length).toBe(2); // the diagnoses that landed are the intended ones
    await sync(port, 62); // read back: another location → not this write's body → checked again after 30 min
    expect((await links(s.v)).find((l) => l.fhir_type === "Encounter")!.status).toBe("outcome_unknown");
    await sync(port, 93);
    expect((await links(s.v)).find((l) => l.fhir_type === "Encounter")).toMatchObject({ status: "exception", status_reason: "update_unresolved" });
    expect((await attempts(s.v)).filter((a) => a.verb === "read").map((a) => a.outcome)).toEqual(["ok", "ok"]);
  });

  it("P2-5 / P2-6: a late answer after crash recovery is kept as stale evidence; recovery skips an item a finisher holds (one lock order)", async () => {
    const port = mockSatusehatPort();
    const { pt } = await knownPatient(port, "P10000073");
    const s = await signed(A, DOC, A.b1, pt, room1); await close(s.v);
    const mine = (await h.admin.query(`select id from satusehat_outbox where visit_id = $1`, [s.v])).rows[0].id as string;
    const c = (await wq<{ id: string; gen: number }[]>(`select satusehat_claim($1)`, [at(70)])).find((x) => x.id === mine)!;
    await wq(`select satusehat_identity_record($1, $2, $3::jsonb, $4)`, [c.id, c.gen,
      JSON.stringify({ kind: "one", ihs: "P10000073", name: "Siti Rahma", birth_date: "1990-06-15", gender: "female" }), at(70)]);
    const pk = await wq<{ links: { id: string; fhir_type: string }[] }>(`select satusehat_prepare($1, $2, $3)`, [c.id, c.gen, at(70)]);
    const enc = pk.links.find((l) => l.fhir_type === "Encounter")!.id;
    const a1 = await wq<string>(`select satusehat_begin($1, $2, $3, 'create', $4, $5)`, [c.id, c.gen, enc, at(70), FP]);
    // a finisher holds the item's locks while recovery runs: recovery skips it, nothing deadlocks
    const fin = await owner.connect(); // stands in for a finisher's transaction holding the item (the app role reads no SATUSEHAT table)
    try {
      await fin.query("begin");
      await fin.query(`select id from satusehat_outbox where id = $1 for update`, [c.id]);
      await wq(`select satusehat_claim($1)`, [at(76)]);
      expect((await h.admin.query(`select state from satusehat_outbox where id = $1`, [c.id])).rows[0].state).toBe("leased");
      await fin.query("commit");
    } finally {
      fin.release();
    }
    // recovery now closes the open attempt as lost; the original worker's late success is appended as stale evidence, nothing else moves
    await wq(`select satusehat_claim($1)`, [at(76)]);
    expect((await h.admin.query(`select outcome from satusehat_attempts where id = $1`, [a1])).rows[0].outcome).toBe("lost");
    expect(await wq(`select satusehat_finish($1, $2::jsonb, $3)`, [a1, JSON.stringify({ outcome: "ok", http_status: 201, remote_id: "enc-late-0073" }), at(77)])).toBe("stale");
    expect((await attempts(s.v)).map((a) => [a.verb, a.outcome])).toEqual([["create", "lost"], ["create", "stale"]]);
    expect((await h.admin.query(`select a.remote_id from satusehat_attempts a join satusehat_links l on l.id = a.link_id where l.visit_id = $1 and a.outcome = 'stale'`, [s.v])).rows[0].remote_id).toBe("enc-late-0073");
    expect((await links(s.v))[0]).toMatchObject({ status: "outcome_unknown", remote_id: null });
  });

  it("P2-8: a practitioner-link replay from another branch's facility head is refused before the replay answers", async () => {
    const FH2 = await person(A, "facility_head", A.b2);
    const D1 = await person(A, "doctor", A.b1); // a doctor of branch 1 only
    const k = key();
    await as(FH, (db) => linkPractitioner(db, k, { staffId: D1.staffId, ihs: "N10000099" }));
    expect(await code(as(FH2, (db) => linkPractitioner(db, k, { staffId: D1.staffId, ihs: "N10000099" })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BOWN, (db) => linkPractitioner(db, k, { staffId: D1.staffId, ihs: "N10000099" })))).toBe("ERR_NOT_FOUND");
    expect(await as(FH, (db) => linkPractitioner(db, k, { staffId: D1.staffId, ihs: "N10000099" }))).toBeTruthy(); // the authorized replay
  });

  it("4xx keeps the provider body in the clinical-class row (code and path on the attempt); 5xx backs off 1, 5, 15, 60, 240 min, then failed", async () => {
    const port = mockSatusehatPort();
    const p1 = (await knownPatient(port, "P10000074")).pt;
    const s1 = await signed(A, DOC, A.b1, p1, room1); await close(s1.v);
    port.next("create", { kind: "http_4xx", code: "invalid", path: "Encounter.period" });
    await sync(port, 80);
    expect((await links(s1.v))[0]).toMatchObject({ status: "failed", status_reason: "http_4xx" });
    const att = (await h.admin.query(`select a.error_code, a.error_path, e.body from satusehat_attempts a join satusehat_links l on l.id = a.link_id
      left join satusehat_errors e on e.attempt_id = a.id where l.visit_id = $1`, [s1.v])).rows[0];
    expect(att).toMatchObject({ error_code: "invalid", error_path: "Encounter.period", body: { resourceType: "OperationOutcome" } });
    const p2 = (await knownPatient(port, "P10000075")).pt;
    const s2 = await signed(A, DOC, A.b1, p2, room1); await close(s2.v);
    for (let i = 0; i < 6; i++) port.next("create", { kind: "http_5xx" });
    const times = [100, 102, 108, 124, 185, 426];
    const nexts: number[] = [];
    for (const t of times) {
      await sync(port, t);
      const l = (await h.admin.query(`select status, status_reason, retries, extract(epoch from next_at - $2::timestamptz) / 60 m from satusehat_links where visit_id = $1 and fhir_type = 'Encounter'`, [s2.v, at(t)])).rows[0];
      nexts.push(l.status === "queued" ? Math.round(Number(l.m)) : -1);
    }
    expect(nexts).toEqual([1, 5, 15, 60, 240, -1]);
    expect((await links(s2.v))[0]).toMatchObject({ status: "failed", status_reason: "retry_exhausted" });
  });

  it("an incomplete search bundle never confirms: searched twice → reconcile_unresolved even though the resource exists", async () => {
    const base = mockSatusehatPort();
    const { pt } = await knownPatient(base, "P10000076");
    const s = await signed(A, DOC, A.b1, pt, room1); await close(s.v);
    base.next("create", { kind: "timeout", commit: "now" });
    await sync(base, 500);
    const inc = { ...base, search: async (...a: Parameters<MockSatusehat["search"]>) => {
      const r = await base.search(...a);
      return r.kind === "ok" ? { ...r, value: { ...r.value, hasNext: true } } : r;
    } };
    await runSatusehatSync(worker, { port: inc as never, now: at(501) });
    await runSatusehatSync(worker, { port: inc as never, now: at(532) });
    expect((await links(s.v))[0]).toMatchObject({ status: "exception", status_reason: "reconcile_unresolved" });
    expect((await attempts(s.v)).filter((a) => a.verb === "search").map((a) => a.outcome)).toEqual(["incomplete", "incomplete"]);
  });

  // last: it leaves other items leased in its own transaction window
  it("P2-4: two claimants and two queued items of one visit: one leases, the other skips the visit without an error", async () => {
    const port = mockSatusehatPort();
    const { pt } = await knownPatient(port, "P10000077");
    const s = await signed(A, DOC, A.b1, pt, room1); await close(s.v);
    // the second item is due only for the second claimant (claim fetches rows in batches: with both due, the first claimant would lock both
    // rows and the race would never happen): A leases item 1 and keeps its transaction open; B sees item 1 locked and item 2 due, with no
    // committed lease for the visit — only the per-visit lock keeps B off it (without it B waits on the unique index, then fails)
    await h.admin.query(`insert into satusehat_outbox (tenant_id, branch_id, visit_id, revision, exam_version_id, kind, next_at)
      select tenant_id, branch_id, visit_id, revision, exam_version_id, 'resend', $2 from satusehat_outbox where visit_id = $1`, [s.v, at(600.5)]);
    const a = await worker.connect(); const b = await worker.connect();
    try {
      await a.query("begin");
      const ra = (await a.query(`select satusehat_claim($1) r`, [at(600)])).rows[0].r as { id: string }[];
      const rb = await Promise.race([
        b.query(`select satusehat_claim($1) r`, [at(601)]).then((r) => r.rows[0].r as { id: string }[]),
        new Promise<"blocked">((res) => setTimeout(() => res("blocked"), 3000)),
      ]);
      await a.query("commit");
      expect(rb).not.toBe("blocked");
      const ids = (await h.admin.query(`select id from satusehat_outbox where visit_id = $1`, [s.v])).rows.map((r) => r.id);
      expect([...ra, ...(rb as { id: string }[])].filter((x) => ids.includes(x.id)).length).toBe(1);
      expect((await outbox(s.v)).filter((o) => o.state === "leased").length).toBe(1);
    } finally {
      a.release(); b.release();
    }
  });

  it("P2-5 through the real worker: while worker A awaits its create, the lease expires and worker B recovers the item; A's late answer is kept as stale evidence, never confirms, and B's reconciliation confirms once", async () => {
    const base = mockSatusehatPort();
    const { pt } = await knownPatient(base, "P10000078");
    const s = await signed(A, DOC, A.b1, pt, room1); await close(s.v);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const inCall = new Promise<void>((r) => (entered = r));
    let phase = 700;
    const slow = { ...base, create: async (...a: Parameters<MockSatusehat["create"]>) => {
      const r = await base.create(...a); // the remote commits
      entered();
      await gate; // A is still waiting for the answer
      return r;
    } };
    const runA = runSatusehatSync(worker, { port: slow as never, clock: () => at(phase) });
    await inCall;
    phase = 706; // A's lease has run out; B claims: recovery closes A's open attempt as lost and B reconciles by search
    const b = await runSatusehatSync(worker, { port: base, clock: () => at(706) });
    expect(b.leased).toBeGreaterThanOrEqual(1);
    expect((await links(s.v))[0]).toMatchObject({ fhir_type: "Encounter", status: "confirmed" });
    release();
    await runA; // A's late answer: appended stale, the confirmed link untouched
    const enc = (await links(s.v))[0];
    expect(enc).toMatchObject({ status: "confirmed", confirmed_revision: 1 });
    expect((await attempts(s.v)).filter((a) => a.verb !== "read").map((a) => [a.verb, a.outcome]).slice(0, 3))
      .toEqual(expect.arrayContaining([["create", "lost"], ["create", "stale"], ["search", "ok"]]));
    expect(base.count("create", "Encounter")).toBe(1);
    const ev = (await h.admin.query(`select payload::text p from domain_events where aggregate_id in (select id from satusehat_outbox where visit_id = $1)`, [s.v])).rows.map((r) => r.p).join();
    expect(ev).not.toMatch(/OperationOutcome|L70/);
  });

  it("P2-4 through the real worker: two runSatusehatSync passes at once on a visit with two queued items lease it once and neither errors", async () => {
    const port = mockSatusehatPort();
    const { pt } = await knownPatient(port, "P10000079");
    const s = await signed(A, DOC, A.b1, pt, room1); await close(s.v);
    await h.admin.query(`insert into satusehat_outbox (tenant_id, branch_id, visit_id, revision, exam_version_id, kind)
      select tenant_id, branch_id, visit_id, revision, exam_version_id, 'resend' from satusehat_outbox where visit_id = $1`, [s.v]);
    const r = await Promise.allSettled([sync(port, 800), sync(port, 800), sync(port, 800)]);
    expect(r.map((x) => x.status)).toEqual(["fulfilled", "fulfilled", "fulfilled"]);
    expect(port.count("create", "Encounter")).toBe(1);
    await sync(port, 801);
    expect((await outbox(s.v)).every((o) => o.state === "done")).toBe(true);
  });
});

describe("T-102 implementation review r2 repairs (Sol 7ebdeb67)", () => {
  it("P2-1: an uncertain update that landed exactly, read back with server-added unmapped fields (text, display, meta), confirms the attempted revision", async () => {
    const port = mockSatusehatPort();
    const { pt } = await knownPatient(port, "P10000080");
    const s = await signed(A, DOC, A.b1, pt, room1); await close(s.v);
    await sync(port, 900);
    await as(DOC, (db) => correctRecord(db, key(), s.examId, { icd10_codes: ["L70.0", "L71.0"] }, "Tambah diagnosis"));
    const upd = port.update;
    port.update = async (tok, env, id, body) => {
      const r = await upd(tok, env, id, body);
      if (body.resourceType === "Encounter") {
        const cur = port.store.get(id)!;
        port.store.set(id, { ...cur, text: { status: "generated", div: "<div>x</div>" }, subject: { ...(cur.subject as object), display: "Nama" },
          meta: { versionId: "9", lastUpdated: "2026-11-17T00:00:00+00:00" } });
        return { kind: "lost" };
      }
      return r;
    };
    await sync(port, 901);
    port.update = upd;
    expect((await links(s.v)).find((l) => l.fhir_type === "Encounter")!.status).toBe("outcome_unknown");
    await sync(port, 902); // read back: the mapped fields equal the attempted body → confirmed
    expect((await links(s.v)).find((l) => l.fhir_type === "Encounter")).toMatchObject({ status: "confirmed" });
    expect((await attempts(s.v)).filter((a) => a.verb === "read").map((a) => a.outcome)).toEqual(["ok"]);
  });

  it("P2-2: a Condition pinned to register A stays held while A is unvalidated; A validated and retired, replacement B active but unvalidated → Kirim Ulang sends it (the pinned row decides)", async () => {
    const port = mockSatusehatPort();
    const PR = await tenant("PT Klinik Produksi Register");
    const pOwn = await person(PR, "owner"); const pDoc = await person(PR, "doctor"); const pFh = await person(PR, "facility_head");
    const pRo = await person(PR, "records_officer");
    await credential(PR, pDoc, PR.b1, pOwn, pFh);
    const r = await room(PR, PR.b1, "loc-r1-0001");
    await h.admin.query(`insert into satusehat_credentials (tenant_id, branch_id, environment, organization_id, client_id, secret_enc, dek_ref, generation, command_key, created_by, created_as)
      values ($1, $2, 'production', $3, 'client-r1', $4, 'dek:v1', 1, $5, $6, 'owner')`,
      [PR.tenantId, PR.b1, PR.org1, encryptField(RING, await keysFor(PR), SECRET_PURPOSE, "rahasia-sintetis-r1"), `k-${key()}`, pOwn.staffId]);
    await h.admin.query(`insert into satusehat_practitioner_links (tenant_id, staff_id, ihs_practitioner_id, source, command_key, recorded_by, recorded_as) values ($1, $2, 'N80000001', 'manual', $3, $4, 'owner')`,
      [PR.tenantId, pDoc.staffId, `k-${key()}`, pOwn.staffId]);
    const nik = `3174${String(++n).padStart(12, "0")}`;
    const pt = await patient(PR, { nik });
    port.patients.set(nik, [{ ihs: "P80000001", name: "Siti Rahma", birthDate: "1990-06-15", gender: "female" }]);
    const ctx = async (p: P) => resolveContext(app, p.acc, { tenantId: PR.tenantId, actingRole: p.role, activeBranchId: p.branch });
    // the active ICD-10 register row A is made unvalidated for this case (the earlier production test validated it) by retiring it in favour of A2
    const A1 = (await h.admin.query(`select id, effective_from from satusehat_code_systems where kind = 'icd10' and code = '*' and effective_to is null`)).rows[0];
    await h.admin.query(`update satusehat_code_systems set effective_to = effective_from + 1 where id = $1`, [A1.id]);
    const regA = (await h.admin.query(`insert into satusehat_code_systems (kind, system_uri, code, display, release_ref, provenance_url, effective_from)
      values ('icd10', 'http://hl7.org/fhir/sid/icd-10', '*', 'ICD-10 (A)', 'SATUSEHAT Standar Terminologi v12.0 (2026-10-31)', 'https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/condition/', $1::date + 1) returning id`,
      [A1.effective_from])).rows[0].id as string;
    const { v } = await visit(PR, PR.b1, pt, r);
    const { examId } = await withTenantContext(app, await ctx(pDoc), (db) => openExam(db, key(), v));
    await withTenantContext(app, await ctx(pDoc), (db) => saveExam(db, key(), examId, { assessment: "Akne", icd10_codes: ["L70.0"] }));
    await withTenantContext(app, await ctx(pDoc), (db) => signRecord(db, key(), examId, STEP));
    await close(v);
    const prod = async (min: number) => {
      process.env.DEPLOY_ENV = "production";
      try { await runSatusehatSync(worker, { port, now: at(min) }); } finally { process.env.DEPLOY_ENV = "local"; }
    };
    await prod(950);
    expect((await links(v)).find((l) => l.fhir_type === "Condition")).toMatchObject({ status: "held", status_reason: "mapping_unvalidated" });
    // A is validated and retired; replacement B (unvalidated) becomes the active row
    await h.admin.query(`update satusehat_code_systems set validated = true where id = $1`, [regA]);
    await h.admin.query(`update satusehat_code_systems set effective_to = effective_from + 1 where id = $1`, [regA]);
    await h.admin.query(`insert into satusehat_code_systems (kind, system_uri, code, display, release_ref, provenance_url, effective_from)
      values ('icd10', 'http://hl7.org/fhir/sid/icd-10', '*', 'ICD-10 (B)', 'SATUSEHAT Standar Terminologi v12.1', 'https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/condition/', $1::date + 2)`,
      [A1.effective_from]);
    await withTenantContext(app, await ctx(pRo), (db) => resend(db, v, "data_corrected"));
    await prod(951);
    expect((await links(v)).map((l) => [l.fhir_type, l.status])).toEqual([["Encounter", "confirmed"], ["Condition", "confirmed"]]);
    expect((await h.admin.query(`select r.materialized ->> 'register_id' reg from satusehat_link_revisions r join satusehat_links l on l.id = r.link_id
      where l.visit_id = $1 and l.fhir_type = 'Condition'`, [v])).rows.map((x) => x.reg)).toEqual([regA]);
  });

  it("review r3: the projection includes every display the builders write and none they do not", () => {
    const enc = encounter({ org: "10000001", visitId: "v-1", patientIhs: "P1", practitionerIhs: "N1", locationId: "L1", arrivedAt: "2026-11-17T01:00:00Z",
      inProgressAt: "2026-11-17T01:10:00Z", finishedAt: "2026-11-17T01:30:00Z", diagnoses: ["c-1"] });
    const cnd = condition({ org: "10000001", visitId: "v-1", code: "L70.0", patientIhs: "P1", encounterId: "e-1" });
    // a copy with one value at a path set (undefined = removed); test-only, the FHIR shape is the builders'
    const at = (o: Fhir, path: (string | number)[], v: unknown): Fhir => {
      const c = structuredClone(o) as Record<string | number, unknown>;
      let x = c;
      for (const k of path.slice(0, -1)) x = x[k] as Record<string | number, unknown>;
      const last = path[path.length - 1];
      if (v === undefined) delete x[last]; else x[last] = v;
      return c as Fhir;
    };
    const fp = bodyFingerprint;
    // a builder-written display changed or removed → a different fingerprint
    for (const [path, v] of [[["class", "display"], "inpatient"], [["class", "display"], undefined],
      [["participant", 0, "type", 0, "coding", 0, "display"], "x"], [["diagnosis", 0, "use", "coding", 0, "display"], "x"]] as [(string | number)[], unknown][]) {
      expect(fp(at(enc, path, v)), path.join(".")).not.toBe(fp(enc));
    }
    for (const path of [["clinicalStatus", "coding", 0, "display"], ["category", 0, "coding", 0, "display"]]) {
      expect(fp(at(cnd, path, "x")), path.join(".")).not.toBe(fp(cnd));
    }
    // displays the builders never write (a reference's, the ICD-10 code's) and other server additions → the same fingerprint
    const encServer = at(at(at(at(enc, ["subject", "display"], "Nama"), ["text"], { div: "x" }), ["meta"], { versionId: "3" }), ["id"], "e-9");
    expect(fp(encServer)).toBe(fp(enc));
    expect(fp(at(at(cnd, ["code", "coding", 0, "display"], "Acne vulgaris"), ["encounter", "display"], "Kunjungan"))).toBe(fp(cnd));
  });
});

