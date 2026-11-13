// Visits and Hari Ini (PR-7, UX-6; T-047, DEC-057). Every call runs inside withTenantContext. Check-in
// and close go through runCommand with the caller's idempotency key (production needs the go-live gate
// first); database errors are mapped outside it. The board reads names and MRNs only: no clinical content.
import type pg from "pg";
import type { StepState, VisitStep } from "../../components/visit-track/visit-track";
import { CommandError, runCommand, type ErrorCode, type Json } from "../../lib/command";
import { assertProductionGoLive } from "../vendor/profile/profile";

const CODE = /^(ERR_[A-Z_]+):\s*(.*)$/;
const KNOWN = new Set(["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT", "ERR_VERSION_CONFLICT", "ERR_TENANT_SUSPENDED"]);

export class VisitError extends CommandError {
  constructor(code: ErrorCode, readonly reason?: string) {
    super(code);
  }
}
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CommandError) throw e;
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new VisitError(m[1] as ErrorCode, m[2]);
    throw e;
  }
}

export const STEP_COLUMNS = ["intake", "doctor", "selection", "consent", "payment", "preparation", "treatment", "dispensing"] as const;
type Column = (typeof STEP_COLUMNS)[number];
export type Step = "not_started" | "in_progress" | "done" | "not_needed" | "blocked";

export type Visit = {
  id: string; kind: "booked" | "walk_in"; checkedInAt: Date; appointmentId: string | null; startsAt: Date | null;
  patientId: string; patientName: string; patientMrn: string; blocker: string | null; closedAt: Date | null;
} & Record<Column, Step>;
export type Arrival = {
  id: string; state: "booked" | "confirmed"; startsAt: Date; checkInFrom: Date; patientId: string; patientName: string; patientMrn: string; serviceName: string;
};
export type Today = { now: Date; timezone: string; today: string; visits: Visit[]; arrivals: Arrival[] };

export async function today(db: pg.ClientBase, branchId: string): Promise<Today> {
  const r = (await call(() => db.query(`select visits_today($1) as r`, [branchId]))).rows[0].r as Record<string, unknown>;
  const d = (x: unknown) => (x ? new Date(x as string) : null);
  return {
    now: new Date(r.now as string), timezone: r.timezone as string, today: r.today as string,
    visits: (r.visits as Record<string, unknown>[]).map((x) => ({
      id: x.id as string, kind: x.kind as Visit["kind"], checkedInAt: new Date(x.checked_in_at as string), appointmentId: (x.appointment_id as string | null) ?? null,
      startsAt: d(x.starts_at), patientId: x.patient_id as string, patientName: x.patient_name as string, patientMrn: x.patient_mrn as string,
      blocker: (x.blocker as string | null) ?? null, closedAt: d(x.closed_at),
      ...(Object.fromEntries(STEP_COLUMNS.map((c) => [c, x[c] as Step])) as Record<Column, Step>),
    })),
    arrivals: (r.arrivals as Record<string, unknown>[]).map((x) => ({
      id: x.id as string, state: x.state as Arrival["state"], startsAt: new Date(x.starts_at as string), checkInFrom: new Date(x.check_in_from as string),
      patientId: x.patient_id as string, patientName: x.patient_name as string, patientMrn: x.patient_mrn as string, serviceName: x.service_name as string,
    })),
  };
}

async function command<T extends Json>(db: pg.ClientBase, command: string, key: string, body: Record<string, unknown>, sql: string, args: unknown[]) {
  await assertProductionGoLive(db);
  const out = await call(() => runCommand<T>(db, { command, key, body: body as never }, async (c) => ((await c.query(sql, args)).rows[0]?.r ?? null) as T));
  if (!out.ok) throw out.error;
  return { result: out.result, replayed: out.replayed };
}

// Pasien Datang: returns the new visit's id (a replay returns the same id).
export async function checkIn(db: pg.ClientBase, key: string, appointmentId: string) {
  const out = await command<string>(db, "visit.check_in", key, { appointment: appointmentId }, `select visit_check_in($1) as r`, [appointmentId]);
  return { visitId: out.result as string, replayed: out.replayed };
}
export const closeVisit = (db: pg.ClientBase, key: string, visitId: string) =>
  command<null>(db, "visit.close", key, { visit: visitId }, `select visit_close($1) as r`, [visitId]);

// The close blocker of an open visit (PR-15, UX-6), in the order the database refuses; null when none.
// unbilled_addition (T-074): a performed addition not billed yet; the visit row does not carry it, so a caller that knows
// passes it (the database refuses it before the unpaid bill).
export type CloseBlocker = "unbilled_addition" | "unpaid_bill" | "pending_dispensing" | "pending_treatment";
export function closeBlocker(v: Pick<Visit, "payment" | "dispensing" | "treatment"> & { unbilledAddition?: boolean }): CloseBlocker | null {
  const held = (s: Step) => s === "in_progress" || s === "blocked";
  if (v.unbilledAddition) return "unbilled_addition";
  if (held(v.payment)) return "unpaid_bill";
  if (held(v.dispensing)) return "pending_dispensing";
  if (held(v.treatment)) return "pending_treatment";
  return null;
}
export const BLOCKER_COPY: Record<CloseBlocker, string> = {
  unbilled_addition: "Tindakan tambahan belum ditagih",
  unpaid_bill: "Tagihan belum lunas",
  pending_dispensing: "Obat belum diserahkan",
  pending_treatment: "Tindakan belum selesai",
};
export const unpaid = (v: Pick<Visit, "payment" | "closedAt">) => v.closedAt === null && (v.payment === "in_progress" || v.payment === "blocked");

// VisitTrack states for a visit (10:70): Daftar is done once checked in; Selesai when closed. Pendampingan
// is the intake step. A blocked step always comes with a blocker text (VisitTrack requires it, r1 P1-3).
const SEGMENT: Record<Column, VisitStep> = {
  intake: "Pendampingan", doctor: "Dokter", selection: "Pilihan", consent: "Persetujuan", payment: "Bayar",
  preparation: "Persiapan", treatment: "Tindakan", dispensing: "Serahkan",
};
const TRACK: Record<Step, StepState> = { not_started: "belum", in_progress: "berjalan", done: "selesai", not_needed: "tidak_perlu", blocked: "terblokir" };
export function trackStates(v: Visit): { states: Partial<Record<VisitStep, StepState>>; blocker?: string } {
  const states: Partial<Record<VisitStep, StepState>> = { Daftar: "selesai", Selesai: v.closedAt ? "selesai" : "belum" };
  for (const c of STEP_COLUMNS) states[SEGMENT[c]] = TRACK[v[c]];
  const cb = v.closedAt ? null : closeBlocker(v);
  const anyBlocked = STEP_COLUMNS.some((c) => v[c] === "blocked");
  const text = v.blocker?.trim() || (cb ? BLOCKER_COPY[cb] : anyBlocked ? "Menunggu penyelesaian kendala" : "");
  return text ? { states, blocker: text } : { states };
}
