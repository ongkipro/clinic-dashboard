#!/usr/bin/env python3
"""T-131 M9 exit check (reads files only; no database). M6/M4 checkers' rules plus the M9 evidence, journey and NFR entries.

Usage: check-scenarios.py [--scaffold] <junit.xml>
- every required M9 scenario title (PLAN.md §1 M9: PR-36, PR-39, PR-50, PR-52, PR-59, PR-64–PR-67, PR-85 import, PR-87; plus PR-86, the
  nav sweep) is mapped as tested or deferred, each a "Scenario: <title>" line of docs/spec/02-PRD.md §8;
- every M9 exit item of PLAN.md §1 is mapped (restore drill, residency gate, browser sweep, security review, import dry-run, J9, J11) and the
  m9 flow is among them; NFR-1–NFR-8 each have an entry with target, method and evidence path;
- every tested entry states what it proves and what is open; every mapped test name's last segment occurs verbatim in its file; in the
  JUnit report every mapped test is present exactly once and passed, and the report has no failure or error anywhere;
- an evidence entry passes only when its status is PASSED and its evidence file exists and records "Result: PASS"; PENDING EXECUTION
  never passes; a NFR entry passes only with an evidence JSON {"id", "result": "PASS", "measured", "at"} matching its id.
Without --scaffold every deferred / pending entry is a failure (the exit is not met). With --scaffold the deferred and pending entries
are reported, not failed: scaffold mode proves only that the map is complete and well-formed, never that M9 passes.
A JUnit report is required in both modes: structure alone never passes the tested entries.
"""
import json
import os
import pathlib
import re
import sys
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(os.environ.get("M9_ROOT") or pathlib.Path(__file__).resolve().parents[3])
MAP = pathlib.Path(os.environ.get("M9_MAP") or ROOT / "docs/evidence/m9/scenarios.json")
REQUIRED_SCENARIOS = [
    "PR-36 residency", "PR-36 activation refused without opinion", "PR-39 no pixel on treatment page", "PR-39 no replay on booking",
    "PR-50 data request", "PR-52 export", "PR-59 go-live gate", "PR-64 generated public site", "PR-65 unpublished price",
    "PR-65 no advertised discount", "PR-66 doctor consent", "PR-67 booking with context", "PR-85 import dry-run",
    "PR-86 role-filtered menu", "PR-87 vendor console tree",
]
REQUIRED_ITEMS = [
    "M9 exit: restore drill passed in an isolated environment",
    "M9 exit: residency gate blocks real-patient actions while evidence is missing",
    "M9 exit: browser sweep 390/820/1180/1440 recorded",
    "M9 exit: security review findings closed",
    "M9 exit: synthetic Numa-shaped import dry-run reconciles",
    "M9 exit: J9 walkthrough passes",
    "M9 exit: J11 walkthrough passes",
    "M9 exit: the m9 flow",
]
REQUIRED_NFR = [f"NFR-{i}" for i in range(1, 9)]
FLOW = "docs/evidence/m9/m9-flow.test.ts"

args = [a for a in sys.argv[1:] if a != "--scaffold"]
scaffold = "--scaffold" in sys.argv[1:]
if len(args) != 1:
    sys.exit("usage: check-scenarios.py [--scaffold] <junit.xml>")
m = json.loads(MAP.read_text())
prd = (ROOT / "docs/spec/02-PRD.md").read_text()
titles = {l[len("Scenario: "):].strip() for l in prd.splitlines() if l.startswith("Scenario: ")}
nfr_rows = set(re.findall(r"(?m)^\| (NFR-\d+) \|", prd))
bad: list[str] = []
pending: list[str] = []


def gap(msg: str) -> None:
    (pending if scaffold else bad).append(msg)


def norm(p: str) -> str:
    p = p.replace("\\", "/")
    return os.path.normpath(p[len(str(ROOT)) + 1:] if p.startswith(str(ROOT) + "/") else p)


cases: dict = {}
dupes = set()
for tc in ET.parse(args[0]).getroot().iter("testcase"):
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


def evidence_passed(path: str) -> bool:
    p = ROOT / path
    return p.exists() and re.search(r"(?m)^Result: PASS\s*$", p.read_text()) is not None


# ── scenarios: tested or deferred, never both, every required one present ─────────────────────────────────────────────────────────
tested = set()
for s in m.get("scenarios", []):
    if s["scenario"] not in titles:
        bad.append(f"scenario not in PRD §8: {s['scenario']}")
    if not str(s.get("open", "")).strip():
        bad.append(f"no 'open': {s['scenario']} ({s['file']})")
    tested.add(s["scenario"])
    check_tests(s["scenario"], s)
deferred = set()
for d in m.get("deferred", []):
    if d["scenario"] not in titles:
        bad.append(f"deferred scenario not in PRD §8: {d['scenario']}")
    if not str(d.get("completes_in", "")).strip():
        bad.append(f"deferred scenario without completes_in: {d['scenario']}")
    if d["scenario"] in tested:
        bad.append(f"scenario both tested and deferred: {d['scenario']}")
    deferred.add(d["scenario"])
    gap(f"deferred scenario (not evidence): {d['scenario']} → {d.get('completes_in')}")
for t in REQUIRED_SCENARIOS:
    if t not in tested | deferred:
        bad.append(f"required M9 scenario not mapped: {t}")

# ── exit items ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
items_seen = set()
flow_mapped = False
for it in m.get("items", []):
    items_seen.add(it["item"])
    kind = it.get("kind")
    if kind == "tests":
        if it.get("file") == FLOW:
            flow_mapped = True
            if not (ROOT / FLOW).exists():
                bad.append(f"missing file: {FLOW}")
        if it.get("tests"):
            check_tests(it["item"], it)
        else:
            gap(f"exit item without executed tests: {it['item']} → {it.get('completes_in')}")
    elif kind == "evidence":
        if not str(it.get("evidence", "")).startswith("docs/evidence/m9/"):
            bad.append(f"evidence outside docs/evidence/m9: {it['item']}")
        if it.get("status") == "PASSED" and evidence_passed(it["evidence"]):
            continue
        if it.get("status") == "PASSED":
            bad.append(f"marked PASSED without a 'Result: PASS' record: {it['item']} ({it['evidence']})")
        else:
            gap(f"evidence PENDING EXECUTION: {it['item']} → {it.get('completes_in')}")
    elif kind == "deferred":
        if not str(it.get("completes_in", "")).strip():
            bad.append(f"deferred exit item without completes_in: {it['item']}")
        gap(f"deferred exit item: {it['item']} → {it['completes_in']}")
    else:
        bad.append(f"exit item with unknown kind: {it['item']}")
for r in REQUIRED_ITEMS:
    if r not in items_seen:
        bad.append(f"required M9 exit item not mapped: {r}")
if not flow_mapped:
    bad.append(f"the M9 flow is not mapped: {FLOW}")

# ── NFR probes ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
nfr_seen = set()
for n in m.get("nfr", []):
    nid = n.get("id", "")
    nfr_seen.add(nid)
    if nid not in nfr_rows:
        bad.append(f"NFR not in PRD: {nid}")
    for f in ("target", "method", "evidence"):
        if not str(n.get(f, "")).strip():
            bad.append(f"{nid}: no '{f}'")
    p = ROOT / str(n.get("evidence", ""))
    rec = None
    if p.is_file():
        try:
            rec = json.loads(p.read_text())
        except ValueError:
            bad.append(f"{nid}: evidence is not JSON ({n['evidence']})")
    ok = isinstance(rec, dict) and rec.get("id") == nid and rec.get("result") == "PASS" and rec.get("measured") not in (None, "") and rec.get("at")
    if n.get("status") == "PASSED" and not ok:
        bad.append(f"{nid}: marked PASSED without a matching PASS record ({n['evidence']})")
    elif not ok:
        gap(f"{nid} probe PENDING EXECUTION ({n.get('method')})")
for r in REQUIRED_NFR:
    if r not in nfr_seen:
        bad.append(f"required NFR not mapped: {r}")

print(f"mode: {'scaffold (structure only; NOT an exit pass)' if scaffold else 'exit'}")
print(f"report: {len(cases)} tests, {len(failed)} failed, {sum(1 for v in cases.values() if v == 'skipped')} skipped")
print(f"scenarios: {len(tested)} tested + {len(deferred)} deferred ({len(REQUIRED_SCENARIOS)} required); exit items: {len(items_seen)} "
      f"({len(REQUIRED_ITEMS)} required); NFR: {len(nfr_seen)} ({len(REQUIRED_NFR)} required); {mapped} mapped test cases")
for p in pending:
    print("PENDING", p)
for b in bad:
    print("FAIL", b)
sys.exit(1 if bad else 0)
