// T-101 M6 exit (PLAN §1 M6: "Test number end to end with recorded fixtures; webhook replay fixtures (duplicate, late, out of order,
// bad signature); PR-94 per-patient cap under concurrency"). One tenant and its test number — the mock Graph port's Embedded Signup and a
// registered Kemang number — through every M6 path on a real database, through the real writers and the real webhook intake
// (receiveMetaWebhook, the function the route calls, with a valid X-Hub-Signature-256 from the mock app secret and the recorded Graph
// v21.0 payload builders). The Meta ports are the mocks (DEC-082): `fetch` is stubbed and asserted never called. The documented stand-ins
// of earlier tasks (appointment / visit rows the M1 writers would make; the guard paused only for those inserts) are the only rows written
// around a writer. Steps run in order on the one tenant; step 12 (the cap under concurrency) is an isolated block with its own patient,
// approved synthetic Q-15 evidence and a wide budget (plan r1, Sol 5e49112a P1). Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "../../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../../src/db/rls/context";
import { openAppPool } from "../../../src/db/rls/pool";
import { CommandError } from "../../../src/lib/command";
import type { KekRing } from "../../../src/lib/keys/envelope";
import { setKekRingForTests } from "../../../src/lib/keys/runtime";
import { issueKasirInvoice, openKasirInvoice, receivePayment } from "../../../src/modules/cashier/kasir/kasir";
import { publish } from "../../../src/modules/catalog/catalog";
import { scheduleControl } from "../../../src/modules/cashier/consultation/consultation";
import { getComplaint } from "../../../src/modules/clinical/complaints/complaints";
import { decideEvidence, uploadEvidence } from "../../../src/modules/compliance/compliance";
import { saveSegment, scheduleCampaign, sendCampaign } from "../../../src/modules/crm/campaigns/campaigns";
import { followupList } from "../../../src/modules/crm/followups/followups";
import { runFollowupScan } from "../../../src/modules/crm/followups/scan";
import { runReminderScan } from "../../../src/modules/crm/reminders/reminders";
import { recordSurvey } from "../../../src/modules/crm/surveys/surveys";
import { outboundBacklog, runOutboundDispatch } from "../../../src/modules/messaging/outbound/outbound";
import { grantConsent, publishConsentText } from "../../../src/modules/patients/consents/consents";
import { cancelAppointment } from "../../../src/modules/scheduling/appointments/appointments";
import { addToWaitlist } from "../../../src/modules/scheduling/waitlist/waitlist";
import { changeSetting } from "../../../src/modules/settings/settings";
import { createLead, saveCampaign, setLeadStage } from "../../../src/modules/crm/leads/leads";
import { saveItem } from "../../../src/modules/inventory/stock";
import { flagMessage } from "../../../src/modules/messaging/inbox/flag";
import { inboundButton, inboundText, RECORDED_TEMPLATES, statusEvent } from "../../../src/modules/messaging/inbox/fixtures";
import { receiveMetaWebhook, sendInboxMessage, syncTemplates, updateConversation } from "../../../src/modules/messaging/inbox/inbox";
import { mockInboxPort, mockMetaAppSecret, signMeta } from "../../../src/modules/messaging/inbox/mock";
import type { RemoteTemplate } from "../../../src/modules/messaging/inbox/port";
import { mockWabaGraphPort } from "../../../src/modules/messaging/waba/mock";
import { addWaNumber, completeWabaSignup, startWabaSignup, syncWabaStatus, wabaStatus } from "../../../src/modules/messaging/waba/waba";
import { setServices } from "../../../src/modules/org/branches/branches";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { createHarness, type Harness, testPool } from "../../../tests/rls/harness";

process.env.DEPLOY_ENV = "local"; // synthetic data (MIG-2)
const RING: KekRing = { current: 1, keys: new Map([[1, Buffer.alloc(32, 11)]]) };
const TEMPLATES: RemoteTemplate[] = [...RECORDED_TEMPLATES,
  { name: "tindak_lanjut_perawatan", language: "id", category: "utility", status: "approved", body: "Halo {{1}}, kami ingin tahu kabar Anda setelah kunjungan di {{2}}.", paramCount: 2 },
  { name: "isi_ulang_produk", language: "id", category: "marketing", status: "approved", body: "Halo {{1}}, saatnya isi ulang produk Anda di {{2}}.", paramCount: 2 },
  { name: "promo_kampanye", language: "id", category: "marketing", status: "approved", body: "Halo {{1}}, ada kabar baru dari {{2}}.", paramCount: 2 },
  { name: "perawatan_anda", language: "id", category: "utility", status: "approved", body: "Halo {{1}}, panduan perawatan Anda setelah kunjungan di {{2}} tersedia di {{3}}.", paramCount: 3 }];

let h: Harness;
let app: pg.Pool;
let worker: pg.Pool;
let owner: pg.Pool;
let n = 0;
let seq = 0;
type P = { acc: string; staffId: string; role: Role; branch?: string };
let tenantId: string; let b1: string; let b2: string;
const TENANT_WIDE = ["owner", "admin_pusat", "central_cs", "marketing", "finance", "auditor"];
const H = 3_600_000;
const key = () => crypto.randomUUID();
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const why = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason}` : `raw:${e.message}`));

async function person(role: Role, name: string, branch?: string): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ($1, $2, true) returning id`, [name, `m6flow${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId, accountId: acc, displayName: name });
  const rid = await assignRole(h.admin, { tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) await assignBranch(h.admin, { tenantId, staffRoleId: rid, branchId: branch ?? b1 });
  return { acc, staffId, role, branch: TENANT_WIDE.includes(role) ? undefined : branch ?? b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
async function paused<R>(tables: string[], fn: () => Promise<R>) {
  for (const t of tables) await h.admin.query(`alter table ${t} disable trigger ${t}_guard`);
  try {
    return await fn();
  } finally {
    for (const t of tables) await h.admin.query(`alter table ${t} enable always trigger ${t}_guard`);
  }
}
// The test number: a recorded, signed delivery into the real intake (the route's function).
let META = ""; let PN = "";
const wamid = () => `wamid.M6${String(++seq).padStart(6, "0")}`;
async function deliver(body: unknown, bad = false) {
  const raw = JSON.stringify(body);
  return receiveMetaWebhook(worker, raw, signMeta(bad ? Buffer.alloc(32, 1) : mockMetaAppSecret()!, raw));
}
const tn = () => ({ wabaId: META, phoneNumberId: PN });
async function patient(name: string, phone: string) {
  const id = (await h.admin.query(`insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation,
       education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $2, '1990-06-15', 'female', 'newborn_via_guardian', 'Fixture sintetis',
       'islam', 'Karyawan', 's1', 'kawin', $3, (select id from staff where tenant_id = $1 limit 1), 'fo_cashier') returning id`, [tenantId, name, b1])).rows[0].id as string;
  await h.admin.query(`insert into contact_points (tenant_id, patient_id, kind, value) values ($1, $2, 'phone', $3)`, [tenantId, id, `+${phone}`]);
  return id;
}
const conv = async (from: string) => (await h.admin.query(`select * from conversations where tenant_id = $1 and contact_wa_id = $2`, [tenantId, from])).rows[0];
const msgOf = async (providerId: string) => (await h.admin.query(`select * from messages where provider_message_id = $1`, [providerId])).rows[0];


// A booked appointment and a visit at fixed instants (documented stand-ins of the M1 booking / check-in writers; guard paused for the insert only).
async function booked(pt: string, start: Date, versionId = facial.versionId) {
  return paused(["appointments"], async () => (await h.admin.query(`insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id,
      starts_at, ends_at, state, channel, created_by, created_as) values ($1, $2, $3, $4, $5, $6, $7, 'booked', 'whatsapp', $5, 'fo_cashier') returning id`,
    [tenantId, b1, pt, versionId, DOC.staffId, start, new Date(start.getTime() + 30 * 60_000)])).rows[0].id as string);
}
const ob = async (id: string) => (await h.admin.query(`select * from outbound_messages where id = $1`, [id])).rows[0];
// a mock port that records every template it sends (the test number's outbound side)
function recordingPort() {
  const port = mockInboxPort();
  const sent: { template: string; params: string[]; to: string }[] = [];
  return { sent, port: { ...port, sendMessage: async (i: Parameters<typeof port.sendMessage>[0]) => {
    if (i.kind === "template") sent.push({ template: i.templateName, params: i.params, to: i.to });
    return port.sendMessage(i);
  } } };
}
const fetchSpy = vi.fn();
let OWN: P; let ADM: P; let CS: P; let FO: P; let DOC: P; let NURSE: P; let MGR: P; let BC: P; let MKT: P; let PH: P; let FH: P;
let facial: { itemId: string; versionId: string }; let serum: string; let ctlItem = ""; let marketingText = "";
let wabaId = "";

beforeAll(async () => {
  setKekRingForTests(RING);
  h = await createHarness();
  const login = h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE]));
  app = await openAppPool({ connectionString: login, max: 6 });
  worker = await openAppPool({ connectionString: login, max: 3 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Klinik M6 Sintetis', 'emkm')`, [tenantId]);
  const br = async (c: string, nm: string) =>
    (await h.admin.query(`insert into branches (tenant_id, code, name, timezone, address) values ($1, $2, $3, 'Asia/Jakarta', 'Jl. Uji') returning id`, [tenantId, c, nm])).rows[0].id as string;
  b1 = await br("M61", "Kemang"); b2 = await br("M62", "Bintaro");
  OWN = await person("owner", "Ibu Pemilik"); ADM = await person("admin_pusat", "Admin Pusat"); CS = await person("central_cs", "CS Pusat");
  FO = await person("fo_cashier", "Rina Kasir"); DOC = await person("doctor", "dr. Sinta"); NURSE = await person("nurse", "Ners Ani");
  MGR = await person("manager", "Manajer Kemang"); BC = await person("bc", "BC Kemang"); MKT = await person("marketing", "Dewi Marketing");
  PH = await person("pharmacist", "Apoteker"); FH = await person("facility_head", "Kepala Fasilitas");
  const pub = (code: string, f: Record<string, unknown>) => as(OWN, (db) => publish(db, { kind: "service", code }, { name: "Facial Glow", tax_category: "exempt_medical",
    tax_basis: "Jasa medis", normal_price: 300_000, category: "facial", prep_min: 0, treatment_min: 30, buffer_min: 0, indications: "Indikasi", consent_template: "Templat.",
    delegation: "Dokter", aftercare_text: "Hindari sinar matahari langsung 24 jam.", eligibility: [{ role: "doctor", mode: "performs" }], ...f } as never, "Layanan baru"));
  const f = await pub("M6-FG", {});
  if (f.approvalId) await as(FH, (db) => db.query(`select approval_decide($1, true, null)`, [f.approvalId]));
  facial = { itemId: f.itemId, versionId: f.versionId };
  const ctl = await pub("M6-CTL", { control_count: 1, control_validity_days: 14 });
  if (ctl.approvalId) await as(FH, (db) => db.query(`select approval_decide($1, true, null)`, [ctl.approvalId]));
  ctlItem = ctl.itemId;
  serum = (await as(OWN, (db) => publish(db, { kind: "product", code: "M6-SRM" }, { name: "Serum M6", tax_category: "non_object", tax_basis: "Barang", normal_price: 250_000 } as never, "Produk"))).itemId;
  await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: serum, unit: "pcs", storage: "ruang", highValue: false, active: true }));
  await as(OWN, (db) => changeSetting(db, { key: "SET-1", branchId: null, value: { nama: "Klinik M6 Sintetis", aksen: "#0A6E86" }, reason: "Nama tampil uji" }));
  marketingText = (await as(OWN, (db) => publishConsentText(db, { purpose: "marketing_wa", body: "Saya setuju menerima promosi klinik." }))).id;
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
  expect(fetchSpy).not.toHaveBeenCalled(); // no live provider call, ever
  vi.unstubAllGlobals();
});

describe("M6 exit: the test number end to end (recorded fixtures, mock ports)", () => {
  it("1 onboarding (PR-27): Embedded Signup registers the test number; an unverified business is held at two numbers", async () => {
    const port = mockWabaGraphPort();
    ({ wabaId } = await as(OWN, (db) => startWabaSignup(db, key(), { onboardingChannel: "cloud_api" })));
    await as(OWN, (db) => completeWabaSignup(db, wabaId, "code-unverified" as never, { port }));
    PN = `9${String(Date.now()).slice(-9)}1`;
    const n1 = await as(OWN, (db) => addWaNumber(db, key(), wabaId, { branchId: b1, phoneNumber: "+6281299911101", phoneNumberId: PN }, { port }));
    const n2 = await as(OWN, (db) => addWaNumber(db, key(), wabaId, { branchId: null, phoneNumber: "+6281299911102", phoneNumberId: `9${String(Date.now()).slice(-9)}2` }, { port }));
    expect([n1.ok, n2.ok]).toEqual([true, true]);
    // Scenario PR-27: the third number asks for Meta business verification first
    const third = await as(OWN, (db) => addWaNumber(db, key(), wabaId, { branchId: b2, phoneNumber: "+6281299911103", phoneNumberId: `9${String(Date.now()).slice(-9)}3` }, { port }));
    expect(third).toMatchObject({ ok: false, code: "verification_required" });
    META = (await h.admin.query(`select meta_waba_id from waba_accounts where id = $1`, [wabaId])).rows[0].meta_waba_id as string;
    await as(OWN, (db) => syncTemplates(db, { port: { ...mockInboxPort(), fetchTemplates: async () => TEMPLATES.map((x) => ({ ...x })) } }));
    expect((await as(OWN, (db) => wabaStatus(db))).numbers.length).toBe(2);
  });

  it("2 inbound (PR-28): a recorded inbound text opens the conversation at Kemang; a reply in the window; 25 h later only approved templates", async () => {
    const from = "6281700006001";
    await deliver(inboundText(tn(), { id: wamid(), from, name: "Kontak M6", text: "Halo, mau tanya jadwal", at: Math.floor(Date.now() / 1000) }));
    const c = await conv(from);
    expect(c).toMatchObject({ branch_id: b1 });
    const port = mockInboxPort();
    expect((await as(FO, (db) => sendInboxMessage(db, key(), c.id, { kind: "text", body: "Selamat pagi, ada yang bisa kami bantu?" }, { port }))).status).toBe("sent");
    // Scenario PR-28: a conversation whose last patient message was 25 h ago
    const late = "6281700006002";
    await deliver(inboundText(tn(), { id: wamid(), from: late, text: "Kemarin", at: Math.floor(Date.now() / 1000) - 25 * 3600 }));
    const c2 = await conv(late);
    expect(await why(as(FO, (db) => sendInboxMessage(db, key(), c2.id, { kind: "text", body: "Halo lagi" }, { port })))).toBe("ERR_VERSION_CONFLICT:window_closed");
    const tpl = (await h.admin.query(`select id from wa_templates where tenant_id = $1 and name = 'pengingat_janji'`, [tenantId])).rows[0].id as string;
    expect((await as(FO, (db) => sendInboxMessage(db, key(), c2.id, { kind: "template", templateId: tpl, params: ["Rina", "Senin"] }, { port }))).status).toBe("sent");
    expect(port.sent).toEqual([{ kind: "text", to: from }, { kind: "template", to: late }]);
  });

  it("3 complaint flag (PR-43 inbox): CS flags a recorded inbound message → a task for Kemang's clinicians; CS sees status only", async () => {
    const from = "6281700006003";
    const pid = await patient("Pasien Keluhan M6", from);
    const id = wamid();
    await deliver(inboundText(tn(), { id, from, text: "wajah bengkak setelah laser kemarin", at: Math.floor(Date.now() / 1000) }));
    const m = await msgOf(id);
    await as(FO, (db) => updateConversation(db, m.conversation_id, { action: "match", patientId: pid }));
    const { taskId } = await as(CS, (db) => flagMessage(db, key(), m.id, { kind: "klinis", summary: "Bengkak setelah laser" }));
    const notes = (await h.admin.query(`select recipient_role from notifications where subject_id = $1 order by 1`, [taskId])).rows.map((r) => r.recipient_role);
    expect(notes).toContain("doctor");
    expect(await as(DOC, (db) => getComplaint(db, taskId))).toMatchObject({ content: true, summary: "Bengkak setelah laser" });
    const forCs = await as(CS, (db) => getComplaint(db, taskId));
    expect(forCs).toMatchObject({ content: false, state: "open" });
    expect(forCs).not.toHaveProperty("summary");
    expect(NURSE && MGR && BC && MKT && ADM).toBeTruthy();
  });

  it("4 lead (PR-29): the conversation becomes a lead; converted refused while unpaid, allowed once paid", async () => {
    const from = "6281700006004";
    const pid = await patient("Pasien Lead M6", from);
    const id = wamid();
    await deliver(inboundText(tn(), { id, from, text: "Mau booking facial", at: Math.floor(Date.now() / 1000) }));
    const c = await conv(from);
    const { leadId } = await as(CS, (db) => createLead(db, key(), { source: "whatsapp", conversationId: c.id, patientId: pid, branchId: b1 }));
    await as(CS, (db) => setLeadStage(db, key(), leadId, { to: "contacted" }));
    const apt = await paused(["appointments"], async () => (await h.admin.query(`insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id,
        performer_staff_id, starts_at, ends_at, state, channel, created_by, created_as) values ($1, $2, $3, $4, $5, now() + interval '2 days', now() + interval '2 days 30 minutes',
        'booked', 'whatsapp', $5, 'fo_cashier') returning id`, [tenantId, b1, pid, facial.versionId, DOC.staffId])).rows[0].id as string);
    await as(CS, (db) => setLeadStage(db, key(), leadId, { to: "booked" }));
    await paused(["appointments"], () => h.admin.query(`update appointments set state = 'arrived', state_changed_at = now(), state_changed_by = $2 where id = $1`, [apt, FO.staffId]));
    const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, appointment_id, kind, checked_in_by) values ($1, $2, $3, $4, 'booked', $5) returning id`,
      [tenantId, b1, pid, apt, FO.staffId])).rows[0].id as string;
    await as(CS, (db) => setLeadStage(db, key(), leadId, { to: "arrived" }));
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: serum, quantity: 1 }]));
    // Scenario PR-29: arrived, nothing paid → converted refused
    expect(await why(as(CS, (db) => setLeadStage(db, key(), leadId, { to: "converted" })))).toBe("ERR_VERSION_CONFLICT:payment_required");
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 250_000, cashTendered: 250_000 }]));
    expect((await as(CS, (db) => setLeadStage(db, key(), leadId, { to: "converted" }))).stage).toBe("converted");
    expect(code).toBeTruthy();
  });

  it("5 reminder reply (PR-69): a booking tomorrow, the H-1 reminder through the mock port, the patient taps Konfirmasi on the test number → confirmed", async () => {
    const phone = "6281700006005";
    const pid = await patient("Pasien Pengingat M6", phone);
    // fixed WIB instants far ahead (no other step's clock): the booking at 14:30 the day after D
    const D = Date.UTC(2032, 6, 5); // a Monday, 00:00 UTC
    const wib = (d: number, hh: number, mm = 0) => new Date(D + d * 86_400_000 + (hh - 7) * H + mm * 60_000);
    const apt = await booked(pid, wib(1, 14, 30));
    expect(await runReminderScan(worker, wib(0, 10, 0))).toMatchObject({ queued: 1 });
    const rec = recordingPort();
    expect(await runOutboundDispatch(worker, { port: rec.port, now: wib(0, 10, 1) })).toMatchObject({ sent: 1, failed: 0 });
    expect(rec.sent[0].to).toBe(phone);
    expect(JSON.stringify(rec.sent[0].params)).not.toMatch(/Facial|Glow/); // neutral (PRIV-15)
    const r = (await h.admin.query(`select o.provider_message_id from appointment_reminders r join outbound_messages o on o.id = r.outbound_id
      where r.appointment_id = $1`, [apt])).rows[0];
    expect((await deliver(inboundButton(tn(), { id: wamid(), from: phone, text: "Konfirmasi", payload: "KONFIRMASI", contextId: r.provider_message_id,
      at: Math.floor(wib(0, 11).getTime() / 1000) }))).status).toBe(200);
    expect((await h.admin.query(`select state from appointments where id = $1`, [apt])).rows[0].state).toBe("confirmed");
  });

  it("6 aftercare (PR-70): the visit closes → a neutral care message with a protected link, sent without marketing consent; no treatment name", async () => {
    const phone = "6281700006006";
    const pid = await patient("Pasien Aftercare M6", phone);
    const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
      [tenantId, b1, pid, FO.staffId])).rows[0].id as string;
    const exam = await paused(["examinations"], async () => (await h.admin.query(`insert into examinations (tenant_id, branch_id, visit_id, patient_id, author_id)
        values ($1, $2, $3, $4, $5) returning id`, [tenantId, b1, v, pid, DOC.staffId])).rows[0].id as string);
    const plan = await paused(["care_plans"], async () => (await h.admin.query(`insert into care_plans (tenant_id, branch_id, patient_id, title, condition, created_exam_id,
        created_by) values ($1, $2, $3, 'Rencana', 'Kondisi', $4, $5) returning id`, [tenantId, b1, pid, exam, DOC.staffId])).rows[0].id as string);
    const pi = await paused(["plan_items"], async () => (await h.admin.query(`insert into plan_items (tenant_id, branch_id, plan_id, examination_id, stage, catalog_version_id, qty)
        values ($1, $2, $3, $4, 1, $5, 1) returning id`, [tenantId, b1, plan, exam, facial.versionId])).rows[0].id as string);
    await paused(["treatment_executions"], () => h.admin.query(`insert into treatment_executions (tenant_id, branch_id, visit_id, plan_item_id, performer_staff_id,
        identity_confirmed, state, started_by, started_as, start_command_key, started_at, finished_at, finished_by, finished_as, finish_command_key, outcome)
        values ($1, $2, $3, $4, $5, true, 'finished', $5, 'doctor', $6, now() - interval '30 minutes', now(), $5, 'doctor', $7, 'completed')`,
      [tenantId, b1, v, pi, DOC.staffId, `k-${key()}`, `k-${key()}`]));
    await paused(["visits"], () => h.admin.query(`update visits set closed_at = clock_timestamp(), closed_by = $2 where id = $1`, [v, FO.staffId]));
    const o = (await h.admin.query(`select * from outbound_messages where source_id = $1 and purpose = 'aftercare'`, [v])).rows[0];
    expect(o).toMatchObject({ purpose: "aftercare", category: "utility", state: "queued" });
    const rec = recordingPort();
    await runOutboundDispatch(worker, { port: rec.port, now: new Date(Date.now() + 60_000) });
    const sent = rec.sent.find((x) => x.template === "perawatan_anda")!;
    expect(sent.to).toBe(phone);
    expect(sent.params[2]).toMatch(/^\/aftercare\/[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(sent.params)).not.toMatch(/Facial|Glow|matahari/);
  });

  it("7 survey (PR-78): a score of 2 → a manager task; no review request (no outbound message)", async () => {
    const pid = await patient("Pasien Survei M6", "6281700006007");
    const v = await paused(["visits"], async () => (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by, closed_at, closed_by)
        values ($1, $2, $3, 'walk_in', $4, now(), $4) returning id`, [tenantId, b1, pid, FO.staffId])).rows[0].id as string);
    const before = Number((await h.admin.query(`select count(*) c from outbound_messages where tenant_id = $1 and patient_id = $2`, [tenantId, pid])).rows[0].c);
    const { surveyId } = await as(CS, (db) => recordSurvey(db, key(), { visitId: v, score: 2 }));
    const f = (await h.admin.query(`select f.* from surveys s join followups f on f.id = s.followup_id where s.id = $1`, [surveyId])).rows[0];
    expect(f).toMatchObject({ rule_code: "survey_low", state: "open", branch_id: b1, assignee_staff_id: MGR.staffId });
    expect(Number((await h.admin.query(`select count(*) c from outbound_messages where tenant_id = $1 and patient_id = $2`, [tenantId, pid])).rows[0].c)).toBe(before);
  });

  it("8 waitlist (PR-81): a patient waits for the service; a matching slot is cancelled → the branch's staff are prompted", async () => {
    await as(OWN, (db) => setServices(db, b1, [facial.itemId])); // Kemang offers the service (the waitlist needs a branch that offers it)
    const waiting = await patient("Pasien Tunggu M6", "6281700006008");
    const { entryId } = await as(FO, (db) => addToWaitlist(db, key(), { branchId: b1, patientId: waiting, itemId: facial.itemId }));
    const other = await patient("Pasien Batal M6", "6281700006018");
    const apt = await booked(other, new Date(Date.now() + 3 * 86_400_000));
    await as(FO, (db) => cancelAppointment(db, key(), apt, "Pasien berhalangan"));
    expect((await h.admin.query(`select state, offered_appointment_id from waitlist_entries where id = $1`, [entryId])).rows[0]).toEqual({ state: "offered", offered_appointment_id: apt });
    expect((await h.admin.query(`select recipient_role from notifications where type = 'waitlist_offer' and subject_id = $1 order by 1`, [entryId])).rows.map((r) => r.recipient_role))
      .toEqual(["central_cs", "fo_cashier", "manager"]);
  });

  it("9 follow-up (PR-30): a free control two days away → a task for the guiding BC", async () => {
    const pid = await patient("Pasien Kontrol M6", "6281700006009");
    const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
      [tenantId, b1, pid, FO.staffId])).rows[0].id as string;
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: v }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: ctlItem, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 300_000, cashTendered: 300_000 }]));
    // the guiding BC through the invoice attribution (as T-093's tests): the issue wrote an active attribution; it is superseded by ours
    await paused(["commission_sale_attributions"], async () => {
      await h.admin.query(`update commission_sale_attributions set state = 'superseded', ended_at = now() where invoice_id = $1 and state = 'active'`, [invoiceId]);
      await h.admin.query(`insert into commission_sale_attributions (tenant_id, branch_id, invoice_id, guiding_bc_staff_id, state, source, attributed_by, attributed_as)
        values ($1, $2, $3, $4, 'active', 'command', $5, 'manager')`, [tenantId, b1, invoiceId, BC.staffId, MGR.staffId]);
    });
    const line = (await h.admin.query(`select id from invoice_lines where invoice_id = $1 order by created_at limit 1`, [invoiceId])).rows[0].id as string;
    const day = (d: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(Date.now() + d * 86_400_000));
    const ctl = await as(DOC, (db) => scheduleControl(db, key(), line, day(5)));
    await runFollowupScan(worker, day(3)); // two days before the control
    const f = (await h.admin.query(`select * from followups where rule_code = 'control_due' and source_id = $1`, [ctl.control_id])).rows[0];
    expect(f).toMatchObject({ role_queue: "bc", assignee_staff_id: BC.staffId, state: "open" });
    expect((await as(BC, (db) => followupList(db, "open", "mine"))).followups.map((x) => x.id)).toContain(f.id);
  });

  it("10 budget (PR-31): the daily budget reached → more due messages queued for the next window; the backlog shows them (counts only)", async () => {
    // the test number's WABA: a budget of 2 new recipients a day (portfolio limit 20 × SET-21 10 %, as T-094's test)
    // through the real writer (review r1 P1: never around an M6 writer): syncWabaStatus with a mock status port reporting the limit
    const limitPort = (limit: number) => { const g = mockWabaGraphPort(); return { ...g, fetchWabaStatus: async (i: Parameters<typeof g.fetchWabaStatus>[0]) =>
      ({ ...(await g.fetchWabaStatus(i)), portfolioMessagingLimit: limit }) }; };
    await as(OWN, (db) => syncWabaStatus(db, wabaId, { port: limitPort(20) }));
    expect((await h.admin.query(`select portfolio_messaging_limit from waba_accounts where id = $1`, [wabaId])).rows[0].portfolio_messaging_limit).toBe(20);
    await as(OWN, (db) => changeSetting(db, { key: "SET-21", branchId: null, value: 10, reason: "Batas kirim uji" }));
    const tpl = (await h.admin.query(`select id from wa_templates where tenant_id = $1 and name = 'pengingat_janji'`, [tenantId])).rows[0].id as string;
    const at = new Date(Date.UTC(2032, 8, 1, 3)); // a fixed instant far ahead: no other step's sends in its 24 h
    const day0 = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(at);
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const pid = await patient(`Pasien Anggaran M6 ${i}`, `628170000610${i}`);
      ids.push((await h.admin.query(`select public.outbound_enqueue_do($1, $2, 'care_reminder', $3, $4, $5, 'appointment', gen_random_uuid(), $6::date, null, null, now()) id`,
        [tenantId, `k-${key()}`, pid, b1, tpl, day0])).rows[0].id as string);
    }
    expect(await runOutboundDispatch(worker, { port: mockInboxPort(), now: at })).toMatchObject({ sent: 2, failed: 0 });
    const rows = await Promise.all(ids.map(ob));
    expect(rows.map((x) => x.state)).toEqual(["sent", "sent", "queued", "queued"]);
    expect(rows.slice(2).map((x) => x.deferred_reason)).toEqual(["budget_reached", "budget_reached"]);
    const bl = await as(CS, (db) => outboundBacklog(db));
    expect(bl.queued.some((q) => q.deferred_budget === 2)).toBe(true);
    expect(JSON.stringify(bl)).not.toMatch(/Pasien Anggaran/);
    // restore a wide budget for the later steps
    await as(OWN, (db) => syncWabaStatus(db, wabaId, { port: limitPort(1000) }));
    await as(OWN, (db) => changeSetting(db, { key: "SET-21", branchId: null, restore: true, reason: "Kembali ke default" }));
  });

  it("11 campaign (PR-94): scheduled to a consented segment; the Q-15 evidence not approved → refused with the copy, nothing queued", async () => {
    const pid = await patient("Pasien Kampanye M6", "6281700006011");
    await as(FO, (db) => grantConsent(db, key(), { patientId: pid, purpose: "marketing_wa", textId: marketingText, channel: "in_person" }));
    const tpl = (await h.admin.query(`select id from wa_templates where tenant_id = $1 and name = 'promo_kampanye'`, [tenantId])).rows[0].id as string;
    const seg = (await as(MKT, (db) => saveSegment(db, key(), { name: "Perempuan Kemang", rules: { branch_id: b1, sex: "female" } }))).segmentId;
    const c = (await as(MKT, (db) => saveCampaign(db, key(), { name: "Promo M6", code: "m6-promo", channel: "whatsapp" }))).campaignId;
    // tomorrow (review r1 P2: a schedule sampled as "today" can turn into yesterday at Jakarta midnight before the writer checks it)
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(Date.now() + 86_400_000));
    await as(MKT, (db) => scheduleCampaign(db, key(), c, { segmentId: seg, templateId: tpl, scheduledFor: day }));
    expect(await code(as(MKT, (db) => sendCampaign(db, key(), c)))).toBe("ERR_GATE_CLOSED");
    expect(Number((await h.admin.query(`select count(*) c from outbound_messages where source_kind = 'campaign' and source_id = $1`, [c])).rows[0].c)).toBe(0);
  });

  it("12 the per-patient cap under concurrency (PR-94): automation-style enqueue and campaign_send overlap on one patient with one slot left", async () => {
    // isolated (plan r1, Sol 5e49112a P1): its own patient with consent; approved synthetic Q-15 evidence; a wide budget; a fixed day D
    const phone = "6281700006012";
    const pid = (await h.admin.query(`insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation,
         education, marital_status, registered_branch_id, created_by, created_as)
       values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Pasien Batas M6', '1936-02-10', 'female', 'newborn_via_guardian',
         'Fixture sintetis', 'islam', 'Karyawan', 's1', 'kawin', $2, (select id from staff where tenant_id = $1 limit 1), 'fo_cashier') returning id`, [tenantId, b1])).rows[0].id as string;
    await h.admin.query(`insert into contact_points (tenant_id, patient_id, kind, value) values ($1, $2, 'phone', $3)`, [tenantId, pid, `+${phone}`]);
    await as(FO, (db) => grantConsent(db, key(), { patientId: pid, purpose: "marketing_wa", textId: marketingText, channel: "in_person" }));
    await as(OWN, (db) => uploadEvidence(db, { obligationKey: "public_site_counsel", fileName: "pendapat.pdf", content: Buffer.from("%PDF-1.7\nm6\n%%EOF\n"),
      expertName: "Konsultan Hukum Sintetis", documentDate: "2026-10-01" }));
    const item = (await h.admin.query(`select id from evidence_items where tenant_id = $1 and obligation_key = 'public_site_counsel'`, [tenantId])).rows[0].id as string;
    const file = (await h.admin.query(`select id from evidence_files where item_id = $1 order by version desc limit 1`, [item])).rows[0].id as string;
    const until = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(Date.now() + 300 * 86_400_000));
    await as(OWN, (db) => decideEvidence(db, item, file, "approved", undefined, until));
    // one calendar anchor; D = tomorrow, D1 = the day after, both from the same anchor (review r1 P2: no midnight window)
    const anchor = Date.now();
    const wibDate = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(anchor + days * 86_400_000));
    const D = wibDate(1);
    const D1 = wibDate(2);
    const care = (await h.admin.query(`select id from wa_templates where tenant_id = $1 and name = 'pengingat_janji'`, [tenantId])).rows[0].id as string;
    const promo = (await h.admin.query(`select id from wa_templates where tenant_id = $1 and name = 'promo_kampanye'`, [tenantId])).rows[0].id as string;
    // one slot left on D (batas_harian 2): one care message already queued for D
    const care1 = (await h.admin.query(`select public.outbound_enqueue_do($1, $2, 'care_reminder', $3, $4, $5, 'appointment', gen_random_uuid(), $6::date, null, null, now()) id`,
      [tenantId, `k-${key()}`, pid, b1, care, D])).rows[0].id as string;
    const seg = (await as(MKT, (db) => saveSegment(db, key(), { name: "Usia sangat lanjut", rules: { age_min: 89, age_max: 92 } }))).segmentId;
    const c = (await as(MKT, (db) => saveCampaign(db, key(), { name: "Promo Batas M6", code: "m6-batas", channel: "whatsapp" }))).campaignId;
    await as(MKT, (db) => scheduleCampaign(db, key(), c, { segmentId: seg, templateId: promo, scheduledFor: D }));
    // T1: the automation writer's discipline (staff_access, then the patient's cap lock) takes the last slot and holds; campaign_send waits
    const t1 = await owner.connect();
    let t1Open = true;
    let auto = "";
    try {
      await t1.query("begin");
      await t1.query(`select pg_advisory_xact_lock(hashtextextended('staff_access:' || $1::text, 0))`, [tenantId]);
      await t1.query(`select public.automation_cap_lock($1, $2)`, [tenantId, pid]);
      auto = (await t1.query(`select public.outbound_enqueue_do($1, $2, 'promo', $3, $4, $5, 'patient', $3, $6::date, null, null, now()) id`,
        [tenantId, `k-${key()}`, pid, b1, promo, D])).rows[0].id as string;
      const pid1 = (await t1.query(`select pg_backend_pid() p`)).rows[0].p;
      const send = as(MKT, (db) => sendCampaign(db, key(), c));
      let blocked = false;
      for (let i = 0; i < 100 && !blocked; i++) {
        blocked = Number((await h.admin.query(`select count(*) c from pg_stat_activity where wait_event_type = 'Lock' and $1 = any(pg_blocking_pids(pid))`, [pid1])).rows[0].c) > 0;
        if (!blocked) await new Promise((r) => setTimeout(r, 50));
      }
      expect(blocked).toBe(true);
      await t1.query("commit");
      t1Open = false;
      expect(await send).toMatchObject({ queued: 1, skipped: {} });
    } finally {
      if (t1Open) await t1.query("rollback").catch(() => undefined);
      t1.release();
    }
    const camp = (await h.admin.query(`select id, planned_for::text planned from outbound_messages where source_kind = 'campaign' and source_id = $1`, [c])).rows;
    expect(camp).toEqual([{ id: camp[0].id, planned: D1 }]); // the overflow goes to D+1, never three automated rows on D
    // dispatch on D: the care message and the automation promo (2 = the cap); on D+1 the campaign message
    const atD = new Date(`${D}T12:00:00+07:00`); const atD1 = new Date(`${D1}T12:00:00+07:00`);
    const recD = recordingPort();
    await runOutboundDispatch(worker, { port: recD.port, now: atD });
    expect([(await ob(care1)).state, (await ob(auto)).state, (await ob(camp[0].id)).state]).toEqual(["sent", "sent", "queued"]);
    expect(recD.sent.filter((x) => x.to === phone)).toHaveLength(2);
    const sentOnD = Number((await h.admin.query(`select count(*) c from outbound_messages where patient_id = $1 and state in ('sending','sent')
      and purpose in ('care_reminder','aftercare','promo') and (coalesce(sent_at, claimed_at) at time zone 'Asia/Jakarta')::date = $2::date`, [pid, D])).rows[0].c);
    expect(sentOnD).toBe(2); // promos never exceed the cap on the day they go out (care counts, care is never deferred)
    const recD1 = recordingPort();
    await runOutboundDispatch(worker, { port: recD1.port, now: atD1 });
    expect((await ob(camp[0].id)).state).toBe("sent");
    expect(recD1.sent.filter((x) => x.to === phone && x.template === "promo_kampanye")).toHaveLength(1);
  });
});

describe("M6 exit: webhook replay fixtures on the test number", () => {
  it("duplicate, out of order, late and bad signature deliveries", async () => {
    const from = "6281700006090";
    const at = Math.floor(Date.now() / 1000);
    // duplicate: the same inbound delivered twice → one message
    const dup = wamid();
    const body = inboundText(tn(), { id: dup, from, text: "Pesan ganda", at });
    expect((await deliver(body)).status).toBe(200);
    expect((await deliver(body)).status).toBe(200);
    expect(Number((await h.admin.query(`select count(*) c from messages where provider_message_id = $1`, [dup])).rows[0].c)).toBe(1);
    // bad signature: refused 401, claims no event id; the genuine delivery then processes
    const sig = wamid();
    const sb = inboundText(tn(), { id: sig, from, text: "Tanda tangan salah dulu", at: at + 1 });
    expect((await deliver(sb, true)).status).toBe(401);
    expect(await msgOf(sig)).toBeUndefined();
    expect((await deliver(sb)).status).toBe(200);
    expect(await msgOf(sig)).toBeTruthy();
    // out of order: a status for an outbound message that arrives before the message exists → held, applied when it exists
    const c = await conv(from);
    const outId = `wamid.OUT${++seq}`;
    expect((await deliver(statusEvent(tn(), { id: outId, status: "delivered", to: from, at: at + 2 }))).status).toBe(200);
    const port = { ...mockInboxPort(), sendMessage: async () => ({ providerMessageId: outId }) };
    await as(FO, (db) => sendInboxMessage(db, key(), c.id, { kind: "text", body: "Balasan" }, { port }));
    expect((await msgOf(outId)).status).toBe("delivered");
    // late: an inbound older than the last one never moves the window back
    const before = (await conv(from)).last_inbound_at;
    await deliver(inboundText(tn(), { id: wamid(), from, text: "Terlambat", at: at - 3600 }));
    expect((await conv(from)).last_inbound_at).toEqual(before);
  });
});
