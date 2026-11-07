// T-027 review round 1 (P2): the console route's checklist-set validates optional ids strictly. Absent
// means missing, null or ""; any other value (false, 0, a non-UUID string) is refused before the
// database is called. The session and pool are replaced here; a valid request reaches the module.
import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock("../../src/app/vendor/_lib/server", () => ({
  ipHeader: () => "x-real-ip",
  vendorOrigin: () => "http://vendor.test",
  vendorAuth: async () => ({ checkSession: async () => ({ gate: "ok", token: "t".repeat(40) }) }),
  vendorPool: async () => ({}),
}));
vi.mock("../../src/modules/vendor/checklist/checklist", () => ({
  setChecklistItem: async (_db: unknown, _c: unknown, tenantId: unknown, i: unknown) => {
    io.calls.push({ tenantId, ...(i as object) });
    return { ok: true, data: { id: "x" } };
  },
}));

const { POST } = await import("../../src/app/vendor/api/console/[action]/route");
const T = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const send = (body: Record<string, unknown>) =>
  POST(new Request("http://vendor.test/vendor/api/console/checklist-set", { method: "POST", headers: { origin: "http://vendor.test", "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ action: "checklist-set" }) });

beforeEach(() => {
  io.calls = [];
});

describe("checklist-set id validation", () => {
  it("refuses false, 0 and non-UUID strings for branchId and ownerId without calling the database", async () => {
    for (const bad of [false, 0, "abc", true, {}, []]) {
      for (const k of ["branchId", "ownerId"]) {
        const r = await send({ tenantId: T, item: "catalog", status: "done", [k]: bad });
        expect(r.status, `${k}=${JSON.stringify(bad)}`).toBe(400);
        expect(await r.json()).toMatchObject({ ok: false, code: "ERR_INVALID_INPUT" });
      }
    }
    expect(io.calls).toEqual([]);
  });

  it("missing, null and empty string mean absent; a UUID is passed through", async () => {
    for (const absent of [undefined, null, ""]) {
      const r = await send({ tenantId: T, item: "catalog", status: "done", branchId: absent, ownerId: absent });
      expect(r.status).toBe(200);
    }
    expect(io.calls.every((c) => (c as { branchId: unknown; ownerId: unknown }).branchId === null && (c as { ownerId: unknown }).ownerId === null)).toBe(true);
    const r = await send({ tenantId: T, branchId: B, item: "branch_setup", status: "done", ownerId: B });
    expect(r.status).toBe(200);
    expect(io.calls.at(-1)).toMatchObject({ tenantId: T, branchId: B, ownerId: B, item: "branch_setup", status: "done" });
  });
});
