// T-089 Done-when: scenario PR-27 against the mock Graph port and recorded fixtures (DEC-082: no live Meta call; `fetch` is spied and must never be
// called; the module holds no network client): Embedded Signup → the token sealed and the app subscribed (TD-20); numbers registered with
// `Brand – Branch` display names (W-08); the third number while unverified commits verification_required with no row and no register call (W-07);
// verification lifts the cap; display names and quality move the states; the BSP fallback migrates to Cloud API keeping its ids (W-09); the
// webhook revocation (TD-21) revokes tokens, numbers and routes, emits WabaRevoked and notifies the owner. Plus roles, branch scope, tenants,
// grants (the vault and the PIN unreadable), guards and the audit trail. Synthetic data (MIG-2); no network.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { decryptField, type KekRing } from "../../src/lib/keys/envelope";
import { setKekRingForTests } from "../../src/lib/keys/runtime";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { changeSetting } from "../../src/modules/settings/settings";
import { fixtureToken } from "../../src/modules/messaging/waba/fixtures";
import { MockGraphUnavailableError, mockWabaGraphPort } from "../../src/modules/messaging/waba/mock";
import type { StatusStep } from "../../src/modules/messaging/waba/fixtures";
import type { WabaGraphPort } from "../../src/modules/messaging/waba/port";
import {
  addWaNumber, completeWabaSignup, migrateWabaToCloudApi, revokeWaba, startWabaSignup, syncWabaStatus, wabaStatus,
} from "../../src/modules/messaging/waba/waba";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local";
const RING: KekRing = { current: 1, keys: new Map([[1, Buffer.alloc(32, 5)]]) };

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
  return { tenantId, b1: await br("WA1", "Kemang"), b2: await br("WA2", "Bintaro") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`waba${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf WA ${n}` });
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
// The webhook path: an unbound connection (no tenant context), as T-090's intake will call it.
async function unbound<R>(fn: (c: pg.PoolClient) => Promise<R>) {
  const c = await worker.connect();
  try {
    await c.query("begin");
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}
let phone = 0;
const num = (branchId: string | null = null, extra: { isCoexistence?: boolean; historySyncEnabled?: boolean } = {}) => {
  phone += 1;
  return { branchId, phoneNumber: `+62811${String(1000000 + phone)}`, phoneNumberId: `3${String(phone).padStart(14, "0")}${Math.floor(Math.random() * 1e6)}`, ...extra };
};
async function connected(o: P, codeName = "code-unverified", port?: WabaGraphPort, channel: "cloud_api" | "bsp_fallback" = "cloud_api") {
  const { wabaId } = await as(o, (db) => startWabaSignup(db, key(), { onboardingChannel: channel, bspProvider: channel === "bsp_fallback" ? "bsp_sintetis" : null }));
  const state = await as(o, (db) => completeWabaSignup(db, wabaId, codeName, { port, onboardingChannel: channel }));
  return { wabaId, state };
}
const fetchSpy = vi.fn();
let A: T; let B: T; let C: T; let D: T; let E: T;
let OWN: P; let ADM: P; let CS: P; let MKT: P; let AU: P; let MGR: P; let FO2: P; let BC: P; let FIN: P; let BOWN: P;

beforeAll(async () => {
  setKekRingForTests(RING);
  h = await createHarness();
  const login = h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE]));
  app = await openAppPool({ connectionString: login, max: 6 });
  worker = await openAppPool({ connectionString: login, max: 3 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant("PT Klinik Ayu Sintetis");
  B = await tenant("PT Klinik Bening Sintetis");
  C = await tenant("PT Klinik Cerah Sintetis");
  D = await tenant("PT Klinik Damai Sintetis");
  E = await tenant("PT Klinik Elok Sintetis");
  OWN = await person(A, "owner"); ADM = await person(A, "admin_pusat"); CS = await person(A, "central_cs"); MKT = await person(A, "marketing");
  AU = await person(A, "auditor"); MGR = await person(A, "manager", A.b1); FO2 = await person(A, "fo_cashier", A.b2); BC = await person(A, "bc", A.b1);
  FIN = await person(A, "finance"); BOWN = await person(B, "owner");
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

describe("T-089 no live Graph (DEC-082)", () => {
  it("the WABA module holds no network client", () => {
    const dir = join(__dirname, "../../src/modules/messaging/waba");
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src, f).not.toMatch(/\bfetch\s*\(|from\s+["'](node:)?(https?|net|tls|undici|axios)["']|graph\.facebook\.com|XMLHttpRequest|WebSocket/);
    }
  });
  it("the mock refuses production, and the definers refuse the mock's results in production", async () => {
    process.env.DEPLOY_ENV = "production";
    try {
      await expect(mockWabaGraphPort().exchangeCode({ code: "code-verified", onboardingChannel: "cloud_api" })).rejects.toBeInstanceOf(MockGraphUnavailableError);
    } finally {
      process.env.DEPLOY_ENV = "local";
    }
    const o = await person(C, "owner");
    const { wabaId } = await as(o, (db) => startWabaSignup(db, key(), { onboardingChannel: "cloud_api" }));
    // a stray key (e.g. a plaintext token) is refused by both definers that take a sealed token (failure-close2)
    const stray = (fn: string, p: Record<string, unknown>) => as(o, async (db) => {
      await db.query(`select set_config('app.deploy_env', 'local', true)`);
      return why(db.query(`select ${fn}($1, $2::jsonb)`, [wabaId, JSON.stringify(p)]));
    });
    const sealedOk = { encrypted_token: "v1.1.a.b.c", dek_ref: "dek:v1", token_kind: "system_user", granted_scopes: [], meta_waba_id: "100000000000009" };
    expect(await stray("waba_complete_signup", { ...sealedOk, meta_business_id: "200000000000009", business_verification_status: "unverified",
      portfolio_messaging_limit: 250, app_subscribed: true, access_token: "EAAPLAINTEXT" })).toBe("raw:22023");
    expect((await h.admin.query(`select count(*)::int c from token_vault where tenant_id = $1`, [C.tenantId])).rows[0].c).toBe(0);
    const r = await as(o, async (db) => {
      await db.query(`select set_config('app.deploy_env', 'production', true)`);
      return why(db.query(`select waba_complete_signup($1, '{"granted_scopes":[],"app_subscribed":true}'::jsonb)`, [wabaId]));
    });
    expect(r).toBe("raw:55000");
  });
});

describe("T-089 scenario PR-27 (Embedded Signup → numbers → the cap → verification)", () => {
  it("connects, seals the token, registers two numbers, refuses the third until verified", async () => {
    let step: StatusStep = "approved";
    const port = mockWabaGraphPort({ statusStep: () => step });
    const spyReg = vi.spyOn(port, "registerNumber");
    const { wabaId, state } = await connected(OWN, "code-unverified", port);
    expect(state).toBe("app_subscribed");
    expect(port.calls).toEqual(["exchangeCode", "subscribeApp"]);
    // the token sealed under the tenant DEK, never in plaintext; the reply carries metadata only
    const vault = (await h.admin.query(`select encrypted_token, dek_ref, token_kind, granted_scopes, revoked_at from token_vault where tenant_id = $1`, [A.tenantId])).rows;
    expect(vault).toHaveLength(1);
    expect(vault[0].encrypted_token).not.toContain(fixtureToken("code-unverified"));
    expect(vault[0].dek_ref).toBe("dek:v1");
    const keys = (await h.admin.query(`select version, wrapped from tenant_data_keys where tenant_id = $1`, [A.tenantId])).rows;
    expect(decryptField(RING, { tenantId: A.tenantId, current: { tenantId: A.tenantId, ...keys[0] }, byVersion: () => ({ tenantId: A.tenantId, ...keys[0] }) },
      "waba.token", vault[0].encrypted_token)).toBe(fixtureToken("code-unverified"));
    const st0 = await as(OWN, (db) => wabaStatus(db));
    expect(JSON.stringify(st0)).not.toContain("EAAFIXTURE");
    expect(st0.waba).toMatchObject({ state: "app_subscribed", business_verification_status: "unverified", portfolio_messaging_limit: 250,
      daily_outbound_budget: 200, has_active_token: true, token_kind: "business_integration_system_user", meta_waba_id: "100000000000001", sending_allowed: false });

    // two numbers: a branch number and a brand-wide one (W-03), the display names `Brand – Branch` / `Brand` (W-08)
    const n1 = await as(ADM, (db) => addWaNumber(db, key(), wabaId, num(A.b1), { port }));
    const n2 = await as(OWN, (db) => addWaNumber(db, key(), wabaId, num(null, { isCoexistence: true, historySyncEnabled: true }), { port }));
    expect(n1).toMatchObject({ ok: true, state: "display_name_pending", displayName: "PT Klinik Ayu Sintetis – Kemang" });
    expect(n2).toMatchObject({ ok: true, state: "display_name_pending", displayName: "PT Klinik Ayu Sintetis" });
    expect(spyReg).toHaveBeenCalledTimes(2);
    // the register call got the stored PIN (six digits), which is sealed at rest
    const pin = spyReg.mock.calls[0][0].pin;
    expect(pin).toMatch(/^\d{6}$/);
    const sealed = (await h.admin.query(`select registration_pin_enc, pin_dek_ref, is_coexistence, history_sync_enabled from wa_numbers where tenant_id = $1 order by added_at`, [A.tenantId])).rows;
    expect(sealed[0].registration_pin_enc).not.toContain(pin);
    // the register call used exactly the sealed PIN (failure-close2)
    const keyRows = (await h.admin.query(`select version, wrapped from tenant_data_keys where tenant_id = $1`, [A.tenantId])).rows;
    const tk = { tenantId: A.tenantId, current: { tenantId: A.tenantId, ...keyRows[0] }, byVersion: () => ({ tenantId: A.tenantId, ...keyRows[0] }) };
    expect(decryptField(RING, tk, "waba.pin", sealed[0].registration_pin_enc)).toBe(pin);
    // a PIN never opens as a token (purpose-bound AAD; review r1 P3-1)
    expect(() => decryptField(RING, tk, "waba.token", sealed[0].registration_pin_enc)).toThrow();
    expect(decryptField(RING, tk, "waba.pin", sealed[1].registration_pin_enc)).toBe(spyReg.mock.calls[1][0].pin);
    expect(sealed[0].pin_dek_ref).toBe("dek:v1");
    expect(sealed[1]).toMatchObject({ is_coexistence: true, history_sync_enabled: true });
    expect((await h.admin.query(`select count(*)::int c from waba_routes where tenant_id = $1 and active`, [A.tenantId])).rows[0].c).toBe(2);
    expect((await as(OWN, (db) => wabaStatus(db))).waba!.state).toBe("display_name_pending");

    // the third number while unverified: verification_required COMMITTED, no row, no register call, a denied audit row (W-07)
    const third = await as(OWN, (db) => addWaNumber(db, key(), wabaId, num(A.b2), { port }));
    expect(third).toMatchObject({ ok: false, code: "verification_required", wabaState: "verification_required" });
    // the live numbers still send while verification is required (review r1 P2-1)
    expect((await as(OWN, (db) => wabaStatus(db))).waba).toMatchObject({ state: "verification_required", sending_allowed: true });
    expect(spyReg).toHaveBeenCalledTimes(2);
    expect((await h.admin.query(`select count(*)::int c from wa_numbers where tenant_id = $1`, [A.tenantId])).rows[0].c).toBe(2);
    expect((await h.admin.query(`select state, previous_state from waba_accounts where id = $1`, [wabaId])).rows[0]).toEqual({ state: "verification_required", previous_state: "display_name_pending" });
    expect((await h.admin.query(`select count(*)::int c from audit_events where tenant_id = $1 and action = 'access_denied' and object_id = $2 and reason_code = 'verification_required'`, [A.tenantId, wabaId])).rows[0].c).toBe(1);

    // the names approved while still unverified: verification_required holds
    expect(await as(OWN, (db) => syncWabaStatus(db, wabaId, { port }))).toBe("verification_required");
    // verified: the state recovers to the numbers' (active), and a third number goes through
    step = "verified";
    expect(await as(OWN, (db) => syncWabaStatus(db, wabaId, { port }))).toBe("active");
    expect((await h.admin.query(`select previous_state, business_verification_status, portfolio_messaging_limit from waba_accounts where id = $1`, [wabaId])).rows[0])
      .toEqual({ previous_state: null, business_verification_status: "verified", portfolio_messaging_limit: 1000 });
    const n3 = await as(OWN, (db) => addWaNumber(db, key(), wabaId, num(A.b2), { port }));
    expect(n3).toMatchObject({ ok: true, displayName: "PT Klinik Ayu Sintetis – Bintaro" });
    const st = await as(OWN, (db) => wabaStatus(db));
    expect(st.waba).toMatchObject({ state: "active", daily_outbound_budget: 800, sending_allowed: true });
    expect(st.numbers.map((x) => x.state)).toEqual(["active", "active", "display_name_pending"]);

    // quality red on the first number → quality_restricted, back when green
    step = "red";
    expect(await as(OWN, (db) => syncWabaStatus(db, wabaId, { port }))).toBe("quality_restricted");
    step = "green";
    expect(await as(OWN, (db) => syncWabaStatus(db, wabaId, { port }))).toBe("active");
    expect((await h.admin.query(`select business_verification_status from waba_accounts where id = $1`, [wabaId])).rows[0].business_verification_status).toBe("verified");

    // branch scope: the Kemang manager and BC see Kemang and brand-wide numbers, the Bintaro FO Bintaro and brand-wide; the auditor, CS and
    // marketing all; nobody reads a PIN or the token
    const seen = async (p: P) => (await as(p, (db) => wabaStatus(db))).numbers.map((x) => x.display_name).sort();
    expect(await seen(MGR)).toEqual(["PT Klinik Ayu Sintetis", "PT Klinik Ayu Sintetis – Kemang"]);
    expect(await seen(BC)).toEqual(["PT Klinik Ayu Sintetis", "PT Klinik Ayu Sintetis – Kemang"]);
    expect(await seen(FO2)).toEqual(["PT Klinik Ayu Sintetis", "PT Klinik Ayu Sintetis – Bintaro"]);
    for (const p of [AU, CS, MKT]) expect(await seen(p)).toHaveLength(3);
    expect((await as(AU, (db) => wabaStatus(db))).can_manage).toBe(false);
    expect(await code(as(FIN, (db) => wabaStatus(db)))).toBe("ERR_FORBIDDEN");
    // the table reads under RLS match the reader
    expect((await as(MGR, (db) => db.query(`select id from wa_numbers`))).rows).toHaveLength(2);
    expect(await code(as(MGR, (db) => db.query(`select registration_pin_enc from wa_numbers`)))).toBe("raw:42501");
    expect(await code(as(OWN, (db) => db.query(`select * from token_vault`)))).toBe("raw:42501");
    expect(await code(as(OWN, (db) => db.query(`select * from waba_routes`)))).toBe("raw:42501");
  });

  it("an add is idempotent: the replay registers with the stored PIN and inserts nothing new", async () => {
    const o = await person(D, "owner");
    const port = mockWabaGraphPort();
    const { wabaId } = await connected(o, "code-verified", port);
    const k = key();
    const nn = num(D.b1);
    const first = await as(o, (db) => addWaNumber(db, k, wabaId, nn, { port }));
    const again = await as(o, (db) => addWaNumber(db, k, wabaId, nn, { port }));
    expect(again).toMatchObject({ ok: true, replayed: true, waNumberId: (first as { waNumberId: string }).waNumberId });
    // the definer's own replay (below the idempotency record): the same key answers the stored number, whatever the body
    const direct = await as(o, async (db) => (await db.query(`select waba_add_number($1, $2, '{}'::jsonb) r`, [k, wabaId])).rows[0].r);
    expect(direct).toMatchObject({ ok: true, replayed: true, wa_number_id: (first as { waNumberId: string }).waNumberId });
    expect((await h.admin.query(`select count(*)::int c from wa_numbers where tenant_id = $1`, [D.tenantId])).rows[0].c).toBe(1);
    // the same number again under a new key: taken
    expect(await code(as(o, (db) => addWaNumber(db, key(), wabaId, nn, { port })))).toBe("ERR_VERSION_CONFLICT");
    // history sync needs Coexistence (W-04; review r1 P3-1)
    expect(await code(as(o, (db) => addWaNumber(db, key(), wabaId, num(D.b2, { isCoexistence: false, historySyncEnabled: true }), { port })))).toBe("ERR_INVALID_INPUT");
    // a second WABA while one is live: refused
    expect(await why(as(o, (db) => startWabaSignup(db, key(), { onboardingChannel: "cloud_api" })))).toBe("ERR_VERSION_CONFLICT:waba_exists");
    // a Meta WABA already connected to another tenant: a coded conflict, not a raw error
    const other = await person(await tenant("PT Klinik Gita Sintetis"), "owner");
    const { wabaId: ew } = await as(other, (db) => startWabaSignup(db, key(), { onboardingChannel: "cloud_api" }));
    expect(await why(as(other, (db) => completeWabaSignup(db, ew, "code-verified", { port })))).toBe("ERR_VERSION_CONFLICT:waba_taken");
  });
});

describe("T-089 roles and tenants", () => {
  it("only the owner and admin_pusat onboard; another tenant sees and touches nothing", async () => {
    for (const p of [CS, MKT, AU, MGR, FO2, BC, FIN]) {
      expect(await code(as(p, (db) => startWabaSignup(db, key(), { onboardingChannel: "cloud_api" }))), p.role).toBe("ERR_FORBIDDEN");
      expect(await code(as(p, (db) => db.query(`select waba_revoke(gen_random_uuid(), 'manual')`))), p.role).toBe("raw:42501");
    }
    const aWaba = (await h.admin.query(`select id from waba_accounts where tenant_id = $1`, [A.tenantId])).rows[0].id as string;
    const bView = await as(BOWN, (db) => wabaStatus(db));
    expect(bView.waba).toBeNull();
    expect(await code(as(BOWN, (db) => addWaNumber(db, key(), aWaba, num(B.b1))))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BOWN, (db) => syncWabaStatus(db, aWaba)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BOWN, (db) => revokeWaba(db, aWaba, "manual")))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BOWN, (db) => migrateWabaToCloudApi(db, aWaba, "code-cloud-after-bsp")))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BOWN, (db) => db.query(`select * from waba_sealed_token($1)`, [aWaba])))).toBe("raw:P0002");
    // the definers themselves filter by the caller's tenant (not only the TS pre-check)
    for (const q of [`select waba_sync_status($1, '{}'::jsonb)`, `select waba_migrate_to_cloud_api($1, '{"granted_scopes":[]}'::jsonb)`,
      `select waba_complete_signup($1, '{"granted_scopes":[],"app_subscribed":true}'::jsonb)`, `select waba_revoke($1, 'manual')`,
      `select waba_add_number('k-cross-0001', $1, '{}'::jsonb)`]) {
      expect(await code(as(BOWN, async (db) => {
        await db.query(`select set_config('app.deploy_env', 'local', true)`);
        return db.query(q, [aWaba]);
      })), q).toBe("raw:P0002");
    }
    expect((await as(BOWN, (db) => db.query(`select id from waba_accounts`))).rows).toHaveLength(0);
  });
  it("a suspended tenant cannot onboard (configuration capability)", async () => {
    const o = await person(E, "owner");
    await h.admin.query(`update tenants_registry set lifecycle_state = 'suspended' where id = $1`, [E.tenantId]);
    try {
      expect(await code(as(o, (db) => startWabaSignup(db, key(), { onboardingChannel: "cloud_api" })))).toBe("ERR_TENANT_SUSPENDED");
    } finally {
      await h.admin.query(`update tenants_registry set lifecycle_state = 'live' where id = $1`, [E.tenantId]);
    }
  });
});

describe("T-089 BSP fallback (W-09) and revocation (TD-21)", () => {
  it("migrates a BSP WABA to Cloud API keeping its ids and routes, then a webhook revocation stops everything", async () => {
    const o = await person(B, "admin_pusat");
    const port = mockWabaGraphPort();
    const { wabaId } = await connected(o, "code-bsp", port, "bsp_fallback");
    const nb = await as(o, (db) => addWaNumber(db, key(), wabaId, num(B.b1), { port }));
    expect(nb.ok).toBe(true);
    const before = (await h.admin.query(`select phone_number_id, wa_number_id from waba_routes where tenant_id = $1`, [B.tenantId])).rows;
    expect(await as(o, async (db) => {
      await db.query(`select set_config('app.deploy_env', 'local', true)`);
      return why(db.query(`select waba_migrate_to_cloud_api($1, $2::jsonb)`, [wabaId, JSON.stringify({ encrypted_token: "v1.1.a.b.c", dek_ref: "dek:v1",
        token_kind: "system_user", granted_scopes: [], meta_waba_id: "100000000000003", access_token: "EAAPLAINTEXT" })]));
    })).toBe("raw:22023");
    expect(await as(o, (db) => migrateWabaToCloudApi(db, wabaId, "code-cloud-after-bsp", { port }))).toBe("cloud_api");
    expect(await code(as(o, (db) => migrateWabaToCloudApi(db, wabaId, "code-cloud-after-bsp", { port })))).toBe("ERR_VERSION_CONFLICT");
    const tokens = (await h.admin.query(`select token_kind, revoked_reason from token_vault where tenant_id = $1 order by created_at`, [B.tenantId])).rows;
    expect(tokens).toEqual([{ token_kind: "bsp_api_key", revoked_reason: "migrated" }, { token_kind: "business_integration_system_user", revoked_reason: null }]);
    expect((await h.admin.query(`select onboarding_channel, bsp_provider, meta_waba_id from waba_accounts where id = $1`, [wabaId])).rows[0])
      .toEqual({ onboarding_channel: "cloud_api", bsp_provider: null, meta_waba_id: "100000000000003" });
    expect((await h.admin.query(`select phone_number_id, wa_number_id from waba_routes where tenant_id = $1`, [B.tenantId])).rows).toEqual(before);

    // the route resolves on the unbound webhook path only
    const pid = before[0].phone_number_id as string;
    expect((await unbound((c) => c.query(`select * from waba_route_resolve($1)`, [pid]))).rows[0]).toMatchObject({ tenant_id: B.tenantId, wa_number_id: before[0].wa_number_id, branch_id: B.b1 });
    expect(await code(as(o, (db) => db.query(`select * from waba_route_resolve($1)`, [pid])))).toBe("raw:42501");
    expect(await code(as(o, (db) => db.query(`select waba_webhook_account_update('100000000000003', 'partner_removed', '{}'::jsonb)`)))).toBe("raw:42501");
    // a quality update recorded, then the revocation
    expect((await unbound((c) => c.query(`select waba_webhook_account_update('100000000000003', 'quality_update', $1::jsonb) r`,
      [JSON.stringify({ phone_number_id: pid, quality_rating: "red" })]))).rows[0].r).toBe("recorded");
    expect((await h.admin.query(`select state from wa_numbers where phone_number_id = $1`, [pid])).rows[0].state).toBe("quality_restricted");
    expect((await unbound((c) => c.query(`select waba_webhook_account_update('100000000000003', 'partner_removed', '{}'::jsonb) r`))).rows[0].r).toBe("revoked");
    expect((await unbound((c) => c.query(`select waba_webhook_account_update('100000000000003', 'partner_removed', '{}'::jsonb) r`))).rows[0].r).toBe("unknown");
    expect((await unbound((c) => c.query(`select waba_webhook_account_update('999', 'partner_removed', '{}'::jsonb) r`))).rows[0].r).toBe("unknown");
    expect((await h.admin.query(`select count(*)::int c from token_vault where tenant_id = $1 and revoked_at is null`, [B.tenantId])).rows[0].c).toBe(0);
    expect((await h.admin.query(`select state from wa_numbers where tenant_id = $1`, [B.tenantId])).rows.map((r) => r.state)).toEqual(["revoked"]);
    expect((await unbound((c) => c.query(`select * from waba_route_resolve($1)`, [pid]))).rows).toHaveLength(0);
    const st = await as(o, (db) => wabaStatus(db));
    expect(st.waba).toMatchObject({ state: "revoked", has_active_token: false, sending_allowed: false });
    const ev = (await h.admin.query(`select type, payload from domain_events where tenant_id = $1 and type = 'WabaRevoked'`, [B.tenantId])).rows;
    expect(ev).toEqual([{ type: "WabaRevoked", payload: { waba_id: wabaId, reason: "partner_removed" } }]);
    expect((await h.admin.query(`select recipient_role, subject_kind, subject_id from notifications where tenant_id = $1 and type = 'waba_revoked'`, [B.tenantId])).rows)
      .toEqual([{ recipient_role: "owner", subject_kind: "waba_account", subject_id: wabaId }]);
    expect((await h.admin.query(`select service_identity, outcome from audit_events where tenant_id = $1 and reason_code = 'waba_revoked'`, [B.tenantId])).rows)
      .toEqual([{ service_identity: "meta_webhook", outcome: "success" }]);
    // revoked is final; a new signup may start
    expect(await code(as(o, (db) => addWaNumber(db, key(), wabaId, num(B.b2), { port })))).toBe("ERR_VERSION_CONFLICT");
    expect(await code(as(o, (db) => syncWabaStatus(db, wabaId, { port })))).toBe("ERR_VERSION_CONFLICT");
    expect(await code(as(o, (db) => startWabaSignup(db, key(), { onboardingChannel: "cloud_api" })))).toBe("ok");
  });

  it("an interactive revoke by the owner does the same, once", async () => {
    const o = await person(C, "admin_pusat");
    const port = mockWabaGraphPort();
    const wabaId = (await h.admin.query(`select id from waba_accounts where tenant_id = $1`, [C.tenantId])).rows[0].id as string;
    expect(await code(as(o, (db) => completeWabaSignup(db, wabaId, "code-verified-2", { port })))).toBe("ok");
    await as(o, (db) => addWaNumber(db, key(), wabaId, num(C.b1), { port }));
    expect(await why(as(o, (db) => revokeWaba(db, wabaId, "Bad Reason")))).toBe("ERR_INVALID_INPUT:reason");
    await as(o, (db) => revokeWaba(db, wabaId, "manual"));
    await as(o, (db) => revokeWaba(db, wabaId, "manual"));
    expect((await h.admin.query(`select count(*)::int c from notifications where tenant_id = $1 and type = 'waba_revoked'`, [C.tenantId])).rows[0].c).toBe(1);
    expect((await h.admin.query(`select count(*)::int c from waba_routes where tenant_id = $1 and active`, [C.tenantId])).rows[0].c).toBe(0);
    expect((await h.admin.query(`select staff_id, acting_role from audit_events where tenant_id = $1 and reason_code = 'waba_revoked'`, [C.tenantId])).rows[0])
      .toEqual({ staff_id: o.staffId, acting_role: "admin_pusat" });
  });
});

describe("T-089 review r1: states, settings and the verified cap", () => {
  it("SET-1 names the brand, SET-21 sets the budget; declined names stay pending; none stays registered; the webhook verifies; 20 numbers cap", async () => {
    const t = await tenant("PT Klinik Fajar Sintetis");
    const o = await person(t, "owner");
    await as(o, (db) => changeSetting(db, { key: "SET-1", branchId: null, value: { nama: "Fajar Glow", aksen: "#0A6E86" }, reason: "Nama tampil" }));
    await as(o, (db) => changeSetting(db, { key: "SET-21", branchId: null, value: 50, reason: "Batas kirim" }));
    let step: StatusStep = "declined";
    const port = mockWabaGraphPort({ statusStep: () => step });
    const { wabaId } = await connected(o, "code-unverified-2", port);
    const n1 = await as(o, (db) => addWaNumber(db, key(), wabaId, num(t.b1), { port }));
    expect(n1).toMatchObject({ ok: true, displayName: "Fajar Glow – Kemang", state: "display_name_pending" });
    expect((await as(o, (db) => wabaStatus(db))).waba).toMatchObject({ daily_outbound_budget: 125 });
    // a declined display name keeps the number pending
    expect(await as(o, (db) => syncWabaStatus(db, wabaId, { port }))).toBe("display_name_pending");
    // a registration whose display name was not submitted stays number_registered (review r1 P2-2)
    const regPort: WabaGraphPort = { ...port, registerNumber: async (i) => ({ ...(await port.registerNumber(i)), displayNameStatus: "none" }) };
    const n2 = await as(o, (db) => addWaNumber(db, key(), wabaId, num(null), { port: regPort }));
    expect(n2).toMatchObject({ ok: true, state: "number_registered" });
    // the third number: verification required; the webhook's verification recovers and clears previous_state (review r1 P2-1)
    expect(await as(o, (db) => addWaNumber(db, key(), wabaId, num(t.b2), { port }))).toMatchObject({ ok: false, code: "verification_required" });
    const meta = (await h.admin.query(`select meta_waba_id from waba_accounts where id = $1`, [wabaId])).rows[0].meta_waba_id as string;
    expect((await unbound((c) => c.query(`select waba_webhook_account_update($1, 'verification_update', '{"business_verification_status":"verified"}'::jsonb) r`, [meta]))).rows[0].r).toBe("recorded");
    expect((await h.admin.query(`select state, previous_state from waba_accounts where id = $1`, [wabaId])).rows[0]).toEqual({ state: "display_name_pending", previous_state: null });
    // verified: up to 20 live numbers; the 21st is refused (the cap moved, W-07)
    step = "approved";
    expect(await as(o, (db) => addWaNumber(db, key(), wabaId, num(t.b2), { port }))).toMatchObject({ ok: true });
    // 17 more branches (one live number per branch): 20 live numbers, then the 21st is refused
    for (let i = 0; i < 18; i += 1) {
      const b = (await h.admin.query(`insert into branches (tenant_id, code, name, timezone, address) values ($1, $2, $2, 'Asia/Jakarta', 'Jl. Uji') returning id`,
        [t.tenantId, `FJ${i}`])).rows[0].id as string;
      const r = await as(o, (db) => addWaNumber(db, key(), wabaId, num(b), { port }).then((x) => x.ok, (e) => (e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason}` : "raw")));
      expect(r, `number ${i + 4}`).toBe(i < 17 ? true : "ERR_VERSION_CONFLICT:number_cap");
    }
    expect((await h.admin.query(`select count(*)::int c from wa_numbers where waba_id = $1 and state <> 'revoked'`, [wabaId])).rows[0].c).toBe(20);
  });
});

describe("T-089 guards", () => {
  it("history is never deleted or rewritten, even by the table owner", async () => {
    const w = (await h.admin.query(`select id from waba_accounts where tenant_id = $1`, [A.tenantId])).rows[0].id as string;
    // a branch number (with its route), so every rewrite below really changes a value
    const nId = (await h.admin.query(`select id from wa_numbers where tenant_id = $1 and branch_id is not null order by added_at limit 1`, [A.tenantId])).rows[0].id as string;
    expect(await raw(`delete from waba_accounts where id = $1`, [w])).toBe("raw:42501");
    expect(await raw(`update waba_accounts set started_by = null where id = $1`, [w])).toBe("raw:42501");
    expect(await raw(`delete from token_vault where waba_id = $1`, [w])).toBe("raw:42501");
    expect(await raw(`update token_vault set encrypted_token = 'v1.1.a.b.c' where waba_id = $1`, [w])).toBe("raw:42501");
    expect(await raw(`delete from wa_numbers where id = $1`, [nId])).toBe("raw:42501");
    expect(await raw(`update wa_numbers set registration_pin_enc = 'v1.1.a.b.c' where id = $1`, [nId])).toBe("raw:42501");
    expect(await raw(`update wa_numbers set branch_id = null where id = $1`, [nId])).toBe("raw:42501");
    expect(await raw(`delete from waba_routes where wa_number_id = $1`, [nId])).toBe("raw:42501");
    expect(await raw(`update waba_routes set wa_number_id = gen_random_uuid() where wa_number_id = $1`, [nId])).toBe("raw:42501");
    // retargeting while deactivating is refused too (only active/deactivated_at may change)
    expect(await raw(`update waba_routes set active = false, deactivated_at = now(), meta_waba_id = '123456789' where wa_number_id = $1`, [nId])).toBe("raw:42501");
    for (const t of ["waba_accounts", "token_vault", "wa_numbers", "waba_routes"]) expect(await raw(`truncate ${t} cascade`), t).toBe("raw:42501");
    // the cap holds at the table too
    const v = (await h.admin.query(`select id, tenant_id from waba_accounts where tenant_id = $1`, [D.tenantId])).rows[0];
    await h.admin.query(`update waba_accounts set business_verification_status = 'unverified' where id = $1`, [v.id]);
    const ins = (i: number) => raw(`insert into wa_numbers (tenant_id, waba_id, phone_number, phone_number_id, display_name, registration_pin_enc, pin_dek_ref, added_by, added_as, command_key)
      select tenant_id, id, '+6289900' || $2, '9900' || $2, 'XYZ', 'v1.1.a.b.c', 'dek:v1', started_by, 'owner', 'cap-key-' || $2 from waba_accounts where id = $1`, [v.id, String(i)]);
    expect(await ins(1)).toBe("ok");
    expect(await ins(2)).toBe("raw:42501");
  });
});
