// Ringkasan per peran (UX-60, PR-33, T-107): the /ringkasan/peran route reads dashboard_home (the role homes) and dashboard_kpi (the KPI
// readers behind them). Each run seeds in B, through B's own staff, a cash top-up (a K1 payment) with a unique amount and a manual-discount
// line on an issued invoice (the Audit home's manual discounts); then runs as the caller's own owner and auditor: B's amount and discount
// are absent from every KPI and home payload, and a branch filter on B's branch is not found. As B's staff (positive control) both show.
// Synthetic data (MIG-2).
import { withTenantContext } from "../../../src/db/rls/context";
import { publish } from "../../../src/modules/catalog/catalog";
import { issueKasirInvoice, openKasirInvoice } from "../../../src/modules/cashier/kasir/kasir";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { topUpBalance } from "../../../src/modules/packages/packages";
import { kpi, roleHome } from "../../../src/modules/reporting/dashboards/dashboards";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

type CaseRole = "owner" | "auditor" | "fo_cashier";
const accOf = new Map<string, string>();
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole): Promise<string> {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email, two_factor_enabled) values ('Staf', $1, true) returning id`, [`${role}.rgp107.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Ringkasan ${role}` });
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId, staffId, role });
    if (role === "fo_cashier") await assignBranch(c, { tenantId, staffRoleId: rid, branchId });
  } finally {
    c.release();
  }
  accOf.set(k, acc);
  return acc;
}
async function as<T>(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole, fn: (db: never) => Promise<T>): Promise<T> {
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const acc = await member(env, tenantId, branchId, role);
  const ctx = await resolveContext(env.app, acc, { tenantId, actingRole: role, activeBranchId: role === "fo_cashier" ? branchId : undefined });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}
const asMine = <T>(env: IsolationEnv, role: CaseRole, fn: (db: never) => Promise<T>) => as(env, env.actor.tenantId, env.actor.branchId, role, fn);

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
const period = () => ({ from: `${today().slice(0, 8)}01`, to: today() });
let runs = 0;
const items = new Map<string, string>();
const latest = new Map<string, { amount: number; discount: number }>();
async function victim(env: IsolationEnv) {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const n = ++runs;
  await member(env, t, b, "owner");
  let item = items.get(t);
  if (!item) {
    item = (await as(env, t, b, "owner", (db) => publish(db, { kind: "product", code: `RGP-${t.slice(0, 6).toUpperCase()}` },
      { name: "Produk Ringkasan Rahasia", tax_category: "exempt_medical", tax_basis: "Barang medis", normal_price: 900_000 } as never, "Produk uji isolasi"))).itemId as string;
    items.set(t, item);
  }
  const staff = (await env.owner.query(`select id from staff where tenant_id = $1 limit 1`, [t])).rows[0].id;
  const pid = (await env.owner.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Pasien Ringkasan Rahasia', '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture sintetis', 'islam',
             'Karyawan', 's1', 'kawin', $2, $3, 'fo_cashier') returning id`, [t, b, staff])).rows[0].id as string;
  const amount = 813_000 + n;
  await as(env, t, b, "fo_cashier", (db) => topUpBalance(db, crypto.randomUUID(), pid, null, { method: "cash", amount, cashTendered: amount }));
  // a manual discount within the cashier's limit (no approval needed) on an issued line
  const discount = 1_000 + n;
  const { invoiceId } = await as(env, t, b, "fo_cashier", (db) => openKasirInvoice(db, crypto.randomUUID(), { patientId: pid }));
  await as(env, t, b, "fo_cashier", (db) => issueKasirInvoice(db, crypto.randomUUID(), invoiceId, [{ itemId: item!, quantity: 1, discount }]));
  for (const x of [String(amount), invoiceId]) env.victimSecret(x);
  latest.set(t, { amount, discount });
}
const marker = (env: IsolationEnv) => String(latest.get(env.victim.tenantId)?.amount ?? "");
const ok = (x: unknown) => ({ status: 200, body: JSON.parse(JSON.stringify(x)) });

export default defineCases({
  kind: "route", id: "/ringkasan/peran", expect: "filtered", marker,
  async run(env) {
    await victim(env);
    const k1 = await asMine(env, "owner", (db) => kpi(db as never, { kpi: "k1", ...period(), detail: true }));
    const k3 = await asMine(env, "owner", (db) => kpi(db as never, { kpi: "k3", ...period(), detail: true }));
    const audit = await asMine(env, "auditor", (db) => roleHome(db as never));
    // a filter on B's branch is not found (never B's data)
    const other = env.actor.tenantId === env.victim.tenantId ? null
      : await asMine(env, "owner", (db) => kpi(db as never, { kpi: "k1", ...period(), branchId: env.victim.branchId }).then((x) => x, () => null));
    return ok({ k1, k3, audit, other });
  },
});
