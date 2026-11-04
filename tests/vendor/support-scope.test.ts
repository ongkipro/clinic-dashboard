// T-026 Done-when (PR-60, TEN-14): scenarios PR-60 "owner sees vendor access", "clinical scope
// without approval" and "expired grant"; the Owner's approval rules (only the Owner, only a
// pending session, not a closed tenant, not an inactive operator, not a dual identity of the
// opener; TTL from approval; every decision and refusal by the acting Owner in the tenant chain —
// a caller who is not the Owner is refused by an exception and leaves no row); the access log
// grouped by session (access windows, refused binds, records read; forged records shown and
// flagged; paginated; tenant-scoped; Owner and Admin Pusat only).
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_GROUP_ROLE, OPERATOR_GROUP_ROLE, VENDOR_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { onboardingAccess } from "../../src/modules/vendor/onboarding/onboarding";
import { bootstrapVendor, createVendorStaff, type VendorCaller } from "../../src/modules/vendor/staff/staff";
import { decideScope, sessionLog, sessionsForOwner, type SessionEvent, type SessionLog } from "../../src/modules/vendor/support/scope";
import { endSessionAsOwner, extendSession, openSession, SupportBindError, withSupportSession } from "../../src/modules/vendor/support/support";
import { advanceTenant } from "../../src/modules/vendor/tenants/tenants";
import { createHarness, type Harness } from "../rls/harness";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let consoleDb: pg.Pool;
let opDb: pg.Pool;
let n = 0;
const IP = "203.0.113.10";
const caller = (accountId: string): VendorCaller => ({ accountId, ip: IP, mfaAt: new Date() });
// A test-only clinical table (no clinical table exists in M0): classed clinical, with an
// operator policy of the T-025 shape, in this throwaway database only.
const CLINICAL = "public.t026_clinical_notes";

async function account(): Promise<string> {
  return (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('V', $1, true) returning id`, [`scope${++n}@vendor-sintetis.test`])).rows[0].id as string;
}
async function session(acc: string): Promise<string> {
  const tok = `tok${++n}${randomBytes(12).toString("hex")}`;
  await h.admin.query(`insert into auth_session (user_id, token, expires_at, surface, second_factor_at) values ($1, $2, now() + interval '8 hours', 'vendor', now())`, [acc, tok]);
  return tok;
}
const as = (token: string) => ({ token, ip: IP });
const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e instanceof CommandError ? e.code : e instanceof SupportBindError ? e.reason : (e as { code?: string }).code ?? String(e)));
const chain = async (tenantId: string, objectId: string) =>
  (await h.admin.query(`select reason_code, outcome, case when staff_id is not null then 'clinic' when vendor_staff_id is not null then 'vendor' end as by from audit_events where tenant_id = $1 and object_id = $2 order by seq`, [tenantId, objectId])).rows;

type Clinic = { tenantId: string; branchId: string; ownerAcc: string; ownerStaff: string; adminAcc: string; managerAcc: string };
async function clinic(state = "live"): Promise<Clinic> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ($1) returning id`, [state])).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, `PT Klinik Sintetis ${++n}`]);
  const branchId = (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'B1', 'Cabang Satu', 'Asia/Jakarta') returning id`, [tenantId])).rows[0].id as string;
  const member = async (role: "owner" | "admin_pusat" | "manager", acc?: string) => {
    acc ??= (await h.admin.query(`insert into auth_user (name, email) values ('C', $1) returning id`, [`klinik${++n}@klinik-sintetis.test`])).rows[0].id as string;
    const { staffId } = await createMembership(owner, { tenantId, accountId: acc, displayName: `Staf ${n}` });
    const roleId = await assignRole(h.admin, { tenantId, staffId, role });
    if (role === "manager") await assignBranch(h.admin, { tenantId, staffRoleId: roleId, branchId });
    return { acc, staffId };
  };
  const o = await member("owner");
  const a = await member("admin_pusat");
  const m = await member("manager");
  return { tenantId, branchId, ownerAcc: o.acc, ownerStaff: o.staffId, adminAcc: a.acc, managerAcc: m.acc };
}
const asRole = async <R>(c: Clinic, acc: string, actingRole: "owner" | "admin_pusat" | "manager", fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, acc, { tenantId: c.tenantId, actingRole, activeBranchId: actingRole === "manager" ? c.branchId : undefined }), fn);
const asOwner = <R>(c: Clinic, fn: (db: pg.PoolClient) => Promise<R>) => asRole(c, c.ownerAcc, "owner", fn);
const asAdmin = <R>(c: Clinic, fn: (db: pg.PoolClient) => Promise<R>) => asRole(c, c.adminAcc, "admin_pusat", fn);
async function open(tok: string, c: Clinic, scope: string[], minutes = 60) {
  const r = await openSession(consoleDb, as(tok), { tenantId: c.tenantId, purpose: "Memeriksa data staf atas permintaan klinik", scope, minutes });
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.data;
}
const readsOf = (log: SessionLog) => log.events.filter((e): e is Extract<SessionEvent, { kind: "read" }> => e.kind === "read");
const read = (tok: string, sessionId: string, sql: string) =>
  withSupportSession(consoleDb, opDb, as(tok), sessionId, async (db) => (await db.query(sql)).rows);

let PO: string; let SUP: string; let SUP2: string; let ONB: string;
let supTok: string; let sup2Tok: string; let poTok: string; let onbTok: string;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 4 });
  owner = new pg.Pool({ connectionString: h.ownerUrl(), max: 3 });
  consoleDb = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [VENDOR_GROUP_ROLE])), max: 3 }, VENDOR_GROUP_ROLE);
  opDb = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [OPERATOR_GROUP_ROLE])), max: 3 }, OPERATOR_GROUP_ROLE);
  await h.admin.query(`
    create table ${CLINICAL} (id uuid primary key default uuid_generate_v7(), tenant_id uuid not null, note text not null);
    alter table ${CLINICAL} enable row level security;
    insert into scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics)
      values ('${CLINICAL}', 'clinical', 'test', '{}', 'test', 'none');
    insert into support_object_kinds (table_name, support_class) values ('${CLINICAL}', 'clinical');
    create policy t026_clinical_notes_operator_read on ${CLINICAL} for select to clinic_operator
      using (tenant_id = public.app_tenant_id() and public.operator_row_read('${CLINICAL}', tenant_id, id));
    grant select on ${CLINICAL} to clinic_operator;`);
  const c = await owner.connect();
  try {
    PO = await account();
    await bootstrapVendor(c, PO, "Pemilik Platform", "203.0.113.0/24", "Kantor vendor");
    SUP = await account();
    SUP2 = await account();
    ONB = await account();
    await createVendorStaff(c, caller(PO), SUP, "Dukungan Satu", ["support"]);
    await createVendorStaff(c, caller(PO), SUP2, "Dukungan Dua", ["support"]);
    await createVendorStaff(c, caller(PO), ONB, "Onboarding Satu", ["onboarding"]);
  } finally {
    c.release();
  }
  poTok = await session(PO); supTok = await session(SUP); sup2Tok = await session(SUP2); onbTok = await session(ONB);
});
afterAll(async () => {
  await opDb?.end();
  await consoleDb?.end();
  await owner?.end();
  await app?.end();
  await h?.close();
});

describe("scenarios PR-60", () => {
  it("owner sees vendor access: operator, reason, scope and end time; the owner can end it", async () => {
    const a = await clinic();
    const s = await open(supTok, a, ["public.branches", "public.evidence_items"], 45);
    const [row] = await asOwner(a, (db) => sessionsForOwner(db));
    expect(row).toMatchObject({
      id: s.id, operator: "Dukungan Satu", purpose: "Memeriksa data staf atas permintaan klinik", state: "active", needs_approval: false, minutes: 45,
      scope: [{ table: "public.branches", class: "config" }, { table: "public.evidence_items", class: "config" }],
    });
    expect(Date.parse(row.ends_at!) - Date.parse(row.activated_at!)).toBe(45 * 60_000);
    await asOwner(a, (db) => endSessionAsOwner(db, s.id));
    expect((await asOwner(a, (db) => sessionsForOwner(db)))[0]).toMatchObject({ state: "ended", end_reason: "owner" });
    expect(await code(read(supTok, s.id, `select 1 from branches`))).toBe("not_active");
  });

  it("clinical scope without approval: the session does not activate and the request is audited; approval activates it", async () => {
    const a = await clinic();
    await h.admin.query(`insert into ${CLINICAL} (tenant_id, note) values ($1, 'catatan klinis sintetis')`, [a.tenantId]);
    for (const scope of [[CLINICAL], ["public.staff"], ["public.branches", CLINICAL]]) {
      const s = await open(supTok, a, scope);
      expect(s.state, scope.join()).toBe("pending_approval");
      expect(await code(read(supTok, s.id, `select 1 from branches`)), scope.join()).toBe("awaiting_owner");
      // The request (opened, awaiting the owner) and the refused read attempt are both in the chain.
      expect((await chain(a.tenantId, s.id)).map((r) => [r.reason_code, r.outcome]), scope.join()).toEqual([["awaiting_owner", "success"], ["awaiting_owner", "denied"]]);
    }
    const [pending] = await asOwner(a, (db) => sessionsForOwner(db));
    expect(pending).toMatchObject({ state: "pending_approval", needs_approval: true, activated_at: null, ends_at: null });
    // The Owner approves the clinical scope: active from now for its minutes, reads work.
    const s = await open(supTok, a, [CLINICAL], 30);
    // Requested an hour ago: the TTL still starts at the approval.
    await h.admin.query(`alter table support_sessions disable trigger support_sessions_guard`);
    await h.admin.query(`update support_sessions set requested_at = requested_at - interval '1 hour' where id = $1`, [s.id]);
    await h.admin.query(`alter table support_sessions enable trigger support_sessions_guard`);
    expect(await asOwner(a, (db) => decideScope(db, s.id, true))).toEqual({ ok: true, decision: "approved" });
    const st = (await h.admin.query(`select state, ends_at - activated_at as ttl, ends_at > clock_timestamp() + interval '29 minutes' as fresh from support_sessions where id = $1`, [s.id])).rows[0];
    expect(st).toEqual({ state: "active", ttl: { minutes: 30 }, fresh: true });
    expect(await read(supTok, s.id, `select note from ${CLINICAL}`)).toEqual([{ note: "catatan klinis sintetis" }]);
    // The clinical read is listed to the Owner (definer can verify the row).
    const note = (await h.admin.query(`select id from ${CLINICAL} where tenant_id = $1`, [a.tenantId])).rows[0].id;
    expect(readsOf(await asOwner(a, (db) => sessionLog(db, s.id)))).toEqual([{ kind: "read", object_kind: CLINICAL, id: note, at: expect.any(String), row_found: true }]);
    // The approval is attributed to the clinic Owner (staff), the request and the read to the vendor operator.
    expect((await chain(a.tenantId, s.id)).map((r) => [r.reason_code, r.outcome, r.by]))
      .toEqual([["awaiting_owner", "success", "vendor"], ["support_scope_approved", "success", "clinic"], ["ticket_issued", "success", "vendor"]]);
    expect((await h.admin.query(`select staff_id from audit_events where object_id = $1 and reason_code = 'support_scope_approved'`, [s.id])).rows[0].staff_id).toBe(a.ownerStaff);
  });

  it("expired grant: an onboarding grant created 31 days ago, tenant not live — the catalog is denied", async () => {
    // A tenant in provisioning moved to onboarding through the console (the grant comes from the
    // lifecycle); the processor agreement is approved by its Owner first (TEN-12).
    const c = await clinic("provisioning");
    const { decideEvidence, uploadEvidence } = await import("../../src/modules/compliance/compliance");
    const pdf = Buffer.from("%PDF-1.7\nPerjanjian pengolahan data sintetis\n%%EOF\n");
    const file = await asOwner(c, (db) => uploadEvidence(db, { obligationKey: "processor_agreement_signed", fileName: "dpa.pdf", content: pdf, expertName: "Konsultan Hukum Sintetis", documentDate: "2026-10-01" }));
    const item = (await h.admin.query(`select item_id from evidence_files where id = $1`, [file.fileId])).rows[0].item_id;
    await asOwner(c, (db) => decideEvidence(db, item, file.fileId, "approved"));
    expect(await advanceTenant(consoleDb, as(onbTok), c.tenantId, "onboarding", "Mulai onboarding klinik uji")).toMatchObject({ ok: true });
    const tenantId = c.tenantId;
    expect(await onboardingAccess(consoleDb, as(onbTok), tenantId, "catalog")).toMatchObject({ ok: true });
    await h.admin.query(`alter table onboarding_grants disable trigger onboarding_grants_guard`);
    await h.admin.query(`update onboarding_grants set granted_at = granted_at - interval '31 days', expires_at = expires_at - interval '31 days' where tenant_id = $1`, [tenantId]);
    await h.admin.query(`alter table onboarding_grants enable trigger onboarding_grants_guard`);
    expect(await onboardingAccess(consoleDb, as(onbTok), tenantId, "catalog")).toMatchObject({ ok: false, reason: "grant_not_active" });
  });
});

describe("the Owner's decision (TEN-14)", () => {
  it("only the Owner decides; Admin Pusat and a manager are refused; another tenant's Owner sees not found (audited)", async () => {
    const a = await clinic();
    const b = await clinic();
    const s = await open(supTok, a, ["public.staff"]);
    expect(await code(asAdmin(a, (db) => decideScope(db, s.id, true)))).toBe("ERR_FORBIDDEN");
    expect(await code(asRole(a, a.managerAcc, "manager", (db) => decideScope(db, s.id, true)))).toBe("ERR_FORBIDDEN");
    expect(await asOwner(b, (db) => decideScope(db, s.id, true))).toEqual({ ok: false, code: "ERR_NOT_FOUND", reason: "not_found" });
    // No session named, no decision given.
    expect(await code(asOwner(a, (db) => db.query(`select support_session_owner_decide(null, true)`)))).toBe("P0002");
    expect(await asOwner(a, (db) => db.query(`select support_session_owner_decide($1, null) as r`, [s.id]).then((r) => r.rows[0].r))).toBe("refused:invalid_input");
    expect((await chain(b.tenantId, s.id)).map((r) => r.reason_code)).toEqual(["support_scope_not_found"]);
    expect((await h.admin.query(`select state from support_sessions where id = $1`, [s.id])).rows[0].state).toBe("pending_approval");
  });

  it("only a pending session; a rejection ends it; decisions are final", async () => {
    const a = await clinic();
    const cfg = await open(supTok, a, ["public.branches"]);
    expect(await asOwner(a, (db) => decideScope(db, cfg.id, true))).toMatchObject({ ok: false, reason: "not_pending" });
    const s = await open(supTok, a, ["public.staff"]);
    expect(await asOwner(a, (db) => decideScope(db, s.id, false))).toEqual({ ok: true, decision: "rejected" });
    expect((await h.admin.query(`select state, end_reason, activated_at from support_sessions where id = $1`, [s.id])).rows[0]).toEqual({ state: "ended", end_reason: "owner", activated_at: null });
    const ap = await open(supTok, a, ["public.staff"]);
    expect(await asOwner(a, (db) => decideScope(db, ap.id, true))).toEqual({ ok: true, decision: "approved" });
    expect((await h.admin.query(`select reason_code, tenant_id from vendor_actions where action = 'support_scope_decide' and object_id = $1`, [ap.id])).rows)
      .toEqual([{ reason_code: "approved_by_owner", tenant_id: a.tenantId }]);
    expect(await asOwner(a, (db) => decideScope(db, s.id, true))).toMatchObject({ ok: false, reason: "not_pending" });
    expect(await code(read(supTok, s.id, `select 1 from staff`))).toBe("not_active");
    expect((await chain(a.tenantId, s.id)).map((r) => [r.reason_code, r.outcome])).toEqual([
      ["awaiting_owner", "success"], ["support_scope_rejected", "success"], ["support_scope_not_pending", "denied"], ["not_active", "denied"],
    ]);
    expect((await h.admin.query(`select reason_code, tenant_id from vendor_actions where action = 'support_scope_decide' and object_id = $1`, [s.id])).rows)
      .toEqual([{ reason_code: "rejected_by_owner", tenant_id: a.tenantId }]);
  });

  it("not for a closed tenant, nor when the operator is no longer active; not by the opener's own account (dual identity)", async () => {
    const a = await clinic();
    const s1 = await open(supTok, a, ["public.staff"]);
    // Operator deactivated after the request.
    const tmp = await account();
    const c = await owner.connect();
    let tmpStaff: string;
    try {
      tmpStaff = await createVendorStaff(c, caller(PO), tmp, "Dukungan Sementara", ["support"]);
    } finally {
      c.release();
    }
    const s2 = await open(await session(tmp), a, ["public.staff"]);
    await h.admin.query(`update vendor_staff set state = 'suspended' where id = $1`, [tmpStaff]);
    expect(await asOwner(a, (db) => decideScope(db, s2.id, true))).toMatchObject({ ok: false, reason: "operator_inactive" });
    // A rejection is still allowed (it only closes the request).
    expect(await asOwner(a, (db) => decideScope(db, s2.id, false))).toEqual({ ok: true, decision: "rejected" });
    expect((await chain(a.tenantId, s2.id)).map((r) => r.reason_code)).toEqual(["awaiting_owner", "support_scope_operator_inactive", "support_scope_rejected"]);
    // Dual identity (an approved IAM-10 case, set up directly): the vendor staff row's account is
    // the clinic Owner's account; that Owner may not approve the session it opened (may reject).
    const d = await clinic();
    const dual = (await h.admin.query(`insert into vendor_staff (account_id, display_name, state) values ($1, 'Dukungan Ganda', 'active') returning id`, [d.ownerAcc])).rows[0].id;
    const sd = (await h.admin.query(`insert into support_sessions (tenant_id, opened_by, purpose, scope, minutes, state)
      values ($1, $2, 'Memeriksa data staf atas permintaan', '{public.staff}', 30, 'pending_approval') returning id`, [d.tenantId, dual])).rows[0].id;
    expect(await asOwner(d, (db) => decideScope(db, sd, true))).toMatchObject({ ok: false, reason: "approver_is_requester" });
    expect(await asOwner(d, (db) => decideScope(db, sd, false))).toEqual({ ok: true, decision: "rejected" });
    // Closed tenant.
    await h.admin.query(`update tenants_registry set lifecycle_state = 'closed' where id = $1`, [a.tenantId]);
    expect((await asOwner(a, (db) => sessionsForOwner(db))).find((r) => r.id === s1.id)).toMatchObject({ state: "pending_approval", needs_approval: false });
    expect(await asOwner(a, (db) => decideScope(db, s1.id, true))).toMatchObject({ ok: false, reason: "tenant_closed" });
    expect((await chain(a.tenantId, s1.id)).map((r) => r.reason_code)).toEqual(["awaiting_owner", "support_scope_tenant_closed"]);
  });

  it("an approved personal scope is not extended (a clinical-scope extension needs the owner again: open a new session)", async () => {
    const a = await clinic();
    const s = await open(supTok, a, ["public.staff"], 30);
    await asOwner(a, (db) => decideScope(db, s.id, true));
    expect(await extendSession(consoleDb, as(supTok), s.id, "Masih memeriksa data staf klinik", 30)).toMatchObject({ ok: false, reason: "needs_owner_approval" });
    const c = await open(supTok, a, [CLINICAL], 30);
    await asOwner(a, (db) => decideScope(db, c.id, true));
    expect(await extendSession(consoleDb, as(supTok), c.id, "Masih memeriksa catatan klinis", 30)).toMatchObject({ ok: false, reason: "needs_owner_approval" });
  });
});

describe("read listing grouped by session (TEN-14)", () => {
  it("access windows, refused binds and every record read with object kind, id and time; forged records shown and flagged", async () => {
    const a = await clinic();
    const b2 = (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'B2', 'Cabang Dua', 'Asia/Jakarta') returning id`, [a.tenantId])).rows[0].id;
    const s = await open(supTok, a, ["public.branches"]);
    await read(supTok, s.id, `select id from branches where code = 'B1'`);
    await withSupportSession(consoleDb, opDb, as(supTok), s.id, async (db) => {
      await db.query(`select id from branches`);
      // A forged record for a made-up id (a bound operator calling the policy function directly).
      await db.query(`select operator_row_read('public.branches', $1, $2)`, [a.tenantId, crypto.randomUUID()]);
    });
    expect(await code(read(sup2Tok, s.id, `select 1 from branches`))).toBe("not_opener");
    const log = await asOwner(a, (db) => sessionLog(db, s.id));
    const windows = log.events.filter((e) => e.kind === "window");
    expect(windows).toHaveLength(2);
    expect(windows.every((w) => w.kind === "window" && w.used_at !== undefined)).toBe(true);
    expect(log.events.filter((e) => e.kind === "refused")).toEqual([{ kind: "refused", at: expect.any(String), reason: "not_opener" }]);
    // Oldest first across kinds.
    expect(log.events.map((e) => Date.parse(e.at))).toEqual([...log.events.map((e) => Date.parse(e.at))].sort((x, y) => x - y));
    const forged = (await h.admin.query(`select row_id from support_session_reads where session_id = $1 and row_id not in ($2, $3)`, [s.id, a.branchId, b2])).rows[0].row_id;
    expect(readsOf(log).map((r) => [r.object_kind, r.id, r.row_found]).sort()).toEqual([
      ["public.branches", a.branchId, true], ["public.branches", b2, true], ["public.branches", forged, false]].sort());
    expect(readsOf(log).every((r) => !Number.isNaN(Date.parse(r.at)))).toBe(true);
    expect(log.totals).toEqual({ windows: 2, refused: 1, reads: 3 });
    expect((await asOwner(a, (db) => sessionsForOwner(db)))[0]).toMatchObject({ access_windows: 2, refused_reads: 1, records_read: 3 });
    // Paging bounds the whole answer: 6 events, pages of 4 then 2, same order as one page.
    const p1 = await asOwner(a, (db) => sessionLog(db, s.id, { offset: 0, limit: 4 }));
    const p2 = await asOwner(a, (db) => sessionLog(db, s.id, { offset: 4, limit: 4 }));
    expect(p1.events).toHaveLength(4);
    expect(p2.events).toHaveLength(2);
    expect([...p1.events, ...p2.events]).toEqual(log.events);
    expect(p2.totals).toEqual(log.totals);
    expect((await asOwner(a, (db) => sessionLog(db, s.id, { offset: 0, limit: 1 }))).events).toHaveLength(1);
    expect(await code(asOwner(a, (db) => sessionLog(db, s.id, { offset: 0, limit: 501 })))).toBe("ERR_INVALID_INPUT");
    // Admin Pusat reads the same (19 §2.16: Akses Vendor, Admin Pusat read); a manager may not;
    // another tenant's Owner sees neither list nor log.
    expect(readsOf(await asAdmin(a, (db) => sessionLog(db, s.id)))).toHaveLength(3);
    expect((await asAdmin(a, (db) => sessionsForOwner(db)))[0]).toMatchObject({ id: s.id, records_read: 3 });
    expect(await code(asRole(a, a.managerAcc, "manager", (db) => sessionsForOwner(db)))).toBe("ERR_FORBIDDEN");
    const b = await clinic();
    expect(await asOwner(b, (db) => sessionsForOwner(db))).toEqual([]);
    expect(await code(asOwner(b, (db) => sessionLog(db, s.id)))).toBe("ERR_NOT_FOUND");
  });

  it("events with the same time keep one order across pages (kind, then a per-kind key)", async () => {
    const a = await clinic();
    const s = await open(supTok, a, ["public.branches"]);
    await withSupportSession(consoleDb, opDb, as(supTok), s.id, async (db) => db.query(`select id from branches`));
    for (let i = 0; i < 3; i++) await code(read(sup2Tok, s.id, `select 1 from branches`));
    // Every event at one instant (test-only, the guard triggers off).
    const at = "2026-11-04T05:00:00Z";
    await h.admin.query(`alter table support_bind_tickets disable trigger support_bind_tickets_guard`);
    await h.admin.query(`update support_bind_tickets set issued_at = $2, expires_at = $2::timestamptz + interval '1 minute' where session_id = $1`, [s.id, at]);
    await h.admin.query(`alter table support_bind_tickets enable trigger support_bind_tickets_guard`);
    await h.admin.query(`alter table vendor_actions disable trigger vendor_actions_guard`);
    await h.admin.query(`update vendor_actions set at = $2 where object_id = $1 and action = 'support_bind' and outcome = 'denied'`, [s.id, at]);
    await h.admin.query(`alter table vendor_actions enable trigger vendor_actions_guard`);
    await h.admin.query(`alter table support_session_reads disable trigger support_session_reads_immutable`);
    await h.admin.query(`update support_session_reads set first_read_at = $2 where session_id = $1`, [s.id, at]);
    await h.admin.query(`alter table support_session_reads enable trigger support_session_reads_immutable`);
    const all = await asOwner(a, (db) => sessionLog(db, s.id));
    expect(all.events.map((e) => e.kind)).toEqual(["read", "refused", "refused", "refused", "window"]);
    const paged: SessionEvent[] = [];
    for (let off = 0; off < 5; off++) paged.push(...(await asOwner(a, (db) => sessionLog(db, s.id, { offset: off, limit: 1 }))).events);
    expect(paged).toEqual(all.events);
  });

  it("an active session past its end is listed as expired; a tenants record is matched by the tenant id", async () => {
    const a = await clinic();
    const s = await open(supTok, a, ["public.tenants"], 30);
    await read(supTok, s.id, `select id from tenants`);
    expect(readsOf(await asOwner(a, (db) => sessionLog(db, s.id))).map((r) => [r.object_kind, r.id])).toEqual([["public.tenants", a.tenantId]]);
    await h.admin.query(`alter table support_sessions disable trigger support_sessions_guard`);
    await h.admin.query(`update support_sessions set activated_at = activated_at - interval '31 minutes', ends_at = ends_at - interval '31 minutes' where id = $1`, [s.id]);
    await h.admin.query(`alter table support_sessions enable trigger support_sessions_guard`);
    expect((await asOwner(a, (db) => sessionsForOwner(db)))[0]).toMatchObject({ id: s.id, state: "expired", needs_approval: false, records_read: 1 });
  });

  it("a record naming another tenant's row is shown as not found; a real read stays listed after its row is deleted", async () => {
    const a = await clinic();
    const b = await clinic();
    const s = await open(supTok, a, ["public.branches"]);
    await withSupportSession(consoleDb, opDb, as(supTok), s.id, async (db) => {
      await db.query(`select operator_row_read('public.branches', $1, $2)`, [a.tenantId, b.branchId]);
    });
    expect(readsOf(await asOwner(a, (db) => sessionLog(db, s.id)))).toEqual([{ kind: "read", object_kind: "public.branches", id: b.branchId, at: expect.any(String), row_found: false }]);
    // A personal read (approved), then the row is deleted: still listed, flagged not found.
    const tmp = (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'TMP', 'Cabang Sementara', 'Asia/Jakarta') returning id`, [a.tenantId])).rows[0].id;
    const p = await open(supTok, a, ["public.staff", "public.branches"]);
    await asOwner(a, (db) => decideScope(db, p.id, true));
    const staffRows = await read(supTok, p.id, `select id from staff`);
    await read(supTok, p.id, `select id from branches where code = 'TMP'`);
    await h.admin.query(`delete from branches where id = $1`, [tmp]);
    const log = await asOwner(a, (db) => sessionLog(db, p.id));
    expect(readsOf(log).filter((r) => r.object_kind === "public.staff").map((r) => [r.id, r.row_found]).sort())
      .toEqual(staffRows.map((r) => [r.id, true]).sort());
    expect(readsOf(log).find((r) => r.id === tmp)).toMatchObject({ object_kind: "public.branches", row_found: false });
  });

  it("every readable classed table can be checked (public, uuid id and tenant column); anything else is not checkable", async () => {
    const tables = (await h.admin.query(`select table_name from support_object_kinds where support_class <> 'never' and table_name <> $1`, [CLINICAL])).rows.map((r) => r.table_name);
    expect(tables.length).toBeGreaterThan(10);
    for (const t of tables) {
      expect((await h.admin.query(`select support_read_row_exists($1, $2, $2) as r`, [t, crypto.randomUUID()])).rows[0].r, t).toBe(false);
    }
    for (const t of ["public.idempotency_records", "public.vendor_staff", "pg_temp.branches", "branches"]) {
      expect((await h.admin.query(`select support_read_row_exists($1, $2, $2) as r`, [t, crypto.randomUUID()])).rows[0].r, t).toBeNull();
    }
    // A whitelisted name that is not public-qualified, or a classed table without the id/tenant
    // columns, is not checkable (null, never an error that would break the Owner's whole list).
    await h.admin.query(`create table public.t026_no_tenant (id uuid primary key default uuid_generate_v7(), label text)`);
    await h.admin.query(`insert into support_object_kinds (table_name, support_class) values ('public.t026_no_tenant', 'config'), ('t026_unqualified', 'config')`);
    await h.admin.query(`insert into scope_map (table_name, policy_kind, owning_module, reader_roles, writer_service, branch_semantics)
      values ('public.t026_no_tenant', 'platform', 'test', '{}', 'test', 'none')`);
    for (const t of ["public.t026_no_tenant", "t026_unqualified"]) {
      expect((await h.admin.query(`select support_read_row_exists($1, $2, $2) as r`, [t, crypto.randomUUID()])).rows[0].r, t).toBeNull();
    }
    await h.admin.query(`create temp table t026_unqualified (id uuid, tenant_id uuid)`);
    expect((await h.admin.query(`select support_read_row_exists('t026_unqualified', $1, $1) as r`, [crypto.randomUUID()])).rows[0].r).toBeNull();
    await h.admin.query(`drop table t026_unqualified`);
    // The database refuses a page out of range even when called directly.
    const a = await clinic();
    const s = await open(supTok, a, ["public.branches"]);
    for (const [off, lim] of [[0, 0], [0, 501], [-1, 10], [null, 10]]) {
      await expect(asOwner(a, (db) => db.query(`select support_session_reads_for_owner($1, $2, $3)`, [s.id, off, lim])), `${off},${lim}`).rejects.toMatchObject({ code: "22023" });
    }
  });

  it("clinic_app cannot read the support tables directly; the listing functions are the only path", async () => {
    for (const t of ["support_sessions", "support_session_reads", "support_bind_tickets"]) {
      await expect(app.query(`select 1 from ${t} limit 1`), t).rejects.toMatchObject({ code: "42501" });
    }
    await expect(app.query(`select support_read_row_exists('public.branches', $1, $1)`, [crypto.randomUUID()])).rejects.toMatchObject({ code: "42501" });
    await expect(consoleDb.query(`select support_session_owner_decide($1, true)`, [crypto.randomUUID()])).rejects.toMatchObject({ code: "42501" });
    await expect(opDb.query(`select support_sessions_for_owner()`)).rejects.toMatchObject({ code: "42501" });
  });
});
