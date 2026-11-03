// T-029 Done-when: scenario PR-63 "Admin Pusat cannot grant Owner"; projection test per
// role × table generated from the 07 matrix.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROLES, type Role, sessionGate } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { assignBranch, assignRole as seedRole, createMembership, resolveContext, roleSource } from "../../src/modules/org/identity";
import { ADMIN_PUSAT_DIRECT_ROLES, CAPABILITY_TABLES, EVERY_MEMBER_TABLES, parseMatrix, readersByTable } from "../../src/modules/org/roles/matrix";
import { answerOwnerGrant, assignRole, decideRoleRequest, myOwnerGrants, withdrawOwnerGrant } from "../../src/modules/org/roles/roles";
import { invite } from "../../src/modules/org/staff/staff";
import { LEVEL3_ROLES } from "../../src/modules/org/schema";
import { createHarness, type Harness } from "./harness";

const ROOT = join(import.meta.dirname, "../..");
const matrix = parseMatrix(readFileSync(join(ROOT, "docs/spec/07-IAM-RBAC-ABAC.md"), "utf8"));
const readers = readersByTable(matrix);

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let tenantId: string;
let branchId: string;
const people = new Map<Role, { acc: string; staffId: string }>();
let n = 0;

async function person(roles: Role[], tenant = tenantId, branch = branchId) {
  const acc = (await h.admin.query(`insert into auth_user (name, email) values ($1, $2) returning id`, [`P${++n}`, `r${n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: tenant, accountId: acc, displayName: `P${n}` });
  for (const role of roles) {
    const id = await seedRole(h.admin, { tenantId: tenant, staffId, role });
    if ((LEVEL3_ROLES as readonly string[]).includes(role)) {
      await assignBranch(h.admin, { tenantId: tenant, staffRoleId: id, branchId: branch });
    }
  }
  return { acc, staffId };
}

const ctxOf = (p: { acc: string }, role: Role, tenant = tenantId) => resolveContext(app, p.acc, { tenantId: tenant, actingRole: role });

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 4 });
  owner = new pg.Pool({ connectionString: h.ownerUrl(), max: 2 });
  tenantId = (await h.admin.query(`insert into tenants_registry default values returning id`)).rows[0].id;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Sintetis', 'emkm')`, [tenantId]);
  branchId = (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'CAB01', 'Cabang', 'Asia/Jakarta') returning id`, [tenantId])).rows[0].id;
  for (const role of ROLES) people.set(role, await person([role]));
  // A context action and a role request by someone else, so those tables have rows.
  const someone = await person(["nurse"]);
  await withTenantContext(app, await resolveContext(app, someone.acc, { tenantId, actingRole: "nurse" }), (db) =>
    db.query(`insert into org_actions (action, active_branch_id) values ('context_selected', $1)`, [branchId]),
  );
  const subject = await person(["therapist"]);
  const requester = await person(["admin_pusat"]);
  await withTenantContext(app, await ctxOf(requester, "admin_pusat"), (db) => assignRole(db, subject.staffId, "finance"));
  // Audit rows: one tenant-level, one at the branch (branch-scoped readers see that one).
  await withTenantContext(app, await ctxOf(people.get("owner")!, "owner"), (db) =>
    db.query(`select audit_append('export', 'tenant', null, 'success')`),
  );
  const nurse = people.get("nurse")!;
  await withTenantContext(app, await resolveContext(app, nurse.acc, { tenantId, actingRole: "nurse", activeBranchId: branchId }), (db) =>
    db.query(`select audit_append('clinical_read', 'medical_record', null, 'success')`),
  );
});

afterAll(async () => {
  await owner?.end();
  await app?.end();
  await h?.close();
});

describe("projection per role × table, generated from the 07 matrix (TEN-18)", () => {
  const tables = [...new Set([...Object.values(CAPABILITY_TABLES).flat(), ...EVERY_MEMBER_TABLES])];
  // org_actions follows the staff readers (it reveals who acted in which role).

  it("readers.sql and the migration that applies it are identical", () => {
    const a = readFileSync(join(ROOT, "src/db/rls/readers.sql"), "utf8");
    const b = readFileSync(join(ROOT, "drizzle/0013_role_readers.sql"), "utf8");
    expect(b).toBe(a);
  });

  it("Staff & invitations readers are exactly the roles the 07 row marks", () => {
    expect(Object.keys(matrix["Staff & invitations"]).sort()).toEqual(["admin_pusat", "facility_head", "manager", "owner"]);
  });

  it("the 07 capabilities used here exist and parse into role sets", () => {
    expect([...readers.get("public.staff")!].sort()).toEqual(["admin_pusat", "facility_head", "manager", "owner"]);
    expect([...readers.get("public.audit_events")!].sort()).toEqual(["auditor", "facility_head", "owner", "records_officer"]);
  });

  for (const role of ROLES) {
    it(`${role}: sees others' rows exactly in the tables the matrix gives it`, async () => {
      const p = people.get(role)!;
      const seen = await withTenantContext(app, await ctxOf(p, role), async (db) => {
        const out: Record<string, number> = {};
        for (const t of tables) {
          // Rows that are not the caller's own (own identity rows are always visible).
          const own =
            t === "public.staff" ? `id <> '${p.staffId}'`
            : t === "public.memberships" ? `id <> (select membership_id from staff where id = '${p.staffId}')`
            : t === "public.staff_roles" || t === "public.staff_branches" ? `staff_id <> '${p.staffId}'`
            : t === "public.role_requests" ? `requested_by <> '${p.staffId}' and staff_id <> '${p.staffId}'`
            : t === "public.org_actions" ? `staff_id <> '${p.staffId}'`
            : "true";
          out[t] = (await db.query(`select count(*)::int as n from ${t} where ${own}`)).rows[0].n;
        }
        return out;
      });
      for (const t of tables) {
        const allowed =
          t === "public.org_actions"
            ? readers.get("public.staff")!.has(role)
            : EVERY_MEMBER_TABLES.includes(t) || (readers.get(t)?.has(role) ?? false);
        if (allowed) expect(seen[t], `${role} should read ${t}`).toBeGreaterThan(0);
        else expect(seen[t], `${role} must not read ${t}`).toBe(0);
      }
    });
  }

  it("every member still reads their own staff, membership and role rows", async () => {
    for (const role of ROLES) {
      const p = people.get(role)!;
      const own = await withTenantContext(app, await ctxOf(p, role), async (db) => ({
        staff: (await db.query(`select id from staff`)).rows.filter((r) => r.id === p.staffId).length,
        roles: (await db.query(`select role from staff_roles where staff_id = $1`, [p.staffId])).rows.length,
        membership: (await db.query(`select 1 from memberships m join staff s on s.membership_id = m.id where s.id = $1`, [p.staffId])).rows.length,
      }));
      expect(own, role).toEqual({ staff: 1, roles: 1, membership: 1 });
    }
  });

  it("Admin Pusat does not read the audit log without the data-protection duty (07: ◐ if duty assigned)", async () => {
    const n = await withTenantContext(app, await ctxOf(people.get("admin_pusat")!, "admin_pusat"), async (db) =>
      (await db.query(`select count(*)::int as n from audit_events`)).rows[0].n,
    );
    expect(n).toBe(0);
  });
});

describe("scenario PR-63 Admin Pusat cannot grant Owner", () => {
  it("an Owner grant by Admin Pusat waits for the owner's approval and is not active", async () => {
    const target = await person(["nurse"]);
    const admin = people.get("admin_pusat")!;
    const r = await withTenantContext(app, await ctxOf(admin, "admin_pusat"), (db) => assignRole(db, target.staffId, "owner"));
    expect(r.state).toBe("pending");
    // Not active: the target cannot act as owner.
    await expect(ctxOf(target, "owner")).rejects.toThrow();
    const { rows } = await h.admin.query(`select role from staff_roles where staff_id = $1`, [target.staffId]);
    expect(rows.map((x) => x.role)).toEqual(["nurse"]);

    // The owner approves; the new Owner must still confirm (DEC-031 D7) before acting.
    const ownerP = people.get("owner")!;
    const requestId = (r as { requestId: string }).requestId;
    const decided = await withTenantContext(app, await ctxOf(ownerP, "owner"), (db) => decideRoleRequest(db, requestId, true));
    expect(decided).toBe("awaiting_confirmation");
    await expect(ctxOf(target, "owner")).rejects.toThrow();
    expect(await withTenantContext(app, await ctxOf(target, "nurse"), (db) => myOwnerGrants(db))).toMatchObject([{ requestId }]);
    expect(await withTenantContext(app, await ctxOf(target, "nurse"), (db) => answerOwnerGrant(db, requestId, true))).toBe("approved");
    await expect(ctxOf(target, "owner")).resolves.toMatchObject({ actingRole: "owner" });
  });

  it("an Owner's assignment of Owner waits for the person's confirmation; only that person answers (DEC-031 D7)", async () => {
    const ownerP = people.get("owner")!;
    const target = await person(["nurse"]);
    const r = await withTenantContext(app, await ctxOf(ownerP, "owner"), (db) => assignRole(db, target.staffId, "owner"));
    expect(r.state).toBe("awaiting_confirmation");
    const requestId = (r as { requestId: string }).requestId;
    await expect(ctxOf(target, "owner")).rejects.toThrow();
    // A second Owner assignment while one waits is refused; nobody else answers it.
    await expect(withTenantContext(app, await ctxOf(ownerP, "owner"), (db) => assignRole(db, target.staffId, "owner"))).rejects.toMatchObject({ code: "23505" });
    await expect(withTenantContext(app, await ctxOf(ownerP, "owner"), (db) => answerOwnerGrant(db, requestId, true))).rejects.toMatchObject({ code: "P0002" });
    await expect(withTenantContext(app, await ctxOf(ownerP, "owner"), (db) => decideRoleRequest(db, requestId, true))).rejects.toMatchObject({ code: "55000" });
    // Declining leaves no role and closes the request; a new assignment is possible afterwards.
    expect(await withTenantContext(app, await ctxOf(target, "nurse"), (db) => answerOwnerGrant(db, requestId, false))).toBe("rejected");
    await expect(ctxOf(target, "owner")).rejects.toThrow();
    await expect(withTenantContext(app, await ctxOf(target, "nurse"), (db) => answerOwnerGrant(db, requestId, true))).rejects.toMatchObject({ code: "P0002" });
    const again = await withTenantContext(app, await ctxOf(ownerP, "owner"), (db) => assignRole(db, target.staffId, "owner"));
    // A grant older than 14 days lapses: accepting it closes it (audited), and it no longer
    // blocks a new assignment, which closes any lapsed grant first.
    const againId = (again as { requestId: string }).requestId;
    await h.admin.query(`update role_requests set decided_at = now() - interval '15 days' where id = $1`, [againId]);
    expect(await withTenantContext(app, await ctxOf(target, "nurse"), (db) => myOwnerGrants(db))).toEqual([]);
    expect(await withTenantContext(app, await ctxOf(target, "nurse"), (db) => answerOwnerGrant(db, againId, true))).toBe("lapsed");
    await expect(ctxOf(target, "owner")).rejects.toThrow();
    const lapsedViaAssign = await withTenantContext(app, await ctxOf(ownerP, "owner"), (db) => assignRole(db, target.staffId, "owner"));
    await h.admin.query(`update role_requests set decided_at = now() - interval '15 days' where id = $1`, [(lapsedViaAssign as { requestId: string }).requestId]);
    const fresh = await withTenantContext(app, await ctxOf(ownerP, "owner"), (db) => assignRole(db, target.staffId, "owner"));
    expect(fresh.state).toBe("awaiting_confirmation");
    expect((await h.admin.query(`select state from role_requests where id = $1`, [(lapsedViaAssign as { requestId: string }).requestId])).rows[0].state).toBe("rejected");
    // Any Owner may withdraw a waiting grant; then it cannot be accepted.
    await withTenantContext(app, await ctxOf(ownerP, "owner"), (db) => withdrawOwnerGrant(db, (fresh as { requestId: string }).requestId));
    await expect(withTenantContext(app, await ctxOf(target, "nurse"), (db) => answerOwnerGrant(db, (fresh as { requestId: string }).requestId, true))).rejects.toMatchObject({ code: "P0002" });
    await expect(withTenantContext(app, await ctxOf(target, "nurse"), (db) => withdrawOwnerGrant(db, (fresh as { requestId: string }).requestId))).rejects.toMatchObject({ code: "42501" });
    // A grant whose granter stopped being an Owner lapses.
    const second = await person(["owner"]);
    const byLeaver = await withTenantContext(app, await ctxOf(second, "owner"), (db) => assignRole(db, target.staffId, "owner"));
    await h.admin.query(`update memberships set effective_to = now() where id = (select membership_id from staff where id = $1)`, [second.staffId]);
    expect(await withTenantContext(app, await ctxOf(target, "nurse"), (db) => answerOwnerGrant(db, (byLeaver as { requestId: string }).requestId, true))).toBe("lapsed");
    await expect(ctxOf(target, "owner")).rejects.toThrow();
    // Confirming creates the role, audited.
    const third = await withTenantContext(app, await ctxOf(ownerP, "owner"), (db) => assignRole(db, target.staffId, "owner"));
    expect(await withTenantContext(app, await ctxOf(target, "nurse"), (db) => answerOwnerGrant(db, (third as { requestId: string }).requestId, true))).toBe("approved");
    await expect(ctxOf(target, "owner")).resolves.toMatchObject({ actingRole: "owner" });
    const audit = (await h.admin.query(`select reason_code from audit_events where object_id = $1 order by seq`, [(third as { requestId: string }).requestId])).rows.map((x) => x.reason_code);
    expect(audit).toEqual(["owner_grant_awaits_confirmation", "owner_grant_confirmed"]);
    const roleRow = (await h.admin.query(`select id from staff_roles where staff_id = $1 and role = 'owner'`, [target.staffId])).rows[0].id;
    expect((await h.admin.query(`select reason_code from audit_events where object_id = $1`, [roleRow])).rows.map((x) => x.reason_code)).toEqual(["role_assigned"]);
  });

  it("a confirmed Owner without TOTP is sent to enrolment by the session gate (no step-up bypass)", async () => {
    const ownerP = people.get("owner")!;
    const target = await person(["nurse"]);
    const roles = roleSource(app);
    const gate = async () => sessionGate({ roles: await roles(target.acc), twoFactorEnabled: false, lastActiveAt: new Date(), lockedAt: null, now: new Date() });
    expect(await gate()).toBe("ok"); // a nurse needs no TOTP
    const g = await withTenantContext(app, await ctxOf(ownerP, "owner"), (db) => assignRole(db, target.staffId, "owner"));
    expect(await gate()).toBe("ok"); // not yet an Owner
    await withTenantContext(app, await ctxOf(target, "nurse"), (db) => answerOwnerGrant(db, (g as { requestId: string }).requestId, true));
    expect(await gate()).toBe("enrol_totp"); // every page and API now requires TOTP enrolment first
  });

  it("an Owner is never created through an invitation link (finding 1)", async () => {
    const ownerP = people.get("owner")!;
    await expect(withTenantContext(app, await ctxOf(ownerP, "owner"), (db) => invite(db, { email: `o.inv${Date.now()}@klinik-sintetis.test`, name: "Calon Owner", roles: ["owner"], branchIds: [] })))
      .rejects.toMatchObject({ code: "ERR_FORBIDDEN" });
    // Also a direct write (the trigger fires for every role, ENABLE ALWAYS).
    await expect(h.admin.query(
      `insert into staff_invitations (tenant_id, email, display_name, roles, branch_ids, token_hash, invited_by, expires_at)
       values ($1, 'langsung@klinik-sintetis.test', 'Langsung', '{owner}', '{}', repeat('a', 64), $2, now() + interval '1 day')`,
      [tenantId, ownerP.staffId],
    )).rejects.toMatchObject({ code: "42501" });
  });

  it.each(ROLES.filter((r) => !ADMIN_PUSAT_DIRECT_ROLES.includes(r)))(
    "granting %s by Admin Pusat is a pending request (every Level 2 role and the owner-approval list)",
    async (role) => {
      const target = await person(["therapist"]);
      const r = await withTenantContext(app, await ctxOf(people.get("admin_pusat")!, "admin_pusat"), (db) => assignRole(db, target.staffId, role));
      expect(r.state).toBe("pending");
      await expect(ctxOf(target, role)).rejects.toThrow();
    },
  );

  it.each(ADMIN_PUSAT_DIRECT_ROLES.filter((r) => r !== "therapist"))("%s (Level 3) is assigned directly by Admin Pusat", async (role) => {
    const target = await person(["therapist"]);
    const r = await withTenantContext(app, await ctxOf(people.get("admin_pusat")!, "admin_pusat"), (db) => assignRole(db, target.staffId, role));
    expect(r.state).toBe("active");
  });

  it("an Owner's own assignment applies directly (the owner's decision; a single-owner clinic is not stuck)", async () => {
    const target = await person(["nurse"]);
    const r = await withTenantContext(app, await ctxOf(people.get("owner")!, "owner"), (db) => assignRole(db, target.staffId, "finance"));
    expect(r.state).toBe("active");
    await expect(ctxOf(target, "finance")).resolves.toMatchObject({ actingRole: "finance" });
  });

  it("the requester cannot approve their own request, and a second pending request is refused", async () => {
    const target = await person(["nurse"]);
    const dual = await person(["admin_pusat", "owner"]); // holds both roles, acts as one at a time
    const r = (await withTenantContext(app, await ctxOf(dual, "admin_pusat"), (db) => assignRole(db, target.staffId, "auditor"))) as {
      requestId: string;
    };
    await expect(
      withTenantContext(app, await ctxOf(dual, "admin_pusat"), (db) => assignRole(db, target.staffId, "auditor")),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      withTenantContext(app, await ctxOf(dual, "owner"), (db) => decideRoleRequest(db, r.requestId, true)),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      withTenantContext(app, await ctxOf(people.get("owner")!, "owner"), (db) => decideRoleRequest(db, r.requestId, true)),
    ).resolves.toBe("approved");
  });

  it("two concurrent requests for the same role: exactly one lands (unique pending index)", async () => {
    const target = await person(["nurse"]);
    const admin = people.get("admin_pusat")!;
    const results = await Promise.allSettled(
      [0, 1].map(async () =>
        withTenantContext(app, await ctxOf(admin, "admin_pusat"), (db) => assignRole(db, target.staffId, "marketing")),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "23505" } });
  });

  it("a role already held cannot be requested again; a membership starting later cannot be given roles", async () => {
    const target = await person(["finance"]);
    await expect(
      withTenantContext(app, await ctxOf(people.get("admin_pusat")!, "admin_pusat"), (db) => assignRole(db, target.staffId, "finance")),
    ).rejects.toMatchObject({ code: "23505" });
    const later = await person(["nurse"]);
    await h.admin.query(
      `update memberships set effective_from = now() + interval '7 days' where id = (select membership_id from staff where id = $1)`,
      [later.staffId],
    );
    await expect(
      withTenantContext(app, await ctxOf(people.get("owner")!, "owner"), (db) => assignRole(db, later.staffId, "bc")),
    ).rejects.toMatchObject({ code: "P0002" });
  });

  it("a request whose subject left before approval cannot be approved, only rejected", async () => {
    const target = await person(["nurse"]);
    const r = (await withTenantContext(app, await ctxOf(people.get("admin_pusat")!, "admin_pusat"), (db) =>
      assignRole(db, target.staffId, "records_officer"),
    )) as { requestId: string };
    await h.admin.query(
      `update memberships set effective_to = now() where id = (select membership_id from staff where id = $1)`,
      [target.staffId],
    );
    const ownerCtx = await ctxOf(people.get("owner")!, "owner");
    await expect(withTenantContext(app, ownerCtx, (db) => decideRoleRequest(db, r.requestId, true))).rejects.toMatchObject({ code: "55000" });
    await expect(withTenantContext(app, ownerCtx, (db) => decideRoleRequest(db, r.requestId, false))).resolves.toBe("rejected");
    const { rows } = await h.admin.query(`select 1 from staff_roles where staff_id = $1 and role = 'records_officer'`, [target.staffId]);
    expect(rows).toHaveLength(0);
  });

  it("a staff member whose membership ended cannot be given roles", async () => {
    const target = await person(["nurse"]);
    await h.admin.query(
      `update memberships set effective_to = now() where id = (select membership_id from staff where id = $1)`,
      [target.staffId],
    );
    await expect(
      withTenantContext(app, await ctxOf(people.get("owner")!, "owner"), (db) => assignRole(db, target.staffId, "bc")),
    ).rejects.toMatchObject({ code: "P0002" });
  });

  it("only an Owner decides; Admin Pusat cannot approve; a decided request cannot be decided again", async () => {
    const target = await person(["nurse"]);
    const r = (await withTenantContext(app, await ctxOf(people.get("admin_pusat")!, "admin_pusat"), (db) =>
      assignRole(db, target.staffId, "auditor"),
    )) as { requestId: string };
    const other = await person(["admin_pusat"]);
    await expect(
      withTenantContext(app, await ctxOf(other, "admin_pusat"), (db) => decideRoleRequest(db, r.requestId, true)),
    ).rejects.toMatchObject({ code: "42501" });
    await withTenantContext(app, await ctxOf(people.get("owner")!, "owner"), (db) => decideRoleRequest(db, r.requestId, false));
    await expect(
      withTenantContext(app, await ctxOf(people.get("owner")!, "owner"), (db) => decideRoleRequest(db, r.requestId, true)),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(ctxOf(target, "auditor")).rejects.toThrow();
  });

  it("nobody changes their own role set; other roles cannot assign at all", async () => {
    const admin = people.get("admin_pusat")!;
    await expect(
      withTenantContext(app, await ctxOf(admin, "admin_pusat"), (db) => assignRole(db, admin.staffId, "nurse")),
    ).rejects.toMatchObject({ code: "42501" });
    const target = await person(["nurse"]);
    for (const role of ["manager", "finance", "auditor"] as Role[]) {
      await expect(
        withTenantContext(app, await ctxOf(people.get(role)!, role), (db) => assignRole(db, target.staffId, "bc")),
        role,
      ).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("clinic_app cannot bypass the functions: no direct write to staff_roles or role_requests", async () => {
    const target = await person(["nurse"]);
    const ctx = await ctxOf(people.get("owner")!, "owner");
    for (const sql of [
      `insert into staff_roles (tenant_id, staff_id, role) values ('${tenantId}', '${target.staffId}', 'owner')`,
      `insert into role_requests (staff_id, role, change) values ('${target.staffId}', 'owner', 'grant')`,
      `update role_requests set state = 'approved'`,
    ]) {
      await expect(withTenantContext(app, ctx, (db) => db.query(sql)), sql).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("a staff member of another tenant cannot be targeted", async () => {
    const otherTenant = (await h.admin.query(`insert into tenants_registry default values returning id`)).rows[0].id;
    await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Lain', 'emkm')`, [otherTenant]);
    const ob = (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'X', 'X', 'Asia/Jakarta') returning id`, [otherTenant])).rows[0].id;
    const stranger = await person(["nurse"], otherTenant, ob);
    await expect(
      withTenantContext(app, await ctxOf(people.get("owner")!, "owner"), (db) => assignRole(db, stranger.staffId, "bc")),
    ).rejects.toMatchObject({ code: "P0002" });
  });

  it("requests are visible to staff readers, the requester and the subject only", async () => {
    const subjectP = await person(["bc"]);
    const r = (await withTenantContext(app, await ctxOf(people.get("admin_pusat")!, "admin_pusat"), (db) => assignRole(db, subjectP.staffId, "marketing"))) as { requestId: string };
    const visible = async (p: { acc: string }, role: Role) =>
      (await withTenantContext(app, await ctxOf(p, role), (db) => db.query(`select id from role_requests where id = $1`, [r.requestId]))).rows.length;
    expect(await visible(subjectP, "bc")).toBe(1);
    expect(await visible(people.get("admin_pusat")!, "admin_pusat")).toBe(1);
    expect(await visible(people.get("owner")!, "owner")).toBe(1);
    expect(await visible(people.get("nurse")!, "nurse")).toBe(0);
    expect(await visible(people.get("auditor")!, "auditor")).toBe(0);
  });

  it("role changes are audited", async () => {
    const { rows } = await h.admin.query(
      `select reason_code, count(*)::int as n from audit_events where tenant_id = $1 and reason_code like 'role_%' group by 1 order by 1`,
      [tenantId],
    );
    expect(rows.map((r) => r.reason_code)).toEqual(
      expect.arrayContaining(["role_assigned", "role_grant_approved", "role_grant_rejected", "role_grant_requested"]),
    );
  });
});
