// T-091 Done-when: Scenario PR-43 inbox flag — a WhatsApp message "wajah bengkak setelah laser kemarin", flagged by CS as a clinical complaint,
// becomes a task for the branch's clinicians on duty (the doctor reads it with the summary) while CS sees only its status. Plus: the inbox ∩
// DEC-066 flagger roles, the active branch, routed and matched conversations, inbound only, one unresolved task per message, key replay, the
// canonical patient after a merge (DEC-061), no message body in the task / event / audit / notification (W-10), TEN-17 (no operator or vendor
// execute; the task stays clinical), the guard freezing message_id, and complaint_flag still refusing the message source (0074 behaviour).
// Synthetic data (MIG-2); Meta through the mock adapters (DEC-082); no network.
import { createHash } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import type { KekRing } from "../../src/lib/keys/envelope";
import { setKekRingForTests } from "../../src/lib/keys/runtime";
import { flagComplaint, getComplaint, listComplaints } from "../../src/modules/clinical/complaints/complaints";
import { flagMessage } from "../../src/modules/messaging/inbox/flag";
import { inboundText } from "../../src/modules/messaging/inbox/fixtures";
import { receiveMetaWebhook, sendInboxMessage, syncTemplates, updateConversation } from "../../src/modules/messaging/inbox/inbox";
import { mockInboxPort, mockMetaAppSecret, signMeta } from "../../src/modules/messaging/inbox/mock";
import { mockWabaGraphPort } from "../../src/modules/messaging/waba/mock";
import { addWaNumber, completeWabaSignup, startWabaSignup } from "../../src/modules/messaging/waba/waba";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { mergePatients } from "../../src/modules/patients/merge/merge";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local";
const RING: KekRing = { current: 1, keys: new Map([[1, Buffer.alloc(32, 9)]]) };

let h: Harness;
let app: pg.Pool;
let worker: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string; allowed?: string[] };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "auditor", "purchasing", "marketing", "central_cs"];

async function tenant(name: string): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, name]);
  const br = async (c: string, nm: string) =>
    (await h.admin.query(`insert into branches (tenant_id, code, name, timezone, address) values ($1, $2, $3, 'Asia/Jakarta', 'Jl. Uji') returning id`, [tenantId, c, nm])).rows[0].id as string;
  return { tenantId, b1: await br("FL1", "Kemang"), b2: await br("FL2", "Bintaro") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`flag${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Flag ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const why = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason ?? ""}` : `raw:${e.code ?? e.message}`));
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const key = () => crypto.randomUUID();
const raw = (sql: string, args: unknown[] = []) => h.admin.query(sql, args).then(() => "ok", (e) => `raw:${e.code}`);
let seq = 0;
const wamid = () => `wamid.FLAG${String(++seq).padStart(6, "0")}${Math.floor(Math.random() * 1e6)}`;
const nowSec = () => Math.floor(Date.now() / 1000);
type Wa = { metaWabaId: string; pnBranch: string; pnBrand: string };
async function connectedWaba(t: T, own: P, codeName: string): Promise<Wa> {
  const g = mockWabaGraphPort();
  const { wabaId } = await as(own, (db) => startWabaSignup(db, key(), { onboardingChannel: "cloud_api" }));
  await as(own, (db) => completeWabaSignup(db, wabaId, codeName, { port: g }));
  const pnBranch = `6${String(Date.now()).slice(-9)}${++seq}`;
  const pnBrand = `7${String(Date.now()).slice(-9)}${++seq}`;
  await as(own, (db) => addWaNumber(db, key(), wabaId, { branchId: t.b1, phoneNumber: `+62815${String(1000000 + seq)}`, phoneNumberId: pnBranch }, { port: g }));
  await as(own, (db) => addWaNumber(db, key(), wabaId, { branchId: null, phoneNumber: `+62816${String(1000000 + seq)}`, phoneNumberId: pnBrand }, { port: g }));
  await as(own, (db) => syncTemplates(db));
  return { metaWabaId: (await h.admin.query(`select meta_waba_id from waba_accounts where id = $1`, [wabaId])).rows[0].meta_waba_id as string, pnBranch, pnBrand };
}
async function inbound(w: Wa, pn: string, from: string, text: string) {
  const id = wamid();
  const body = JSON.stringify(inboundText({ wabaId: w.metaWabaId, phoneNumberId: pn }, { id, from, text, at: nowSec() }));
  await receiveMetaWebhook(worker, body, signMeta(mockMetaAppSecret()!, body));
  return (await h.admin.query(`select m.id, m.conversation_id from messages m where m.provider_message_id = $1`, [id])).rows[0] as { id: string; conversation_id: string };
}
async function patient(t: T, name: string) {
  return (await h.admin.query(`insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation,
       education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $2, '1990-01-01', 'female', 'nik', 'v1.1.aa.bb.cc', $3, 'islam', 'Karyawan', 's1',
       'kawin', $4, $5, 'fo_cashier') returning id`, [t.tenantId, name, createHash("sha256").update(name + Math.random()).digest("base64url").slice(0, 43), t.b1, FO.staffId])).rows[0].id as string;
}
const CLINICAL = "wajah bengkak setelah laser kemarin";
const fetchSpy = vi.fn();
let A: T; let B: T;
let OWN: P; let CS: P; let FO: P; let FO2: P; let BC: P; let MGR: P; let DOC: P; let DOC2: P; let NURSE: P; let MKT: P; let AU: P; let ADM: P; let RO: P; let BOWN: P;
let WA: Wa; let WB: Wa;

beforeAll(async () => {
  setKekRingForTests(RING);
  h = await createHarness();
  const login = h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE]));
  app = await openAppPool({ connectionString: login, max: 6 });
  worker = await openAppPool({ connectionString: login, max: 3 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant("PT Klinik Flag Sintetis");
  B = await tenant("PT Klinik Lain Flag Sintetis");
  OWN = await person(A, "owner"); CS = await person(A, "central_cs"); FO = await person(A, "fo_cashier", A.b1); FO2 = await person(A, "fo_cashier", A.b2);
  BC = await person(A, "bc", A.b1); MGR = await person(A, "manager", A.b1); DOC = await person(A, "doctor", A.b1); DOC2 = await person(A, "doctor", A.b2);
  NURSE = await person(A, "nurse", A.b1); MKT = await person(A, "marketing"); AU = await person(A, "auditor"); ADM = await person(A, "admin_pusat");
  RO = await person(A, "records_officer", A.b1); BOWN = await person(B, "owner");
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

describe("T-091 scenario PR-43 inbox flag", () => {
  it("CS flags the message clinical: a task for the Kemang clinicians, the doctor reads it, CS sees only its status", async () => {
    const pid = await patient(A, "Pasien Laser Sintetis");
    const m = await inbound(WA, WA.pnBranch, "6281700000001", CLINICAL);
    await as(FO, (db) => updateConversation(db, m.conversation_id, { action: "match", patientId: pid }));
    const { taskId } = await as(CS, (db) => flagMessage(db, key(), m.id, { kind: "klinis", triage: "merah", summary: "Bengkak setelah laser, minta dinilai dokter" }));
    const t = (await h.admin.query(`select * from complaint_tasks where id = $1`, [taskId])).rows[0];
    expect(t).toMatchObject({ tenant_id: A.tenantId, branch_id: A.b1, patient_id: pid, message_id: m.id, visit_id: null, source: "message", kind: "klinis",
      triage: "merah", state: "open", flagged_by: CS.staffId, flagged_as: "central_cs" });
    // the clinicians of Kemang are notified; nothing in Bintaro
    const notes = (await h.admin.query(`select recipient_role, branch_id from notifications where subject_id = $1 order by recipient_role`, [taskId])).rows;
    expect(notes).toEqual(["doctor", "facility_head", "nurse", "pharmacist"].map((r) => ({ recipient_role: r, branch_id: A.b1 })));
    // the doctor reads the task with the summary; CS reads only its status
    const forDoc = await as(DOC, (db) => getComplaint(db, taskId));
    expect(forDoc).toMatchObject({ content: true, summary: "Bengkak setelah laser, minta dinilai dokter", source: "message", message_id: m.id });
    const forCs = await as(CS, (db) => getComplaint(db, taskId));
    expect(forCs).toMatchObject({ content: false, state: "open", message_id: m.id });
    expect(forCs).not.toHaveProperty("summary");
    expect((await as(CS, (db) => listComplaints(db, A.b1, null))).tasks.find((x) => x.id === taskId)).toMatchObject({ content: false });
    expect(await code(as(DOC2, (db) => getComplaint(db, taskId)))).toBe("ERR_NOT_FOUND");
    // the message body is nowhere outside the sealed message (W-10)
    const dump = JSON.stringify([t, notes, (await h.admin.query(`select payload from domain_events where aggregate_id = $1`, [taskId])).rows,
      (await h.admin.query(`select * from audit_events where object_id = $1`, [taskId])).rows, (await h.admin.query(`select * from complaint_events where task_id = $1`, [taskId])).rows]);
    expect(dump).not.toContain("bengkak setelah laser kemarin");
    expect((await h.admin.query(`select payload from domain_events where aggregate_id = $1 and type = 'ComplaintFlagged'`, [taskId])).rows[0].payload)
      .toMatchObject({ task_id: taskId, message_id: m.id, source: "message", kind: "klinis" });
  });

  it("one unresolved task per message; the same key replays; a layanan flag goes to the manager", async () => {
    const pid = await patient(A, "Pasien Ulang Sintetis");
    const m = await inbound(WA, WA.pnBranch, "6281700000002", "antrean lama sekali tadi");
    await as(FO, (db) => updateConversation(db, m.conversation_id, { action: "match", patientId: pid }));
    const k = key();
    const f = { kind: "layanan" as const, category: "waktu_tunggu" as const, summary: "Mengeluh menunggu lama" };
    const first = await as(FO, (db) => flagMessage(db, k, m.id, f));
    expect(await as(FO, (db) => flagMessage(db, k, m.id, f))).toEqual({ taskId: first.taskId, replayed: true });
    expect(await code(as(FO, (db) => flagMessage(db, k, m.id, { ...f, summary: "Lain" })))).toBe("ERR_IDEMPOTENCY_CONFLICT");
    expect(await why(as(BC, (db) => flagMessage(db, key(), m.id, f)))).toBe("ERR_VERSION_CONFLICT:already_flagged");
    expect((await h.admin.query(`select recipient_role from notifications where subject_id = $1 order by 1`, [first.taskId])).rows.map((r) => r.recipient_role))
      .toEqual(["facility_head", "manager"]);
    // the manager flags layanan only
    const m2 = await inbound(WA, WA.pnBranch, "6281700000002", CLINICAL);
    expect(await code(as(MGR, (db) => flagMessage(db, key(), m2.id, { kind: "klinis", summary: "Klinis" })))).toBe("ERR_FORBIDDEN");
    expect(await code(as(MGR, (db) => flagMessage(db, key(), m2.id, { kind: "layanan", category: "lainnya", summary: "Layanan" })))).toBe("ok");
  });

  it("refusals: roles outside the inbox flaggers, another branch, unrouted, unmatched, outbound, another tenant", async () => {
    const pid = await patient(A, "Pasien Tolak Sintetis");
    const m = await inbound(WA, WA.pnBranch, "6281700000003", CLINICAL);
    await as(FO, (db) => updateConversation(db, m.conversation_id, { action: "match", patientId: pid }));
    const f = { kind: "klinis" as const, summary: "Keluhan klinis" };
    for (const p of [DOC, NURSE, OWN, MKT, AU, ADM, RO]) expect(await code(as(p, (db) => flagMessage(db, key(), m.id, f))), p.role).toBe("ERR_FORBIDDEN");
    // a Bintaro FO, and a two-branch FO acting at Bintaro, do not find a Kemang message
    expect(await code(as(FO2, (db) => flagMessage(db, key(), m.id, f)))).toBe("ERR_NOT_FOUND");
    const both = await person(A, "fo_cashier", A.b2, A.b1);
    expect(await code(as(both, (db) => flagMessage(db, key(), m.id, f)))).toBe("ERR_NOT_FOUND");
    // a brand-wide (unrouted) conversation: route first; an unmatched one: match first
    const ub = await inbound(WA, WA.pnBrand, "6281700000004", CLINICAL);
    expect(await why(as(CS, (db) => flagMessage(db, key(), ub.id, f)))).toBe("ERR_VERSION_CONFLICT:route_first");
    const um = await inbound(WA, WA.pnBranch, "6281700000005", CLINICAL);
    expect(await why(as(FO, (db) => flagMessage(db, key(), um.id, f)))).toBe("ERR_VERSION_CONFLICT:match_patient_first");
    // an outbound message is not a complaint source
    const sent = await as(FO, (db) => sendInboxMessage(db, key(), m.conversation_id, { kind: "text", body: "Baik, kami teruskan ke dokter" }, { port: mockInboxPort() }));
    expect(await why(as(FO, (db) => flagMessage(db, key(), sent.messageId, f)))).toBe("ERR_INVALID_INPUT:inbound_message_required");
    // another tenant's message is not found
    const bm = await inbound(WB, WB.pnBranch, "6281700000006", CLINICAL);
    expect(await code(as(CS, (db) => flagMessage(db, key(), bm.id, f)))).toBe("ERR_NOT_FOUND");
    const bcs = await person(B, "central_cs");
    expect(await code(as(bcs, (db) => flagMessage(db, key(), m.id, f)))).toBe("ERR_NOT_FOUND");
    // extra keys refused
    expect(await why(as(FO, (db) => db.query(`select complaint_flag_from_message($1, $2::jsonb)`, [m.id, JSON.stringify({ ...f, source: "staff_flag" })])))).toBe("raw:22023");
  });

  it("a merged patient: the task lands on the canonical survivor (DEC-061)", async () => {
    const dup = await patient(A, "Duplikat Flag Sintetis");
    const surv = await patient(A, "Penyintas Flag Sintetis");
    const m = await inbound(WA, WA.pnBranch, "6281700000007", CLINICAL);
    await as(FO, (db) => updateConversation(db, m.conversation_id, { action: "match", patientId: dup }));
    await as(RO, (db) => mergePatients(db, key(), surv, dup, "Pasien ganda"));
    const { taskId } = await as(CS, (db) => flagMessage(db, key(), m.id, { kind: "klinis", summary: "Keluhan pasien ganda" }));
    expect((await h.admin.query(`select patient_id from complaint_tasks where id = $1`, [taskId])).rows[0].patient_id).toBe(surv);
  });
});

describe("T-091 invariants kept", () => {
  it("complaint_flag still refuses the message source; the guard freezes message_id; the CHECK couples source and message", async () => {
    const pid = await patient(A, "Pasien Invarian Sintetis");
    expect(await why(as(DOC, (db) => flagComplaint(db, key(), { patientId: pid, kind: "klinis", source: "message", summary: "Lewat jalur lama" }))))
      .toBe("ERR_INVALID_INPUT:message_source_not_ready");
    const ok = await as(DOC, (db) => flagComplaint(db, key(), { patientId: pid, kind: "klinis", source: "staff_flag", summary: "Flag staf biasa" }));
    expect((await h.admin.query(`select message_id, source from complaint_tasks where id = $1`, [ok.taskId])).rows[0]).toEqual({ message_id: null, source: "staff_flag" });
    const m = await inbound(WA, WA.pnBranch, "6281700000008", CLINICAL);
    await as(FO, (db) => updateConversation(db, m.conversation_id, { action: "match", patientId: pid }));
    const { taskId } = await as(FO, (db) => flagMessage(db, key(), m.id, { kind: "klinis", summary: "Untuk uji guard" }));
    const other = await inbound(WA, WA.pnBranch, "6281700000008", "pesan lain");
    expect(await raw(`update complaint_tasks set message_id = $2 where id = $1`, [taskId, other.id])).toBe("raw:42501");
    expect(await raw(`update complaint_tasks set message_id = $2 where id = $1`, [ok.taskId, other.id])).toBe("raw:42501");
    // direct inserts that break the coupling are refused by the CHECK (even with the guard paused)
    await h.admin.query(`alter table complaint_tasks disable trigger complaint_tasks_guard`);
    try {
      expect(await raw(`insert into complaint_tasks (tenant_id, branch_id, patient_id, kind, source, triage, summary, due_at, flagged_by, flagged_as)
        values ($1, $2, $3, 'klinis', 'message', 'kuning', 'Tanpa pesan', now() + interval '1 day', $4, 'fo_cashier')`, [A.tenantId, A.b1, pid, FO.staffId])).toBe("raw:23514");
    } finally {
      await h.admin.query(`alter table complaint_tasks enable always trigger complaint_tasks_guard`);
    }
  });

  it("TEN-17: no operator or vendor execute; the wrapper is the only granted addition; the task stays clinical", async () => {
    for (const r of ["clinic_vendor", "clinic_operator"]) {
      expect((await h.admin.query(`select has_function_privilege($1, 'public.complaint_flag_from_message(uuid,jsonb)', 'execute') ok`, [r])).rows[0].ok, r).toBe(false);
      expect((await h.admin.query(`select has_function_privilege($1, 'public.complaint_flag_do(record,uuid,uuid,uuid,uuid,text,jsonb)', 'execute') ok`, [r])).rows[0].ok, r).toBe(false);
    }
    expect((await h.admin.query(`select has_function_privilege('clinic_app', 'public.complaint_flag_do(record,uuid,uuid,uuid,uuid,text,jsonb)', 'execute') ok`)).rows[0].ok).toBe(false);
    expect((await h.admin.query(`select has_function_privilege('clinic_app', 'public.complaint_flag_from_message(uuid,jsonb)', 'execute') ok`)).rows[0].ok).toBe(true);
    expect((await h.admin.query(`select support_class from support_object_kinds where table_name = 'public.complaint_tasks'`)).rows[0].support_class).toBe("clinical");
    // CS reads no task row directly (RLS); the status comes only through the readers
    expect((await as(CS, (db) => db.query(`select id from complaint_tasks`))).rows).toHaveLength(0);
  });
});
