// WABA onboarding (PR-27, TD-20, TD-21, W-01…W-09; T-089, migration 0104, DEC-101). The app drives the Graph port (the mock by default; DEC-082),
// seals the business token and each number's two-step PIN with the tenant DEK (`waba.token`, `waba.pin`) and passes the recorded result to the
// definers, which decide authority (owner, admin_pusat; configuration), state (TD-20) and the number cap (W-07). No secret plaintext ever reaches
// SQL, a log, an event or a reply.
import { randomInt } from "node:crypto";
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../../lib/command";
import { decryptField, encryptField, newWrappedDek, type KekRing, type TenantKeys, type WrappedDek } from "../../../lib/keys/envelope";
import { EncryptionUnavailableError, kekRing } from "../../../lib/keys/runtime";
import { bindDeployEnv } from "../../payments/payments";
import { assertProductionGoLive } from "../../vendor/profile/profile";
import { mockWabaGraphPort } from "./mock";
import type { OnboardingChannel, WabaGraphPort } from "./port";

export class WabaError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED", "ERR_IDEMPOTENCY_CONFLICT", "ERR_NOT_AVAILABLE"]);
export async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CommandError) throw e;
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new WabaError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}
const TOKEN = "waba.token";
const PIN = "waba.pin";
let defaultPort: WabaGraphPort | null = null;
const portOr = (p?: WabaGraphPort) => p ?? (defaultPort ??= mockWabaGraphPort());

function ring(): KekRing {
  const r = kekRing();
  if (!r) throw new EncryptionUnavailableError();
  return r;
}
function keysOf(tenantId: string, rows: { version: number; wrapped: string; is_current?: boolean }[]): TenantKeys | null {
  if (!rows.length) return null;
  const deks: WrappedDek[] = rows.map((r) => ({ tenantId, version: r.version, wrapped: r.wrapped }));
  const cur = rows.find((r) => r.is_current !== false) ?? rows[rows.length - 1];
  return { tenantId, current: deks.find((d) => d.version === cur.version)!, byVersion: (v) => deks.find((d) => d.version === v) };
}
// The tenant keys for the WABA secrets (r1 P1-1): the existing ones, else version 1 through waba_data_key_ensure (owner/admin_pusat).
export async function ensureWabaTenantKeys(db: pg.ClientBase, r: KekRing, tenantId: string): Promise<TenantKeys> {
  const existing = keysOf(tenantId, (await db.query(`select version, wrapped, is_current from tenant_data_keys_for()`)).rows);
  if (existing) return existing;
  const candidate = newWrappedDek(r, tenantId, 1);
  const keys = keysOf(tenantId, (await call(() => db.query(`select version, wrapped from waba_data_key_ensure($1)`, [candidate.wrapped]))).rows);
  if (!keys) throw new WabaError("ERR_NOT_AVAILABLE", "tenant data key was not stored");
  return keys;
}
const dekRef = (sealed: string) => `dek:v${sealed.split(".")[1]}`;
async function tenantOf(db: pg.ClientBase) {
  return (await db.query(`select app_tenant_id() t`)).rows[0].t as string;
}
// The live token in memory for a port call (never returned to a client).
async function openSealed(db: pg.ClientBase, purpose: string, sealed: string): Promise<string> {
  const keys = keysOf(await tenantOf(db), (await db.query(`select version, wrapped, is_current from tenant_data_keys_for()`)).rows);
  if (!keys) throw new WabaError("ERR_NOT_AVAILABLE", "no tenant keys");
  return decryptField(ring(), keys, purpose, sealed);
}
async function openToken(db: pg.ClientBase, wabaId: string): Promise<string> {
  const row = (await call(() => db.query(`select encrypted_token from waba_sealed_token($1)`, [wabaId]))).rows[0];
  if (!row) throw new WabaError("ERR_VERSION_CONFLICT", "no_active_token");
  return openSealed(db, TOKEN, row.encrypted_token);
}

// Start Embedded Signup (or a BSP fallback, W-09).
export async function startWabaSignup(db: pg.ClientBase, key: string, o: { onboardingChannel: OnboardingChannel; bspProvider?: string | null }) {
  await assertProductionGoLive(db);
  const p: Record<string, Json> = { onboarding_channel: o.onboardingChannel };
  if (o.bspProvider) p.bsp_provider = o.bspProvider;
  const out = await call(() => runCommand<string>(db, { command: "waba_signup_start", key, body: p },
    async (c) => ((await c.query(`select waba_signup_start($1, $2::jsonb) as r`, [key, JSON.stringify(p)])).rows[0]?.r ?? null) as string));
  if (!out.ok) throw out.error;
  return { wabaId: out.result, replayed: out.replayed };
}

// Complete the signup: exchange the code, subscribe the app, seal the token, record it (TD-20 acceptance).
export async function completeWabaSignup(db: pg.ClientBase, wabaId: string, code: string, o: { port?: WabaGraphPort; onboardingChannel?: OnboardingChannel } = {}) {
  await assertProductionGoLive(db);
  await bindDeployEnv(db);
  const port = portOr(o.port);
  const ex = await port.exchangeCode({ code, onboardingChannel: o.onboardingChannel ?? "cloud_api" });
  const sub = await port.subscribeApp({ metaWabaId: ex.metaWabaId, accessToken: ex.accessToken });
  const r = ring();
  const keys = await ensureWabaTenantKeys(db, r, await tenantOf(db));
  const sealed = encryptField(r, keys, TOKEN, ex.accessToken);
  const p = { encrypted_token: sealed, dek_ref: dekRef(sealed), token_kind: ex.tokenKind, granted_scopes: ex.grantedScopes, meta_waba_id: ex.metaWabaId,
    meta_business_id: ex.metaBusinessId, business_verification_status: ex.businessVerificationStatus, portfolio_messaging_limit: ex.portfolioMessagingLimit,
    app_subscribed: sub.subscribed };
  return call(async () => (await db.query(`select waba_complete_signup($1, $2::jsonb) as r`, [wabaId, JSON.stringify(p)])).rows[0].r as string);
}

export type AddNumberResult =
  | { ok: true; replayed: boolean; waNumberId: string; state: string; displayName: string }
  | { ok: false; code: "verification_required"; wabaState: string; message: string };
// Add a number (W-03 branch or brand-wide; W-04 Coexistence): a generated 6-digit PIN sealed; the definer applies the cap (scenario PR-27: a third
// number while unverified commits verification_required and returns it, with no register call); only then the port registers the number.
export async function addWaNumber(db: pg.ClientBase, key: string, wabaId: string,
  n: { branchId?: string | null; phoneNumber: string; phoneNumberId: string; isCoexistence?: boolean; historySyncEnabled?: boolean }, o: { port?: WabaGraphPort } = {}): Promise<AddNumberResult> {
  await assertProductionGoLive(db);
  await bindDeployEnv(db);
  const r = ring();
  const keys = await ensureWabaTenantKeys(db, r, await tenantOf(db));
  const pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const sealedPin = encryptField(r, keys, PIN, pin);
  const p: Record<string, Json> = { phone_number: n.phoneNumber, phone_number_id: n.phoneNumberId, is_coexistence: n.isCoexistence ?? false,
    history_sync_enabled: n.historySyncEnabled ?? false, registration_pin_enc: sealedPin, pin_dek_ref: dekRef(sealedPin) };
  if (n.branchId) p.branch_id = n.branchId;
  // the command body never carries the sealed PIN (a fresh PIN per attempt): the key's fingerprint covers the number's identity only
  const body: Record<string, Json> = { waba_id: wabaId, branch_id: n.branchId ?? null, phone_number: n.phoneNumber, phone_number_id: n.phoneNumberId,
    is_coexistence: n.isCoexistence ?? false, history_sync_enabled: n.historySyncEnabled ?? false };
  const out = await call(() => runCommand<Json>(db, { command: "waba_add_number", key, body },
    async (c) => ((await c.query(`select waba_add_number($1, $2, $3::jsonb) as r`, [key, wabaId, JSON.stringify(p)])).rows[0]?.r ?? null) as Json));
  if (!out.ok) throw out.error;
  const res = out.result as Record<string, Json>;
  if (res.ok === false) return { ok: false, code: "verification_required", wabaState: String(res.waba_state), message: String(res.message) };
  let state = String(res.state);
  if (state === "number_pending_registration") {
    const port = portOr(o.port);
    // the stored PIN (a replayed add retries with it, never a fresh one)
    const sealedRow = (await call(() => db.query(`select registration_pin_enc from waba_sealed_pin($1)`, [res.wa_number_id]))).rows[0];
    if (!sealedRow) {
      // a replay of an add that has since registered: its current state
      const cur = (await db.query(`select state from wa_numbers where id = $1`, [res.wa_number_id])).rows[0];
      return { ok: true, replayed: true, waNumberId: String(res.wa_number_id), state: cur.state, displayName: String(res.display_name) };
    }
    const storedPin = await openSealed(db, PIN, sealedRow.registration_pin_enc);
    const status = (await db.query(`select waba_status() as r`)).rows[0].r as { waba: { meta_waba_id: string } };
    const reg = await port.registerNumber({ metaWabaId: status.waba.meta_waba_id, phoneNumberId: n.phoneNumberId, phoneNumber: n.phoneNumber,
      displayName: String(res.display_name), pin: storedPin, isCoexistence: n.isCoexistence ?? false, historySyncEnabled: n.historySyncEnabled ?? false,
      accessToken: await openToken(db, wabaId) });
    state = await call(async () => (await db.query(`select waba_register_number($1, $2::jsonb) as r`, [res.wa_number_id, JSON.stringify({
      registered: reg.registered, verified_name: reg.verifiedName, display_name_status: reg.displayNameStatus, quality_rating: reg.qualityRating })])).rows[0].r as string);
  }
  return { ok: true, replayed: out.replayed || res.replayed === true, waNumberId: String(res.wa_number_id), state, displayName: String(res.display_name) };
}

// Sync the WABA's status (verification, the portfolio limit, display names, quality) from the port.
export async function syncWabaStatus(db: pg.ClientBase, wabaId: string, o: { port?: WabaGraphPort } = {}) {
  await assertProductionGoLive(db);
  await bindDeployEnv(db);
  const st = await wabaStatus(db);
  if (!st.waba || st.waba.id !== wabaId) throw new WabaError("ERR_NOT_FOUND", "waba not found");
  if (st.waba.state === "revoked") throw new WabaError("ERR_VERSION_CONFLICT", "waba_revoked");
  const ids = st.numbers.filter((x) => x.state !== "revoked").map((x) => x.phone_number_id);
  const s = await portOr(o.port).fetchWabaStatus({ metaWabaId: st.waba.meta_waba_id!, phoneNumberIds: ids, accessToken: await openToken(db, wabaId) });
  const p = { business_verification_status: s.businessVerificationStatus, portfolio_messaging_limit: s.portfolioMessagingLimit,
    numbers: Object.fromEntries(Object.entries(s.numbers).map(([k, v]) => [k, { display_name_status: v.displayNameStatus, quality_rating: v.qualityRating }])) };
  return call(async () => (await db.query(`select waba_sync_status($1, $2::jsonb) as r`, [wabaId, JSON.stringify(p)])).rows[0].r as string);
}

// BSP fallback → Cloud API (W-09, TD-27): a new Embedded Signup code; the BSP token revoked, ids and routes kept.
export async function migrateWabaToCloudApi(db: pg.ClientBase, wabaId: string, code: string, o: { port?: WabaGraphPort } = {}) {
  await assertProductionGoLive(db);
  await bindDeployEnv(db);
  const port = portOr(o.port);
  const ex = await port.exchangeCode({ code, onboardingChannel: "cloud_api" });
  await port.subscribeApp({ metaWabaId: ex.metaWabaId, accessToken: ex.accessToken });
  const r = ring();
  const keys = await ensureWabaTenantKeys(db, r, await tenantOf(db));
  const sealed = encryptField(r, keys, TOKEN, ex.accessToken);
  const p = { encrypted_token: sealed, dek_ref: dekRef(sealed), token_kind: ex.tokenKind, granted_scopes: ex.grantedScopes, meta_waba_id: ex.metaWabaId };
  return call(async () => (await db.query(`select waba_migrate_to_cloud_api($1, $2::jsonb) as r`, [wabaId, JSON.stringify(p)])).rows[0].r as string);
}

// Revoke (owner, admin_pusat): every token, number and route; WabaRevoked; the owner notified.
export async function revokeWaba(db: pg.ClientBase, wabaId: string, reason: string) {
  await assertProductionGoLive(db);
  await call(() => db.query(`select waba_revoke($1, $2)`, [wabaId, reason]));
}

export type WabaNumber = { id: string; branch_id: string | null; phone_number: string; phone_number_id: string; display_name: string; state: string;
  display_name_status: string; quality_rating: string; is_coexistence: boolean; history_sync_enabled: boolean; has_pin: boolean };
export type WabaStatus = { role: string; can_manage: boolean; numbers: WabaNumber[];
  waba: null | { id: string; state: string; onboarding_channel: OnboardingChannel; bsp_provider: string | null; meta_waba_id: string | null;
    business_verification_status: string; portfolio_messaging_limit: number; daily_outbound_budget: number; app_subscribed: boolean; revoked_at: string | null;
    has_active_token: boolean; token_kind: string | null; granted_scopes: string[] | null; sending_allowed: boolean } };
// The WABA's status and numbers (metadata only).
export const wabaStatus = (db: pg.ClientBase) => call(async () => (await db.query(`select waba_status() as r`)).rows[0].r as WabaStatus);
