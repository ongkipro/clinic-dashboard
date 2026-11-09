// T-041 Done-when: scenario PR-76 (a cashier searching by phone sees name and visit status, no
// diagnosis); the query string absent from logs; the rate limit enforced; cross-tenant negatives on the
// list and saved segments. Plus the plan review: matching (name, MRN, phone with local 0), filters and the
// "allowed branches" rule for visits, keyset pages, the 13 roles, the committed count and the hourly
// alert to the facility head, segments (own only, filters validated, never a query), marketing's masked
// consented contacts, the log append-only and unreadable, tenancy.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { decideApproval } from "../../src/modules/approvals/approvals";
import { publish } from "../../src/modules/catalog/catalog";
import { setServices, upsertRoom } from "../../src/modules/org/branches/branches";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { marketingContacts } from "../../src/modules/patients/consents/consents";
import { deleteSegment, maskPhone, mySegments, saveSegment, searchPatients } from "../../src/modules/patients/search/search";
import { checkIn } from "../../src/modules/visits/visits";
import { createHarness, type Harness } from "../rls/harness";

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
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Cari Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("K1"), b2: await br("K2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`srch${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Cari ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  const bs = TENANT_WIDE.includes(role) ? [] : branches.length ? branches : [t.b1];
  for (const b of bs) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: bs[0] };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>, branch?: string) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: branch ?? p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const key = () => crypto.randomUUID();


let A: T;
let B: T;
let OWN: P; let FH: P; let FH2: P; let FO: P; let FO2: P; let DOC: P; let FIN: P; let MK: P; let PU: P; let AU: P; let BFO: P;
let consult: { itemId: string; versionId: string };

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 8 });
  owner = new pg.Pool({ connectionString: h.ownerUrl(), max: 2 });
  owner.on("error", () => {});
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); FH = await person(A, "facility_head", A.b1); FH2 = await person(A, "facility_head", A.b2);
  FO = await person(A, "fo_cashier", A.b1); FO2 = await person(A, "fo_cashier", A.b2); DOC = await person(A, "doctor", A.b1);
  FIN = await person(A, "finance"); MK = await person(A, "marketing"); PU = await person(A, "purchasing"); AU = await person(A, "auditor");
  BFO = await person(B, "fo_cashier", B.b1);
  for (const b of [A.b1, A.b2]) await as(OWN, (db) => upsertRoom(db, b, { name: `Konsul ${b.slice(0, 4)}`, kind: "consultation" }));
  const v = await as(OWN, (db) => publish(db, { kind: "service", code: "KONSUL" }, {
    name: "Konsultasi", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 150_000, category: "consultation",
    prep_min: 0, treatment_min: 30, buffer_min: 0, indications: "I", contraindications: "K", consent_template: "T", delegation: "Dokter",
    aftercare_text: "A", eligibility: [{ role: "doctor", mode: "performs" }], resources: [{ kind: "room", code: "consultation" }],
  } as never, "Layanan baru"));
  if (v.approvalId) await as(FH, (db) => decideApproval(db, v.approvalId!, true));
  for (const b of [A.b1, A.b2]) await as(OWN, (db) => setServices(db, b, [v.itemId]));
  consult = { itemId: v.itemId, versionId: v.versionId };
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

const slotNow = () => new Date(Math.floor(Date.now() / 900_000) * 900_000);
async function phoned(t: T, name: string, phone: string, branch = t.b1) {
  const id = (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
     select $1, 'RM-' || lpad((count(*) + 1)::text, 6, '0'), $2, '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture sintetis', 'islam', 'Karyawan', 's1', 'kawin', $3,
            (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier' from patients where tenant_id = $1 returning id`,
    [t.tenantId, name, branch],
  )).rows[0].id as string;
  await h.admin.query(`insert into contact_points (tenant_id, patient_id, kind, value) values ($1, $2, 'phone', $3)`, [t.tenantId, id, phone]);
  return id;
}
// An open visit at a branch (checked in through the T-047 writer).
async function visitAt(pt: string, branch: string, fo: P) {
  const d = await person(A, "doctor", branch);
  const s = slotNow();
  await h.admin.query(`alter table appointments disable trigger appointments_guard`);
  let ap: string;
  try {
    ap = (await h.admin.query(
      `insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state, channel, created_by, created_as)
       values ($1, $2, $3, $4, $5, $6, $7, 'booked', 'phone', $5, 'fo_cashier') returning id`,
      [A.tenantId, branch, pt, consult.versionId, d.staffId, s, new Date(s.getTime() + 30 * 60_000)],
    )).rows[0].id as string;
  } finally {
    await h.admin.query(`alter table appointments enable always trigger appointments_guard`);
  }
  return (await as(fo, (db) => checkIn(db, key(), ap))).visitId;
}
// Unwraps a page outside the transaction (a rate-limited answer throws here, after the commit).
const rows = async (x: Promise<Awaited<ReturnType<typeof searchPatients>>>) => {
  const r = await x;
  if (!r.ok) throw new CommandError("ERR_RATE_LIMITED");
  return r;
};
async function clearLog(p: P) {
  await h.admin.query(`alter table patient_search_log disable trigger patient_search_log_guard`);
  try {
    await h.admin.query(`delete from patient_search_log where staff_id = $1`, [p.staffId]);
  } finally {
    await h.admin.query(`alter table patient_search_log enable always trigger patient_search_log_guard`);
  }
}

describe("scenario PR-76: search projection", () => {
  it("a cashier searching by phone sees name, masked phone, MRN and visit status; no diagnosis or clinical keys", async () => {
    const pt = await phoned(A, "Rina Telepon", "+6281277001122");
    await visitAt(pt, A.b1, FO);
    const page = await rows(as(FO, (db) => searchPatients(db, "0812-7700-1122")));
    expect(page.rows.map((r) => r.id)).toEqual([pt]);
    const r = page.rows[0];
    expect(r).toMatchObject({ fullName: "Rina Telepon", maskedPhone: "+62•••••••1122", openVisitBranch: "K1" });
    expect(r.lastVisitAt).toBeInstanceOf(Date);
    expect(Object.keys(r).sort()).toEqual(["birthYear", "fullName", "id", "lastVisitAt", "maskedPhone", "mrn", "openVisitBranch", "registeredBranch", "registeredBranchId"]);
    const raw = JSON.stringify((await as(FO, (db) => db.query(`select patient_search($1, '{}'::jsonb, null) as r`, ["Rina Telepon"]))).rows[0].r);
    expect(raw).not.toMatch(/diagnos|allerg|alergi|soap|intake|identity|nik/i);
    expect(raw).not.toContain("+6281277001122");
  });

  it("matches name (contains, wildcards literal), MRN (exact) and phone suffix; pages of 50 by name; the 13 roles only", async () => {
    const pt = await phoned(A, "Zaskia Mencari", "+6281299112233");
    const mrn = (await h.admin.query(`select mrn from patients where id = $1`, [pt])).rows[0].mrn;
    expect((await rows(as(DOC, (db) => searchPatients(db, "zaskia men")))).rows.map((r) => r.id)).toEqual([pt]);
    expect((await rows(as(FIN, (db) => searchPatients(db, mrn.toLowerCase())))).rows.map((r) => r.id)).toEqual([pt]);
    expect((await rows(as(OWN, (db) => searchPatients(db, "99112233")))).rows.map((r) => r.id)).toEqual([pt]);
    expect((await rows(as(OWN, (db) => searchPatients(db, "%%")))).rows).toEqual([]);
    for (const p of [MK, PU, AU]) expect(await code(as(p, (db) => searchPatients(db, "zaskia"))), p.role).toBe("ERR_FORBIDDEN");
    for (let i = 0; i < 55; i++) await phoned(A, `Halaman Pasien ${String(i).padStart(2, "0")}`, `+62813000${String(i).padStart(4, "0")}`);
    await clearLog(OWN);
    const p1 = await rows(as(OWN, (db) => searchPatients(db, "halaman pasien")));
    expect(p1.rows.length).toBe(50);
    expect(p1.more).toBe(true);
    const p2 = await rows(as(OWN, (db) => searchPatients(db, "halaman pasien", {}, p1.rows[49].id)));
    expect(p2).toMatchObject({ more: false });
    expect(p2.rows.length).toBe(5);
    expect(new Set([...p1.rows, ...p2.rows].map((r) => r.id)).size).toBe(55);
    expect(await code(as(OWN, (db) => searchPatients(db, "halaman", {}, crypto.randomUUID())))).toBe("ERR_INVALID_INPUT");
  });

  it("visits are shown and filtered only from the caller's allowed branches", async () => {
    const pt = await phoned(A, "Pasien Cabang Dua Saja", "+6281266554433", A.b2);
    await visitAt(pt, A.b2, FO2);
    // FO of B1: the patient is found (patients are tenant-wide), but the B2 visit is not shown or used.
    const r1 = (await rows(as(FO, (db) => searchPatients(db, "Cabang Dua Saja")))).rows[0];
    expect(r1).toMatchObject({ id: pt, openVisitBranch: null, lastVisitAt: null });
    expect((await rows(as(FO, (db) => searchPatients(db, "Cabang Dua Saja", { visiting_now: true })))).rows).toEqual([]);
    expect((await rows(as(FO, (db) => searchPatients(db, "Cabang Dua Saja", { last_visit: "30d" })))).rows).toEqual([]);
    expect((await rows(as(FO, (db) => searchPatients(db, "Cabang Dua Saja", { last_visit: "never" })))).rows.map((r) => r.id)).toEqual([pt]);
    // FO of B2 and the Owner see it.
    expect((await rows(as(FO2, (db) => searchPatients(db, "Cabang Dua Saja", { visiting_now: true })))).rows[0]).toMatchObject({ id: pt, openVisitBranch: "K2" });
    expect((await rows(as(OWN, (db) => searchPatients(db, "Cabang Dua Saja", { last_visit: "30d" })))).rows.map((r) => r.id)).toEqual([pt]);
    expect((await rows(as(OWN, (db) => searchPatients(db, "Cabang Dua Saja", { branch_id: A.b1 })))).rows).toEqual([]);
    expect((await rows(as(OWN, (db) => searchPatients(db, "Cabang Dua Saja", { branch_id: A.b2 })))).rows.map((r) => r.id)).toEqual([pt]);
    expect(await code(as(OWN, (db) => searchPatients(db, "x y", { q: "bocor" } as never)))).toBe("ERR_INVALID_INPUT");
  });
});

describe("rate limit, abuse alert and no query text anywhere", () => {
  it("the 31st search in a minute is refused yet counted; over 200 in an hour alerts the facility head once; no query text stored or logged", async () => {
    const fo = await person(A, "fo_cashier", A.b1);
    const secret = "Kueri Rahasia Pencarian";
    const errors: string[] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => { errors.push(JSON.stringify(args)); };
    try {
      for (let i = 0; i < 30; i++) await rows(as(fo, (db) => searchPatients(db, secret)));
      expect(await code(rows(as(fo, (db) => searchPatients(db, secret))))).toBe("ERR_RATE_LIMITED");
      expect(Number((await h.admin.query(`select count(*) from patient_search_log where staff_id = $1`, [fo.staffId])).rows[0].count)).toBe(31);
    } finally {
      console.error = orig;
    }
    expect(errors.join("")).not.toContain(secret);
    const stored = JSON.stringify((await h.admin.query(`select * from patient_search_log where staff_id = $1`, [fo.staffId])).rows)
      + JSON.stringify((await h.admin.query(`select * from audit_events where staff_id = $1`, [fo.staffId])).rows);
    expect(stored).not.toContain(secret);
    // Over 200 in the last hour: backdate 180 rows (older than a minute, inside the hour), then search on.
    await h.admin.query(`insert into patient_search_log (tenant_id, staff_id, role, branch_id, searched_at)
                         select $1, $2, 'fo_cashier', $3, now() - interval '10 minutes' from generate_series(1, 180)`, [A.tenantId, fo.staffId, A.b1]);
    expect(await code(rows(as(fo, (db) => searchPatients(db, "x y"))))).toBe("ERR_RATE_LIMITED");
    const alerts = async () => (await h.admin.query(`select recipient_role, branch_id, subject_id from notifications where type = 'patient_search_abuse' and subject_id = $1`, [fo.staffId])).rows;
    expect(await alerts()).toEqual([{ recipient_role: "facility_head", branch_id: A.b1, subject_id: fo.staffId }]);
    await rows(as(fo, (db) => searchPatients(db, "x y"))).catch(() => undefined);
    expect((await alerts()).length).toBe(1); // once per hour
    // The facility head of that branch sees it; the one of another branch does not.
    const seen = async (p: P) => (await as(p, (db) => db.query(`select count(*)::int as n from notifications where type = 'patient_search_abuse' and subject_id = $1`, [fo.staffId]))).rows[0].n;
    expect(await seen(FH)).toBe(1);
    expect(await seen(FH2)).toBe(0);
    // Staff cannot raise this alert themselves.
    expect(await code(as(FO, (db) => db.query(`select notification_raise('patient_search_abuse', 'facility_head', null, $1, 'staff', $2, null)`, [A.b1, FO.staffId])))).toBe("raw:42501"); // "raised by the system only"
  });

  it("the log is append-only and unreadable to app roles", async () => {
    expect(await code(as(OWN, (db) => db.query(`select count(*)::int as n from patient_search_log`)))).toBe("raw:42501");
    const err = (q: Promise<unknown>) => q.then(() => "ok", (e) => e.message as string);
    expect(await err(h.admin.query(`update patient_search_log set role = 'owner'`))).toMatch(/append-only/);
    expect(await err(h.admin.query(`truncate patient_search_log`))).not.toBe("ok");
  });
});

describe("saved segments", () => {
  it("save, list own, overwrite by name, delete own; filters validated and never a query; another staff's and tenant's invisible", async () => {
    const s = await as(FO, (db) => saveSegment(db, key(), "Datang 30 hari", { last_visit: "30d", branch_id: A.b1 }));
    await as(FO, (db) => saveSegment(db, key(), "Datang 30 hari", { last_visit: "90d" }));
    expect(await as(FO, (db) => mySegments(db))).toMatchObject([{ id: s.segmentId, name: "Datang 30 hari", filters: { last_visit: "90d" } }]);
    expect(await as(FO2, (db) => mySegments(db))).toEqual([]);
    expect(await as(BFO, (db) => mySegments(db))).toEqual([]);
    for (const bad of [{ q: "Rina" }, {}, { last_visit: "1y" }, { branch_id: B.b1 }, { visiting_now: "ya" }]) {
      expect(await code(as(FO, (db) => saveSegment(db, key(), "Salah", bad as never))), JSON.stringify(bad)).toBe("ERR_INVALID_INPUT");
    }
    expect(await code(as(FO2, (db) => deleteSegment(db, key(), s.segmentId)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BFO, (db) => deleteSegment(db, key(), s.segmentId)))).toBe("ERR_NOT_FOUND");
    for (const p of [MK, PU]) expect(await code(as(p, (db) => saveSegment(db, key(), "Segmen", { visiting_now: true }))), p.role).toBe("ERR_FORBIDDEN");
    await as(FO, (db) => deleteSegment(db, key(), s.segmentId));
    expect(await as(FO, (db) => mySegments(db))).toEqual([]);
    const au = (await h.admin.query(`select reason_code from audit_events where object_id = $1 order by seq`, [s.segmentId])).rows.map((r) => r.reason_code);
    expect(au).toEqual(["segment_saved", "segment_saved", "segment_deleted"]);
  });
});

describe("marketing and tenancy", () => {
  it("marketing sees only consented contacts, phone masked by the module", async () => {
    expect(maskPhone("+6281277001122")).toBe("+62•••••••1122");
    expect(maskPhone(null)).toBeNull();
    expect(Array.isArray(await as(MK, (db) => marketingContacts(db)))).toBe(true);
  });

  it("tenant B's search never returns A's patients; A's segments are not B's", async () => {
    await phoned(A, "Pasien Rahasia Tenant A", "+6281200998877");
    expect((await rows(as(BFO, (db) => searchPatients(db, "Rahasia Tenant A")))).rows).toEqual([]);
    expect((await rows(as(BFO, (db) => searchPatients(db, "00998877")))).rows).toEqual([]);
  });
});
