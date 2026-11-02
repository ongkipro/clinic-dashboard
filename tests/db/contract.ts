// 05 §3.1 constraint contract checker. Returns human-readable violations so a test can
// prove both that the real schema is clean and that the checker catches bad fixtures.
import type pg from "pg";

// Platform tables (policy kind `platform`, TEN-16) and the tenant root. Every other table
// must be a tenant table. T-003 replaces this list with `scope_map`.
export const PLATFORM_TABLES = new Set(["tenants_registry", "tenants"]);

const USER_TABLES = `
  select n.nspname as schema, c.relname as table, c.oid::regclass::text as qualified,
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
  const tenantTables = new Set<string>();

  for (const t of tables) {
    if (t.schema === "public" && PLATFORM_TABLES.has(t.table)) continue;
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
       from pg_constraint k where k.conrelid = $1::regclass and k.contype in ('u','p')`,
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
    `select k.conname as name, k.conrelid::regclass::text as src,
            k.confrelid::regclass::text as dst, k.confdeltype as deltype,
            array(select sa.attname::text || '->' || da.attname::text
                  from unnest(k.conkey, k.confkey) u(c, rc)
                  join pg_attribute sa on sa.attrelid = k.conrelid and sa.attnum = u.c
                  join pg_attribute da on da.attrelid = k.confrelid and da.attnum = u.rc) as pairs
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
