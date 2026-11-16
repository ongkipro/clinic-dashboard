// Kampanye & Segmen (UX-19, PR-94, T-100): the /kampanye page's reader (the campaign workspace) and its actions (segment save, schedule,
// unschedule / cancel, send). Each run seeds in B a segment whose name is a secret and a draft campaign whose name is a secret. As A's
// owner and marketing: B's segment and campaign are absent from the workspace; saving over B's segment, scheduling, unscheduling and sending
// B's campaign are refused. As B (positive control) the workspace shows B's segment; every action succeeds on fresh B rows (the send runs
// with B's Q-15 evidence closed and is refused ERR_GATE_CLOSED — a refusal that only B's own actor can reach, so the positive control
// records its outcome as "done" when it is that gate refusal). Synthetic data (MIG-2); no network (DEC-082).
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { setKekRingForTests } from "../../../src/lib/keys/runtime";
import { campaignWorkspace, saveSegment, scheduleCampaign, sendCampaign, unscheduleCampaign } from "../../../src/modules/crm/campaigns/campaigns";
import { saveCampaign } from "../../../src/modules/crm/leads/leads";
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
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('Staf', $1) returning id`, [`${role}.kp100.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Kampanye ${role} ${tenantId}` });
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
let runs = 0;
// A fresh B segment and a fresh B campaign (draft), plus an approved marketing template row for scheduling (fixture insert as the owner).
async function seed(env: IsolationEnv) {
  const t = env.victim.tenantId;
  // the fixtures start as provisioning; campaign sending needs a live tenant
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [t]);
  const n = ++runs;
  const segName = `Segmen Rahasia ${t.slice(0, 8)}-${n}`;
  const campName = `Kampanye Rahasia ${t.slice(0, 8)}-${n}`;
  const segment = (await as(env, t, "marketing", (db) => saveSegment(db, crypto.randomUUID(), { name: segName, rules: { sex: "female" } }))).segmentId;
  const campaign = (await as(env, t, "marketing", (db) => saveCampaign(db, crypto.randomUUID(), { name: campName, code: `kr-${t.slice(0, 6)}-${n}`, channel: "whatsapp" }))).campaignId;
  const template = await templateOf(env, t);
  for (const s of [segName, campName, segment, campaign]) env.victimSecret(s);
  return { segment, campaign, template, segName };
}
const templates = new Map<string, string>();
async function templateOf(env: IsolationEnv, t: string) {
  const known = templates.get(t);
  if (known) return known;
  const staff = (await member(env, t, "owner")).staffId;
  // fixture rows (owner inserts; the isolation suite shares one database, so the mock signup's fixed Meta ids cannot be reused here). A
  // tenant has one live WABA (waba_accounts_one_live): reuse one another case connected, else add one.
  let waba = (await env.owner.query(`select id from waba_accounts where tenant_id = $1 and state <> 'revoked' order by started_at limit 1`, [t])).rows[0]?.id as string | undefined;
  if (!waba) {
    const meta = `9${String(Date.now()).slice(-9)}${String(runs).padStart(3, "0")}`;
    waba = (await env.owner.query(`insert into waba_accounts (tenant_id, onboarding_channel, state, meta_waba_id, meta_business_id, business_verification_status,
        portfolio_messaging_limit, started_by, started_as, command_key) values ($1, 'cloud_api', 'number_registered', $2, $2, 'verified', 1000, $3, 'owner', $4) returning id`,
      [t, meta, staff, `k-${crypto.randomUUID()}`])).rows[0].id as string;
  }
  const tpl = (await env.owner.query(`insert into wa_templates (tenant_id, waba_id, name, language, category, status, body, param_count, command_key)
      values ($1, $2, 'promo_isolasi', 'id', 'marketing', 'approved', 'Halo {{1}}, kabar dari {{2}}.', 2, $3)
      on conflict do nothing returning id`, [t, waba, `k-${crypto.randomUUID()}`])).rows[0]?.id as string | undefined
    ?? (await env.owner.query(`select id from wa_templates where tenant_id = $1 and waba_id = $2 and name = 'promo_isolasi'`, [t, waba])).rows[0].id as string;
  templates.set(t, tpl);
  return tpl;
}
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
const ok = (x: unknown) => ({ status: 200, body: JSON.parse(JSON.stringify(x)) });
const outcome = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));
const lastSeg = new Map<string, string>();
// the action case's marker: the segment the first attempt targets (set before any later seed of the same run)
const actionSeg = new Map<string, string>();

export default defineCases(
  { kind: "route", id: "/kampanye", expect: "filtered", marker: (env) => lastSeg.get(env.victim.tenantId) ?? "",
    async run(env) {
      const s = await seed(env);
      lastSeg.set(env.victim.tenantId, s.segName);
      return ok({
        owner: await as(env, env.actor.tenantId, "owner", (db) => campaignWorkspace(db)),
        marketing: await as(env, env.actor.tenantId, "marketing", (db) => campaignWorkspace(db)),
      });
    } },
  {
    kind: "action",
    id: "app/(app)/kampanye/actions",
    marker: (env) => actionSeg.get(env.victim.tenantId) ?? "",
    async run(env) {
      const me = env.actor.tenantId;
      const own = me === env.victim.tenantId;
      const fresh = async () => {
        const s = await seed(env);
        lastSeg.set(env.victim.tenantId, s.segName);
        await expectLive(env, "B's campaign", `exists (select 1 from campaigns where id = $1 and send_state = 'draft')`, [s.campaign]);
        return s;
      };
      const s1 = await fresh();
      actionSeg.set(env.victim.tenantId, s1.segName);
      const segment = await outcome(as(env, me, "marketing", (db) => saveSegment(db, crypto.randomUUID(), { id: s1.segment, name: "Diubah", rules: { sex: "male" } })));
      const s2 = await fresh();
      const schedule = await outcome(as(env, me, "marketing", (db) => scheduleCampaign(db, crypto.randomUUID(), s2.campaign, { segmentId: s2.segment, templateId: s2.template, scheduledFor: today() })));
      const s3 = await fresh();
      // B's campaign scheduled by B, then A tries to cancel it
      await as(env, env.victim.tenantId, "marketing", (db) => scheduleCampaign(db, crypto.randomUUID(), s3.campaign, { segmentId: s3.segment, templateId: s3.template, scheduledFor: today() }));
      const cancel = await outcome(as(env, me, "marketing", (db) => unscheduleCampaign(db, crypto.randomUUID(), s3.campaign, "cancelled")));
      const s4 = await fresh();
      await as(env, env.victim.tenantId, "marketing", (db) => scheduleCampaign(db, crypto.randomUUID(), s4.campaign, { segmentId: s4.segment, templateId: s4.template, scheduledFor: today() }));
      const sendRaw = await outcome(as(env, me, "marketing", (db) => sendCampaign(db, crypto.randomUUID(), s4.campaign)));
      // B's own send reaches its campaign and stops at B's closed Q-15 gate: that is the positive control's success
      const send = own && sendRaw === "ERR_GATE_CLOSED" ? "done" : sendRaw;
      const attempts = { segment, schedule, cancel, send };
      return { attempts, body: { ...attempts, segment: segment === "done" ? s1.segName : null } };
    },
  },
);
