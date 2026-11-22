// Ringkasan Owner (T-109): one reader call under a SAVEPOINT. A reader that refuses (a role it does not admit, a branch that is not found) or fails rolls back to its
// savepoint and answers null — the caller turns that into an `unavailable` figure with a reason, never a 0 and never a failed screen — and the surrounding
// transaction stays usable for the next reader. A dead connection is NOT swallowed: the rollback itself throws and the page's error boundary shows the error state.
import type pg from "pg";
import { CommandError } from "../../../../lib/command";

let seq = 0;
export async function guarded<T>(db: pg.ClientBase, what: string, fn: () => Promise<T>): Promise<T | null> {
  const sp = `rk${++seq}`;
  await db.query(`savepoint ${sp}`);
  try {
    const r = await fn();
    await db.query(`release savepoint ${sp}`);
    return r;
  } catch (e) {
    await db.query(`rollback to savepoint ${sp}`);
    const refused = e instanceof CommandError && ["ERR_FORBIDDEN", "ERR_NOT_FOUND", "ERR_INVALID_INPUT"].includes(e.code);
    if (!refused) console.error("ringkasan/owner: reader failed", { reader: what, error: e instanceof Error ? e.name : "unknown" });
    return null;
  }
}
