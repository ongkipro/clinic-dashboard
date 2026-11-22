// Ringkasan Admin Pusat data (UX-57, PR-33g; T-115): the server wrapper — the role gate (Admin Pusat only) before one tenant transaction that runs readAdminHome (load.ts). Existing readers only (no
// reporting reader, no financial or clinical table). Admin Pusat only; every read is under RLS as that role:
// branches / hours / rooms / branch_services (tenant-wide), catalog_commercial() (active versions, no clinical content),
// listStaff + listCredentials (owner/admin_pusat read all), staff_invitations (owner/admin_pusat), role_requests
// (owner/admin_pusat/…), approvals (the requester reads its own). Prices are never read: only whether an active version exists.
// page.tsx is not added yet: a new route must ship with its cross-tenant case in tests/isolation/cases (DEL-2 gate), which
// is outside T-115's Allowed Paths; the parked page and the needed case are in the T-115 checkpoint notes.
import "server-only";
import { withTenantContext } from "../../../../db/rls/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { readAdminHome } from "./load";
import { type AdminHomeData, mayOpen } from "./model";

export type AdminHome = { kind: "redirect"; to: string } | { kind: "forbidden" } | { kind: "ok"; data: AdminHomeData };

export async function loadAdminHome(): Promise<AdminHome> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return { kind: "redirect", to: rc.to };
  if (rc.kind === "blocked" || !mayOpen(rc.active.context.actingRole)) return { kind: "forbidden" };
  return withTenantContext(await appPool(), rc.active.context, async (db) => ({ kind: "ok" as const, data: await readAdminHome(db) }));
}
