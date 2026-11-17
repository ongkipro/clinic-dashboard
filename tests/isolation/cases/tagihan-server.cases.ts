// Saya › Tagihan Server (UX-49, PR-61, T-103): the page reader (vendor_billing_tenant_view) and Bayar (vendor_billing_bayar_begin, the first
// step of the action; the provider call and the token-fenced finish only follow a successful begin). Each run issues an invoice in B (the
// issuer as the executor would) with a secret number marker kept in B's view; as A's owner the view never contains B's invoice and Bayar on
// B's invoice is refused (not found). As B (positive control) the view lists the invoice and Bayar on it begins an attempt. The billing policy
// is a platform row: the case opens the fee-bearer gate the way the billing tests do (a fixture standing in for the owner's Q-16 decision).
// Synthetic data (MIG-2); no AutoLaris call (DEC-082).
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { tenantView } from "../../../src/modules/vendor/billing/billing";
import { assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, expectLive, type IsolationEnv } from "../case";

const owners = new Map<string, string>();
async function ownerOf(env: IsolationEnv, tenantId: string): Promise<string> {
  const known = owners.get(tenantId);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email, two_factor_enabled) values ('O', $1, true) returning id`, [`owner.ts.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: "Owner TS" });
  const c = await env.owner.connect();
  try {
    await assignRole(c, { tenantId, staffId, role: "owner" });
  } finally {
    c.release();
  }
  owners.set(tenantId, acc);
  return acc;
}
async function asOwner<T>(env: IsolationEnv, tenantId: string, fn: (db: never) => Promise<T>): Promise<T> {
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const ctx = await resolveContext(env.app, await ownerOf(env, tenantId), { tenantId, actingRole: "owner" });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}

let runs = 0;
const latest = new Map<string, { invoice: string; number: string }>();
// A fresh issued invoice in B (a fixture row as the issuer writes it; the platform policy opened as in tests/vendor/billing).
async function victim(env: IsolationEnv) {
  const t = env.victim.tenantId;
  const n = ++runs;
  await env.owner.query(`alter table vendor_billing_policy disable trigger vendor_billing_policy_guard`);
  try {
    await env.owner.query(`update vendor_billing_policy set channel_fee_bearer = 'tenant', fee_bearer_ref = 'UJI-Q16' where channel_fee_bearer is null`);
  } finally {
    await env.owner.query(`alter table vendor_billing_policy enable always trigger vendor_billing_policy_guard`);
  }
  const number = `VND-2099${String(n).padStart(2, "0")}-${String(Math.floor(Math.random() * 9000) + 1000)}${n}`;
  const period = `20${String(30 + (n % 60)).padStart(2, "0")}-${String((n % 12) + 1).padStart(2, "0")}`;
  const invoice = (await env.owner.query(`insert into vendor_invoices (tenant_id, number, kind, period, service_from, service_to, issue_date, due_date, fee_source, fee_amount,
      proration, amount_rupiah, vat_rupiah, total_rupiah, tax_basis, created_by)
    values ($1, $2, 'monthly', $3, $4::date, ($4::date + interval '1 month - 1 day')::date, $4::date, $4::date + 9, 'default', 1000000, '{"days":30,"days_in_month":30}',
      1000000, 0, 1000000, '{"status":"non_pkp"}', 'billing.fixture') returning id`, [t, number, period, `${period}-01`])).rows[0].id as string;
  for (const s of [number, invoice]) env.victimSecret(s);
  latest.set(t, { invoice, number });
  return { invoice, number };
}
const outcome = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : String(e.message).startsWith("ERR_") ? String(e.message).split(":")[0] : Promise.reject(e)));

export default defineCases(
  { kind: "route", id: "/saya/tagihan-server", expect: "filtered", marker: (env) => latest.get(env.victim.tenantId)?.number ?? "",
    async run(env) {
      await victim(env);
      return { status: 200, body: JSON.parse(JSON.stringify(await asOwner(env, env.actor.tenantId, (db) => tenantView(db)))) };
    } },
  {
    kind: "action",
    id: "app/(app)/saya/tagihan-server/actions",
    marker: (env) => latest.get(env.victim.tenantId)?.number ?? "",
    async run(env) {
      const v = await victim(env);
      await expectLive(env, "B's issued invoice", `exists (select 1 from vendor_invoices where id = $1 and state = 'issued')`, [v.invoice]);
      const bayar = await outcome(asOwner(env, env.actor.tenantId, (db: { query: (s: string, a: unknown[]) => Promise<unknown> }) =>
        db.query(`select vendor_billing_bayar_begin($1, $2, 'VABNI', array['VABNI'], now())`, [crypto.randomUUID(), v.invoice])));
      const own = env.actor.tenantId === env.victim.tenantId;
      return { attempts: { bayar }, body: { bayar, number: own && bayar === "done" ? v.number : null } };
    },
  },
);
