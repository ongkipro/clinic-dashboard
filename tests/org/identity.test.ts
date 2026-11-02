// T-007 Done-when: staff.membership_id NOT NULL UNIQUE; staff cannot be assigned another
// tenant's branch; Level 2 roles see future branches (wildcard); acting role recorded on
// actions. Plus: memberships unique per (account, tenant), staff tenant = membership
// tenant, Level 2 never stores branches, context resolution validates client selectors
// (TEN-1), account_memberships returns only the requested account, and the real
// RoleSource drives the T-006 TOTP gate.
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { createAuth } from "../../src/auth/server";
import {
  accountMemberships,
  assignBranch,
  assignRole,
  createMembership,
  IdentityError,
  recordContextSelected,
  resolveContext,
  roleSource,
} from "../../src/modules/org/identity";
import { BASE_URL, Client, PASSWORD } from "../auth/helpers";
import { createHarness, type Harness } from "../rls/harness";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool; // migration owner: identity rows are written by the org service (T-022/T-031)
let n = 0;

async function account(): Promise<string> {
  const r = await h.admin.query<{ id: string }>(
    `insert into auth_user (name, email) values ($1, $2) returning id`,
    [`Akun ${++n}`, `akun${n}@klinik-sintetis.test`],
  );
  return r.rows[0].id;
}

async function tenant(branchCount = 1): Promise<{ tenantId: string; branches: string[] }> {
  const t = (await h.admin.query(`insert into tenants_registry default values returning id`)).rows[0].id;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [
    t,
    `PT Sintetis ${t.slice(-4)}`,
  ]);
  const branches: string[] = [];
  for (let i = 1; i <= branchCount; i++) branches.push(await addBranch(t, i));
  return { tenantId: t, branches };
}

async function addBranch(tenantId: string, i: number): Promise<string> {
  return (
    await h.admin.query(
      `insert into branches (tenant_id, code, name, timezone) values ($1, $2, $3, 'Asia/Jakarta') returning id`,
      [tenantId, `CAB${String(i).padStart(2, "0")}`, `Cabang ${i}`],
    )
  ).rows[0].id;
}

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 4 });
  owner = new pg.Pool({ connectionString: h.ownerUrl(), max: 4 });
});

afterAll(async () => {
  await owner?.end();
  await app?.end();
  await h?.close();
});

describe("identity chain constraints (DATA-55)", () => {
  it("staff.membership_id is NOT NULL and UNIQUE", async () => {
    const { rows } = await h.admin.query(
      `select a.attnotnull as notnull,
              exists (select 1 from pg_constraint k where k.conrelid = 'public.staff'::regclass
                        and k.contype = 'u' and k.conkey = array[a.attnum]) as unique
         from pg_attribute a where a.attrelid = 'public.staff'::regclass and a.attname = 'membership_id'`,
    );
    expect(rows[0]).toEqual({ notnull: true, unique: true });

    const { tenantId } = await tenant();
    const { membershipId } = await createMembership(owner, {
      tenantId,
      accountId: await account(),
      displayName: "Staf A",
    });
    await expect(
      h.admin.query(`insert into staff (tenant_id, membership_id, display_name) values ($1, $2, 'Dua')`, [
        tenantId,
        membershipId,
      ]),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      h.admin.query(`insert into staff (tenant_id, membership_id, display_name) values ($1, null, 'X')`, [tenantId]),
    ).rejects.toMatchObject({ code: "23502" });
  });

  it("one membership per account per tenant; one account may join several tenants", async () => {
    const acc = await account();
    const a = await tenant();
    const b = await tenant();
    await createMembership(owner, { tenantId: a.tenantId, accountId: acc, displayName: "Dr Sinta" });
    await createMembership(owner, { tenantId: b.tenantId, accountId: acc, displayName: "Dr Sinta" });
    await expect(
      createMembership(owner, { tenantId: a.tenantId, accountId: acc, displayName: "Lagi" }),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("staff belongs to its membership's tenant (composite FK)", async () => {
    const a = await tenant();
    const b = await tenant();
    const { membershipId } = await createMembership(owner, {
      tenantId: a.tenantId,
      accountId: await account(),
      displayName: "X",
    });
    await expect(
      h.admin.query(`update staff set tenant_id = $1 where membership_id = $2`, [b.tenantId, membershipId]),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("membership and staff are created atomically", async () => {
    const { tenantId } = await tenant();
    const acc = await account();
    await expect(
      createMembership(owner, { tenantId, accountId: acc, displayName: null as unknown as string }),
    ).rejects.toMatchObject({ code: "23502" });
    const { rows } = await h.admin.query(`select 1 from memberships where account_id = $1`, [acc]);
    expect(rows).toEqual([]);
  });

  it("staff cannot be assigned a branch of another tenant", async () => {
    const a = await tenant();
    const b = await tenant();
    const { staffId } = await createMembership(owner, {
      tenantId: a.tenantId,
      accountId: await account(),
      displayName: "Perawat",
    });
    const roleId = await assignRole(h.admin, { tenantId: a.tenantId, staffId, role: "nurse" });
    await expect(
      assignBranch(h.admin, { tenantId: a.tenantId, staffRoleId: roleId, branchId: b.branches[0] }),
    ).rejects.toMatchObject({ code: "23503" });
    // Also refused when written directly, bypassing the service.
    await expect(
      h.admin.query(
        `insert into staff_branches (tenant_id, staff_role_id, staff_id, role, branch_id)
         values ($1, $2, $3, 'nurse', $4)`,
        [a.tenantId, roleId, staffId, b.branches[0]],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("a branch scope cannot claim a different staff or role than its role row", async () => {
    const a = await tenant();
    const one = await createMembership(owner, { tenantId: a.tenantId, accountId: await account(), displayName: "1" });
    const two = await createMembership(owner, { tenantId: a.tenantId, accountId: await account(), displayName: "2" });
    const roleId = await assignRole(h.admin, { tenantId: a.tenantId, staffId: one.staffId, role: "nurse" });
    await assignRole(h.admin, { tenantId: a.tenantId, staffId: two.staffId, role: "doctor" });
    for (const [staffId, role] of [
      [two.staffId, "nurse"],
      [one.staffId, "doctor"],
    ]) {
      await expect(
        h.admin.query(
          `insert into staff_branches (tenant_id, staff_role_id, staff_id, role, branch_id) values ($1, $2, $3, $4, $5)`,
          [a.tenantId, roleId, staffId, role, a.branches[0]],
        ),
      ).rejects.toMatchObject({ code: "23503" });
    }
  });

  it("Level 2 roles never store branches; unknown roles are refused", async () => {
    const a = await tenant();
    const { staffId } = await createMembership(owner, { tenantId: a.tenantId, accountId: await account(), displayName: "Owner" });
    const roleId = await assignRole(h.admin, { tenantId: a.tenantId, staffId, role: "owner" });
    await expect(
      assignBranch(h.admin, { tenantId: a.tenantId, staffRoleId: roleId, branchId: a.branches[0] }),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      h.admin.query(`insert into staff_roles (tenant_id, staff_id, role) values ($1, $2, 'superadmin')`, [
        a.tenantId,
        staffId,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("branch scope per acting role (IAM-9)", () => {
  it("Level 2 roles see branches created later (wildcard, never a stored list)", async () => {
    const a = await tenant(2);
    const acc = await account();
    const { staffId } = await createMembership(owner, { tenantId: a.tenantId, accountId: acc, displayName: "Owner" });
    await assignRole(h.admin, { tenantId: a.tenantId, staffId, role: "owner" });

    const ctx = await resolveContext(app, acc, { tenantId: a.tenantId, actingRole: "owner" });
    expect(ctx.allowedBranchIds).toBe("*");

    const later = await addBranch(a.tenantId, 3);
    const seen = await withTenantContext(app, ctx, async (db) =>
      (await db.query(`select id from branches order by code`)).rows.map((r) => r.id),
    );
    expect(seen).toEqual([...a.branches, later]);
    // The new branch can be the active branch without any reassignment.
    const active = await resolveContext(app, acc, { tenantId: a.tenantId, actingRole: "owner", activeBranchId: later });
    expect(active.activeBranchId).toBe(later);
    // Nothing was stored for the owner.
    const { rows } = await h.admin.query(`select 1 from staff_branches where staff_id = $1`, [staffId]);
    expect(rows).toEqual([]);
  });

  it("Level 3 roles get exactly their assigned branches, per role", async () => {
    const a = await tenant(3);
    const acc = await account();
    const { staffId } = await createMembership(owner, { tenantId: a.tenantId, accountId: acc, displayName: "Dr Sinta" });
    const doctor = await assignRole(h.admin, { tenantId: a.tenantId, staffId, role: "doctor" });
    const manager = await assignRole(h.admin, { tenantId: a.tenantId, staffId, role: "manager" });
    await assignBranch(h.admin, { tenantId: a.tenantId, staffRoleId: doctor, branchId: a.branches[0] });
    await assignBranch(h.admin, { tenantId: a.tenantId, staffRoleId: doctor, branchId: a.branches[1] });
    await assignBranch(h.admin, { tenantId: a.tenantId, staffRoleId: manager, branchId: a.branches[2] });

    const asDoctor = await resolveContext(app, acc, { tenantId: a.tenantId, actingRole: "doctor" });
    expect([...(asDoctor.allowedBranchIds as string[])].sort()).toEqual([a.branches[0], a.branches[1]].sort());
    const asManager = await resolveContext(app, acc, { tenantId: a.tenantId, actingRole: "manager" });
    expect(asManager.allowedBranchIds).toEqual([a.branches[2]]);
    expect(asManager.activeBranchId).toBe(a.branches[2]); // single branch becomes active
    expect(asManager.roles).toEqual(["manager"]);

    // A branch of the doctor role is not usable while acting as manager.
    await expect(
      resolveContext(app, acc, { tenantId: a.tenantId, actingRole: "manager", activeBranchId: a.branches[0] }),
    ).rejects.toBeInstanceOf(IdentityError);
  });

  it("client selectors are validated against memberships (TEN-1)", async () => {
    const a = await tenant();
    const b = await tenant();
    const acc = await account();
    const { staffId } = await createMembership(owner, { tenantId: a.tenantId, accountId: acc, displayName: "FO" });
    const fo = await assignRole(h.admin, { tenantId: a.tenantId, staffId, role: "fo_cashier" });
    await assignBranch(h.admin, { tenantId: a.tenantId, staffRoleId: fo, branchId: a.branches[0] });

    const refused = [
      { tenantId: b.tenantId, actingRole: "fo_cashier" }, // not a member of B
      { tenantId: a.tenantId, actingRole: "owner" }, // role not held
      { tenantId: a.tenantId, actingRole: "fo_cashier", activeBranchId: b.branches[0] }, // B's branch
    ];
    for (const sel of refused) {
      await expect(resolveContext(app, acc, sel), JSON.stringify(sel)).rejects.toThrow(IdentityError);
    }
    // Same message for "not a member" and "role not held".
    const messages = await Promise.all(refused.slice(0, 2).map((sel) => resolveContext(app, acc, sel).catch((e) => e.message)));
    expect(new Set(messages).size).toBe(1);
  });

  it("a Level 2 role cannot pick another tenant's branch as active", async () => {
    const a = await tenant();
    const b = await tenant();
    const acc = await account();
    const { staffId } = await createMembership(owner, { tenantId: a.tenantId, accountId: acc, displayName: "Finance" });
    await assignRole(h.admin, { tenantId: a.tenantId, staffId, role: "finance" });
    await expect(
      resolveContext(app, acc, { tenantId: a.tenantId, actingRole: "finance", activeBranchId: b.branches[0] }),
    ).rejects.toBeInstanceOf(IdentityError);
  });

  it("ended memberships give no access", async () => {
    const a = await tenant();
    const acc = await account();
    const { membershipId, staffId } = await createMembership(owner, { tenantId: a.tenantId, accountId: acc, displayName: "X" });
    await assignRole(h.admin, { tenantId: a.tenantId, staffId, role: "finance" });
    await h.admin.query(`update memberships set effective_to = now() where id = $1`, [membershipId]);
    await expect(resolveContext(app, acc, { tenantId: a.tenantId, actingRole: "finance" })).rejects.toBeInstanceOf(
      IdentityError,
    );
    const c = await app.connect();
    try {
      expect(await accountMemberships(c, acc)).toEqual([]);
    } finally {
      c.release();
    }
  });
});

describe("acting role recorded on actions (IAM-3, DATA-60)", () => {
  async function multiRole() {
    const a = await tenant(2);
    const acc = await account();
    const { staffId } = await createMembership(owner, { tenantId: a.tenantId, accountId: acc, displayName: "Dr Sinta" });
    const bc = await assignRole(h.admin, { tenantId: a.tenantId, staffId, role: "bc" });
    const doctor = await assignRole(h.admin, { tenantId: a.tenantId, staffId, role: "doctor" });
    await assignBranch(h.admin, { tenantId: a.tenantId, staffRoleId: bc, branchId: a.branches[0] });
    await assignBranch(h.admin, { tenantId: a.tenantId, staffRoleId: doctor, branchId: a.branches[0] });
    return { ...a, acc, staffId };
  }

  it("records the staff and the acting role chosen, from the server-side context", async () => {
    const { tenantId, branches, acc, staffId } = await multiRole();
    for (const role of ["bc", "doctor"] as const) {
      await recordContextSelected(app, await resolveContext(app, acc, { tenantId, actingRole: role }));
    }
    const { rows } = await h.admin.query(
      `select staff_id, acting_role, active_branch_id from org_actions where tenant_id = $1 order by at, acting_role`,
      [tenantId],
    );
    expect(rows).toEqual([
      { staff_id: staffId, acting_role: "bc", active_branch_id: branches[0] },
      { staff_id: staffId, acting_role: "doctor", active_branch_id: branches[0] },
    ]);
  });

  it("an action cannot claim a branch other than the bound active branch, even one in scope", async () => {
    const { tenantId, branches, acc } = await multiRole();
    const second = await addBranch(tenantId, 9);
    const [{ id: roleId }] = (await h.admin.query(
      `select r.id from staff_roles r join staff s on s.id = r.staff_id join memberships m on m.id = s.membership_id
        where m.account_id = $1 and r.role = 'doctor'`,
      [acc],
    )).rows;
    await assignBranch(h.admin, { tenantId, staffRoleId: roleId, branchId: second });
    const ctx = await resolveContext(app, acc, { tenantId, actingRole: "doctor", activeBranchId: branches[0] });
    for (const sql of [
      `insert into org_actions (action, active_branch_id) values ('context_selected', '${second}')`,
      `insert into org_actions (action, active_branch_id) values ('context_selected', null)`,
    ]) {
      await expect(withTenantContext(app, ctx, async (db) => db.query(sql)), sql).rejects.toMatchObject({
        code: "42501",
      });
    }
  });

  it("assignBranch refuses a role id of another tenant; a malformed branch id is an IdentityError", async () => {
    const a = await tenant();
    const b = await tenant();
    const s = await createMembership(owner, { tenantId: b.tenantId, accountId: await account(), displayName: "B" });
    const rb = await assignRole(h.admin, { tenantId: b.tenantId, staffId: s.staffId, role: "nurse" });
    await expect(
      assignBranch(h.admin, { tenantId: a.tenantId, staffRoleId: rb, branchId: a.branches[0] }),
    ).rejects.toBeInstanceOf(IdentityError);
    const acc = await account();
    const sa = await createMembership(owner, { tenantId: a.tenantId, accountId: acc, displayName: "A" });
    await assignRole(h.admin, { tenantId: a.tenantId, staffId: sa.staffId, role: "owner" });
    await expect(
      resolveContext(app, acc, { tenantId: a.tenantId, actingRole: "owner", activeBranchId: "not-a-uuid" }),
    ).rejects.toBeInstanceOf(IdentityError);
  });

  it("concurrent createMembership calls are independent: a failing one does not lose the other", async () => {
    const a = await tenant();
    const acc = await account();
    const results = await Promise.allSettled([
      createMembership(owner, { tenantId: a.tenantId, accountId: acc, displayName: "Benar" }),
      createMembership(owner, { tenantId: a.tenantId, accountId: await account(), displayName: null as unknown as string }),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    const ok = (results[0] as PromiseFulfilledResult<{ membershipId: string; staffId: string }>).value;
    const { rows } = await h.admin.query(`select 1 from staff where id = $1 and membership_id = $2`, [ok.staffId, ok.membershipId]);
    expect(rows).toHaveLength(1);
  });

  it("a forged acting role, staff or tenant is refused by the database", async () => {
    const { tenantId, acc, staffId } = await multiRole();
    const other = await multiRole();
    const ctx = await resolveContext(app, acc, { tenantId, actingRole: "bc" });
    const attempts = [
      `insert into org_actions (action, acting_role) values ('context_selected', 'owner')`,
      `insert into org_actions (action, acting_role) values ('context_selected', 'doctor')`,
      `insert into org_actions (action, staff_id) values ('context_selected', '${other.staffId}')`,
      `insert into org_actions (action, tenant_id) values ('context_selected', '${other.tenantId}')`,
      `insert into org_actions (action, active_branch_id) values ('context_selected', '${other.branches[0]}')`,
    ];
    for (const sql of attempts) {
      await expect(
        withTenantContext(app, ctx, async (db) => db.query(sql)),
        sql,
      ).rejects.toMatchObject({ code: expect.stringMatching(/^(42501|23503)$/) });
    }
    // A context binding a role the staff does not hold is refused too.
    await expect(
      withTenantContext(app, { ...ctx, roles: ["owner"] }, async (db) =>
        db.query(`insert into org_actions (action) values ('context_selected')`),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    // Several roles bound at once: no single acting role, so nothing can be recorded.
    await expect(
      withTenantContext(app, { ...ctx, roles: ["bc", "doctor"] }, async (db) =>
        db.query(`insert into org_actions (action) values ('context_selected')`),
      ),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^(23502|42501)$/) });
    void staffId;
  });

  it("without context nothing can be recorded and nothing can be read", async () => {
    await expect(app.query(`insert into org_actions (action) values ('context_selected')`)).rejects.toMatchObject({
      code: expect.stringMatching(/^(23502|42501)$/),
    });
    expect((await app.query(`select * from org_actions`)).rows).toEqual([]);
  });
});

describe("cross-tenant isolation of the identity tables", () => {
  it("a member of A reads none of B's memberships, staff, roles or branches", async () => {
    const a = await tenant();
    const b = await tenant();
    const accA = await account();
    const sa = await createMembership(owner, { tenantId: a.tenantId, accountId: accA, displayName: "A" });
    await assignRole(h.admin, { tenantId: a.tenantId, staffId: sa.staffId, role: "owner" });
    const sb = await createMembership(owner, { tenantId: b.tenantId, accountId: await account(), displayName: "B" });
    const rb = await assignRole(h.admin, { tenantId: b.tenantId, staffId: sb.staffId, role: "nurse" });
    await assignBranch(h.admin, { tenantId: b.tenantId, staffRoleId: rb, branchId: b.branches[0] });

    const ctx = await resolveContext(app, accA, { tenantId: a.tenantId, actingRole: "owner" });
    const seen = await withTenantContext(app, ctx, async (db) => ({
      memberships: (await db.query(`select tenant_id from memberships`)).rows,
      staff: (await db.query(`select tenant_id from staff`)).rows,
      roles: (await db.query(`select tenant_id from staff_roles`)).rows,
      branches: (await db.query(`select tenant_id from staff_branches`)).rows,
    }));
    for (const rows of Object.values(seen)) {
      expect(rows.every((r: { tenant_id: string }) => r.tenant_id === a.tenantId)).toBe(true);
    }
    expect(seen.memberships).toHaveLength(1);
  });

  it("clinic_app cannot write the identity tables directly", async () => {
    const a = await tenant();
    const acc = await account();
    const s = await createMembership(owner, { tenantId: a.tenantId, accountId: acc, displayName: "Owner" });
    await assignRole(h.admin, { tenantId: a.tenantId, staffId: s.staffId, role: "owner" });
    const ctx = await resolveContext(app, acc, { tenantId: a.tenantId, actingRole: "owner" });
    for (const sql of [
      `insert into staff_roles (tenant_id, staff_id, role) values ('${a.tenantId}', '${s.staffId}', 'auditor')`,
      `update memberships set effective_to = null`,
      `delete from staff_roles`,
    ]) {
      await expect(withTenantContext(app, ctx, async (db) => db.query(sql)), sql).rejects.toMatchObject({
        code: "42501",
      });
    }
  });

  it("account_memberships returns only the requested account's active rows, ids and role keys", async () => {
    const a = await tenant();
    const accA = await account();
    const accB = await account();
    const sa = await createMembership(owner, { tenantId: a.tenantId, accountId: accA, displayName: "A" });
    await assignRole(h.admin, { tenantId: a.tenantId, staffId: sa.staffId, role: "finance" });
    const sb = await createMembership(owner, { tenantId: a.tenantId, accountId: accB, displayName: "B" });
    await assignRole(h.admin, { tenantId: a.tenantId, staffId: sb.staffId, role: "owner" });
    const c = await app.connect();
    try {
      const rows = await accountMemberships(c, accA);
      expect(rows).toEqual([
        { tenantId: a.tenantId, membershipId: sa.membershipId, staffId: sa.staffId, role: "finance", branchIds: null },
      ]);
      const cols = (await c.query(`select * from account_memberships($1)`, [accA])).fields.map((f) => f.name);
      expect(cols).toEqual(["tenant_id", "membership_id", "staff_id", "role", "branch_ids"]);
      expect(await accountMemberships(c, "00000000-0000-7000-8000-000000000000")).toEqual([]);
    } finally {
      c.release();
    }
  });
});

describe("the T-006 TOTP gate uses the real roles (PR-3 with memberships)", () => {
  it("a doctor membership requires TOTP; the same person without roles does not", async () => {
    const authLogin = await h.createLoginRole("", ["clinic_auth"]);
    const authPool = await openAppPool({ connectionString: h.urlAs(authLogin), max: 2 }, "clinic_auth");
    try {
      const auth = createAuth({
        pool: authPool,
        baseURL: BASE_URL,
        secret: randomBytes(32).toString("base64"),
        roles: roleSource(app),
        rateLimit: false,
        sleep: async () => {},
      });
      const doc = await auth.createStaffAccount({ email: "dokter.t007@klinik-sintetis.test", name: "Dok", password: PASSWORD });
      const plain = await auth.createStaffAccount({ email: "tanpa.peran@klinik-sintetis.test", name: "X", password: PASSWORD });
      const a = await tenant();
      const s = await createMembership(owner, { tenantId: a.tenantId, accountId: doc.id, displayName: "Dok" });
      const r = await assignRole(h.admin, { tenantId: a.tenantId, staffId: s.staffId, role: "doctor" });
      await assignBranch(h.admin, { tenantId: a.tenantId, staffRoleId: r, branchId: a.branches[0] });

      const c1 = new Client(auth);
      await c1.signIn("dokter.t007@klinik-sintetis.test");
      expect((await auth.checkSession(c1.headers())).gate).toBe("enrol_totp");
      const c2 = new Client(auth);
      await c2.signIn("tanpa.peran@klinik-sintetis.test");
      expect((await auth.checkSession(c2.headers())).gate).toBe("ok");
      void plain;
    } finally {
      await authPool.end();
    }
  });
});
