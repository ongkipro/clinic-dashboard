// PR-84 context switching (Saya › Ganti Cabang / Ganti Peran / Ganti Klinik and the
// switch action). The pages render activeContext() and the action applies
// switchContext(); each case runs them as the caller and selects tenant B's clinic and
// branch: nothing of B (tenant, branch, name) may come back, and the switch is refused.
import type pg from "pg";
import { activeContext, ContextSwitchError, switchContext } from "../../../src/modules/org/context/context";
import { assignRole, createMembership } from "../../../src/modules/org/identity";
import { defineCases, type IsolationEnv } from "../case";

const accounts = new Map<string, string>(); // tenant id -> owner account

async function ownerOf(env: IsolationEnv, tenantId: string): Promise<string> {
  const known = accounts.get(tenantId);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('Owner', $1) returning id`, [
    `ctx.owner.${tenantId}@klinik-sintetis.test`,
  ])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: "Owner" });
  const c = await env.owner.connect();
  try {
    await assignRole(c, { tenantId, staffId, role: "owner" });
  } finally {
    c.release();
  }
  accounts.set(tenantId, acc);
  return acc;
}

// What a page shows: the active clinic, branches and clinics on offer.
async function view(app: pg.Pool, acc: string, sel: Parameters<typeof activeContext>[2]) {
  const a = await activeContext(app, acc, sel);
  return a
    ? { tenant: a.context.tenantId, clinic: a.clinic.name, clinics: a.clinics.map((c) => [c.tenantId, c.name]), branches: a.branches.map((b) => [b.id, b.name]), branch: a.context.activeBranchId ?? null }
    : null;
}

const page = (id: string) =>
  ({
    kind: "route" as const,
    id,
    expect: "filtered" as const,
    marker: (env: IsolationEnv) => env.victim.branchId,
    async run(env: IsolationEnv) {
      const acc = await ownerOf(env, env.actor.tenantId);
      // The stored selection points at B's clinic and branch (forged cookie).
      const body = await view(env.app, acc, { tenantId: env.victim.tenantId, role: "owner", branchId: env.victim.branchId });
      return { status: 200, body };
    },
  });

export default defineCases(
  page("/saya/cabang"),
  page("/saya/peran"),
  page("/saya/klinik"),
  {
    kind: "action",
    id: "modules/org/context/actions",
    marker: (env) => env.victim.branchId,
    async run(env) {
      const acc = await ownerOf(env, env.actor.tenantId);
      const attempts: Record<string, unknown> = {};
      for (const [name, req] of [
        ["clinic", { kind: "clinic", tenantId: env.victim.tenantId }],
        ["branch", { kind: "branch", branchId: env.victim.branchId }],
      ] as const) {
        attempts[name] = await switchContext(env.app, acc, {}, req).then(
          (next) => next,
          (e) => (e instanceof ContextSwitchError ? "refused" : Promise.reject(e)),
        );
      }
      return attempts as never;
    },
  },
);
