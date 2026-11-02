// Shared command wrapper (DATA-45, TD-51). Every money, stock, session, commission,
// clinical sign/amend and consent command runs through runCommand inside the caller's
// withTenantContext transaction:
//   - first call with a key: claims the key (insert), runs the command, stores its result
//     in the same transaction, so the record exists exactly when the effects committed;
//   - same key, same body: returns the stored result without running again (replayed);
//   - same key, different body (or another caller's key): ERR_IDEMPOTENCY_CONFLICT;
//   - concurrent duplicates: the second waits on the unique key, then replays;
//   - a CommandError thrown by the command (domain refusal, e.g. ERR_STOCK_INSUFFICIENT)
//     rolls the command's writes back to a savepoint, is stored, and is *returned* as
//     { ok: false } so the caller's transaction commits the record; a retry with the same
//     key gets the same refusal without running (a new attempt needs a new key).
//   - any other error, a retryable code (RETRYABLE) and ERR_IDEMPOTENCY_CONFLICT roll
//     back both the claim and the command's writes before propagating, so even a caller
//     that catches the error and commits leaves no record and no partial effects.
// Requires READ COMMITTED (withTenantContext's default): a waiting duplicate must see
// the committed record. Results must be plain JSON of ids and codes (no clinical
// content); a replay returns the stored JSON.
import { createHash } from "node:crypto";
import type pg from "pg";

export type ErrorCode = `ERR_${string}`;

// Refusals that depend on timing or on data the caller can refresh: never cached.
export const RETRYABLE: ReadonlySet<string> = new Set([
  "ERR_IDEMPOTENCY_CONFLICT",
  "ERR_VERSION_CONFLICT",
  "ERR_RATE_LIMITED",
]);

const HTTP: Record<string, number> = {
  ERR_NOT_FOUND: 404,
  ERR_FORBIDDEN: 403,
  ERR_IDEMPOTENCY_CONFLICT: 409,
  ERR_VERSION_CONFLICT: 409,
  ERR_RATE_LIMITED: 429,
};

// TD-51: a stable machine code; the UI maps it to its Indonesian message.
export class CommandError extends Error {
  readonly http: number;
  constructor(readonly code: ErrorCode) {
    super(code);
    if (!/^ERR_[A-Z_]{2,60}$/.test(code)) throw new TypeError(`invalid error code ${code}`);
    this.http = HTTP[code] ?? 422;
  }
}

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

// Canonical JSON: object keys sorted, no undefined/function/symbol/bigint/non-finite
// numbers (money is integer rupiah), so equal bodies always hash the same.
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("command body has a non-finite number");
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) throw new TypeError("command body has an unsafe integer");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${Array.from(value, canonicalJson).join(",")}]`;
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  throw new TypeError(`command body has an unsupported value (${typeof value})`);
}

export const fingerprint = (command: string, body: unknown) =>
  createHash("sha256").update(`${command}\n${canonicalJson(body)}`).digest("hex");

export type CommandOutcome<T> =
  | { ok: true; result: T; replayed: boolean }
  | { ok: false; error: CommandError; replayed: boolean };

export async function runCommand<T extends Json>(
  db: pg.ClientBase,
  spec: { command: string; key: string; body: unknown },
  fn: (db: pg.ClientBase) => Promise<T>,
): Promise<CommandOutcome<T>> {
  const fp = fingerprint(spec.command, spec.body);
  // Outer savepoint: undoes the claim too, for every outcome that must leave no record.
  await db.query("savepoint idem_claim");
  try {
    const outcome = await claimAndRun(db, spec, fp, fn);
    await db.query("release savepoint idem_claim");
    return outcome;
  } catch (error) {
    await db.query("rollback to savepoint idem_claim").catch(() => undefined); // aborted tx: caller rolls back
    await db.query("release savepoint idem_claim").catch(() => undefined);
    throw error;
  }
}

async function claimAndRun<T extends Json>(
  db: pg.ClientBase,
  spec: { command: string; key: string },
  fp: string,
  fn: (db: pg.ClientBase) => Promise<T>,
): Promise<CommandOutcome<T>> {
  const claimed = await db.query<{ id: string }>(
    `insert into idempotency_records (command, key, fingerprint) values ($1, $2, $3)
     on conflict (tenant_id, command, key) do nothing returning id`,
    [spec.command, spec.key, fp],
  );
  if (claimed.rows.length === 0) {
    // Visible only when it is the caller's own record (RLS); anything else is a conflict.
    const { rows } = await db.query<{ fingerprint: string; status: string; result: T; error_code: ErrorCode | null }>(
      `select fingerprint, status, result, error_code from idempotency_records
        where command = $1 and key = $2`,
      [spec.command, spec.key],
    );
    const prior = rows[0];
    if (!prior || prior.fingerprint !== fp || prior.status === "in_progress") {
      throw new CommandError("ERR_IDEMPOTENCY_CONFLICT");
    }
    if (prior.status === "failed") return { ok: false, error: new CommandError(prior.error_code!), replayed: true };
    return { ok: true, result: prior.result, replayed: true };
  }
  const id = claimed.rows[0].id;
  await db.query("savepoint idem_command");
  let result: T;
  try {
    result = await fn(db);
  } catch (error) {
    if (!(error instanceof CommandError) || RETRYABLE.has(error.code)) throw error;
    await db.query("rollback to savepoint idem_command");
    await db.query("release savepoint idem_command");
    await db.query(
      `update idempotency_records set status = 'failed', error_code = $2, completed_at = now() where id = $1`,
      [id, error.code],
    );
    return { ok: false, error, replayed: false };
  }
  await db.query("release savepoint idem_command");
  await db.query(
    `update idempotency_records set status = 'succeeded', result = $2::jsonb, completed_at = now() where id = $1`,
    [id, canonicalJson(result ?? null)],
  );
  return { ok: true, result, replayed: false };
}
