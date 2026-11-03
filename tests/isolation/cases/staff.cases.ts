// UX-3 Staf & Undangan, staff detail and Pengguna & Akses (PR-91), and their actions. The
// pages render listStaff / listInvitations / staffSessions / accessLog in the caller's
// active context; actions call the staff access functions. Each case seeds B's staff and
// invitation, then runs as A's owner: nothing of B comes back and every action on B's
// staff is not found.
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { accessLog, endMembership, removeRole, revokeSession, setBranch, setDuty, staffSessions } from "../../../src/modules/org/access/access";
import { assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { cancelInvite, invite, listInvitations, listStaff } from "../../../src/modules/org/staff/staff";
import { defineCases, type IsolationEnv } from "../case";

// Invitations are open only outside production (DEC-024 gate); the gate runs as local.
process.env.DEPLOY_ENV = "local";

const owners = new Map<string, string>();
const victims = new Map<string, { staffId: string; name: string; email: string; invitationId: string; branchId: string }>();

async function ownerOf(env: IsolationEnv, tenantId: string): Promise<string> {
  const known = owners.get(tenantId);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('Owner', $1) returning id`, [`staff.owner.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: "Owner" });
  const c = await env.owner.connect();
  try {
    await assignRole(c, { tenantId, staffId, role: "owner" });
  } finally {
    c.release();
  }
  owners.set(tenantId, acc);
  return acc;
}

async function victimStaff(env: IsolationEnv) {
  const t = env.victim.tenantId;
  const known = victims.get(t);
  if (known) return known;
  const name = `Staf Rahasia ${t.slice(0, 8)}`;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('V', $1) returning id`, [`victim.${t}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId: t, accountId: acc, displayName: name });
  const ctx = await resolveContext(env.app, await ownerOf(env, t), { tenantId: t, actingRole: "owner" });
  const email = `undangan.${t.slice(0, 8)}@klinik-sintetis.test`;
  const { invitationId } = await withTenantContext(env.app, ctx, (db) => invite(db, { email, name: "Calon Rahasia", roles: ["finance"], branchIds: [] }));
  const branchId = (await env.owner.query(`select id from branches where tenant_id = $1 limit 1`, [t])).rows[0]?.id as string;
  const v = { staffId, name, email, invitationId, branchId };
  victims.set(t, v);
  env.victimSecret(name);
  env.victimSecret(email);
  env.victimSecret(staffId);
  return v;
}

async function asOwner<T>(env: IsolationEnv, fn: Parameters<typeof withTenantContext>[2] & ((db: never) => Promise<T>)) {
  const ctx = await resolveContext(env.app, await ownerOf(env, env.actor.tenantId), { tenantId: env.actor.tenantId, actingRole: "owner" });
  return withTenantContext(env.app, ctx, fn as never) as Promise<T>;
}

const refused = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));

export default defineCases(
  {
    kind: "route",
    id: "/staf",
    expect: "filtered",
    marker: (env) => victims.get(env.victim.tenantId)?.name ?? "",
    async run(env) {
      await victimStaff(env);
      const body = await asOwner(env, async (db) => ({
        staff: (await listStaff(db)).map((s) => [s.staffId, s.name]),
        invitations: (await listInvitations(db)).map((i) => [i.email, i.name]),
      }));
      return { status: 200, body };
    },
  },
  {
    kind: "route",
    id: "/staf/[id]",
    expect: "filtered",
    marker: (env) => victims.get(env.victim.tenantId)?.name ?? "",
    async run(env) {
      const v = await victimStaff(env);
      const body = await asOwner(env, async (db) => ({
        found: (await listStaff(db)).filter((s) => s.staffId === v.staffId).map((s) => s.name),
        sessions: await refused(staffSessions(db, v.staffId)),
      }));
      return { status: 200, body: body as never };
    },
  },
  {
    kind: "route",
    id: "/pengguna-akses",
    expect: "filtered",
    marker: (env) => victims.get(env.victim.tenantId)?.name ?? "",
    async run(env) {
      await victimStaff(env);
      const body = await asOwner(env, async (db) => ({
        staff: (await listStaff(db)).map((s) => s.name),
        log: (await accessLog(db)).map((l) => [l.reason, l.objectId]),
      }));
      return { status: 200, body: body as never };
    },
  },
  {
    kind: "action",
    id: "modules/org/staff/actions",
    marker: (env) => victims.get(env.victim.tenantId)?.name ?? "",
    async run(env) {
      const v = await victimStaff(env);
      // Each action in its own transaction, as a Server Action request would run it.
      const body = {
        revoke: await refused(asOwner(env, (db) => revokeSession(db, v.staffId, null))),
        end: await refused(asOwner(env, (db) => endMembership(db, v.staffId))),
        duty: await refused(asOwner(env, (db) => setDuty(db, v.staffId, "it_admin", true))),
        role: await refused(asOwner(env, (db) => removeRole(db, v.staffId, "finance"))),
        branch: await refused(asOwner(env, (db) => setBranch(db, v.staffId, "nurse", v.branchId ?? v.staffId, true))),
        cancel: await refused(asOwner(env, (db) => cancelInvite(db, v.invitationId))),
        // Positive control: the caller's own staff list (contains the victim only for B).
        staff: await asOwner(env, async (db) => (await listStaff(db)).map((s) => s.name)),
      };
      return body as never;
    },
  },
);
