// CRM leads (PR-29, UX-18; T-092, migration 0107, DEC-104). Staff confirm each pipeline step; the definers check the fact behind it (an
// appointment, a checked-in visit, a real payment — Scenario PR-29 refuses converted without one) and decide who may read what (marketing
// masked without consent, the auditor always). A manual lead's contact name is sealed with the tenant DEK (`lead.contact`); a conversation
// lead shows the conversation's sealed name (`message.contact`). No plaintext contact reaches SQL, a log or an event.
import { createHash } from "node:crypto";
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../../lib/command";
import { decryptField, encryptField, newWrappedDek, type KekRing, type TenantKeys, type WrappedDek } from "../../../lib/keys/envelope";
import { EncryptionUnavailableError, kekRing } from "../../../lib/keys/runtime";
import { assertProductionGoLive } from "../../vendor/profile/profile";
import type { LEAD_LOST_REASONS, LEAD_SOURCES, LEAD_STAGES, CAMPAIGN_CHANNELS } from "../schema";

export type LeadStage = (typeof LEAD_STAGES)[number];
export type LeadSource = (typeof LEAD_SOURCES)[number];
export type LostReason = (typeof LEAD_LOST_REASONS)[number];
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];

export class LeadError extends CommandError {
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
    if (m && KNOWN.has(m[1])) throw new LeadError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}
const P_LEAD = "lead.contact";
const P_CONV = "message.contact";
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
const tenantOf = async (db: pg.ClientBase) => (await db.query(`select app_tenant_id() t`)).rows[0].t as string;
async function keys(db: pg.ClientBase, create: boolean): Promise<TenantKeys | null> {
  const tenantId = await tenantOf(db);
  const existing = keysOf(tenantId, (await db.query(`select version, wrapped, is_current from tenant_data_keys_for()`)).rows);
  if (existing || !create) return existing;
  return keysOf(tenantId, (await call(() => db.query(`select version, wrapped from inbox_data_key_ensure($1)`, [newWrappedDek(ring(), tenantId, 1).wrapped]))).rows);
}
const dekRef = (sealed: string) => `dek:v${sealed.split(".")[1]}`;
const digest = (s: string) => createHash("sha256").update(s).digest("hex");

export type NewLead = { source: LeadSource; conversationId?: string; patientId?: string; branchId?: string; campaignId?: string; contactName?: string; contactPhone?: string };
export async function createLead(db: pg.ClientBase, key: string, n: NewLead) {
  await assertProductionGoLive(db);
  const p: Record<string, Json> = { source: n.source };
  if (n.conversationId) p.conversation_id = n.conversationId;
  if (n.patientId) p.patient_id = n.patientId;
  if (n.branchId) p.branch_id = n.branchId;
  if (n.campaignId) p.campaign_id = n.campaignId;
  if (n.contactPhone) p.contact_phone = n.contactPhone;
  const name = n.contactName?.trim();
  if (name) {
    if (name.length < 2 || name.length > 120) throw new LeadError("ERR_INVALID_INPUT", "contact_name");
    const s = encryptField(ring(), (await keys(db, true))!, P_LEAD, name);
    Object.assign(p, { contact_name_enc: s, contact_name_dek_ref: dekRef(s) });
  }
  // the fingerprint never carries the ciphertext (a fresh IV per attempt) nor the name: a digest
  const body: Record<string, Json> = { ...p, contact_name_enc: null, contact_name_dek_ref: null, name_digest: name ? digest(name) : null };
  const out = await call(() => runCommand<string>(db, { command: "lead_create", key, body },
    async (c) => (await c.query(`select lead_create($1, $2::jsonb) r`, [key, JSON.stringify(p)])).rows[0].r as string));
  if (!out.ok) throw out.error;
  return { leadId: out.result, replayed: out.replayed };
}

export type LeadUpdate =
  | { action: "assign"; staffId: string } | { action: "unassign" } | { action: "route"; branchId: string }
  | { action: "match"; patientId: string } | { action: "campaign"; campaignId: string | null };
export async function updateLead(db: pg.ClientBase, leadId: string, u: LeadUpdate) {
  await assertProductionGoLive(db);
  const p: Record<string, Json> = { action: u.action };
  if (u.action === "assign") p.staff_id = u.staffId;
  if (u.action === "route") p.branch_id = u.branchId;
  if (u.action === "match") p.patient_id = u.patientId;
  if (u.action === "campaign" && u.campaignId) p.campaign_id = u.campaignId;
  await call(() => db.query(`select lead_update($1, $2::jsonb)`, [leadId, JSON.stringify(p)]));
}

export type StageChange =
  | { to: "contacted" } | { to: "booked"; appointmentId?: string } | { to: "arrived"; visitId?: string }
  | { to: "converted"; invoiceId?: string } | { to: "lost"; reason: LostReason; note?: string } | { to: "new" };
export async function setLeadStage(db: pg.ClientBase, key: string, leadId: string, s: StageChange) {
  await assertProductionGoLive(db);
  const p: Record<string, Json> = { to: s.to };
  if (s.to === "booked" && s.appointmentId) p.appointment_id = s.appointmentId;
  if (s.to === "arrived" && s.visitId) p.visit_id = s.visitId;
  if (s.to === "converted" && s.invoiceId) p.invoice_id = s.invoiceId;
  if (s.to === "lost") {
    p.reason = s.reason;
    if (s.note?.trim()) p.note = s.note.trim();
  }
  const body: Record<string, Json> = { lead_id: leadId, ...p, note: s.to === "lost" && s.note ? digest(s.note.trim()) : null };
  const out = await call(() => runCommand<string>(db, { command: "lead_stage_set", key, body },
    async (c) => (await c.query(`select lead_stage_set($1, $2::jsonb) r`, [leadId, JSON.stringify(p)])).rows[0].r as string));
  if (!out.ok) throw out.error;
  return { stage: out.result as LeadStage, replayed: out.replayed };
}

export async function saveCampaign(db: pg.ClientBase, key: string, c: { id?: string; name?: string; code?: string; channel?: CampaignChannel; active?: boolean }) {
  await assertProductionGoLive(db);
  const p: Record<string, Json> = {};
  for (const [k, v] of Object.entries(c)) if (v !== undefined) p[k] = v as Json;
  const out = await call(() => runCommand<string>(db, { command: "campaign_save", key, body: p },
    async (cl) => (await cl.query(`select campaign_save($1, $2::jsonb) r`, [key, JSON.stringify(p)])).rows[0].r as string));
  if (!out.ok) throw out.error;
  return { campaignId: out.result, replayed: out.replayed };
}

// ── Readers ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export type LeadRow = {
  id: string; branch_id: string | null; branch_name: string | null; source: LeadSource; campaign_id: string | null; campaign_name: string | null;
  conversation_id: string | null; patient_id: string | null; patient_name: string | null; patient_mrn: string | null; contact_name: string | null;
  contact_phone: string | null; assignee_staff_id: string | null; assignee_name: string | null; stage: LeadStage; lost_reason: LostReason | null;
  lost_note: string | null; marketing_consent: boolean; consent_masked: boolean; first_response_at: string | null; contacted_at: string | null;
  booked_at: string | null; arrived_at: string | null; converted_at: string | null; lost_at: string | null; created_at: string;
  appointment_id: string | null; visit_id: string | null; converted_invoice_id: string | null; sla_minutes: number; response_minutes: number | null; sla_overdue: boolean;
};
export type LeadDetail = LeadRow & { next_appointment_id: string | null; next_visit_id: string | null; next_invoice_id: string | null;
  events: { kind: string; from_stage: LeadStage | null; to_stage: LeadStage; reason: LostReason | null; actor_name: string | null; at: string }[] };
type Raw = Omit<LeadRow, "contact_name"> & { contact_name_enc: string | null; contact_name_source: "lead" | "conversation" | null };
function open(k: TenantKeys | null, r: Raw): string | null {
  if (!k || !r.contact_name_enc) return null;
  try {
    return decryptField(ring(), k, r.contact_name_source === "conversation" ? P_CONV : P_LEAD, r.contact_name_enc);
  } catch {
    return null;
  }
}
const strip = <T extends Raw>(k: TenantKeys | null, r: T) => {
  const { contact_name_enc: _e, contact_name_source: _s, ...rest } = r;
  void _e;
  void _s;
  return { ...rest, contact_name: open(k, r) };
};
export type LeadList = { role: string; can_write: boolean; now: string; sla_minutes: number; counts: Partial<Record<LeadStage, number>>; leads: LeadRow[] };
export async function leadList(db: pg.ClientBase, stage = "open", scope = "all"): Promise<LeadList> {
  const r = await call(async () => (await db.query(`select lead_list($1, $2) r`, [stage, scope])).rows[0].r) as Omit<LeadList, "leads"> & { leads: Raw[] };
  const k = r.leads.some((x) => x.contact_name_enc) ? await keys(db, false) : null;
  return { ...r, leads: r.leads.map((x) => strip(k, x) as LeadRow) };
}
export type LeadView = { role: string; can_write: boolean; me: string; now: string; lead: LeadDetail };
export async function leadGet(db: pg.ClientBase, leadId: string): Promise<LeadView> {
  const r = await call(async () => (await db.query(`select lead_get($1) r`, [leadId])).rows[0].r) as Omit<LeadView, "lead"> & { lead: Raw & Omit<LeadDetail, keyof LeadRow> };
  const k = r.lead.contact_name_enc ? await keys(db, false) : null;
  return { ...r, lead: strip(k, r.lead) as LeadDetail };
}
export type CampaignList = { role: string; can_manage: boolean; campaigns: { id: string; name: string; code: string; channel: CampaignChannel; active: boolean; leads: number }[] };
export const campaignList = (db: pg.ClientBase) => call(async () => (await db.query(`select campaigns_list() r`)).rows[0].r as CampaignList);
