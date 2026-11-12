// Payment port (PR-68, TD-40, TD-41, TD-43, BILL-29; T-073, migration 0088, DEC-084). Server code over the port
// definers. Interactive calls run inside withTenantContext (the database decides authority: the Kasir roles create,
// poll and cancel charges; owner and manager enable the mock port and refund); the deployment environment reaches the
// database as the transaction-local `app.deploy_env` (DEL-3; production when missing — the mock is then unusable).
// Webhooks are ingested on an unbound worker connection (no tenant context; the route resolves the tenant).
import { createHash } from "node:crypto";
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../lib/command";
import { assertProductionGoLive, deployEnv } from "../vendor/profile/profile";
import { currentKekVersion, MAX_BODY_BYTES, MockUnavailableError, mockSecret, SIGNATURE_HEADER, sign, verify } from "./mock";

export class PortError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED", "ERR_IDEMPOTENCY_CONFLICT", "ERR_NOT_AVAILABLE"]);
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CommandError) throw e;
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new PortError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}
// The deployment environment for this transaction (SET LOCAL: it ends with the transaction).
export async function bindDeployEnv(db: pg.ClientBase, env = deployEnv()) {
  await db.query(`select set_config('app.deploy_env', $1, true)`, [env]);
}
async function command<T extends Json>(db: pg.ClientBase, name: string, key: string, body: Record<string, Json>, sql: string, args: unknown[]) {
  await assertProductionGoLive(db);
  await bindDeployEnv(db);
  const out = await call(() => runCommand<T>(db, { command: name, key, body }, async (c) => ((await c.query(sql, args)).rows[0]?.r ?? null) as T));
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}

// ── Interactive ────────────────────────────────────────────────────────────────────────────────────────────────

export async function enableMockPort(db: pg.ClientBase) {
  const v = currentKekVersion();
  if (v === null) throw new MockUnavailableError();
  await bindDeployEnv(db);
  return call(async () => (await db.query(`select payment_port_enable($1) as r`, [v])).rows[0].r as { config_id: string; order_prefix: string; provider_account: string; kek_version: number });
}

export type Channel = "qris" | "va" | "payment_link";
export type Charge = { charge_id: string; order_ref: string; external_id: string; amount: number; expires_at: string; channel: Channel; is_simulated: boolean; state: string; reused: boolean };
export async function createCharge(db: pg.ClientBase, key: string, invoiceId: string, c: { channel: Channel; amount?: number }) {
  const p: Record<string, Json> = { channel: c.channel, ...(c.amount !== undefined ? { amount: c.amount } : {}) };
  const out = await command<Charge>(db, "payment_charge_create", key, { invoice_id: invoiceId, charge: p }, `select payment_charge_create($1, $2, $3::jsonb) as r`,
    [key, invoiceId, JSON.stringify(p)]);
  return { ...out.result, replayed: out.replayed };
}

export type Settle = { outcome: "applied" | "flagged" | "duplicate" | "rejected_amount"; state: string; receipt_id?: string; flag?: string | null };
// Cek Status (the lost-webhook path, scenario 18): ask the adapter, settle through the one path.
export async function pollCharge(db: pg.ClientBase, chargeId: string): Promise<Settle> {
  await bindDeployEnv(db);
  return call(async () => {
    const s = (await db.query(`select payment_mock_status($1) as r`, [chargeId])).rows[0].r as { state: string; amount: number };
    return (await db.query(`select payment_charge_poll($1, $2::jsonb) as r`, [chargeId, JSON.stringify({ state: s.state, amount: Number(s.amount) })])).rows[0].r as Settle;
  });
}
export async function cancelCharge(db: pg.ClientBase, chargeId: string) {
  await bindDeployEnv(db);
  await call(() => db.query(`select payment_charge_cancel($1)`, [chargeId]));
}
export async function refundCharge(db: pg.ClientBase, key: string, chargeId: string, amount: number) {
  await bindDeployEnv(db);
  return call(async () => (await db.query(`select payment_refund($1, $2, $3) as r`, [key, chargeId, amount])).rows[0].r as { refund_id: string; refunded: number; replayed: boolean });
}

// The simulator (UX-56): changes the mock gateway's state and returns the signed webhook to deliver after the
// transaction commits (r1 P1-3); deliverWebhook runs it on the worker pool.
export type SignedWebhook = { rawBody: string; headers: Record<string, string> };
export type SimAction = "paid" | "expired" | "failed" | "resend";
export async function simulate(db: pg.ClientBase, chargeId: string, action: SimAction, tenantId: string): Promise<SignedWebhook> {
  await bindDeployEnv(db);
  const payload = await call(async () => (await db.query(`select simulasi_set($1, $2) as r`, [chargeId, action])).rows[0].r as Record<string, Json>);
  const cfg = (await db.query(`select provider_account, kek_version from payment_port_configs where tenant_id = $1 and active`, [tenantId])).rows[0];
  const secret = cfg ? mockSecret(tenantId, cfg.provider_account, cfg.kek_version) : null;
  if (!secret) throw new MockUnavailableError();
  const rawBody = JSON.stringify(payload);
  return { rawBody, headers: { [SIGNATURE_HEADER]: sign(secret, rawBody), "content-type": "application/json" } };
}
export type SimulasiList = {
  environment: string; role: string; can_enable: boolean;
  port: { provider: string; order_prefix: string; usable: boolean } | null;
  charges: { id: string; invoice_id: string; invoice_number: string | null; channel: Channel; amount: number; state: string; mock_state: string | null; mock_event: string | null;
    expires_at: string; review_flag: string | null; balance_pending: number; created_at: string }[];
};
export async function simulasiList(db: pg.ClientBase, branchId: string | null = null): Promise<SimulasiList> {
  await bindDeployEnv(db);
  return call(async () => (await db.query(`select simulasi_list($1) as r`, [branchId])).rows[0].r as SimulasiList);
}

// ── Webhook (unbound worker connection) ────────────────────────────────────────────────────────────────────────

export type WebhookAnswer = { status: 200 | 400 | 401 | 404 | 413; outcome: string };
// The route's whole handling of one mock webhook: size, JSON, route by order prefix, signature and window against the
// routed tenant's derived secret, then the database decides (duplicate, mismatch, settle). `pool` is an unbound pool
// (no tenant context is ever set on it here).
export async function receiveMockWebhook(pool: pg.Pool, rawBody: string, signature: string | null, env = deployEnv()): Promise<WebhookAnswer> {
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) return { status: 413, outcome: "too_large" };
  let e: Record<string, unknown>;
  try {
    e = JSON.parse(rawBody) as Record<string, unknown>;
    if (!e || typeof e !== "object" || Array.isArray(e)) throw new Error("not an object");
  } catch {
    return { status: 400, outcome: "bad_json" };
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`select set_config('app.deploy_env', $1, true)`, [env]);
    const route = (await client.query(`select payment_webhook_route($1) as r`, [String(e.order_ref ?? "")])).rows[0].r as
      | { tenant_id: string; provider_account: string; kek_version: number; usable: boolean } | null;
    let verdict = { signatureOk: false, timestampOk: false };
    if (route) {
      const secret = mockSecret(route.tenant_id, route.provider_account, route.kek_version);
      if (!secret || !route.usable) {
        await client.query("rollback");
        return { status: 404, outcome: "port_unusable" };
      }
      verdict = verify(secret, rawBody, signature);
    }
    let outcome: string;
    try {
      outcome = (await client.query(`select payment_webhook_ingest($1::jsonb, $2, $3, $4) as r`,
        [rawBody, verdict.signatureOk, verdict.timestampOk, createHash("sha256").update(rawBody, "utf8").digest("hex")])).rows[0].r as string;
    } catch (err) {
      await client.query("rollback");
      if (/ERR_INVALID_INPUT/.test((err as Error).message)) return { status: 400, outcome: "bad_payload" };
      throw err;
    }
    await client.query("commit");
    return { status: outcome === "rejected_signature" || outcome === "rejected_window" ? 401 : 200, outcome };
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
