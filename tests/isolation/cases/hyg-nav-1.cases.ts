// HYG-NAV-1 (T-130 orphan routes batch 1): Target Saya, Target & Scorecard Staf, Jadwal Saya, Notifikasi, Tampilan, Bantuan, Koreksi Rekam
// Medis, Matriks Persetujuan, Tindak Lanjut, Survei. Each data page runs the same reader its page uses, as the caller's own role, while B
// holds a BC with a target, a doctor with a shift and leave, a notification for its facility head, a changed SET-11 and a survey (secret
// names / reasons); none of B's rows appear for A, and A's owner setting a target for B's BC or acknowledging B's notification is refused.
// As B (positive control) every read returns B's marker and every write succeeds. The static / redirect pages read no tenant data: their
// cases return the page's fixed output and B's marker is the tenant id the run is about (positive control only proves the case runs).
// Synthetic data (MIG-2).
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { TINDAK_LANJUT_HREF } from "../../../src/app/(app)/lead/tindak-lanjut/target";
import { KOREKSI_HREF } from "../../../src/app/(app)/persetujuan/koreksi/target";
import { matrix } from "../../../src/app/(app)/persetujuan/matriks/model";
import { HELP } from "../../../src/app/(app)/saya/bantuan/page";
import { myLeave, myShifts } from "../../../src/app/(app)/saya/jadwal/queries";
import { listTargets, myTarget, setStaffTarget } from "../../../src/modules/commission/targets/targets";
import { recordSurvey, surveyList, surveySummary } from "../../../src/modules/crm/surveys/surveys";
import { ack, list as notifications, raise } from "../../../src/modules/notifications/notifications";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { setHours, setServices } from "../../../src/modules/org/branches/branches";
import { publish } from "../../../src/modules/catalog/catalog";
import { calendar } from "../../../src/modules/scheduling/appointments/appointments";
import { decideApproval } from "../../../src/modules/approvals/approvals";
import { setWeek, addLeave } from "../../../src/modules/scheduling/rosters/rosters";
import { changeSetting, settingValue } from "../../../src/modules/settings/settings";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

type CaseRole = "owner" | "bc" | "doctor" | "facility_head" | "marketing" | "central_cs";
const BRANCH_ROLES = new Set<CaseRole>(["bc", "doctor", "facility_head"]);
const accOf = new Map<string, { acc: string; staffId: string }>();
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole) {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('Staf', $1) returning id`, [`${role}.hnav1.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Rahasia ${role} ${tenantId}` });
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId, staffId, role });
    if (BRANCH_ROLES.has(role)) await assignBranch(c, { tenantId, staffRoleId: rid, branchId });
  } finally {
    c.release();
  }
  accOf.set(k, { acc, staffId });
  return { acc, staffId };
}
async function as<T>(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole, fn: (db: never) => Promise<T>): Promise<T> {
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const { acc } = await member(env, tenantId, branchId, role);
  const ctx = await resolveContext(env.app, acc, { tenantId, actingRole: role, activeBranchId: BRANCH_ROLES.has(role) ? branchId : undefined });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}
const mine = <T>(env: IsolationEnv, role: CaseRole, fn: (db: never) => Promise<T>) => as(env, env.actor.tenantId, env.actor.branchId, role, fn);
const thisMonth = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }).slice(0, 7);
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
const plus = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const monday = (d: string) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };

type Seed = { apptPatient: string; bcName: string; bcId: string; leaveReason: string; settingReason: string; notification: string; survey: string };
// A closed visit in B (fixture rows; the visit guard paused for the close only), as tests/isolation/cases/lead.cases.ts.
async function closedVisit(env: IsolationEnv, tenantId: string, branchId: string): Promise<string> {
  const o = env.owner;
  const staff = (await o.query(`select id from staff where tenant_id = $1 limit 1`, [tenantId])).rows[0].id as string;
  const pt = (await o.query(`insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation,
       education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Pasien Survei Rahasia hnav1', '1990-01-01', 'female',
       'newborn_via_guardian', 'Fixture sintetis', 'islam', 'Karyawan', 's1', 'kawin', $2, $3, 'fo_cashier') returning id`, [tenantId, branchId, staff])).rows[0].id as string;
  const v = (await o.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
    [tenantId, branchId, pt, staff])).rows[0].id as string;
  const c = await o.connect();
  try {
    await c.query(`alter table visits disable trigger visits_guard`);
    try {
      await c.query(`update visits set closed_at = clock_timestamp(), closed_by = $2 where id = $1`, [v, staff]);
    } finally {
      await c.query(`alter table visits enable always trigger visits_guard`);
    }
  } finally {
    c.release();
  }
  return v;
}
const seeds = new Map<string, Seed>();
async function victim(env: IsolationEnv): Promise<Seed> {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const known = seeds.get(t);
  if (known) return known;
  // a BC with a target this month (target_mine / target_list)
  const bc = await member(env, t, b, "bc");
  await as(env, t, b, "owner", (db) => setStaffTarget(db, crypto.randomUUID(), bc.staffId, thisMonth(), { closingValueTarget: 12_345_678 }));
  // the doctor's own shift (next week) and leave (Jadwal Saya)
  const doc = await member(env, t, b, "doctor");
  const week = monday(plus(today(), 7));
  const leaveReason = `Cuti rahasia hnav1 ${t.slice(0, 8)}`;
  await as(env, t, b, "owner", (db) => setHours(db, b, [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "07:00", closes: "22:00" }))));
  await as(env, t, b, "owner", (db) => setWeek(db, b, week, [doc.staffId], [{ staffId: doc.staffId, date: week, starts: "09:00", ends: "17:00", kind: "work" }]));
  await as(env, t, b, "owner", (db) => addLeave(db, { branchId: b, staffId: doc.staffId, kind: "leave", from: plus(week, 1), to: plus(week, 1), reason: leaveReason }));
  // review r1 residual: a populated appointment of B's doctor (the patient name is the secret Jadwal Saya must never show to A)
  const svc = await as(env, t, b, "owner", (db) => publish(db, { kind: "service", code: `HN1-${t.slice(0, 6).toUpperCase()}` }, {
    name: "Konsultasi hnav1", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 100_000, category: "consultation", prep_min: 0, treatment_min: 30,
    buffer_min: 0, indications: "I", contraindications: "K", consent_template: "T", delegation: "D", aftercare_text: "A", eligibility: [{ role: "doctor", mode: "performs" }],
  } as never, "Layanan uji"));
  if (svc.approvalId) await as(env, t, b, "facility_head", (db) => decideApproval(db, svc.approvalId!, true));
  await as(env, t, b, "owner", (db) => setServices(db, b, [svc.itemId]));
  const apptPatient = `Pasien Janji Rahasia hnav1 ${t.slice(0, 8)}`;
  const ptA = (await env.owner.query(`insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation,
       education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $2, '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture sintetis', 'islam',
       'Karyawan', 's1', 'kawin', $3, $4, 'fo_cashier') returning id`, [t, apptPatient, b, doc.staffId])).rows[0].id as string;
  const s0 = new Date(`${week}T10:00:00+07:00`);
  const appt = (await env.owner.query(`insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state, channel, created_by, created_as)
     values ($1, $2, $3, $4, $5, $6, $7, 'booked', 'phone', $5, 'fo_cashier') returning id`, [t, b, ptA, svc.versionId, doc.staffId, s0, new Date(s0.getTime() + 30 * 60_000)])).rows[0].id as string;
  await env.owner.query(`insert into resource_reservations (tenant_id, branch_id, appointment_id, kind, resource_id, starts_at, ends_at) values ($1, $2, $3, 'staff', $4, $5, $6)`,
    [t, b, appt, doc.staffId, s0, new Date(s0.getTime() + 30 * 60_000)]);
  for (const x of [apptPatient, ptA, appt]) env.victimSecret(x);
  // a notification for B's facility head (service-raised type, raised by the seeding pool as a service: no staff in context)
  const fh = await member(env, t, b, "facility_head");
  const notification = await raiseFor(env, fh.staffId);
  // a changed SET-11 (Matriks Persetujuan reads the value in force)
  const settingReason = `Alasan matriks rahasia ${t.slice(0, 8)}`;
  await as(env, t, b, "owner", (db) => changeSetting(db, { key: "SET-11", branchId: null, value: "owner_manager", reason: settingReason }));
  // a survey on a closed visit in B (Survei)
  const survey = (await as(env, t, b, "central_cs", async (db) => recordSurvey(db, crypto.randomUUID(), { visitId: await closedVisit(env, t, b), score: 2 }))).surveyId;
  const s = { apptPatient, bcName: `Staf Rahasia bc ${t}`, bcId: bc.staffId, leaveReason, settingReason, notification, survey };
  for (const x of [s.bcName, bc.staffId, doc.staffId, fh.staffId, leaveReason, settingReason, notification, survey]) env.victimSecret(x);
  seeds.set(t, s);
  return s;
}
// A notification raised by a service (no staff in context), as the outbox consumers do (tests/notifications).
const raiseFor = (env: IsolationEnv, staffId: string) => withTenantContext(env.app, { tenantId: env.victim.tenantId, allowedBranchIds: "*", roles: [] },
  (db) => raise(db, { type: "credential_expiry", to: { staffId }, subjectKind: "staff_credential", subjectId: crypto.randomUUID() }));
const ok = (x: unknown) => ({ status: 200, body: JSON.parse(JSON.stringify(x)) });
const outcome = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));
// For static / redirect pages: the page's fixed output plus the tenant the run is about (the positive-control marker; never B's data).
const staticRoute = (id: string, render: () => unknown) => ({
  kind: "route" as const, id, expect: "filtered" as const, marker: (env: IsolationEnv) => env.actor.tenantId,
  async run(env: IsolationEnv) { return ok({ page: render(), runFor: env.actor.tenantId }); },
});

export default defineCases(
  { kind: "route", id: "/saya/target", expect: "filtered", marker: () => "12345678",
    async run(env) {
      await victim(env);
      // The caller's own BC reads its own target only (B's BC target 12.345.678 never appears).
      return ok(await mine(env, "bc", (db) => myTarget(db as never, thisMonth())));
    } },
  { kind: "route", id: "/staf/target", expect: "filtered", marker: (env) => `Staf Rahasia bc ${env.victim.tenantId}`,
    async run(env) {
      await victim(env);
      return ok(await mine(env, "owner", (db) => listTargets(db as never, { period: thisMonth() })));
    } },
  { kind: "action", id: "app/(app)/staf/target/actions", marker: (env) => seeds.get(env.victim.tenantId)?.bcId ?? "",
    async run(env) {
      const v = await victim(env);
      const attempts = { target: await outcome(mine(env, "owner", (db) => setStaffTarget(db as never, crypto.randomUUID(), v.bcId, thisMonth(), { closingValueTarget: 1 }))) };
      return { attempts, body: { ...attempts, bc: attempts.target === "done" ? v.bcId : null } };
    } },
  { kind: "route", id: "/saya/jadwal", expect: "filtered", marker: (env) => `${env.victim.legalName} Cabang`,
    async run(env) {
      await victim(env);
      const from = today();
      const to = plus(from, 20);
      // The caller's own doctor: own rows only. As B, its doctor's shift and leave carry B's branch name (the marker) and its own
      // appointment (the page's performer filter, data.ts) carries B's patient; as A, nothing of B — and A's doctor asking the calendar
      // reader for B's branch is refused (404-equivalent) rather than shown.
      const me = await member(env, env.actor.tenantId, env.actor.branchId, "doctor");
      const body = await mine(env, "doctor", async (db) => {
        const own = await calendar(db as never, env.actor.branchId, from, to);
        return { shifts: await myShifts(db as never, from, to), leave: await myLeave(db as never, from, to),
          appointments: own.appointments.filter((a) => a.performerId === me.staffId).map((a) => ({ patient: a.patientName, service: a.serviceName })) };
      });
      // its own transaction: a refusal aborts it (the reader raises), and the page then shows no appointments
      const foreignBranch = await mine(env, "doctor", (db) => calendar(db as never, env.victim.branchId, from, to))
        .then((c) => c.appointments.map((a) => a.patientName), () => "refused");
      return ok({ ...body, foreignBranch });
    } },
  { kind: "route", id: "/saya/notifikasi", expect: "filtered", marker: (env) => seeds.get(env.victim.tenantId)?.notification ?? "",
    async run(env) {
      await victim(env);
      return ok(await mine(env, "facility_head", (db) => notifications(db as never, { limit: 200 })));
    } },
  { kind: "action", id: "app/(app)/saya/notifikasi/actions", marker: (env) => seeds.get(env.victim.tenantId)?.notification ?? "",
    async run(env) {
      const t = env.victim.tenantId;
      const v = await victim(env);
      // a fresh unacknowledged notification in B for each run (the positive control acknowledges it)
      const fh = await member(env, t, env.victim.branchId, "facility_head");
      const fresh = await raiseFor(env, fh.staffId);
      env.victimSecret(fresh);
      const attempts = { ack: await outcome(mine(env, "facility_head", (db) => ack(db as never, fresh))) };
      return { attempts, body: { ...attempts, id: attempts.ack === "done" ? v.notification : null } };
    } },
  { kind: "route", id: "/persetujuan/matriks", expect: "filtered", marker: () => "owner_manager",
    async run(env) {
      await victim(env);
      // The owner sees the matrix and the values in force in its own tenant (A keeps the default "owner"; B changed SET-11).
      return ok({ rows: matrix(), set11: await mine(env, "owner", (db) => settingValue(db as never, "SET-11")) });
    } },
  { kind: "route", id: "/lead/survei", expect: "filtered", marker: (env) => seeds.get(env.victim.tenantId)?.survey ?? "",
    async run(env) {
      await victim(env);
      // As B, marketing sees B's survey (its id is the marker); as A, neither B's survey nor B's branch summary appears.
      const [sum, list] = await mine(env, "marketing", async (db) => [await surveySummary(db as never), await surveyList(db as never)] as const);
      return ok({ sum, list });
    } },
  staticRoute("/saya/tampilan", () => "device-local switch only"),
  staticRoute("/saya/bantuan", () => HELP),
  staticRoute("/persetujuan/koreksi", () => KOREKSI_HREF),
  staticRoute("/lead/tindak-lanjut", () => TINDAK_LANJUT_HREF),
);
