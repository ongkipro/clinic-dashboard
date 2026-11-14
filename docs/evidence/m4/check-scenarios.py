#!/usr/bin/env python3
"""T-086 M4 exit map check (the M3 checker pointed at M4, with a money block) (reads files only; no database).

Usage: check-scenarios.py <junit.xml>
- money: the required money scenario ids (docs/spec/fixtures/money-scenarios.md, DEC-080; M4 asserts the domain behaviour of 1–9, 11–13,
  15–19 and the facts of 10 and 14) are each mapped; every entry states what it proves and what M5/M8 completes;
- scenarios: the required M4 titles (PLAN.md §1 M4, incl. the M0–M3 deferrals completing in M4) are mapped, each a "Scenario: <title>"
  line of docs/spec/02-PRD.md §8, each with 'open';
- items: the M4 CLIN ids (each a CLIN row of the PRD), "PR-68 mock never counts", "PR-77 quota atomic under 2 concurrent cashiers" and the
  T-085 shift close are covered;
- every mapped test name's last segment occurs verbatim in its file;
- in the JUnit report every mapped test is present exactly once (normalized file path and "describe > test"), passed (no failure, error
  or skipped child), and the report has no failure or error anywhere.
A JUnit report is required: structure alone never passes.
"""
import json
import os
import pathlib
import re
import sys
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[3]
REQUIRED_MONEY = ["1", "1 PKP", "2", "3a", "3b", "4a", "4b", "4c", "4d", "5a", "5b", "6a", "6b", "6c", "6d", "6e", "6 PKP", "6e PKP", "7a", "7b",
                  "7c", "7d", "8", "9", "10", "11", "12a", "12b", "13", "14", "15a", "15b", "15 PKP", "16", "17", "17 PKP", "18", "19"]
REQUIRED_SCENARIOS = [
    "PR-24 VAT gated by tax advice", "PR-24 PKP switch", "PR-42 branch price", "PR-19 proportional allocation", "PR-68 mock gateway duplicate webhook",
    "PR-68 mock hidden in production", "PR-15 alerts", "PR-15 cannot close unpaid", "PR-7 outstanding list", "PR-45 clinician approves addition",
    "PR-15 receivable", "PR-21 refund goes to balance by default", "PR-21 balance never expires", "PR-37 maker-checker", "PR-37 owner write-off",
    "PR-63 Admin Pusat boundary", "PR-20 session unlock and expiry", "PR-14 patient-chosen stop", "PR-22 booking DP under 24 hours", "PR-83 no-show",
    "PR-12 consultation fee after full refund", "PR-43 complaint escalation", "PR-72 discount above limit", "PR-77 promo quota",
    "PR-93 sharing disabled by default", "PR-93 beneficiaries cannot exceed paid value", "PR-96 schedule does not unlock", "PR-79 expense",
]
REQUIRED_CLIN = ["CLIN-006", "CLIN-007", "CLIN-009", "CLIN-010", "CLIN-011", "CLIN-020", "CLIN-025", "CLIN-028"]
REQUIRED_ITEMS = ["PR-68 mock never counts", "PR-77 quota atomic under 2 concurrent cashiers", "PR-19 / BILL-18 shift close"]

if len(sys.argv) != 2:
    sys.exit("usage: check-scenarios.py <junit.xml>")
m = json.loads((ROOT / "docs/evidence/m4/scenarios.json").read_text())
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


for s in m["money"]:
    if not str(s.get("open", "")).strip():
        bad.append(f"no 'open': money {s['scenario']} ({s['file']})")
    check_tests(f"money {s['scenario']}", s)
for sid in REQUIRED_MONEY:
    if sid not in {s["scenario"] for s in m["money"]}:
        bad.append(f"required money scenario not mapped: {sid}")

for s in m["scenarios"]:
    if s["scenario"] not in titles:
        bad.append(f"scenario not in PRD §8: {s['scenario']}")
    if not str(s.get("open", "")).strip():
        bad.append(f"no 'open': {s['scenario']} ({s['file']})")
    check_tests(s["scenario"], s)
for t in REQUIRED_SCENARIOS:
    if t not in {s["scenario"] for s in m["scenarios"]}:
        bad.append(f"required M4 scenario not mapped: {t}")

clin_seen = set()
for it in m.get("items", []):
    cid = re.match(r"^(CLIN-\d{3})\b", it["item"])
    if cid:
        if cid.group(1) not in clin_rows:
            bad.append(f"CLIN id not a row of 02-PRD.md: {cid.group(1)}")
        clin_seen.add(cid.group(1))
    check_tests(it["item"], it)
for c in REQUIRED_CLIN:
    if c not in clin_seen:
        bad.append(f"required CLIN id not mapped: {c}")
for r in REQUIRED_ITEMS:
    if not any(it["item"].startswith(r) for it in m.get("items", [])):
        bad.append(f"required item not mapped: {r}")

for d in m.get("deferred", []):
    if not str(d.get("completes_in", "")).strip():
        bad.append(f"deferred entry without completes_in: {d.get('scenario') or d.get('item')}")

print(f"report: {len(cases)} tests, {len(failed)} failed, {sum(1 for v in cases.values() if v == 'skipped')} skipped")
print(f"money: {len({s['scenario'] for s in m['money']})} ids ({len(REQUIRED_MONEY)} required); scenarios: {len({s['scenario'] for s in m['scenarios']})} "
      f"({len(REQUIRED_SCENARIOS)} required); CLIN ids: {len(clin_seen)} ({len(REQUIRED_CLIN)} required); items: {len(m.get('items', []))}; "
      f"{mapped} mapped test cases, all required to pass; deferred: {len(m.get('deferred', []))}")
for b in bad:
    print("FAIL", b)
sys.exit(1 if bad else 0)
