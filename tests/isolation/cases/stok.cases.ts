// Stok (UX-11, PR-17, T-060): the landing page (stock_context), the item list, page and form (stock_item_list,
// stock_item_get, stock_item_options), the card (stock_card), the batch watch (stock_batch_watch), the counts
// (stock_count_list, stock_count_get), and the actions (item save, receive, hold, vial open, level, count start,
// record, submit, cancel). Each run seeds in B a fresh stock item from a fresh catalog product, a received batch of a
// vial item by B's pharmacist and a draft count; then runs as the caller's own pharmacist or purchasing: B's items,
// batches and counts are not found or absent; every write on B's item, batch or count is refused. As B's staff
// (positive control) everything succeeds. Synthetic data on a local database (MIG-2).
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { publish } from "../../../src/modules/catalog/catalog";
import {
  batchWatch, cancelCount, getCount, getItem, holdBatch, itemOptions, listCounts, listItems, openVial, receiveStock, recordCount, saveItem, setLevel,
  startCount, stockCard, stockContext, submitCount,
} from "../../../src/modules/inventory/stock";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

type CaseRole = "pharmacist" | "purchasing" | "owner";
const accOf = new Map<string, string>();
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole): Promise<string> {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('Staf', $1) returning id`, [`${role}.stk60.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: role === "pharmacist" ? "Apoteker Stok" : role === "purchasing" ? "Pembelian Stok" : "Pemilik" });
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId, staffId, role });
    if (role === "pharmacist") await assignBranch(c, { tenantId, staffRoleId: rid, branchId });
  } finally {
    c.release();
  }
  accOf.set(k, acc);
  return acc;
}
async function as<T>(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole, fn: (db: never) => Promise<T>): Promise<T> {
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const acc = await member(env, tenantId, branchId, role);
  const ctx = await resolveContext(env.app, acc, { tenantId, actingRole: role, activeBranchId: role === "pharmacist" ? branchId : undefined });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}
const asMine = <T>(env: IsolationEnv, role: CaseRole, fn: (db: never) => Promise<T>) => as(env, env.actor.tenantId, env.actor.branchId, role, fn);

let runs = 0;
const latest = new Map<string, { name: string; item: string; batch: string; count: string; line: string; catalog: string; spare: string }>();
async function victim(env: IsolationEnv) {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const ph = <T>(fn: (db: never) => Promise<T>) => as(env, t, b, "pharmacist", fn);
  const n = ++runs;
  const name = `Toksin Rahasia ${t.slice(0, 8)} ${n}`;
  const code = `STK-${t.slice(0, 4).toUpperCase()}-${n}`;
  const catalog = (await as(env, t, b, "owner", (db) => publish(db, { kind: "product", code }, { name, tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1_000 } as never, "Produk uji isolasi"))).itemId;
  // A second catalog product without a stock item: the Tambah Item form lists it; the action case creates from it.
  const spare = (await as(env, t, b, "owner", (db) => publish(db, { kind: "material", code: `${code}-S` }, { name: `${name} cadangan`, tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1_000 } as never, "Bahan uji isolasi"))).itemId;
  const { itemId: item } = await ph((db) => saveItem(db, crypto.randomUUID(), null, { catalogItemId: catalog, unit: "U", vialSize: "100", openedUseHours: 24, storage: "dingin", highValue: true, active: true }));
  const expiry = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10);
  const { batchId: batch } = await ph((db) => receiveStock(db, crypto.randomUUID(), null, { itemId: item, batchNo: `RHS-${n}`, expiry, quantity: "100", reason: "stok_awal" }));
  const { countId: count } = await ph((db) => startCount(db, crypto.randomUUID(), false, [item]));
  const line = (await env.owner.query(`select id from stock_count_lines where count_id = $1`, [count])).rows[0].id as string;
  for (const s of [name, item, batch, count, line, catalog, spare]) env.victimSecret(s);
  const r = { name, item, batch, count, line, catalog, spare };
  latest.set(t, r);
  return r;
}
const outcome = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));
const notFound = (e: unknown) => (e instanceof CommandError && (e.code === "ERR_NOT_FOUND" || e.code === "ERR_FORBIDDEN") ? { status: 404, body: null } : Promise.reject(e));
const marker = (env: IsolationEnv) => latest.get(env.victim.tenantId)?.name ?? "";
const ok = (x: unknown) => ({ status: 200, body: JSON.parse(JSON.stringify(x)) });

export default defineCases(
  {
    kind: "route",
    id: "/stok",
    expect: "filtered",
    marker: (env) => env.victim.branchId,
    async run(env) {
      await victim(env);
      return asMine(env, "purchasing", (db) => stockContext(db as never).then(ok));
    },
  },
  {
    kind: "route",
    id: "/stok/item",
    expect: "filtered",
    marker,
    async run(env) {
      await victim(env);
      return asMine(env, "pharmacist", (db) => listItems(db as never, null).then(ok));
    },
  },
  {
    kind: "route",
    id: "/stok/item/[id]",
    expect: "not-found",
    marker,
    async run(env) {
      const v = await victim(env);
      return asMine(env, "pharmacist", (db) => getItem(db as never, v.item, null).then(ok, notFound));
    },
  },
  {
    kind: "route",
    id: "/stok/item/baru",
    expect: "filtered",
    marker: (env) => latest.get(env.victim.tenantId)?.spare ?? "",
    async run(env) {
      await victim(env);
      return asMine(env, "purchasing", (db) => itemOptions(db as never).then(ok));
    },
  },
  {
    kind: "route",
    id: "/stok/kartu",
    expect: "not-found",
    marker: (env) => latest.get(env.victim.tenantId)?.batch ?? "",
    async run(env) {
      const v = await victim(env);
      return asMine(env, "pharmacist", (db) => stockCard(db as never, v.item, null).then(ok, notFound));
    },
  },
  {
    kind: "route",
    id: "/stok/batch",
    expect: "filtered",
    marker,
    async run(env) {
      const v = await victim(env);
      await as(env, env.victim.tenantId, env.victim.branchId, "pharmacist", (db) => openVial(db as never, crypto.randomUUID(), v.batch).catch(() => undefined));
      return asMine(env, "pharmacist", (db) => batchWatch(db as never, null).then(ok));
    },
  },
  {
    kind: "route",
    id: "/stok/opname",
    expect: "filtered",
    marker: (env) => latest.get(env.victim.tenantId)?.count ?? "",
    async run(env) {
      await victim(env);
      return asMine(env, "pharmacist", (db) => listCounts(db as never, null).then(ok));
    },
  },
  {
    kind: "route",
    id: "/stok/opname/[id]",
    expect: "not-found",
    marker,
    async run(env) {
      const v = await victim(env);
      return asMine(env, "pharmacist", (db) => getCount(db as never, v.count).then(ok, notFound));
    },
  },
  {
    kind: "action",
    id: "app/(app)/stok/actions",
    marker,
    async run(env) {
      const v = await victim(env);
      const k = () => crypto.randomUUID();
      const exp = new Date(Date.now() + 100 * 86_400_000).toISOString().slice(0, 10);
      // Order matters for the positive control (every attempt must succeed as B): the vial before the hold, the
      // count recorded, submitted (above the threshold: pending) and cancelled before a new one starts on the batch.
      const attempts = {
        save: await outcome(asMine(env, "pharmacist", (db) => saveItem(db as never, k(), v.item, { unit: "U", vialSize: "100", openedUseHours: 24, storage: "dingin", highValue: true, active: true }))),
        create: await outcome(asMine(env, "purchasing", (db) => saveItem(db as never, k(), null, { catalogItemId: v.spare, unit: "pcs", storage: "ruang", highValue: false, active: true }))),
        receive: await outcome(asMine(env, "pharmacist", (db) => receiveStock(db as never, k(), null, { itemId: v.item, batchNo: "LINTAS-1", expiry: exp, quantity: "1", reason: "penerimaan" }))),
        receiveVictimBranch: await outcome(asMine(env, "purchasing", (db) => receiveStock(db as never, k(), env.victim.branchId, { itemId: v.item, batchNo: "LINTAS-2", expiry: exp, quantity: "1", reason: "penerimaan" }))),
        vial: await outcome(asMine(env, "pharmacist", (db) => openVial(db as never, k(), v.batch))),
        level: await outcome(asMine(env, "pharmacist", (db) => setLevel(db as never, k(), null, v.item, "1", "2"))),
        record: await outcome(asMine(env, "pharmacist", (db) => recordCount(db as never, k(), v.count, v.line, "1"))),
        submit: await outcome(asMine(env, "pharmacist", (db) => submitCount(db as never, k(), v.count, "Coba lintas"))),
        cancel: await outcome(asMine(env, "pharmacist", (db) => cancelCount(db as never, k(), v.count))),
        start: await outcome(asMine(env, "pharmacist", (db) => startCount(db as never, k(), false, [v.item]))),
        hold: await outcome(asMine(env, "pharmacist", (db) => holdBatch(db as never, k(), v.batch, "quarantined", "Coba lintas"))),
      };
      const read = await asMine(env, "pharmacist", (db) => getItem(db as never, v.item, null).then((x) => x.name, () => null));
      return { attempts, body: { ...attempts, read } };
    },
  },
);
