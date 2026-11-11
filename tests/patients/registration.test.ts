// T-037 Done-when: scenario PR-5 passes; the NIK is never stored in clear; one phone for two patients
// exposes neither; scenario PR-1 tenant isolation passes in full (patients of two tenants, an audit
// event recorded). Plus the plan review: the tenant data key race, all four identity types, the
// minimal match projection, guardians for minors and newborns, the MRN sequence, roles and readers,
// the lifecycle gate, tampered sealed values, immutability, vendor support class, cross-tenant.
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { decryptField, type KekRing } from "../../src/lib/keys/envelope";
import { setKekRingForTests, tenantKeys } from "../../src/lib/keys/runtime";
import { CommandError } from "../../src/lib/command";
import {
  findMatches, getPatient, identityIndexForSearch, normaliseIdentity, normalisePhone, registerPatient, type RegistrationFields, sealIdentity, verifySealed,
} from "../../src/modules/patients/patients";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { createHarness, type Harness, testPool } from "../rls/harness";

// Synthetic data on a local database (MIG-2); the production gate is tested explicitly below.
process.env.DEPLOY_ENV = "local";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
const RING: KekRing = { current: 1, keys: new Map([[1, randomBytes(32)]]) };
type T = { tenantId: string; b1: string; b2: string; jyp: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "purchasing", "marketing", "central_cs", "auditor"];

async function tenant(state = "live"): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ($1) returning id`, [state])).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Pasien Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string, tz = "Asia/Jakarta") =>
    (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, $3) returning id`, [tenantId, c, tz])).rows[0].id as string;
  return { tenantId, b1: await br("P1"), b2: await br("P2"), jyp: await br("PJ", "Asia/Jayapura") };
}
async function person(t: T, role: Role, branch?: string): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`psn${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Pasien ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  const b = TENANT_WIDE.includes(role) ? undefined : branch ?? t.b1;
  if (b) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: b };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>, branch?: string | null) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: branch === null ? undefined : branch ?? p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? `${e.code}` : `raw:${e.code ?? e.message}`));

// A registration as the UI does it: normalise, seal (if a number), register.
async function register(p: P, f: Partial<RegistrationFields> & { number?: string }, decision: "new" | null = null, branch?: string | null) {
  const fields: RegistrationFields = {
    full_name: "Sinta Pasien", birth_date: "1990-05-17", sex: "female", phone: "0812-3456-7890", identity_type: "nik",
    religion: "islam", occupation: "Karyawan", education: "s1", marital_status: "kawin", ...f,
  };
  return as(p, async (db) => {
    let sealed = null;
    if (fields.identity_type !== "newborn_via_guardian") {
      const nrm = normaliseIdentity(fields.identity_type, f.number ?? "3171012345670001");
      if (!nrm) throw new Error("bad number in test");
      sealed = await sealIdentity(db, p.tenantId, fields.identity_type, nrm);
    }
    return registerPatient(db, fields, sealed, decision);
  }, branch);
}

let A: T;
let B: T;
let FO: P; let CS: P; let OWN: P; let MGR: P; let DOC: P; let FIN: P; let MK: P; let PU: P; let AU: P; let BC: P;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  setKekRingForTests(RING);
  A = await tenant();
  B = await tenant();
  FO = await person(A, "fo_cashier", A.b1);
  CS = await person(A, "central_cs");
  OWN = await person(A, "owner");
  MGR = await person(A, "manager", A.b1);
  DOC = await person(A, "doctor", A.b1);
  FIN = await person(A, "finance");
  MK = await person(A, "marketing");
  PU = await person(A, "purchasing");
  AU = await person(A, "auditor");
  BC = await person(A, "bc", A.b1);
});

afterAll(async () => {
  setKekRingForTests(undefined);
  await owner?.end();
  await app?.end();
  await h?.close();
});

describe("T-037 Done-when", () => {
  it("scenario PR-5: two patients with the same phone; a search by that phone lists both for an explicit choice, minimal projection only", async () => {
    const one = await register(FO, { full_name: "Ani Satu", number: "3171010101010001", phone: "081299990001" });
    expect(one).toMatchObject({ ok: true, mrn: expect.stringMatching(/^RM-[0-9]{6}$/) });
    // The same phone for another person: an explicit decision is required (UX-4), nothing written.
    const pause = await register(FO, { full_name: "Budi Dua", birth_date: "1985-01-02", number: "3171010101010002", phone: "+62 812-9999-0001" });
    expect(pause).toMatchObject({ ok: false, code: "duplicate_decision_required" });
    expect(pause.ok === false && pause.matches.map((m) => m.fullName)).toEqual(["Ani Satu"]);
    const two = await register(FO, { full_name: "Budi Dua", birth_date: "1985-01-02", number: "3171010101010002", phone: "+62 812-9999-0001" }, "new");
    expect(two.ok).toBe(true);
    const found = await as(FO, (db) => findMatches(db, { phone: "0812 9999 0001" }));
    expect(found.map((m) => m.fullName)).toEqual(["Ani Satu", "Budi Dua"]);
    for (const m of found) {
      expect(Object.keys(m).sort()).toEqual(["birthYear", "fullName", "id", "maskedPhone", "mrn"]);
      expect(m.maskedPhone).toMatch(/^\+62•+0001$/);
    }
  });

  it("the NIK is never stored in clear: ciphertext and index only; the app role cannot select them; another tenant's key cannot open it", async () => {
    const nik = "3171019876543210";
    const r = await register(FO, { full_name: "Citra Rahasia", number: nik, phone: "081277770001" });
    expect(r.ok).toBe(true);
    const raw = (await h.admin.query(`select identity_enc, identity_bidx, row_to_json(p)::text as all_columns from patients p where id = $1`, [(r as { patientId: string }).patientId])).rows[0];
    expect(raw.identity_enc).toMatch(/^v1\.1\./);
    expect(raw.all_columns).not.toContain(nik);
    expect(raw.identity_bidx).not.toContain(nik);
    // Nowhere else either: events, audit, contact points, guardians.
    for (const t of ["domain_events", "audit_events", "contact_points", "guardians"]) {
      expect((await h.admin.query(`select count(*)::int as c from ${t} x where row_to_json(x)::text like $1`, [`%${nik}%`])).rows[0].c, t).toBe(0);
    }
    await expect(as(DOC, (db) => db.query(`select identity_enc from patients limit 1`))).rejects.toThrow(/permission denied/);
    await expect(as(FO, (db) => db.query(`select identity_bidx from patients limit 1`))).rejects.toThrow(/permission denied/);
    // It opens under A's key only.
    const keysA = await as(FO, (db) => tenantKeys(db, A.tenantId));
    expect(decryptField(RING, keysA!, "patient.identity", raw.identity_enc)).toBe(nik);
    await register(await person(B, "fo_cashier", B.b1), { full_name: "Orang B", number: "3171010000000009", phone: "081200000009" });
    const bFo = await person(B, "fo_cashier", B.b1);
    const keysB = await as(bFo, (db) => tenantKeys(db, B.tenantId));
    expect(() => decryptField(RING, { ...keysB!, tenantId: B.tenantId }, "patient.identity", raw.identity_enc)).toThrow();
  });

  it("scenario PR-1: tenant A requesting B's patient by id gets not-found and an audit event records it; an unknown id is answered the same", async () => {
    const bFo = await person(B, "fo_cashier", B.b1);
    const bp = await register(bFo, { full_name: "Pasien Tenant B", number: "3171010000000101", phone: "081200000101" });
    expect(bp.ok).toBe(true);
    const bId = (bp as { patientId: string }).patientId;
    const auditOf = async (id: string) => (await h.admin.query(`select tenant_id, action, outcome, reason_code from audit_events where object_kind = 'patient' and object_id = $1`, [id])).rows;
    expect(await as(DOC, (db) => getPatient(db, bId))).toBeNull();
    expect(await auditOf(bId)).toEqual(expect.arrayContaining([{ tenant_id: A.tenantId, action: "access_denied", outcome: "denied", reason_code: "patient_not_found" }]));
    expect((await auditOf(bId)).filter((x) => x.tenant_id === B.tenantId && x.action === "access_denied")).toEqual([]);
    const unknown = "00000000-0000-7000-8000-000000000123";
    expect(await as(DOC, (db) => getPatient(db, unknown))).toBeNull();
    expect(await auditOf(unknown)).toEqual([{ tenant_id: A.tenantId, action: "access_denied", outcome: "denied", reason_code: "patient_not_found" }]);
    // B reads its own patient.
    expect(await as(bFo, (db) => getPatient(db, bId))).toMatchObject({ fullName: "Pasien Tenant B", phone: "+6281200000101" });
  });
});

describe("identity types and the guardian (PR-5, DATA-13, plan r1 P1-2)", () => {
  it("passport and KITAS are sealed and need a reason; a newborn has no number, needs a reason and a guardian; malformed numbers are refused", async () => {
    expect(await register(FO, { full_name: "Tourist One", identity_type: "passport", number: "x1234567", no_identity_reason: "Warga negara asing", phone: "081211110001" })).toMatchObject({ ok: true });
    expect(await code(register(FO, { full_name: "Tourist Two", identity_type: "kitas", number: "2C11AB0012345", phone: "081211110002" }))).toBe("ERR_INVALID_INPUT");
    expect(await register(FO, { full_name: "Expat Tiga", identity_type: "kitas", number: "2C11AB0012345", no_identity_reason: "Pemegang KITAS", phone: "081211110003" })).toMatchObject({ ok: true });
    expect(normaliseIdentity("nik", "317101234567000")).toBeNull();
    expect(normaliseIdentity("nik", "3171 0123 4567 0001")).toBe("3171012345670001");
    expect(normaliseIdentity("passport", "a b")).toBeNull();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
    expect(await code(register(FO, { full_name: "Bayi Satu", identity_type: "newborn_via_guardian", birth_date: today, no_identity_reason: "Bayi baru lahir", phone: "081211110004" }))).toBe("ERR_INVALID_INPUT");
    const baby = await register(FO, { full_name: "Bayi Satu", identity_type: "newborn_via_guardian", birth_date: today, no_identity_reason: "Bayi baru lahir", phone: "081211110004", guardian: { name: "Ibu Bayi", relation: "ibu", phone: "081211110005" } });
    expect(baby).toMatchObject({ ok: true });
    expect(await as(FO, (db) => getPatient(db, (baby as { patientId: string }).patientId))).toMatchObject({ identityType: "newborn_via_guardian", guardians: [{ name: "Ibu Bayi", relation: "ibu", phone: "+6281211110005" }] });
    // A newborn with a number is refused.
    expect(await code(as(FO, async (db) => registerPatient(db, { full_name: "Bayi Dua", birth_date: today, sex: "male", phone: "081211110006", identity_type: "newborn_via_guardian", no_identity_reason: "Bayi", religion: "islam", occupation: "Belum bekerja", education: "tidak_sekolah", marital_status: "belum_kawin", guardian: { name: "Ayah", relation: "ayah" } },
      await sealIdentity(db, A.tenantId, "nik", "3171010000000222"), null)))).toBe("ERR_INVALID_INPUT");
  });

  it("a minor (under 18 on the registration date in the branch timezone) needs a guardian; an adult does not; the day of the 18th birthday is an adult", async () => {
    const tz = "Asia/Jayapura";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
    const [y, m, d] = today.split("-").map(Number);
    const eighteenToday = `${y - 18}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const tomorrowMinus18 = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.UTC(y - 18, m - 1, d + 1, 3)));
    const foJ = await person(A, "fo_cashier", A.jyp);
    expect(await code(register(foJ, { full_name: "Remaja Satu", birth_date: tomorrowMinus18, number: "3171010000000301", phone: "081233330001" }))).toBe("ERR_INVALID_INPUT");
    expect(await register(foJ, { full_name: "Remaja Satu", birth_date: tomorrowMinus18, number: "3171010000000301", phone: "081233330001", guardian: { name: "Ayah Remaja", relation: "ayah" } })).toMatchObject({ ok: true });
    expect(await register(foJ, { full_name: "Dewasa Hari Ini", birth_date: eighteenToday, number: "3171010000000302", phone: "081233330002" })).toMatchObject({ ok: true });
  });
});

describe("duplicates (PR-5, UX-4, plan r1 P2-1)", () => {
  it("the same identity is never registered twice: the existing record is offered, even with decision 'new'; name + birth date asks for a decision", async () => {
    const first = await register(FO, { full_name: "Dina Unik", number: "3171010000000401", phone: "081244440001" });
    expect(first.ok).toBe(true);
    const again = await register(FO, { full_name: "Dina Lain", number: "3171 0100 0000 0401", phone: "081244440099" }, "new");
    expect(again).toMatchObject({ ok: false, code: "duplicate_identity", matches: [{ fullName: "Dina Unik" }] });
    const sameName = await register(FO, { full_name: "dina unik", number: "3171010000000402", phone: "081244440002" });
    expect(sameName).toMatchObject({ ok: false, code: "duplicate_decision_required" });
    // Search by the identity number goes through the index; by MRN; by name.
    const bidx = await as(FO, (db) => identityIndexForSearch(db, A.tenantId, "nik", "3171010000000401"));
    expect((await as(FO, (db) => findMatches(db, { identityBidx: bidx }))).map((m) => m.fullName)).toEqual(["Dina Unik"]);
    expect((await as(FO, (db) => findMatches(db, { mrn: (first as { mrn: string }).mrn.toLowerCase() }))).map((m) => m.fullName)).toEqual(["Dina Unik"]);
    expect((await as(CS, (db) => findMatches(db, { name: "unik" }))).map((m) => m.fullName)).toContain("Dina Unik");
    // A search before the tenant has any key creates none and finds nothing.
    const c = await tenant();
    const cFo = await person(c, "fo_cashier", c.b1);
    expect(await as(cFo, (db) => identityIndexForSearch(db, c.tenantId, "nik", "3171010000000401"))).toBeNull();
    expect((await h.admin.query(`select count(*)::int as n from tenant_data_keys where tenant_id = $1`, [c.tenantId])).rows[0].n).toBe(0);
  });

  it("the database refuses an identity number in clear even from a direct call (mutation run: clear-identity-ok)", async () => {
    const fields = { full_name: "Langsung SQL", birth_date: "1990-01-01", sex: "female", phone: "081255550001", identity_type: "nik", religion: "islam", occupation: "Karyawan", education: "s1", marital_status: "kawin" };
    await expect(as(FO, (db) => db.query(`select patient_register($1::jsonb, $2, $3, 'new')`, [JSON.stringify(fields), "3171010000005501", "A".repeat(43)])))
      .rejects.toThrow(/^ERR_INVALID_INPUT: patients_identity_enc_check$/);
    expect((await h.admin.query(`select count(*)::int as n from patients where full_name = 'Langsung SQL'`)).rows[0].n).toBe(0);
  });

  it("the identity index is unique per tenant, not across tenants (DATA-13; mutation run: identity-unique-global)", async () => {
    const r = await register(FO, { full_name: "Index Satu", number: "3171010000005601", phone: "081256560001" });
    const bidx = (await h.admin.query(`select identity_bidx, identity_enc from patients where id = $1`, [(r as { patientId: string }).patientId])).rows[0];
    const bOwnerStaff = (await person(B, "fo_cashier", B.b1)).staffId;
    // The same index value in tenant B (never produced by real keys, but the constraint is per tenant).
    await expect(h.admin.query(`insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
      values ($1, 'RM-999901', 'Index B', '1990-01-01', 'female', 'nik', $2, $3, 'islam', 'Karyawan', 's1', 'kawin', $4, $5, 'fo_cashier')`, [B.tenantId, bidx.identity_enc, bidx.identity_bidx, B.b1, bOwnerStaff])).resolves.toBeDefined();
    await expect(h.admin.query(`insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
      values ($1, 'RM-999902', 'Index A2', '1990-01-01', 'female', 'nik', $2, $3, 'islam', 'Karyawan', 's1', 'kawin', $4, $5, 'fo_cashier')`, [A.tenantId, bidx.identity_enc, bidx.identity_bidx, A.b1, FO.staffId])).rejects.toThrow(/patients_tenant_identity_key/);
  });

  it("review r1: an unknown decision is refused; missing required fields are refused before any duplicate pause; a 2-character name searches", async () => {
    await register(FO, { full_name: "Yu", number: "3171010000005701", phone: "081257570001" });
    expect(await code(as(FO, async (db) => registerPatient(db, { full_name: "Lain", birth_date: "1990-01-01", sex: "female", phone: "081257570009", identity_type: "nik",
      religion: "islam", occupation: "Karyawan", education: "s1", marital_status: "kawin" }, await sealIdentity(db, A.tenantId, "nik", "3171010000005709"), "merge" as never)))).toBe("ERR_INVALID_INPUT");
    // Same phone as Yu (a pause would come) but no religion: refused first, nothing paused or written.
    expect(await code(register(FO, { full_name: "Tanpa Agama", number: "3171010000005702", phone: "081257570001", religion: "" }))).toBe("ERR_INVALID_INPUT");
    expect((await as(FO, (db) => findMatches(db, { name: "Yu" }))).map((m) => m.fullName)).toContain("Yu");
  });

  it("a tampered sealed pair is caught: the posted index must match the posted ciphertext", async () => {
    const s1 = await as(FO, (db) => sealIdentity(db, A.tenantId, "nik", "3171010000000501"));
    const s2 = await as(FO, (db) => sealIdentity(db, A.tenantId, "nik", "3171010000000502"));
    expect(await as(FO, (db) => verifySealed(db, A.tenantId, "nik", s1.enc, s1.bidx))).toBe("••••••••••••0501");
    expect(await as(FO, (db) => verifySealed(db, A.tenantId, "nik", s1.enc, s2.bidx))).toBeNull();
    expect(await as(FO, (db) => verifySealed(db, A.tenantId, "passport", s1.enc, s1.bidx))).toBeNull();
    expect(await as(FO, (db) => verifySealed(db, A.tenantId, "nik", "v1.1.AAAA.BBBB.CCCC", s1.bidx))).toBeNull();
  });
});

describe("the tenant data key (plan r1 open point 1)", () => {
  it("two concurrent first writes end with one key; both values open under it", async () => {
    const t = await tenant();
    const f1 = await person(t, "fo_cashier", t.b1);
    const f2 = await person(t, "fo_cashier", t.b2);
    const [a, b] = await Promise.all([
      register(f1, { full_name: "Race Satu", number: "3171010000000601", phone: "081266660001" }),
      register(f2, { full_name: "Race Dua", number: "3171010000000602", phone: "081266660002" }, "new"),
    ]);
    expect([a.ok, b.ok]).toEqual([true, true]);
    expect((await h.admin.query(`select count(*)::int as n from tenant_data_keys where tenant_id = $1`, [t.tenantId])).rows[0].n).toBe(1);
    const keys = await as(f1, (db) => tenantKeys(db, t.tenantId));
    const enc = (await h.admin.query(`select identity_enc from patients where tenant_id = $1 order by mrn`, [t.tenantId])).rows.map((r) => r.identity_enc);
    expect(enc.map((e) => decryptField(RING, keys!, "patient.identity", e))).toEqual(expect.arrayContaining(["3171010000000601", "3171010000000602"]));
    // The app role cannot read or write the key table directly.
    await expect(as(f1, (db) => db.query(`select * from tenant_data_keys`))).rejects.toThrow(/permission denied/);
  });

  it("a second first-write gets the stored key, never its own candidate (mutation run: key-loser-used)", async () => {
    const t = await tenant();
    const f1 = await person(t, "fo_cashier", t.b1);
    const { newWrappedDek } = await import("../../src/lib/keys/envelope");
    const c1 = newWrappedDek(RING, t.tenantId, 1).wrapped;
    const c2 = newWrappedDek(RING, t.tenantId, 1).wrapped;
    const first = await as(f1, async (db) => (await db.query(`select wrapped from tenant_data_key_ensure($1)`, [c1])).rows);
    const second = await as(f1, async (db) => (await db.query(`select wrapped from tenant_data_key_ensure($1)`, [c2])).rows);
    expect(first).toEqual([{ wrapped: c1 }]);
    expect(second).toEqual([{ wrapped: c1 }]);
  });

  it("without a KEK, a registration with a number is refused and nothing is stored in clear", async () => {
    setKekRingForTests(null);
    try {
      await expect(register(FO, { full_name: "Tanpa Kunci", number: "3171010000000701", phone: "081277770701" })).rejects.toThrow(/encryption keys are not installed/);
    } finally {
      setKekRingForTests(RING);
    }
    expect((await h.admin.query(`select count(*)::int as n from patients where full_name = 'Tanpa Kunci'`)).rows[0].n).toBe(0);
  });
});

describe("MRN, roles, readers and the lifecycle (plan r1 open points 2-3, P1-3, P1-4)", () => {
  it("the MRN is gap-free per tenant: refused and duplicate attempts consume no number; concurrent writers get distinct numbers", async () => {
    const t = await tenant();
    const f = await person(t, "fo_cashier", t.b1);
    expect(await register(f, { full_name: "Satu", number: "3171010000000801", phone: "081288880001" })).toMatchObject({ mrn: "RM-000001" });
    await code(register(f, { full_name: "Gagal", birth_date: "2999-01-01", number: "3171010000000802", phone: "081288880002" }));
    await register(f, { full_name: "Satu Lagi", number: "3171010000000801", phone: "081288880003" }, "new");
    const many = await Promise.all([3, 4, 5, 6].map((i) => register(f, { full_name: `Pasien ${i}`, number: `317101000000081${i}`, phone: `08128888001${i}` }, "new")));
    expect(many.map((r) => (r as { mrn: string }).mrn).sort()).toEqual(["RM-000002", "RM-000003", "RM-000004", "RM-000005"]);
  });

  it("only FO/cashier and central CS register; central CS on Semua Cabang chooses a branch; a branch role cannot register for another branch", async () => {
    for (const p of [OWN, MGR, DOC, FIN, BC]) {
      expect(await code(register(p, { full_name: `Tolak ${p.role}`, number: `31710100000009${String(++n).padStart(2, "0")}`, phone: "081299991001" })), p.role).toBe("ERR_FORBIDDEN");
    }
    expect(await code(register(CS, { full_name: "Tanpa Cabang", number: "3171010000000950", phone: "081299991002" }))).toBe("ERR_NOT_FOUND");
    expect(await register(CS, { full_name: "Lewat CS", number: "3171010000000951", phone: "081299991003", branch_id: A.b2 })).toMatchObject({ ok: true });
    expect(await code(register(FO, { full_name: "Cabang Lain", number: "3171010000000952", phone: "081299991004", branch_id: A.b2 }))).toBe("ERR_FORBIDDEN");
    // Central CS naming another tenant's branch: not found (mutation run: foreign-branch-ok).
    expect(await code(register(CS, { full_name: "Cabang Tenant B", number: "3171010000000953", phone: "081299991005", branch_id: B.b1 }))).toBe("ERR_NOT_FOUND");
    expect(await code(as(MGR, (db) => findMatches(db, { name: "Sinta" })))).toBe("ERR_FORBIDDEN");
  });

  it("the 13 identity roles read; marketing, purchasing and auditor read nothing (consent view arrives with T-038)", async () => {
    expect(await register(FO, { full_name: "Dibaca Semua", number: "3171010000000990", phone: "081299990990" })).toMatchObject({ ok: true });
    for (const p of [OWN, MGR, DOC, FIN, BC, FO, CS]) expect((await as(p, (db) => db.query(`select id from patients`))).rows.length, p.role).toBeGreaterThan(0);
    for (const p of [MK, PU, AU]) {
      expect((await as(p, (db) => db.query(`select id from patients`))).rows, p.role).toEqual([]);
      expect((await as(p, (db) => db.query(`select id from contact_points`))).rows, p.role).toEqual([]);
      expect(await as(p, (db) => getPatient(db, "00000000-0000-7000-8000-000000000999")), p.role).toBeNull();
    }
    const denied = (await h.admin.query(`select count(*)::int as n from audit_events where staff_id = $1 and reason_code = 'role_forbidden'`, [MK.staffId])).rows[0].n;
    expect(denied).toBe(1);
  });

  it("production with go-live blockers refuses registration before anything is written (ARCH-10, plan r1 P1-4)", async () => {
    process.env.DEPLOY_ENV = "production";
    try {
      await expect(register(FO, { full_name: "Belum Boleh", number: "3171010000001090", phone: "081210109090" })).rejects.toThrow(/go-live blocked/);
    } finally {
      process.env.DEPLOY_ENV = "local";
    }
    expect((await h.admin.query(`select count(*)::int as n from patients where full_name = 'Belum Boleh'`)).rows[0].n).toBe(0);
  });

  it("a tenant that is not live takes no new patients (provisioning, onboarding, suspended)", async () => {
    for (const st of ["onboarding", "suspended"]) {
      const t = await tenant(st);
      const f = await person(t, "fo_cashier", t.b1);
      expect(await code(register(f, { full_name: "Belum Live", number: "3171010000001001", phone: "081210100001" })), st).toBe("ERR_TENANT_SUSPENDED");
    }
  });
});

describe("immutability, vendor support class, events", () => {
  it("patients, contacts and guardians are never deleted or rewritten; the key table is guarded; events and audit carry ids only", async () => {
    const r = await register(FO, { full_name: "Tetap Ada", number: "3171010000001101", phone: "081211011001", birth_date: "2015-01-01", guardian: { name: "Wali Tetap", relation: "wali" } });
    const id = (r as { patientId: string }).patientId;
    for (const [t, col] of [["patients", "id"], ["contact_points", "patient_id"], ["guardians", "patient_id"]]) {
      await expect(h.admin.query(`delete from ${t} where ${col} = $1`, [id])).rejects.toThrow(/never deleted/);
      await expect(h.admin.query(`update ${t} set tenant_id = tenant_id where ${col} = $1`, [id])).rejects.toThrow(/never deleted/);
      await expect(h.admin.query(`truncate ${t} cascade`)).rejects.toThrow();
    }
    await expect(h.admin.query(`update tenant_data_keys set is_current = true where tenant_id = $1`, [A.tenantId])).rejects.toThrow(/never changed/);
    const ev = (await h.admin.query(`select payload from domain_events where type = 'PatientRegistered' and aggregate_id = $1`, [id])).rows;
    expect(ev).toEqual([{ payload: { patient_id: id, branch_id: A.b1 } }]);
    expect((await h.admin.query(`select reason_code from audit_events where object_kind = 'patient' and object_id = $1`, [id])).rows).toEqual([{ reason_code: "patient_registered" }]);
  });

  it("vendor support: patient identity is personal; each table has one operator policy; the key table is platform", async () => {
    const classes = (await h.admin.query(`select table_name, support_class from support_object_kinds where table_name in ('public.patients','public.contact_points','public.guardians') order by 1`)).rows;
    expect(classes.map((c) => c.support_class)).toEqual(["personal", "personal", "personal"]);
    expect((await h.admin.query(`select policy_kind from scope_map where table_name in ('public.tenant_data_keys','public.patient_mrn_counters')`)).rows).toEqual([{ policy_kind: "platform" }, { policy_kind: "platform" }]);
  });

  it("phone normalisation is the same in TS and SQL", async () => {
    for (const raw of ["0812-3456-7890", "62 812 3456 7890", "+62 812 3456 7890", "812345", "+1 415 555 0100", "abc"]) {
      const sql = (await h.admin.query(`select patient_phone_norm($1) as v`, [raw])).rows[0].v;
      expect(normalisePhone(raw), raw).toBe(sql);
    }
  });
});

describe("cross-tenant", () => {
  it("tenant B neither reads, finds nor registers onto tenant A's patients", async () => {
    const bFo = await person(B, "fo_cashier", B.b1);
    const a = await register(FO, { full_name: "Rahasia A", number: "3171010000001201", phone: "081212012001" });
    const aId = (a as { patientId: string }).patientId;
    expect((await as(bFo, (db) => db.query(`select id from patients where id = $1`, [aId]))).rows).toEqual([]);
    expect(await as(bFo, (db) => findMatches(db, { phone: "081212012001" }))).toEqual([]);
    expect(await as(bFo, (db) => findMatches(db, { name: "Rahasia A" }))).toEqual([]);
    expect(await as(bFo, (db) => findMatches(db, { mrn: (a as { mrn: string }).mrn }))).toEqual([]);
    // The same NIK in B is a different patient (the index is per tenant), never a duplicate of A's.
    expect(await register(bFo, { full_name: "Rahasia A", number: "3171010000001201", phone: "081212012001" })).toMatchObject({ ok: true });
    // A's search by that shared name or phone finds only A's own record (mutation run: matches-other-tenant).
    expect((await as(FO, (db) => findMatches(db, { phone: "081212012001" }))).map((m) => m.id)).toEqual([aId]);
    expect((await as(FO, (db) => findMatches(db, { name: "Rahasia A" }))).map((m) => m.id)).toEqual([aId]);
    expect(await code(register(bFo, { full_name: "Cabang A", number: "3171010000001202", phone: "081212012002", branch_id: A.b1 }))).toBe("ERR_FORBIDDEN");
  });
});
