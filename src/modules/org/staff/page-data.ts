// Server data for Staf & Undangan and Pengguna & Akses (UX-3, PR-91). Server only.
import "server-only";
import type { Role } from "../../../auth/policy";
import { withTenantContext } from "../../../db/rls/context";
import { type AccessChange, accessLog, type Duty, duties, type StaffSession } from "../access/access";
import { type RenderedContext, renderedContext } from "../context/context";
import { appPool, requestContext } from "../context/store";
import { type InvitationRow, listInvitations, listStaff, manageableSessions, type StaffRow } from "./staff";

export type StaffPage =
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" }
  | {
      kind: "ok";
      role: Role;
      canManage: boolean; // owner, Admin Pusat
      isOwner: boolean;
      staff: StaffRow[];
      invitations: InvitationRow[];
      branches: { id: string; name: string }[];
      ctx: RenderedContext;
    };

const STAFF_READERS: readonly Role[] = ["owner", "admin_pusat", "manager", "facility_head"];

export async function loadStaffPage(): Promise<StaffPage> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return rc;
  if (rc.kind === "blocked") return { kind: "forbidden" };
  const role = rc.active.context.actingRole;
  if (!STAFF_READERS.includes(role)) return { kind: "forbidden" };
  const canManage = role === "owner" || role === "admin_pusat";
  return withTenantContext(await appPool(), rc.active.context, async (db) => ({
    kind: "ok" as const,
    role,
    canManage,
    isOwner: role === "owner",
    staff: await listStaff(db),
    invitations: canManage ? await listInvitations(db) : [],
    branches: rc.active.branches,
    ctx: renderedContext(rc.active.context),
  }));
}

export type StaffDetail =
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "ok"; canManage: boolean; canAudit: boolean; self: boolean; staff: StaffRow; sessions: StaffSession[]; branches: { id: string; name: string }[]; ctx: RenderedContext };

export async function loadStaffDetail(staffId: string): Promise<StaffDetail> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return rc;
  if (rc.kind === "blocked") return { kind: "forbidden" };
  const role = rc.active.context.actingRole;
  if (!STAFF_READERS.includes(role)) return { kind: "forbidden" };
  if (!/^[0-9a-f-]{36}$/i.test(staffId)) return { kind: "not-found" };
  const admin = role === "owner" || role === "admin_pusat";
  return withTenantContext(await appPool(), rc.active.context, async (db) => {
    const staff = (await listStaff(db)).find((s) => s.staffId === staffId);
    if (!staff) return { kind: "not-found" as const };
    // HYG-009 N1: Admin Pusat may not manage privileged members; the database decides.
    const sessions = admin ? await manageableSessions(db, staffId) : null;
    return {
      kind: "ok" as const,
      canManage: sessions !== null,
      canAudit: admin,
      self: staffId === rc.active.context.staffId,
      staff,
      sessions: sessions ?? [],
      branches: rc.active.branches,
      ctx: renderedContext(rc.active.context),
    };
  });
}

export type AccessPage =
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" }
  | { kind: "ok"; isOwner: boolean; selfId: string; staff: StaffRow[]; duties: { staffId: string; duty: Duty; assignedAt: Date }[]; log: AccessChange[]; ctx: RenderedContext; branches: { id: string; name: string }[] };

export async function loadAccessPage(): Promise<AccessPage> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return rc;
  if (rc.kind === "blocked") return { kind: "forbidden" };
  const role = rc.active.context.actingRole;
  if (role !== "owner" && role !== "admin_pusat") return { kind: "forbidden" };
  return withTenantContext(await appPool(), rc.active.context, async (db) => ({
    kind: "ok" as const,
    isOwner: role === "owner",
    selfId: rc.active.context.staffId,
    staff: await listStaff(db),
    duties: await duties(db),
    log: await accessLog(db, 50),
    branches: rc.active.branches,
    ctx: renderedContext(rc.active.context),
  }));
}
