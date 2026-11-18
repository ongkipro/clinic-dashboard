// Piutang & Kewajiban Layanan (UX-22 ▸ Kewajiban, PR-25, T-104): the page reader, the CSV export route and the PPN fact actions. Each run
// seeds in B a top-up (patient balance, cash) and a PPN masukan row through B's own staff; then runs as the caller's own owner and finance:
// B's amounts and ids are absent from the roll-forward and every export, a filter on B's branch is not found, and a VAT fact written by
// the caller lands only in the caller's tenant. As B's staff (positive control) everything shows B's data and succeeds. Synthetic data.
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { exportRows, recordVatInputCredit, recordVatPayment, rollforward } from "../../../src/modules/accounting/subledgers/subledgers";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { topUpBalance } from "../../../src/modules/packages/packages";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

type CaseRole = "owner" | "finance" | "fo_cashier";
const accOf = new Map<string, string>();
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole): Promise<string> {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('Staf', $1) returning id`, [`${role}.kwj104.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Kewajiban ${role}` });
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
// PKP for a tenant from 40 days ago, only for the duration of fn (the tax-profile guards bypassed for this fixture only, then the tenant
// restored: other cases share tenant B and must see it non-PKP).
async function withPkp<T>(env: IsolationEnv, tenantId: string, fn: () => Promise<T>): Promise<T> {
  const staff = (await env.owner.query(`select id from staff where tenant_id = $1 limit 1`, [tenantId])).rows[0].id;
  const key = `pkp-kwj-${crypto.randomUUID()}`;
  const flip = async (on: boolean) => {
    await env.owner.query(`alter table tax_profile_changes disable trigger tax_profile_changes_guard`);
    await env.owner.query(`alter table tenants disable trigger tenants_tax_guard`);
    try {
      if (on) {
        await env.owner.query(`insert into tax_profile_changes (tenant_id, npwp, is_pkp, pkp_effective_from, reason, command_key, changed_by, changed_as, changed_at)
          values ($1, '012345678901234', true, current_date - 40, 'PKP sintetis', $2, $3, 'owner', now() - interval '45 days')`, [tenantId, key, staff]);
        await env.owner.query(`update tenants set is_pkp = true, npwp = '012345678901234', pkp_effective_from = current_date - 40 where id = $1`, [tenantId]);
      } else {
        await env.owner.query(`delete from tax_profile_changes where tenant_id = $1 and command_key = $2`, [tenantId, key]);
        await env.owner.query(`update tenants set is_pkp = false, npwp = null, pkp_effective_from = null where id = $1`, [tenantId]);
      }
    } finally {
      await env.owner.query(`alter table tax_profile_changes enable always trigger tax_profile_changes_guard`);
      await env.owner.query(`alter table tenants enable always trigger tenants_tax_guard`);
    }
  };
  await flip(true);
  try {
    return await fn();
  } finally {
    await flip(false);
  }
}
let runs = 0;
type Seed = { amount: number; ref: string; topUp: string };
const latest = new Map<string, Seed>();
async function victim(env: IsolationEnv): Promise<Seed> {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const n = ++runs;
  await member(env, t, b, "owner");
  const pid = (await env.owner.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Pasien Kewajiban Rahasia', '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture sintetis', 'islam',
             'Karyawan', 's1', 'kawin', $2, (select id from staff where tenant_id = $1 limit 1), 'fo_cashier') returning id`, [t, b])).rows[0].id as string;
  const amount = 731_000 + n;
  const topUp = (await as(env, t, b, "fo_cashier", (db) => topUpBalance(db, crypto.randomUUID(), pid, null, { method: "cash", amount, cashTendered: amount }))).receipt_id;
  const ref = `FM-RAHASIA-${t.slice(0, 8)}-${n}`;
  await withPkp(env, t, () => as(env, t, b, "finance", (db) => recordVatInputCredit(db, crypto.randomUUID(), { taxPeriod: today().slice(0, 7), amount: 9_000 + n, date: today(), reference: ref })));
  for (const x of [ref, topUp, String(amount)]) env.victimSecret(x);
  const r = { amount, ref, topUp };
  latest.set(t, r);
  return r;
}
const marker = (env: IsolationEnv) => latest.get(env.victim.tenantId)?.ref ?? "";
const amountMarker = (env: IsolationEnv) => String(latest.get(env.victim.tenantId)?.amount ?? "");
const ok = (x: unknown) => ({ status: 200, body: JSON.parse(JSON.stringify(x)) });
const outcome = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));

export default defineCases(
  {
    kind: "route", id: "/keuangan/kewajiban", expect: "filtered", marker,
    async run(env) {
      await victim(env);
      const owner = await asMine(env, "owner", (db) => rollforward(db as never, period()));
      const finance = await asMine(env, "finance", (db) => rollforward(db as never, period()));
      // a filter on B's branch is not found (never B's data)
      const other = await asMine(env, "finance", (db) => rollforward(db as never, { ...period(), branchId: env.victim.branchId }).then((x) => x, () => null));
      return ok({ owner, finance, other: env.actor.tenantId === env.victim.tenantId ? null : other });
    },
  },
  {
    kind: "route", id: "/keuangan/kewajiban/ekspor#route", expect: "filtered", marker: amountMarker,
    async run(env) {
      await victim(env);
      const out: Record<string, unknown> = {};
      for (const kind of ["vat", "patient_balance", "cash_bank", "payments"] as const) out[kind] = await asMine(env, "finance", (db) => exportRows(db as never, { kind, ...period() }));
      return ok(out);
    },
  },
  {
    kind: "action",
    id: "app/(app)/keuangan/kewajiban/actions",
    marker,
    async run(env) {
      const v = await victim(env);
      // the caller's finance records facts (PKP for the call only): they land in the caller's tenant only, never in B's
      const k = crypto.randomUUID();
      const attempts = await withPkp(env, env.actor.tenantId, async () => ({
        inputCredit: await outcome(asMine(env, "finance", (db) => recordVatInputCredit(db as never, k, { taxPeriod: today().slice(0, 7), amount: 1_000, date: today(), reference: "FM-LINTAS" }))),
        payment: await outcome(asMine(env, "finance", (db) => recordVatPayment(db as never, crypto.randomUUID(), { taxPeriod: today().slice(0, 7), amount: 1_000, date: today(), reference: "NTPN-LINTAS" }))),
      }));
      const inB = (await env.owner.query(`select count(*)::int c from vat_input_credits where tenant_id = $1 and command_key = $2`, [env.victim.tenantId, k])).rows[0].c;
      const mine = env.actor.tenantId === env.victim.tenantId;
      const read = await asMine(env, "finance", (db) => rollforward(db as never, period()).then((r) => r.vat.input_credits.map((c) => c.evidence_ref)));
      return {
        attempts: mine ? attempts : { inputCredit: inB === 0 ? "not_seen" : "done", payment: inB === 0 ? "not_seen" : "done" },
        body: { read, seenRef: read.includes(v.ref) ? v.ref : null },
      };
    },
  },
);
