// DEL-2 isolation gate: discovers every tenant-facing surface and matches it to a
// cross-tenant negative case. Conventions (DEC-008):
// - route: every App Router `page.*`, `route.*` or parallel-route `default.*` under
//   src/app (plus metadata routes); id is the URL path with route groups removed and
//   `#file` for non-page files, e.g. src/app/(app)/pasien/[id]/page.tsx -> /pasien/[id],
//   src/app/(app)/@panel/default.tsx -> /@panel#default
// - action: every module under src whose first statement is "use server" (Server
//   Actions are POST endpoints); id is its path without extension
// - job:   every module under src/workers (tests excluded); id is its path without extension
// - export: every `*.export.ts` under src; id is its path without extension
// Routers outside src/app (root app/, pages/, src/pages/) are refused outright, and
// function-level "use server" (inline actions) is forbidden by ESLint, so every Server
// Action lives in a discoverable module.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

export type SurfaceKind = "route" | "action" | "job" | "export";
export type Surface = { kind: SurfaceKind; id: string; file: string };

function walk(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

const CODE = /\.(ts|tsx|js|jsx|mjs|cts|mts)$/;
// Files Next.js serves as HTTP endpoints: pages, route handlers, parallel-route defaults
// and metadata routes (which can render tenant data).
const ROUTE_FILE =
  /^(page|route|default|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\.(ts|tsx|js|jsx|mjs)$/;
const TEST = /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cts|mts)$/;

// Route groups `(name)` are dropped; intercepting markers `(.)x`, `(..)x`, `(...)x` are
// kept so an intercepted page never shares an id with the page it intercepts. The file
// name is appended for non-page files so page, default and metadata routes stay apart.
export function routeId(appRelative: string): string {
  const parts = appRelative.split(sep);
  const file = (parts.pop() ?? "").replace(CODE, "");
  const segments = parts.filter((s) => !/^\([^.)][^)]*\)$/.test(s));
  const path = "/" + segments.join("/");
  return file === "page" ? path : `${path}#${file}`;
}

export function discoverSurfaces(root: string): Surface[] {
  const src = join(root, "src");
  const app = join(src, "app");
  const out: Surface[] = [];
  for (const file of walk(app)) {
    const name = file.split(sep).pop() ?? "";
    if (ROUTE_FILE.test(name)) {
      out.push({ kind: "route", id: routeId(relative(app, file)), file: relative(root, file) });
    }
  }
  for (const file of walk(src)) {
    if (CODE.test(file) && !TEST.test(file) && isServerActionModule(file)) {
      out.push({ kind: "action", id: relative(src, file).replace(CODE, ""), file: relative(root, file) });
    }
  }
  for (const file of walk(join(src, "workers"))) {
    if (CODE.test(file) && !TEST.test(file)) {
      out.push({ kind: "job", id: relative(src, file).replace(CODE, ""), file: relative(root, file) });
    }
  }
  for (const file of walk(src)) {
    if (/\.export\.(ts|tsx|js|mjs)$/.test(file)) {
      out.push({
        kind: "export",
        id: relative(src, file).replace(CODE, ""),
        file: relative(root, file),
      });
    }
  }
  return out.sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
}

// A module-level "use server" directive: the first statement, after comments.
export function isServerActionModule(file: string): boolean {
  let text = readFileSync(file, "utf8").trimStart();
  for (;;) {
    const comment = /^(\/\/[^\n]*(\n|$)|\/\*[\s\S]*?\*\/)/.exec(text);
    if (!comment) break;
    text = text.slice(comment[0].length).trimStart();
  }
  return /^["']use server["']/.test(text);
}

// Next.js serves these instead of (or beside) src/app; the gate cannot see them.
export function foreignRouters(root: string): string[] {
  return ["app", "pages", "src/pages"].filter((d) => existsSync(join(root, d)));
}

export function duplicateSurfaces(surfaces: readonly Surface[]): string[] {
  const seen = new Map<string, string[]>();
  for (const s of surfaces) seen.set(`${s.kind}:${s.id}`, [...(seen.get(`${s.kind}:${s.id}`) ?? []), s.file]);
  return [...seen].filter(([, files]) => files.length > 1).map(([k, f]) => `${k}: ${f.join(", ")}`);
}

export type SurfaceRef = { kind: SurfaceKind; id: string };
export type Exemption = SurfaceRef & { reason: string };

// Surfaces without tenant data. Each needs a reason; a stale exemption fails the gate.
// Account-level auth surfaces (T-006) run as clinic_auth, which has no privilege on any
// tenant table (tests/auth proves it); they are exempt until they read tenant data.
const AUTH = "account-level auth (clinic_auth role, no tenant tables; tests/auth)";
export const EXEMPT: Exemption[] = [
  { kind: "route", id: "/", reason: "bootstrap placeholder page; renders no tenant data" },
  { kind: "route", id: "/api/auth/[...all]#route", reason: AUTH },
  { kind: "route", id: "/masuk", reason: AUTH },
  { kind: "route", id: "/verifikasi", reason: AUTH },
  { kind: "route", id: "/aktifkan-2fa", reason: AUTH },
  { kind: "route", id: "/terkunci", reason: AUTH },
  { kind: "action", id: "app/(auth)/terkunci/actions", reason: AUTH },
  { kind: "route", id: "/dev/galeri", reason: "development-only component gallery, refused in production (T-012)" },
  { kind: "route", id: "/dev/templat", reason: "development-only page-template gallery with static sample data, refused in production (T-014)" },
];

const key = (s: SurfaceRef) => `${s.kind}:${s.id}`;

export function coverageViolations(
  surfaces: readonly Surface[],
  cases: readonly SurfaceRef[],
  exempt: readonly Exemption[] = EXEMPT,
): string[] {
  const out: string[] = [];
  const surfaceKeys = new Set(surfaces.map(key));
  const caseKeys = new Set(cases.map(key));
  const exemptKeys = new Set(exempt.map(key));
  for (const s of surfaces) {
    if (!caseKeys.has(key(s)) && !exemptKeys.has(key(s))) {
      out.push(`${key(s)} (${s.file}): no cross-tenant negative test`);
    }
    if (caseKeys.has(key(s)) && exemptKeys.has(key(s))) {
      out.push(`${key(s)}: both exempt and tested; remove the exemption`);
    }
  }
  for (const c of caseKeys) if (!surfaceKeys.has(c)) out.push(`${c}: case for a surface that does not exist`);
  for (const e of exempt) {
    if (!surfaceKeys.has(key(e))) out.push(`${key(e)}: stale exemption`);
    if (!e.reason.trim()) out.push(`${key(e)}: exemption without a reason`);
  }
  return out.sort();
}
