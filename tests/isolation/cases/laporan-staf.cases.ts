// Laporan Staf (UX-38, PR-95; T-116): the DEL-2 case for the route /laporan/staf (auto-discovered by tests/isolation/isolation.test.ts; the route id is the page's path without the (app) group;
// no tests/isolation/surfaces.ts change).
//
// The case runs the page-data core (src/app/(app)/laporan/_components/load.ts reportIn: the function the page calls, over the real K15 / K17 / K19 / K27 readers) as the CALLER's own manager
// (a role of this report's nav row; it is bound to its own branch) while tenant B holds a real SIGNED examination: a visit, an examination opened by B's doctor and signed through the real
// record_sign (second factor enrolled, as the writer requires). K27 lists the doctor by DISPLAY NAME in its table (never a clinical field: the reader selects none), so B's doctor's name — unique per
// run — is the marker:
//   - positive control (as B's manager, on B's branch): B's own report table lists B's doctor by name with one signed examination;
//   - negative (as A's manager): B's branch id as ?cabang= is NOT FOUND (TEN-1, never forbidden, never data); A's own report carries nothing of B (the doctor's name, branch id and name, tenant id,
//     legal name). Both answers are returned in the body.
// route kind "not-found": the by-id selector (?cabang=) answers 404 for another tenant's branch.
import { reportIn } from "../../../src/app/(app)/laporan/_components/load";
import { withTenantContext } from "../../../src/db/rls/context";
import { openExam } from "../../../src/modules/clinical/exam/exam";
import { signRecord } from "../../../src/modules/clinical/records/records";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, type IsolationEnv } from "../case";
import { stepUpForTests } from "../../support/step-up";

process.env.DEPLOY_ENV = "local";

type CaseRole = "doctor" | "manager" | "owner";
const accOf = new Map<string, string>();
const nameOf = new Map<string, string>();
// A staff member of the tenant's case branch in a role (one per tenant and role). The doctor's display name is unique per tenant: the marker.
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole): Promise<string> {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  // two_factor_enabled: record_sign requires the signer's second factor to be enrolled
  const acc = (await env.owner.query(`insert into auth_user (name, email, two_factor_enabled) values ('Staf', $1, true) returning id`, [`${role}.lps116.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const display = role === "doctor" ? `dr. Rahasia Laporan ${tenantId.slice(0, 8)}` : `Staf Laporan Staf ${role}`;
  await createMembership(env.owner, { tenantId, accountId: acc, displayName: display });
  const staffId = (await env.owner.query(`select s.id from staff s join memberships m on m.tenant_id = s.tenant_id and m.id = s.membership_id where s.tenant_id = $1 and m.account_id = $2`, [tenantId, acc])).rows[0].id as string;
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId, staffId, role });
    if (role !== "owner") await assignBranch(c, { tenantId, staffRoleId: rid, branchId });
  } finally {
    c.release();
  }
  accOf.set(k, acc);
  nameOf.set(k, display);
  return acc;
}
async function as<T>(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole, fn: (db: never) => Promise<T>): Promise<T> {
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const acc = await member(env, tenantId, branchId, role);
  const ctx = await resolveContext(env.app, acc, { tenantId, actingRole: role, activeBranchId: role === "owner" ? undefined : branchId });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}

let runs = 0;
async function victim(env: IsolationEnv): Promise<string> {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  await member(env, t, b, "doctor");
  const doctor = nameOf.get(`${t}:doctor`)!;
  const docStaff = (await env.owner.query(`select s.id from staff s where s.tenant_id = $1 and s.display_name = $2`, [t, doctor])).rows[0].id as string;
  // a patient and an open visit at B's branch, an examination opened by B's doctor and signed (the writer: second factor + the author signs)
  const n = ++runs;
  const patient = (await env.owner.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $2, '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture sintetis', 'islam', 'Karyawan', 's1', 'kawin', $3, $4, 'fo_cashier')
     returning id`, [t, `Pasien Rahasia Staf ${t.slice(0, 8)} ${n}`, b, docStaff])).rows[0].id as string;
  const visit = (await env.owner.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`, [t, b, patient, docStaff])).rows[0].id as string;
  const { examId } = await as(env, t, b, "doctor", (db) => openExam(db, crypto.randomUUID(), visit));
  await as(env, t, b, "doctor", (db) => signRecord(db, crypto.randomUUID(), examId, stepUpForTests()));
  env.victimSecret(doctor);
  return doctor;
}
const marker = (env: IsolationEnv) => nameOf.get(`${env.victim.tenantId}:doctor`) ?? "";

export default defineCases({
  kind: "route",
  id: "/laporan/staf",
  expect: "not-found",
  marker,
  async run(env) {
    await victim(env);
    return as(env, env.actor.tenantId, env.actor.branchId, "manager", async (db) => {
      // B's branch asked by the caller: a manager is bound to its own branch, so the readers answer not-found (TEN-1)
      const byBranch = await reportIn(db, "staf", "manager", { cabang: env.victim.branchId });
      const all = await reportIn(db, "staf", "manager", {});
      // the caller's own unfiltered report is returned in both outcomes: it must carry nothing of B (the harness checks every registered secret in the whole body)
      if (byBranch.kind === "not-found") return { status: 404, body: JSON.parse(JSON.stringify({ all })) };
      return { status: 200, body: JSON.parse(JSON.stringify({ byBranch, all })) };
    });
  },
});
