#!/usr/bin/env python3
"""T-059 scenario and CLIN map check (M2; T-049's checker extended; plan review r1 P2-1) (reads files only; no database).

Usage: check-scenarios.py <junit.xml>
- the required M2 scenario titles are mapped, each a "Scenario: <title>" line of docs/spec/02-PRD.md §8;
- the thirteen Done-when CLIN ids are each covered by an item (several items per id allowed), each id a CLIN row of
  the PRD; the m2 flow test is mapped;
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
    "PR-9 no scores from BC", "PR-9 BC cannot diagnose", "PR-10 history on one screen", "PR-11 consent mismatch", "PR-13 correction window",
    "PR-32 private photo", "PR-43 complaint escalation", "PR-45 clinician approves addition", "PR-49 record copy",
    "PR-3 acting role for multi-role staff", "PR-73 credential alert", "PR-74 signed letter",
]
REQUIRED_CLIN = ["CLIN-001", "CLIN-002", "CLIN-003", "CLIN-004", "CLIN-005", "CLIN-012", "CLIN-014", "CLIN-015", "CLIN-016",
                 "CLIN-021", "CLIN-022", "CLIN-023", "CLIN-026"]
FLOW = "docs/evidence/m2/m2-flow.test.ts"

if len(sys.argv) != 2:
    sys.exit("usage: check-scenarios.py <junit.xml>")
m = json.loads((ROOT / "docs/evidence/m2/scenarios.json").read_text())
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
        bad.append(f"required M2 scenario not mapped: {t}")

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
    bad.append(f"the M2 flow test is not mapped: {FLOW}")

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
