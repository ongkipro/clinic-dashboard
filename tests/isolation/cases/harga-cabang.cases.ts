// Harga Cabang (UX-25, PR-42, T-035): the list renders branch prices with the commercial catalog, the
// item page the rows of one item, both in the caller's active context; the actions set and cancel
// (Owner only). Each case seeds in B an active product, a branch price in force and a scheduled one
// (secret reasons), then runs as A's owner: none of B's items, prices or branches appear; B's item is
// not found; setting a price on B's item or branch and cancelling B's scheduled price are refused.
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { catalogItem, commercialCatalog, publish } from "../../../src/modules/catalog/catalog";
import { cancelBranchPrice, effectivePrice, priceBranches, priceRows, setBranchPrice } from "../../../src/modules/catalog/prices/prices";
import { assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, expectLive, type IsolationEnv } from "../case";

const owners = new Map<string, string>();
async function ownerOf(env: IsolationEnv, tenantId: string): Promise<string> {
  const known = owners.get(tenantId);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`owner.hrg.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: "owner harga" });
  const c = await env.owner.connect();
  try {
    await assignRole(c, { tenantId, staffId, role: "owner" });
  } finally {
    c.release();
  }
  owners.set(tenantId, acc);
  return acc;
}
async function as<T>(env: IsolationEnv, tenantId: string, fn: (db: never) => Promise<T>): Promise<T> {
  const ctx = await resolveContext(env.app, await ownerOf(env, tenantId), { tenantId, actingRole: "owner" });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}

const seeded = new Map<string, { itemId: string; name: string; reason: string }>();
async function victimItem(env: IsolationEnv) {
  const t = env.victim.tenantId;
  const known = seeded.get(t);
  if (known) return known;
  const name = `Produk Harga Rahasia ${t.slice(0, 8)}`;
  const reason = `Harga rahasia ${t.slice(0, 8)}`;
  const p = await as(env, t, (db) => publish(db, { kind: "product", code: `HRG-${t.slice(0, 6).toUpperCase()}` }, { name, tax_category: "taxable_goods", tax_basis: "Barang kena pajak", normal_price: 123_457 }, "Produk rahasia B"));
  await as(env, t, (db) => setBranchPrice(db, { itemId: p.itemId, branchId: env.victim.branchId, price: 98_765, effectiveFrom: null, reason }));
  env.victimSecret(name);
  env.victimSecret(reason);
  env.victimSecret(p.itemId);
  const v = { itemId: p.itemId, name, reason };
  seeded.set(t, v);
  return v;
}
// A fresh scheduled price per run (an attempt cancels it).
async function victimScheduled(env: IsolationEnv, itemId: string) {
  const reason = `Jadwal rahasia ${crypto.randomUUID().slice(0, 8)}`;
  const r = await as(env, env.victim.tenantId, (db) => setBranchPrice(db, { itemId, branchId: env.victim.branchId, price: 87_654, effectiveFrom: new Date(Date.now() + 30 * 86_400_000 + Math.floor(Math.random() * 1e7)), reason }));
  env.victimSecret(reason);
  env.victimSecret(r.id);
  return r.id;
}
const refused = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : (e as { code?: string }).code === "P0002" ? "ERR_NOT_FOUND" : Promise.reject(e)));

export default defineCases(
  {
    kind: "route",
    id: "/katalog/harga-cabang",
    expect: "filtered",
    marker: (env) => seeded.get(env.victim.tenantId)?.reason ?? "",
    async run(env) {
      await victimItem(env);
      const body = await as(env, env.actor.tenantId, async (db) => ({
        items: (await commercialCatalog(db as never)).map((r) => [r.itemId, r.name]),
        rows: (await priceRows(db as never)).map((r) => [r.id, r.itemId, r.branchId, r.reason]),
        branches: (await priceBranches(db as never)).map((b) => [b.id, b.name]),
      }));
      return { status: 200, body };
    },
  },
  {
    kind: "route",
    id: "/katalog/harga-cabang/[item]",
    expect: "not-found",
    marker: (env) => seeded.get(env.victim.tenantId)?.reason ?? "",
    async run(env) {
      const v = await victimItem(env);
      const r = await as(env, env.actor.tenantId, async (db) => ({
        item: await catalogItem(db as never, v.itemId),
        rows: (await priceRows(db as never, v.itemId)).map((x) => [x.id, x.reason]),
        price: await effectivePrice(db as never, v.itemId, env.victim.branchId),
      }));
      return r.item || r.rows.length || r.price !== null ? { status: 200, body: { ...r, item: r.item?.id ?? null } } : { status: 404, body: null };
    },
  },
  {
    kind: "action",
    id: "app/(app)/katalog/harga-cabang/actions",
    marker: (env) => seeded.get(env.victim.tenantId)?.itemId ?? "",
    async run(env) {
      const v = await victimItem(env);
      const scheduled = await victimScheduled(env, v.itemId);
      await expectLive(env, "B's scheduled price", `exists (select 1 from branch_prices where id = $1 and state = 'active')`, [scheduled]);
      const set = await refused(as(env, env.actor.tenantId, (db) => setBranchPrice(db as never, { itemId: v.itemId, branchId: env.victim.branchId, price: 1, effectiveFrom: new Date(Date.now() + 40 * 86_400_000 + Math.floor(Math.random() * 1e7)), reason: "Ubah harga" })));
      const cancel = await refused(as(env, env.actor.tenantId, (db) => cancelBranchPrice(db as never, scheduled)));
      if (env.actor.tenantId !== env.victim.tenantId) {
        const st = (await env.owner.query(`select state from branch_prices where id = $1`, [scheduled])).rows[0].state;
        if (st !== "active") throw new Error("B's scheduled price changed under A");
        await as(env, env.victim.tenantId, (db) => cancelBranchPrice(db as never, scheduled));
      }
      return { attempts: { set, cancel }, body: { set, cancel, item: set === "done" ? v.itemId : null } };
    },
  },
);
