// PR-51 Log Audit (UX-31): an owner of tenant A asking for tenant B's log, or reading
// A's log, never receives B's rows.
import { withTenantContext } from "../../../src/db/rls/context";
import { record } from "../../../src/modules/audit/audit";
import { auditPageFor } from "../../../src/modules/audit/log-view";
import { assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, type IsolationEnv } from "../case";

const owners = new Map<string, string>(); // tenantId -> account id of its owner

async function ownerOf(env: IsolationEnv, tenantId: string): Promise<string> {
  const known = owners.get(tenantId);
  if (known) return known;
  const acc = (await env.owner.query(
    `insert into auth_user (name, email) values ('Owner', $1) returning id`,
    [`owner.${tenantId}@klinik-sintetis.test`],
  )).rows[0].id as string;
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

let seeded: string | undefined;

export default defineCases({
  kind: "route",
  id: "/audit",
  expect: "filtered",
  marker: () => seeded ?? "",
  async run(env) {
    const victimOwner = await ownerOf(env, env.victim.tenantId);
    if (!seeded) {
      const ctx = await resolveContext(env.app, victimOwner, { tenantId: env.victim.tenantId, actingRole: "owner" });
      seeded = await withTenantContext(env.app, ctx, (db) => record(db, { action: "export", objectKind: "tenant" }));
      env.victimSecret(seeded);
    }
    const caller = await ownerOf(env, env.actor.tenantId);
    // The caller selects the victim's tenant first (refused), then reads its own log.
    const asked = await auditPageFor(env.app, caller, { tenantId: env.victim.tenantId, role: "owner", filter: {} });
    const own = await auditPageFor(env.app, caller, { tenantId: env.actor.tenantId, role: "owner", filter: {} });
    const rows = own.kind === "ok" ? own.rows.map((r) => ({ id: r.id, objectKind: r.objectKind })) : [];
    return { status: 200, body: { asked: asked.kind, rows } };
  },
});
