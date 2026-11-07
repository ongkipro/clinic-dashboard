#!/bin/bash
# T-032 `ci` check (review round 1 P1): the Done-when commands pass in CI for the commit under test.
# Usage: check-ci.sh <sha> <run-id> <receipt-out>
# 1) the run is the `ci` workflow (.github/workflows/ci.yml) on a push to main for <sha>, concluded success;
# 2) its `verify` job's "Run pnpm test" step succeeded; that step runs every suite (`pnpm test`, the
#    same files as `pnpm test:rls`, `pnpm test:isolation` and `pnpm test -- m0`) with RUN_BACKUP_DRILL=1;
# 3) the step's log shows the restore drill passed, the RLS and isolation files ran, and no test failed;
# 4) the tree checked here differs from <sha> only in the T-032 allowed paths.
# Writes a receipt (JSON summary + the log lines used) to <receipt-out>. Read-only `gh`.
set -euo pipefail
SHA=$(git rev-parse "$1"); RUN=$2; OUT=$3
cd "$(git rev-parse --show-toplevel)"
other=$(git diff --name-only "$SHA" -- . ':!docs/evidence/m0' ':!STATUS.md' ':!.delivery'; git ls-files --others --exclude-standard -- . ':!docs/evidence/m0' ':!.delivery')
[ -z "$other" ] || { echo "differs from $SHA outside the T-032 allowed paths:"; echo "$other"; exit 1; }
meta=$(gh run view "$RUN" --json headSha,conclusion,workflowName,workflowDatabaseId,event,headBranch,jobs)
wf=$(gh workflow list --json id,path --jq '.[] | select(.path == ".github/workflows/ci.yml") | .id')
LOG=$(mktemp); trap 'rm -f $LOG' EXIT
gh run view "$RUN" --log > "$LOG"
python3 - "$meta" "$LOG" "$SHA" "$OUT" "$wf" <<'PY'
import json, re, sys
meta, sha, out, wf = json.loads(sys.argv[1]), sys.argv[3], sys.argv[4], sys.argv[5]
# Colour codes: real ESC bytes or the literal "^[" text GitHub logs may carry.
log = [re.sub(r"(\x1b|\^\[)\[[0-9;]*m", "", l) for l in open(sys.argv[2], encoding="utf-8", errors="replace").read().splitlines()]
bad = []
want = {"headSha": sha, "conclusion": "success", "workflowName": "ci", "event": "push", "headBranch": "main"}
for k, v in want.items():
    if meta.get(k) != v: bad.append(f"{k} is {meta.get(k)!r}, want {v!r}")
if not wf or str(meta.get("workflowDatabaseId")) != wf: bad.append(f"workflow id {meta.get('workflowDatabaseId')} is not .github/workflows/ci.yml ({wf})")
steps = [s for j in meta["jobs"] if j["name"] == "verify" for s in j["steps"] if s["name"] == "Run pnpm test"]
if len(steps) != 1 or steps[0]["conclusion"] != "success": bad.append(f"verify > Run pnpm test: {steps}")
test = [l for l in log if "\tRun pnpm test\t" in l]
def find(p): return [l for l in test if re.search(p, l)]
drill = find(r"✓ restores a seeded database to a scratch instance with matching row counts")
files = {f: find(re.escape(f)) for f in ["tests/rls/rls.test.ts", "tests/rls/readers.test.ts", "tests/isolation/isolation.test.ts", "tests/vendor/checklist.test.ts"]}
summary = find(r"\sTests\s+\d+ passed")
failed = find(r"Tests\s+.*\d+ failed") + find(r"Test Files\s+.*\d+ failed")
if not drill: bad.append("restore drill pass line not found")
for f, ls in files.items():
    if not ls: bad.append(f"{f} not in the test step log")
if not summary: bad.append("no test summary line")
if failed: bad.append(f"failures reported: {failed[0][-120:]}")
receipt = {"run": meta, "drill": drill[:1], "summary": summary[-1:], "files": {f: len(v) for f, v in files.items()}, "problems": bad}
json.dump(receipt, open(out, "w"), indent=1)
print(json.dumps({"sha": sha[:7], "workflow": meta.get("workflowName"), "event": meta.get("event"), "step": steps[0]["conclusion"] if steps else None,
                  "summary": summary[-1].split("Tests")[-1].strip() if summary else None, "drill": bool(drill), "problems": bad}))
sys.exit(1 if bad else 0)
PY
