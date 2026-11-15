// T-095 Done-when: Scenario PR-69 reminder reply (02-PRD:690): a booking tomorrow and a reminder sent → the patient replies Konfirmasi →
// the appointment shows confirmed. Plus the plan (r1, review r2): the SET-18 send times per branch and the quiet window, the neutral params
// (clinic, branch, date, time — never the service, PRIV-15), Ubah Jadwal → a CS follow-up (PR-83), the reply matched by the quoted template
// or the latest unanswered reminder, a second tap idempotent, a reply that answers no reminder stays an ordinary message, cancelled
// appointments get none, the guard, the unbound-only definers, tenants. The Meta port is the mock adapter (DEC-082); `fetch` is spied and
// never called. Synthetic data (MIG-2). Clocks are passed explicitly (p_now) and placed in the branch's day, never the machine's.
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import type { KekRing } from "../../src/lib/keys/envelope";
import { setKekRingForTests } from "../../src/lib/keys/runtime";
import { publish } from "../../src/modules/catalog/catalog";
import { followupList } from "../../src/modules/crm/followups/followups";
import { runReminderScan } from "../../src/modules/crm/reminders/reminders";
import { inboundButton, inboundText } from "../../src/modules/messaging/inbox/fixtures";
import { receiveMetaWebhook, syncTemplates } from "../../src/modules/messaging/inbox/inbox";
import { mockInboxPort, mockMetaAppSecret, signMeta } from "../../src/modules/messaging/inbox/mock";
import { runOutboundDispatch } from "../../src/modules/messaging/outbound/outbound";
import { mockWabaGraphPort } from "../../src/modules/messaging/waba/mock";
import { addWaNumber, completeWabaSignup, startWabaSignup } from "../../src/modules/messaging/waba/waba";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { changeSetting } from "../../src/modules/settings/settings";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local";
const RING: KekRing = { current: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) };

let h: Harness;
let app: pg.Pool;
let worker: pg.Pool;
let owner: pg.Pool;
let n = 0;
let seq = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "auditor", "purchasing", "marketing", "central_cs"];
const H = 3_600_000;

async function tenant(name: string): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, name]);
  const br = async (c: string, nm: string) =>
    (await h.admin.query(`insert into branches (tenant_id, code, name, timezone, address) values ($1, $2, $3, 'Asia/Jakarta', 'Jl. Uji') returning id`, [tenantId, c, nm])).rows[0].id as string;
  return { tenantId, b1: await br("RM1", "Kemang"), b2: await br("RM2", "Bintaro") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`rm${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf RM ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const key = () => crypto.randomUUID();
const raw = (sql: string, args: unknown[] = []) => h.admin.query(sql, args).then(() => "ok", (e) => `raw:${e.code}`);
async function paused<R>(tables: string[], fn: () => Promise<R>) {
  for (const t of tables) await h.admin.query(`alter table ${t} disable trigger ${t}_guard`);
  try {
    return await fn();
  } finally {
    for (const t of tables) await h.admin.query(`alter table ${t} enable always trigger ${t}_guard`);
  }
}
async function patient(t: T, name: string, withPhone = true) {
  const id = (await h.admin.query(`insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation,
       education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $2, '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture sintetis',
       'islam', 'Karyawan', 's1', 'kawin', $3, (select id from staff where tenant_id = $1 limit 1), 'fo_cashier') returning id`, [t.tenantId, name, t.b1])).rows[0].id as string;
  const phone = `62857${String(10000000 + ++seq)}`;
  if (withPhone) await h.admin.query(`insert into contact_points (tenant_id, patient_id, kind, value) values ($1, $2, 'phone', $3)`, [t.tenantId, id, `+${phone}`]);
  return { id, phone };
}
// A booked appointment at a fixed instant (the guard paused: the booking writer would check rosters and rooms, not this task's subject).
async function appointment(t: T, pt: string, start: Date, by: P, versionId: string, branch = t.b1) {
  return paused(["appointments"], async () => (await h.admin.query(`insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id,
      performer_staff_id, starts_at, ends_at, state, channel, created_by, created_as) values ($1, $2, $3, $4, $5, $6, $7, 'booked', 'phone', $5, 'fo_cashier') returning id`,
    [t.tenantId, branch, pt, versionId, by.staffId, start, new Date(start.getTime() + 30 * 60_000)])).rows[0].id as string);
}
// A WIB wall-clock instant: `d` days after the base day at hh:mm (the base day is far ahead so no other test's clock interferes).
const BASE = Date.UTC(2031, 0, 6); // a Monday, 00:00 UTC
const wib = (d: number, hh: number, mm = 0) => new Date(BASE + d * 86_400_000 + (hh - 7) * H + mm * 60_000);
async function deliver(body: unknown) {
  const s = JSON.stringify(body);
  return receiveMetaWebhook(worker, s, signMeta(mockMetaAppSecret()!, s));
}
// the reply handler called directly on the worker (the webhook calls it under a savepoint, so its answer is not visible there)
const handle = async (pn: string, providerMessageId: string, action: "confirm" | "reschedule", ctx: string | null) =>
  (await worker.query(`select reminder_reply_handle($1::jsonb) r`, [JSON.stringify({ phone_number_id: pn, provider_message_id: providerMessageId, action,
    context_provider_message_id: ctx })])).rows[0].r as string;
type Wa = { metaWabaId: string; pn: string };
async function connect(t: T, own: P, codeName: string): Promise<Wa> {
  const g = mockWabaGraphPort();
  const { wabaId } = await as(own, (db) => startWabaSignup(db, key(), { onboardingChannel: "cloud_api" }));
  await as(own, (db) => completeWabaSignup(db, wabaId, codeName as never, { port: g }));
  const pn = `5${String(Date.now()).slice(-9)}${++seq}`;
  await as(own, (db) => addWaNumber(db, key(), wabaId, { branchId: t.b1, phoneNumber: `+62812${String(3000000 + seq)}`, phoneNumberId: pn }, { port: g }));
  await as(own, (db) => syncTemplates(db, { port: mockInboxPort() }));
  return { metaWabaId: (await h.admin.query(`select meta_waba_id from waba_accounts where id = $1`, [wabaId])).rows[0].meta_waba_id as string, pn };
}
const rem = async (apt: string) => (await h.admin.query(`select r.*, o.state o_state, o.provider_message_id, o.planned_for::text planned
  from appointment_reminders r join outbound_messages o on o.tenant_id = r.tenant_id and o.id = r.outbound_id where r.appointment_id = $1 order by r.kind`, [apt])).rows;
const apState = async (apt: string) => (await h.admin.query(`select state, state_changed_by from appointments where id = $1`, [apt])).rows[0];

const fetchSpy = vi.fn();
let A: T; let B: T;
let OWN: P; let CS: P; let FO: P; let DOC: P; let MKT: P; let FO2: P; let BOWN: P; let BCS: P;
let WA: Wa; let WB: Wa;
let svc: string; let bsvc: string;

beforeAll(async () => {
  setKekRingForTests(RING);
  h = await createHarness();
  const login = h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE]));
  app = await openAppPool({ connectionString: login, max: 6 });
  worker = await openAppPool({ connectionString: login, max: 3 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant("PT Klinik Pengingat Sintetis");
  B = await tenant("PT Klinik Lain Pengingat");
  OWN = await person(A, "owner"); CS = await person(A, "central_cs"); FO = await person(A, "fo_cashier", A.b1); DOC = await person(A, "doctor", A.b1);
  MKT = await person(A, "marketing"); FO2 = await person(A, "fo_cashier", A.b2);
  BOWN = await person(B, "owner"); BCS = await person(B, "central_cs");
  const pub = (p: P, code: string) => as(p, (db) => publish(db, { kind: "service", code }, { name: "Facial Glow", tax_category: "exempt_medical", tax_basis: "Jasa medis",
    normal_price: 300_000, category: "facial", prep_min: 0, treatment_min: 30, buffer_min: 0, indications: "Indikasi", consent_template: "Templat.",
    delegation: "Dokter", aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }] } as never, "Layanan baru"));
  svc = (await pub(OWN, "RM-FG")).versionId;
  bsvc = (await pub(BOWN, "RM-FGB")).versionId;
  WA = await connect(A, OWN, "code-verified");
  WB = await connect(B, BOWN, "code-verified-2");
  // the clinic's display name (SET-1) appears in the reminder
  await as(OWN, (db) => changeSetting(db, { key: "SET-1", branchId: null, value: { nama: "Klinik Cantik Sintetis", aksen: "#0A6E86" }, reason: "Nama tampil uji" }));
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

describe("T-095 Scenario PR-69 (reminder reply)", () => {
  it("a booking tomorrow: the H-1 reminder is sent at 10:00 with neutral params; the patient taps Konfirmasi → the appointment is confirmed", async () => {
    const pt = await patient(A, "Pasien Pengingat Sintetis");
    const apt = await appointment(A, pt.id, wib(1, 14, 30), DOC, svc);
    // before 10:00 on the day before: nothing is due
    expect(await runReminderScan(worker, wib(0, 9, 59))).toEqual({ queued: 0, refused: 0 });
    expect(await rem(apt)).toEqual([]);
    // 10:00 the day before (SET-18 default h1): the H-1 reminder is queued once, a rescan queues nothing more
    expect(await runReminderScan(worker, wib(0, 10, 0))).toEqual({ queued: 1, refused: 0 });
    expect(await runReminderScan(worker, wib(0, 10, 5))).toEqual({ queued: 0, refused: 0 });
    const port = mockInboxPort();
    const sentParams: string[][] = [];
    const spy = { ...port, sendMessage: async (i: Parameters<typeof port.sendMessage>[0]) => {
      sentParams.push((i as { params?: string[] }).params ?? []);
      return port.sendMessage(i);
    } };
    expect(await runOutboundDispatch(worker, { port: spy, now: wib(0, 10, 1) })).toEqual({ sent: 1, failed: 0 });
    const [r] = await rem(apt);
    expect(r).toMatchObject({ kind: "h1", o_state: "sent", reply: null, planned: "2031-01-06" });
    // the neutral template: name, then clinic – branch, weekday date month year at the time; no service name (PRIV-15)
    expect(sentParams).toEqual([["Pasien Pengingat Sintetis", "Klinik Cantik Sintetis – Kemang, Selasa 7 Januari 2031 pukul 14:30"]]);
    expect(JSON.stringify(sentParams)).not.toMatch(/Facial|Glow/);
    // the patient taps Konfirmasi on that template (context.id = its wamid)
    const evId = `wamid.RM${++seq}`;
    const ev = inboundButton({ wabaId: WA.metaWabaId, phoneNumberId: WA.pn }, { id: evId, from: pt.phone, text: "Konfirmasi",
      payload: "KONFIRMASI", contextId: r.provider_message_id, at: Math.floor(wib(0, 11).getTime() / 1000) });
    expect(await deliver(ev)).toEqual({ status: 200, outcomes: ["processed"] });
    expect(await apState(apt)).toEqual({ state: "confirmed", state_changed_by: null });
    const [after] = await rem(apt);
    expect(after.reply).toBe("confirm");
    expect(after.reply_message_id).toBe((await h.admin.query(`select id from messages where provider_message_id = $1`, [evId])).rows[0].id);
    // the event: ids only, no staff
    const evs = (await h.admin.query(`select staff_id, payload from domain_events where type = 'AppointmentConfirmed' and aggregate_id = $1`, [apt])).rows;
    expect(evs).toEqual([{ staff_id: null, payload: { appointment_id: apt, branch_id: A.b1, patient_id: pt.id, reminder_id: r.id } }]);
    // the reply text is sealed in the inbox like any message (W-10)
    const m = (await h.admin.query(`select body_enc is not null sealed from messages where id = $1`, [after.reply_message_id])).rows[0];
    expect(m.sealed).toBe(true);
    // a second tap: answered already, nothing changes
    const againId = `wamid.RM${++seq}`;
    const again = inboundButton({ wabaId: WA.metaWabaId, phoneNumberId: WA.pn }, { id: againId, from: pt.phone, text: "Konfirmasi",
      contextId: r.provider_message_id, at: Math.floor(wib(0, 11, 5).getTime() / 1000) });
    expect(await deliver(again)).toEqual({ status: 200, outcomes: ["processed"] });
    expect((await rem(apt))[0].reply_message_id).toBe(after.reply_message_id);
    // the handler's own answer for that second tap (the webhook keeps the message either way)
    expect(await handle(WA.pn, againId, "confirm", r.provider_message_id)).toBe("already_answered");
    expect((await h.admin.query(`select count(*)::int c from domain_events where type = 'AppointmentConfirmed' and aggregate_id = $1`, [apt])).rows[0].c).toBe(1);
  });
});

describe("T-095 Ubah Jadwal, typed replies and timing", () => {
  it("Ubah Jadwal opens a CS follow-up and leaves the appointment; a typed 'konfirmasi' answers the latest unanswered reminder", async () => {
    const pt = await patient(A, "Pasien Ubah Jadwal");
    const a1 = await appointment(A, pt.id, wib(3, 9, 0), DOC, svc);
    // the same-day reminder: 2 h before 09:00 = 07:00; H-1 at 10:00 the day before
    expect(await runReminderScan(worker, wib(2, 10, 0))).toEqual({ queued: 1, refused: 0 });
    expect(await runReminderScan(worker, wib(3, 7, 0))).toEqual({ queued: 1, refused: 0 });
    expect(await runOutboundDispatch(worker, { port: mockInboxPort(), now: wib(3, 7, 1) })).toEqual({ sent: 2, failed: 0 });
    const [h1, sd] = await rem(a1);
    expect([h1.kind, sd.kind]).toEqual(["h1", "same_day"]);
    // Ubah Jadwal quoting the H-1 reminder → a reschedule_request task in the CS queue; the appointment stays booked
    await deliver(inboundButton({ wabaId: WA.metaWabaId, phoneNumberId: WA.pn }, { id: `wamid.RM${++seq}`, from: pt.phone, text: "Ubah Jadwal",
      payload: "UBAH_JADWAL", contextId: h1.provider_message_id, at: Math.floor(wib(3, 7, 10).getTime() / 1000) }));
    expect(await apState(a1)).toEqual({ state: "booked", state_changed_by: null });
    const r1 = (await rem(a1))[0];
    expect(r1.reply).toBe("reschedule");
    const f = (await h.admin.query(`select rule_code, source_kind, source_id, step, role_queue, state from followups where id = $1`, [r1.followup_id])).rows[0];
    expect(f).toEqual({ rule_code: "reschedule_request", source_kind: "appointment", source_id: a1, step: "h1", role_queue: "cs", state: "open" });
    const list = await as(CS, (db) => followupList(db, "open", "all", "reschedule_request"));
    expect(list.followups.map((x: { id: string }) => x.id)).toContain(r1.followup_id);
    // a typed "konfirmasi" without a quote answers the latest unanswered reminder (the same-day one) and confirms
    await deliver(inboundText({ wabaId: WA.metaWabaId, phoneNumberId: WA.pn }, { id: `wamid.RM${++seq}`, from: pt.phone, text: " Konfirmasi ",
      at: Math.floor(wib(3, 7, 20).getTime() / 1000) }));
    expect((await rem(a1)).map((x) => x.reply)).toEqual(["reschedule", "confirm"]);
    expect((await apState(a1)).state).toBe("confirmed");
    // an ordinary text and a reply quoting no reminder stay ordinary messages
    expect(await deliver(inboundText({ wabaId: WA.metaWabaId, phoneNumberId: WA.pn }, { id: `wamid.RM${++seq}`, from: pt.phone, text: "Terima kasih",
      at: Math.floor(wib(3, 7, 30).getTime() / 1000) }))).toEqual({ status: 200, outcomes: ["processed"] });
    expect(await deliver(inboundButton({ wabaId: WA.metaWabaId, phoneNumberId: WA.pn }, { id: `wamid.RM${++seq}`, from: pt.phone, text: "Konfirmasi",
      contextId: "wamid.NOTAREMINDER", at: Math.floor(wib(3, 7, 31).getTime() / 1000) }))).toEqual({ status: 200, outcomes: ["processed"] });
  });

  it("a typed reply answers the latest UNANSWERED reminder; a reply to a cancelled appointment changes nothing", async () => {
    const pt = await patient(A, "Pasien Balasan Urut");
    const a1 = await appointment(A, pt.id, wib(6, 9, 0), DOC, svc);
    expect((await runReminderScan(worker, wib(5, 10, 0))).queued).toBe(1);
    expect((await runReminderScan(worker, wib(6, 7, 0))).queued).toBe(1);
    expect(await runOutboundDispatch(worker, { port: mockInboxPort(), now: wib(6, 7, 1) })).toEqual({ sent: 2, failed: 0 });
    const [h1, sd] = await rem(a1);
    // the latest (same-day) reminder is answered by a quoted Konfirmasi
    await deliver(inboundButton({ wabaId: WA.metaWabaId, phoneNumberId: WA.pn }, { id: `wamid.RM${++seq}`, from: pt.phone, text: "Konfirmasi",
      contextId: sd.provider_message_id, at: Math.floor(wib(6, 7, 10).getTime() / 1000) }));
    expect((await rem(a1)).map((x) => x.reply)).toEqual([null, "confirm"]);
    // a typed "Ubah Jadwal" without a quote answers the earlier, still unanswered H-1 reminder
    await deliver(inboundText({ wabaId: WA.metaWabaId, phoneNumberId: WA.pn }, { id: `wamid.RM${++seq}`, from: pt.phone, text: "ubah jadwal",
      at: Math.floor(wib(6, 7, 20).getTime() / 1000) }));
    const after = await rem(a1);
    expect(after.map((x) => x.reply)).toEqual(["reschedule", "confirm"]);
    expect((await h.admin.query(`select step from followups where id = $1`, [after[0].followup_id])).rows[0].step).toBe("h1");
    expect(after[0].id).toBe(h1.id);
    // a cancelled appointment: its sent reminder is answered by nobody
    const pt2 = await patient(A, "Pasien Janji Batal");
    const a2 = await appointment(A, pt2.id, wib(8, 15, 0), DOC, svc);
    expect((await runReminderScan(worker, wib(7, 10, 0))).queued).toBe(1);
    await runOutboundDispatch(worker, { port: mockInboxPort(), now: wib(7, 10, 1) });
    const [c1] = await rem(a2);
    await paused(["appointments"], () => h.admin.query(`update appointments set state = 'cancelled', state_reason = 'Batal uji', state_changed_at = now(),
      state_changed_by = $2 where id = $1`, [a2, FO.staffId]));
    const tapId = `wamid.RM${++seq}`;
    await deliver(inboundButton({ wabaId: WA.metaWabaId, phoneNumberId: WA.pn }, { id: tapId, from: pt2.phone, text: "Konfirmasi",
      contextId: c1.provider_message_id, at: Math.floor(wib(7, 11).getTime() / 1000) }));
    expect((await rem(a2))[0].reply).toBeNull();
    expect((await apState(a2)).state).toBe("cancelled");
    expect(await handle(WA.pn, tapId, "confirm", c1.provider_message_id)).toBe("appointment_closed");
  });

  it("timing: quiet hours, the same-day clamp to 07:00, SET-18 per branch, cancelled appointments and late bookings", async () => {
    const pt = await patient(A, "Pasien Waktu Kirim");
    // an 08:00 appointment: 2 h before is 06:00 → clamped to 07:00; at 06:30 nothing (quiet hours), at 07:00 it is queued
    const early = await appointment(A, pt.id, wib(10, 8, 0), DOC, svc);
    expect(await runReminderScan(worker, wib(10, 6, 30))).toEqual({ queued: 0, refused: 0 });
    expect((await runReminderScan(worker, wib(10, 7, 0))).queued).toBe(1);
    expect((await rem(early)).map((x) => x.kind)).toEqual(["same_day"]); // h1 is only sent on the day before (a late scan never sends it)
    // the branch's SET-18: H-1 at 16:00 and 3 h before; at 10:00 the day before nothing, at 16:00 the H-1
    await as(OWN, (db) => changeSetting(db, { key: "SET-18", branchId: A.b1, value: { h1: "16:00", sebelum: 3 }, reason: "Jam kirim cabang uji" }));
    const pt2 = await patient(A, "Pasien Setelan Cabang");
    const a2 = await appointment(A, pt2.id, wib(13, 15, 0), DOC, svc);
    expect(await runReminderScan(worker, wib(12, 10, 0))).toEqual({ queued: 0, refused: 0 });
    expect(await runReminderScan(worker, wib(12, 16, 0))).toEqual({ queued: 1, refused: 0 });
    expect(await runReminderScan(worker, wib(13, 11, 59))).toEqual({ queued: 0, refused: 0 });
    expect(await runReminderScan(worker, wib(13, 12, 0))).toEqual({ queued: 1, refused: 0 });
    expect((await rem(a2)).map((x) => [x.kind, x.due_at.toISOString()])).toEqual([["h1", wib(12, 16).toISOString()], ["same_day", wib(13, 12).toISOString()]]);
    // a quiet-hours scan (21:00 or later) never sends, even when due
    const pt3 = await patient(A, "Pasien Malam");
    const a3 = await appointment(A, pt3.id, wib(16, 10, 0), DOC, svc);
    expect(await runReminderScan(worker, wib(15, 21, 0))).toEqual({ queued: 0, refused: 0 });
    expect(await rem(a3)).toEqual([]);
    // a cancelled appointment gets none
    const pt4 = await patient(A, "Pasien Batal");
    const a4 = await appointment(A, pt4.id, wib(19, 15, 0), DOC, svc);
    await paused(["appointments"], () => h.admin.query(`update appointments set state = 'cancelled', state_reason = 'Batal uji', state_changed_at = now(),
      state_changed_by = $2 where id = $1`, [a4, FO.staffId]));
    expect(await runReminderScan(worker, wib(18, 16, 0))).toEqual({ queued: 0, refused: 0 });
    expect(await rem(a4)).toEqual([]);
    // a patient without a phone: refused and counted, the rest continue
    const noPhone = (await patient(A, "Pasien Tanpa Nomor", false)).id;
    await appointment(A, noPhone, wib(22, 15, 0), DOC, svc);
    expect(await runReminderScan(worker, wib(21, 16, 0))).toEqual({ queued: 0, refused: 1 });
  });
});

describe("T-095 a reply that cannot be applied is retried whole (supervisor 2026-11-16: ingestion and reply handling atomic)", () => {
  it("a handler failure stores nothing and answers 500; Meta's redelivery of the same message then applies it once; a third delivery is a duplicate", async () => {
    const pt = await patient(A, "Pasien Ulang Kirim");
    const apt = await appointment(A, pt.id, wib(28, 14, 0), DOC, svc);
    // Kemang's SET-18 is H-1 at 16:00 since the timing test
    expect((await runReminderScan(worker, wib(27, 16, 0))).queued).toBe(1);
    await runOutboundDispatch(worker, { port: mockInboxPort(), now: wib(27, 16, 1) });
    const [r] = await rem(apt);
    const msgId = `wamid.RM${++seq}`;
    const ev = inboundButton({ wabaId: WA.metaWabaId, phoneNumberId: WA.pn }, { id: msgId, from: pt.phone, text: "Konfirmasi", contextId: r.provider_message_id,
      at: Math.floor(wib(27, 11).getTime() / 1000) });
    // a synthetic handler failure: the reminder row refuses every update while this trigger exists
    await h.admin.query(`create function pg_temp_t095_fail() returns trigger language plpgsql as $$ begin raise exception 'synthetic reminder failure'; end $$`);
    await h.admin.query(`create trigger t095_fail before update on appointment_reminders for each row execute function pg_temp_t095_fail()`);
    try {
      expect(await deliver(ev)).toEqual({ status: 500, outcomes: ["retry"] });
    } finally {
      await h.admin.query(`drop trigger t095_fail on appointment_reminders`);
      await h.admin.query(`drop function pg_temp_t095_fail()`);
    }
    // nothing was stored: no message, no receipt, the reminder unanswered, the appointment booked
    expect((await h.admin.query(`select count(*)::int c from messages where provider_message_id = $1`, [msgId])).rows[0].c).toBe(0);
    expect((await h.admin.query(`select count(*)::int c from meta_webhook_receipts where provider_event_id = $1`, [msgId])).rows[0].c).toBe(0);
    expect((await rem(apt))[0].reply).toBeNull();
    expect((await apState(apt)).state).toBe("booked");
    // the provider redelivers the same message: processed whole, once
    expect(await deliver(ev)).toEqual({ status: 200, outcomes: ["processed"] });
    expect((await apState(apt)).state).toBe("confirmed");
    const [after] = await rem(apt);
    expect(after.reply).toBe("confirm");
    expect(after.reply_message_id).toBe((await h.admin.query(`select id from messages where provider_message_id = $1`, [msgId])).rows[0].id);
    // a third delivery is a duplicate: no second message, event or reply
    expect(await deliver(ev)).toEqual({ status: 200, outcomes: ["duplicate"] });
    expect((await h.admin.query(`select count(*)::int c from messages where provider_message_id = $1`, [msgId])).rows[0].c).toBe(1);
    expect((await h.admin.query(`select count(*)::int c from domain_events where type = 'AppointmentConfirmed' and aggregate_id = $1`, [apt])).rows[0].c).toBe(1);
  });
});

describe("T-095 guards, definers and tenants", () => {
  it("the definers refuse a bound connection and foreign keys; the reminder table is guarded; tenants see only their rows", async () => {
    expect(await as(FO, (db) => db.query(`select reminder_scan(null)`)).then(() => "ok", (e) => `raw:${e.code}`)).toBe("raw:42501");
    expect(await as(FO, (db) => db.query(`select reminder_reply_handle('{}'::jsonb)`)).then(() => "ok", (e) => `raw:${e.code}`)).toBe("raw:42501");
    expect(await worker.query(`select reminder_reply_handle('{"phone_number_id":"1","provider_message_id":"x","action":"confirm","x":1}'::jsonb)`)
      .then(() => "ok", (e) => `raw:${e.code}`)).toBe("raw:22023");
    expect(await worker.query(`select reminder_reply_handle('{"phone_number_id":"1","provider_message_id":"x","action":"cancel"}'::jsonb)`)
      .then(() => "ok", (e) => `raw:${e.code}`)).toBe("raw:22023");
    expect((await worker.query(`select reminder_reply_handle('{"phone_number_id":"1","provider_message_id":"x","action":"confirm"}'::jsonb) r`)).rows[0].r).toBe("no_reminder");
    // B: its own reminder; A's staff never read it, A's webhook number never answers it
    const bp = await patient(B, "Pasien B Pengingat");
    const bapt = await appointment(B, bp.id, wib(25, 15, 0), BOWN, bsvc);
    expect((await runReminderScan(worker, wib(24, 10, 0))).queued).toBeGreaterThanOrEqual(1);
    await runOutboundDispatch(worker, { port: mockInboxPort(), now: wib(24, 10, 1) });
    const [br] = await rem(bapt);
    expect(br.o_state).toBe("sent");
    for (const p of [OWN, CS, FO])
      expect((await as(p, (db) => db.query(`select id from appointment_reminders where id = $1`, [br.id]))).rowCount, p.role).toBe(0);
    expect((await as(BCS, (db) => db.query(`select id from appointment_reminders where id = $1`, [br.id]))).rowCount).toBe(1);
    // the B patient's reply arriving on A's number (a different tenant's route) answers nothing of B's
    await deliver(inboundButton({ wabaId: WA.metaWabaId, phoneNumberId: WA.pn }, { id: `wamid.RM${++seq}`, from: bp.phone, text: "Konfirmasi",
      contextId: br.provider_message_id, at: Math.floor(wib(24, 11).getTime() / 1000) }));
    expect((await rem(bapt))[0].reply).toBeNull();
    expect((await apState(bapt)).state).toBe("booked");
    // B's own number answers it
    await deliver(inboundButton({ wabaId: WB.metaWabaId, phoneNumberId: WB.pn }, { id: `wamid.RM${++seq}`, from: bp.phone, text: "Konfirmasi",
      contextId: br.provider_message_id, at: Math.floor(wib(24, 11, 1).getTime() / 1000) }));
    expect((await apState(bapt)).state).toBe("confirmed");
    // branch scope and roles: the Bintaro FO and marketing read none of Kemang's reminders
    const ar = (await h.admin.query(`select id from appointment_reminders where tenant_id = $1 limit 1`, [A.tenantId])).rows[0].id as string;
    for (const p of [FO2, MKT, DOC]) expect((await as(p, (db) => db.query(`select id from appointment_reminders where id = $1`, [ar]))).rowCount, p.role).toBe(0);
    expect((await as(FO, (db) => db.query(`select id from appointment_reminders where id = $1`, [ar]))).rowCount).toBe(1);
    // the guard: never deleted, identity frozen, a reply is final, no truncate
    expect(await raw(`delete from appointment_reminders where id = $1`, [ar])).toBe("raw:42501");
    expect(await raw(`update appointment_reminders set kind = 'same_day' where id = $1`, [br.id])).toBe("raw:42501");
    // a reply is final: CHECK-valid changes of an answered reminder (another reply with a real follow-up, another message) are refused by the guard
    const fid = await paused(["followups"], async () => (await h.admin.query(`insert into followups (tenant_id, branch_id, patient_id, rule_code,
        source_kind, source_id, step, role_queue, original_due_on, due_on) values ($1, $2, $3, 'reschedule_request', 'appointment', $4, 'uji', 'cs',
        current_date, current_date) returning id`, [B.tenantId, B.b1, bp.id, bapt])).rows[0].id as string);
    expect(await raw(`update appointment_reminders set reply = 'reschedule', followup_id = $2 where id = $1`, [br.id, fid])).toBe("raw:42501");
    const otherId = `wamid.RM${++seq}`;
    await deliver(inboundText({ wabaId: WB.metaWabaId, phoneNumberId: WB.pn }, { id: otherId, from: bp.phone, text: "Terima kasih", at: Math.floor(wib(24, 12).getTime() / 1000) }));
    const otherMsg = (await h.admin.query(`select id from messages where tenant_id = $1 and direction = 'in' and id <> (select reply_message_id from
      appointment_reminders where id = $2) limit 1`, [B.tenantId, br.id])).rows[0].id as string;
    expect(await raw(`update appointment_reminders set reply_message_id = $2 where id = $1`, [br.id, otherMsg])).toBe("raw:42501");
    expect(await raw(`truncate appointment_reminders cascade`)).toBe("raw:42501");
    // a staff confirmation still records its actor (the widened check admits null for confirmed only)
    expect(await raw(`update appointments set state = 'cancelled', state_reason = 'Uji batal', state_changed_at = now() where id = $1`, [bapt])).toBe("raw:23514");
  });
});
