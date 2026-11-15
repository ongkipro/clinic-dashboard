// Lead (UX-18, PR-29, T-092): the lead list (and the Kampanye segment), one lead and the actions. Each run seeds in B a lead whose contact
// name is a secret and a campaign whose name is a secret; then runs as the caller's own staff: B's lead and campaign are absent from the
// lists, B's lead is not found, and every write on B's lead (next step, assign, unassign, tag a campaign) is refused. As B's staff (positive
// control) everything succeeds (a fresh lead per run, so the next step is always available).
// Synthetic data (MIG-2); no network (DEC-082).
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { setKekRingForTests } from "../../../src/lib/keys/runtime";
import { campaignList, createLead, leadGet, leadList, saveCampaign, setLeadStage, updateLead } from "../../../src/modules/crm/leads/leads";
import { assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, expectLive, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";
setKekRingForTests({ current: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) });

type CaseRole = "central_cs" | "marketing";
const accOf = new Map<string, { acc: string; staffId: string }>();
async function member(env: IsolationEnv, tenantId: string, role: CaseRole) {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('Staf', $1) returning id`, [`${role}.lead92.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Lead ${role} ${tenantId}` });
  const c = await env.owner.connect();
  try {
    await assignRole(c, { tenantId, staffId, role });
  } finally {
    c.release();
  }
  accOf.set(k, { acc, staffId });
  return { acc, staffId };
}
async function as<T>(env: IsolationEnv, tenantId: string, role: CaseRole, fn: (db: never) => Promise<T>): Promise<T> {
  const m = await member(env, tenantId, role);
  const ctx = await resolveContext(env.app, m.acc, { tenantId, actingRole: role });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}
const asMine = <T>(env: IsolationEnv, role: CaseRole, fn: (db: never) => Promise<T>) => as(env, env.actor.tenantId, role, fn);

type Seed = { lead: string; name: string; campaign: string; campaignName: string };
const seeds = new Map<string, Seed>();
async function victim(env: IsolationEnv): Promise<Seed> {
  const t = env.victim.tenantId;
  const known = seeds.get(t);
  if (known) return known;
  const name = `Kontak Lead Rahasia ${t}`;
  const campaignName = `Kampanye Rahasia ${t}`;
  const { campaignId } = await as(env, t, "marketing", (db) => saveCampaign(db, crypto.randomUUID(), { name: campaignName, code: `rahasia-${t.slice(-8)}`, channel: "ads" }));
  const { leadId } = await as(env, t, "central_cs", (db) => createLead(db, crypto.randomUUID(), { source: "phone", contactName: name, branchId: env.victim.branchId, campaignId }));
  const s = { lead: leadId, name, campaign: campaignId, campaignName };
  seeds.set(t, s);
  env.victimSecret(name);
  env.victimSecret(campaignName);
  env.victimSecret(leadId);
  return s;
}
const ok = (x: unknown) => ({ status: 200, body: JSON.parse(JSON.stringify(x)) });
const notFound = (e: unknown) => (e instanceof CommandError && e.code === "ERR_NOT_FOUND" ? { status: 404, body: null } : Promise.reject(e));
const outcome = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));
const seeded = (env: IsolationEnv) => seeds.get(env.victim.tenantId);

export default defineCases(
  { kind: "route", id: "/lead", expect: "filtered", marker: (env) => seeded(env)?.name ?? "",
    async run(env) {
      await victim(env);
      return ok({
        cs: await asMine(env, "central_cs", (db) => leadList(db, "all", "all")),
        mk: await asMine(env, "marketing", (db) => leadList(db, "all", "all")),
        campaigns: await asMine(env, "marketing", (db) => campaignList(db)),
      });
    } },
  { kind: "route", id: "/lead/[id]", expect: "not-found", marker: (env) => seeded(env)?.name ?? "",
    async run(env) {
      const v = await victim(env);
      return asMine(env, "central_cs", (db) => leadGet(db, v.lead).then(ok, notFound));
    } },
  {
    kind: "action",
    id: "app/(app)/lead/actions",
    marker: (env) => seeded(env)?.lead ?? "",
    async run(env) {
      const v = await victim(env);
      // a fresh open lead in B each run (the positive control moves it on)
      const { leadId } = await as(env, env.victim.tenantId, "central_cs", (db) => createLead(db, crypto.randomUUID(), { source: "walk_in", contactName: "Kontak Isolasi", branchId: env.victim.branchId }));
      await expectLive(env, "B's new lead", `exists (select 1 from leads where id = $1 and stage = 'new' and assignee_staff_id is null)`, [leadId]);
      const cs = await member(env, env.actor.tenantId, "central_cs");
      const attempts = {
        stage: await outcome(asMine(env, "central_cs", (db) => setLeadStage(db, crypto.randomUUID(), leadId, { to: "contacted" }))),
        assign: await outcome(asMine(env, "central_cs", (db) => updateLead(db, leadId, { action: "assign", staffId: cs.staffId }))),
        unassign: await outcome(asMine(env, "central_cs", (db) => updateLead(db, leadId, { action: "unassign" }))),
        campaign: await outcome(asMine(env, "central_cs", (db) => updateLead(db, leadId, { action: "campaign", campaignId: v.campaign }))),
      };
      return { attempts, body: { ...attempts, lead: attempts.stage === "done" ? v.lead : null } };
    },
  },
);
