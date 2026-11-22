// Ringkasan Cabang (UX-21, PR-33b; T-110): the DEL-2 case for the route /ringkasan/cabang (auto-discovered by tests/isolation/isolation.test.ts;
// the route id is the page's path without the (app) group). Until the page is mounted the coverage gate reports this case as "a surface that
// does not exist" (as every parked DEL-2 case); the case itself runs now.
//
// The case runs the loader core (src/app/(app)/ringkasan/cabang/load.ts cabangIn: the function the page calls, over the real readers) as the
// CALLER's own manager. The branch is the server-resolved ACTIVE branch (never a query parameter), so the cross-tenant selector is the active
// branch id itself. Dedicated synthetic fixture, so no other case's stock can change it: in tenant B a branch of its own ("Cabang Rahasia
// Ringkasan") holds ONE stock item below its minimum (3 fit < minimum 5, Scenario PR-33b) through the real writers, seeded once per tenant.
//   - positive control (B's manager on the dedicated branch): ok, and the below-minimum list is EXACTLY that item (3 of 5, asserted here);
//   - negative (A's manager): the dedicated branch id as the active branch is NOT FOUND (TEN-1: the readers cannot see another tenant's
//     branch; never forbidden, never data); A's own summary (A's own branch) carries nothing of B (item id and name, branch id and name).
//     Both answers are in the body.
// route kind "not-found". Owner and admin_pusat are routed elsewhere by the loader (ROUTE_FOR), so the case uses the manager, the page's reader.
import { cabangIn } from "../../../src/app/(app)/ringkasan/cabang/load";
import { withTenantContext } from "../../../src/db/rls/context";
import { publish } from "../../../src/modules/catalog/catalog";
import { receiveCosted } from "../../../src/modules/inventory/costing/costing";
import { saveItem, setLevel } from "../../../src/modules/inventory/stock";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

type CaseRole = "owner" | "manager" | "pharmacist";
const accOf = new Map<string, string>();
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole): Promise<string> {
  const k = `${tenantId}:${branchId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email, two_factor_enabled) values ('Staf', $1, true) returning id`,
    [`${role}.rc110.${branchId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Cabang ${role}` });
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId, staffId, role });
    if (role !== "owner") await assignBranch(c, { tenantId, staffRoleId: rid, branchId });
  } finally {
    c.release();
  }
  accOf.set(k, acc);
  return acc;
}
async function as<T>(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole, fn: (db: never) => Promise<T>): Promise<T> {
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const acc = await member(env, tenantId, branchId, role);
  const ctx = await resolveContext(env.app, acc, { tenantId, actingRole: role, activeBranchId: role === "owner" ? undefined : branchId });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}

type Seed = { branch: string; item: string };
const seeded = new Map<string, Seed>();
// One below-minimum item per tenant B on its own branch (both runs reuse it): the exact list check needs exactly one row there.
async function victim(env: IsolationEnv): Promise<Seed> {
  const t = env.victim.tenantId;
  const known = seeded.get(t);
  if (known) return known;
  const k = () => crypto.randomUUID();
  const branchName = "Cabang Rahasia Ringkasan";
  const itemName = "Bahan Rahasia Cabang";
  const branch = (await env.owner.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'RCB2', $2, 'Asia/Jakarta') returning id`, [t, branchName])).rows[0].id as string;
  const { itemId: cat } = await as(env, t, branch, "owner", (db) => publish(db, { kind: "material", code: `RCB-${t.slice(0, 6).toUpperCase()}` },
    { name: itemName, tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1_000 } as never, "Bahan"));
  const item = (await as(env, t, branch, "pharmacist", (db) => saveItem(db, k(), null, { catalogItemId: cat, unit: "pak", storage: "ruang", highValue: false, active: true }))).itemId as string;
  const expiry = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10);
  await as(env, t, branch, "pharmacist", (db) => receiveCosted(db, k(), null, { itemId: item, batchNo: "RCB-1", expiry, quantity: "3", reason: "penerimaan", unitCost: 1_000 }));
  await as(env, t, branch, "pharmacist", (db) => setLevel(db, k(), null, item, "5", "10"));
  for (const x of [branch, branchName, item, itemName]) env.victimSecret(x);
  const s = { branch, item };
  seeded.set(t, s);
  return s;
}
const marker = (env: IsolationEnv) => seeded.get(env.victim.tenantId)?.item ?? "";

export default defineCases({
  kind: "route",
  id: "/ringkasan/cabang",
  expect: "not-found",
  marker,
  async run(env) {
    const v = await victim(env);
    const mine = env.actor.tenantId === env.victim.tenantId;
    // B's manager is assigned to the dedicated branch; A's manager to A's own branch, and asks with B's branch id as its active branch
    return as(env, env.actor.tenantId, mine ? v.branch : env.actor.branchId, "manager", async (db) => {
      const byBranch = await cabangIn(db, "manager", v.branch, {});
      if (byBranch.kind === "not-found") {
        const own = await cabangIn(db, "manager", env.actor.branchId, {});
        return { status: 404, body: JSON.parse(JSON.stringify({ own })) };
      }
      if (byBranch.kind !== "ok" || byBranch.state.kind !== "ok") throw new Error(`unexpected ${byBranch.kind}/${"state" in byBranch ? byBranch.state.kind : ""}`);
      // positive control (B itself): exactly the one seeded below-minimum item, 3 fit of a minimum 5
      const below = byBranch.state.summary.below;
      const rows = below.kind === "rows" ? below.rows : [];
      if (rows.length !== 1 || rows[0].itemId !== v.item || rows[0].onHand !== 3 || rows[0].minQty !== 5) throw new Error(`below-minimum list is ${JSON.stringify(below)}`);
      return { status: 200, body: JSON.parse(JSON.stringify({ byBranch })) };
    });
  },
});
