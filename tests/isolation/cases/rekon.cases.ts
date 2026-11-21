// Rekonsiliasi (UX-22 ▸ Rekon, PR-34; T-108): the DEL-2 case for the route /keuangan/rekon. PARKED: target path tests/isolation/cases/rekon.cases.ts
// (outside T-108's Allowed Paths; auto-discovered by tests/isolation/isolation.test.ts; the route id is the page's path without the (app) group).
//
// The case runs the loader core (src/app/(app)/keuangan/rekon/load.ts: the function the page calls, over the real recon_report reader) as the CALLER's
// own finance while tenant B holds a real payment whose ledger posting is missing (the PR-34 difference), at a unique, non-round amount (the marker):
//   - positive control (as B's finance, ?cabang=<B's branch>): B's difference with B's receipt number and amount;
//   - negative (as A's finance): B's branch id as ?cabang= is NOT FOUND (TEN-1, never forbidden, never data); A's own all-branch report carries
//     nothing of B (amount, receipt number, payment id, branch id and name). Both answers are returned in the body.
// route kind "not-found": the by-id selector (?cabang=) answers 404 for another tenant's branch.
import { rekonIn } from "../../../src/app/(app)/keuangan/rekon/load";
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
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email, two_factor_enabled) values ('Staf', $1, true) returning id`, [`${role}.rk108.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Rekon ${role}` });
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

let runs = 0;
type Seed = { payment: string; receipt: string; amount: number; day: string };
const latest = new Map<string, Seed>();
const items = new Map<string, string>();
async function victim(env: IsolationEnv): Promise<Seed> {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const k = () => crypto.randomUUID();
  const n = ++runs;
  let item = items.get(t);
  if (!item) {
    item = (await as(env, t, b, "owner", (db) => publish(db, { kind: "product", code: `RK-${t.slice(0, 6).toUpperCase()}` },
      { name: "Produk Rahasia Rekon", tax_category: "exempt_medical", tax_basis: "Obat", normal_price: 10_007, unit: "pcs" } as never, "Produk baru"))).itemId;
    // a counter sale needs the product's stock item (as the Ringkasan Shift case)
    await as(env, t, b, "pharmacist", (db) => saveItem(db, k(), null, { catalogItemId: item!, unit: "pcs", storage: "ruang", highValue: false, active: true }));
    items.set(t, item);
  }
  const qty = 11 + n; // a unique amount per run: qty × 10.007
  const { invoiceId } = await as(env, t, b, "fo_cashier", (db) => openKasirInvoice(db, k(), { counter: true }));
  await as(env, t, b, "fo_cashier", (db) => issueKasirInvoice(db, k(), invoiceId, [{ itemId: item!, quantity: qty }]));
  await as(env, t, b, "fo_cashier", (db) => receivePayment(db, k(), invoiceId, [{ method: "cash", amount: qty * 10_007, cashTendered: qty * 10_007 }]));
  const y = (await env.owner.query(`select y.id, r.number, public.tax_local_date(y.tenant_id, y.received_at, y.branch_id)::text d
                                      from payments y join receipts r on r.id = y.receipt_id where y.tenant_id = $1 and y.invoice_id = $2`, [t, invoiceId])).rows[0];
  // the PR-34 difference: the posting receipt completed without its entry (no ledger posting for this payment)
  await env.owner.query(`update event_receipts r set done_at = now() from domain_events e
                          where e.id = r.event_id and r.consumer = 'ledger.posting' and e.type = 'PaymentAllocated' and e.payload ->> 'payment_id' = $1`, [y.id]);
  for (const x of [y.id, y.number]) env.victimSecret(x);
  const s = { payment: y.id as string, receipt: y.number as string, amount: qty * 10_007, day: y.d as string };
  latest.set(t, s);
  return s;
}
const marker = (env: IsolationEnv) => latest.get(env.victim.tenantId)?.receipt ?? "";

export default defineCases({
  kind: "route",
  id: "/keuangan/rekon",
  expect: "not-found",
  marker,
  async run(env) {
    const v = await victim(env);
    return as(env, env.actor.tenantId, env.actor.branchId, "finance", async (db) => {
      const byBranch = await rekonIn(db, { dari: v.day, sampai: v.day, cabang: env.victim.branchId });
      const all = await rekonIn(db, { dari: v.day, sampai: v.day });
      const plain = JSON.parse(JSON.stringify({ all })); // hrefFor (a function) drops out; its links are checked through the items' refs
      if (byBranch.kind === "not-found") return { status: 404, body: plain };
      if (byBranch.kind !== "ok") throw new Error(`unexpected ${byBranch.kind}`);
      return { status: 200, body: JSON.parse(JSON.stringify({ byBranch, all })) };
    });
  },
});
