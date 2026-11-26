// Background worker scheduler tests (DEL-4, OBS-3, T-122, T-126):
// verifies config clamping, full real-PostgreSQL cycle execution across fast/maintenance/daily
// phases as clinic_app, interval gating, atomic heartbeat writing, fault isolation, and loop abort.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openAppPool } from "../../src/db/rls/pool";
import {
  clearHeartbeat,
  parseWorkerConfig,
  runWorkerCycle,
  runWorkerLoop,
  writeHeartbeat,
} from "../../src/workers/runner";
import { createHarness, type Harness } from "../rls/harness";

let h: Harness;
let appPool: pg.Pool;
let tempDir: string;

beforeAll(async () => {
  h = await createHarness();
  const appRole = await h.createLoginRole("NOSUPERUSER NOBYPASSRLS", ["clinic_app"]);
  appPool = await openAppPool({ connectionString: h.urlAs(appRole), max: 4 });
  tempDir = mkdtempSync(join(tmpdir(), "worker-runner-test-"));
}, 120_000);

afterAll(async () => {
  await appPool?.end();
  await h?.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
}, 60_000);

describe("background worker scheduler (DEL-4, OBS-3)", () => {
  it("clamps configuration intervals and bounds safely", () => {
    const defaults = parseWorkerConfig({});
    expect(defaults.fastIntervalMs).toBe(15_000);
    expect(defaults.maintenanceIntervalMs).toBe(300_000);
    expect(defaults.dailyIntervalMs).toBe(3_600_000);
    expect(defaults.heartbeatFile).toBe("/tmp/clinic-worker-heartbeat.json");
    expect(defaults.runOnce).toBe(false);

    const clamped = parseWorkerConfig({
      WORKER_ID: "w-1",
      WORKER_FAST_INTERVAL_MS: "10",
      WORKER_MAINTENANCE_INTERVAL_MS: "999999999",
      WORKER_DAILY_INTERVAL_MS: "not-a-number",
      WORKER_MAX_EXPORTS_PER_TICK: "999",
      WORKER_HEARTBEAT_FILE: " ",
      WORKER_ONCE: "1",
    });
    expect(clamped.workerId).toBe("w-1");
    expect(clamped.fastIntervalMs).toBe(1_000);
    expect(clamped.maintenanceIntervalMs).toBe(3_600_000);
    expect(clamped.dailyIntervalMs).toBe(3_600_000);
    expect(clamped.maxExportsPerTick).toBe(50);
    expect(clamped.heartbeatFile).toBeNull();
    expect(clamped.runOnce).toBe(true);
  });

  it("executes all fast, maintenance, and daily jobs cleanly on an unbound clinic_app pool and respects intervals", async () => {
    const cfg = parseWorkerConfig({ WORKER_ID: "test-worker", WORKER_HEARTBEAT_FILE: "" });
    const state = { tick: 0, lastMaintenanceAt: 0, lastDailyAt: 0 };
    const t0 = Date.UTC(2026, 10, 27, 2, 0, 0);

    const first = await runWorkerCycle(appPool, cfg, { ...state, nowMs: t0 });
    expect(first.fastOk).toBe(true);
    expect(first.errors).toEqual([]);
    expect(first.maintenanceRan).toBe(true);
    expect(first.dailyRan).toBe(true);
    expect(first.tick).toBe(1);

    // Next tick 15s later runs fast jobs only; maintenance & daily are skipped until due.
    const second = await runWorkerCycle(appPool, cfg, {
      tick: first.tick,
      lastMaintenanceAt: t0,
      lastDailyAt: t0,
      nowMs: t0 + 15_000,
    });
    expect(second.fastOk).toBe(true);
    expect(second.errors).toEqual([]);
    expect(second.maintenanceRan).toBe(false);
    expect(second.dailyRan).toBe(false);
    expect(second.tick).toBe(2);

    // After 5 min, maintenance runs again while daily waits for 1 h.
    const third = await runWorkerCycle(appPool, cfg, {
      tick: second.tick,
      lastMaintenanceAt: t0,
      lastDailyAt: t0,
      nowMs: t0 + 300_000,
    });
    expect(third.fastOk).toBe(true);
    expect(third.errors).toEqual([]);
    expect(third.maintenanceRan).toBe(true);
    expect(third.dailyRan).toBe(false);
  });

  it("writes an atomic JSON heartbeat in daemon mode and exits cleanly without leaving a liveness file in runOnce mode", async () => {
    const hbPath = join(tempDir, "hb.json");
    const daemonCfg = parseWorkerConfig({
      WORKER_ID: "daemon-worker",
      WORKER_HEARTBEAT_FILE: hbPath,
      WORKER_FAST_INTERVAL_MS: "1000",
    });

    const ac = new AbortController();
    await runWorkerLoop(appPool, daemonCfg, {
      signal: ac.signal,
      onCycle: () => ac.abort(),
    });
    const hb = JSON.parse(readFileSync(hbPath, "utf8")) as {
      ok: boolean;
      worker: string;
      pid: number;
      at: string;
      tick: number;
      errors: string[];
    };
    expect(hb.ok).toBe(true);
    expect(hb.worker).toBe("daemon-worker");
    expect(hb.pid).toBe(process.pid);
    expect(hb.tick).toBe(1);
    expect(hb.errors).toEqual([]);
    expect(Number.isFinite(Date.parse(hb.at))).toBe(true);

    // One-shot run ignores WORKER_HEARTBEAT_FILE so running WORKER_ONCE=1 via docker exec never disturbs a live daemon's heartbeat.
    const beforeRaw = readFileSync(hbPath, "utf8");
    const onceCfg = parseWorkerConfig({
      WORKER_ID: "once-worker",
      WORKER_HEARTBEAT_FILE: hbPath,
      WORKER_ONCE: "1",
    });
    expect(onceCfg.heartbeatFile).toBeNull();
    const summary = await runWorkerLoop(appPool, onceCfg);
    expect(summary?.ok).toBe(true);
    expect(readFileSync(hbPath, "utf8")).toBe(beforeRaw);
  });

  it("isolates job failures, clears stale heartbeats on startup, and marks ok=false on maintenance/daily/outbox failures without advancing retry timestamps", async () => {
    const hbPath = join(tempDir, "hb-fail.json");
    writeHeartbeat(hbPath, { ok: true, worker: "stale-prev", pid: 1, at: new Date().toISOString(), tick: 99, errors: [] });
    expect(existsSync(hbPath)).toBe(true);

    // 1. Stale heartbeat from an earlier restart is cleared immediately before first cycle finishes,
    //    and daemon mode writes ok=false when the database is unreachable.
    let staleSeenDuringFirstQuery: boolean | null = null;
    const brokenPool = {
      connect: async () => {
        staleSeenDuringFirstQuery ??= existsSync(hbPath);
        const err = new Error("connection refused") as Error & { code: string };
        err.code = "ECONNREFUSED";
        throw err;
      },
      query: async () => {
        staleSeenDuringFirstQuery ??= existsSync(hbPath);
        const err = new Error("connection refused") as Error & { code: string };
        err.code = "ECONNREFUSED";
        throw err;
      },
    } as unknown as pg.Pool;

    const cfg = parseWorkerConfig({
      WORKER_ID: "broken-worker",
      WORKER_HEARTBEAT_FILE: hbPath,
    });
    const ac = new AbortController();
    await runWorkerLoop(brokenPool, cfg, { signal: ac.signal, onCycle: () => ac.abort() });
    expect(staleSeenDuringFirstQuery).toBe(false);
    const hb = JSON.parse(readFileSync(hbPath, "utf8")) as { ok: boolean; errors: string[] };
    expect(hb.ok).toBe(false);
    expect(hb.errors.length).toBeGreaterThan(0);
    expect(hb.errors.some((e) => e.startsWith("outbox.ledger:"))).toBe(true);

    // One-shot mode still calls onCycle (so CLI emits ok:false summary) before throwing and leaves any daemon heartbeat untouched.
    const beforeFailRaw = readFileSync(hbPath, "utf8");
    let seenFailSummary: { ok: boolean; errors: unknown[] } | null = null;
    await expect(
      runWorkerLoop(
        brokenPool,
        parseWorkerConfig({ WORKER_ID: "broken-once", WORKER_HEARTBEAT_FILE: hbPath, WORKER_ONCE: "1" }),
        {
          onCycle: (s) => {
            seenFailSummary = { ok: s.ok, errors: s.errors };
          },
        },
      ),
    ).rejects.toThrow("worker_once_failed");
    expect(seenFailSummary).not.toBeNull();
    expect(seenFailSummary!.ok).toBe(false);
    expect(seenFailSummary!.errors.length).toBeGreaterThan(0);
    expect(readFileSync(hbPath, "utf8")).toBe(beforeFailRaw);

    // 2. Maintenance failure keeps ok=false and does NOT advance lastMaintenanceAt so the next tick retries it.
    let failPurge = true;
    const partialPool = {
      connect: async () => {
        const real = await appPool.connect();
        const origQuery = real.query.bind(real);
        const wrapped = Object.create(real);
        wrapped.query = (sql: unknown, params?: unknown[]) => {
          if (failPurge && typeof sql === "string" && sql.includes("public_booking_purge_expired")) {
            const err = new Error("transient_purge_err") as Error & { code: string };
            err.code = "57014";
            return Promise.reject(err);
          }
          return origQuery(sql as string, params);
        };
        return wrapped;
      },
      query: (sql: unknown, params?: unknown[]) => appPool.query(sql as string, params),
    } as unknown as pg.Pool;

    const retryCfg = parseWorkerConfig({ WORKER_ID: "retry-worker", WORKER_HEARTBEAT_FILE: "" });
    const t0 = Date.UTC(2026, 10, 27, 4, 0, 0);
    const state = { tick: 0, lastMaintenanceAt: 0, lastDailyAt: 0 };
    const r1 = await runWorkerCycle(partialPool, retryCfg, { ...state, nowMs: t0 });
    expect(r1.fastOk).toBe(true);
    expect(r1.maintenanceOk).toBe(false);
    expect(r1.ok).toBe(false);
    expect(r1.errors).toEqual([{ phase: "maintenance", job: "public_booking.purge", code: "57014" }]);

    // Since maintenance failed, state.lastMaintenanceAt stays 0 and the very next tick 15 s later retries it.
    failPurge = false;
    const nextState = {
      tick: r1.tick,
      lastMaintenanceAt: r1.maintenanceOk ? t0 : 0,
      lastDailyAt: r1.dailyOk ? t0 : 0,
      nowMs: t0 + 15_000,
    };
    const r2 = await runWorkerCycle(partialPool, retryCfg, nextState);
    expect(r2.maintenanceRan).toBe(true);
    expect(r2.maintenanceOk).toBe(true);
    expect(r2.dailyRan).toBe(false);
    expect(r2.ok).toBe(true);

    clearHeartbeat(hbPath);
    expect(existsSync(hbPath)).toBe(false);
  });

  it("marks ok=false and fastOk=false when runOutboxBatch reports consumer failed > 0 without throwing", async () => {
    const tenantId = (
      await h.admin.query<{ id: string }>(
        `INSERT INTO public.tenants_registry (lifecycle_state) VALUES ('live') RETURNING id`,
      )
    ).rows[0].id;
    await h.admin.query(
      `INSERT INTO public.tenants (id, legal_name, sak_framework) VALUES ($1, 'PT Worker Outbox Fail', 'emkm')`,
      [tenantId],
    );
    const aggId = crypto.randomUUID();
    await h.admin.query(
      `INSERT INTO public.domain_events (tenant_id, type, version, aggregate_kind, aggregate_id, aggregate_version, correlation_id, payload)
       VALUES ($1, 'InvoiceIssued', 1, 'invoice', $2::uuid, 1, gen_random_uuid(), jsonb_build_object('invoice_id', $3::text))`,
      [tenantId, aggId, aggId],
    );

    const outboxFailPool = {
      connect: async () => {
        const real = await appPool.connect();
        const origQuery = real.query.bind(real);
        const wrapped = Object.create(real);
        wrapped.query = (sql: unknown, params?: unknown[]) => {
          if (typeof sql === "string" && sql.includes("ledger_post_event")) {
            const err = new Error("simulated_consumer_failure") as Error & { code: string };
            err.code = "P0001";
            return Promise.reject(err);
          }
          return origQuery(sql as string, params);
        };
        return wrapped;
      },
      query: (sql: unknown, params?: unknown[]) => appPool.query(sql as string, params),
    } as unknown as pg.Pool;

    const cfg = parseWorkerConfig({ WORKER_ID: "outbox-fail-worker", WORKER_HEARTBEAT_FILE: "" });
    const res = await runWorkerCycle(outboxFailPool, cfg, {
      tick: 0,
      lastMaintenanceAt: Date.now(),
      lastDailyAt: Date.now(),
    });
    expect(res.outboxFailed).toBe(1);
    expect(res.fastOk).toBe(false);
    expect(res.ok).toBe(false);
    expect(res.errors).toContainEqual({ phase: "fast", job: "outbox.ledger", code: "consumer_failed" });
  });
});
