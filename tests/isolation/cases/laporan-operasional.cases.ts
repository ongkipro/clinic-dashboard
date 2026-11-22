// Laporan Operasional (UX-38, PR-95; T-116): the DEL-2 case for the route /laporan/operasional (auto-discovered by tests/isolation/isolation.test.ts; the route id is the page's path without the
// (app) group; no tests/isolation/surfaces.ts change).
//
// The case runs the page-data core (src/app/(app)/laporan/_components/load.ts reportIn: the function the page calls, over the real K12 / K20 / K23 / K24 readers) as the CALLER's own manager
// (the only role of this report's nav row) while tenant B holds a real counter sale paid in cash at a unique 8-digit amount. K23 lists money per SHIFT and that amount appears verbatim in the
// shift row of the table (the sale's invoice and its cash both land on B's shift rows). The body this case returns is the page's PROPS as plain JSON, where a money figure is
// `{"kind":"money","rupiah":N}` — so the marker is the digits of the amount (8 of them: no UUID, timestamp or total of another case contains them by chance), not the "Rp…" text the view prints:
//   - positive control (as B's manager, on B's own branch): B's own report table carries B's amount;
//   - negative (as A's manager): B's branch id as ?cabang= is NOT FOUND (TEN-1, never forbidden, never data) — a manager is bound to its own branch, so another branch of ANY clinic is refused
//     by the reader; A's own report carries nothing of B (amount, branch id and name, tenant id, legal name). Both answers are returned in the body.
// route kind "not-found": the by-id selector (?cabang=) answers 404 for another tenant's branch.
import { reportIn } from "../../../src/app/(app)/laporan/_components/load";
import { withTenantContext } from "../../../src/db/rls/context";
import { issueKasirInvoice, openKasirInvoice, receivePayment } from "../../../src/modules/cashier/kasir/kasir";
import { publish } from "../../../src/modules/catalog/catalog";
import { saveItem } from "../../../src/modules/inventory/stock";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

type CaseRole = "fo_cashier" | "manager" | "owner" | "pharmacist";
const accOf = new Map<string, string>();
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole): Promise<string> {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email, two_factor_enabled) values ('Staf', $1, true) returning id`, [`${role}.lpo116.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Laporan Operasional ${role}` });
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

let runs = 0;
const latest = new Map<string, string>();
const items = new Map<string, string>();
// A counter sale at tenant B's branch, paid in cash today by B's FO. qty × 10.007 with qty >= 2001 is an 8-digit amount that no UUID, timestamp or total of another case can contain by chance.
async function victim(env: IsolationEnv): Promise<string> {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const k = () => crypto.randomUUID();
  const n = ++runs;
  let item = items.get(t);
  if (!item) {
    item = (await as(env, t, b, "owner", (db) => publish(db, { kind: "product", code: `LPO-${t.slice(0, 6).toUpperCase()}` },
      { name: "Produk Rahasia Operasional", tax_category: "exempt_medical", tax_basis: "Obat", normal_price: 10_007, unit: "pcs" } as never, "Produk baru"))).itemId;
    // a counter sale needs the product's stock item (as the Rekon and Ringkasan Shift cases)
    await as(env, t, b, "pharmacist", (db) => saveItem(db, k(), null, { catalogItemId: item!, unit: "pcs", storage: "ruang", highValue: false, active: true }));
    items.set(t, item);
  }
  const qty = 2500 + n; // base 2500: no other Laporan case seeds the same amount (a shared amount lets one case pass on another's sale)
  const amount = qty * 10_007;
  const { invoiceId } = await as(env, t, b, "fo_cashier", (db) => openKasirInvoice(db, k(), { counter: true }));
  await as(env, t, b, "fo_cashier", (db) => issueKasirInvoice(db, k(), invoiceId, [{ itemId: item!, quantity: qty }]));
  await as(env, t, b, "fo_cashier", (db) => receivePayment(db, k(), invoiceId, [{ method: "cash", amount, cashTendered: amount }]));
  env.victimSecret(String(amount));
  latest.set(t, String(amount));
  return String(amount);
}
const marker = (env: IsolationEnv) => latest.get(env.victim.tenantId) ?? "";

export default defineCases({
  kind: "route",
  id: "/laporan/operasional",
  expect: "not-found",
  marker,
  async run(env) {
    await victim(env);
    return as(env, env.actor.tenantId, env.actor.branchId, "manager", async (db) => {
      // B's branch asked by the caller: a manager is bound to its own branch, so the readers answer not-found (TEN-1)
      const byBranch = await reportIn(db, "operasional", "manager", { cabang: env.victim.branchId });
      const all = await reportIn(db, "operasional", "manager", {});
      // the caller's own unfiltered report is returned in both outcomes: it must carry nothing of B (the harness checks every registered secret in the whole body)
      if (byBranch.kind === "not-found") return { status: 404, body: JSON.parse(JSON.stringify({ all })) };
      return { status: 200, body: JSON.parse(JSON.stringify({ byBranch, all })) };
    });
  },
});
