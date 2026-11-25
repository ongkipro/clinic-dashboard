// DEL-2 cross-tenant negative cases for T-128 opening-data import (PR-85, DATA-58).
// Covers: /pasien/impor (route), app/(app)/pasien/impor/actions (action), modules/import/dry-run.export (export).
import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";
import { withTenantContext } from "../../../src/db/rls/context";
import type { Json } from "../../../src/lib/command";
import {
  approveImportBatch,
  dryRunValidateImport,
  formatDryRunReconciliationCsv,
  listImportBatches,
} from "../../../src/modules/import";
import { assignRole, createMembership } from "../../../src/modules/org/identity";
import { defineCases, type IsolationEnv } from "../case";

const asJson = (v: unknown): Json => JSON.parse(JSON.stringify(v)) as Json;
const owners = new Map<string, string>();
const victimBatches = new Map<string, { batchId: string; manifestSha: string }>();

async function ensureImportOwner(env: IsolationEnv, tenantId: string): Promise<string> {
  const cached = owners.get(tenantId);
  if (cached) return cached;
  const existing = (
    await env.owner.query<{ staff_id: string }>(
      `select s.id as staff_id
         from staff s
         join staff_roles sr on sr.tenant_id = s.tenant_id and sr.staff_id = s.id and sr.role = 'owner'
        where s.tenant_id = $1 limit 1`,
      [tenantId],
    )
  ).rows[0];
  if (existing) {
    owners.set(tenantId, existing.staff_id);
    return existing.staff_id;
  }
  const acc = (
    await env.owner.query<{ id: string }>(
      `insert into auth_user (name, email, two_factor_enabled) values ('Owner Impor', $1, true) returning id`,
      [`owner-impor-${tenantId}@iso.test`],
    )
  ).rows[0].id;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: "Owner Impor" });
  const c = await env.owner.connect();
  try {
    await assignRole(c, { tenantId, staffId, role: "owner" });
  } finally {
    c.release();
  }
  owners.set(tenantId, staffId);
  return staffId;
}

async function asImportOwner<R>(env: IsolationEnv, tenantId: string, fn: (db: pg.ClientBase) => Promise<R>): Promise<R> {
  const staffId = await ensureImportOwner(env, tenantId);
  return withTenantContext(env.app, { tenantId, staffId, roles: ["owner"], allowedBranchIds: "*" }, fn);
}

async function ensureVictimBatch(env: IsolationEnv): Promise<{ batchId: string; manifestSha: string }> {
  const cached = victimBatches.get(env.victim.tenantId);
  if (cached) return cached;
  const staffId = await ensureImportOwner(env, env.victim.tenantId);
  const manifestSha = createHash("sha256").update(`victim-import-${env.victim.tenantId}`).digest("hex");
  const { rows } = await env.owner.query<{ id: string }>(
    `insert into public.import_batches
      (tenant_id, source_system, cutover_date, state, row_count, validation_revision, validated_manifest_sha256, summary_json, staged_by, purge_after)
     values ($1, 'legacy_victim', '2026-11-25', 'validated', 1, 1, $2, '{"totalRows":1}'::jsonb, $3, clock_timestamp() + interval '7 days')
     returning id`,
    [env.victim.tenantId, manifestSha, staffId],
  );
  const entry = { batchId: rows[0].id, manifestSha };
  victimBatches.set(env.victim.tenantId, entry);
  return entry;
}

export default defineCases(
  {
    kind: "route",
    id: "/pasien/impor",
    expect: "filtered",
    marker: (env) => createHash("sha256").update(`victim-import-${env.victim.tenantId}`).digest("hex"),
    async run(env) {
      const vb = await ensureVictimBatch(env);
      env.victimSecret(vb.manifestSha);
      const list = await asImportOwner(env, env.actor.tenantId, (db) => listImportBatches(db));
      return { status: 200, body: asJson(list) };
    },
  },
  {
    kind: "action",
    id: "app/(app)/pasien/impor/actions",
    marker: (env) => createHash("sha256").update(`victim-import-${env.victim.tenantId}`).digest("hex"),
    async run(env) {
      const vb = await ensureVictimBatch(env);
      try {
        const res = await asImportOwner(env, env.actor.tenantId, (db) =>
          approveImportBatch(db, vb.batchId, 1, vb.manifestSha, { ...process.env, DEPLOY_ENV: "local" }),
        );
        return { attempts: { approve: "done" }, body: asJson({ res, manifest: vb.manifestSha }) };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        return {
          attempts: { approve: msg.includes("ERR_NOT_FOUND") ? "ERR_NOT_FOUND" : "ERR_CONFLICT" },
          body: { error: "not_found" },
        };
      }
    },
  },
  {
    kind: "export",
    id: "modules/import/dry-run.export",
    marker: (env) => createHash("sha256").update(`victim-import-${env.victim.tenantId}`).digest("hex"),
    async run(env) {
      const vb = await ensureVictimBatch(env);
      env.victimSecret(vb.manifestSha);
      const list = await asImportOwner(env, env.actor.tenantId, (db) => listImportBatches(db));
      const matched = list.find((b) => b.batchId === vb.batchId);
      const dry = dryRunValidateImport({
        tenantHmacKey: randomBytes(32),
        sourceSystem: "legacy_actor",
        cutoverDate: "2026-11-25",
        knownBranchCodes: new Set(["KMG"]),
        knownServiceCodes: new Set(["FAC-01"]),
        patients: [
          {
            externalId: "P-ISO-1",
            fullName: "Pasien Iso",
            birthDate: "1990-01-01",
            sex: "female",
            branchCode: "KMG",
          },
        ],
        packages: [],
        balances: [],
        receivables: [],
        bookingDps: [],
      });
      if (!dry.ok) return { attempts: { export: "ERR_INVALID_INPUT" }, body: asJson({ ok: false }) };
      return {
        attempts: { export: matched ? "done" : "ERR_NOT_FOUND" },
        body: asJson({
          csv: formatDryRunReconciliationCsv(dry.summary),
          matchedManifest: matched?.validatedManifestSha256 ?? null,
        }),
      };
    },
  },
);
