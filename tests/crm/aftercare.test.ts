// T-096 Done-when: Scenario PR-70 (02-PRD:695): a treatment with aftercare text → the visit closes → a neutral care message with a protected
// aftercare link is sent even without marketing consent, and the WhatsApp text contains no treatment name; Scenario PR-56: a suspended
// tenant keeps care messages (both halves: enqueue and dispatch, T-094 review P3-2). Plus the plan (r1, review r2): the link token minted at
// claim (only its hash stored, 7 days), the OTP (TD-26: 5 min, 5 attempts → 15-min lock; RATE-1 per phone and per IP, counting sends only),
// the pre- / post-OTP projection, the session, refused enqueues keep the notice, no notice without aftercare, guards, the unbound-only
// definers, column grants (no hash readable), tenants. The Meta port is the mock adapter (DEC-082); `fetch` is spied and never called.
// Synthetic data (MIG-2).
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import type { KekRing } from "../../src/lib/keys/envelope";
import { setKekRingForTests } from "../../src/lib/keys/runtime";
import { publish } from "../../src/modules/catalog/catalog";
import { aftercarePage, hashOf, sendAftercareOtp, verifyAftercareOtp } from "../../src/modules/crm/aftercare/aftercare";
import { RECORDED_TEMPLATES } from "../../src/modules/messaging/inbox/fixtures";
import { syncTemplates } from "../../src/modules/messaging/inbox/inbox";
import { mockInboxPort } from "../../src/modules/messaging/inbox/mock";
import type { RemoteTemplate } from "../../src/modules/messaging/inbox/port";
import { enqueueOutbound, runOutboundDispatch } from "../../src/modules/messaging/outbound/outbound";
import { mockWabaGraphPort } from "../../src/modules/messaging/waba/mock";
import { addWaNumber, completeWabaSignup, startWabaSignup } from "../../src/modules/messaging/waba/waba";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { grantConsent, publishConsentText } from "../../src/modules/patients/consents/consents";
import { changeSetting } from "../../src/modules/settings/settings";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local";
const RING: KekRing = { current: 1, keys: new Map([[1, Buffer.alloc(32, 5)]]) };
// the recorded templates plus this task's two (the shared list is T-090's contract): the neutral notice and the authentication OTP
const TEMPLATES: RemoteTemplate[] = [...RECORDED_TEMPLATES,
  { name: "perawatan_anda", language: "id", category: "utility", status: "approved", body: "Halo {{1}}, panduan perawatan Anda setelah kunjungan di {{2}} tersedia di {{3}}.", paramCount: 3 },
  { name: "kode_otp", language: "id", category: "authentication", status: "approved", body: "{{1}} adalah kode verifikasi Anda.", paramCount: 1 }];

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
  return { tenantId, b1: await br("AC1", "Kemang"), b2: await br("AC2", "Bintaro") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`ac${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf AC ${n}` });
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
async function patient(t: T, name: string, withPhone = true) {
  const id = (await h.admin.query(`insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation,
       education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $2, '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture sintetis',
       'islam', 'Karyawan', 's1', 'kawin', $3, (select id from staff where tenant_id = $1 limit 1), 'fo_cashier') returning id`, [t.tenantId, name, t.b1])).rows[0].id as string;
  const phone = `62858${String(10000000 + ++seq)}`;
  if (withPhone) await h.admin.query(`insert into contact_points (tenant_id, patient_id, kind, value) values ($1, $2, 'phone', $3)`, [t.tenantId, id, `+${phone}`]);
  return { id, phone };
}
// An open visit with counted executions of the given service versions (the treatment fixtures of T-093's tests).
async function visitWith(t: T, pt: string, doc: P, fo: P, versions: string[], outcome = "completed") {
  const v = (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
    [t.tenantId, t.b1, pt, fo.staffId])).rows[0].id as string;
  const exam = await paused(["examinations"], async () => (await h.admin.query(`insert into examinations (tenant_id, branch_id, visit_id, patient_id, author_id)
      values ($1, $2, $3, $4, $5) returning id`, [t.tenantId, t.b1, v, pt, doc.staffId])).rows[0].id as string);
  const plan = await paused(["care_plans"], async () => (await h.admin.query(`insert into care_plans (tenant_id, branch_id, patient_id, title, condition, created_exam_id,
      created_by) values ($1, $2, $3, 'Rencana', 'Kondisi', $4, $5) returning id`, [t.tenantId, t.b1, pt, exam, doc.staffId])).rows[0].id as string);
  let i = 0;
  for (const ver of versions) {
    const pi = await paused(["plan_items"], async () => (await h.admin.query(`insert into plan_items (tenant_id, branch_id, plan_id, examination_id, stage, catalog_version_id, qty)
        values ($1, $2, $3, $4, 1, $5, 1) returning id`, [t.tenantId, t.b1, plan, exam, ver])).rows[0].id as string);
    await paused(["treatment_executions"], () => h.admin.query(`insert into treatment_executions (tenant_id, branch_id, visit_id, plan_item_id, performer_staff_id,
        identity_confirmed, state, started_by, started_as, start_command_key, started_at, finished_at, finished_by, finished_as, finish_command_key, outcome, stop_reason)
        values ($1, $2, $3, $4, $5, true, 'finished', $5, 'doctor', $6, now() - make_interval(mins => $8), now(), $5, 'doctor', $7, $9, $10)`,
      [t.tenantId, t.b1, v, pi, doc.staffId, `k-${key()}`, `k-${key()}`, 60 - 10 * i++, outcome, outcome === "completed" ? null : "Dihentikan klinik"]));
  }
  return v;
}
// Close a visit the way visit_close does (the guard paused: the cashier checks of visit_close are not this task's subject).
const close = (t: T, v: string, by: P) => paused(["visits"], () => h.admin.query(`update visits set closed_at = clock_timestamp(), closed_by = $2 where id = $1`, [v, by.staffId]));
const notice = async (v: string) => (await h.admin.query(`select * from aftercare_notices where visit_id = $1`, [v])).rows[0];
const outOf = async (v: string) => (await h.admin.query(`select * from outbound_messages where source_id = $1 and purpose = 'aftercare'`, [v])).rows[0];
// a port that records the params of every template it sends
function recordingPort() {
  const port = mockInboxPort();
  const sent: { template: string; params: string[]; to: string }[] = [];
  return { sent, port: { ...port, sendMessage: async (i: Parameters<typeof port.sendMessage>[0]) => {
    if (i.kind === "template") sent.push({ template: i.templateName, params: i.params, to: i.to });
    return port.sendMessage(i);
  } } };
}
const tokenOf = (params: string[]) => params[2].replace("/aftercare/", "");
async function connect(t: T, own: P, codeName: string) {
  const g = mockWabaGraphPort();
  const { wabaId } = await as(own, (db) => startWabaSignup(db, key(), { onboardingChannel: "cloud_api" }));
  await as(own, (db) => completeWabaSignup(db, wabaId, codeName as never, { port: g }));
  await as(own, (db) => addWaNumber(db, key(), wabaId, { branchId: t.b1, phoneNumber: `+62812${String(4000000 + ++seq)}`, phoneNumberId: `4${String(Date.now()).slice(-9)}${seq}` }, { port: g }));
  await as(own, (db) => syncTemplates(db, { port: { ...mockInboxPort(), fetchTemplates: async () => TEMPLATES.map((x) => ({ ...x })) } }));
}

const fetchSpy = vi.fn();
let A: T; let B: T;
let OWN: P; let FO: P; let DOC: P; let CS: P; let MKT: P; let FO2: P; let BOWN: P; let BFO: P; let BDOC: P;
let facial: string; let peel: string; let plain: string; let bfacial: string;
let flush = 500;
const drain = () => runOutboundDispatch(worker, { port: mockInboxPort(), now: new Date(Date.now() + (flush += 30) * H) });

beforeAll(async () => {
  setKekRingForTests(RING);
  h = await createHarness();
  const login = h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE]));
  app = await openAppPool({ connectionString: login, max: 6 });
  worker = await openAppPool({ connectionString: login, max: 3 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant("PT Klinik Aftercare Sintetis");
  B = await tenant("PT Klinik Lain Aftercare");
  OWN = await person(A, "owner"); FO = await person(A, "fo_cashier", A.b1); DOC = await person(A, "doctor", A.b1); CS = await person(A, "central_cs");
  MKT = await person(A, "marketing"); FO2 = await person(A, "fo_cashier", A.b2);
  BOWN = await person(B, "owner"); BFO = await person(B, "fo_cashier", B.b1); BDOC = await person(B, "doctor", B.b1);
  const svc = async (p: P, c: string, name: string, aftercare: string) => (await as(p, (db) => publish(db, { kind: "service", code: c }, { name,
    tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 300_000, category: "facial", prep_min: 0, treatment_min: 30, buffer_min: 0,
    indications: "Indikasi", consent_template: "Templat.", delegation: "Dokter", aftercare_text: aftercare, eligibility: [{ role: "doctor", mode: "performs" }] } as never,
    "Layanan baru"))).versionId;
  facial = await svc(OWN, "AC-FG", "Facial Glow", "Hindari sinar matahari langsung selama 3 hari.");
  peel = await svc(OWN, "AC-PL", "Chemical Peel", "Gunakan pelembap dua kali sehari.");
  plain = await svc(OWN, "AC-KS", "Konsultasi Kulit", "");
  bfacial = await svc(BOWN, "AC-BFG", "Facial Rahasia B", "Panduan rahasia B.");
  await connect(A, OWN, "code-verified");
  await connect(B, BOWN, "code-verified-2");
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

describe("T-096 Scenario PR-70 (aftercare)", () => {
  it("a closed visit with aftercare → a neutral notice without marketing consent; the link opens the texts only after the WhatsApp OTP", async () => {
    await drain();
    const pt = await patient(A, "Pasien Aftercare Sintetis");
    const v = await visitWith(A, pt.id, DOC, FO, [facial, peel, plain]);
    await close(A, v, FO);
    // the notice: the two versions with aftercare, in the order the treatments started; queued as care, no marketing consent needed
    const n0 = await notice(v);
    expect(n0.catalog_version_ids).toEqual([facial, peel]);
    expect(n0.token_hash).toBeNull();
    const o = await outOf(v);
    expect(o).toMatchObject({ purpose: "aftercare", category: "utility", state: "queued", source_kind: "visit" });
    expect(n0.outbound_id).toBe(o.id);
    const rec = recordingPort();
    expect(await runOutboundDispatch(worker, { port: rec.port, now: new Date(Date.now() + 60_000) })).toEqual({ sent: 1, failed: 0 });
    // the WhatsApp text: the name, the clinic and branch, the path — no treatment name (PRIV-15)
    expect(rec.sent).toHaveLength(1);
    const [p] = rec.sent;
    expect(p.template).toBe("perawatan_anda");
    expect(p.params[0]).toBe("Pasien Aftercare Sintetis");
    expect(p.params[1]).toBe("Klinik Cantik Sintetis – Kemang");
    expect(p.params[2]).toMatch(/^\/aftercare\/[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(p.params)).not.toMatch(/Facial|Glow|Peel|Konsultasi|matahari|pelembap/);
    const token = tokenOf(p.params);
    // only the hash is stored, 7 days from the claim
    const n1 = await notice(v);
    expect(n1.token_hash).toBe(hashOf(token));
    expect(n1.token_hash).not.toContain(token);
    expect(Math.round((new Date(n1.expires_at).getTime() - new Date((await outOf(v)).claimed_at).getTime()) / H)).toBe(168);
    // before the OTP: neutral metadata only
    const before = await aftercarePage(worker, token, null);
    expect(before).toEqual({ state: "ready", clinic_name: "Klinik Cantik Sintetis", branch_name: "Kemang", accent: "#0A6E86", masked_phone: `•••• ${pt.phone.slice(-4)}` });
    expect(JSON.stringify(before)).not.toMatch(/Pasien|Facial|Peel/);
    // the OTP through the authentication template, to the same number
    const otp = recordingPort();
    expect(await sendAftercareOtp(worker, token, "203.0.113.7", { port: otp.port })).toEqual({ ok: true });
    expect(otp.sent).toEqual([{ template: "kode_otp", params: [expect.stringMatching(/^[0-9]{6}$/)], to: pt.phone }]);
    expect((await aftercarePage(worker, token, null)).state).toBe("otp_sent");
    const verified = await verifyAftercareOtp(worker, token, otp.sent[0].params[0]);
    expect(verified.ok).toBe(true);
    const session = (verified as { sessionToken: string }).sessionToken;
    const after = await aftercarePage(worker, token, session);
    expect(after).toMatchObject({ state: "verified", items: [
      { name: "Facial Glow", aftercare: "Hindari sinar matahari langsung selama 3 hari." },
      { name: "Chemical Peel", aftercare: "Gunakan pelembap dua kali sehari." }] });
    // the stored values are hashes only; another session token does not open the page
    expect((await notice(v)).session_hash).toBe(hashOf(session));
    expect((await aftercarePage(worker, token, "x".repeat(43))).state).toBe("ready");
    // the session lasts 30 minutes
    expect((await aftercarePage(worker, token, session, new Date(Date.now() + 31 * 60_000))).state).toBe("ready");
    expect((await notice(v)).opened_at).not.toBeNull();
  });
});

describe("T-096 OTP rules (TD-26, RATE-1)", () => {
  async function sentLink(name: string) {
    const pt = await patient(A, name);
    const v = await visitWith(A, pt.id, DOC, FO, [facial]);
    await close(A, v, FO);
    const rec = recordingPort();
    await runOutboundDispatch(worker, { port: rec.port, now: new Date(Date.now() + 60_000) });
    return { v, pt, token: tokenOf(rec.sent.find((x) => x.template === "perawatan_anda")!.params) };
  }
  it("five wrong codes lock for 15 minutes; an expired code needs a new one; an expired link refuses", async () => {
    const { token, v } = await sentLink("Pasien OTP Salah");
    const otp = recordingPort();
    await sendAftercareOtp(worker, token, "203.0.113.8", { port: otp.port });
    const good = otp.sent[0].params[0];
    const wrong = good === "000000" ? "111111" : "000000";
    for (let i = 4; i >= 1; i--) expect(await verifyAftercareOtp(worker, token, wrong)).toEqual({ ok: false, reason: "otp_invalid", attempts_remaining: i });
    expect(await verifyAftercareOtp(worker, token, wrong)).toEqual({ ok: false, reason: "otp_locked", attempts_remaining: 0 });
    // locked: even the right code and a new send are refused, the page says so
    expect(await verifyAftercareOtp(worker, token, good)).toEqual({ ok: false, reason: "otp_locked" });
    expect(await sendAftercareOtp(worker, token, "203.0.113.8", { now: new Date(Date.now() + 10 * 60_000), port: otp.port })).toEqual({ ok: false, reason: "otp_locked" });
    expect(await sendAftercareOtp(worker, token, "203.0.113.8", { port: otp.port })).toEqual({ ok: false, reason: "otp_locked" });
    expect((await aftercarePage(worker, token, null)).state).toBe("otp_locked");
    // after 15 minutes: a new code works; a code older than 5 minutes does not
    const later = new Date(Date.now() + 16 * 60_000);
    const o2 = recordingPort();
    expect(await sendAftercareOtp(worker, token, "203.0.113.9", { now: later, port: o2.port })).toEqual({ ok: true });
    expect(await verifyAftercareOtp(worker, token, o2.sent[0].params[0], new Date(later.getTime() + 6 * 60_000))).toEqual({ ok: false, reason: "otp_expired" });
    // the link expires 7 days after the claim
    const n = await notice(v);
    const past = new Date(new Date(n.expires_at).getTime() + 60_000);
    expect(await sendAftercareOtp(worker, token, "203.0.113.9", { now: past })).toEqual({ ok: false, reason: "link_expired" });
    expect((await aftercarePage(worker, token, null, past)).state).toBe("link_expired");
    expect(await aftercarePage(worker, "A".repeat(43), null)).toEqual({ state: "not_found" });
    expect(await aftercarePage(worker, "bukan-token", null)).toEqual({ state: "not_found" });
  });

  it("RATE-1: three sends per 10 minutes per phone, ten per minute per IP; refusals never extend the window", async () => {
    const { token } = await sentLink("Pasien Batas Kirim");
    const t0 = new Date(Date.now() + 20 * 60_000);
    const port = mockInboxPort();
    for (let i = 0; i < 3; i++) expect(await sendAftercareOtp(worker, token, "198.51.100.1", { now: new Date(t0.getTime() + i * 1000), port })).toEqual({ ok: true });
    expect(await sendAftercareOtp(worker, token, "198.51.100.1", { now: new Date(t0.getTime() + 5000), port })).toEqual({ ok: false, reason: "rate_limited" });
    expect(await sendAftercareOtp(worker, token, "198.51.100.1", { now: new Date(t0.getTime() + 6000), port })).toEqual({ ok: false, reason: "rate_limited" });
    // refusals logged but never counted: at 10 min + 1.5 s the sends at +0 and +1 s left the window, the one at +2 s and both refusals are
    // still in it → one send counts, so the next goes out (counting the refusals too would make three and refuse it)
    expect(await sendAftercareOtp(worker, token, "198.51.100.2", { now: new Date(t0.getTime() + 10 * 60_000 + 1500), port })).toEqual({ ok: true });
    const log = (await h.admin.query(`select outcome from aftercare_otp_sends where notice_id = (select id from aftercare_notices where token_hash = $1) order by sent_at`, [hashOf(token)])).rows.map((r) => r.outcome);
    expect(log).toEqual(["sent", "sent", "sent", "rate_limited", "rate_limited", "sent"]);
    // per IP: ten sends a minute across links
    const ip = "198.51.100.77";
    const t1 = new Date(Date.now() + 40 * 60_000);
    const links = [];
    for (let i = 0; i < 4; i++) links.push((await sentLink(`Pasien IP ${i}`)).token);
    let ok = 0;
    for (let i = 0; i < 12; i++) {
      const r = await sendAftercareOtp(worker, links[i % 4], ip, { now: new Date(t1.getTime() + i * 1000), port });
      if (r.ok) ok++;
      else expect(r.reason).toBe("rate_limited");
    }
    expect(ok).toBe(10);
    // an unknown token writes nothing
    const before = (await h.admin.query(`select count(*)::int c from aftercare_otp_sends`)).rows[0].c as number;
    expect(await sendAftercareOtp(worker, "B".repeat(43), ip, { port })).toEqual({ ok: false, reason: "not_found" });
    expect((await h.admin.query(`select count(*)::int c from aftercare_otp_sends`)).rows[0].c).toBe(before);
  });

  it("a resend mints a new token: the old link stops working", async () => {
    const { v, token } = await sentLink("Pasien Kirim Ulang");
    // a resend: the failed-and-requeued path is T-094's; here the outbound row is re-claimed after a failure
    const o = await outOf(v);
    await h.admin.query(`alter table outbound_messages disable trigger outbound_messages_guard`);
    try {
      await h.admin.query(`update outbound_messages set state = 'queued', sent_at = null, provider_message_id = null, decided_at = null, message_id = null where id = $1`, [o.id]);
    } finally {
      await h.admin.query(`alter table outbound_messages enable always trigger outbound_messages_guard`);
    }
    const rec = recordingPort();
    await runOutboundDispatch(worker, { port: rec.port, now: new Date(Date.now() + 2 * 60_000) });
    const token2 = tokenOf(rec.sent[0].params);
    expect(token2).not.toBe(token);
    expect((await aftercarePage(worker, token, null)).state).toBe("not_found");
    expect((await aftercarePage(worker, token2, null)).state).toBe("ready");
  });
});

describe("T-096 visit close edges", () => {
  it("no aftercare text or no counted execution → no notice; a refused enqueue (no phone) keeps the notice without a message", async () => {
    const pt = await patient(A, "Pasien Tanpa Teks");
    const v1 = await visitWith(A, pt.id, DOC, FO, [plain]);
    await close(A, v1, FO);
    expect(await notice(v1)).toBeUndefined();
    const v2 = await visitWith(A, (await patient(A, "Pasien Batal Tindakan")).id, DOC, FO, [facial], "clinic_stop");
    await close(A, v2, FO);
    expect(await notice(v2)).toBeUndefined();
    const noPhone = await patient(A, "Pasien Tanpa Nomor", false);
    const v3 = await visitWith(A, noPhone.id, DOC, FO, [facial]);
    await close(A, v3, FO);
    expect((await notice(v3))).toMatchObject({ outbound_id: null, token_hash: null });
    expect(await outOf(v3)).toBeUndefined();
  });
});

describe("T-096 Scenario PR-56 (a suspended tenant keeps care messages)", () => {
  it("suspended: a promo is refused at enqueue and a queued one deferred, while the aftercare is queued, sent and opens", async () => {
    await drain();
    const pt = await patient(A, "Pasien Klinik Ditangguhkan");
    const text = (await as(OWN, (db) => publishConsentText(db, { purpose: "marketing_wa", body: "Saya setuju menerima promosi klinik." }))).id;
    await as(FO, (db) => grantConsent(db, key(), { patientId: pt.id, purpose: "marketing_wa", textId: text, channel: "in_person" }));
    const promoTpl = (await h.admin.query(`select id from wa_templates where tenant_id = $1 and name = 'promo_bulan_ini'`, [A.tenantId])).rows[0].id as string;
    const queuedPromo = (await as(MKT, (db) => enqueueOutbound(db, key(), { purpose: "promo", patientId: pt.id, templateId: promoTpl, sourceKind: "patient", sourceId: pt.id }))).outboundId;
    const v = await visitWith(A, pt.id, DOC, FO, [facial]);
    await h.admin.query(`update tenants_registry set lifecycle_state = 'suspended' where id = $1`, [A.tenantId]);
    try {
      // (a) enqueue: a new promo is refused, the visit close still queues the aftercare
      expect(await code(as(MKT, (db) => enqueueOutbound(db, key(), { purpose: "promo", patientId: pt.id, templateId: promoTpl, sourceKind: "patient", sourceId: pt.id }))))
        .toBe("ERR_TENANT_SUSPENDED");
      await close(A, v, FO);
      expect((await outOf(v)).state).toBe("queued");
      // (b) dispatch: the queued promo waits (tenant_suspended), the aftercare is sent
      const rec = recordingPort();
      await runOutboundDispatch(worker, { port: rec.port, now: new Date(Date.now() + 60_000) });
      expect(rec.sent.map((x) => x.template)).toEqual(["perawatan_anda"]);
      expect((await h.admin.query(`select state, deferred_reason from outbound_messages where id = $1`, [queuedPromo])).rows[0])
        .toEqual({ state: "queued", deferred_reason: "tenant_suspended" });
      // the patient still verifies and reads the page
      const token = tokenOf(rec.sent[0].params);
      const otp = recordingPort();
      expect(await sendAftercareOtp(worker, token, "192.0.2.10", { port: otp.port })).toEqual({ ok: true });
      const s = await verifyAftercareOtp(worker, token, otp.sent[0].params[0]);
      expect(s.ok).toBe(true);
      expect((await aftercarePage(worker, token, (s as { sessionToken: string }).sessionToken)).state).toBe("verified");
    } finally {
      await h.admin.query(`update tenants_registry set lifecycle_state = 'live' where id = $1`, [A.tenantId]);
    }
  });
});

describe("T-096 guards, definers, grants and tenants", () => {
  it("the definers refuse a bound connection; hashes are not readable; the notice and the log are guarded; tenants stay apart", async () => {
    for (const q of [`select aftercare_link_lookup('x', null, null)`, `select aftercare_otp_send('x', repeat('a', 64), repeat('a', 64), null)`,
      `select aftercare_otp_verify('x', repeat('a', 64), repeat('a', 64), null)`])
      expect(await as(FO, (db) => db.query(q)).then(() => "ok", (e) => `raw:${e.code}`), q).toBe("raw:42501");
    expect(await worker.query(`select aftercare_otp_send('x', 'not-a-hash', repeat('a', 64), null)`).then(() => "ok", (e) => `raw:${e.code}`)).toBe("raw:22023");
    // B's link: A's staff never read B's notice; B's token resolves to B's clinic only
    const bp = await patient(B, "Pasien B Aftercare");
    const bv = await visitWith(B, bp.id, BDOC, BFO, [bfacial]);
    await close(B, bv, BFO);
    const rec = recordingPort();
    await runOutboundDispatch(worker, { port: rec.port, now: new Date(Date.now() + 60_000) });
    const bt = tokenOf(rec.sent.find((x) => x.to === bp.phone)!.params);
    expect((await aftercarePage(worker, bt, null))).toMatchObject({ clinic_name: "PT Klinik Lain Aftercare" });
    const bn = await notice(bv);
    for (const p of [OWN, CS, FO]) expect((await as(p, (db) => db.query(`select id from aftercare_notices where id = $1`, [bn.id]))).rowCount, p.role).toBe(0);
    // A's own notice: readable by FO at Kemang, not by the Bintaro FO, marketing or the doctor; the hashes are never granted
    const an = (await h.admin.query(`select id from aftercare_notices where tenant_id = $1 limit 1`, [A.tenantId])).rows[0].id as string;
    expect((await as(FO, (db) => db.query(`select id, opened_at from aftercare_notices where id = $1`, [an]))).rowCount).toBe(1);
    for (const p of [FO2, MKT, DOC]) expect((await as(p, (db) => db.query(`select id from aftercare_notices where id = $1`, [an]))).rowCount, p.role).toBe(0);
    for (const col of ["token_hash", "otp_hash", "session_hash"])
      expect(await as(OWN, (db) => db.query(`select ${col} from aftercare_notices limit 1`)).then(() => "ok", (e) => `raw:${e.code}`), col).toBe("raw:42501");
    expect(await as(OWN, (db) => db.query(`select id from aftercare_otp_sends limit 1`)).then(() => "ok", (e) => `raw:${e.code}`)).toBe("raw:42501");
    // guards
    expect(await raw(`delete from aftercare_notices where id = $1`, [an])).toBe("raw:42501");
    expect(await raw(`update aftercare_notices set catalog_version_ids = '{}' where id = $1`, [an])).not.toBe("ok");
    expect(await raw(`update aftercare_notices set visit_id = $2 where id = $1`, [an, bv])).not.toBe("ok");
    expect(await raw(`truncate aftercare_notices cascade`)).toBe("raw:42501");
    expect(await raw(`delete from aftercare_otp_sends`)).toBe("raw:42501");
    expect(await raw(`update aftercare_otp_sends set outcome = 'sent'`)).toBe("raw:42501");
  });
});
