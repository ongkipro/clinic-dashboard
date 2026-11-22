// Ringkasan CS reader wiring (UX-36, PR-33e; T-113 slice 2). Builds CsSummaryData from EXISTING granted readers only, with the authority
// they already have (no migration, no access change):
//   dashboard_kpi k13 (T-107)  → lead → booked → arrived → paid by source (central_cs, marketing, owner, … per 07 Dashboards)
//   dashboard_kpi k14 (T-107)  → % answered within the SLA in effect at entry (sla_mix = the label), within 15 min, median
//   lead_list('new', …) (0107) → open unanswered leads and today's new leads; unassigned count
//   survey_summary (0113)      → low-score surveys (central_cs allowed)
// What no existing reader gives with this authority stays UNAVAILABLE with its reason — never 0 (see SEAMS):
// The overdue list (Scenario PR-33e) uses the settled K14 basis (0126 dashboard_kpi k14, Panel 2 decision 3): a lead that ENTERED while its
// branch was open (branch_is_open at created_at, weekly hours minus closures; a lead without a branch is outside the population), still
// unanswered, past the SLA — lead_list's own `sla_overdue` (wall-clock since entry vs today's SET-20, the live inbox target). Minutes shown are
// wall-clock since entry. CURRENT SEMANTICS: open-at-entry, wall-clock wait ("only opening-hours minutes count" would need a SQL helper —
// a migration outside T-113).
//   - unconfirmed appointments for a tenant-wide CS (appointments_window is per branch and needs a branch);
//   - open service complaints: complaint_list admits central_cs but complaint_readable lets it read only the ones it flagged itself,
//     so a count would understate silently.
// Today's SET-20 (lead_list.sla_minutes) is carried for the CURRENT inbox only; the historical K14 share is labelled by its sla_mix.
// A K14 / K13 reader that refuses the role is "Tidak tersedia untuk peran ini"; a branch outside scope propagates (ERR_NOT_FOUND).
import type pg from "pg";
import { CommandError } from "../../../../lib/command";
import { kpi, type K14Extra } from "../../../../modules/reporting/dashboards/dashboards";
import { leadList, type LeadRow } from "../../../../modules/crm/leads/leads";
import { surveySummary } from "../../../../modules/crm/surveys/surveys";
import type { Count, CsSummaryData, FunnelRow, LeadSource, Ratio } from "./model";

export const SEAMS = {
  unconfirmed: "Janji belum dikonfirmasi belum tersedia untuk semua cabang",
  complaints: "Keluhan layanan hanya terbaca oleh manajer cabang",
} as const;
export const FORBIDDEN = "Tidak tersedia untuk peran ini";

const value = (n: number): Count => ({ state: "value", n });
const off = (reason: string): Count => ({ state: "unavailable", reason });
const ratio = (num: number, den: number): Ratio => ({ state: "value", num, den });
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : 0);
const SOURCES = new Set<LeadSource>(["whatsapp", "walk_in", "phone", "instagram", "tiktok", "website", "referral", "ads", "other"]);

async function part<T>(db: pg.ClientBase, fn: () => Promise<T>): Promise<T | "forbidden"> {
  await db.query("savepoint ringkasan_cs");
  try {
    const r = await fn();
    await db.query("release savepoint ringkasan_cs");
    return r;
  } catch (e) {
    await db.query("rollback to savepoint ringkasan_cs");
    if (e instanceof CommandError && e.code === "ERR_FORBIDDEN") return "forbidden";
    throw e;
  }
}

export type CsWindow = { from: string; to: string; today: string; label: string; branchId?: string | null; href?: (source: LeadSource) => string };

// K14 extra → the view's K14 (pure): the SLA share keeps its at-entry thresholds; no leads = no rate and no median.
export function k14From(x: K14Extra | null, href: string): CsSummaryData["k14"] {
  if (!x) return { state: "unavailable", reason: FORBIDDEN, href };
  return {
    median: x.median_minutes === null ? null : Math.round(x.median_minutes),
    within: ratio(num(x.within_sla), num(x.leads)),
    within15: ratio(num(x.within_15m), num(x.leads)),
    slaMix: (x.sla_mix ?? []).map((m) => ({ minutes: num(m.minutes), leads: num(m.leads), within: num(m.within) })),
    trend: [], // lazy: a weekly trend needs one dashboard_kpi call per week; the window total is shown until the page asks for weeks
    href,
  };
}

// K13 by_grp1 (source → { lead, booked, arrived, paid }) → funnel rows (pure). An unknown source is dropped, never relabelled.
export function k13From(byGrp1: Record<string, Record<string, number>>, href?: (s: LeadSource) => string): FunnelRow[] {
  return Object.entries(byGrp1).filter(([s]) => SOURCES.has(s as LeadSource)).map(([s, d]) => ({
    source: s as LeadSource, lead: num(d.lead), booked: num(d.booked), arrived: num(d.arrived), paid: num(d.paid), ...(href ? { href: href(s as LeadSource) } : {}),
  }));
}

// Which waiting leads entered while their branch was open: one branch_is_open call per lead in a single statement (the granted K14 check).
export async function enteredOpen(db: pg.ClientBase, leads: readonly Pick<LeadRow, "id" | "branch_id" | "created_at">[]): Promise<Set<string>> {
  const withBranch = leads.filter((l) => l.branch_id !== null);
  if (withBranch.length === 0) return new Set();
  const r = await db.query<{ id: string }>(
    `select x.id from unnest($1::uuid[], $2::uuid[], $3::timestamptz[]) as x(id, branch_id, at) where branch_is_open(x.branch_id, x.at)`,
    [withBranch.map((l) => l.id), withBranch.map((l) => l.branch_id), withBranch.map((l) => l.created_at)]);
  return new Set(r.rows.map((x) => x.id));
}

// The waiting list (pure): opening-hours entrants only, minutes since entry at the reader's `now`, overdue = the reader's own flag.
export function waitingOf(open: readonly LeadRow[], now: string | null, opened: Set<string> | "forbidden"): Pick<CsSummaryData, "waiting" | "waitingUnavailable"> {
  if (now === null || opened === "forbidden") return { waiting: [], waitingUnavailable: FORBIDDEN };
  const t = Date.parse(now);
  return {
    waiting: open.filter((l) => opened.has(l.id)).map((l) => ({
      id: l.id, contact: l.contact_name ?? "Kontak tanpa nama", source: l.source, branch: l.branch_name, assigned: l.assignee_staff_id !== null,
      waitingMinutes: Math.max(0, Math.floor((t - Date.parse(l.created_at)) / 60_000)), overdue: l.sla_overdue, href: `/lead/${l.id}`,
    })),
  };
}

export async function readCsSummary(db: pg.ClientBase, w: CsWindow): Promise<CsSummaryData> {
  const branchId = w.branchId ?? null;
  const k13 = await part(db, () => kpi(db, { kpi: "k13", from: w.from, to: w.to, branchId }));
  const k14 = await part(db, () => kpi(db, { kpi: "k14", from: w.from, to: w.to, branchId }));
  const leads = await part(db, () => leadList(db, "new", "all"));
  const surveys = await part(db, () => surveySummary(db, { branchId: branchId ?? undefined, from: w.from, to: w.to }));

  const local = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  const open = leads === "forbidden" ? [] : leads.leads.filter((l) => l.first_response_at === null && (!branchId || l.branch_id === branchId));
  const opened = leads === "forbidden" ? "forbidden" as const : await part(db, () => enteredOpen(db, open));
  return {
    slaMinutes: leads === "forbidden" ? 15 : leads.sla_minutes, // the current target, for the live inbox only
    ...waitingOf(open, leads === "forbidden" ? null : leads.now, opened),
    unassigned: leads === "forbidden" ? off(FORBIDDEN) : value(open.filter((l) => l.assignee_staff_id === null).length),
    newToday: leads === "forbidden" ? off(FORBIDDEN) : value(open.filter((l) => local(l.created_at) === w.today).length),
    inboxHref: { unassigned: "/lead?tahap=new&lingkup=unassigned", overdue: "/lead?tahap=new" },
    unconfirmed: { count: off(SEAMS.unconfirmed), href: "/jadwal" },
    complaints: { count: off(SEAMS.complaints), href: "/pesan" },
    lowSurveys: { count: surveys === "forbidden" ? off(FORBIDDEN) : value(surveys.reduce((s, g) => s + num(g.low_count), 0)) }, // no link: /lead/tindak-lanjut is not built
    k14: k14From(k14 === "forbidden" ? null : (k14.extra as K14Extra | null), "/lead"),
    k13: k13 === "forbidden" ? { state: "unavailable", reason: FORBIDDEN } : { period: w.label, rows: k13From(k13.by_grp1 as Record<string, Record<string, number>>, w.href) },
  };
}
