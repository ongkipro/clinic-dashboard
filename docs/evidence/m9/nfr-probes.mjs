#!/usr/bin/env node
// T-131 NFR probe runner (scaffold). Each probe measures for real against a configured target and writes one evidence record
// docs/evidence/m9/nfr/<NFR-n>.json = { id, result: "PASS" | "FAIL", measured, target, at, method, source } — the only shape
// check-scenarios.py accepts. A probe whose target or input is not configured exits with "PENDING EXECUTION" and writes nothing: no
// record is ever written without a measurement (no fabricated claims). Live probes need the deployed or staging host (OBSERVABILITY.md
// probes are TBD until a deployed host exists, DEC-034); nothing here calls a third-party provider.
//
// Usage: node docs/evidence/m9/nfr-probes.mjs <NFR-n> [--dry-run]
//   NFR-1  M9_HEALTH_URL + M9_HEALTH_SAMPLES + M9_INCIDENT_LOG + M9_FROM + M9_TO  availability over clinic hours 08:00–21:00 local
//   NFR-2  M9_BASE_URL + M9_PERF_COOKIE + M9_PERF_PATHS (JSON {booking, treatment, dashboard} → path)  p95 per path, n = M9_PERF_N (> 0, default 200; 2xx only)
//   NFR-3  M9_RESTORE_REPORT (restore drill report JSON {rpo_seconds, rto_seconds, passed})
//   NFR-4  M9_BROWSER_SWEEP (+ M9_EXPECTED_ROUTES or expected_routes[] in report)  every expected route passes 390/820/1180/1440, zoom200, axe=0
//   NFR-5  M9_JUNIT (JUnit of the full suite) — the replay / concurrency / drift tests named in NFR5_TESTS all passed
//   NFR-6  M9_JUNIT — the isolation gate (tests/isolation/isolation.test.ts) all passed, coverage gate included
//   NFR-7  M9_MIGRATION_REHEARSAL (JSON {started_at, finished_at, config_only: true, passed})
//   NFR-8  M9_JUNIT — the localization tests named in NFR8_TESTS all passed
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "nfr");
export const TARGETS = {
  "NFR-1": { availability: 0.995, open: "08:00", close: "21:00" },
  "NFR-2": { booking: 500, treatment: 2000, dashboard: 2000 },
  "NFR-3": { rpo_seconds: 15 * 60, rto_seconds: 2 * 3600 },
  "NFR-4": { widths: [390, 820, 1180, 1440], zoom200: true, axe_violations: 0 },
  "NFR-7": { max_seconds: 24 * 3600 },
};
// Test files whose cases prove NFR-5 (whole files: every case in them must pass): command replay, outbox once-only, ledger and sub-ledger
// reconciliation, stock costing and depots under concurrency, commission, and the DB drift pins.
export const NFR5_FILES = ["tests/idempotency/", "tests/events/events.test.ts", "tests/accounting/", "tests/inventory/", "tests/commission/", "tests/db/"];
// NFR-8 (TEST-LOC-1): docs/evidence/m9/nfr8-locale.test.ts — Indonesian labels across nav, settings and every labels.ts, id-ID integer
// rupiah, Indonesian dates, WIB / WITA / WIT zone labels (T-131 Lane D, 2026-11-19).
export const NFR8_FILES = ["docs/evidence/m9/nfr8-locale.test.ts"];

export class Pending extends Error {}
const need = (name) => {
  const v = process.env[name];
  if (!v) throw new Pending(`${name} is not set`);
  return v;
};
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// Nearest-rank percentile of milliseconds (p in (0, 100]).
export function percentile(xs, p) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}
// Merge sorted/overlapping [start, end] intervals (strictly positive duration: end > start).
function mergeIntervals(intervals) {
  const valid = intervals
    .map(([a, b]) => [a, b])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
    .sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const [a, b] of valid) {
    if (merged.length === 0 || a > merged[merged.length - 1][1]) merged.push([a, b]);
    else if (b > merged[merged.length - 1][1]) merged[merged.length - 1][1] = b;
  }
  return merged;
}

// Minutes of [open, close) local clinic time in [from, to] (ISO with offset) lost to outages; days counted on the given offset.
// Overlapping outages are merged (union) so downtime is never double-counted; null/malformed entries are safely ignored here
// (evaluateNfr1 flags them as invalid_outages > 0 and fails the probe).
export function availability(outages, from, to, open = "08:00", close = "21:00", offsetMin = 7 * 60) {
  const day = 86_400_000, toMs = (s) => Date.parse(s);
  const [oh, om] = open.split(":").map(Number), [ch, cm] = close.split(":").map(Number);
  const merged = mergeIntervals(outages.map((o) => [toMs(o?.start), toMs(o?.end)]));
  let total = 0, lost = 0;
  const start = Math.floor((toMs(from) + offsetMin * 60_000) / day) * day - offsetMin * 60_000;
  for (let d = start; d < toMs(to); d += day) {
    const a = Math.max(d + (oh * 60 + om) * 60_000, toMs(from)), b = Math.min(d + (ch * 60 + cm) * 60_000, toMs(to));
    if (b <= a) continue;
    total += b - a;
    for (const [os, oe] of merged) lost += Math.max(0, Math.min(b, oe) - Math.max(a, os));
  }
  return total === 0 ? null : 1 - lost / total;
}
// JUnit cases of the given file prefixes: EVERY prefix must have >= 1 passing testcase,
// EVERY required {file, name} testcase must pass, suite-level errors/failures fail the run,
// and an optional file-scoped allowlist (`allowedSkipped: [{file, name}]`) permits ONLY
// explicitly named non-regression `<skipped/>` placeholders (never `<failure>` or `<error>`).
export const NFR5_ALLOWED_SKIPPED = [
  {
    file: "tests/accounting/ledger.test.ts",
    name: "T-105 OPEN acceptance gaps G-Q4 U1–U4 (unlinked visit selection products) > OPEN U1: a handed selection product never billed on a linked line — owner / accountant rule (sample, giveaway, write-off) and visit-close policy",
  },
  {
    file: "tests/accounting/ledger.test.ts",
    name: "T-105 OPEN acceptance gaps G-Q4 U1–U4 (unlinked visit selection products) > OPEN U2: fractional selection quantities cannot be represented on an integer invoice line — forbid them for products, or change the line quantity model",
  },
  {
    file: "tests/accounting/ledger.test.ts",
    name: "T-105 OPEN acceptance gaps G-Q4 U1–U4 (unlinked visit selection products) > OPEN U3: a selection row billed unlinked or at an edited quantity — allow split linking or keep exact-only",
  },
  {
    file: "tests/accounting/ledger.test.ts",
    name: "T-105 OPEN acceptance gaps G-Q4 U1–U4 (unlinked visit selection products) > OPEN U4: lines issued before migration 0124 carry no link and are not backfilled — finance reconciliation list",
  },
];
export const NFR6_ALLOWED_SKIPPED = [
  {
    file: "tests/isolation/isolation.test.ts",
    name: "cross-tenant negative cases > no cases yet: foundation has no tenant surface",
  },
];
export const NFR6_REQUIRED_TESTS = [
  {
    file: "tests/isolation/isolation.test.ts",
    name: "coverage gate > every route, job and export in src has a cross-tenant negative case",
  },
];

const keyOf = (file, name) => `${file}\0${name}`;
const normPath = (p) => p.replace(/\\/g, "/").replace(/^\.\//, "");
const matchesSelector = (file, selector) => {
  const f = normPath(file), s = normPath(selector);
  return s.endsWith("/") ? f.startsWith(s) : f === s;
};

// Strict W3C XML 1.0 JUnit parser via Python 3 stdlib Expat (same parser used by check-scenarios.py).
// Rejects all malformed XML (duplicate/glued attributes, literal `<` in attribute values, multiple roots,
// unclosed comments/CDATA, invalid entities) and traverses only valid testsuites -> testsuite -> testcase trees.
const PY_PARSE_JUNIT = `
import json, sys, xml.etree.ElementTree as ET
raw = sys.stdin.buffer.read()
try:
    root = ET.fromstring(raw)
except Exception:
    print(json.dumps({"cases": [], "suiteErrors": True}))
    sys.exit(0)
if root.tag not in ("testsuites", "testsuite"):
    print(json.dumps({"cases": [], "suiteErrors": True}))
    sys.exit(0)
cases = []
suite_errors = False
def is_pos(v):
    if v is None:
        return False
    try:
        return int(v) > 0
    except ValueError:
        return True
def walk_suite(el):
    global suite_errors
    if is_pos(el.attrib.get("errors")) or is_pos(el.attrib.get("failures")):
        suite_errors = True
    for child in el:
        if child.tag in ("testsuite", "testsuites"):
            walk_suite(child)
        elif child.tag in ("failure", "error"):
            suite_errors = True
        elif child.tag == "testcase" and el.tag == "testsuite":
            child_tags = {c.tag for c in child}
            cases.append({
                "file": child.attrib.get("classname", ""),
                "name": child.attrib.get("name", ""),
                "failed": bool(child_tags & {"failure", "error"}),
                "skipped": "skipped" in child_tags,
            })
walk_suite(root)
print(json.dumps({"cases": cases, "suiteErrors": suite_errors}))
`;

function parseJunitXml(xml) {
  const raw = Buffer.isBuffer(xml) ? xml : Buffer.from(String(xml), "utf8");
  const out = execFileSync("python3", ["-c", PY_PARSE_JUNIT], {
    input: raw,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const parsed = JSON.parse(out);
  return {
    cases: parsed.cases.map((c) => ({ ...c, file: normPath(c.file) })),
    suiteErrors: parsed.suiteErrors === true,
  };
}

export function resolveSameOriginPath(base, path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) {
    throw new Error(`path must be a same-origin absolute path starting with single '/': ${path}`);
  }
  const baseUrl = new URL(base);
  const resolved = new URL(path, baseUrl);
  if (resolved.origin !== baseUrl.origin) {
    throw new Error(`resolved URL origin ${resolved.origin} does not match ${baseUrl.origin}`);
  }
  return resolved;
}

export function evaluateNfr1(log, samples, from, to, open = TARGETS["NFR-1"].open, close = TARGETS["NFR-1"].close, offsetMin = 7 * 60) {
  const fromMs = Date.parse(from), toMs = Date.parse(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    throw new Pending("invalid [M9_FROM, M9_TO] window");
  }
  const day = 86_400_000;
  const [oh, om] = open.split(":").map(Number), [ch, cm] = close.split(":").map(Number);
  const clinicWindows = [];
  const start = Math.floor((fromMs + offsetMin * 60_000) / day) * day - offsetMin * 60_000;
  for (let d = start; d < toMs; d += day) {
    const a = Math.max(d + (oh * 60 + om) * 60_000, fromMs);
    const b = Math.min(d + (ch * 60 + cm) * 60_000, toMs);
    if (b > a) clinicWindows.push([a, b]);
  }
  if (clinicWindows.length === 0) throw new Pending("no clinic hours in the window");

  const inClinic = (ms) => clinicWindows.some(([a, b]) => ms >= a && ms < b);
  const clinicSamples = samples
    .map((s) => ({ ms: Date.parse(s.at), ok: s.ok === true }))
    .filter((s) => Number.isFinite(s.ms) && inClinic(s.ms));
  if (clinicSamples.length === 0) throw new Pending("no health observations inside clinic hours");

  const uncoveredDays = clinicWindows.filter(([a, b]) => !clinicSamples.some((s) => s.ms >= a && s.ms < b)).length;
  if (uncoveredDays > 0) throw new Pending(`${uncoveredDays} clinic day(s) in window have no health observations`);

  const parsedOutages = log.map((o) => [Date.parse(o?.start), Date.parse(o?.end)]);
  const invalidOutages = parsedOutages.filter(([a, b]) => !Number.isFinite(a) || !Number.isFinite(b) || b <= a).length;
  const mergedOutages = mergeIntervals(parsedOutages);

  const unloggedFailures = clinicSamples.filter(
    (s) => !s.ok && !mergedOutages.some(([a, b]) => s.ms >= a && s.ms <= b),
  ).length;
  const logAvailability = availability(log, from, to, open, close, offsetMin);
  const sampleAvailability = clinicSamples.filter((s) => s.ok).length / clinicSamples.length;
  const effective = Math.min(logAvailability ?? 0, sampleAvailability);
  return {
    availability: effective,
    log_availability: logAvailability,
    sample_availability: sampleAvailability,
    outages: log.length,
    invalid_outages: invalidOutages,
    health_samples: clinicSamples.length,
    failed_samples: clinicSamples.filter((s) => !s.ok).length,
    unlogged_failures: unloggedFailures,
    pass: invalidOutages === 0 && unloggedFailures === 0 && effective >= TARGETS["NFR-1"].availability,
  };
}

export function evaluateNfr3(r) {
  const t = TARGETS["NFR-3"];
  const rpoOk = typeof r?.rpo_seconds === "number" && Number.isFinite(r.rpo_seconds) && r.rpo_seconds >= 0;
  const rtoOk = typeof r?.rto_seconds === "number" && Number.isFinite(r.rto_seconds) && r.rto_seconds >= 0;
  return {
    measured: r,
    pass: r?.passed === true && rpoOk && rtoOk && r.rpo_seconds <= t.rpo_seconds && r.rto_seconds <= t.rto_seconds,
  };
}

export function evaluateNfr7(r) {
  const startMs = Date.parse(r?.started_at);
  const endMs = Date.parse(r?.finished_at);
  const secs = (endMs - startMs) / 1000;
  const validDuration = Number.isFinite(startMs) && Number.isFinite(endMs) && secs >= 0;
  return {
    measured: { seconds: validDuration ? secs : null, config_only: r?.config_only === true },
    pass: validDuration && r?.passed === true && r?.config_only === true && secs <= TARGETS["NFR-7"].max_seconds,
  };
}

export function junitPassed(xml, prefixes, options = {}) {
  const { allowedSkipped = [], requiredTests = [] } = options;
  const { cases: allCases, suiteErrors } = parseJunitXml(xml);
  const allow = new Set(allowedSkipped.map((x) => keyOf(normPath(x.file), x.name)));
  const cases = allCases.filter((c) => prefixes.some((p) => matchesSelector(c.file, p)));

  const allowedSkips = cases.filter((c) => !c.failed && c.skipped && allow.has(keyOf(c.file, c.name)));
  const bad = cases.filter((c) => c.failed || (c.skipped && !allow.has(keyOf(c.file, c.name))));
  const passedCases = cases.filter((c) => !c.failed && !c.skipped);
  const passedKeys = new Set(passedCases.map((c) => keyOf(c.file, c.name)));
  const missingPrefixes = prefixes.filter((p) => !passedCases.some((c) => matchesSelector(c.file, p)));
  const missingRequired = requiredTests.filter((r) => !passedKeys.has(keyOf(normPath(r.file), r.name))).map((r) => `${r.file} > ${r.name}`);

  const passed =
    !suiteErrors &&
    passedCases.length > 0 &&
    bad.length === 0 &&
    missingPrefixes.length === 0 &&
    missingRequired.length === 0;

  if (allowedSkipped.length === 0 && requiredTests.length === 0 && !suiteErrors && missingPrefixes.length === 0) {
    return { count: cases.length, failed: bad.length, passed };
  }
  return {
    count: cases.length,
    passed_count: passedCases.length,
    failed: bad.length,
    allowed_skipped: allowedSkips.length,
    suite_errors: suiteErrors,
    missing_prefixes: missingPrefixes,
    missing_required: missingRequired,
    passed,
  };
}

const PROBES = {
  "NFR-1": async () => {
    const log = readFileSync(need("M9_INCIDENT_LOG"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const samples = readFileSync(need("M9_HEALTH_SAMPLES"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const from = need("M9_FROM"), to = need("M9_TO");
    const healthUrl = need("M9_HEALTH_URL");
    const ev = evaluateNfr1(log, samples, from, to);
    const live = await fetch(healthUrl, { redirect: "manual" });
    if (live.status !== 200) throw new Error(`health probe ${healthUrl}: HTTP ${live.status}`);
    return {
      measured: { ...ev, from, to, live_status: live.status },
      pass: ev.pass,
      source: "incident log + health observations + live probe",
    };
  },
  "NFR-2": async () => {
    const base = need("M9_BASE_URL"), cookie = need("M9_PERF_COOKIE"), paths = JSON.parse(need("M9_PERF_PATHS"));
    const n = Number(process.env.M9_PERF_N ?? 200);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`M9_PERF_N must be a positive integer, got ${process.env.M9_PERF_N}`);
    const resolvedUrls = Object.fromEntries(
      Object.keys(TARGETS["NFR-2"]).map((k) => [k, resolveSameOriginPath(base, paths[k])]),
    );
    const measured = {};
    for (const [k, url] of Object.entries(resolvedUrls)) {
      const ms = [];
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        const r = await fetch(url, { headers: { cookie }, redirect: "manual" });
        await r.arrayBuffer();
        if (r.status < 200 || r.status >= 300) throw new Error(`${k}: expected 2xx, got HTTP ${r.status}`);
        ms.push(performance.now() - t0);
      }
      const p95 = percentile(ms, 95);
      if (p95 === null) throw new Error(`${k}: no timing samples recorded`);
      measured[k] = { p95_ms: Math.round(p95), n };
    }
    const pass = Object.entries(TARGETS["NFR-2"]).every(([k, max]) => measured[k] && measured[k].p95_ms < max);
    return { measured, pass, source: base };
  },
  "NFR-3": () => {
    const ev = evaluateNfr3(readJson(need("M9_RESTORE_REPORT")));
    return { measured: ev.measured, pass: ev.pass, source: "restore drill report" };
  },
  "NFR-4": () => {
    const r = readJson(need("M9_BROWSER_SWEEP"));
    const expected = Array.isArray(r.expected_routes) ? r.expected_routes : readJson(need("M9_EXPECTED_ROUTES"));
    const t = TARGETS["NFR-4"];
    const byRoute = new Map((Array.isArray(r.pages) ? r.pages : []).map((p) => [p.route, p]));
    const missing = Array.isArray(expected) ? expected.filter((route) => !byRoute.has(route)) : [];
    const pass =
      Array.isArray(expected) &&
      expected.length > 0 &&
      missing.length === 0 &&
      Array.isArray(r.pages) &&
      r.pages.length >= expected.length &&
      r.pages.every((p) => t.widths.every((w) => p.widths?.[w] === "pass") && p.zoom200 === "pass" && p.axe_violations === 0);
    return { measured: { pages: r.pages?.length ?? 0, expected_routes: expected?.length ?? 0, missing_routes: missing.length }, pass, source: "browser sweep report" };
  },
  "NFR-5": () => {
    const j = junitPassed(readFileSync(need("M9_JUNIT")), NFR5_FILES, { allowedSkipped: NFR5_ALLOWED_SKIPPED });
    return { measured: j, pass: j.passed, source: "JUnit (all 6 NFR-5 prefixes verified; 4 file-scoped M8-AMEND-2-GQ4-U1-U4 todos accounted)" };
  },
  "NFR-6": () => {
    const j = junitPassed(readFileSync(need("M9_JUNIT")), ["tests/isolation/isolation.test.ts"], {
      allowedSkipped: NFR6_ALLOWED_SKIPPED,
      requiredTests: NFR6_REQUIRED_TESTS,
    });
    return { measured: j, pass: j.passed, source: "JUnit (DEL-2 coverage gate verified; file-scoped M0 empty-suite skipIf sentinel accounted)" };
  },
  "NFR-7": () => {
    const r = readJson(need("M9_MIGRATION_REHEARSAL"));
    const ev = evaluateNfr7(r);
    return { measured: ev.measured, pass: ev.pass, source: "migration rehearsal" };
  },
  "NFR-8": () => {
    const j = junitPassed(readFileSync(need("M9_JUNIT")), NFR8_FILES);
    return { measured: j, pass: j.passed, source: "JUnit (TEST-LOC-1)" };
  },
};

async function main() {
  const [id, flag] = process.argv.slice(2);
  if (!PROBES[id]) {
    console.error(`usage: nfr-probes.mjs <${Object.keys(PROBES).join("|")}> [--dry-run]`);
    process.exit(2);
  }
  try {
    const r = await PROBES[id]();
    const rec = { id, result: r.pass ? "PASS" : "FAIL", measured: r.measured, target: TARGETS[id] ?? null, at: new Date().toISOString(), method: id, source: r.source };
    if (flag === "--dry-run") console.log(JSON.stringify(rec, null, 1));
    else {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, `${id}.json`), `${JSON.stringify(rec, null, 1)}\n`);
      console.log(`${id}: ${rec.result} → docs/evidence/m9/nfr/${id}.json`);
    }
    process.exit(r.pass ? 0 : 1);
  } catch (e) {
    if (e instanceof Pending) {
      console.log(`${id}: PENDING EXECUTION (${e.message}); nothing written`);
      process.exit(3);
    }
    throw e;
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
