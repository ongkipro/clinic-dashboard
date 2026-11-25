// Consolidated DEC-117 regression suite covering verified findings across System Map Rows 1–10 & 12
// (Row 11 was closed in T-128 R3 r10 APPROVE).
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { sessionGate } from "../../src/auth/policy";
import { createAuth } from "../../src/auth/server";
import { AUTH_GROUP_ROLE } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { isSameBookingOrigin } from "../../src/lib/public-origin";
import { isCalendarDate } from "../../src/modules/accounting/ledger/ledger";
import { reconcile } from "../../src/modules/accounting/recon/recon";
import { allocate } from "../../src/modules/cashier/allocation";
import { measureLineWidthPt, PDF_MAX_LINE_PT, renderPdf } from "../../src/modules/clinical/records/pdf";
import { otpHashOf, hashOf } from "../../src/modules/crm/aftercare/aftercare";
import { buildManifest, MAX_FILE_BYTES } from "../../src/modules/export/export";
import { buildTenantExportFiles, type TenantSnapshot } from "../../src/modules/export/tenant.export";
import { runOutboundDispatch } from "../../src/modules/messaging/outbound/outbound";
import { evaluateGate, type GateInput } from "../../src/modules/platform/residency/gate";
import { deployedLocations, envKey, type StorageKind } from "../../src/modules/platform/residency/config";
import { checkText, computeArtifactDigest } from "../../src/modules/public-site/rules/rules";
import { applyLiveBranchOverlay, buildPublicSiteDto } from "../../src/modules/public-site/snapshot";
import { k20 } from "../../src/modules/reporting/reports/calculators";
import { fromKpi } from "../../src/modules/reporting/reports/live";
import { proxy } from "../../src/proxy";
import { MigrationDriftError, runMigrations } from "../../src/db/migrate";
import { createHarness } from "../rls/harness";

describe("DEC-117 consolidated security & correctness regressions (Rows 1–10 & 12)", () => {
  // ── Row 1: Hosts & Proxy ─────────────────────────────────────────────────────────────────────
  it("Row 1 P1+P2: BOOKING_HOST blocks Next-Action & non-API POSTs; VENDOR_HOST rejects application/json-seq", async () => {
    const reqAction = new NextRequest("http://booking.localhost:3000/klinik-demo", {
      method: "POST",
      headers: {
        host: "booking.localhost:3000",
        "next-action": "deadbeef0123456789",
        "content-type": "text/plain;charset=UTF-8",
      },
    });
    expect((await proxy(reqAction)).status).toBe(404);

    const reqFormPost = new NextRequest("http://booking.localhost:3000/klinik-demo/booking", {
      method: "POST",
      headers: {
        host: "booking.localhost:3000",
        "content-type": "multipart/form-data; boundary=---abc",
      },
    });
    expect((await proxy(reqFormPost)).status).toBe(404);

    const reqPublicApiAction = new NextRequest("http://booking.localhost:3000/api/v1/public/booking/otp?slug=klinik-demo", {
      method: "POST",
      headers: {
        host: "booking.localhost:3000",
        "next-action": "deadbeef0123456789",
      },
    });
    expect((await proxy(reqPublicApiAction)).status).toBe(404);

    const reqPublicApiOk = new NextRequest("http://booking.localhost:3000/api/v1/public/aftercare", {
      method: "POST",
      headers: {
        host: "booking.localhost:3000",
        "content-type": "application/json",
      },
    });
    expect((await proxy(reqPublicApiOk)).status).not.toBe(404);

    const reqVendorJsonSeq = new NextRequest("http://vendor.localhost:3000/vendor/api/console/audit-export", {
      method: "POST",
      headers: {
        host: "vendor.localhost:3000",
        "content-type": "application/json-seq",
      },
    });
    expect((await proxy(reqVendorJsonSeq)).status).toBe(404);

    const reqVendorJsonCharset = new NextRequest("http://vendor.localhost:3000/vendor/api/console/audit-export", {
      method: "POST",
      headers: {
        host: "vendor.localhost:3000",
        "content-type": "application/json; charset=utf-8",
      },
    });
    expect((await proxy(reqVendorJsonCharset)).status).not.toBe(404);
  });

  // ── Row 2a: Auth session-bound MFA ───────────────────────────────────────────────────────────
  it("Row 2a P1: sessionGate requires session-bound secondFactorAt for TOTP-required roles", () => {
    const now = new Date("2026-11-26T00:00:00Z");
    expect(
      sessionGate({
        roles: ["owner"],
        twoFactorEnabled: true,
        secondFactorAt: null,
        lastActiveAt: now,
        lockedAt: null,
        now,
      }),
    ).toBe("reauth");

    expect(
      sessionGate({
        roles: ["owner"],
        twoFactorEnabled: true,
        secondFactorAt: now,
        lastActiveAt: now,
        lockedAt: null,
        now,
      }),
    ).toBe("ok");

    expect(
      sessionGate({
        roles: ["fo_cashier"],
        twoFactorEnabled: false,
        secondFactorAt: null,
        lastActiveAt: now,
        lockedAt: null,
        now,
      }),
    ).toBe("ok");
  });

  // ── Row 5a: Money & Accounting ───────────────────────────────────────────────────────────────
  it("Row 5a P2+P3: isCalendarDate handles impossible dates, allocate throws on positive empty lines, reconcile preserves multi-day/branch buckets", () => {
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("2026-02-28")).toBe(true);

    expect(() => allocate(BigInt(100), [])).toThrow(RangeError);
    expect(allocate(BigInt(0), [])).toEqual([]);

    const rec = reconcile({
      from: "2026-11-01",
      to: "2026-11-30",
      branches: [
        { id: "b1", name: "Cabang 1" },
        { id: "b2", name: "Cabang 2" },
      ],
      facts: [
        { metric: "k1", ref: { kind: "payment", id: "p1", label: "PAY-1" }, day: "2026-11-01", branchId: "b1", amount: 100_000 },
        { metric: "k1", ref: { kind: "payment", id: "p1", label: "PAY-1" }, day: "2026-11-02", branchId: "b2", amount: 200_000 },
      ],
      postings: [
        { metric: "k1", ref: { kind: "payment", id: "p1", label: "PAY-1" }, businessDay: "2026-11-01", branchId: "b1", amount: 100_000, period: "2026-11", originalPeriod: "2026-11", entryId: "e1" },
        { metric: "k1", ref: { kind: "payment", id: "p1", label: "PAY-1" }, businessDay: "2026-11-02", branchId: "b2", amount: 200_000, period: "2026-11", originalPeriod: "2026-11", entryId: "e2" },
      ],
      pending: [],
      handover: [],
      unavailable: [],
      clearing: [],
      clearingNet: [],
    });
    expect(rec.items).toEqual([]);
  });

  // ── Row 6: Clinical PDF symbols & width wrapping ─────────────────────────────────────────────
  it("Row 6 P2: renderPdf preserves clinical notation cleanly and wraps wide glyphs ('@', 'W') strictly within printable width", () => {
    const pdf = renderPdf([
      { text: "Dosis ≤ 50 mg ± 5 µg × 2 (suhu 36.5°C, ≥ 10 mL)", bold: false },
      { text: "@".repeat(55), bold: false },
      { text: "W".repeat(76), bold: true },
    ]).toString("latin1");
    expect(pdf).toContain("Dosis <= 50 mg +/- 5 ug x 2");
    expect(pdf).toContain(">= 10 mL");
    expect(pdf).not.toContain("?");
    // Verify EVERY rendered text operator stays strictly within PDF_MAX_LINE_PT (495pt) for its actual font
    const ops = [...pdf.matchAll(/\/(F1|F2) 10 Tf [0-9.]+ [0-9.]+ Td \(((?:\\.|[^\\)])*)\) Tj/g)];
    expect(ops.length).toBeGreaterThanOrEqual(5);
    for (const [, font, raw] of ops) {
      const text = raw.replace(/\\([\\()])/g, "$1");
      expect(measureLineWidthPt(text, font === "F2")).toBeLessThanOrEqual(PDF_MAX_LINE_PT);
    }
    // Exact Latin-1 AFM widths: 'é' = 556 (5.56pt -> 89 chars fit on 1 line: 89*5.56 = 494.84pt <= 495pt),
    // 'Æ' = 1000 (10.0pt -> 55 chars = 550pt > 495pt -> must wrap to >= 2 lines!)
    const latinPdf = renderPdf([
      { text: "é".repeat(89), bold: false },
      { text: "Æ".repeat(55), bold: false },
    ]).toString("latin1");
    const latinOps = [...latinPdf.matchAll(/\/F1 10 Tf [0-9.]+ [0-9.]+ Td \(((?:\\.|[^\\)])*)\) Tj/g)];
    // Line 1 ('é' x 89) must NOT over-wrap as if it were 1000 units/char -> stays 1 line; Line 2 ('Æ' x 55) wraps into 2 lines -> total 3 ops
    expect(latinOps).toHaveLength(3);
    expect(latinOps[0][1].length).toBe(89);
    expect(latinOps[1][1].length).toBe(49); // floor(495 / 10) = 49
    expect(latinOps[2][1].length).toBe(6);
  });

  // ── Row 7: Aftercare OTP HMAC & outbound per-row error isolation ─────────────────────────────
  it("Row 7 P2: otpHashOf uses keyed token-bound HMAC distinct from bare SHA-256; runOutboundDispatch isolates per-row completion errors", async () => {
    const tokenA = "A".repeat(43);
    const tokenB = "B".repeat(43);
    expect(otpHashOf(tokenA, "123456")).toMatch(/^[0-9a-f]{64}$/);
    expect(otpHashOf(tokenA, "123456")).not.toBe(hashOf("123456"));
    expect(otpHashOf(tokenA, "123456")).not.toBe(otpHashOf(tokenB, "123456"));

    let completeCalls = 0;
    const fakeWorker = {
      query: async (sql: string) => {
        if (sql.includes("outbound_claim")) {
          return {
            rows: [
              {
                r: [
                  { id: "m1", tenant_id: "t1", meta_waba_id: "w", phone_number_id: "p", to: "+6281", template_name: "t", template_language: "id", params: [], encrypted_token: null, keys: [] },
                  { id: "m2", tenant_id: "t1", meta_waba_id: "w", phone_number_id: "p", to: "+6282", template_name: "t", template_language: "id", params: [], encrypted_token: null, keys: [] },
                ],
              },
            ],
          };
        }
        completeCalls++;
        if (completeCalls === 1) throw new Error("transient_db_error");
        return { rows: [{ s: "failed" }] };
      },
    };
    const res = await runOutboundDispatch(fakeWorker as never);
    expect(completeCalls).toBe(2);
    expect(res).toEqual({ sent: 0, failed: 2 });
  });

  // ── Row 8: Reports malformed payload & BigInt K20 rounding ───────────────────────────────────
  it("Row 8 P2+P3: malformed reader values (including K7/K5 metadata) map to unavailable: invalid; K20 uses exact BigInt half-away rounding", () => {
    const baseKpi = {
      from: "2026-11-01",
      to: "2026-11-30",
      as_of: "2026-11-30",
      branch_id: null,
      by_branch: {},
      by_grp1: {},
      by_grp2: {},
      rows: [],
      extra: null,
    };
    const bad = fromKpi("K1", { ...baseKpi, kpi: "k1", total: "not-a-number" as unknown as number, by_dim: {} });
    expect(bad[0].metric).toEqual({ kind: "unavailable", reason: "invalid" });

    const badK7Uncosted = fromKpi("K7", { ...baseKpi, kpi: "k7", total: 100_000, by_dim: { uncosted: "corrupt" as unknown as number } });
    expect(badK7Uncosted[0].metric).toEqual({ kind: "unavailable", reason: "invalid" });

    const badK7Est = fromKpi("K7", { ...baseKpi, kpi: "k7", total: 100_000, by_dim: { estimasi: "corrupt" as unknown as number } });
    expect(badK7Est[0].metric).toEqual({ kind: "unavailable", reason: "invalid" });

    const badK5 = fromKpi("K5", { ...baseKpi, kpi: "k5", total: 100_000, by_dim: { incomplete: "corrupt" as unknown as number } });
    expect(badK5[0].metric).toEqual({ kind: "unavailable", reason: "invalid" });

    const badK4 = fromKpi("K4", { ...baseKpi, kpi: "k4", total: 100_000, by_dim: {}, extra: { complete: true, undated_cancellations: "corrupt" as unknown as number } });
    expect(badK4[0].metric).toEqual({ kind: "unavailable", reason: "invalid" });

    const r = k20(
      [
        { id: "i1", branch: "b1", patient: "p1", day: "2026-11-01", state: "issued", shift: null, lines: [{ kind: "service", value: 3 }] },
        { id: "i2", branch: "b1", patient: "p2", day: "2026-11-02", state: "issued", shift: null, lines: [{ kind: "service", value: 2 }] },
      ],
      [],
      { from: "2026-11-01", to: "2026-11-30" },
    );
    expect(r.average).toEqual({ kind: "money", rupiah: 3 }); // 5 / 2 = 2.5 -> 3 half away from zero
  });

  // ── Row 9: Residency fail-closed defaults & Export fixed codes + incremental ceilings ────────
  it("Row 9 P2+P3: evaluateGate fails closed when attested/checksumMatches omitted; buildManifest uses fixed error codes; buildTenantExportFiles enforces ceilings incrementally", () => {
    const env: Record<string, string> = { DEPLOY_ENV: "production" };
    for (const k of ["database", "object_storage", "backups", "logs", "error_tracking"] as StorageKind[]) {
      env[envKey(k, "provider")] = "vultr";
      env[envKey(k, "region")] = "sgp";
      env[envKey(k, "country")] = "SG";
    }
    const dep = deployedLocations(env);
    const base: GateInput = {
      env: "production",
      dbEnv: "production",
      deployed: dep,
      declared: dep.locations,
      opinion: { outcome: "positive", evidenceApproved: true },
      approved: new Set(["vendor_processor_agreement_template", "processor_agreement_signed", "dpia", "appointment_dpo"]),
    };
    const res = evaluateGate(base);
    expect(res.open).toBe(false);
    expect(res.blockers.map((b) => b.code)).toEqual(["unattested", "opinion_unapproved"]);

    expect(() =>
      buildManifest({
        tenantId: "t1",
        exportId: "e1",
        generation: 1,
        completedAt: new Date("2026-11-26T00:00:00Z"),
        files: [{ path: "../secret/file.csv", kind: "csv", bytes: new Uint8Array([1]) }],
      }),
    ).toThrow(/invalid_path/);
    try {
      buildManifest({
        tenantId: "t1",
        exportId: "e1",
        generation: 1,
        completedAt: new Date("2026-11-26T00:00:00Z"),
        files: [{ path: "../secret/file.csv", kind: "csv", bytes: new Uint8Array([1]) }],
      });
    } catch (e) {
      expect(String(e)).not.toContain("secret");
    }

    const oversizedSnapshot: TenantSnapshot = {
      tenant: { id: "t1", legal_name: "PT Uji" },
      tenant_keys: [],
      patients: [
        {
          id: "p1",
          mrn: "RM1",
          full_name: "A",
          birth_date: "1990-01-01",
          sex: "female",
          identity_type: "nik",
          identity_enc: null,
          religion: "other",
          occupation: "",
          education: "",
          marital_status: "single",
          phone: null,
          address: null,
          ihs_patient_id: null,
          registered_branch_id: "b1",
          created_at: "2026-11-01T00:00:00Z",
        },
      ],
      visits: [],
      record_versions: [],
      media: [
        {
          id: "m1",
          patient_id: "p1",
          content_type: "image/png",
          sha256: "0".repeat(64),
          content_b64: Buffer.alloc(MAX_FILE_BYTES + 16).toString("base64"),
        },
      ],
      invoices: [],
      invoice_lines: [],
      payments: [],
      packages: [],
      balance_entries: [],
      receivables: [],
      journal_entries: [],
      journal_lines: [],
      leads: [],
      conversations: [],
      messages: [],
    };
    expect(() => buildTenantExportFiles(oversizedSnapshot)).toThrow(/export_file_too_large/);

    // Quote-heavy CSV cell: raw size (~60% of MAX_FILE_BYTES) fits, but RFC 4180 doubled quotes (~120%) exceed
    // MAX_FILE_BYTES in preflight BEFORE toCsv() / Buffer.from() ever allocates the escaped row!
    const quoteHeavySnapshot: TenantSnapshot = {
      ...oversizedSnapshot,
      media: [],
      patients: [
        {
          ...oversizedSnapshot.patients[0],
          address: '"'.repeat(Math.floor(MAX_FILE_BYTES * 0.6)),
        },
      ],
    };
    const fromSpy = vi.spyOn(Buffer, "from");
    try {
      expect(() => buildTenantExportFiles(quoteHeavySnapshot)).toThrow(/export_file_too_large/);
      const oversizedAllocCalls = fromSpy.mock.calls.filter(
        (args) => typeof args[0] === "string" && args[0].length > MAX_FILE_BYTES,
      );
      expect(oversizedAllocCalls).toHaveLength(0);
    } finally {
      fromSpy.mockRestore();
    }
  });

  // ── Row 10: Public-site category lint, Harga: punctuation & overlay tariff recompute ─────────
  it("Row 10 P2: checkText catches Harga: 250.000 & treatment category; applyLiveBranchOverlay recomputes top-level tariff", () => {
    expect(checkText("purpose", "Harga: 250.000 per sesi").some((v) => v.rule === "harga_di_teks")).toBe(true);
    expect(checkText("purpose", "Tarif - 150.000").some((v) => v.rule === "harga_di_teks")).toBe(true);

    const trBase = {
      slug: "facial",
      name: "Facial Klinis",
      purpose: "Membersihkan pori",
      performedBy: "doctor",
      durationMin: 45,
      downtime: "Kemerahan ringan 1 hari",
      sessions: 1,
      intervalDays: 30,
      contraindications: "Infeksi aktif",
      priceNote: null,
      heroPhoto: null,
      heroAlt: null,
      caption: null,
    };
    const reviewedArtifactHash = computeArtifactDigest(trBase);

    const badCat = buildPublicSiteDto({
      brand: "Klinik Uji",
      slug: "klinik-uji",
      accent: "#0071E3",
      heroPhoto: null,
      oneLine: "Layanan kulit klinis",
      sections: { treatments: true, branches: true, doctors: false },
      counselApproved: true,
      tariffListAllowed: true,
      branches: [{ slug: "jkt", name: "Jakarta", city: "Jakarta", timezone: "Asia/Jakarta", address: null, mapUrl: null, whatsapp: null, hours: [], publishFrom: "2026-01-01", publishUntil: null }],
      treatments: [
        {
          ...trBase,
          category: "Diskon 50% Promo",
          clinicalReview: { state: "approved", reviewedVersion: 1, currentVersion: 1, reviewedArtifactHash },
          publishPrice: true,
          onlineBookable: true,
          published: true,
          branchSlugs: ["jkt"],
          branchPrices: { jkt: 500_000 },
        },
      ],
      templateVars: { "klinik.nama": "Klinik Uji", "klinik.alamat": "Jl. Uji", "klinik.kontak": "021", "klinik.email": "a@b.c", "vendor.nama": "Vendor" },
      now: new Date("2026-11-26T00:00:00Z"),
    });
    expect(badCat.ok).toBe(false);
    if (!badCat.ok) expect(badCat.violations.some((v) => v.field === "facial.category")).toBe(true);

    const okSnap = buildPublicSiteDto({
      brand: "Klinik Uji",
      slug: "klinik-uji",
      accent: "#0071E3",
      heroPhoto: null,
      oneLine: "Layanan kulit klinis",
      sections: { treatments: true, branches: true, doctors: false },
      counselApproved: true,
      tariffListAllowed: true,
      branches: [
        { slug: "jkt", name: "Jakarta", city: "Jakarta", timezone: "Asia/Jakarta", address: null, mapUrl: null, whatsapp: null, hours: [], publishFrom: "2026-01-01", publishUntil: null },
        { slug: "bdg", name: "Bandung", city: "Bandung", timezone: "Asia/Jakarta", address: null, mapUrl: null, whatsapp: null, hours: [], publishFrom: "2026-01-01", publishUntil: null },
      ],
      treatments: [
        {
          ...trBase,
          category: "Perawatan Wajah",
          clinicalReview: { state: "approved", reviewedVersion: 1, currentVersion: 1, reviewedArtifactHash },
          publishPrice: true,
          onlineBookable: true,
          published: true,
          branchSlugs: ["jkt", "bdg"],
          branchPrices: {
            jkt: 500_000,
            bdg: 750_000,
          },
        },
      ],
      templateVars: { "klinik.nama": "Klinik Uji", "klinik.alamat": "Jl. Uji", "klinik.kontak": "021", "klinik.email": "a@b.c", "vendor.nama": "Vendor" },
      now: new Date("2026-11-26T00:00:00Z"),
    });
    expect(okSnap.ok ? [] : okSnap.violations).toEqual([]);
    expect(okSnap.ok).toBe(true);
    if (okSnap.ok) {
      const overlaid = applyLiveBranchOverlay(okSnap.dto, new Set(["bdg"]), []);
      expect(overlaid).not.toBeNull();
      expect(overlaid!.treatments[0].tariff).toMatchObject({ kind: "amount", amount: 750_000 });
    }
  });

  // ── Row 1/7: Shared public booking origin check ──────────────────────────────────────────────
  it("Rows 1/7 P2: isSameBookingOrigin enforces configured BOOKING_HOST and HTTPS in production", () => {
    const prodEnv = { DEPLOY_ENV: "production", BOOKING_HOST: "booking.klinik.example" };
    const httpReq = new NextRequest("https://booking.klinik.example/api/v1/public/aftercare", {
      method: "POST",
      headers: { host: "booking.klinik.example", origin: "http://booking.klinik.example" },
    });
    expect(isSameBookingOrigin(httpReq, prodEnv)).toBe(false);

    const wrongHostReq = new NextRequest("https://evil.example/api/v1/public/aftercare", {
      method: "POST",
      headers: { host: "evil.example", origin: "https://evil.example" },
    });
    expect(isSameBookingOrigin(wrongHostReq, prodEnv)).toBe(false);

    const okReq = new NextRequest("https://booking.klinik.example/api/v1/public/aftercare", {
      method: "POST",
      headers: { host: "booking.klinik.example", origin: "https://booking.klinik.example" },
    });
    const missingHostEnv = { DEPLOY_ENV: "production" };
    expect(isSameBookingOrigin(okReq, missingHostEnv)).toBe(false);
    expect(isSameBookingOrigin(okReq, { DEPLOY_ENV: "production", BOOKING_HOST: "   " })).toBe(false);

    expect(isSameBookingOrigin(okReq, prodEnv)).toBe(true);
  });

  // ── Row 2a P2: Two auth instances against same DB preserve concurrent pending failures ───────
  it("Row 2a P2: concurrent failing sign-in on Instance B survives Instance A's successful sign-in", async () => {
    const h = await createHarness();
    const authUrl = h.urlAs(await h.createLoginRole("", [AUTH_GROUP_ROLE]));
    const poolA = await openAppPool({ connectionString: authUrl, max: 2 }, AUTH_GROUP_ROLE);
    const poolB = await openAppPool({ connectionString: authUrl, max: 2 }, AUTH_GROUP_ROLE);
    try {
      const secret = "dec117-test-secret-0123456789abcdef0123456789";
      const email = "concurrent.dec117@klinik.test";
      const goodPassword = "PasswordKuatDec117!#2026";
      const badPassword = "WrongPasswordDec117!#2026";

      let releaseB!: () => void;
      let bClaimed!: () => void;
      const bClaimedPromise = new Promise<void>((r) => { bClaimed = r; });
      const bGatePromise = new Promise<void>((r) => { releaseB = r; });

      const authA = createAuth({
        pool: poolA,
        baseURL: "http://localhost:3000",
        secret,
        roles: async () => ["fo_cashier"],
        rateLimit: false,
        sleep: async () => {},
      });
      const authB = createAuth({
        pool: poolB,
        baseURL: "http://localhost:3000",
        secret,
        roles: async () => ["fo_cashier"],
        rateLimit: false,
        sleep: async () => {
          bClaimed();
          await bGatePromise;
        },
      });
      await authA.createStaffAccount({ email, name: "Staf Konkuren", password: goodPassword });

      // 1. Seed one prior failure so Instance B has prior=1 and enters sleep() while state='pending'
      await authA.auth.api.signInEmail({ body: { email, password: badPassword }, headers: new Headers() }).catch(() => {});

      // 2. Start Instance B failing sign-in; wait until B has claimed its pending DB row
      const bRun = authB.auth.api.signInEmail({ body: { email, password: badPassword }, headers: new Headers() }).catch(() => {});
      await bClaimedPromise;

      // 3. Instance A completes a valid sign-in while Instance B is still in flight
      await authA.auth.api.signInEmail({ body: { email, password: goodPassword }, headers: new Headers() });

      // 4. Release Instance B to finish failing
      releaseB();
      await bRun;

      // 5. Instance B's failure row MUST survive as state='failed' (never erased by Instance A's success!)
      const rows = (
        await h.admin.query<{ state: string }>(`select state from public.auth_login_failure where email = $1`, [email])
      ).rows;
      expect(rows).toEqual([{ state: "failed" }]);
    } finally {
      await poolA.end();
      await poolB.end();
      await h.close();
    }
  }, 60_000);

  // ── Row 12: Migration runner rejects duplicate journal timestamps ────────────────────────────
  it("Row 12 P2: runMigrations rejects duplicate folderMillis timestamps before applying", async () => {
    const h = await createHarness();
    const dir = mkdtempSync(join(tmpdir(), "dec117-mig-"));
    try {
      mkdirSync(join(dir, "meta"), { recursive: true });
      writeFileSync(join(dir, "0000_a.sql"), "select 1;\n");
      writeFileSync(join(dir, "0001_b.sql"), "select 1;\n");
      writeFileSync(
        join(dir, "meta", "_journal.json"),
        JSON.stringify({
          version: "7",
          dialect: "postgresql",
          entries: [
            { idx: 0, version: "7", when: 1700000000000, tag: "0000_a", breakpoints: true },
            { idx: 1, version: "7", when: 1700000000000, tag: "0001_b", breakpoints: true },
          ],
        }),
      );
      await expect(runMigrations(h.ownerUrl(), { folder: dir })).rejects.toThrow(MigrationDriftError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await h.close();
    }
  }, 60_000);
});
