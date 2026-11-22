// Ringkasan Admin Pusat (UX-57, PR-33g / PR-33, TEN-1; T-115): the DEL-2 case for the route /ringkasan/admin-pusat (auto-discovered by
// tests/isolation/isolation.test.ts; the route id is the page's path without the (app) group). The page lists the CALLER's tenant only and takes no
// selector, so the route kind is "filtered": it answers 2xx and carries nothing of another tenant.
//
// The case runs the page's core (src/app/(app)/ringkasan/admin-pusat/load.ts readAdminHome: the function the page's loader calls inside its tenant
// transaction, over the real readers) as the CALLER's own admin_pusat. Dedicated synthetic fixture in tenant B, seeded once per tenant:
// a branch of its own with NO opening hours ("Cabang Rahasia Admin Pusat": Scenario PR-33g makes it an incomplete branch the page lists), a staff
// member with a pending Owner role request (its name is shown in "Menunggu Owner"), and a pending staff invitation (counted, never shown).
//   - positive control (as B's admin_pusat): the branch is listed with "Jam buka belum diisi", and the role request names B's staff member;
//   - negative (as A's admin_pusat): none of B's branch id or name, staff name or invitation email appears.
import { createHash } from "node:crypto";
import { readAdminHome } from "../../../src/app/(app)/ringkasan/admin-pusat/load";
import { withTenantContext } from "../../../src/db/rls/context";
import { assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

const accOf = new Map<string, { acc: string; staffId: string }>();
async function member(env: IsolationEnv, tenantId: string, role: "admin_pusat" | "owner", name: string) {
  const k = `${tenantId}:${role}:${name}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('X', $1) returning id`,
    [`${role}.rap115.${createHash("sha256").update(k).digest("hex").slice(0, 12)}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: name });
  const c = await env.owner.connect();
  try {
    await assignRole(c, { tenantId, staffId, role });
  } finally {
    c.release();
  }
  const m = { acc, staffId };
  accOf.set(k, m);
  return m;
}

type Seed = { branch: string; branchName: string; staffName: string; email: string };
const seeded = new Map<string, Seed>();
async function victim(env: IsolationEnv): Promise<Seed> {
  const t = env.victim.tenantId;
  const known = seeded.get(t);
  if (known) return known;
  const branchName = "Cabang Rahasia Admin Pusat";
  const staffName = "Staf Rahasia Calon Owner";
  const email = `undangan.rahasia.${t.slice(0, 8)}@klinik-sintetis.test`;
  const branch = (await env.owner.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'RAP2', $2, 'Asia/Jakarta') returning id`, [t, branchName])).rows[0].id as string;
  const ap = await member(env, t, "admin_pusat", "Admin Pusat Korban");
  const subject = await member(env, t, "owner", staffName);
  await env.owner.query(`insert into role_requests (tenant_id, staff_id, role, change, requested_by, requested_as) values ($1, $2, 'owner', 'grant', $3, 'admin_pusat')`, [t, subject.staffId, ap.staffId]);
  await env.owner.query(`insert into staff_invitations (tenant_id, email, display_name, roles, branch_ids, token_hash, invited_by, expires_at)
    values ($1, $2, 'Calon Staf Rahasia', '{bc}', $3, $4, $5, now() + interval '1 day')`, [t, email, [branch], createHash("sha256").update(`inv-${t}`).digest("hex"), ap.staffId]);
  for (const x of [branch, branchName, staffName, email]) env.victimSecret(x);
  const s = { branch, branchName, staffName, email };
  seeded.set(t, s);
  return s;
}
const marker = (env: IsolationEnv) => seeded.get(env.victim.tenantId)?.branchName ?? "";

export default defineCases({
  kind: "route",
  id: "/ringkasan/admin-pusat",
  expect: "filtered",
  marker,
  async run(env) {
    const v = await victim(env);
    const me = await member(env, env.actor.tenantId, "admin_pusat", env.actor.tenantId === env.victim.tenantId ? "Admin Pusat Korban" : "Admin Pusat Pemanggil");
    const ctx = await resolveContext(env.app, me.acc, { tenantId: env.actor.tenantId, actingRole: "admin_pusat" });
    return withTenantContext(env.app, ctx, async (db) => {
      const data = await readAdminHome(db);
      if (env.actor.tenantId === env.victim.tenantId) {
        // positive control (B itself): the incomplete branch (Scenario PR-33g) and the role request, from the real readers
        const b = data.branches.find((x) => x.id === v.branch);
        if (!b || !b.issues.some((i) => i.text === "Jam buka belum diisi")) throw new Error(`B's branch without hours is not listed as incomplete: ${JSON.stringify(b)}`);
        if (!data.waitingOwner.some((p) => p.title.includes(v.staffName))) throw new Error("B's Owner role request is not shown");
      }
      return { status: 200, body: JSON.parse(JSON.stringify(data)) };
    });
  },
});
