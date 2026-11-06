// Server data for Persetujuan (UX-26, PR-44). Server only.
import { type RenderedContext, renderedContext } from "../../../modules/org/context/context";
import "server-only";
import type { Role } from "../../../auth/policy";
import { withTenantContext } from "../../../db/rls/context";
import { APPROVAL_TYPES, decidableTypes, INBOX_READERS, inboxDetail, type InboxDetail, type InboxRow, listInbox } from "../../../modules/approvals/inbox";
import { appPool, requestContext } from "../../../modules/org/context/store";

export type InboxPage =
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" }
  | { kind: "ok"; rows: InboxRow[]; more: boolean; type: string | null; types: { key: string; label: string }[] };

export async function loadInbox(type: string | undefined): Promise<InboxPage> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return rc;
  if (rc.kind === "blocked") return { kind: "forbidden" };
  const role: Role = rc.active.context.actingRole;
  if (!INBOX_READERS.includes(role)) return { kind: "forbidden" };
  // A type outside this role's types (or unknown) filters to an empty list.
  const t = type ? type.slice(0, 40) : null;
  const { rows, more } = await withTenantContext(await appPool(), rc.active.context, (db) => listInbox(db, role, { type: t ?? undefined }));
  return { kind: "ok", rows, more, type: t, types: decidableTypes(role).map((key) => ({ key, label: APPROVAL_TYPES[key].label })) };
}

export type DetailPage =
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "ok"; detail: InboxDetail; ctx: RenderedContext };

export async function loadDetail(id: string): Promise<DetailPage> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return rc;
  if (rc.kind === "blocked") return { kind: "forbidden" };
  const { staffId, actingRole: role } = rc.active.context;
  if (!INBOX_READERS.includes(role)) return { kind: "forbidden" };
  const detail = await withTenantContext(await appPool(), rc.active.context, (db) => inboxDetail(db, { staffId, role }, id));
  return detail ? { kind: "ok", detail, ctx: renderedContext(rc.active.context) } : { kind: "not-found" };
}
