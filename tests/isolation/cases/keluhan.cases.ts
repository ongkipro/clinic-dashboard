// Keluhan (UX-28, PR-43, T-057): the complaint list (complaint_list), one task (complaint_get), the flag form's
// visits (complaint_flag_options), and the actions (flag, take, triage, note, resolve, reopen). Each run seeds in B
// a fresh patient with a visit and a klinis task flagged by B's doctor, then runs as a doctor of the caller's own
// branch: B's branch list, task and flag options are not found; every write on B's task, patient or visit is
// refused. As B's doctor (positive control) everything succeeds. Synthetic data on a local database (MIG-2).
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import {
  flagComplaint, flagOptions, getComplaint, listComplaints, noteComplaint, reopenComplaint, resolveComplaint, takeComplaint, triageComplaint,
} from "../../../src/modules/clinical/complaints/complaints";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

const accOf = new Map<string, string>();
async function member(env: IsolationEnv, tenantId: string, branchId: string): Promise<string> {
  const known = accOf.get(tenantId);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email, two_factor_enabled) values ('Staf', $1, true) returning id`, [`doctor.klh57.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: "Dokter Keluhan" });
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId, staffId, role: "doctor" });
    await assignBranch(c, { tenantId, staffRoleId: rid, branchId });
  } finally {
    c.release();
  }
  accOf.set(tenantId, acc);
  return acc;
}
async function as<T>(env: IsolationEnv, tenantId: string, branchId: string, fn: (db: never) => Promise<T>): Promise<T> {
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const acc = await member(env, tenantId, branchId);
  const ctx = await resolveContext(env.app, acc, { tenantId, actingRole: "doctor", activeBranchId: branchId });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}
const asDoctor = <T>(env: IsolationEnv, fn: (db: never) => Promise<T>) => as(env, env.actor.tenantId, env.actor.branchId, fn);

let runs = 0;
const latest = new Map<string, { name: string; patient: string; visit: string; task: string; resolved: string }>();
async function victim(env: IsolationEnv) {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const doc = <T>(fn: (db: never) => Promise<T>) => as(env, t, b, fn);
  await member(env, t, b);
  const staff = (await env.owner.query(`select s.id from staff s join memberships m on m.id = s.membership_id where m.account_id = $1`, [accOf.get(t)])).rows[0].id as string;
  const name = `Pasien Rahasia Keluhan ${t.slice(0, 8)} ${++runs}`;
  const id = crypto.randomUUID().replace(/-/g, "");
  const patient = (await env.owner.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education, marital_status,
                           registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $2, '1990-01-01', 'female', 'nik', $5, $6, 'islam', 'Karyawan', 's1', 'kawin', $3, $4, 'fo_cashier') returning id`,
    [t, name, b, staff, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43)],
  )).rows[0].id as string;
  const visit = (await env.owner.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`, [t, b, patient, staff])).rows[0].id as string;
  const { taskId: task } = await doc((db) => flagComplaint(db, crypto.randomUUID(), { patientId: patient, visitId: visit, kind: "klinis", source: "visit_note", summary: "Keluhan rahasia isolasi", triage: "kuning" }));
  const { taskId: resolved } = await doc((db) => flagComplaint(db, crypto.randomUUID(), { patientId: patient, kind: "klinis", source: "staff_flag", summary: "Keluhan rahasia selesai" }));
  await doc((db) => resolveComplaint(db, crypto.randomUUID(), resolved, "edukasi", "Penyelesaian rahasia"));
  for (const s of [name, patient, visit, task, resolved]) env.victimSecret(s);
  const r = { name, patient, visit, task, resolved };
  latest.set(t, r);
  return r;
}
const outcome = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));
const notFound = (e: unknown) => (e instanceof CommandError && (e.code === "ERR_NOT_FOUND" || e.code === "ERR_FORBIDDEN") ? { status: 404, body: null } : Promise.reject(e));
const marker = (env: IsolationEnv) => latest.get(env.victim.tenantId)?.name ?? "";
const ok = (x: unknown) => ({ status: 200, body: JSON.parse(JSON.stringify(x)) });

export default defineCases(
  {
    kind: "route",
    id: "/keluhan",
    expect: "not-found",
    marker,
    async run(env) {
      await victim(env);
      return asDoctor(env, (db) => listComplaints(db as never, env.victim.branchId, null).then(ok, notFound));
    },
  },
  {
    kind: "route",
    id: "/keluhan/[id]",
    expect: "not-found",
    marker,
    async run(env) {
      const v = await victim(env);
      return asDoctor(env, (db) => getComplaint(db as never, v.task).then(ok, notFound));
    },
  },
  {
    kind: "route",
    id: "/keluhan/baru",
    expect: "not-found",
    marker,
    async run(env) {
      await victim(env);
      return asDoctor(env, (db) => flagOptions(db as never, env.victim.branchId).then(ok, notFound));
    },
  },
  {
    kind: "action",
    id: "app/(app)/keluhan/actions",
    marker,
    async run(env) {
      const v = await victim(env);
      const k = () => crypto.randomUUID();
      const attempts = {
        flag: await outcome(asDoctor(env, (db) => flagComplaint(db as never, k(), { patientId: v.patient, visitId: v.visit, kind: "klinis", source: "visit_note", summary: "Coba lintas" }))),
        take: await outcome(asDoctor(env, (db) => takeComplaint(db as never, k(), v.task))),
        triage: await outcome(asDoctor(env, (db) => triageComplaint(db as never, k(), v.task, "merah"))),
        note: await outcome(asDoctor(env, (db) => noteComplaint(db as never, k(), v.task, "Catatan lintas"))),
        resolve: await outcome(asDoctor(env, (db) => resolveComplaint(db as never, k(), v.task, "edukasi", "Selesai lintas"))),
        reopen: await outcome(asDoctor(env, (db) => reopenComplaint(db as never, k(), v.resolved, "Buka lintas"))),
      };
      const read = await asDoctor(env, (db) => getComplaint(db as never, v.task).then((x) => x.patient_name, () => null));
      return { attempts, body: { ...attempts, read } };
    },
  },
);
