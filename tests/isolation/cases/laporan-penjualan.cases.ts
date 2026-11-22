// Laporan Penjualan & Uang (UX-38, PR-95; T-116): the DEL-2 case for the route /laporan/penjualan (auto-discovered by tests/isolation/isolation.test.ts; the route id is the page's path
// without the (app) group; no tests/isolation/surfaces.ts change).
//
// The case runs the page-data core (src/app/(app)/laporan/_components/load.ts reportIn: the function the page calls, over the real K1/K2/K3 readers) as the CALLER's own owner while
// tenant B holds a real counter sale paid in cash at a unique, 8-digit amount. A report's KPI is a SUM over every payment B has today (other cases seed B too), so the unique amount is
// only verbatim in a ROW: the body therefore also carries the reader's own K1 detail rows for the caller (one per payment, as the ringkasan-owner case does), read from the reader's
// answer, not from a field the case adds:
//   - positive control (as B's owner): the K1 detail rows carry B's unique amount, and B's own report (?cabang=<B's branch>) is composed from the same readers;
//   - negative (as A's owner): B's branch id as ?cabang= is NOT FOUND (TEN-1, never forbidden, never data); A's own all-branch report and A's own K1 detail rows carry nothing of B
//     (amount, branch id and name, tenant id, legal name). Both answers are returned in the body.
// route kind "not-found": the by-id selector (?cabang=) answers 404 for another tenant's branch.
import { reportIn } from "../../../src/app/(app)/laporan/_components/load";
import { withTenantContext } from "../../../src/db/rls/context";
import { issueKasirInvoice, openKasirInvoice, receivePayment } from "../../../src/modules/cashier/kasir/kasir";
import { publish } from "../../../src/modules/catalog/catalog";
import { saveItem } from "../../../src/modules/inventory/stock";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { kpi } from "../../../src/modules/reporting/dashboards/dashboards";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

type CaseRole = "fo_cashier" | "owner" | "pharmacist";
const accOf = new Map<string, string>();
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole): Promise<string> {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email, two_factor_enabled) values ('Staf', $1, true) returning id`, [`${role}.lpj116.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Laporan ${role}` });
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

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
let runs = 0;
const latest = new Map<string, number>();
const items = new Map<string, string>();
// A counter sale at tenant B's branch, paid in cash today: K1 (money in) and K3 (sales) carry it. qty × 10.007 with qty >= 2001 gives an 8-digit amount that no UUID, timestamp or total of
// another case can contain by chance.
async function victim(env: IsolationEnv): Promise<number> {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const k = () => crypto.randomUUID();
  const n = ++runs;
  let item = items.get(t);
  if (!item) {
    item = (await as(env, t, b, "owner", (db) => publish(db, { kind: "product", code: `LPJ-${t.slice(0, 6).toUpperCase()}` },
      { name: "Produk Rahasia Laporan", tax_category: "exempt_medical", tax_basis: "Obat", normal_price: 10_007, unit: "pcs" } as never, "Produk baru"))).itemId;
    // a counter sale needs the product's stock item (as the Rekon and Ringkasan Shift cases)
    await as(env, t, b, "pharmacist", (db) => saveItem(db, k(), null, { catalogItemId: item!, unit: "pcs", storage: "ruang", highValue: false, active: true }));
    items.set(t, item);
  }
  const qty = 2100 + n; // base 2100: no other Laporan case seeds the same amount (a shared amount lets one case pass on another's sale)
  const amount = qty * 10_007;
  const { invoiceId } = await as(env, t, b, "fo_cashier", (db) => openKasirInvoice(db, k(), { counter: true }));
  await as(env, t, b, "fo_cashier", (db) => issueKasirInvoice(db, k(), invoiceId, [{ itemId: item!, quantity: qty }]));
  await as(env, t, b, "fo_cashier", (db) => receivePayment(db, k(), invoiceId, [{ method: "cash", amount, cashTendered: amount }]));
  env.victimSecret(String(amount));
  latest.set(t, amount);
  return amount;
}
// the marker is what the positive control must find in the body: B's amount, verbatim in the reader's own K1 detail row
const marker = (env: IsolationEnv) => String(latest.get(env.victim.tenantId) ?? "");
// the reader's own K1 detail rows (one per payment) for the caller's clinic, optionally for one branch; null when the reader refuses (a branch that is not the caller's)
const k1Rows = (db: never) => kpi(db as never, { kpi: "k1", from: today(), to: today(), detail: true }).then((r) => r.rows ?? []);

export default defineCases({
  kind: "route",
  id: "/laporan/penjualan",
  expect: "not-found",
  marker,
  async run(env) {
    await victim(env);
    return as(env, env.actor.tenantId, env.actor.branchId, "owner", async (db) => {
      // B's branch asked by the caller: the readers answer not-found for another tenant's branch (TEN-1)
      const byBranch = await reportIn(db, "penjualan", "owner", { cabang: env.victim.branchId });
      const all = await reportIn(db, "penjualan", "owner", {});
      const rows = await k1Rows(db);
      // the caller's own unfiltered report and rows are returned in both outcomes: they must carry nothing of B (the harness checks every registered secret in the whole body)
      if (byBranch.kind === "not-found") return { status: 404, body: JSON.parse(JSON.stringify({ all, k1Rows: rows })) };
      return { status: 200, body: JSON.parse(JSON.stringify({ byBranch, all, k1Rows: rows })) };
    });
  },
});
