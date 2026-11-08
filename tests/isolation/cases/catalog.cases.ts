// Katalog (UX-25, PR-41, T-033): the list renders catalog_commercial(), the detail and edit pages
// catalog_items + catalog_versions, all in the caller's active context; the actions publish and
// withdraw (approval_cancel). Each case seeds in B an active item and a clinical change waiting for
// review (secret name and reason), then runs as A's owner: none of B's items, versions or reviews
// appear; B's item is not found; publishing onto it, withdrawing its review are refused.
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { cancelApproval } from "../../../src/modules/approvals/approvals";
import { catalogItem, commercialCatalog, itemVersions, publish } from "../../../src/modules/catalog/catalog";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, expectLive, type IsolationEnv } from "../case";

const members = new Map<string, string>();
// The branch of the tenant the member belongs to (actor and victim are the two fixtures).
const branchOf = (env: IsolationEnv, tenantId: string) => (env.victim.tenantId === tenantId ? env.victim.branchId : env.actor.branchId);
async function member(env: IsolationEnv, tenantId: string, role: "owner" | "manager"): Promise<string> {
  const k = `${tenantId}:${role}`;
  const known = members.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`${role}.kat.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `${role} katalog` });
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId, staffId, role });
    if (role === "manager") await assignBranch(c, { tenantId, staffRoleId: rid, branchId: branchOf(env, tenantId) });
  } finally {
    c.release();
  }
  members.set(k, acc);
  return acc;
}
async function as<T>(env: IsolationEnv, tenantId: string, role: "owner" | "manager", fn: (db: never) => Promise<T>): Promise<T> {
  const acc = await member(env, tenantId, role);
  const branch = role === "manager" ? branchOf(env, tenantId) : undefined;
  const ctx = await resolveContext(env.app, acc, { tenantId, actingRole: role, activeBranchId: branch });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}

const FIELDS = { tax_category: "exempt_medical" as const, tax_basis: "Jasa pelayanan kesehatan medis", normal_price: 300_000 };
const seeded = new Map<string, { itemId: string; name: string }>();
// B's active item (no clinical fields: active at once) and, per run, a fresh clinical change waiting.
async function victimItem(env: IsolationEnv) {
  const t = env.victim.tenantId;
  const known = seeded.get(t);
  if (known) return known;
  const name = `Layanan Rahasia ${t.slice(0, 8)}`;
  const p = await as(env, t, "manager", (db) => publish(db, { kind: "service", code: `RHS-${t.slice(0, 6).toUpperCase()}` }, { ...FIELDS, name }, "Layanan rahasia B"));
  env.victimSecret(name);
  env.victimSecret(p.itemId);
  const v = { itemId: p.itemId, name };
  seeded.set(t, v);
  return v;
}
async function victimPending(env: IsolationEnv, itemId: string, name: string) {
  const reason = `Kontraindikasi rahasia ${crypto.randomUUID().slice(0, 8)}`;
  const p = await as(env, env.victim.tenantId, "manager", (db) => publish(db, { itemId }, { ...FIELDS, name, contraindications: reason }, reason));
  env.victimSecret(reason);
  env.victimSecret(p.approvalId!);
  return { approvalId: p.approvalId!, reason };
}

const refused = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : (e as { code?: string }).code === "P0002" ? "ERR_NOT_FOUND" : Promise.reject(e)));

export default defineCases(
  {
    kind: "route",
    id: "/katalog",
    expect: "filtered",
    marker: (env) => seeded.get(env.victim.tenantId)?.name ?? "",
    async run(env) {
      await victimItem(env);
      const body = await as(env, env.actor.tenantId, "owner", async (db) => (await commercialCatalog(db as never)).map((r) => [r.itemId, r.name, r.code]));
      return { status: 200, body };
    },
  },
  {
    kind: "route",
    id: "/katalog/[id]",
    expect: "not-found",
    marker: (env) => seeded.get(env.victim.tenantId)?.name ?? "",
    async run(env) {
      const v = await victimItem(env);
      const r = await as(env, env.actor.tenantId, "owner", async (db) => ({ item: await catalogItem(db as never, v.itemId), versions: (await itemVersions(db as never, v.itemId)).map((x) => [x.id, x.name]) }));
      return r.item ? { status: 200, body: { item: [r.item.id, r.item.code], versions: r.versions, name: r.versions[0]?.[1] ?? null } } : { status: 404, body: null };
    },
  },
  {
    kind: "route",
    id: "/katalog/[id]/ubah",
    expect: "not-found",
    marker: (env) => seeded.get(env.victim.tenantId)?.name ?? "",
    async run(env) {
      const v = await victimItem(env);
      const r = await as(env, env.actor.tenantId, "owner", async (db) => ({ item: await catalogItem(db as never, v.itemId), versions: (await itemVersions(db as never, v.itemId)).map((x) => x.name) }));
      return r.item ? { status: 200, body: { item: r.item.id, name: r.versions[0] ?? null } } : { status: 404, body: null };
    },
  },
  {
    kind: "route",
    id: "/katalog/baru",
    expect: "filtered",
    marker: (env) => seeded.get(env.victim.tenantId)?.name ?? "",
    async run(env) {
      // The new-item page loads the same data as the list (loadCatalog: the commercial projection)
      // for its editor check; that load must not include B's items.
      await victimItem(env);
      const body = await as(env, env.actor.tenantId, "owner", async (db) => (await commercialCatalog(db as never)).map((r) => [r.itemId, r.name]));
      return { status: 200, body };
    },
  },
  {
    kind: "action",
    id: "app/(app)/katalog/actions",
    marker: (env) => seeded.get(env.victim.tenantId)?.itemId ?? "",
    async run(env) {
      const v = await victimItem(env);
      const pending = await victimPending(env, v.itemId, v.name);
      await expectLive(env, "B's catalog review", `exists (select 1 from approvals where id = $1 and state = 'pending')`, [pending.approvalId]);
      // Withdraw is the requester's (B's manager): the positive control; A's manager is refused.
      const withdraw = await refused(as(env, env.actor.tenantId, "manager", (db) => cancelApproval(db as never, pending.approvalId)));
      // Publishing a new version onto B's item: not found for A; for B the item is open again only
      // after its own withdrawal above.
      const pub = await refused(as(env, env.actor.tenantId, "owner", (db) => publish(db as never, { itemId: v.itemId }, { ...FIELDS, name: v.name }, "Ubah item")));
      if (env.actor.tenantId !== env.victim.tenantId) {
        const st = (await env.owner.query(`select state from approvals where id = $1`, [pending.approvalId])).rows[0].state;
        if (st !== "pending") throw new Error("B's catalog review changed under A");
        // Leave B clean for the next run: B's own manager withdraws it.
        await as(env, env.victim.tenantId, "manager", (db) => cancelApproval(db as never, pending.approvalId));
      }
      return { attempts: { withdraw, publish: pub }, body: { withdraw, publish: pub, item: pub === "done" ? v.itemId : null } };
    },
  },
);
