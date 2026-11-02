// Audit service (SEC-5, DATA-60, PR-51). `record` appends through audit_append() inside
// the caller's bound tenant transaction, so attribution comes from the server-side
// context; `list` is the Log Audit read API (UX-31); `verifyChain` reports the first
// broken row; `dailyCopy` writes the previous day's rows to write-once storage.
import { createHash } from "node:crypto";
import type pg from "pg";
import { AUDIT_ACTIONS, AUDIT_OUTCOMES } from "./schema";

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export type AuditInput = {
  action: AuditAction;
  objectKind: string; // e.g. "medical_record", "setting", "approval"
  objectId?: string;
  outcome?: AuditOutcome;
  reasonCode?: string;
  reason?: string; // break_glass only (IAM-6: ≥ 15 characters); a procedural justification —
  // the break-glass form (clinical task) must say "tanpa data klinis" next to the field
  correlationId?: string;
};

// Runs inside withTenantContext. Fails (and so fails the caller's transaction) when the
// audit row cannot be written: an action that must be audited never succeeds unaudited
// (SEC-5: the pipeline failing blocks, it never silently skips).
export async function record(db: pg.ClientBase, e: AuditInput): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `select audit_append($1, $2, $3, $4, $5, $6, $7) as id`,
    [e.action, e.objectKind, e.objectId ?? null, e.outcome ?? "success", e.reasonCode ?? null, e.reason ?? null, e.correlationId ?? null],
  );
  return rows[0].id;
}

export type AuditRow = {
  id: string;
  seq: number;
  at: string;
  staffId: string | null;
  actingRole: string | null;
  branchId: string | null;
  vendorSessionId: string | null;
  action: AuditAction;
  objectKind: string;
  objectId: string | null;
  outcome: AuditOutcome;
  reasonCode: string | null;
  reason: string | null;
};

export type AuditFilter = {
  staffId?: string;
  actingRole?: string;
  action?: AuditAction;
  objectKind?: string;
  objectId?: string;
  vendorSessionId?: string;
  from?: Date;
  to?: Date;
  beforeSeq?: number; // keyset pagination, newest first
  limit?: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[a-z][a-z_]{1,40}$/;

// Log Audit read API (UX-31). RLS decides which rows the acting role sees; the internal
// auditor gets a masked projection (no free-text reason, no object id) per UX-31
// "auditor (masked)" and IAM-12.
export async function list(db: pg.ClientBase, actingRole: string, f: AuditFilter = {}): Promise<AuditRow[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    args.push(v);
    where.push(sql.replace("?", `$${args.length}`));
  };
  for (const [k, v] of [["staffId", f.staffId], ["objectId", f.objectId], ["vendorSessionId", f.vendorSessionId]] as const) {
    if (v !== undefined && !UUID.test(v)) throw new TypeError(`${k} is not a UUID`);
  }
  for (const [k, v] of [["actingRole", f.actingRole], ["action", f.action], ["objectKind", f.objectKind]] as const) {
    if (v !== undefined && !CODE.test(v)) throw new TypeError(`${k} is malformed`);
  }
  if (f.staffId) add("staff_id = ?", f.staffId);
  if (f.actingRole) add("acting_role = ?", f.actingRole);
  if (f.action) add("action = ?", f.action);
  if (f.objectKind) add("object_kind = ?", f.objectKind);
  if (f.objectId) add("object_id = ?", f.objectId);
  if (f.vendorSessionId) add("vendor_session_id = ?", f.vendorSessionId);
  for (const [k, v] of [["from", f.from], ["to", f.to]] as const) {
    if (v !== undefined && Number.isNaN(v.getTime())) throw new TypeError(`${k} is not a date`);
  }
  if (f.from) add("at >= ?", f.from);
  if (f.to) add("at < ?", f.to);
  if (f.beforeSeq !== undefined) {
    if (!Number.isSafeInteger(f.beforeSeq)) throw new TypeError("beforeSeq is not an integer");
    add("seq < ?", f.beforeSeq);
  }
  const limit = Number.isSafeInteger(f.limit) ? Math.min(Math.max(f.limit!, 1), 200) : 50;
  const { rows } = await db.query(
    `select id, seq, at, staff_id, acting_role, branch_id, vendor_session_id, action, object_kind,
            object_id, outcome, reason_code, reason
       from audit_events ${where.length ? `where ${where.join(" and ")}` : ""}
      order by seq desc limit ${limit}`,
    args,
  );
  const masked = actingRole === "auditor";
  return rows.map((r) => ({
    id: r.id,
    seq: Number(r.seq),
    at: new Date(r.at).toISOString(),
    staffId: r.staff_id,
    actingRole: r.acting_role,
    branchId: r.branch_id,
    vendorSessionId: r.vendor_session_id,
    action: r.action,
    objectKind: r.object_kind,
    objectId: masked ? null : r.object_id,
    outcome: r.outcome,
    reasonCode: r.reason_code,
    reason: masked ? null : r.reason,
  }));
}

// First broken seq for the bound tenant, or null when the chain is intact.
export async function verifyChain(db: pg.ClientBase, tenantId: string): Promise<number | null> {
  const { rows } = await db.query<{ broken: string | null }>(`select audit_verify($1) as broken`, [tenantId]);
  return rows[0].broken === null ? null : Number(rows[0].broken);
}

// Daily write-once copy (SEC-5). A job running as the migration owner (not the app's
// database role) copies, per tenant, every row after the last copied seq — by seq, never
// by time, so a row committed late is copied next run. Each run writes one object per
// tenant: canonical rows (exactly what was hashed) plus a manifest with the anchor
// (last seq, last hash). The store is create-only (If-None-Match: *) on a bucket with
// Object Lock (DEC-013), so neither the app nor a database administrator can rewrite a
// copy. A DBA who re-chains rows in the database is caught by checkAgainstCopies(): the
// row at an anchored seq no longer has the anchored hash.
export type WormStore = {
  // Must refuse to overwrite an existing key (create-only).
  put(key: string, body: Buffer, sha256: string): Promise<void>;
  // Anchors already copied for a tenant, newest last (read back from the store).
  anchors(tenantId: string): Promise<{ seq: number; hash: string; key: string }[]>;
};

export class AuditChainBrokenError extends Error {
  constructor(
    readonly broken: { tenantId: string; brokenSeq: number }[],
    readonly failedCopies: { tenantId: string; error: string }[] = [],
  ) {
    super(`audit chain broken for ${broken.length} tenant(s), copy failed for ${failedCopies.length}`);
  }
}

export type CopyResult = { tenantId: string; key: string; fromSeq: number; toSeq: number; sha256: string };

// Copies every tenant (a broken tenant does not stop the others), then raises if any
// chain is broken or any anchored row was rewritten, so the job's failure is the alert.
export async function dailyCopy(owner: pg.ClientBase, store: WormStore, runId: string): Promise<CopyResult[]> {
  if (!/^[0-9]{8}T[0-9]{6}Z$/.test(runId)) throw new TypeError("runId must look like 20261103T000000Z");
  const broken = new Map<string, number>();
  for (const r of (await owner.query<{ tenant_id: string; broken_seq: string }>(
    `select tenant_id, broken_seq from audit_verify_all()`,
  )).rows) {
    broken.set(r.tenant_id, Number(r.broken_seq));
  }
  for (const r of await checkAgainstCopies(owner, store)) {
    if (!broken.has(r.tenantId) || broken.get(r.tenantId)! > r.brokenSeq) broken.set(r.tenantId, r.brokenSeq);
  }

  const tenants = (await owner.query<{ tenant_id: string }>(
    `select distinct tenant_id from audit_events order by tenant_id`,
  )).rows.map((r) => r.tenant_id);
  const out: CopyResult[] = [];
  const failed: { tenantId: string; error: string }[] = [];
  for (const tenantId of tenants) {
    // lazy: anchors() is read per tenant here and in checkAgainstCopies; cache the
    // manifest index once the store holds many objects.
    const done = (await store.anchors(tenantId)).at(-1)?.seq ?? 0;
    const { rows } = await owner.query<{ row: Record<string, string> }>(
      `select audit_export(e) as row from audit_events e where tenant_id = $1 and seq > $2 order by seq`,
      [tenantId, done],
    );
    if (rows.length === 0) continue;
    const last = rows[rows.length - 1].row;
    const manifest = {
      tenantId,
      fromSeq: done + 1,
      toSeq: Number(last.seq),
      anchorHash: last.hash,
      chainBrokenAt: broken.get(tenantId) ?? null,
    };
    const body = Buffer.from(
      [JSON.stringify({ manifest }), ...rows.map((r) => JSON.stringify(r.row))].join("\n") + "\n",
      "utf8",
    );
    const sha256 = createHash("sha256").update(body).digest("hex");
    const key = `audit/${tenantId}/${runId}-${manifest.fromSeq}-${manifest.toSeq}.ndjson`;
    try {
      await store.put(key, body, sha256);
      out.push({ tenantId, key, fromSeq: manifest.fromSeq, toSeq: manifest.toSeq, sha256 });
    } catch (e) {
      failed.push({ tenantId, error: String(e).slice(0, 200) }); // keep copying the others
    }
  }
  if (broken.size || failed.length) {
    throw new AuditChainBrokenError(
      [...broken].map(([tenantId, brokenSeq]) => ({ tenantId, brokenSeq })),
      failed,
    );
  }
  return out;
}

// Every anchor in the write-once store must still match the database: the row at that
// seq exists with that hash. Catches deletion, edits and full re-chaining by a DBA.
export async function checkAgainstCopies(
  owner: pg.ClientBase,
  store: WormStore,
): Promise<{ tenantId: string; brokenSeq: number }[]> {
  const tenants = (await owner.query<{ id: string }>(`select id from tenants order by id`)).rows.map((r) => r.id);
  const out: { tenantId: string; brokenSeq: number }[] = [];
  for (const tenantId of tenants) {
    for (const a of await store.anchors(tenantId)) {
      const { rows } = await owner.query<{ hash: string }>(
        `select hash from audit_events where tenant_id = $1 and seq = $2`,
        [tenantId, a.seq],
      );
      if (rows[0]?.hash !== a.hash) {
        out.push({ tenantId, brokenSeq: a.seq });
        break;
      }
    }
  }
  return out;
}
