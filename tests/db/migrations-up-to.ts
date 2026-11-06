// A copy of drizzle/ that ends at `tag` (inclusive): later migration files and snapshots are
// removed and the journal is cut after that entry. Drift tests migrate a database to an exact
// point with it, so a proof about one migration does not change when later ones are added.
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS_FOLDER } from "../../src/db/migrate";

type Journal = { entries: { idx: number; tag: string }[] };

export function migrationsUpTo(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `migrations-${tag.slice(0, 4)}-`));
  cpSync(MIGRATIONS_FOLDER, dir, { recursive: true });
  const journal = JSON.parse(readFileSync(join(dir, "meta/_journal.json"), "utf8")) as Journal;
  const at = journal.entries.findIndex((e) => e.tag === tag);
  if (at < 0) throw new Error(`migration ${tag} is not in the journal`);
  for (const e of journal.entries.slice(at + 1)) {
    rmSync(join(dir, `${e.tag}.sql`));
    const snap = join(dir, `meta/${String(e.idx).padStart(4, "0")}_snapshot.json`);
    if (existsSync(snap)) rmSync(snap);
  }
  journal.entries = journal.entries.slice(0, at + 1);
  writeFileSync(join(dir, "meta/_journal.json"), JSON.stringify(journal));
  return dir;
}
