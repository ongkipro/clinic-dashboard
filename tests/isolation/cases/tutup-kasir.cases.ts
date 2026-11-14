// Tutup Kasir (UX-15, PR-19, T-085): the list, one shift and the actions. Each run seeds in B a shift of B's FO (opened with a float, one
// cash sale, a short count waiting for approval); then runs as the caller's own FO/cashier, manager and owner: B's shift is absent from
// the lists and not found, every write on it is refused. As B's staff (positive control) everything succeeds. Synthetic data (MIG-2).
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { publish } from "../../../src/modules/catalog/catalog";
import { issueKasirInvoice, openKasirInvoice, receivePayment } from "../../../src/modules/cashier/kasir/kasir";
import { getShift, listShifts, myShift, openShift, submitShiftCount } from "../../../src/modules/cashier/shifts/shifts";
import { saveItem } from "../../../src/modules/inventory/stock";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

type CaseRole = "fo_cashier" | "owner" | "pharmacist" | "manager";
const accOf = new Map<string, string>();
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole): Promise<string> {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('Staf', $1) returning id`, [`${role}.tk85.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Tutup Kasir ${role}` });
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
const asMine = <T>(env: IsolationEnv, role: CaseRole, fn: (db: never) => Promise<T>) => as(env, env.actor.tenantId, env.actor.branchId, role, fn);

let runs = 0;
type Seed = { cashier: string; shift: string; open: string };
const latest = new Map<string, Seed>();
const items = new Map<string, string>();
// B's FO has at most one open shift: each run closes the previous open one with a zero-variance count (as B), then opens a fresh shift
// with one sale and a short count waiting (the "pending" target), and a second open shift at the same branch for another FO is not
// possible, so the "open" target is the manager's own open shift.
async function victim(env: IsolationEnv): Promise<Seed> {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const k = () => crypto.randomUUID();
  const n = ++runs;
  let item = items.get(t);
  if (!item) {
    item = (await as(env, t, b, "owner", (db) => publish(db, { kind: "product", code: `TK-${t.slice(0, 6).toUpperCase()}` },
      { name: "Produk Rahasia Shift", tax_category: "non_object", tax_basis: "Barang", normal_price: 10_000 } as never, "Produk"))).itemId;
    await as(env, t, b, "pharmacist", (db) => saveItem(db, k(), null, { catalogItemId: item!, unit: "pcs", storage: "ruang", highValue: false, active: true }));
    items.set(t, item);
  }
  // the FO's previous open shift (if any) is closed first; then a shift with one sale and a pending short count
  const mine = await as(env, t, b, "fo_cashier", (db) => myShift(db));
  if (mine && mine.state === "open") {
    const exp = (await as(env, t, b, "fo_cashier", (db) => getShift(db, mine.id))).expected.find((e) => e.method === "cash")!.expected;
    await as(env, t, b, "fo_cashier", (db) => submitShiftCount(db, k(), mine.id, { countedCash: exp }));
  }
  const { shiftId } = await as(env, t, b, "fo_cashier", (db) => openShift(db, k(), { openingFloat: 1_000 + n }));
  const { invoiceId } = await as(env, t, b, "fo_cashier", (db) => openKasirInvoice(db, k(), { counter: true }));
  await as(env, t, b, "fo_cashier", (db) => issueKasirInvoice(db, k(), invoiceId, [{ itemId: item!, quantity: 1 }]));
  await as(env, t, b, "fo_cashier", (db) => receivePayment(db, k(), invoiceId, [{ method: "cash", amount: 10_000, cashTendered: 10_000 }]));
  // B's owner's open shift at B's branch (left by a previous run's positive control) is closed, so Buka Kasir succeeds as B again
  const own = await as(env, t, b, "owner", (db) => myShift(db, b));
  if (own && own.state === "open") {
    const exp = (await as(env, t, b, "owner", (db) => getShift(db, own.id))).expected.find((e) => e.method === "cash")!.expected;
    await as(env, t, b, "owner", (db) => submitShiftCount(db, k(), own.id, { countedCash: exp }));
  }
  // the manager's own open shift of B (for the attempts on an open shift)
  const mgrShift = await as(env, t, b, "manager", (db) => myShift(db));
  const open = mgrShift?.state === "open" ? mgrShift.id : (await as(env, t, b, "manager", (db) => openShift(db, k(), { openingFloat: 0 }))).shiftId;
  const cashier = (await env.owner.query(`select cashier_id from cash_shifts where id = $1`, [shiftId])).rows[0].cashier_id as string;
  for (const x of [shiftId, open]) env.victimSecret(x);
  const r = { cashier, shift: shiftId, open };
  latest.set(t, r);
  return r;
}
const outcome = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));
const marker = (env: IsolationEnv) => latest.get(env.victim.tenantId)?.shift ?? "";
const ok = (x: unknown) => ({ status: 200, body: JSON.parse(JSON.stringify(x)) });
const notFound = (e: unknown) => (e instanceof CommandError && e.code === "ERR_NOT_FOUND" ? { status: 404, body: null } : Promise.reject(e));
const route = (id: string, expect: "filtered" | "not-found", m: (env: IsolationEnv) => string, run: (env: IsolationEnv, v: Seed) => Promise<{ status: number; body: unknown }>) =>
  ({ kind: "route" as const, id, expect, marker: m, async run(env: IsolationEnv) { const v = await victim(env); return run(env, v) as never; } });

export default defineCases(
  route("/kasir/tutup", "filtered", marker, async (env) => {
    const owner = await asMine(env, "owner", (db) => listShifts(db as never));
    const manager = await asMine(env, "manager", (db) => listShifts(db as never));
    const fo = await asMine(env, "fo_cashier", (db) => listShifts(db as never));
    return ok({ owner, manager, fo });
  }),
  route("/kasir/tutup/[shiftId]", "not-found", marker, (env, v) => asMine(env, "owner", (db) => getShift(db as never, v.shift).then(ok, notFound))),
  {
    kind: "action",
    id: "app/(app)/kasir/tutup/actions",
    marker,
    async run(env) {
      const v = await victim(env);
      const k = () => crypto.randomUUID();
      // ordered so each also succeeds as B (positive control): the open shift is counted (zero variance → closed) by B's manager, its
      // own cashier; the pending one is re-counted only after a decision, so the attempt on it is a read through the writer's checks.
      const attempts = {
        countOpen: await outcome(asMine(env, "manager", async (db) => {
          const exp = (await getShift(db as never, v.open)).expected.find((e) => e.method === "cash")!.expected;
          return submitShiftCount(db as never, k(), v.open, { countedCash: exp });
        })),
        // Buka Kasir naming B's branch: refused as not found for the caller; as B's owner it opens one at that branch.
        openOtherBranch: await outcome(asMine(env, "owner", (db) => openShift(db as never, k(), { branchId: env.victim.branchId, openingFloat: 0 }))),
      };
      const read = await asMine(env, "owner", (db) => getShift(db as never, v.shift).then((d) => d.shift.id, () => null));
      return { attempts, body: { ...attempts, read } };
    },
  },
);
