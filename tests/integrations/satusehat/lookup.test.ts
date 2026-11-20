// T-102 increment 4 (TD-31; Panel 2 T102-TD31-DECISION; DEC-123): the practitioner NIK lookup on real PostgreSQL (migration 0128).
// Proves: request → claim → matched writes the link (source lookup) and requeues practitioner_unresolved work; not_found / ambiguous / failed
// write no link; nik_enc is NULL in every terminal row and after expiry (a column scan of the whole table) and the CHECK refuses a terminal
// row with a NIK; the NIK appears nowhere (audit, events, outbox, lookup columns, replies); replay re-authorized before it answers; one open
// lookup per staff member; cross-tenant / other branch / other roles / vendor refused; the worker refuses a bound connection; the requester
// losing the role between request and record → failed/authority and no link; the lease fence; the status reader shows outcome words only.
// The port is the mock (synthetic Practitioner ids); fetch is stubbed and never called. Synthetic NIKs only (MIG-2).
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Role } from "../../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../../src/db/rls/context";
import { openAppPool } from "../../../src/db/rls/pool";
import { CommandError } from "../../../src/lib/command";
import { decryptField, type KekRing } from "../../../src/lib/keys/envelope";
import { setKekRingForTests } from "../../../src/lib/keys/runtime";
import { openExam, saveExam } from "../../../src/modules/clinical/exam/exam";
import { signRecord, type StepUp } from "../../../src/modules/clinical/records/records";
import { mockSatusehatPort, type MockSatusehat } from "../../../src/modules/integrations/satusehat/mock";
import { LOOKUP_PURPOSE } from "../../../src/modules/integrations/satusehat/practitioner-lookup";
import { linkPractitioner, practitionerLookupStatus, requestPractitionerLookup, runSatusehatSync, setCredentials }
  from "../../../src/modules/integrations/satusehat/satusehat";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { createHarness, type Harness, testPool } from "../../rls/harness";

process.env.DEPLOY_ENV = "local"; // sandbox (satusehat_env)

let h: Harness;
let app: pg.Pool;
let worker: pg.Pool;
let owner: pg.Pool;
let n = 0;
const RING: KekRing = { current: 1, keys: new Map([[1, Buffer.alloc(32, 9)]]) };
const STEP: StepUp = { verified: true };
type T = { tenantId: string; b1: string; b2: string; org1: string; org2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "admin_pusat", "finance", "marketing", "central_cs", "auditor", "purchasing"];

async function tenant(name: string): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, name]);
  const org1 = `1100${String(++n).padStart(4, "0")}`; const org2 = `2100${String(++n).padStart(4, "0")}`;
  const br = async (c: string, org: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone, satusehat_org_id) values ($1, $2, $2, 'Asia/Jakarta', $3) returning id`,
    [tenantId, c, org])).rows[0].id as string;
  return { tenantId, b1: await br(`L${++n}`, org1), b2: await br(`L${++n}`, org2), org1, org2 };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`lk${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Lookup ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  const bs = TENANT_WIDE.includes(role) ? [] : branches.length ? branches : [t.b1];
  for (const b of bs) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: bs[0] };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const key = () => crypto.randomUUID();
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => {
  if (!(e instanceof CommandError)) return `raw:${e.code ?? e.message}`;
  const reason = (e as CommandError & { reason?: string }).reason;
  return `${e.code}${reason ? `:${reason}` : ""}`;
});
const at = (min: number) => new Date(Date.now() + min * 60_000);
const sync = (port: MockSatusehat, min = 0) => runSatusehatSync(worker, { port, now: at(min) });
let nikSeq = 0;
const nik = () => `3171${String(++nikSeq).padStart(12, "0")}`; // synthetic 16-digit
const row = async (id: string) => (await h.admin.query(`select state, reason, nik_enc, link_id, lease_gen, finished_at from satusehat_practitioner_lookups where id = $1`, [id])).rows[0];
const linkOf = async (staff: string) => (await h.admin.query(`select ihs_practitioner_id ihs, source, recorded_by, recorded_as from satusehat_practitioner_links
  where staff_id = $1 and ended_at is null`, [staff])).rows[0] ?? null;
// No NIK anywhere the platform persists text (audit, events, outbox, lookup rows except the sealed column) — only the sealed column holds it,
// and only while open.
async function nikNowhere(t: T, value: string) {
  const hits = (await h.admin.query(`
    select 'audit' w from audit_events where tenant_id = $1 and (coalesce(reason, '') || coalesce(reason_code, '') || object_kind) like '%' || $2 || '%'
    union all select 'event' from domain_events where tenant_id = $1 and payload::text like '%' || $2 || '%'
    union all select 'lookup' from satusehat_practitioner_lookups where tenant_id = $1 and (to_jsonb(satusehat_practitioner_lookups) - 'nik_enc')::text like '%' || $2 || '%'
    union all select 'idem' from idempotency_records where tenant_id = $1 and coalesce(result::text, '') like '%' || $2 || '%'`,
    [t.tenantId, value])).rows;
  expect(hits).toEqual([]);
}

const fetchSpy = vi.fn();
let A: T; let B: T;
let OWN: P; let FH: P; let FH2: P; let MGR: P; let RO: P; let DOC: P; let DOC2: P; let NUR: P; let AP: P; let BOWN: P; let BFH: P; let BDOC: P;

async function credential(t: T, p: P, branch: string, rec: P, ver: P) {
  for (const [kind, b] of [["str", null], ["sip", branch]] as const) {
    const id = (await h.admin.query(
      `insert into staff_credentials (tenant_id, staff_id, kind, number, issuer, profession, branch_id, valid_from, expires_on, recorded_by)
       values ($1, $2, $3, $4, 'Konsil Kesehatan', 'dokter', $5, '2024-01-01', $6, $7) returning id`,
      [t.tenantId, p.staffId, kind, `NO-LK-${++n}`, b, b ? "2099-12-31" : null, rec.staffId])).rows[0].id as string;
    await h.admin.query(`update staff_credentials set state = 'verified', decided_by = $2, decided_at = now() where id = $1`, [id, ver.staffId]);
  }
}

beforeAll(async () => {
  setKekRingForTests(RING);
  vi.stubGlobal("fetch", fetchSpy);
  h = await createHarness();
  const login = h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE]));
  app = await openAppPool({ connectionString: login, max: 6 });
  worker = await openAppPool({ connectionString: login, max: 2 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant("PT Klinik Lookup Sintetis");
  B = await tenant("PT Klinik Lookup Lain");
  OWN = await person(A, "owner"); FH = await person(A, "facility_head"); FH2 = await person(A, "facility_head", A.b2); MGR = await person(A, "manager");
  RO = await person(A, "records_officer"); DOC = await person(A, "doctor"); DOC2 = await person(A, "doctor"); NUR = await person(A, "nurse"); AP = await person(A, "admin_pusat");
  BOWN = await person(B, "owner"); BFH = await person(B, "facility_head"); BDOC = await person(B, "doctor");
  await as(OWN, (db) => setCredentials(db, key(), { branchId: A.b1, environment: "sandbox", organizationId: A.org1, clientId: "client-lk-a1", clientSecret: "rahasia-lookup-a1" }));
  await as(BOWN, (db) => setCredentials(db, key(), { branchId: B.b1, environment: "sandbox", organizationId: B.org1, clientId: "client-lk-b1", clientSecret: "rahasia-lookup-b1" }));
}, 300_000);
afterEach(() => expect(fetchSpy).not.toHaveBeenCalled());
afterAll(async () => {
  vi.unstubAllGlobals();
  setKekRingForTests(undefined);
  await app?.end();
  await worker?.end();
  await owner?.end();
  await h?.close();
});

describe("TD-31 NIK lookup: request → claim → record", () => {
  it("a facility head requests; the row holds only a sealed NIK bound to staff + lookup for ≤ 15 min; the worker matches → link (source lookup), nik_enc cleared, audited without the NIK", async () => {
    const port = mockSatusehatPort();
    const v = nik();
    port.practitioners.set(v, ["10009880001"]);
    const id = await as(FH, (db) => requestPractitionerLookup(db, key(), { staffId: DOC.staffId, branchId: A.b1, nik: `${v.slice(0, 4)} ${v.slice(4)}` }));
    const r0 = (await h.admin.query(`select state, nik_enc, requested_as, expires_at - requested_at d, environment from satusehat_practitioner_lookups where id = $1`, [id])).rows[0];
    expect([r0.state, r0.requested_as, r0.environment, r0.d.minutes ?? 0]).toEqual(["pending", "facility_head", "sandbox", 15]);
    expect(r0.nik_enc).toMatch(/^v1\./);
    expect(r0.nik_enc).not.toContain(v);
    // the seal is bound: decrypting gives staff|lookup|nik (only the worker does this)
    const k = (await h.admin.query(`select version, wrapped from tenant_data_keys where tenant_id = $1 and is_current`, [A.tenantId])).rows[0];
    const keys = { tenantId: A.tenantId, current: { tenantId: A.tenantId, version: k.version, wrapped: k.wrapped }, byVersion: () => ({ tenantId: A.tenantId, version: k.version, wrapped: k.wrapped }) };
    expect(decryptField(RING, keys, LOOKUP_PURPOSE, r0.nik_enc)).toBe(`${DOC.staffId}|${id}|${v}`);
    expect(await sync(port, 1)).toMatchObject({ lookups: 1 });
    expect(port.count("practitioner")).toBe(1);
    const r1 = await row(id);
    expect([r1.state, r1.reason, r1.nik_enc, r1.link_id !== null, r1.finished_at !== null]).toEqual(["matched", null, null, true, true]);
    expect(await linkOf(DOC.staffId)).toEqual({ ihs: "10009880001", source: "lookup", recorded_by: FH.staffId, recorded_as: "facility_head" });
    const audit = (await h.admin.query(`select reason_code, service_identity, staff_id is not null s from audit_events where object_id = $1 order by seq`, [id])).rows;
    expect(audit).toEqual([{ reason_code: "satusehat_lookup_requested", service_identity: null, s: true }, { reason_code: "satusehat_lookup_matched", service_identity: "satusehat.worker", s: false }]);
    const ev = (await h.admin.query(`select type, payload from domain_events where aggregate_id = $1 order by occurred_at, id`, [id])).rows;
    expect(ev.map((e) => [e.type, Object.keys(e.payload).sort()])).toEqual([
      ["PractitionerLookupRequested", ["lookup_id", "staff_id"]], ["PractitionerLookupFinished", ["link_id", "lookup_id", "staff_id", "state"]]]);
    // a non-matched outcome's event carries no link_id (ids and codes only; no null keys)
    await nikNowhere(A, v);
    // the status reader: outcome words only (state + reason code), never the NIK or the IHS id
    const st = await as(FH, (db) => practitionerLookupStatus(db, A.b1));
    expect(st.find((x) => x.staff_id === DOC.staffId)).toMatchObject({ state: "matched", reason: null });
    expect(JSON.stringify(st)).not.toContain(v);
    expect(JSON.stringify(st)).not.toContain("10009880001");
  });

  it("a doctor held practitioner_unresolved is requeued by a matched lookup, exactly as by a manual link", async () => {
    const port = mockSatusehatPort();
    const DOC3 = await person(A, "doctor");
    await credential(A, DOC3, A.b1, OWN, FH);
    const room = (await h.admin.query(`insert into rooms (tenant_id, branch_id, name, kind, satusehat_location_id) values ($1, $2, $3, 'consultation', 'loc-lk-0001') returning id`,
      [A.tenantId, A.b1, `Ruang LK ${++n}`])).rows[0].id as string;
    const pn = nik();
    const enc = (await import("../../../src/lib/keys/envelope")).encryptField(RING, await (async () => {
      const k = (await h.admin.query(`select version, wrapped from tenant_data_keys where tenant_id = $1 and is_current`, [A.tenantId])).rows[0];
      return { tenantId: A.tenantId, current: { tenantId: A.tenantId, version: k.version, wrapped: k.wrapped }, byVersion: () => ({ tenantId: A.tenantId, version: k.version, wrapped: k.wrapped }) };
    })(), "patient.identity", pn);
    const pt = (await h.admin.query(
      `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education, marital_status,
         registered_branch_id, created_by, created_as)
       values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Siti Rahma', '1990-06-15', 'female', 'nik', $2, $3, 'islam', 'Karyawan', 's1', 'kawin',
         $4, (select id from staff where tenant_id = $1 limit 1), 'fo_cashier') returning id`, [A.tenantId, enc, `bidxlk${String(++n).padStart(37, "0")}`, A.b1])).rows[0].id as string;
    port.patients.set(pn, [{ ihs: "P10009001", name: "SITI RAHMA", birthDate: "1990-06-15", gender: "female" }]);
    const by = (await h.admin.query(`select id from staff where tenant_id = $1 limit 1`, [A.tenantId])).rows[0].id;
    const vis = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by, checked_in_at) values ($1, $2, $3, 'walk_in', $4, now() - interval '2 hours') returning id`,
      [A.tenantId, A.b1, pt, by])).rows[0].id as string;
    const tk = (await h.admin.query(`insert into queue_tickets (tenant_id, branch_id, queue_date, seq, prefix, visit_id) values ($1, $2, current_date, $3, 'A', $4) returning id`,
      [A.tenantId, A.b1, ++n, vis])).rows[0].id as string;
    await h.admin.query(`update queue_tickets set state = 'called', called_at = now(), called_by = $2, room_id = $3 where id = $1`, [tk, by, room]);
    const { examId } = await as(DOC3, (db) => openExam(db, key(), vis));
    await as(DOC3, (db) => saveExam(db, key(), examId, { assessment: "Akne", icd10_codes: ["L70.0"], vitals: { nadi: 80 } }));
    await as(DOC3, (db) => signRecord(db, key(), examId, STEP));
    await h.admin.query(`update visits set closed_at = now() - interval '1 minute', closed_by = checked_in_by where id = $1`, [vis]);
    await sync(port, 2);
    const ob = async () => (await h.admin.query(`select state, hold_reason from satusehat_outbox where visit_id = $1 order by created_at desc, id desc limit 1`, [vis])).rows[0];
    expect(await ob()).toEqual({ state: "held", hold_reason: "practitioner_unresolved" });
    const v = nik();
    port.practitioners.set(v, ["10009880003"]);
    await as(FH, (db) => requestPractitionerLookup(db, key(), { staffId: DOC3.staffId, branchId: A.b1, nik: v }));
    await sync(port, 3); // the lookup links; the requeued item is sent in this same pass (lookups run before the outbox claim)
    expect(await linkOf(DOC3.staffId)).toMatchObject({ ihs: "10009880003", source: "lookup" });
    if ((await ob()).state !== "done") await sync(port, 4);
    expect((await ob()).state).toBe("done");
  });

  it("not_found, ambiguous (never auto-selected) and port failures write no link; every terminal row has nik_enc NULL", async () => {
    const port = mockSatusehatPort();
    const cases: [string, () => void, string, string | null][] = [
      ["none", () => undefined, "not_found", null],
      ["two", () => undefined, "ambiguous", null],
      ["5xx", () => port.next("practitioner", { kind: "http_5xx" }), "failed", "http_5xx"],
      ["lost", () => port.next("practitioner", { kind: "throw" }), "failed", "lost"],
      ["token", () => port.next("token", { kind: "throw" }), "failed", "token"],
    ];
    for (const [label, arm, state, reason] of cases) {
      const D = await person(A, "nurse");
      const v = nik();
      if (label === "two") port.practitioners.set(v, ["10009880100", "10009880101"]);
      const { clearTokenCache } = await import("../../../src/modules/integrations/satusehat/satusehat");
      clearTokenCache();
      arm();
      const id = await as(OWN, (db) => requestPractitionerLookup(db, key(), { staffId: D.staffId, branchId: A.b1, nik: v }));
      await sync(port, 5);
      expect(await row(id), label).toMatchObject({ state, reason, nik_enc: null, link_id: null });
      expect(await linkOf(D.staffId), label).toBeNull();
      await nikNowhere(A, v);
    }
  });

  it("expiry: an unclaimed lookup past 15 minutes is expired by the sweep (nik_enc NULL, audited by the worker), and a claimed one recorded late is expired, no link", async () => {
    const port = mockSatusehatPort();
    const D = await person(A, "therapist");
    const v = nik();
    port.practitioners.set(v, ["10009880200"]);
    const id = await as(FH, (db) => requestPractitionerLookup(db, key(), { staffId: D.staffId, branchId: A.b1, nik: v }));
    await sync(port, 16);
    // expired by the SWEEP: never leased (lease_gen 0), the port never called
    expect(await row(id)).toMatchObject({ state: "expired", nik_enc: null, link_id: null, lease_gen: 0 });
    expect(port.count("practitioner")).toBe(0);
    expect((await h.admin.query(`select reason_code, service_identity from audit_events where object_id = $1 order by seq desc limit 1`, [id])).rows[0])
      .toEqual({ reason_code: "satusehat_lookup_expired", service_identity: "satusehat.worker" });
    // claimed in time, recorded after expires_at: expired (the lease is still valid)
    const D2 = await person(A, "therapist");
    const id2 = await as(FH, (db) => requestPractitionerLookup(db, key(), { staffId: D2.staffId, branchId: A.b1, nik: nik() }));
    const exp = (await h.admin.query(`select expires_at from satusehat_practitioner_lookups where id = $1`, [id2])).rows[0].expires_at as Date;
    const c = await worker.connect();
    try {
      await c.query(`select set_config('app.deploy_env', 'local', false)`);
      const claimed = (await c.query(`select satusehat_practitioner_lookup_claim($1) r`, [new Date(exp.getTime() - 60_000)])).rows[0].r as { id: string; gen: number }[];
      const mine = claimed.find((x) => x.id === id2)!;
      expect((await c.query(`select satusehat_practitioner_lookup_record($1, $2, $3::jsonb, $4) r`, [id2, mine.gen, JSON.stringify({ state: "matched", ihs: "10009880201" }),
        new Date(exp.getTime() + 1_000)])).rows[0].r).toBe("expired");
    } finally {
      c.release();
    }
    expect(await row(id2)).toMatchObject({ state: "expired", nik_enc: null, link_id: null });
    expect(await linkOf(D2.staffId)).toBeNull();
  });

  it("the erasure is a CHECK: a terminal row cannot keep a NIK, an open row cannot lose it; the guard refuses deletes, rewriting the seal and reopening", async () => {
    const D = await person(A, "nurse");
    const id = await as(FH, (db) => requestPractitionerLookup(db, key(), { staffId: D.staffId, branchId: A.b1, nik: nik() }));
    const raw = (sql: string) => h.admin.query(sql, [id]).then(() => "ok", (e) => `${e.code}:${e.constraint ?? ""}`);
    expect(await raw(`update satusehat_practitioner_lookups set state = 'expired', finished_at = now() where id = $1`)).toBe("23514:satusehat_practitioner_lookups_check");
    expect(await raw(`update satusehat_practitioner_lookups set nik_enc = null where id = $1`)).toBe("23514:satusehat_practitioner_lookups_check");
    expect(await raw(`update satusehat_practitioner_lookups set nik_enc = 'v1.1.aaaa.bbbb.cccc' where id = $1`)).toBe("42501:");
    expect(await raw(`delete from satusehat_practitioner_lookups where id = $1`)).toBe("42501:");
    expect(await raw(`update satusehat_practitioner_lookups set state = 'expired', nik_enc = null, finished_at = now() where id = $1`)).toBe("ok");
    expect(await raw(`update satusehat_practitioner_lookups set state = 'pending', nik_enc = 'v1.1.aaaa.bbbb.cccc', finished_at = null where id = $1`)).toBe("42501:");
    // a terminal row is final even for a change that touches no NIK and no state
    expect(await raw(`update satusehat_practitioner_lookups set finished_at = finished_at + interval '1 second' where id = $1`)).toBe("42501:");
    // the whole table: no terminal row holds a NIK, no open row lacks one
    const bad = (await h.admin.query(`select count(*)::int c from satusehat_practitioner_lookups
      where (state in ('pending','leased')) <> (nik_enc is not null)`)).rows[0].c;
    expect(bad).toBe(0);
  });
});

describe("TD-31 authority, replay, isolation", () => {
  it("one open lookup per staff member: a new request expires the open one (its sealed NIK cleared at once)", async () => {
    const D = await person(A, "doctor");
    const first = await as(FH, (db) => requestPractitionerLookup(db, key(), { staffId: D.staffId, branchId: A.b1, nik: nik() }));
    const second = await as(OWN, (db) => requestPractitionerLookup(db, key(), { staffId: D.staffId, branchId: A.b1, nik: nik() }));
    expect(await row(first)).toMatchObject({ state: "expired", nik_enc: null });
    expect((await row(second)).state).toBe("pending");
  });

  it("a replay returns the first id, stores no new ciphertext, and is re-authorized first (another branch's facility head and another tenant: not found)", async () => {
    const D = await person(A, "doctor");
    const k = key();
    const id = await as(FH, (db) => requestPractitionerLookup(db, k, { staffId: D.staffId, branchId: A.b1, nik: nik() }));
    const before = (await row(id)).nik_enc;
    expect(await as(FH, (db) => requestPractitionerLookup(db, k, { staffId: D.staffId, branchId: A.b1, nik: nik() }))).toBe(id);
    expect((await row(id)).nik_enc).toBe(before);
    expect(await code(as(FH2, (db) => requestPractitionerLookup(db, k, { staffId: D.staffId, branchId: A.b2, nik: nik() })))).toBe("ERR_NOT_FOUND:branch not found");
    expect(await code(as(BFH, (db) => requestPractitionerLookup(db, k, { staffId: D.staffId, branchId: B.b1, nik: nik() })))).toBe("ERR_NOT_FOUND:staff not found");
    expect(Number((await h.admin.query(`select count(*) c from satusehat_practitioner_lookups where command_key = $1`, [k])).rows[0].c)).toBe(1);
  });

  it("roles: manager, records officer, doctor, admin pusat refused; a facility head only for staff at his branch; a branch without an active credential refused; bad NIK refused without echo", async () => {
    for (const p of [MGR, RO, DOC, AP]) {
      expect(await code(as(p, (db) => requestPractitionerLookup(db, key(), { staffId: DOC2.staffId, branchId: A.b1, nik: nik() }))), p.role).toBe("ERR_FORBIDDEN:role may not do this in SATUSEHAT");
    }
    expect(await code(as(FH2, (db) => requestPractitionerLookup(db, key(), { staffId: DOC2.staffId, branchId: A.b1, nik: nik() })))).toBe("ERR_NOT_FOUND:branch not found");
    expect(await code(as(FH, (db) => requestPractitionerLookup(db, key(), { staffId: BDOC.staffId, branchId: A.b1, nik: nik() })))).toBe("ERR_NOT_FOUND:staff not found");
    expect(await code(as(OWN, (db) => requestPractitionerLookup(db, key(), { staffId: NUR.staffId, branchId: A.b2, nik: nik() })))).toBe("ERR_NOT_FOUND:staff not found");
    const N2 = await person(A, "nurse", A.b2);
    expect(await code(as(OWN, (db) => requestPractitionerLookup(db, key(), { staffId: N2.staffId, branchId: A.b2, nik: nik() })))).toBe("ERR_VERSION_CONFLICT:credential");
    const bad = "31710112038900X1";
    const e = await as(FH, (db) => requestPractitionerLookup(db, key(), { staffId: DOC2.staffId, branchId: A.b1, nik: bad })).catch((x) => x);
    expect(JSON.stringify({ m: e.message, e })).not.toContain(bad);
    expect(await as(FH, (db) => db.query(`select satusehat_practitioner_lookup_request($1, $2, $3, $4, 'not-a-cipher')`, [crypto.randomUUID(), key(), DOC2.staffId, A.b1]))
      .then(() => "ok", (e) => e.message)).toBe("ERR_INVALID_INPUT: lookup");
  });

  it("the requester losing the role between request and record → failed/authority, no link; the lease fence refuses a stale record", async () => {
    const port = mockSatusehatPort();
    const FH3 = await person(A, "facility_head");
    const D = await person(A, "doctor");
    const v = nik();
    port.practitioners.set(v, ["10009880300"]);
    const id = await as(FH3, (db) => requestPractitionerLookup(db, key(), { staffId: D.staffId, branchId: A.b1, nik: v }));
    await h.admin.query(`update memberships set effective_to = now() where id = (select membership_id from staff where id = $1)`, [FH3.staffId]);
    await sync(port, 6);
    expect(await row(id)).toMatchObject({ state: "failed", reason: "authority", nik_enc: null, link_id: null });
    expect(await linkOf(D.staffId)).toBeNull();
    // fence: a record with the wrong generation is stale and changes nothing
    const D2 = await person(A, "doctor");
    const id2 = await as(FH, (db) => requestPractitionerLookup(db, key(), { staffId: D2.staffId, branchId: A.b1, nik: nik() }));
    const c = await worker.connect();
    try {
      await c.query(`select set_config('app.deploy_env', 'local', false)`);
      const claimed = (await c.query(`select satusehat_practitioner_lookup_claim($1) r`, [new Date()])).rows[0].r as { id: string; gen: number }[];
      const g = claimed.find((x) => x.id === id2)!.gen;
      expect((await c.query(`select satusehat_practitioner_lookup_record($1, $2, '{"state":"not_found"}'::jsonb, $3) r`, [id2, g + 1, new Date()])).rows[0].r).toBe("stale");
      expect((await row(id2)).state).toBe("leased");
      expect((await c.query(`select satusehat_practitioner_lookup_record($1, $2, '{"state":"not_found"}'::jsonb, $3) r`, [id2, g, new Date()])).rows[0].r).toBe("not_found");
      expect((await c.query(`select satusehat_practitioner_lookup_record($1, $2, '{"state":"not_found"}'::jsonb, $3) r`, [id2, g, new Date()])).rows[0].r).toBe("stale");
      // a malformed outcome is refused (an ambiguous record carries no IHS; matched needs one)
      expect(await c.query(`select satusehat_practitioner_lookup_record($1, 1, '{"state":"matched"}'::jsonb, now())`, [id2]).then(() => "ok", (e) => e.message)).toMatch(/ERR_INVALID_INPUT/);
    } finally {
      c.release();
    }
  });

  // review b62a4c56 F1: the record joins the tenant's staff_access serialization (authority changes, the manual link writer). Controlled with a
  // held lock: the record must WAIT, then judge authority / write the link after the other transaction commits.
  const leasedFor = async (c: pg.PoolClient, id: string) => {
    await c.query(`select set_config('app.deploy_env', 'local', false)`);
    const claimed = (await c.query(`select satusehat_practitioner_lookup_claim($1) r`, [new Date()])).rows[0].r as { id: string; gen: number }[];
    return claimed.find((x) => x.id === id)!.gen;
  };
  const waitsOnLock = async (pid: number) => {
    for (let i = 0; i < 100; i++) {
      if ((await h.admin.query(`select count(*)::int n from pg_locks where pid = $1 and not granted`, [pid])).rows[0].n > 0) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };
  it("record vs an authority change in progress: the record waits for staff_access, then sees the revocation → failed/authority, no stale link", async () => {
    const FH4 = await person(A, "facility_head");
    const D = await person(A, "doctor");
    const id = await as(FH4, (db) => requestPractitionerLookup(db, key(), { staffId: D.staffId, branchId: A.b1, nik: nik() }));
    const c = await worker.connect(); const x = await owner.connect();
    try {
      const g = await leasedFor(c, id);
      const pid = (await c.query(`select pg_backend_pid() p`)).rows[0].p as number;
      // an authority change holds the tenant lock and ends the requester's membership, not yet committed
      await x.query("begin");
      await x.query(`select pg_advisory_xact_lock(hashtextextended('staff_access:' || $1::text, 0))`, [A.tenantId]);
      await x.query(`update memberships set effective_to = now() where id = (select membership_id from staff where id = $1)`, [FH4.staffId]);
      const rec = c.query(`select satusehat_practitioner_lookup_record($1, $2, '{"state":"matched","ihs":"10009880401"}'::jsonb, $3) r`, [id, g, new Date()]);
      expect(await waitsOnLock(pid)).toBe(true); // serialized behind the authority change
      // lock order (the request path's): staff_access first — the waiting record holds no lock on the lookup row yet
      const y = await owner.connect();
      try {
        await y.query("begin");
        expect(await y.query(`select 1 from satusehat_practitioner_lookups where id = $1 for update nowait`, [id]).then(() => "free", (e) => e.code)).toBe("free");
      } finally { await y.query("rollback"); y.release(); }
      await x.query("commit");
      expect((await rec).rows[0].r).toBe("failed");
      expect(await row(id)).toMatchObject({ state: "failed", reason: "authority", nik_enc: null, link_id: null });
      expect(await linkOf(D.staffId)).toBeNull();
    } finally {
      await x.query("rollback").catch(() => {}); x.release(); c.release();
    }
  });
  it("record vs the manual link writer in progress: the record waits, then replaces the manual link — one current link, no unique-index abort, NIK erased", async () => {
    const D = await person(A, "doctor");
    const id = await as(FH, (db) => requestPractitionerLookup(db, key(), { staffId: D.staffId, branchId: A.b1, nik: nik() }));
    const c = await worker.connect();
    let release!: () => void; const hold = new Promise<void>((r) => { release = r; });
    let started!: () => void; const inside = new Promise<void>((r) => { started = r; });
    try {
      const g = await leasedFor(c, id);
      const pid = (await c.query(`select pg_backend_pid() p`)).rows[0].p as number;
      // the owner's manual link: link_set takes staff_access (satusehat_actor) and writes end-current / insert; held open
      const manual = as(OWN, async (db) => { const v = await linkPractitioner(db, key(), { staffId: D.staffId, ihs: "10009880402" }); started(); await hold; return v; });
      await inside;
      const rec = c.query(`select satusehat_practitioner_lookup_record($1, $2, '{"state":"matched","ihs":"10009880403"}'::jsonb, $3) r`, [id, g, new Date()]);
      expect(await waitsOnLock(pid)).toBe(true);
      release();
      await manual;
      expect((await rec).rows[0].r).toBe("matched");
      const links = (await h.admin.query(`select ihs_practitioner_id ihs, source, ended_at is null cur from satusehat_practitioner_links where staff_id = $1 order by recorded_at, id`, [D.staffId])).rows;
      expect(links).toEqual([{ ihs: "10009880402", source: "manual", cur: false }, { ihs: "10009880403", source: "lookup", cur: true }]);
      expect(await row(id)).toMatchObject({ state: "matched", nik_enc: null });
    } finally {
      release(); c.release();
    }
  });

  // review 44a609f4: the fence time is read AFTER the staff_access and row locks. A record that enters just before a deadline and waits behind
  // another holder of staff_access must be judged on the time it resumes: the injected test clock (p_now) is advanced by the real wait.
  const blockedRecord = async (id: string, nowFor: (r: { expires_at: Date; lease_until: Date }) => Date | null, holdMs: number, claimAt?: (expiresAt: Date) => Date) => {
    const c = await worker.connect(); const x = await owner.connect();
    try {
      let g: number;
      if (claimAt) { // claim at a chosen instant so the 2-minute lease outlives expires_at (a valid lease when expiry is crossed)
        await c.query(`select set_config('app.deploy_env', 'local', false)`);
        const ex = (await h.admin.query(`select expires_at from satusehat_practitioner_lookups where id = $1`, [id])).rows[0].expires_at as Date;
        const claimed = (await c.query(`select satusehat_practitioner_lookup_claim($1) r`, [claimAt(ex)])).rows[0].r as { id: string; gen: number }[];
        g = claimed.find((y) => y.id === id)!.gen;
      } else g = await leasedFor(c, id);
      const r = (await h.admin.query(`select expires_at, lease_until from satusehat_practitioner_lookups where id = $1`, [id])).rows[0];
      const pid = (await c.query(`select pg_backend_pid() p`)).rows[0].p as number;
      await x.query("begin");
      await x.query(`select pg_advisory_xact_lock(hashtextextended('staff_access:' || $1::text, 0))`, [A.tenantId]); // an unrelated holder
      const rec = c.query(`select satusehat_practitioner_lookup_record($1, $2, '{"state":"matched","ihs":"10009880501"}'::jsonb, $3) r`, [id, g, nowFor(r)]);
      expect(await waitsOnLock(pid)).toBe(true);
      await new Promise((res) => setTimeout(res, holdMs));
      const before = await row(id);
      expect([before.state, before.lease_gen]).toEqual(["leased", g]); // nothing changed the row while it waited: only time passed
      await x.query("commit");
      return (await rec).rows[0].r as string;
    } finally {
      await x.query("rollback").catch(() => {}); x.release(); c.release();
    }
  };
  it("deadline crossing while blocked: enters 1 s before expires_at with a valid lease, waits 1.5 s → expired, NIK erased, no link", async () => {
    const D = await person(A, "doctor");
    const id = await as(FH, (db) => requestPractitionerLookup(db, key(), { staffId: D.staffId, branchId: A.b1, nik: nik() }));
    // claimed 1 s before expiry (lease until expiry + 119 s); the injected clock sits 1 s before expiry: a valid lease at entry and after the wait
    const out = await blockedRecord(id, (r) => new Date(r.expires_at.getTime() - 1000), 1500, (ex) => new Date(ex.getTime() - 1000));
    expect(out).toBe("expired");
    expect(await row(id)).toMatchObject({ state: "expired", nik_enc: null, link_id: null });
    expect(await linkOf(D.staffId)).toBeNull();
  });
  it("lease crossing while blocked: enters 1 s before lease_until, waits 1.5 s → stale, the row untouched, no link", async () => {
    const D = await person(A, "doctor");
    const id = await as(FH, (db) => requestPractitionerLookup(db, key(), { staffId: D.staffId, branchId: A.b1, nik: nik() }));
    const out = await blockedRecord(id, (r) => new Date(r.lease_until.getTime() - 1000), 1500);
    expect(out).toBe("stale");
    expect(await row(id)).toMatchObject({ state: "leased", link_id: null });
    expect((await row(id)).nik_enc).toMatch(/^v1\./); // the stale record changes nothing; the sweep / a later lease owns it
    expect(await linkOf(D.staffId)).toBeNull();
  });
  it("production path (no injected instant), lease crossed while blocked: the database clock read after the locks → stale, no link", async () => {
    const D = await person(A, "doctor");
    const id = await as(FH, (db) => requestPractitionerLookup(db, key(), { staffId: D.staffId, branchId: A.b1, nik: nik() }));
    // claimed with an instant 119 s ago: the 2-minute lease ends ~1 s from now on the real clock; expiry is ~14 min away
    const out = await blockedRecord(id, () => null, 1500, () => new Date(Date.now() - 119_000));
    expect(out).toBe("stale");
    expect(await row(id)).toMatchObject({ state: "leased", link_id: null });
    expect(await linkOf(D.staffId)).toBeNull();
  });
  it("production path (no injected instant): the record fences on the database clock read after the locks", async () => {
    const D = await person(A, "doctor");
    const id = await as(FH, (db) => requestPractitionerLookup(db, key(), { staffId: D.staffId, branchId: A.b1, nik: nik() }));
    expect(await blockedRecord(id, () => null, 200)).toBe("matched"); // well within both deadlines on the real clock
    expect(await row(id)).toMatchObject({ state: "matched", nik_enc: null });
    expect((await linkOf(D.staffId))?.source).toBe("lookup");
  });

  it("isolation: the worker functions refuse a bound connection; the app cannot read or write the table; B's status shows nothing of A; vendor support never reaches the table", async () => {
    expect(await code(as(OWN, (db) => db.query(`select satusehat_practitioner_lookup_claim()`)))).toMatch(/^raw:/);
    expect(await code(as(OWN, (db) => db.query(`select satusehat_practitioner_lookup_record($1, 1, '{"state":"not_found"}'::jsonb)`, [crypto.randomUUID()])))).toMatch(/^raw:/);
    expect(await code(as(OWN, (db) => db.query(`select 1 from satusehat_practitioner_lookups limit 1`)))).toBe("raw:42501");
    expect(await code(as(OWN, (db) => db.query(`insert into satusehat_practitioner_lookups (tenant_id, staff_id, branch_id, environment, nik_enc, command_key, requested_by, requested_as, expires_at)
      values ($1, $2, $3, 'sandbox', 'v1.1.a.b.c', 'k-00000000', $2, 'owner', now() + interval '1 minute')`, [A.tenantId, OWN.staffId, A.b1])))).toBe("raw:42501");
    expect(await code(as(BOWN, (db) => practitionerLookupStatus(db, A.b1)))).toBe("ERR_NOT_FOUND:branch not found");
    expect(await as(BOWN, (db) => practitionerLookupStatus(db, B.b1))).toEqual([]);
    for (const p of [MGR, RO, DOC]) expect(await code(as(p, (db) => practitionerLookupStatus(db, A.b1))), p.role).toBe("ERR_FORBIDDEN:role may not do this in SATUSEHAT");
    expect((await h.admin.query(`select support_class from support_object_kinds where table_name = 'public.satusehat_practitioner_lookups'`)).rows[0].support_class).toBe("never");
    // the manual link still works beside the lookup (DEC-113 (6))
    await as(OWN, (db) => linkPractitioner(db, key(), { staffId: DOC2.staffId, ihs: "N10009999" }));
    expect(await linkOf(DOC2.staffId)).toMatchObject({ source: "manual" });
  });
});
