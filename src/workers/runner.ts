// Background worker scheduler (DEL-4, OBS-3, T-122, T-126).
// DEL-2 auto-discovered `job` surface (`src/workers/**`).
// Runs ONLY internal database jobs on an unbound least-privilege `clinic_app` pool (TEN-2):
// - Fast loop (default 15 s): domain-event outbox (ledger posting) + queued PR-52 tenant exports.
// - Maintenance loop (default 5 min): PR-52 24h export expiry/purge, PR-67 abandoned booking PII purge,
//   and internal queue-only CRM reminder / automation scans (zero live provider calls).
// - Daily loop (default 1 h; SQL scans are idempotent per business day): credential expiry alerts,
//   safety logbook due scan, package expiry settlement, instalment reminders, and CRM follow-up scan.
// Never sends live Meta WhatsApp, SATUSEHAT, AutoLaris, or email requests (AGENTS.md).
import { randomUUID } from "node:crypto";
import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import type pg from "pg";
import { openAppPool } from "../db/rls/pool";
import { kekRing } from "../lib/keys/runtime";
import { ledgerPostingConsumer } from "../modules/accounting/ledger/posting";
import { runAutomationScan } from "../modules/crm/automation/automation";
import { runFollowupScan } from "../modules/crm/followups/scan";
import { runReminderScan } from "../modules/crm/reminders/reminders";
import { runCredentialAlerts } from "../modules/org/licences/licences";
import { runPackageExpiryScan } from "../modules/packages/expiry";
import { runInstalmentReminderScan } from "../modules/packages/schedules/scan";
import { runDueScan } from "../modules/safety/safety";
import { runExportExpireBatch, runExportWorkerOnce } from "./export";
import { runOutboxBatch } from "./outbox";
import { runPublicBookingPurge } from "./public-booking-purge";

export type WorkerConfig = {
  workerId: string;
  fastIntervalMs: number;
  maintenanceIntervalMs: number;
  dailyIntervalMs: number;
  maxExportsPerTick: number;
  outboxLimit: number;
  outboxLeaseSeconds: number;
  bookingPurgeGraceMinutes: number;
  heartbeatFile: string | null;
  runOnce: boolean;
};

export type JobPhase = "fast" | "maintenance" | "daily";

export type JobErrorRecord = {
  phase: JobPhase;
  job: string;
  code: string;
};

export type CycleSummary = {
  at: string;
  tick: number;
  ok: boolean;
  fastOk: boolean;
  maintenanceOk: boolean;
  dailyOk: boolean;
  outboxDone: number;
  outboxFailed: number;
  exportsProcessed: number;
  maintenanceRan: boolean;
  dailyRan: boolean;
  errors: JobErrorRecord[];
};

export type HeartbeatPayload = {
  ok: boolean;
  worker: string;
  pid: number;
  at: string;
  tick: number;
  errors: string[];
};

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export function parseWorkerConfig(env: Partial<Record<string, string | undefined>> = process.env): WorkerConfig {
  const runOnce = env.WORKER_ONCE === "1";
  const hb = env.WORKER_HEARTBEAT_FILE;
  // One-shot runs never touch the daemon's liveness heartbeat file (even when sharing container env via docker exec).
  const heartbeatFile = runOnce ? null : hb === undefined ? "/tmp/clinic-worker-heartbeat.json" : hb.trim() || null;
  return {
    workerId: (env.WORKER_ID ?? "").trim() || `clinic-worker-${process.pid}`,
    // Clamped to <= 60 s so daemon sleep stays safely inside the 180 s container healthcheck window.
    fastIntervalMs: clampInt(env.WORKER_FAST_INTERVAL_MS, 15_000, 1_000, 60_000),
    maintenanceIntervalMs: clampInt(env.WORKER_MAINTENANCE_INTERVAL_MS, 300_000, 5_000, 3_600_000),
    dailyIntervalMs: clampInt(env.WORKER_DAILY_INTERVAL_MS, 3_600_000, 60_000, 86_400_000),
    maxExportsPerTick: clampInt(env.WORKER_MAX_EXPORTS_PER_TICK, 5, 1, 50),
    outboxLimit: clampInt(env.WORKER_OUTBOX_LIMIT, 100, 1, 500),
    outboxLeaseSeconds: clampInt(env.WORKER_OUTBOX_LEASE_SECONDS, 60, 15, 600),
    bookingPurgeGraceMinutes: clampInt(env.WORKER_BOOKING_PURGE_GRACE_MINUTES, 15, 0, 1_440),
    heartbeatFile,
    runOnce,
  };
}

function errorCodeOf(err: unknown): string {
  const pgCode = (err as { code?: unknown })?.code;
  if (typeof pgCode === "string" && /^[A-Z0-9_]{2,32}$/i.test(pgCode)) return pgCode;
  if (err instanceof Error && /^[A-Za-z0-9_]{2,48}$/.test(err.name)) return err.name;
  return "worker_job_failed";
}

async function safeJob<T>(
  workerId: string,
  phase: JobPhase,
  job: string,
  errors: JobErrorRecord[],
  fn: () => Promise<T>,
): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    const code = errorCodeOf(err);
    errors.push({ phase, job, code });
    // OBS-1 / SEC-2: IDs and error codes only — never payloads, messages, SQL params, or PII.
    console.error("worker: job failed", { worker: workerId, phase, job, code });
    return null;
  }
}

export async function runWorkerCycle(
  pool: pg.Pool,
  cfg: WorkerConfig,
  state: {
    tick: number;
    lastMaintenanceAt: number;
    lastDailyAt: number;
    nowMs?: number;
    forceAll?: boolean;
  },
): Promise<CycleSummary> {
  const nowMs = state.nowMs ?? Date.now();
  const errors: JobErrorRecord[] = [];
  let outboxDone = 0;
  let outboxFailed = 0;
  let exportsProcessed = 0;

  // 1. Fast jobs (every tick): ledger posting outbox + queued tenant exports.
  const outboxRes = await safeJob(cfg.workerId, "fast", "outbox.ledger", errors, () =>
    runOutboxBatch(pool, [ledgerPostingConsumer], {
      worker: cfg.workerId,
      limit: cfg.outboxLimit,
      leaseSeconds: cfg.outboxLeaseSeconds,
    }),
  );
  if (outboxRes) {
    for (const r of outboxRes) {
      outboxDone += r.done;
      outboxFailed += r.failed;
    }
    if (outboxFailed > 0) {
      errors.push({ phase: "fast", job: "outbox.ledger", code: "consumer_failed" });
    }
  }

  await safeJob(cfg.workerId, "fast", "export.build", errors, async () => {
    for (let i = 0; i < cfg.maxExportsPerTick; i++) {
      const res = await runExportWorkerOnce(pool);
      if (res.kind === "idle") break;
      exportsProcessed++;
    }
  });

  // 2. Maintenance jobs (default every 5 min): retention purges & internal queue scans.
  //    Timestamp advances ONLY when every maintenance job succeeds, so failures retry on the next tick.
  const runMaintenance =
    state.forceAll === true || state.lastMaintenanceAt === 0 || nowMs - state.lastMaintenanceAt >= cfg.maintenanceIntervalMs;
  if (runMaintenance) {
    await safeJob(cfg.workerId, "maintenance", "export.expire", errors, () => runExportExpireBatch(pool, { limit: 50 }));
    await safeJob(cfg.workerId, "maintenance", "public_booking.purge", errors, () =>
      runPublicBookingPurge(pool, { graceMinutes: cfg.bookingPurgeGraceMinutes }),
    );
    await safeJob(cfg.workerId, "maintenance", "crm.reminders", errors, () => runReminderScan(pool));
    await safeJob(cfg.workerId, "maintenance", "crm.automation", errors, () => runAutomationScan(pool));
  }

  // 3. Daily idempotent scans (default every 1 h): credentials, safety logbooks, packages, instalments, follow-ups.
  //    Timestamp advances ONLY when every daily scan succeeds, so failures retry on the next tick.
  const runDaily = state.forceAll === true || state.lastDailyAt === 0 || nowMs - state.lastDailyAt >= cfg.dailyIntervalMs;
  if (runDaily) {
    await safeJob(cfg.workerId, "daily", "org.credentials", errors, () => runCredentialAlerts(pool));
    await safeJob(cfg.workerId, "daily", "safety.logbook", errors, () => runDueScan(pool));
    await safeJob(cfg.workerId, "daily", "packages.expiry", errors, () => runPackageExpiryScan(pool));
    await safeJob(cfg.workerId, "daily", "packages.instalments", errors, () => runInstalmentReminderScan(pool));
    await safeJob(cfg.workerId, "daily", "crm.followups", errors, () => runFollowupScan(pool));
  }

  const fastOk = !errors.some((e) => e.phase === "fast");
  const maintenanceOk = !errors.some((e) => e.phase === "maintenance");
  const dailyOk = !errors.some((e) => e.phase === "daily");
  if (runMaintenance && maintenanceOk) state.lastMaintenanceAt = nowMs;
  if (runDaily && dailyOk) state.lastDailyAt = nowMs;

  state.tick += 1;
  const ok = fastOk && maintenanceOk && dailyOk;
  return {
    at: new Date(nowMs).toISOString(),
    tick: state.tick,
    ok,
    fastOk,
    maintenanceOk,
    dailyOk,
    outboxDone,
    outboxFailed,
    exportsProcessed,
    maintenanceRan: runMaintenance,
    dailyRan: runDaily,
    errors,
  };
}

export function clearHeartbeat(filePath: string | null): void {
  if (!filePath) return;
  try {
    unlinkSync(filePath);
  } catch (err) {
    if ((err as { code?: string })?.code !== "ENOENT") {
      console.error("worker: heartbeat clear failed", { code: errorCodeOf(err) });
    }
  }
}

export function writeHeartbeat(filePath: string, payload: HeartbeatPayload): void {
  const tmp = `${filePath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(payload)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, filePath);
}

export async function runWorkerLoop(
  pool: pg.Pool,
  cfg: WorkerConfig,
  opts: { signal?: AbortSignal; onCycle?: (summary: CycleSummary) => void } = {},
): Promise<CycleSummary | null> {
  // Invalidate any stale heartbeat persisted from an earlier container incarnation before the first cycle completes.
  clearHeartbeat(cfg.heartbeatFile);

  const state = { tick: 0, lastMaintenanceAt: 0, lastDailyAt: 0 };
  let lastSummary: CycleSummary | null = null;
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      if (opts.signal?.aborted) return resolve();
      const onAbort = () => {
        clearTimeout(t);
        resolve();
      };
      const t = setTimeout(() => {
        opts.signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      opts.signal?.addEventListener("abort", onAbort, { once: true });
    });

  while (!opts.signal?.aborted) {
    const summary = await runWorkerCycle(pool, cfg, { ...state, forceAll: cfg.runOnce });
    lastSummary = summary;
    state.tick = summary.tick;
    if (summary.maintenanceRan && summary.maintenanceOk) state.lastMaintenanceAt = Date.parse(summary.at);
    if (summary.dailyRan && summary.dailyOk) state.lastDailyAt = Date.parse(summary.at);

    // Liveness heartbeat is only for long-running daemon mode; one-shot runs report via exit code + stdout summary.
    // Use publication wall-clock time (after cycle completes) so a long successful cycle never publishes an expired timestamp.
    if (!cfg.runOnce && cfg.heartbeatFile) {
      try {
        writeHeartbeat(cfg.heartbeatFile, {
          ok: summary.ok,
          worker: cfg.workerId,
          pid: process.pid,
          at: new Date().toISOString(),
          tick: summary.tick,
          errors: summary.errors.map((e) => `${e.job}:${e.code}`),
        });
      } catch (err) {
        console.error("worker: heartbeat write failed", { worker: cfg.workerId, code: errorCodeOf(err) });
      }
    }

    opts.onCycle?.(summary);

    if (cfg.runOnce) {
      if (!summary.ok) {
        throw new Error("worker_once_failed");
      }
      return summary;
    }
    await sleep(cfg.fastIntervalMs);
  }
  return lastSummary;
}

async function main(): Promise<void> {
  const cfg = parseWorkerConfig(process.env);
  // Clear any leftover heartbeat from a prior container restart BEFORE config/KEK/DB startup so
  // healthchecks never falsely treat a wedged restart as healthy.
  clearHeartbeat(cfg.heartbeatFile);

  const url = process.env.APP_DATABASE_URL;
  if (!url) {
    throw new Error("APP_DATABASE_URL is required for worker");
  }
  // Fail fast if KEK_FILE is configured with broken custody/permissions (ARCH-7).
  kekRing();
  const pool = await openAppPool({ connectionString: url, max: 4 });
  const ac = new AbortController();
  const stop = () => ac.abort();
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  console.log(
    JSON.stringify({
      event: "worker_started",
      worker: cfg.workerId,
      fastIntervalMs: cfg.fastIntervalMs,
      maintenanceIntervalMs: cfg.maintenanceIntervalMs,
      dailyIntervalMs: cfg.dailyIntervalMs,
      runOnce: cfg.runOnce,
    }),
  );

  try {
    await runWorkerLoop(pool, cfg, {
      signal: ac.signal,
      onCycle: cfg.runOnce
        ? (summary) => {
            console.log(
              JSON.stringify({
                event: "worker_once_done",
                worker: cfg.workerId,
                tick: summary.tick,
                ok: summary.ok,
                outboxDone: summary.outboxDone,
                outboxFailed: summary.outboxFailed,
                exportsProcessed: summary.exportsProcessed,
                errors: summary.errors.map((e) => `${e.job}:${e.code}`),
              }),
            );
          }
        : undefined,
    });
  } finally {
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
    clearHeartbeat(cfg.heartbeatFile);
    await pool.end();
    console.log(JSON.stringify({ event: "worker_stopped", worker: cfg.workerId }));
  }
}

// Run when invoked directly via `node .../workers/runner.js` (CommonJS built target or direct CLI).
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  main().catch((err) => {
    console.error("worker: fatal", { code: errorCodeOf(err) });
    process.exitCode = 1;
  });
}
