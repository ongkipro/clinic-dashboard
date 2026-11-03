// UX-26 Persetujuan (PR-44): the inbox, the detail and Setujui/Tolak. The pages render
// listInbox / inboxDetail in the caller's active context and the action calls
// decideApproval. Each case seeds a waiting approval in B, then runs as A's owner: B's
// approval is never listed, its detail is not found, and deciding it is not found.
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { decideApproval, requestApproval } from "../../../src/modules/approvals/approvals";
import { inboxDetail, listInbox } from "../../../src/modules/approvals/inbox";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, type IsolationEnv } from "../case";

type Member = { acc: string; staffId: string };
const owners = new Map<string, Member>();
const waiting = new Map<string, { id: string; reason: string }>(); // `${tenantId}:${use}` -> B's waiting approval

async function member(env: IsolationEnv, tenantId: string, role: "owner" | "pharmacist", branchId?: string): Promise<Member> {
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`${role}.inbox.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `${role} ${tenantId.slice(0, 8)}` });
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId, staffId, role });
    if (branchId) await assignBranch(c, { tenantId, staffRoleId: rid, branchId });
  } finally {
    c.release();
  }
  return { acc, staffId };
}

async function ownerOf(env: IsolationEnv, tenantId: string): Promise<Member> {
  const known = owners.get(tenantId);
  if (known) return known;
  const m = await member(env, tenantId, "owner");
  owners.set(tenantId, m);
  return m;
}

// One approval per surface: the action case decides its own, so the list and detail
// cases never depend on case order.
const pharmacists = new Map<string, Member>();
async function victimApproval(env: IsolationEnv, use: "view" | "decide") {
  const t = env.victim;
  const known = waiting.get(`${t.tenantId}:${use}`);
  if (known) return known;
  const ph = pharmacists.get(t.tenantId) ?? (await member(env, t.tenantId, "pharmacist", t.branchId));
  pharmacists.set(t.tenantId, ph);
  const ctx = await resolveContext(env.app, ph.acc, { tenantId: t.tenantId, actingRole: "pharmacist", activeBranchId: t.branchId });
  const reason = `Opname rahasia ${use} ${t.tenantId.slice(0, 8)}`;
  const id = await withTenantContext(env.app, ctx, (db) =>
    requestApproval(db, { type: "stock_adjustment", subjectKind: "stock_count", subjectId: crypto.randomUUID(), reason }),
  );
  const v = { id, reason };
  waiting.set(`${t.tenantId}:${use}`, v);
  env.victimSecret(id);
  env.victimSecret(reason);
  return v;
}

async function asOwner<T>(env: IsolationEnv, fn: (db: never, me: Member) => Promise<T>): Promise<T> {
  const me = await ownerOf(env, env.actor.tenantId);
  const ctx = await resolveContext(env.app, me.acc, { tenantId: env.actor.tenantId, actingRole: "owner" });
  return withTenantContext(env.app, ctx, (db) => fn(db as never, me));
}

const refused = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));

export default defineCases(
  {
    kind: "route",
    id: "/persetujuan",
    expect: "filtered",
    marker: (env) => waiting.get(`${env.victim.tenantId}:view`)?.reason ?? "",
    async run(env) {
      await victimApproval(env, "view");
      const rows = await asOwner(env, async (db) => (await listInbox(db, "owner")).rows.map((r) => [r.id, r.reason ?? ""]));
      return { status: 200, body: rows };
    },
  },
  {
    kind: "route",
    id: "/persetujuan/[id]",
    expect: "not-found",
    marker: (env) => waiting.get(`${env.victim.tenantId}:view`)?.reason ?? "",
    async run(env) {
      const v = await victimApproval(env, "view");
      const d = await asOwner(env, (db, me) => inboxDetail(db, { staffId: me.staffId, role: "owner" }, v.id));
      return d ? { status: 200, body: { id: d.id, reason: d.reason } } : { status: 404, body: null };
    },
  },
  {
    kind: "action",
    id: "app/(app)/persetujuan/actions",
    marker: (env) => waiting.get(`${env.victim.tenantId}:decide`)?.id ?? "",
    async run(env) {
      const v = await victimApproval(env, "decide");
      // The positive control runs this as B's own owner: the decision succeeds and names B's
      // approval; as A's owner it is not found.
      const outcome = await asOwner(env, (db) => refused(decideApproval(db, v.id, false, "Ditolak uji")));
      const body: Record<string, string> = outcome === "done" ? { decided: v.id } : { refused: outcome };
      return body;
    },
  },
);
