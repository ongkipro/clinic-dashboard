// Tenant export worker (PR-52, TEN-5, TEN-18; T-122).
// DEL-2 auto-discovered `job` surface (`src/workers/**`).
// Closes Findings #1, #2, #3, #5, #6, #7, #8, #9 of t122/PLAN-REVIEW-codex-panel3.md:
// - Runs on an unbound least-privilege clinic_app pool (never BYPASSRLS / harness superuser).
// - Claims one queued/expired-lease job with monotonic generation + DB wall-clock lease.
// - Reads all source families in ONE staffless, roleless tenant-bound REPEATABLE READ transaction.
// - Writes files fenced by (export_id, generation) + unexpired lease through ExportStore.
// - Atomically publishes canonical manifest_json + manifest_sha256 for published_generation and reclaims abandoned generations.
// - Runs bounded expiry/purge batches (ready -> expired+purged; failed -> purged keeping failed+error_code) with missed-run detection.
import type pg from "pg";
import type { KekRing } from "../lib/keys/envelope";
import { kekRing } from "../lib/keys/runtime";
import {
  assertPilotCeilings,
  buildManifest,
  ExportRuleError,
  manifestJsonString,
  sha256,
} from "../modules/export/export";
import { dbExportStore, type ExportStore } from "../modules/export/store";
import { buildTenantExportFiles, type TenantSnapshot } from "../modules/export/tenant.export";

export type ClaimedExport = {
  id: string;
  tenant_id: string;
  generation: number;
  attempts: number;
};

export type WorkerRunResult =
  | { kind: "idle" }
  | { kind: "ready"; exportId: string; tenantId: string; generation: number; fileCount: number; manifestSha256: string }
  | { kind: "failed"; exportId: string; tenantId: string; generation: number; errorCode: string };

export type ExpireBatchResult = {
  expiredReady: number;
  purgedFailed: number;
  purgedAbandonedFiles: number;
  oldestDueSeconds: number | null;
};

function normalizeErrorCode(e: unknown): string {
  if (e instanceof ExportRuleError) {
    const clean = e.reason.replace(/[^a-z0-9_]/gi, "_").toLowerCase().slice(0, 48);
    if (/^[a-z][a-z0-9_]{1,48}$/.test(clean)) return clean;
  }
  const msg = (e as { message?: string })?.message ?? "";
  if (msg.includes("tenant_closed")) return "tenant_closed";
  if (msg.includes("lease_lost")) return "lease_lost";
  return "export_build_failed";
}

export async function runExportWorkerOnce(
  pool: pg.Pool,
  opts: { leaseSeconds?: number; store?: ExportStore; kekRing?: KekRing } = {},
): Promise<WorkerRunResult> {
  const leaseSeconds = opts.leaseSeconds ?? 300;
  const store = opts.store ?? dbExportStore;

  // 1. Unbound claim (export_claim verifies all TEN-2 GUCs are empty).
  const claimClient = await pool.connect();
  let claimed: ClaimedExport | null = null;
  try {
    const res = await claimClient.query<{ r: ClaimedExport | null }>(
      `select public.export_claim($1) as r`,
      [leaseSeconds],
    );
    claimed = res.rows[0]?.r ?? null;
  } finally {
    claimClient.release();
  }
  if (!claimed) return { kind: "idle" };

  const { id: exportId, tenant_id: tenantId, generation } = claimed;

  try {
    // 2. Single consistent REPEATABLE READ READ ONLY snapshot on a staffless, roleless tenant-bound connection (Findings #1 & #2).
    const snapshot = await (async (): Promise<TenantSnapshot> => {
      const snapClient = await pool.connect();
      let broken: Error | undefined;
      const onError = (err: Error) => {
        broken ??= err;
      };
      snapClient.on("error", onError);
      try {
        try {
          await snapClient.query(`begin transaction isolation level repeatable read read only`);
          await snapClient.query(
            `select set_config('app.tenant_id', $1, true),
                    set_config('app.allowed_branch_ids', '*', true),
                    set_config('app.active_branch_id', '', true),
                    set_config('app.staff_id', '', true),
                    set_config('app.roles', '', true)`,
            [tenantId],
          );
          const r = await snapClient.query<{ s: TenantSnapshot }>(
            `select public.export_snapshot_read($1, $2) as s`,
            [exportId, generation],
          );
          await snapClient.query(`commit`);
          return r.rows[0].s;
        } catch (err) {
          await snapClient.query(`rollback`).catch((rb: Error) => {
            broken = rb;
          });
          throw err;
        }
      } finally {
        snapClient.removeListener("error", onError);
        snapClient.release(broken);
      }
    })();

    // 3. Build files & check pilot ceilings OUTSIDE any DB lock (Findings #3, #7, R3 P1-1 runtime key ring).
    const ring = opts.kekRing ?? kekRing() ?? undefined;
    const files = buildTenantExportFiles(snapshot, { kekRing: ring });
    assertPilotCeilings(files);

    // 4. Persist each file fenced by (exportId, generation) + live lease on unbound connection (Finding #2).
    const putClient = await pool.connect();
    try {
      for (const f of files) {
        await store.put(putClient, {
          exportId,
          generation,
          path: f.path,
          kind: f.kind,
          bytes: f.bytes,
        });
      }

      // 5. Commit canonical manifest + published_generation atomically under tenant lock -> row lock (DB wall clock, R3 P2-3).
      const completedAt = (await putClient.query<{ now: Date }>(`select clock_timestamp() as now`)).rows[0].now;
      const manifest = buildManifest({ tenantId, exportId, generation, completedAt, files });
      const manifestJson = manifestJsonString(manifest);
      const manifestSha = sha256(manifestJson);

      await putClient.query(`select public.export_finish($1, $2, $3, $4, $5)`, [
        exportId,
        generation,
        completedAt,
        manifestJson,
        manifestSha,
      ]);

      return {
        kind: "ready",
        exportId,
        tenantId,
        generation,
        fileCount: files.length,
        manifestSha256: manifestSha,
      };
    } finally {
      putClient.release();
    }
  } catch (e) {
    const code = normalizeErrorCode(e);
    const failClient = await pool.connect();
    try {
      await failClient.query(`select public.export_fail($1, $2, $3)`, [exportId, generation, code]);
    } catch {
      // If lease was already lost to a newer generation, export_fail cleanly refuses; do not mask.
    } finally {
      failClient.release();
    }
    return { kind: "failed", exportId, tenantId, generation, errorCode: code };
  }
}

// Bounded purge & missed-run detector (Finding #5): purges ready exports past expires_at (-> expired),
// failed exports past requested_at+24h (keeps failed+error_code, stamps purged_at), and abandoned bytes.
export async function runExportExpireBatch(
  pool: pg.Pool,
  opts: { limit?: number } = {},
): Promise<ExpireBatchResult> {
  const client = await pool.connect();
  try {
    const r = (
      await client.query<{
        r: {
          expired_ready: number;
          purged_failed: number;
          purged_abandoned_files: number;
          oldest_due_seconds: number | null;
        };
      }>(`select public.export_expire($1) as r`, [opts.limit ?? 50])
    ).rows[0].r;
    return {
      expiredReady: Number(r.expired_ready ?? 0),
      purgedFailed: Number(r.purged_failed ?? 0),
      purgedAbandonedFiles: Number(r.purged_abandoned_files ?? 0),
      oldestDueSeconds: r.oldest_due_seconds == null ? null : Number(r.oldest_due_seconds),
    };
  } finally {
    client.release();
  }
}
