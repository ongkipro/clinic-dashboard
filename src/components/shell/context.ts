// Shell view model (NAV-3, PR-84): the active context of an authenticated account as the
// shell shows it. Pure server code without Next.js imports, so tests exercise exactly
// what the shell renders.
import type pg from "pg";
import type { Role } from "../../auth/policy";
import { type ActiveContext, activeContext, type Selection } from "../../modules/org/context/context";
import { ROLE_LABEL } from "./nav";

export type Branch = { id: string; name: string };

export type ShellContext = {
  staffId: string; // scopes device-local pinned/recent pages to this membership
  role: Role;
  roleLabel: string;
  name: string;
  clinic: string;
  branches: Branch[]; // branches the acting role may switch to
  activeBranchId: string | null; // null = Semua Cabang (tenant-wide roles)
  tenantWide: boolean;
  canSwitchRole: boolean; // Saya › Ganti Peran only with more than one role (17)
  canSwitchClinic: boolean; // Saya › Ganti Klinik only with more than one membership (17)
};

export type ShellData =
  | { kind: "ok"; context: ShellContext }
  | { kind: "redirect"; to: string }
  | { kind: "blocked" };

export function shellFromActive(a: ActiveContext): ShellContext {
  return {
    staffId: a.context.staffId,
    role: a.context.actingRole,
    roleLabel: ROLE_LABEL[a.context.actingRole],
    name: a.staffName,
    clinic: a.clinic.name,
    branches: a.branches,
    activeBranchId: a.context.activeBranchId ?? null,
    tenantWide: a.tenantWide,
    canSwitchRole: a.roles.length > 1,
    canSwitchClinic: a.clinics.length > 1,
  };
}

export async function shellFor(app: pg.Pool, accountId: string, selection: Selection = {}): Promise<ShellData> {
  const a = await activeContext(app, accountId, selection);
  return a ? { kind: "ok", context: shellFromActive(a) } : { kind: "blocked" };
}
