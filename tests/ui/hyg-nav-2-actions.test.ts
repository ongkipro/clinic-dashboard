// HYG-NAV-2 r2 (Panel 2 r1 review dde6632e) — the server-action entry points and two render paths, with the request context and the
// database replaced by fakes (no PostgreSQL; database authority and isolation are tests/isolation/cases/hyg-nav-2.cases.ts):
// - P1 depot writers: the action refuses admin_pusat (which the database would admit for depot_create) and every non PH / PU role
//   before any SQL; PH and PU reach the command.
// - HYG-009: gabung (merge, unmerge), paket (sharing) and depot (create, move) refuse a mismatched or missing rendered context, no SQL.
// - P1 SharingForm: the idempotency key is per mount of the keyed form (a completed attempt gets a fresh key; enable → disable → enable).
// - P2 gabung ?ok=: only the literal codes render a notice; __proto__, constructor, unknown and repeated values render nothing.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ ctx: null as unknown, sql: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect ${to}`); }, notFound: () => { throw new Error("not-found"); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("../../src/modules/org/context/store", () => ({ requestContext: async () => io.ctx, appPool: async () => ({}) }));
vi.mock("../../src/db/rls/context", () => ({
  withTenantContext: async (_p: unknown, _c: unknown, fn: (db: unknown) => Promise<unknown>) =>
    fn({ query: async (sql: string) => { io.sql.push(sql); return { rows: [] }; } }),
}));

const T = "00000000-0000-4000-8000-000000000001";
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ctx = (role: string, branch?: string) => ({ kind: "ok", accountId: "a", sessionId: "s", selection: {},
  active: { context: { tenantId: T, actingRole: role, staffId: U(21), activeBranchId: branch }, clinic: { tenantId: T, name: "Klinik" }, clinics: [], roles: [role], branches: [], staffName: "S", tenantWide: !branch } });
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const rendered = (role: string, branch = "") => ({ ctx_t: T, ctx_r: role, ctx_b: branch });
const stale = (role: string, branch: string) => [
  ["tenant", { ctx_t: U(2), ctx_r: role, ctx_b: branch }], ["role", { ctx_t: T, ctx_r: "manager", ctx_b: branch }],
  ["branch", { ctx_t: T, ctx_r: role, ctx_b: "b-lain" }], ["missing", {}],
] as const;
beforeEach(() => { io.sql = []; vi.stubEnv("DEPLOY_ENV", "local"); });

describe("Gudang & Depot actions — PH / PU only, before any command (review r1 P1)", () => {
  const create = { name: "Apotek Baru", kind: "apotek", branch: "", key: U(41) };
  const move = { from: U(51), to: U(52), batch: U(53), quantity: "1", key: U(42) };
  it("admin_pusat (admitted by depot_create in the database) and other non-writer roles are refused with no SQL", async () => {
    const { createDepotAction, moveAction } = await import("../../src/app/(app)/stok/depot/actions");
    for (const role of ["admin_pusat", "owner", "manager", "fo_cashier", "finance"]) {
      const b = ["manager", "fo_cashier"].includes(role) ? "b1" : "";
      io.ctx = ctx(role, b || undefined);
      io.sql = [];
      expect(await createDepotAction({}, form({ ...create, ...rendered(role, b) })), role).toEqual({ error: "Peran Anda tidak dapat mengubah depot.", n: 1 });
      expect(await moveAction({}, form({ ...move, ...rendered(role, b) })), role).toEqual({ error: "Peran Anda tidak dapat mengubah depot.", n: 1 });
      expect(io.sql, role).toEqual([]);
    }
  });
  it("pharmacist and purchasing reach the depot commands", async () => {
    const { createDepotAction, moveAction } = await import("../../src/app/(app)/stok/depot/actions");
    for (const [role, b] of [["pharmacist", "b1"], ["purchasing", ""]] as const) {
      io.ctx = ctx(role, b || undefined);
      io.sql = [];
      const c = await createDepotAction({}, form({ ...create, ...rendered(role, b) }));
      expect(c.error, role).not.toBe("Peran Anda tidak dapat mengubah depot.");
      const m = await moveAction({}, form({ ...move, ...rendered(role, b) }));
      expect(m.error, role).not.toBe("Peran Anda tidak dapat mengubah depot.");
      expect(io.sql.length, role).toBeGreaterThan(0);
    }
  });
});

describe("HYG-009 B2-1: a form rendered in another context (or without one) is refused before any SQL", () => {
  it("depot (create, move), paket (sharing), gabung (merge, unmerge)", async () => {
    const { STALE_CONTEXT } = await import("../../src/modules/org/context/context");
    const depot = await import("../../src/app/(app)/stok/depot/actions");
    const paket = await import("../../src/app/(app)/layanan/paket/actions");
    const gabung = await import("../../src/app/(app)/pasien/gabung/actions");
    const calls: [string, string, string | undefined, (c: Record<string, string>) => Promise<{ error?: string }>][] = [
      ["depot create", "pharmacist", "b1", (c) => depot.createDepotAction({}, form({ name: "Apotek Baru", kind: "apotek", branch: "", key: U(41), ...c }))],
      ["depot move", "pharmacist", "b1", (c) => depot.moveAction({}, form({ from: U(51), to: U(52), batch: U(53), quantity: "1", key: U(42), ...c }))],
      ["paket sharing", "owner", undefined, (c) => paket.sharingAction({}, form({ item: U(61), key: U(43), enabled: "1", reason: "Keluarga inti", ...c }))],
      ["gabung merge", "records_officer", "b1", (c) => gabung.mergeAction({}, form({ pair_a: U(71), pair_b: U(72), survivor: U(71), reason: "Data ganda pendaftaran", key: U(44), ...c }))],
      ["gabung unmerge", "records_officer", "b1", (c) => gabung.unmergeAction({}, form({ merge: U(73), reason: "Ternyata pasien berbeda", key: U(45), ...c }))],
    ];
    for (const [what, role, branch, call] of calls) {
      io.ctx = ctx(role, branch);
      for (const [v, c] of stale(role, branch ?? "")) {
        io.sql = [];
        expect((await call(c)).error, `${what} ${v}`).toBe(STALE_CONTEXT);
        expect(io.sql, `${what} ${v}`).toEqual([]);
      }
    }
  });
});

describe("SharingForm: a fresh idempotency key per completed attempt (review r1 P1)", () => {
  it("the key input is inside the keyed form (remounted on each completed attempt), never held by the outer component", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(import.meta.dirname, "../../src/app/(app)/layanan/paket/forms.tsx"), "utf8");
    const outer = src.slice(src.indexOf("export function SharingForm"));
    expect(outer).not.toMatch(/useState\(\(\) => crypto\.randomUUID\(\)\)/);
    expect(outer).toMatch(/<form action=\{act\} key=\{`s\$\{s\.n \?\? 0\}`\}[^>]*>\s*<ContextFields ctx=\{ctx\} \/><Key \/>/);
  });
  it("two mounts of the key field draw two different keys (what a completed attempt's remount does); enable → disable → enable runs in the browser flow", async () => {
    const React = await import("react");
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(import.meta.dirname, "../../src/app/(app)/layanan/paket/forms.tsx"), "utf8");
    expect(src).toMatch(/function Key\(\) \{\n  const \[k\] = useState\(\(\) => crypto\.randomUUID\(\)\);\n  return <input type="hidden" name="key" value=\{k\} \/>;/);
    // the same component shape, mounted twice: two keys
    function Key() { const [k] = React.useState(() => crypto.randomUUID()); return React.createElement("input", { type: "hidden", name: "key", value: k, readOnly: true }); }
    const v = (h: string) => /value="([^"]+)"/.exec(h)![1];
    expect(v(renderToStaticMarkup(React.createElement(Key)))).not.toBe(v(renderToStaticMarkup(React.createElement(Key))));
  });
});

describe("Gabung ?ok=: literal codes only (review r1 P2)", () => {
  it("merged / unmerged render their notice; __proto__, constructor, toString, unknown and repeated values render nothing", async () => {
    io.ctx = ctx("records_officer", "b1");
    const page = (await import("../../src/app/(app)/pasien/gabung/page")).default;
    const body = async (ok: unknown) => {
      const el = page({ searchParams: Promise.resolve({ ok } as never) }) as { props: { children: { type: (p: unknown) => Promise<unknown>; props: unknown } } };
      const b = el.props.children;
      return renderToStaticMarkup((await b.type(b.props)) as never);
    };
    expect(await body("merged")).toContain("Data pasien digabung.");
    expect(await body("unmerged")).toContain("Penggabungan dibatalkan.");
    for (const bad of ["__proto__", "constructor", "toString", "hasOwnProperty", "x", ["merged", "merged"]]) {
      const out = await body(bad);
      expect(out, String(bad)).not.toContain('role="status" class="m-0 rounded');
      expect(out, String(bad)).not.toMatch(/Data pasien digabung\.|Penggabungan dibatalkan\./);
    }
  });
});
