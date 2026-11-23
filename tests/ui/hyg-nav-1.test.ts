// HYG-NAV-1 — the first 10 orphan nav routes from the T-130 audit, on existing readers only. No database, no server:
// - pure models (target attainment / periods, Jadwal Saya grouping, notification links, Tampilan prefs, Matriks, Survei totals, rupiah parse);
// - the pages render through react-dom/server with requestContext / withTenantContext replaced by fakes (each page's role gate, empty and
//   permission states, and that it reads only its intended reader);
// - the two redirects point at the routes the nav and tab bars need;
// - every new route file is a page the nav lists (and the T-130 ORPHANS of this batch are now built).
// The cross-tenant cases for these routes and actions are tests/isolation/cases/hyg-nav-1.cases.ts (real PostgreSQL, `pnpm test:isolation`).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ ctx: null as unknown, sql: [] as string[], calls: [] as string[], rows: ((): unknown[] => []) as (sql: string) => unknown[], fail: null as null | { code: string } }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect ${to}`); }, notFound: () => { throw new Error("not-found"); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("../../src/modules/org/context/store", () => ({ requestContext: async () => io.ctx, appPool: async () => ({}) }));
vi.mock("../../src/db/rls/context", () => ({
  withTenantContext: async (_p: unknown, _c: unknown, fn: (db: unknown) => Promise<unknown>) =>
    fn({ query: async (sql: string) => { io.sql.push(sql); if (io.fail) { const { CommandError } = await import("../../src/lib/command"); throw new CommandError(io.fail.code as never); } return { rows: io.rows(sql) }; } }),
}));

const ROOT = join(import.meta.dirname, "../..");
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
async function render(mod: { default: (p: never) => unknown }, props: Record<string, unknown> = {}) {
  // Pages are `<main><Suspense><Body/></Suspense></main>`: render Body's element directly (async server component).
  const el = mod.default(props as never) as { props: { children: { props: { children: { type: (p: unknown) => Promise<unknown>; props: unknown } } } } };
  const body = el.props.children.props.children;
  return renderToStaticMarkup((await body.type(body.props)) as never);
}
const ctx = (role: string, branch?: string) => ({ kind: "ok", accountId: "a", sessionId: "s", selection: {},
  active: { context: { tenantId: "00000000-0000-4000-8000-000000000001", actingRole: role, staffId: "00000000-0000-4000-8000-000000000021", activeBranchId: branch },
    clinic: { tenantId: "t", name: "Klinik" }, clinics: [], roles: [role], branches: [], staffName: "Staf", tenantWide: !branch } });
const sp = (q: Record<string, string> = {}) => ({ searchParams: Promise.resolve(q) });

beforeEach(() => { io.sql = []; io.rows = () => []; io.fail = null; io.ctx = ctx("bc", "b1"); });

describe("models", () => {
  it("target: periods, attainment (no target is never 0%), figures in one order for both pages", async () => {
    const m = await import("../../src/app/(app)/saya/target/model");
    expect(m.periodLabel("2026-11")).toBe("November 2026");
    expect(m.periodLabel("2026-Q4")).toBe("Triwulan 4 2026");
    expect(m.shiftPeriod("2026-01", -1)).toBe("2025-12");
    expect(m.shiftPeriod("2026-Q1", -1)).toBe("2025-Q4");
    expect(m.shiftPeriod("2026-Q4", 1)).toBe("2027-Q1");
    expect(m.attainment({ target: null, attainment_bps: null })).toEqual({ text: "Target belum ditetapkan", pct: null });
    expect(m.attainment({ target: { id: "x", closing_value_target: 0, plans_target: null, set_at: "" }, attainment_bps: null }).pct).toBeNull();
    expect(m.attainment({ target: { id: "x", closing_value_target: 10, plans_target: null, set_at: "" }, attainment_bps: 7550 })).toEqual({ text: "75,5% dari target", pct: 75.5 });
    expect(m.utilization(null)).toBe("Belum ada jadwal kerja");
    expect(m.PERIOD.test("2026-13")).toBe(false);
  });
  it("Jadwal Saya: every day of the window, leave marked, appointments by Jakarta day in time order, breaks hidden", async () => {
    const m = await import("../../src/app/(app)/saya/jadwal/model");
    const d = m.mySchedule({
      from: "2026-11-20", to: "2026-11-22",
      shifts: [{ date: "2026-11-20", starts: "09:00", ends: "17:00", kind: "work", branch: "A" }, { date: "2026-11-20", starts: "12:00", ends: "13:00", kind: "break", branch: "A" }],
      leave: [{ from: "2026-11-21", to: "2026-11-21", kind: "sick", branch: "A" }],
      appointments: [
        { startsAt: new Date("2026-11-20T05:00:00Z"), endsAt: new Date("2026-11-20T06:00:00Z"), service: "Facial", patient: "P2", state: "booked" },
        { startsAt: new Date("2026-11-20T02:00:00Z"), endsAt: new Date("2026-11-20T03:00:00Z"), service: "Peeling", patient: "P1", state: "booked" },
        { startsAt: new Date("2026-11-21T17:30:00Z"), endsAt: new Date("2026-11-21T18:00:00Z"), service: "X", patient: "P3", state: "booked" }, // 22 Nov WIB
      ],
    });
    expect(d.map((x) => x.date)).toEqual(["2026-11-20", "2026-11-21", "2026-11-22"]);
    expect(d[0].shifts).toHaveLength(1);
    expect(d[0].appointments.map((a) => a.patient)).toEqual(["P1", "P2"]);
    expect(d[1].leave).toEqual({ kind: "sick", branch: "A" });
    expect(d[2].appointments.map((a) => a.patient)).toEqual(["P3"]);
  });
  it("Notifikasi: subject links only for pages that exist, never for a malformed id", async () => {
    const { subjectHref } = await import("../../src/app/(app)/saya/notifikasi/links");
    const id = "00000000-0000-4000-8000-000000000099";
    expect(subjectHref("approval", id)).toBe(`/persetujuan/${id}`);
    expect(subjectHref("staff_credential", id)).toBe("/staf?segmen=kredensial");
    expect(subjectHref("tenant_lifecycle", id)).toBeNull();
    expect(subjectHref("approval", "../x")).toBeNull();
    // every by-id link lands on an existing [id] page (no dead links)
    for (const kind of ["approval", "clinical_request", "complaint_task", "clinical_incident", "patient"]) {
      const dir = subjectHref(kind, id)!.replace(id, "[id]");
      expect(existsSync(join(ROOT, "src/app/(app)", dir, "page.tsx")), dir).toBe(true);
    }
  });
  it("Tampilan: the switch writes the device key and toggles the reduce-transparency class DESIGN.md styles", async () => {
    const p = await import("../../src/app/(app)/saya/tampilan/prefs");
    const store = new Map<string, string>();
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    const classes = new Set<string>();
    const root = { classList: { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)) } };
    expect(p.readReduce(s)).toBe(false);
    p.writeReduce(s, root, true);
    expect(p.readReduce(s)).toBe(true);
    expect(classes.has("reduce-transparency")).toBe(true);
    p.writeReduce(s, root, false);
    expect(store.size).toBe(0);
    expect(classes.size).toBe(0);
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(join(ROOT, "src/styles/tokens.css"), "utf8")).toContain(`html.${p.REDUCE_CLASS} .bar-glass`);
    // review r1 P2: a fresh document gets the stored value back; the clinic layout mounts the initializer on every (app) page
    store.set(p.REDUCE_KEY, "1");
    p.applyStoredReduce(s, root);
    expect(classes.has("reduce-transparency")).toBe(true);
    store.clear();
    p.applyStoredReduce(s, root);
    expect(classes.size).toBe(0);
    const layout = readFileSync(join(ROOT, "src/app/(app)/layout.tsx"), "utf8");
    expect(layout).toMatch(/<Shell \{\.\.\.data\.context\}><ApplyTampilan \/>/);
  });
  it("Matriks: every approval type once, with its approvers in words and the tuning setting", async () => {
    const { matrix, TYPE_SETTING } = await import("../../src/app/(app)/persetujuan/matriks/model");
    const { APPROVAL_TYPES } = await import("../../src/modules/approvals/inbox");
    const { SETTING_BY_KEY } = await import("../../src/modules/settings/registry");
    const rows = matrix();
    expect(rows.map((r) => r.type).sort()).toEqual(Object.keys(APPROVAL_TYPES).sort());
    expect(rows.find((r) => r.type === "write_off")).toMatchObject({ approvers: "Owner", setting: null });
    expect(rows.find((r) => r.type === "record_late_correction")!.approvers).toBe("Perekam Medis, Penanggung Jawab Klinik");
    for (const k of Object.values(TYPE_SETTING)) expect(SETTING_BY_KEY.get(k)?.kind, k).toBe("value");
  });
  it("Survei: weighted totals; no survey has no average (never 0)", async () => {
    const m = await import("../../src/app/(app)/lead/survei/model");
    expect(m.totals([])).toEqual({ total: 0, low: 0, avg: null, lowPct: null });
    expect(m.avgText(m.totals([]))).toBe("Belum ada survei");
    const t = m.totals([{ branch_id: "a", total: 3, low_count: 1, avg_score: 3, low_pct: 33.33 }, { branch_id: "b", total: 1, low_count: 0, avg_score: 5, low_pct: 0 }]);
    expect(t).toEqual({ total: 4, low: 1, avg: 3.5, lowPct: 25 });
    expect(m.who({ consent_masked: true, patient_name: null, patient_mrn: null } as never)).toBe("Pasien (tanpa persetujuan promosi)");
  });
  it("rupiah input: digits with dots or Rp only; integers only", async () => {
    const { parseRupiah } = await import("../../src/app/(app)/staf/target/parse");
    expect(parseRupiah("Rp1.500.000")).toBe(1_500_000);
    expect(parseRupiah("1500000")).toBe(1_500_000);
    for (const bad of ["1,5 juta", "-5", "1.5e6", "", "abc"]) expect(parseRupiah(bad), bad).toBeNaN();
  });
});

describe("pages (server-rendered with fake context and database)", () => {
  it("Target Saya: reads target_mine for the caller only; meter only with a real attainment", async () => {
    io.rows = (s) => (s.includes("target_mine") ? [{ r: { staff_id: "s", staff: "BC Satu", is_bc: true, target: { id: "t", closing_value_target: 40_000_000, plans_target: 5, set_at: "" },
      closing_value_actual: 30_000_000, branch_closing_value: null, plans_actual: 3, attainment_bps: 7500, period: "2026-11", period_kind: "bulanan", period_start: "", period_end: "",
      scorecard: { completed_services: 7, executed_minutes: 0, rostered_minutes: 0, utilization_bps: null, commission_gross: 0, commission_adjustments: 0, commission_net: 1_250_000 } } }] : []);
    const out = text(await render(await import("../../src/app/(app)/saya/target/page"), sp()));
    expect(io.sql).toEqual(["select target_mine($1) as r"]);
    expect(out).toContain("November 2026");
    expect(out).toContain("Rp30.000.000");
    expect(out).toContain("75% dari target");
    expect(out).toContain("3 dari 5 rencana terpilih penuh");
  });
  it("Target Saya: a role without own target (database refuses) gets the permission state", async () => {
    io.ctx = ctx("owner");
    io.fail = { code: "ERR_FORBIDDEN" };
    expect(text(await render(await import("../../src/app/(app)/saya/target/page"), sp()))).toContain("Anda tidak memiliki akses ke target.");
  });
  it("Target & Scorecard Staf: target_list; the owner gets Tetapkan Target on BC rows only; manager reads only", async () => {
    const row = (name: string, bc: boolean) => ({ staff_id: `00000000-0000-4000-8000-00000000000${bc ? 1 : 2}`, staff: name, is_bc: bc, target: null, closing_value_actual: 0,
      branch_closing_value: null, plans_actual: 0, attainment_bps: null, scorecard: { completed_services: 0, executed_minutes: 0, rostered_minutes: 0, utilization_bps: 5000, commission_gross: 0, commission_adjustments: 0, commission_net: 0 } });
    io.ctx = ctx("owner");
    io.rows = (s) => (s.includes("target_list") ? [{ r: { role: "owner", period: "2026-11", period_kind: "bulanan", branch_id: null, can_set: true, rows: [row("BC Satu", true), row("Dokter Dua", false)] } }] : []);
    const out = await render(await import("../../src/app/(app)/staf/target/page"), sp());
    expect(io.sql).toEqual(["select target_list($1, $2) as r"]);
    expect(text(out)).toContain("BC Satu");
    expect(text(out)).toContain("Target belum ditetapkan");
    expect((out.match(/Tetapkan Target/g) ?? []).length).toBe(1);
    io.rows = (s) => (s.includes("target_list") ? [{ r: { role: "manager", period: "2026-11", period_kind: "bulanan", branch_id: "b1", can_set: false, rows: [row("BC Satu", true)] } }] : []);
    const m = await render(await import("../../src/app/(app)/staf/target/page"), sp());
    expect(m).not.toContain("Tetapkan Target");
    expect(text(m)).toContain("hanya lihat");
  });
  it("Notifikasi: list of the caller's notifications; open ones get Tandai Selesai; empty open list offers Semua", async () => {
    io.ctx = ctx("facility_head", "b1");
    io.rows = (s) => (s.includes("from notifications") ? [
      { id: "00000000-0000-4000-8000-000000000031", type: "credential_expiry", label: "STR/SIP hampir habis masa berlaku", subject_kind: "staff_credential", subject_id: "00000000-0000-4000-8000-000000000032", branch_id: "b1", created_at: new Date("2026-11-19T03:00:00Z"), acknowledged_at: null },
    ] : []);
    const out = await render(await import("../../src/app/(app)/saya/notifikasi/page"), sp());
    expect(io.sql.every((s) => s.includes("from notifications"))).toBe(true);
    expect(text(out)).toContain("STR/SIP hampir habis masa berlaku");
    expect(out).toContain('href="/staf?segmen=kredensial"');
    expect(text(out)).toContain("Tandai Selesai");
    io.rows = () => [];
    expect(text(await render(await import("../../src/app/(app)/saya/notifikasi/page"), sp()))).toContain("Tidak ada notifikasi yang belum selesai.");
  });
  it("Matriks Persetujuan: owner and Admin Pusat only; reads only setting values in force", async () => {
    io.ctx = ctx("finance");
    expect(text(await render(await import("../../src/app/(app)/persetujuan/matriks/page")))).toContain("Anda tidak memiliki akses ke matriks persetujuan.");
    expect(io.sql).toEqual([]);
    io.ctx = ctx("admin_pusat");
    io.rows = (s) => (s.includes("setting_value_at") ? [{ v: null }] : []);
    const out = text(await render(await import("../../src/app/(app)/persetujuan/matriks/page")));
    expect(io.sql.length).toBeGreaterThan(0);
    expect(io.sql.every((s) => s.includes("setting_value_at"))).toBe(true);
    expect(out).toContain("Hapus piutang Owner");
    expect(out).toContain("Pengaju tidak pernah menyetujui permintaannya sendiri");
  });
  it("Survei: survey_summary + survey_list; empty period; a refused role gets the permission state", async () => {
    io.ctx = ctx("marketing");
    io.rows = (s) => (s.includes("survey_summary") ? [{ r: [] }] : s.includes("survey_list") ? [{ r: { role: "marketing", rows: [] } }] : []);
    expect(text(await render(await import("../../src/app/(app)/lead/survei/page"), sp()))).toContain("Belum ada survei pada periode ini.");
    expect(io.sql.map((s) => s.split("(")[0])).toEqual(["select survey_summary", "select survey_list"]);
    io.fail = { code: "ERR_FORBIDDEN" };
    io.ctx = ctx("bc", "b1");
    expect(text(await render(await import("../../src/app/(app)/lead/survei/page"), sp()))).toContain("Anda tidak memiliki akses ke survei.");
  });
  it("Survei: Manager and Marketing only (19:169, nav M MK) — owner, central CS and auditor, whom the readers admit, get the permission state with no read (review r1 P1)", async () => {
    const { READERS } = await import("../../src/app/(app)/lead/survei/page");
    expect([...READERS].sort()).toEqual(["manager", "marketing"]);
    for (const role of ["owner", "central_cs", "auditor"]) {
      io.sql = [];
      io.ctx = ctx(role);
      io.rows = (s) => (s.includes("survey_summary") ? [{ r: [{ branch_id: "b", total: 1, low_count: 1, avg_score: 1, low_pct: 100 }] }]
        : s.includes("survey_list") ? [{ r: { role, rows: [{ id: "x", score: 1, day: "2026-11-19", branch_id: "b", branch_name: "C", patient_name: "Pasien Rahasia", patient_mrn: "RM-1", consent_masked: false }] } }] : []);
      const out = text(await render(await import("../../src/app/(app)/lead/survei/page"), sp()));
      expect(out, role).toContain("Anda tidak memiliki akses ke survei.");
      expect(out, role).not.toContain("Pasien Rahasia");
      expect(io.sql, role).toEqual([]);
    }
    io.ctx = ctx("manager", "b1");
    io.rows = (s) => (s.includes("survey_summary") ? [{ r: [] }] : s.includes("survey_list") ? [{ r: { role: "manager", rows: [] } }] : []);
    expect(text(await render(await import("../../src/app/(app)/lead/survei/page"), sp()))).toContain("Belum ada survei pada periode ini.");
  });
  it("Jadwal Saya: own rows only (staff_id = app_staff_id()); performer appointments through the calendar reader at the active branch", async () => {
    io.ctx = ctx("doctor", "b1");
    io.rows = (s) => (s.includes("appointments_window") ? [{ w: { appointments: [], performers: [] } }] : []);
    const out = text(await render(await import("../../src/app/(app)/saya/jadwal/page")));
    expect(out).toContain("Belum ada jadwal untuk 14 hari ke depan.");
    const own = io.sql.filter((s) => /from staff_(shifts|leave)/.test(s));
    expect(own).toHaveLength(2);
    for (const s of own) expect(s).toContain("staff_id = app_staff_id()");
    expect(io.sql.some((s) => s.includes("appointments_window"))).toBe(true);
    // populated (review r1 residual): the caller's own appointment is shown, another performer's patient never is
    const appt = (performer: string, patient: string, hour: number) => ({ id: `${performer}-${hour}`, state: "booked", starts_at: new Date(Date.now() + (24 + hour) * 3_600_000).toISOString(),
      ends_at: new Date(Date.now() + (25 + hour) * 3_600_000).toISOString(), hold_until: null, no_show_from: new Date().toISOString(), channel: "phone", patient_id: "p",
      patient_name: patient, patient_mrn: "RM", service_name: "Facial", version_id: "v", performer_id: performer, performer_name: "x", rooms: [], devices: [] });
    io.rows = (s) => (s.includes("appointments_window") ? [{ w: { appointments: [appt("00000000-0000-4000-8000-000000000021", "Pasien Sendiri", 1),
      appt("00000000-0000-4000-8000-000000000099", "Pasien Dokter Lain", 2)], performers: [] } }] : []);
    const pop = text(await render(await import("../../src/app/(app)/saya/jadwal/page")));
    expect(pop).toContain("Pasien Sendiri");
    expect(pop).not.toContain("Pasien Dokter Lain");
    io.sql = [];
    io.ctx = ctx("finance");
    await render(await import("../../src/app/(app)/saya/jadwal/page"));
    expect(io.sql.some((s) => s.includes("appointments_window"))).toBe(false);
  });
});

describe("server actions refuse a form rendered in another context before any write (HYG-009 B2-1; review r1 residual)", () => {
  const T = "00000000-0000-4000-8000-000000000001";
  const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
  const variants = (r: string, b: string) => [
    ["tenant", { ctx_t: "00000000-0000-4000-8000-000000000002", ctx_r: r, ctx_b: b }],
    ["role", { ctx_t: T, ctx_r: "manager", ctx_b: b }],
    ["branch", { ctx_t: T, ctx_r: r, ctx_b: "b-lain" }],
    ["missing", {}],
  ] as const;
  it("Tetapkan Target (staf/target/actions): mismatched or missing tenant / role / branch → STALE_CONTEXT, no write; matching → written", async () => {
    const { setTargetAction } = await import("../../src/app/(app)/staf/target/actions");
    const { STALE_CONTEXT } = await import("../../src/modules/org/context/context");
    io.ctx = ctx("owner");
    const base = { staff: "00000000-0000-4000-8000-000000000031", period: "2026-11", key: "00000000-0000-4000-8000-000000000041", closing: "5.000.000" };
    for (const [what, c] of variants("owner", "")) {
      io.sql = [];
      expect(await setTargetAction({}, form({ ...base, ...c })), what).toEqual({ error: STALE_CONTEXT, n: 1 });
      expect(io.sql, what).toEqual([]);
    }
    io.sql = [];
    io.rows = (s) => (s.includes("staff_target_set") ? [{ r: "t1" }] : []);
    vi.stubEnv("DEPLOY_ENV", "local"); // the production go-live guard fails closed without it (MIG-2: synthetic data only)
    const ok = await setTargetAction({}, form({ ...base, ctx_t: T, ctx_r: "owner", ctx_b: "" }));
    vi.unstubAllEnvs();
    // a matching context passes the guard and reaches the writer path (the idempotency wrapper's own reads hit the fake database: the full
    // write is proven on PostgreSQL by the isolation case)
    expect(ok.error).not.toBe(STALE_CONTEXT);
    expect(io.sql.length).toBeGreaterThan(0);
  });
  it("Tandai Selesai (saya/notifikasi/actions): mismatched or missing tenant / role / branch → STALE_CONTEXT, no ack; matching → acknowledged", async () => {
    const { ackAction } = await import("../../src/app/(app)/saya/notifikasi/actions");
    const { STALE_CONTEXT } = await import("../../src/modules/org/context/context");
    io.ctx = ctx("facility_head", "b1");
    const id = "00000000-0000-4000-8000-000000000051";
    for (const [what, c] of variants("facility_head", "b1")) {
      io.sql = [];
      expect(await ackAction({}, form({ id, ...c })), what).toEqual({ error: STALE_CONTEXT, n: 1 });
      expect(io.sql, what).toEqual([]);
    }
    io.sql = [];
    io.rows = (s) => (s.includes("notification_ack") ? [{ at: new Date() }] : []);
    expect(await ackAction({}, form({ id, ctx_t: T, ctx_r: "facility_head", ctx_b: "b1" }))).toEqual({ n: 1 });
    expect(io.sql).toEqual(["select notification_ack($1) as at"]);
  });
});

describe("redirects and static pages", () => {
  it("Koreksi Rekam Medis opens Persetujuan filtered to late record corrections (a type the inbox knows)", async () => {
    const { APPROVAL_TYPES } = await import("../../src/modules/approvals/inbox");
    const page = (await import("../../src/app/(app)/persetujuan/koreksi/page")).default;
    expect(() => page()).toThrow("redirect /persetujuan?jenis=record_late_correction");
    expect(APPROVAL_TYPES.record_late_correction.approverRoles).toEqual(["records_officer", "facility_head"]);
  });
  it("Tindak Lanjut opens the Lead segment the lead page renders", async () => {
    const page = (await import("../../src/app/(app)/lead/tindak-lanjut/page")).default;
    expect(() => page()).toThrow("redirect /lead?segmen=tindak-lanjut");
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(join(ROOT, "src/app/(app)/lead/page.tsx"), "utf8")).toContain('sp.segmen === "tindak-lanjut"');
  });
  it("Bantuan and Tampilan render without any data access", async () => {
    const b = text(renderToStaticMarkup((await import("../../src/app/(app)/saya/bantuan/page")).default() as never));
    expect(b).toContain("Ctrl + K");
    expect(b).not.toMatch(/Keranjang|Checkout|Pesanan|Pembeli|Pengiriman/);
    const t = renderToStaticMarkup((await import("../../src/app/(app)/saya/tampilan/page")).default() as never);
    expect(text(t)).toContain("Kurangi transparansi");
    expect(t).toContain('role="switch"');
    expect(io.sql).toEqual([]);
  });
});

describe("nav coverage (T-130 batch 1)", () => {
  const BATCH = ["/saya/target", "/staf/target", "/saya/jadwal", "/saya/notifikasi", "/saya/tampilan", "/saya/bantuan", "/persetujuan/koreksi", "/persetujuan/matriks", "/lead/tindak-lanjut", "/lead/survei"];
  it("every route of the batch is a nav page and now has its page.tsx", async () => {
    const nav = await import("../../src/components/shell/nav");
    const hrefs = new Set([...nav.NAV.flatMap((g) => g.pages), ...nav.SAYA].map((p) => p.href));
    for (const h of BATCH) {
      expect(hrefs.has(h), h).toBe(true);
      expect(existsSync(join(ROOT, "src/app/(app)", h, "page.tsx")), h).toBe(true);
    }
  });
  it("the tab bars and landing pages that hit these routes now resolve (BC Target / Tindak Lanjut, CS Tindak Lanjut, RO Koreksi)", async () => {
    const nav = await import("../../src/components/shell/nav");
    for (const role of ["bc", "central_cs", "records_officer"] as const) {
      for (const t of [...nav.tabsFor(role), nav.landingFor(role)]) {
        const h = t.href.split("?")[0];
        if (BATCH.includes(h)) expect(existsSync(join(ROOT, "src/app/(app)", h, "page.tsx")), `${role} ${h}`).toBe(true);
      }
    }
  });
});
