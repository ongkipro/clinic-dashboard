// Outbound WhatsApp (PR-31, PR-4, PR-15; T-094, migration 0109, DEC-106). Staff enqueue care reminders, aftercare notes, promos (consent and
// role checked by the definers) and the WhatsApp bill; the queue carries ids only. The daily dispatch runs on an unbound worker: outbound_claim
// applies consent (PR-4), the suspended-tenant hold (PR-56) and the budget (W-06, PR-31) and returns the rows to send with params built from
// the ids (no clinical content); this module opens the sealed token, calls the Meta port (the mock adapter — DEC-082: no live call) and
// records each result with outbound_complete. A replay never calls the port twice (only queued rows are claimed).
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../../lib/command";
import { decryptField, type KekRing, type TenantKeys, type WrappedDek } from "../../../lib/keys/envelope";
import { EncryptionUnavailableError, kekRing } from "../../../lib/keys/runtime";
import { assertProductionGoLive } from "../../vendor/profile/profile";
import { mockInboxPort } from "../inbox/mock";
import type { InboxPort } from "../inbox/port";
import type { OUTBOUND_PURPOSES, OUTBOUND_SOURCES } from "../schema";

export type OutboundPurpose = (typeof OUTBOUND_PURPOSES)[number];
export type OutboundSource = (typeof OUTBOUND_SOURCES)[number];

export class OutboundError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED", "ERR_IDEMPOTENCY_CONFLICT"]);
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CommandError) throw e;
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new OutboundError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}
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

export type Enqueue = { purpose: Exclude<OutboundPurpose, "bill">; patientId: string; templateId: string; sourceKind: OutboundSource; sourceId: string;
  branchId?: string; plannedFor?: string };
export async function enqueueOutbound(db: pg.ClientBase, key: string, e: Enqueue) {
  await assertProductionGoLive(db);
  const p: Record<string, Json> = { purpose: e.purpose, patient_id: e.patientId, template_id: e.templateId, source_kind: e.sourceKind, source_id: e.sourceId };
  if (e.branchId) p.branch_id = e.branchId;
  if (e.plannedFor) p.planned_for = e.plannedFor;
  const out = await call(() => runCommand<string>(db, { command: "outbound_enqueue", key, body: p },
    async (c) => (await c.query(`select outbound_enqueue($1, $2::jsonb) r`, [key, JSON.stringify(p)])).rows[0].r as string));
  if (!out.ok) throw out.error;
  return { outboundId: out.result, replayed: out.replayed };
}

// Kirim Tagihan WhatsApp (PR-15): the visit's unpaid bill as the approved utility template `tagihan_kunjungan`.
export async function sendWhatsappBill(db: pg.ClientBase, key: string, visitId: string) {
  await assertProductionGoLive(db);
  const out = await call(() => runCommand<string>(db, { command: "outbound_bill", key, body: { visit_id: visitId } },
    async (c) => (await c.query(`select outbound_bill($1, $2) r`, [key, visitId])).rows[0].r as string));
  if (!out.ok) throw out.error;
  return { outboundId: out.result, replayed: out.replayed };
}

export type Backlog = { role: string; queued: { planned_for: string; purpose: OutboundPurpose; count: number; deferred_budget: number; deferred_suspended: number }[] };
export const outboundBacklog = (db: pg.ClientBase, branchId?: string) =>
  call(async () => (await db.query(`select outbound_backlog($1) r`, [branchId ?? null])).rows[0].r as Backlog);

type Claimed = { id: string; tenant_id: string; meta_waba_id: string; phone_number_id: string; to: string; template_name: string; template_language: string;
  params: string[] | null; encrypted_token: string | null; keys: { version: number; wrapped: string; is_current: boolean }[] };
// The daily dispatch on an unbound worker connection (no tenant context): claim, send through the port, record. A send that throws is recorded
// as failed (the error's name only — never a provider body).
export async function runOutboundDispatch(worker: pg.Pool | pg.ClientBase, o: { now?: Date; port?: InboxPort } = {}) {
  const port = o.port ?? mockInboxPort();
  const claimed = (await worker.query<{ r: Claimed[] }>(`select outbound_claim($1) r`, [o.now ?? null])).rows[0].r;
  const result = { sent: 0, failed: 0 };
  for (const c of claimed) {
    let providerId: string | null = null;
    let error: string | null = null;
    try {
      const keys = keysOf(c.tenant_id, c.keys);
      if (!keys || !c.encrypted_token) throw new Error("token_unavailable");
      const accessToken = decryptField(ring(), keys, "waba.token", c.encrypted_token);
      providerId = (await port.sendMessage({ kind: "template", metaWabaId: c.meta_waba_id, phoneNumberId: c.phone_number_id, to: c.to,
        templateName: c.template_name, language: c.template_language, params: c.params ?? [], accessToken })).providerMessageId;
    } catch (e) {
      error = e instanceof Error ? (e.message === "token_unavailable" ? e.message : e.name) : "send_failed";
    }
    const st = (await worker.query<{ s: string }>(`select outbound_complete($1, $2, $3, $4) s`, [c.id, providerId, error, o.now ?? null])).rows[0].s;
    if (st === "sent") result.sent++;
    else result.failed++;
  }
  return result;
}
