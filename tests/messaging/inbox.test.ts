// T-090 Done-when: scenario PR-28 (a conversation whose last patient message was 25 h ago → free-form refused, only approved templates) and
// the webhook replay fixtures (duplicate, late, out of order, bad signature) against the mock Meta adapter and recorded webhook shapes
// (DEC-082: no live Meta call; `fetch` spied and never called). Plus: unknown phone_number_id dropped, routing to branch, SET-42 rotation,
// a Coexistence echo, marketing consent, roles and branch scope, tenants, no plaintext body in any column, guards. Synthetic data (MIG-2).
import { createHash } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import type { KekRing } from "../../src/lib/keys/envelope";
import { setKekRingForTests } from "../../src/lib/keys/runtime";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { changeSetting } from "../../src/modules/settings/settings";
import { grantConsent, publishConsentText } from "../../src/modules/patients/consents/consents";
import { mergePatients } from "../../src/modules/patients/merge/merge";
import { mockWabaGraphPort } from "../../src/modules/messaging/waba/mock";
import { addWaNumber, completeWabaSignup, revokeWaba, startWabaSignup } from "../../src/modules/messaging/waba/waba";
import { echoText, inboundImage, inboundText, statusEvent } from "../../src/modules/messaging/inbox/fixtures";
import { mockInboxPort, mockMetaAppSecret, signMeta } from "../../src/modules/messaging/inbox/mock";
import {
  inboxList, inboxThread, receiveMetaWebhook, saveTemplate, sendInboxMessage, syncTemplates, templateList, updateConversation,
} from "../../src/modules/messaging/inbox/inbox";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local";
const RING: KekRing = { current: 1, keys: new Map([[1, Buffer.alloc(32, 8)]]) };

let h: Harness;
let app: pg.Pool;
let worker: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "auditor", "purchasing", "marketing", "central_cs"];

async function tenant(name: string): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, name]);
  const br = async (c: string, nm: string) =>
    (await h.admin.query(`insert into branches (tenant_id, code, name, timezone, address) values ($1, $2, $3, 'Asia/Jakarta', 'Jl. Uji') returning id`, [tenantId, c, nm])).rows[0].id as string;
  return { tenantId, b1: await br("PS1", "Kemang"), b2: await br("PS2", "Bintaro") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`inbox${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Pesan ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const why = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason ?? ""}` : `raw:${e.code ?? e.message}`));
const key = () => crypto.randomUUID();
const raw = (sql: string, args: unknown[] = []) => h.admin.query(sql, args).then(() => "ok", (e) => `raw:${e.code}`);
let seq = 0;
const wamid = () => `wamid.TEST${String(++seq).padStart(8, "0")}${Math.floor(Math.random() * 1e6)}`;
const nowSec = () => Math.floor(Date.now() / 1000);
// Deliver a recorded webhook signed with the mock app secret (or a bad one).
async function deliver(body: unknown, bad = false) {
  const raw = JSON.stringify(body);
  const sig = bad ? signMeta(Buffer.alloc(32, 1), raw) : signMeta(mockMetaAppSecret()!, raw);
  return receiveMetaWebhook(worker, raw, sig);
}
type Wa = { wabaId: string; metaWabaId: string; pnBranch: string; pnBrand: string };
// A connected, verified WABA with a Kemang number and a brand-wide number; templates synced.
async function connectedWaba(t: T, own: P, codeName: string): Promise<Wa> {
  const g = mockWabaGraphPort();
  const { wabaId } = await as(own, (db) => startWabaSignup(db, key(), { onboardingChannel: "cloud_api" }));
  await as(own, (db) => completeWabaSignup(db, wabaId, codeName, { port: g }));
  const pnBranch = `6${String(Date.now()).slice(-9)}${++seq}`;
  const pnBrand = `7${String(Date.now()).slice(-9)}${++seq}`;
  await as(own, (db) => addWaNumber(db, key(), wabaId, { branchId: t.b1, phoneNumber: `+62812${String(1000000 + seq)}`, phoneNumberId: pnBranch }, { port: g }));
  await as(own, (db) => addWaNumber(db, key(), wabaId, { branchId: null, phoneNumber: `+62813${String(1000000 + seq)}`, phoneNumberId: pnBrand }, { port: g }));
  const metaWabaId = (await h.admin.query(`select meta_waba_id from waba_accounts where id = $1`, [wabaId])).rows[0].meta_waba_id as string;
  await as(own, (db) => syncTemplates(db));
  return { wabaId, metaWabaId, pnBranch, pnBrand };
}
const convOf = async (tenantId: string, waId: string) =>
  (await h.admin.query(`select * from conversations where tenant_id = $1 and contact_wa_id = $2`, [tenantId, waId])).rows[0];
const tplId = async (tenantId: string, name: string) =>
  (await h.admin.query(`select id from wa_templates where tenant_id = $1 and name = $2`, [tenantId, name])).rows[0].id as string;

const fetchSpy = vi.fn();
let A: T; let B: T;
let OWN: P; let ADM: P; let CS: P; let MGR: P; let FO: P; let FO2: P; let BC: P; let MKT: P; let AU: P; let FIN: P; let DOC: P; let BOWN: P;
let WA: Wa; let WB: Wa;

beforeAll(async () => {
  setKekRingForTests(RING);
  h = await createHarness();
  const login = h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE]));
  app = await openAppPool({ connectionString: login, max: 6 });
  worker = await openAppPool({ connectionString: login, max: 3 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant("PT Klinik Pesan Sintetis");
  B = await tenant("PT Klinik Lain Sintetis");
  OWN = await person(A, "owner"); ADM = await person(A, "admin_pusat"); CS = await person(A, "central_cs"); MKT = await person(A, "marketing");
  AU = await person(A, "auditor"); FIN = await person(A, "finance"); MGR = await person(A, "manager", A.b1); FO = await person(A, "fo_cashier", A.b1);
  FO2 = await person(A, "fo_cashier", A.b2); BC = await person(A, "bc", A.b1); DOC = await person(A, "doctor", A.b1); BOWN = await person(B, "owner");
  WA = await connectedWaba(A, OWN, "code-verified");
  WB = await connectedWaba(B, BOWN, "code-verified-2");
});
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

describe("T-090 webhook intake (TD-22) and the replay fixtures", () => {
  it("an inbound message creates one conversation at the number's branch, sealed; a duplicate delivery adds nothing", async () => {
    const from = "6281200000001";
    const evId = wamid();
    const ev = inboundText({ wabaId: WA.metaWabaId, phoneNumberId: WA.pnBranch }, { id: evId, from, name: "Rina Sintetis", text: "Halo, mau tanya jadwal", at: nowSec() });
    expect(await deliver(ev)).toEqual({ status: 200, outcomes: ["processed"] });
    expect(await deliver(ev)).toEqual({ status: 200, outcomes: ["duplicate"] });
    const c = await convOf(A.tenantId, from);
    expect(c).toMatchObject({ branch_id: A.b1, state: "open", assignee_staff_id: null });
    expect(new Date(c.window_expires_at).getTime() - new Date(c.last_inbound_at).getTime()).toBe(24 * 3600 * 1000);
    expect((await h.admin.query(`select count(*)::int c from messages where conversation_id = $1`, [c.id])).rows[0].c).toBe(1);
    // nothing in plaintext anywhere (W-10)
    const dump = JSON.stringify((await h.admin.query(`select m.*, c.contact_name_enc, r.raw_payload_enc from messages m join conversations c on c.id = m.conversation_id
      join meta_webhook_receipts r on r.tenant_id = c.tenant_id and r.provider_event_id = m.provider_message_id where c.id = $1`, [c.id])).rows);
    expect(dump).not.toMatch(/Halo, mau tanya|Rina Sintetis/);
    expect((await h.admin.query(`select state from meta_webhook_receipts where provider_event_id = $1 order by received_at`, [evId])).rows.map((r) => r.state))
      .toEqual(["processed", "duplicate"]);
    // the inbox role reads it opened
    const t = await as(FO, (db) => inboxThread(db, c.id));
    expect(t.messages.map((m) => m.body)).toEqual(["Halo, mau tanya jadwal"]);
    expect(t.conversation.contact_name).toBe("Rina Sintetis");
    expect(t.conversation.window_open).toBe(true);
  });

  it("a bad signature is refused (401) and claims no event id; the real delivery then processes", async () => {
    const from = "6281200000002";
    const evId = wamid();
    const ev = inboundText({ wabaId: WA.metaWabaId, phoneNumberId: WA.pnBranch }, { id: evId, from, text: "Rahasia", at: nowSec() });
    expect(await deliver(ev, true)).toEqual({ status: 401, outcomes: ["rejected_signature"] });
    const rej = (await h.admin.query(`select tenant_id, raw_payload_enc, state, signature_ok from meta_webhook_receipts where provider_event_id = $1`, [evId])).rows;
    expect(rej).toEqual([{ tenant_id: null, raw_payload_enc: null, state: "rejected_signature", signature_ok: false }]);
    expect(await convOf(A.tenantId, from)).toBeUndefined();
    expect(await deliver(ev)).toEqual({ status: 200, outcomes: ["processed"] });
    // a body that is not a WABA webhook: 401 unsigned, 400 signed
    expect((await receiveMetaWebhook(worker, "{}", "sha256=" + "0".repeat(64))).status).toBe(401);
    expect((await receiveMetaWebhook(worker, "{}", signMeta(mockMetaAppSecret()!, "{}"))).status).toBe(400);
    const empty = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    const before = (await h.admin.query(`select count(*)::int c from meta_webhook_receipts where state = 'rejected_signature'`)).rows[0].c as number;
    expect((await receiveMetaWebhook(worker, empty, "sha256=" + "0".repeat(64))).status).toBe(401);
    expect((await h.admin.query(`select count(*)::int c from meta_webhook_receipts where state = 'rejected_signature'`)).rows[0].c).toBe(before + 1);
    expect((await receiveMetaWebhook(worker, empty, signMeta(mockMetaAppSecret()!, empty))).status).toBe(400);
  });

  it("the intake definers refuse a bound (staff) connection; without the mock secret (production) the webhook is 404 and the port refuses", async () => {
    for (const q of [`select meta_webhook_ingest('{}'::jsonb)`, `select meta_webhook_drop('{}'::jsonb)`, `select * from inbox_webhook_keys($1)`]) {
      expect(await code(as(FO, (db) => db.query(q, q.includes("$1") ? [A.tenantId] : [])))).toBe("raw:42501");
    }
    // an event without a kind is invalid input on the unbound path (never treated as a message or a status)
    const c0 = await worker.connect();
    try {
      expect(await c0.query(`select meta_webhook_ingest('{"provider_event_id":"x","phone_number_id":"${WA.pnBranch}","body_sha256":"${"0".repeat(64)}"}'::jsonb)`)
        .then(() => "ok", (e) => `raw:${e.code}`)).toBe("raw:22023");
    } finally {
      c0.release();
    }
    process.env.DEPLOY_ENV = "production";
    try {
      const raw = JSON.stringify(inboundText({ wabaId: WA.metaWabaId, phoneNumberId: WA.pnBranch }, { id: wamid(), from: "6281200000099", text: "x", at: nowSec() }));
      expect(await receiveMetaWebhook(worker, raw, "sha256=" + "0".repeat(64))).toEqual({ status: 404, outcomes: ["unavailable"] });
      await expect(mockInboxPort().fetchTemplates({ metaWabaId: "1", accessToken: "x" })).rejects.toThrow();
    } finally {
      process.env.DEPLOY_ENV = "local";
    }
    expect(await convOf(A.tenantId, "6281200000099")).toBeUndefined();
  });

  it("an unknown phone number id is dropped with metadata only", async () => {
    const ev = inboundText({ wabaId: "1", phoneNumberId: "999999999" }, { id: wamid(), from: "6281200000003", text: "Siapa ini", at: nowSec() });
    expect(await deliver(ev)).toEqual({ status: 200, outcomes: ["dropped_unknown_route"] });
    const r = (await h.admin.query(`select tenant_id, raw_payload_enc, error_code from meta_webhook_receipts where phone_number_id = '999999999'`)).rows;
    expect(r).toEqual([{ tenant_id: null, raw_payload_enc: null, error_code: "unknown_route" }]);
    expect((await h.admin.query(`select count(*)::int c from vendor_actions where action = 'meta_webhook_drop' and reason_code = 'dropped_unknown_route'`)).rows[0].c).toBeGreaterThan(0);
  });

  it("statuses advance only; one that arrives before its message is held and applied; a late inbound never moves the window back", async () => {
    const from = "6281200000004";
    const m = { wabaId: WA.metaWabaId, phoneNumberId: WA.pnBranch };
    const t0 = nowSec() - 600;
    await deliver(inboundText(m, { id: wamid(), from, text: "Pagi", at: t0 + 300 }));
    const c = await convOf(A.tenantId, from);
    // an outbound send through the mock port
    const port = mockInboxPort();
    const fixedId = "wamid.FIXEDOUT" + String(Date.now());
    const sendPort = { ...port, sendMessage: async () => ({ providerMessageId: fixedId }) };
    // the read status arrives BEFORE the message is recorded: held
    expect(await deliver(statusEvent(m, { id: fixedId, status: "read", to: from, at: t0 + 400 }))).toEqual({ status: 200, outcomes: ["held"] });
    const sent = await as(FO, (db) => sendInboxMessage(db, key(), c.id, { kind: "text", body: "Selamat pagi, ada yang bisa kami bantu?" }, { port: sendPort }));
    expect(sent.status).toBe("sent");
    const msg = (await h.admin.query(`select status, read_at, delivered_at from messages where provider_message_id = $1`, [fixedId])).rows[0];
    expect(msg.status).toBe("read");
    expect(msg.delivered_at).toBeNull(); // only a delivered status stamps delivered_at (review r1 P2-2)
    // delivered after read: stays read, delivered_at backfilled; failed after read: ignored
    expect(await deliver(statusEvent(m, { id: fixedId, status: "delivered", to: from, at: t0 + 350 }))).toEqual({ status: 200, outcomes: ["processed"] });
    expect(await deliver(statusEvent(m, { id: fixedId, status: "failed", to: from, at: t0 + 450 }))).toEqual({ status: 200, outcomes: ["processed"] });
    const after = (await h.admin.query(`select status, delivered_at is not null d, failed_at from messages where provider_message_id = $1`, [fixedId])).rows[0];
    expect(after).toEqual({ status: "read", d: true, failed_at: null });
    // a late inbound (older than the last) is stored; the window stays
    const before = (await convOf(A.tenantId, from)).window_expires_at.getTime();
    await deliver(inboundText(m, { id: wamid(), from, text: "Pesan lama", at: t0 }));
    expect((await convOf(A.tenantId, from)).window_expires_at.getTime()).toBe(before);
    expect((await h.admin.query(`select count(*)::int c from messages where conversation_id = $1 and direction = 'in'`, [c.id])).rows[0].c).toBe(2);
    expect((await convOf(A.tenantId, from)).first_response_at).not.toBeNull();
  });

  it("a status for another tenant's message is dropped, never held or applied", async () => {
    const from = "6281200000005";
    await deliver(inboundText({ wabaId: WB.metaWabaId, phoneNumberId: WB.pnBranch }, { id: wamid(), from, text: "Halo B", at: nowSec() }));
    const bc = await convOf(B.tenantId, from);
    const bFixed = "wamid.BOUT" + String(Date.now());
    const bfo = await person(B, "fo_cashier", B.b1);
    await as(bfo, (db) => sendInboxMessage(db, key(), bc.id, { kind: "text", body: "Balasan B" }, { port: { ...mockInboxPort(), sendMessage: async () => ({ providerMessageId: bFixed }) } }));
    // tenant A's number reports a status for B's message
    expect(await deliver(statusEvent({ wabaId: WA.metaWabaId, phoneNumberId: WA.pnBranch }, { id: bFixed, status: "read", to: from, at: nowSec() })))
      .toEqual({ status: 200, outcomes: ["dropped"] });
    expect((await h.admin.query(`select status from messages where provider_message_id = $1`, [bFixed])).rows[0].status).toBe("sent");
    // B's own number delivers "delivered"; A's number then reports the same delivered: dropped, not a duplicate of B's receipt
    expect(await deliver(statusEvent({ wabaId: WB.metaWabaId, phoneNumberId: WB.pnBranch }, { id: bFixed, status: "delivered", to: from, at: nowSec() }))).toEqual({ status: 200, outcomes: ["processed"] });
    expect(await deliver(statusEvent({ wabaId: WA.metaWabaId, phoneNumberId: WA.pnBranch }, { id: bFixed, status: "delivered", to: from, at: nowSec() }))).toEqual({ status: 200, outcomes: ["dropped"] });
    // an inbound message to A carrying B's provider message id: dropped, no row in A
    expect(await deliver(inboundText({ wabaId: WA.metaWabaId, phoneNumberId: WA.pnBranch }, { id: bFixed, from: "6281200000007", text: "x", at: nowSec() }))).toEqual({ status: 200, outcomes: ["dropped"] });
    expect(await convOf(A.tenantId, "6281200000007")).toBeUndefined();
    // a status B holds (its message not yet recorded) reported again by A's number: dropped, never a second held receipt (no raw error)
    const bHeldId = "wamid.BHELD" + String(Date.now());
    expect(await deliver(statusEvent({ wabaId: WB.metaWabaId, phoneNumberId: WB.pnBranch }, { id: bHeldId, status: "sent", to: from, at: nowSec() }))).toEqual({ status: 200, outcomes: ["held"] });
    expect(await deliver(statusEvent({ wabaId: WA.metaWabaId, phoneNumberId: WA.pnBranch }, { id: bHeldId, status: "sent", to: from, at: nowSec() }))).toEqual({ status: 200, outcomes: ["dropped"] });
    // each cross-tenant event (the read, the delivered, the message, the held status) audited once in A's chain
    expect((await h.admin.query(`select count(*)::int c from audit_events where tenant_id = $1 and reason_code = 'tenant_mismatch'`, [A.tenantId])).rows[0].c).toBe(4);
  });

  it("a media message keeps Meta's id (never a URL) and its sealed caption; a Coexistence echo is an outbound response", async () => {
    const from = "6281200000006";
    const m = { wabaId: WA.metaWabaId, phoneNumberId: WA.pnBranch };
    await deliver(inboundImage(m, { id: wamid(), from, mediaId: "1234567890", caption: "Foto kulit", at: nowSec() - 60 }));
    const c = await convOf(A.tenantId, from);
    const media = (await h.admin.query(`select kind, media_meta_id, media_mime_type, body_enc is not null sealed from messages where conversation_id = $1`, [c.id])).rows[0];
    expect(media).toEqual({ kind: "media", media_meta_id: "1234567890", media_mime_type: "image/jpeg", sealed: true });
    expect(await raw(`update messages set media_meta_id = 'https://lookaside.fbsbx.com/x' where conversation_id = $1`, [c.id])).toBe("raw:42501");
    await deliver(echoText(m, { id: wamid(), to: from, text: "Dibalas dari aplikasi", at: nowSec() }));
    const after = await convOf(A.tenantId, from);
    expect(after.first_response_at).not.toBeNull();
    expect(after.window_expires_at.getTime()).toBe(c.window_expires_at.getTime());
    expect((await h.admin.query(`select direction, sent_via from messages where conversation_id = $1 order by created_at`, [c.id])).rows)
      .toEqual([{ direction: "in", sent_via: "cloud_api" }, { direction: "out", sent_via: "business_app" }]);
  });
});

describe("T-090 scenario PR-28 (the 24 h window)", () => {
  it("25 h after the last patient message: free-form refused, only approved templates; marketing needs consent", async () => {
    const from = "6281200000010";
    const m = { wabaId: WA.metaWabaId, phoneNumberId: WA.pnBranch };
    await deliver(inboundText(m, { id: wamid(), from, text: "Kemarin", at: nowSec() - 25 * 3600 }));
    const c = await convOf(A.tenantId, from);
    const port = mockInboxPort();
    expect(await why(as(FO, (db) => sendInboxMessage(db, key(), c.id, { kind: "text", body: "Halo lagi" }, { port })))).toBe("ERR_VERSION_CONFLICT:window_closed");
    expect(await why(as(FO, (db) => sendInboxMessage(db, key(), c.id, { kind: "template", templateId: "00000000-0000-7000-8000-000000000000", params: [] }, { port }))))
      .toBe("ERR_NOT_FOUND:template not found");
    expect(await why(as(FO, async (db) => sendInboxMessage(db, key(), c.id, { kind: "template", templateId: await tplId(A.tenantId, "sapaan_baru"), params: [] }, { port }))))
      .toBe("ERR_VERSION_CONFLICT:template_not_approved");
    const ok = await as(FO, async (db) => sendInboxMessage(db, key(), c.id, { kind: "template", templateId: await tplId(A.tenantId, "pengingat_janji"), params: ["Rina", "Senin"] }, { port }));
    expect(ok.status).toBe("sent");
    expect(port.sent).toEqual([{ kind: "template", to: from }]);
    expect((await h.admin.query(`select template_category from messages where id = $1`, [ok.messageId])).rows[0].template_category).toBe("utility");
    // the thread says why the composer is limited
    const t = await as(FO, (db) => inboxThread(db, c.id));
    expect(t.conversation.window_open).toBe(false);
    expect(t.templates.map((x) => x.name).sort()).toEqual(["konfirmasi_booking", "pengingat_janji", "promo_bulan_ini"]);
    // a marketing template to a matched patient without marketing consent is refused (17:174)
    const pid = (await h.admin.query(`insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation,
         education, marital_status, registered_branch_id, created_by, created_as)
       values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Pasien Pesan', '1990-01-01', 'female', 'nik', 'v1.1.aa.bb.cc', $3,
         'islam', 'Karyawan', 's1', 'kawin', $2, $4, 'fo_cashier') returning id`,
      [A.tenantId, A.b1, createHash("sha256").update(from).digest("base64url").slice(0, 43), FO.staffId])).rows[0].id as string;
    await as(FO, (db) => updateConversation(db, c.id, { action: "match", patientId: pid }));
    expect(await why(as(FO, async (db) => sendInboxMessage(db, key(), c.id, { kind: "template", templateId: await tplId(A.tenantId, "promo_bulan_ini"), params: ["Kemang"] }, { port }))))
      .toBe("ERR_VERSION_CONFLICT:marketing_consent_required");
    // with an active marketing_wa consent on the patient cluster, the marketing template goes out (review r1 P2-3)
    const textId = (await as(OWN, (db) => publishConsentText(db, { purpose: "marketing_wa", body: "Saya setuju menerima promosi via WhatsApp." }))).id;
    expect(await as(FO, (db) => grantConsent(db, key(), { patientId: pid, purpose: "marketing_wa", textId, channel: "in_person" }))).toMatchObject({ ok: true });
    const promo = await as(FO, async (db) => sendInboxMessage(db, key(), c.id, { kind: "template", templateId: await tplId(A.tenantId, "promo_bulan_ini"), params: ["Kemang"] }, { port }));
    expect(promo.status).toBe("sent");
    expect((await h.admin.query(`select template_category from messages where id = $1`, [promo.messageId])).rows[0].template_category).toBe("marketing");
    expect((await as(FO, (db) => inboxThread(db, c.id))).patient?.marketing_consent).toBe(true);
    // inside the window free-form goes; a replay returns the same message, no second port call
    await deliver(inboundText(m, { id: wamid(), from, text: "Masih buka?", at: nowSec() }));
    const k = key();
    const first = await as(FO, (db) => sendInboxMessage(db, k, c.id, { kind: "text", body: "Masih, sampai jam 20.00" }, { port }));
    const again = await as(FO, (db) => sendInboxMessage(db, k, c.id, { kind: "text", body: "Masih, sampai jam 20.00" }, { port }));
    expect(again).toMatchObject({ messageId: first.messageId, replayed: true });
    expect(port.sent).toHaveLength(3);
  });
});

describe("T-090 patient matching (P2-3, DEC-061)", () => {
  it("an inbound number matches its one canonical patient; after a merge the thread resolves the survivor's cluster", async () => {
    const mkPatient = async (name: string) => (await h.admin.query(`insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx,
         religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
       values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $2, '1990-01-01', 'female', 'nik', 'v1.1.aa.bb.cc', $3, 'islam', 'Karyawan', 's1',
         'kawin', $4, $5, 'fo_cashier') returning id`, [A.tenantId, name, createHash("sha256").update(name + Math.random()).digest("base64url").slice(0, 43), A.b1, FO.staffId])).rows[0].id as string;
    const dup = await mkPatient("Duplikat Sintetis");
    const survivor = await mkPatient("Penyintas Sintetis");
    await h.admin.query(`insert into contact_points (tenant_id, patient_id, kind, value) values ($1, $2, 'phone', '+6281200000040')`, [A.tenantId, dup]);
    const ro = await person(A, "records_officer", A.b1);
    await as(ro, (db) => mergePatients(db, key(), survivor, dup, "Pasien ganda"));
    await deliver(inboundText({ wabaId: WA.metaWabaId, phoneNumberId: WA.pnBranch }, { id: wamid(), from: "6281200000040", text: "Halo", at: nowSec() }));
    expect((await convOf(A.tenantId, "6281200000040")).patient_id).toBe(survivor);
    expect((await as(FO, async (db) => inboxThread(db, (await convOf(A.tenantId, "6281200000040")).id))).patient?.id).toBe(survivor);
  });
});

describe("T-090 assignment, routing and roles", () => {
  it("SET-42 bergilir assigns the branch's least recently assigned fo_cashier/bc; a brand-wide conversation is routed then assigned", async () => {
    // a tenant of its own (SET-42 stays manual for the other tests)
    const t = await tenant("PT Klinik Giliran Sintetis");
    const o = await person(t, "owner");
    const fo = await person(t, "fo_cashier", t.b1); const bc = await person(t, "bc", t.b1); const fo2 = await person(t, "fo_cashier", t.b2);
    const w = await connectedWaba(t, o, "code-unverified");
    await as(o, (db) => changeSetting(db, { key: "SET-42", branchId: null, value: "bergilir", reason: "Giliran" }));
    const m = { wabaId: w.metaWabaId, phoneNumberId: w.pnBranch };
    await deliver(inboundText(m, { id: wamid(), from: "6281200000020", text: "A", at: nowSec() }));
    await deliver(inboundText(m, { id: wamid(), from: "6281200000021", text: "B", at: nowSec() }));
    const a1 = (await convOf(t.tenantId, "6281200000020")).assignee_staff_id;
    const a2 = (await convOf(t.tenantId, "6281200000021")).assignee_staff_id;
    expect([fo.staffId, bc.staffId]).toContain(a1);
    expect([fo.staffId, bc.staffId]).toContain(a2);
    expect(a1).not.toBe(a2);
    // brand-wide: unrouted, visible to every branch inbox role; routed by FO2 to Bintaro → assigned to FO2 (the only Bintaro inbox staff)
    await deliver(inboundText({ wabaId: w.metaWabaId, phoneNumberId: w.pnBrand }, { id: wamid(), from: "6281200000022", text: "C", at: nowSec() }));
    const bw = await convOf(t.tenantId, "6281200000022");
    expect(bw).toMatchObject({ branch_id: null, assignee_staff_id: null });
    expect((await as(fo2, (db) => inboxList(db))).conversations.map((x) => x.id)).toContain(bw.id);
    expect(await why(as(fo2, (db) => updateConversation(db, bw.id, { action: "route", branchId: t.b1 })))).toBe("ERR_NOT_FOUND:branch not found");
    expect(await as(fo2, (db) => updateConversation(db, bw.id, { action: "route", branchId: t.b2 }))).toMatchObject({ branch_id: t.b2, assignee_staff_id: fo2.staffId });
    // now Kemang staff no longer see it; the owner reads but cannot write
    expect((await as(fo, (db) => inboxList(db))).conversations.map((x) => x.id)).not.toContain(bw.id);
    expect(await code(as(fo, (db) => inboxThread(db, bw.id)))).toBe("ERR_NOT_FOUND");
    expect((await as(o, (db) => inboxList(db))).can_write).toBe(false);
    expect(await code(as(o, (db) => updateConversation(db, bw.id, { action: "close" })))).toBe("ERR_FORBIDDEN");
  });

  it("only inbox roles read threads; templates for the configuration roles; another tenant sees nothing", async () => {
    const c = await convOf(A.tenantId, "6281200000001");
    for (const p of [ADM, MKT, AU, FIN, DOC]) {
      expect(await code(as(p, (db) => inboxList(db))), p.role).toBe("ERR_FORBIDDEN");
      expect(await code(as(p, (db) => inboxThread(db, c.id))), p.role).toBe("ERR_FORBIDDEN");
      expect((await as(p, (db) => db.query(`select id from conversations`))).rows, p.role).toHaveLength(0);
    }
    for (const p of [CS, MGR, FO, BC, OWN]) expect((await as(p, (db) => inboxList(db))).conversations.map((x) => x.id), p.role).toContain(c.id);
    expect((await as(FO2, (db) => inboxList(db))).conversations.map((x) => x.id)).not.toContain(c.id);
    // sealed columns are never granted
    expect(await code(as(FO, (db) => db.query(`select body_enc from messages`)))).toBe("raw:42501");
    expect(await code(as(FO, (db) => db.query(`select contact_name_enc from conversations`)))).toBe("raw:42501");
    expect(await code(as(OWN, (db) => db.query(`select * from meta_webhook_receipts`)))).toBe("raw:42501");
    // templates
    expect((await as(MKT, (db) => templateList(db))).can_manage).toBe(true);
    expect((await as(FO, (db) => templateList(db))).can_manage).toBe(false);
    expect(await code(as(FO, (db) => saveTemplate(db, key(), { name: "coba", category: "utility", body: "Halo" })))).toBe("ERR_FORBIDDEN");
    expect(await why(as(MKT, (db) => saveTemplate(db, key(), { name: "hasil_klinis", category: "utility", body: "Hasil diagnosis Anda siap" })))).toBe("ERR_INVALID_INPUT:clinical_content");
    expect(await code(as(MKT, (db) => saveTemplate(db, key(), { name: "salam_pagi", category: "utility", body: "Selamat pagi dari klinik" })))).toBe("ok");
    expect(await code(as(DOC, (db) => templateList(db)))).toBe("ERR_FORBIDDEN");
    // tenant B
    expect((await as(BOWN, (db) => inboxList(db))).conversations.map((x) => x.id)).not.toContain(c.id);
    expect(await code(as(BOWN, (db) => inboxThread(db, c.id)))).toBe("ERR_NOT_FOUND");
    const bfo = await person(B, "fo_cashier", B.b1);
    expect(await code(as(bfo, (db) => sendInboxMessage(db, key(), c.id, { kind: "text", body: "x" })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(bfo, (db) => updateConversation(db, c.id, { action: "close" })))).toBe("ERR_NOT_FOUND");
  });

  it("a revoked WABA stops sending", async () => {
    const t = await tenant("PT Klinik Cabut Sintetis");
    const o = await person(t, "owner");
    const fo = await person(t, "fo_cashier", t.b1);
    const w = await connectedWaba(t, o, "code-unverified-2");
    await deliver(inboundText({ wabaId: w.metaWabaId, phoneNumberId: w.pnBranch }, { id: wamid(), from: "6281200000030", text: "Halo", at: nowSec() }));
    const c = await convOf(t.tenantId, "6281200000030");
    await as(o, (db) => revokeWaba(db, w.wabaId, "manual"));
    expect(await why(as(fo, (db) => sendInboxMessage(db, key(), c.id, { kind: "text", body: "Halo" }, { port: mockInboxPort() })))).toBe("ERR_VERSION_CONFLICT:number_not_sending");
  });
});

describe("T-090 guards", () => {
  it("history is never deleted or rewritten", async () => {
    const c = await convOf(A.tenantId, "6281200000001");
    const msg = (await h.admin.query(`select id from messages where conversation_id = $1 limit 1`, [c.id])).rows[0].id as string;
    expect(await raw(`delete from messages where id = $1`, [msg])).toBe("raw:42501");
    expect(await raw(`update messages set body_enc = 'v1.1.a.b.c' where id = $1`, [msg])).toBe("raw:42501");
    expect(await raw(`delete from conversations where id = $1`, [c.id])).toBe("raw:42501");
    expect(await raw(`update conversations set last_inbound_at = last_inbound_at - interval '1 day', window_expires_at = window_expires_at - interval '1 day' where id = $1`, [c.id])).toBe("raw:42501");
    expect(await raw(`update conversations set contact_wa_id = '6289999999999' where id = $1`, [c.id])).toBe("raw:42501");
    expect(await raw(`delete from meta_webhook_receipts where tenant_id = $1`, [A.tenantId])).toBe("raw:42501");
    expect(await raw(`update meta_webhook_receipts set tenant_id = null where tenant_id = $1`, [A.tenantId])).toBe("raw:42501");
    // a receipt only moves forward to processed (never back to received); an inbound message's status never changes
    expect(await raw(`update meta_webhook_receipts set state = 'received', processed_at = null where tenant_id = $1 and state = 'processed'`, [A.tenantId])).toBe("raw:42501");
    expect(await raw(`update messages set status = 'read' where id = $1`, [msg])).toBe("raw:42501");
    for (const t of ["meta_webhook_receipts", "conversations", "messages", "wa_templates"]) expect(await raw(`truncate ${t} cascade`), t).toBe("raw:42501");
  });
});
