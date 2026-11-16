// Lead (UX-18, PR-29, T-092): the lead list (and the Kampanye segment), one lead and the actions. Each run seeds in B a lead whose contact
// name is a secret and a campaign whose name is a secret; then runs as the caller's own staff: B's lead and campaign are absent from the
// lists, B's lead is not found, and every write on B's lead (next step, assign, unassign, tag a campaign) is refused. As B's staff (positive
// control) everything succeeds (a fresh lead per run, so the next step is always available).
// T-093 (plan r1 P1-3): B also has a follow-up (its no-show task, made by the appointments trigger); the caller's follow-up list and get never
// show it and every follow-up write on it is refused; as B's central CS the writes succeed (a fresh task per run).
// T-098 (plan r1 P2-3; no new surface: the survey writer and readers go with the follow-up cases): B also has a survey on a closed visit
// (score 1, its survey_low follow-up); the caller's survey list and summary never show it, and recording a survey on B's fresh closed visit
// is refused; as B's central CS the write succeeds (a fresh visit per run: one survey per visit).
// Synthetic data (MIG-2); no network (DEC-082).
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { setKekRingForTests } from "../../../src/lib/keys/runtime";
import { followupGet, followupList, updateFollowup } from "../../../src/modules/crm/followups/followups";
import { campaignList, createLead, leadGet, leadList, saveCampaign, setLeadStage, updateLead } from "../../../src/modules/crm/leads/leads";
import { recordSurvey, surveyList, surveySummary } from "../../../src/modules/crm/surveys/surveys";
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

type Seed = { lead: string; name: string; campaign: string; campaignName: string; followup: string; survey: string };
// T-098: a closed visit in the victim tenant (fixture rows; the visit guard paused for the close only) — a fresh one per survey.
async function closedVisitFor(env: IsolationEnv, tenantId: string, branchId: string): Promise<string> {
  const o = env.owner;
  const staff = (await o.query(`select id from staff where tenant_id = $1 limit 1`, [tenantId])).rows[0].id as string;
  const pt = (await o.query(`insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation,
       education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Pasien Survei Rahasia', '1990-01-01', 'female',
       'newborn_via_guardian', 'Fixture sintetis', 'islam', 'Karyawan', 's1', 'kawin', $2, $3, 'fo_cashier') returning id`, [tenantId, branchId, staff])).rows[0].id as string;
  const v = (await o.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
    [tenantId, branchId, pt, staff])).rows[0].id as string;
  const c = await o.connect();
  try {
    await c.query(`alter table visits disable trigger visits_guard`);
    try {
      await c.query(`update visits set closed_at = clock_timestamp(), closed_by = $2 where id = $1`, [v, staff]);
    } finally {
      await c.query(`alter table visits enable always trigger visits_guard`);
    }
  } finally {
    c.release();
  }
  return v;
}
// T-093: a follow-up in the victim tenant — a no-show task (the trigger makes it as an appointment becomes no_show; admin fixture rows).
async function followupFor(env: IsolationEnv, tenantId: string, branchId: string): Promise<string> {
  const o = env.owner;
  const staff = (await o.query(`select id from staff where tenant_id = $1 limit 1`, [tenantId])).rows[0].id as string;
  const pt = (await o.query(`insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation,
       education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Pasien Tindak Lanjut Rahasia', '1990-01-01', 'female',
       'newborn_via_guardian', 'Fixture sintetis', 'islam', 'Karyawan', 's1', 'kawin', $2, $3, 'fo_cashier') returning id`, [tenantId, branchId, staff])).rows[0].id as string;
  const cv = (await o.query(`select id from catalog_versions where tenant_id = $1 limit 1`, [tenantId])).rows[0]?.id as string | undefined;
  const c = await o.connect();
  try {
    await c.query(`alter table appointments disable trigger appointments_guard`);
    let apt = "";
    try {
      if (!cv) throw new Error("no catalog version in the victim tenant");
      apt = (await c.query(`insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state, channel,
          created_by, created_as) values ($1, $2, $3, $4, $5, now() - interval '3 hours', now() - interval '150 minutes', 'booked', 'phone', $5, 'fo_cashier') returning id`,
        [tenantId, branchId, pt, cv, staff])).rows[0].id as string;
      await c.query(`update appointments set state = 'no_show', state_changed_at = now(), state_changed_by = $2 where id = $1`, [apt, staff]);
    } finally {
      await c.query(`alter table appointments enable always trigger appointments_guard`);
    }
    return (await c.query(`select id from followups where rule_code = 'no_show' and source_id = $1`, [apt])).rows[0].id as string;
  } finally {
    c.release();
  }
}
const seeds = new Map<string, Seed>();
async function victim(env: IsolationEnv): Promise<Seed> {
  const t = env.victim.tenantId;
  const known = seeds.get(t);
  if (known) return known;
  const name = `Kontak Lead Rahasia ${t}`;
  const campaignName = `Kampanye Rahasia ${t}`;
  const { campaignId } = await as(env, t, "marketing", (db) => saveCampaign(db, crypto.randomUUID(), { name: campaignName, code: `rahasia-${t.slice(-8)}`, channel: "ads" }));
  const { leadId } = await as(env, t, "central_cs", (db) => createLead(db, crypto.randomUUID(), { source: "phone", contactName: name, branchId: env.victim.branchId, campaignId }));
  // the fixtures start as provisioning; survey_record needs care_message (live or suspended), as payments.cases.ts
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = any($1) and lifecycle_state <> 'live'`, [[t, env.actor.tenantId]]);
  const survey = (await as(env, t, "central_cs", async (db) => recordSurvey(db, crypto.randomUUID(),
    { visitId: await closedVisitFor(env, t, env.victim.branchId), score: 1 }))).surveyId;
  const s = { lead: leadId, name, campaign: campaignId, campaignName, followup: await followupFor(env, t, env.victim.branchId), survey };
  seeds.set(t, s);
  env.victimSecret(name);
  env.victimSecret(campaignName);
  env.victimSecret(leadId);
  env.victimSecret(s.followup);
  env.victimSecret(s.survey);
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
        followups: await asMine(env, "central_cs", (db) => followupList(db, "all", "all")),
        // T-098
        surveys: await asMine(env, "central_cs", (db) => surveyList(db)),
        surveySummary: await asMine(env, "central_cs", (db) => surveySummary(db)),
      });
    } },
  { kind: "route", id: "/lead/[id]", expect: "not-found", marker: (env) => seeded(env)?.name ?? "",
    async run(env) {
      const v = await victim(env);
      const lead = await asMine(env, "central_cs", (db) => leadGet(db, v.lead).then(ok, notFound));
      const fu = await asMine(env, "central_cs", (db) => followupGet(db, v.followup).then(ok, notFound));
      return lead.status === 404 && fu.status === 404 ? { status: 404, body: null } : { status: 200, body: { lead: lead.body, followup: fu.body } };
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
        // T-093: a fresh open follow-up in B each run (the positive control closes it)
        followup: await outcome(asMine(env, "central_cs", async (db) => updateFollowup(db, crypto.randomUUID(),
          await followupFor(env, env.victim.tenantId, env.victim.branchId), { action: "dismiss", note: "Uji isolasi" }))),
        // T-098: a fresh closed visit in B each run (the positive control surveys it)
        survey: await outcome(asMine(env, "central_cs", async (db) => recordSurvey(db, crypto.randomUUID(),
          { visitId: await closedVisitFor(env, env.victim.tenantId, env.victim.branchId), score: 2 }))),
      };
      return { attempts, body: { ...attempts, lead: attempts.stage === "done" ? v.lead : null } };
    },
  },
);
