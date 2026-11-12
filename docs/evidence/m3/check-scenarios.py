#!/usr/bin/env python3
"""T-069 scenario and CLIN map check (M3; T-059's checker pointed at M3) (reads files only; no database).

Usage: check-scenarios.py <junit.xml>
- the required M3 scenario titles are mapped, each a "Scenario: <title>" line of docs/spec/02-PRD.md §8;
- the M3 exit CLIN ids (PLAN.md §1 M3) are each covered by an item (several items per id allowed), each id a CLIN row of
  the PRD; the m3 stock fixture is mapped;
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
    "PR-14 patient-chosen stop", "PR-16 no double deduction", "PR-17 transfer", "PR-18 automatic list", "PR-75 supplier return", "PR-82 logbook",
    "PR-89 depot transfer", "PR-89 concurrent depot transfers", "PR-90 supplier payable", "PR-90 no double allocation",
]
REQUIRED_CLIN = ["CLIN-008", "CLIN-017", "CLIN-018", "CLIN-019", "CLIN-024", "CLIN-025"]
FLOW = "docs/evidence/m3/m3-flow.test.ts"

if len(sys.argv) != 2:
    sys.exit("usage: check-scenarios.py <junit.xml>")
m = json.loads((ROOT / "docs/evidence/m3/scenarios.json").read_text())
prd = (ROOT / "docs/spec/02-PRD.md").read_text()
titles = {l[len("Scenario: "):].strip() for l in prd.splitlines() if l.startswith("Scenario: ")}
clin_rows = set(re.findall(r"^\| (CLIN-\d{3}) \|", prd, re.M))
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
        bad.append(f"required M3 scenario not mapped: {t}")

clin_seen = set()
flow_mapped = False
for it in m.get("items", []):
    cid = re.match(r"^(CLIN-\d{3})\b", it["item"])
    if cid:
        if cid.group(1) not in clin_rows:
            bad.append(f"CLIN id not a row of 02-PRD.md: {cid.group(1)}")
        clin_seen.add(cid.group(1))
    if it["file"] == FLOW:
        flow_mapped = True
    check_tests(it["item"], it)
for c in REQUIRED_CLIN:
    if c not in clin_seen:
        bad.append(f"required CLIN id not mapped: {c}")
if not flow_mapped:
    bad.append(f"the M3 stock fixture is not mapped: {FLOW}")

for d in m.get("deferred", []):
    if d["scenario"] not in titles:
        bad.append(f"deferred scenario not in PRD §8: {d['scenario']}")
    if not str(d.get("completes_in", "")).strip():
        bad.append(f"deferred scenario without completes_in: {d['scenario']}")

print(f"report: {len(cases)} tests, {len(failed)} failed, {sum(1 for v in cases.values() if v == 'skipped')} skipped")
print(f"scenarios: {len({s['scenario'] for s in m['scenarios']})} distinct ({len(REQUIRED_SCENARIOS)} required), "
      f"CLIN ids: {len(clin_seen)} ({len(REQUIRED_CLIN)} required), items: {len(m.get('items', []))}, {mapped} mapped test cases, "
      f"all required to pass; deferred: {len(m.get('deferred', []))}")
for b in bad:
    print("FAIL", b)
sys.exit(1 if bad else 0)
