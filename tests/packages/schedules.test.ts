// T-083 Done-when: scenario PR-96 (a package with an agreed instalment schedule; a scheduled date passes unpaid → a reminder task is
// created and no session unlocks) and "the schedule never unlocks or creates debt". Plus the plan and its reviews: base_paid (a DP paid
// before the schedule never covers row 1), coverage, the reminder once per row, receivable schedules, automatic cancellation (paid in full,
// cancelled, expired, collected, written off), replace = version + 1, the writer's rules (targets, dates, sums, SET-41, packages without
// instalments, replay), the guards, the unbound scan, roles, branches and tenants. Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { issueKasirInvoice, openKasirInvoice, receivePayment } from "../../src/modules/cashier/kasir/kasir";
import { collectReceivable, writeOffAsOwner } from "../../src/modules/cashier/receivables/receivables";
import { publish } from "../../src/modules/catalog/catalog";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { cancelPackage, reserveSession, setPackageContents } from "../../src/modules/packages/packages";
import { runPackageExpiryScan } from "../../src/modules/packages/expiry";
import { cancelInstalmentSchedule, instalmentSchedules, setInstalmentSchedule } from "../../src/modules/packages/schedules/schedules";
import { runInstalmentReminderScan } from "../../src/modules/packages/schedules/scan";
import { changeSetting } from "../../src/modules/settings/settings";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local";

let h: Harness;
let app: pg.Pool;
let worker: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "purchasing", "marketing", "central_cs", "auditor"];

async function tenant(): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Cicilan Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
  return { tenantId, b1: await br("CC1"), b2: await br("CC2") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`ccl${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Cicilan ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const key = () => crypto.randomUUID();
const why = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason ?? ""}` : `raw:${e.code ?? e.message}`));
const raw = (sql: string, args: unknown[]) => h.admin.query(sql, args).then(() => "ok", (e) => `raw:${e.code}`);
const wib = (d: number) => new Date(Date.now() + d * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
async function patient(t: T, branch: string, name = "Pasien Cicilan"): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "");
  return (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $5, '1990-01-01', 'female', 'nik', $3, $4, 'islam', 'Karyawan', 's1', 'kawin', $2,
             (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id`,
    [t.tenantId, branch, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43), name])).rows[0].id as string;
}

let A: T; let B: T;
let OWN: P; let AP: P; let FIN: P; let AU: P; let FO: P; let FOB2: P; let MGR: P; let DOC: P; let BOWN: P;
let facial: string; let pkgItem: string; let fullItem: string;

async function sell(pid: string, item: string, pay?: number) {
  const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid }));
  await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: item, quantity: 1 }]));
  if (pay) await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: pay, cashTendered: pay }]));
  return { invoiceId, pkg: (await h.admin.query(`select id from packages where invoice_id = $1`, [invoiceId])).rows[0].id as string };
}
const pay = (inv: string, amount: number) => as(FO, (db) => receivePayment(db, key(), inv, [{ method: "cash", amount, cashTendered: amount }]));
const alerts = async (schedule: string) =>
  (await h.admin.query(`select recipient_role, branch_id from notifications where type = 'instalment_due' and subject_id = $1`, [schedule])).rows;
const sched = async (id: string) => (await h.admin.query(`select * from instalment_schedules where id = $1`, [id])).rows[0];
// Move a schedule's rows into the past (the scan runs "today"): the guard is bypassed by the owner connection for this fixture only.
async function backdate(schedule: string, days: number) {
  await h.admin.query(`alter table instalment_rows disable trigger instalment_rows_guard`);
  try {
    await h.admin.query(`update instalment_rows set due_on = due_on - $2::int where schedule_id = $1`, [schedule, days]);
  } finally {
    await h.admin.query(`alter table instalment_rows enable always trigger instalment_rows_guard`);
  }
}
// A receivable of the patient on a visit (the T-078 conversion would need a delivered line; the facts the schedule reads are the row's).
async function receivable(t: T, by: P, amount: number) {
  const pid = await patient(t, t.b1, "Pasien Piutang Cicilan");
  const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
    [t.tenantId, t.b1, pid, by.staffId])).rows[0].id as string;
  await h.admin.query(`alter table receivables disable trigger receivables_guard`);
  try {
    return (await h.admin.query(`insert into receivables (tenant_id, branch_id, patient_id, visit_id, amount, command_key, created_by, created_as)
                                 values ($1, $2, $3, $4, $5, $6, $7, 'fo_cashier') returning id`, [t.tenantId, t.b1, pid, v, amount, `rc-${key()}`, by.staffId])).rows[0].id as string;
  } finally {
    await h.admin.query(`alter table receivables enable always trigger receivables_guard`);
  }
}

beforeAll(async () => {
  h = await createHarness();
  const login = h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE]));
  app = await openAppPool({ connectionString: login, max: 6 });
  worker = await openAppPool({ connectionString: login, max: 2 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant();
  B = await tenant();
  OWN = await person(A, "owner"); AP = await person(A, "admin_pusat"); FIN = await person(A, "finance"); AU = await person(A, "auditor");
  FO = await person(A, "fo_cashier", A.b1); FOB2 = await person(A, "fo_cashier", A.b2); MGR = await person(A, "manager", A.b1); DOC = await person(A, "doctor", A.b1);
  BOWN = await person(B, "owner");
  const FH = await person(A, "facility_head", A.b1);
  const s = await as(OWN, (db) => publish(db, { kind: "service", code: "CC-FAC" }, {
    name: "Facial Cicilan", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 500_000, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
    indications: "Indikasi", consent_template: "Templat facial cicilan.", delegation: "Dokter", aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }],
  } as never, "Layanan baru"));
  if (s.approvalId) await as(FH, (db) => db.query(`select approval_decide($1, true, null)`, [s.approvalId]));
  facial = s.itemId;
  const p = await as(OWN, (db) => publish(db, { kind: "package", code: "CC-PKT" }, { name: "Paket 3x Facial Cicilan", tax_category: "exempt_medical", tax_basis: "Jasa medis",
    normal_price: 1_500_000, installments_allowed: true } as never, "Paket"));
  await as(OWN, (db) => setPackageContents(db, key(), p.versionId, [{ serviceItemId: facial, count: 3 }]));
  pkgItem = p.itemId;
  // a package that must be paid in full (no instalments: min_dp = price)
  await as(OWN, (db) => changeSetting(db, { key: "SET-9", branchId: null, value: { dp_minimum: null, cicilan: false }, reason: "Tanpa cicilan uji" }));
  const f = await as(OWN, (db) => publish(db, { kind: "package", code: "CC-FULL" }, { name: "Paket Lunas", tax_category: "exempt_medical", tax_basis: "Jasa medis",
    normal_price: 1_000_000, installments_allowed: false } as never, "Paket"));
  await as(OWN, (db) => setPackageContents(db, key(), f.versionId, [{ serviceItemId: facial, count: 2 }]));
  fullItem = f.itemId;
}, 300_000);
afterAll(async () => {
  await app?.end();
  await worker?.end();
  await owner?.end();
  await h?.close();
});

describe("scenario PR-96 schedule does not unlock", () => {
  it("a package with the min DP paid and an agreed schedule; a date passes unpaid → one reminder for FO at the sold branch; no session unlocks; nothing of money", async () => {
    const pid = await patient(A, A.b1);
    const { invoiceId, pkg } = await sell(pid, pkgItem, 500_000); // the first session's value: one session unlocked
    const before = {
      events: (await h.admin.query(`select count(*)::int c from domain_events where tenant_id = $1`, [A.tenantId])).rows[0].c,
      recv: (await h.admin.query(`select count(*)::int c from receivables where patient_id = $1`, [pid])).rows[0].c,
      bal: (await h.admin.query(`select count(*)::int c from balance_entries e join balance_accounts b on b.id = e.account_id where b.patient_id = $1`, [pid])).rows[0].c,
    };
    const { scheduleId } = await as(FO, (db) => setInstalmentSchedule(db, key(), { packageId: pkg }, [{ dueOn: wib(1), amount: 500_000 }, { dueOn: wib(31), amount: 500_000 }]));
    // the schedule set itself wrote nothing of money and unlocked nothing (r1 P3)
    expect((await h.admin.query(`select count(*)::int c from domain_events where tenant_id = $1`, [A.tenantId])).rows[0].c).toBe(before.events);
    expect((await h.admin.query(`select count(*)::int c from receivables where patient_id = $1`, [pid])).rows[0].c).toBe(before.recv);
    expect((await h.admin.query(`select count(*)::int c from balance_entries e join balance_accounts b on b.id = e.account_id where b.patient_id = $1`, [pid])).rows[0].c).toBe(before.bal);
    expect(Number((await sched(scheduleId)).base_paid)).toBe(500_000);
    // the DP paid before the schedule does not cover row 1 (r1 P1-1)
    await backdate(scheduleId, 3);
    expect(await runInstalmentReminderScan(worker)).toBeGreaterThanOrEqual(1);
    expect(await alerts(scheduleId)).toEqual([{ recipient_role: "fo_cashier", branch_id: A.b1 }]);
    // the second session is still locked: the schedule unlocks nothing
    const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
      [A.tenantId, A.b1, pid, FO.staffId])).rows[0].id as string;
    await as(FO, (db) => reserveSession(db, key(), pkg, v));
    expect(await why(as(FO, (db) => reserveSession(db, key(), pkg, v)))).toMatch(/^ERR_SESSION_NOT_UNLOCKED/);
    // once per row: the same day and the next day raise nothing more
    await runInstalmentReminderScan(worker);
    await runInstalmentReminderScan(worker, wib(1));
    expect(await alerts(scheduleId)).toHaveLength(1);
    // paid enough for row 1 → covered; the reader shows it
    await pay(invoiceId, 500_000);
    const r = await as(FO, (db) => instalmentSchedules(db, { packageId: pkg }));
    expect(r.schedules[0].rows.map((x) => [x.seq, x.covered, x.reminded_on !== null])).toEqual([[1, true, true], [2, false, false]]);
    expect(r.schedules[0].rows[0].linked_payments.length).toBe(1);
  });
});

describe("coverage, cancellation, versions", () => {
  it("a covered row raises nothing; a package paid in full cancels its schedule at once (paid); cancel and expiry cancel it (target_closed)", async () => {
    const p1 = await sell(await patient(A, A.b1), pkgItem, 500_000);
    const s1 = (await as(FO, (db) => setInstalmentSchedule(db, key(), { packageId: p1.pkg }, [{ dueOn: wib(1), amount: 400_000 }]))).scheduleId;
    await pay(p1.invoiceId, 400_000);
    await backdate(s1, 3);
    await runInstalmentReminderScan(worker);
    expect(await alerts(s1)).toEqual([]);
    await pay(p1.invoiceId, 600_000); // paid in full: the allocation trigger cancels the schedule
    expect([(await sched(s1)).state, (await sched(s1)).cancel_reason]).toEqual(["cancelled", "paid"]);
    const p2 = await sell(await patient(A, A.b1), pkgItem, 500_000);
    const s2 = (await as(FO, (db) => setInstalmentSchedule(db, key(), { packageId: p2.pkg }, [{ dueOn: wib(5), amount: 500_000 }]))).scheduleId;
    await as(OWN, (db) => cancelPackage(db, key(), p2.pkg, "Pasien membatalkan"));
    expect([(await sched(s2)).state, (await sched(s2)).cancel_reason, (await sched(s2)).cancelled_by]).toEqual(["cancelled", "target_closed", OWN.staffId]);
    const p3 = await sell(await patient(A, A.b1), pkgItem, 500_000);
    const s3 = (await as(FO, (db) => setInstalmentSchedule(db, key(), { packageId: p3.pkg }, [{ dueOn: wib(5), amount: 500_000 }]))).scheduleId;
    await h.admin.query(`alter table packages disable trigger packages_guard`);
    await h.admin.query(`update packages set validity_end = now() - interval '1 day' where id = $1`, [p3.pkg]);
    await h.admin.query(`alter table packages enable always trigger packages_guard`);
    await runPackageExpiryScan(worker);
    expect([(await sched(s3)).state, (await sched(s3)).cancel_reason, (await sched(s3)).cancelled_by]).toEqual(["cancelled", "target_closed", null]);
    await backdate(s3, 10);
    await runInstalmentReminderScan(worker);
    expect(await alerts(s3)).toEqual([]);
  });

  it("a receivable schedule: reminders; collected in full → paid; written off → target_closed", async () => {
    const r1 = await receivable(A, FO, 600_000);
    const s1 = (await as(FIN, (db) => setInstalmentSchedule(db, key(), { receivableId: r1 }, [{ dueOn: wib(1), amount: 300_000 }, { dueOn: wib(20), amount: 300_000 }]))).scheduleId;
    await backdate(s1, 3);
    await runInstalmentReminderScan(worker);
    expect(await alerts(s1)).toHaveLength(1);
    // collected through the real writer (review r1 P2-1): row 1 covered with its linked payment; the rest → paid in full, cancelled
    await as(FO, (db) => collectReceivable(db, key(), r1, { method: "cash", amount: 300_000, cashTendered: 300_000 }));
    const got = await as(FIN, (db) => instalmentSchedules(db, { receivableId: r1 }));
    expect([got.schedules[0].rows[0].covered, got.schedules[0].rows[0].linked_payments.length, got.schedules[0].rows[1].covered]).toEqual([true, 1, false]);
    await as(FO, (db) => collectReceivable(db, key(), r1, { method: "cash", amount: 300_000, cashTendered: 300_000 }));
    expect([(await sched(s1)).state, (await sched(s1)).cancel_reason]).toEqual(["cancelled", "paid"]);
    const r2 = await receivable(A, FO, 600_000);
    const s2 = (await as(FIN, (db) => setInstalmentSchedule(db, key(), { receivableId: r2 }, [{ dueOn: wib(1), amount: 600_000 }]))).scheduleId;
    await as(OWN, (db) => writeOffAsOwner(db, key(), r2, "Pasien tidak dapat dihubungi lagi"));
    expect([(await sched(s2)).state, (await sched(s2)).cancel_reason]).toEqual(["cancelled", "target_closed"]);
  });

  it("replace = version + 1 (the old one cancelled 'replaced'); manual cancel is idempotent; base_paid per version", async () => {
    const p = await sell(await patient(A, A.b1), pkgItem, 500_000);
    const s1 = (await as(FO, (db) => setInstalmentSchedule(db, key(), { packageId: p.pkg }, [{ dueOn: wib(5), amount: 1_000_000 }]))).scheduleId;
    await pay(p.invoiceId, 200_000);
    const s2 = (await as(MGR, (db) => setInstalmentSchedule(db, key(), { packageId: p.pkg }, [{ dueOn: wib(5), amount: 400_000 }, { dueOn: wib(35), amount: 400_000 }]))).scheduleId;
    expect([(await sched(s1)).state, (await sched(s1)).cancel_reason, (await sched(s2)).version, Number((await sched(s2)).base_paid)]).toEqual(["cancelled", "replaced", 2, 700_000]);
    await as(FO, (db) => cancelInstalmentSchedule(db, key(), s2));
    await as(FO, (db) => cancelInstalmentSchedule(db, key(), s2));
    expect([(await sched(s2)).state, (await sched(s2)).cancel_reason]).toEqual(["cancelled", "manual"]);
    expect(await why(as(FO, (db) => cancelInstalmentSchedule(db, key(), s1)))).toBe("ERR_VERSION_CONFLICT:schedule_closed");
    const r = await as(FIN, (db) => instalmentSchedules(db, { packageId: p.pkg }));
    expect(r.schedules.map((x) => [x.version, x.state, x.cancel_reason])).toEqual([[2, "cancelled", "manual"], [1, "cancelled", "replaced"]]);
  });
});

describe("the writer's rules, guards, roles, tenants", () => {
  it("refusals: both or no target, dates not increasing, the first in the past, the sum above the open amount, too many rows (SET-41), no instalments, closed target, replay", async () => {
    const p = await sell(await patient(A, A.b1), pkgItem, 500_000);
    const set = (rows: { dueOn: string; amount: number }[], k = key()) => why(as(FO, (db) => setInstalmentSchedule(db, k, { packageId: p.pkg }, rows)));
    expect(await why(as(FO, (db) => db.query(`select instalment_schedule_set($1, $2::jsonb)`, [key(), JSON.stringify({ package_id: p.pkg, receivable_id: p.pkg, rows: [] })]))))
      .toBe("raw:22023");
    expect(await set([{ dueOn: wib(5), amount: 100_000 }, { dueOn: wib(5), amount: 100_000 }])).toBe("ERR_INVALID_INPUT:schedule_dates");
    expect(await set([{ dueOn: wib(-1), amount: 100_000 }])).toBe("ERR_INVALID_INPUT:schedule_dates");
    expect(await set([{ dueOn: wib(5), amount: 1_000_001 }])).toBe("ERR_INVALID_INPUT:schedule_above_open");
    await as(OWN, (db) => changeSetting(db, { key: "SET-41", branchId: null, value: { cicilan_maks: 2, mundur: 1 }, reason: "Batas cicilan uji" }));
    expect(await set([{ dueOn: wib(5), amount: 100 }, { dueOn: wib(6), amount: 100 }, { dueOn: wib(7), amount: 100 }])).toBe("ERR_INVALID_INPUT:schedule_too_many_rows");
    await as(OWN, (db) => changeSetting(db, { key: "SET-41", branchId: null, restore: true, reason: "Kembali" }));
    const full = await sell(await patient(A, A.b1), fullItem);
    expect(await why(as(FO, (db) => setInstalmentSchedule(db, key(), { packageId: full.pkg }, [{ dueOn: wib(5), amount: 100_000 }])))).toBe("ERR_INVALID_INPUT:instalments_not_allowed");
    const k = key();
    const a1 = await as(FO, (db) => setInstalmentSchedule(db, k, { packageId: p.pkg }, [{ dueOn: wib(5), amount: 100_000 }]));
    expect((await as(FO, (db) => setInstalmentSchedule(db, k, { packageId: p.pkg }, [{ dueOn: wib(5), amount: 100_000 }]))).scheduleId).toBe(a1.scheduleId);
    expect(await as(FO, (db) => db.query(`select instalment_schedule_set($1, $2::jsonb)`, [k, JSON.stringify({ package_id: p.pkg, rows: [{ due_on: wib(6), amount: 1 }] })]))
      .then(() => "ok", (e) => e.code)).toBe("23505");
    await as(OWN, (db) => cancelPackage(db, key(), p.pkg, "Batal"));
    expect(await set([{ dueOn: wib(5), amount: 100_000 }])).toBe("ERR_VERSION_CONFLICT:target_closed");
  });

  it("guards: rows frozen, reminded once, schedules never deleted, one active per target; the scan runs unbound only", async () => {
    const p = await sell(await patient(A, A.b1), pkgItem, 500_000);
    const s = (await as(FO, (db) => setInstalmentSchedule(db, key(), { packageId: p.pkg }, [{ dueOn: wib(5), amount: 100_000 }]))).scheduleId;
    expect(await raw(`update instalment_rows set amount = 1 where schedule_id = $1`, [s])).toBe("raw:42501");
    // reminded_on is set once (the scan) and never cleared or moved
    await backdate(s, 10);
    await runInstalmentReminderScan(worker);
    expect((await h.admin.query(`select reminded_on from instalment_rows where schedule_id = $1`, [s])).rows[0].reminded_on).not.toBeNull();
    expect(await raw(`update instalment_rows set reminded_on = null where schedule_id = $1`, [s])).toBe("raw:42501");
    expect(await raw(`update instalment_rows set reminded_on = reminded_on + 1 where schedule_id = $1`, [s])).toBe("raw:42501");
    expect(await raw(`delete from instalment_schedules where id = $1`, [s])).toBe("raw:42501");
    expect(await raw(`update instalment_schedules set base_paid = 0 where id = $1`, [s])).toBe("raw:42501");
    expect(await raw(`insert into instalment_schedules (tenant_id, branch_id, patient_id, package_id, version, base_paid, command_key, created_by, created_as)
       select tenant_id, branch_id, patient_id, package_id, version + 1, 0, 'k-dup-active-1', created_by, created_as from instalment_schedules where id = $1`, [s])).toBe("raw:23505");
    expect(await why(as(FO, (db) => db.query(`select instalment_reminder_scan(null)`)))).toBe("raw:42501");
    // reminded_on refused on a non-active schedule (review r1 P3-1): a fresh, un-reminded schedule cancelled manually
    const s2 = (await as(FO, (db) => setInstalmentSchedule(db, key(), { packageId: p.pkg }, [{ dueOn: wib(5), amount: 100_000 }]))).scheduleId;
    await as(FO, (db) => cancelInstalmentSchedule(db, key(), s2));
    expect(await raw(`update instalment_rows set reminded_on = current_date where schedule_id = $1`, [s2])).toBe("raw:42501");
  });

  it("roles and branches: auditor, Admin Pusat and doctor refused; a branch-2 FO cannot set or read a branch-1 package's schedule; tenant B sees nothing", async () => {
    const p = await sell(await patient(A, A.b1), pkgItem, 500_000);
    for (const x of [AU, AP, DOC]) expect(await why(as(x, (db) => setInstalmentSchedule(db, key(), { packageId: p.pkg }, [{ dueOn: wib(5), amount: 1 }]))), x.role).toMatch(/^ERR_FORBIDDEN/);
    expect(await why(as(FOB2, (db) => setInstalmentSchedule(db, key(), { packageId: p.pkg }, [{ dueOn: wib(5), amount: 1 }])))).toBe("ERR_NOT_FOUND:package not found");
    const s = (await as(FO, (db) => setInstalmentSchedule(db, key(), { packageId: p.pkg }, [{ dueOn: wib(5), amount: 1 }]))).scheduleId;
    expect(await why(as(FOB2, (db) => instalmentSchedules(db, { packageId: p.pkg })))).toBe("ERR_NOT_FOUND:target not found");
    expect((await as(AU, (db) => instalmentSchedules(db, { packageId: p.pkg }))).schedules.map((x) => x.id)).toEqual([s]);
    expect(await why(as(BOWN, (db) => setInstalmentSchedule(db, key(), { packageId: p.pkg }, [{ dueOn: wib(5), amount: 1 }])))).toBe("ERR_NOT_FOUND:package not found");
    expect((await as(BOWN, (db) => db.query(`select count(*)::int c from instalment_schedules`))).rows[0].c).toBe(0);
    expect((await as(FOB2, (db) => db.query(`select count(*)::int c from instalment_rows where schedule_id = $1`, [s]))).rows[0].c).toBe(0);
  });

  it("the cashier capability: a tenant in exit can neither set nor cancel a schedule (ERR_TENANT_SUSPENDED)", async () => {
    const p = await sell(await patient(A, A.b1), pkgItem, 500_000);
    const sc = (await as(FO, (db) => setInstalmentSchedule(db, key(), { packageId: p.pkg }, [{ dueOn: wib(5), amount: 100_000 }]))).scheduleId;
    await h.admin.query(`update tenants_registry set lifecycle_state = 'exit' where id = $1`, [A.tenantId]);
    try {
      expect(await why(as(FO, (db) => cancelInstalmentSchedule(db, key(), sc)))).toMatch(/^ERR_TENANT_SUSPENDED/);
      expect(await why(as(FO, (db) => setInstalmentSchedule(db, key(), { packageId: p.pkg }, [{ dueOn: wib(6), amount: 1 }])))).toMatch(/^ERR_TENANT_SUSPENDED/);
    } finally {
      await h.admin.query(`update tenants_registry set lifecycle_state = 'live' where id = $1`, [A.tenantId]);
    }
    expect((await sched(sc)).state).toBe("active");
  });
});
