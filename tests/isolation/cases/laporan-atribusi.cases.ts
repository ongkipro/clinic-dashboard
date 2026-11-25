// Atribusi & Sumber Rujukan (19 §2.10, UX-38 report, K13): DEL-2 isolation case for /laporan/atribusi.
import { loadAtribusiIn, todayJakarta } from "../../../src/app/(app)/laporan/atribusi/data";
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { createLead } from "../../../src/modules/crm/leads/leads";
import { assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

type CaseRole = "marketing" | "central_cs";
const accOf = new Map<string, string>();
async function member(env: IsolationEnv, tenantId: string, role: CaseRole): Promise<string> {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (
    await env.owner.query(
      `insert into auth_user (name, email, two_factor_enabled) values ('Staf', $1, true) returning id`,
      [`${role}.atribusi.${tenantId}@klinik-sintetis.test`],
    )
  ).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Atribusi ${role}` });
  const c = await env.owner.connect();
  try {
    await assignRole(c, { tenantId, staffId, role });
  } finally {
    c.release();
  }
  accOf.set(k, acc);
  return acc;
}
async function as<T>(env: IsolationEnv, tenantId: string, role: CaseRole, fn: (db: never) => Promise<T>): Promise<T> {
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const acc = await member(env, tenantId, role);
  const ctx = await resolveContext(env.app, acc, { tenantId, actingRole: role });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}

let runs = 0;
const latest = new Map<string, string>();
async function victim(env: IsolationEnv): Promise<{ branchId: string; branchName: string }> {
  const t = env.victim.tenantId;
  const n = ++runs;
  const bName = `Cabang Atribusi Rahasia ${n}`;
  const bCode = `ATR${n}${Math.floor(Math.random() * 90 + 10)}`;
  const branchId = (
    await env.owner.query(
      `insert into branches (tenant_id, code, name, timezone) values ($1, $2, $3, 'Asia/Jakarta') returning id`,
      [t, bCode, bName],
    )
  ).rows[0].id as string;
  await as(env, t, "central_cs", (db) =>
    createLead(db, crypto.randomUUID(), { source: "referral", branchId }),
  );
  env.victimSecret(bName);
  env.victimSecret(branchId);
  latest.set(t, bName);
  return { branchId, branchName: bName };
}
const marker = (env: IsolationEnv) => latest.get(env.victim.tenantId) ?? "";

export default defineCases({
  kind: "route",
  id: "/laporan/atribusi",
  expect: "not-found",
  marker,
  async run(env) {
    const t = todayJakarta();
    const from = `${t.slice(0, 8)}01`;
    const isCrossTenant = env.actor.tenantId !== env.victim.tenantId;
    const actorBefore = isCrossTenant
      ? await as(env, env.actor.tenantId, "marketing", (db) => loadAtribusiIn(db, { from, to: t, branchId: null }))
      : null;

    const seeded = await victim(env);

    // Positive control: victim's own marketing user MUST see the seeded branch and >= 1 lead there.
    const victimOwn = await as(env, env.victim.tenantId, "marketing", (db) =>
      loadAtribusiIn(db, { from, to: t, branchId: seeded.branchId }),
    );
    if (victimOwn.totals.lead < 1 || !victimOwn.byBranch.some((b) => b.key === seeded.branchId && b.lead >= 1)) {
      throw new Error(`Victim positive control failed for seeded branch ${seeded.branchId}`);
    }

    return as(env, env.actor.tenantId, "marketing", async (db) => {
      const all = await loadAtribusiIn(db, { from, to: t, branchId: null });
      const aggregateLeaked =
        isCrossTenant &&
        actorBefore !== null &&
        (all.totals.lead !== actorBefore.totals.lead ||
          all.totals.booked !== actorBefore.totals.booked ||
          all.totals.arrived !== actorBefore.totals.arrived ||
          all.totals.paid !== actorBefore.totals.paid);
      try {
        const byBranch = await loadAtribusiIn(db, { from, to: t, branchId: seeded.branchId });
        return { status: 200, body: JSON.parse(JSON.stringify({ byBranch, all })) };
      } catch (e) {
        if (e instanceof CommandError && e.code === "ERR_NOT_FOUND") {
          if (aggregateLeaked) {
            return {
              status: 200,
              body: JSON.parse(JSON.stringify({ aggregateLeaked: true, leakedMarker: seeded.branchName, all })),
            };
          }
          return { status: 404, body: JSON.parse(JSON.stringify({ all })) };
        }
        throw e;
      }
    });
  },
});
