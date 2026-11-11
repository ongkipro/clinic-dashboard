// HYG-015: every test database connection has an `error` listener, so a backend terminated while
// a connection is idle or checked out never fails the run as an unhandled error (CI 42615137831,
// 42753612376 attempt 1: `57P01` with 0 failed tests). Two parts:
// - structure: no file under tests/ or docs/evidence/ builds a raw pg pool or client; all go
//   through testPool/testClient (tests/rls/harness.ts). The scan reads the TypeScript AST, so
//   comments and strings never count and `new Client(auth)` from tests/auth/helpers is not pg's;
// - behaviour: a terminated idle pool client, a terminated checked-out pool client, a terminated
//   idle client and a terminated in-flight query raise no process-level error, while the query
//   still rejects (nothing is swallowed).
import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness, testClient, testPool } from "./harness";

const ROOT = join(import.meta.dirname, "../..");
// The harness defines the helpers. The M1/M2 exit flow tests are committed milestone evidence,
// kept byte-identical; they attach their own listeners (asserted below).
const EXEMPT = new Set(["tests/rls/harness.ts", "docs/evidence/m1/m1-flow.test.ts", "docs/evidence/m2/m2-flow.test.ts"]);

// Raw constructions in one source text: `new X.Pool|Client(` where X is bound to the pg module, and
// `new Pool|Client(` where the name is imported or destructured from "pg" or "pg-pool".
function rawConstructions(text: string, file = "scan.ts"): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const diagnostics = (sf as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics;
  if (diagnostics.length) throw new Error(`scan ${file}: ${ts.flattenDiagnosticMessageText(diagnostics[0].messageText, " ")}`);
  const PG = new Set(["pg", "pg-pool"]);
  const modules = new Set<string>(); // local names bound to the module itself
  const ctors = new Set<string>(); // local names bound to Pool or Client
  const fromPg = (e: ts.Expression | undefined): boolean => {
    if (!e) return false;
    if (ts.isAwaitExpression(e) || ts.isParenthesizedExpression(e)) return fromPg(e.expression);
    if (ts.isPropertyAccessExpression(e) && e.name.text === "default") return fromPg(e.expression);
    if (ts.isCallExpression(e) && e.arguments.length === 1 && ts.isStringLiteral(e.arguments[0]) && PG.has(e.arguments[0].text))
      return e.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(e.expression) && e.expression.text === "require");
    return false;
  };
  const bindPattern = (name: ts.BindingName) => {
    if (ts.isIdentifier(name)) return modules.add(name.text);
    if (ts.isObjectBindingPattern(name))
      for (const el of name.elements) {
        const key = (el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : ts.isIdentifier(el.name) ? el.name.text : "");
        if (key === "default" && ts.isIdentifier(el.name)) modules.add(el.name.text);
        else if ((key === "Pool" || key === "Client") && ts.isIdentifier(el.name)) ctors.add(el.name.text);
      }
  };
  const collect = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && PG.has(node.moduleSpecifier.text) && node.importClause) {
      const c = node.importClause;
      if (c.name) {
        if (node.moduleSpecifier.text === "pg-pool") ctors.add(c.name.text);
        else modules.add(c.name.text);
      }
      const nb = c.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) modules.add(nb.name.text);
      if (nb && ts.isNamedImports(nb))
        for (const el of nb.elements) {
          const key = (el.propertyName ?? el.name).text;
          if (key === "Pool" || key === "Client") ctors.add(el.name.text);
          if (key === "default") modules.add(el.name.text);
        }
    }
    if (ts.isVariableDeclaration(node) && fromPg(node.initializer)) bindPattern(node.name);
    node.forEachChild(collect);
  };
  collect(sf);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isNewExpression(node)) {
      const e = node.expression;
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      if (ts.isPropertyAccessExpression(e) && (e.name.text === "Pool" || e.name.text === "Client") && ts.isIdentifier(e.expression) && modules.has(e.expression.text))
        found.push(`${file}:${line} new ${e.expression.text}.${e.name.text}`);
      else if (ts.isIdentifier(e) && ctors.has(e.text)) found.push(`${file}:${line} new ${e.text}`);
    }
    node.forEachChild(visit);
  };
  visit(sf);
  return found;
}

describe("HYG-015 structure: no raw pg pool or client in tests", () => {
  it("every file under tests/ and docs/evidence/ uses testPool/testClient", () => {
    const files = globSync(["tests/**/*.ts", "docs/evidence/**/*.ts"], { cwd: ROOT }).sort();
    expect(files.length).toBeGreaterThan(100);
    const raw = files.filter((f) => !EXEMPT.has(f)).flatMap((f) => rawConstructions(readFileSync(join(ROOT, f), "utf8"), f));
    expect(raw).toEqual([]);
  });

  it("the scan finds every construction form and ignores comments, strings and other Clients (positive control)", () => {
    const planted = [
      'import pg from "pg";\nconst a = new pg.Pool({});\nconst b = new pg.Client({});',
      'import * as db from "pg";\nconst a = new db.Pool();',
      'import { Pool as P, Client } from "pg";\nconst a = new P();\nconst b = new Client();',
      'import Pool from "pg-pool";\nconst a = new Pool();',
      'const pg = (await import("pg")).default;\nconst a = new pg.Pool();',
      'const { Client: C } = await import("pg");\nconst a = new C();',
      'const pg = require("pg");\nconst a = new pg.Client();',
    ];
    expect(planted.map((t) => rawConstructions(t).length)).toEqual([2, 1, 2, 1, 1, 1, 1]);
    const clean = [
      'import pg from "pg";\n// new pg.Pool({}) in a comment\nconst s = "new pg.Client()";\nlet p: pg.Pool;',
      'import { Client } from "../auth/helpers";\nconst c = new Client(auth);',
      'import { testPool } from "./harness";\nconst p = testPool({});',
    ];
    expect(clean.map((t) => rawConstructions(t))).toEqual([[], [], []]);
  });

  it("the exempt milestone flow tests still attach their own listeners", () => {
    expect(readFileSync(join(ROOT, "docs/evidence/m1/m1-flow.test.ts"), "utf8")).toContain('owner.on("error", () => {});');
    const m2 = readFileSync(join(ROOT, "docs/evidence/m2/m2-flow.test.ts"), "utf8");
    expect(m2).toContain('owner.on("error", () => {});');
    expect(m2).toContain('app.on("error", () => {});');
  });
});

describe("HYG-015 behaviour: a terminated backend is not an unhandled error", () => {
  let h: Harness;
  const seen: unknown[] = [];
  let wake = () => {};
  const onProcess = (e: unknown) => {
    seen.push(e);
    wake();
  };
  const pid = async (q: { query: (s: string) => Promise<{ rows: { p: number }[] }> }) => (await q.query("select pg_backend_pid() as p")).rows[0].p;
  const kill = (p: number) => h.admin.query("select pg_terminate_backend($1)", [p]);
  // Resolves when the connection ends, or when the process sees an error: without a listener pg
  // throws before it emits `end`, so waiting for `end` alone would hang instead of failing.
  const ended = (c: { once: (e: "end", f: () => void) => unknown }) =>
    new Promise<void>((r) => {
      c.once("end", () => r());
      wake = r;
      setTimeout(r, 10_000);
    });
  const settle = () => new Promise((r) => setTimeout(r, 100));
  // A client whose error was thrown (the mutated, listener-less case) never finishes ending;
  // cleanup must not hang the case so its assertion is what reports.
  const end = (x: { end: () => Promise<void> }) => Promise.race([x.end().catch(() => {}), new Promise((r) => setTimeout(r, 2_000))]);

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });
  // vitest records uncaught errors itself; these spies make the assertion local to each case.
  afterEach(() => {
    process.off("uncaughtException", onProcess);
    process.off("unhandledRejection", onProcess);
  });
  const watch = () => {
    seen.length = 0;
    process.on("uncaughtException", onProcess);
    process.on("unhandledRejection", onProcess);
  };

  it("an idle pool client whose backend is terminated is dropped by the pool, no process error", async () => {
    watch();
    const pool = testPool({ connectionString: h.ownerUrl(), max: 1 });
    try {
      const c = await pool.connect();
      const p = await pid(c);
      const gone = ended(c);
      c.release();
      expect(pool.idleCount).toBe(1);
      await kill(p);
      await gone;
      await settle();
      expect(pool.totalCount).toBe(0);
      expect(seen).toEqual([]);
      expect((await pool.query("select 1 as one")).rows[0].one).toBe(1); // a fresh client serves the next query
    } finally {
      await end(pool);
    }
  });

  it("a checked-out pool client (no pg-pool idle listener) whose backend is terminated: no process error; its next query rejects", async () => {
    watch();
    const pool = testPool({ connectionString: h.ownerUrl(), max: 1 });
    try {
      const c = await pool.connect();
      const gone = ended(c);
      await kill(await pid(c));
      await gone;
      await settle();
      expect(seen).toEqual([]);
      await expect(c.query("select 1")).rejects.toThrow();
      c.release(true);
    } finally {
      await end(pool);
    }
  });

  it("an idle testClient whose backend is terminated: no process error", async () => {
    watch();
    const c = testClient({ connectionString: h.ownerUrl() });
    await c.connect();
    try {
      const gone = ended(c);
      await kill(await pid(c));
      await gone;
      await settle();
      expect(seen).toEqual([]);
      await expect(c.query("select 1")).rejects.toThrow();
    } finally {
      await end(c);
    }
  });

  it("an in-flight query on a terminated testClient still rejects with 57P01 (nothing swallowed), no process error", async () => {
    watch();
    const c = testClient({ connectionString: h.ownerUrl() });
    await c.connect();
    try {
      const p = await pid(c);
      const q = c.query("select pg_sleep(30)");
      const result = q.then(() => "resolved", (e: { code?: string }) => e.code ?? "rejected");
      const until = Date.now() + 10_000;
      while ((await h.admin.query("select 1 from pg_stat_activity where pid = $1 and query like 'select pg_sleep%'", [p])).rowCount === 0) {
        if (Date.now() > until) throw new Error("sleep never started");
        await new Promise((r) => setTimeout(r, 25));
      }
      await kill(p);
      expect(await result).toBe("57P01");
      await settle();
      expect(seen).toEqual([]);
    } finally {
      await end(c);
    }
  });
});
