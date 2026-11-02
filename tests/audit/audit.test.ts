// T-008 Done-when: scenario PR-51 passes; tampering with an audit row breaks the chain
// check; audit rows carry account, membership, staff, acting role, tenant, branch,
// vendor session; no clinical values stored.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import {
  AuditChainBrokenError,
  checkAgainstCopies,
  dailyCopy,
  list,
  record,
  verifyChain,
} from "../../src/modules/audit/audit";
import {
  type ActingContext,
  assignBranch,
  assignRole,
  createMembership,
  resolveContext,
} from "../../src/modules/org/identity";
import type { Role } from "../../src/auth/policy";
import { createHarness, type Harness } from "../rls/harness";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;

type Tenant = { tenantId: string; branches: string[] };

async function tenant(branchCount = 2): Promise<Tenant> {
  const t = (await h.admin.query(`insert into tenants_registry default values returning id`)).rows[0].id;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [t, `PT ${t.slice(-4)}`]);
  const branches: string[] = [];
  for (let i = 1; i <= branchCount; i++) {
    branches.push(
      (await h.admin.query(
        `insert into branches (tenant_id, code, name, timezone) values ($1, $2, $3, 'Asia/Jakarta') returning id`,
        [t, `CAB0${i}`, `Cabang ${i}`],
      )).rows[0].id,
    );
  }
  return { tenantId: t, branches };
}

async function person(t: Tenant, roles: { role: Role; branches?: string[] }[]) {
  const acc = (await h.admin.query(
    `insert into auth_user (name, email) values ($1, $2) returning id`,
    [`P${++n}`, `p${n}@klinik-sintetis.test`],
  )).rows[0].id as string;
  const { membershipId, staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `P${n}` });
  for (const r of roles) {
    const id = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role: r.role });
    for (const b of r.branches ?? []) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: id, branchId: b });
  }
  return {
    acc,
    membershipId,
    staffId,
    as: (role: Role, activeBranchId?: string): Promise<ActingContext> =>
      resolveContext(app, acc, { tenantId: t.tenantId, actingRole: role, activeBranchId }),
  };
}

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 4 });
  owner = new pg.Pool({ connectionString: h.ownerUrl(), max: 2 });
});

afterAll(async () => {
  await owner?.end();
  await app?.end();
  await h?.close();
});

describe("scenario PR-51 audit", () => {
  it("a Level 3 role must bind an active branch, so branch-scoped reviewers see its actions", async () => {
    const t = await tenant(2);
    const doctor = await person(t, [{ role: "doctor", branches: [t.branches[0], t.branches[1]] }]);
    const head = await person(t, [{ role: "facility_head", branches: [t.branches[1]] }]);
    const noBranch = await doctor.as("doctor"); // two branches: none active
    await expect(
      withTenantContext(app, noBranch, (db) =>
        record(db, { action: "break_glass", objectKind: "medical_record", reason: "Pasien gawat, riwayat alergi diperlukan segera" }),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await withTenantContext(app, await doctor.as("doctor", t.branches[1]), (db) =>
      record(db, { action: "break_glass", objectKind: "medical_record", reason: "Pasien gawat, riwayat alergi diperlukan segera" }),
    );
    const seen = await withTenantContext(app, await head.as("facility_head"), (db) => list(db, "facility_head"));
    expect(seen.map((r) => r.action)).toEqual(["break_glass"]);
  });

  it("break-glass access by a doctor appears in the owner's Log Audit with reason and time", async () => {
    const t = await tenant();
    const doctor = await person(t, [{ role: "doctor", branches: [t.branches[0]] }]);
    const ownerP = await person(t, [{ role: "owner" }]);
    const recordId = "0198f2a1-0000-7000-8000-000000000001";
    const before = Date.now();

    await withTenantContext(app, await doctor.as("doctor"), (db) =>
      record(db, {
        action: "break_glass",
        objectKind: "medical_record",
        objectId: recordId,
        reason: "Pasien gawat, riwayat alergi diperlukan segera",
      }),
    );

    const rows = await withTenantContext(app, await ownerP.as("owner"), (db) => list(db, "owner"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "break_glass",
      objectKind: "medical_record",
      objectId: recordId,
      staffId: doctor.staffId,
      actingRole: "doctor",
      branchId: t.branches[0],
      reason: "Pasien gawat, riwayat alergi diperlukan segera",
    });
    expect(new Date(rows[0].at).getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("break-glass needs a reason of at least 15 characters; other actions carry none", async () => {
    const t = await tenant();
    const doctor = await person(t, [{ role: "doctor", branches: [t.branches[0]] }]);
    const ctx = await doctor.as("doctor");
    for (const e of [
      { action: "break_glass" as const, objectKind: "medical_record" },
      { action: "break_glass" as const, objectKind: "medical_record", reason: "terlalu pendek" },
      { action: "clinical_read" as const, objectKind: "medical_record", reason: "teks bebas tidak boleh di sini" },
    ]) {
      await expect(withTenantContext(app, ctx, (db) => record(db, e)), JSON.stringify(e)).rejects.toMatchObject({
        code: "23514",
      });
    }
  });
});

describe("attribution from the server-side context (DATA-60)", () => {
  it("rows carry account, membership, staff, acting role, tenant and branch; vendor session column exists", async () => {
    const t = await tenant();
    const p = await person(t, [{ role: "nurse", branches: [t.branches[1]] }]);
    const id = await withTenantContext(app, await p.as("nurse"), (db) =>
      record(db, { action: "clinical_read", objectKind: "medical_record", objectId: "0198f2a1-0000-7000-8000-000000000002" }),
    );
    const { rows } = await h.admin.query(`select * from audit_events where id = $1`, [id]);
    expect(rows[0]).toMatchObject({
      tenant_id: t.tenantId,
      account_id: p.acc,
      membership_id: p.membershipId,
      staff_id: p.staffId,
      acting_role: "nurse",
      branch_id: t.branches[1],
      vendor_session_id: null,
      vendor_staff_id: null,
      outcome: "success",
    });
  });

  it("the caller cannot choose who acted: audit_append takes no actor arguments", async () => {
    const { rows } = await h.admin.query(
      `select pg_get_function_identity_arguments('public.audit_append'::regproc) as args`,
    );
    expect(rows[0].args).not.toMatch(/staff|role|account|membership|tenant|branch/);
  });

  it("without a bound context, or with a role the staff does not hold, nothing is written", async () => {
    const t = await tenant();
    const p = await person(t, [{ role: "nurse", branches: [t.branches[0]] }]);
    const ctx = await p.as("nurse");
    await expect(
      app.query(`select audit_append('clinical_read', 'medical_record', null, 'success')`),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      withTenantContext(app, { ...ctx, roles: ["owner"] }, (db) => record(db, { action: "export", objectKind: "tenant" })),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      withTenantContext(app, { ...ctx, activeBranchId: t.branches[1] }, (db) =>
        record(db, { action: "clinical_read", objectKind: "medical_record" }),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("clinic_app cannot insert, update or delete audit rows directly; the owner cannot update or delete", async () => {
    const t = await tenant();
    const p = await person(t, [{ role: "owner" }]);
    const ctx = await p.as("owner");
    const id = await withTenantContext(app, ctx, (db) => record(db, { action: "settings_change", objectKind: "setting" }));
    for (const sql of [
      `insert into audit_events select * from audit_events limit 1`,
      `update audit_events set outcome = 'denied'`,
      `delete from audit_events`,
    ]) {
      await expect(withTenantContext(app, ctx, (db) => db.query(sql)), sql).rejects.toMatchObject({ code: "42501" });
    }
    await expect(h.admin.query(`update audit_events set outcome = 'denied' where id = $1`, [id])).rejects.toMatchObject({
      code: "42501",
    });
    await expect(h.admin.query(`delete from audit_events where id = $1`, [id])).rejects.toMatchObject({ code: "42501" });
    await expect(h.admin.query(`truncate audit_events`)).rejects.toMatchObject({ code: "42501" });
  });

  it("an audited action fails with its transaction when the audit row cannot be written (SEC-5)", async () => {
    const t = await tenant();
    const p = await person(t, [{ role: "owner" }]);
    const ctx = await p.as("owner");
    await expect(
      withTenantContext(app, ctx, async (db) => {
        await db.query(`insert into org_actions (action) values ('context_selected')`);
        await record(db, { action: "break_glass", objectKind: "medical_record" }); // no reason: refused
      }),
    ).rejects.toMatchObject({ code: "23514" });
    const { rows } = await h.admin.query(`select 1 from org_actions where tenant_id = $1`, [t.tenantId]);
    expect(rows).toEqual([]);
  });
});

describe("hash chain per tenant (SEC-5)", () => {
  it("chains rows per tenant with gap-free seq; concurrent appends stay consistent", async () => {
    const a = await tenant();
    const b = await tenant();
    const pa = await person(a, [{ role: "owner" }]);
    const pb = await person(b, [{ role: "owner" }]);
    const ca = await pa.as("owner");
    const cb = await pb.as("owner");
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        withTenantContext(app, i % 2 ? ca : cb, (db) => record(db, { action: "settings_change", objectKind: "setting" })),
      ),
    );
    for (const [ctx, t] of [[ca, a], [cb, b]] as const) {
      const seqs = (await h.admin.query(`select seq from audit_events where tenant_id = $1 order by seq`, [t.tenantId])).rows.map((r) => Number(r.seq));
      expect(seqs).toEqual([1, 2, 3, 4, 5, 6]);
      expect(await withTenantContext(app, ctx, (db) => verifyChain(db, t.tenantId))).toBeNull();
    }
  });

  it("tampering with a row breaks the chain check at that row", async () => {
    const t = await tenant();
    const p = await person(t, [{ role: "owner" }]);
    const ctx = await p.as("owner");
    for (let i = 0; i < 4; i++) {
      await withTenantContext(app, ctx, (db) => record(db, { action: "approval", objectKind: "approval" }));
    }
    // A database administrator bypasses the trigger to rewrite row 3.
    await h.admin.query(`alter table audit_events disable trigger audit_events_no_update`);
    try {
      await h.admin.query(`update audit_events set outcome = 'denied' where tenant_id = $1 and seq = 3`, [t.tenantId]);
    } finally {
      await h.admin.query(`alter table audit_events enable trigger audit_events_no_update`);
    }
    expect(await withTenantContext(app, ctx, (db) => verifyChain(db, t.tenantId))).toBe(3);
  });

  it("deleting a row is caught at the next row (gap in seq / prev_hash mismatch)", async () => {
    const t = await tenant();
    const p = await person(t, [{ role: "owner" }]);
    const ctx = await p.as("owner");
    for (let i = 0; i < 3; i++) {
      await withTenantContext(app, ctx, (db) => record(db, { action: "export", objectKind: "tenant" }));
    }
    await h.admin.query(`alter table audit_events disable trigger audit_events_no_update`);
    try {
      await h.admin.query(`delete from audit_events where tenant_id = $1 and seq = 2`, [t.tenantId]);
    } finally {
      await h.admin.query(`alter table audit_events enable trigger audit_events_no_update`);
    }
    expect(await withTenantContext(app, ctx, (db) => verifyChain(db, t.tenantId))).toBe(3);
  });

  it("audit_verify only answers for the bound tenant and for log readers", async () => {
    const a = await tenant();
    const b = await tenant();
    const pa = await person(a, [{ role: "owner" }, { role: "nurse", branches: [a.branches[0]] }]);
    await expect(withTenantContext(app, await pa.as("owner"), (db) => verifyChain(db, b.tenantId))).rejects.toMatchObject({
      code: "42501",
    });
    await expect(withTenantContext(app, await pa.as("nurse"), (db) => verifyChain(db, a.tenantId))).rejects.toMatchObject({
      code: "42501",
    });
  });
});

describe("who reads the log (UX-31)", () => {
  it("owner and auditor read the tenant; facility head and records officer only their branches; others nothing", async () => {
    const t = await tenant(2);
    const nurse1 = await person(t, [{ role: "nurse", branches: [t.branches[0]] }]);
    const nurse2 = await person(t, [{ role: "nurse", branches: [t.branches[1]] }]);
    const ownerP = await person(t, [{ role: "owner" }]);
    await withTenantContext(app, await nurse1.as("nurse"), (db) => record(db, { action: "clinical_read", objectKind: "medical_record" }));
    await withTenantContext(app, await nurse2.as("nurse"), (db) => record(db, { action: "clinical_read", objectKind: "medical_record" }));
    await withTenantContext(app, await ownerP.as("owner"), (db) => record(db, { action: "export", objectKind: "tenant" }));

    const readers = await person(t, [
      { role: "auditor" },
      { role: "facility_head", branches: [t.branches[0]] },
      { role: "records_officer", branches: [t.branches[1]] },
      { role: "manager", branches: [t.branches[0]] },
    ]);
    const count = async (role: Role) =>
      (await withTenantContext(app, await readers.as(role), (db) => list(db, role))).length;
    expect(await withTenantContext(app, await ownerP.as("owner"), (db) => list(db, "owner"))).toHaveLength(3);
    expect(await count("auditor")).toBe(3);
    expect(await count("facility_head")).toBe(1); // branch 1 only, not tenant-level rows
    expect(await count("records_officer")).toBe(1);
    expect(await count("manager")).toBe(0);
  });

  it("the internal auditor sees a masked projection (no object id, no reason)", async () => {
    const t = await tenant();
    const doctor = await person(t, [{ role: "doctor", branches: [t.branches[0]] }]);
    const auditor = await person(t, [{ role: "auditor" }]);
    await withTenantContext(app, await doctor.as("doctor"), (db) =>
      record(db, {
        action: "break_glass",
        objectKind: "medical_record",
        objectId: "0198f2a1-0000-7000-8000-000000000003",
        reason: "Pasien gawat, riwayat alergi diperlukan segera",
      }),
    );
    const [row] = await withTenantContext(app, await auditor.as("auditor"), (db) => list(db, "auditor"));
    expect(row).toMatchObject({ action: "break_glass", objectId: null, reason: null, staffId: doctor.staffId });
  });

  it("filters by actor, acting role, object and time; rejects malformed filters", async () => {
    const t = await tenant();
    const doctor = await person(t, [{ role: "doctor", branches: [t.branches[0]] }, { role: "bc", branches: [t.branches[0]] }]);
    const ownerP = await person(t, [{ role: "owner" }]);
    await withTenantContext(app, await doctor.as("doctor"), (db) => record(db, { action: "sign", objectKind: "medical_record" }));
    await withTenantContext(app, await doctor.as("bc"), (db) => record(db, { action: "clinical_read", objectKind: "intake" }));
    const oc = await ownerP.as("owner");
    const q = (f: Parameters<typeof list>[2]) => withTenantContext(app, oc, (db) => list(db, "owner", f));
    expect((await q({ actingRole: "doctor" })).map((r) => r.action)).toEqual(["sign"]);
    expect((await q({ objectKind: "intake" })).map((r) => r.actingRole)).toEqual(["bc"]);
    expect(await q({ staffId: doctor.staffId })).toHaveLength(2);
    expect(await q({ from: new Date(Date.now() + 60_000) })).toHaveLength(0);
    await expect(q({ staffId: "x' or 1=1 --" })).rejects.toThrow("not a UUID");
    await expect(q({ objectKind: "a; drop table x" })).rejects.toThrow("malformed");
    await expect(q({ from: new Date("2026-13-45") })).rejects.toThrow("not a date");
    expect(await q({ limit: Number.NaN })).toHaveLength(2);
  });

  it("cross-tenant: an owner of A never sees B's audit rows", async () => {
    const a = await tenant();
    const b = await tenant();
    const pb = await person(b, [{ role: "owner" }]);
    await withTenantContext(app, await pb.as("owner"), (db) => record(db, { action: "export", objectKind: "tenant" }));
    const pa = await person(a, [{ role: "owner" }]);
    expect(await withTenantContext(app, await pa.as("owner"), (db) => list(db, "owner"))).toEqual([]);
  });
});

describe("hash covers every column", () => {
  it("audit_canonical names every column except prev_hash and hash (a new column must be added to it)", async () => {
    const cols = (await h.admin.query(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'audit_events'`,
    )).rows.map((r) => r.column_name as string);
    const { rows } = await h.admin.query(`select pg_get_functiondef('public.audit_canonical(public.audit_events)'::regprocedure) as d`);
    const body = rows[0].d as string;
    const missing = cols.filter((c) => !["prev_hash", "hash"].includes(c) && !new RegExp(`e\\.${c}\\b`).test(body));
    expect(missing).toEqual([]);
  });
});

describe("no clinical values stored", () => {
  it("every column is an id, a code or a timestamp, except the break-glass reason", async () => {
    const { rows } = await h.admin.query(
      `select column_name, data_type from information_schema.columns
        where table_schema = 'public' and table_name = 'audit_events' order by ordinal_position`,
    );
    const text = rows.filter((r) => r.data_type === "text").map((r) => r.column_name);
    expect(text.sort()).toEqual(
      ["acting_role", "action", "hash", "object_kind", "outcome", "prev_hash", "reason", "reason_code", "service_identity"].sort(),
    );
    // Codes are constrained; free text exists only for break_glass.
    const t = await tenant();
    const p = await person(t, [{ role: "owner" }]);
    await expect(
      withTenantContext(app, await p.as("owner"), (db) =>
        record(db, { action: "export", objectKind: "Diagnosa: dermatitis atopik" }),
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

// Own database: the tamper tests above leave broken chains on purpose.
describe("write-once copy and anchors (SEC-5)", () => {
  let h2: Harness;
  let app2: pg.Pool;
  let owner2: pg.Pool;
  beforeAll(async () => {
    h2 = await createHarness();
    app2 = await openAppPool({ connectionString: h2.urlAs(await h2.createLoginRole("", [APP_GROUP_ROLE])), max: 2 });
    owner2 = new pg.Pool({ connectionString: h2.ownerUrl(), max: 2 });
  });
  afterAll(async () => {
    await owner2?.end();
    await app2?.end();
    await h2?.close();
  });
  const use = async <T>(fn: () => Promise<T>): Promise<T> => {
    const saved = [h, app, owner] as const;
    [h, app, owner] = [h2, app2, owner2];
    try {
      return await fn();
    } finally {
      [h, app, owner] = saved;
    }
  };

  // In-memory write-once store: create-only, anchors read back from stored manifests.
  function memoryStore() {
    const objects = new Map<string, Buffer>();
    return {
      objects,
      async put(key: string, body: Buffer) {
        if (objects.has(key)) throw new Error("object exists (write-once)");
        objects.set(key, body);
      },
      async anchors(tenantId: string) {
        return [...objects.entries()]
          .filter(([k]) => k.startsWith(`audit/${tenantId}/`))
          .map(([key, body]) => {
            const m = JSON.parse(body.toString().split("\n")[0]).manifest;
            return { seq: m.toSeq as number, hash: m.anchorHash as string, key };
          })
          .sort((x, y) => x.seq - y.seq);
      },
    };
  }
  const tamper = async (sql: string, args: unknown[]) => {
    await h.admin.query(`alter table audit_events disable trigger audit_events_no_update`);
    try {
      await h.admin.query(sql, args);
    } finally {
      await h.admin.query(`alter table audit_events enable trigger audit_events_no_update`);
    }
  };
  const ownerClient = async <T>(fn: (c: pg.PoolClient) => Promise<T>) => {
    const c = await owner.connect();
    try {
      return await fn(c);
    } finally {
      c.release();
    }
  };

  it("copies by seq per tenant: each run copies only new rows, rows are recomputable from the copy", () =>
    use(async () => {
      const t = await tenant();
      const p = await person(t, [{ role: "owner" }]);
      const ctx = await p.as("owner");
      const store = memoryStore();
      for (let i = 0; i < 3; i++) await withTenantContext(app, ctx, (db) => record(db, { action: "export", objectKind: "tenant" }));
      const first = await ownerClient((c) => dailyCopy(c, store, "20261103T000000Z"));
      expect(first.find((r) => r.tenantId === t.tenantId)).toMatchObject({ fromSeq: 1, toSeq: 3 });
      await withTenantContext(app, ctx, (db) => record(db, { action: "export", objectKind: "tenant" }));
      const second = await ownerClient((c) => dailyCopy(c, store, "20261104T000000Z"));
      expect(second.find((r) => r.tenantId === t.tenantId)).toMatchObject({ fromSeq: 4, toSeq: 4 });
      // A third run with nothing new writes nothing for this tenant.
      const third = await ownerClient((c) => dailyCopy(c, store, "20261105T000000Z"));
      expect(third.find((r) => r.tenantId === t.tenantId)).toBeUndefined();

      // Every copied row's hash recomputes from the copy alone.
      const { createHash } = await import("node:crypto");
      for (const body of store.objects.values()) {
        const [, ...lines] = body.toString().trim().split("\n");
        for (const l of lines) {
          const r = JSON.parse(l);
          expect(createHash("sha256").update(r.prev_hash + r.canonical).digest("hex")).toBe(r.hash);
        }
      }
      // The store refuses to overwrite.
      await expect(store.put([...store.objects.keys()][0], Buffer.from("x"))).rejects.toThrow("write-once");
    }));

  it("a row committed after a run (late transaction) is copied by the next run", () =>
    use(async () => {
      const t = await tenant();
      const p = await person(t, [{ role: "owner" }]);
      const ctx = await p.as("owner");
      const store = memoryStore();
      await withTenantContext(app, ctx, (db) => record(db, { action: "export", objectKind: "tenant" }));
      // An open transaction appends before the run but commits after it.
      let release!: () => void;
      const held = withTenantContext(app, ctx, async (db) => {
        await record(db, { action: "approval", objectKind: "approval" });
        await new Promise<void>((r) => (release = r));
      });
      await new Promise((r) => setTimeout(r, 100));
      const run1 = await ownerClient((c) => dailyCopy(c, store, "20261103T000000Z"));
      expect(run1.find((r) => r.tenantId === t.tenantId)?.toSeq).toBe(1);
      release();
      await held;
      const run2 = await ownerClient((c) => dailyCopy(c, store, "20261104T000000Z"));
      expect(run2.find((r) => r.tenantId === t.tenantId)).toMatchObject({ fromSeq: 2, toSeq: 2 });
    }));

  it("a DBA who deletes a row and re-chains the rest passes audit_verify but fails the anchor check", () =>
    use(async () => {
      const t = await tenant();
      const p = await person(t, [{ role: "owner" }]);
      const ctx = await p.as("owner");
      const store = memoryStore();
      for (let i = 0; i < 3; i++) await withTenantContext(app, ctx, (db) => record(db, { action: "export", objectKind: "tenant" }));
      await ownerClient((c) => dailyCopy(c, store, "20261103T000000Z"));

      // Full forgery: delete seq 2, renumber seq 3 as 2, recompute every hash.
      await tamper(`delete from audit_events where tenant_id = $1 and seq = 2`, [t.tenantId]);
      await tamper(`update audit_events set seq = 2 where tenant_id = $1 and seq = 3`, [t.tenantId]);
      await h.admin.query(`alter table audit_events disable trigger audit_events_no_update`);
      try {
        await h.admin.query(
          `do $$ declare e audit_events; prev text := repeat('0', 64); begin
             for e in select * from audit_events where tenant_id = '${t.tenantId}' order by seq loop
               update audit_events set prev_hash = prev where id = e.id;
               update audit_events set hash = encode(digest(prev || audit_canonical((select x from audit_events x where x.id = e.id)), 'sha256'), 'hex') where id = e.id;
               select hash into prev from audit_events where id = e.id;
             end loop; end $$`,
        );
      } finally {
        await h.admin.query(`alter table audit_events enable trigger audit_events_no_update`);
      }
      expect(await withTenantContext(app, ctx, (db) => verifyChain(db, t.tenantId))).toBeNull(); // forgery is self-consistent
      expect(await ownerClient((c) => checkAgainstCopies(c, store))).toContainEqual({ tenantId: t.tenantId, brokenSeq: 3 });
      await expect(ownerClient((c) => dailyCopy(c, store, "20261104T000000Z"))).rejects.toBeInstanceOf(AuditChainBrokenError);
    }));

  it("a broken tenant does not stop copying the others; the run still fails loudly", () =>
    use(async () => {
      const bad = await tenant();
      const good = await tenant();
      const pb = await person(bad, [{ role: "owner" }]);
      const pg2 = await person(good, [{ role: "owner" }]);
      const store = memoryStore();
      await withTenantContext(app, await pb.as("owner"), (db) => record(db, { action: "export", objectKind: "tenant" }));
      await withTenantContext(app, await pg2.as("owner"), (db) => record(db, { action: "export", objectKind: "tenant" }));
      await tamper(`update audit_events set hash = repeat('a', 64) where tenant_id = $1`, [bad.tenantId]);
      await expect(ownerClient((c) => dailyCopy(c, store, "20261103T000000Z"))).rejects.toBeInstanceOf(AuditChainBrokenError);
      const keys = [...store.objects.keys()];
      expect(keys.some((k) => k.startsWith(`audit/${good.tenantId}/`))).toBe(true);
      const badCopy = keys.find((k) => k.startsWith(`audit/${bad.tenantId}/`))!;
      const manifest = JSON.parse(store.objects.get(badCopy)!.toString().split("\n")[0]).manifest;
      expect(manifest.chainBrokenAt).toBe(1);
    }));

  it("a store failure for one tenant does not stop copying the others", () =>
    use(async () => {
      const a = await tenant();
      const b = await tenant();
      for (const t of [a, b]) {
        const p = await person(t, [{ role: "owner" }]);
        await withTenantContext(app, await p.as("owner"), (db) => record(db, { action: "export", objectKind: "tenant" }));
      }
      const inner = memoryStore();
      const store = {
        ...inner,
        async put(key: string, body: Buffer) {
          if (key.startsWith(`audit/${a.tenantId}/`)) throw new Error("network down");
          return inner.put(key, body);
        },
      };
      const err = await ownerClient((c) => dailyCopy(c, store, "20261103T000000Z")).catch((e) => e);
      expect(err).toBeInstanceOf(AuditChainBrokenError);
      expect(err.failedCopies.map((f: { tenantId: string }) => f.tenantId)).toContain(a.tenantId);
      expect([...inner.objects.keys()].some((k) => k.startsWith(`audit/${b.tenantId}/`))).toBe(true);
    }));
});
