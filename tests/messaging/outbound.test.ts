// T-094 Done-when: Scenario PR-31 budget (a tenant whose daily outbound budget is reached → more due reminders stay queued for the next window
// and the backlog shows them) and Scenario PR-4 consent withdrawal in full (a queued promo is not sent after marketing consent is withdrawn;
// care reminders continue). Plus the plan (r1, r2): W-06 unique recipients (a recipient already reached in 24 h costs nothing), the enqueue
// refusals (no consent, no phone, a clinical or service-name template, a pending template, roles), the two-step dispatch
// replay-safe (the port called once), first-contact conversations, messages_check for a system template, events with ids only, the backlog
// reader, tenants, the guard. The Meta port is the mock adapter (DEC-082); `fetch` is spied and never called. Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import type { KekRing } from "../../src/lib/keys/envelope";
import { setKekRingForTests } from "../../src/lib/keys/runtime";
import { syncTemplates } from "../../src/modules/messaging/inbox/inbox";
import { mockInboxPort } from "../../src/modules/messaging/inbox/mock";
import type { RemoteTemplate } from "../../src/modules/messaging/inbox/port";
import { RECORDED_TEMPLATES } from "../../src/modules/messaging/inbox/fixtures";
import { enqueueOutbound, outboundBacklog, runOutboundDispatch } from "../../src/modules/messaging/outbound/outbound";
import { mockWabaGraphPort } from "../../src/modules/messaging/waba/mock";
import { addWaNumber, completeWabaSignup, startWabaSignup } from "../../src/modules/messaging/waba/waba";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { grantConsent, publishConsentText, withdrawConsent } from "../../src/modules/patients/consents/consents";
import { createHarness, type Harness, testPool } from "../rls/harness";
import { wibDay } from "../support/dates";

process.env.DEPLOY_ENV = "local";
const RING: KekRing = { current: 1, keys: new Map([[1, Buffer.alloc(32, 9)]]) };
// the recorded templates plus one only these tests use: a body naming a service (W-05 / PRIV-15 — wa_template_body_ok does not know the
// tenant's service names; outbound_template_ok does). A clinical body never reaches wa_templates: wa_template_sync refuses it (0105:878).
export const OUTBOUND_TEMPLATES: RemoteTemplate[] = [...RECORDED_TEMPLATES,
  { name: "nama_layanan", language: "id", category: "utility", status: "approved", body: "Halo {{1}}, jadwal Facial Glow Anda di {{2}}.", paramCount: 2 }];

let h: Harness;
let app: pg.Pool;
let worker: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "auditor", "purchasing", "marketing", "central_cs"];
const day = wibDay;

async function tenant(name: string): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, name]);
  const br = async (c: string, nm: string) =>
    (await h.admin.query(`insert into branches (tenant_id, code, name, timezone, address) values ($1, $2, $3, 'Asia/Jakarta', 'Jl. Uji') returning id`, [tenantId, c, nm])).rows[0].id as string;
  return { tenantId, b1: await br("OB1", "Kemang"), b2: await br("OB2", "Bintaro") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`ob${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf OB ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const key = () => crypto.randomUUID();
const why = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason ?? ""}` : `raw:${e.code ?? e.message}`));
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const raw = (sql: string, args: unknown[] = []) => h.admin.query(sql, args).then(() => "ok", (e) => `raw:${e.code}`);
let seq = 0;
async function patient(t: T, name: string, phone?: string) {
  const id = (await h.admin.query(`insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation,
       education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $2, '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture sintetis',
       'islam', 'Karyawan', 's1', 'kawin', $3, (select id from staff where tenant_id = $1 limit 1), 'fo_cashier') returning id`, [t.tenantId, name, t.b1])).rows[0].id as string;
  if (phone !== "") await h.admin.query(`insert into contact_points (tenant_id, patient_id, kind, value) values ($1, $2, 'phone', $3)`,
    [t.tenantId, id, phone ?? `+62857${String(10000000 + ++seq)}`]);
  return id;
}
const tpl = async (t: T, name: string) => (await h.admin.query(`select id from wa_templates where tenant_id = $1 and name = $2`, [t.tenantId, name])).rows[0].id as string;
// planned_for read as text (pg turns a date into a local-midnight Date)
const ob = async (id: string) => (await h.admin.query(`select *, planned_for::text planned from outbound_messages where id = $1`, [id])).rows[0];
// run every due row through the mock port so a test starts with an empty due queue (sends at a time far ahead of any budget window)
let flushAt = 400;
const flush = async () => runOutboundDispatch(worker, { port: mockInboxPort(), now: new Date(Date.now() + (flushAt += 30) * 3_600_000) });
// A connected WABA (mock Graph port) with a Kemang number, the templates synced; its portfolio limit set for the budget tests.
async function connect(t: T, own: P, codeName: string, limit: number) {
  const g = mockWabaGraphPort();
  const { wabaId } = await as(own, (db) => startWabaSignup(db, key(), { onboardingChannel: "cloud_api" }));
  await as(own, (db) => completeWabaSignup(db, wabaId, codeName as never, { port: g }));
  await as(own, (db) => addWaNumber(db, key(), wabaId, { branchId: t.b1, phoneNumber: `+62812${String(2000000 + ++seq)}`, phoneNumberId: `8${String(Date.now()).slice(-9)}${seq}` }, { port: g }));
  const port = { ...mockInboxPort(), fetchTemplates: async () => OUTBOUND_TEMPLATES.map((x) => ({ ...x })) };
  await as(own, (db) => syncTemplates(db, { port }));
  await h.admin.query(`alter table waba_accounts disable trigger waba_accounts_guard`);
  try {
    await h.admin.query(`update waba_accounts set portfolio_messaging_limit = $2 where id = $1`, [wabaId, limit]);
  } finally {
    await h.admin.query(`alter table waba_accounts enable always trigger waba_accounts_guard`);
  }
  return wabaId;
}

const fetchSpy = vi.fn();
let A: T; let B: T;
let OWN: P; let CS: P; let FO: P; let MKT: P; let AU: P; let DOC: P; let FIN: P; let FO2: P; let BOWN: P; let BCS: P;
let marketingText: string;

beforeAll(async () => {
  setKekRingForTests(RING);
  h = await createHarness();
  const login = h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE]));
  app = await openAppPool({ connectionString: login, max: 6 });
  worker = await openAppPool({ connectionString: login, max: 2 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant("PT Klinik Pesan Keluar Sintetis");
  B = await tenant("PT Klinik Lain Pesan Keluar");
  OWN = await person(A, "owner"); CS = await person(A, "central_cs"); FO = await person(A, "fo_cashier", A.b1); MKT = await person(A, "marketing");
  AU = await person(A, "auditor"); DOC = await person(A, "doctor", A.b1); FIN = await person(A, "finance"); FO2 = await person(A, "fo_cashier", A.b2);
  BOWN = await person(B, "owner"); BCS = await person(B, "central_cs");
  // budget: 20 × SET-21 10 % = 2 new recipients a day
  await connect(A, OWN, "code-verified", 20);
  await connect(B, BOWN, "code-verified-2", 1000);
  const { changeSetting } = await import("../../src/modules/settings/settings");
  await as(OWN, (db) => changeSetting(db, { key: "SET-21", branchId: null, value: 10, reason: "Uji batas kirim" }));
  marketingText = (await as(OWN, (db) => publishConsentText(db, { purpose: "marketing_wa", body: "Saya setuju menerima promosi." }))).id;
}, 300_000);
afterAll(async () => {
  setKekRingForTests(undefined);
  await app?.end();
  await worker?.end();
  await owner?.end();
  await h?.close();
});
beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

const reminder = async (pt: string, k = key(), source = crypto.randomUUID()) => (await as(FO, async (db) => enqueueOutbound(db, k, {
  purpose: "care_reminder", patientId: pt, templateId: await tpl(A, "pengingat_janji"), sourceKind: "appointment", sourceId: source }))).outboundId;

describe("T-094 Scenario PR-31 (daily budget)", () => {
  it("the budget reached: new recipients stay queued for the next window, the backlog shows them; a known recipient still sends", async () => {
    const pts = [await patient(A, "Pasien Budget 1"), await patient(A, "Pasien Budget 2"), await patient(A, "Pasien Budget 3"), await patient(A, "Pasien Budget 4")];
    const ids = [];
    for (const pt of pts) ids.push(await reminder(pt));
    const port = mockInboxPort();
    const r1 = await runOutboundDispatch(worker, { port });
    expect(r1).toEqual({ sent: 2, failed: 0 });
    expect(port.sent).toHaveLength(2);
    const rows = await Promise.all(ids.map(ob));
    expect(rows.map((x) => x.state)).toEqual(["sent", "sent", "queued", "queued"]);
    expect(rows.slice(2).map((x) => [x.planned, x.deferred_reason, x.rescheduled_count]))
      .toEqual([[day(1), "budget_reached", 1], [day(1), "budget_reached", 1]]);
    // the dashboard backlog: two reminders for tomorrow, deferred by the budget (counts only)
    const bl = await as(CS, (db) => outboundBacklog(db));
    expect(bl.queued).toContainEqual({ planned_for: day(1), purpose: "care_reminder", count: 2, deferred_budget: 2, deferred_suspended: 0 });
    expect(JSON.stringify(bl)).not.toMatch(/Pasien Budget/);
    // a second message to a recipient already reached costs no budget: it sends now
    const again = await reminder(pts[0]);
    expect(await runOutboundDispatch(worker, { port })).toEqual({ sent: 1, failed: 0 });
    expect((await ob(again)).state).toBe("sent");
    // the deferred ones go out in the next window (tomorrow's 24 h no longer holds today's recipients)
    const tomorrow = new Date(Date.now() + 25 * 3_600_000);
    expect(await runOutboundDispatch(worker, { port, now: tomorrow })).toEqual({ sent: 2, failed: 0 });
    expect((await Promise.all(ids.map(ob))).map((x) => x.state)).toEqual(["sent", "sent", "sent", "sent"]);
    // a sent template is recorded in the inbox without a staff author (messages_check, P1-2); events carry ids and codes only
    const m = (await h.admin.query(`select direction, kind, author_staff_id, status, template_category from messages where id = $1`, [rows[0].message_id ?? (await ob(ids[0])).message_id])).rows[0];
    expect(m).toEqual({ direction: "out", kind: "template", author_staff_id: null, status: "sent", template_category: "utility" });
    const ev = (await h.admin.query(`select type, payload from domain_events where aggregate_kind = 'outbound_message' and aggregate_id = any($1) order by occurred_at`, [ids])).rows;
    expect(ev.map((e) => e.type)).toEqual(Array(4).fill("OutboundMessageQueued"));
    expect(JSON.stringify(ev)).not.toMatch(/Pasien|\+62|Rp/);
  });
});

describe("T-094 Scenario PR-4 (consent withdrawal)", () => {
  it("a queued promo is not sent after the marketing consent is withdrawn; a care reminder to the same patient continues", async () => {
    await flush();
    const pt = await patient(A, "Pasien Promo Sintetis");
    const g = await as(FO, (db) => grantConsent(db, key(), { patientId: pt, purpose: "marketing_wa", textId: marketingText, channel: "in_person" }));
    expect(g.ok).toBe(true);
    const promo = (await as(MKT, async (db) => enqueueOutbound(db, key(), {
      purpose: "promo", patientId: pt, templateId: await tpl(A, "promo_bulan_ini"), sourceKind: "patient", sourceId: pt }))).outboundId;
    const care = await reminder(pt);
    const consentId = (await h.admin.query(`select id from consents where patient_id = $1 and purpose = 'marketing_wa' and withdrawn_at is null`, [pt])).rows[0].id as string;
    expect((await as(FO, (db) => withdrawConsent(db, key(), { consentId, channel: "in_person", reason: "Tidak ingin promosi" }))).ok).toBe(true);
    const port = mockInboxPort();
    expect(await runOutboundDispatch(worker, { port, now: new Date(Date.now() + 50 * 3_600_000) })).toEqual({ sent: 1, failed: 0 });
    expect(await ob(promo)).toMatchObject({ state: "skipped", skip_reason: "consent_withdrawn", provider_message_id: null });
    expect((await ob(care)).state).toBe("sent");
    expect(port.sent.filter((x) => x.kind === "template")).toHaveLength(1);
    const ev = (await h.admin.query(`select type from domain_events where aggregate_id = $1 order by occurred_at`, [promo])).rows.map((r) => r.type);
    expect(ev).toEqual(["OutboundMessageQueued", "OutboundMessageSkipped"]);
    // without consent a promo is refused at enqueue
    expect(await why(as(MKT, async (db) => enqueueOutbound(db, key(), {
      purpose: "promo", patientId: pt, templateId: await tpl(A, "promo_bulan_ini"), sourceKind: "patient", sourceId: pt })))).toBe("ERR_VERSION_CONFLICT:no_marketing_consent");
  });
});

describe("T-094 enqueue rules, dispatch replay, readers and guards", () => {
  it("refuses: no phone, a clinical or service-name template (W-05), a pending or wrong-category template, roles, branches; replay answers the first row", async () => {
    const noPhone = await patient(A, "Pasien Tanpa Telepon", "");
    expect(await why(as(FO, async (db) => enqueueOutbound(db, key(), {
      purpose: "care_reminder", patientId: noPhone, templateId: await tpl(A, "pengingat_janji"), sourceKind: "appointment", sourceId: crypto.randomUUID() }))))
      .toBe("ERR_VERSION_CONFLICT:patient_phone_required");
    const pt = await patient(A, "Pasien Aturan Kirim");
    const at = (name: string, purpose: "care_reminder" | "promo" = "care_reminder", who = FO) => as(who, async (db) => enqueueOutbound(db, key(), {
      purpose, patientId: pt, templateId: await tpl(A, name), sourceKind: purpose === "promo" ? "patient" : "appointment", sourceId: purpose === "promo" ? pt : crypto.randomUUID() }));
    // a clinical template is refused at sync, so it never reaches the queue (the first W-05 layer)
    const clinical = { ...mockInboxPort(), fetchTemplates: async () => [{ name: "hasil_klinis", language: "id", category: "utility" as const, status: "approved" as const,
      body: "Hasil diagnosis Anda sudah siap, {{1}}.", paramCount: 1 }] };
    expect(await code(as(OWN, (db) => syncTemplates(db, { port: clinical })))).toBe("ERR_INVALID_INPUT");
    expect((await h.admin.query(`select count(*)::int c from wa_templates where tenant_id = $1 and name = 'hasil_klinis'`, [A.tenantId])).rows[0].c).toBe(0);
    // a service name in the body (PRIV-15): publish a service named like the template text
    const { publish } = await import("../../src/modules/catalog/catalog");
    await as(OWN, (db) => publish(db, { kind: "service", code: "OB-FG" }, { name: "Facial Glow", tax_category: "exempt_medical", tax_basis: "Jasa medis",
      normal_price: 300_000, category: "facial", prep_min: 0, treatment_min: 30, buffer_min: 0, indications: "Indikasi", consent_template: "Templat.",
      delegation: "Dokter", aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }] } as never, "Layanan baru"));
    expect(await why(at("nama_layanan"))).toBe("ERR_INVALID_INPUT:template_clinical_content");
    expect(await why(at("sapaan_baru"))).toBe("ERR_VERSION_CONFLICT:template_not_usable");
    expect(await why(at("promo_bulan_ini"))).toBe("ERR_VERSION_CONFLICT:template_not_usable"); // a marketing template as a care reminder
    for (const p of [DOC, FIN, AU]) expect(await code(at("pengingat_janji", "care_reminder", p)), p.role).toBe("ERR_FORBIDDEN");
    for (const p of [FO, DOC]) expect(await code(at("promo_bulan_ini", "promo", p)), p.role).toBe("ERR_FORBIDDEN");
    expect(await code(as(FO, async (db) => enqueueOutbound(db, key(), { purpose: "care_reminder", patientId: pt, templateId: await tpl(A, "pengingat_janji"),
      sourceKind: "appointment", sourceId: crypto.randomUUID(), branchId: A.b2 })))).toBe("ERR_FORBIDDEN");
    const k = key();
    const src = crypto.randomUUID();
    const first = await reminder(pt, k, src);
    expect(await reminder(pt, k, src)).toBe(first);
    // the same key with another body is a different command
    expect(await code(reminder(pt, k))).toBe("ERR_IDEMPOTENCY_CONFLICT");
    // a first contact opens the conversation without a window (approved templates send regardless of it)
    const c = (await h.admin.query(`select last_inbound_at, window_expires_at, patient_id from conversations where id = (select conversation_id from outbound_messages where id = $1)`, [first])).rows[0];
    expect(c).toEqual({ last_inbound_at: null, window_expires_at: null, patient_id: pt });
    // every definer accepts exactly its key set
    expect(await code(as(FO, (db) => db.query(`select outbound_enqueue('k-extra-0001', '{"purpose":"care_reminder","x":1}'::jsonb)`)))).toBe("raw:22023");
    // another tenant's template: not found (A's own patient, B's template id)
    expect(await why(as(FO, async (db) => enqueueOutbound(db, key(), { purpose: "care_reminder", patientId: pt, templateId: await tpl(B, "pengingat_janji"),
      sourceKind: "appointment", sourceId: crypto.randomUUID() })))).toBe("ERR_NOT_FOUND:template not found");
  });

  it("dispatch: replay never calls the port twice; a failed send is recorded; the claim and complete refuse a bound connection; tenants; the guard", async () => {
    await flush();
    const pt = await patient(A, "Pasien Kirim Ulang");
    const id = await reminder(pt);
    const port = mockInboxPort();
    // a failing port: recorded failed, the error name only
    const bad = { ...port, sendMessage: async () => { throw new TypeError("boom"); } };
    expect(await runOutboundDispatch(worker, { port: bad, now: new Date(Date.now() + 75 * 3_600_000) })).toEqual({ sent: 0, failed: 1 });
    expect(await ob(id)).toMatchObject({ state: "failed", error_code: "TypeError" });
    expect(await runOutboundDispatch(worker, { port, now: new Date(Date.now() + 75 * 3_600_000) })).toEqual({ sent: 0, failed: 0 });
    expect(port.sent).toHaveLength(0);
    expect((await worker.query(`select outbound_complete($1, null, 'again', null) s`, [id])).rows[0].s).toBe("failed");
    expect(await code(as(FO, (db) => db.query(`select outbound_claim(null)`)))).toBe("raw:42501");
    expect(await code(as(FO, (db) => db.query(`select outbound_complete($1, null, 'x', null)`, [id])))).toBe("raw:42501");
    // tenants: B's staff see none of A's rows; A's backlog never counts B's
    expect((await as(BCS, (db) => db.query(`select id from outbound_messages where id = $1`, [id]))).rowCount).toBe(0);
    expect((await as(BCS, (db) => outboundBacklog(db))).queued).toEqual([]);
    // branch scope: the Bintaro FO reads none of Kemang's rows
    expect((await as(FO2, (db) => db.query(`select id from outbound_messages where id = $1`, [id]))).rowCount).toBe(0);
    // guard
    expect(await raw(`delete from outbound_messages where id = $1`, [id])).toBe("raw:42501");
    expect(await raw(`update outbound_messages set state = 'queued' where id = $1`, [id])).toBe("raw:42501");
    expect(await raw(`truncate outbound_messages cascade`)).toBe("raw:42501");
    const q = await reminder(pt);
    expect(await raw(`update outbound_messages set planned_for = planned_for - 1 where id = $1`, [q])).toBe("raw:42501");
    expect(await raw(`update outbound_messages set patient_id = $2 where id = $1`, [q, await patient(A, "Pasien Lain")])).toBe("raw:42501");
    expect(await raw(`update outbound_messages set state = 'sent' where id = $1`, [q])).not.toBe("ok");
  });
});

describe("T-094 budget: a row that will not send holds no recipient (review r1 P3-1)", () => {
  it("a withdrawn template is skipped before the budget is counted: the next new recipient still sends", async () => {
    // its own clock window, far from the other tests; drain what earlier tests left queued
    const at = new Date(Date.now() + 5000 * 3_600_000);
    for (const back of [96, 48]) await runOutboundDispatch(worker, { port: mockInboxPort(), now: new Date(at.getTime() - back * 3_600_000) });
    const sync = (status: "approved" | "rejected") => as(OWN, (db) => syncTemplates(db, { port: { ...mockInboxPort(), fetchTemplates: async () =>
      [{ name: "pengingat_ditarik", language: "id", category: "utility" as const, status, body: "Halo {{1}}, mengingatkan janji Anda di {{2}}.", paramCount: 2 }] } }));
    await sync("approved");
    const [p1, p2, p3] = [await patient(A, "Pasien Ditarik 1"), await patient(A, "Pasien Ditarik 2"), await patient(A, "Pasien Ditarik 3")];
    const withdrawn = async (pt: string) => (await as(FO, async (db) => enqueueOutbound(db, key(), {
      purpose: "care_reminder", patientId: pt, templateId: await tpl(A, "pengingat_ditarik"), sourceKind: "appointment", sourceId: crypto.randomUUID() }))).outboundId;
    const w1 = await withdrawn(p1);
    const w2 = await withdrawn(p2);
    const ok = await reminder(p3);
    // Meta rejects the template after the two rows were queued: they never send, so they must not use the budget of 2
    await sync("rejected");
    const port = mockInboxPort();
    expect(await runOutboundDispatch(worker, { port, now: at })).toEqual({ sent: 1, failed: 0 });
    for (const w of [w1, w2]) expect(await ob(w)).toMatchObject({ state: "skipped", skip_reason: "template_withdrawn", provider_message_id: null });
    expect(await ob(ok)).toMatchObject({ state: "sent", deferred_reason: null });
    expect(port.sent).toHaveLength(1);
    const ev = (await h.admin.query(`select type, payload from domain_events where aggregate_id = $1 order by occurred_at`, [w1])).rows;
    expect(ev.map((e) => e.type)).toEqual(["OutboundMessageQueued", "OutboundMessageSkipped"]);
    expect(ev[1].payload).toEqual({ outbound_id: w1, patient_id: p1, purpose: "care_reminder", skip_reason: "template_withdrawn" });
  });
});

describe("T-094 budget: an unfinished claim holds its recipient", () => {
  it("a row claimed and not yet completed (sending) counts against the 24 h budget like a sent one", async () => {
    // last in the file and far ahead of every other test's clock: its two rows stay `sending` on purpose
    const at = new Date(Date.now() + 9000 * 3_600_000);
    await runOutboundDispatch(worker, { port: mockInboxPort(), now: new Date(at.getTime() - 48 * 3_600_000) });
    const [p1, p2, p3] = [await patient(A, "Pasien Klaim 1"), await patient(A, "Pasien Klaim 2"), await patient(A, "Pasien Klaim 3")];
    const a1 = await reminder(p1);
    const a2 = await reminder(p2);
    // claim both (budget 2) without completing them: a worker that died between the port call and outbound_complete
    const claimed = (await worker.query(`select outbound_claim($1) r`, [at])).rows[0].r as { id: string }[];
    expect(claimed.map((x) => x.id).sort()).toEqual([a1, a2].sort());
    expect((await ob(a1)).state).toBe("sending");
    // a third, new recipient: the two sending rows fill the budget, so it waits
    const a3 = await reminder(p3);
    expect(await runOutboundDispatch(worker, { port: mockInboxPort(), now: new Date(at.getTime() + 60_000) })).toEqual({ sent: 0, failed: 0 });
    expect(await ob(a3)).toMatchObject({ state: "queued", deferred_reason: "budget_reached" });
  });
});
