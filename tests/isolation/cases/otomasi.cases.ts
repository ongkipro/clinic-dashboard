// Otomasi (UX-55, PR-94, T-097): the /otomasi page's readers (the delivery log, the pending SET-19 draft) and its draft actions. Each run
// seeds in B an automation occurrence for a patient whose name is a secret (a skipped row, as the scan writes it; owner fixture insert —
// the guard admits inserts only) and a fresh pending draft proposed by B's marketing whose reason is a secret. As A's owner and marketing:
// B's occurrence is absent from the log, B's draft is absent, and deciding or cancelling B's draft is refused. As B (positive control) the
// log shows B's patient, the draft is read, B's owner approves it (through setting_set) and B's marketing cancels its next one.
// Synthetic data (MIG-2); no network (DEC-082).
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { setKekRingForTests } from "../../../src/lib/keys/runtime";
import { automationDraft, automationLog, cancelScenarioDraft, decideScenarioDraft, proposeScenarioDraft } from "../../../src/modules/crm/automation/automation";
import { assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, expectLive, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";
setKekRingForTests({ current: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) });

type Role = "owner" | "marketing";
const accOf = new Map<string, { acc: string; staffId: string }>();
async function member(env: IsolationEnv, tenantId: string, role: Role) {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('Staf', $1) returning id`, [`${role}.ot97.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Otomasi ${role} ${tenantId}` });
  const c = await env.owner.connect();
  try {
    await assignRole(c, { tenantId, staffId, role });
  } finally {
    c.release();
  }
  accOf.set(k, { acc, staffId });
  return { acc, staffId };
}
async function as<T>(env: IsolationEnv, tenantId: string, role: Role, fn: (db: never) => Promise<T>): Promise<T> {
  const m = await member(env, tenantId, role);
  const ctx = await resolveContext(env.app, m.acc, { tenantId, actingRole: role });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}
const VALUE = { aftercare: 1, kepuasan: 7, rencana: 14, belum_jadwal: 21, pengingat: 3, isi_ulang: 5, ulang_tahun: false, batas_harian: 2 };

// A fresh pending draft in a tenant: any pending one is cancelled first by its proposer (one pending per tenant).
let runs = 0;
async function draftIn(env: IsolationEnv, tenantId: string): Promise<{ id: string; reason: string }> {
  const pending = await as(env, tenantId, "marketing", (db) => automationDraft(db));
  if (pending) await as(env, tenantId, "marketing", (db) => cancelScenarioDraft(db, pending.id));
  const reason = `Usulan rahasia ${tenantId.slice(0, 8)}-${++runs}`;
  const { draftId } = await as(env, tenantId, "marketing", (db) => proposeScenarioDraft(db, crypto.randomUUID(), VALUE, reason));
  return { id: draftId, reason };
}
type Seed = { name: string; occurrence: string };
const seeds = new Map<string, Seed>();
async function victim(env: IsolationEnv): Promise<Seed> {
  const t = env.victim.tenantId;
  // the fixtures start as provisioning; the draft commands need a live tenant (as payments.cases.ts)
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [t]);
  const known = seeds.get(t);
  if (known) return known;
  const name = `Pasien Otomasi Rahasia ${t}`;
  const staff = (await member(env, t, "marketing")).staffId;
  const pt = (await env.owner.query(`insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation,
       education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $4, '1990-01-01', 'female', 'newborn_via_guardian',
       'Fixture sintetis', 'islam', 'Karyawan', 's1', 'kawin', $2, $3, 'fo_cashier') returning id`, [t, env.victim.branchId, staff, name])).rows[0].id as string;
  const occurrence = (await env.owner.query(`insert into automation_occurrences (tenant_id, branch_id, scenario, source_kind, source_id, patient_id, offset_days,
       original_planned_for, state, skip_reason) values ($1, $2, 'kepuasan', 'visit', $3, $4, 7, current_date, 'skipped', 'patient_phone_required') returning id`,
    [t, env.victim.branchId, crypto.randomUUID(), pt])).rows[0].id as string;
  const s = { name, occurrence };
  seeds.set(t, s);
  env.victimSecret(name);
  env.victimSecret(occurrence);
  return s;
}
const ok = (x: unknown) => ({ status: 200, body: JSON.parse(JSON.stringify(x)) });
const outcome = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));
const seeded = (env: IsolationEnv) => seeds.get(env.victim.tenantId);

export default defineCases(
  { kind: "route", id: "/otomasi", expect: "filtered", marker: (env) => `${seeded(env)?.name ?? ""}`,
    async run(env) {
      await victim(env);
      const d = await draftIn(env, env.victim.tenantId);
      env.victimSecret(d.reason);
      env.victimSecret(d.id);
      return ok({
        owner: await as(env, env.actor.tenantId, "owner", (db) => automationLog(db, null, "all")),
        skipped: await as(env, env.actor.tenantId, "owner", (db) => automationLog(db, "kepuasan", "skipped")),
        draft: await as(env, env.actor.tenantId, "owner", (db) => automationDraft(db)),
        mkDraft: await as(env, env.actor.tenantId, "marketing", (db) => automationDraft(db)),
      });
    } },
  {
    kind: "action",
    id: "app/(app)/otomasi/actions",
    marker: (env) => seeded(env)?.occurrence ?? "",
    async run(env) {
      const v = await victim(env);
      // each attempt on its own fresh pending draft in B (the positive control consumes it: approved, rejected, cancelled)
      const attempt = async (role: Role, fn: (db: never, id: string) => Promise<unknown>) => {
        const d = await draftIn(env, env.victim.tenantId);
        env.victimSecret(d.id);
        await expectLive(env, "B's pending draft", `exists (select 1 from automation_scenario_drafts where id = $1 and state = 'pending')`, [d.id]);
        return outcome(as(env, env.actor.tenantId, role, (db) => fn(db, d.id)));
      };
      const attempts = {
        decide: await attempt("owner", (db, id) => decideScenarioDraft(db, id, true)),
        reject: await attempt("owner", (db, id) => decideScenarioDraft(db, id, false, "Tolak uji isolasi")),
        cancel: await attempt("marketing", (db, id) => cancelScenarioDraft(db, id)),
      };
      return { attempts, body: { ...attempts, occurrence: attempts.decide === "done" ? v.occurrence : null } };
    },
  },
);
