// Ringkasan CS (UX-36, PR-33e; T-113): the DEL-2 case for the route /ringkasan/cs (approved expansion: this file only). Auto-discovered by
// tests/isolation/isolation.test.ts; the route id is the page's file path without the (app) group. The page itself is mounted later (P2):
// until then the coverage gate reports "case for a surface that does not exist" for this id — that is expected before mount and clears
// when src/app/(app)/ringkasan/cs/page.tsx lands.
//
// The case runs the loader core (src/app/(app)/ringkasan/cs/load.ts: the function the page calls, over the real dashboard_kpi / lead_list +
// branch_is_open / survey_summary readers) as the CALLER's own central CS while tenant B holds one waiting lead: unanswered, entered inside
// B's opening hours (B's branch open around the clock), 40 minutes ago — so it is in B's waiting list (and overdue against SET-20).
//   - positive control (as B's central CS, ?cabang=<B's branch>): the summary lists B's lead (marker = its id);
//   - negative (as A's central CS): B's branch id asked as ?cabang= is NOT FOUND (TEN-1, never forbidden, never data), and A's own
//     all-branch summary carries nothing of B (lead id, branch id and name, tenant). Both answers are returned in the body.
// route kind "not-found": the selector (?cabang=) answers 404 for another tenant's branch.
import { csIn } from "../../../src/app/(app)/ringkasan/cs/load";
import { withTenantContext } from "../../../src/db/rls/context";
import { assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

const accOf = new Map<string, string>();
const staffOf = new Map<string, string>();
// central CS is tenant-wide: a role row, no branch assignment (the level-3 check refuses a branch for it)
async function centralCs(env: IsolationEnv, tenantId: string): Promise<string> {
  const known = accOf.get(tenantId);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email, two_factor_enabled) values ('Staf', $1, true) returning id`,
    [`central_cs.rcs113.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: "Staf Ringkasan CS" });
  staffOf.set(tenantId, staffId);
  const c = await env.owner.connect();
  try {
    await assignRole(c, { tenantId, staffId, role: "central_cs" });
  } finally {
    c.release();
  }
  accOf.set(tenantId, acc);
  return acc;
}
async function asCs<T>(env: IsolationEnv, tenantId: string, fn: (db: never) => Promise<T>): Promise<T> {
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const acc = await centralCs(env, tenantId);
  const ctx = await resolveContext(env.app, acc, { tenantId, actingRole: "central_cs" });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}

// Raw seeding with the named triggers paused (the writers cannot set created_at; the pr-33e seedRaw pattern), owner pool only.
async function seedRaw(env: IsolationEnv, tables: string[], fn: () => Promise<void>) {
  const off: [string, string][] = [];
  for (const tb of tables) for (const r of (await env.owner.query(`select tgname from pg_trigger where tgrelid = $1::regclass and not tgisinternal and tgenabled <> 'D'`, [tb])).rows) off.push([tb, r.tgname]);
  for (const [tb, tg] of off) await env.owner.query(`alter table ${tb} disable trigger ${tg}`);
  try { await fn(); } finally { for (const [tb, tg] of off) await env.owner.query(`alter table ${tb} enable always trigger ${tg}`); }
}

const latest = new Map<string, string>(); // victim tenant → its waiting lead id (the marker)
async function victim(env: IsolationEnv): Promise<string> {
  const t = env.victim.tenantId, b = env.victim.branchId;
  const known = latest.get(t);
  if (known) return known;
  await centralCs(env, t);
  const staffId = staffOf.get(t)!;
  let lead = "";
  await seedRaw(env, ["branch_hours", "leads"], async () => {
    // B's branch open around the clock (every weekday), so "entered while open" holds whatever the run time
    await env.owner.query(`insert into branch_hours (tenant_id, branch_id, weekday, opens, closes)
                           select $1, $2, wd, '00:00', '23:59:59.999999' from generate_series(0, 6) wd
                           on conflict do nothing`, [t, b]);
    lead = (await env.owner.query(`insert into leads (tenant_id, branch_id, source, stage, created_by, created_as, command_key, created_at)
                                   values ($1, $2, 'ads', 'new', $3, 'central_cs', $4, now() - interval '40 minutes') returning id`,
      [t, b, staffId, `ld-rcs-${crypto.randomUUID()}`])).rows[0].id as string;
  });
  env.victimSecret(lead);
  latest.set(t, lead);
  return lead;
}

export default defineCases({
  kind: "route",
  id: "/ringkasan/cs",
  expect: "not-found",
  marker: (env) => latest.get(env.victim.tenantId) ?? "",
  async run(env) {
    await victim(env);
    return asCs(env, env.actor.tenantId, async (db) => {
      const byBranch = await csIn(db, { cabang: env.victim.branchId }, new Date());
      const all = await csIn(db, {}, new Date());
      const plain = (x: unknown) => JSON.parse(JSON.stringify(x));
      if (byBranch.kind === "not-found") return { status: 404, body: plain({ all }) };
      return { status: 200, body: plain({ byBranch, all }) };
    });
  },
});
