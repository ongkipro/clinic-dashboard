// T-040 Done-when: the role projections of scenario PR-49 pass (the cashier sees no clinical tabs; a
// projection test per role). Plus: the loader on a real database per role (the database decides who reads
// a patient; the projection decides the sections), cross-tenant and unknown ids, and the consent actions
// the profile offers (recorders only; the care notice is not withdrawable).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROLES, type Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { grantConsent, publishConsentText, withdrawConsent } from "../../src/modules/patients/consents/consents";
import { CLINICAL_SECTIONS, loadProfile, profileSections, withdrawFromProfile } from "../../src/modules/patients/profile";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local"; // synthetic data (MIG-2); the production gate is T-037's, reused here

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "purchasing", "marketing", "central_cs", "auditor"];

async function tenant(state = "live"): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ($1) returning id`, [state])).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Profil Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("C1"), b2: await br("C2") };
}
async function person(t: T, role: Role, branch?: string): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`prf${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Profil ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  const b = TENANT_WIDE.includes(role) ? undefined : branch ?? t.b1;
  if (b) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: b };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const key = () => crypto.randomUUID();

async function patient(t: T, name = "Pasien Profil", phone = "+6281200000000"): Promise<string> {
  const id = (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
     select $1, 'RM-' || lpad((count(*) + 1)::text, 6, '0'), $2, '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture sintetis', 'islam', 'Karyawan', 's1', 'kawin', $3,
            (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier' from patients where tenant_id = $1 returning id`,
    [t.tenantId, name, t.b1],
  )).rows[0].id as string;
  await h.admin.query(`insert into contact_points (tenant_id, patient_id, kind, value) values ($1, $2, 'phone', $3)`, [t.tenantId, id, phone]);
  return id;
}

// The expected projection per role (07:41-50, 19:76): identity sections for the 13 readers, clinical
// sections for clinical roles only, nothing for marketing, purchasing and auditor.
const BASE = ["ringkasan", "wali", "persetujuan", "kunjungan", "paket-saldo"];
const EXPECTED: Record<Role, string[]> = {
  owner: BASE, admin_pusat: BASE, manager: BASE, fo_cashier: BASE, central_cs: BASE, finance: BASE,
  facility_head: [...BASE, "rekam-medis", "foto", "resep"],
  records_officer: [...BASE, "rekam-medis", "foto", "resep"],
  doctor: [...BASE, "rekam-medis", "foto", "resep"],
  nurse: [...BASE, "rekam-medis", "foto"],
  therapist: [...BASE, "rekam-medis", "foto"],
  bc: [...BASE, "foto"],
  pharmacist: [...BASE, "resep"],
  marketing: [], purchasing: [], auditor: [],
};
const NON_CLINICAL: Role[] = ["owner", "admin_pusat", "manager", "fo_cashier", "central_cs", "finance"];

let A: T;
let B: T;
const P_: Partial<Record<Role, P>> = {};
let BFO: P;
let careText: string;
let waText: string;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  for (const r of ROLES) P_[r] = await person(A, r);
  BFO = await person(B, "fo_cashier");
  careText = (await as(P_.owner!, (db) => publishConsentText(db, { purpose: "care_notice", body: "Teks layanan versi 1" }))).id;
  waText = (await as(P_.owner!, (db) => publishConsentText(db, { purpose: "marketing_wa", body: "Teks WA versi 1" }))).id;
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

describe("scenario PR-49, role projections", () => {
  it("each of the 16 roles gets exactly its sections; the cashier sees no clinical tab", () => {
    expect(ROLES.length).toBe(16);
    for (const r of ROLES) expect(profileSections(r), r).toEqual(EXPECTED[r]);
    for (const r of NON_CLINICAL) expect(profileSections(r).filter((s) => (CLINICAL_SECTIONS as readonly string[]).includes(s)), r).toEqual([]);
    expect(profileSections("fo_cashier")).not.toContain("rekam-medis");
  });

  it("the loader, per role on a real database: readers get the patient and the role's sections; the rest nothing", async () => {
    const pt = await patient(A);
    await h.admin.query(`insert into guardians (tenant_id, patient_id, guardian_name, relation, phone) values ($1, $2, 'Wali Sintetis', 'ibu', '+6281211110000')`, [A.tenantId, pt]);
    for (const r of ROLES) {
      const p = await as(P_[r]!, (db) => loadProfile(db, r, pt));
      if (EXPECTED[r].length === 0) {
        expect(p, r).toBeNull();
        // The database refused and audited it (plan r1 P1-1), not only the projection.
        const au = await h.admin.query(`select count(*)::int as n from audit_events where object_id = $1 and staff_id = $2 and reason_code = 'role_forbidden'`, [pt, P_[r]!.staffId]);
        expect(au.rows[0].n, r).toBe(1);
        continue;
      }
      expect(p?.patient.id, r).toBe(pt);
      expect(p?.sections, r).toEqual(EXPECTED[r]);
      expect(p?.patient.guardians.map((g) => g.name), r).toEqual(["Wali Sintetis"]);
      expect(p?.canRecordConsent, r).toBe(["fo_cashier", "central_cs", "bc", "doctor", "records_officer", "manager"].includes(r));
    }
  });

  it("another tenant's patient and an unknown id are not found (and audited), never an error", async () => {
    const pt = await patient(A);
    expect(await as(BFO, (db) => loadProfile(db, "fo_cashier", pt))).toBeNull();
    expect(await as(P_.fo_cashier!, (db) => loadProfile(db, "fo_cashier", crypto.randomUUID()))).toBeNull();
    expect(await as(P_.fo_cashier!, (db) => loadProfile(db, "fo_cashier", "bukan-uuid"))).toBeNull();
    const audited = await h.admin.query(`select count(*)::int as n from audit_events where tenant_id = $1 and object_id = $2 and reason_code = 'patient_not_found'`, [B.tenantId, pt]);
    expect(audited.rows[0].n).toBe(1);
  });
});

describe("consents on the profile", () => {
  it("a recorder grants and withdraws; the profile shows both; the care notice is not withdrawable; finance cannot record", async () => {
    const pt = await patient(A);
    const fo = P_.fo_cashier!;
    const g1 = await as(fo, (db) => grantConsent(db, key(), { patientId: pt, purpose: "care_notice", textId: careText, channel: "in_person" }));
    const g2 = await as(fo, (db) => grantConsent(db, key(), { patientId: pt, purpose: "marketing_wa", textId: waText, channel: "in_person" }));
    expect(g1.ok && g2.ok).toBe(true);
    if (!g1.ok || !g2.ok) return;
    expect(await as(fo, (db) => withdrawConsent(db, key(), { consentId: g1.consentId, channel: "in_person", reason: "Tidak mau" }))).toMatchObject({ ok: false, code: "not_withdrawable" });
    expect(await as(fo, (db) => withdrawConsent(db, key(), { consentId: g2.consentId, channel: "whatsapp", reason: "Tidak mau promo" }))).toMatchObject({ ok: true });
    const p = await as(fo, (db) => loadProfile(db, "fo_cashier", pt));
    expect(p?.consents.map((c) => [c.purpose, c.withdrawnAt === null])).toEqual(expect.arrayContaining([["care_notice", true], ["marketing_wa", false]]));
    expect(await code(as(P_.finance!, (db) => grantConsent(db, key(), { patientId: pt, purpose: "marketing_wa", textId: waText, channel: "in_person" })))).toBe("ERR_FORBIDDEN");
    const fin = await as(P_.finance!, (db) => loadProfile(db, "finance", pt));
    expect(fin?.canRecordConsent).toBe(false);
    // A withdrawal closes its row; the history keeps both rows.
    expect(fin?.consents.length).toBe(2);
  });

  it("a withdrawal through a profile must name that patient's consent (plan r1 P1-2)", async () => {
    const a = await patient(A, "Pasien A");
    const b = await patient(A, "Pasien B");
    const fo = P_.fo_cashier!;
    const gb = await as(fo, (db) => grantConsent(db, key(), { patientId: b, purpose: "marketing_wa", textId: waText, channel: "in_person" }));
    if (!gb.ok) throw new Error("grant");
    expect(await code(as(fo, (db) => withdrawFromProfile(db, key(), { patientId: a, consentId: gb.consentId, channel: "phone", reason: "Silang pasien" })))).toBe("ERR_NOT_FOUND");
    expect(await as(fo, (db) => withdrawFromProfile(db, key(), { patientId: b, consentId: gb.consentId, channel: "phone", reason: "Pasien sendiri" }))).toMatchObject({ ok: true });
  });
});

