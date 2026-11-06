// DEL-2 isolation gate (`pnpm test:isolation`). Fails when any route, job or export has
// no cross-tenant negative case, then runs every case as tenant A against tenant B.
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_GROUP_ROLE } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { createHarness, type Harness } from "../rls/harness";
import pg from "pg";

const { Pool: PgPool } = pg;
import type { IsolationCase, IsolationEnv, TenantFixture } from "./case";
import {
  coverageViolations,
  discoverSurfaces,
  duplicateSurfaces,
  foreignRouters,
  routeId,
} from "./surfaces";

const ROOT = join(import.meta.dirname, "../..");
const CASES_DIR = join(import.meta.dirname, "cases");

async function loadCases(): Promise<IsolationCase[]> {
  const files = readdirSync(CASES_DIR).filter((f) => f.endsWith(".cases.ts"));
  const modules = await Promise.all(files.map((f) => import(join(CASES_DIR, f))));
  return modules.flatMap((m) => m.default as IsolationCase[]);
}

const cases = await loadCases();

describe("coverage gate", () => {
  it("every route, job and export in src has a cross-tenant negative case", () => {
    expect(coverageViolations(discoverSurfaces(ROOT), cases)).toEqual([]);
  });

  it("no two surfaces share an id", () => {
    expect(duplicateSurfaces(discoverSurfaces(ROOT))).toEqual([]);
  });

  it("no router outside src/app (root app/, pages/, src/pages/)", () => {
    expect(foreignRouters(ROOT)).toEqual([]);
  });

  it("case ids are unique", () => {
    const keys = cases.map((c) => `${c.kind}:${c.id}`);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });
});

// Self-test on a fixture tree: proves the gate fails for an untested route, job and
// export, and passes once each has a case.
describe("coverage gate self-test", () => {
  // Copied to a temp dir so a worker test file can be added without Vitest running it.
  const tree = mkdtempSync(join(tmpdir(), "isolation-tree-"));
  cpSync(join(import.meta.dirname, "fixtures/tree"), tree, { recursive: true });
  writeFileSync(join(tree, "src/workers/reminders.test.ts"), "export {};\n");
  const surfaces = discoverSurfaces(tree);
  afterAll(() => rmSync(tree, { recursive: true, force: true }));

  it("discovers pages, handlers, parallel defaults, server actions, workers and exports", () => {
    expect(surfaces.map((s) => `${s.kind}:${s.id}`)).toEqual([
      "action:modules/patients/actions",
      "export:modules/patients/patients.export",
      "job:workers/reminders",
      "route:/@panel#default",
      "route:/api/v1/branches#route",
      "route:/pasien/[id]",
    ]);
  });

  it("refuses routers outside src/app", () => {
    const root = mkdtempSync(join(tmpdir(), "isolation-root-"));
    try {
      mkdirSync(join(root, "pages"));
      mkdirSync(join(root, "app"));
      expect(foreignRouters(root)).toEqual(["app", "pages"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails on a deliberately untested route", () => {
    const tested = surfaces.filter((s) => s.id !== "/pasien/[id]");
    expect(coverageViolations(surfaces, tested, [])).toEqual([
      "route:/pasien/[id] (src/app/(app)/pasien/[id]/page.tsx): no cross-tenant negative test",
    ]);
  });

  it("fails on untested server actions, jobs and exports", () => {
    const v = coverageViolations(surfaces, surfaces.filter((s) => s.kind === "route"), []);
    expect(v.map((x) => x.split(" ")[0])).toEqual([
      "action:modules/patients/actions",
      "export:modules/patients/patients.export",
      "job:workers/reminders",
    ]);
  });

  it("passes when every surface has a case", () => {
    expect(coverageViolations(surfaces, surfaces, [])).toEqual([]);
  });

  it("fails on stale cases, stale exemptions and double classification", () => {
    const v = coverageViolations(
      surfaces,
      [...surfaces, { kind: "route", id: "/gone" }],
      [
        { kind: "route", id: "/old", reason: "removed" },
        { kind: "route", id: "/pasien/[id]", reason: "x" },
        { kind: "job", id: "workers/reminders", reason: " " },
      ],
    );
    expect(v).toEqual([
      "job:workers/reminders: both exempt and tested; remove the exemption",
      "job:workers/reminders: exemption without a reason",
      "route:/gone: case for a surface that does not exist",
      "route:/old: stale exemption",
      "route:/pasien/[id]: both exempt and tested; remove the exemption",
    ]);
  });

  it("builds distinct route ids: groups dropped, intercepts and file kinds kept", () => {
    expect(routeId("(app)/(kasir)/kasir/page.tsx")).toBe("/kasir");
    expect(routeId("page.tsx")).toBe("/");
    expect(routeId("feed/(..)photo/[id]/page.tsx")).toBe("/feed/(..)photo/[id]");
    expect(routeId("feed/(.)photo/page.tsx")).toBe("/feed/(.)photo");
    expect(routeId("(...)login/page.tsx")).toBe("/(...)login");
    expect(routeId("@modal/default.tsx")).toBe("/@modal#default");
    expect(routeId("[slug]/opengraph-image.tsx")).toBe("/[slug]#opengraph-image");
    expect(routeId("api/v1/x/route.ts")).toBe("/api/v1/x#route");
  });

  it("flags two files that map to one surface id", () => {
    const s = (file: string) => ({ kind: "route" as const, id: "/x", file });
    expect(duplicateSurfaces([s("a"), s("b")])).toEqual(["route:/x: a, b"]);
  });
});

describe("cross-tenant negative cases", () => {
  let h: Harness;
  let app: pg.Pool;
  let owner: pg.Pool;
  let a: TenantFixture;
  let b: TenantFixture;

  async function fixture(name: string): Promise<TenantFixture> {
    const tenantId = (
      await h.admin.query(`insert into tenants_registry default values returning id`)
    ).rows[0].id as string;
    await h.admin.query(
      `insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`,
      [tenantId, name],
    );
    const branchId = (
      await h.admin.query(
        `insert into branches (tenant_id, code, name, timezone)
         values ($1, 'CAB01', $2, 'Asia/Jakarta') returning id`,
        [tenantId, `${name} Cabang`],
      )
    ).rows[0].id as string;
    return { tenantId, branchId, legalName: name };
  }

  function envFor(actor: TenantFixture, secrets: Set<string>): IsolationEnv {
    return { app, owner, actor, victim: b, victimSecret: (v) => void secrets.add(v) };
  }

  beforeAll(async () => {
    if (cases.length === 0) return;
    h = await createHarness();
    app = await openAppPool({
      connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])),
      max: 4,
    });
    owner = new PgPool({ connectionString: h.ownerUrl(), max: 2 });
    a = await fixture("PT Sintetis A");
    b = await fixture("PT Sintetis B");
  });

  afterAll(async () => {
    await owner?.end();
    await app?.end();
    await h?.close();
  });

  it.skipIf(cases.length > 0)("no cases yet: foundation has no tenant surface", () => {
    expect(cases).toEqual([]);
  });

  for (const c of cases) {
    it(`${c.kind}:${c.id} never returns tenant B data`, async () => {
      const unwrap = (r: unknown) =>
        c.kind === "route" ? (r as { status: number; body: unknown }) : { status: 200, body: r };
      // Actions and jobs: every attempt is reported (HYG-010 N-1).
      const attemptsOf = (r: unknown) => {
        const a = (r as { attempts?: unknown }).attempts;
        expect(a && typeof a === "object" && Object.keys(a).length > 0, "action/job case must report attempts").toBe(true);
        return a as Record<string, string>;
      };

      // One secret set for both runs: secrets a case registers while seeding B in the
      // positive control are checked in the negative run too.
      const secrets = new Set([b.tenantId, b.branchId, b.legalName]);

      // Positive control: as B itself the surface must return B's marker.
      const own = envFor(b, secrets);
      const ownResult = unwrap(await c.run(own));
      expect(isPlainJson(ownResult.body), "result must be plain JSON").toBe(true);
      expect(ownResult.status, "positive control status").toBeGreaterThanOrEqual(200);
      expect(ownResult.status, "positive control status").toBeLessThan(300);
      const marker = c.marker(own);
      expect(JSON.stringify(ownResult.body), "positive control must return B data").toContain(
        marker,
      );
      secrets.add(marker);
      if (c.kind !== "route") {
        // Every attempt must succeed as B itself (review P1): an attempt B could not make either
        // would accept any refusal from A and hide a cross-tenant regression.
        for (const [name, outcome] of Object.entries(attemptsOf(ownResult.body))) {
          expect(outcome, `${name}: positive control, the attempt as B itself must succeed`).toBe("done");
        }
      }

      // Negative: as A, nothing of B may appear.
      const env = envFor(a, secrets);
      const result = unwrap(await c.run(env));
      expect(isPlainJson(result.body), "result must be plain JSON").toBe(true);
      const text = JSON.stringify(result.body) ?? "";
      for (const secret of secrets) expect(text).not.toContain(secret);
      if (c.kind !== "route") {
        const attempts = attemptsOf(result.body);
        for (const [name, outcome] of Object.entries(attempts)) {
          expect(outcome, `${name}: as tenant A an attempt on B must be refused`).not.toBe("done");
          expect(outcome, `${name}: refusal must be an error code`).toMatch(/^(ERR_[A-Z_]+|refused|not_seen)$/);
        }
      }
      if (c.kind === "route" && c.expect === "not-found") expect(result.status).toBe(404);
      if (c.kind === "route" && c.expect === "filtered") {
        expect(result.status).toBeGreaterThanOrEqual(200);
        expect(result.status).toBeLessThan(300);
      }
    });
  }
});

function isPlainJson(value: unknown): boolean {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isPlainJson);
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.values(value as object).every(isPlainJson);
  }
  return false;
}
