// Master Layanan (UX-25, PR-88, T-034): the list renders catalog_commercial() services, the detail
// and edit pages catalog_items + catalog_versions + service rows, the new page the clinical staff list,
// all in the caller's active context; the actions publish and withdraw (approval_cancel). Each case
// seeds in B an active service with resources, a doctor, and a recipe change
// waiting for the materials review (secret names), then runs as A's owner: none of B's services,
// rows, staff or reviews appear; B's service is not found; publishing onto it, withdrawing its
// review, naming B's staff in eligibility and reading B's requirements are refused.
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { cancelApproval } from "../../../src/modules/approvals/approvals";
import { CatalogError, catalogItem, commercialCatalog, itemVersions, publish, serviceRequirements, serviceRows } from "../../../src/modules/catalog/catalog";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { listStaff } from "../../../src/modules/org/staff/staff";
import { defineCases, expectLive, type IsolationEnv } from "../case";

type R = "owner" | "manager" | "doctor";
const members = new Map<string, { acc: string; staffId: string }>();
const branchOf = (env: IsolationEnv, tenantId: string) => (env.victim.tenantId === tenantId ? env.victim.branchId : env.actor.branchId);
async function member(env: IsolationEnv, tenantId: string, role: R) {
  const k = `${tenantId}:${role}`;
  const known = members.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`${role}.lay.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const name = role === "doctor" ? `Dokter Rahasia ${tenantId.slice(0, 8)}` : `${role} layanan`;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: name });
  if (role === "doctor") env.victimSecret(name);
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId, staffId, role });
    if (role !== "owner") await assignBranch(c, { tenantId, staffRoleId: rid, branchId: branchOf(env, tenantId) });
  } finally {
    c.release();
  }
  const m = { acc, staffId };
  members.set(k, m);
  return m;
}
async function as<T>(env: IsolationEnv, tenantId: string, role: R, fn: (db: never) => Promise<T>): Promise<T> {
  const { acc } = await member(env, tenantId, role);
  const branch = role === "owner" ? undefined : branchOf(env, tenantId);
  const ctx = await resolveContext(env.app, acc, { tenantId, actingRole: role, activeBranchId: branch });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}

const FIELDS = {
  tax_category: "exempt_medical" as const, tax_basis: "Jasa pelayanan kesehatan medis", normal_price: 900_000, category: "laser_non_ablative",
  prep_min: 10, treatment_min: 40, buffer_min: 10, resources: [{ kind: "device" as const, code: "laser_non_ablative" }],
};
const seeded = new Map<string, { itemId: string; versionId: string; name: string; doctor: string }>();
// B's active service with its resources (operational only: active at once, no reviewer needed) and
// B's doctor (named by A in the eligibility attempt).
async function victimService(env: IsolationEnv) {
  const t = env.victim.tenantId;
  const known = seeded.get(t);
  if (known) return known;
  const name = `Layanan Laser Rahasia ${t.slice(0, 8)}`;
  const doctor = (await member(env, t, "doctor")).staffId;
  const p = await as(env, t, "manager", (db) => publish(db, { kind: "service", code: `LYS-${t.slice(0, 6).toUpperCase()}` }, { ...FIELDS, name }, "Layanan rahasia B"));
  if (p.state !== "active") throw new Error("B's service should be active at once");
  env.victimSecret(name);
  env.victimSecret(p.itemId);
  env.victimSecret(p.versionId);
  const v = { itemId: p.itemId, versionId: p.versionId, name, doctor };
  seeded.set(t, v);
  return v;
}
async function victimRecipe(env: IsolationEnv, v: { itemId: string; name: string; doctor: string }) {
  const material = `Bahan rahasia ${crypto.randomUUID().slice(0, 8)}`;
  const p = await as(env, env.victim.tenantId, "manager", (db) => publish(db, { itemId: v.itemId }, { ...FIELDS, name: v.name, material_formula: [{ material, qty: 1, unit: "ml" }] }, material));
  env.victimSecret(material);
  env.victimSecret(p.materialsApprovalId!);
  return { approvalId: p.materialsApprovalId!, material };
}

const refused = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CatalogError && e.reason ? `${e.code}:${e.reason}` : e instanceof CommandError ? e.code : (e as { code?: string }).code === "P0002" ? "ERR_NOT_FOUND" : Promise.reject(e)));
const detail = async (env: IsolationEnv, itemId: string, versionId: string) =>
  as(env, env.actor.tenantId, "owner", async (db) => ({
    item: await catalogItem(db as never, itemId),
    versions: (await itemVersions(db as never, itemId)).map((x) => [x.id, x.name]),
    rows: await serviceRows(db as never, versionId),
  }));

export default defineCases(
  {
    kind: "route",
    id: "/layanan",
    expect: "filtered",
    marker: (env) => seeded.get(env.victim.tenantId)?.name ?? "",
    async run(env) {
      await victimService(env);
      const body = await as(env, env.actor.tenantId, "owner", async (db) => (await commercialCatalog(db as never)).filter((r) => r.kind === "service").map((r) => [r.itemId, r.name, r.code]));
      return { status: 200, body };
    },
  },
  {
    kind: "route",
    id: "/layanan/[id]",
    expect: "not-found",
    marker: (env) => seeded.get(env.victim.tenantId)?.name ?? "",
    async run(env) {
      const v = await victimService(env);
      const r = await detail(env, v.itemId, v.versionId);
      const leaked = r.item || r.versions.length || r.rows.resources.length;
      return leaked ? { status: 200, body: { ...r, name: r.versions[0]?.[1] ?? null } } : { status: 404, body: null };
    },
  },
  {
    kind: "route",
    id: "/layanan/[id]/ubah",
    expect: "not-found",
    marker: (env) => seeded.get(env.victim.tenantId)?.name ?? "",
    async run(env) {
      const v = await victimService(env);
      const r = await detail(env, v.itemId, v.versionId);
      const staff = await as(env, env.actor.tenantId, "owner", async (db) => (await listStaff(db as never)).map((s) => s.name));
      const leaked = r.item || r.versions.length || staff.some((n) => n.startsWith("Dokter Rahasia") && n.endsWith(env.victim.tenantId.slice(0, 8)));
      return leaked ? { status: 200, body: { ...r, staff, name: r.versions[0]?.[1] ?? null } } : { status: 404, body: null };
    },
  },
  {
    kind: "route",
    id: "/layanan/baru",
    expect: "filtered",
    marker: (env) => `Dokter Rahasia ${env.victim.tenantId.slice(0, 8)}`,
    async run(env) {
      // The new-service page lists the active clinical staff for the eligibility picker: never B's.
      await victimService(env);
      const body = await as(env, env.actor.tenantId, "owner", async (db) => (await listStaff(db as never)).map((s) => [s.staffId, s.name]));
      return { status: 200, body };
    },
  },
  {
    kind: "action",
    id: "app/(app)/layanan/actions",
    marker: (env) => seeded.get(env.victim.tenantId)?.itemId ?? "",
    async run(env) {
      const v = await victimService(env);
      const pending = await victimRecipe(env, v);
      await expectLive(env, "B's materials review", `exists (select 1 from approvals where id = $1 and state = 'pending')`, [pending.approvalId]);
      // Withdraw is the requester's (B's manager): the positive control; A's manager is refused.
      const withdraw = await refused(as(env, env.actor.tenantId, "manager", (db) => cancelApproval(db as never, pending.approvalId)));
      const pub = await refused(as(env, env.actor.tenantId, "owner", (db) => publish(db as never, { itemId: v.itemId }, { ...FIELDS, name: v.name }, "Ubah layanan")));
      // Naming B's doctor in A's own service: not a staff member of A (refused by the floor check).
      const own = await refused(as(env, env.actor.tenantId, "owner", (db) => publish(db as never, { kind: "service", code: `OWN-${crypto.randomUUID().slice(0, 6).toUpperCase()}` },
        { ...FIELDS, name: "Layanan A", eligibility: [{ staff_id: v.doctor, mode: "performs" }] }, "Layanan A")));
      const req = await as(env, env.actor.tenantId, "owner", (db) => serviceRequirements(db as never, v.versionId));
      if (env.actor.tenantId !== env.victim.tenantId) {
        const st = (await env.owner.query(`select state from approvals where id = $1`, [pending.approvalId])).rows[0].state;
        if (st !== "pending") throw new Error("B's materials review changed under A");
        await as(env, env.victim.tenantId, "manager", (db) => cancelApproval(db as never, pending.approvalId));
      }
      return {
        attempts: { withdraw, publish: pub, eligibility: own === "ERR_INVALID_INPUT:delegation_floor" ? "refused" : own },
        body: { withdraw, publish: pub, item: pub === "done" ? v.itemId : null, requirements: req, eligibility: own },
      };
    },
  },
);
