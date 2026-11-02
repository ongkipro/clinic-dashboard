// TEN-3 / TEN-19: one row per relation (table, partitioned table, view, materialized
// view, foreign table), classifying it into exactly one policy kind. Every migration that
// creates a relation inserts its row; tests/rls fails on a missing, duplicated or stale
// row. Relations in the tool-owned `drizzle` schema are excluded. The table is created by
// migration 0002 because T-002 shipped the first migrations (DEC-007).
import { sql } from "drizzle-orm";
import { check, pgTable, text } from "drizzle-orm/pg-core";

export const policyKinds = [
  "tenant-shared",
  "clinical",
  "branch-scoped",
  "tenant-ledger",
  "platform",
] as const;
export type PolicyKind = (typeof policyKinds)[number];

export const scopeMap = pgTable("scope_map", {
  // Always `schema.relation` (nspname || '.' || relname), independent of search_path.
  tableName: text("table_name").primaryKey(),
  policyKind: text("policy_kind", { enum: policyKinds }).notNull(),
  owningModule: text("owning_module").notNull(),
  // Acting roles allowed to read (TEN-18). `*` = any member of the tenant until T-029
  // generates readers from the 07 matrix; empty for platform tables.
  readerRoles: text("reader_roles").array().notNull(),
  writerService: text("writer_service").notNull(),
  branchSemantics: text("branch_semantics").notNull(),
}, (t) => [
  check(
    "scope_map_policy_kind_check",
    sql`${t.policyKind} in ('tenant-shared','clinical','branch-scoped','tenant-ledger','platform')`,
  ),
]);

export type ScopeEntry = { tableName: string; policyKind: string };

// Pure check so "classified twice" can be proven even though the table's primary key
// already prevents it in the database.
export function scopeMapViolations(
  physicalTables: readonly string[],
  entries: readonly ScopeEntry[],
): string[] {
  const out: string[] = [];
  const seen = new Map<string, number>();
  for (const e of entries) seen.set(e.tableName, (seen.get(e.tableName) ?? 0) + 1);
  const physical = new Set(physicalTables);
  for (const t of physicalTables) if (!seen.has(t)) out.push(`${t}: missing from scope_map`);
  for (const [t, n] of seen) {
    if (n > 1) out.push(`${t}: classified ${n} times`);
    if (!physical.has(t)) out.push(`${t}: scope_map row for a table that does not exist`);
  }
  for (const e of entries) {
    if (!(policyKinds as readonly string[]).includes(e.policyKind)) {
      out.push(`${e.tableName}: unknown policy kind ${e.policyKind}`);
    }
  }
  return out.sort();
}
