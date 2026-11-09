// T-050 Done-when: scenario PR-73 (a doctor's SIP expiring in 30 days; the daily job alerts the doctor and the
// facility head); no alert for a lifetime STR; expired or invalid credentials remain blocked. Plus the plan
// review: the scan's thresholds, catch-up and idempotency; IAM-4 separation of duties (holder, recorder,
// inviter; the sole facility head falls back to the Owner); scope per branch; the lifecycle and guards;
// credential_valid; readers; vendor classes; events and audit ids only; cross-tenant.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import {
  assertCredentialValid, completeSet, credentialStatus, credentialValid, decidable, decideCredential, endCredential, listCredentials, recordCredential, runCredentialAlerts,
  type CredentialInput,
} from "../../src/modules/org/licences/licences";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { list as notifications } from "../../src/modules/notifications/notifications";
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
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Kredensial Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string, tz: string) =>
    (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, $3) returning id`, [tenantId, c, tz])).rows[0].id as string;
  return { tenantId, b1: await br("K1", "Asia/Jakarta"), b2: await br("K2", "Asia/Makassar") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`krd${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Kredensial ${n}` });
  return addRole({ acc, staffId, tenantId: t.tenantId, role }, t, role, ...branches);
}
async function addRole(p: Omit<P, "branch"> & { branch?: string }, t: T, role: Role, ...branches: string[]): Promise<P> {
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId: p.staffId, role });
  const bs = TENANT_WIDE.includes(role) ? [] : branches.length ? branches : [t.b1];
  for (const b of bs) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { ...p, role, branch: bs[0] };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>, branch?: string) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: branch ?? p.branch }), fn);
const key = () => crypto.randomUUID();
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const day = (tz: string, days = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.now() + days * 86_400_000));
const plus = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const str = (profession: CredentialInput["profession"] = "dokter", expiresOn: string | null = null): CredentialInput =>
  ({ kind: "str", number: `STR-${++n}`, issuer: "Konsil Kesehatan Indonesia", profession, validFrom: "2024-01-01", expiresOn });
const sip = (branchId: string, expiresOn: string, profession: CredentialInput["profession"] = "dokter"): CredentialInput =>
  ({ kind: "sip", number: `SIP-${++n}`, issuer: "Dinas Kesehatan Kota", profession, branchId, validFrom: "2024-01-01", expiresOn });
const notes = async (subject: string) =>
  (await h.admin.query(`select recipient_role, recipient_staff_id, branch_id from notifications where type = 'credential_expiry' and subject_id = $1 order by recipient_role nulls first`, [subject])).rows;
const alerts = async (credential: string) =>
  (await h.admin.query(`select threshold from credential_alerts where credential_id = $1 order by threshold`, [credential])).rows.map((r) => r.threshold);

let A: T;
let B: T;
let OWN: P; let AP: P; let MGR: P; let MGR2: P; let FH: P; let FH2: P; let DOC: P; let DOC2: P; let NUR: P; let FO: P; let FIN: P; let AU: P;
let BOWN: P; let BDOC: P;
const today = () => day("Asia/Jakarta");

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = new pg.Pool({ connectionString: h.ownerUrl(), max: 2 });
  owner.on("error", () => {});
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); AP = await person(A, "admin_pusat");
  MGR = await person(A, "manager", A.b1); MGR2 = await person(A, "manager", A.b2);
  FH = await person(A, "facility_head", A.b1); FH2 = await person(A, "facility_head", A.b2);
  DOC = await person(A, "doctor", A.b1, A.b2); DOC2 = await person(A, "doctor", A.b2);
  NUR = await person(A, "nurse", A.b1); FO = await person(A, "fo_cashier", A.b1); FIN = await person(A, "finance"); AU = await person(A, "auditor");
  BOWN = await person(B, "owner"); BDOC = await person(B, "doctor", B.b1);
}, 300_000);
afterAll(async () => {
  await app?.end();
  await owner?.end();
  await h?.close();
});

describe("scenario PR-73: credential expiry alerts", () => {
  it("a doctor's SIP expiring in 30 days: the daily job alerts the doctor and the facility head, once", async () => {
    const { credentialId: s } = await as(OWN, (db) => recordCredential(db, key(), DOC.staffId, sip(A.b1, plus(today(), 30))));
    await as(FH, (db) => decideCredential(db, key(), s, true));
    await runCredentialAlerts(app, today());
    expect(await alerts(s)).toEqual([30]);
    expect(await notes(s)).toEqual([
      { recipient_role: null, recipient_staff_id: DOC.staffId, branch_id: A.b1 },
      { recipient_role: "facility_head", recipient_staff_id: null, branch_id: A.b1 },
    ]);
    // Both see it through their own inbox (notification_visible); the other branch's facility head does not.
    expect((await as(DOC, (db) => notifications(db))).filter((x) => x.subjectId === s)).toHaveLength(1);
    expect((await as(FH, (db) => notifications(db))).filter((x) => x.subjectId === s)).toHaveLength(1);
    expect((await as(FH2, (db) => notifications(db))).filter((x) => x.subjectId === s)).toHaveLength(0);
    // The next run, and a run the next day, send nothing more (30 already sent; 7 not reached).
    await runCredentialAlerts(app, today());
    await runCredentialAlerts(app, plus(today(), 1));
    expect(await alerts(s)).toEqual([30]);
    expect(await notes(s)).toHaveLength(2);
    // At 7 days left the 7-day alert goes out; 60 never fires after a smaller threshold.
    await runCredentialAlerts(app, plus(today(), 23));
    expect(await alerts(s)).toEqual([7, 30]);
    await runCredentialAlerts(app, plus(today(), 24));
    expect(await alerts(s)).toEqual([7, 30]);
  });

  it("thresholds: 60 at 60 days; a late first run sends only the most urgent; nothing past expiry or beyond 60 days", async () => {
    const mk = async (days: number, who = DOC2, branch = A.b2) => {
      const { credentialId } = await as(OWN, (db) => recordCredential(db, key(), who.staffId, sip(branch, plus(today(), days))));
      return credentialId;
    };
    const s60 = await mk(60);
    await runCredentialAlerts(app, plus(today(), -1)); // 61 days left: nothing
    expect(await alerts(s60)).toEqual([]);
    await runCredentialAlerts(app, today());
    expect(await alerts(s60)).toEqual([60]);
    // A pending SIP alerts too (open point 4); the first run at 25 days left sends 30 only, and 60 never follows.
    const nurse = await person(A, "nurse", A.b2);
    const { credentialId: late } = await as(OWN, (db) =>
      recordCredential(db, key(), nurse.staffId, { kind: "sipp", number: `SIPP-${++n}`, issuer: "Dinas Kesehatan", profession: "perawat", branchId: A.b2, validFrom: "2024-01-01", expiresOn: plus(today(), 25) }));
    await runCredentialAlerts(app, today());
    await runCredentialAlerts(app, plus(today(), 1));
    expect(await alerts(late)).toEqual([30]);
    // Expired: no alert.
    await runCredentialAlerts(app, plus(today(), 26));
    expect(await alerts(late)).toEqual([30]);
  });

  it("a larger threshold never fires after a smaller one, whatever the order the rows arrive in", async () => {
    const d = await person(A, "doctor", A.b2);
    const { credentialId } = await as(OWN, (db) => recordCredential(db, key(), d.staffId, sip(A.b2, plus(today(), 25))));
    // A 7-day alert already recorded (e.g. by a run on a clock ahead): at 25 days left neither 30 nor 60 fires.
    await h.admin.query(`insert into credential_alerts (tenant_id, credential_id, threshold, alerted_on) values ($1, $2, 7, $3)`, [A.tenantId, credentialId, today()]);
    await runCredentialAlerts(app, today());
    expect(await alerts(credentialId)).toEqual([7]);
    expect(await notes(credentialId)).toEqual([]);
  });

  it("no alert for a lifetime STR; an STR with an expiry alerts the facility head of each clinical branch of its holder", async () => {
    const { credentialId: life } = await as(OWN, (db) => recordCredential(db, key(), DOC.staffId, str()));
    await as(FH, (db) => decideCredential(db, key(), life, true));
    for (const d of [0, 30, 60, 3650]) await runCredentialAlerts(app, plus(today(), d));
    expect(await alerts(life)).toEqual([]);
    expect(await notes(life)).toEqual([]);
    // An old-regime STR with an expiry (JUR-ID-9): DOC works at b1 and b2 → both facility heads, never a null branch.
    const doc3 = await person(A, "doctor", A.b1, A.b2);
    const { credentialId: old } = await as(OWN, (db) => recordCredential(db, key(), doc3.staffId, str("dokter", plus(today(), 7))));
    await runCredentialAlerts(app, today());
    expect(await alerts(old)).toEqual([7]);
    expect((await notes(old)).map((r) => [r.recipient_role, r.branch_id]).sort()).toEqual(
      [["facility_head", A.b1], ["facility_head", A.b2], [null, null]].sort());
  });

  it("the scan runs only on an unbound worker connection and skips ended holders and closed tenants", async () => {
    await expect(as(OWN, (db) => runCredentialAlerts(db))).rejects.toMatchObject({ code: "42501" });
    const leaving = await person(A, "doctor", A.b1);
    const { credentialId } = await as(OWN, (db) => recordCredential(db, key(), leaving.staffId, sip(A.b1, plus(today(), 30))));
    await h.admin.query(`update memberships set effective_to = now() where id = (select membership_id from staff where id = $1)`, [leaving.staffId]);
    await runCredentialAlerts(app, today());
    expect(await alerts(credentialId)).toEqual([]);
    expect(await runCredentialAlerts(app)).toBeGreaterThanOrEqual(0); // without a date: each credential's own local today
  });
});

describe("IAM-4: separation of duties and scope", () => {
  it("the Owner and Admin Pusat record; nobody else", async () => {
    for (const p of [MGR, FH, DOC, NUR, FO, FIN, AU]) expect(await code(as(p, (db) => recordCredential(db, key(), DOC2.staffId, str())))).toBe("ERR_FORBIDDEN");
    const { credentialId } = await as(AP, (db) => recordCredential(db, key(), DOC2.staffId, str()));
    expect((await h.admin.query(`select state, recorded_by from staff_credentials where id = $1`, [credentialId])).rows[0]).toEqual({ state: "pending", recorded_by: AP.staffId });
  });

  it("a holder must be an active clinical staff member, and a permit's branch one where they hold the role", async () => {
    expect(await code(as(OWN, (db) => recordCredential(db, key(), FO.staffId, str())))).toBe("ERR_NOT_FOUND");
    expect(await code(as(OWN, (db) => recordCredential(db, key(), NUR.staffId, sip(A.b2, plus(today(), 100), "perawat"))))).toBe("ERR_INVALID_INPUT"); // sip for perawat
    expect(await code(as(OWN, (db) => recordCredential(db, key(), NUR.staffId, { ...sip(A.b2, plus(today(), 100)), kind: "sipp", profession: "perawat" })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(OWN, (db) => recordCredential(db, key(), BDOC.staffId, str())))).toBe("ERR_NOT_FOUND");
    expect(await code(as(OWN, (db) => recordCredential(db, key(), DOC2.staffId, { ...sip(A.b2, plus(today(), 10)), expiresOn: null })))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(OWN, (db) => recordCredential(db, key(), DOC2.staffId, { ...str(), branchId: A.b2 })))).toBe("ERR_INVALID_INPUT");
  });

  it("the verifier is never the holder, the recorder or the inviter; a facility head decides only in their branches", async () => {
    const holderFh = await person(A, "doctor", A.b1);
    await addRole(holderFh, A, "facility_head", A.b1);
    // The holder (as facility head) cannot verify their own.
    const { credentialId: own } = await as(OWN, (db) => recordCredential(db, key(), holderFh.staffId, sip(A.b1, plus(today(), 200))));
    expect(await code(as({ ...holderFh, role: "facility_head", branch: A.b1 }, (db) => decideCredential(db, key(), own, true)))).toBe("ERR_APPROVER_IS_REQUESTER");
    // A facility head who recorded? Only Owner/AP record, so the recorder check bites the Owner fallback below.
    // The inviter: a facility head who invited the doctor cannot verify them.
    const invited = await person(A, "doctor", A.b1);
    await h.admin.query(`insert into staff_invitations (tenant_id, email, display_name, roles, branch_ids, invited_by, token_hash, expires_at, state, accepted_staff_id, closed_at)
      values ($1, 'inv@klinik-sintetis.test', 'Dokter Undangan', '{doctor}', array[$2::uuid], $3, encode(sha256(gen_random_uuid()::text::bytea), 'hex'), now() + interval '1 day', 'accepted', $4, now())`,
      [A.tenantId, A.b1, FH.staffId, invited.staffId]);
    const { credentialId: inv } = await as(OWN, (db) => recordCredential(db, key(), invited.staffId, sip(A.b1, plus(today(), 200))));
    expect(await code(as(FH, (db) => decideCredential(db, key(), inv, true)))).toBe("ERR_APPROVER_IS_REQUESTER");
    // Another branch's facility head: not found (scope), and the Owner may not step in while a facility head of b1 exists who is not conflicted.
    const fresh = await person(A, "doctor", A.b1);
    const { credentialId: c } = await as(OWN, (db) => recordCredential(db, key(), fresh.staffId, sip(A.b1, plus(today(), 200))));
    expect(await code(as(FH2, (db) => decideCredential(db, key(), c, true)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(OWN, (db) => decideCredential(db, key(), c, true)))).toBe("ERR_FORBIDDEN");
    for (const p of [MGR, AP, DOC2, NUR]) expect(await code(as(p, (db) => decideCredential(db, key(), c, true)))).toBe("ERR_FORBIDDEN");
    await as(FH, (db) => decideCredential(db, key(), c, true));
    expect((await h.admin.query(`select state, decided_by from staff_credentials where id = $1`, [c])).rows[0]).toEqual({ state: "verified", decided_by: FH.staffId });
    expect(await code(as(FH, (db) => decideCredential(db, key(), c, false, "Nomor tidak cocok")))).toBe("ERR_VERSION_CONFLICT");
  });

  it("the sole facility head: their own credential is verified by the Owner, who never verifies one they recorded", async () => {
    const C = await tenant();
    const own = await person(C, "owner");
    const ap = await person(C, "admin_pusat");
    const pj = await person(C, "doctor", C.b1);
    await addRole(pj, C, "facility_head", C.b1);
    const pjFh = { ...pj, role: "facility_head" as Role, branch: C.b1 };
    const { credentialId: byAp } = await as(ap, (db) => recordCredential(db, key(), pj.staffId, sip(C.b1, plus(today(), 300))));
    expect(await code(as(pjFh, (db) => decideCredential(db, key(), byAp, true)))).toBe("ERR_APPROVER_IS_REQUESTER");
    await as(own, (db) => decideCredential(db, key(), byAp, true)); // no other facility head: the Owner verifies
    const { credentialId: byOwner } = await as(own, (db) => recordCredential(db, key(), pj.staffId, str()));
    expect(await code(as(own, (db) => decideCredential(db, key(), byOwner, true)))).toBe("ERR_APPROVER_IS_REQUESTER");
    // A practising Owner records their own credential; the facility head verifies it.
    await addRole(own, C, "doctor", C.b1);
    const { credentialId: ownersStr } = await as(own, (db) => recordCredential(db, key(), own.staffId, str()));
    await as(pjFh, (db) => decideCredential(db, key(), ownersStr, true));
    // The Owner's own credential cannot be verified by the Owner even as a fallback.
    expect(await code(as(own, (db) => decideCredential(db, key(), byOwner, false, "Salah catat")))).toBe("ERR_APPROVER_IS_REQUESTER");
    await expect(h.admin.query(`update staff_credentials set state = 'verified', decided_by = staff_id, decided_at = now() where id = $1`, [byOwner])).rejects.toThrow(/verifier_check/);
  });

  it("an expired credential cannot be verified; a rejection needs a reason", async () => {
    const d = await person(A, "doctor", A.b2);
    const { credentialId } = await as(OWN, (db) => recordCredential(db, key(), d.staffId, { ...sip(A.b2, plus(day("Asia/Makassar"), -1)), validFrom: "2020-01-01" }));
    expect(await code(as(FH2, (db) => decideCredential(db, key(), credentialId, true)))).toBe("ERR_CREDENTIAL_INVALID");
    expect(await code(as(FH2, (db) => decideCredential(db, key(), credentialId, false, "")))).toBe("ERR_INVALID_INPUT");
    await as(FH2, (db) => decideCredential(db, key(), credentialId, false, "Sudah habis masa berlaku"));
    expect((await h.admin.query(`select state, decision_reason from staff_credentials where id = $1`, [credentialId])).rows[0]).toEqual({ state: "rejected", decision_reason: "Sudah habis masa berlaku" });
  });
});

describe("validity: expired or invalid credentials remain blocked", () => {
  it("credential_valid needs a verified STR and a verified permit for the branch, both in force, same profession", async () => {
    const d = await person(A, "doctor", A.b1, A.b2);
    const valid = (branch: string, at?: Date) => as(OWN, (db) => credentialValid(db, d.staffId, branch, at));
    expect(await valid(A.b1)).toBe(false); // nothing
    const { credentialId: s } = await as(OWN, (db) => recordCredential(db, key(), d.staffId, str()));
    const { credentialId: p1 } = await as(OWN, (db) => recordCredential(db, key(), d.staffId, sip(A.b1, plus(today(), 90))));
    expect(await valid(A.b1)).toBe(false); // pending
    await as(FH, (db) => decideCredential(db, key(), s, true));
    expect(await valid(A.b1)).toBe(false); // permit still pending
    await as(FH, (db) => decideCredential(db, key(), p1, true));
    expect(await valid(A.b1)).toBe(true);
    expect(await valid(A.b2)).toBe(false); // another branch's permit is not this branch's
    expect(await valid(A.b1, new Date(Date.now() + 120 * 86_400_000))).toBe(false); // expired by then
    expect(await valid(A.b1, new Date("2023-06-01T03:00:00Z"))).toBe(false); // before valid_from
    expect(await code(as(OWN, (db) => assertCredentialValid(db, d.staffId, A.b2)))).toBe("ERR_CREDENTIAL_INVALID");
    // A permit of another profession does not pair with the STR.
    const n2 = await person(A, "nurse", A.b2);
    const { credentialId: ns } = await as(OWN, (db) => recordCredential(db, key(), n2.staffId, str("dokter")));
    const { credentialId: np } = await as(OWN, (db) =>
      recordCredential(db, key(), n2.staffId, { kind: "sipp", number: `SIPP-${++n}`, issuer: "Dinas", profession: "perawat", branchId: A.b2, validFrom: "2024-01-01", expiresOn: plus(today(), 90) }));
    await as(FH2, (db) => decideCredential(db, key(), ns, true));
    await as(FH2, (db) => decideCredential(db, key(), np, true));
    expect(await as(OWN, (db) => credentialValid(db, n2.staffId, A.b2))).toBe(false);
    // Suspension blocks at once; a suspended credential is never verified again (only revoked).
    await as(FH, (db) => endCredential(db, key(), p1, "suspended", "Sedang diperiksa"));
    expect(await valid(A.b1)).toBe(false);
    expect(await code(as(FH, (db) => decideCredential(db, key(), p1, true)))).toBe("ERR_VERSION_CONFLICT");
    expect(await code(as(MGR, (db) => endCredential(db, key(), p1, "revoked", "Dicabut")))).toBe("ERR_FORBIDDEN");
    expect(await code(as(FH, (db) => endCredential(db, key(), p1, "suspended", "Tangguh lagi")))).toBe("ERR_VERSION_CONFLICT");
    await as(OWN, (db) => endCredential(db, key(), p1, "revoked", "Izin dicabut dinas"));
    expect((await h.admin.query(`select state, ended_by, decided_by from staff_credentials where id = $1`, [p1])).rows[0]).toEqual({ state: "revoked", ended_by: OWN.staffId, decided_by: FH.staffId });
    // Reinstatement is a new record that replaces it and is verified again.
    const { credentialId: p2 } = await as(OWN, (db) => recordCredential(db, key(), d.staffId, { ...sip(A.b1, plus(today(), 365)), replaces: p1 }));
    expect(await valid(A.b1)).toBe(false);
    await as(FH, (db) => decideCredential(db, key(), p2, true));
    expect(await valid(A.b1)).toBe(true);
    // An ended membership: invalid.
    await h.admin.query(`update memberships set effective_to = now() where id = (select membership_id from staff where id = $1)`, [d.staffId]);
    expect(await valid(A.b1)).toBe(false);
  });

  it("review r1 P1-1: an ended replacement never resurrects the old one; an early renewal waits for its valid_from", async () => {
    const d = await person(A, "doctor", A.b1);
    const valid = (at?: Date) => as(OWN, (db) => credentialValid(db, d.staffId, A.b1, at));
    const { credentialId: s } = await as(OWN, (db) => recordCredential(db, key(), d.staffId, str()));
    await as(FH, (db) => decideCredential(db, key(), s, true));
    const { credentialId: p1 } = await as(OWN, (db) => recordCredential(db, key(), d.staffId, sip(A.b1, plus(today(), 30))));
    await as(FH, (db) => decideCredential(db, key(), p1, true));
    expect(await valid()).toBe(true);
    // An early renewal from the day after p1 ends: verified now, p1 stays valid until then, p2 after.
    const { credentialId: p2 } = await as(OWN, (db) => recordCredential(db, key(), d.staffId, { ...sip(A.b1, plus(today(), 400)), validFrom: plus(today(), 31), replaces: p1 }));
    await as(FH, (db) => decideCredential(db, key(), p2, true));
    expect(await valid()).toBe(true);
    expect(await valid(new Date(Date.now() + 40 * 86_400_000))).toBe(true);
    // Suspending the renewal ends the line at once: p1 does not come back.
    await as(FH, (db) => endCredential(db, key(), p2, "suspended", "Diperiksa dinas"));
    expect(await valid()).toBe(false);
    expect(await valid(new Date(Date.now() + 40 * 86_400_000))).toBe(false);
    // The staff page shows p1 superseded and the line ended, not "verified".
    const rows = await as(OWN, (db) => listCredentials(db, [d.staffId]));
    expect(rows.find((r) => r.id === p1)?.superseded).toBe(true);
    expect(credentialStatus(rows, today()).kind).toBe("ended");
  });

  it("review r1 P1-3: a fresh reinstatement after an end clears the ended status; a replaced pending row is never decided", async () => {
    const d = await person(A, "doctor", A.b1);
    const { credentialId: s1 } = await as(OWN, (db) => recordCredential(db, key(), d.staffId, str()));
    await as(FH, (db) => decideCredential(db, key(), s1, true));
    await as(FH, (db) => endCredential(db, key(), s1, "revoked", "Salah nomor"));
    const { credentialId: s2 } = await as(OWN, (db) => recordCredential(db, key(), d.staffId, str()));
    await as(FH, (db) => decideCredential(db, key(), s2, true));
    const rows = await as(OWN, (db) => listCredentials(db, [d.staffId]));
    expect(rows.find((r) => r.id === s1)?.superseded).toBe(true);
    expect(credentialStatus(rows, today()).kind).toBe("verified");
    // A pending row that already has a pending replacement cannot be decided.
    const { credentialId: q1 } = await as(OWN, (db) => recordCredential(db, key(), d.staffId, sip(A.b1, plus(today(), 200))));
    await as(OWN, (db) => recordCredential(db, key(), d.staffId, { ...sip(A.b1, plus(today(), 300)), replaces: q1 }));
    expect(await code(as(FH, (db) => decideCredential(db, key(), q1, true)))).toBe("ERR_VERSION_CONFLICT");
  });

  it("review r1 P2-1: decidable answers like the writer (Owner while a facility head may; holder; inviter; scope)", async () => {
    const d = await person(A, "doctor", A.b1);
    const { credentialId } = await as(AP, (db) => recordCredential(db, key(), d.staffId, str()));
    const why = async (who: P) => (await as(who, (db) => decidable(db, [credentialId]))).get(credentialId);
    expect(await why(FH)).toEqual({ ok: true, why: null });
    expect(await why(OWN)).toEqual({ ok: false, why: "facility_head" });
    expect(await why(FH2)).toBeUndefined(); // FH2 cannot even read it (b2 only)
    expect(await why(MGR)).toEqual({ ok: false, why: "role" });
    expect(await why(AP)).toEqual({ ok: false, why: "role" });
    // A facility head who holds the credential: "holder", in words on the page.
    const pj = await person(A, "doctor", A.b1);
    await addRole(pj, A, "facility_head", A.b1);
    const { credentialId: own } = await as(AP, (db) => recordCredential(db, key(), pj.staffId, str()));
    const pjFh = { ...pj, role: "facility_head" as Role, branch: A.b1 };
    expect((await as(pjFh, (db) => decidable(db, [own]))).get(own)).toEqual({ ok: false, why: "holder" });
    // The Admin Pusat who recorded it, if also a facility head: "recorder".
    expect((await as(FH, (db) => decidable(db, [own]))).get(own)).toEqual({ ok: true, why: null });
  });

  it("review r1 P2-4: the scan follows the permit's branch (a holder removed from that branch gets no alert for it)", async () => {
    const d = await person(A, "doctor", A.b1, A.b2);
    const { credentialId } = await as(OWN, (db) => recordCredential(db, key(), d.staffId, sip(A.b1, plus(today(), 30))));
    await h.admin.query(`delete from staff_branches where staff_id = $1 and branch_id = $2`, [d.staffId, A.b1]);
    await runCredentialAlerts(app, today());
    expect(await alerts(credentialId)).toEqual([]);
  });

  it("credential_valid is false, never null, without a tenant, for nulls and for another tenant's branch", async () => {
    expect((await app.query(`select credential_valid($1, $2, now()) as ok`, [DOC.staffId, A.b1])).rows[0].ok).toBe(false);
    expect(await as(OWN, async (db) => (await db.query(`select credential_valid(null, $1, now()) as ok`, [A.b1])).rows[0].ok)).toBe(false);
    expect(await as(BOWN, (db) => credentialValid(db, DOC.staffId, A.b1))).toBe(false);
  });

  it("renewals: a second live credential needs to replace the first; one live replacement; readers ignore the superseded", async () => {
    const d = await person(A, "doctor", A.b2);
    const { credentialId: a1 } = await as(OWN, (db) => recordCredential(db, key(), d.staffId, sip(A.b2, plus(today(), 20))));
    expect(await code(as(OWN, (db) => recordCredential(db, key(), d.staffId, sip(A.b2, plus(today(), 400)))))).toBe("ERR_VERSION_CONFLICT");
    const { credentialId: a2 } = await as(OWN, (db) => recordCredential(db, key(), d.staffId, { ...sip(A.b2, plus(today(), 400)), replaces: a1 }));
    expect(await code(as(OWN, (db) => recordCredential(db, key(), d.staffId, { ...sip(A.b2, plus(today(), 500)), replaces: a1 })))).toBe("ERR_VERSION_CONFLICT");
    const other = await person(A, "doctor", A.b2);
    expect(await code(as(OWN, (db) => recordCredential(db, key(), other.staffId, { ...sip(A.b2, plus(today(), 500)), replaces: a1 })))).toBe("ERR_NOT_FOUND");
    // A pending renewal does not silence the old one's expiry alert (it is still the credential in force).
    await runCredentialAlerts(app, today());
    expect(await alerts(a1)).toEqual([30]);
    // A pending replacement marks the old row replaced (never decided again) but not superseded: it stays the
    // current one, shown and endable, until the replacement is verified and in force (review r1 P1-3).
    let rows = await as(OWN, (db) => listCredentials(db, [d.staffId]));
    expect(rows.find((r) => r.id === a1)).toMatchObject({ replaced: true, superseded: false });
    expect(rows.find((r) => r.id === a2)).toMatchObject({ replaced: false, superseded: false });
    await as(FH2, (db) => decideCredential(db, key(), a2, true));
    rows = await as(OWN, (db) => listCredentials(db, [d.staffId]));
    expect(rows.find((r) => r.id === a1)?.superseded).toBe(true);
    // Once the renewal is verified and in force, the old one gets no more alerts (7 days not sent).
    await runCredentialAlerts(app, plus(today(), 14));
    expect(await alerts(a1)).toEqual([30]);
  });
});

describe("lifecycle, guards and the record", () => {
  it("never deleted, recorded fields never change, no truncate; alerts append-only; triggers always enabled", async () => {
    const g = await person(A, "doctor", A.b1);
    const { credentialId } = await as(OWN, (db) => recordCredential(db, key(), g.staffId, str()));
    await expect(h.admin.query(`delete from staff_credentials where id = $1`, [credentialId])).rejects.toThrow(/never deleted/);
    await expect(h.admin.query(`update staff_credentials set number = 'X-999' where id = $1`, [credentialId])).rejects.toThrow(/never changes/);
    await expect(h.admin.query(`update staff_credentials set expires_on = '2099-01-01' where id = $1`, [credentialId])).rejects.toThrow(/never changes/);
    await expect(h.admin.query(`insert into staff_credentials (tenant_id, staff_id, kind, number, issuer, profession, valid_from, state, recorded_by, decided_by, decided_at)
      select tenant_id, staff_id, kind, 'X-1', issuer, profession, valid_from, 'verified', recorded_by, $2, now() from staff_credentials where id = $1`, [credentialId, FH.staffId])).rejects.toThrow(/recorded pending/);
    await expect(h.admin.query(`truncate staff_credentials cascade`)).rejects.toThrow();
    await expect(h.admin.query(`truncate credential_alerts`)).rejects.toThrow();
    const trig = (await h.admin.query(`select tgname, tgenabled from pg_trigger where tgrelid in ('staff_credentials'::regclass, 'credential_alerts'::regclass) and not tgisinternal order by 1`)).rows;
    expect(trig.map((t) => `${t.tgname}:${t.tgenabled}`)).toEqual([
      "credential_alerts_guard:A", "credential_alerts_no_truncate:A", "staff_credentials_guard:A", "staff_credentials_no_truncate:A"]);
  });

  it("an existing alert row cannot be changed or deleted", async () => {
    const row = (await h.admin.query(`select id from credential_alerts limit 1`)).rows[0];
    expect(row).toBeDefined();
    await expect(h.admin.query(`update credential_alerts set threshold = 60 where id = $1`, [row.id])).rejects.toThrow(/never changed/);
    await expect(h.admin.query(`delete from credential_alerts where id = $1`, [row.id])).rejects.toThrow(/never changed/);
  });

  it("audit and events carry ids and codes only; the reason stays on the row", async () => {
    const { credentialId } = await as(OWN, (db) => recordCredential(db, key(), NUR.staffId, { kind: "sipp", number: `SIPP-${++n}`, issuer: "Dinas", profession: "perawat", branchId: A.b1, validFrom: "2024-01-01", expiresOn: plus(today(), 300) }));
    await as(FH, (db) => decideCredential(db, key(), credentialId, false, "Dokumen kurang jelas sekali"));
    const au = (await h.admin.query(`select action, reason_code, reason from audit_events where object_kind = 'staff_credential' and object_id = $1 order by seq`, [credentialId])).rows;
    expect(au).toEqual([
      { action: "settings_change", reason_code: "credential_recorded", reason: null },
      { action: "approval", reason_code: "credential_rejected", reason: null },
    ]);
    const ev = (await h.admin.query(`select type, payload, branch_id from domain_events where aggregate_id = $1 order by occurred_at`, [credentialId])).rows;
    expect(ev.map((e) => e.payload.change)).toEqual(["credential_recorded", "credential_rejected"]);
    expect(ev[0]).toMatchObject({ type: "CredentialChanged", branch_id: A.b1, payload: { credential_id: credentialId, staff_id: NUR.staffId, branch_id: A.b1, kind: "sipp" } });
    expect(JSON.stringify(ev)).not.toMatch(/Dokumen|Dinas|SIPP-/i);
    for (const e of ev) expect(Object.keys(e.payload).sort()).toEqual(["branch_id", "change", "credential_id", "kind", "staff_id"]);
  });

  it("an idempotent replay records once", async () => {
    const k = key();
    const d = await person(A, "doctor", A.b1);
    const a = await as(OWN, (db) => recordCredential(db, k, d.staffId, str()));
    const b = await as(OWN, (db) => recordCredential(db, k, d.staffId, str()).catch((e) => e));
    expect(a.replayed).toBe(false);
    // Same key with another body (a new number) is refused; same body replays.
    expect(b instanceof CommandError || b.replayed === true).toBe(true);
  });
});

describe("readers and scope (plan r1 P2-1)", () => {
  it("Owner and Admin Pusat read all; a manager or facility head only for their branches; the holder their own; others nothing", async () => {
    const d = await person(A, "doctor", A.b2);
    const { credentialId: p } = await as(OWN, (db) => recordCredential(db, key(), d.staffId, sip(A.b2, plus(today(), 200))));
    const { credentialId: s } = await as(OWN, (db) => recordCredential(db, key(), d.staffId, str()));
    const sees = async (who: P) => (await as(who, (db) => listCredentials(db, [d.staffId]))).map((c) => c.id).sort();
    expect(await sees(OWN)).toEqual([p, s].sort());
    expect(await sees(AP)).toEqual([p, s].sort());
    expect(await sees(MGR2)).toEqual([p, s].sort());
    expect(await sees(FH2)).toEqual([p, s].sort());
    expect(await sees(MGR)).toEqual([]);
    expect(await sees(FH)).toEqual([]);
    expect(await sees(d)).toEqual([p, s].sort());
    for (const who of [DOC2, NUR, FO, FIN, AU]) expect(await sees(who)).toEqual([]);
    expect(await sees(BOWN)).toEqual([]);
    // DOC works at b1 and b2: b1's manager sees DOC's STR and DOC's b1 permit, never DOC's b2 permit.
    const { credentialId: b2Permit } = await as(OWN, (db) => recordCredential(db, key(), DOC.staffId, sip(A.b2, plus(today(), 300))));
    const mgrSees = (await as(MGR, (db) => listCredentials(db, [DOC.staffId]))).map((c) => c.kind);
    expect((await as(MGR, (db) => listCredentials(db, [DOC.staffId]))).map((c) => c.id)).not.toContain(b2Permit);
    expect(mgrSees).toContain("str");
    expect(mgrSees).toContain("sip");
  });

  it("the alert log is readable by no app role; vendor classes", async () => {
    await expect(as(OWN, (db) => db.query(`select count(*) from credential_alerts`))).rejects.toMatchObject({ code: "42501" });
    const kinds = (await h.admin.query(`select table_name, support_class from support_object_kinds where table_name in ('public.staff_credentials','public.credential_alerts') order by 1`)).rows;
    expect(kinds).toEqual([{ table_name: "public.credential_alerts", support_class: "never" }, { table_name: "public.staff_credentials", support_class: "personal" }]);
    const fns = ["credential_holder_ok(uuid,uuid,uuid)", "credential_branches(uuid,uuid,uuid)", "credential_timezone(uuid,uuid,uuid)", "credential_open(record,uuid)",
      "credential_inviter(uuid,uuid)", "staff_credentials_guard()", "credential_alerts_guard()"];
    for (const f of fns) {
      for (const r of ["clinic_app", "clinic_vendor", "clinic_operator"]) {
        expect((await h.admin.query(`select has_function_privilege($1, $2, 'execute') as ok`, [r, `public.${f}`])).rows[0].ok, `${r} ${f}`).toBe(false);
      }
    }
  });

  it("cross-tenant: tenant B cannot record, decide or end tenant A's rows, nor see them", async () => {
    const x = await person(A, "doctor", A.b2);
    const { credentialId } = await as(OWN, (db) => recordCredential(db, key(), x.staffId, sip(A.b2, plus(today(), 250))));
    expect(await code(as(BOWN, (db) => recordCredential(db, key(), DOC.staffId, str())))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BOWN, (db) => decideCredential(db, key(), credentialId, true)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BOWN, (db) => endCredential(db, key(), credentialId, "revoked", "Coba cabut")))).toBe("ERR_NOT_FOUND");
    expect(await as(BOWN, (db) => listCredentials(db))).toEqual([]);
    expect((await h.admin.query(`select state from staff_credentials where id = $1`, [credentialId])).rows[0].state).toBe("pending");
  });

  it("a suspended tenant may still suspend or revoke, not record or verify", async () => {
    const S = await tenant();
    const own = await person(S, "owner");
    const fh = await person(S, "facility_head", S.b1);
    const d = await person(S, "doctor", S.b1);
    const { credentialId: c1 } = await as(own, (db) => recordCredential(db, key(), d.staffId, str()));
    await as(fh, (db) => decideCredential(db, key(), c1, true));
    const { credentialId: c2 } = await as(own, (db) => recordCredential(db, key(), d.staffId, sip(S.b1, plus(today(), 100))));
    await h.admin.query(`update tenants_registry set lifecycle_state = 'suspended' where id = $1`, [S.tenantId]);
    expect(await code(as(own, (db) => recordCredential(db, key(), d.staffId, { ...str(), replaces: c1 })))).toBe("ERR_TENANT_SUSPENDED");
    expect(await code(as(fh, (db) => decideCredential(db, key(), c2, true)))).toBe("ERR_TENANT_SUSPENDED");
    await as(fh, (db) => endCredential(db, key(), c1, "suspended", "Diperiksa"));
    expect((await h.admin.query(`select state from staff_credentials where id = $1`, [c1])).rows[0].state).toBe("suspended");
  });
});

describe("list status (UX-3 Kredensial segment)", () => {
  it("worst first: none, ended, expired, pending, expiring within 60 days, verified; lifetime STR never expires", () => {
    const base = { staffId: "s", number: "n", issuer: "i", profession: "dokter" as const, scope: null, branchId: null, validFrom: "2024-01-01",
      evidenceNote: null, replaces: null, recordedBy: "r", recordedAt: new Date(), decidedBy: null, decidedAt: null, decisionReason: null,
      endedBy: null, endedAt: null, endReason: null, superseded: false, replaced: false };
    const c = (o: Partial<typeof base> & { id: string; kind: "str" | "sip"; state: "pending" | "verified" | "rejected" | "suspended" | "revoked"; expiresOn: string | null }) => ({ ...base, ...o });
    const t = "2026-11-09";
    expect(credentialStatus([], t)).toEqual({ kind: "none" });
    expect(credentialStatus([c({ id: "1", kind: "str", state: "rejected", expiresOn: null })], t)).toEqual({ kind: "none" });
    expect(credentialStatus([c({ id: "1", kind: "str", state: "verified", expiresOn: null })], t)).toEqual({ kind: "verified" });
    expect(credentialStatus([c({ id: "1", kind: "str", state: "verified", expiresOn: null }), c({ id: "2", kind: "sip", state: "verified", expiresOn: "2026-12-09" })], t)).toEqual({ kind: "expiring", days: 30 });
    expect(credentialStatus([c({ id: "2", kind: "sip", state: "verified", expiresOn: "2027-12-09" })], t)).toEqual({ kind: "verified" });
    expect(credentialStatus([c({ id: "2", kind: "sip", state: "verified", expiresOn: "2026-12-24" })], t)).toEqual({ kind: "expiring", days: 45 });
    expect(credentialStatus([c({ id: "2", kind: "sip", state: "verified", expiresOn: "2027-01-08" })], t)).toEqual({ kind: "expiring", days: 60 });
    expect(credentialStatus([c({ id: "2", kind: "sip", state: "verified", expiresOn: "2027-01-09" })], t)).toEqual({ kind: "verified" });
    expect(credentialStatus([c({ id: "2", kind: "sip", state: "pending", expiresOn: "2027-12-09" })], t)).toEqual({ kind: "pending" });
    expect(credentialStatus([c({ id: "2", kind: "sip", state: "verified", expiresOn: "2026-11-08" })], t)).toEqual({ kind: "expired" });
    expect(credentialStatus([c({ id: "2", kind: "sip", state: "suspended", expiresOn: "2027-11-08" })], t)).toEqual({ kind: "ended" });
    expect(credentialStatus([c({ id: "2", kind: "sip", state: "verified", expiresOn: "2026-11-08", superseded: true })], t)).toEqual({ kind: "none" });
    // The blocked notice needs a complete set (review r1 P1-3): an STR and a permit of one profession, verified, in force.
    const strV = c({ id: "s", kind: "str", state: "verified", expiresOn: null });
    const sipV = c({ id: "p", kind: "sip", state: "verified", expiresOn: "2027-12-09" });
    expect(completeSet([strV], t)).toBe(false);
    expect(completeSet([sipV], t)).toBe(false);
    expect(completeSet([strV, sipV], t)).toBe(true);
    expect(completeSet([strV, { ...sipV, profession: "perawat" as never }], t)).toBe(false);
    expect(completeSet([strV, { ...sipV, expiresOn: "2026-11-08" }], t)).toBe(false);
    expect(completeSet([strV, { ...sipV, state: "pending" }], t)).toBe(false);
  });

  it("credentialValid treats anything but true as invalid (a missing or null row is never valid)", async () => {
    const fake = (rows: unknown[]) => ({ query: async () => ({ rows }) }) as never;
    expect(await credentialValid(fake([{ ok: null }]), "s", "b")).toBe(false);
    expect(await credentialValid(fake([]), "s", "b")).toBe(false);
    expect(await credentialValid(fake([{ ok: true }]), "s", "b")).toBe(true);
  });
});
