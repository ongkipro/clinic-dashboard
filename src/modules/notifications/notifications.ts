// In-app notifications (PR-54). Runs on the caller's client inside withTenantContext.
// raise(): from a service context (an outbox consumer turning a domain event into an
// alert, with the event id for dedupe) or from a staff action; ack(): a recipient
// acknowledges once for everyone. Database refusals come back as TD-51 CommandErrors.
import type pg from "pg";
import { CommandError, type ErrorCode } from "../../lib/command";

const CODE = /^(ERR_[A-Z_]+):/;
const KNOWN = new Set<string>(["ERR_FORBIDDEN", "ERR_NOT_FOUND"]);

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const m = CODE.exec((e as { message?: string }).message ?? "");
    if (m && KNOWN.has(m[1])) throw new CommandError(m[1] as ErrorCode);
    throw e;
  }
}

export type RaiseInput = {
  type: string;
  to: { role: string; branchId?: string } | { staffId: string };
  subjectKind: string;
  subjectId: string;
  sourceEventId?: string;
};

export async function raise(db: pg.ClientBase, n: RaiseInput): Promise<string> {
  const role = "role" in n.to ? n.to.role : null;
  const staff = "staffId" in n.to ? n.to.staffId : null;
  const branch = "role" in n.to ? (n.to.branchId ?? null) : null;
  return call(async () =>
    (await db.query<{ id: string }>(`select notification_raise($1, $2, $3, $4, $5, $6, $7) as id`, [
      n.type, role, staff, branch, n.subjectKind, n.subjectId, n.sourceEventId ?? null,
    ])).rows[0].id,
  );
}

export async function ack(db: pg.ClientBase, notificationId: string): Promise<Date> {
  return call(async () => (await db.query<{ at: Date }>(`select notification_ack($1) as at`, [notificationId])).rows[0].at);
}

export type Notification = {
  id: string;
  type: string;
  label: string;
  subjectKind: string;
  subjectId: string;
  branchId: string | null;
  createdAt: Date;
  acknowledged: { staffId: string; role: string; name: string; at: Date } | null;
};

// Notifikasi (Saya) and the bell: what the acting staff member may see, newest first.
export async function list(db: pg.ClientBase, opts: { open?: boolean; limit?: number } = {}): Promise<Notification[]> {
  const { rows } = await db.query(
    `select n.id, n.type, coalesce(t.label, n.type) as label, n.subject_kind, n.subject_id, n.branch_id, n.created_at,
            n.acknowledged_by, n.acknowledged_as, n.acknowledged_at, n.acknowledged_name as ack_name
       from notifications n
       left join lateral (select label from notification_labels() l where l.key = n.type) t on true
      where ($1::boolean is not true or n.acknowledged_at is null)
      order by n.created_at desc, n.id desc limit $2`,
    [opts.open ?? false, Math.min(opts.limit ?? 50, 200)],
  );
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    label: r.label,
    subjectKind: r.subject_kind,
    subjectId: r.subject_id,
    branchId: r.branch_id,
    createdAt: r.created_at,
    acknowledged: r.acknowledged_at
      ? { staffId: r.acknowledged_by, role: r.acknowledged_as, name: r.ack_name ?? "", at: r.acknowledged_at }
      : null,
  }));
}

export async function openCount(db: pg.ClientBase): Promise<number> {
  return (await db.query<{ n: number }>(`select count(*)::int as n from notifications where acknowledged_at is null`)).rows[0].n;
}
