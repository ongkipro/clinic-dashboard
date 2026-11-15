// Komisi (PR-23, BILL-15, BILL-16, BILL-23, B-12, B-13, B-21, DATA-37; T-087, migration 0102, DEC-099). Server code over the commission
// definers. Rules are prepared by finance (or the owner) and activated by the owner; the rule in force at a sale is resolved at the
// originating invoice's issue and stored on the contribution. Accrual and adjustments are synchronous database triggers on the settlement
// facts (payment allocations, applied deposits, receivable collections, counted treatments, package redemptions, moves to balance,
// package closes, cheaper substitutions, write-offs); this module never computes commission itself.
import type pg from "pg";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../lib/command";
import { assertProductionGoLive } from "../vendor/profile/profile";

export class CommissionError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED", "ERR_IDEMPOTENCY_CONFLICT"]);
export async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CommandError) throw e;
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new CommissionError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}
async function command<T extends Json>(db: pg.ClientBase, name: string, key: string, body: Record<string, Json>, sql: string, args: unknown[]) {
  await assertProductionGoLive(db);
  const out = await call(() => runCommand<T>(db, { command: name, key, body }, async (c) => ((await c.query(sql, args)).rows[0]?.r ?? null) as T));
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}

export const CONTRIBUTION_TYPES = ["closing_bc", "guiding_bc", "new_patient", "performer"] as const;
export type ContributionType = (typeof CONTRIBUTION_TYPES)[number];
export type RuleValue = { kind: "percent"; basisPoints: number } | { kind: "fixed"; fixedAmount: number };
export type RuleInput = RuleValue & {
  contributionType: ContributionType; name: string; role?: string | null; staffId?: string | null; catalogItemId?: string | null;
  category?: string | null; priority?: number; effectiveFrom?: string | null;
};

function value(v: RuleValue & { effectiveFrom?: string | null }): Record<string, Json> {
  const p: Record<string, Json> = { kind: v.kind };
  if (v.kind === "percent") p.basis_points = v.basisPoints;
  else p.fixed_amount = v.fixedAmount;
  if (v.effectiveFrom) p.effective_from = v.effectiveFrom;
  return p;
}

// Aturan Komisi: a new rule with its first draft version.
export async function createRule(db: pg.ClientBase, key: string, r: RuleInput) {
  const p: Record<string, Json> = { contribution_type: r.contributionType, name: r.name, ...value(r) };
  if (r.role) p.role = r.role;
  if (r.staffId) p.staff_id = r.staffId;
  if (r.catalogItemId) p.catalog_item_id = r.catalogItemId;
  if (r.category) p.category = r.category;
  if (r.priority !== undefined) p.priority = r.priority;
  const out = await command<{ rule_id: string; version_id: string }>(db, "commission_rule_create", key, { rule: p },
    `select commission_rule_create($1, $2::jsonb) as r`, [key, JSON.stringify(p)]);
  return { ruleId: out.result.rule_id, versionId: out.result.version_id, replayed: out.replayed };
}
// A new draft version of a rule (a new value from a date; the old one stays for sales before it).
export async function newRuleVersion(db: pg.ClientBase, key: string, ruleId: string, v: RuleValue & { effectiveFrom?: string | null }) {
  const p = value(v);
  const out = await command<string>(db, "commission_rule_version", key, { rule_id: ruleId, version: p },
    `select commission_rule_version($1, $2, $3::jsonb) as r`, [key, ruleId, JSON.stringify(p)]);
  return { versionId: out.result, replayed: out.replayed };
}
// The owner activates (superseding the rule's active version) or cancels a draft.
export async function decideRuleVersion(db: pg.ClientBase, versionId: string, action: "activate" | "cancel") {
  await assertProductionGoLive(db);
  await call(() => db.query(`select commission_rule_decide($1, $2)`, [versionId, action]));
}

// Set the closing/guiding BC of a sale; replacing a set BC opens an attribution_correction approval.
export async function attributeSale(db: pg.ClientBase, key: string, invoiceId: string, a: { closingBcId?: string | null; guidingBcId?: string | null; reason?: string | null }) {
  const p: Record<string, Json> = {};
  if (a.closingBcId) p.closing_bc_staff_id = a.closingBcId;
  if (a.guidingBcId) p.guiding_bc_staff_id = a.guidingBcId;
  if (a.reason) p.reason = a.reason;
  const out = await command<{ attribution_id: string; state: string }>(db, "commission_attribute_sale", key, { invoice_id: invoiceId, attribution: p },
    `select commission_attribute_sale($1, $2, $3::jsonb) as r`, [key, invoiceId, JSON.stringify(p)]);
  return { attributionId: out.result.attribution_id, state: out.result.state, replayed: out.replayed };
}
// Set the guiding BC of an active care plan; replacing one opens an attribution_correction approval.
export async function assignGuidingBc(db: pg.ClientBase, key: string, carePlanId: string, staffId: string, reason?: string | null) {
  const out = await command<{ assignment_id: string; state: string }>(db, "guiding_bc_assign", key, { care_plan_id: carePlanId, staff_id: staffId, reason: reason ?? null },
    `select guiding_bc_assign($1, $2, $3, $4) as r`, [key, carePlanId, staffId, reason ?? null]);
  return { assignmentId: out.result.assignment_id, state: out.result.state, replayed: out.replayed };
}

// Rekap Komisi & Batch: open the batch of a month (YYYY-MM; the window follows SET-44), submit it for the owner's approval (the items
// and per-recipient lines with carry-forward are fixed at submit), mark it paid; the owner decides an exited member's staff receivable.
export async function openBatch(db: pg.ClientBase, key: string, period: string) {
  const out = await command<string>(db, "commission_batch_open", key, { period }, `select commission_batch_open($1, $2) as r`, [key, period]);
  return { batchId: out.result, replayed: out.replayed };
}
export async function submitBatch(db: pg.ClientBase, batchId: string) {
  await assertProductionGoLive(db);
  return call(async () => (await db.query(`select commission_batch_submit($1) as r`, [batchId])).rows[0].r as string);
}
export async function markBatchPaid(db: pg.ClientBase, batchId: string, method: "cash" | "transfer") {
  await assertProductionGoLive(db);
  await call(() => db.query(`select commission_batch_mark_paid($1, $2)`, [batchId, method]));
}
export async function decideStaffReceivable(db: pg.ClientBase, id: string, state: "settled" | "waived", reason: string) {
  await assertProductionGoLive(db);
  await call(() => db.query(`select staff_commission_receivable_decide($1, $2, $3)`, [id, state, reason]));
}

// ── readers (UX-16): the database decides who reads; no patient data in any of them ──
export type RuleVersion = { id: string; version: number; kind: "percent" | "fixed"; basis_points: number | null; fixed_amount: number | null;
  effective_from: string; state: "draft" | "active" | "superseded" | "cancelled"; ended_at: string | null; prepared_by: string | null;
  in_force: boolean; ended: boolean }; // in force now / its window over (the database clock)
export type Rule = { id: string; name: string; contribution_type: ContributionType; role: string | null; category: string | null; priority: number;
  staff: { id: string; name: string } | null; item: { id: string; code: string } | null; versions: RuleVersion[] };
export type RuleList = { role: string; can_prepare: boolean; can_activate: boolean; rules: Rule[]; staff: { id: string; name: string }[]; items: { id: string; name: string }[] };
export const listRules = (db: pg.ClientBase) => call(async () => (await db.query(`select commission_rules_list() as r`)).rows[0].r as RuleList);
export type Simulation = { basis: number; contributions: { type: ContributionType; staff_id: string | null; rule_version_id: string | null; kind: string | null;
  basis_points: number | null; fixed_amount: number | null; amount: number }[] };
export const simulateRule = (db: pg.ClientBase, p: { itemId: string; price: number; at?: string | null; closingBcId?: string | null; guidingBcId?: string | null;
  registrarId?: string | null; performerId?: string | null }) => {
  const q: Record<string, Json> = { item_id: p.itemId, price: p.price };
  if (p.at) q.at = p.at;
  if (p.closingBcId) q.closing_bc_staff_id = p.closingBcId;
  if (p.guidingBcId) q.guiding_bc_staff_id = p.guidingBcId;
  if (p.registrarId) q.registrar_staff_id = p.registrarId;
  if (p.performerId) q.performer_staff_id = p.performerId;
  return call(async () => (await db.query(`select commission_rule_simulate($1::jsonb) as r`, [JSON.stringify(q)])).rows[0].r as Simulation);
};
export const BATCH_STATES = ["draft", "pending_approval", "approved", "paid"] as const;
export type BatchState = (typeof BATCH_STATES)[number];
export type BatchSummary = { id: string; period: string; period_start: string; period_end: string; closing_day: string; state: BatchState; approval_id: string | null;
  submitted_at: string | null; paid_at: string | null; paid_method: string | null; submitted_by: string | null; recipients: number; net_payable: number; open_period: boolean };
export type BatchList = { role: string; staff_id: string; can_open: boolean; can_pay: boolean; can_approve: boolean; batches: BatchSummary[];
  unbatched: { gross: number; adjustments: number };
  receivables: { id: string; staff: string; amount: number; state: "open" | "settled" | "waived"; decided_at: string | null; decision_reason: string | null }[] };
export const listBatches = (db: pg.ClientBase) => call(async () => (await db.query(`select commission_batches_list() as r`)).rows[0].r as BatchList);
export type BatchLine = { staff_id: string; staff: string; gross: number; adjustments: number; carry_forward_in: number; net_payable: number; carry_forward_out: number; types: ContributionType[] };
export type BatchDetail = { role: string; can_submit: boolean; can_approve: boolean; can_pay: boolean; lines: BatchLine[];
  batch: Omit<BatchSummary, "submitted_by" | "recipients" | "net_payable"> & { submitted_by_me: boolean; approval_state: string | null } };
export const getBatch = (db: pg.ClientBase, batchId: string) => call(async () => (await db.query(`select commission_batch_get($1) as r`, [batchId])).rows[0].r as BatchDetail);
export type ExportRow = { staff_id: string; staff_name: string; gross: number; adjustments: number; carry_forward_in: number; net_payable: number; carry_forward_out: number };
export const exportBatch = (db: pg.ClientBase, batchId: string) =>
  call(async () => (await db.query(`select staff_id, staff_name, gross::int8 gross, adjustments::int8 adjustments, carry_forward_in::int8 carry_forward_in,
    net_payable::int8 net_payable, carry_forward_out::int8 carry_forward_out from commission_batch_export($1)`, [batchId])).rows.map((r) => ({
    ...r, gross: Number(r.gross), adjustments: Number(r.adjustments), carry_forward_in: Number(r.carry_forward_in), net_payable: Number(r.net_payable), carry_forward_out: Number(r.carry_forward_out),
  })) as ExportRow[]);
// CSV of the export (RFC 4180; a formula-leading name is prefixed with ' so a spreadsheet never evaluates it).
export function exportCsv(rows: ExportRow[]) {
  const cell = (v: string | number) => {
    const s = String(v);
    const safe = /^[=+\-@\t\r]/.test(s) && typeof v === "string" ? `'${s}` : s;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const head = ["Penerima", "Kotor", "Penyesuaian", "Bawaan Masuk", "Dibayar", "Bawaan Keluar"];
  return [head, ...rows.map((r) => [r.staff_name, r.gross, r.adjustments, r.carry_forward_in, r.net_payable, r.carry_forward_out])].map((l) => l.map(cell).join(",")).join("\r\n") + "\r\n";
}
export type MineRow = { id: string; kind: "entitlement" | "adjustment"; at: string; type: ContributionType; amount: number; basis?: number; cause?: string;
  after_payout?: boolean; item: string | null; invoice: string | null; branch: string | null;
  rule?: { kind: string; basis_points: number | null; fixed_amount: number | null; version: number } };
export type Mine = { role: string; month: string; rows: MineRow[];
  lines: { period: string; state: BatchState; gross: number; adjustments: number; carry_forward_in: number; net_payable: number; carry_forward_out: number; paid_at: string | null }[];
  receivables: { amount: number; state: string }[] };
export const myCommission = (db: pg.ClientBase, month: string) => call(async () => (await db.query(`select commission_mine($1) as r`, [month])).rows[0].r as Mine);
