// Pasienku — BC home (UX-35, PR-33d; T-112). Typed props and pure helpers for the presentational view (view.tsx).
// Data arrives from server readers scoped to the acting BC (load.ts: `target_mine` for K19 AND the own commission K17 — one reading, so the two
// can never disagree; `followup_list` scope "mine" for the BC's own tasks; `pendampingan_visits` for the doctor wait); this module never
// widens scope and carries no clinical content: patient display name and MRN, a reason word, a date, counts and amounts. Rows carry no
// treatment, finding or note text. A figure the reader could not produce — or that no reader the BC may call carries — is `unavailable`
// with a reason, never 0 (Rp0 and 0% are real values).
import type { ListState } from "../../../components/templates/templates";

export type Amount = { state: "value"; rp: number } | { state: "unavailable"; reason: string };
// A list the view shows. `unavailable`: the reader could not answer (a missing answer is never an empty list, and its heading carries no count). `incomplete`: rows may be
// missing (the reader answered a full page, or a row could not be typed), so the heading says "n+" and an empty list does not claim "nothing to do". `note`: a fact the BC's
// reader does not carry for every row of this section (the item count and value of an unselected plan, the sessions left of a package), said once instead of on each row.
export type Rows<T> = { state: "value"; rows: T[]; incomplete?: string; note?: string } | { state: "unavailable"; reason: string };

// Follow-up reasons the BC queue can hold (FOLLOWUP_RULES); the word, never the clinical source.
export type FollowupReason = "control_due" | "package_stage" | "package_expiry" | "instalment_locked" | "receivable" | "plan_unselected" | "no_show" | "dormant" | "reschedule_request" | "survey_low";
export type ContactRow = { id: string; patient: string; mrn: string; reason: FollowupReason; dueOn: string; overdue: boolean; href: string | null };
export type WaitingRow = { visitId: string; patient: string; mrn: string; arrived: string; href: string | null }; // intake sent by this BC, the doctor has not started; `arrived` = check-in time
// `items`, `value`, `sessionsLeft`, `validUntil` are null when the BC's reader does not carry them (never 0): the section's `note` says so. `overdueDays` = days past the task's due date.
export type UnselectedRow = { id: string; patient: string; mrn: string; items: { recommended: number; selected: number } | null; value: number | null; dueOn: string; overdueDays: number; href: string | null };
export type PackageRow = { id: string; patient: string; mrn: string; sessionsLeft: number | null; validUntil: string | null; dueOn: string; href: string | null };

export type Target = {
  period: string; // "November 2026"
  closing: Amount; // K19 actual closing value
  target: Amount | null; // null = no target set for the period
  plansActual: number | null; // null = the reader's count could not be typed
  plansTarget: number | null;
  href: string | null; // Target Saya (null until that page exists)
};

export type PasienkuData = {
  contact: Rows<ContactRow>;
  waiting: Rows<WaitingRow>;
  unselected: Rows<UnselectedRow>;
  packages: Rows<PackageRow>;
  dormant: { count: number; href: string | null } | { state: "unavailable"; reason: string; href: string | null };
  k9: { selected: number; recommended: number; window: 30 | 60 | 90; href: string | null } | { state: "unavailable"; reason: string; href: string | null };
  target: Target;
  commission: { amount: Amount; href: string | null }; // K17 own = target_mine's commission_net (gross + adjustments of the month), same reading as K19
};

export type ScreenState<D> = Exclude<ListState, { kind: "rows" }> | { kind: "ready"; data: D };
export type PasienkuProps = { staff: string; branch: string; state: ScreenState<PasienkuData>; as?: "main" | "section" };

export const REASON: Record<FollowupReason, string> = {
  control_due: "Jadwal kontrol", package_stage: "Lanjut sesi paket", package_expiry: "Paket hampir kedaluwarsa", instalment_locked: "Cicilan tertahan",
  receivable: "Sisa tagihan", plan_unselected: "Rencana belum dipilih", no_show: "Tidak datang", dormant: "Lama tidak datang",
  reschedule_request: "Minta ubah jadwal", survey_low: "Nilai survei rendah",
};
export const UNAVAILABLE = "Belum tersedia";

const nf = new Intl.NumberFormat("id-ID");
const pf = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });
export const rp = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n).replace(/\s/g, "");
export const money = (a: Amount) => (a.state === "value" ? rp(a.rp) : UNAVAILABLE);
export const count = (n: number) => nf.format(n);

// Oldest due date first (overdue rows are always the oldest), then name: the BC calls the oldest promise first.
export const sortContact = (rows: ContactRow[]) => [...rows].sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.patient.localeCompare(b.patient, "id"));

// The soonest reminder date first (a package whose expiry step is due sooner is nearer its end), then fewer sessions left when the reader carries it, then name. The sessions
// left and the end of validity are facts the BC's reader does not carry (followup_json has none), so they never decide an order on their own.
const left = (r: PackageRow) => r.sessionsLeft ?? Number.POSITIVE_INFINITY;
export const sortPackages = (rows: PackageRow[]) => [...rows].sort((a, b) => a.dueOn.localeCompare(b.dueOn) || left(a) - left(b) || a.patient.localeCompare(b.patient, "id"));
// Oldest overdue first, then name.
export const sortUnselected = (rows: UnselectedRow[]) => [...rows].sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.patient.localeCompare(b.patient, "id"));

// K19 attainment: whole-percent of closing vs target. No target or an unavailable side → no percent; a zero target has no rate.
export type Attainment = { state: "value"; pct: number; text: string } | { state: "none"; text: string };
export function attainment(t: Target): Attainment {
  if (t.target === null) return { state: "none", text: "Target belum ditetapkan" };
  if (t.closing.state !== "value" || t.target.state !== "value") return { state: "none", text: UNAVAILABLE };
  if (t.target.rp <= 0) return { state: "none", text: "Target belum ditetapkan" };
  const pct = (t.closing.rp * 100) / t.target.rp;
  return { state: "value", pct, text: `${pf.format(pct)}% dari target` };
}

export const ratio = (num: number, den: number) => (den > 0 ? `${pf.format((num * 100) / den)}%` : UNAVAILABLE);
