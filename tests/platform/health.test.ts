// OBS-3 health probe tests (OBSERVABILITY.md): verifies database readiness probe against
// a real PostgreSQL clinic_app role, timeout/failure handling without leaking details, and
// zero tenant-table access.
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openAppPool } from "../../src/db/rls/pool";
import { probeDatabase } from "../../src/app/api/health/db/check";
import { createHarness, type Harness } from "../rls/harness";

let h: Harness;
let appPool: pg.Pool;

beforeAll(async () => {
  h = await createHarness();
  const appRole = await h.createLoginRole("NOSUPERUSER NOBYPASSRLS", ["clinic_app"]);
  appPool = await openAppPool({ connectionString: h.urlAs(appRole), max: 2 });
}, 120_000);

afterAll(async () => {
  await appPool?.end();
  await h?.close();
}, 60_000);

describe("database health probe (OBS-3)", () => {
  it("returns ok: true on a healthy unbound clinic_app pool", async () => {
    await expect(probeDatabase(async () => appPool)).resolves.toEqual({ ok: true });
  });

  it("returns ok: false cleanly when pool creation rejects without leaking error text", async () => {
    const res = await probeDatabase(async () => {
      throw new Error("postgres://secret:password@db.internal:5432/prod");
    });
    expect(res).toEqual({ ok: false });
    expect(JSON.stringify(res)).not.toContain("secret");
  });

  it("returns ok: false on timeout and releases late-resolving clients", async () => {
    let released = false;
    const fakePool = {
      connect: () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              release: () => {
                released = true;
              },
            });
          }, 220);
        }),
    } as unknown as pg.Pool;

    const res = await probeDatabase(async () => fakePool, 100);
    expect(res).toEqual({ ok: false });
    await new Promise((r) => setTimeout(r, 200));
    expect(released).toBe(true);
  });

  it("returns ok: false when SELECT fails and discards the client without blocking on a wedged ROLLBACK", async () => {
    let releasedArg: unknown = "not-called";
    let queryCount = 0;
    const fakePool = {
      connect: async () => ({
        on: () => {},
        removeListener: () => {},
        query: async () => {
          queryCount++;
          if (queryCount === 1) throw new Error("connection terminated unexpectedly");
          // A subsequent ROLLBACK call must never be awaited on a failed socket.
          return await new Promise(() => {});
        },
        release: (arg?: unknown) => {
          releasedArg = arg;
        },
      }),
    } as unknown as pg.Pool;

    const started = Date.now();
    await expect(probeDatabase(async () => fakePool, 500)).resolves.toEqual({ ok: false });
    expect(Date.now() - started).toBeLessThan(300);
    expect(queryCount).toBe(1);
    expect(releasedArg).toBeInstanceOf(Error);
  });
});
