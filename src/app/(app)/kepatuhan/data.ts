// Server data for Kepatuhan & Pendapat Ahli (UX-58, PR-97). Server only.
import { type RenderedContext, renderedContext } from "../../../modules/org/context/context";
import "server-only";
import type { Role } from "../../../auth/policy";
import { withTenantContext } from "../../../db/rls/context";
import { type EvidenceDecision, type EvidenceFile, itemDetail, register, type RegisterRow } from "../../../modules/compliance/compliance";
import { appPool, requestContext } from "../../../modules/org/context/store";

// 07 "Compliance register": owner ●, facility head (clinical), finance (tax/accounting),
// Admin Pusat and auditor read.
export const READERS: readonly Role[] = ["owner", "admin_pusat", "auditor", "facility_head", "finance"];

export type RegisterPage =
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" }
  | { kind: "ok"; rows: RegisterRow[]; filter: string | null };

const FILTERS = new Set(["missing", "submitted", "approved", "expired", "rejected", "revoked"]);

export async function loadRegister(status: string | undefined): Promise<RegisterPage> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return rc;
  if (rc.kind === "blocked") return { kind: "forbidden" };
  if (!READERS.includes(rc.active.context.actingRole)) return { kind: "forbidden" };
  const rows = await withTenantContext(await appPool(), rc.active.context, register);
  const filter = status && FILTERS.has(status) ? status : null;
  return { kind: "ok", rows: filter ? rows.filter((r) => r.status === filter) : rows, filter };
}

export type ItemPage =
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "ok"; row: RegisterRow; files: EvidenceFile[]; decisions: EvidenceDecision[]; ctx: RenderedContext };

// One obligation by key: tenant items show files and decisions; vendor items status only.
export async function loadItem(key: string): Promise<ItemPage> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return rc;
  if (rc.kind === "blocked") return { kind: "forbidden" };
  if (!READERS.includes(rc.active.context.actingRole)) return { kind: "forbidden" };
  return withTenantContext(await appPool(), rc.active.context, async (db) => {
    const row = (await register(db)).find((r) => r.obligationKey === key);
    if (!row) return { kind: "not-found" as const };
    const detail = row.itemId && row.mayRead ? await itemDetail(db, row.itemId) : { files: [], decisions: [] };
    return { kind: "ok" as const, row, ...detail, ctx: renderedContext(rc.active.context) };
  });
}
