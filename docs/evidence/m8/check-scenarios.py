#!/usr/bin/env python3
"""T-119 scenario, exit-item and journey map check (M8; the M6 checker extended with journeys and an explicit deferral list).

Usage: check-scenarios.py [--final] <junit.xml>
- every required M8 scenario title is a "Scenario: <title>" line of docs/spec/02-PRD.md §8 and is either mapped to tests or deferred to a
  named task (with --final, a deferred scenario, exit item or journey is a failure: T-119 closes only when everything is mapped);
- the M8 exit items (PLAN.md §1 M8) are each mapped or deferred, the m8 flow among the mapped ones;
- the Phase 1 demo journeys J1–J8 and J10 (02-PRD §Journeys) are each mapped;
- every entry states what it proves; every scenario states what is open; every deferred entry names its task;
- an entry may carry `owner_amended`: a list of {id, what, amendment, scope, tracked_in}. Every entry must equal, field by field, one
  entry of the reviewed allowlist OWNER_AMENDMENTS below (the owner's decision t119/final/OWNER-AMENDMENT-M8-EXIT-20261123.md, R3 f2
  review): the same id, on the same exit item, citing that exact file, with exactly that scope — an unknown id, another item, an extra or
  missing scope member, a duplicate, or any other file (even with the OWNER-AMENDMENT- prefix) fails the check, final or not. With --final
  an allowlisted entry is REPORTED as "AMENDED (not passed)", never counted as proven and never a failure; any `final_required` entry
  still fails --final unconditionally;
- every mapped test name's last segment occurs verbatim in its file;
- in the JUnit report every mapped test is present exactly once (normalized file path and "describe > test"),
  passed (no failure, error or skipped child), and the report has no failure or error anywhere.
A JUnit report is required: structure alone never passes.
"""
import json
import os
import pathlib
import sys
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[3]
REQUIRED_SCENARIOS = [
    "PR-25 liability roll-forward", "PR-26 period lock",
    "PR-33a K2 at executing branch", "PR-33b stock risk", "PR-33c shift summary", "PR-33d own figures only", "PR-33e overdue leads",
    "PR-33f roll-forward", "PR-33g Admin Pusat setup view", "PR-34 reconciliation", "PR-62 health without content", "PR-80 digest",
    "PR-95 report definition", "PR-98 Coretax export gated",
]
REQUIRED_ITEMS = [
    "M8 exit: ledger reconciles to sub-ledgers on the §3 fixtures",
    "M8 exit: statements balance; journal export fail-closed",
    "M8 exit: KPI values equal fixture expectations for K1–K19 and PR-95 metrics",
    "M8 exit: owner walkthrough J1–J8, J10 recorded",
    "M8 exit: SATUSEHAT steps of J3 / J6 on recorded fixtures",
]
REQUIRED_JOURNEYS = ["J1 Lead to booking", "J2 Arrival and intake", "J3 Examination and plan", "J4 Selection and payment", "J5 Treatment",
                     "J6 Dispensing and close", "J7 Package lifecycle", "J8 Month end", "J10 Server-fee month"]
FLOW = "docs/evidence/m8/m8-flow.test.ts"
# Reviewed allowlist (R3 f2, panel 3): the ONLY owner amendments to the M8 exit scope. Changing it is a reviewed change, never a map edit.
AMENDMENT_SOURCE = "t119/final/OWNER-AMENDMENT-M8-EXIT-20261123.md"
OWNER_AMENDMENTS = {
    "M8-AMEND-1-DRAFT-KPI": {"item": "M8 exit: KPI values equal fixture expectations for K1–K19 and PR-95 metrics", "amendment": AMENDMENT_SOURCE,
                             "scope": ["K12", "K14", "K15", "K17", "K4"]},
    "M8-AMEND-2-GQ4-U1-U4": {"item": "M8 exit: ledger reconciles to sub-ledgers on the §3 fixtures", "amendment": AMENDMENT_SOURCE,
                             "scope": ["G-Q4 U1", "G-Q4 U2", "G-Q4 U3", "G-Q4 U4"]},
}

args = sys.argv[1:]
final = "--final" in args
args = [a for a in args if a != "--final"]
if len(args) != 1:
    sys.exit("usage: check-scenarios.py [--final] <junit.xml>")
m = json.loads((ROOT / "docs/evidence/m8/scenarios.json").read_text())
prd = (ROOT / "docs/spec/02-PRD.md").read_text()
titles = {l[len("Scenario: "):].strip() for l in prd.splitlines() if l.startswith("Scenario: ")}
journey_rows = {l.split("|")[1].strip() for l in prd.splitlines() if l.startswith("| J") and l.count("|") > 3}
bad = []


def norm(p: str) -> str:
    p = p.replace("\\", "/")
    return os.path.normpath(p[len(str(ROOT)) + 1:] if p.startswith(str(ROOT) + "/") else p)


root = ET.parse(args[0]).getroot()
# aggregate errors / failures on the root or a suite (an initialization or hook failure with no failed testcase) fail the report
for el in [root, *root.iter("testsuite")]:
    for attr in ("errors", "failures"):
        if int(el.get(attr) or 0) > 0:
            bad.append(f"report {el.tag} {el.get('name', '')!r} has {attr}={el.get(attr)}")
cases = {}
dupes = set()
for tc in root.iter("testcase"):
    k = (norm(tc.get("classname", "")), tc.get("name", ""))
    if k in cases:
        dupes.add(k)
    kinds = {c.tag for c in tc}
    state = "failed" if kinds & {"failure", "error"} else "skipped" if "skipped" in kinds else "passed"
    # a duplicate never overwrites a failure (an earlier failed case with the same key stays failed)
    cases[k] = "failed" if cases.get(k) == "failed" else state
failed = [k for k, v in cases.items() if v == "failed"]
if failed:
    bad.append(f"{len(failed)} failed test(s) in the report, e.g. {failed[0][0]} > {failed[0][1]}")

mapped = 0
amended: list = []
amended_ids: set = set()


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
    oa = entry.get("owner_amended")
    if oa is not None:
        if not (isinstance(oa, list) and oa):
            bad.append(f"owner_amended must be a non-empty list: {label}")
        else:
            for a in oa:
                aid = a.get("id") if isinstance(a, dict) else None
                pin = OWNER_AMENDMENTS.get(aid)
                if pin is None:
                    bad.append(f"owner_amended id not in the reviewed allowlist: {aid!r} on {label}")
                    continue
                if aid in amended_ids:
                    bad.append(f"owner_amended duplicate: {aid} on {label}")
                    continue
                amended_ids.add(aid)
                if label != pin["item"]:
                    bad.append(f"owner_amended {aid} placed on another item: {label} (allowed: {pin['item']})")
                elif a.get("amendment") != pin["amendment"]:
                    bad.append(f"owner_amended {aid} cites an unreviewed source: {a.get('amendment')!r} (allowed: {pin['amendment']})")
                elif not isinstance(a.get("scope"), list) or sorted(a["scope"]) != pin["scope"] or len(set(a["scope"])) != len(a["scope"]):
                    bad.append(f"owner_amended {aid} scope differs from the reviewed scope: {a.get('scope')!r} (allowed: {pin['scope']})")
                elif not all(isinstance(a.get(k), str) and a[k].strip() for k in ("what", "tracked_in")):
                    bad.append(f"owner_amended {aid} needs what / tracked_in: {label}")
                elif final:
                    amended.append(f"{label}: {aid} {sorted(a['scope'])} — {a['what']} ({AMENDMENT_SOURCE}; tracked in {a['tracked_in']})")
    fr = entry.get("final_required")
    if fr is not None and not (isinstance(fr, list) and fr and all(isinstance(x, str) and x.strip() for x in fr)):
        bad.append(f"final_required must be a non-empty list of strings: {label}")
    elif fr and final:
        for x in fr:
            bad.append(f"--final: {label} still requires: {x}")
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


# scenarios: mapped or deferred, never both
mapped_s = set()
for s in m["scenarios"]:
    if s["scenario"] not in titles:
        bad.append(f"scenario not in PRD §8: {s['scenario']}")
    if not str(s.get("open", "")).strip():
        bad.append(f"no 'open': {s['scenario']} ({s['file']})")
    mapped_s.add(s["scenario"])
    check_tests(s["scenario"], s)
deferred_s = set()
for d in m.get("deferred", []):
    if d["scenario"] not in titles:
        bad.append(f"deferred scenario not in PRD §8: {d['scenario']}")
    if not str(d.get("completes_in", "")).strip():
        bad.append(f"deferred scenario without completes_in: {d['scenario']}")
    if d["scenario"] in mapped_s:
        bad.append(f"scenario both mapped and deferred: {d['scenario']}")
    deferred_s.add(d["scenario"])
    if final:
        bad.append(f"--final: scenario still deferred: {d['scenario']} ({d['completes_in']})")
for t in REQUIRED_SCENARIOS:
    if t not in mapped_s | deferred_s:
        bad.append(f"required M8 scenario neither mapped nor deferred: {t}")

# exit items: mapped (the flow among them) or deferred
flow_mapped = False
items_seen = set()
for it in m.get("items", []):
    items_seen.add(it["item"])
    if it["file"] == FLOW:
        flow_mapped = True
    check_tests(it["item"], it)
items_deferred = set()
for d in m.get("deferred_items", []):
    if not str(d.get("completes_in", "")).strip():
        bad.append(f"deferred item without completes_in: {d['item']}")
    if d["item"] in items_seen:
        bad.append(f"item both mapped and deferred: {d['item']}")
    items_deferred.add(d["item"])
    if final:
        bad.append(f"--final: exit item still deferred: {d['item']} ({d['completes_in']})")
for r in REQUIRED_ITEMS:
    if r not in items_seen | items_deferred:
        bad.append(f"required M8 exit item neither mapped nor deferred: {r}")
if not flow_mapped:
    bad.append(f"the M8 flow is not mapped: {FLOW}")

# journeys: every required one mapped, each a row of the PRD journey table
journeys_seen = set()
for j in m.get("journeys", []):
    if j["journey"] not in journey_rows:
        bad.append(f"journey not in the PRD journey table: {j['journey']}")
    journeys_seen.add(j["journey"])
    check_tests(j["journey"], j)
for r in REQUIRED_JOURNEYS:
    if r not in journeys_seen:
        bad.append(f"required Phase 1 journey not mapped: {r}")

print(f"report: {len(cases)} tests, {len(failed)} failed, {sum(1 for v in cases.values() if v == 'skipped')} skipped")
print(f"scenarios: {len(mapped_s)} mapped + {len(deferred_s)} deferred ({len(REQUIRED_SCENARIOS)} required); "
      f"exit items: {len(items_seen)} mapped + {len(items_deferred)} deferred ({len(REQUIRED_ITEMS)} required); "
      f"journeys: {len(journeys_seen)} ({len(REQUIRED_JOURNEYS)} required); {mapped} mapped test cases, all required to pass"
      f"{' [final]' if final else ''}")
for a in amended:
    print("AMENDED (owner exception to the exit scope, not passed):", a)
for b in bad:
    print("FAIL", b)
sys.exit(1 if bad else 0)
