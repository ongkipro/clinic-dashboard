// Jadwal (UX-5, PR-83, T-045): the page renders a branch's calendar (appointments_window) and the
// actions confirm, cancel, mark no-show and reschedule. Each case seeds in B a booked appointment for a
// secret patient, then runs as A's owner: none of B's rows appear; B's branch and appointment are not
// found; every write onto B's appointment is refused.
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { decideApproval } from "../../../src/modules/approvals/approvals";
import { publish } from "../../../src/modules/catalog/catalog";
import { setHours, setServices, upsertRoom } from "../../../src/modules/org/branches/branches";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { calendar, cancelAppointment, confirmAttendance, markNoShow, reschedule } from "../../../src/modules/scheduling/appointments/appointments";
import { setWeek } from "../../../src/modules/scheduling/rosters/rosters";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

const people = new Map<string, string>();
async function personOf(env: IsolationEnv, tenantId: string, role: "owner" | "doctor" | "facility_head", branchId?: string): Promise<{ acc: string; staffId: string }> {
  const k = `${tenantId}:${role}`;
  const known = people.get(k);
  if (known) return JSON.parse(known);
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`${role}.jdw45.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `${role} jadwal` });
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
  // Appointment writers need a live tenant (as pasien-baru.cases.ts, T-037).
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const p = await personOf(env, tenantId, role, branchId);
  const ctx = await resolveContext(env.app, p.acc, { tenantId, actingRole: role, activeBranchId: role === "owner" ? undefined : branchId });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}
const day = (n: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(Date.now() + n * 86_400_000));
const monday = (d: string) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
};
const at = (d: string, t: string) => new Date(`${d}T${t}:00+07:00`);

const seeded = new Map<string, { appt: string; appts: string[]; name: string; d: string }>();
async function victim(env: IsolationEnv) {
  const t = env.victim.tenantId;
  const known = seeded.get(t);
  if (known) return known;
  const b = env.victim.branchId;
  const doc = await personOf(env, t, "doctor", b);
  await personOf(env, t, "facility_head", b);
  await as(env, t, (db) => setHours(db, b, [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "07:00", closes: "22:00" }))));
  await as(env, t, (db) => upsertRoom(db, b, { name: "Konsul Iso", kind: "consultation" }));
  const v = await as(env, t, (db) => publish(db, { kind: "service", code: "ISO-45" }, {
    name: "Konsultasi Iso", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 100_000, category: "consultation",
    prep_min: 0, treatment_min: 30, buffer_min: 0, indications: "I", contraindications: "K", consent_template: "T", delegation: "D",
    aftercare_text: "A", eligibility: [{ role: "doctor", mode: "performs" }], resources: [{ kind: "room", code: "consultation" }],
  } as never, "Layanan baru"));
  if (v.approvalId) await as(env, t, (db) => decideApproval(db, v.approvalId!, true), "facility_head", b);
  await as(env, t, (db) => setServices(db, b, [v.itemId]));
  const d = day(9);
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => { const x = new Date(`${monday(d)}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + i); return x.toISOString().slice(0, 10); });
  await as(env, t, (db) => setWeek(db, b, monday(d), [doc.staffId], days.map((x) => ({ staffId: doc.staffId, date: x, starts: "07:00", ends: "22:00", kind: "work" as const }))));
  const name = `Pasien Rahasia ${t.slice(0, 8)}`;
  const pt = (await env.owner.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || lpad((floor(random() * 900000) + 100000)::text, 6, '0'), $2, '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture', 'islam', 'Karyawan', 's1', 'kawin', $3, $4, 'fo_cashier') returning id`,
    [t, name, b, doc.staffId],
  )).rows[0].id as string;
  // The fixture appointment and its reservations are inserted directly (guards satisfied: booked,
  // active, the room and the performer), so the case does not depend on the booking engine.
  const room = (await env.owner.query(`select id from rooms where tenant_id = $1 and branch_id = $2 limit 1`, [t, b])).rows[0].id as string;
  // One appointment per attempt (confirm, reschedule, no-show, cancel), so each runs on a booked row in
  // the positive control; the no-show one started an hour ago.
  const appts: string[] = [];
  const past = new Date(Math.floor((Date.now() - 3_600_000) / 900_000) * 900_000);
  for (const [i, s0] of [at(d, "10:00"), at(d, "12:00"), past, at(d, "16:00")].entries()) {
    const e0 = new Date(s0.getTime() + 30 * 60_000);
    if (i === 2) await env.owner.query(`alter table appointments disable trigger appointments_guard`);
    try {
      const id = (await env.owner.query(
        `insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state, channel, created_by, created_as)
         values ($1, $2, $3, $4, $5, $6, $7, 'booked', 'phone', $5, 'fo_cashier') returning id`,
        [t, b, pt, v.versionId, doc.staffId, s0, e0],
      )).rows[0].id as string;
      for (const [kind, rid] of [["staff", doc.staffId], ["room", room]]) {
        await env.owner.query(`insert into resource_reservations (tenant_id, branch_id, appointment_id, kind, resource_id, starts_at, ends_at) values ($1, $2, $3, $4, $5, $6, $7)`,
          [t, b, id, kind, rid, s0, e0]);
      }
      appts.push(id);
    } finally {
      if (i === 2) await env.owner.query(`alter table appointments enable always trigger appointments_guard`);
    }
  }
  const appt = appts[3];
  for (const s of [name, pt, ...appts]) env.victimSecret(s);
  const r = { appt, appts, name, d };
  seeded.set(t, r);
  return r;
}
const refused = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));

export default defineCases(
  {
    kind: "route",
    id: "/jadwal",
    expect: "not-found",
    marker: (env) => seeded.get(env.victim.tenantId)?.name ?? "",
    async run(env) {
      const v = await victim(env);
      // The calendar of the victim branch, as the caller (B itself for the positive control; A must get
      // not-found and nothing of B).
      const out = await as(env, env.actor.tenantId, (db) => calendar(db as never, env.victim.branchId, v.d, v.d).then(
        (c) => ({ status: 200, body: JSON.parse(JSON.stringify(c)) }),
        (e) => (e instanceof CommandError && e.code === "ERR_NOT_FOUND" ? { status: 404, body: null } : Promise.reject(e)),
      ));
      return out;
    },
  },
  {
    kind: "action",
    id: "app/(app)/jadwal/actions",
    marker: (env) => seeded.get(env.victim.tenantId)?.appt ?? "",
    async run(env) {
      const v = await victim(env);
      const me = env.actor.tenantId;
      const [a1, a2, a3, a4] = v.appts;
      const confirm = await refused(as(env, me, (db) => confirmAttendance(db, crypto.randomUUID(), a1)));
      const move = await refused(as(env, me, (db) => reschedule(db, crypto.randomUUID(), a2, at(v.d, "13:00"), null)));
      const noShow = await refused(as(env, me, (db) => markNoShow(db, crypto.randomUUID(), a3)));
      const cancel = await refused(as(env, me, (db) => cancelAppointment(db, crypto.randomUUID(), a4, "Uji isolasi")));
      const attempts = { confirm, move, noShow, cancel };
      return { attempts, body: { ...attempts, appt: cancel === "done" ? v.appt : null } };
    },
  },
);
