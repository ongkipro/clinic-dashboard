// Kirim Laporan Terjadwal (19 §2.13, PR-80, SET-37): DEL-2 isolation case for /laporan/terjadwal.
import { loadTerjadwalIn } from "../../../src/app/(app)/laporan/terjadwal/data";
import { withTenantContext } from "../../../src/db/rls/context";
import { assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { changeSetting } from "../../../src/modules/settings/settings";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

const accOf = new Map<string, string>();
async function ownerOf(env: IsolationEnv, tenantId: string): Promise<string> {
  const known = accOf.get(tenantId);
  if (known) return known;
  const acc = (
    await env.owner.query(
      `insert into auth_user (name, email, two_factor_enabled) values ('Owner', $1, true) returning id`,
      [`owner.terjadwal.${tenantId}@klinik-sintetis.test`],
    )
  ).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: "Owner Terjadwal" });
  const c = await env.owner.connect();
  try {
    await assignRole(c, { tenantId, staffId, role: "owner" });
  } finally {
    c.release();
  }
  accOf.set(tenantId, acc);
  return acc;
}
async function asOwner<T>(env: IsolationEnv, tenantId: string, fn: (db: never) => Promise<T>): Promise<T> {
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const acc = await ownerOf(env, tenantId);
  const ctx = await resolveContext(env.app, acc, { tenantId, actingRole: "owner" });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}

const seeded = new Set<string>();
const MARKER_TIME = "21:37";

export default defineCases({
  kind: "route",
  id: "/laporan/terjadwal",
  expect: "filtered",
  marker: () => MARKER_TIME,
  async run(env) {
    const t = env.victim.tenantId;
    if (!seeded.has(t)) {
      await asOwner(env, t, (db) =>
        changeSetting(db, {
          key: "SET-37",
          branchId: null,
          value: { ringkasan: MARKER_TIME, penerima: ["owner", "finance"] },
          reason: "Jadwal sintetis tenant B",
        }),
      );
      seeded.add(t);
    }
    env.victimSecret(MARKER_TIME);
    const data = await asOwner(env, env.actor.tenantId, (db) => loadTerjadwalIn(db));
    return { status: 200, body: JSON.parse(JSON.stringify(data)) };
  },
});
