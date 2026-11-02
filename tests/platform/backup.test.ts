// T-005 restore drill (DR-1): runs ops/pgbackrest/restore-drill.sh, which needs Docker.
// Opt-in with RUN_BACKUP_DRILL=1 because it takes about 90 s. Not yet in CI (ci.yml is
// outside T-005; tracked in STATUS.md).
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const drill = join(import.meta.dirname, "../../ops/pgbackrest/restore-drill.sh");

describe.skipIf(process.env.RUN_BACKUP_DRILL !== "1")("pgBackRest restore drill", () => {
  it("restores a seeded database to a scratch instance with matching row counts", () => {
    const out = execFileSync(drill, { encoding: "utf8", timeout: 600_000 });
    expect(out).toContain("RESTORE DRILL PASSED");
  }, 600_000);
});
