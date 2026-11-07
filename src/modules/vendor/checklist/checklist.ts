// Onboarding checklist and go-live gate (T-027, PR-59, UX-41). Console calls name the caller by its
// vendor session token; the database runs vendor_guard and re-checks the caller's authority before
// every exit (HYG-008b). Go-live itself is the existing lifecycle step (advanceTenant, to = "live"):
// the database refuses it while a blocker exists and names the first one.
import type pg from "pg";
import { call, type ConsoleCall, type Result } from "../tenants/tenants";

import type { ChecklistItemKey } from "./labels";

export { blockerLabel, CHECKLIST_ITEMS, ITEM_LABEL, type ChecklistItemKey } from "./labels";
export type ChecklistStatus = "open" | "done" | "not_applicable";
export const OPTIONAL_ITEMS: readonly ChecklistItemKey[] = ["payment_port", "waba", "satusehat"];

export type ChecklistItem = {
  item: ChecklistItemKey; branch_id: string | null; branch_code: string | null; branch_name: string | null;
  status: ChecklistStatus; note: string | null; owner_id: string | null; owner: string | null;
  updated_by: string | null; updated_at: string;
};
export type Checklist = {
  id: string; state: string; name: string | null; items: ChecklistItem[];
  blockers: string[]; go_live_at: string | null; staff: { id: string; name: string }[]; my_roles: string[] | null;
};

export function checklist(db: pg.Pool, c: ConsoleCall, tenantId: string) {
  return call<Checklist>(db, `select vendor_console_checklist($1, $2, $3) as r`, [c.token, c.ip, tenantId], { tenant: tenantId });
}

export function setChecklistItem(
  db: pg.Pool, c: ConsoleCall, tenantId: string | null,
  i: { branchId: string | null; item: string; status: string; note: string; ownerId: string | null },
) {
  return call<{ id: string }>(db, `select vendor_console_checklist_set($1, $2, $3, $4, $5, $6, $7, $8) as r`,
    [c.token, c.ip, tenantId, i.branchId, i.item, i.status, i.note, i.ownerId], { tenant: tenantId });
}

export type { Result };
