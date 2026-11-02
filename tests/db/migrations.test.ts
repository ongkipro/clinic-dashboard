// T-002: a fresh database migrates, and the schema honours 05 §3.1:
// UNIQUE(tenant_id, id) on every tenant table, composite tenant FKs between
// tenant tables, ON DELETE RESTRICT on every business FK.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setTimeout as sleep } from "node:timers/promises";
import { LOCAL_DATABASE_URL, MIGRATION_LOCK_KEY, MigrationDriftError, runMigrations } from "../../src/db/migrate";
import { contractViolations } from "./contract";

// Tests create a throwaway database on TEST_DATABASE_URL's server. Only loopback hosts
// are accepted outside CI so a developer shell pointed at a shared server is refused.
const adminUrl = process.env.TEST_DATABASE_URL ?? LOCAL_DATABASE_URL;
const adminHost = new URL(adminUrl).hostname;
if (!process.env.CI && !["127.0.0.1", "localhost", "::1", "[::1]"].includes(adminHost)) {
  throw new Error(`refusing to create test databases on non-loopback host ${adminHost}`);
}
const dbName = `t002_${randomUUID().replaceAll("-", "")}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

let admin: pg.Client;
let db: pg.Client;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = new pg.Client({ connectionString: testUrl });
  await db.connect();
});

afterAll(async () => {
  await db?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin?.end();
});

async function rows<T>(text: string, values: unknown[] = []): Promise<T[]> {
  return (await db.query(text, values)).rows as T[];
}

describe("fresh database migration", () => {
  it("creates the foundation tables", async () => {
    const names = (
      await rows<{ t: string }>(
        `select tablename as t from pg_tables where schemaname = 'public' order by 1`,
      )
    ).map((r) => r.t);
    expect(names).toEqual(expect.arrayContaining(["branches", "tenants", "tenants_registry"]));
  });

  it("two concurrent runners on a fresh database both succeed", async () => {
    const name = `${dbName}_c`;
    await admin.query(`CREATE DATABASE ${name}`);
    try {
      const u = new URL(testUrl);
      u.pathname = `/${name}`;
      await expect(
        Promise.all([runMigrations(u.toString()), runMigrations(u.toString())]),
      ).resolves.toEqual([undefined, undefined]);
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    }
  }, 60_000); // two full runs of every migration; CI runs the restore drill beside this suite

  it("a runner waits for the migration lock longer than the 5 s DDL lock timeout", async () => {
    const name = `${dbName}_w`;
    await admin.query(`CREATE DATABASE ${name}`);
    const u = new URL(testUrl);
    u.pathname = `/${name}`;
    const holder = new pg.Client({ connectionString: u.toString() });
    await holder.connect();
    try {
      await holder.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
      const run = runMigrations(u.toString());
      const settled = await Promise.race([run.then(() => "done", () => "failed"), sleep(6_500).then(() => "waiting")]);
      expect(settled).toBe("waiting");
      await holder.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
      await expect(run).resolves.toBeUndefined();
    } finally {
      await holder.end();
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    }
  }, 60_000);

  it("refuses to run when an applied migration was edited (drift)", async () => {
    const [row] = (await db.query(`select id, hash from drizzle.__drizzle_migrations order by id limit 1`)).rows;
    await db.query(`update drizzle.__drizzle_migrations set hash = 'edited' where id = $1`, [row.id]);
    try {
      await expect(runMigrations(testUrl)).rejects.toBeInstanceOf(MigrationDriftError);
    } finally {
      await db.query(`update drizzle.__drizzle_migrations set hash = $2 where id = $1`, [row.id, row.hash]);
    }
    await expect(runMigrations(testUrl)).resolves.toBeUndefined();
  });

  it("refuses an unapplied migration older than the newest applied one", async () => {
    const [first] = (await db.query(`select id, hash, created_at from drizzle.__drizzle_migrations order by created_at limit 1`)).rows;
    await db.query(`delete from drizzle.__drizzle_migrations where id = $1`, [first.id]);
    try {
      await expect(runMigrations(testUrl)).rejects.toThrow("would be skipped");
    } finally {
      await db.query(`insert into drizzle.__drizzle_migrations (id, hash, created_at) values ($1, $2, $3)`, [first.id, first.hash, first.created_at]);
    }
  });

  it("refuses an applied migration that has no file", async () => {
    await db.query(`insert into drizzle.__drizzle_migrations (hash, created_at) values ('x', 1)`);
    try {
      await expect(runMigrations(testUrl)).rejects.toThrow("has no file");
    } finally {
      await db.query(`delete from drizzle.__drizzle_migrations where created_at = 1`);
    }
  });

  it("re-running migrations is a no-op", async () => {
    await expect(runMigrations(testUrl)).resolves.toBeUndefined();
  });
});

describe("05 §3.1 constraint contract", () => {
  it("the migrated schema has no violations", async () => {
    expect(await contractViolations(db)).toEqual([]);
  });

  // Each fixture is created inside a rolled-back transaction to prove the checker
  // catches the defect it claims to catch.
  async function violationsWith(ddl: string): Promise<string[]> {
    await db.query("begin");
    try {
      await db.query(ddl);
      return await contractViolations(db);
    } finally {
      await db.query("rollback");
    }
  }

  it("flags a table without tenant_id that is not a platform table", async () => {
    expect(await violationsWith(`create table patients (id uuid primary key)`)).toEqual([
      "public.patients: unclassified table without tenant_id",
    ]);
  });

  it("flags tables outside the public schema too", async () => {
    expect(
      await violationsWith(`create schema extra; create table extra.notes (id uuid primary key)`),
    ).toEqual(["extra.notes: unclassified table without tenant_id"]);
  });

  it("flags a nullable tenant_id and a missing UNIQUE(tenant_id, id)", async () => {
    expect(
      await violationsWith(`create table visits (id uuid primary key, tenant_id uuid)`),
    ).toEqual(["public.visits: tenant_id is nullable", "public.visits: missing UNIQUE(tenant_id, id)"]);
  });

  it("flags a foreign key that is not ON DELETE RESTRICT", async () => {
    const v = await violationsWith(
      `create table rooms (id uuid primary key, tenant_id uuid not null, branch_id uuid not null,
         unique (tenant_id, id),
         constraint rooms_branch_fk foreign key (tenant_id, branch_id)
           references branches (tenant_id, id) on delete cascade)`,
    );
    expect(v).toEqual(["public.rooms.rooms_branch_fk: ON DELETE is not RESTRICT"]);
  });

  it("flags a single-column FK between tenant tables", async () => {
    const v = await violationsWith(
      `create table rooms (id uuid primary key, tenant_id uuid not null, branch_id uuid not null,
         unique (tenant_id, id),
         constraint rooms_branch_fk foreign key (branch_id) references branches (id) on delete restrict)`,
    );
    expect(v).toEqual(["public.rooms.rooms_branch_fk: not composite (tenant_id, id) key (branch_id->id)"]);
  });

  it("flags a composite FK that targets a key other than (tenant_id, id)", async () => {
    const v = await violationsWith(
      `create table rooms (id uuid primary key, tenant_id uuid not null, branch_code text not null,
         unique (tenant_id, id),
         constraint rooms_branch_fk foreign key (tenant_id, branch_code)
           references branches (tenant_id, code) on delete restrict)`,
    );
    expect(v).toEqual([
      "public.rooms.rooms_branch_fk: not composite (tenant_id, id) key (tenant_id->tenant_id, branch_code->code)",
    ]);
  });

  it("accepts a wider same-row key that includes (tenant_id, id)", async () => {
    const v = await violationsWith(
      `alter table branches add constraint branches_wide_key unique (tenant_id, id, code);
       create table rooms (id uuid primary key, tenant_id uuid not null, branch_id uuid not null,
         branch_code text not null, unique (tenant_id, id),
         constraint rooms_branch_fk foreign key (tenant_id, branch_id, branch_code)
           references branches (tenant_id, id, code) on delete restrict)`,
    );
    expect(v).toEqual([]);
  });

  it("flags a composite FK whose columns are mis-paired", async () => {
    const v = await violationsWith(
      `create table rooms (id uuid primary key, tenant_id uuid not null, branch_id uuid not null,
         unique (tenant_id, id),
         constraint rooms_branch_fk foreign key (tenant_id, branch_id)
           references branches (id, tenant_id) on delete restrict)`,
    );
    expect(v).toEqual([
      "public.rooms.rooms_branch_fk: not composite (tenant_id, id) key (tenant_id->id, branch_id->tenant_id)",
    ]);
  });
});

describe("foundation behaviour", () => {
  async function newTenant(): Promise<string> {
    const [r] = await rows<{ id: string }>(
      `insert into tenants_registry default values returning id`,
    );
    await db.query(
      `insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Sintetis', 'emkm')`,
      [r.id],
    );
    return r.id;
  }

  it("generates UUIDv7 ids carrying the current millisecond timestamp", async () => {
    const before = Date.now();
    const [r] = await rows<{ id: string }>(`select uuid_generate_v7()::text as id`);
    const after = Date.now();
    expect(r.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const ms = Number.parseInt(r.id.replaceAll("-", "").slice(0, 12), 16);
    expect(ms).toBeGreaterThanOrEqual(before - 1000); // tolerate client/server clock skew
    expect(ms).toBeLessThanOrEqual(after + 1000);
  });

  it("a tenant needs a registry row", async () => {
    await expect(
      db.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'x', 'emkm')`, [
        randomUUID(),
      ]),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("branch code is unique per tenant, not globally", async () => {
    const a = await newTenant();
    const b = await newTenant();
    const insert = (t: string) =>
      db.query(
        `insert into branches (tenant_id, code, name, timezone) values ($1, 'CAB01', 'Cabang', 'Asia/Jakarta')`,
        [t],
      );
    await insert(a);
    await insert(b);
    await expect(insert(a)).rejects.toMatchObject({ code: "23505" });
  });

  it("deleting a tenant with branches is restricted", async () => {
    const a = await newTenant();
    await db.query(
      `insert into branches (tenant_id, code, name, timezone) values ($1, 'CAB01', 'Cabang', 'Asia/Makassar')`,
      [a],
    );
    await expect(db.query(`delete from tenants where id = $1`, [a])).rejects.toMatchObject({
      code: "23503",
    });
    await expect(db.query(`delete from tenants_registry where id = $1`, [a])).rejects.toMatchObject(
      { code: "23503" },
    );
  });

  it("rejects an unknown branch timezone", async () => {
    const a = await newTenant();
    await expect(
      db.query(
        `insert into branches (tenant_id, code, name, timezone) values ($1, 'X', 'X', 'UTC')`,
        [a],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
