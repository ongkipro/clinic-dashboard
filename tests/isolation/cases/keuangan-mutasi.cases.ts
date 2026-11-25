// Mutasi Pembayaran (UX-22 ▸ Mutasi, PR-33f): DEL-2 isolation case for /keuangan/mutasi.
import { loadMutasiIn, todayJakarta } from "../../../src/app/(app)/keuangan/mutasi/data";
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { topUpBalance } from "../../../src/modules/packages/packages";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

type CaseRole = "finance" | "fo_cashier";
const accOf = new Map<string, string>();
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole): Promise<string> {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (
    await env.owner.query(
      `insert into auth_user (name, email, two_factor_enabled) values ('Staf', $1, true) returning id`,
      [`${role}.mutasi.${tenantId}@klinik-sintetis.test`],
    )
  ).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Mutasi ${role}` });
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId, staffId, role });
    if (role === "fo_cashier") await assignBranch(c, { tenantId, staffRoleId: rid, branchId });
  } finally {
    c.release();
  }
  accOf.set(k, acc);
  return acc;
}
async function as<T>(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole, fn: (db: never) => Promise<T>): Promise<T> {
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const acc = await member(env, tenantId, branchId, role);
  const ctx = await resolveContext(env.app, acc, {
    tenantId,
    actingRole: role,
    activeBranchId: role === "fo_cashier" ? branchId : undefined,
  });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}

let runs = 0;
const latest = new Map<string, string>();
async function victim(env: IsolationEnv): Promise<string> {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const n = ++runs;
  const pid = (
    await env.owner.query(
      `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
       values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Pasien Mutasi Rahasia', '1991-01-01', 'female', 'newborn_via_guardian', 'Fixture sintetis', 'islam',
               'Karyawan', 's1', 'kawin', $2, (select id from staff where tenant_id = $1 limit 1), 'fo_cashier') returning id`,
      [t, b],
    )
  ).rows[0].id as string;
  const amount = 719_100 + n * 7;
  await as(env, t, b, "fo_cashier", (db) =>
    topUpBalance(db, crypto.randomUUID(), pid, null, { method: "cash", amount, cashTendered: amount }),
  );
  const m = String(amount);
  env.victimSecret(m);
  latest.set(t, m);
  return m;
}
const marker = (env: IsolationEnv) => latest.get(env.victim.tenantId) ?? "";

export default defineCases({
  kind: "route",
  id: "/keuangan/mutasi",
  expect: "not-found",
  marker,
  async run(env) {
    await victim(env);
    const t = todayJakarta();
    const from = `${t.slice(0, 8)}01`;
    return as(env, env.actor.tenantId, env.actor.branchId, "finance", async (db) => {
      const all = await loadMutasiIn(db, { from, to: t, branchId: null });
      try {
        const byBranch = await loadMutasiIn(db, { from, to: t, branchId: env.victim.branchId });
        return { status: 200, body: JSON.parse(JSON.stringify({ byBranch, all })) };
      } catch (e) {
        if (e instanceof CommandError && e.code === "ERR_NOT_FOUND") {
          return { status: 404, body: JSON.parse(JSON.stringify({ all })) };
        }
        throw e;
      }
    });
  },
});
