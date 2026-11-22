// Pasienku (UX-35 BC home, PR-33d; T-112): the loader core. It composes the props of the presentational view from the readers a BC may call — nothing is recomputed and
// nothing is invented. K19 (target, closing value, plans) and the own commission K17 come from ONE reading, `target_mine` (its scorecard's commission_net = gross + adjustments
// of the month), so the two figures cannot disagree and no other staff member's figure has a place to enter. "Perlu Dihubungi", "Belum Memilih" and "Paket Hampir Habis" are the BC's
// own follow-up tasks (`followup_list`, scope "mine": assignee = the acting BC); "Menunggu Dokter" is the visits of the branch's day whose intake this BC sent and the doctor has not
// started (`pendampingan_visits`). What no reader a BC may call carries — K9 (dashboard_kpi refuses the role), the dormant count (the CS queue), the item counts and value of a plan,
// the sessions left of a package — is `unavailable` with its reason, never 0. The database decides who reads what; data.ts puts the role gate in front, and this core — no
// `server-only` — is what the PostgreSQL tests and the isolation case run as another tenant's BC.
import type pg from "pg";
import { CommandError } from "../../../lib/command";
import { myTarget, type MyTarget } from "../../../modules/commission/targets/targets";
import { queue, type QueueVisit } from "../../../modules/clinical/intake/intake";
import { type FollowupRow, followupList, type FollowupRule } from "../../../modules/crm/followups/followups";
import { getBranch } from "../../../modules/org/branches/branches";
import { localDate, time as clock, ZONE } from "../jadwal/labels";
import type { Amount, ContactRow, FollowupReason, PackageRow, PasienkuData, PasienkuProps, Rows, Target, UnselectedRow, WaitingRow } from "./model";

// The BC only: every reader below is the BC's own (target_mine admits the eight own-target roles, pendampingan_visits and the BC queue of followup_list the BC).
export const READERS = ["bc"] as const;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The drill-down pages that exist on main. /saya/target and /lead/tindak-lanjut are built by HYG-NAV-1 and are not integrated yet: a link to a page that is not built is a dead link, so it is null.
export const LINKS = { visit: (id: string) => `/pendampingan/${id}`, patient: (id: string) => `/pasien/${id}`, komisi: "/saya/komisi" } as const;
export const OPEN_LIMIT = 200; // followup_list answers at most 200 rows: a full page is not a count
export const REASONS = {
  followups: "Tugas tindak lanjut belum bisa dibaca",
  target: "Target dan komisi belum bisa dibaca",
  visits: "Antrean pendampingan belum bisa dibaca",
  full: "Daftar tindak lanjut penuh (200); mungkin masih ada yang belum tampil",
  skipped: "Ada tugas yang tidak bisa ditampilkan karena datanya tidak lengkap",
  k9: "Rencana dipilih per BC belum tersedia: pembaca dashboard tidak melayani peran BC",
  dormant: "Pasien lama tidak datang ada di antrean CS; BC belum punya pembacanya",
  noteUnselected: "Jumlah item dan nilai rencana belum tersedia: pembaca tindak lanjut tidak membawanya.",
  notePackage: "Sisa sesi dan masa berlaku belum tersedia: pembaca tindak lanjut hanya membawa tanggal pengingat.",
  badAmount: "Nilai dari pembacaan tidak valid",
} as const;

export type Branch = { id: string; name: string };
export type Pasienku =
  | { kind: "no-branch" }
  | { kind: "forbidden" }
  | { kind: "ok"; props: PasienkuProps; branchId: string };

type Guarded<T> = { ok: true; value: T } | { ok: false; error: unknown };
let seq = 0;
// One reader call under a SAVEPOINT: a reader that refuses or fails rolls back to its savepoint, so the surrounding transaction stays usable for the next reader. A failure that is not
// a refusal is logged by reader name only (never a payload). A dead connection is not swallowed: the rollback itself throws.
async function guarded<T>(db: pg.ClientBase, what: string, fn: () => Promise<T>): Promise<Guarded<T>> {
  const sp = `ps${++seq}`;
  await db.query(`savepoint ${sp}`);
  try {
    const value = await fn();
    await db.query(`release savepoint ${sp}`);
    return { ok: true, value };
  } catch (error) {
    await db.query(`rollback to savepoint ${sp}`);
    const refused = error instanceof CommandError && ["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT"].includes(error.code);
    if (!refused) console.error("pasienku: reader failed", { reader: what, error: error instanceof Error ? error.name : "unknown" });
    return { ok: false, error };
  }
}

const nat = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const int = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n);
const amountOf = (n: unknown): Amount => (nat(n) ? { state: "value", rp: n } : { state: "unavailable", reason: REASONS.badAmount });
const gap = (reason: string): { state: "unavailable"; reason: string } => ({ state: "unavailable", reason });

const REASON_OF: Record<string, FollowupReason> = {
  control_due: "control_due", package_stage: "package_stage", package_expiry: "package_expiry", instalment_locked: "instalment_locked", receivable: "receivable",
  plan_unselected: "plan_unselected", no_show: "no_show", dormant: "dormant", reschedule_request: "reschedule_request", survey_low: "survey_low",
};
// "Perlu Dihubungi" holds the BC's due-or-overdue contact tasks; the plan and package rules have their own sections below.
const OWN_SECTION_RULES: FollowupRule[] = ["plan_unselected", "package_expiry"];

// A follow-up row the view can show: an identity (the BC reads names and MRNs: followup_json), a known reason word, a due date. A row the view cannot type is dropped from
// its list and counted in `skipped`, so the section says so instead of showing a smaller list as if it were the whole one.
function typed(f: FollowupRow): { patient: string; mrn: string; reason: FollowupReason; dueOn: string } | null {
  if (typeof f.patient_name !== "string" || typeof f.patient_mrn !== "string" || !(f.rule_code in REASON_OF) || typeof f.due_on !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(f.due_on)) return null;
  return { patient: f.patient_name, mrn: f.patient_mrn, reason: REASON_OF[f.rule_code], dueOn: f.due_on };
}

// Whole days between two calendar dates (the branch's own date), never negative.
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Number.isNaN(a) || Number.isNaN(b) ? 0 : Math.max(0, Math.round((b - a) / 86_400_000));
}

const monthOf = (day: string) => day.slice(0, 7);
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const periodLabel = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1] ?? key} ${key.slice(0, 4)}`;

// "Menunggu Dokter": today's open visits of the branch whose intake was SENT BY THIS BC and whose doctor step has not started. `author_id` is the only marker of "my patient" the
// BC's reader carries; a visit without a sent intake is not waiting for the doctor yet.
export function waitingOf(visits: QueueVisit[], staffId: string, tz: string): WaitingRow[] {
  return visits
    .filter((v) => !v.closed && v.intakeState === "sent" && v.authorId === staffId && v.doctor === "not_started")
    .map((v) => ({ visitId: v.id, patient: v.patientName, mrn: v.patientMrn, arrived: `${clock(v.checkedInAt, tz)} ${ZONE[tz] ?? ""}`.trim(), href: LINKS.visit(v.id) }));
}

const done = <T,>(rows: T[], extra: { incomplete?: string; note?: string } = {}): Rows<T> => ({ state: "value", rows, ...extra });

export function targetOf(t: MyTarget): { target: Target; commission: PasienkuData["commission"] } {
  const closing = amountOf(t.closing_value_actual);
  const tgt: Amount | null = t.target === null ? null : amountOf(t.target.closing_value_target);
  const net = int(t.scorecard?.commission_net) ? ({ state: "value", rp: t.scorecard.commission_net } as const) : ({ state: "unavailable", reason: REASONS.badAmount } as const);
  return {
    target: { period: periodLabel(t.period), closing, target: tgt, plansActual: nat(t.plans_actual) ? t.plans_actual : null, plansTarget: t.target && nat(t.target.plans_target) ? t.target.plans_target : null, href: null },
    commission: { amount: net, href: LINKS.komisi },
  };
}

export async function summaryIn(db: pg.ClientBase, role: string, activeBranchId: string | null, staffId: string, staffName: string, now: Date = new Date()): Promise<Pasienku> {
  if (!(READERS as readonly string[]).includes(role)) return { kind: "forbidden" };
  if (!activeBranchId) return { kind: "no-branch" };
  const branch = await getBranch(db, activeBranchId);
  if (!branch) return { kind: "no-branch" };
  const tz = branch.timezone;
  const today = localDate(now, tz);

  // K19 and the own commission: ONE reader, the month of the branch's own date (target_period takes the month explicitly; SET-25 may make the default a quarter).
  const tg = await guarded(db, "target_mine", () => myTarget(db, monthOf(today)));
  // The BC's own open tasks: assigned to this BC (scope "mine"); the identity of the patient is what followup_json gives a BC.
  const fu = await guarded(db, "followup_list", () => followupList(db, "open", "mine"));
  // The branch's day, for the doctor wait.
  const qu = await guarded(db, "pendampingan_visits", () => queue(db, branch.id));

  const followups: FollowupRow[] = fu.ok && Array.isArray(fu.value.followups) ? fu.value.followups : [];
  const full = fu.ok && followups.length >= OPEN_LIMIT;
  // belt and braces: the reader already filters by assignee and queue; the view never shows a row that is not this BC's own open BC-queue task
  const owned = followups.filter((f) => f.state === "open" && f.role_queue === "bc" && f.assignee_staff_id === staffId);

  const contactRows: ContactRow[] = [];
  const unselected: UnselectedRow[] = [];
  const packages: PackageRow[] = [];
  let skipped = 0;
  for (const f of owned) {
    const t = typed(f);
    if (!t) { skipped += 1; continue; }
    const link = typeof f.patient_id === "string" && UUID.test(f.patient_id) ? LINKS.patient(f.patient_id) : null;
    if (f.rule_code === "plan_unselected") {
      unselected.push({ id: f.id, patient: t.patient, mrn: t.mrn, items: null, value: null, dueOn: t.dueOn, overdueDays: f.overdue === true ? daysBetween(t.dueOn, today) : 0, href: link });
    } else if (f.rule_code === "package_expiry") {
      packages.push({ id: f.id, patient: t.patient, mrn: t.mrn, sessionsLeft: null, validUntil: null, dueOn: t.dueOn, href: link });
    } else if (!OWN_SECTION_RULES.includes(f.rule_code) && (f.overdue === true || f.due_today === true)) {
      contactRows.push({ id: f.id, patient: t.patient, mrn: t.mrn, reason: t.reason, dueOn: t.dueOn, overdue: f.overdue === true, href: link });
    }
  }
  // A list is only as complete as the page the reader answered: a full page or an untypable row is said, never silently a smaller list.
  const incomplete = full ? REASONS.full : skipped > 0 ? REASONS.skipped : undefined;
  const fromFollowups = <T,>(rows: T[], note?: string): Rows<T> => (fu.ok ? done(rows, { ...(incomplete ? { incomplete } : {}), ...(note && rows.length > 0 ? { note } : {}) }) : gap(REASONS.followups));

  const { target, commission } = tg.ok
    ? targetOf(tg.value)
    : { target: { period: periodLabel(monthOf(today)), closing: gap(REASONS.target), target: null, plansActual: null, plansTarget: null, href: null } satisfies Target, commission: { amount: gap(REASONS.target), href: LINKS.komisi } };

  const data: PasienkuData = {
    contact: fromFollowups(contactRows),
    waiting: qu.ok ? done(waitingOf(qu.value.visits, staffId, tz)) : gap(REASONS.visits),
    unselected: fromFollowups(unselected, REASONS.noteUnselected),
    packages: fromFollowups(packages, REASONS.notePackage),
    dormant: { ...gap(REASONS.dormant), href: null },
    k9: { ...gap(REASONS.k9), href: null },
    target,
    commission,
  };
  const props: PasienkuProps = { staff: staffName, branch: branch.name, state: { kind: "ready", data } };
  return { kind: "ok", props, branchId: branch.id };
}
