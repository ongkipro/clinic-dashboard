// T-027 Done-when: scenario PR-59 (go-live gate). Go-live (onboarding → live) is refused naming its
// first blocker while an onboarding checklist item is open, while the vendor has fewer than two
// TOTP-enrolled vendor staff (maker-checker), and while the clinical go-live evidence (PR-97, Q-07:
// authority matrix, appointments, SOPs) is unapproved; once all are cleared it succeeds and the
// go-live date (billing start) is recorded. Plus: seeding per tenant and branch, the checklist
// console's role, state, input and cross-tenant refusals, reactivation unaffected, no direct access.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { decideEvidence, uploadEvidence } from "../../src/modules/compliance/compliance";
import { checklist, setChecklistItem } from "../../src/modules/vendor/checklist/checklist";
import { blockerLabel } from "../../src/modules/vendor/checklist/labels";
import { assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { applyLifecycleRequest } from "../../src/modules/vendor/lifecycle/lifecycle";
import { bootstrapVendor, createVendorStaff, decideVendorRequest, requestVendorAction, type VendorCaller } from "../../src/modules/vendor/staff/staff";
import { advanceTenant } from "../../src/modules/vendor/tenants/tenants";
import { createHarness, type Harness } from "../rls/harness";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let exec: pg.Pool;
let opPool: pg.Pool;
let op: pg.PoolClient;
let consoleDb: pg.Pool;
let n = 0;
const IP = "203.0.113.10";
const caller = (accountId: string): VendorCaller => ({ accountId, ip: IP, mfaAt: new Date() });

let PO: string; let PO2: string; let FIN: string; let ONB: string; let SUP: string;
let POTok: string; let ONBTok: string; let SUPTok: string; let FINTok: string;
let ONBId: string;

async function account(totp = true): Promise<string> {
  return (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('V', $1, $2) returning id`, [`ck${++n}@vendor-sintetis.test`, totp])).rows[0].id as string;
}
async function session(acc: string): Promise<string> {
  const tok = `tok${++n}${"x".repeat(30)}`;
  await h.admin.query(`insert into auth_session (user_id, token, expires_at, surface, second_factor_at) values ($1, $2, now() + interval '8 hours', 'vendor', now())`, [acc, tok]);
  return tok;
}

type Clinic = { tenantId: string; b1: string; b2: string; ownerAcc: string };
// A clinic with an approved processor agreement, two branches, an Owner and a facility head.
async function clinic(): Promise<Clinic> {
  const tenantId = (await h.admin.query(`insert into tenants_registry default values returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Klinik Ceklis', 'emkm')`, [tenantId]);
  const br = async (code: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, code])).rows[0].id as string;
  const b1 = await br("CB1");
  const b2 = await br("CB2");
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ('O', $1) returning id`, [`owner${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId, accountId: acc, displayName: `Owner ${n}` });
  await assignRole(h.admin, { tenantId, staffId, role: "owner" });
  const c = { tenantId, b1, b2, ownerAcc: acc };
  await approveEvidence(c, "processor_agreement_signed");
  return c;
}
const asOwner = async <R>(c: Clinic, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, c.ownerAcc, { tenantId: c.tenantId, actingRole: "owner" }), fn);
async function approveEvidence(c: Clinic, key: string) {
  const pdf = Buffer.from(`%PDF-1.7\n${key} sintetis ${++n}\n%%EOF\n`);
  const file = await asOwner(c, (db) => uploadEvidence(db, { obligationKey: key, fileName: `${key}.pdf`, content: pdf, expertName: "Konsultan Sintetis", documentDate: "2026-10-01" }));
  const item = (await h.admin.query(`select item_id from evidence_files where id = $1`, [file.fileId])).rows[0].item_id;
  await asOwner(c, (db) => decideEvidence(db, item, file.fileId, "approved"));
}
const CLINICAL = ["clinical_authority_matrix", "sop_downtime", "sop_incident", "sop_waste", "appointment_responsible_person", "appointment_pharmacist"];
const TENANT_ITEMS = ["entity_tax", "catalog", "staff_credentials", "money_settings", "payment_port", "waba", "satusehat"];
const advance = (c: Clinic, to: string, tok = POTok) => advanceTenant(consoleDb, { token: tok, ip: IP }, c.tenantId, to, `Langkah siklus ${to} untuk uji ceklis`);
const set = (c: Clinic, item: string, status: string, o: { branchId?: string | null; note?: string; ownerId?: string | null; tok?: string; tenantId?: string } = {}) =>
  setChecklistItem(consoleDb, { token: o.tok ?? ONBTok, ip: IP }, o.tenantId ?? c.tenantId, { branchId: o.branchId ?? null, item, status, note: o.note ?? "", ownerId: o.ownerId ?? null });
const read = (c: Clinic, tok = SUPTok) => checklist(consoleDb, { token: tok, ip: IP }, c.tenantId);
const state = async (t: string) => (await h.admin.query(`select lifecycle_state from tenants_registry where id = $1`, [t])).rows[0].lifecycle_state as string;
const lastLog = async () => (await h.admin.query(`select action, outcome, reason_code from vendor_actions order by seq desc limit 1`)).rows[0];
beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 4 });
  owner = new pg.Pool({ connectionString: h.ownerUrl(), max: 2 });
  exec = new pg.Pool({ connectionString: h.urlAs(await h.createLoginRole("", ["clinic_executor"])), max: 2 });
  opPool = new pg.Pool({ connectionString: h.ownerUrl(), max: 1 });
  op = await opPool.connect();
  consoleDb = new pg.Pool({ connectionString: h.urlAs(await h.createLoginRole("", ["clinic_vendor"])), max: 3 });
  // Vendor profile complete (PR-55): Indonesian storage, no placeholders, so only the maker-checker
  // part of vendor_go_live_blockers() depends on the vendor staff below.
  await h.admin.query(
    `update vendor_profile set legal_name = 'PT Sintetis Teknologi Klinik', nib = '1234567890123', pse_number = '000123.01/DJAI.PSE/11/2026',
       npwp = '0123456789012345', meta_business_id = '123456789012345', website = 'https://vendor-sintetis.example',
       privacy_url = 'https://vendor-sintetis.example/privasi', support_email = 'dukungan@vendor-sintetis.example', support_phone = '+6281234567890',
       placeholder_fields = '{}', storage_locations = $1::jsonb where id = 1`,
    [JSON.stringify(["database", "object_storage", "backups", "logs", "error_tracking"].map((kind) => ({ kind, provider: "Penyedia Lokal", region: "Jakarta", country: "ID" })))]);
  PO = await account();
  await bootstrapVendor(op, PO, "Pemilik Platform", "203.0.113.0/24", "Kantor vendor");
  PO2 = await account();
  ONB = await account();
  SUP = await account();
  await createVendorStaff(op, caller(PO), PO2, "Pemilik Platform Kedua", ["platform_owner"]);
  ONBId = await createVendorStaff(op, caller(PO), ONB, "Onboarding Vendor", ["onboarding"]);
  await createVendorStaff(op, caller(PO), SUP, "Dukungan Vendor", ["support"]);
  POTok = await session(PO);
  ONBTok = await session(ONB);
  SUPTok = await session(SUP);
});

afterAll(async () => {
  op?.release();
  await opPool?.end();
  await consoleDb?.end();
  await exec?.end();
  await owner?.end();
  await app?.end();
  await h?.close();
});

describe("scenario PR-59 go-live gate", () => {
  let c: Clinic;

  it("entering onboarding creates the checklist per tenant and per branch; a later branch gets its item", async () => {
    c = await clinic();
    expect((await read(c)).ok && (await read(c) as { ok: true; data: { items: unknown[] } }).data.items).toEqual([]);
    expect(await advance(c, "onboarding", ONBTok)).toMatchObject({ ok: true });
    const r = await read(c);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.items.filter((i) => !i.branch_id).map((i) => i.item).sort()).toEqual([...TENANT_ITEMS].sort());
    expect(r.data.items.filter((i) => i.branch_id).map((i) => [i.item, i.branch_code])).toEqual([["branch_setup", "CB1"], ["branch_setup", "CB2"]]);
    expect(r.data.items.every((i) => i.status === "open")).toBe(true);
    expect(r.data.go_live_at).toBeNull();
    const b3 = (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'CB3', 'CB3', 'Asia/Jakarta') returning id`, [c.tenantId])).rows[0].id as string;
    const after = await read(c);
    expect(after.ok && after.data.items.filter((i) => i.branch_id).map((i) => i.branch_code)).toEqual(["CB1", "CB2", "CB3"]);
    expect(await set(c, "branch_setup", "done", { branchId: b3 })).toMatchObject({ ok: true });
  });

  it("go-live is refused naming the first open checklist item; nothing changes", async () => {
    // The vendor has two staff with TOTP, but not the vendor-finance checker yet (see below).
    const r = await advance(c, "live");
    expect(r).toMatchObject({ ok: false, code: "ERR_FORBIDDEN", reason: "go_live_blocked", blocker: "checklist:catalog" });
    expect(await lastLog()).toEqual({ action: "tenant_live", outcome: "denied", reason_code: "go_live_blocked" });
    expect(await state(c.tenantId)).toBe("onboarding");
    expect((await h.admin.query(`select count(*)::int n from tenant_lifecycle_events where tenant_id = $1 and to_state = 'live'`, [c.tenantId])).rows[0].n).toBe(0);
    // One branch item left open: named with its branch code.
    for (const k of ["entity_tax", "catalog", "staff_credentials", "money_settings"]) await set(c, k, "done");
    for (const k of ["payment_port", "waba", "satusehat"]) await set(c, k, "not_applicable", { note: "Belum dipakai klinik ini" });
    await set(c, "branch_setup", "done", { branchId: c.b1 });
    expect(await advance(c, "live")).toMatchObject({ ok: false, reason: "go_live_blocked", blocker: "checklist:branch_setup@CB2" });
    await set(c, "branch_setup", "done", { branchId: c.b2 });
  });

  // vendor_go_live_blockers' maker-checker (0032): an active TOTP platform owner plus a different active TOTP
  // vendor-finance member. Here the vendor has platform owners, onboarding and support but no finance checker.
  it("go-live is refused while the vendor lacks its maker-checker pair (no active vendor-finance checker)", async () => {
    const r = await advance(c, "live");
    expect(r).toMatchObject({ ok: false, reason: "go_live_blocked", blocker: "vendor:vendor_staff_maker_checker" });
    FIN = await account();
    await createVendorStaff(op, caller(PO), FIN, "Keuangan Vendor", ["vendor_finance"]);
    FINTok = await session(FIN);
  });

  it("go-live is refused while the clinical go-live evidence is unapproved (PR-97, Q-07)", async () => {
    expect(await advance(c, "live")).toMatchObject({ ok: false, reason: "go_live_blocked", blocker: "clinical:appointment_pharmacist" });
    for (const k of CLINICAL.filter((x) => x !== "clinical_authority_matrix")) await approveEvidence(c, k);
    // The authority matrix (Q-07) alone still blocks.
    expect(await advance(c, "live")).toMatchObject({ ok: false, reason: "go_live_blocked", blocker: "clinical:clinical_authority_matrix" });
    const r = await read(c);
    expect(r.ok && r.data.blockers).toEqual(["clinical:clinical_authority_matrix"]);
    await approveEvidence(c, "clinical_authority_matrix");
  });

  it("with every blocker cleared go-live succeeds and the go-live date (billing start) is recorded", async () => {
    const r0 = await read(c);
    expect(r0.ok && r0.data.blockers).toEqual([]);
    expect(await advance(c, "live", ONBTok)).toMatchObject({ ok: false, reason: "role_not_held" }); // platform owner confirms
    const before = Date.now();
    expect(await advance(c, "live")).toEqual({ ok: true, data: { ok: true, state: "live" } });
    expect(await state(c.tenantId)).toBe("live");
    const at = (await h.admin.query(`select tenant_go_live_at($1) as at`, [c.tenantId])).rows[0].at as Date;
    expect(at.getTime()).toBeGreaterThanOrEqual(before - 5_000);
    const r = await read(c);
    expect(r.ok && new Date(r.data.go_live_at!).getTime()).toBe(at.getTime());
    // After go-live the checklist is history: no more edits.
    expect(await set(c, "catalog", "open")).toMatchObject({ ok: false, code: "ERR_VERSION_CONFLICT", reason: "not_onboarding" });
  });

  it("the go-live date is the first onboarding → live; reactivation is not gated and keeps it", async () => {
    const first = (await h.admin.query(`select tenant_go_live_at($1) as at`, [c.tenantId])).rows[0].at as Date;
    // Suspension: requested by vendor finance, approved by a platform owner. Reactivation: requested by a
    // platform owner, approved by another (T-022 maker-checker).
    const req = (kind: "suspension" | "reactivation") => requestVendorAction(op, caller(kind === "suspension" ? FIN : PO), c.tenantId, { kind }, `Permintaan ${kind} untuk uji ceklis`);
    const s = await req("suspension");
    expect(await decideVendorRequest(op, caller(PO), s, true)).toBe("approved");
    expect(await applyLifecycleRequest(exec, s, "suspension", c.tenantId, "lifecycle.worker")).toBe("suspended");
    // Reopen an item while suspended (direct, as an operator fix would): reactivation still goes through.
    await h.admin.query(`update onboarding_checklist_items set status = 'open' where tenant_id = $1 and item = 'catalog'`, [c.tenantId]);
    // A blocker exists now (the gate would refuse onboarding → live); reactivation must not consult it.
    expect((await h.admin.query(`select tenant_go_live_blockers($1) as b`, [c.tenantId])).rows[0].b).toEqual(["checklist:catalog"]);
    const re = await req("reactivation");
    expect(await decideVendorRequest(op, caller(PO2), re, true)).toBe("approved");
    expect(await applyLifecycleRequest(exec, re, "reactivation", c.tenantId, "lifecycle.worker")).toBe("live");
    // Reactivation adds a later suspended → live event; the go-live date stays the first onboarding → live.
    const lives = (await h.admin.query(`select from_state, at from tenant_lifecycle_events where tenant_id = $1 and to_state = 'live' order by seq`, [c.tenantId])).rows;
    expect(lives.map((x) => x.from_state)).toEqual(["onboarding", "suspended"]);
    expect(((await h.admin.query(`select tenant_go_live_at($1) as at`, [c.tenantId])).rows[0].at as Date).getTime()).toBe(first.getTime());
  });
});

// HYG-014 (DEC-045, PR-59): go-live re-checks the processor agreement. Onboarding needed it (TEN-12);
// an agreement revoked, or replaced by a new unapproved file, after onboarding must block go-live too.
describe("scenario PR-59: the processor agreement is checked again at go-live (HYG-014)", () => {
  // A clinic in onboarding with every other blocker cleared (checklist, clinical evidence, and the
  // vendor maker-checker pair, which the go-live scenario above creates; created here when this block
  // runs alone): only the agreement decides.
  async function readyClinic(): Promise<Clinic> {
    if (!FIN) {
      FIN = await account();
      await createVendorStaff(op, caller(PO), FIN, "Keuangan Vendor", ["vendor_finance"]);
      FINTok = await session(FIN);
    }
    const x = await clinic();
    expect(await advance(x, "onboarding", ONBTok)).toMatchObject({ ok: true });
    await h.admin.query(
      `update onboarding_checklist_items
          set status = CASE WHEN item IN ('payment_port','waba','satusehat') THEN 'not_applicable' ELSE 'done' END,
              note = CASE WHEN item IN ('payment_port','waba','satusehat') THEN 'Tidak dipakai dalam uji' END
        where tenant_id = $1`, [x.tenantId]);
    for (const k of CLINICAL) await approveEvidence(x, k);
    expect((await h.admin.query(`select tenant_go_live_blockers($1) as b`, [x.tenantId])).rows[0].b).toEqual([]);
    return x;
  }
  const agreementItem = async (x: Clinic) =>
    (await h.admin.query(`select id from evidence_items where tenant_id = $1 and obligation_key = 'processor_agreement_signed'`, [x.tenantId])).rows[0].id as string;
  const latestFile = async (item: string) =>
    (await h.admin.query(`select id from evidence_files where item_id = $1 order by version desc limit 1`, [item])).rows[0].id as string;

  it("an agreement revoked after onboarding: go-live is refused naming it; nothing changes; approved again, go-live succeeds", async () => {
    const x = await readyClinic();
    const item = await agreementItem(x);
    await asOwner(x, async (db) => decideEvidence(db, item, await latestFile(item), "revoked", "Perjanjian ditarik untuk ditinjau ulang"));
    const r = await advance(x, "live");
    expect(r).toMatchObject({ ok: false, reason: "go_live_blocked", blocker: "agreement:processor_agreement_signed" });
    expect(await state(x.tenantId)).toBe("onboarding");
    expect(await lastLog()).toEqual({ action: "tenant_live", outcome: "denied", reason_code: "go_live_blocked" });
    const c2 = await read(x);
    expect(c2.ok && c2.data.blockers).toEqual(["agreement:processor_agreement_signed"]);
    // Approved again (a new decision on the current file): go-live goes through.
    await asOwner(x, async (db) => decideEvidence(db, item, await latestFile(item), "approved"));
    expect(await advance(x, "live")).toEqual({ ok: true, data: { ok: true, state: "live" } });
  });

  it("an agreement replaced by a new unapproved version after onboarding blocks go-live, ahead of any open checklist item", async () => {
    const x = await readyClinic();
    const pdf = Buffer.from(`%PDF-1.7
processor_agreement_signed versi baru ${++n}
%%EOF
`);
    await asOwner(x, (db) => uploadEvidence(db, { obligationKey: "processor_agreement_signed", fileName: "dpa-v2.pdf", content: pdf, expertName: "Konsultan Sintetis", documentDate: "2026-11-01" }));
    await h.admin.query(`update onboarding_checklist_items set status = 'open' where tenant_id = $1 and item = 'catalog'`, [x.tenantId]);
    // Named first: no tenant data commitments go live without a current agreement (PRIV-8).
    expect((await h.admin.query(`select tenant_go_live_blockers($1) as b`, [x.tenantId])).rows[0].b).toEqual(["agreement:processor_agreement_signed", "checklist:catalog"]);
    expect(await advance(x, "live")).toMatchObject({ ok: false, reason: "go_live_blocked", blocker: "agreement:processor_agreement_signed" });
    expect(await state(x.tenantId)).toBe("onboarding");
  });

  // Mutation "agreement-state-only" (review of the mutation run): revoking and a new file both change the
  // item state; an expired agreement keeps state 'approved', so only evidence_item_open sees it.
  it("an agreement that expired since onboarding (still approved) blocks go-live", async () => {
    const x = await readyClinic();
    await h.admin.query(`update evidence_items set valid_until = current_date - 1 where tenant_id = $1 and obligation_key = 'processor_agreement_signed'`, [x.tenantId]);
    expect((await h.admin.query(`select state from evidence_items where tenant_id = $1 and obligation_key = 'processor_agreement_signed'`, [x.tenantId])).rows[0].state).toBe("approved");
    expect(await advance(x, "live")).toMatchObject({ ok: false, reason: "go_live_blocked", blocker: "agreement:processor_agreement_signed" });
    expect(await state(x.tenantId)).toBe("onboarding");
  });

  // Review notes (HYG-014 R3): a tenant without any agreement item at runtime; the console label;
  // reactivation (suspended -> live) is not the go-live gate, even with a revoked agreement.
  it("a tenant with no agreement item at all is blocked (runtime, not only the drift check)", async () => {
    // A tenant row without any evidence (as one created before compliance existed); its checklist is
    // not seeded either, so both are named, the agreement first.
    const bare = (await h.admin.query(`insert into tenants_registry default values returning id`)).rows[0].id as string;
    expect((await h.admin.query(`select count(*)::int as n from evidence_items where tenant_id = $1`, [bare])).rows[0].n).toBe(0);
    expect((await h.admin.query(`select tenant_go_live_blockers($1) as b`, [bare])).rows[0].b.slice(0, 2)).toEqual(["agreement:processor_agreement_signed", "checklist:not_seeded"]);
  });

  it("the console names the agreement blocker in Indonesian", () => {
    expect(blockerLabel("agreement:processor_agreement_signed")).toBe("Perjanjian pengolahan data belum berlaku (disetujui klinik di Kepatuhan)");
  });

  it("reactivation is not gated by a revoked agreement (only onboarding -> live is)", async () => {
    const x = await readyClinic();
    expect(await advance(x, "live")).toEqual({ ok: true, data: { ok: true, state: "live" } });
    const s1 = await requestVendorAction(op, caller(FIN), x.tenantId, { kind: "suspension" }, "Permintaan suspension untuk uji perjanjian");
    expect(await decideVendorRequest(op, caller(PO), s1, true)).toBe("approved");
    expect(await applyLifecycleRequest(exec, s1, "suspension", x.tenantId, "lifecycle.worker")).toBe("suspended");
    const item = await agreementItem(x);
    await asOwner(x, async (db) => decideEvidence(db, item, await latestFile(item), "revoked", "Perjanjian ditarik untuk ditinjau ulang"));
    expect((await h.admin.query(`select tenant_go_live_blockers($1) as b`, [x.tenantId])).rows[0].b).toEqual(["agreement:processor_agreement_signed"]);
    const re = await requestVendorAction(op, caller(PO), x.tenantId, { kind: "reactivation" }, "Permintaan reactivation untuk uji perjanjian");
    expect(await decideVendorRequest(op, caller(PO2), re, true)).toBe("approved");
    expect(await applyLifecycleRequest(exec, re, "reactivation", x.tenantId, "lifecycle.worker")).toBe("live");
  });

  it("another tenant's approved agreement does not satisfy this tenant", async () => {
    const x = await readyClinic();
    const item = await agreementItem(x);
    await asOwner(x, async (db) => decideEvidence(db, item, await latestFile(item), "revoked", "Perjanjian ditarik untuk ditinjau ulang"));
    await clinic(); // another tenant, its agreement approved
    expect((await h.admin.query(`select tenant_go_live_blockers($1) as b`, [x.tenantId])).rows[0].b).toEqual(["agreement:processor_agreement_signed"]);
  });
});

// Waits until a backend running `like` (its query text) is blocked on a lock held by `holder`
// (pg_blocking_pids), so an unrelated lock wait never releases the schedule early (review round 2).
async function waitBlocked(holder: pg.PoolClient, like: string) {
  const pid = (await holder.query(`select pg_backend_pid() as p`)).rows[0].p as number;
  for (let i = 0; i < 200; i++) {
    const r = await h.admin.query(`select 1 from pg_stat_activity where query like $1 and $2 = any (pg_blocking_pids(pid))`, [`%${like}%`, pid]);
    if (r.rowCount) return;
    await new Promise((res) => setTimeout(res, 25));
  }
  throw new Error(`no backend running ${like} became blocked by ${pid}`);
}

describe("concurrency (review round 1, P1): branches and checklist edits against lifecycle steps", () => {
  it("a branch inserted while the tenant enters onboarding still gets its item (either order)", async () => {
    const c = await clinic();
    // The branch transaction holds staff_access first; entering onboarding waits on it, then seeds the branch.
    const tx = await owner.connect();
    try {
      await tx.query("begin");
      const b3 = (await tx.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'CB3', 'CB3', 'Asia/Jakarta') returning id`, [c.tenantId])).rows[0].id as string;
      const step = advance(c, "onboarding", ONBTok);
      await waitBlocked(tx, "vendor_console_tenant_advance");
      await tx.query("commit");
      expect(await step).toMatchObject({ ok: true });
      const items = (await h.admin.query(`select branch_id from onboarding_checklist_items where tenant_id = $1 and item = 'branch_setup'`, [c.tenantId])).rows.map((r) => r.branch_id);
      expect(items.sort()).toEqual([c.b1, c.b2, b3].sort());
    } finally {
      tx.release();
    }
    // The other order: the transition holds the locks; the branch insert waits, then sees onboarding.
    const d = await clinic();
    const lc = await owner.connect();
    try {
      await lc.query("begin");
      await lc.query(`select pg_advisory_xact_lock(hashtextextended('staff_access:' || $1::text, 0))`, [d.tenantId]);
      await lc.query(`update tenants_registry set lifecycle_state = 'onboarding' where id = $1`, [d.tenantId]);
      await lc.query(`insert into tenant_lifecycle_events (tenant_id, from_state, to_state, reason, actor_kind, actor) values ($1, 'provisioning', 'onboarding', 'Uji urutan kunci cabang', 'service', 'test.order')`, [d.tenantId]);
      const ins = owner.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'CB4', 'CB4', 'Asia/Jakarta') returning id`, [d.tenantId]);
      await waitBlocked(lc, "insert into branches");
      await lc.query("commit");
      const b4 = (await ins).rows[0].id as string;
      expect((await h.admin.query(`select 1 from onboarding_checklist_items where tenant_id = $1 and branch_id = $2`, [d.tenantId, b4])).rowCount).toBe(1);
    } finally {
      lc.release();
    }
  });

  it("a branch inserted while go-live waits is a blocker the gate sees (no go-live without its item)", async () => {
    const c = await clinic();
    expect(await advance(c, "onboarding", ONBTok)).toMatchObject({ ok: true });
    const { clearGoLiveBlockers } = await import("./go-live-ready");
    await clearGoLiveBlockers(h.admin, app, c.tenantId, c.ownerAcc);
    const tx = await owner.connect();
    try {
      await tx.query("begin");
      await tx.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'CB9', 'CB9', 'Asia/Jakarta')`, [c.tenantId]);
      const live = advance(c, "live");
      await waitBlocked(tx, "vendor_console_tenant_advance");
      await tx.query("commit");
      expect(await live).toMatchObject({ ok: false, reason: "go_live_blocked", blocker: "checklist:branch_setup@CB9" });
      expect(await state(c.tenantId)).toBe("onboarding");
    } finally {
      tx.release();
    }
  });

  it("a checklist edit reopening an item while go-live waits is seen by the gate", async () => {
    const c = await clinic();
    expect(await advance(c, "onboarding", ONBTok)).toMatchObject({ ok: true });
    const { clearGoLiveBlockers } = await import("./go-live-ready");
    await clearGoLiveBlockers(h.admin, app, c.tenantId, c.ownerAcc);
    // A transaction holding staff_access (as checklist_set does first) reopens catalog; go-live waits on it.
    const tx = await owner.connect();
    try {
      await tx.query("begin");
      await tx.query(`select pg_advisory_xact_lock(hashtextextended('staff_access:' || $1::text, 0))`, [c.tenantId]);
      await tx.query(`update onboarding_checklist_items set status = 'open' where tenant_id = $1 and item = 'catalog'`, [c.tenantId]);
      const live = advance(c, "live");
      await waitBlocked(tx, "vendor_console_tenant_advance");
      await tx.query("commit");
      expect(await live).toMatchObject({ ok: false, reason: "go_live_blocked", blocker: "checklist:catalog" });
    } finally {
      tx.release();
    }
  });
});

describe("blocker shapes and evidence scope (review round 1)", () => {
  it("an onboarding tenant with no items is blocked as not seeded", async () => {
    const c = await clinic();
    await h.admin.query(`update tenants_registry set lifecycle_state = 'onboarding' where id = $1`, [c.tenantId]);
    expect((await h.admin.query(`select tenant_go_live_blockers($1) as b`, [c.tenantId])).rows[0].b[0]).toBe("checklist:not_seeded");
  });

  it("another tenant's approved clinical evidence does not satisfy this tenant", async () => {
    const other = await clinic();
    for (const k of CLINICAL) await approveEvidence(other, k);
    const c = await clinic();
    const b = (await h.admin.query(`select tenant_go_live_blockers($1) as b`, [c.tenantId])).rows[0].b as string[];
    expect(b.filter((x) => x.startsWith("clinical:")).sort()).toEqual(CLINICAL.map((k) => `clinical:${k}`).sort());
  });

  it("vendor profile blockers are named with their field or kind, and the console maps them", async () => {
    const c = await clinic();
    expect(await advance(c, "onboarding", ONBTok)).toMatchObject({ ok: true });
    const { clearGoLiveBlockers } = await import("./go-live-ready");
    await clearGoLiveBlockers(h.admin, app, c.tenantId, c.ownerAcc);
    const prof = (await h.admin.query(`select npwp, storage_locations from vendor_profile where id = 1`)).rows[0];
    try {
      await h.admin.query(`update vendor_profile set npwp = '[NPWP]' where id = 1`);
      expect(await advance(c, "live")).toMatchObject({ ok: false, reason: "go_live_blocked", blocker: "vendor:placeholder:npwp" });
      await h.admin.query(`update vendor_profile set npwp = $1, storage_locations = '[]' where id = 1`, [prof.npwp]);
      expect(await advance(c, "live")).toMatchObject({ ok: false, reason: "go_live_blocked", blocker: "vendor:storage_undeclared:database" });
    } finally {
      await h.admin.query(`update vendor_profile set npwp = $1, storage_locations = $2 where id = 1`, [prof.npwp, JSON.stringify(prof.storage_locations)]);
    }
  });
});

describe("checklist console: roles, state, input, isolation", () => {
  let a: Clinic;
  let b: Clinic;

  beforeAll(async () => {
    a = await clinic();
    b = await clinic();
    expect(await advance(a, "onboarding", ONBTok)).toMatchObject({ ok: true });
    expect(await advance(b, "onboarding", ONBTok)).toMatchObject({ ok: true });
  });

  it("only onboarding and platform owners set items; every vendor role reads; refusals are logged", async () => {
    // The guard refuses first (vendor_guard logs checklist_set denied role_not_held); no row is touched.
    const stamp = async () => (await h.admin.query(`select updated_at, updated_by from onboarding_checklist_items where tenant_id = $1 and item = 'catalog'`, [a.tenantId])).rows[0];
    const s0 = await stamp();
    expect(await set(a, "catalog", "done", { tok: SUPTok })).toMatchObject({ ok: false, code: "ERR_FORBIDDEN", reason: "role_not_held" });
    expect(await lastLog()).toEqual({ action: "checklist_set", outcome: "denied", reason_code: "role_not_held" });
    expect(await set(a, "catalog", "done", { tok: FINTok })).toMatchObject({ ok: false, reason: "role_not_held" });
    expect(await lastLog()).toEqual({ action: "checklist_set", outcome: "denied", reason_code: "role_not_held" });
    expect(await stamp()).toEqual(s0);
    expect(await set(a, "catalog", "done", { tok: "x".repeat(40) })).toMatchObject({ ok: false, reason: "no_session" });
    expect(await set(a, "catalog", "done", { tok: POTok })).toMatchObject({ ok: true });
    expect(await set(a, "catalog", "done")).toMatchObject({ ok: true });
    expect(await lastLog()).toEqual({ action: "checklist_set", outcome: "success", reason_code: null });
    for (const tok of [SUPTok, FINTok, ONBTok, POTok]) expect((await read(a, tok)).ok).toBe(true);
  });

  it("input: not applicable only for the integrations and with a reason; unknown item, status or owner refused", async () => {
    expect(await set(a, "catalog", "not_applicable", { note: "Tidak dipakai" })).toMatchObject({ ok: false, code: "ERR_INVALID_INPUT" });
    expect(await set(a, "waba", "not_applicable")).toMatchObject({ ok: false, code: "ERR_INVALID_INPUT" });
    expect(await set(a, "waba", "not_applicable", { note: "Belum memakai WhatsApp" })).toMatchObject({ ok: true });
    expect(await set(a, "catalog", "maybe")).toMatchObject({ ok: false, code: "ERR_INVALID_INPUT" });
    expect(await set(a, "no_such_item", "done")).toMatchObject({ ok: false, code: "ERR_NOT_FOUND" });
    expect(await set(a, "catalog", "done", { note: "x".repeat(501) })).toMatchObject({ ok: false, code: "ERR_INVALID_INPUT" });
    // Owner must be active onboarding or platform-owner staff.
    const supId = (await h.admin.query(`select id from vendor_staff where account_id = $1`, [SUP])).rows[0].id;
    expect(await set(a, "catalog", "done", { ownerId: supId })).toMatchObject({ ok: false, code: "ERR_INVALID_INPUT" });
    expect(await set(a, "catalog", "done", { ownerId: ONBId, note: "Katalog awal dari klinik" })).toMatchObject({ ok: true });
    const r = await read(a);
    const cat = r.ok ? r.data.items.find((i) => i.item === "catalog" && !i.branch_id) : undefined;
    expect(cat).toMatchObject({ status: "done", owner_id: ONBId, owner: "Onboarding Vendor", note: "Katalog awal dari klinik", updated_by: "Onboarding Vendor" });
  });

  it("cross-tenant: tenant B's branch item is never found under tenant A's id; reads return only the asked tenant", async () => {
    expect(await set(a, "branch_setup", "done", { branchId: b.b1 })).toMatchObject({ ok: false, code: "ERR_NOT_FOUND" });
    const before = (await h.admin.query(`select status from onboarding_checklist_items where tenant_id = $1 and branch_id = $2`, [b.tenantId, b.b1])).rows[0].status;
    expect(before).toBe("open");
    const r = await read(a);
    expect(r.ok && r.data.items.every((i) => !i.branch_id || [a.b1, a.b2].includes(i.branch_id))).toBe(true);
    expect(r.ok && r.data.items.some((i) => i.branch_id === b.b1)).toBe(false);
  });

  it("a tenant not in onboarding: no edits; a provisioning tenant has no checklist yet", async () => {
    const p = await clinic();
    expect(await set(p, "catalog", "done")).toMatchObject({ ok: false, code: "ERR_NOT_FOUND" });
    expect(await advance(p, "live")).toMatchObject({ ok: false, reason: "not_a_step" });
  });

  it("no application role reads or writes the table; items are never deleted or moved", async () => {
    await expect(app.query(`select * from onboarding_checklist_items`)).rejects.toMatchObject({ code: "42501" });
    await expect(consoleDb.query(`select * from onboarding_checklist_items`)).rejects.toMatchObject({ code: "42501" });
    await expect(consoleDb.query(`select tenant_go_live_blockers($1)`, [a.tenantId])).rejects.toMatchObject({ code: "42501" });
    await expect(h.admin.query(`delete from onboarding_checklist_items where tenant_id = $1`, [a.tenantId])).rejects.toMatchObject({ code: "42501" });
    await expect(h.admin.query(`update onboarding_checklist_items set item = 'catalog' where tenant_id = $1 and item = 'waba'`, [a.tenantId])).rejects.toMatchObject({ code: "42501" });
    await expect(h.admin.query(`truncate onboarding_checklist_items`)).rejects.toBeTruthy();
  });
});
