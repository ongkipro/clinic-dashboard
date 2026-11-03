// Pengaturan (PR-38): the group pages render groupRows in the caller's active context; the
// actions call changeSetting / cancelDraft. Each case seeds a changed value and a waiting
// draft in B (with a secret reason), then runs as A's owner: B's values, history and draft
// never appear, and changing a B branch's value is not found.
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { cancelDraft, changeSetting, groupRows } from "../../../src/modules/settings/settings";
import { defineCases, type IsolationEnv } from "../case";

type Member = { acc: string };
const members = new Map<string, Member>(); // `${tenantId}:${role}`
const seeded = new Map<string, { reason: string; draftReason: string; approvalId: string }>();

async function member(env: IsolationEnv, tenantId: string, role: "owner" | "admin_pusat"): Promise<Member> {
  const k = `${tenantId}:${role}`;
  const known = members.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`${role}.set.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `${role} set` });
  const c = await env.owner.connect();
  try {
    await assignRole(c, { tenantId, staffId, role });
  } finally {
    c.release();
  }
  const m = { acc };
  members.set(k, m);
  return m;
}

async function as<T>(env: IsolationEnv, tenantId: string, role: "owner" | "admin_pusat", fn: (db: never) => Promise<T>): Promise<T> {
  const m = await member(env, tenantId, role);
  const ctx = await resolveContext(env.app, m.acc, { tenantId, actingRole: role });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}

async function victimSettings(env: IsolationEnv) {
  const t = env.victim.tenantId;
  const known = seeded.get(t);
  if (known) return known;
  const reason = `Alasan rahasia ${t.slice(0, 8)}`;
  const draftReason = `Usulan rahasia ${t.slice(0, 8)}`;
  await as(env, t, "owner", (db) => changeSetting(db, { key: "SET-13", branchId: env.victim.branchId, value: 77_000, reason }));
  const d = await as(env, t, "admin_pusat", (db) => changeSetting(db, { key: "SET-8", branchId: null, value: 400, reason: draftReason }));
  const v = { reason, draftReason, approvalId: d.approvalId! };
  seeded.set(t, v);
  env.victimSecret(reason);
  env.victimSecret(draftReason);
  env.victimSecret(v.approvalId);
  return v;
}

const refused = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));
const flat = (rows: Awaited<ReturnType<typeof groupRows>>) =>
  rows.map((r) => ({ key: r.def.key, current: JSON.stringify(r.current), history: r.history.map((v) => v.reason), draft: r.draft?.reason ?? null }));

export default defineCases(
  {
    kind: "route",
    id: "/pengaturan",
    expect: "filtered",
    marker: (env) => seeded.get(env.victim.tenantId)?.draftReason ?? "",
    async run(env) {
      await victimSettings(env);
      // The index lists groups (no tenant data); the money group page is what it opens.
      const body = await as(env, env.actor.tenantId, "owner", async (db) => flat(await groupRows(db as never, "owner", "uang", null)));
      return { status: 200, body };
    },
  },
  {
    kind: "route",
    id: "/pengaturan/[grup]",
    expect: "filtered",
    marker: (env) => seeded.get(env.victim.tenantId)?.reason ?? "",
    async run(env) {
      await victimSettings(env);
      // Asking for B's branch (the ?cabang= of a tenant-wide role) shows nothing of B: the
      // page only accepts branches of the caller's own context; groupRows itself filters
      // by the bound tenant.
      const body = await as(env, env.actor.tenantId, "owner", async (db) => flat(await groupRows(db as never, "owner", "uang", env.victim.branchId)));
      return { status: 200, body };
    },
  },
  {
    kind: "action",
    id: "app/(app)/pengaturan/actions",
    marker: (env) => seeded.get(env.victim.tenantId)?.approvalId ?? "",
    async run(env) {
      const v = await victimSettings(env);
      const body: Record<string, string> = {
        change: await refused(as(env, env.actor.tenantId, "owner", (db) => changeSetting(db, { key: "SET-13", branchId: env.victim.branchId, value: 1_000, reason: "Ubah cabang lain" }))),
        // B's own admin withdrawing its draft is the positive control (names the approval).
        withdraw: await refused(as(env, env.actor.tenantId, "admin_pusat", (db) => cancelDraft(db, v.approvalId))),
      };
      return body.withdraw === "done" ? { withdrew: v.approvalId } : body;
    },
  },
);
