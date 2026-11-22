// Laporan Marketing (UX-38, PR-95; T-116): the DEL-2 case for the route /laporan/marketing (auto-discovered by tests/isolation/isolation.test.ts; the route id is the page's path without the
// (app) group; no tests/isolation/surfaces.ts change).
//
// The case runs the page-data core (src/app/(app)/laporan/_components/load.ts reportIn: the function the page calls, over the real K13 / K14 / K25 / K26 readers) as the CALLER's own marketing
// role (the first of this report's nav row) while tenant B holds a real promo code that was USED: created by B's marketing through the promo writer with a unique code, applied at issue on B's
// counter sale and paid in full (the usage becomes "consumed", which K25 counts). K25 lists the code in its table, so the CODE is the marker — unique per run, never a figure a total of A could
// contain:
//   - positive control (as B's marketing): B's own report table lists B's promo code with its use and discount;
//   - negative (as A's marketing): B's branch id as ?cabang= is NOT FOUND (TEN-1, never forbidden, never data); A's own report carries nothing of B (the code, its discount, branch id and name,
//     tenant id, legal name). Both answers are returned in the body.
// route kind "not-found": the by-id selector (?cabang=) answers 404 for another tenant's branch.
import { reportIn } from "../../../src/app/(app)/laporan/_components/load";
import { withTenantContext } from "../../../src/db/rls/context";
import { issueKasirInvoice, openKasirInvoice, receivePayment } from "../../../src/modules/cashier/kasir/kasir";
import { publish } from "../../../src/modules/catalog/catalog";
import { saveItem } from "../../../src/modules/inventory/stock";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { createPromoCode } from "../../../src/modules/promo/promo";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

type CaseRole = "fo_cashier" | "marketing" | "owner" | "pharmacist";
const accOf = new Map<string, string>();
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole): Promise<string> {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email, two_factor_enabled) values ('Staf', $1, true) returning id`, [`${role}.lpm116.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Laporan Marketing ${role}` });
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId, staffId, role });
    if (role === "fo_cashier" || role === "pharmacist") await assignBranch(c, { tenantId, staffRoleId: rid, branchId });
  } finally {
    c.release();
  }
  accOf.set(k, acc);
  return acc;
}
async function as<T>(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole, fn: (db: never) => Promise<T>): Promise<T> {
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const acc = await member(env, tenantId, branchId, role);
  const wide = role === "owner" || role === "marketing";
  const ctx = await resolveContext(env.app, acc, { tenantId, actingRole: role, activeBranchId: wide ? undefined : branchId });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
let runs = 0;
const latest = new Map<string, string>();
const items = new Map<string, string>();
async function victim(env: IsolationEnv): Promise<string> {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const k = () => crypto.randomUUID();
  const n = ++runs;
  let item = items.get(t);
  if (!item) {
    item = (await as(env, t, b, "owner", (db) => publish(db, { kind: "product", code: `LPM-${t.slice(0, 6).toUpperCase()}` },
      { name: "Produk Rahasia Marketing", tax_category: "exempt_medical", tax_basis: "Obat", normal_price: 100_000, unit: "pcs" } as never, "Produk baru"))).itemId;
    // a counter sale needs the product's stock item (as the Rekon and Ringkasan Shift cases)
    await as(env, t, b, "pharmacist", (db) => saveItem(db, k(), null, { catalogItemId: item!, unit: "pcs", storage: "ruang", highValue: false, active: true }));
    items.set(t, item);
  }
  // a code unique per run (3–32 chars of A–Z 0–9 and "-"): the marker the report's K25 table lists verbatim
  const code = `RHS-${t.slice(0, 6).toUpperCase()}-${n}-${Math.floor(Math.random() * 1e6)}`;
  await as(env, t, b, "marketing", (db) => createPromoCode(db, k(), code, 10, { validFrom: day(-1), validTo: day(30), discountKind: "percent", discountValue: 10, itemIds: [item!] }));
  // a counter sale of one product with the code, paid in full: the usage is reserved at issue and consumed at settlement (K25 counts consumed uses)
  const { invoiceId } = await as(env, t, b, "fo_cashier", (db) => openKasirInvoice(db, k(), { counter: true }));
  await as(env, t, b, "fo_cashier", (db) => issueKasirInvoice(db, k(), invoiceId, [{ itemId: item!, quantity: 1, promoCode: code }]));
  const paid = Number((await env.owner.query(`select sum(line_total)::bigint t from invoice_lines where invoice_id = $1`, [invoiceId])).rows[0].t);
  await as(env, t, b, "fo_cashier", (db) => receivePayment(db, k(), invoiceId, [{ method: "cash", amount: paid, cashTendered: paid }]));
  const used = (await env.owner.query(`select u.state from promo_usages u join promo_codes c on c.id = u.promo_id where c.tenant_id = $1 and c.code = $2`, [t, code])).rows.map((r) => r.state);
  if (used.join() !== "consumed") throw new Error(`isolation case: the victim's promo usage is ${used.join() || "missing"}, not consumed — K25 would not list it`);
  env.victimSecret(code);
  latest.set(t, code);
  return code;
}
const marker = (env: IsolationEnv) => latest.get(env.victim.tenantId) ?? "";

export default defineCases({
  kind: "route",
  id: "/laporan/marketing",
  expect: "not-found",
  marker,
  async run(env) {
    await victim(env);
    return as(env, env.actor.tenantId, env.actor.branchId, "marketing", async (db) => {
      // B's branch asked by the caller: the readers answer not-found for another tenant's branch (TEN-1)
      const byBranch = await reportIn(db, "marketing", "marketing", { cabang: env.victim.branchId });
      const all = await reportIn(db, "marketing", "marketing", {});
      // the caller's own unfiltered report is returned in both outcomes: it must carry nothing of B (the harness checks every registered secret in the whole body)
      if (byBranch.kind === "not-found") return { status: 404, body: JSON.parse(JSON.stringify({ all })) };
      return { status: 200, body: JSON.parse(JSON.stringify({ byBranch, all })) };
    });
  },
});
