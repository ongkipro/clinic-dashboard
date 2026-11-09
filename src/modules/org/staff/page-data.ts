// Server data for Staf & Undangan and Pengguna & Akses (UX-3, PR-91). Server only.
import "server-only";
import type { Role } from "../../../auth/policy";
import { withTenantContext } from "../../../db/rls/context";
import { type AccessChange, accessLog, type Duty, duties, type StaffSession } from "../access/access";
import { type RenderedContext, renderedContext } from "../context/context";
import { appPool, requestContext } from "../context/store";
import { type Credential, type Decidable, decidable, listCredentials } from "../licences/licences";
import { type InvitationRow, listInvitations, listStaff, manageableSessions, type StaffRow } from "./staff";

// T-050 (plan r1 P2-1): clinical roles, and the staff a branch-scoped viewer (manager, facility head) may
// see on the Kredensial segment and the detail: those holding a role at one of the viewer's branches.
export const CLINICAL_ROLES: readonly Role[] = ["doctor", "nurse", "therapist", "pharmacist", "facility_head"];
const BRANCH_VIEWERS: readonly Role[] = ["manager", "facility_head"];
// A clinical role at one of the viewer's branches (review r1 P2-2: the database scopes credentials by
// clinical branches, so a non-clinical role elsewhere must not bring the person into view).
const inScope = (s: StaffRow, role: Role, branches: readonly string[]) =>
  !BRANCH_VIEWERS.includes(role) || s.roles.some((r) => CLINICAL_ROLES.includes(r.role) && r.branchIds.some((b) => branches.includes(b)));
// The branch-local date for status badges (YYYY-MM-DD) in the active branch's zone (else the first branch's).
async function localToday(db: Parameters<typeof listStaff>[0], branchId: string | undefined): Promise<string> {
  const { rows } = await db.query<{ d: string }>(
    `select to_char(now() at time zone coalesce((select timezone from branches where id = $1), (select timezone from branches order by created_at, id limit 1), 'Asia/Jakarta'), 'YYYY-MM-DD') as d`,
    [branchId ?? null],
  );
  return rows[0].d;
}

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
      credentials: Credential[]; // T-050: what the viewer may read (RLS)
      clinical: StaffRow[]; // active clinical staff the viewer may see (Kredensial segment)
      today: string;
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
  return withTenantContext(await appPool(), rc.active.context, async (db) => {
    const staff = await listStaff(db);
    const branchIds = rc.active.branches.map((b) => b.id);
    const clinical = staff.filter((s) => s.active && s.roles.some((r) => CLINICAL_ROLES.includes(r.role)) && inScope(s, role, branchIds));
    return {
      kind: "ok" as const,
      role,
      canManage,
      isOwner: role === "owner",
      staff,
      clinical,
      credentials: clinical.length ? await listCredentials(db, clinical.map((c) => c.staffId)) : [],
      invitations: canManage ? await listInvitations(db) : [],
      branches: rc.active.branches,
      today: await localToday(db, rc.active.context.activeBranchId),
      ctx: renderedContext(rc.active.context),
    };
  });
}

export type StaffDetail =
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | {
      kind: "ok"; canManage: boolean; canAudit: boolean; self: boolean; staff: StaffRow; sessions: StaffSession[]; branches: { id: string; name: string }[]; ctx: RenderedContext;
      // T-050: the holder's credentials the viewer may read; who may record or decide; the viewer's id.
      clinical: boolean; credentials: Credential[]; canRecord: boolean; canEnd: boolean; decidable: Record<string, Decidable>; today: string;
      clinicalBranchIds: string[]; // where the staff member holds a clinical role (a permit's branch choices)
    };

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
    const clinical = staff.roles.some((r) => CLINICAL_ROLES.includes(r.role)) && inScope(staff, role, rc.active.branches.map((b) => b.id));
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
      clinical,
      ...(await (async () => {
        const credentials = clinical ? await listCredentials(db, [staffId]) : [];
        const pending = credentials.filter((c) => c.state === "pending" && !c.replaced).map((c) => c.id);
        return { credentials, decidable: Object.fromEntries(await decidable(db, pending)) };
      })()),
      canRecord: admin && staff.active,
      canEnd: role === "facility_head" || role === "owner",
      clinicalBranchIds: staff.roles.filter((r) => CLINICAL_ROLES.includes(r.role)).flatMap((r) => r.branchIds),
      today: await localToday(db, rc.active.context.activeBranchId),
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
