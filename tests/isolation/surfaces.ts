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
// Vendor console sign-in surfaces (T-021): same account store and clinic_auth role on the
// vendor host, sessions marked surface = vendor (tests/vendor/host.test.ts).
const VENDOR_AUTH = "vendor-console account-level auth (clinic_auth role, no tenant tables; tests/vendor/host.test.ts)";
export const EXEMPT: Exemption[] = [
  { kind: "route", id: "/", reason: "bootstrap placeholder page; renders no tenant data" },
  { kind: "route", id: "/api/auth/[...all]#route", reason: AUTH },
  { kind: "route", id: "/masuk", reason: AUTH },
  { kind: "route", id: "/verifikasi", reason: AUTH },
  { kind: "route", id: "/aktifkan-2fa", reason: AUTH },
  { kind: "route", id: "/terkunci", reason: AUTH },
  { kind: "action", id: "app/(auth)/terkunci/actions", reason: AUTH },
  { kind: "route", id: "/undangan/[token]", reason: "invitation link: before any membership; shows only the invited name, clinic and roles for a valid token (tests/org/access.test.ts)" },
  { kind: "action", id: "app/(auth)/undangan/[token]/actions", reason: "invitation acceptance: creates the invited account and membership from the token only (tests/org/access.test.ts)" },
  { kind: "route", id: "/vendor", reason: "vendor console redirect to /vendor/tenant; no data (T-021)" },
  { kind: "route", id: "/vendor/[...rest]", reason: "vendor console not-found for unknown paths; renders no data (T-021)" },
  { kind: "route", id: "/vendor/masuk", reason: VENDOR_AUTH },
  { kind: "route", id: "/vendor/verifikasi", reason: VENDOR_AUTH },
  { kind: "route", id: "/vendor/aktifkan-2fa", reason: VENDOR_AUTH },
  { kind: "route", id: "/vendor/api/auth/[...all]#route", reason: VENDOR_AUTH },
  { kind: "route", id: "/saya/keamanan", reason: "Profil & Keamanan (DEC-033): only this account's auth rows on this surface, by the request's session (tests/auth/security.test.ts lists and ends only own sessions)" },
  { kind: "action", id: "app/(app)/saya/keamanan/actions", reason: "ends one of this account's own other sessions; another account's session id is refused (tests/auth/security.test.ts)" },
  { kind: "route", id: "/vendor/keamanan", reason: "vendor Keamanan Akun (DEC-033): own auth rows on the vendor surface only (tests/auth/security.test.ts)" },
  { kind: "route", id: "/vendor/tenant/baru", reason: "Buat Tenant form; renders no tenant data; the write runs vendor_console_tenant_create behind vendor_guard (tests/vendor/tenants.test.ts)" },
  { kind: "route", id: "/vendor/tenant/[id]", reason: "vendor console platform page: clinic_vendor has no tenant-table privilege; vendor_console_tenant_detail returns registry state, legal name, branches, owner presence, agreement flag and invitations only, never staff, patient or clinical data (tests/vendor/tenants.test.ts key list)" },
  { kind: "route", id: "/vendor/api/console/[action]#route", reason: "vendor console writes (T-023): JSON POST, Origin and vendor session checked, every function behind vendor_guard as clinic_vendor; session-end only own sessions (tests/vendor/tenants.test.ts, tests/vendor/host.test.ts)" },
  { kind: "route", id: "/vendor/tim", reason: "Tim Vendor (HYG-003): platform page, no tenant context or data; vendor_console_staff_list behind vendor_guard as clinic_vendor (tests/vendor/team.test.ts)" },
  { kind: "route", id: "/vendor/undangan/[token]", reason: "Tim Vendor invitation link: before any vendor staff or clinic membership; shows only the invited name and vendor roles for a valid token (tests/vendor/team.test.ts)" },
  { kind: "route", id: "/vendor/tenant", reason: "vendor console platform page (no tenant context): clinic_vendor has no tenant-table privilege; reads only state, legal name and branch count through vendor_console_tenants behind vendor_guard (tests/vendor/host.test.ts)" },
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
