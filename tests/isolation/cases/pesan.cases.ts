// Pesan (UX-17, PR-28, T-090): the inbox list, one thread, Templat, Nomor, the Meta webhook route and the actions. Each run seeds in B a
// connected WABA (mock Graph port, recorded fixtures), synced templates and a conversation from a webhook-delivered message whose body and
// contact name are secrets; then runs as the caller's own staff: B's conversation, messages, templates and numbers are absent from the
// lists, B's thread is not found, a webhook status from the caller's number for B's message is dropped (not found), and every write on B's
// conversation (reply, template, assign, close) or B's templates is refused. As B's staff (positive control) everything succeeds.
// T-091: B's conversation is matched to a patient; each action run delivers a fresh inbound message to B and the caller tries to flag it as a
// complaint (PR-43 inbox flag): refused as another tenant, done as B (the positive control).
// T-094 (PR-31): B's patient has a phone; each action run tries to queue a care reminder to B's patient with B's template — refused as another
// tenant (the patient and template are B's), done as B; the outbound backlog never counts B's rows for the caller.
// Synthetic data (MIG-2); no network (DEC-082).
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { setKekRingForTests } from "../../../src/lib/keys/runtime";
import { inboundText, statusEvent } from "../../../src/modules/messaging/inbox/fixtures";
import {
  inboxList, inboxThread, receiveMetaWebhook, sendInboxMessage, syncTemplates, templateList, updateConversation,
} from "../../../src/modules/messaging/inbox/inbox";
import { mockInboxPort, mockMetaAppSecret, signMeta } from "../../../src/modules/messaging/inbox/mock";
import { flagMessage } from "../../../src/modules/messaging/inbox/flag";
import { enqueueOutbound, outboundBacklog } from "../../../src/modules/messaging/outbound/outbound";
import { mockWabaGraphPort } from "../../../src/modules/messaging/waba/mock";
import { addWaNumber, completeWabaSignup, revokeWaba, startWabaSignup, wabaStatus } from "../../../src/modules/messaging/waba/waba";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, expectLive, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";
setKekRingForTests({ current: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) });

type CaseRole = "owner" | "fo_cashier" | "marketing";
const accOf = new Map<string, { acc: string; staffId: string }>();
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole) {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('Staf', $1) returning id`, [`${role}.psn90.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Pesan ${role} ${tenantId}` });
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId, staffId, role });
    if (role === "fo_cashier") await assignBranch(c, { tenantId, staffRoleId: rid, branchId });
  } finally {
    c.release();
  }
  accOf.set(k, { acc, staffId });
  return { acc, staffId };
}
async function as<T>(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole, fn: (db: never) => Promise<T>): Promise<T> {
  const m = await member(env, tenantId, branchId, role);
  const ctx = await resolveContext(env.app, m.acc, { tenantId, actingRole: role, activeBranchId: role === "fo_cashier" ? branchId : undefined });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}
const asMine = <T>(env: IsolationEnv, role: CaseRole, fn: (db: never) => Promise<T>) => as(env, env.actor.tenantId, env.actor.branchId, role, fn);

// One WABA per tenant (both actor and victim need one: the webhook case delivers from the caller's own number).
type Wa = { metaWabaId: string; pn: string };
const wabas = new Map<string, Wa>();
let seq = 0;
async function waba(env: IsolationEnv, tenantId: string, branchId: string): Promise<Wa> {
  const known = wabas.get(tenantId);
  // still live? (the settings cases may have revoked it for their own seed)
  if (known && (await env.owner.query(`select 1 from waba_routes where phone_number_id = $1 and active`, [known.pn])).rowCount) return known;
  if (known) seeds.delete(tenantId);
  // another case file's live WABA for this tenant (one live WABA per tenant): revoke it first
  const live = (await env.owner.query(`select id from waba_accounts where tenant_id = $1 and state <> 'revoked'`, [tenantId])).rows[0];
  if (live) await as(env, tenantId, branchId, "owner", (db) => revokeWaba(db, live.id, "manual"));
  const g = mockWabaGraphPort();
  const { wabaId } = await as(env, tenantId, branchId, "owner", (db) => startWabaSignup(db, crypto.randomUUID(), { onboardingChannel: "cloud_api" }));
  // a distinct recorded Meta WABA per tenant (the Meta id is unique while live)
  // a recorded Meta WABA no other tenant holds live (the Meta id is unique while live)
  const taken = new Set((await env.owner.query(`select meta_waba_id from waba_accounts where state <> 'revoked' and meta_waba_id is not null`)).rows.map((r) => r.meta_waba_id as string));
  const code = (["code-unverified", "code-unverified-2", "code-verified", "code-verified-2"] as const)
    .find((c) => !taken.has({ "code-unverified": "100000000000001", "code-unverified-2": "100000000000005", "code-verified": "100000000000002", "code-verified-2": "100000000000004" }[c]))!;
  await as(env, tenantId, branchId, "owner", (db) => completeWabaSignup(db, wabaId, code, { port: g }));
  const pn = `8${String(Date.now()).slice(-9)}${++seq}`;
  await as(env, tenantId, branchId, "owner", (db) => addWaNumber(db, crypto.randomUUID(), wabaId, { branchId, phoneNumber: `+62814${String(1000000 + seq)}`, phoneNumberId: pn }, { port: g }));
  await as(env, tenantId, branchId, "owner", (db) => syncTemplates(db));
  const metaWabaId = (await env.owner.query(`select meta_waba_id from waba_accounts where id = $1`, [wabaId])).rows[0].meta_waba_id as string;
  const w = { metaWabaId, pn };
  wabas.set(tenantId, w);
  return w;
}
const deliver = (env: IsolationEnv, body: unknown) => {
  const raw = JSON.stringify(body);
  return receiveMetaWebhook(env.app, raw, signMeta(mockMetaAppSecret()!, raw));
};
// B's seed: a conversation from a delivered message (secret body and name) and one outbound message (its provider id).
type Seed = { conversation: string; body: string; name: string; outId: string; template: string; from: string; wabaMeta: string; pn: string; patient: string };
const seeds = new Map<string, Seed>();
async function victim(env: IsolationEnv, pool: import("pg").Pool): Promise<Seed> {
  const t = env.victim.tenantId;
  const w = await waba(env, t, env.victim.branchId);
  const known = seeds.get(t);
  if (known) return known;
  const from = `6285${String(Date.now()).slice(-8)}`;
  const body = `Pesan rahasia ${t}`;
  const name = `Kontak Rahasia ${t}`;
  const raw = JSON.stringify(inboundText({ wabaId: w.metaWabaId, phoneNumberId: w.pn }, { id: `wamid.ISO${Date.now()}`, from, name, text: body, at: Math.floor(Date.now() / 1000) }));
  await receiveMetaWebhook(pool, raw, signMeta(mockMetaAppSecret()!, raw));
  const conversation = (await env.owner.query(`select id from conversations where tenant_id = $1 and contact_wa_id = $2`, [t, from])).rows[0].id as string;
  const outId = `wamid.ISOOUT${Date.now()}`;
  await as(env, t, env.victim.branchId, "fo_cashier", (db) => sendInboxMessage(db, crypto.randomUUID(), conversation, { kind: "text", body: "Balasan B" },
    { port: { ...mockInboxPort(), sendMessage: async () => ({ providerMessageId: outId }) } }));
  const template = (await env.owner.query(`select id from wa_templates where tenant_id = $1 and name = 'pengingat_janji'`, [t])).rows[0].id as string;
  // T-091: a patient for the conversation (a flag needs a matched conversation)
  const fo = await member(env, t, env.victim.branchId, "fo_cashier");
  const pid = (await env.owner.query(`insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation,
       education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Pasien Pesan Rahasia', '1990-01-01', 'female', 'nik', 'v1.1.aa.bb.cc',
       substr(md5(random()::text) || md5(random()::text), 1, 43), 'islam', 'Karyawan', 's1', 'kawin', $2, $3, 'fo_cashier') returning id`, [t, env.victim.branchId, fo.staffId])).rows[0].id as string;
  await as(env, t, env.victim.branchId, "fo_cashier", (db) => updateConversation(db, conversation, { action: "match", patientId: pid }));
  // T-094: the patient's phone (an outbound reminder needs one)
  await env.owner.query(`insert into contact_points (tenant_id, patient_id, kind, value) values ($1, $2, 'phone', $3)`, [t, pid, `+${from}`]);
  const s = { conversation, body, name, outId, template, from, wabaMeta: w.metaWabaId, pn: w.pn, patient: pid };
  seeds.set(t, s);
  env.victimSecret(body);
  env.victimSecret(name);
  env.victimSecret(conversation);
  env.victimSecret(from);
  return s;
}
const ok = (x: unknown) => ({ status: 200, body: JSON.parse(JSON.stringify(x)) });
const notFound = (e: unknown) => (e instanceof CommandError && e.code === "ERR_NOT_FOUND" ? { status: 404, body: null } : Promise.reject(e));
const outcome = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));
const seeded = (env: IsolationEnv) => seeds.get(env.victim.tenantId);

export default defineCases(
  { kind: "route", id: "/pesan", expect: "filtered", marker: (env) => seeded(env)?.name ?? "",
    async run(env) {
      await victim(env, env.app);
      return ok({ fo: await asMine(env, "fo_cashier", (db) => inboxList(db)), owner: await asMine(env, "owner", (db) => inboxList(db)),
        // T-094: the outbound backlog counts only the caller's rows (counts carry no marker; the rows' ids are checked in the action case)
        backlog: await asMine(env, "owner", (db) => outboundBacklog(db)) });
    } },
  { kind: "route", id: "/pesan/[id]", expect: "not-found", marker: (env) => seeded(env)?.body ?? "",
    async run(env) {
      const v = await victim(env, env.app);
      return asMine(env, "fo_cashier", (db) => inboxThread(db, v.conversation).then(ok, notFound));
    } },
  { kind: "route", id: "/pesan/templat", expect: "filtered", marker: (env) => seeded(env)?.template ?? "",
    async run(env) {
      await victim(env, env.app);
      return ok({ mk: await asMine(env, "marketing", (db) => templateList(db)) });
    } },
  { kind: "route", id: "/pesan/nomor", expect: "filtered", marker: (env) => wabas.get(env.victim.tenantId)?.pn ?? "",
    async run(env) {
      await victim(env, env.app);
      return ok({ owner: await asMine(env, "owner", (db) => wabaStatus(db)) });
    } },
  // The webhook resolves the tenant from the delivering number: B's own number advances B's message (positive control); the caller's number
  // reporting B's message is dropped (tenant_mismatch) and B's message keeps its status.
  { kind: "route", id: "/api/v1/webhooks/meta#route", expect: "not-found", marker: (env) => seeded(env)?.outId ?? "",
    async run(env) {
      const v = await victim(env, env.app);
      const own = env.actor.tenantId === env.victim.tenantId;
      const w = await waba(env, env.actor.tenantId, env.actor.branchId);
      // a status B has not seen yet (own: delivered; the caller: read), so the run is never answered as a duplicate
      const a = await deliver(env, statusEvent({ wabaId: w.metaWabaId, phoneNumberId: w.pn }, { id: v.outId, status: own ? "delivered" : "read", to: "6280000000000", at: Math.floor(Date.now() / 1000) }));
      if (a.outcomes[0] === "dropped") return { status: 404, body: null };
      const st = (await env.owner.query(`select status from messages where provider_message_id = $1`, [v.outId])).rows[0].status as string;
      return { status: 200, body: { message: v.outId, status: st, own } };
    } },
  {
    kind: "action",
    id: "app/(app)/pesan/actions",
    marker: (env) => seeded(env)?.conversation ?? "",
    async run(env) {
      const v = await victim(env, env.app);
      await expectLive(env, "B's open conversation", `exists (select 1 from conversations where id = $1 and state = 'open')`, [v.conversation]);
      const fo = await member(env, env.actor.tenantId, env.actor.branchId, "fo_cashier");
      const k = () => crypto.randomUUID();
      const port = mockInboxPort();
      // T-091: a fresh unflagged inbound message in B's conversation each run (HYG-010 N-1)
      const inId = `wamid.ISOFLAG${Date.now()}${Math.floor(Math.random() * 1e6)}`;
      const inRaw = JSON.stringify(inboundText({ wabaId: v.wabaMeta, phoneNumberId: v.pn }, { id: inId, from: v.from, text: `Keluhan rahasia ${inId}`, at: Math.floor(Date.now() / 1000) }));
      await receiveMetaWebhook(env.app, inRaw, signMeta(mockMetaAppSecret()!, inRaw));
      const inMsg = (await env.owner.query(`select id from messages where provider_message_id = $1`, [inId])).rows[0].id as string;
      await expectLive(env, "B's unflagged inbound message", `exists (select 1 from messages m where m.id = $1 and m.direction = 'in'
        and not exists (select 1 from complaint_tasks t where t.message_id = m.id and t.state <> 'resolved'))`, [inMsg]);
      const attempts = {
        reply: await outcome(asMine(env, "fo_cashier", (db) => sendInboxMessage(db, k(), v.conversation, { kind: "text", body: "Coba lintas" }, { port }))),
        template: await outcome(asMine(env, "fo_cashier", (db) => sendInboxMessage(db, k(), v.conversation, { kind: "template", templateId: v.template, params: ["A", "B"] }, { port }))),
        assign: await outcome(asMine(env, "fo_cashier", (db) => updateConversation(db, v.conversation, { action: "assign", staffId: fo.staffId }))),
        // reversible: the positive control unassigns again so the next run finds B's conversation unassigned
        unassign: await outcome(asMine(env, "fo_cashier", (db) => updateConversation(db, v.conversation, { action: "unassign" }))),
        // T-091: the complaint flag on B's fresh inbound message
        flag: await outcome(asMine(env, "fo_cashier", (db) => flagMessage(db, k(), inMsg, { kind: "klinis", summary: "Keluhan isolasi pesan" }))),
        // T-094: a care reminder to B's patient with B's template
        outbound: await outcome(asMine(env, "fo_cashier", (db) => enqueueOutbound(db, k(), { purpose: "care_reminder", patientId: v.patient,
          templateId: v.template, sourceKind: "appointment", sourceId: crypto.randomUUID() }))),
      };
      return { attempts, body: { ...attempts, conversation: attempts.reply === "done" ? v.conversation : null } };
    },
  },
);
