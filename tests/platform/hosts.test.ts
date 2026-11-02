// T-005: host resolver unit tests (ARCH-3, SEC-21, API-1).
import { describe, expect, it } from "vitest";
import {
  canonicalPath,
  hostConfigFromEnv,
  isPublicSitePath,
  RESERVED_SEGMENTS,
  resolveRequest,
} from "../../src/lib/hosts";

const cfg = { app: "app.example.test", booking: "booking.example.test", vendor: "vendor.example.test" };
const allowed = (host: string, path: string) => resolveRequest(cfg, host, path).allow;

const STAFF = ["/", "/saya", "/persetujuan", "/pasien/123", "/kasir", "/api/v1/staff/visits", "/api/v1/webhooks/meta",
  "/masuk", "/verifikasi", "/aktifkan-2fa", "/terkunci", "/api/auth/sign-in/email", "/api/auth/two-factor/verify-totp"];
const PUBLIC = ["/klinik-a", "/klinik-a/perawatan", "/klinik-a/perawatan/facial-dasar", "/klinik-a/booking", "/aftercare/abc", "/api/v1/public/otp", "/api/v1/webhooks/payment", "/api/v1/webhooks/payment/mock"];
const VENDOR = ["/vendor", "/vendor/tenant", "/api/v1/vendor/tenants"];

describe("host resolver", () => {
  it("app host serves staff routes and refuses public and vendor routes", () => {
    for (const p of STAFF) expect(allowed(cfg.app, p), p).toBe(true);
    for (const p of [...PUBLIC, ...VENDOR]) expect(allowed(cfg.app, p), p).toBe(false);
  });

  it("booking host serves public routes and refuses staff and vendor routes", () => {
    for (const p of PUBLIC) expect(allowed(cfg.booking, p), p).toBe(true);
    for (const p of [...STAFF, ...VENDOR]) expect(allowed(cfg.booking, p), p).toBe(false);
  });

  it("vendor host serves vendor routes only; vendor routes are refused on every other host", () => {
    for (const p of VENDOR) expect(allowed(cfg.vendor, p), p).toBe(true);
    for (const p of [...STAFF, ...PUBLIC]) expect(allowed(cfg.vendor, p), p).toBe(false);
    for (const h of [cfg.app, cfg.booking, "evil.test"]) {
      for (const p of VENDOR) expect(allowed(h, p), `${h}${p}`).toBe(false);
    }
  });

  it("refuses unknown and missing hosts, and matches hosts case-insensitively", () => {
    expect(resolveRequest(cfg, "evil.test", "/saya")).toEqual({ allow: false, reason: "unknown host" });
    expect(resolveRequest(cfg, null, "/")).toEqual({ allow: false, reason: "unknown host" });
    expect(allowed("APP.Example.Test", "/saya")).toBe(true);
  });

  it("prefixes match whole segments only", () => {
    expect(allowed(cfg.vendor, "/vendorx")).toBe(false); // not the vendor prefix
    expect(allowed(cfg.app, "/pasien-baru/x/y")).toBe(true); // not a public-site shape
    expect(allowed(cfg.booking, "/aftercare")).toBe(false); // reserved slug, no index page
    expect(allowed(cfg.booking, "/aftercare/")).toBe(false);
    expect(allowed(cfg.booking, "/aftercare/abc")).toBe(true);
    expect(allowed(cfg.booking, "/api/v1/publicx")).toBe(false);
  });

  it("serves static framework assets on every host, nothing else under /_next", () => {
    for (const h of Object.values(cfg)) expect(allowed(h, "/_next/static/chunks/a.js")).toBe(true);
    expect(allowed(cfg.booking, "/_next/image")).toBe(false);
    expect(allowed(cfg.booking, "/_next/data/x/saya.json")).toBe(false);
  });

  it("decodes once before deciding: encoded forms of other hosts' routes are refused", () => {
    for (const p of ["/%76endor", "/%76endor/tenant", "/api/v1/%76endor/tenants", "/kl%69nik-a", "/%61ftercare/x"]) {
      expect(allowed(cfg.app, p), p).toBe(false);
    }
    expect(allowed(cfg.vendor, "/%76endor")).toBe(true); // same route, right host
    expect(allowed(cfg.booking, "/%73aya")).toBe(false);
  });

  it("refuses non-canonical paths on every host", () => {
    const bad = ["//vendor", "/vendor%2Ftenant", "/x%5cvendor", "/%2576endor", "/./vendor",
      "/x/../vendor", "/%E0%A4%A", "/a%00b", "/a\\b", "x"];
    for (const p of bad) {
      expect(canonicalPath(p), p).toBeUndefined();
      for (const h of Object.values(cfg)) expect(allowed(h, p), `${h}${p}`).toBe(false);
    }
    expect(canonicalPath("/saya/")).toBe("/saya/");
  });

  it("treats case variants of another host's route as that route; ids keep their case", () => {
    for (const p of ["/Vendor", "/API/v1/vendor/x", "/Klinik-A", "/AFTERCARE/x"]) {
      expect(allowed(cfg.app, p), p).toBe(false);
    }
    expect(allowed(cfg.booking, "/SAYA")).toBe(false);
    expect(allowed(cfg.app, "/pasien/ABC123")).toBe(true);
    expect(allowed(cfg.booking, "/aftercare/Tok3nXYZ")).toBe(true);
  });

  it("public-site paths: slug rules, listed pages only, reserved slugs refused", () => {
    expect(isPublicSitePath("/klinik-a/")).toBe(true);
    expect(isPublicSitePath("/klinik-a/dokter/dr-sinta")).toBe(true);
    expect(isPublicSitePath("/klinik-a/booking/x")).toBe(false);
    expect(isPublicSitePath("/klinik-a/kasir")).toBe(false);
    expect(isPublicSitePath("/Klinik-A")).toBe(false);
    expect(isPublicSitePath("/-a")).toBe(false);
    expect(isPublicSitePath("/a/perawatan/x/y")).toBe(false);
    for (const r of RESERVED_SEGMENTS) expect(isPublicSitePath(`/${r}`), r).toBe(false);
  });

  it("every clinic-app and auth route folder (TASKS.md and src/app) is reserved", async () => {
    const { readFileSync, readdirSync, existsSync } = await import("node:fs");
    const text = readFileSync(new URL("../../TASKS.md", import.meta.url), "utf8");
    const folders = new Set([...text.matchAll(/src\/app\/\((?:app|auth)\)\/([a-z0-9-]+)\//g)].map((m) => m[1]));
    for (const group of ["(app)", "(auth)"]) {
      const dir = new URL(`../../src/app/${group}/`, import.meta.url);
      if (!existsSync(dir)) continue;
      for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) folders.add(e.name);
    }
    folders.delete("layout"); // layout file, not a segment
    expect([...folders].filter((f) => !RESERVED_SEGMENTS.has(f))).toEqual([]);
  });

  it("development-only /dev pages are refused in production on every host", () => {
    for (const h of Object.values(cfg)) {
      for (const p of ["/dev", "/dev/galeri", "/DEV/galeri"]) {
        expect(resolveRequest(cfg, h, p, true).allow, `${h}${p}`).toBe(false);
      }
    }
    expect(resolveRequest(cfg, cfg.app, "/dev/galeri", false).allow).toBe(true);
    expect(resolveRequest(cfg, cfg.booking, "/dev/galeri", false).allow).toBe(false);
  });

  it("config: required, distinct, well-formed", () => {
    expect(hostConfigFromEnv({ APP_HOST: "a.test", BOOKING_HOST: "b.test", VENDOR_HOST: "c.test:8443" })).toEqual({
      app: "a.test",
      booking: "b.test",
      vendor: "c.test:8443",
    });
    expect(() => hostConfigFromEnv({ APP_HOST: "a.test", BOOKING_HOST: "b.test" })).toThrow("VENDOR_HOST");
    expect(() => hostConfigFromEnv({ APP_HOST: "a.test", BOOKING_HOST: "a.test", VENDOR_HOST: "c.test" })).toThrow("must differ");
    expect(() => hostConfigFromEnv({ APP_HOST: "A.test", BOOKING_HOST: "b.test", VENDOR_HOST: "c.test" })).toThrow("lower-case");
  });
});
