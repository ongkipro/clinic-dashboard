// Ringkasan Shift (UX-6 shift summary, PR-33c; T-111): the DEL-2 case for the route /hari-ini/ringkasan. PARKED: target path tests/isolation/cases/hari-ini-ringkasan.cases.ts
// (outside T-111's Allowed Paths; auto-discovered by tests/isolation/isolation.test.ts, so no surfaces.ts change; the route id is the page's file path without the (app) group).
//
// The case runs the loader's core (src/app/(app)/hari-ini/ringkasan/load.ts: the same function the page calls, over the real cash_shift_* / visits_today / appointments_window readers)
// as the CALLER's own owner while tenant B holds a real shift with money in it. Each run seeds in B, through B's own FO/cashier, a fresh shift (the previous run's is closed with an exact
// count) with ONE cash sale of a unique, non-round amount (qty × 10.007: the marker, it appears verbatim as the tender's `received`):
//   - positive control (as B's owner, ?shift=<B's shift>): the summary carries B's amount and B's cashier;
//   - negative (as A's owner): B's shift id asked as ?shift= is NOT FOUND (TEN-1), never forbidden and never data; B's branch id asked as ?cabang= is not in A's list, so it falls back to
//     A's own branch and no reader is asked about B; nothing of B (amount, shift id, branch id and name, cashier name) appears in either answer A receives (the 404 body carries the ?cabang= one).
// route kind "not-found": the by-id selector answers 404 for another tenant's shift.
import { summaryIn } from "../../../src/app/(app)/hari-ini/ringkasan/load";
import { withTenantContext } from "../../../src/db/rls/context";
import { issueKasirInvoice, openKasirInvoice, receivePayment } from "../../../src/modules/cashier/kasir/kasir";
import { getShift, myShift, openShift, submitShiftCount } from "../../../src/modules/cashier/shifts/shifts";
import { publish } from "../../../src/modules/catalog/catalog";
import { saveItem } from "../../../src/modules/inventory/stock";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

type CaseRole = "fo_cashier" | "owner" | "pharmacist";
const accOf = new Map<string, string>();
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole): Promise<string> {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('Staf', $1) returning id`, [`${role}.rsh111.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Ringkasan Shift ${role}` });
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
type Seed = { shift: string; amount: number; cashier: string };
const latest = new Map<string, Seed>();
const items = new Map<string, string>();
async function victim(env: IsolationEnv): Promise<Seed> {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const k = () => crypto.randomUUID();
  const n = ++runs;
  let item = items.get(t);
  if (!item) {
    item = (await as(env, t, b, "owner", (db) => publish(db, { kind: "product", code: `RS-${t.slice(0, 6).toUpperCase()}` }, { name: "Produk Rahasia Ringkasan Shift", tax_category: "non_object", tax_basis: "Barang", normal_price: 10_007 } as never, "Produk"))).itemId;
    await as(env, t, b, "pharmacist", (db) => saveItem(db, k(), null, { catalogItemId: item!, unit: "pcs", storage: "ruang", highValue: false, active: true }));
    items.set(t, item);
  }
  // the FO's previous open shift (if any) is closed first with an exact count; then a fresh shift with one sale of a unique amount (qty × 10.007)
  const mine = await as(env, t, b, "fo_cashier", (db) => myShift(db));
  if (mine && mine.state === "open") {
    const exp = (await as(env, t, b, "fo_cashier", (db) => getShift(db, mine.id))).expected.find((e) => e.method === "cash")!.expected;
    await as(env, t, b, "fo_cashier", (db) => submitShiftCount(db, k(), mine.id, { countedCash: exp }));
  }
  const { shiftId } = await as(env, t, b, "fo_cashier", (db) => openShift(db, k(), { openingFloat: 0 }));
  const qty = 7 + n; // a unique quantity per run: the amount is qty × 10.007
  const { invoiceId } = await as(env, t, b, "fo_cashier", (db) => openKasirInvoice(db, k(), { counter: true }));
  await as(env, t, b, "fo_cashier", (db) => issueKasirInvoice(db, k(), invoiceId, [{ itemId: item!, quantity: qty }]));
  await as(env, t, b, "fo_cashier", (db) => receivePayment(db, k(), invoiceId, [{ method: "cash", amount: qty * 10_007, cashTendered: qty * 10_007 }]));
  const cashier = (await env.owner.query(`select s.display_name from cash_shifts c join staff s on s.tenant_id = c.tenant_id and s.id = c.cashier_id where c.id = $1`, [shiftId])).rows[0].display_name as string;
  for (const x of [shiftId, cashier]) env.victimSecret(x);
  const r = { shift: shiftId, amount: qty * 10_007, cashier };
  latest.set(t, r);
  return r;
}
// The route's own loader core, as a plain-JSON route result. As the caller's own owner it asks for B's shift by id AND for B's branch as ?cabang=:
//   - as B (positive control): the summary of B's shift, 200, carrying B's amount;
//   - as A (negative): the shift is not found (404, TEN-1); the ?cabang= of B's branch is not in A's list, so it falls back to A's own branch and no reader is asked about B. Both answers
//     are returned in the body, so the harness checks that NOTHING of B (amount, shift id, branch id and name, cashier name, tenant) appears in either, not only in the 404.
const ok = (x: unknown) => ({ status: 200, body: JSON.parse(JSON.stringify(x)) });
const marker = (env: IsolationEnv) => String(latest.get(env.victim.tenantId)?.amount ?? "");

export default defineCases({
  kind: "route",
  id: "/hari-ini/ringkasan",
  expect: "not-found",
  marker,
  async run(env) {
    const v = await victim(env);
    return as(env, env.actor.tenantId, env.actor.branchId, "owner", async (db) => {
      const byShift = await summaryIn(db, "owner", env.actor.branchId, { shift: v.shift }, new Date());
      const byBranch = await summaryIn(db, "owner", env.actor.branchId, { cabang: env.victim.branchId }, new Date());
      if (byShift.kind === "not-found") return { status: 404, body: JSON.parse(JSON.stringify({ byBranch })) };
      if (byShift.kind !== "ok") throw new Error(`unexpected ${byShift.kind}`);
      return ok({ summary: byShift, byBranch });
    });
  },
});
