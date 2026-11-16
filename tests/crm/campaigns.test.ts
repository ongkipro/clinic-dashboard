// T-100 Done-when: Scenario PR-94 "campaign sending gated" (02-PRD:880): a scheduled campaign to a segment of patients with marketing consent;
// the Q-15 counsel evidence is not approved → sending is refused with "Pengiriman kampanye terkunci sampai bukti hukum disetujui" and the
// segment remains editable. Segments respect marketing consent. Plus plan r3 (Sol 12e3c76b / cce6c6a6 / bebd571e / 90f4beda): the gate on
// every path (generic enqueue refused, claim re-checks after revocation), the per-patient cap at send and at dispatch (worker gap, care vs
// promo, deferral day, horizon), lifecycle capabilities and replays, legacy readers vs the workspace, the state machine, roles, tenants,
// vendor. The Meta port is the mock (no live call). Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import type { KekRing } from "../../src/lib/keys/envelope";
import { setKekRingForTests } from "../../src/lib/keys/runtime";
import { decideEvidence, uploadEvidence } from "../../src/modules/compliance/compliance";
import { campaignWorkspace, previewSegment, saveSegment, scheduleCampaign, sendCampaign, unscheduleCampaign } from "../../src/modules/crm/campaigns/campaigns";
import { campaignList, saveCampaign } from "../../src/modules/crm/leads/leads";
import { sentNotice, sentQuery } from "../../src/app/(app)/kampanye/labels";
import { RECORDED_TEMPLATES } from "../../src/modules/messaging/inbox/fixtures";
import { syncTemplates } from "../../src/modules/messaging/inbox/inbox";
import { mockInboxPort } from "../../src/modules/messaging/inbox/mock";
import type { RemoteTemplate } from "../../src/modules/messaging/inbox/port";
import { enqueueOutbound, runOutboundDispatch } from "../../src/modules/messaging/outbound/outbound";
import { mockWabaGraphPort } from "../../src/modules/messaging/waba/mock";
import { addWaNumber, completeWabaSignup, startWabaSignup } from "../../src/modules/messaging/waba/waba";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { grantConsent, publishConsentText, withdrawConsent } from "../../src/modules/patients/consents/consents";
import { mergePatients } from "../../src/modules/patients/merge/merge";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local";
const RING: KekRing = { current: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) };
const TEMPLATES: RemoteTemplate[] = [...RECORDED_TEMPLATES,
  { name: "promo_kampanye", language: "id", category: "marketing", status: "approved", body: "Halo {{1}}, ada kabar baru dari {{2}}.", paramCount: 2 }];

let h: Harness;
let app: pg.Pool;
let worker: pg.Pool;
let owner: pg.Pool;
let n = 0;
let seq = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "auditor", "marketing", "central_cs"];
const H = 3_600_000;
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
const dayPlus = (d: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(Date.now() + d * 86_400_000));

async function tenant(name: string, state = "live"): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ($1) returning id`, [state])).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, name]);
  const br = async (c: string, nm: string) =>
    (await h.admin.query(`insert into branches (tenant_id, code, name, timezone, address) values ($1, $2, $3, 'Asia/Jakarta', 'Jl. Uji') returning id`, [tenantId, c, nm])).rows[0].id as string;
  return { tenantId, b1: await br("KP1", "Kemang"), b2: await br("KP2", "Bintaro") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`kp${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf KP ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const key = () => crypto.randomUUID();
const raw = (sql: string, args: unknown[] = []) => h.admin.query(sql, args).then(() => "ok", (e) => `raw:${e.code}`);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
async function paused<R>(tables: string[], fn: () => Promise<R>) {
  for (const t of tables) await h.admin.query(`alter table ${t} disable trigger ${t}_guard`);
  try {
    return await fn();
  } finally {
    for (const t of tables) await h.admin.query(`alter table ${t} enable always trigger ${t}_guard`);
  }
}
async function patient(t: T, name: string, o: { birth?: string; sex?: "female" | "male"; branch?: string } = {}) {
  const id = (await h.admin.query(`insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation,
       education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $2, $3, $4, 'newborn_via_guardian', 'Fixture sintetis',
       'islam', 'Karyawan', 's1', 'kawin', $5, (select id from staff where tenant_id = $1 limit 1), 'fo_cashier') returning id`,
    [t.tenantId, name, o.birth ?? "1990-06-15", o.sex ?? "female", o.branch ?? t.b1])).rows[0].id as string;
  await h.admin.query(`insert into contact_points (tenant_id, patient_id, kind, value) values ($1, $2, 'phone', $3)`, [t.tenantId, id, `+62857${String(10000000 + ++seq)}`]);
  return id;
}
async function visit(t: T, pt: string, at: Date, fo: P) {
  return paused(["visits"], async () => (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by, checked_in_at, closed_at, closed_by)
      values ($1, $2, $3, 'walk_in', $4, $5, $5, $4) returning id`, [t.tenantId, t.b1, pt, fo.staffId, at])).rows[0].id as string);
}
// run every due row through the mock port at a far-future instant (an empty due queue for the next test)
let flushAt = 400;
const flush = async () => runOutboundDispatch(worker, { port: mockInboxPort(), now: new Date(Date.now() + (flushAt += 30) * H) });
const outbox = async (campaignId: string) => (await h.admin.query(`select patient_id, state, skip_reason, deferred_reason, planned_for::text planned
  from outbound_messages where source_kind = 'campaign' and source_id = $1 order by patient_id`, [campaignId])).rows;

let A: T; let B: T;
let OWN: P; let AP: P; let MKT: P; let AU: P; let CS: P; let MGR: P; let BC: P; let FO: P; let FIN: P; let DOC: P; let BOWN: P; let BMKT: P;
let marketingText: string; let FH: P;
let promoTpl: string;
// G: the gate-open tenant (approved Q-15 fixture evidence; the second verified WABA fixture); each test uses its own branch-tagged patients
let G: T; let GOWN: P; let GFO: P; let GREC: P; let gTpl: string; let gText: string;
const gConsent = (pt: string) => as(GFO, (db) => grantConsent(db, key(), { patientId: pt, purpose: "marketing_wa", textId: gText, channel: "in_person" }));
// a G campaign scheduled today for exactly the given patients (a segment by birthday month unique to the test: patients get that month)
async function gCampaign(month: number) {
  const seg = (await as(GOWN, (db) => saveSegment(db, key(), { name: `Bulan ${month} ${++seq}`, rules: { birthday_month: month } }))).segmentId;
  const c = (await as(GOWN, (db) => saveCampaign(db, key(), { name: `Kampanye G ${seq}`, code: `kg-${seq}`, channel: "whatsapp" }))).campaignId;
  await as(GOWN, (db) => scheduleCampaign(db, key(), c, { segmentId: seg, templateId: gTpl, scheduledFor: today() }));
  return { c, seg };
}
const born = (month: number) => `1990-${String(month).padStart(2, "0")}-10`;
const consent = async (t: T, fo: P, pt: string) => as(fo, (db) => grantConsent(db, key(), { patientId: pt, purpose: "marketing_wa", textId: marketingText, channel: "in_person" }));
const pdf = (s: string) => Buffer.from(`%PDF-1.7\n${s}\n%%EOF\n`);
// The Q-15 counsel evidence (public_site_counsel) uploaded and approved by the owner, or revoked.
async function counsel(o: P, decision: "approved" | "revoked") {
  if (decision === "approved") await as(o, (db) => uploadEvidence(db, { obligationKey: "public_site_counsel", fileName: "pendapat.pdf", content: pdf(`counsel ${++n}`),
    expertName: "Konsultan Hukum Sintetis", documentDate: "2026-10-01" }));
  const item = (await h.admin.query(`select id from evidence_items where tenant_id = $1 and obligation_key = 'public_site_counsel'`, [o.tenantId])).rows[0].id as string;
  const file = (await h.admin.query(`select id from evidence_files where item_id = $1 order by version desc limit 1`, [item])).rows[0].id as string;
  await as(o, (db) => decideEvidence(db, item, file, decision, decision === "revoked" ? "Dicabut untuk uji" : undefined, decision === "approved" ? dayPlus(300) : undefined));
}
// Each Meta WABA belongs to one tenant: the two verified fixture codes serve tenant A and the gate-open tenant G.
async function connect(t: T, o: P, fixtureCode: "code-verified" | "code-verified-2") {
  const g = mockWabaGraphPort();
  const { wabaId } = await as(o, (db) => startWabaSignup(db, key(), { onboardingChannel: "cloud_api" }));
  await as(o, (db) => completeWabaSignup(db, wabaId, fixtureCode as never, { port: g }));
  await as(o, (db) => addWaNumber(db, key(), wabaId, { branchId: t.b1, phoneNumber: `+62812${String(3000000 + ++seq)}`, phoneNumberId: `7${String(Date.now()).slice(-9)}${seq}` }, { port: g }));
  await as(o, (db) => syncTemplates(db, { port: { ...mockInboxPort(), fetchTemplates: async () => TEMPLATES.map((x) => ({ ...x })) } }));
  await paused(["waba_accounts"], () => h.admin.query(`update waba_accounts set portfolio_messaging_limit = 1000 where id = $1`, [wabaId]));
  return (await h.admin.query(`select id from wa_templates where tenant_id = $1 and name = 'promo_kampanye'`, [t.tenantId])).rows[0].id as string;
}
async function campaign(o: P, name: string) {
  return (await as(o, (db) => saveCampaign(db, key(), { name, code: `kp-${++seq}`, channel: "whatsapp" }))).campaignId;
}
async function scheduled(o: P, rules: Record<string, unknown>, day = today()) {
  const seg = (await as(o, (db) => saveSegment(db, key(), { name: `Segmen ${++seq}`, rules }))).segmentId;
  const c = await campaign(o, `Kampanye ${seq}`);
  await as(o, (db) => scheduleCampaign(db, key(), c, { segmentId: seg, templateId: promoTpl, scheduledFor: day }));
  return { c, seg };
}

beforeAll(async () => {
  setKekRingForTests(RING);
  h = await createHarness();
  const login = h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE]));
  app = await openAppPool({ connectionString: login, max: 6 });
  worker = await openAppPool({ connectionString: login, max: 3 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant("PT Klinik Kampanye Sintetis");
  B = await tenant("PT Klinik Lain Kampanye");
  OWN = await person(A, "owner"); AP = await person(A, "admin_pusat"); MKT = await person(A, "marketing"); AU = await person(A, "auditor");
  CS = await person(A, "central_cs"); MGR = await person(A, "manager", A.b1); BC = await person(A, "bc", A.b1); FO = await person(A, "fo_cashier", A.b1);
  FIN = await person(A, "finance"); DOC = await person(A, "doctor", A.b1); FH = await person(A, "facility_head", A.b1);
  BOWN = await person(B, "owner"); BMKT = await person(B, "marketing");
  promoTpl = await connect(A, OWN, "code-verified");
  G = await tenant("PT Klinik Gerbang Terbuka");
  GOWN = await person(G, "owner"); GFO = await person(G, "fo_cashier", G.b1); GREC = await person(G, "records_officer", G.b1);
  gTpl = await connect(G, GOWN, "code-verified-2");
  gText = (await as(GOWN, (db) => publishConsentText(db, { purpose: "marketing_wa", body: "Saya setuju menerima promosi klinik." }))).id;
  await counsel(GOWN, "approved");
  marketingText = (await as(OWN, (db) => publishConsentText(db, { purpose: "marketing_wa", body: "Saya setuju menerima promosi klinik." }))).id;
}, 300_000);
afterAll(async () => {
  setKekRingForTests(undefined);
  await app?.end();
  await worker?.end();
  await owner?.end();
  await h?.close();
});

describe("T-100 Scenario PR-94: campaign sending gated", () => {
  it("a scheduled campaign to a consented segment; Q-15 evidence not approved → refused with the copy, nothing queued, segment editable", async () => {
    const yes = await patient(A, "Pasien Setuju Promo");
    await patient(A, "Pasien Tanpa Persetujuan");
    await consent(A, FO, yes);
    const { c, seg } = await scheduled(MKT, { branch_id: A.b1 });
    expect(await code(as(MKT, (db) => sendCampaign(db, key(), c)))).toBe("ERR_GATE_CLOSED");
    expect(await outbox(c)).toEqual([]);
    const w = await as(MKT, campaignWorkspace);
    expect(w.campaigns.find((x) => x.id === c)).toMatchObject({ send_state: "scheduled" });
    expect(w.gate).toEqual({ open: false, missing: [] }); // marketing: no evidence labels (cannot open Kepatuhan)
    expect((await as(OWN, campaignWorkspace)).gate).toEqual({ open: false, missing: ["Pendapat hukum situs klinik (Permenkes 1787/2010)"] });
    expect((await as(AP, campaignWorkspace))).toMatchObject({ can_manage: true, gate: { open: false, missing: ["Pendapat hukum situs klinik (Permenkes 1787/2010)"] } });
    expect(await code(as(AP, (db) => sendCampaign(db, key(), c)))).toBe("ERR_GATE_CLOSED"); // admin pusat may send — still gated
    // the segment remains editable while sending is locked
    await as(MKT, (db) => saveSegment(db, key(), { id: seg, name: "Segmen diubah", rules: { branch_id: A.b1, sex: "female" } }));
    expect((await as(MKT, campaignWorkspace)).segments.find((x) => x.id === seg)).toMatchObject({ name: "Segmen diubah", rules: { branch_id: A.b1, sex: "female" } });
  });
});

describe("T-100 gate open (fixture evidence): consent, keying, bypass, revocation", () => {
  it("only consented members are queued, once each; merged patient once; replay queues nothing new; the generic enqueue refuses 'campaign'", async () => {
    const yes1 = await patient(G, "Setuju Satu", { birth: born(1) }); const yes2 = await patient(G, "Setuju Dua", { birth: born(1) });
    const no = await patient(G, "Belum Setuju", { birth: born(1) }); const dup = await patient(G, "Setuju Ganda", { birth: born(1) });
    for (const p of [yes1, yes2, dup]) await gConsent(p);
    await as(GREC, (db) => mergePatients(db, key(), yes2, dup, "Data ganda: pasien yang sama"));
    expect(await as(GOWN, (db) => previewSegment(db, { birthday_month: 1 }))).toBe(2); // yes1, yes2 (dup merged into yes2); not `no`
    const { c } = await gCampaign(1);
    const k = key();
    expect(await as(GOWN, (db) => sendCampaign(db, k, c))).toMatchObject({ queued: 2, skipped: {}, replayed: false });
    expect((await outbox(c)).map((r) => r.patient_id).sort()).toEqual([yes1, yes2].sort());
    expect((await outbox(c)).map((r) => r.patient_id)).not.toContain(no);
    expect(await as(GOWN, (db) => sendCampaign(db, k, c))).toMatchObject({ queued: 2, replayed: true });
    expect(await outbox(c)).toHaveLength(2);
    expect(await code(as(GOWN, (db) => sendCampaign(db, key(), c)))).toBe("ERR_VERSION_CONFLICT"); // queued is final
    // review r1 P1-2 c: the generic writer cannot queue a campaign message
    expect(await code(as(GOWN, (db) => enqueueOutbound(db, key(), { purpose: "promo", patientId: yes1, templateId: gTpl, sourceKind: "campaign", sourceId: c } as never))))
      .toBe("ERR_INVALID_INPUT");
    // the event carries ids only (TD-50); the counts are the command's result
    const ev = (await h.admin.query(`select payload from domain_events where type = 'CampaignQueued' and aggregate_id = $1`, [c])).rows[0].payload;
    expect(Object.keys(ev).sort()).toEqual(["campaign_id", "segment_id"]);
    await flush();
    expect((await outbox(c)).map((r) => r.state)).toEqual(["sent", "sent"]); // gate open: sent through the mock port
  });

  it("consent withdrawn after queueing → skipped consent_withdrawn at dispatch (gate still open)", async () => {
    const p = await patient(G, "Tarik Persetujuan", { birth: born(2) });
    const g = await gConsent(p);
    if (!g.ok) throw new Error(g.code);
    const { c } = await gCampaign(2);
    await as(GOWN, (db) => sendCampaign(db, key(), c));
    await as(GFO, (db) => withdrawConsent(db, key(), { consentId: g.consentId, channel: "in_person", reason: "Pasien menolak promosi" }));
    await flush();
    expect((await outbox(c)).map((r) => [r.state, r.skip_reason])).toEqual([["skipped", "consent_withdrawn"]]);
  });

  // last in this file's G sequence: revokes G's evidence (re-approved at the end)
  it("approve → queue → revoke → the worker skips campaign_locked (not sent); a care message of the tenant still sends", async () => {
    const p1 = await patient(G, "Dicabut Satu", { birth: born(3) }); const p2 = await patient(G, "Dicabut Dua", { birth: born(3) });
    for (const p of [p1, p2]) await gConsent(p);
    const { c } = await gCampaign(3);
    expect((await as(GOWN, (db) => sendCampaign(db, key(), c))).queued).toBe(2);
    await counsel(GOWN, "revoked");
    try {
      const sentBefore = (await h.admin.query(`select count(*)::int n from outbound_messages where tenant_id = $1 and state = 'sent'`, [G.tenantId])).rows[0].n;
      await flush();
      expect((await outbox(c)).map((r) => [r.state, r.skip_reason])).toEqual([["skipped", "campaign_locked"], ["skipped", "campaign_locked"]]);
      expect((await h.admin.query(`select count(*)::int n from outbound_messages where tenant_id = $1 and state = 'sent'`, [G.tenantId])).rows[0].n).toBe(sentBefore);
      const ev = (await h.admin.query(`select payload from domain_events where type = 'OutboundMessageSkipped' and payload ->> 'skip_reason' = 'campaign_locked'
         and payload ->> 'patient_id' = $1`, [p1])).rows[0].payload;
      expect(Object.keys(ev).sort()).toEqual(["outbound_id", "patient_id", "purpose", "skip_reason"]);
      // the existing claim path: a care message of the same tenant is still sent while campaigns are locked
      const care = (await h.admin.query(`select id from wa_templates where tenant_id = $1 and category = 'utility' and status = 'approved' order by name limit 1`, [G.tenantId])).rows[0].id as string;
      const cm = (await as(GFO, (db) => enqueueOutbound(db, key(), { purpose: "care_reminder", patientId: p1, templateId: care, sourceKind: "appointment", sourceId: crypto.randomUUID() } as never))).outboundId;
      await flush();
      expect((await h.admin.query(`select state from outbound_messages where id = $1`, [cm])).rows[0].state).toBe("sent");
    } finally {
      await counsel(GOWN, "approved");
    }
  });
});

describe("T-100 the per-patient cap at send and at dispatch (plan r3 §5)", () => {
  // queue a row directly (fixture) with a given purpose and planned day, as automation / reminders do
  const queueRow = async (pt: string, purpose: "promo" | "care_reminder", day: string) => {
    const tpl = purpose === "promo" ? gTpl
      : (await h.admin.query(`select id from wa_templates where tenant_id = $1 and category = 'utility' and status = 'approved' order by name limit 1`, [G.tenantId])).rows[0].id as string;
    return (await h.admin.query(`select public.outbound_enqueue_do($1, $2, $3, $4, $5, $6, $7, gen_random_uuid(), $8::date, null, null, now()) id`,
      [G.tenantId, `k-${key()}`, purpose, pt, G.b1, tpl, purpose === "promo" ? "patient" : "appointment", day])).rows[0].id as string;
  };
  const row = async (id: string) => (await h.admin.query(`select state, skip_reason, deferred_reason, planned_for::text planned from outbound_messages where id = $1`, [id])).rows[0];
  // the worker on a fixed instant of a given WIB day (11:00), the budget wide
  const dispatchOn = (day: string) => runOutboundDispatch(worker, { port: mockInboxPort(), now: new Date(`${day}T11:00:00+07:00`) });

  it("at send: a member already at batas_harian on the scheduled day is queued on the next day with room", async () => {
    const pt = await patient(G, "Batas Kirim", { birth: born(4) });
    await gConsent(pt);
    await queueRow(pt, "care_reminder", today());
    await queueRow(pt, "care_reminder", today()); // 2 = the default cap
    const { c } = await gCampaign(4);
    expect((await as(GOWN, (db) => sendCampaign(db, key(), c))).queued).toBe(1);
    expect((await outbox(c))[0]).toMatchObject({ state: "queued", planned: dayPlus(1) });
  });

  it("at send: no day with room in scheduled … +7 → reported skipped cap_horizon_exceeded, not queued", async () => {
    const pt = await patient(G, "Batas Penuh", { birth: born(5) });
    await gConsent(pt);
    for (let d = 0; d <= 7; d++) for (let k = 0; k < 2; k++) await queueRow(pt, "care_reminder", dayPlus(d));
    const { c } = await gCampaign(5);
    expect(await as(GOWN, (db) => sendCampaign(db, key(), c))).toMatchObject({ queued: 0, skipped: { cap_horizon_exceeded: 1 } });
    expect(await outbox(c)).toEqual([]);
  });

  it("at dispatch, worker gap: promos for D and D+1 both due on D+1 (cap 2 with one care sent) → one sends, one deferred cap_reached to D+2", async () => {
    const pt = await patient(G, "Jeda Pekerja", { birth: born(6) });
    await gConsent(pt);
    const D = dayPlus(20), D1 = dayPlus(21), D2 = dayPlus(22);
    const p1 = await queueRow(pt, "promo", D); const p2 = await queueRow(pt, "promo", D1); const care = await queueRow(pt, "care_reminder", D1);
    await dispatchOn(D1);
    const states = [await row(p1), await row(p2), await row(care)];
    expect(states[2].state).toBe("sent"); // care never cap-deferred
    expect(states.slice(0, 2).map((x) => x.state).sort()).toEqual(["queued", "sent"]);
    expect(states.slice(0, 2).find((x) => x.state === "queued")).toMatchObject({ deferred_reason: "cap_reached", planned: D2 });
  });

  it("at dispatch, care vs promo (review r3 P1): an overdue promo (D) and two care reminders due D+1 (cap 2) → the promo is deferred, both care sent", async () => {
    const pt = await patient(G, "Rawat Lawan Promo", { birth: born(7) });
    await gConsent(pt);
    const D = dayPlus(30), D1 = dayPlus(31);
    const promo = await queueRow(pt, "promo", D);
    const c1 = await queueRow(pt, "care_reminder", D1); const c2 = await queueRow(pt, "care_reminder", D1);
    await dispatchOn(D1);
    expect([(await row(c1)).state, (await row(c2)).state]).toEqual(["sent", "sent"]);
    expect(await row(promo)).toMatchObject({ state: "queued", deferred_reason: "cap_reached", planned: dayPlus(32) });
  });

  it("care is never cap-deferred: a patient already at the cap today still gets a due care reminder (probe 1)", async () => {
    const pt = await patient(G, "Rawat Tetap Kirim", { birth: born(9) });
    await gConsent(pt);
    const D = dayPlus(45);
    for (const x of [await queueRow(pt, "care_reminder", D), await queueRow(pt, "care_reminder", D)]) expect(x).toBeTruthy();
    await dispatchOn(D);
    const extra = await queueRow(pt, "care_reminder", D);
    await dispatchOn(D);
    expect(await row(extra)).toMatchObject({ state: "sent", deferred_reason: null });
  });

  it("deferral day (review r3 P2): one sent today, the candidate the only queued row → deferred to tomorrow, not later; room only on +7 → +7; none → skipped", async () => {
    const pt = await patient(G, "Hari Tunda", { birth: born(8) });
    await gConsent(pt);
    const D = dayPlus(40);
    const sent1 = await queueRow(pt, "care_reminder", D); const sent2 = await queueRow(pt, "care_reminder", D);
    await dispatchOn(D);
    expect([(await row(sent1)).state, (await row(sent2)).state]).toEqual(["sent", "sent"]);
    const promo = await queueRow(pt, "promo", D);
    await dispatchOn(D);
    expect(await row(promo)).toMatchObject({ state: "queued", deferred_reason: "cap_reached", planned: dayPlus(41) });
    // room only on D+7 (the window measured from the dispatch day)
    const pt2 = await patient(G, "Hari Tunda Tujuh", { birth: born(8) });
    await gConsent(pt2);
    const E = dayPlus(50);
    for (const x of [await queueRow(pt2, "care_reminder", E), await queueRow(pt2, "care_reminder", E)]) expect(x).toBeTruthy();
    await dispatchOn(E);
    for (let d = 1; d <= 6; d++) for (let k = 0; k < 2; k++) await queueRow(pt2, "care_reminder", dayPlus(50 + d));
    const p7 = await queueRow(pt2, "promo", E);
    await dispatchOn(E);
    expect(await row(p7)).toMatchObject({ state: "queued", deferred_reason: "cap_reached", planned: dayPlus(57) });
    // no room through E+7 → skipped cap_horizon_exceeded
    for (let k = 0; k < 2; k++) await queueRow(pt2, "care_reminder", dayPlus(57));
    const p8 = await queueRow(pt2, "promo", E);
    await dispatchOn(E);
    expect(await row(p8)).toMatchObject({ state: "skipped", skip_reason: "cap_horizon_exceeded" });
  });
});

describe("T-100 review r1 (Sol 75a1a20a P1): cross-writer cap, deferral collisions, evidence expiry", () => {
  const queueRow2 = async (pt: string, purpose: "promo" | "care_reminder", day: string) => {
    const tpl = purpose === "promo" ? gTpl
      : (await h.admin.query(`select id from wa_templates where tenant_id = $1 and category = 'utility' and status = 'approved' order by name limit 1`, [G.tenantId])).rows[0].id as string;
    return (await h.admin.query(`select public.outbound_enqueue_do($1, $2, $3, $4, $5, $6, $7, gen_random_uuid(), $8::date, null, null, now()) id`,
      [G.tenantId, `k-${key()}`, purpose, pt, G.b1, tpl, purpose === "promo" ? "patient" : "appointment", day])).rows[0].id as string;
  };
  const row2 = async (id: string) => (await h.admin.query(`select state, skip_reason, deferred_reason, planned_for::text planned from outbound_messages where id = $1`, [id])).rows[0];
  const at11 = (day: string) => new Date(`${day}T11:00:00+07:00`);
  const sentOn = async (pt: string, day: string) => Number((await h.admin.query(`select count(*) c from outbound_messages where patient_id = $1 and state in ('sending','sent')
    and (coalesce(sent_at, claimed_at) at time zone 'Asia/Jakarta')::date = $2::date`, [pt, day])).rows[0].c);

  it("cross-writer: an automation-style enqueue holding the cap lock makes a concurrent campaign_send queue on the next day with room (deterministic)", async () => {
    // cap 2; one care already queued today → one slot left. T1 (as the scan does: staff_access, then the patient's cap lock) takes the slot;
    // campaign_send (T2) waits on staff_access, then sees today full and queues tomorrow — never three on one day.
    const pt = await patient(G, "Rebut Slot", { birth: born(10) });
    await gConsent(pt);
    await queueRow2(pt, "care_reminder", today());
    const { c } = await gCampaign(10);
    const t1 = await owner.connect();
    let t1Open = true;
    try {
      await t1.query("begin");
      await t1.query(`select pg_advisory_xact_lock(hashtextextended('staff_access:' || $1::text, 0))`, [G.tenantId]);
      await t1.query(`select public.automation_cap_lock($1, $2)`, [G.tenantId, pt]);
      const tpl = (await t1.query(`select id from wa_templates where tenant_id = $1 and category = 'utility' and status = 'approved' order by name limit 1`, [G.tenantId])).rows[0].id;
      await t1.query(`select public.outbound_enqueue_do($1, $2, 'care_reminder', $3, $4, $5, 'appointment', gen_random_uuid(), $6::date, null, null, now())`,
        [G.tenantId, `k-${key()}`, pt, G.b1, tpl, today()]);
      const pid1 = (await t1.query(`select pg_backend_pid() p`)).rows[0].p;
      const p2 = as(GOWN, (db) => sendCampaign(db, key(), c));
      let blocked = false;
      for (let i = 0; i < 100 && !blocked; i++) {
        blocked = Number((await h.admin.query(`select count(*) c from pg_stat_activity where wait_event_type = 'Lock' and $1 = any(pg_blocking_pids(pid))`, [pid1])).rows[0].c) > 0;
        if (!blocked) await new Promise((r) => setTimeout(r, 50));
      }
      expect(blocked).toBe(true);
      await t1.query("commit");
      t1Open = false;
      expect(await p2).toMatchObject({ queued: 1, skipped: {} });
    } finally {
      if (t1Open) await t1.query("rollback").catch(() => undefined);
      t1.release();
    }
    expect((await outbox(c))[0]).toMatchObject({ state: "queued", planned: dayPlus(1) });
  });

  it("budget deferral into a full day: a promo the budget pushed to D+1 meets two care messages already due D+1 → deferred again cap_reached to D+2", async () => {
    const pt = await patient(G, "Anggaran Penuh", { birth: born(11) });
    await gConsent(pt);
    const D = dayPlus(60), D1 = dayPlus(61);
    // the promo carries a budget deferral from D (as outbound_claim's budget branch writes it)
    const promo = await queueRow2(pt, "promo", D);
    await h.admin.query(`update outbound_messages set planned_for = $2::date, rescheduled_count = rescheduled_count + 1, deferred_reason = 'budget_reached' where id = $1`, [promo, D1]);
    const c1 = await queueRow2(pt, "care_reminder", D1); const c2 = await queueRow2(pt, "care_reminder", D1);
    await runOutboundDispatch(worker, { port: mockInboxPort(), now: at11(D1) });
    expect([(await row2(c1)).state, (await row2(c2)).state]).toEqual(["sent", "sent"]);
    expect(await row2(promo)).toMatchObject({ state: "queued", deferred_reason: "cap_reached", planned: dayPlus(62) });
    expect(await sentOn(pt, D1)).toBe(2);
  });

  it("suspension resume: a promo deferred while suspended collides with two care messages on the resume day → deferred cap_reached, care sent", async () => {
    // G's own lifecycle toggled for the dispatch on D (suspended: the existing branch defers the promo), then back to live
    const pt = await patient(G, "Lanjut Setelah Jeda", { birth: born(12) });
    await gConsent(pt);
    const D = dayPlus(70), D1 = dayPlus(71);
    const promo = await queueRow2(pt, "promo", D);
    await h.admin.query(`update tenants_registry set lifecycle_state = 'suspended' where id = $1`, [G.tenantId]);
    try {
      await runOutboundDispatch(worker, { port: mockInboxPort(), now: at11(D) });
      expect(await row2(promo)).toMatchObject({ state: "queued", deferred_reason: "tenant_suspended", planned: D1 });
    } finally {
      await h.admin.query(`update tenants_registry set lifecycle_state = 'live' where id = $1`, [G.tenantId]);
    }
    const c1 = await queueRow2(pt, "care_reminder", D1); const c2 = await queueRow2(pt, "care_reminder", D1);
    await runOutboundDispatch(worker, { port: mockInboxPort(), now: at11(D1) });
    expect([(await row2(c1)).state, (await row2(c2)).state]).toEqual(["sent", "sent"]);
    expect(await row2(promo)).toMatchObject({ state: "queued", deferred_reason: "cap_reached", planned: dayPlus(72) });
  });

  it("evidence EXPIRY between queueing and dispatch: the approved Q-15 evidence's validity passes → the queued campaign message is skipped campaign_locked, not sent", async () => {
    // its own segment: G's birthday months are all used by earlier tests, so an age band nobody else in G has (born 1940: 86–87)
    const pt = await patient(G, "Bukti Kedaluwarsa", { birth: "1940-03-10" });
    await gConsent(pt);
    const seg = (await as(GOWN, (db) => saveSegment(db, key(), { name: `Usia lanjut ${++seq}`, rules: { age_min: 86, age_max: 87 } }))).segmentId;
    const c = (await as(GOWN, (db) => saveCampaign(db, key(), { name: `Kampanye Kedaluwarsa ${seq}`, code: `kg-exp-${seq}`, channel: "whatsapp" }))).campaignId;
    await as(GOWN, (db) => scheduleCampaign(db, key(), c, { segmentId: seg, templateId: gTpl, scheduledFor: today() }));
    const r = await as(GOWN, (db) => sendCampaign(db, key(), c));
    expect(r.queued).toBeGreaterThan(0);
    // the evidence expires (valid_until before today — not revoked: the item stays 'approved'); fixture write with the guard off
    const item = (await h.admin.query(`select id from evidence_items where tenant_id = $1 and obligation_key = 'public_site_counsel'`, [G.tenantId])).rows[0].id as string;
    const before = (await h.admin.query(`select valid_until::text v, state from evidence_items where id = $1`, [item])).rows[0];
    const fixture = async (sql: string, args: unknown[]) => {
      await h.admin.query(`alter table evidence_items disable trigger evidence_items_guard`);
      try { await h.admin.query(sql, args); } finally { await h.admin.query(`alter table evidence_items enable trigger evidence_items_guard`); }
    };
    await fixture(`update evidence_items set valid_until = current_date - 1 where id = $1`, [item]);
    try {
      expect((await h.admin.query(`select state, public.evidence_item_status(id) st from evidence_items where id = $1`, [item])).rows[0]).toEqual({ state: "approved", st: "expired" });
      await flush();
      const mine = (await outbox(c)).filter((x) => x.patient_id === pt);
      expect(mine.map((x) => [x.state, x.skip_reason])).toEqual([["skipped", "campaign_locked"]]);
      expect(Number((await h.admin.query(`select count(*) c from outbound_messages where tenant_id = $1 and state = 'sent' and source_kind = 'campaign'
        and source_id = $2`, [G.tenantId, c])).rows[0].c)).toBe(0);
    } finally {
      await fixture(`update evidence_items set valid_until = $2::date where id = $1`, [item, before.v]);
    }
    expect((await as(GOWN, campaignWorkspace)).gate.open).toBe(true); // restored for the next tests
  });
});

describe("T-100 review r1 (Sol 75a1a20a P2): the send result reaches the notice truthfully, counts only", () => {
  const parse = (q: string) => Object.fromEntries(new URLSearchParams(`ok=${q}`)) as Record<string, string>;
  it("zero queued (everyone excluded at send), partial exclusion, all queued; a tampered query shows the neutral notice", () => {
    const zero = parse(sentQuery({ queued: 0, skipped: { cap_horizon_exceeded: 1 } }));
    expect(zero).toEqual({ ok: "terkirim", q: "0", x: "1" });
    expect(sentNotice(zero.q, zero.x)).toBe("Tidak ada pesan yang masuk antrean: 1 pasien dikecualikan saat pengiriman.");
    const part = parse(sentQuery({ queued: 3, skipped: { cap_horizon_exceeded: 1, patient_phone_required: 2 } }));
    expect(sentNotice(part.q, part.x)).toBe("3 pesan masuk antrean pengiriman; 3 pasien dikecualikan saat pengiriman.");
    const all = parse(sentQuery({ queued: 2, skipped: {} }));
    expect(sentNotice(all.q, all.x)).toBe("2 pesan masuk antrean pengiriman.");
    for (const [q, x] of [["-1", "0"], ["1e3", "0"], ["<b>", "0"], [undefined, "0"], ["01", "0"]] as const) {
      expect(sentNotice(q, x), String(q)).toBe("Kampanye diproses. Lihat jumlah antrean di daftar kampanye.");
    }
  });

  it("end to end: a real zero-queued send (every member at the cap through the horizon) yields the zero notice and no outbound row", async () => {
    const pt = await patient(G, "Nol Antrean", { birth: "1930-04-11" }); // 96–97: its own age band
    await gConsent(pt);
    const tpl = (await h.admin.query(`select id from wa_templates where tenant_id = $1 and category = 'utility' and status = 'approved' order by name limit 1`, [G.tenantId])).rows[0].id as string;
    for (let d = 0; d <= 7; d++) for (let k = 0; k < 2; k++) {
      await h.admin.query(`select public.outbound_enqueue_do($1, $2, 'care_reminder', $3, $4, $5, 'appointment', gen_random_uuid(), $6::date, null, null, now())`,
        [G.tenantId, `k-${key()}`, pt, G.b1, tpl, dayPlus(d)]);
    }
    const seg = (await as(GOWN, (db) => saveSegment(db, key(), { name: `Usia 85 ${++seq}`, rules: { age_min: 95, age_max: 98 } }))).segmentId;
    const c = (await as(GOWN, (db) => saveCampaign(db, key(), { name: `Kampanye Nol ${seq}`, code: `kg-nol-${seq}`, channel: "whatsapp" }))).campaignId;
    await as(GOWN, (db) => scheduleCampaign(db, key(), c, { segmentId: seg, templateId: gTpl, scheduledFor: today() }));
    const r = await as(GOWN, (db) => sendCampaign(db, key(), c));
    expect(r).toMatchObject({ queued: 0, skipped: { cap_horizon_exceeded: 1 } });
    const q = parse(sentQuery(r));
    expect(sentNotice(q.q, q.x)).toBe("Tidak ada pesan yang masuk antrean: 1 pasien dikecualikan saat pengiriman.");
    expect(await outbox(c)).toEqual([]);
  });
});

describe("T-100 lifecycle, replays, readers, state machine, roles, tenants, vendor", () => {
  it("capabilities: onboarding configures but cannot send; suspended neither; a replay after a lifecycle change is refused before the stored answer", async () => {
    const L = await tenant("PT Klinik Siklus", "onboarding");
    const lo = await person(L, "owner");
    const seg = (await as(lo, (db) => saveSegment(db, key(), { name: "Onboarding", rules: { sex: "female" } }))).segmentId;
    const c = (await h.admin.query(`insert into campaigns (tenant_id, name, code, channel, created_by, created_as, command_key)
      values ($1, 'Kampanye Siklus', 'kp-siklus', 'whatsapp', $2, 'owner', $3) returning id`, [L.tenantId, lo.staffId, `k-${key()}`])).rows[0].id as string;
    expect(seg).toBeTruthy();
    expect(await code(as(lo, (db) => sendCampaign(db, key(), c)))).toBe("ERR_TENANT_SUSPENDED"); // marketing_message: live only
    // the definer's own check (probe 1: the TS pre-check refused first): a scheduled campaign sent by SQL is refused for the lifecycle too
    // (fixture: a WABA + approved marketing template in L, the campaign put in 'scheduled' with the guard off)
    const wabaL = (await h.admin.query(`insert into waba_accounts (tenant_id, onboarding_channel, state, meta_waba_id, meta_business_id, business_verification_status,
        started_by, started_as, command_key) values ($1, 'cloud_api', 'number_registered', '77700000000001', '77700000000001', 'verified', $2, 'owner', $3) returning id`,
      [L.tenantId, lo.staffId, `k-${key()}`])).rows[0].id as string;
    const tplL = (await h.admin.query(`insert into wa_templates (tenant_id, waba_id, name, language, category, status, body, param_count, command_key)
        values ($1, $2, 'promo_siklus', 'id', 'marketing', 'approved', 'Halo {{1}}.', 1, $3) returning id`, [L.tenantId, wabaL, `k-${key()}`])).rows[0].id as string;
    await paused(["campaigns"], () => h.admin.query(`update campaigns set send_state = 'scheduled', segment_id = $2, template_id = $3, scheduled_for = current_date
      where id = $1`, [c, seg, tplL]));
    const sqlCode = (x: Promise<unknown>) => x.then(() => "ok", (e) => String((e as Error).message).split(":")[0]);
    expect(await sqlCode(as(lo, (db) => db.query(`select campaign_send($1)`, [c])))).toBe("ERR_TENANT_SUSPENDED");
    // the same key replayed after the tenant is suspended: refused (configuration not allowed when suspended)
    const k = key();
    await as(lo, (db) => saveSegment(db, k, { name: "Dua", rules: { sex: "male" } }));
    await h.admin.query(`update tenants_registry set lifecycle_state = 'suspended' where id = $1`, [L.tenantId]);
    expect(await code(as(lo, (db) => saveSegment(db, k, { name: "Dua", rules: { sex: "male" } })))).toBe("ERR_TENANT_SUSPENDED");
    expect(await code(as(lo, (db) => sendCampaign(db, key(), c)))).toBe("ERR_TENANT_SUSPENDED");
  });

  it("readers: central CS / manager / BC read the tag columns, never the workspace columns; campaigns_list keeps its shape; the workspace is campaign roles only", async () => {
    const { c } = await scheduled(MKT, { sex: "female" });
    for (const p of [CS, MGR, BC]) {
      expect(await code(as(p, (db) => db.query(`select id, name, code from campaigns where id = $1`, [c])))).toBe("ok");
      expect(await code(as(p, (db) => db.query(`select segment_id from campaigns where id = $1`, [c])))).toBe("raw:42501");
      expect(await code(as(p, (db) => db.query(`select * from campaigns where id = $1`, [c])))).toBe("raw:42501");
      expect(await code(as(p, campaignWorkspace))).toBe("ERR_FORBIDDEN");
      expect(await code(as(p, (db) => db.query(`select id from campaign_segments`)))).toBe("ok");
      expect((await as(p, (db) => db.query(`select id from campaign_segments`))).rowCount).toBe(0);
    }
    const legacy = (await as(CS, campaignList)).campaigns.find((x) => x.id === c)!;
    expect(Object.keys(legacy).sort()).toEqual(["active", "channel", "code", "id", "leads", "name"]);
    // the auditor reads the workspace, cannot change it; the preview is a number, never a member
    expect((await as(AU, campaignWorkspace)).campaigns.map((x) => x.id)).toContain(c);
    expect(await code(as(AU, (db) => saveSegment(db, key(), { name: "Auditor", rules: { sex: "female" } })))).toBe("ERR_FORBIDDEN");
    const ws = await as(MKT, campaignWorkspace);
    const text = JSON.stringify(ws);
    for (const pt of (await h.admin.query(`select id, full_name from patients where tenant_id = $1`, [A.tenantId])).rows) {
      expect(text).not.toContain(pt.id);
      expect(text).not.toContain(pt.full_name);
    }
    expect(typeof (await as(MKT, (db) => previewSegment(db, { sex: "female" })))).toBe("number");
    for (const p of [CS, FO, AU]) expect(await code(as(p, (db) => previewSegment(db, { sex: "female" }))), p.role).toBe("ERR_FORBIDDEN"); // probe 1
  });

  it("rules: the closed set only (no service / package / diagnosis), validated; the guard refuses a stored rule outside it", async () => {
    for (const bad of [{}, { service_id: crypto.randomUUID() }, { package_active: true }, { age_min: 50, age_max: 20 }, { visit_within_days: 10, no_visit_within_days: 10 },
                       { birthday_month: 13 }, { sex: "x" }, { branch_id: "nope" }]) {
      expect(await code(as(MKT, (db) => saveSegment(db, key(), { name: "Salah", rules: bad as never }))), JSON.stringify(bad)).toBe("ERR_INVALID_INPUT");
    }
    expect(await code(as(MKT, (db) => saveSegment(db, key(), { name: "Cabang lain", rules: { branch_id: B.b1 } })))).toBe("ERR_NOT_FOUND");
    const seg = (await as(MKT, (db) => saveSegment(db, key(), { name: "Valid", rules: { visit_within_days: 30 } }))).segmentId;
    expect(await raw(`update campaign_segments set rules = '{"service_id":"x"}' where id = $1`, [seg])).toBe("raw:42501");
    expect(await raw(`delete from campaign_segments where id = $1`, [seg])).toBe("raw:42501");
  });

  it("rules select correctly: visit window (date only), no visit, birthday month, age band, sex, branch — always with consent", async () => {
    const now = Date.now();
    const recent = await patient(A, "Kunjungan Baru", { birth: "1985-11-02", sex: "male", branch: A.b2 });
    const old = await patient(A, "Kunjungan Lama", { birth: "2001-11-20", sex: "female", branch: A.b2 });
    for (const p of [recent, old]) await consent(A, FO, p);
    await visit(A, recent, new Date(now - 5 * 86_400_000), FO);
    await visit(A, old, new Date(now - 200 * 86_400_000), FO);
    const count = (rules: Record<string, unknown>) => as(MKT, (db) => previewSegment(db, { branch_id: A.b2, ...rules } as never));
    expect(await count({ visit_within_days: 30 })).toBe(1);
    expect(await count({ no_visit_within_days: 30 })).toBe(1);
    expect(await count({ birthday_month: 11 })).toBe(2);
    expect(await count({ sex: "male" })).toBe(1);
    expect(await count({ age_min: 30 })).toBe(1);
    expect(await count({ age_max: 30 })).toBe(1);
    // consent is always required: withdrawing old's consent drops it from every rule's count
    const cid = (await h.admin.query(`select id from consents where patient_id = $1 and purpose = 'marketing_wa' and withdrawn_at is null`, [old])).rows[0].id as string;
    await as(FO, (db) => withdrawConsent(db, key(), { consentId: cid, channel: "in_person", reason: "Pasien menolak promosi" }));
    expect(await count({ birthday_month: 11 })).toBe(1);
    expect(await count({ no_visit_within_days: 30 })).toBe(0);
  });

  it("state machine: draft → scheduled → draft → scheduled → cancelled; queued / cancelled final; the guard refuses other edges", async () => {
    const { c, seg } = await scheduled(MKT, { sex: "female" });
    expect(await as(MKT, (db) => unscheduleCampaign(db, key(), c, "draft"))).toBe("draft");
    expect(await code(as(MKT, (db) => sendCampaign(db, key(), c)))).toBe("ERR_VERSION_CONFLICT"); // not scheduled
    await as(MKT, (db) => scheduleCampaign(db, key(), c, { segmentId: seg, templateId: promoTpl, scheduledFor: dayPlus(3) }));
    expect(await as(MKT, (db) => unscheduleCampaign(db, key(), c, "cancelled"))).toBe("cancelled");
    expect(await code(as(MKT, (db) => scheduleCampaign(db, key(), c, { segmentId: seg, templateId: promoTpl, scheduledFor: dayPlus(3) })))).toBe("ERR_VERSION_CONFLICT");
    expect(await code(as(MKT, (db) => unscheduleCampaign(db, key(), c, "draft")))).toBe("ERR_VERSION_CONFLICT");
    expect(await raw(`update campaigns set send_state = 'queued', queued_at = now(), queued_by = $2 where id = $1`, [c, MKT.staffId])).toBe("raw:42501");
    // probe 1: an edge the final-state freeze does not cover — a DRAFT moved straight to queued
    const c3 = await campaign(MKT, "Kampanye Lompat");
    await h.admin.query(`update campaigns set segment_id = $2, template_id = $3, scheduled_for = current_date where id = $1`, [c3, seg, promoTpl]);
    expect(await raw(`update campaigns set send_state = 'queued', queued_at = now(), queued_by = $2 where id = $1`, [c3, MKT.staffId])).toBe("raw:42501");
    expect(await raw(`insert into campaigns (tenant_id, name, code, channel, created_by, created_as, command_key, send_state)
      values ($1, 'X', 'kp-guard-x', 'whatsapp', $2, 'owner', $3, 'scheduled')`, [A.tenantId, OWN.staffId, `k-${key()}`])).toBe("raw:42501");
    // schedule inputs: past date, another tenant's segment, a utility template, a bad date
    const c2 = await campaign(MKT, "Kampanye Input");
    expect(await code(as(MKT, (db) => scheduleCampaign(db, key(), c2, { segmentId: seg, templateId: promoTpl, scheduledFor: dayPlus(-1) })))).toBe("ERR_INVALID_INPUT");
    expect(await code(as(MKT, (db) => scheduleCampaign(db, key(), c2, { segmentId: seg, templateId: promoTpl, scheduledFor: "2026-02-30" })))).toBe("ERR_INVALID_INPUT");
    const util = (await h.admin.query(`select id from wa_templates where tenant_id = $1 and category = 'utility' limit 1`, [A.tenantId])).rows[0].id as string;
    expect(await code(as(MKT, (db) => scheduleCampaign(db, key(), c2, { segmentId: seg, templateId: util, scheduledFor: today() })))).toBe("ERR_VERSION_CONFLICT");
  });

  it("roles and tenants: FO, doctor, finance, central CS refused; B cannot touch A's campaign or segment; vendor / operator sees nothing without a session", async () => {
    const { c, seg } = await scheduled(MKT, { sex: "female" });
    for (const p of [FO, DOC, FIN, CS]) {
      expect(await code(as(p, (db) => saveSegment(db, key(), { name: "Peran", rules: { sex: "female" } }))), p.role).toBe("ERR_FORBIDDEN");
      expect(await code(as(p, (db) => sendCampaign(db, key(), c))), p.role).toBe("ERR_FORBIDDEN");
    }
    expect(await code(as(BMKT, (db) => scheduleCampaign(db, key(), c, { segmentId: seg, templateId: promoTpl, scheduledFor: today() })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BMKT, (db) => sendCampaign(db, key(), c)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BMKT, (db) => saveSegment(db, key(), { id: seg, name: "Curi", rules: { sex: "male" } })))).toBe("ERR_NOT_FOUND");
    expect((await as(BOWN, (db) => db.query(`select id from campaign_segments where id = $1`, [seg]))).rowCount).toBe(0);
    expect((await as(BOWN, campaignWorkspace)).campaigns.map((x) => x.id)).not.toContain(c);
    expect((await h.admin.query(`select support_class from support_object_kinds where table_name = 'public.campaign_segments'`)).rows[0].support_class).toBe("config");
    expect((await h.admin.query(`select count(*)::int n from pg_policies where tablename = 'campaign_segments' and 'clinic_operator' = any(roles)`)).rows[0].n).toBe(1);
    const op = await owner.connect();
    try {
      await op.query("begin");
      await op.query("set local role clinic_operator");
      await op.query(`select set_config('app.tenant_id', $1, true)`, [A.tenantId]);
      expect(Number((await op.query(`select count(*) c from campaign_segments`)).rows[0].c)).toBe(0);
      expect(await op.query(`select segment_id from campaigns limit 1`).then(() => "ok", (e) => `raw:${e.code}`)).toBe("raw:42501");
    } finally {
      await op.query("rollback");
      op.release();
    }
    expect(FH).toBeTruthy();
  });
});
