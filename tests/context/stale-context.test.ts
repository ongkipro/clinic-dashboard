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
const cabang = await import("../../src/app/(app)/pengaturan/cabang/actions"); // T-036
const jadwal = await import("../../src/app/(app)/jadwal-staf/actions"); // T-043
const kalender = await import("../../src/app/(app)/jadwal/actions"); // T-045
const profil = await import("../../src/app/(app)/pasien/[id]/actions"); // T-040
const hariIni = await import("../../src/app/(app)/hari-ini/actions"); // T-047
const antrean = await import("../../src/app/(app)/antrean/actions"); // T-048
const privasi = await import("../../src/app/(app)/privasi/actions"); // T-039
const daftar = await import("../../src/app/(app)/pasien/_components/actions"); // T-041
const kredensial = await import("../../src/app/(app)/staf/kredensial-actions"); // T-050
const pendampingan = await import("../../src/app/(app)/pendampingan/actions"); // T-051
const pemeriksaan = await import("../../src/app/(app)/pemeriksaan/actions"); // T-052
const persetujuanTindakan = await import("../../src/app/(app)/persetujuan-tindakan/actions"); // T-054
const keluhan = await import("../../src/app/(app)/keluhan/actions"); // T-057

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
  ["jadwal findPatientAction", (f) => kalender.findPatientAction({}, f), () => ({ q: "Sinta" })],
  ["jadwal slotsAction", (f) => kalender.slotsAction({}, f), () => ({ branch: BRANCH_1, version: U(54), date: today })],
  ["jadwal createAction", (f) => kalender.createAction({}, f), () => ({ key: U(55), branch: BRANCH_1, patient: U(56), version: U(54), start: new Date(Date.now() + 86_400_000).toISOString(), channel: "phone" })],
  ["jadwal confirmAction", (f) => kalender.confirmAction({}, f), () => ({ key: U(57), id: U(58) })],
  ["jadwal cancelAction", (f) => kalender.cancelAction({}, f), () => ({ key: U(59), id: U(58), reason: "Uji konteks" })],
  ["jadwal noShowAction", (f) => kalender.noShowAction({}, f), () => ({ key: U(60), id: U(58) })],
  ["jadwal rescheduleAction", (f) => kalender.rescheduleAction({}, f), () => ({ key: U(61), id: U(58), start: new Date(Date.now() + 86_400_000).toISOString() })],
  ["profil grantAction", (f) => profil.grantAction({}, f), () => ({ key: U(62), patient: U(56), purpose: "marketing_wa", channel: "in_person", text: U(63) })],
  ["profil withdrawAction", (f) => profil.withdrawAction({}, f), () => ({ key: U(64), patient: U(56), consent: U(65), channel: "whatsapp", reason: "Uji konteks" })],
  ["hari-ini checkInAction", (f) => hariIni.checkInAction({}, f), () => ({ key: U(66), id: U(58) })],
  ["hari-ini closeVisitAction", (f) => hariIni.closeVisitAction({}, f), () => ({ key: U(67), id: U(68) })],
  ["antrean findPatientAction", (f) => antrean.findPatientAction({}, f), () => ({ q: "Sinta" })],
  ["antrean walkInAction", (f) => antrean.walkInAction({}, f), () => ({ key: U(69), patient: U(56) })],
  ["antrean callAction", (f) => antrean.callAction({}, f), () => ({ key: U(70), ticket: U(71), room: U(72) })],
  ["antrean skipAction", (f) => antrean.skipAction({}, f), () => ({ key: U(73), ticket: U(71) })],
  ["antrean pairAction", (f) => antrean.pairAction({}, f), () => ({ key: U(74), label: "TV Lobi" })],
  ["antrean revokeAction", (f) => antrean.revokeAction({}, f), () => ({ key: U(75), display: U(76) })],
  ["privasi publishTextAction", (f) => privasi.publishTextAction({}, f), () => ({ key: U(77), purpose: "marketing_wa", body: "Teks persetujuan uji konteks" })],
  ["privasi processorAction", (f) => privasi.processorAction({}, f), () => ({ key: U(78), role: "processor", name: "Vultr", service: "Server", data_categories: "Semua", location: "Jakarta" })],
  ["privasi processorActiveAction", (f) => privasi.processorActiveAction({}, f), () => ({ key: U(79), id: U(80), active: "false" })],
  ["privasi recordBreachAction", (f) => privasi.recordBreachAction({}, f), () => ({ key: U(81), aware_at: "2026-11-01T09:00", description: "Uji konteks kebocoran", data_categories: "Nama" })],
  ["privasi assessAction", (f) => privasi.assessAction({}, f), () => ({ key: U(82), id: U(83) })],
  ["privasi concludeAction", (f) => privasi.concludeAction({}, f), () => ({ key: U(84), id: U(83), notifiable: "no", reason: "Alasan uji konteks" })],
  ["privasi closeAction", (f) => privasi.closeAction({}, f), () => ({ key: U(85), id: U(83) })],
  ["daftar-pasien searchAction", (f) => daftar.searchAction({}, f), () => ({ q: "Sinta" })],
  ["daftar-pasien saveSegmentAction", (f) => daftar.saveSegmentAction({}, f), () => ({ key: U(87), name: "Segmen uji", visiting_now: "on" })],
  ["daftar-pasien deleteSegmentAction", (f) => daftar.deleteSegmentAction({}, f), () => ({ key: U(88), id: U(89) })],
  ["privasi noticeAction", (f) => privasi.noticeAction({}, f), () => ({ key: U(86), id: U(83), recipient_kind: "authority", recipient: "Otoritas", sent_at: "2026-11-01T10:00",
    channel: "Surat", content_summary: "Ringkasan pemberitahuan uji", file: new File(["%PDF-1.4"], "a.pdf", { type: "application/pdf" }) })],
  ["pendampingan openAction", (f) => pendampingan.openAction({}, f), () => ({ key: U(95), visit: U(96) })],
  ["pendampingan saveAction", (f) => pendampingan.saveAction({}, f), () => ({ key: U(97), send_key: U(98), visit: U(96), intake: U(99), intent: "save", complaint: "Uji konteks" })],
  ["pemeriksaan openAction", (f) => pemeriksaan.openAction({}, f), () => ({ key: U(100), visit: U(101) })],
  ["pemeriksaan saveAction", (f) => pemeriksaan.saveAction({}, f), () => ({ key: U(102), visit: U(101), exam: U(103), assessment: "Uji konteks" })],
  ["pemeriksaan verifyAction", (f) => pemeriksaan.verifyAction({}, f), () => ({ key: U(104), visit: U(101), exam: U(103), fact: U(105), decision: "confirmed" })],
  ["pemeriksaan markAction", (f) => pemeriksaan.markAction({}, f), () => ({ key: U(106), visit: U(101), exam: U(103), template: "face_front", layer: "keluhan", x: "10", y: "10", label: "Uji" })],
  ["pemeriksaan removeMarkAction", (f) => pemeriksaan.removeMarkAction({}, f), () => ({ key: U(107), visit: U(101), exam: U(103), mark: U(108) })],
  ["pemeriksaan planAction", (f) => pemeriksaan.planAction({}, f), () => ({ key: U(109), visit: U(101), exam: U(103), title: "Program", condition: "Kondisi" })],
  ["pemeriksaan itemAction", (f) => pemeriksaan.itemAction({}, f), () => ({ key: U(110), visit: U(101), exam: U(103), plan: U(111), version: U(112), stage: "1", qty: "1" })],
  ["pemeriksaan removeItemAction", (f) => pemeriksaan.removeItemAction({}, f), () => ({ key: U(113), visit: U(101), exam: U(103), item: U(114) })],
  ["pemeriksaan closePlanAction", (f) => pemeriksaan.closePlanAction({}, f), () => ({ key: U(115), visit: U(101), exam: U(103), plan: U(111), state: "completed" })],
  ["persetujuan-tindakan captureAction", (f) => persetujuanTindakan.captureAction({}, f), () => ({ key: U(116), visit: U(117), plan: U(118), hash: "a".repeat(64), signer: "patient",
    signature: "data:image/png;base64,iVBORw0KGgo=" })],
  ["persetujuan-tindakan withdrawAction", (f) => persetujuanTindakan.withdrawAction({}, f), () => ({ key: U(119), visit: U(117), consent: U(120), reason: "Uji konteks" })],
  ["persetujuan-tindakan reviewAction", (f) => persetujuanTindakan.reviewAction({}, f), () => ({ key: U(121), visit: U(117), exam: U(122), item: U(123), decision: "cleared" })],
  ["keluhan flagAction", (f) => keluhan.flagAction({}, f), () => ({ key: U(124), target: `${U(125)}:${U(126)}`, kind: "klinis", triage: "kuning", summary: "Uji konteks" })],
  ["keluhan takeAction", (f) => keluhan.takeAction({}, f), () => ({ key: U(127), task: U(128) })],
  ["keluhan triageAction", (f) => keluhan.triageAction({}, f), () => ({ key: U(129), task: U(128), triage: "merah" })],
  ["keluhan noteAction", (f) => keluhan.noteAction({}, f), () => ({ key: U(130), task: U(128), note: "Uji konteks" })],
  ["keluhan resolveAction", (f) => keluhan.resolveAction({}, f), () => ({ key: U(131), task: U(128), outcome: "edukasi", note: "Uji konteks" })],
  ["keluhan reopenAction", (f) => keluhan.reopenAction({}, f), () => ({ key: U(132), task: U(128), note: "Uji konteks" })],
  ["staf recordCredentialAction", (f) => kredensial.recordCredentialAction({}, f), () => ({ key: U(91), staff_id: U(46), kind: "str", profession: "dokter", number: "STR-1", issuer: "Konsil Kesehatan", valid_from: "2024-01-01" })],
  ["staf decideCredentialAction", (f) => kredensial.decideCredentialAction({}, f), () => ({ key: U(92), id: U(93), staff_id: U(46), verdict: "verified" })],
  ["staf endCredentialAction", (f) => kredensial.endCredentialAction({}, f), () => ({ key: U(94), id: U(93), staff_id: U(46), state: "suspended", reason: "Uji konteks" })],
  ["jadwal-staf saveWeekAction", (f) => jadwal.saveWeekAction({}, f), () => ({ branch: BRANCH_1, week: "2030-01-07" })],
  ["jadwal-staf addLeaveAction", (f) => jadwal.addLeaveAction({}, f), () => ({ branch: BRANCH_1, staff: U(52), kind: "leave", from: today, to: today, reason: "Uji konteks" })],
  ["jadwal-staf cancelLeaveAction", (f) => jadwal.cancelLeaveAction({}, f), () => ({ id: U(53), reason: "Uji konteks" })],
  ["cabang createBranchAction", (f) => cabang.createBranchAction({}, f), () => ({ code: "NEW-1", name: "Cabang Baru", timezone: "Asia/Jakarta" })],
  ["cabang profileAction", (f) => cabang.profileAction({}, f), () => ({ branch: BRANCH_1, section: "identitas", name: "Cabang Satu", timezone: "Asia/Jakarta" })],
  ["cabang hoursAction", (f) => cabang.hoursAction({}, f), () => ({ branch: BRANCH_1, h_1_0_open: "09:00", h_1_0_close: "17:00" })],
  ["cabang addClosureAction", (f) => cabang.addClosureAction({}, f), () => ({ branch: BRANCH_1, date: today, reason: "Uji konteks" })],
  ["cabang removeClosureAction", (f) => cabang.removeClosureAction({}, f), () => ({ branch: BRANCH_1, id: U(49) })],
  ["cabang roomAction", (f) => cabang.roomAction({}, f), () => ({ branch: BRANCH_1, name: "Ruang Uji", kind: "treatment" })],
  ["cabang deviceAction", (f) => cabang.deviceAction({}, f), () => ({ branch: BRANCH_1, label: "Alat Uji", type: "ipl" })],
  ["cabang activeAction", (f) => cabang.activeAction({}, f), () => ({ branch: BRANCH_1, id: U(50), what: "room", active: "0" })],
  ["cabang servicesAction", (f) => cabang.servicesAction({}, f), () => ({ branch: BRANCH_1, item: U(51) })],
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
