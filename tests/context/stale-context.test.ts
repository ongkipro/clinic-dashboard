// HYG-009 B2-1: a form rendered for one clinic context never writes in another. Tabs share one
// stored selection, so between rendering and submitting, another tab may switch clinic, acting
// role or branch. Every clinic write action compares the posted rendered context (ctx_t, ctx_r,
// ctx_b) with the freshly resolved one and refuses a difference before any action-specific
// database work (context resolution itself reads the session and memberships; that happens first).
// The request layer is replaced here, and appPool() records whether an action went on to the database.
// A matching form does reach it (control), so the refusal is the comparison, not the inputs.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActingContext } from "../../src/modules/org/identity";

const io = vi.hoisted(() => ({ current: null as unknown, poolCalls: 0 }));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect ${to}`); } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: () => {}, get: () => undefined }), headers: async () => new Headers() }));
vi.mock("../../src/modules/org/context/store", () => ({
  CONTEXT_COOKIE: "clinic_context",
  requestContext: async () => io.current,
  appPool: async () => {
    io.poolCalls++;
    throw new Error("reached the database");
  },
}));

const { renderedContext, STALE_CONTEXT, staleContext } = await import("../../src/modules/org/context/context");
const pengaturan = await import("../../src/app/(app)/pengaturan/actions");
const kepatuhan = await import("../../src/app/(app)/kepatuhan/actions");
const persetujuan = await import("../../src/app/(app)/persetujuan/actions");
const staff = await import("../../src/modules/org/staff/actions");
const roles = await import("../../src/modules/org/roles/actions");
const ctxActions = await import("../../src/modules/org/context/actions");
const pasienBaru = await import("../../src/app/(app)/pasien/baru/actions"); // T-037

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TENANT_A = U(1);
const TENANT_B = U(2);
const BRANCH_1 = U(11);
const BRANCH_2 = U(12);
const ctx = (tenantId: string, actingRole: ActingContext["actingRole"], activeBranchId?: string): ActingContext =>
  ({ tenantId, actingRole, activeBranchId, staffId: U(21), membershipId: U(22) }) as ActingContext;

function activate(c: ActingContext) {
  io.current = { kind: "ok", accountId: U(31), sessionId: U(32), selection: {}, active: { context: c, clinic: { tenantId: c.tenantId, name: "X" }, clinics: [], roles: [c.actingRole], branches: [], staffName: "X", tenantWide: !c.activeBranchId } };
}

function form(fields: Record<string, string | File>, rendered: ActingContext | null): FormData {
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

const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
// Every clinic write action with inputs that pass its own validation (so only the context decides).
const ACTIONS: [string, (f: FormData) => Promise<{ error?: string }>, () => Record<string, string | File>][] = [
  ["pengaturan saveAction", (f) => pengaturan.saveAction({}, f), () => ({ key: "SET-38", branch: BRANCH_1, reason: "Uji konteks", v: "25" })],
  ["pengaturan withdrawAction", (f) => pengaturan.withdrawAction({}, f), () => ({ approval: U(41), group: "jadwal" })],
  ["kepatuhan uploadAction", (f) => kepatuhan.uploadAction({}, f), () => ({ key: "izin_klinik", file: new File(["%PDF-1.4"], "a.pdf", { type: "application/pdf" }), expert: "Dr. Uji", date: today })],
  ["kepatuhan decideAction", (f) => kepatuhan.decideAction({}, f), () => ({ key: "izin_klinik", item: U(42), file: U(43), decision: "approved" })],
  ["persetujuan decideAction", (f) => persetujuan.decideAction({}, f), () => ({ id: U(44), decision: "approve" })],
  ["staff inviteAction", (f) => staff.inviteAction({}, f), () => ({ email: "baru@klinik-sintetis.test", name: "Staf Baru", roles: "nurse", branches: BRANCH_1 })],
  ["staff cancelInviteAction", (f) => staff.cancelInviteAction({}, f), () => ({ id: U(45) })],
  ["staff revokeSessionAction", (f) => staff.revokeSessionAction({}, f), () => ({ staff: U(46), session: U(47) })],
  ["staff endMembershipAction", (f) => staff.endMembershipAction({}, f), () => ({ staff: U(46) })],
  ["staff removeRoleAction", (f) => staff.removeRoleAction({}, f), () => ({ staff: U(46), role: "nurse" })],
  ["staff dutyAction", (f) => staff.dutyAction({}, f), () => ({ staff: U(46), duty: "data_protection", assign: "1" })],
  ["roles answerOwnerGrantAction", (f) => roles.answerOwnerGrantAction({}, f), () => ({ id: U(48), answer: "terima" })],
  ["context switchAction", (f) => ctxActions.switchAction({}, f), () => ({ kind: "branch", value: BRANCH_2 })],
  ["pasien-baru searchAction", (f) => pasienBaru.searchAction({}, f), () => ({ by: "phone", q: "081234567890" })],
  ["pasien-baru registerAction", (f) => pasienBaru.registerAction({}, f), () => ({ full_name: "Pasien Uji", birth_date: "1990-01-01", sex: "female", phone: "081234567890",
    identity_type: "nik", identity_number: "3171010101010001", religion: "islam", occupation: "Karyawan", education: "s1", marital_status: "kawin" })],
];

// Another tab changed one of the three: clinic, acting role, branch (and branch <-> Semua Cabang).
const SWITCHES: [string, ActingContext, ActingContext][] = [
  ["clinic", ctx(TENANT_A, "owner"), ctx(TENANT_B, "owner")],
  ["acting role", ctx(TENANT_A, "owner"), ctx(TENANT_A, "admin_pusat")],
  ["branch", ctx(TENANT_A, "manager", BRANCH_1), ctx(TENANT_A, "manager", BRANCH_2)],
  ["Semua Cabang to a branch", ctx(TENANT_A, "owner"), ctx(TENANT_A, "owner", BRANCH_1)],
];

beforeEach(() => {
  io.poolCalls = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("HYG-009 B2-1: staleContext", () => {
  it("is false only when tenant, acting role and branch all match", () => {
    const c = ctx(TENANT_A, "manager", BRANCH_1);
    expect(staleContext(form({}, c), c)).toBe(false);
    for (const [, rendered, now] of SWITCHES) {
      expect(staleContext(form({}, rendered), now)).toBe(true);
      expect(staleContext(form({}, now), rendered)).toBe(true);
    }
    // Missing fields (an old page, a crafted post) are stale, never "no expectation".
    expect(staleContext(form({}, null), c)).toBe(true);
    const partial = form({}, c);
    partial.delete("ctx_b");
    expect(staleContext(partial, c)).toBe(true);
    const tenantWide = ctx(TENANT_A, "owner");
    expect(staleContext(form({}, tenantWide), tenantWide)).toBe(false); // ctx_b "" = Semua Cabang
  });
});

describe("HYG-009 B2-1: every clinic write action refuses a form from another context before any database work", () => {
  for (const [name, run, fields] of ACTIONS) {
    it(name, async () => {
      for (const [what, rendered, now] of SWITCHES) {
        activate(now);
        io.poolCalls = 0;
        expect(await run(form(fields(), rendered)), `${name} after a ${what} switch`).toMatchObject({ error: STALE_CONTEXT });
        expect(io.poolCalls, `${name} after a ${what} switch`).toBe(0);
      }
      // No rendered context at all: refused too.
      activate(SWITCHES[0][2]);
      io.poolCalls = 0;
      expect(await run(form(fields(), null))).toMatchObject({ error: STALE_CONTEXT });
      expect(io.poolCalls).toBe(0);
      // Control: the context the form was rendered in is still active, so the action goes on to
      // the database (here it stops there; the write path itself is covered by its own tests).
      for (const [, rendered] of SWITCHES) {
        activate(rendered);
        io.poolCalls = 0;
        const r = await run(form(fields(), rendered)).catch((e: Error) => ({ error: `thrown: ${e.message}` }));
        expect(r.error ?? "", name).not.toBe(STALE_CONTEXT);
        expect(io.poolCalls, name).toBe(1);
      }
    });
  }
});
