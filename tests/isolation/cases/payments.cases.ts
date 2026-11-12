// Payment port (PR-68, TD-43, T-073): the Simulasi page, the mock webhook route and the Simulasi actions (the Kasir's
// port actions are in kasir.cases.ts). Each run seeds in B a mock port and a pending simulated charge on an issued tagihan; then runs as the
// caller's own FO/cashier and manager: B's charges are absent from the lists or not found; every write on B's charge
// is refused; a webhook carrying B's order reference but signed with the caller's port is dropped (tenant mismatch).
// As B's staff (positive control) everything succeeds. Synthetic data (MIG-2); no network.
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { setKekRingForTests } from "../../../src/lib/keys/runtime";
import { publish } from "../../../src/modules/catalog/catalog";
import { issueKasirInvoice, openKasirInvoice } from "../../../src/modules/cashier/kasir/kasir";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { mockSecret, sign } from "../../../src/modules/payments/mock";
import { createCharge, enableMockPort, receiveMockWebhook, simulasiList, simulate } from "../../../src/modules/payments/payments";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";
setKekRingForTests({ current: 1, keys: new Map([[1, Buffer.alloc(32, 5)]]) });

type CaseRole = "fo_cashier" | "manager" | "owner";
const accOf = new Map<string, string>();
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole): Promise<string> {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('Staf', $1) returning id`, [`${role}.prt73.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Port ${role}` });
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
const asMine = <T>(env: IsolationEnv, role: CaseRole, fn: (db: never) => Promise<T>) => as(env, env.actor.tenantId, env.actor.branchId, role, fn);

type Seed = { charge: string; orderRef: string; invoice: string; amount: number };
const latest = new Map<string, Seed>();
const items = new Map<string, string>();
async function port(env: IsolationEnv, t: string, b: string) {
  await as(env, t, b, "manager", (db) => enableMockPort(db));
}
async function victim(env: IsolationEnv): Promise<Seed> {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const k = () => crypto.randomUUID();
  await port(env, t, b);
  await port(env, env.actor.tenantId, env.actor.branchId);
  let item = items.get(t);
  if (!item) {
    item = (await as(env, t, b, "owner", (db) => publish(db, { kind: "product", code: `PRT-${t.slice(0, 6).toUpperCase()}` },
      { name: "Produk Rahasia Port", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 70_000 } as never, "Produk"))).itemId;
    items.set(t, item);
  }
  const id = crypto.randomUUID().replace(/-/g, "");
  const patient = (await env.owner.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Pasien Rahasia Port', '1990-01-01', 'female', 'nik', $3, $4, 'islam', 'Karyawan', 's1', 'kawin', $2,
             (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id`,
    [t, b, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43)])).rows[0].id as string;
  const fo = (await env.owner.query(`select s.id from staff s join staff_roles r on r.staff_id = s.id where s.tenant_id = $1 and r.role = 'fo_cashier' limit 1`, [t])).rows[0]?.id
    ?? (await member(env, t, b, "fo_cashier"), (await env.owner.query(`select s.id from staff s join staff_roles r on r.staff_id = s.id where s.tenant_id = $1 and r.role = 'fo_cashier' limit 1`, [t])).rows[0].id);
  const visit = (await env.owner.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`, [t, b, patient, fo])).rows[0].id;
  const { invoiceId } = await as(env, t, b, "fo_cashier", (db) => openKasirInvoice(db, k(), { patientId: patient, visitId: visit }));
  await as(env, t, b, "fo_cashier", (db) => issueKasirInvoice(db, k(), invoiceId, [{ itemId: item!, quantity: 1 }]));
  const c = await as(env, t, b, "fo_cashier", (db) => createCharge(db, k(), invoiceId, { channel: "qris" }));
  for (const x of [c.charge_id, c.order_ref, invoiceId, patient]) env.victimSecret(x);
  const r = { charge: c.charge_id, orderRef: c.order_ref, invoice: invoiceId, amount: c.amount };
  latest.set(t, r);
  return r;
}
const outcome = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));
const idMarker = (k: keyof Seed) => (env: IsolationEnv) => String(latest.get(env.victim.tenantId)?.[k] ?? "");
const ok = (x: unknown) => ({ status: 200, body: JSON.parse(JSON.stringify(x)) });

export default defineCases(
  { kind: "route", id: "/simulasi", expect: "filtered", marker: idMarker("charge"),
    async run(env) { await victim(env); return asMine(env, "fo_cashier", (db) => simulasiList(db as never).then(ok)) as never; } },
  { kind: "route", id: "/api/v1/webhooks/payment/mock#route", expect: "not-found", marker: idMarker("charge"),
    // A webhook for B's charge signed with the caller's own port: dropped (tenant mismatch), nothing returned; as B
    // (positive control) the same body signed with B's port applies and the answer names B's charge's outcome.
    async run(env) {
      const v = await victim(env);
      const mine = (await env.owner.query(`select tenant_id, provider_account from payment_port_configs where tenant_id = $1 and active`, [env.actor.tenantId])).rows[0];
      const body = JSON.stringify({ event_id: `evt_iso_${crypto.randomUUID().replace(/-/g, "")}`, order_ref: v.orderRef, state: "paid", amount: v.amount, at: new Date().toISOString(),
        provider: "mock", provider_account: mine.provider_account, environment: "local" });
      const a = await receiveMockWebhook(env.app, body, sign(mockSecret(mine.tenant_id, mine.provider_account, 1)!, body), "local");
      const paid = (await env.owner.query(`select state from payment_charges where id = $1`, [v.charge])).rows[0].state;
      return (a.outcome === "applied" && paid === "paid" ? { status: 200, body: { charge: v.charge } } : { status: 404, body: null }) as never;
    } },
  {
    kind: "action",
    id: "app/(app)/simulasi/actions",
    marker: idMarker("charge"),
    async run(env) {
      const v = await victim(env);
      const attempts = {
        simulate: await outcome(asMine(env, "fo_cashier", (db) => simulate(db as never, v.charge, "paid", env.actor.tenantId))),
      };
      const read = await asMine(env, "fo_cashier", (db) => simulasiList(db as never).then((x) => x.charges.find((c) => c.id === v.charge)?.id ?? null));
      return { attempts, body: { ...attempts, read } };
    },
  },
);
