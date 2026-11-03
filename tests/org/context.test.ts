// T-030 Done-when: context switching records the active branch, brand and acting role on
// actions (PR-84 branch-switch half: the doctor at B1 switches to B2 and the action
// records B2; Antrean with B2 patients arrives with the walk-in task).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { emit } from "../../src/modules/events/events";
import {
  activeContext,
  ContextSwitchError,
  parseSelection,
  type Selection,
  serializeSelection,
  switchContext,
} from "../../src/modules/org/context/context";
import { assignBranch, assignRole, createMembership } from "../../src/modules/org/identity";
import { shellFor } from "../../src/components/shell/context";
import { sayaFor } from "../../src/components/shell/nav";
import { createHarness, type Harness } from "../rls/harness";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;

type Clinic = { tenantId: string; name: string; b1: string; b2: string };

async function clinic(name: string): Promise<Clinic> {
  const tenantId = (await h.admin.query(`insert into tenants_registry default values returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, name]);
  const br = async (code: string, label: string) =>
    (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $3, 'Asia/Jakarta') returning id`, [tenantId, code, label])).rows[0].id as string;
  return { tenantId, name, b1: await br("B1", "Cabang Kemang"), b2: await br("B2", "Cabang Senopati") };
}

async function account(): Promise<string> {
  return (await h.admin.query(`insert into auth_user (name, email) values ('S', $1) returning id`, [`c${++n}@klinik-sintetis.test`])).rows[0].id as string;
}

async function member(acc: string, c: Clinic, roles: [Role, string[]?][]) {
  const { staffId } = await createMembership(owner, { tenantId: c.tenantId, accountId: acc, displayName: `Staf ${n}` });
  for (const [role, branches] of roles) {
    const rid = await assignRole(h.admin, { tenantId: c.tenantId, staffId, role });
    for (const b of branches ?? []) await assignBranch(h.admin, { tenantId: c.tenantId, staffRoleId: rid, branchId: b });
  }
  return staffId;
}

const actions = async (staffId: string) =>
  (await h.admin.query(`select tenant_id, acting_role, active_branch_id from org_actions where staff_id = $1 order by at, id`, [staffId])).rows;

let A: Clinic;
let B: Clinic;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = new pg.Pool({ connectionString: h.ownerUrl(), max: 2 });
  A = await clinic("PT Klinik Aurelia Sintetis");
  B = await clinic("PT Klinik Bening Sintetis");
});

afterAll(async () => {
  await owner?.end();
  await app?.end();
  await h?.close();
});

describe("scenario PR-84 branch switch (record half)", () => {
  it("a doctor allowed at B1 and B2 with B1 active switches to B2: the switch and later actions record B2", async () => {
    const acc = await account();
    const staffId = await member(acc, A, [["doctor", [A.b1, A.b2]]]);
    const start = await activeContext(app, acc, { tenantId: A.tenantId, role: "doctor", branchId: A.b1 });
    expect(start!.context.activeBranchId).toBe(A.b1);
    const next = await switchContext(app, acc, { tenantId: A.tenantId, role: "doctor", branchId: A.b1 }, { kind: "branch", branchId: A.b2 });
    expect(next).toEqual({ tenantId: A.tenantId, role: "doctor", branchId: A.b2 });
    expect(await actions(staffId)).toEqual([{ tenant_id: A.tenantId, acting_role: "doctor", active_branch_id: A.b2 }]);
    // A later action in the stored context carries B2 too (domain event attribution).
    const now = await activeContext(app, acc, next);
    await withTenantContext(app, now!.context, (db) =>
      emit(db, { type: "VisitCheckedIn", aggregateKind: "visit", aggregateId: crypto.randomUUID(), branchId: now!.context.activeBranchId }),
    );
    const ev = (await h.admin.query(`select branch_id, acting_role from domain_events where staff_id = $1`, [staffId])).rows;
    expect(ev).toEqual([{ branch_id: A.b2, acting_role: "doctor" }]);
  });
});

describe("Ganti Peran, Ganti Klinik and the recorded context", () => {
  it("switching role records the new acting role; the active role drives the shell", async () => {
    const acc = await account();
    const staffId = await member(acc, A, [["manager", [A.b1]], ["doctor", [A.b1]]]);
    const cur: Selection = {};
    const first = await activeContext(app, acc, cur);
    expect(first!.context.actingRole).toBe("manager"); // 07 order
    expect(first!.roles).toEqual(["manager", "doctor"]);
    const next = await switchContext(app, acc, cur, { kind: "role", role: "doctor" });
    expect(next.role).toBe("doctor");
    expect(await actions(staffId)).toEqual([{ tenant_id: A.tenantId, acting_role: "doctor", active_branch_id: A.b1 }]);
    const shell = await shellFor(app, acc, next);
    expect(shell).toMatchObject({ kind: "ok", context: { role: "doctor", roleLabel: "Dokter", clinic: A.name, canSwitchRole: true, canSwitchClinic: false } });
  });

  it("switching clinic opens the new clinic's defaults and records that brand", async () => {
    const acc = await account();
    await member(acc, A, [["owner"]]);
    const staffB = await member(acc, B, [["finance"]]);
    const first = await activeContext(app, acc, {});
    expect(first!.clinics.map((c) => c.name).sort()).toEqual([A.name, B.name].sort());
    const other = first!.context.tenantId === A.tenantId ? B : A;
    const next = await switchContext(app, acc, {}, { kind: "clinic", tenantId: other.tenantId });
    expect(next.tenantId).toBe(other.tenantId);
    if (other === B) expect(await actions(staffB)).toEqual([{ tenant_id: B.tenantId, acting_role: "finance", active_branch_id: null }]);
    const shell = await shellFor(app, acc, next);
    expect(shell).toMatchObject({ kind: "ok", context: { clinic: other.name, canSwitchClinic: true } });
  });

  it("a tenant-wide role switches between a branch and Semua Cabang", async () => {
    const acc = await account();
    const staffId = await member(acc, A, [["owner"]]);
    const s1 = await switchContext(app, acc, {}, { kind: "branch", branchId: A.b2 });
    expect(s1.branchId).toBe(A.b2);
    const s2 = await switchContext(app, acc, s1, { kind: "branch", branchId: null });
    expect(s2.branchId).toBeNull();
    expect((await actions(staffId)).map((r) => r.active_branch_id)).toEqual([A.b2, null]);
  });
});

describe("the stored selection is re-validated (TEN-1)", () => {
  it("refuses a branch outside the role's scope, another tenant's branch, a role not held, a clinic not joined", async () => {
    const acc = await account();
    const staffId = await member(acc, A, [["nurse", [A.b1]]]);
    for (const req of [
      { kind: "branch", branchId: A.b2 },
      { kind: "branch", branchId: B.b1 },
      { kind: "branch", branchId: null },
      { kind: "role", role: "owner" },
      { kind: "clinic", tenantId: B.tenantId },
    ] as const) {
      await expect(switchContext(app, acc, {}, req), JSON.stringify(req)).rejects.toBeInstanceOf(ContextSwitchError);
    }
    expect(await actions(staffId)).toEqual([]);
  });

  it("a forged or stale stored selection falls back to the defaults, never to foreign data", async () => {
    const acc = await account();
    await member(acc, A, [["fo_cashier", [A.b1]]]);
    for (const sel of [
      { tenantId: B.tenantId, role: "owner", branchId: B.b1 },
      { tenantId: A.tenantId, role: "owner" },
      { tenantId: A.tenantId, role: "fo_cashier", branchId: A.b2 },
      { tenantId: A.tenantId, role: "fo_cashier", branchId: crypto.randomUUID() },
    ] as Selection[]) {
      const a = await activeContext(app, acc, sel);
      expect(a!.context, JSON.stringify(sel)).toMatchObject({ tenantId: A.tenantId, actingRole: "fo_cashier", activeBranchId: A.b1 });
      expect(a!.branches.map((b) => b.id)).toEqual([A.b1]);
    }
  });

  it("a removed role or ended membership is no longer offered", async () => {
    const acc = await account();
    const staffId = await member(acc, A, [["manager", [A.b1]], ["doctor", [A.b1]]]);
    const sel = await switchContext(app, acc, {}, { kind: "role", role: "doctor" });
    await h.admin.query(`delete from staff_branches where staff_id = $1 and role = 'doctor'`, [staffId]);
    await h.admin.query(`delete from staff_roles where staff_id = $1 and role = 'doctor'`, [staffId]);
    expect((await activeContext(app, acc, sel))!.context.actingRole).toBe("manager");
    await h.admin.query(`update memberships set effective_to = now() where id = (select membership_id from staff where id = $1)`, [staffId]);
    expect(await activeContext(app, acc, sel)).toBeNull();
  });

  it("a clinic whose first role cannot act is still offered through another role", async () => {
    const acc = await account();
    await member(acc, A, [["owner"]]);
    await member(acc, B, [["therapist"], ["manager", [B.b1]]]); // therapist has no branch yet
    const a = await activeContext(app, acc, { tenantId: A.tenantId });
    expect(a!.clinics.map((c) => c.tenantId).sort()).toEqual([A.tenantId, B.tenantId].sort());
    const next = await switchContext(app, acc, { tenantId: A.tenantId }, { kind: "clinic", tenantId: B.tenantId });
    expect(next).toEqual({ tenantId: B.tenantId, role: "manager", branchId: B.b1 });
  });

  it("repeating the current choice records nothing", async () => {
    const acc = await account();
    const staffId = await member(acc, A, [["doctor", [A.b1, A.b2]]]);
    // Start explicitly on b1: the default branch is the first by id (UUIDv7, so b1 or b2
    // depending on timing), and the first switch must be a real change to be recorded.
    const s1 = await switchContext(app, acc, { tenantId: A.tenantId, role: "doctor", branchId: A.b1 }, { kind: "branch", branchId: A.b2 });
    await switchContext(app, acc, s1, { kind: "branch", branchId: A.b2 });
    expect(await actions(staffId)).toHaveLength(1);
  });

  it("a branch role without a branch is not offered as a role", async () => {
    const acc = await account();
    await member(acc, A, [["manager", [A.b1]], ["therapist"]]);
    expect((await activeContext(app, acc, {}))!.roles).toEqual(["manager"]);
  });

  it("parseSelection drops malformed fields; serialize round-trips", () => {
    expect(parseSelection(undefined)).toEqual({});
    expect(parseSelection("not json")).toEqual({});
    expect(parseSelection(JSON.stringify({ t: "x", r: "superadmin", b: "y" }))).toEqual({ tenantId: undefined, role: undefined, branchId: undefined });
    const s = { tenantId: A.tenantId, role: "doctor", branchId: null };
    expect(parseSelection(serializeSelection(s))).toEqual(s);
  });
});

describe("Saya shows a switcher only when there is something to switch to (17)", () => {
  it("single-role, single-branch, single-clinic staff see none", () => {
    const ids = sayaFor("nurse", { roles: false, branches: false, clinics: false }).map((p) => p.id);
    expect(ids).not.toContain("ganti-peran");
    expect(ids).not.toContain("ganti-cabang");
    expect(ids).not.toContain("ganti-klinik");
    expect(sayaFor("nurse", { roles: true, branches: true, clinics: true }).map((p) => p.id)).toEqual(
      expect.arrayContaining(["ganti-peran", "ganti-cabang", "ganti-klinik"]),
    );
  });
});
