// T-110 (PR-33b, UX-21) presentational slice: synthetic payloads only, no database and no reader (T-107 wires the reader).
// Proves: the manager sees only the active branch (another branch's payload is refused, ?cabang is never an input); every
// KPI tile is a link to its records (PR-33); an unavailable value is shown as "Belum tersedia", never 0 / Rp0, while a real
// zero stays 0; the projection is an allowlist, so clinical or identity fields a reader might add never render (PR-33,
// SEC-2); Scenario PR-33b stock risk (an item below minimum appears with a link to reorder); every state renders.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
// The page gate (ringkasan/cabang/data.ts) reads the request context; here a controllable stand-in (as other route tests do).
const gate = vi.hoisted(() => ({ rc: null as unknown, pool: null as unknown }));
vi.mock("server-only", () => ({}));
// redirect() / notFound() throw Next's control-flow errors in a request; here they throw a plain, recognisable error (as the T-113 / T-116 route tests do).
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); },
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));
vi.mock("../../src/modules/org/context/store", () => ({ requestContext: async () => gate.rc, appPool: async () => gate.pool }));
import {
  count, drill, isRole, money, projectSummary, resolveView, scopeFor, show, utilization, type Viewer, type ViewState, VIEWERS,
} from "../../src/app/(app)/ringkasan/cabang/model";
import { BranchSummaryView } from "../../src/app/(app)/ringkasan/cabang/view";
import { ROLES, type Role } from "../../src/auth/policy";
import pg from "pg";
import { afterAll, beforeAll } from "vitest";
import { LEVEL3_ROLES } from "../../src/modules/org/schema";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { publish } from "../../src/modules/catalog/catalog";
import { saveItem, setLevel } from "../../src/modules/inventory/stock";
import { receiveCosted } from "../../src/modules/inventory/costing/costing";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { setStaffTarget } from "../../src/modules/commission/targets/targets";
import { MISSING, readBranchSummary } from "../../src/app/(app)/ringkasan/cabang/reader";
import { cabangIn, navRoles, ROUTE_FOR } from "../../src/app/(app)/ringkasan/cabang/load";
import { loadCabangPage } from "../../src/app/(app)/ringkasan/cabang/data";
import { cabangBody } from "../../src/app/(app)/ringkasan/cabang/body";
import { FULL as SETTINGS_FULL, READERS as SETTINGS_READERS } from "../../src/app/(app)/pengaturan/cabang/data";
import { existsSync } from "node:fs";
import { createHarness, type Harness, testPool } from "../rls/harness";

const A = { id: "0193a000-0000-7000-8000-00000000000a", name: "Cabang Sintetis A" };
const B = { id: "0193a000-0000-7000-8000-00000000000b", name: "Cabang Sintetis B" };
const ITEM = "0193a000-0000-7000-8000-0000000000c1";
const BC = "0193a000-0000-7000-8000-0000000000d1";
const NURSE = "0193a000-0000-7000-8000-0000000000d2";
const manager: Viewer = { role: "manager", activeBranchId: A.id, branches: [A] };

// Sentinels a careless reader could leak: none may reach the markup.
const SENTINEL = {
  patient: "Pasien Sentinel Rahasia", phone: "081299990000", nik: "3171000000000001", diagnosis: "Diagnosis Sentinel L70.0",
  note: "Catatan klinis sentinel", photo: "/media/sentinel.jpg", message: "Isi pesan WhatsApp sentinel",
};

function payload(over: Record<string, unknown> = {}) {
  return {
    branch_id: A.id,
    today: "2026-11-19",
    wait_minutes: 20,
    chase: { unpaid_bills: 2, unpaid_additions: 0, receivables_due: "3", no_shows_to_rebook: 1, waiting_long: 0, approvals: 4, complaints: 0,
      patients: [{ name: SENTINEL.patient, phone: SENTINEL.phone }] },
    today_counts: { appointments: 12, arrived: 7, in_treatment: 2, waiting_payment: 1, no_shows: 1, rooms_in_use: 3, devices_in_use: 0, staff_on_duty: 6 },
    hours: [{ hour: 9, booked: 3, arrived: 3, patient_name: SENTINEL.patient }, { hour: 10, booked: 4, arrived: 2 }],
    tomorrow: { appointments: 9, leave_conflicts: 1, gaps: [{ staff_id: NURSE, name: "Perawat Sintetis", booked_minutes: 240, rostered_minutes: 480 }] },
    stock: { expiring_30d: 2, count_variance: 0, pending_po: 1,
      below_min: [{ item_id: ITEM, name: "Kasa Steril Sintetis", on_hand: 3, min_qty: 10, unit: "pak", supplier_price: 999_999 }] },
    staff: [
      { staff_id: BC, name: "BC Sintetis", role: "bc", completions: 5, k17_rupiah: "1250000", k19: { closing_rupiah: 30_000_000, target_rupiah: 50_000_000 } },
      { staff_id: NURSE, name: "Perawat Sintetis", role: "nurse", completions: 8, k17_rupiah: 0, k19: null, nik: SENTINEL.nik },
    ],
    diagnosis: SENTINEL.diagnosis, clinical_note: SENTINEL.note, photo_url: SENTINEL.photo, last_message: SENTINEL.message,
    ...over,
  };
}
const ok = (raw: unknown, filter: "semua" | "perlu" = "semua", viewer = manager) => resolveView({ viewer, filter, read: { ok: true, raw } });
const html = (s: ViewState) => renderToStaticMarkup(BranchSummaryView({ state: s }));
const hrefs = (h: string) => [...h.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replaceAll("&amp;", "&"));

describe("PR-33b branch scope", () => {
  it("only the manager views it, on the active branch", () => {
    expect(VIEWERS).toEqual(["manager"]);
    for (const role of ROLES.filter((r) => r !== "manager")) {
      expect(scopeFor({ role, activeBranchId: A.id, branches: [A, B] })).toEqual({ kind: "permission" });
    }
    expect(scopeFor(manager)).toEqual({ kind: "ok", branch: A });
    expect(scopeFor({ ...manager, activeBranchId: null })).toEqual({ kind: "no-branch" });
    // an active id outside the manager's branches is not honoured
    expect(scopeFor({ ...manager, activeBranchId: B.id })).toEqual({ kind: "no-branch" });
  });

  it("another branch's payload is refused, never rendered", () => {
    const v = ok(payload({ branch_id: B.id }));
    expect(v).toEqual({ kind: "permission" });
    const h = html(v);
    expect(h).toContain("Anda tidak memiliki akses ke Ringkasan Cabang.");
    expect(h).not.toContain(B.name);
    expect(h).not.toMatch(/\d+.*Janji hari ini/);
  });

  it("drill-down links carry no branch parameter (the target page scopes to the active branch)", () => {
    const h = html(ok(payload()));
    expect(hrefs(h).filter((x) => /cabang=/.test(x))).toEqual([]);
  });
});

describe("KPI presentation and drill-down (PR-33)", () => {
  const v = ok(payload());
  const h = html(v);

  it("every value tile is a link to its records", () => {
    const d = drill("2026-11-19");
    if (v.kind !== "ok") throw new Error(v.kind);
    for (const t of [...v.summary.todayTiles, ...v.summary.tomorrowTiles, ...v.summary.stockTiles]) {
      expect(h).toMatch(new RegExp(`data-metric="${t.key}"[^>]*href="${t.href.replaceAll("&", "&amp;").replace(/[?]/g, "\\?")}"`));
    }
    expect(v.summary.todayTiles.find((t) => t.key === "appointments")?.href).toBe(d.today);
    expect(v.summary.tomorrowTiles.find((t) => t.key === "appointments")?.href).toBe("/jadwal?tampilan=hari&tanggal=2026-11-20");
    expect(v.summary.chase.find((t) => t.key === "receivables_due")?.href).toBe("/piutang");
    expect(v.summary.chase.find((t) => t.key === "no_shows")?.href).toBe("/jadwal?tampilan=hari&tanggal=2026-11-19");
    for (const x of hrefs(h)) expect(x.startsWith("/")).toBe(true);
  });

  it("formats counts, integer rupiah, K15 and K19", () => {
    expect(h).toContain("Tagihan belum dibayar");
    expect(h).toMatch(/data-metric="receivables_due"[^>]*>.*?>3</);
    expect(h).toContain("Rp1.250.000"); // K17 from a bigint string
    expect(h).toContain("Rp30.000.000 dari Rp50.000.000"); // K19 for the BC
    expect(h).toContain("50%"); // K15: 240 of 480 rostered minutes
    expect(h).toContain("240 menit");
    expect(utilization({ staffId: NURSE, name: "x", bookedMin: 10, rosteredMin: 0 })).toEqual({ kind: "unavailable", reason: "no_roster" });
    if (v.kind !== "ok") throw new Error(v.kind);
    expect(v.summary.chase.find((t) => t.key === "waiting_long")?.label).toBe("Menunggu lebih dari 20 menit"); // SET-38 value
    const p = payload({ wait_minutes: null });
    const pv = projectSummary(p, A);
    if (pv.kind !== "ok") throw new Error(pv.kind);
    expect(pv.summary.chase.find((t) => t.key === "waiting_long")?.label).toBe("Pasien menunggu terlalu lama");
  });

  it("Perlu Ditangani hides a zero; the filter shows only it", () => {
    if (v.kind !== "ok") throw new Error(v.kind);
    const perlu = h.split('id="perlu"')[1].split("</section>")[0];
    expect(perlu).toContain("Menunggu persetujuan");
    expect(perlu).not.toContain("Keluhan terbuka"); // 0 → hidden
    const f = html(ok(payload(), "perlu"));
    expect(f).toContain('id="perlu"');
    expect(f).not.toContain('id="hari-ini"');
    expect(f).toContain('aria-current="true"');
  });

  it("Scenario PR-33b stock risk: an item below minimum appears with a link to reorder", () => {
    const row = h.split(`data-item="${ITEM}"`)[1].split("</li>")[0];
    expect(row).toContain("Kasa Steril Sintetis");
    expect(row).toContain("Sisa 3 pak · minimum 10 pak");
    expect(row).toContain(`href="/stok/item/${ITEM}"`);
    expect(row).toContain('href="/pembelian/po"');
    expect(row).toContain("Buat PO untuk Kasa Steril Sintetis");
  });
});

describe("unavailable is not zero", () => {
  it("metric parsing", () => {
    expect(count(0)).toEqual({ kind: "count", value: 0 });
    expect(count(undefined)).toEqual({ kind: "unavailable", reason: "reader_pending" });
    expect(count(null)).toEqual({ kind: "unavailable", reason: "reader_pending" });
    for (const bad of [-1, 1.5, "1.5", "x", NaN, Infinity, {}, true]) expect(count(bad)).toEqual({ kind: "unavailable", reason: "invalid" });
    expect(money("0")).toEqual({ kind: "money", rupiah: 0 });
    expect(money(-25_000)).toEqual({ kind: "money", rupiah: -25_000 });
    expect(money(0.5)).toEqual({ kind: "unavailable", reason: "invalid" }); // integer rupiah only
    expect(show(money(undefined))).toBe("Belum tersedia");
    expect(show(money(0))).toBe("Rp0");
    expect(show(count(0))).toBe("0");
  });

  it("a missing K17, K19, list and tile renders Belum tersedia, a real 0 renders 0 / Rp0", () => {
    const p = payload();
    delete (p.today_counts as Record<string, unknown>).devices_in_use;
    p.staff = [{ staff_id: BC, name: "BC Sintetis", role: "bc", completions: 0, k17_rupiah: null, k19: null } as never,
      { staff_id: NURSE, name: "Perawat Sintetis", role: "nurse", completions: 2, k17_rupiah: 0, k19: null } as never];
    delete (p as Record<string, unknown>).hours;
    const v = ok(p);
    if (v.kind !== "ok") throw new Error(v.kind);
    const h = html(v);
    expect(h).toMatch(/data-metric="devices_in_use" data-state="unavailable"[^>]*>.*?Belum tersedia/);
    expect(h).toMatch(/data-metric="rooms_in_use" data-state="value"[^>]*>.*?>3</);
    const staff = h.split('id="staf"')[1].split("</section>")[0];
    const bcRow = staff.split("BC Sintetis")[1].split("</tr>")[0];
    expect(bcRow).toContain("Belum tersedia"); // K17 null and K19 pending: not Rp0
    expect(bcRow).not.toContain("Rp0");
    const nurseRow = staff.split("Perawat Sintetis")[1].split("</tr>")[0];
    expect(nurseRow).toContain("Rp0"); // a real zero
    expect(nurseRow).toContain("—"); // K19 does not apply to a nurse
    const hari = h.split('id="hari-ini"')[1].split("</section>")[0];
    expect(hari).toContain('data-state="unavailable"');
    expect(hari).not.toContain("Belum ada janji hari ini.");
  });

  it("an unset target is not 0 %", () => {
    const p = payload({ staff: [{ staff_id: BC, name: "BC Sintetis", role: "bc", completions: 1, k17_rupiah: 0, k19: { closing_rupiah: 0, target_rupiah: 0 } }] });
    expect(html(ok(p))).toContain("Target belum diatur");
  });

  it("an untrusted list is shown as invalid, not as an empty list", () => {
    const p = payload({ hours: [{ hour: 30, booked: 1, arrived: 0 }] });
    const h = html(ok(p));
    expect(h.split('id="hari-ini"')[1].split("</section>")[0]).toContain("Data tidak valid.");
  });
});

describe("no clinical or identity content (PR-33, SEC-2)", () => {
  it("the projection is an allowlist: no sentinel reaches the model or the markup", () => {
    const p = projectSummary(payload(), A);
    if (p.kind !== "ok") throw new Error(p.kind);
    const model = JSON.stringify(p.summary);
    const h = html(ok(payload()));
    for (const s of Object.values(SENTINEL)) {
      expect(model).not.toContain(s);
      expect(h).not.toContain(s);
    }
    expect(model).not.toContain("999999"); // supplier price is not on the manager summary
    const keys = new Set<string>();
    const walk = (x: unknown) => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { keys.add(k); walk(v); }
    };
    walk(p.summary);
    for (const k of ["patient", "patients", "patient_name", "phone", "nik", "diagnosis", "clinical_note", "photo_url", "last_message", "supplier_price"]) {
      expect(keys.has(k)).toBe(false);
    }
  });

  it("names are React text (escaped)", () => {
    const hostile = `<img src=x onerror="alert(1)">`;
    const h = html(ok(payload({ stock: { expiring_30d: 0, count_variance: 0, pending_po: 0,
      below_min: [{ item_id: ITEM, name: hostile, on_hand: 0, min_qty: 1, unit: "pak" }] } })));
    expect(h).not.toContain("<img");
    expect(h).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("an unknown role in a staff row is refused", () => {
    expect(isRole("manager")).toBe(true);
    expect(isRole("vendor_finance")).toBe(false);
    const h = html(ok(payload({ staff: [{ staff_id: BC, name: "X", role: "patient", completions: 1, k17_rupiah: 0 }] })));
    expect(h.split('id="staf"')[1]).toContain("Data tidak valid.");
  });
});

describe("T-110 mount defect (200 % text): the staff list switches table ↔ cards on its CONTAINER, never on the viewport", () => {
  const out = html(ok(payload()));
  const staff = out.slice(out.indexOf('id="staf"'), out.indexOf("</section>", out.indexOf('id="staf"')));
  it("the staff section is a size container; the table shows only from a wide container (@min-[64em]) and the cards hide there; no viewport breakpoint in it", () => {
    expect(staff).toContain("@container");
    expect(staff).toContain("@min-[64em]:block");
    expect(staff).toContain("@min-[64em]:hidden");
    expect(staff).not.toMatch(/min-\[\d+px\]:(block|hidden)/);
  });
  it("same content as before: a table (caption, five column headers, a row per staff member) and the compact cards with the same values", () => {
    expect(staff).toContain('<caption class="sr-only">Staf cabang bulan ini</caption>');
    for (const h of ["Nama", "Peran", "Layanan selesai", "Target BC (K19)", "Komisi terutang (K17)"]) expect(staff).toContain(`>${h}</th>`);
    expect((staff.match(/<th scope="row"/g) ?? []).length).toBe((staff.match(/<li /g) ?? []).length);
    expect((staff.match(/<li /g) ?? []).length).toBeGreaterThan(0);
  });
  it("no staff: the empty message, never an empty table", () => {
    const e = html(ok(payload({ staff: [] })));
    const sec = e.slice(e.indexOf('id="staf"'), e.indexOf("</section>", e.indexOf('id="staf"')));
    expect(sec).toContain("Belum ada staf bertugas bulan ini.");
    expect(sec).not.toContain("<table");
  });
});

describe("T-110 route mount: page, error boundary and page body (no database)", () => {
  const ctxOf = (role: Role) => ({ kind: "ok", active: { context: { actingRole: role, activeBranchId: null } } });
  it("the route exports only a default page and metadata (a Next page file may export nothing else); the title names the page", async () => {
    const m = await import("../../src/app/(app)/ringkasan/cabang/page");
    expect(Object.keys(m).sort()).toEqual(["default", "metadata"]);
    expect((m.metadata as { title: string }).title).toBe("Ringkasan Cabang — Clinic Dashboard");
  });
  it("loading: while the body streams the page shows the title with a busy skeleton (Suspense fallback), never a figure", async () => {
    const m = await import("../../src/app/(app)/ringkasan/cabang/page");
    const el = m.default({ searchParams: Promise.resolve({}) }) as { props: { fallback: unknown } };
    const out = renderToStaticMarkup(el.props.fallback as never);
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain("Ringkasan Cabang");
    expect(out).not.toMatch(/Perlu Ditangani|Buat PO|data-kpi/);
  });
  it("error boundary: the title, 'Coba Lagi' wired to retry, and never the error's own text", async () => {
    const e = await import("../../src/app/(app)/ringkasan/cabang/error");
    const retry = vi.fn();
    const el = e.default({ error: new Error("rahasia: koneksi basis data putus"), retry }) as { props: { children: { props: { onRetry: unknown } }[] } };
    const out = renderToStaticMarkup(el as never);
    expect(out).toContain("Ringkasan cabang belum bisa dimuat. Tidak ada yang berubah.");
    expect(out).toContain('role="alert"');
    expect(out).toContain("Coba Lagi");
    expect(out).not.toContain("rahasia");
    expect(el.props.children[1].props.onRetry).toBe(retry);
  });
  it("cabangBody gate: every role outside the nav row (M O AP) gets the permission state BEFORE any read; sign-in redirect and blocked kept", async () => {
    gate.pool = null; // no pool: a read would throw
    for (const role of ROLES.filter((r) => !["manager", "owner", "admin_pusat"].includes(r))) {
      gate.rc = ctxOf(role);
      const out = renderToStaticMarkup((await cabangBody(Promise.resolve({}))) as never);
      expect(out, role).toContain("Anda tidak memiliki akses ke Ringkasan Cabang.");
      expect(out, role).not.toMatch(/Perlu Ditangani|Buat PO/);
    }
    gate.rc = { kind: "redirect", to: "/masuk" };
    await expect(cabangBody(Promise.resolve({}))).rejects.toThrow("NEXT_REDIRECT /masuk");
    gate.rc = { kind: "blocked", accountId: "x" };
    expect(renderToStaticMarkup((await cabangBody(Promise.resolve({}))) as never)).toContain("Anda tidak memiliki akses ke Ringkasan Cabang.");
  });
});

describe("states (10 State Copy Patterns)", () => {
  it("loading, permission, no-branch, error, empty, filtered-empty", () => {
    const loading = html({ kind: "loading" });
    expect(loading).toContain('aria-busy="true"');
    expect(loading.replace(/<[^>]+>/g, "")).toBe("Ringkasan Cabang"); // skeleton only, no text besides the title

    expect(html(resolveView({ viewer: { ...manager, role: "owner" }, filter: "semua", read: { ok: true, raw: payload() } })))
      .toContain("Anda tidak memiliki akses ke Ringkasan Cabang.");
    expect(html(resolveView({ viewer: { ...manager, activeBranchId: null }, filter: "semua", read: { ok: true, raw: payload() } })))
      .toContain("Belum ada cabang aktif.</span> <span class=\"text-[var(--label-2)]\">Pilih cabang di Saya › Ganti Cabang.");

    const err = resolveView({ viewer: manager, filter: "semua", read: { ok: false } });
    expect(err).toEqual({ kind: "error" });
    expect(html(err)).toMatch(/role="alert".*Ringkasan cabang belum bisa dimuat\..*href="\/ringkasan\/cabang"[^>]*>Coba Lagi/);
    expect(ok({ branch_id: A.id, today: "19-11-2026" })).toEqual({ kind: "error" });

    const zeros = {
      branch_id: A.id, today: "2026-11-19", wait_minutes: 20,
      chase: { unpaid_bills: 0, unpaid_additions: 0, receivables_due: 0, no_shows_to_rebook: 0, waiting_long: 0, approvals: 0, complaints: 0 },
      today_counts: { appointments: 0, arrived: 0, in_treatment: 0, waiting_payment: 0, no_shows: 0, rooms_in_use: 0, devices_in_use: 0, staff_on_duty: 0 },
      hours: [], tomorrow: { appointments: 0, leave_conflicts: 0, gaps: [] }, stock: { expiring_30d: 0, count_variance: 0, pending_po: 0, below_min: [] }, staff: [],
    };
    const empty = ok(zeros);
    expect(empty.kind).toBe("empty");
    expect(html(empty)).toContain("Belum ada aktivitas di cabang ini.");
    // all zero but one value unavailable: not "empty" (unknown is not nothing)
    expect(ok({ ...zeros, staff: undefined }).kind).toBe("ok");

    const quiet = { ...zeros, today_counts: { ...zeros.today_counts, appointments: 5 } };
    const fe = ok(quiet, "perlu");
    expect(fe.kind).toBe("filtered-empty");
    expect(html(fe)).toMatch(/Tidak ada yang perlu ditangani untuk filter ini\..*href="\/ringkasan\/cabang"[^>]*>Hapus Filter/);
    expect(ok(quiet, "semua").kind).toBe("ok");
  });

  it("compact and regular layouts: cards below 700 px, a table at ≥ 700 px, four tiles across at ≥ 1180 px", () => {
    const h = html(ok(payload()));
    expect(h).toContain("min-[700px]:block"); // ReportTable table
    expect(h).toContain("min-[700px]:hidden"); // ReportTable cards
    expect(h).toContain("min-[1180px]:grid-cols-4");
    expect(h.match(/<main/g)).toHaveLength(1);
    expect(h.match(/<h1/g)).toHaveLength(1);
  });
});

// ── slice 2 (P1, on main f0bd3c44): the existing T-107 / stock / purchasing / complaint / target readers wired for one branch, on
// PostgreSQL with synthetic facts. Proves the manager's own-branch scope at the readers, unavailable vs zero end to end, and Scenario
// PR-33b through the real stock reader. ──
describe("readBranchSummary on the real readers (PostgreSQL, synthetic)", () => {
  let h: Harness; let app: pg.Pool; let owner: pg.Pool; let n = 0;
  type T = { tenantId: string; b1: string; b2: string };
  type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
  const WIDE: string[] = ROLES.filter((r) => !(LEVEL3_ROLES as readonly string[]).includes(r));
  const key = () => crypto.randomUUID();
  const tenant = async (name: string): Promise<T> => {
    const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
    await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, name]);
    const br = async (c: string) => (await h.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
    return { tenantId, b1: await br("RC-A"), b2: await br("RC-B") };
  };
  const person = async (t: T, role: Role, ...branches: string[]): Promise<P> => {
    const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`rc${++n}@klinik-sintetis.test`])).rows[0].id as string;
    const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Cabang ${n}` });
    const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
    if (!WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
    return { acc, staffId, tenantId: t.tenantId, role, branch: WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
  };
  const as = async <X>(p: P, fn: (db: pg.PoolClient) => Promise<X>) =>
    withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
  const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : String(e)));
  async function seedRaw(tables: string[], fn: () => Promise<void>) {
    const off: [string, string][] = [];
    for (const tb of tables) for (const r of (await h.admin.query(`select tgname from pg_trigger where tgrelid = $1::regclass and not tgisinternal and tgenabled <> 'D'`, [tb])).rows) off.push([tb, r.tgname]);
    for (const [tb, tg] of off) await h.admin.query(`alter table ${tb} disable trigger ${tg}`);
    try { await fn(); } finally { for (const [tb, tg] of off) await h.admin.query(`alter table ${tb} enable always trigger ${tg}`); }
  }
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  const at = (day: string, hm: string) => `${day} ${hm}+07`;
  const plusDay = (d: string, k: number) => new Date(Date.parse(`${d}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);
  // the reader's payload as the tests read it (loose on purpose: projectSummary is the typed gate)
  type Raw = { branch_id: string; today_counts: Record<string, number>; hours: unknown; tomorrow: { appointments: number; gaps: unknown };
    chase: Record<string, number>; stock: { below_min: unknown; expiring_30d: number; count_variance: number; pending_po: number };
    staff: { staff_id: string }[] };
  let A: T; let OWN: P; let MGR: P; let MGRB: P; let PH: P; let DOC: P; let BC: P; let FO: P; let low = ""; let svcV = "";
  const viewer = (p: P, name: string): Viewer => ({ role: p.role, activeBranchId: p.branch ?? null, branches: [{ id: p.branch!, name }] });

  beforeAll(async () => {
    process.env.DEPLOY_ENV = "local";
    h = await createHarness();
    app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 4 });
    owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
    A = await tenant("PT Cabang Sintetis");
    OWN = await person(A, "owner"); MGR = await person(A, "manager", A.b1); MGRB = await person(A, "manager", A.b2); PH = await person(A, "pharmacist", A.b1);
    DOC = await person(A, "doctor", A.b1); BC = await person(A, "bc", A.b1); FO = await person(A, "fo_cashier", A.b1);
    const pid = (await h.admin.query(
      `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
       values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Pasien Sentinel Rahasia', '1990-01-01', 'female', 'nik', $3, $4, 'islam', 'Karyawan', 's1', 'kawin', $2, $5, 'fo_cashier') returning id`,
      [A.tenantId, A.b1, "v1.1.a.b.c", "x".repeat(43), FO.staffId])).rows[0].id as string;
    const svc = (await h.admin.query(`insert into catalog_items (tenant_id, kind, code, created_by) values ($1, 'service', 'RC-SVC', $2) returning id`, [A.tenantId, OWN.staffId])).rows[0].id as string;
    svcV = (await h.admin.query(`insert into catalog_versions (tenant_id, item_id, version, state, name, tax_category, tax_basis, normal_price, reason, created_by, created_as, category, created_at)
      values ($1, $2, 1, 'active', 'Layanan Cabang', 'exempt_medical', 'Jasa medis', 500000, 'Baru', $3, 'owner', 'facial', '2026-01-01 00:00+07') returning id`, [A.tenantId, svc, OWN.staffId])).rows[0].id as string;
    const t0 = today(), t1 = plusDay(t0, 1);
    await seedRaw(["service_staff_eligibility", "branch_services", "staff_shifts", "appointments", "complaint_tasks"], async () => {
      const q = (sql: string, args: unknown[]) => h.admin.query(sql, args);
      await q(`insert into service_staff_eligibility (tenant_id, version_id, role, mode) values ($1, $2, 'doctor', 'performs')`, [A.tenantId, svcV]);
      await q(`insert into branch_services (tenant_id, branch_id, item_id) values ($1, $2, $3)`, [A.tenantId, A.b1, svc]);
      // tomorrow: the doctor rostered 09–17 (480) with one booked hour → K15 gap 60 / 480
      await q(`insert into staff_shifts (tenant_id, branch_id, staff_id, shift_date, starts, ends, kind, created_by) values ($1, $2, $3, $4, '09:00', '17:00', 'work', $5)`, [A.tenantId, A.b1, DOC.staffId, t1, OWN.staffId]);
      const ap = (day: string, hm: string, end: string, state: string, branch = A.b1) => q(
        `insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state, channel, created_by, created_as, state_changed_at, state_changed_by, state_reason)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'phone', $9, 'fo_cashier', case when $8 <> 'booked' then now() end, case when $8 <> 'booked' then $9::uuid end,
                 case when $8 = 'cancelled' then 'Batal uji' end)`,
        [A.tenantId, branch, pid, svcV, DOC.staffId, at(day, hm), at(day, end), state, FO.staffId]);
      // today at A: 10:00 arrived, 10:30 booked, 14:00 no-show, 15:00 cancelled (off the book); at B: one booked (never in A's counts)
      await ap(t0, "10:00", "10:30", "arrived"); await ap(t0, "10:30", "11:00", "booked"); await ap(t0, "14:00", "14:30", "no_show"); await ap(t0, "15:00", "15:30", "cancelled");
      await ap(t0, "11:00", "11:30", "booked", A.b2);
      await ap(t1, "10:00", "11:00", "booked");
      // service complaints (the kind a manager handles, complaint_readable): one open and one resolved at A, one open at B
      for (const [b, st] of [[A.b1, "open"], [A.b1, "resolved"], [A.b2, "open"]] as const) await q(
        `insert into complaint_tasks (tenant_id, branch_id, patient_id, kind, source, category, summary, due_at, flagged_by, flagged_as, state, assigned_to, assigned_as,
                                      resolved_at, resolved_by, resolved_as, resolution_outcome, resolution_note)
         values ($1, $2, $3, 'layanan', 'staff_flag', 'tagihan', 'Ringkasan keluhan sentinel', now() + interval '1 day', $4, 'doctor', $5,
                 case when $5 = 'resolved' then $4::uuid end, case when $5 = 'resolved' then 'doctor' end,
                 case when $5 = 'resolved' then now() end, case when $5 = 'resolved' then $4::uuid end, case when $5 = 'resolved' then 'doctor' end,
                 case when $5 = 'resolved' then 'edukasi' end, case when $5 = 'resolved' then 'Selesai uji' end)`, [A.tenantId, b, pid, DOC.staffId, st]);
    });
    // stock at A (real writers): an item 3 fit < minimum 5 (Scenario PR-33b), a batch expiring in 10 days
    const cat = (await as(OWN, (db) => publish(db, { kind: "material", code: "RC-LOW" }, { name: "Kasa Steril Sintetis", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1_000 } as never, "Bahan"))).itemId;
    low = (await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: cat, unit: "pak", storage: "ruang", highValue: false, active: true }))).itemId as string;
    await as(PH, (db) => receiveCosted(db, key(), null, { itemId: low, batchNo: "L-1", expiry: plusDay(t0, 10), quantity: "3", reason: "penerimaan", unitCost: 1_000 }));
    await as(PH, (db) => setLevel(db, key(), null, low, "5", "10"));
    // a control item at A with 20 fit ≥ minimum 5: never listed as risk
    const okCat = (await as(OWN, (db) => publish(db, { kind: "material", code: "RC-OK" }, { name: "Sarung Tangan Sintetis", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1_000 } as never, "Bahan"))).itemId;
    const okItem = (await as(PH, (db) => saveItem(db, key(), null, { catalogItemId: okCat, unit: "pak", storage: "ruang", highValue: false, active: true }))).itemId as string;
    await as(PH, (db) => receiveCosted(db, key(), null, { itemId: okItem, batchNo: "O-1", expiry: plusDay(t0, 300), quantity: "20", reason: "penerimaan", unitCost: 1_000 }));
    await as(PH, (db) => setLevel(db, key(), null, okItem, "5", "10"));
    // K19: the BC's target this month
    await as(OWN, (db) => setStaffTarget(db, key(), BC.staffId, t0.slice(0, 7), { closingValueTarget: 50_000_000 }));
    // Menunggu pembayaran (visits_today + unpaid(), DEC-057): visits with their payment step, which kasir_visit_payment derives from the
    // visit's issued invoices in production (in_progress while one owes, done when none owes, not_started without one). The step is the
    // fact the predicate reads, so it is seeded directly (visits_guard off for the seed only), one patient per open visit (one open visit
    // per patient and branch). At A: today in_progress (counts), YESTERDAY in_progress (counts: the tile is "waiting now", older ones
    // included, the same population as /hari-ini?tampilan=belum-bayar), blocked (counts), done but open (no), not_started (no: no bill
    // yet), and an in_progress visit already CLOSED today (no: unpaid() needs an open visit). At B: one in_progress (only B's count).
    const wpPatient = async (b: string) => (await h.admin.query(
      `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
       values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Pasien Sentinel Rahasia', '1990-01-01', 'female', 'nik', $3, $4, 'islam', 'Karyawan', 's1', 'kawin', $2, $5, 'fo_cashier') returning id`,
      [A.tenantId, b, `v1.1.${key().replace(/-/g, "")}.b.c`, key().replace(/-/g, "").padEnd(43, "x").slice(0, 43), FO.staffId])).rows[0].id as string;
    const wp: [string, string, string, boolean][] = [ // branch, payment step, check-in day, closed
      [A.b1, "in_progress", t0, false], [A.b1, "in_progress", plusDay(t0, -1), false], [A.b1, "blocked", t0, false],
      [A.b1, "done", t0, false], [A.b1, "not_started", t0, false], [A.b1, "in_progress", t0, true], [A.b2, "in_progress", t0, false]];
    const wpPids: string[] = [];
    for (const [b] of wp) wpPids.push(await wpPatient(b));
    await seedRaw(["visits"], async () => {
      for (const [i, [b, pay, day, closed]] of wp.entries()) await h.admin.query(
        `insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by, checked_in_at, payment, blocker, closed_at, closed_by)
         values ($1, $2, $3, 'walk_in', $4, $5, $6, case when $6 = 'blocked' then 'Menunggu konfirmasi pembayaran' end,
                 case when $7 then now() end, case when $7 then $4::uuid end)`,
        [A.tenantId, b, wpPids[i], FO.staffId, at(day, "09:00"), pay, closed]);
    });
  }, 300_000);
  afterAll(async () => { await app?.end(); await owner?.end(); await h?.close(); });

  it("manager of A: today's counts and hours from appointments_window at A only; tomorrow's K15 gap; open complaints only; Scenario PR-33b below minimum", async () => {
    const raw = await as(MGR, (db) => readBranchSummary(db, A.b1)) as Raw;
    expect(raw.branch_id).toBe(A.b1);
    // waiting_payment 3 = A's open visits whose payment step is in_progress (today and an older one) or blocked; not done, not not_started,
    // not the in_progress visit closed today, not B's (the cancelled and B's appointment are not on A's book either)
    expect(raw.today_counts).toEqual({ appointments: 3, arrived: 1, no_shows: 1, waiting_payment: 3 });
    expect(raw.hours).toEqual([{ hour: 10, booked: 2, arrived: 1 }, { hour: 14, booked: 1, arrived: 0 }]);
    expect(raw.tomorrow.appointments).toBe(1);
    expect(raw.tomorrow.gaps).toEqual([{ staff_id: DOC.staffId, name: expect.any(String), booked_minutes: 60, rostered_minutes: 480 }]);
    expect(raw.chase).toEqual({ complaints: 1 });
    expect(raw.stock.below_min).toEqual([{ item_id: low, name: "Kasa Steril Sintetis", on_hand: 3, min_qty: 5, unit: "pak" }]);
    expect([raw.stock.expiring_30d, raw.stock.count_variance, raw.stock.pending_po]).toEqual([1, 0, 0]);
    expect(raw.staff.find((x: { staff_id: string }) => x.staff_id === BC.staffId)).toMatchObject({ role: "bc", completions: 0, k19: { closing_rupiah: 0, target_rupiah: 50_000_000 } });
    // the branch's own-target staff only (target_list scopes to the branch): A's manager, pharmacist, doctor, BC, FO — never B's manager
    expect(raw.staff.map((x) => x.staff_id).sort()).toEqual([MGR, PH, DOC, BC, FO].map((p) => p.staffId).sort());
    expect(JSON.stringify(raw)).not.toContain("Pasien Sentinel Rahasia");
    expect(JSON.stringify(raw)).not.toContain("Ringkasan keluhan sentinel");
    // through the slice-1 model and view: Scenario PR-33b and 'Belum tersedia' for what no reader gives (never 0)
    const v = resolveView({ viewer: viewer(MGR, "RC-A"), filter: "semua", read: { ok: true, raw } });
    expect(v.kind).toBe("ok");
    const out = html(v);
    expect(out).toContain("Kasa Steril Sintetis");
    expect(out).toMatch(/aria-label="Buat PO untuk Kasa Steril Sintetis"/);
    const s = (v as Extract<typeof v, { kind: "ok" }>).summary;
    const tile = (k: string) => [...s.chase, ...s.todayTiles, ...s.tomorrowTiles, ...s.stockTiles].find((x) => x.key === k)!.metric;
    expect(tile("unpaid_bills")).toEqual({ kind: "unavailable", reason: "reader_pending" });
    expect(tile("waiting_payment")).toEqual({ kind: "count", value: 3 });
    expect(out).toMatch(/Menunggu pembayaran[\s\S]{0,400}?>3</); // the UX-21 tile shows the number, not "Belum tersedia"
    expect(tile("staff_on_duty")).toEqual({ kind: "unavailable", reason: "reader_pending" });
    expect(tile("variance")).toEqual({ kind: "count", value: 0 }); // a real zero stays 0
    const bc = s.staff.kind === "rows" ? s.staff.rows.find((r) => r.staffId === BC.staffId)! : null;
    expect(bc?.k17).toEqual({ kind: "unavailable", reason: "reader_pending" }); // no per-branch owed reader: never Rp0
    expect(show(bc!.k17)).toBe("Belum tersedia");
  });

  it("manager-own-branch scoping: the manager of A cannot read B (refused by the readers, no payload); the manager of B reads B only", async () => {
    expect(await code(as(MGR, (db) => readBranchSummary(db, A.b2)))).toBe("ERR_NOT_FOUND");
    const rb = await as(MGRB, (db) => readBranchSummary(db, A.b2)) as Raw;
    expect([rb.branch_id, rb.today_counts.appointments, rb.chase.complaints, rb.stock.below_min]).toEqual([A.b2, 1, 1, []]);
    expect(rb.today_counts.waiting_payment).toBe(1); // B's one in_progress visit; none of A's
    // a payload of B offered to A's manager view is refused by the model too
    expect(resolveView({ viewer: viewer(MGR, "RC-A"), filter: "semua", read: { ok: true, raw: rb } })).toEqual({ kind: "permission" });
  });

  it("allowed branch: an id of another tenant or a random id is not found, never an empty summary", async () => {
    const B = await tenant("PT Cabang Lain");
    expect(await code(as(MGR, (db) => readBranchSummary(db, B.b1)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(MGR, (db) => readBranchSummary(db, crypto.randomUUID())))).toBe("ERR_NOT_FOUND");
  });

  it("a widget whose reader refuses the role is unavailable, not zero; the others still read (owner: no complaint reader, K18 tenant-wide)", async () => {
    const raw = await as(OWN, (db) => readBranchSummary(db, A.b1)) as Raw;
    expect(raw.chase).toEqual({}); // complaint_list refuses the owner → left out → Belum tersedia
    expect(raw.today_counts.appointments).toBe(3);
    const v = resolveView({ viewer: { role: "manager", activeBranchId: A.b1, branches: [{ id: A.b1, name: "RC-A" }] }, filter: "semua", read: { ok: true, raw } });
    const s = (v as Extract<typeof v, { kind: "ok" }>).summary;
    expect(s.chase.find((c) => c.key === "complaints")!.metric).toEqual({ kind: "unavailable", reason: "reader_pending" });
  });

  // ── page-data core (load.ts) + server gate (data.ts) ──
  it("page core: the manager gets UX-21 for its ACTIVE branch (never a query-chosen one); ?tampilan=perlu is the only query honoured", async () => {
    const r = await as(MGR, (db) => cabangIn(db, "manager", MGR.branch!, {}));
    if (r.kind !== "ok") throw new Error(r.kind);
    expect(["ok", "empty"]).toContain(r.state.kind);
    expect("summary" in r.state && r.state.summary.branch.id).toBe(A.b1);
    const p = await as(MGR, (db) => cabangIn(db, "manager", MGR.branch!, { tampilan: "perlu" }));
    expect(p.kind === "ok" && p.filter).toBe("perlu");
    // the manager of B reads B only
    const b = await as(MGRB, (db) => cabangIn(db, "manager", MGRB.branch!, {}));
    expect(b.kind === "ok" && "summary" in b.state && b.state.summary.branch.id).toBe(A.b2);
  });
  it("page core: owner and admin_pusat are routed (Panel 2 decision 2), not served UX-21; a manager without an active branch is no-branch; other roles permission", async () => {
    expect(await as(OWN, (db) => cabangIn(db, "owner", null, {}))).toEqual({ kind: "route", to: "/ringkasan/owner/cabang", role: "owner" });
    expect(await as(OWN, (db) => cabangIn(db, "admin_pusat", null, {}))).toEqual({ kind: "route", to: "/pengaturan/cabang", role: "admin_pusat" });
    expect(await as(MGR, (db) => cabangIn(db, "manager", null, {}))).toMatchObject({ kind: "ok", state: { kind: "no-branch" } });
    expect(await as(PH, (db) => cabangIn(db, "pharmacist", PH.branch!, {}))).toMatchObject({ kind: "ok", state: { kind: "permission" } });
    // a non-manager role never reaches a branch reader (only the branch list and the savepoint statements run)
    await as(PH, async (db) => {
      const seen: string[] = [];
      const spy = { query: (sql: string, args?: unknown[]) => { seen.push(sql); return db.query(sql, args); } } as unknown as typeof db;
      expect(await cabangIn(spy, "pharmacist", PH.branch!, {})).toMatchObject({ kind: "ok", state: { kind: "permission" } });
      expect(seen.filter((q) => !/^(savepoint|release savepoint|rollback to savepoint)|order by created_at, id$/.test(q))).toEqual([]);
    });
    expect(ROUTE_FOR).toEqual({ owner: "/ringkasan/owner/cabang", admin_pusat: "/pengaturan/cabang" });
    expect([...navRoles()]).toEqual(["manager", "owner", "admin_pusat"]);
  });
  it("admin_pusat is routed to a BUILT page it may use in full (/pengaturan/cabang: page exists, FULL includes admin_pusat), never to the unbuilt /pengaturan/klinik", () => {
    const to = ROUTE_FOR.admin_pusat!;
    expect(to).not.toBe("/pengaturan/klinik");
    expect(existsSync(`src/app/(app)${to}/page.tsx`), `${to} is a built page`).toBe(true);
    expect(SETTINGS_READERS).toContain("admin_pusat");
    expect(SETTINGS_FULL).toContain("admin_pusat"); // sees and changes every branch there (UX-2)
    // the owner target stays as decided (gated on T-109's /ringkasan/owner/cabang; unchanged here)
    expect(ROUTE_FOR.owner).toBe("/ringkasan/owner/cabang");
  });
  it("page core: an active branch that is not the caller's tenant's is not found (TEN-1); a reader fault is the error state, the transaction usable", async () => {
    const C = await tenant("PT Cabang Lain");
    expect(await as(MGR, (db) => cabangIn(db, "manager", C.b1, {}))).toEqual({ kind: "not-found" });
    await as(MGR, async (db) => {
      const err = console.error; const logged: unknown[] = []; console.error = (...a: unknown[]) => { logged.push(a); };
      try {
        const broken = { query: (sql: string, args?: unknown[]) => db.query(/order by created_at, id$/.test(sql) ? "select 1 / 0 as r" : sql, /order by created_at, id$/.test(sql) ? [] : args) } as unknown as typeof db;
        expect(await cabangIn(broken, "manager", MGR.branch!, {})).toEqual({ kind: "ok", filter: "semua", state: { kind: "error" } });
      } finally { console.error = err; }
      expect(JSON.stringify(logged)).not.toMatch(/division|RC-A|[0-9a-f]{8}-[0-9a-f]{4}-/i);
      expect((await db.query(`select 1 as ok`)).rows[0].ok).toBe(1);
    });
  });
  it("page gate (data.ts): manager / owner / admin_pusat pass (the nav row); other roles are refused before any read; redirect and blocked kept", async () => {
    const ctx = async (p: P) => resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch });
    gate.pool = app;
    gate.rc = { kind: "ok", active: { context: await ctx(MGR) } };
    expect(await loadCabangPage({})).toMatchObject({ kind: "ok" });
    gate.rc = { kind: "ok", active: { context: await ctx(OWN) } };
    expect(await loadCabangPage({})).toEqual({ kind: "route", to: "/ringkasan/owner/cabang", role: "owner" });
    for (const p of [PH, DOC, BC, FO]) {
      gate.rc = { kind: "ok", active: { context: await ctx(p) } };
      expect(await loadCabangPage({}), p.role).toEqual({ kind: "forbidden" });
    }
    gate.rc = { kind: "redirect", to: "/masuk" };
    expect(await loadCabangPage({})).toEqual({ kind: "redirect", to: "/masuk" });
    gate.rc = { kind: "blocked", accountId: "x" };
    expect(await loadCabangPage({})).toEqual({ kind: "forbidden" });
  });
  it("page body (cabangBody) on the real readers: the manager gets its branch summary (Scenario PR-33b item); ?tampilan=perlu is kept; a foreign active branch is Next's not-found", async () => {
    const ctx = async (p: P, branch?: string) => resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: branch ?? p.branch });
    gate.pool = app;
    gate.rc = { kind: "ok", active: { context: await ctx(MGR) } };
    const out = renderToStaticMarkup((await cabangBody(Promise.resolve({}))) as never);
    expect(out).toContain("Ringkasan Cabang");
    expect(out).toContain("Kasa Steril Sintetis"); // the below-minimum item of A's branch
    expect(out).not.toContain("Anda tidak memiliki akses");
    const perlu = renderToStaticMarkup((await cabangBody(Promise.resolve({ tampilan: "perlu" }))) as never);
    expect(perlu).toMatch(/aria-current="true"[^>]*>Perlu Ditangani</); // the filter the URL asked for is the current chip
    expect(out).toMatch(/aria-current="true"[^>]*>Semua</);
    // owner and admin_pusat are redirected by the page to the BUILT targets (ROUTE_FOR; Panel 2 decision 2)
    for (const [p, role, to] of [[OWN, "owner", "/ringkasan/owner/cabang"], [OWN, "admin_pusat", "/pengaturan/cabang"]] as const) {
      gate.rc = { kind: "ok", active: { context: { ...(await ctx(p)), actingRole: role } } };
      await expect(cabangBody(Promise.resolve({})), role).rejects.toThrow(`NEXT_REDIRECT ${to}`);
      expect(existsSync(`src/app/(app)${to}/page.tsx`), `${to} is built`).toBe(true);
    }
    gate.rc = { kind: "ok", active: { context: await ctx(MGR) } };
    const D = await tenant("PT Cabang Asing");
    const c = await ctx(MGR);
    gate.rc = { kind: "ok", active: { context: { ...c, activeBranchId: D.b1 } } };
    await expect(cabangBody(Promise.resolve({}))).rejects.toThrow("NEXT_NOT_FOUND");
  });
  it("Panel 2 decision 3: the staff section has no /staf/target link (omitted until the page exists)", () => {
    expect(drill("2026-11-19").staff).toBeUndefined();
    const out = renderToStaticMarkup(createElement(BranchSummaryView, { state: ok(payload()) }));
    expect(out).not.toContain("/staf/target");
    expect(out).not.toContain("Target &amp; Scorecard");
  });
  it("Menunggu pembayaran (UX-21): today's AND older unpaid open visits count (the tile's /hari-ini?tampilan=belum-bayar population), a failed board read stays 'Belum tersedia', a successful empty read is a real 0", async () => {
    // the older (yesterday) in_progress visit is in the 3; without it the count would be 2 — the tile is "waiting now", not T-109's
    // "older than today" attention row, and not today's check-ins only (no not_started, no done, no closed)
    const raw = await as(MGR, (db) => readBranchSummary(db, A.b1)) as Raw;
    expect(raw.today_counts.waiting_payment).toBe(3);
    // the board read refused / failed → the field is absent → "Belum tersedia", never 0 (the part() savepoint; the others still read)
    await as(MGR, async (db) => {
      const refusing = { query: (sql: string, args?: unknown[]) => (/visits_today/.test(sql)
        ? Promise.reject(new CommandError("ERR_FORBIDDEN")) : db.query(sql, args)) } as unknown as typeof db;
      const r = await readBranchSummary(refusing, A.b1) as Raw;
      expect("waiting_payment" in r.today_counts).toBe(false);
      expect(r.today_counts.appointments).toBe(3);
      const v = resolveView({ viewer: viewer(MGR, "RC-A"), filter: "semua", read: { ok: true, raw: r } });
      const s = (v as Extract<typeof v, { kind: "ok" }>).summary;
      const m = s.todayTiles.find((x) => x.key === "waiting_payment")!.metric;
      expect(m).toEqual({ kind: "unavailable", reason: "reader_pending" });
      expect(show(m)).toBe("Belum tersedia");
    });
    // a branch with no unpaid visit: a successful read gives a real 0 (shown as 0)
    const E = await tenant("PT Cabang Kosong");
    const mgrE = await person(E, "manager", E.b1);
    const re = await as(mgrE, (db) => readBranchSummary(db, E.b1)) as Raw;
    expect(re.today_counts.waiting_payment).toBe(0);
    // aggregate only: no patient name of the seeded visits leaves the reader
    expect(JSON.stringify(raw)).not.toContain("Pasien Sentinel Rahasia");
  });
  it("MISSING names exactly the payload fields left for the next reader scope", () => {
    expect(MISSING).toEqual([
      "chase.unpaid_bills", "chase.unpaid_additions", "chase.receivables_due", "chase.no_shows_to_rebook", "chase.waiting_long", "chase.approvals",
      "today_counts.in_treatment", "today_counts.rooms_in_use", "today_counts.devices_in_use", "today_counts.staff_on_duty",
      "tomorrow.leave_conflicts", "wait_minutes", "staff[].k17_rupiah",
    ]);
  });
});
