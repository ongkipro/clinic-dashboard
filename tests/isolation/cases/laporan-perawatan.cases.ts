// Laporan Perawatan (UX-38, PR-95; T-116): the DEL-2 case for the route /laporan/perawatan (auto-discovered by tests/isolation/isolation.test.ts; the route id is the page's path without the (app)
// group; no tests/isolation/surfaces.ts change).
//
// The case runs the page-data core (src/app/(app)/laporan/_components/load.ts reportIn: the function the page calls, over the real K7 reader) as the CALLER's own owner while tenant B holds a real,
// DELIVERED product sale: a stock item received at a unique cost, moved to the pharmacy depot, sold over the counter at a unique price, paid in cash and handed over — so K2 (value delivered) is the
// price and K7 (contribution = K2 − the product's moving-average cost) is price − cost, a unique figure no total of another case can equal. K7 is the page's ONE figure (a money total, no table), so the
// marker is that figure's digits as the page's props carry it (`{"kind":"money","rupiah":N}`), and the case THROWS if B's own K7 is not exactly that figure — a case that silently exercised nothing
// (a sale that never reached K2, a cost that made K7 incomplete) must fail here, not pass:
//   - positive control (as B's owner): B's own report shows B's K7;
//   - negative (as A's owner): B's branch id as ?cabang= is NOT FOUND (TEN-1, never forbidden, never data); A's own report (no delivered product) carries nothing of B (K7, branch id and name, tenant
//     id, legal name). Both answers are returned in the body.
// LIMIT, stated plainly: K7 is a SINGLE SUM, so a cross-tenant leak that happened to add up to the marker's value is conceivable only by coincidence; the strong guarantees here are the not-found for a
// foreign branch and the reader's own tenant scope, which tests/reporting/dashboards.test.ts (T-107) proves for K7 on two tenants.
// route kind "not-found": the by-id selector (?cabang=) answers 404 for another tenant's branch.
import { reportIn } from "../../../src/app/(app)/laporan/_components/load";
import { withTenantContext } from "../../../src/db/rls/context";
import { issueKasirInvoice, openKasirInvoice, receivePayment } from "../../../src/modules/cashier/kasir/kasir";
import { publish } from "../../../src/modules/catalog/catalog";
import { receiveCosted } from "../../../src/modules/inventory/costing/costing";
import { createDepot, transferBetweenDepots } from "../../../src/modules/inventory/depots/depots";
import { saveItem } from "../../../src/modules/inventory/stock";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { CHECKS, handOver, prepareDispensing } from "../../../src/modules/pharmacy/pharmacy";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

type CaseRole = "fo_cashier" | "owner" | "pharmacist";
const accOf = new Map<string, string>();
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole): Promise<string> {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email, two_factor_enabled) values ('Staf', $1, true) returning id`, [`${role}.lpr116.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Laporan Perawatan ${role}` });
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

const ALL = Object.fromEntries(CHECKS.map((c) => [c, true])) as Record<(typeof CHECKS)[number], boolean>;
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
// One delivered product per tenant (the report is a total, so the fact is seeded once and the figure is stable across the positive and negative runs).
type Seed = { price: number; cost: number; k7: number };
const seeded = new Map<string, Seed>();
async function victim(env: IsolationEnv): Promise<Seed> {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const known = seeded.get(t);
  if (known) return known;
  const k = () => crypto.randomUUID();
  const price = 10_007 * (3000 + (Math.floor(Math.random() * 900) + 1)); // unique 8-digit price, a multiple of 10.007
  const cost = 5_003 * (1000 + (Math.floor(Math.random() * 900) + 1)); // unique 7-digit moving-average cost
  const catalog = (await as(env, t, b, "owner", (db) => publish(db, { kind: "product", code: `LPR-${t.slice(0, 6).toUpperCase()}` },
    { name: "Produk Rahasia Perawatan", tax_category: "non_object", tax_basis: "Barang", normal_price: price } as never, "Produk baru"))).itemId;
  const { itemId } = await as(env, t, b, "pharmacist", (db) => saveItem(db, k(), null, { catalogItemId: catalog, unit: "pcs", storage: "ruang", highValue: false, active: true }));
  const g1 = (await env.owner.query(`select id from depots where tenant_id = $1 and branch_id = $2 and is_default`, [t, b])).rows[0].id as string;
  const apt = (await as(env, t, b, "pharmacist", (db) => createDepot(db, k(), { branchId: null, name: "Apotek Rahasia Perawatan", kind: "apotek" }))).depotId;
  const batch = (await as(env, t, b, "pharmacist", (db) => receiveCosted(db, k(), null, { itemId, batchNo: "LPR-1", expiry: day(300), quantity: "5", reason: "penerimaan", unitCost: cost }))).batchId;
  await as(env, t, b, "pharmacist", (db) => transferBetweenDepots(db, k(), { fromDepotId: g1, toDepotId: apt, lines: [{ batchId: batch, quantity: "5" }] }));
  const { invoiceId } = await as(env, t, b, "fo_cashier", (db) => openKasirInvoice(db, k(), { counter: true }));
  await as(env, t, b, "fo_cashier", (db) => issueKasirInvoice(db, k(), invoiceId, [{ itemId: catalog, quantity: 1 }]));
  await as(env, t, b, "fo_cashier", (db) => receivePayment(db, k(), invoiceId, [{ method: "cash", amount: price, cashTendered: price }]));
  const d = (await env.owner.query(`select d.id from dispensings d join invoice_lines l on l.id = d.invoice_line_id where l.invoice_id = $1`, [invoiceId])).rows[0].id as string;
  await as(env, t, b, "pharmacist", (db) => prepareDispensing(db, k(), d, apt));
  await as(env, t, b, "pharmacist", (db) => handOver(db, k(), d, { checks: ALL }));
  const s = { price, cost, k7: price - cost };
  env.victimSecret(String(s.k7));
  seeded.set(t, s);
  return s;
}
const marker = (env: IsolationEnv) => String(seeded.get(env.victim.tenantId)?.k7 ?? "");

export default defineCases({
  kind: "route",
  id: "/laporan/perawatan",
  expect: "not-found",
  marker,
  async run(env) {
    const v = await victim(env);
    return as(env, env.actor.tenantId, env.actor.branchId, "owner", async (db) => {
      // B's branch asked by the caller: the readers answer not-found for another tenant's branch (TEN-1)
      const byBranch = await reportIn(db, "perawatan", "owner", { cabang: env.victim.branchId });
      const all = await reportIn(db, "perawatan", "owner", {});
      if (env.actor.tenantId === env.victim.tenantId) {
        // the positive control is B itself: its own K7 must be exactly the delivered sale (price − cost), or the case exercised nothing
        const k7 = all.kind === "ok" ? all.props.kpis.find((x) => x.id === "K7")?.metric : undefined;
        if (!k7 || k7.kind !== "money" || k7.rupiah !== v.k7) throw new Error(`isolation case: as B, K7 is ${JSON.stringify(k7)}, not ${v.k7} (price ${v.price} − cost ${v.cost}) — the sale never reached K7`);
      }
      // the caller's own unfiltered report is returned in both outcomes: it must carry nothing of B (the harness checks every registered secret in the whole body)
      if (byBranch.kind === "not-found") return { status: 404, body: JSON.parse(JSON.stringify({ all })) };
      return { status: 200, body: JSON.parse(JSON.stringify({ byBranch, all })) };
    });
  },
});
