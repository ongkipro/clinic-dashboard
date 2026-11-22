// Laporan Stok (UX-38, PR-95; T-116): the DEL-2 case for the route /laporan/stok (auto-discovered by tests/isolation/isolation.test.ts; the route id is the page's path without the (app) group;
// no tests/isolation/surfaces.ts change).
//
// WHAT THIS CASE CAN AND CANNOT PROVE. The page shows K18 as THREE COUNTS ("Di bawah minimum", "Kedaluwarsa dekat", "Selisih hitung") and nothing else: no item name, no batch number, no branch name
// reaches it. A B-specific TEXT therefore cannot appear in the body, and this case does not pretend it can. The marker is a COUNT made distinctive: tenant B gets exactly SEVEN items below their branch
// minimum (a number no other fixture of the suite produces for this report), so the positive control (as B's pharmacist) must show "Di bawah minimum" = 7 while the tenant the case runs as (A, which
// holds no stock at all) shows none of it. The harness checks the rendered body for the marker and for every registered B secret (tenant id, branch id, legal name, the items' unique names).
//   - positive control (as B's pharmacist, on B's branch): B's own report shows 7 items below minimum;
//   - negative (as A's pharmacist): B's branch id as ?cabang= is NOT FOUND (TEN-1, never forbidden, never data) — a pharmacist is bound to its own branch, so another branch of ANY clinic is refused by
//     the reader; A's own report carries neither the 7 nor B's names. Both answers are returned in the body.
// LIMIT, stated plainly: a leak of a COUNT across tenants would be caught only when the leaked count equals the marker; the stronger guarantee here is the not-found for a foreign branch and the
// reader's own tenant scope, which tests/reporting/reports.test.ts exercises on the real readers (a tenant B owner sees none of tenant A's figures).
// route kind "not-found": the by-id selector (?cabang=) answers 404 for another tenant's branch.
import { reportIn } from "../../../src/app/(app)/laporan/_components/load";
import { withTenantContext } from "../../../src/db/rls/context";
import { publish } from "../../../src/modules/catalog/catalog";
import { receiveStock, saveItem, setLevel } from "../../../src/modules/inventory/stock";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

type CaseRole = "pharmacist" | "owner";
const accOf = new Map<string, string>();
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole): Promise<string> {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email, two_factor_enabled) values ('Staf', $1, true) returning id`, [`${role}.lpk116.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Laporan Stok ${role}` });
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

const SEVEN = 7;
const seeded = new Set<string>();
// Seven stock items at tenant B's branch, each with 1 unit on hand against a minimum of 5: all seven are "below minimum" (K18). Seeded once per tenant (the report is a count, not a consumable fact).
async function victim(env: IsolationEnv): Promise<void> {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  if (seeded.has(t)) return;
  const k = () => crypto.randomUUID();
  const expiry = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10); // far enough not to count as "expiring"
  for (let i = 1; i <= SEVEN; i++) {
    const name = `Bahan Rahasia Stok ${t.slice(0, 8)} ${i}`;
    const catalog = (await as(env, t, b, "owner", (db) => publish(db, { kind: "material", code: `LPK-${t.slice(0, 4).toUpperCase()}-${i}` },
      { name, tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1_000 } as never, "Bahan uji laporan stok"))).itemId;
    const { itemId } = await as(env, t, b, "pharmacist", (db) => saveItem(db, k(), null, { catalogItemId: catalog, unit: "pcs", storage: "ruang", highValue: false, active: true }));
    await as(env, t, b, "pharmacist", (db) => receiveStock(db, k(), null, { itemId, batchNo: `LPK-${i}`, expiry, quantity: "1", reason: "stok_awal" }));
    await as(env, t, b, "pharmacist", (db) => setLevel(db, k(), null, itemId, "5", "10"));
    env.victimSecret(name);
  }
  seeded.add(t);
}
// the marker is what the positive control must find in the body: the count of B's items below minimum, in the report's own words
const marker = () => `"label":"Di bawah minimum","metric":{"kind":"count","value":${SEVEN}}`;

export default defineCases({
  kind: "route",
  id: "/laporan/stok",
  expect: "not-found",
  marker,
  async run(env) {
    await victim(env);
    return as(env, env.actor.tenantId, env.actor.branchId, "pharmacist", async (db) => {
      // B's branch asked by the caller: a pharmacist is bound to its own branch, so the readers answer not-found (TEN-1)
      const byBranch = await reportIn(db, "stok", "pharmacist", { cabang: env.victim.branchId });
      const all = await reportIn(db, "stok", "pharmacist", {});
      // the caller's own unfiltered report is returned in both outcomes: it must carry nothing of B (the harness checks every registered secret in the whole body)
      if (byBranch.kind === "not-found") return { status: 404, body: JSON.parse(JSON.stringify({ all })) };
      return { status: 200, body: JSON.parse(JSON.stringify({ byBranch, all })) };
    });
  },
});
