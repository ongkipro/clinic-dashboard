// T-005 HTTP negatives: the production (standalone) Next.js server running
// src/proxy.ts. The suite runs `next build` (`next dev` would rewrite tsconfig.json),
// then copies the standalone output to a temporary directory and serves it from there,
// so a concurrent build that rewrites .next cannot break the running server. Requests carry each host's Host header; refused
// requests must get the proxy's 404 (x-host-policy: refused) before any route renders.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
const PORT = 3000 + Math.floor(Math.random() * 2000) + 1000;
const HOSTS = { app: "app.test", booking: "booking.test", vendor: "vendor.test" };
let server: ChildProcess;

async function get(
  host: string,
  path: string,
): Promise<{ status: number; refused: boolean; location?: string }> {
  const { request } = await import("node:http");
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port: PORT, path, method: "GET", headers: { host }, insecureHTTPParser: false },
      (res) => {
        res.resume();
        const out = { status: res.statusCode ?? 0, refused: res.headers["x-host-policy"] === "refused" };
        resolve(res.headers.location ? { ...out, location: res.headers.location } : out);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const NEXT = join(ROOT, "node_modules/next/dist/bin/next");
const SERVE = mkdtempSync(join(tmpdir(), "hosts-spec-"));

beforeAll(async () => {
  execFileSync(process.execPath, [NEXT, "build"], {
    cwd: ROOT,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "ignore", "inherit"],
  });
  // verbatimSymlinks keeps pnpm's relative links pointing inside the copy.
  cpSync(join(ROOT, ".next/standalone"), SERVE, { recursive: true, verbatimSymlinks: true });
  cpSync(join(ROOT, ".next/static"), join(SERVE, ".next/static"), { recursive: true, verbatimSymlinks: true });
  server = spawn(process.execPath, [join(SERVE, "server.js")], {
    cwd: SERVE,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      NODE_ENV: "production",
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
      APP_HOST: HOSTS.app,
      BOOKING_HOST: HOSTS.booking,
      VENDOR_HOST: HOSTS.vendor,
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 300; i++) {
    try {
      await get(HOSTS.app, "/");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("next start did not come up");
}, 180_000);

afterAll(async () => {
  if (server && server.exitCode === null) {
    const exited = new Promise((r) => server.once("exit", r));
    server.kill("SIGTERM");
    await exited;
  }
  rmSync(SERVE, { recursive: true, force: true });
});

describe("host isolation over HTTP (ARCH-3, SEC-21)", { timeout: 60_000 }, () => {
  it("/saya and /persetujuan are refused on the booking and vendor hosts", async () => {
    for (const host of [HOSTS.booking, HOSTS.vendor]) {
      for (const path of ["/saya", "/persetujuan", "/saya/akses-vendor"]) {
        expect(await get(host, path), `${host}${path}`).toEqual({ status: 404, refused: true });
      }
    }
  });

  it("/saya and /persetujuan pass the proxy on the app host", async () => {
    for (const path of ["/saya", "/persetujuan"]) {
      // No page exists yet, so Next answers 404 itself; the proxy must not refuse it.
      expect((await get(HOSTS.app, path)).refused, path).toBe(false);
    }
    expect(await get(HOSTS.app, "/")).toEqual({ status: 200, refused: false });
  });

  it("the auth API and sign-in screens are refused on the booking and vendor hosts", async () => {
    for (const host of [HOSTS.booking, HOSTS.vendor]) {
      for (const path of ["/api/auth/sign-in/email", "/api/auth/get-session", "/masuk", "/terkunci"]) {
        expect(await get(host, path), `${host}${path}`).toEqual({ status: 404, refused: true });
      }
    }
    expect((await get(HOSTS.app, "/masuk")).status).toBe(200);
  });

  it("public routes are refused on the app host", async () => {
    for (const path of ["/klinik-a", "/klinik-a/booking", "/aftercare/x", "/api/v1/public/otp"]) {
      expect(await get(HOSTS.app, path), path).toEqual({ status: 404, refused: true });
    }
  });

  it("vendor routes are refused on every non-vendor host", async () => {
    for (const host of [HOSTS.app, HOSTS.booking, "unknown.test"]) {
      for (const path of ["/vendor", "/vendor/tenant", "/api/v1/vendor/tenants"]) {
        expect(await get(host, path), `${host}${path}`).toEqual({ status: 404, refused: true });
      }
    }
  });

  it("encoded and non-canonical forms of vendor routes are refused on the app host", async () => {
    for (const path of ["/%76endor", "/api/v1/%76endor/x", "/Vendor", "/vendor%2Fx", "/kl%69nik-a"]) {
      expect(await get(HOSTS.app, path), path).toEqual({ status: 404, refused: true });
    }
    // Next.js collapses duplicate slashes with a redirect before the proxy runs; the
    // redirect target is then refused.
    const dup = await get(HOSTS.app, "//vendor");
    expect(dup.status).toBe(308);
    expect(await get(HOSTS.app, new URL(dup.location ?? "", "http://x").pathname)).toEqual({
      status: 404,
      refused: true,
    });
  });

  it("unknown hosts are refused for every path", async () => {
    for (const path of ["/", "/saya", "/klinik-a"]) {
      expect(await get("unknown.test", path), path).toEqual({ status: 404, refused: true });
    }
  });
});
