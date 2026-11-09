#!/usr/bin/env python3
"""T-049 scenario map check (M1; T-032 checker pointed at m1) (reads files only; no database).

Usage: check-scenarios.py <junit.xml>
- every mapped scenario title is a "Scenario: <title>" line of docs/spec/02-PRD.md §8;
- every mapped test name's last segment occurs verbatim in its mapped file;
- in the JUnit report: every mapped test is present exactly once, identified by its normalized file
  path and full name ("describe > test"), and passed (no failure, error or skipped child);
- the report has no failure or error anywhere.
A JUnit report is required: structure alone never passes (review round 1 P2).
"""
import json
import os
import pathlib
import sys
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[3]
if len(sys.argv) != 2:
    sys.exit("usage: check-scenarios.py <junit.xml>")
m = json.loads((ROOT / "docs/evidence/m1/scenarios.json").read_text())
prd = (ROOT / "docs/spec/02-PRD.md").read_text()
titles = {l[len("Scenario: "):].strip() for l in prd.splitlines() if l.startswith("Scenario: ")}
bad = []


def norm(p: str) -> str:
    p = p.replace("\\", "/")
    return os.path.normpath(p[len(str(ROOT)) + 1:] if p.startswith(str(ROOT) + "/") else p)


cases = {}
dupes = set()
for tc in ET.parse(sys.argv[1]).getroot().iter("testcase"):
    key = (norm(tc.get("classname", "")), tc.get("name", ""))
    if key in cases:
        dupes.add(key)
    kinds = {c.tag for c in tc}
    cases[key] = "failed" if kinds & {"failure", "error"} else "skipped" if "skipped" in kinds else "passed"
failed = [k for k, v in cases.items() if v == "failed"]
if failed:
    bad.append(f"{len(failed)} failed test(s) in the report, e.g. {failed[0][0]} > {failed[0][1]}")

mapped = 0
for s in m["scenarios"]:
    if s["scenario"] not in titles:
        bad.append(f"scenario not in PRD §8: {s['scenario']}")
    f = ROOT / s["file"]
    src = f.read_text() if f.exists() else ""
    if not src:
        bad.append(f"missing file: {s['file']}")
    if not s.get("tests"):
        bad.append(f"no tests mapped: {s['scenario']}")
    for t in s.get("tests", []):
        mapped += 1
        if t.split(" > ")[-1] not in src:
            bad.append(f"test name not in {s['file']}: {t}")
        key = (norm(s["file"]), t)
        if key in dupes:
            bad.append(f"ambiguous (several cases with this name): {s['file']} > {t}")
        state = cases.get(key)
        if state != "passed":
            bad.append(f"{s['scenario']}: {s['file']} > {t}: {state or 'not in report'}")
# M1 requirements without a PRD §8 scenario title: the same file, name and report rules.
for it in m.get("items", []):
    f = ROOT / it["file"]
    src = f.read_text() if f.exists() else ""
    if not src:
        bad.append(f"missing file: {it['file']}")
    if not it.get("tests"):
        bad.append(f"no tests mapped: {it['item']}")
    for t in it.get("tests", []):
        mapped += 1
        if t.split(" > ")[-1] not in src:
            bad.append(f"test name not in {it['file']}: {t}")
        key = (norm(it["file"]), t)
        if key in dupes:
            bad.append(f"ambiguous (several cases with this name): {it['file']} > {t}")
        state = cases.get(key)
        if state != "passed":
            bad.append(f"{it['item']}: {it['file']} > {t}: {state or 'not in report'}")
for d in m["deferred"]:
    if d["scenario"] not in titles:
        bad.append(f"deferred scenario not in PRD §8: {d['scenario']}")
    if not d.get("completes_in"):
        bad.append(f"deferred scenario without completes_in: {d['scenario']}")

print(f"report: {len(cases)} tests, {len(failed)} failed, {sum(1 for v in cases.values() if v == 'skipped')} skipped")
print(f"scenarios: {len({s['scenario'] for s in m['scenarios']})} distinct, items: {len(m.get('items', []))}, {mapped} mapped test cases, all required to pass; deferred: {len(m['deferred'])}")
for b in bad:
    print("FAIL", b)
sys.exit(1 if bad else 0)
