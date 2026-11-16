#!/usr/bin/env python3
"""T-101 scenario and exit-item map check (M6; T-069's checker pointed at M6) (reads files only; no database).

Usage: check-scenarios.py <junit.xml>
- the required M6 scenario titles are mapped, each a "Scenario: <title>" line of docs/spec/02-PRD.md §8;
- the M6 exit items (PLAN.md §1 M6) are each mapped, the m6 flow among them;
- every entry states what it proves; every scenario states what is open; every deferred entry names its task;
- every mapped test name's last segment occurs verbatim in its file;
- in the JUnit report every mapped test is present exactly once (normalized file path and "describe > test"),
  passed (no failure, error or skipped child), and the report has no failure or error anywhere.
A JUnit report is required: structure alone never passes.
"""
import json
import os
import pathlib
import re
import sys
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[3]
REQUIRED_SCENARIOS = [
    "PR-27 number cap", "PR-28 service window", "PR-29 converted requires payment", "PR-30 control due", "PR-31 budget", "PR-43 complaint escalation",
    "PR-69 reminder reply", "PR-70 aftercare", "PR-78 low score", "PR-81 waitlist", "PR-94 frequency cap", "PR-94 campaign sending gated",
]
REQUIRED_ITEMS = [
    "M6 exit: the test number end to end with recorded fixtures",
    "M6 exit: webhook replay fixtures (duplicate, late, out of order, bad signature)",
    "M6 exit: PR-94 per-patient cap under concurrency",
]
FLOW = "docs/evidence/m6/m6-flow.test.ts"

if len(sys.argv) != 2:
    sys.exit("usage: check-scenarios.py <junit.xml>")
m = json.loads((ROOT / "docs/evidence/m6/scenarios.json").read_text())
prd = (ROOT / "docs/spec/02-PRD.md").read_text()
titles = {l[len("Scenario: "):].strip() for l in prd.splitlines() if l.startswith("Scenario: ")}
bad = []


def norm(p: str) -> str:
    p = p.replace("\\", "/")
    return os.path.normpath(p[len(str(ROOT)) + 1:] if p.startswith(str(ROOT) + "/") else p)


cases = {}
dupes = set()
for tc in ET.parse(sys.argv[1]).getroot().iter("testcase"):
    k = (norm(tc.get("classname", "")), tc.get("name", ""))
    if k in cases:
        dupes.add(k)
    kinds = {c.tag for c in tc}
    cases[k] = "failed" if kinds & {"failure", "error"} else "skipped" if "skipped" in kinds else "passed"
failed = [k for k, v in cases.items() if v == "failed"]
if failed:
    bad.append(f"{len(failed)} failed test(s) in the report, e.g. {failed[0][0]} > {failed[0][1]}")

mapped = 0


def check_tests(label: str, entry: dict) -> None:
    global mapped
    f = ROOT / entry["file"]
    src = f.read_text() if f.exists() else ""
    if not src:
        bad.append(f"missing file: {entry['file']}")
    if not entry.get("tests"):
        bad.append(f"no tests mapped: {label}")
    if not str(entry.get("proves", "")).strip():
        bad.append(f"no 'proves': {label} ({entry['file']})")
    for t in entry.get("tests", []):
        mapped += 1
        if t.split(" > ")[-1] not in src:
            bad.append(f"test name not in {entry['file']}: {t}")
        k = (norm(entry["file"]), t)
        if k in dupes:
            bad.append(f"ambiguous (several cases with this name): {entry['file']} > {t}")
        state = cases.get(k)
        if state != "passed":
            bad.append(f"{label}: {entry['file']} > {t}: {state or 'not in report'}")


for s in m["scenarios"]:
    if s["scenario"] not in titles:
        bad.append(f"scenario not in PRD §8: {s['scenario']}")
    if not str(s.get("open", "")).strip():
        bad.append(f"no 'open': {s['scenario']} ({s['file']})")
    check_tests(s["scenario"], s)
for t in REQUIRED_SCENARIOS:
    if t not in {s["scenario"] for s in m["scenarios"]}:
        bad.append(f"required M6 scenario not mapped: {t}")

flow_mapped = False
items_seen = set()
for it in m.get("items", []):
    items_seen.add(it["item"])
    if it["file"] == FLOW:
        flow_mapped = True
    check_tests(it["item"], it)
for r in REQUIRED_ITEMS:
    if r not in items_seen:
        bad.append(f"required M6 exit item not mapped: {r}")
if not flow_mapped:
    bad.append(f"the M6 flow is not mapped: {FLOW}")

for d in m.get("deferred", []):
    if d["scenario"] not in titles:
        bad.append(f"deferred scenario not in PRD §8: {d['scenario']}")
    if not str(d.get("completes_in", "")).strip():
        bad.append(f"deferred scenario without completes_in: {d['scenario']}")

print(f"report: {len(cases)} tests, {len(failed)} failed, {sum(1 for v in cases.values() if v == 'skipped')} skipped")
print(f"scenarios: {len({s['scenario'] for s in m['scenarios']})} distinct ({len(REQUIRED_SCENARIOS)} required), "
      f"exit items: {len(items_seen)} ({len(REQUIRED_ITEMS)} required), {mapped} mapped test cases, "
      f"all required to pass; deferred: {len(m.get('deferred', []))}")
for b in bad:
    print("FAIL", b)
sys.exit(1 if bad else 0)
