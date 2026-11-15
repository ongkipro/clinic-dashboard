// The Pesan inbox (PR-28, TD-22, TD-24, TD-25 part, W-05, W-10; T-090, migration 0105, DEC-102). The webhook intake verifies Meta's
// signature against the mock app secret, parses the event, seals the raw JSON, the contact name and the body with the tenant DEK
// (`message.webhook_raw`, `message.contact`, `message.body`) and hands ids, codes and ciphertext to the definers on an unbound connection.
// Staff send through the mock port in two steps (queue → port → record). No plaintext body reaches SQL, a log, an event or an audit row.
import { createHash } from "node:crypto";
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../../lib/command";
import { decryptField, encryptField, newWrappedDek, type KekRing, type TenantKeys, type WrappedDek } from "../../../lib/keys/envelope";
import { EncryptionUnavailableError, kekRing } from "../../../lib/keys/runtime";
import { bindDeployEnv } from "../../payments/payments";
import { assertProductionGoLive, deployEnv } from "../../vendor/profile/profile";
import { MAX_WEBHOOK_BYTES, mockInboxPort, mockMetaAppSecret, verifyMeta } from "./mock";
import type { InboxPort } from "./port";

export class InboxError extends CommandError {
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
    if (m && KNOWN.has(m[1])) throw new InboxError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}
const P_BODY = "message.body";
const P_CONTACT = "message.contact";
const P_RAW = "message.webhook_raw";
let defaultPort: InboxPort | null = null;
const portOr = (p?: InboxPort) => p ?? (defaultPort ??= mockInboxPort());

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
const dekRef = (sealed: string) => `dek:v${sealed.split(".")[1]}`;
const tenantOf = async (db: pg.ClientBase) => (await db.query(`select app_tenant_id() t`)).rows[0].t as string;

// The staff side's keys (any inbox or template role creates version 1 when missing; r1 P1-1).
async function staffKeys(db: pg.ClientBase, create: boolean): Promise<TenantKeys | null> {
  const tenantId = await tenantOf(db);
  const existing = keysOf(tenantId, (await db.query(`select version, wrapped, is_current from tenant_data_keys_for()`)).rows);
  if (existing || !create) return existing;
  const candidate = newWrappedDek(ring(), tenantId, 1);
  return keysOf(tenantId, (await call(() => db.query(`select version, wrapped from inbox_data_key_ensure($1)`, [candidate.wrapped]))).rows);
}
// The webhook side's keys (unbound; the routed tenant only).
async function webhookKeys(db: pg.ClientBase, tenantId: string): Promise<TenantKeys> {
  const r = ring();
  let keys = keysOf(tenantId, (await db.query(`select version, wrapped, is_current from inbox_webhook_keys($1)`, [tenantId])).rows);
  if (!keys) keys = keysOf(tenantId, (await db.query(`select version, wrapped, is_current from inbox_webhook_keys($1, $2)`,
    [tenantId, newWrappedDek(r, tenantId, 1).wrapped])).rows);
  if (!keys) throw new Error("tenant data key was not stored");
  return keys;
}

// ── Webhook intake (TD-22) ────────────────────────────────────────────────────────────────────────────────────────

type Parsed =
  | { kind: "message"; phoneNumberId: string; providerEventId: string; contactWaId: string; contactName: string | null; direction: "in" | "out";
      sentVia: "cloud_api" | "business_app"; msgKind: "text" | "media"; body: string | null; mediaMetaId: string | null; mediaMimeType: string | null; at: Date }
  | { kind: "status"; phoneNumberId: string; providerEventId: string; target: string; status: "sent" | "delivered" | "read" | "failed"; at: Date };
const DIGITS = /^[1-9][0-9]{7,14}$/;
const at = (s: unknown) => {
  const n = Number(s);
  if (!Number.isInteger(n) || n <= 0) throw new Error("bad timestamp");
  return new Date(n * 1000);
};
// Every event of one delivery (Meta batches several changes and messages into one POST).
export function parseMetaWebhook(raw: string): Parsed[] {
  const e = JSON.parse(raw) as { object?: string; entry?: { changes?: { value?: Record<string, unknown> }[] }[] };
  if (e?.object !== "whatsapp_business_account" || !Array.isArray(e.entry)) throw new Error("not a WABA webhook");
  const out: Parsed[] = [];
  for (const entry of e.entry) for (const ch of entry.changes ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untrusted JSON, every field checked below
    const v = (ch.value ?? {}) as Record<string, any>;
    const pnid = String(v.metadata?.phone_number_id ?? "");
    if (!/^[0-9]{5,32}$/.test(pnid)) throw new Error("bad phone_number_id");
    const names = new Map<string, string>((v.contacts ?? []).map((c: { wa_id?: unknown; profile?: { name?: unknown } }) => [String(c.wa_id), String(c.profile?.name ?? "")]));
    for (const m of v.messages ?? []) {
      const from = String(m.from ?? "");
      if (!DIGITS.test(from) || typeof m.id !== "string") throw new Error("bad message");
      const media = ["image", "video", "audio", "document", "sticker"].find((k) => m[k]);
      out.push({ kind: "message", phoneNumberId: pnid, providerEventId: m.id, contactWaId: from, contactName: names.get(from) || null, direction: "in",
        sentVia: "cloud_api", msgKind: media ? "media" : "text", body: media ? (m[media].caption ?? null) : String(m.text?.body ?? ""),
        mediaMetaId: media ? String(m[media].id) : null, mediaMimeType: media ? String(m[media].mime_type ?? "") || null : null, at: at(m.timestamp) });
    }
    for (const m of v.message_echoes ?? []) {
      const to = String(m.to ?? "");
      if (!DIGITS.test(to) || typeof m.id !== "string") throw new Error("bad echo");
      out.push({ kind: "message", phoneNumberId: pnid, providerEventId: m.id, contactWaId: to, contactName: null, direction: "out", sentVia: "business_app",
        msgKind: "text", body: String(m.text?.body ?? ""), mediaMetaId: null, mediaMimeType: null, at: at(m.timestamp) });
    }
    for (const s of v.statuses ?? []) {
      if (typeof s.id !== "string" || !["sent", "delivered", "read", "failed"].includes(s.status)) throw new Error("bad status");
      out.push({ kind: "status", phoneNumberId: pnid, providerEventId: `${s.id}:${s.status}`, target: s.id, status: s.status, at: at(s.timestamp) });
    }
  }
  // an eventless delivery is not a webhook we act on: unsigned → a rejected receipt; signed → 400 (review r1 P2-2)
  if (!out.length) throw new Error("empty WABA webhook");
  return out;
}

export type WebhookAnswer = { status: 200 | 400 | 401 | 404 | 413; outcomes: string[] };
// The whole handling of one Meta webhook POST on an unbound pool. 404 without the mock secret (no keys, or production); 413 above 64 KB;
// 401 bad signature (a non-personal receipt per event when parseable); 400 not a WABA webhook; 200 otherwise (processed, duplicate, held,
// dropped — Meta stops retrying).
export async function receiveMetaWebhook(pool: pg.Pool, rawBody: string, signature: string | null): Promise<WebhookAnswer> {
  const secret = mockMetaAppSecret();
  if (!secret) return { status: 404, outcomes: ["unavailable"] };
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BYTES) return { status: 413, outcomes: ["too_large"] };
  const sha = createHash("sha256").update(rawBody, "utf8").digest("hex");
  const ok = verifyMeta(secret, rawBody, signature);
  let events: Parsed[];
  try {
    events = parseMetaWebhook(rawBody);
  } catch {
    if (!ok) await drop(pool, { state: "rejected_signature", provider_event_id: `sha:${sha.slice(0, 32)}`, kind: "unknown", body_sha256: sha, error_code: "bad_signature" });
    return { status: ok ? 400 : 401, outcomes: [ok ? "bad_payload" : "rejected_signature"] };
  }
  if (!ok) {
    for (const ev of events) await drop(pool, { state: "rejected_signature", provider_event_id: ev.providerEventId, kind: ev.kind,
      phone_number_id: ev.phoneNumberId, body_sha256: sha, error_code: "bad_signature" });
    return { status: 401, outcomes: events.map(() => "rejected_signature") };
  }
  const outcomes: string[] = [];
  for (const ev of events) outcomes.push(await ingestOne(pool, ev, rawBody, sha));
  return { status: 200, outcomes };
}
async function drop(pool: pg.Pool, p: Record<string, string>) {
  const c = await pool.connect();
  try {
    await c.query(`select meta_webhook_drop($1::jsonb)`, [JSON.stringify(p)]);
  } finally {
    c.release();
  }
}
async function ingestOne(pool: pg.Pool, ev: Parsed, raw: string, sha: string): Promise<string> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const route = (await c.query(`select tenant_id from waba_route_resolve($1)`, [ev.phoneNumberId])).rows[0] as { tenant_id: string } | undefined;
    const p: Record<string, Json> = { provider_event_id: ev.providerEventId, kind: ev.kind, phone_number_id: ev.phoneNumberId, body_sha256: sha };
    if (route) {
      const keys = await webhookKeys(c, route.tenant_id);
      const r = ring();
      const sealedRaw = encryptField(r, keys, P_RAW, raw);
      p.raw_payload_enc = sealedRaw;
      p.payload_dek_ref = dekRef(sealedRaw);
      if (ev.kind === "message") {
        Object.assign(p, { contact_wa_id: ev.contactWaId, direction: ev.direction, sent_via: ev.sentVia, msg_kind: ev.msgKind,
          provider_message_id: ev.providerEventId, provider_at: ev.at.toISOString() });
        if (ev.contactName) {
          const s = encryptField(r, keys, P_CONTACT, ev.contactName);
          Object.assign(p, { contact_name_enc: s, contact_name_dek_ref: dekRef(s) });
        }
        if (ev.body) {
          const s = encryptField(r, keys, P_BODY, ev.body);
          Object.assign(p, { body_enc: s, body_dek_ref: dekRef(s) });
        }
        if (ev.mediaMetaId) Object.assign(p, { media_meta_id: ev.mediaMetaId, media_mime_type: ev.mediaMimeType });
      } else {
        Object.assign(p, { target_message_id: ev.target, observed_status: ev.status, status_at: ev.at.toISOString() });
      }
    }
    const out = (await c.query(`select meta_webhook_ingest($1::jsonb) r`, [JSON.stringify(p)])).rows[0].r as string;
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

// ── Staff commands ─────────────────────────────────────────────────────────────────────────────────────────────────

export type SendRequest = { kind: "text"; body: string } | { kind: "template"; templateId: string; params: string[] };
// Send in two steps (r1 P2-1): the definer decides (window, approved template, consent, capability), the mock port sends, the definer
// records queued → sent. A replay returns the stored message.
export async function sendInboxMessage(db: pg.ClientBase, key: string, conversationId: string, req: SendRequest, o: { port?: InboxPort } = {}) {
  await assertProductionGoLive(db);
  await bindDeployEnv(db);
  const p: Record<string, Json> = { kind: req.kind };
  if (req.kind === "text") {
    const text = req.body.trim();
    if (!text || text.length > 4096) throw new InboxError("ERR_INVALID_INPUT", "body");
    const keys = await staffKeys(db, true);
    const s = encryptField(ring(), keys!, P_BODY, text);
    Object.assign(p, { body_enc: s, body_dek_ref: dekRef(s) });
  } else {
    p.template_id = req.templateId;
  }
  // the fingerprint covers the intent, never the ciphertext (a fresh IV per attempt)
  const body: Record<string, Json> = { conversation_id: conversationId, kind: req.kind,
    digest: createHash("sha256").update(req.kind === "text" ? req.body.trim() : `${req.templateId}|${req.params.join("|")}`).digest("hex") };
  const out = await call(() => runCommand<Json>(db, { command: "inbox_send", key, body },
    async (c) => ((await c.query(`select inbox_send_queue($1, $2, $3::jsonb) r`, [key, conversationId, JSON.stringify(p)])).rows[0]?.r ?? null) as Json));
  if (!out.ok) throw out.error;
  const q = out.result as Record<string, Json>;
  // a replay (the idempotency record or the definer's own key) never calls the port again
  if (out.replayed || q.replayed === true || q.status !== "queued") {
    const cur = (await db.query(`select status from messages where id = $1`, [q.message_id])).rows[0];
    return { messageId: String(q.message_id), status: String(cur?.status ?? q.status), replayed: true };
  }
  const route = (await db.query(`select w.meta_waba_id, n.phone_number_id, c.contact_wa_id, c.waba_id
       from conversations c join waba_accounts w on w.tenant_id = c.tenant_id and w.id = c.waba_id
       join wa_numbers n on n.tenant_id = c.tenant_id and n.id = c.wa_number_id where c.id = $1`, [conversationId])).rows[0];
  const sealed = (await call(() => db.query(`select encrypted_token from inbox_sealed_token($1)`, [route.waba_id]))).rows[0];
  if (!sealed) throw new InboxError("ERR_VERSION_CONFLICT", "no_active_token");
  const keys = await staffKeys(db, false);
  const accessToken = decryptField(ring(), keys!, "waba.token", sealed.encrypted_token);
  const port = portOr(o.port);
  const sent = req.kind === "text"
    ? await port.sendMessage({ kind: "text", metaWabaId: route.meta_waba_id, phoneNumberId: route.phone_number_id, to: route.contact_wa_id, body: req.body.trim(), accessToken })
    : await port.sendMessage({ kind: "template", metaWabaId: route.meta_waba_id, phoneNumberId: route.phone_number_id, to: route.contact_wa_id,
        templateName: String(q.template_name), language: String(q.template_language), params: req.params, accessToken });
  const status = await call(async () => (await db.query(`select inbox_send_record($1, $2) r`, [q.message_id, sent.providerMessageId])).rows[0].r as string);
  return { messageId: String(q.message_id), status, replayed: out.replayed };
}

export type ConversationAction =
  | { action: "assign"; staffId: string } | { action: "unassign" } | { action: "route"; branchId: string } | { action: "match"; patientId: string }
  | { action: "close" } | { action: "reopen" } | { action: "labels"; labels: string[] };
export async function updateConversation(db: pg.ClientBase, conversationId: string, a: ConversationAction) {
  await assertProductionGoLive(db);
  const p: Record<string, Json> = { action: a.action };
  if (a.action === "assign") p.staff_id = a.staffId;
  if (a.action === "route") p.branch_id = a.branchId;
  if (a.action === "match") p.patient_id = a.patientId;
  if (a.action === "labels") p.labels = a.labels;
  return call(async () => (await db.query(`select inbox_conversation_update($1, $2::jsonb) r`, [conversationId, JSON.stringify(p)])).rows[0].r);
}

export async function saveTemplate(db: pg.ClientBase, key: string, t: { name: string; language?: string; category: string; body: string; paramCount?: number }) {
  await assertProductionGoLive(db);
  const p = { name: t.name, language: t.language ?? "id", category: t.category, body: t.body, param_count: t.paramCount ?? 0 };
  return call(async () => (await db.query(`select wa_template_save($1, $2::jsonb) r`, [key, JSON.stringify(p)])).rows[0].r as string);
}
// Sync the approved/pending/rejected templates from the mock port.
export async function syncTemplates(db: pg.ClientBase, o: { port?: InboxPort } = {}) {
  await assertProductionGoLive(db);
  await bindDeployEnv(db);
  if (deployEnv() === "production") throw new InboxError("ERR_NOT_AVAILABLE", "live_graph_not_configured");
  const w = (await db.query(`select id, meta_waba_id from waba_accounts where state <> 'revoked' limit 1`)).rows[0];
  const sealed = w ? (await call(() => db.query(`select encrypted_token from inbox_sealed_token($1)`, [w.id]))).rows[0] : undefined;
  if (!w || !sealed) throw new InboxError("ERR_VERSION_CONFLICT", "no_waba");
  const keys = await staffKeys(db, false);
  const list = await portOr(o.port).fetchTemplates({ metaWabaId: w.meta_waba_id, accessToken: decryptField(ring(), keys!, "waba.token", sealed.encrypted_token) });
  const p = { templates: list.map((t) => ({ name: t.name, language: t.language, category: t.category, status: t.status, body: t.body, param_count: t.paramCount })) };
  return call(async () => (await db.query(`select wa_template_sync($1::jsonb) r`, [JSON.stringify(p)])).rows[0].r as number);
}

// ── Readers (bodies opened on the server for the inbox roles only) ────────────────────────────────────────────────

export type InboxRow = { id: string; branch_id: string | null; branch_name: string | null; contact_wa_id: string; contact_name: string | null;
  patient_id: string | null; patient_name: string | null; assignee_staff_id: string | null; assignee_name: string | null; state: string; labels: string[];
  window_open: boolean; window_expires_at: string | null; awaiting_reply: boolean; first_response_at: string | null; last_activity_at: string };
export type InboxList = { role: string; can_write: boolean; now: string; sla_minutes: number; conversations: InboxRow[] };
const open = (keys: TenantKeys | null, purpose: string, v: string | null) => {
  if (!v || !keys) return null;
  try {
    return decryptField(ring(), keys, purpose, v);
  } catch {
    return null;
  }
};
export async function inboxList(db: pg.ClientBase, filter = "all", branchId: string | null = null): Promise<InboxList> {
  type Raw = Omit<InboxList, "conversations"> & { conversations: (Omit<InboxRow, "contact_name"> & { contact_name_enc: string | null })[] };
  const r = await call(async () => (await db.query(`select inbox_list($1, $2) r`, [filter, branchId])).rows[0].r as Raw);
  const keys = r.conversations.length ? await staffKeys(db, false) : null;
  return { ...r, conversations: r.conversations.map(({ contact_name_enc, ...c }) => ({ ...c, contact_name: open(keys, P_CONTACT, contact_name_enc) })) };
}
export type ThreadMessage = { id: string; direction: "in" | "out"; sent_via: string; kind: string; body: string | null; template_name: string | null;
  media_mime_type: string | null; status: string; at: string; author_name: string | null };
export type Thread = { role: string; can_write: boolean; now: string;
  conversation: { id: string; branch_id: string | null; contact_wa_id: string; contact_name: string | null; patient_id: string | null; assignee_staff_id: string | null;
    state: string; labels: string[]; window_expires_at: string | null; window_open: boolean; sending: boolean };
  messages: ThreadMessage[];
  patient: null | { id: string; full_name: string; mrn: string; marketing_consent: boolean; next_appointment_at: string | null };
  templates: { id: string; name: string; language: string; category: string; param_count: number; body: string }[] };
export async function inboxThread(db: pg.ClientBase, conversationId: string): Promise<Thread> {
  const r = await call(async () => (await db.query(`select inbox_thread_get($1) r`, [conversationId])).rows[0].r);
  const keys = await staffKeys(db, false);
  const { contact_name_enc, ...conv } = r.conversation;
  return { ...r, conversation: { ...conv, contact_name: open(keys, P_CONTACT, contact_name_enc) },
    messages: r.messages.map(({ body_enc, ...m }: { body_enc: string | null } & ThreadMessage) => ({ ...m, body: open(keys, P_BODY, body_enc) })) };
}
export type TemplateList = { role: string; can_manage: boolean;
  templates: { id: string; name: string; language: string; category: string; status: string; body: string; param_count: number; updated_at: string }[] };
export const templateList = (db: pg.ClientBase) => call(async () => (await db.query(`select wa_templates_list() r`)).rows[0].r as TemplateList);
