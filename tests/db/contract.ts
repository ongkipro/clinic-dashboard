// 05 §3.1 constraint contract checker. Returns human-readable violations so a test can
// prove both that the real schema is clean and that the checker catches bad fixtures.
import type pg from "pg";

// Tables exempt from the tenant-table rules: scope_map rows of policy kind `platform`
// (TEN-16) plus the tenant root `tenants`, whose id is the tenant id. Every other table
// must be a tenant table. Scope-map completeness itself is tested in tests/rls.
const TENANT_ROOT = "public.tenants";

async function exemptTables(db: pg.ClientBase): Promise<Set<string>> {
  const { rows } = await db.query<{ t: string }>(
    `select table_name as t from scope_map where policy_kind = 'platform'`,
  );
  return new Set([TENANT_ROOT, ...rows.map((r) => r.t)]);
}

const USER_TABLES = `
  select n.nspname as schema, c.relname as table, n.nspname || '.' || c.relname as qualified,
         exists (select 1 from pg_attribute a where a.attrelid = c.oid
                 and a.attname = 'tenant_id' and not a.attisdropped) as has_tenant,
         coalesce((select a.attnotnull from pg_attribute a where a.attrelid = c.oid
                 and a.attname = 'tenant_id' and not a.attisdropped), false) as tenant_not_null
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r','p')
    and n.nspname not in ('pg_catalog','information_schema','drizzle')
    and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp%'
  order by 1, 2`;

type Table = {
  schema: string;
  table: string;
  qualified: string;
  has_tenant: boolean;
  tenant_not_null: boolean;
};

export async function contractViolations(db: pg.ClientBase): Promise<string[]> {
  const out: string[] = [];
  const tables = (await db.query<Table>(USER_TABLES)).rows;
  const exempt = await exemptTables(db);
  const tenantTables = new Set<string>();

  for (const t of tables) {
    if (exempt.has(t.qualified)) continue;
    if (!t.has_tenant) {
      out.push(`${t.qualified}: unclassified table without tenant_id`);
      continue;
    }
    tenantTables.add(t.qualified);
    if (!t.tenant_not_null) out.push(`${t.qualified}: tenant_id is nullable`);
    const keys = await db.query<{ cols: string[] }>(
      `select array(select a.attname::text from unnest(k.conkey) with ordinality u(n, o)
              join pg_attribute a on a.attrelid = k.conrelid and a.attnum = u.n
              order by u.o) as cols
       from pg_constraint k
       join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname || '.' || c.relname = $1 and k.contype in ('u','p')`,
      [t.qualified],
    );
    if (!keys.rows.some((k) => k.cols.join(",") === "tenant_id,id")) {
      out.push(`${t.qualified}: missing UNIQUE(tenant_id, id)`);
    }
  }

  const fks = await db.query<{
    name: string;
    src: string;
    dst: string;
    deltype: string;
    pairs: string[];
  }>(
    `select k.conname as name,
            (select n2.nspname || '.' || c2.relname from pg_class c2
               join pg_namespace n2 on n2.oid = c2.relnamespace where c2.oid = k.conrelid) as src,
            (select n2.nspname || '.' || c2.relname from pg_class c2
               join pg_namespace n2 on n2.oid = c2.relnamespace where c2.oid = k.confrelid) as dst,
            k.confdeltype as deltype,
            array(select sa.attname::text || '->' || da.attname::text
                  from unnest(k.conkey, k.confkey) with ordinality u(c, rc, o)
                  join pg_attribute sa on sa.attrelid = k.conrelid and sa.attnum = u.c
                  join pg_attribute da on da.attrelid = k.confrelid and da.attnum = u.rc
                  order by u.o) as pairs
     from pg_constraint k join pg_namespace n on n.oid = k.connamespace
     where k.contype = 'f' and n.nspname not in ('pg_catalog','information_schema','drizzle')
     order by 2, 1`,
  );
  for (const fk of fks.rows) {
    if (fk.deltype !== "r") out.push(`${fk.src}.${fk.name}: ON DELETE is not RESTRICT`);
    const target = fk.pairs.map((p) => p.split("->")[1]).sort().join(",");
    if (
      tenantTables.has(fk.src) &&
      tenantTables.has(fk.dst) &&
      (!fk.pairs.includes("tenant_id->tenant_id") || target !== "id,tenant_id")
    ) {
      out.push(`${fk.src}.${fk.name}: not composite (tenant_id, id) key (${fk.pairs.join(", ")})`);
    }
  }
  return out;
}
