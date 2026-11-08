// The process-wide KEK ring (ARCH-7, DEC-009) and tenant data keys for field encryption (DATA-8).
// The ring is loaded once from KEK_FILE (kek-file.ts checks custody: 0400, not a symlink, owned by the
// app user) and never logged. Without KEK_FILE, encryption is unavailable: callers refuse the write
// (never store clear text). A tenant's data key is created at its first encrypted write: the database
// keeps the first stored key (tenant_data_key_ensure) and every caller uses the returned one, so a race
// between two first writes ends with one key (T-037 plan r1 open point 1).
import type pg from "pg";
import { KeyError, type KekRing, newWrappedDek, type TenantKeys, type WrappedDek } from "./envelope";
import { loadKekRing } from "./kek-file";

let cached: KekRing | null | undefined;

// The ring, or null when no KEK_FILE is configured. A configured but unreadable or unsafe file throws:
// a misconfigured key must stop the process, not silently disable encryption.
export function kekRing(): KekRing | null {
  if (cached !== undefined) return cached;
  const path = process.env.KEK_FILE;
  cached = path ? loadKekRing(path) : null;
  return cached;
}

// Tests only: a ring injected without a file, or reset.
export function setKekRingForTests(ring: KekRing | null | undefined): void {
  cached = ring;
}

export class EncryptionUnavailableError extends KeyError {
  constructor() {
    super("encryption keys are not installed");
  }
}

function keysOf(tenantId: string, rows: { version: number; wrapped: string; is_current?: boolean }[]): TenantKeys | null {
  if (!rows.length) return null;
  const deks: WrappedDek[] = rows.map((r) => ({ tenantId, version: r.version, wrapped: r.wrapped }));
  const current = rows.find((r) => r.is_current !== false) ?? rows[rows.length - 1];
  return {
    tenantId,
    current: deks.find((d) => d.version === current.version)!,
    byVersion: (v) => deks.find((d) => d.version === v),
  };
}

// The caller's tenant keys, or null when the tenant has none yet (no encrypted value exists then).
export async function tenantKeys(db: pg.ClientBase, tenantId: string): Promise<TenantKeys | null> {
  return keysOf(tenantId, (await db.query(`select version, wrapped, is_current from tenant_data_keys_for()`)).rows);
}

// The caller's tenant keys, creating version 1 at the first encrypted write.
export async function ensureTenantKeys(db: pg.ClientBase, ring: KekRing, tenantId: string): Promise<TenantKeys> {
  const existing = await tenantKeys(db, tenantId);
  if (existing) return existing;
  const candidate = newWrappedDek(ring, tenantId, 1);
  const rows = (await db.query(`select version, wrapped from tenant_data_key_ensure($1)`, [candidate.wrapped])).rows;
  const keys = keysOf(tenantId, rows);
  if (!keys) throw new KeyError("tenant data key was not stored");
  return keys;
}
