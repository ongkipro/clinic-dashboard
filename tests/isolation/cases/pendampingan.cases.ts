// Pendampingan (UX-7, PR-9, T-051): the BC's queue of a branch (pendampingan_visits), one visit's flow page
// (pendampingan_visit) and the actions (open, save, send). Each run seeds in B a fresh patient with an open
// walk-in visit, then runs as a BC of the caller's own branch: B's branch queue is not found, B's visit page
// is not found, opening, saving and sending on B's visit or intake are refused. As B's BC (positive control)
// everything succeeds. Synthetic data on a local database (MIG-2).
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { openIntake, queue, saveIntake, sendIntake, visitIntake } from "../../../src/modules/clinical/intake/intake";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

const bcs = new Map<string, string>();
// A BC of the tenant's case branch (one per tenant; the acting BC of each run).
async function bcOf(env: IsolationEnv, tenantId: string, branchId: string): Promise<string> {
  const known = bcs.get(tenantId);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('BC', $1) returning id`, [`bc.pdm51.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: "BC Pendampingan" });
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId, staffId, role: "bc" });
    await assignBranch(c, { tenantId, staffRoleId: rid, branchId });
  } finally {
    c.release();
  }
  bcs.set(tenantId, acc);
  return acc;
}
async function asBc<T>(env: IsolationEnv, fn: (db: never) => Promise<T>): Promise<T> {
  const t = env.actor.tenantId;
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [t]);
  const acc = await bcOf(env, t, env.actor.branchId);
  const ctx = await resolveContext(env.app, acc, { tenantId: t, actingRole: "bc", activeBranchId: env.actor.branchId });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}

let runs = 0;
const latest = new Map<string, { name: string; visit: string; intake: string }>();
// A fresh secret patient in B with an open walk-in visit and a draft intake by B's BC.
async function victim(env: IsolationEnv) {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const bAcc = await bcOf(env, t, b);
  const by = (await env.owner.query(`select s.id from staff s join memberships m on m.id = s.membership_id where m.account_id = $1 and s.tenant_id = $2`, [bAcc, t])).rows[0].id as string;
  const name = `Pasien Rahasia Pendampingan ${t.slice(0, 8)} ${++runs}`;
  const patient = (await env.owner.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || lpad((floor(random() * 900000) + 100000)::text, 6, '0'), $2, '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture', 'islam', 'Karyawan', 's1', 'kawin', $3, $4, 'fo_cashier') returning id`,
    [t, name, b, by],
  )).rows[0].id as string;
  const visit = (await env.owner.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`, [t, b, patient, by])).rows[0].id as string;
  const ctx = await resolveContext(env.app, bAcc, { tenantId: t, actingRole: "bc", activeBranchId: b });
  const { intakeId: intake } = await withTenantContext(env.app, ctx, (db) => openIntake(db, crypto.randomUUID(), visit));
  for (const s of [name, patient, visit, intake]) env.victimSecret(s);
  const r = { name, visit, intake };
  latest.set(t, r);
  return r;
}
const outcome = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));
const notFound = (e: unknown) => (e instanceof CommandError && (e.code === "ERR_NOT_FOUND" || e.code === "ERR_FORBIDDEN") ? { status: 404, body: null } : Promise.reject(e));
const marker = (env: IsolationEnv) => latest.get(env.victim.tenantId)?.name ?? "";

export default defineCases(
  {
    kind: "route",
    id: "/pendampingan",
    expect: "not-found",
    marker,
    async run(env) {
      await victim(env);
      return asBc(env, (db) => queue(db as never, env.victim.branchId).then((x) => ({ status: 200, body: JSON.parse(JSON.stringify(x)) }), notFound));
    },
  },
  {
    kind: "route",
    id: "/pendampingan/[visitId]",
    expect: "not-found",
    marker,
    async run(env) {
      const v = await victim(env);
      return asBc(env, (db) => visitIntake(db as never, v.visit).then((x) => ({ status: 200, body: JSON.parse(JSON.stringify(x)) }), notFound));
    },
  },
  {
    kind: "action",
    id: "app/(app)/pendampingan/actions",
    // The complaint reaches the body only when the save succeeded and the page is read back (positive control).
    marker: (env) => latest.get(env.victim.tenantId)?.name ?? "",
    async run(env) {
      const v = await victim(env);
      const open = await outcome(asBc(env, (db) => openIntake(db as never, crypto.randomUUID(), v.visit)));
      const save = await outcome(asBc(env, (db) => saveIntake(db as never, crypto.randomUUID(), v.intake, { complaint: "Keluhan uji isolasi" })));
      const send = await outcome(asBc(env, (db) => sendIntake(db as never, crypto.randomUUID(), v.intake)));
      const read = await asBc(env, (db) => visitIntake(db as never, v.visit).then((x) => x.patient.name, () => null));
      return { attempts: { open, save, send }, body: { open, save, send, read } };
    },
  },
);
