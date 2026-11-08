// Cabang (UX-2, PR-2, T-036): the list renders the tenant's branches, the detail one branch with its
// hours, closures, rooms, devices and services; /jam and /ruang redirect to a branch; the actions add a
// branch and write every section. Each case seeds in B a branch profile, a closure and a room (secret
// names), then runs as A's owner: none of B's branches or rows appear; B's branch is not found; every
// write onto B's branch or rows is refused.
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import {
  addClosure, branchRooms, closures, getBranch, listBranches, setHours, setRoomActive, updateProfile, upsertRoom, weeklyHours,
} from "../../../src/modules/org/branches/branches";
import { assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, type IsolationEnv } from "../case";

const owners = new Map<string, string>();
async function ownerOf(env: IsolationEnv, tenantId: string): Promise<string> {
  const known = owners.get(tenantId);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`owner.cbg.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: "owner cabang" });
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
const localDay = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jayapura" }).format(new Date(Date.now() + days * 86_400_000));

const seeded = new Map<string, { address: string; room: string; roomId: string; reason: string }>();
async function victimBranch(env: IsolationEnv) {
  const t = env.victim.tenantId;
  const known = seeded.get(t);
  if (known) return known;
  const address = `Jl. Rahasia ${t.slice(0, 8)}`;
  const room = `Ruang Rahasia ${t.slice(0, 8)}`;
  const reason = `Libur rahasia ${t.slice(0, 8)}`;
  const b = env.victim.branchId;
  await as(env, t, (db) => updateProfile(db as never, b, { address }));
  await as(env, t, (db) => setHours(db as never, b, [{ weekday: 1, opens: "09:00", closes: "17:00" }]));
  await as(env, t, (db) => addClosure(db as never, b, { date: localDay(30), reason }));
  const roomId = await as(env, t, (db) => upsertRoom(db as never, b, { name: room, kind: "treatment" }));
  for (const s of [address, room, reason, roomId]) env.victimSecret(s);
  const v = { address, room, roomId, reason };
  seeded.set(t, v);
  return v;
}
const refused = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));

const detail = async (env: IsolationEnv) => {
  await victimBranch(env);
  const b = env.victim.branchId;
  const r = await as(env, env.actor.tenantId, async (db) => ({
    branch: await getBranch(db as never, b),
    hours: await weeklyHours(db as never, b),
    closures: (await closures(db as never, b)).map((c) => c.reason),
    rooms: (await branchRooms(db as never, b)).map((x) => [x.id, x.name]),
  }));
  return r.branch || r.hours.length || r.closures.length || r.rooms.length
    ? { status: 200, body: { ...r, branch: r.branch ? [r.branch.id, r.branch.address] : null } as never }
    : { status: 404, body: null };
};

export default defineCases(
  {
    kind: "route",
    id: "/pengaturan/cabang",
    expect: "filtered",
    marker: (env) => seeded.get(env.victim.tenantId)?.address ?? "",
    async run(env) {
      await victimBranch(env);
      const body = await as(env, env.actor.tenantId, async (db) => (await listBranches(db as never)).map((b) => [b.id, b.name, b.address]));
      return { status: 200, body };
    },
  },
  { kind: "route", id: "/pengaturan/cabang/[id]", expect: "not-found", marker: (env) => seeded.get(env.victim.tenantId)?.room ?? "", run: detail },
  {
    // The redirect reads the caller's active or first allowed branch only (its own tenant's list).
    kind: "route",
    id: "/pengaturan/cabang/jam",
    expect: "filtered",
    marker: (env) => env.victim.branchId,
    async run(env) {
      await victimBranch(env);
      const body = await as(env, env.actor.tenantId, async (db) => (await listBranches(db as never)).map((b) => b.id));
      return { status: 200, body };
    },
  },
  {
    kind: "route",
    id: "/pengaturan/cabang/ruang",
    expect: "filtered",
    marker: (env) => seeded.get(env.victim.tenantId)?.roomId ?? "",
    async run(env) {
      await victimBranch(env);
      const body = await as(env, env.actor.tenantId, async (db) => {
        const mine = await listBranches(db as never);
        return Promise.all(mine.map(async (b) => (await branchRooms(db as never, b.id)).map((r) => r.id)));
      });
      return { status: 200, body: body.flat() };
    },
  },
  {
    kind: "action",
    id: "app/(app)/pengaturan/cabang/actions",
    marker: (env) => seeded.get(env.victim.tenantId)?.roomId ?? "",
    async run(env) {
      const v = await victimBranch(env);
      const b = env.victim.branchId;
      const me = env.actor.tenantId;
      const profile = await refused(as(env, me, (db) => updateProfile(db as never, b, { address: `Jl. Lain ${crypto.randomUUID().slice(0, 6)}` })));
      const hours = await refused(as(env, me, (db) => setHours(db as never, b, [{ weekday: 2, opens: "10:00", closes: "11:00" }])));
      const room = await refused(as(env, me, (db) => setRoomActive(db as never, v.roomId, true)));
      const closure = await refused(as(env, me, (db) => addClosure(db as never, b, { date: localDay(40 + Math.floor(Math.random() * 300)), reason: "Uji isolasi" })));
      return { attempts: { profile, hours, room, closure }, body: { profile, hours, room, closure, roomId: room === "done" ? v.roomId : null } };
    },
  },
);
