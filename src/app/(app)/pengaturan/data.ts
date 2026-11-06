// Server data for Pengaturan (19 §2.17, PR-38). Server only.
import { type RenderedContext, renderedContext } from "../../../modules/org/context/context";
import "server-only";
import type { Role } from "../../../auth/policy";
import { withTenantContext } from "../../../db/rls/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { GROUPS, type GroupSlug, groupOf, SETTINGS } from "../../../modules/settings/registry";
import { accessFor, groupRows, type Row } from "../../../modules/settings/settings";

// The groups the acting role has at least one row in (a group page without rows is absent).
export function groupsFor(role: Role) {
  return GROUPS.filter((g) => SETTINGS.some((s) => s.group === g.slug && accessFor(s, role)));
}

export type IndexPage = { kind: "redirect"; to: string } | { kind: "forbidden" } | { kind: "ok"; groups: { slug: string; label: string; count: number }[] };

export async function loadIndex(): Promise<IndexPage> {
  const rc = await requestContext();
  if (rc.kind === "redirect") return rc;
  if (rc.kind === "blocked") return { kind: "forbidden" };
  const role = rc.active.context.actingRole;
  const groups = groupsFor(role).map((g) => ({ ...g, count: SETTINGS.filter((s) => s.group === g.slug && accessFor(s, role)).length }));
  return groups.length ? { kind: "ok", groups } : { kind: "forbidden" };
}

export type GroupPage =
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | {
      kind: "ok";
      group: { slug: GroupSlug; label: string };
      role: Role;
      rows: Row[];
      branch: { id: string; name: string } | null; // branch-scoped rows show this branch
      tenantWide: boolean;
      branches: { id: string; name: string }[];
      ctx: RenderedContext;
    };

// `cabang` selects the branch of branch-scoped rows for tenant-wide roles (empty = the
// tenant value); branch roles always see their active branch.
export async function loadGroup(slug: string, cabang: string | undefined): Promise<GroupPage> {
  const g = groupOf(slug);
  if (!g) return { kind: "not-found" };
  const rc = await requestContext();
  if (rc.kind === "redirect") return rc;
  if (rc.kind === "blocked") return { kind: "forbidden" };
  const { actingRole: role, activeBranchId } = rc.active.context;
  if (!groupsFor(role).some((x) => x.slug === g.slug)) return { kind: "forbidden" };
  const branches = rc.active.branches;
  const branch = rc.active.tenantWide
    ? (branches.find((b) => b.id === cabang) ?? null)
    : (branches.find((b) => b.id === activeBranchId) ?? null);
  const rows = await withTenantContext(await appPool(), rc.active.context, (db) => groupRows(db, role, g.slug, branch?.id ?? null));
  return { kind: "ok", group: g, role, rows, branch, tenantWide: rc.active.tenantWide, branches, ctx: renderedContext(rc.active.context) };
}
