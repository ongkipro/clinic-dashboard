// Dashboard read models (PR-33, Appendix A, UX-60; T-107, migration 0126 provisional). Two on-read definers decide who reads what:
// dashboard_kpi (K1–K18; per KPI role list, Level 3 roles their active branch only; K4/K12/K14/K15/K17 per Panel 2 slice-4 decisions) and
// dashboard_home (the UX-60 role homes). No clinical field is ever in a payload. K19 = target_mine / target_list; Ruang Saya =
// treatment_room_list + appointments_window + target_mine (own commission).
import type pg from "pg";
import { call, isCalendarDate, SubledgerError } from "../../accounting/subledgers/subledgers";

export const KPIS = ["k1", "k2", "k3", "k4", "k5", "k6", "k7", "k8", "k9", "k10", "k11", "k12", "k13", "k14", "k15", "k16", "k17", "k18"] as const;
export type Kpi = (typeof KPIS)[number];
type Counts = Record<string, number>;
export type KpiResult = {
  kpi: Kpi; from: string; to: string; branch_id: string | null; as_of: string;
  total: number | null; // sum of the money parts (K17: accrued + adjusted + paid_net = owed at `to`); null when the KPI has none or no rows,
  // and for K4 when extra.complete is false (never a partial total)
  by_dim: Counts; by_branch: Record<string, Counts>;
  by_grp1: Record<string, Counts>; // K13 source, K15 performer staff id, K17 staff id
  by_grp2: Record<string, Counts>; // K13 assignee staff id, K17 contribution type
  extra: K4Extra | K12Extra | K14Extra | K15Extra | K17Extra | null;
  // K15 rows also carry grp1 (performer) and refs (contributing records: non-additive metadata, the minutes are on the row once)
  rows: ({ branch_id: string | null; day: string; dim: string; amount: number; source_kind: string; source_id: string } & Partial<K15RowExtra>)[] | null;
};
export type K15RowExtra = { grp1: string; refs: { source_kind: string; source_id: string }[] };
// K4 (r3): complete = every cancellation is dated by its writer's fact; when false, total / by_dim / by_branch / rows are empty (unavailable)
export type K4Extra = { undated_cancellations: number; complete: boolean };

export type K12Extra = { booked: number; failed: number };
// K14 (r4): the on-time shares compare the exact elapsed time; median_minutes is for display (one decimal). within_sla counts each lead
// against the SET-20 in effect when it entered; sla_mix splits that count per threshold (the label); sla_minutes is today's setting only.
// The K14 amounts (by_dim / by_branch / rows) are elapsed SECONDS, fraction kept.
export type K14Extra = { leads: number; answered: number; median_minutes: number | null; within_15m: number; within_sla: number; sla_minutes: number;
  sla_mix: { minutes: number; leads: number; within: number }[] };
export type K15Extra = { covered_minutes: number; rostered_minutes: number };
// K17 (r3): by_dim = { accrued, adjusted, paid_net (negative, dated paid_at) } sums to total (owed). current_workflow = gross rupiah of the
// same entitlements / adjustments by their batch's state NOW (informational, not history, never part of owed).
export type K17Extra = { earned_net: number; current_workflow: { as_of: string; accrued: number; pending_approval: number; approved: number; paid: number } };

export function kpi(db: pg.ClientBase, o: { kpi: Kpi; from: string; to: string; branchId?: string | null; detail?: boolean }): Promise<KpiResult> {
  if (!KPIS.includes(o.kpi)) throw new SubledgerError("ERR_INVALID_INPUT", "kpi");
  if (!isCalendarDate(o.from) || !isCalendarDate(o.to)) throw new SubledgerError("ERR_INVALID_INPUT", "period");
  return call(async () => (await db.query(`select dashboard_kpi($1, $2::date, $3::date, $4, $5) as r`,
    [o.kpi, o.from, o.to, o.branchId ?? null, o.detail ?? false])).rows[0].r as KpiResult);
}

type Base = { branch_id: string | null; today: string };
export type KlinisHome = Base & {
  home: "klinis"; complaints_open: number; satusehat_rejected: number; incidents_open: number;
  corrections_pending: { id: string; requested_at: string; requested_by: string }[];
  credentials_expiring: { id: string; staff: string; kind: string; expires_on: string }[];
};
export type MarketingHome = Base & {
  home: "marketing"; month_from: string; leads_by_stage: Counts; dormant_patients: number;
  // r3 (19 :40): K13 source and K14 response for the stated window (month to date), from dashboard_kpi itself
  window: { from: string; to: string };
  k13: { lead: number; booked: number; arrived: number; paid: number; by_source: Record<string, Counts> };
  k14: K14Extra;
  promo_this_month: { code: string; uses: number; discount: number }[];
  surveys_this_month: { count: number; average: number | null; low: number };
};
export type ApotekHome = Base & {
  home: "apotek"; to_prepare: number; to_hand_over: number; near_expiry: number; vials_lapsed: number; vials_due_24h: number;
  po_received_today: number; batches_held: { quarantined: number; recalled: number };
};
export type PembelianHome = Base & { home: "pembelian"; below_min_by_branch: Counts; po_open: number; payables_due: { count: number; outstanding: number } };
export type AuditHome = Base & {
  home: "audit"; month_from: string; manual_discounts: { count: number; discount: number }; voids: { count: number };
  cash_variance: { count: number; absolute: number }; stock_variance: { counts: number; lines: number }; write_offs: { count: number; amount: number };
};
export type RoleHome = KlinisHome | MarketingHome | ApotekHome | PembelianHome | AuditHome;

export const roleHome = (db: pg.ClientBase, branchId?: string | null) =>
  call(async () => (await db.query(`select dashboard_home($1) as r`, [branchId ?? null])).rows[0].r as RoleHome);
