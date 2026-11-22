// Ringkasan CS (UX-36, PR-33e; T-113). Typed props and pure helpers for the presentational view (view.tsx).
// Data arrives from server readers (T-107 `dash_k13` / `dash_k14`, the existing `lead_list`, the appointment and complaint
// readers); this module carries no clinical content: lead contact display name, source, branch, minutes, counts and links.
// Waiting leads are those that entered while their branch was open (the K14 population, D-08 via branch_is_open); waiting time is minutes
// since entry; the reader's overdue verdict is compared with the live SET-20 target. Unavailable is never shown as 0.
import type { ListState } from "../../../../components/templates/templates";
import { SOURCE } from "../../lead/labels";

export type Count = { state: "value"; n: number } | { state: "unavailable"; reason: string };
export type Ratio = { state: "value"; num: number; den: number } | { state: "unavailable"; reason: string };

export type LeadSource = "whatsapp" | "walk_in" | "phone" | "instagram" | "tiktok" | "website" | "referral" | "ads" | "other";
// An open lead with no first response yet.
// `overdue`: the lead reader's own verdict (lead_list.sla_overdue — exact instant vs today's SET-20); when absent, minutes > target.
export type WaitingLead = { id: string; contact: string; source: LeadSource; branch: string | null; assigned: boolean; waitingMinutes: number; overdue?: boolean; href: string };
export type SlaMix = { minutes: number; leads: number; within: number };
// href is absent while no built page reads the source / branch filter (/lead reads tahap, lingkup, segmen only): the row is plain text.
export type FunnelRow = { source: LeadSource; lead: number; booked: number; arrived: number; paid: number; href?: string };

export type CsSummaryData = {
  slaMinutes: number; // SET-20 (default 15, D-08)
  waiting: WaitingLead[];
  // slice 2 (reader wiring): when the opening-hours wait cannot be read, the overdue list is UNAVAILABLE (reason shown), never "0 lewat";
  // the unassigned count then comes from the lead reader directly instead of the waiting list
  waitingUnavailable?: string;
  unassigned?: Count;
  newToday: Count;
  inboxHref: { unassigned: string; overdue: string }; // UX-17 Pesan filters
  unconfirmed: { count: Count; href: string }; // appointments not yet confirmed
  complaints: { count: Count; href: string }; // open service complaints (Layanan), counts only
  lowSurveys: { count: Count; href?: string }; // href absent while the follow-up page is unbuilt: plain text, the count stays
  // K14 (T-107 r4): `within` counts each lead against the SET-20 in effect when it ENTERED; `slaMix` names those thresholds (the label);
  // `within15` is the fixed 15-minute literal. Today's SET-20 (slaMinutes) never labels this historical share.
  k14: { median: number | null; within: Ratio; within15: Ratio; slaMix: SlaMix[]; trend: { label: string; within: Ratio }[]; href: string }
    | { state: "unavailable"; reason: string; href: string };
  k13: { rows: FunnelRow[]; period: string } | { state: "unavailable"; reason: string };
};

export type ScreenState<D> = Exclude<ListState, { kind: "rows" }> | { kind: "ready"; data: D };
export type CsSummaryProps = { scope: string; state: ScreenState<CsSummaryData>; as?: "main" | "section" };

export const UNAVAILABLE = "Belum tersedia";
const nf = new Intl.NumberFormat("id-ID");
const pf = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });
export const count = (n: number) => nf.format(n);
export const qty = (c: Count) => (c.state === "value" ? nf.format(c.n) : UNAVAILABLE);
export const rate = (r: Ratio) => (r.state === "value" && r.den > 0 ? `${pf.format((r.num * 100) / r.den)}%` : UNAVAILABLE);
export const sourceLabel = (s: LeadSource) => SOURCE[s] ?? s;
// "SLA 15 menit: 1 dari 2 · SLA 30 menit: 1 dari 2" — the thresholds a historical K14 share was measured against.
export const mixText = (mix: SlaMix[]) => mix.map((m) => `SLA ${count(m.minutes)} menit: ${count(m.within)} dari ${count(m.leads)}`).join(" · ");
export const minutes = (m: number) => (m < 60 ? `${count(m)} menit` : `${count(Math.floor(m / 60))} jam ${count(m % 60)} menit`);

// "First response within N minutes in opening hours": a lead is overdue once its opening-hours wait exceeds N.
export const isOverdue = (l: WaitingLead, slaMinutes: number) => l.waitingMinutes > slaMinutes;

// Perlu ditangani: overdue (longest wait first) and unassigned counts.
export function inbox(d: CsSummaryData) {
  const overdue = d.waiting.filter((l) => l.overdue ?? isOverdue(l, d.slaMinutes)).sort((a, b) => b.waitingMinutes - a.waitingMinutes);
  const unassigned: Count = d.unassigned ?? { state: "value", n: d.waiting.filter((l) => !l.assigned).length };
  return { overdue, unassigned };
}

// K13 by source, best paid conversion first; a source with no leads ranks last.
export const conversion = (r: FunnelRow): Ratio => ({ state: "value", num: r.paid, den: r.lead });
export function sortFunnel(rows: FunnelRow[]): FunnelRow[] {
  const v = (r: FunnelRow) => (r.lead > 0 ? r.paid / r.lead : -1);
  return [...rows].sort((a, b) => v(b) - v(a) || b.lead - a.lead || sourceLabel(a.source).localeCompare(sourceLabel(b.source), "id"));
}
