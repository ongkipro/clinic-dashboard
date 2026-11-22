// Ringkasan Keuangan (UX-22 ▸ Ringkasan, PR-33f; T-114): the DEL-2 case for the route /keuangan/ringkasan (auto-discovered by
// tests/isolation/isolation.test.ts; the route id is the page's path without the (app) group). Until P2 mounts page.tsx the coverage gate
// reports this case as "a surface that does not exist" (as every parked DEL-2 case); the case itself runs now.
//
// The case runs the loader core (src/app/(app)/keuangan/ringkasan/load.ts financeIn: the function the page calls, over the real readers) as the
// CALLER's own finance. Dedicated synthetic fixture, so no other case's sales can change the numbers: in tenant B a branch of its own
// ("Cabang Rahasia Keuangan") holds exactly one cash counter sale at a unique, non-round amount (the marker), seeded once per tenant.
//   - positive control (as B's finance, ?cabang=<the dedicated branch>, the sale's local day): ok, and K1 cash at that branch is EXACTLY the
//     amount (asserted here, not only "contains");
//   - negative (as A's finance): the dedicated branch id as ?cabang= is NOT FOUND (TEN-1, never forbidden, never data); A's own consolidated
//     summary for that day carries nothing of B (amount, branch id and name, payment id, receipt number). Both answers are in the body.
// route kind "not-found": the by-id selector (?cabang=) answers 404 for another tenant's branch.
import { financeIn } from "../../../src/app/(app)/keuangan/ringkasan/load";
import { withTenantContext } from "../../../src/db/rls/context";
import { issueKasirInvoice, openKasirInvoice, receivePayment } from "../../../src/modules/cashier/kasir/kasir";
import { publish } from "../../../src/modules/catalog/catalog";
import { saveItem } from "../../../src/modules/inventory/stock";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

type CaseRole = "fo_cashier" | "owner" | "finance" | "pharmacist";
const accOf = new Map<string, string>();
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole): Promise<string> {
  const k = `${tenantId}:${branchId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email, two_factor_enabled) values ('Staf', $1, true) returning id`,
    [`${role}.rk114.${branchId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Keuangan ${role}` });
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
  const ctx = await resolveContext(env.app, acc, { tenantId, actingRole: role, activeBranchId: role === "fo_cashier" || role === "pharmacist" ? branchId : undefined });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}

type Seed = { branch: string; amount: number; day: string };
const seeded = new Map<string, Seed>();
// One sale per tenant B on its own branch: the exact-amount check needs exactly one movement there (both runs reuse it).
async function victim(env: IsolationEnv): Promise<Seed> {
  const t = env.victim.tenantId;
  const known = seeded.get(t);
  if (known) return known;
  const k = () => crypto.randomUUID();
  const name = "Cabang Rahasia Keuangan";
  const branch = (await env.owner.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'RKU2', $2, 'Asia/Jakarta') returning id`, [t, name])).rows[0].id as string;
  const { itemId } = await as(env, t, branch, "owner", (db) => publish(db, { kind: "product", code: `RKU-${t.slice(0, 6).toUpperCase()}` },
    { name: "Produk Rahasia Keuangan", tax_category: "exempt_medical", tax_basis: "Obat", normal_price: 10_009, unit: "pcs" } as never, "Produk baru"));
  await as(env, t, branch, "pharmacist", (db) => saveItem(db, k(), null, { catalogItemId: itemId, unit: "pcs", storage: "ruang", highValue: false, active: true }));
  const qty = 307; // 307 × 10.009 = 3.072.763: unique, non-round
  const { invoiceId } = await as(env, t, branch, "fo_cashier", (db) => openKasirInvoice(db, k(), { counter: true }));
  await as(env, t, branch, "fo_cashier", (db) => issueKasirInvoice(db, k(), invoiceId, [{ itemId, quantity: qty }]));
  await as(env, t, branch, "fo_cashier", (db) => receivePayment(db, k(), invoiceId, [{ method: "cash", amount: qty * 10_009, cashTendered: qty * 10_009 }]));
  const y = (await env.owner.query(`select y.id, r.number, public.tax_local_date(y.tenant_id, y.received_at, y.branch_id)::text d
                                      from payments y join receipts r on r.id = y.receipt_id where y.tenant_id = $1 and y.invoice_id = $2`, [t, invoiceId])).rows[0];
  for (const x of [branch, name, y.id as string, y.number as string]) env.victimSecret(x);
  const s = { branch, amount: qty * 10_009, day: y.d as string };
  seeded.set(t, s);
  return s;
}
const marker = (env: IsolationEnv) => String(seeded.get(env.victim.tenantId)?.amount ?? "");

export default defineCases({
  kind: "route",
  id: "/keuangan/ringkasan",
  expect: "not-found",
  marker,
  async run(env) {
    const v = await victim(env);
    return as(env, env.actor.tenantId, env.actor.branchId, "finance", async (db) => {
      const byBranch = await financeIn(db, { dari: v.day, sampai: v.day, cabang: v.branch });
      const all = await financeIn(db, { dari: v.day, sampai: v.day });
      if (byBranch.kind === "not-found") return { status: 404, body: JSON.parse(JSON.stringify({ all })) };
      if (byBranch.kind !== "ok" || byBranch.props.state.kind !== "ready") throw new Error(`unexpected ${byBranch.kind}`);
      // positive control (B itself): exactly the one seeded sale in K1 cash at the dedicated branch
      const cash = byBranch.props.state.data.k1.methods.find((m) => m.method === "cash")?.amount;
      if (cash?.state !== "value" || cash.rp !== v.amount) throw new Error(`K1 cash at the dedicated branch is ${JSON.stringify(cash)}, not ${v.amount}`);
      return { status: 200, body: JSON.parse(JSON.stringify({ byBranch, all })) };
    });
  },
});
