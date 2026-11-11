// Hari Ini (UX-6, PR-7, T-047): the board reads a branch's visits and arrivals (visits_today); the actions
// check a patient in and close a visit. Each run seeds in B a fresh patient with one appointment of now
// and one already-checked-in visit (payment settled), then runs as A's owner: B's board is not found and
// shows nothing of B; checking in B's appointment and closing B's visit are refused. As B's owner
// (positive control) both succeed. /hari-ini/check-in and /hari-ini/papan only redirect to the board, so
// their cases read the board too. Synthetic data on a local database (MIG-2).
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { decideApproval } from "../../../src/modules/approvals/approvals";
import { publish } from "../../../src/modules/catalog/catalog";
import { setServices, upsertRoom } from "../../../src/modules/org/branches/branches";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { checkIn, closeVisit, today } from "../../../src/modules/visits/visits";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

const people = new Map<string, string>();
async function personOf(env: IsolationEnv, tenantId: string, role: "owner" | "doctor" | "facility_head", branchId?: string): Promise<{ acc: string; staffId: string }> {
  const k = `${tenantId}:${role}`;
  const known = people.get(k);
  if (known) return JSON.parse(known);
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`${role}.hri47.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `${role} hari ini` });
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId, staffId, role });
    if (branchId) await assignBranch(c, { tenantId, staffRoleId: rid, branchId });
  } finally {
    c.release();
  }
  people.set(k, JSON.stringify({ acc, staffId }));
  return { acc, staffId };
}
async function as<T>(env: IsolationEnv, tenantId: string, fn: (db: never) => Promise<T>, role: "owner" | "facility_head" = "owner", branchId?: string): Promise<T> {
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const p = await personOf(env, tenantId, role, branchId);
  const ctx = await resolveContext(env.app, p.acc, { tenantId, actingRole: role, activeBranchId: role === "owner" ? undefined : branchId });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}

const services = new Map<string, string>();
async function serviceOf(env: IsolationEnv): Promise<string> {
  const t = env.victim.tenantId;
  const known = services.get(t);
  if (known) return known;
  const b = env.victim.branchId;
  // The branch is shared with other cases: only names of our own are added (no hours: check-in does not
  // read them, and the appointments are inserted directly).
  await personOf(env, t, "facility_head", b);
  await as(env, t, (db) => upsertRoom(db, b, { name: "Konsul Hari Ini", kind: "consultation" }));
  const v = await as(env, t, (db) => publish(db, { kind: "service", code: "KONSULHI" }, {
    name: "Konsultasi Hari Ini", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 100_000, category: "consultation",
    prep_min: 0, treatment_min: 30, buffer_min: 0, indications: "I", contraindications: "K", consent_template: "T", delegation: "D",
    aftercare_text: "A", eligibility: [{ role: "doctor", mode: "performs" }], resources: [{ kind: "room", code: "consultation" }],
  } as never, "Layanan baru"));
  if (v.approvalId) await as(env, t, (db) => decideApproval(db, v.approvalId!, true), "facility_head", b);
  await as(env, t, (db) => setServices(db, b, [v.itemId]));
  services.set(t, v.versionId);
  return v.versionId;
}

let runs = 0;
const latest = new Map<string, { name: string; appt: string; visit: string }>();
// A fresh secret patient in B with an appointment of now (for check-in) and a second appointment already
// checked in and settled (for close). Inserted directly: the case does not depend on booking.
async function victim(env: IsolationEnv) {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const version = await serviceOf(env);
  const doc = await personOf(env, t, "doctor", b);
  const name = `Pasien Rahasia Hari ${t.slice(0, 8)} ${++runs}`;
  const pt = async (n: string) => (await env.owner.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $2, '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture', 'islam', 'Karyawan', 's1', 'kawin', $3, $4, 'fo_cashier') returning id`,
    [t, n, b, doc.staffId],
  )).rows[0].id as string;
  const p1 = await pt(name);
  const p2 = await pt(`${name} B`);
  const s0 = new Date(Math.floor(Date.now() / 900_000) * 900_000);
  const e0 = new Date(s0.getTime() + 30 * 60_000);
  const mk = async (p: string, state: string) => (await env.owner.query(
    `insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state, channel, created_by, created_as, state_changed_at, state_changed_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'phone', $5, 'fo_cashier', case when $8 = 'arrived' then now() end, case when $8 = 'arrived' then $5::uuid end) returning id`,
    [t, b, p, version, doc.staffId, s0, e0, state],
  )).rows[0].id as string;
  await env.owner.query(`alter table appointments disable trigger appointments_guard`);
  let appt: string;
  let arrived: string;
  try {
    appt = await mk(p1, "booked");
    arrived = await mk(p2, "arrived");
  } finally {
    await env.owner.query(`alter table appointments enable always trigger appointments_guard`);
  }
  const visit = (await env.owner.query(
    `insert into visits (tenant_id, branch_id, patient_id, appointment_id, kind, checked_in_by, payment) values ($1, $2, $3, $4, 'booked', $5, 'done') returning id`,
    [t, b, p2, arrived, doc.staffId],
  )).rows[0].id as string;
  for (const s of [name, p1, p2, appt, arrived, visit]) env.victimSecret(s);
  const r = { name, appt, visit };
  latest.set(t, r);
  return r;
}
const outcome = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));
const board = async (env: IsolationEnv) => {
  await victim(env);
  return as(env, env.actor.tenantId, (db) => today(db as never, env.victim.branchId).then(
    (x) => ({ status: 200, body: JSON.parse(JSON.stringify(x)) }),
    (e) => (e instanceof CommandError && e.code === "ERR_NOT_FOUND" ? { status: 404, body: null } : Promise.reject(e)),
  ));
};
const marker = (env: IsolationEnv) => latest.get(env.victim.tenantId)?.name ?? "";

export default defineCases(
  { kind: "route", id: "/hari-ini", expect: "not-found", marker, run: board },
  { kind: "route", id: "/hari-ini/check-in", expect: "not-found", marker, run: board },
  { kind: "route", id: "/hari-ini/papan", expect: "not-found", marker, run: board },
  {
    kind: "action",
    id: "app/(app)/hari-ini/actions",
    // The new visit's id comes back only from a successful check-in (the positive control).
    marker: (env) => latest.get(env.victim.tenantId)?.appt ?? "",
    async run(env) {
      const v = await victim(env);
      const me = env.actor.tenantId;
      const c = as(env, me, (db) => checkIn(db, crypto.randomUUID(), v.appt));
      const check = await outcome(c);
      const close = await outcome(as(env, me, (db) => closeVisit(db, crypto.randomUUID(), v.visit)));
      return { attempts: { check, close }, body: { check, close, appt: check === "done" ? v.appt : null } };
    },
  },
);
