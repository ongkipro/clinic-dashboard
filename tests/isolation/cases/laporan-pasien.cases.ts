// Laporan Pasien (UX-38, PR-95; T-116): the DEL-2 case for the route /laporan/pasien (auto-discovered by tests/isolation/isolation.test.ts; the route id is the page's path without the
// (app) group; no tests/isolation/surfaces.ts change).
//
// The case runs the page-data core (src/app/(app)/laporan/_components/load.ts reportIn: the function the page calls, over the real K10/K11/K21/K22 readers) as the CALLER's own
// owner while tenant B holds a patient with a real counter sale at a unique, non-round amount. K22 (Pasien teratas) lists that patient by MRN (and by name for an owner), so the
// MRN is the marker — unique per run, never a figure a total of A could contain:
//   - positive control (as B's owner): B's own report lists B's MRN, name and spend;
//   - negative (as A's owner): B's branch id as ?cabang= is NOT FOUND (TEN-1, never forbidden, never data); A's own report carries nothing of B (MRN, name, amount, branch id and
//     name, tenant id, legal name). Both answers are returned in the body.
// route kind "not-found": the by-id selector (?cabang=) answers 404 for another tenant's branch.
import { reportIn } from "../../../src/app/(app)/laporan/_components/load";
import { withTenantContext } from "../../../src/db/rls/context";
import { issueKasirInvoice, openKasirInvoice, receivePayment } from "../../../src/modules/cashier/kasir/kasir";
import { publish } from "../../../src/modules/catalog/catalog";
import { saveItem } from "../../../src/modules/inventory/stock";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

type CaseRole = "fo_cashier" | "owner" | "pharmacist";
const accOf = new Map<string, string>();
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole): Promise<string> {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email, two_factor_enabled) values ('Staf', $1, true) returning id`, [`${role}.lpn116.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Laporan Pasien ${role}` });
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId, staffId, role });
    if (role !== "owner") await assignBranch(c, { tenantId, staffRoleId: rid, branchId });
  } finally {
    c.release();
  }
  accOf.set(k, acc);
  return acc;
}
async function as<T>(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole, fn: (db: never) => Promise<T>): Promise<T> {
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const acc = await member(env, tenantId, branchId, role);
  const ctx = await resolveContext(env.app, acc, { tenantId, actingRole: role, activeBranchId: role === "owner" ? undefined : branchId });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}

let runs = 0;
type Seed = { mrn: string; name: string; amount: number };
const latest = new Map<string, Seed>();
const items = new Map<string, string>();
async function victim(env: IsolationEnv): Promise<Seed> {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const k = () => crypto.randomUUID();
  const n = ++runs;
  let item = items.get(t);
  if (!item) {
    item = (await as(env, t, b, "owner", (db) => publish(db, { kind: "product", code: `LPN-${t.slice(0, 6).toUpperCase()}` },
      { name: "Produk Rahasia Laporan Pasien", tax_category: "exempt_medical", tax_basis: "Obat", normal_price: 10_007, unit: "pcs" } as never, "Produk baru"))).itemId;
    // a counter sale needs the product's stock item (as the Rekon and Ringkasan Shift cases)
    await as(env, t, b, "pharmacist", (db) => saveItem(db, k(), null, { catalogItemId: item!, unit: "pcs", storage: "ruang", highValue: false, active: true }));
    items.set(t, item);
  }
  const staff = (await env.owner.query(`select id from staff where tenant_id = $1 limit 1`, [t])).rows[0].id as string;
  const name = `Pasien Rahasia Laporan ${t.slice(0, 8)} ${n}`;
  const p = (await env.owner.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $2, '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture sintetis', 'islam', 'Karyawan', 's1', 'kawin', $3, $4, 'fo_cashier')
     returning id, mrn`, [t, name, b, staff])).rows[0] as { id: string; mrn: string };
  // a unique 8-digit spend per run (qty × 10.007, qty >= 2001): K22 lists the top 10 patients by spend, and this one must rank first whatever other cases left in B; the 8 digits cannot be
  // contained by a UUID, a timestamp or another total by chance
  const qty = 2300 + n; // base 2300: no other Laporan case seeds the same amount (a shared amount lets one case pass on another's sale)
  const amount = qty * 10_007;
  const { invoiceId } = await as(env, t, b, "fo_cashier", (db) => openKasirInvoice(db, k(), { patientId: p.id, counter: true }));
  await as(env, t, b, "fo_cashier", (db) => issueKasirInvoice(db, k(), invoiceId, [{ itemId: item!, quantity: qty }]));
  await as(env, t, b, "fo_cashier", (db) => receivePayment(db, k(), invoiceId, [{ method: "cash", amount, cashTendered: amount }]));
  for (const x of [p.mrn, name, String(amount)]) env.victimSecret(x);
  const s = { mrn: p.mrn, name, amount };
  latest.set(t, s);
  return s;
}
// the marker is what the positive control must find in the body: B's patient as K22 lists it (the MRN)
const marker = (env: IsolationEnv) => latest.get(env.victim.tenantId)?.mrn ?? "";

export default defineCases({
  kind: "route",
  id: "/laporan/pasien",
  expect: "not-found",
  marker,
  async run(env) {
    await victim(env);
    return as(env, env.actor.tenantId, env.actor.branchId, "owner", async (db) => {
      // B's branch asked by the caller: the readers answer not-found for another tenant's branch (TEN-1)
      const byBranch = await reportIn(db, "pasien", "owner", { cabang: env.victim.branchId });
      const all = await reportIn(db, "pasien", "owner", {});
      // the unfiltered report of the CALLER is returned in both outcomes: it must carry nothing of B (the harness checks every registered secret in the whole body)
      if (byBranch.kind === "not-found") return { status: 404, body: JSON.parse(JSON.stringify({ all })) };
      return { status: 200, body: JSON.parse(JSON.stringify({ byBranch, all })) };
    });
  },
});
