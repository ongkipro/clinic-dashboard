// T-131 M9 exit flow (executed on green main 5210d969 after T-120–T-130 and DEC-117 remediation).
// Verifies the M9 map invariants, NFR probe arithmetic, automated J9 & J11 journey contracts, and
// M9 exit evidence integrity using synthetic data only (MIG-2) and zero live provider calls.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  availability,
  evaluateNfr1,
  evaluateNfr3,
  evaluateNfr7,
  junitPassed,
  NFR5_FILES,
  NFR8_FILES,
  Pending,
  percentile,
  resolveSameOriginPath,
  TARGETS,
} from "./nfr-probes.mjs";
import { deployedLocations, envKey, type StorageKind } from "../../../src/modules/platform/residency/config";
import { evaluateGate } from "../../../src/modules/platform/residency/gate";
import { dryRunValidateImport } from "../../../src/modules/import/parser";
import { buildPublicSiteDto } from "../../../src/modules/public-site/snapshot";
import { computeArtifactDigest, CONSULTATION_PRICE } from "../../../src/modules/public-site/rules/rules";
import { resolveBookingHostCsp } from "../../../src/app/(public)/_pixel-policy";
import { bookingHref, whatsappLink } from "../../../src/app/(public)/[slug]/booking/model";

const ROOT = join(__dirname, "../../..");
const MAP = JSON.parse(readFileSync(join(__dirname, "scenarios.json"), "utf8")) as {
  scenarios: { scenario: string }[];
  deferred: { scenario: string; completes_in: string }[];
  items: { item: string; kind: string; status?: string; evidence?: string }[];
  nfr: { id: string; status: string; evidence: string }[];
};

describe("M9 map shape and truthful pre-staging accounting (no database)", () => {
  it("maps all 15 required M9 scenarios with zero deferred entries", () => {
    expect(MAP.scenarios.length).toBe(15);
    expect(MAP.deferred).toEqual([]);
  });

  it("records all 8 NFR entries with truthful PASSED vs PENDING EXECUTION status", () => {
    expect(MAP.nfr.map((n) => n.id)).toEqual(["NFR-1", "NFR-2", "NFR-3", "NFR-4", "NFR-5", "NFR-6", "NFR-7", "NFR-8"]);
    for (const n of MAP.nfr) {
      if (n.status === "PASSED") {
        const rec = JSON.parse(readFileSync(join(ROOT, n.evidence), "utf8")) as { id: string; result: string };
        expect(rec.id).toBe(n.id);
        expect(rec.result).toBe("PASS");
      } else {
        expect(n.status).toBe("PENDING EXECUTION");
      }
    }
  });

  it("every evidence item marked PASSED has an on-disk Result: PASS report", () => {
    for (const item of MAP.items.filter((x) => x.kind === "evidence")) {
      if (item.status === "PASSED") {
        expect(item.evidence).toBeTruthy();
        const text = readFileSync(join(ROOT, item.evidence!), "utf8");
        expect(text).toMatch(/^Result: PASS\s*$/m);
      } else {
        expect(item.status).toBe("PENDING EXECUTION");
      }
    }
  });
});

describe("NFR probe arithmetic (nfr-probes.mjs)", () => {
  it("p95 is the nearest-rank percentile", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 95)).toBe(95);
    expect(percentile([5, 1, 3], 50)).toBe(3);
    expect(percentile([], 95)).toBeNull();
  });

  it("availability counts clinic hours only (08:00–21:00 WIB)", () => {
    const out = [
      { start: "2026-11-02T10:00:00+07:00", end: "2026-11-02T10:39:00+07:00" },
      { start: "2026-11-02T22:00:00+07:00", end: "2026-11-03T00:00:00+07:00" },
    ];
    const a = availability(out, "2026-11-02T00:00:00+07:00", "2026-11-03T00:00:00+07:00");
    expect(a).toBeCloseTo(1 - 39 / (13 * 60), 10);
    expect(a !== null && a < TARGETS["NFR-1"].availability).toBe(true);
    expect(availability([], "2026-11-02T00:00:00+07:00", "2026-11-02T07:00:00+07:00")).toBeNull();
  });

  it("JUnit pass check: enforces all prefixes, required tests, suite errors, and file-scoped skip allowlist", () => {
    const xml = (body: string, suiteAttrs = "") => `<testsuites><testsuite${suiteAttrs}>${body}</testsuite></testsuites>`;
    const ok = xml(`<testcase classname="tests/isolation/isolation.test.ts" name="a"/><testcase classname="tests/x.test.ts" name="b"><failure/></testcase>`);
    expect(junitPassed(ok, ["tests/isolation/isolation.test.ts"])).toEqual({ count: 1, failed: 0, passed: true });
    expect(junitPassed(xml(`<testcase classname="tests/isolation/isolation.test.ts" name="a"><skipped/></testcase>`), ["tests/isolation/"]).passed).toBe(false);
    expect(junitPassed(xml(`<testcase classname="tests/isolation/isolation.test.ts" name="a"><error/></testcase>`), ["tests/isolation/"]).passed).toBe(false);
    expect(junitPassed(xml(""), ["tests/isolation/"]).passed).toBe(false);

    // Incomplete multi-prefix report fails (every selector prefix must have >= 1 passing case)
    const partialPrefixes = xml(`<testcase classname="tests/accounting/ledger.test.ts" name="a"/>`);
    expect(junitPassed(partialPrefixes, ["tests/accounting/", "tests/idempotency/"])).toMatchObject({
      passed: false,
      missing_prefixes: ["tests/idempotency/"],
    });

    // Missing required testcase (e.g. DEL-2 coverage gate) fails
    expect(
      junitPassed(xml(`<testcase classname="tests/isolation/isolation.test.ts" name="other"/>`), ["tests/isolation/isolation.test.ts"], {
        requiredTests: [{ file: "tests/isolation/isolation.test.ts", name: "coverage gate > every route" }],
      }),
    ).toMatchObject({ passed: false, missing_required: ["tests/isolation/isolation.test.ts > coverage gate > every route"] });

    // Suite-level error/failure attributes (double, single, & spaced quotes) and suite-level <error>/<failure> tags fail
    expect(
      junitPassed(xml(`<testcase classname="tests/isolation/isolation.test.ts" name="a"/>`, ' errors="1"'), ["tests/isolation/isolation.test.ts"]),
    ).toMatchObject({ passed: false, suite_errors: true });
    expect(
      junitPassed(xml(`<testcase classname="tests/isolation/isolation.test.ts" name="a"/>`, " failures='1'"), ["tests/isolation/isolation.test.ts"]),
    ).toMatchObject({ passed: false, suite_errors: true });
    expect(
      junitPassed(xml(`<testcase classname="tests/isolation/isolation.test.ts" name="a"/>`, " failures = '1'"), ["tests/isolation/isolation.test.ts"]),
    ).toMatchObject({ passed: false, suite_errors: true });
    expect(
      junitPassed(xml(`<error message="crash"/><testcase classname="tests/isolation/isolation.test.ts" name="a"/>`), ["tests/isolation/isolation.test.ts"]),
    ).toMatchObject({ passed: false, suite_errors: true });
    expect(
      junitPassed(xml(`<failure message="suite fail"/><testcase classname="tests/isolation/isolation.test.ts" name="a"/>`), ["tests/isolation/isolation.test.ts"]),
    ).toMatchObject({ passed: false, suite_errors: true });

    // Rooted directory prefixes and exact file paths reject non-rooted or suffixed filenames
    expect(
      junitPassed(xml(`<testcase classname="old/tests/db/example.test.ts" name="a"/>`), ["tests/db/"]),
    ).toMatchObject({ passed: false, missing_prefixes: ["tests/db/"] });
    expect(
      junitPassed(xml(`<testcase classname="tests/events/events.test.ts.bak" name="a"/>`), ["tests/events/events.test.ts"]),
    ).toMatchObject({ passed: false, missing_prefixes: ["tests/events/events.test.ts"] });

    // Commented-out and CDATA-wrapped testcases never count as executed; literal `<!--` inside CDATA never swallows a following real <failure/>
    expect(
      junitPassed(xml(`<!-- <testcase classname="tests/db/a.test.ts" name="a"/> -->`), ["tests/db/"]),
    ).toMatchObject({ count: 0, passed: false, missing_prefixes: ["tests/db/"] });
    expect(
      junitPassed(xml(`<![CDATA[<testcase classname="tests/db/a.test.ts" name="a"/>]]>`), ["tests/db/"]),
    ).toMatchObject({ count: 0, passed: false, missing_prefixes: ["tests/db/"] });
    expect(
      junitPassed(
        xml(`<testcase classname="tests/db/a.test.ts" name="a"><system-out><![CDATA[<!--]]></system-out><failure/><!-- note --></testcase>`),
        ["tests/db/"],
      ),
    ).toMatchObject({ count: 1, failed: 1, passed: false });

    // Malformed XML (duplicate/glued attributes, literal `<` in attr, multiple roots) and nested output suites/testcases fail
    expect(
      junitPassed(xml(`<testcase classname="tests/db/a.test.ts" name="a"/>`, ' failures="1" failures="0"'), ["tests/db/"]),
    ).toMatchObject({ passed: false, suite_errors: true });
    expect(
      junitPassed(xml(`<testcase classname="tests/db/a.test.ts"name="a"/>`), ["tests/db/"]),
    ).toMatchObject({ passed: false, suite_errors: true });
    expect(
      junitPassed(xml(`<testcase classname="tests/db/a.test.ts" name="a<b"/>`), ["tests/db/"]),
    ).toMatchObject({ passed: false, suite_errors: true });
    expect(
      junitPassed(
        `<testsuite><testcase classname="tests/db/a.test.ts" name="a"/></testsuite><testsuite/>`,
        ["tests/db/"],
      ),
    ).toMatchObject({ passed: false, suite_errors: true });
    expect(
      junitPassed(
        xml(`<system-out><testcase classname="tests/db/a.test.ts" name="a"/></system-out>`),
        ["tests/db/"],
      ),
    ).toMatchObject({ count: 0, passed: false, missing_prefixes: ["tests/db/"] });
    expect(
      junitPassed(
        xml(`<system-out><testsuite><testcase classname="tests/db/a.test.ts" name="a"/></testsuite></system-out>`),
        ["tests/db/"],
      ),
    ).toMatchObject({ count: 0, passed: false, missing_prefixes: ["tests/db/"] });
    expect(
      junitPassed(
        xml(`<testcase classname="tests/db/a.test.ts" name="outer"><system-out><testsuite><testcase classname="tests/db/a.test.ts" name="inner"></testcase></testsuite></system-out><failure/></testcase>`),
        ["tests/db/"],
      ),
    ).toMatchObject({ count: 1, failed: 1, passed: false });
    // Malformed UTF-8 bytes in raw JUnit buffer are rejected by Expat (never silently replaced with U+FFFD)
    const badUtf8 = Buffer.concat([
      Buffer.from('<testsuites><testsuite><testcase classname="tests/db/a.test.ts" name="a"/><!-- '),
      Buffer.from([0xff, 0xfe]),
      Buffer.from(" --></testsuite></testsuites>"),
    ]);
    expect(junitPassed(badUtf8, ["tests/db/"])).toMatchObject({ passed: false, suite_errors: true });

    // File-scoped skip allowlist: exact file+name passes; wrong file fails; failure/error on allowlisted name fails; all-skipped fails
    const allow = [{ file: "tests/isolation/isolation.test.ts", name: "sentinel > empty" }];
    const withNamedSkip = xml(
      `<testcase classname="tests/isolation/isolation.test.ts" name="real"/><testcase classname="tests/isolation/isolation.test.ts" name="sentinel &gt; empty"><skipped/></testcase>`,
    );
    expect(junitPassed(withNamedSkip, ["tests/isolation/"], { allowedSkipped: allow })).toMatchObject({
      count: 2,
      passed_count: 1,
      failed: 0,
      allowed_skipped: 1,
      passed: true,
    });
    const wrongFileSkip = xml(
      `<testcase classname="tests/isolation/other.test.ts" name="real"/><testcase classname="tests/isolation/other.test.ts" name="sentinel &gt; empty"><skipped/></testcase>`,
    );
    expect(junitPassed(wrongFileSkip, ["tests/isolation/"], { allowedSkipped: allow })).toMatchObject({ failed: 1, passed: false });
    const allowlistedFailure = xml(
      `<testcase classname="tests/isolation/isolation.test.ts" name="real"/><testcase classname="tests/isolation/isolation.test.ts" name="sentinel &gt; empty"><failure/></testcase>`,
    );
    expect(junitPassed(allowlistedFailure, ["tests/isolation/"], { allowedSkipped: allow })).toMatchObject({ failed: 1, passed: false });
    const allowlistedError = xml(
      `<testcase classname="tests/isolation/isolation.test.ts" name="real"/><testcase classname="tests/isolation/isolation.test.ts" name="sentinel &gt; empty"><error/></testcase>`,
    );
    expect(junitPassed(allowlistedError, ["tests/isolation/"], { allowedSkipped: allow })).toMatchObject({ failed: 1, passed: false });
    const onlySkipped = xml(`<testcase classname="tests/isolation/isolation.test.ts" name="sentinel &gt; empty"><skipped/></testcase>`);
    expect(junitPassed(onlySkipped, ["tests/isolation/"], { allowedSkipped: allow }).passed).toBe(false);
  });

  it("NFR-5 names existing test folders; NFR-8 names the TEST-LOC-1 file, which exists", () => {
    expect(NFR5_FILES.length).toBeGreaterThan(0);
    expect(NFR8_FILES).toEqual(["docs/evidence/m9/nfr8-locale.test.ts"]);
    for (const f of NFR8_FILES) expect(readFileSync(join(ROOT, f), "utf8")).toContain("TEST-LOC-1");
  });

  it("NFR-1 rejects unlogged failed samples and missing day coverage; NFR-2 blocks off-origin paths; NFR-7 rejects reversed timestamps", () => {
    // NFR-1: unlogged failed health observation fails even with an empty incident log
    const unlogged = evaluateNfr1(
      [],
      [
        { at: "2026-11-02T09:00:00+07:00", ok: true },
        { at: "2026-11-02T10:00:00+07:00", ok: false },
      ],
      "2026-11-02T08:00:00+07:00",
      "2026-11-02T21:00:00+07:00",
    );
    expect(unlogged.pass).toBe(false);
    expect(unlogged.unlogged_failures).toBe(1);
    expect(unlogged.availability).toBe(0.5);

    // NFR-1: multi-day window missing observations on day 2 throws Pending
    expect(() =>
      evaluateNfr1(
        [],
        [{ at: "2026-11-02T09:00:00+07:00", ok: true }],
        "2026-11-02T08:00:00+07:00",
        "2026-11-03T21:00:00+07:00",
      ),
    ).toThrow(Pending);

    // NFR-2: network-path references (//evil.test) cannot steal session cookies off-origin
    expect(() => resolveSameOriginPath("https://app.example.id", "//evil.test/steal")).toThrow();
    expect(() => resolveSameOriginPath("https://app.example.id", "https://evil.test/steal")).toThrow();
    expect(resolveSameOriginPath("https://app.example.id", "/jadwal").href).toBe("https://app.example.id/jadwal");

    // NFR-1: zero-duration incident cannot excuse a failed sample
    const zeroDur = evaluateNfr1(
      [{ start: "2026-11-02T10:00:00+07:00", end: "2026-11-02T10:00:00+07:00" }],
      [
        { at: "2026-11-02T09:00:00+07:00", ok: true },
        { at: "2026-11-02T10:00:00+07:00", ok: false },
      ],
      "2026-11-02T08:00:00+07:00",
      "2026-11-02T21:00:00+07:00",
    );
    expect(zeroDur.pass).toBe(false);
    expect(zeroDur.invalid_outages).toBe(1);
    expect(zeroDur.unlogged_failures).toBe(1);

    // NFR-1: overlapping outages are merged (union) and not double-counted
    const dup3m = availability(
      [
        { start: "2026-11-02T10:00:00+07:00", end: "2026-11-02T10:03:00+07:00" },
        { start: "2026-11-02T10:00:00+07:00", end: "2026-11-02T10:03:00+07:00" },
      ],
      "2026-11-02T08:00:00+07:00",
      "2026-11-02T21:00:00+07:00",
    );
    expect(dup3m).toBeCloseTo(1 - 3 / (13 * 60), 10);
    expect(dup3m !== null && dup3m >= TARGETS["NFR-1"].availability).toBe(true);

    // NFR-1: null incident row records invalid_outages=1 and fails cleanly without throwing
    const nullInc = evaluateNfr1(
      [null],
      [{ at: "2026-11-02T09:00:00+07:00", ok: true }],
      "2026-11-02T08:00:00+07:00",
      "2026-11-02T21:00:00+07:00",
    );
    expect(nullInc.invalid_outages).toBe(1);
    expect(nullInc.pass).toBe(false);

    // NFR-3: null, NaN, or negative durations fail
    expect(evaluateNfr3({ passed: true, rpo_seconds: null, rto_seconds: null }).pass).toBe(false);
    expect(evaluateNfr3({ passed: true, rpo_seconds: Number.NaN, rto_seconds: 10 }).pass).toBe(false);
    expect(evaluateNfr3({ passed: true, rpo_seconds: -1, rto_seconds: 10 }).pass).toBe(false);
    expect(evaluateNfr3({ passed: true, rpo_seconds: 0, rto_seconds: 14 }).pass).toBe(true);

    // NFR-7: reversed timestamps (negative duration) fail
    expect(
      evaluateNfr7({ started_at: "2026-11-02T12:00:00Z", finished_at: "2026-11-02T10:00:00Z", config_only: true, passed: true }).pass,
    ).toBe(false);
    expect(
      evaluateNfr7({ started_at: "2026-11-02T10:00:00Z", finished_at: "2026-11-02T12:00:00Z", config_only: true, passed: true }).pass,
    ).toBe(true);
  });
});

// ── J9 Clinic onboarding automated contract checks ───────────────────────────────────────────────────
describe("J9 clinic onboarding (automated contract verification)", () => {
  it("J9 residency gate blocks real-patient actions while residency opinion or obligations are missing (PR-36)", () => {
    const env: Record<string, string> = { DEPLOY_ENV: "production" };
    for (const k of ["database", "object_storage", "backups", "logs", "error_tracking"] as StorageKind[]) {
      env[envKey(k, "provider")] = "vultr";
      env[envKey(k, "region")] = "sgp";
      env[envKey(k, "country")] = "SG";
    }
    const deployed = deployedLocations(env);
    const blocked = evaluateGate({
      env: "production",
      dbEnv: "production",
      deployed,
      declared: deployed.locations,
      opinion: { outcome: null, evidenceApproved: false, checksumMatches: false },
      approved: new Set(),
      attested: true,
    });
    expect(blocked.open).toBe(false);
    expect(blocked.blockers.some((b) => b.code === "opinion_required")).toBe(true);
    expect(blocked.blockers.some((b) => b.code === "obligation_missing")).toBe(true);

    const open = evaluateGate({
      env: "production",
      dbEnv: "production",
      deployed,
      declared: deployed.locations,
      opinion: { outcome: "positive", evidenceApproved: true, checksumMatches: true },
      approved: new Set(["vendor_processor_agreement_template", "processor_agreement_signed", "dpia", "appointment_dpo"]),
      attested: true,
    });
    expect(open).toEqual({ open: true, blockers: [] });
  });

  it("J9 opening-data import dry-run reconciles synthetic Numa-shaped batch with zero drift (PR-85)", () => {
    const res = dryRunValidateImport({
      sourceSystem: "numa_synthetic",
      cutoverDate: "2026-11-25",
      tenantHmacKey: Buffer.alloc(32, 7),
      knownBranchCodes: new Set(["jkt", "bdg"]),
      knownServiceCodes: new Set(["FAC-01"]),
      patients: [
        { externalId: "P-1", fullName: "Pasien Sintetis M9", phone: "+6281200001111", nik: "3171010101900011", birthDate: "1990-01-01", sex: "female", branchCode: "jkt" },
      ],
      balances: [
        { externalId: "B-1", patientExternalId: "P-1", branchCode: "jkt", amountIdr: "500000" },
      ],
      packages: [
        {
          externalId: "PK-1",
          patientExternalId: "P-1",
          branchCode: "jkt",
          catalogCode: "FAC-01",
          totalSessions: 5,
          historicalUsedCount: 2,
          contractValueIdr: "1500000",
          paidValueIdr: "1500000",
          usedValueIdr: "500000",
          expiresOn: "2027-11-25",
        },
      ],
      bookingDps: [
        { externalId: "DP-1", patientExternalId: "P-1", branchCode: "bdg", amountIdr: "250000" },
      ],
      receivables: [
        { externalId: "AR-1", patientExternalId: "P-1", branchCode: "jkt", amountIdr: "300000", dueOn: "2026-12-25" },
      ],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.summary.totalsIdr.balances).toBe("500000");
      expect(res.summary.totalsIdr.packagesPaidRemaining).toBe("1000000");
      expect(res.summary.totalsIdr.bookingDps).toBe("250000");
      expect(res.summary.totalsIdr.receivables).toBe("300000");
      expect(res.summary.totalsIdr.totalLiabilities).toBe("1750000");
      expect(res.summary.totalsIdr.totalAssets).toBe("300000");
    }
  });
});

// ── J11 Patient finds the clinic online automated contract checks ────────────────────────────────────
describe("J11 patient finds the clinic online (automated contract verification)", () => {
  it("J11 public site publishes master-data branches/treatments, hides unpublished prices, and builds neutral booking/WA links (PR-64/65/67)", () => {
    const trHiddenPrice = {
      slug: "laser-klinis",
      name: "Laser Klinis",
      purpose: "Perawatan pigmentasi kulit oleh dokter",
      performedBy: "doctor",
      durationMin: 30,
      downtime: "Kemerahan ringan 1 hari",
      sessions: 3,
      intervalDays: 28,
      contraindications: "Kehamilan atau infeksi aktif",
      priceNote: "Mulai Rp500.000",
      heroPhoto: null,
      heroAlt: null,
      caption: null,
    };
    const snap = buildPublicSiteDto({
      brand: "Klinik M9 Sintetis",
      slug: "klinik-m9-sintetis",
      accent: "#0071E3",
      heroPhoto: null,
      oneLine: "Layanan estetika berbasis dokter",
      sections: { treatments: true, branches: true, doctors: false },
      counselApproved: true,
      tariffListAllowed: true,
      branches: [
        { slug: "kemang", name: "Cabang Kemang", city: "Jakarta Selatan", timezone: "Asia/Jakarta", address: null, mapUrl: null, whatsapp: "6281200002222", hours: [], publishFrom: "2026-01-01", publishUntil: null },
        { slug: "bsd", name: "Cabang BSD", city: "Tangerang", timezone: "Asia/Jakarta", address: null, mapUrl: null, whatsapp: "6281200003333", hours: [], publishFrom: "2026-01-01", publishUntil: null },
      ],
      treatments: [
        {
          ...trHiddenPrice,
          category: "Perawatan Kulit",
          clinicalReview: { state: "approved", reviewedVersion: 1, currentVersion: 1, reviewedArtifactHash: computeArtifactDigest(trHiddenPrice) },
          publishPrice: false,
          onlineBookable: true,
          published: true,
          branchSlugs: ["kemang", "bsd"],
          branchPrices: { kemang: 1_500_000, bsd: 1_500_000 },
        },
      ],
      templateVars: { "klinik.nama": "Klinik M9 Sintetis", "klinik.alamat": "Jl. Kemang 1", "klinik.kontak": "021-5550000", "klinik.email": "halo@m9.test", "vendor.nama": "Vendor M9" },
      now: new Date("2026-11-26T00:00:00Z"),
    });
    expect(snap.ok).toBe(true);
    if (snap.ok) {
      expect(snap.dto.branches).toHaveLength(2);
      expect(snap.dto.treatments[0].tariff).toEqual({ kind: "consultation", text: CONSULTATION_PRICE });
    }

    const bookingUrl = bookingHref("klinik-m9-sintetis", { page: "perawatan", treatment: "laser-klinis", branch: "kemang" });
    expect(bookingUrl).toContain("/klinik-m9-sintetis/booking?");
    expect(bookingUrl).toContain("layanan=laser-klinis");
    expect(bookingUrl).toContain("cabang=kemang");

    const wa = whatsappLink("6281200002222", { brand: "Klinik M9 Sintetis", page: "perawatan" });
    expect(wa?.href).toContain("wa.me/6281200002222");
    expect(wa?.href).not.toMatch(/laser|pigmentasi|jerawat/i);
  });

  it("J11 pixel policy keeps health-intent and booking routes strictly free of third-party pixel/replay hosts (PR-39)", () => {
    for (const path of ["/klinik-m9-sintetis/perawatan/laser-klinis", "/klinik-m9-sintetis/booking", "/klinik-m9-sintetis/cabang"]) {
      const res = resolveBookingHostCsp({
        pathname: path,
        cookieHeader: null,
        nonce: "testnonce123",
      });
      expect(res.consentedProviders).toBeNull();
      expect(res.csp).not.toMatch(/facebook|connect\.facebook|googletagmanager|google-analytics|hotjar|clarity|posthog/i);
    }
  });
});

// ── M9 exit evidence integrity ───────────────────────────────────────────────────────────────────────
describe("M9 exit evidence files", () => {
  it("records security review (DEC-117 12-row closure), browser sweep, and restore drill artefacts", () => {
    for (const rel of [
      "docs/evidence/m9/security-review.md",
      "docs/evidence/m9/browser-sweep.md",
      "docs/evidence/m9/restore-drill.md",
      "docs/evidence/m9/walkthrough-j9.md",
      "docs/evidence/m9/walkthrough-j11.md",
    ]) {
      expect(existsSync(join(ROOT, rel)), rel).toBe(true);
    }
    const sec = readFileSync(join(ROOT, "docs/evidence/m9/security-review.md"), "utf8");
    expect(sec).toContain("9router-fantastico/cx/gpt-6.2-sol");
    expect(sec).toMatch(/^Result: PASS\s*$/m);
  });
});
