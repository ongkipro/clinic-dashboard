// Active context (PR-84, IAM-3, TEN-1, 17 Navigation): which clinic (membership), acting
// role and active branch a session works in. The browser keeps only the selection
// (cookie, see store.ts); the server re-validates it on every request against the
// account's memberships (resolveContext), so a stale or forged selection never reaches a
// tenant context — it falls back to the default. Pure server code (no Next.js imports).
import type pg from "pg";
import { ROLES, type Role } from "../../../auth/policy";
import { withTenantContext } from "../../../db/rls/context";
import { accountMemberships, type ActingContext, IdentityError, isLevel2, type MembershipRole, recordContextSelected, resolveContext } from "../identity";

export type Selection = { tenantId?: string; role?: string; branchId?: string | null };

export type ClinicOption = { tenantId: string; name: string };
export type BranchOption = { id: string; name: string };

export type ActiveContext = {
  context: ActingContext;
  clinic: ClinicOption;
  clinics: ClinicOption[]; // every clinic the account has an active membership in
  roles: Role[]; // roles held in the active clinic (07 order)
  branches: BranchOption[]; // branches the acting role may switch to
  staffName: string;
  tenantWide: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Parses the stored selection: anything malformed is dropped field by field.
export function parseSelection(raw: string | undefined): Selection {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    return {
      tenantId: typeof v.t === "string" && UUID.test(v.t) ? v.t : undefined,
      role: typeof v.r === "string" && (ROLES as readonly string[]).includes(v.r) ? v.r : undefined,
      branchId: v.b === null ? null : typeof v.b === "string" && UUID.test(v.b) ? v.b : undefined,
    };
  } catch {
    return {};
  }
}

export function serializeSelection(s: { tenantId: string; role: string; branchId: string | null }): string {
  return JSON.stringify({ t: s.tenantId, r: s.role, b: s.branchId });
}

const roleOrder = (r: Role) => ROLES.indexOf(r);

// The context for this request: the stored selection where it is still valid, else the
// defaults (first clinic in membership order; its first role in 07 order; a branch role's
// only branch, or its first branch; tenant-wide roles on "Semua Cabang").
// With a session id, memberships revoked for that session (IAM-16, PR-91) are left out:
// the request continues in another clinic, or has no context at all.
export async function activeContext(app: pg.Pool, accountId: string, sel: Selection, sessionId?: string): Promise<ActiveContext | null> {
  const c = await app.connect();
  let memberships: MembershipRole[];
  try {
    memberships = await accountMemberships(c, accountId);
    if (sessionId) {
      const ids = [...new Set(memberships.map((m) => m.membershipId))];
      const revoked = new Set(
        (await c.query<{ id: string }>(`select id from unnest($1::uuid[]) id where staff_session_revoked(id, $2)`, [ids, sessionId])).rows.map((r) => r.id),
      );
      memberships = memberships.filter((m) => !revoked.has(m.membershipId));
    }
  } finally {
    c.release();
  }
  if (memberships.length === 0) return null;
  const tenantIds = [...new Set(memberships.map((m) => m.tenantId))];
  const tenantId = sel.tenantId && tenantIds.includes(sel.tenantId) ? sel.tenantId : tenantIds[0];
  const held = memberships.filter((m) => m.tenantId === tenantId);
  const roles = [...new Set(held.map((m) => m.role))].sort((a, b) => roleOrder(a) - roleOrder(b));
  // Prefer the selected role, then roles that can act (a branch role needs a branch).
  const usable = roles.filter((r) => isLevel2(r) || (held.find((m) => m.role === r)?.branchIds?.length ?? 0) > 0);
  const role = sel.role && usable.includes(sel.role as Role) ? (sel.role as Role) : usable[0];
  if (!role) return null;
  const roleBranches = held.find((m) => m.role === role)?.branchIds ?? null; // null = Level 2
  let branchId: string | undefined;
  if (roleBranches === null) branchId = sel.branchId ?? undefined; // Level 2: a branch or Semua Cabang
  else branchId = sel.branchId && roleBranches.includes(sel.branchId) ? sel.branchId : roleBranches[0];

  let context: ActingContext;
  try {
    context = await resolveContext(app, accountId, { tenantId, actingRole: role, activeBranchId: branchId });
  } catch (e) {
    if (!(e instanceof IdentityError)) throw e;
    // The selected branch is gone (deleted or out of scope): fall back to the default;
    // if that fails too (membership ended meanwhile), there is no active context.
    try {
      context = await resolveContext(app, accountId, { tenantId, actingRole: role, activeBranchId: roleBranches?.[0] });
    } catch (e2) {
      if (e2 instanceof IdentityError) return null;
      throw e2;
    }
  }

  // A clinic is offered when any of its roles can act there (07 order); its name is read
  // in that role's context.
  const clinics: ClinicOption[] = [];
  for (const t of tenantIds) {
    const candidates = t === tenantId ? [role] : [...new Set(memberships.filter((x) => x.tenantId === t).map((x) => x.role))].sort((a, b) => roleOrder(a) - roleOrder(b));
    for (const r of candidates) {
      try {
        const ctx = await resolveContext(app, accountId, { tenantId: t, actingRole: r });
        clinics.push({ tenantId: t, name: await withTenantContext(app, ctx, async (db) => (await db.query(`select legal_name from tenants`)).rows[0]?.legal_name ?? "") });
        break;
      } catch (e) {
        if (!(e instanceof IdentityError)) throw e; // this role cannot act yet: try the next
      }
    }
  }

  return withTenantContext(app, context, async (db) => {
    const b = await db.query<BranchOption>(`select id, name from branches order by name`);
    const s = await db.query<{ display_name: string }>(`select display_name from staff where id = $1`, [context.staffId]);
    const allowed = context.allowedBranchIds;
    return {
      context,
      clinic: clinics.find((x) => x.tenantId === tenantId) ?? { tenantId, name: "" },
      clinics,
      roles: usable,
      branches: allowed === "*" ? b.rows : b.rows.filter((x) => allowed.includes(x.id)),
      staffName: s.rows[0]?.display_name ?? "",
      tenantWide: allowed === "*",
    };
  });
}

export type SwitchRequest =
  | { kind: "clinic"; tenantId: string }
  | { kind: "role"; role: string }
  | { kind: "branch"; branchId: string | null }; // null = Semua Cabang (tenant-wide roles)

export class ContextSwitchError extends Error {}

// Applies one switch to the current selection, validates the result against the
// account's memberships and records it (org_actions context_selected, IAM-3): the new
// active clinic, branch and acting role are on that row. Returns the selection to store.
export async function switchContext(
  app: pg.Pool,
  accountId: string,
  current: Selection,
  req: SwitchRequest,
): Promise<{ tenantId: string; role: string; branchId: string | null }> {
  const now = await activeContext(app, accountId, current);
  if (!now) throw new ContextSwitchError("no active membership");
  let next: Selection;
  if (req.kind === "clinic") {
    if (!now.clinics.some((c) => c.tenantId === req.tenantId)) throw new ContextSwitchError("clinic not available");
    next = { tenantId: req.tenantId }; // the new clinic's defaults
  } else if (req.kind === "role") {
    if (!now.roles.includes(req.role as Role)) throw new ContextSwitchError("role not held");
    // The new role opens on its own default branch (a branch role's scope differs).
    next = { tenantId: now.context.tenantId, role: req.role };
  } else {
    if (req.branchId === null ? !now.tenantWide : !now.branches.some((b) => b.id === req.branchId)) {
      throw new ContextSwitchError("branch outside the acting role's scope");
    }
    next = { tenantId: now.context.tenantId, role: now.context.actingRole, branchId: req.branchId };
  }
  const after = await activeContext(app, accountId, next);
  if (!after) throw new ContextSwitchError("no active membership");
  const unchanged =
    after.context.tenantId === now.context.tenantId &&
    after.context.actingRole === now.context.actingRole &&
    (after.context.activeBranchId ?? null) === (now.context.activeBranchId ?? null);
  // A request that the defaults silently replaced is refused, not half-applied.
  if (req.kind === "role" && after.context.actingRole !== req.role) throw new ContextSwitchError("role cannot act");
  if (req.kind === "branch" && (after.context.activeBranchId ?? null) !== req.branchId) throw new ContextSwitchError("branch not applied");
  if (!unchanged) await recordContextSelected(app, after.context); // a repeat of the current context records nothing
  return { tenantId: after.context.tenantId, role: after.context.actingRole, branchId: after.context.activeBranchId ?? null };
}
