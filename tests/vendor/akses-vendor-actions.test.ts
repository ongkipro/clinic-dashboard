// T-028 Akses Vendor actions (UX-48, PR-60): every decision posts its rendered context and is refused
// before any database work when another tab changed clinic, role or branch (HYG-009 B2-1); malformed ids
// and decisions are refused before the database too. The database's own refusals (non-Owner, another
// tenant's session, not pending) are covered by tests/vendor/support-scope.test.ts (T-026) and the
// isolation case tests/isolation/cases/akses-vendor.cases.ts. The request layer is replaced here.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActingContext } from "../../src/modules/org/identity";

const io = vi.hoisted(() => ({ current: null as unknown, poolCalls: 0, db: null as null | ((sql: string) => unknown), cookie: null as null | [string, string], committed: 0 }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect ${to}`); } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: (k: string, v: string) => { io.cookie = [k, v]; }, get: () => undefined }), headers: async () => new Headers() }));
// The tenant transaction: with a stubbed database (io.db) it runs the callback and counts the commit.
vi.mock("../../src/db/rls/context", async (orig) => ({
  ...(await orig()),
  withTenantContext: async (_pool: unknown, _ctx: unknown, fn: (db: unknown) => Promise<unknown>) => {
    const r = await fn({ query: async (sql: string) => ({ rows: [io.db!(sql)] }) });
    io.committed++;
    return r;
  },
}));
vi.mock("../../src/modules/org/context/store", () => ({
  CONTEXT_COOKIE: "clinic_context",
  requestContext: async () => io.current,
  appPool: async () => {
    io.poolCalls++;
    if (!io.db) throw new Error("reached the database");
    return {};
  },
}));

const { renderedContext, STALE_CONTEXT } = await import("../../src/modules/org/context/context");
const a = await import("../../src/app/(app)/saya/akses-vendor/actions");
const { RESULT_COOKIE } = await import("../../src/app/(app)/saya/akses-vendor/result-cookie");
vi.mock("server-only", () => ({}));
const { verifiedResult } = await import("../../src/app/(app)/saya/akses-vendor/data");

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ctx = (tenantId: string, actingRole: ActingContext["actingRole"], activeBranchId?: string): ActingContext =>
  ({ tenantId, actingRole, activeBranchId, staffId: U(21), membershipId: U(22) }) as ActingContext;
function activate(c: ActingContext) {
  io.current = { kind: "ok", accountId: U(31), sessionId: U(32), selection: {}, active: { context: c, clinic: { tenantId: c.tenantId, name: "X" }, clinics: [], roles: [c.actingRole], branches: [], staffName: "X", tenantWide: !c.activeBranchId } };
}
function form(fields: Record<string, string>, rendered: ActingContext | null): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  if (rendered) {
    const r = renderedContext(rendered);
    f.append("ctx_t", r.t);
    f.append("ctx_r", r.r);
    f.append("ctx_b", r.b);
  }
  return f;
}
const ACTIONS: [string, (f: FormData) => Promise<{ error?: string; ok?: string }>, Record<string, string>][] = [
  ["decideScopeAction", (f) => a.decideScopeAction({}, f), { session: U(41), decision: "approve" }],
  ["endSessionAction", (f) => a.endSessionAction({}, f), { session: U(41) }],
  ["decideDualIdentityAction", (f) => a.decideDualIdentityAction({}, f), { request: U(42), decision: "reject" }],
];
const OWNER_A = ctx(U(1), "owner");
const SWITCHES: [string, ActingContext][] = [["clinic", ctx(U(2), "owner")], ["role", ctx(U(1), "admin_pusat")], ["branch", ctx(U(1), "owner", U(11))]];

beforeEach(() => {
  io.poolCalls = 0;
  io.db = null;
  io.cookie = null;
  io.committed = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Akses Vendor actions refuse a stale context and malformed input before the database", () => {
  for (const [name, run, fields] of ACTIONS) {
    it(name, async () => {
      for (const [what, now] of SWITCHES) {
        activate(now);
        io.poolCalls = 0;
        expect(await run(form(fields, OWNER_A)), `${name} after a ${what} switch`).toMatchObject({ error: STALE_CONTEXT });
        expect(io.poolCalls).toBe(0);
      }
      activate(OWNER_A);
      io.poolCalls = 0;
      expect(await run(form(fields, null))).toMatchObject({ error: STALE_CONTEXT });
      expect(io.poolCalls).toBe(0);
      // Malformed id or decision: refused before the context check reaches the database.
      const bad = { ...fields, ...(fields.session ? { session: "x" } : { request: "x" }) };
      expect(await run(form(bad, OWNER_A))).toMatchObject({ error: "Pilihan tidak valid." });
      if (fields.decision) expect(await run(form({ ...fields, decision: "maybe" }, OWNER_A))).toMatchObject({ error: "Pilihan tidak valid." });
      expect(io.poolCalls).toBe(0);
      // Control: the rendered context is current, so the action goes on to the database.
      io.poolCalls = 0;
      await run(form(fields, OWNER_A)).catch(() => undefined);
      expect(io.poolCalls).toBe(1);
    });
  }
});

describe("Akses Vendor actions: database answers (review round 1)", () => {
  it("a refusal the database returns is committed and shown; no result cookie, no redirect", async () => {
    activate(OWNER_A);
    io.db = () => ({ r: "refused:not_pending" });
    expect(await a.decideScopeAction({}, form({ session: U(41), decision: "approve" }, OWNER_A))).toEqual({ error: "Sesi ini sudah tidak menunggu persetujuan. Muat ulang halaman." });
    expect(io.committed).toBe(1);
    expect(io.cookie).toBeNull();
    io.db = () => ({ s: "refused:already_decided" });
    expect(await a.decideDualIdentityAction({}, form({ request: U(42), decision: "approve" }, OWNER_A))).toEqual({ error: "Permintaan ini sudah diputuskan. Muat ulang halaman." });
    expect(io.cookie).toBeNull();
  });

  it("a non-Owner refused by the database (42501 raised) gets the Owner-only message", async () => {
    activate(ctx(U(1), "admin_pusat"));
    io.db = () => { throw Object.assign(new Error("ERR_FORBIDDEN: only the Owner decides vendor onboarding work"), { code: "42501" }); };
    expect(await a.endSessionAction({}, form({ session: U(41) }, ctx(U(1), "admin_pusat")))).toEqual({ error: "Hanya Owner yang dapat memutuskan akses vendor." });
    expect(io.cookie).toBeNull();
  });

  it("success sets the one-use result cookie naming the code and the subject, then reloads the page", async () => {
    activate(OWNER_A);
    io.db = () => ({ r: "approved" });
    await expect(a.decideScopeAction({}, form({ session: U(41), decision: "approve" }, OWNER_A))).rejects.toThrow("redirect /saya/akses-vendor");
    expect(io.cookie).toEqual([RESULT_COOKIE, `akses-disetujui:${U(41)}`]);
    io.db = () => ({});
    await expect(a.endSessionAction({}, form({ session: U(43) }, OWNER_A))).rejects.toThrow("redirect /saya/akses-vendor");
    expect(io.cookie).toEqual([RESULT_COOKIE, `sesi-diakhiri:${U(43)}`]);
  });
});

describe("the result notice is shown only when the data agrees (review round 1)", () => {
  const sess = (o: Record<string, unknown>) => ({ id: U(41), state: "active", activated_at: null, end_reason: null, ...o }) as never;
  it("unknown, prototype and malformed codes, foreign ids and stale states show nothing", () => {
    for (const raw of [undefined, "", "__proto__", `__proto__:${U(41)}`, `constructor:${U(41)}`, "sesi-diakhiri", `sesi-diakhiri:${U(99)}`, `bogus:${U(41)}`]) {
      expect(verifiedResult(raw, [sess({ state: "ended", end_reason: "owner" })], []), String(raw)).toBeNull();
    }
    // The code claims an ended session but the session is still active.
    expect(verifiedResult(`sesi-diakhiri:${U(41)}`, [sess({ state: "active" })], [])).toBeNull();
    // Approved, then ended by someone else: "Sesi aktif" would no longer be true (review round 2).
    expect(verifiedResult(`akses-disetujui:${U(41)}`, [sess({ state: "ended", activated_at: "2026-11-07T00:00:00Z", end_reason: "operator" })], [])).toBeNull();
    // Rejected by the operator, not the Owner.
    expect(verifiedResult(`sesi-diakhiri:${U(41)}`, [sess({ state: "ended", end_reason: "operator" })], [])).toBeNull();
  });
  it("a code whose subject's state agrees shows its fixed message", () => {
    expect(verifiedResult(`sesi-diakhiri:${U(41)}`, [sess({ state: "ended", end_reason: "owner" })], [])).toBe("Sesi diakhiri. Vendor tidak bisa membaca data lagi lewat sesi ini.");
    expect(verifiedResult(`akses-disetujui:${U(41)}`, [sess({ state: "active", activated_at: "2026-11-07T00:00:00Z" })], [])).toBe("Akses disetujui. Sesi aktif mulai sekarang.");
    expect(verifiedResult(`identitas-ditolak:${U(42)}`, [], [{ requestId: U(42), state: "rejected", clinicApprovedAt: null } as never])).toBe("Identitas ganda ditolak.");
  });
});
