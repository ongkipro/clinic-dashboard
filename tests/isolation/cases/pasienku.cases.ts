// Pasienku (UX-35 BC home, PR-33d; T-112): the DEL-2 case for the route /pasienku. PARKED: target path tests/isolation/cases/pasienku.cases.ts (outside T-112's Allowed Paths;
// auto-discovered by tests/isolation/isolation.test.ts, so no surfaces.ts change; the route id is the page's file path without the (app) group).
//
// The case runs the loader's core (src/app/(app)/pasienku/load.ts: the same function the page calls, over the real target_mine / followup_list / pendampingan_visits readers)
// as the CALLER's own BC while tenant B holds a BC with a target of a unique amount, a due follow-up task and a sent intake still waiting for the doctor. Each run seeds in B,
// through B's own staff, a fresh patient with that task and that visit (unique names are registered as secrets):
//   - positive control (as B's BC): the summary carries B's target amount, the task and the waiting visit;
//   - negative (as A's BC, whose active branch is A's): nothing of B appears in what A receives, whether A's BC asks with her own branch or with B's branch id (a branch her tenant does
//     not show: the loader answers no-branch and reads nothing). A foreign branch is never forbidden and never data.
// route kind "filtered": a BC home lists the caller's own rows, it has no by-id selector that answers 404.
import { summaryIn } from "../../../src/app/(app)/pasienku/load";
import { withTenantContext } from "../../../src/db/rls/context";
import { setStaffTarget } from "../../../src/modules/commission/targets/targets";
import { openIntake, saveIntake, sendIntake } from "../../../src/modules/clinical/intake/intake";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

type CaseRole = "bc" | "owner" | "fo_cashier";
const people = new Map<string, { acc: string; staffId: string }>();
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole): Promise<{ acc: string; staffId: string }> {
  const k = `${tenantId}:${role}`;
  const known = people.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email, two_factor_enabled) values ('Staf', $1, true) returning id`, [`${role}.pk112.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Pasienku ${role}` });
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId, staffId, role });
    if (role !== "owner") await assignBranch(c, { tenantId, staffRoleId: rid, branchId });
  } finally {
    c.release();
  }
  const r = { acc, staffId };
  people.set(k, r);
  return r;
}
async function as<T>(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole, fn: (db: never) => Promise<T>): Promise<T> {
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const p = await member(env, tenantId, branchId, role);
  const ctx = await resolveContext(env.app, p.acc, { tenantId, actingRole: role, activeBranchId: role === "owner" ? undefined : branchId });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}

let runs = 0;
const latest = new Map<string, { target: number; patient: string }>();
async function victim(env: IsolationEnv) {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const n = ++runs;
  const bc = await member(env, t, b, "bc");
  const fo = await member(env, t, b, "fo_cashier");
  const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date()).slice(0, 7);
  const target = 70_000_000 + n * 1_000_003; // a unique, non-round amount: the marker, verbatim as K19's target
  await as(env, t, b, "owner", (db) => setStaffTarget(db as never, crypto.randomUUID(), bc.staffId, month, { closingValueTarget: target, plansTarget: 3 }));
  const id = crypto.randomUUID().replace(/-/g, "");
  const name = `Pasien Rahasia Pasienku ${t.slice(0, 8)} ${n}`;
  const pid = (await env.owner.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $2, '1990-01-01', 'female', 'nik', $3, $4, 'islam', 'Karyawan', 's1', 'kawin', $5, $6, 'fo_cashier') returning id`,
    [t, name, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43), b, fo.staffId])).rows[0].id as string;
  // a due control task assigned to B's BC, created the way the scan creates it (followup_create on the unbound owner connection)
  await env.owner.query(`select followup_create($1, $2, $3, 'control_due', 'consultation_control', $4, 'due', 'bc', $5, (clock_timestamp() at time zone 'Asia/Jakarta')::date - 2, clock_timestamp())`, [t, b, pid, crypto.randomUUID(), bc.staffId]);
  // a sent intake still waiting for the doctor, through the real intake writers
  const visit = (await env.owner.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`, [t, b, pid, fo.staffId])).rows[0].id as string;
  const { intakeId } = await as(env, t, b, "bc", (db) => openIntake(db as never, crypto.randomUUID(), visit));
  await as(env, t, b, "bc", (db) => saveIntake(db as never, crypto.randomUUID(), intakeId, { complaint: "Keluhan rahasia", facts: [{ kind: "allergy", value: "Tidak ada" }, { kind: "skincare", value: "Sabun" }, { kind: "medication", value: "Tidak ada" }] }));
  await as(env, t, b, "bc", (db) => sendIntake(db as never, crypto.randomUUID(), intakeId));
  for (const x of [name, pid, visit, bc.staffId]) env.victimSecret(x);
  latest.set(t, { target, patient: name });
  return { bc };
}
const marker = (env: IsolationEnv) => String(latest.get(env.victim.tenantId)?.target ?? "");
const ok = (x: unknown) => ({ status: 200, body: JSON.parse(JSON.stringify(x)) });

export default defineCases({
  kind: "route",
  id: "/pasienku",
  expect: "filtered",
  marker,
  async run(env) {
    await victim(env);
    const mine = await member(env, env.actor.tenantId, env.actor.branchId, "bc");
    const name = "Staf Pasienku bc";
    return as(env, env.actor.tenantId, env.actor.branchId, "bc", async (db) => {
      // her own branch: the summary of the caller's own BC (as B itself it carries B's marker, the positive control)
      const own = await summaryIn(db as never, "bc", env.actor.branchId, mine.staffId, name, new Date());
      // B's branch id as her active branch (negative only): the database does not show it to her tenant, so the loader reads nothing
      const foreign = env.actor.tenantId === env.victim.tenantId ? null : await summaryIn(db as never, "bc", env.victim.branchId, mine.staffId, name, new Date());
      return ok({ own, foreign });
    });
  },
});
