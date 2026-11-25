// Konsol Vendor › Sesi Dukungan — the projection (UX-44, PR-60; T-129 vendor UI subset). Pure: no database, no React.
// The reader (vendor_console_support_list) answers more than this list may show: the session's free-text purpose, the operator's
// name and the end reason. `projectRows` names the only fields that leave the reader's answer; the page renders nothing else, and
// tests/vendor/support.test.ts runs it over the real reader's answer on a real database.
import type { SessionRow } from "../../../modules/vendor/support/support";

export const STATES = ["pending_approval", "active", "expired", "ended"] as const satisfies readonly SessionRow["state"][];
export type Row = { id: string; tenantId: string; state: SessionRow["state"]; kinds: number; requestedAt: string; endsAt: string | null };

const ISO_TS = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysInMonth = (y: number, mo: number) => (mo === 2 ? (isLeapYear(y) ? 29 : 28) : mo === 4 || mo === 6 || mo === 9 || mo === 11 ? 30 : 31);
function validTimestamp(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = ISO_TS.exec(v);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]), h = Number(m[4]), mi = Number(m[5]), s = Number(m[6]);
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || h > 23 || mi > 59 || s > 59) return false;
  return Number.isFinite(Date.parse(v));
}

// null = the answer is not the shape the reader promises (the page shows its error state, never a partial list).
export function projectRows(raw: unknown): Row[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Row[] = [];
  for (const r of raw as (Partial<SessionRow> | null)[]) {
    const state = STATES.find((s) => s === r?.state);
    if (!r || !state || typeof r.id !== "string" || typeof r.tenant_id !== "string" || !validTimestamp(r.requested_at) || !Array.isArray(r.scope)) return null;
    if (r.ends_at !== null && r.ends_at !== undefined && !validTimestamp(r.ends_at)) return null;
    out.push({ id: r.id, tenantId: r.tenant_id, state, kinds: r.scope.length, requestedAt: r.requested_at, endsAt: r.ends_at ?? null });
  }
  return out;
}
