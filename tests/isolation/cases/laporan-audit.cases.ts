// Laporan Audit (19 §2.13, UX-53): DEL-2 isolation case for /laporan/audit.
import { loadAuditInternalIn, todayJakarta } from "../../../src/app/(app)/audit/internal/data";
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { issueKasirInvoice, openKasirInvoice } from "../../../src/modules/cashier/kasir/kasir";
import { publish } from "../../../src/modules/catalog/catalog";
import { saveItem } from "../../../src/modules/inventory/stock";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

type CaseRole = "auditor" | "owner" | "fo_cashier" | "pharmacist";
const accOf = new Map<string, string>();
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole): Promise<string> {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (
    await env.owner.query(
      `insert into auth_user (name, email, two_factor_enabled) values ('Staf', $1, true) returning id`,
      [`${role}.lapaud.${tenantId}@klinik-sintetis.test`],
    )
  ).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf LapAudit ${role}` });
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId, staffId, role });
    if (role === "fo_cashier" || role === "pharmacist") await assignBranch(c, { tenantId, staffRoleId: rid, branchId });
  } finally {
    c.release();
  }
  accOf.set(k, acc);
  return acc;
}
async function as<T>(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole, fn: (db: never) => Promise<T>): Promise<T> {
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const acc = await member(env, tenantId, branchId, role);
  const wide = role === "owner" || role === "auditor";
  const ctx = await resolveContext(env.app, acc, {
    tenantId,
    actingRole: role,
    activeBranchId: wide ? undefined : branchId,
  });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}

let runs = 0;
const latest = new Map<string, string>();
const items = new Map<string, string>();
async function victim(env: IsolationEnv): Promise<string> {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const n = ++runs;
  let item = items.get(t);
  if (!item) {
    item = (
      await as(env, t, b, "owner", (db) =>
        publish(
          db,
          { kind: "product", code: `LAUD-${t.slice(0, 6).toUpperCase()}` },
          { name: "Produk LapAudit Rahasia", tax_category: "exempt_medical", tax_basis: "Obat", normal_price: 180_000, unit: "pcs" } as never,
          "Produk lap audit sintetis",
        ),
      )
    ).itemId;
    await as(env, t, b, "pharmacist", (db) =>
      saveItem(db, crypto.randomUUID(), null, { catalogItemId: item!, unit: "pcs", storage: "ruang", highValue: false, active: true }),
    );
    items.set(t, item);
  }
  const { invoiceId } = await as(env, t, b, "fo_cashier", (db) =>
    openKasirInvoice(db, crypto.randomUUID(), { counter: true }),
  );
  const disc = 19_200 + n * 11;
  await as(env, t, b, "fo_cashier", (db) =>
    issueKasirInvoice(db, crypto.randomUUID(), invoiceId, [{ itemId: item!, quantity: 1, discount: disc }]),
  );
  const invNum = (await env.owner.query(`select number from invoices where id = $1`, [invoiceId])).rows[0].number as string;
  env.victimSecret(invNum);
  latest.set(t, invNum);
  return invNum;
}
const marker = (env: IsolationEnv) => latest.get(env.victim.tenantId) ?? "";

export default defineCases({
  kind: "route",
  id: "/laporan/audit",
  expect: "not-found",
  marker,
  async run(env) {
    await victim(env);
    const t = todayJakarta();
    const from = `${t.slice(0, 8)}01`;
    return as(env, env.actor.tenantId, env.actor.branchId, "auditor", async (db) => {
      const all = await loadAuditInternalIn(db, { from, to: t, branchId: null });
      try {
        const byBranch = await loadAuditInternalIn(db, { from, to: t, branchId: env.victim.branchId });
        return { status: 200, body: JSON.parse(JSON.stringify({ byBranch, all })) };
      } catch (e) {
        if (e instanceof CommandError && e.code === "ERR_NOT_FOUND") {
          return { status: 404, body: JSON.parse(JSON.stringify({ all })) };
        }
        throw e;
      }
    });
  },
});
