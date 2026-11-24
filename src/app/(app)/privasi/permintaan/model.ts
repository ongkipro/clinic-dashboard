// UX-30 ▸ Permintaan pure list & label model (PR-50; T-121).
// A list row carries right, requester kind, MRN only (never patient name or clinical content),
// due time, urgency, state, assignee + active status, and SLA status.
import {
  closedLate,
  deadlineAt,
  minutesLeft,
  type Outcome,
  type Requester,
  type Right,
  RIGHT_LABEL,
  RIGHTS,
  type State,
  urgency,
  type Urgency,
} from "../../../../modules/privacy/requests/requests";
import type { DsrListRow } from "../../../../modules/privacy/requests/db";

export const STATE: Record<State, { label: string; tone: "neutral" | "warning" | "success" | "locked" }> = {
  received: { label: "Diterima", tone: "neutral" },
  in_progress: { label: "Diproses", tone: "warning" },
  closed: { label: "Ditutup", tone: "locked" },
};

export const URGENCY: Record<Urgency, { label: string; tone: "danger" | "warning" | "neutral" | "locked" }> = {
  overdue: { label: "Lewat tenggat", tone: "danger" },
  due_soon: { label: "Kurang dari 24 jam", tone: "warning" },
  on_track: { label: "Sesuai jadwal", tone: "neutral" },
  closed: { label: "Selesai", tone: "locked" },
};

export const OUTCOME: Record<Outcome, string> = {
  fulfilled: "Dipenuhi",
  partially_fulfilled: "Sebagian dipenuhi",
  refused: "Ditolak",
  withdrawn: "Dibatalkan pemohon",
};

export const REQUESTER: Record<Requester, string> = {
  patient: "Pasien",
  guardian: "Wali",
  representative: "Kuasa",
};

export type Filter = { state: "open" | "closed" | "all"; right: Right | null };
export const parseFilter = (q: { status?: string; hak?: string }): Filter => ({
  state: q.status === "closed" || q.status === "all" ? q.status : "open",
  right: (RIGHTS as readonly string[]).includes(q.hak ?? "") ? (q.hak as Right) : null,
});

export type ViewRow = {
  id: string;
  right: string;
  who: string;
  due: Date;
  urgency: Urgency;
  left: number;
  state: State;
  verified: boolean;
  assignee: string | null;
  assigneeActive: boolean;
  outcome: string | null;
  late: boolean;
  closedAt: Date | null;
};

export function shapeList(rows: DsrListRow[], f: Filter, now: Date): ViewRow[] {
  return rows
    .filter((r) => (f.state === "all" || (f.state === "open") === (r.state !== "closed")) && (!f.right || r.right === f.right))
    .map((r) => ({
      id: r.id,
      right: RIGHT_LABEL[r.right],
      who: `${REQUESTER[r.requester]}${r.mrn ? ` · ${r.mrn}` : " · Subjek belum diikat"}`,
      due: deadlineAt(r.receivedAt),
      urgency: urgency(r, now),
      left: minutesLeft(r.receivedAt, now),
      state: r.state,
      verified: !!r.identityVerifiedAt,
      assignee: r.assigneeName,
      assigneeActive: r.assigneeActive,
      outcome: r.outcome ? OUTCOME[r.outcome] : null,
      late: closedLate(r),
      closedAt: r.closedAt,
    }))
    .sort(
      (a, b) =>
        Number(a.state === "closed") - Number(b.state === "closed")
        || (a.state === "closed"
          ? (b.closedAt?.getTime() ?? 0) - (a.closedAt?.getTime() ?? 0)
          : a.due.getTime() - b.due.getTime()),
    );
}

export const counts = (rows: DsrListRow[], now: Date) => ({
  open: rows.filter((r) => r.state !== "closed").length,
  overdue: rows.filter((r) => urgency(r, now) === "overdue").length,
  unverified: rows.filter((r) => r.state !== "closed" && !r.identityVerifiedAt).length,
});

export function timeLeft(minutes: number): string {
  const m = Math.abs(minutes);
  const text = `${Math.floor(m / 60)} jam ${m % 60} menit`;
  return minutes >= 0 ? `${text} lagi` : `lewat ${text}`;
}
