// PR-33d (T-112) — Pasienku, the BC home (UX-35), presentational slice.
// Synthetic props only: no database and no T-107 reader yet. Own-scope filtering ("only her own target and commission") is
// the reader's job (`target_mine`, own follow-ups, T-107 own K17 slice) and is proven against PostgreSQL at wiring; here we
// pin what the view owns: it renders exactly the one BC's figures it is given and its props have no place for another
// staff member's figures, unavailable ≠ Rp0, K19 attainment, UX-35 section order and sorting, one state per screen,
// drill-down links from caller props, compact and regular layouts, and no clinical text.
import type pg from "pg";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LINKS, OPEN_LIMIT, type Pasienku as PasienkuLoad, READERS, REASONS, summaryIn, targetOf, waitingOf } from "../../src/app/(app)/pasienku/load";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { setKekRingForTests } from "../../src/lib/keys/runtime";
import { issueKasirInvoice, openKasirInvoice, receivePayment } from "../../src/modules/cashier/kasir/kasir";
import { publish } from "../../src/modules/catalog/catalog";
import { openIntake, saveIntake, sendIntake } from "../../src/modules/clinical/intake/intake";
import { createRule, decideRuleVersion } from "../../src/modules/commission/commission";
import { setStaffTarget } from "../../src/modules/commission/targets/targets";
import { changeSetting } from "../../src/modules/settings/settings";
import { saveItem } from "../../src/modules/inventory/stock";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { confirmSelection } from "../../src/modules/pharmacy/pharmacy";
import { createHarness, type Harness, testPool } from "../rls/harness";
import { type Amount, attainment, type ContactRow, type PackageRow, type PasienkuData, type PasienkuProps, ratio, type Rows, sortContact, sortPackages, type Target, type UnselectedRow, type WaitingRow } from "../../src/app/(app)/pasienku/model";
import { Pasienku } from "../../src/app/(app)/pasienku/view";

const v = (rp: number): Amount => ({ state: "value", rp });
const na = (reason = "Pembacaan belum tersedia"): Amount => ({ state: "unavailable", reason });
const html = (p: PasienkuProps) => renderToStaticMarkup(h(Pasienku, p));
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const section = (out: string, id: string) => text(out.slice(out.indexOf(`id="${id}"`), out.indexOf("</section>", out.indexOf(`id="${id}"`))));
const contact = (id: string, patient: string, dueOn: string, overdue: boolean): ContactRow =>
  ({ id, patient, mrn: `RM-${id}`, reason: "control_due", dueOn, overdue, href: `/pasien/${id}` });
const list = <T,>(rows: T[], extra: { incomplete?: string; note?: string } = {}): Rows<T> => ({ state: "value", rows, ...extra });
const target = (over: Partial<Target> = {}): Target =>
  ({ period: "November 2026", closing: v(30_000_000), target: v(40_000_000), plansActual: 3, plansTarget: 5, href: "/saya/target", ...over });

function data(over: Partial<PasienkuData> = {}): PasienkuData {
  return {
    contact: list([contact("c2", "Bunga", "2026-11-19", false), contact("c1", "Ayu", "2026-11-17", true)]),
    waiting: list<WaitingRow>([{ visitId: "v1", patient: "Citra", mrn: "RM-3", arrived: "10.15 WIB", href: "/pendampingan/v1" }]),
    unselected: list<UnselectedRow>([{ id: "p1", patient: "Dewi", mrn: "RM-4", items: { recommended: 4, selected: 1 }, value: 2_500_000, dueOn: "2026-11-13", overdueDays: 6, href: "/pasien/p1" }]),
    packages: list<PackageRow>([
      { id: "k2", patient: "Eka", mrn: "RM-5", sessionsLeft: 2, validUntil: "2026-12-01", dueOn: "2026-11-20", href: "/pasien/e" },
      { id: "k1", patient: "Fani", mrn: "RM-6", sessionsLeft: 1, validUntil: "2027-01-10", dueOn: "2026-11-20", href: "/pasien/f" },
    ]),
    dormant: { count: 7, href: "/pasien" },
    k9: { selected: 6, recommended: 8, window: 30, href: "/saya/target#k9" },
    target: target(),
    commission: { amount: v(1_250_000), href: "/saya/komisi" },
    ...over,
  };
}
const ready = (d: PasienkuData = data(), staff = "BC Satu"): PasienkuProps => ({ staff, branch: "Cabang A", state: { kind: "ready", data: d } });

describe("Scenario PR-33d own figures only (view level)", () => {
  // Two BCs with closings this month; each dashboard receives only its own reader result.
  const mine = html(ready(data({ target: target({ closing: v(30_000_000) }), commission: { amount: v(1_250_000), href: "/saya/komisi" } }), "BC Satu"));
  const hers = html(ready(data({ target: target({ closing: v(12_000_000) }), commission: { amount: v(400_000), href: "/saya/komisi" } }), "BC Dua"));
  it("each BC sees exactly her own target and commission, never the other's", () => {
    expect(section(mine, "kpi-k19")).toContain("Rp30.000.000");
    expect(section(mine, "kpi-k17")).toContain("Rp1.250.000");
    expect(mine).not.toContain("Rp12.000.000");
    expect(mine).not.toContain("Rp400.000");
    expect(section(hers, "kpi-k19")).toContain("Rp12.000.000");
    expect(hers).not.toContain("Rp30.000.000");
    expect(text(mine)).toContain("BC Satu");
    expect(text(mine)).not.toContain("BC Dua");
  });
  it("the props have no slot for other staff (type-level guard)", () => {
    // @ts-expect-error — no team / other-staff list on the BC home
    const bad: PasienkuData = { ...data(), team: [{ staff: "BC Dua", closing: 1 }] };
    expect(bad).toBeTruthy();
  });
});

describe("K19 attainment and unavailable ≠ Rp0", () => {
  it("states percent of target; none without a target, with a zero target or an unknown side", () => {
    expect(attainment(target())).toEqual({ state: "value", pct: 75, text: "75% dari target" });
    expect(attainment(target({ target: null }))).toEqual({ state: "none", text: "Target belum ditetapkan" });
    expect(attainment(target({ target: v(0) }))).toEqual({ state: "none", text: "Target belum ditetapkan" });
    expect(attainment(target({ closing: na() }))).toEqual({ state: "none", text: "Belum tersedia" });
  });
  it("renders a meter only with a real attainment; overshoot caps the bar at 100", () => {
    expect(html(ready())).toContain('aria-valuenow="75"');
    expect(html(ready(data({ target: target({ closing: v(50_000_000) }) })))).toContain('aria-valuenow="100"');
    expect(html(ready(data({ target: target({ target: null }) })))).not.toContain('role="meter"');
  });
  it("an unavailable closing or commission reads 'Belum tersedia' with its reason, a real zero reads Rp0", () => {
    const out = html(ready(data({ target: target({ closing: na("Penutupan belum dihitung") }), commission: { amount: v(0), href: "/saya/komisi" } })));
    expect(section(out, "kpi-k19")).toContain("Belum tersedia");
    expect(section(out, "kpi-k19")).toContain("Penutupan belum dihitung");
    expect(section(out, "kpi-k19")).not.toMatch(/Rp0\b/);
    expect(section(out, "kpi-k17")).toContain("Rp0");
    expect(section(out, "kpi-k17")).not.toContain("Belum tersedia");
  });
  it("K9 with no recommendations has no rate; 0 of n is 0%", () => {
    expect(ratio(0, 0)).toBe("Belum tersedia");
    expect(ratio(0, 4)).toBe("0%");
    expect(section(html(ready()), "kpi-k9")).toMatch(/75% 6 dari 8 item dalam 30 hari/);
  });
});

describe("UX-35 sections, order and drill-down", () => {
  const out = html(ready());
  it("sections in contract order, target after the lists", () => {
    const at = ["Perlu Dihubungi", "Menunggu Dokter", "Belum Memilih", "Paket Hampir Habis", 'id="kpi-k19"'].map((s) => out.indexOf(s));
    expect(at.every((x) => x >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
  it("oldest due date first (overdue marked), ties by name; fewest sessions left first", () => {
    expect(sortContact([contact("x", "Zahra", "2026-11-19", false), contact("y", "Abel", "2026-11-19", false)]).map((r) => r.patient)).toEqual(["Abel", "Zahra"]);
    expect(sortContact((data().contact as { rows: ContactRow[] }).rows).map((r) => r.patient)).toEqual(["Ayu", "Bunga"]);
    expect(out.indexOf("Ayu")).toBeLessThan(out.indexOf("Bunga"));
    expect(text(out)).toContain("Terlambat");
    expect(sortPackages((data().packages as { rows: PackageRow[] }).rows).map((r) => r.patient)).toEqual(["Fani", "Eka"]);
  });
  it("rows show reason words and counts, not clinical text", () => {
    const t = text(out);
    expect(t).toContain("Jadwal kontrol · jatuh tempo 2026-11-17");
    expect(t).toContain("1 dari 4 item dipilih · Rp2.500.000 · tindak lanjut 2026-11-13 · terlambat 6 hari");
    expect(t).toContain("Sisa 1 sesi · berlaku sampai 2027-01-10 · pengingat 2026-11-20");
  });
  it("every row and figure links to the caller's drill-down target", () => {
    for (const href of ["/pasien/c1", "/pendampingan/v1", "/pasien/p1", "/pasien/f", "/saya/target", "/saya/komisi", "/saya/target#k9", "/pasien"]) {
      expect(out).toContain(`href="${href}"`);
    }
  });
  it("empty sections keep their heading with a calm line", () => {
    const t = text(html(ready(data({ contact: list<ContactRow>([]), waiting: list<WaitingRow>([]) }))));
    expect(t).toContain("Perlu Dihubungi (0)");
    expect(t).toContain("Tidak ada pasien yang perlu dihubungi hari ini.");
    expect(t).toContain("Tidak ada pasien yang menunggu dokter.");
  });
  it("an empty 'Belum Memilih' / 'Paket Hampir Habis' names the follow-up REMINDERS, never a state of the world: a reminder exists only after its window (SET-22 / SET-23) and only for the BC the patient is guided by, so none is not 'all selected' and not 'no package is near its end'", () => {
    const t = text(html(ready(data({ unselected: list<UnselectedRow>([]), packages: list<PackageRow>([]) }))));
    expect(t).toContain("Belum ada tindak lanjut rencana.");
    expect(t).toContain("Belum ada pengingat paket.");
    expect(t).not.toContain("Semua rencana sudah dipilih");
    expect(t).not.toContain("Tidak ada paket yang hampir habis");
  });
  it("the side column follows the CONTAINER's text size, never the viewport (WCAG 1.4.10: no sideways scroll at 200 % text); a viewport breakpoint cannot follow the text size", () => {
    expect(out).toContain("@container");
    expect(out).toContain("grid-cols-[minmax(0,1fr)] gap-5 @min-[64em]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]");
    expect(out).not.toContain("min-[1180px]");
    expect(out).not.toContain("min-[700px]");
  });
  it("a money figure is one word: it never breaks inside its digits and shrinks with the container instead", () => {
    for (const id of ["kpi-k19", "kpi-k17"]) {
      const card = out.slice(out.indexOf(`id="${id}"`), out.indexOf("</section>", out.indexOf(`id="${id}"`)));
      const fig = /<span data-kpi="value" class="([^"]*)">/.exec(card)?.[1] ?? "";
      expect(fig).toContain("whitespace-nowrap");
      expect(fig).toMatch(/@max-\[22em\]:text-/);
    }
  });
  it("the 'Terlambat' badge sits UNDER the row's title in the row's text, never beside it (beside a narrow title it crushes the title to a letter per line at 200 % text)", () => {
    const row = out.slice(out.indexOf('aria-label="Perlu Dihubungi"'), out.indexOf("</ul>", out.indexOf('aria-label="Perlu Dihubungi"')));
    const title = row.indexOf("Ayu");
    const badge = row.indexOf("Terlambat");
    expect(title).toBeGreaterThan(-1);
    expect(badge).toBeGreaterThan(title);
    // not a flex sibling of the title block inside the link: the link holds the title block and the chevron only
    const link = /<a [^>]*>([\s\S]*?)<\/a>/.exec(row.slice(row.indexOf("Ayu") - 400))?.[1] ?? "";
    expect(link).not.toContain("Terlambat");
  });
});

describe("one state per screen (10 State Copy Patterns)", () => {
  const cases = [
    [{ kind: "loading" }, 'aria-busy="true"'],
    [{ kind: "empty", message: "Belum ada pasien.", action: "Lihat Tindak Lanjut", actionHref: "/lead/tindak-lanjut" }, "Belum ada pasien."],
    [{ kind: "filtered-empty", message: "Tidak ada pasien untuk filter ini.", clearHref: "/pasienku" }, "Hapus Filter"],
    [{ kind: "error", message: "Koneksi terputus.", retryHref: "/pasienku" }, "Coba Lagi"],
    [{ kind: "blocked", reason: "Anda belum ditugaskan ke cabang", unblock: "Manager dapat menugaskan cabang" }, "Anda belum ditugaskan ke cabang."],
    [{ kind: "permission", object: "Pasienku" }, "Anda tidak memiliki akses ke Pasienku."],
  ] as const;
  it.each(cases)("%o renders its copy and no figure", (state, copy) => {
    const out = html({ staff: "BC Satu", branch: "Cabang A", state });
    expect(out).toContain(copy);
    expect(out).not.toContain("data-kpi=");
    expect(out).not.toContain("Perlu Dihubungi");
  });
});

describe("no clinical content and safe text", () => {
  it("escapes patient and staff names and renders no clinical vocabulary", () => {
    const hostile = `<img src=x onerror="alert(1)">`;
    const out = html(ready(data({ waiting: list<WaitingRow>([{ visitId: "v", patient: hostile, mrn: "RM", arrived: "10.00", href: "/v" }]) }), hostile));
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
    expect(text(out)).not.toMatch(/diagnos|alergi|resep|anamnesis|rekam medis|keluhan|temuan/i);
  });
  it("plan rows carry no treatment or note text (type-level guard)", () => {
    // @ts-expect-error — no treatment / note field on a plan row
    const bad: UnselectedRow = { ...(data().unselected as { rows: UnselectedRow[] }).rows[0], treatment: "x" };
    expect(bad).toBeTruthy();
  });
});

// ── The loader core (load.ts) over a fake connection that answers each reader with the shape the real one returns ─────────────────────────────────────
// The shapes are the SQL's own: target_mine (0103: TargetRow + period), followup_list (0108/0113: followup_json rows), pendampingan_visits (0069), and getBranch (select * from branches).
// A reader that is not asked for is absent from `calls`, so the call log also proves what a BC reads.
type Row = Record<string, unknown>;
const BR = { id: "11111111-1111-4111-8111-111111111111", name: "Cabang Kemang", timezone: "Asia/Jakarta" };
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOW = new Date("2026-11-19T05:00:00Z"); // 12:00 WIB, Thursday 2026-11-19
const myTargetRow = (o: Row = {}): Row => ({
  period: "2026-11", period_kind: "bulanan", period_start: "2026-10-31T17:00:00Z", period_end: "2026-11-30T17:00:00Z", staff_id: ME, staff: "BC Satu", is_bc: true,
  target: { id: "t", closing_value_target: 40_000_000, plans_target: 5, set_at: "2026-11-01T00:00:00Z" }, closing_value_actual: 30_000_000, branch_closing_value: null, plans_actual: 3, attainment_bps: 7500,
  scorecard: { completed_services: 4, executed_minutes: 0, rostered_minutes: 0, utilization_bps: null, commission_gross: 1_300_000, commission_adjustments: -50_000, commission_net: 1_250_000 }, ...o,
});
let fid = 0;
const task = (rule: string, o: Row = {}): Row => ({
  id: `f${++fid}`, branch_id: BR.id, branch_name: BR.name, rule_code: rule, source_kind: "x", source_id: "s", step: "due", role_queue: "bc", assignee_staff_id: ME, assignee_name: "BC Satu",
  patient_id: PT, patient_name: `Pasien ${rule}`, patient_mrn: `RM-${fid}`, consent_masked: false, promo_blocked: false, original_due_on: "2026-11-17", due_on: "2026-11-17",
  snooze_count: 0, due_today: false, overdue: true, state: "open", outcome: null, outcome_note: null, closed_at: null, created_at: "2026-11-10T00:00:00Z", ...o,
});
const visitRow = (id: string, o: Row = {}): Row => ({
  id, kind: "walk_in", checked_in_at: "2026-11-19T01:15:00Z", patient_id: PT, patient_name: "Pasien Antre", patient_mrn: "RM-9", intake: "done", doctor: "not_started", closed: false,
  intake_id: `i-${id}`, intake_state: "sent", author_id: ME, author_name: "BC Satu", ...o,
});
type Ans = { branch?: Row | null; target?: Row | Error; followups?: Row[] | Error; visits?: Row[] | Error; role?: string };
function fake(a: Ans) {
  const calls: { sql: string; args: unknown[] }[] = [];
  return {
    calls,
    async query(sql: string, args: unknown[] = []) {
      calls.push({ sql, args });
      if (/^(savepoint|release savepoint|rollback to savepoint)/.test(sql)) return { rows: [] };
      if (sql.startsWith("select * from branches")) return { rows: a.branch === null ? [] : [a.branch ?? { id: BR.id, code: "KMG", name: BR.name, timezone: BR.timezone }] };
      if (sql.includes("target_mine")) { if (a.target instanceof Error) throw a.target; return { rows: [{ r: a.target ?? myTargetRow() }] }; }
      if (sql.includes("followup_list")) { if (a.followups instanceof Error) throw a.followups; return { rows: [{ r: { role: "bc", can_write: true, now: "x", followups: a.followups ?? [] } }] }; }
      if (sql.includes("pendampingan_visits")) { if (a.visits instanceof Error) throw a.visits; return { rows: [{ r: { today: "2026-11-19", branch_name: BR.name, visits: a.visits ?? [] } }] }; }
      throw new Error(`unexpected sql: ${sql.slice(0, 80)}`);
    },
  };
}
const run = (db: ReturnType<typeof fake>, role = "bc", branch: string | null = BR.id, staff = ME) => summaryIn(db as never, role, branch, staff, "BC Satu", NOW);
const okOf = async (r: Promise<PasienkuLoad>) => {
  const x = await r;
  if (x.kind !== "ok" || x.props.state.kind !== "ready") throw new Error(`not a ready summary: ${x.kind}`);
  return { d: x.props.state.data, props: x.props, r: x };
};
const reads = (db: ReturnType<typeof fake>, name: string) => db.calls.filter((c) => c.sql.includes(name));
const rowsOf = <T,>(l: Rows<T>): T[] => { if (l.state !== "value") throw new Error("list unavailable"); return l.rows; };
const quiet = () => vi.spyOn(console, "error").mockImplementation(() => undefined);
const v0 = v;

describe("loader: Scenario PR-33d on the reader's answers — own target and commission only, from ONE reading", () => {
  it("K19 and the own commission K17 both come from target_mine: closing, target, plans, attainment and commission_net of the month", async () => {
    const db = fake({});
    const { d } = await okOf(run(db));
    expect(d.target).toMatchObject({ period: "November 2026", closing: v(30_000_000), target: v(40_000_000), plansActual: 3, plansTarget: 5 });
    expect(d.commission).toEqual({ amount: { state: "value", rp: 1_250_000 }, href: LINKS.komisi });
    expect(reads(db, "target_mine")).toHaveLength(1); // one reading serves both cards: they cannot disagree
    expect(reads(db, "target_mine")[0].args).toEqual(["2026-11"]); // the month of the branch's own date, never the SET-25 default
    expect(attainment(d.target)).toEqual({ state: "value", pct: 75, text: "75% dari target" });
  });
  it("two BCs: each dashboard shows exactly the answer of its own reading, never the other's", async () => {
    const mine = await okOf(run(fake({ target: myTargetRow() })));
    const hers = await okOf(run(fake({ target: myTargetRow({ closing_value_actual: 12_000_000, scorecard: { commission_gross: 400_000, commission_adjustments: 0, commission_net: 400_000 } }) })));
    const a = html(mine.props);
    const b = html(hers.props);
    expect([section(a, "kpi-k19"), section(a, "kpi-k17")].join(" ")).toMatch(/Rp30\.000\.000[\s\S]*Rp1\.250\.000/);
    expect(a).not.toContain("Rp12.000.000");
    expect(a).not.toContain("Rp400.000");
    expect(section(b, "kpi-k19")).toContain("Rp12.000.000");
    expect(section(b, "kpi-k17")).toContain("Rp400.000");
    expect(b).not.toContain("Rp30.000.000");
  });
  it("a negative commission month (adjustments exceed accrual) is a real figure; no target is 'Target belum ditetapkan', not a rate", async () => {
    const { d } = await okOf(run(fake({ target: myTargetRow({ target: null, attainment_bps: null, scorecard: { commission_net: -75_000 } }) })));
    expect(d.commission.amount).toEqual({ state: "value", rp: -75_000 });
    expect(d.target.target).toBeNull();
    expect(attainment(d.target).state).toBe("none");
    const card = html({ staff: "x", branch: "y", state: { kind: "ready", data: d } });
    const k19 = section(card, "kpi-k19");
    expect(k19).toContain("Target belum ditetapkan");
    expect(k19.split("Target belum ditetapkan")).toHaveLength(2); // said once: the attainment line, not a second muted line
    expect(k19).not.toMatch(/Target\s+Rp/); // a missing target never shows a rupiah target, not even Rp0
    const raw = card.slice(card.indexOf('id="kpi-k19"'), card.indexOf("</section>", card.indexOf('id="kpi-k19"')));
    expect(raw).not.toMatch(/<p[^>]*>\s*<\/p>/); // the muted target line is absent, not rendered blank
  });
  it.each([[undefined], [null], [1250000.5], ["1250000"], [Number.NaN]])("a commission_net of %s is not a figure: K17 is unavailable with its reason, K19 stays", async (bad) => {
    const { d } = await okOf(run(fake({ target: myTargetRow({ scorecard: { commission_net: bad } }) })));
    expect(d.commission.amount).toMatchObject({ state: "unavailable", reason: REASONS.badAmount });
    expect(d.target.closing).toEqual(v(30_000_000));
  });
  it.each([[-1], [1.5], ["30000000"], [null]])("a closing value of %s is not a figure: K19 closing is unavailable, never Rp0", async (bad) => {
    const { d } = await okOf(run(fake({ target: myTargetRow({ closing_value_actual: bad }) })));
    expect(d.target.closing).toMatchObject({ state: "unavailable", reason: REASONS.badAmount });
    expect(attainment(d.target)).toEqual({ state: "none", text: "Belum tersedia" });
  });
  it("target_mine failing leaves K19 and K17 unavailable with the reason and every other card intact — never Rp0", async () => {
    const spy = quiet();
    const db = fake({ target: new Error("connection reset: pasien Rahasia"), followups: [task("control_due")], visits: [visitRow("v1")] });
    const { d, props } = await okOf(run(db));
    spy.mockRestore();
    expect(d.target.closing).toEqual({ state: "unavailable", reason: REASONS.target });
    expect(d.commission.amount).toEqual({ state: "unavailable", reason: REASONS.target });
    expect(rowsOf(d.contact)).toHaveLength(1);
    expect(rowsOf(d.waiting)).toHaveLength(1);
    const rollback = db.calls.findIndex((c) => c.sql.startsWith("rollback to savepoint"));
    expect(rollback).toBeGreaterThan(-1);
    expect(db.calls.findIndex((c) => c.sql.includes("followup_list"))).toBeGreaterThan(rollback); // rolled back BEFORE the next reader ran
    const out = html(props);
    expect(section(out, "kpi-k19")).toContain("Belum tersedia");
    expect(section(out, "kpi-k19")).not.toMatch(/Rp\d/);
    expect(section(out, "kpi-k17")).not.toMatch(/Rp\d/);
  });
});

describe("loader: 'Perlu Dihubungi', 'Belum Memilih', 'Paket Hampir Habis' are the BC's own open tasks — never another BC's, never a missing answer shown as nothing", () => {
  it("own BC-queue tasks only: another assignee, the CS queue and a closed task never appear, whatever the reader answered", async () => {
    const { d } = await okOf(run(fake({ followups: [
      task("control_due", { patient_name: "Milik Saya" }),
      task("control_due", { assignee_staff_id: OTHER, patient_name: "Milik BC Lain" }),
      task("no_show", { role_queue: "cs", patient_name: "Antrean CS" }),
      task("control_due", { state: "done", patient_name: "Sudah Selesai" }),
    ] })));
    expect(rowsOf(d.contact).map((r) => r.patient)).toEqual(["Milik Saya"]);
  });
  it("the three sections split by rule: plan_unselected → Belum Memilih, package_expiry → Paket Hampir Habis, the rest due today or overdue → Perlu Dihubungi", async () => {
    const { d } = await okOf(run(fake({ followups: [
      task("plan_unselected", { patient_name: "Rencana A" }), task("package_expiry", { patient_name: "Paket A", step: "d14" }), task("control_due", { patient_name: "Kontrol A" }),
      task("package_stage", { patient_name: "Sesi A", overdue: false, due_today: true }), task("control_due", { patient_name: "Belum Waktunya", overdue: false, due_today: false, due_on: "2026-11-25", original_due_on: "2026-11-25" }),
    ] })));
    expect(rowsOf(d.contact).map((r) => r.patient).sort()).toEqual(["Kontrol A", "Sesi A"]);
    expect(rowsOf(d.unselected).map((r) => r.patient)).toEqual(["Rencana A"]);
    expect(rowsOf(d.packages).map((r) => r.patient)).toEqual(["Paket A"]);
  });
  it("an overdue row is marked, its reason is a word, its link goes to the patient (a built page); a plan task carries its age and no invented counts or value", async () => {
    const { d } = await okOf(run(fake({ followups: [task("control_due"), task("plan_unselected", { due_on: "2026-11-12", original_due_on: "2026-11-12" })] })));
    expect(rowsOf(d.contact)[0]).toMatchObject({ reason: "control_due", dueOn: "2026-11-17", overdue: true, href: `/pasien/${PT}` });
    expect(rowsOf(d.unselected)[0]).toMatchObject({ items: null, value: null, dueOn: "2026-11-12", overdueDays: 7 });
  });
  it("a package task carries the reminder date only: sessions left and validity are null (not 0, not a date made up from the reminder)", async () => {
    const { d } = await okOf(run(fake({ followups: [task("package_expiry", { due_on: "2026-11-20", original_due_on: "2026-11-20", overdue: false, due_today: false })] })));
    expect(rowsOf(d.packages)[0]).toMatchObject({ sessionsLeft: null, validUntil: null, dueOn: "2026-11-20" });
    const t = text(html({ staff: "x", branch: "y", state: { kind: "ready", data: d } }));
    expect(t).toContain("pengingat 2026-11-20");
    expect(t).not.toMatch(/Sisa \d+ sesi/);
    expect(t).not.toContain("berlaku sampai");
    expect(t).toContain(REASONS.notePackage);
  });
  it("followup_list failing makes the three sections unavailable (no count in the heading, a reason) — not 'Tidak ada pasien'", async () => {
    const spy = quiet();
    const { d, props } = await okOf(run(fake({ followups: new Error("timeout"), visits: [visitRow("v1")] })));
    spy.mockRestore();
    for (const l of [d.contact, d.unselected, d.packages]) expect(l).toEqual({ state: "unavailable", reason: REASONS.followups });
    expect(rowsOf(d.waiting)).toHaveLength(1); // the doctor wait is another reader: intact
    const out = html(props);
    for (const id of ["hubungi", "belum-memilih", "paket"]) {
      const s = out.slice(out.indexOf(`id="${id}"`), out.indexOf("</section>", out.indexOf(`id="${id}"`)));
      expect(text(s)).toContain("Belum tersedia");
      expect(text(s)).not.toMatch(/\(\d/); // no count at all
    }
    expect(text(out)).not.toContain("Tidak ada pasien yang perlu dihubungi");
    expect(text(out)).not.toContain("Belum ada tindak lanjut rencana");
    expect(text(out)).not.toContain("Belum ada pengingat paket");
  });
  it("a full page (200) is 'n+', and an empty-looking list is never claimed to be complete; a row the view cannot type is counted, not silently dropped", async () => {
    const many = Array.from({ length: OPEN_LIMIT }, (_, i) => task("control_due", { id: `m${i}`, patient_name: `Pasien ${i}` }));
    const full = await okOf(run(fake({ followups: many })));
    expect(full.d.contact).toMatchObject({ state: "value", incomplete: REASONS.full });
    expect(text(html(full.props))).toMatch(/Perlu Dihubungi \(200\+\)/);
    const onlyOthers = await okOf(run(fake({ followups: Array.from({ length: OPEN_LIMIT }, (_, i) => task("control_due", { id: `o${i}`, assignee_staff_id: OTHER })) })));
    expect(onlyOthers.d.contact).toMatchObject({ state: "value", rows: [], incomplete: REASONS.full });
    expect(text(html(onlyOthers.props))).not.toContain("Tidak ada pasien yang perlu dihubungi"); // a full page of someone else's rows says nothing about mine
    const bad = await okOf(run(fake({ followups: [task("control_due"), task("control_due", { patient_name: null }), task("control_due", { due_on: "kemarin" })] })));
    expect(rowsOf(bad.d.contact)).toHaveLength(1);
    expect(bad.d.contact).toMatchObject({ incomplete: REASONS.skipped });
  });
  it("the scope is the actor's: the reader is asked for 'open' + 'mine' with no rule filter, once; a malformed patient id gets no link", async () => {
    const db = fake({ followups: [task("control_due", { patient_id: "bukan-uuid" })] });
    const { d } = await okOf(run(db));
    expect(reads(db, "followup_list")).toHaveLength(1);
    expect(reads(db, "followup_list")[0].args).toEqual(["open", "mine", null]);
    expect(rowsOf(d.contact)[0].href).toBeNull();
  });
});

describe("loader: 'Menunggu Dokter' = this BC's sent intakes still waiting for the doctor, today, at the branch", () => {
  it("only visits whose intake THIS BC sent, still open, the doctor step not started: another BC's patient, a draft, a started doctor and a closed visit never appear", () => {
    const rows = waitingOf([
      visitRow("mine", { patient_name: "Milik Saya" }), visitRow("other", { author_id: OTHER }), visitRow("draft", { intake_state: "draft" }), visitRow("none", { intake_id: null, intake_state: null, author_id: null }),
      visitRow("with-doctor", { doctor: "in_progress" }), visitRow("done-doc", { doctor: "done" }), visitRow("closed", { closed: true }),
    ].map((r) => ({ id: r.id as string, kind: "walk_in", checkedInAt: new Date(r.checked_in_at as string), patientId: PT, patientName: r.patient_name as string, patientMrn: r.patient_mrn as string, intake: "done",
      doctor: r.doctor as string, closed: r.closed as boolean, intakeId: (r.intake_id as string | null) ?? null, intakeState: (r.intake_state as never) ?? null, authorId: (r.author_id as string | null) ?? null, authorName: null })), ME, "Asia/Jakarta");
    expect(rows.map((r) => [r.visitId, r.patient])).toEqual([["mine", "Milik Saya"]]);
    expect(rows[0]).toMatchObject({ arrived: "08.15 WIB", href: "/pendampingan/mine" });
  });
  it("the arrival time is the branch's own clock", async () => {
    const mk = (tz: string) => waitingOf([{ id: "v", kind: "walk_in", checkedInAt: new Date("2026-11-19T01:15:00Z"), patientId: PT, patientName: "P", patientMrn: "R", intake: "done", doctor: "not_started", closed: false, intakeId: "i", intakeState: "sent", authorId: ME, authorName: null }], ME, tz)[0].arrived;
    expect([mk("Asia/Jakarta"), mk("Asia/Makassar"), mk("Asia/Jayapura")]).toEqual(["08.15 WIB", "09.15 WITA", "10.15 WIT"]);
  });
  it("pendampingan_visits failing makes only the doctor wait unavailable; the readers are asked for the BC's own branch", async () => {
    const spy = quiet();
    const db = fake({ visits: new Error("boom"), followups: [task("control_due")] });
    const { d } = await okOf(run(db));
    spy.mockRestore();
    expect(d.waiting).toEqual({ state: "unavailable", reason: REASONS.visits });
    expect(rowsOf(d.contact)).toHaveLength(1);
    expect(reads(db, "pendampingan_visits")[0].args).toEqual([BR.id]);
  });
});

describe("loader: what no reader a BC may call carries is unavailable with its reason — never 0, never invented", () => {
  it("K9 'Rencana dipilih' and 'Pasien lama tidak datang' are unavailable with their reasons and no link; the card shows no figure", async () => {
    const { d, props } = await okOf(run(fake({})));
    expect(d.k9).toEqual({ state: "unavailable", reason: REASONS.k9, href: null });
    expect(d.dormant).toEqual({ state: "unavailable", reason: REASONS.dormant, href: null });
    const out = html(props);
    expect(section(out, "kpi-k9")).toContain("Belum tersedia");
    expect(section(out, "kpi-k9")).toContain(REASONS.k9);
    expect(section(out, "kpi-k9")).not.toMatch(/\d%/);
    expect(section(out, "kpi-dormant")).toContain(REASONS.dormant);
    // the visible words only: the slice starts inside the heading tag, so its class names ("text-[0.94rem]") are not part of what a person reads
    const words = (id: string) => section(out, id).replace(/^[^>]*>/, "");
    expect(words("kpi-dormant")).not.toMatch(/\d/);
    expect(out.slice(out.indexOf('id="kpi-k9"'), out.indexOf("</section>", out.indexOf('id="kpi-k9"')))).not.toContain("href=");
  });
  it("no reader the loader calls is dashboard_kpi or a CS-queue / marketing reader (a BC is refused there): the call log names only the BC's own readers", async () => {
    const db = fake({});
    await run(db);
    const names = db.calls.filter((c) => !/^(savepoint|release|rollback)/.test(c.sql)).map((c) => c.sql.match(/select (?:\* from )?(\w+)/)?.[1]);
    expect(names.sort()).toEqual(["branches", "followup_list", "pendampingan_visits", "target_mine"]);
    expect(JSON.stringify(db.calls)).not.toMatch(/dashboard_kpi|dashboard_home|commission_mine|package_patient_get|kasir_/);
  });
});

describe("loader: who and where — role, branch and identity come from the context, one reader per SAVEPOINT", () => {
  it("only the BC role is served, decided before any query", async () => {
    expect([...READERS]).toEqual(["bc"]);
    for (const role of ["owner", "manager", "fo_cashier", "central_cs", "doctor", "finance", "admin_pusat", "auditor", "nurse"]) {
      const db = fake({});
      expect((await run(db, role)).kind).toBe("forbidden");
      expect(db.calls).toHaveLength(0);
    }
  });
  it("a BC with no active branch, or whose branch the database does not show, gets no-branch and no reader is asked", async () => {
    const db = fake({});
    expect((await run(db, "bc", null)).kind).toBe("no-branch");
    expect(db.calls).toHaveLength(0);
    const db2 = fake({ branch: null });
    expect((await run(db2)).kind).toBe("no-branch");
    expect(db2.calls.some((c) => c.sql.includes("target_mine") || c.sql.includes("followup_list"))).toBe(false);
  });
  it("the header carries the staff name and the branch the context gave; the month of the target is the branch's own date (Asia/Makassar crosses midnight first)", async () => {
    const near = new Date("2026-11-30T16:30:00Z"); // 23:30 WIB 30 Nov, 00:30 WITA 1 Dec
    const wita = fake({ branch: { id: BR.id, code: "MKS", name: "Cabang Makassar", timezone: "Asia/Makassar" } });
    const w = await summaryIn(wita as never, "bc", BR.id, ME, "BC Satu", near);
    expect(w.kind === "ok" && w.props.branch).toBe("Cabang Makassar");
    expect(reads(wita, "target_mine")[0].args).toEqual(["2026-12"]);
    const wib = fake({});
    await summaryIn(wib as never, "bc", BR.id, ME, "BC Satu", near);
    expect(reads(wib, "target_mine")[0].args).toEqual(["2026-11"]);
  });
  it("one reader that refuses or fails is a savepoint rolled back, not a logged fault for a refusal; a failure is logged by reader name only", async () => {
    const spy = quiet();
    await run(fake({ target: new CommandError("ERR_FORBIDDEN") }));
    expect(spy).not.toHaveBeenCalled();
    spy.mockClear();
    await run(fake({ followups: new Error("patient Rahasia Sekali") }));
    const logged = JSON.stringify(spy.mock.calls);
    spy.mockRestore();
    expect(logged).toContain("followup_list");
    expect(logged).not.toContain("Rahasia");
  });
  it("the props carry no clinical vocabulary and no other staff member, whatever the readers answered", async () => {
    const { props } = await okOf(run(fake({ followups: [task("control_due"), task("plan_unselected"), task("package_expiry")], visits: [visitRow("v1")] })));
    const t = text(html(props));
    expect(t).not.toMatch(/diagnos|alergi|resep|anamnesis|rekam medis|keluhan|temuan|Jerawat/i);
    expect(t).not.toContain("Pasien Rahasia");
  });
  it("targetOf is pure over the reader's answer (no reading): a closed shape in, the two cards out", () => {
    const { target, commission } = targetOf(myTargetRow() as never);
    expect(target.href).toBeNull();
    expect(commission.href).toBe("/saya/komisi");
  });
});

// ── Real-fixture evidence: the loader core over the REAL readers on PostgreSQL ─────────────────────────────────────────────────────────────────────
// Facts come from the real writers wherever one exists: the owner's BC target (setStaffTarget), a sale closed by a named BC through the real selection / cashier path (confirmSelection naming
// closingBcId, then payment), the commission rule and its accrual, the BC's intake (openIntake / saveIntake / sendIntake). One fact has no writer a test may call: a follow-up task is created
// by the daily scan (a cron-owned definer) and, for the plan / package rules, only after a window of days has passed, so the tasks are inserted the way the scan's own `followup_create`
// persists them (the same function, called on the unbound connection that owns it), with the guards left ON. Synthetic data only (MIG-2).
// Heavy: run under heavy-run --lock clinic-dashboard-env.
describe("T-112 Pasienku on the real readers (PostgreSQL)", () => {
  let hn: Harness;
  let appP: pg.Pool;
  let ownP: pg.Pool;
  let seq = 0;
  const key = () => crypto.randomUUID();
  const LONG = 180_000;
  beforeAll(async () => {
    process.env.DEPLOY_ENV = "local"; // synthetic data only (MIG-2): the cashier writers' production go-live gate stays closed otherwise
    setKekRingForTests({ current: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) });
    hn = await createHarness();
    appP = await openAppPool({ connectionString: hn.urlAs(await hn.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
    ownP = testPool({ connectionString: hn.ownerUrl(), max: 2 });
  }, 300_000);
  afterAll(async () => { setKekRingForTests(undefined); await appP?.end(); await ownP?.end(); await hn?.close(); });

  type Who = { acc: string; staffId: string; role: Role; branch?: string; name: string };
  const WIDE = ["owner", "finance", "admin_pusat", "central_cs", "auditor", "marketing", "purchasing"];
  async function world() {
    const t = (await hn.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
    await hn.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Pasienku Sintetis', 'emkm')`, [t]);
    const br = async (c: string, n: string) => (await hn.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $3, 'Asia/Jakarta') returning id`, [t, c, n])).rows[0].id as string;
    const b1 = await br("PK1", "Cabang Kemang");
    const b2 = await br("PK2", "Cabang BSD");
    const person = async (role: Role, ...branches: string[]): Promise<Who> => {
      const n = ++seq;
      const name = `Staf Pasienku ${n}`;
      const acc = (await hn.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`pk${n}@klinik-sintetis.test`])).rows[0].id as string;
      const { staffId } = await createMembership(ownP, { tenantId: t, accountId: acc, displayName: name });
      const rid = await assignRole(hn.admin, { tenantId: t, staffId, role });
      if (!WIDE.includes(role)) for (const b of branches.length ? branches : [b1]) await assignBranch(hn.admin, { tenantId: t, staffRoleId: rid, branchId: b });
      return { acc, staffId, role, branch: WIDE.includes(role) ? undefined : branches[0] ?? b1, name };
    };
    const as = async <R>(w: Who, fn: (db: pg.PoolClient) => Promise<R>) =>
      withTenantContext(appP, await resolveContext(appP, w.acc, { tenantId: t, actingRole: w.role, activeBranchId: w.branch }), fn);
    return { t, b1, b2, person, as };
  }
  type World = Awaited<ReturnType<typeof world>>;
  // An adult with a NIK (the consent writer refuses a newborn_via_guardian patient without a guardian), the pattern of tests/commission/targets.test.ts.
  const patient = async (w: World, name: string, by: Who) => {
    const id = crypto.randomUUID().replace(/-/g, "");
    return (await hn.admin.query(
      `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
       values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $2, '1990-01-01', 'female', 'nik', $5, $6, 'islam', 'Karyawan', 's1', 'kawin', $3, $4, 'fo_cashier') returning id`,
      [w.t, name, w.b1, by.staffId, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43)])).rows[0].id as string;
  };
  const month = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date()).slice(0, 7);
  const dayOffset = (d: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(Date.now() + d * 86_400_000));
  const load = async (w: World, who: Who) => {
    const r = await w.as(who, (db) => summaryIn(db, who.role, who.branch ?? null, who.staffId, who.name, new Date()));
    if (r.kind !== "ok" || r.props.state.kind !== "ready") throw new Error(`not a ready summary: ${r.kind}`);
    return { d: r.props.state.data, props: r.props, r };
  };
  // A follow-up task persisted the way the scan persists it: `followup_create` on the unbound owner connection (its own definer path), the table's guards ON.
  async function task(w: World, rule: string, kind: string, patientId: string, branch: string, assignee: Who | null, due: string, step = "due"): Promise<string> {
    const q = rule === "plan_unselected" || rule === "package_expiry" || rule === "package_stage" || rule === "control_due" ? "bc" : "cs";
    const source = crypto.randomUUID();
    await hn.admin.query(`select followup_create($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, clock_timestamp())`, [w.t, branch, patientId, rule, kind, source, step, q, assignee?.staffId ?? null, due]);
    return source;
  }

  it("Scenario PR-33d on the real readers: two BCs with closings this month — each dashboard shows only her own target, closing value and commission", async () => {
    const w = await world();
    const own = await w.person("owner");
    const bc1 = await w.person("bc", w.b1);
    const bc2 = await w.person("bc", w.b1);
    // the targets: bc1 Rp40.000.000 (plans 5), bc2 Rp25.000.000
    await w.as(own, (db) => setStaffTarget(db, key(), bc1.staffId, month(), { closingValueTarget: 40_000_000, plansTarget: 5 }));
    await w.as(own, (db) => setStaffTarget(db, key(), bc2.staffId, month(), { closingValueTarget: 25_000_000, plansTarget: 2 }));
    const a = await load(w, bc1);
    const b = await load(w, bc2);
    expect(a.d.target.target).toEqual(v0(40_000_000));
    expect(b.d.target.target).toEqual(v0(25_000_000));
    expect(a.d.target.closing).toEqual(v0(0)); // a real Rp0: the reader answered, nothing was closed yet
    expect(a.d.target.plansTarget).toBe(5);
    expect(b.d.target.plansTarget).toBe(2);
    const ha = html(a.props);
    const hb = html(b.props);
    expect(section(ha, "kpi-k19")).toContain("Rp40.000.000");
    expect(ha).not.toContain("Rp25.000.000");
    expect(section(hb, "kpi-k19")).toContain("Rp25.000.000");
    expect(hb).not.toContain("Rp40.000.000");
    expect(text(ha)).toContain(bc1.name);
    expect(text(ha)).not.toContain(bc2.name);
  }, LONG);

  it("the commission K17 is the scorecard's own: a sale the BC closed earns 5 % — it shows in HER card and not in another BC's, from the same reading as her target", async () => {
    const w = await world();
    const own = await w.person("owner");
    const bc1 = await w.person("bc", w.b1);
    const bc2 = await w.person("bc", w.b1);
    const fin = await w.person("finance");
    const doc = await w.person("doctor", w.b1);
    const fo = await w.person("fo_cashier", w.b1);
    const fh = await w.person("facility_head", w.b1);
    const pharm = await w.person("pharmacist", w.b1);
    for (const [kind, b] of [["str", null], ["sip", w.b1]] as const) {
      const id = (await hn.admin.query(`insert into staff_credentials (tenant_id, staff_id, kind, number, issuer, profession, branch_id, valid_from, expires_on, recorded_by) values ($1, $2, $3, $4, 'Konsil Kesehatan', 'dokter', $5, '2024-01-01', $6, $7) returning id`,
        [w.t, doc.staffId, kind, `NO-${++seq}`, b, b ? "2099-12-31" : null, own.staffId])).rows[0].id as string;
      await hn.admin.query(`update staff_credentials set state = 'verified', decided_by = $2, decided_at = now() where id = $1`, [id, fh.staffId]);
    }
    const svc = await w.as(own, (db) => publish(db, { kind: "service", code: `PK-C${seq}` }, {
      name: "Facial Komisi", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 10_000_000, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
      indications: "Indikasi", consent_template: "Templat persetujuan Facial Komisi.", delegation: "Dokter", aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }],
    } as never, "Layanan baru"));
    if (svc.approvalId) await w.as(fh, (db) => db.query(`select approval_decide($1, true, null)`, [svc.approvalId]));
    const rule = await w.as(fin, (db) => createRule(db, key(), { contributionType: "closing_bc", name: "Closing", kind: "percent", basisPoints: 500 }));
    await w.as(own, (db) => decideRuleVersion(db, rule.versionId, "activate"));
    await w.as(own, (db) => setStaffTarget(db, key(), bc1.staffId, month(), { closingValueTarget: 40_000_000 }));
    const before = await load(w, bc1);
    expect(before.d.commission.amount).toEqual(v0(0)); // a real Rp0: no commission yet
    // a sale of one facial closed by bc1, paid in full (the allocation accrues 5 % of 10.000.000 for the closing BC)
    const pid = await patient(w, "Pasien Penutupan", fo);
    const vis = (await hn.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`, [w.t, w.b1, pid, fo.staffId])).rows[0].id as string;
    const { examId } = await w.as(doc, async (db) => (await import("../../src/modules/clinical/exam/exam")).openExam(db, key(), vis));
    const exam = await import("../../src/modules/clinical/exam/exam");
    const { planId } = await w.as(doc, (db) => exam.createPlan(db, key(), examId, "Program Komisi", "Kondisi rahasia pasien"));
    const item = (await w.as(doc, (db) => exam.addPlanItem(db, key(), examId, planId, { stage: 1, catalog_version_id: svc.versionId, qty: 1 }))).itemId;
    const rec = await import("../../src/modules/clinical/records/records");
    await w.as(doc, (db) => rec.signRecord(db, key(), examId, { verified: true }));
    const cons = await import("../../src/modules/clinical/consent/consent");
    const ctext = await w.as(doc, (db) => cons.consentText(db, vis, planId));
    const png = Buffer.alloc(80); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0); png.writeUInt32BE(13, 8); png.write("IHDR", 12, "latin1"); png.writeUInt32BE(640, 16); png.writeUInt32BE(240, 20);
    await w.as(doc, (db) => cons.captureConsent(db, key(), { visitId: vis, planId, signer: "patient", expectedHash: ctext.content_hash, signature: png }));
    await w.as(fo, (db) => confirmSelection(db, key(), vis, { items: [{ planItemId: item }], closingBcId: bc1.staffId }));
    const { invoiceId } = await w.as(fo, (db) => openKasirInvoice(db, key(), { patientId: pid, visitId: vis }));
    await w.as(fo, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: svc.itemId, quantity: 1 }]));
    await w.as(fo, (db) => receivePayment(db, key(), invoiceId, [{ method: "transfer", amount: 10_000_000, details: { bank: "BCA", reference: "PK-33D" } }]));
    void pharm; void saveItem;
    const a = await load(w, bc1);
    const b = await load(w, bc2);
    expect(a.d.target.closing).toEqual(v0(10_000_000)); // K19: the sale she closed, net of VAT (exempt medical)
    expect(a.d.commission.amount).toEqual(v0(500_000)); // K17: 5 % of it — the SAME reading as the target
    expect(attainment(a.d.target)).toEqual({ state: "value", pct: 25, text: "25% dari target" }); // 10.000.000 of 40.000.000
    expect(b.d.target.closing).toEqual(v0(0)); // not hers
    expect(b.d.commission.amount).toEqual(v0(0));
    expect(section(html(a.props), "kpi-k17")).toContain("Rp500.000");
    expect(html(b.props)).not.toContain("Rp500.000");
    expect(html(b.props)).not.toContain("Rp10.000.000");
  }, LONG);

  it("SET-25 may make the default period a QUARTER: the card still reads the branch's own MONTH (the month target, never the quarter's)", async () => {
    const w = await world();
    const own = await w.person("owner");
    const bc = await w.person("bc", w.b1);
    const m = month();
    const quarter = `${m.slice(0, 4)}-Q${Math.floor((Number(m.slice(5, 7)) - 1) / 3) + 1}`;
    await w.as(own, (db) => setStaffTarget(db, key(), bc.staffId, m, { closingValueTarget: 11_000_000 }));
    await w.as(own, (db) => setStaffTarget(db, key(), bc.staffId, quarter, { closingValueTarget: 33_000_000 }));
    await w.as(own, (db) => changeSetting(db, { key: "SET-25", branchId: null, value: { metrik: "closing_rencana", periode: "triwulan" }, reason: "Uji periode Pasienku" }));
    try {
      const { d } = await load(w, bc);
      expect(d.target.target).toEqual(v0(11_000_000)); // the month's target, not the quarter's 33.000.000 that target_mine(null) would answer
      expect(d.target.period).toMatch(/^[A-Z][a-z]+ \d{4}$/); // "November 2026", a month, not "2026-Q4"
    } finally {
      await w.as(own, (db) => changeSetting(db, { key: "SET-25", branchId: null, restore: true, reason: "Kembali" }));
    }
  }, LONG);

  it("a BC with no target set: the target card says so and the closing value is still hers", async () => {
    const w = await world();
    const bc = await w.person("bc", w.b1);
    const a = await load(w, bc);
    expect(a.d.target.target).toBeNull();
    expect(a.d.target.closing).toEqual(v0(0));
    expect(attainment(a.d.target)).toEqual({ state: "none", text: "Target belum ditetapkan" });
    expect(text(html(a.props))).toContain("Target belum ditetapkan");
  }, LONG);

  it("CROSS-TENANT: tenant B holds a BC with a target, a task, a waiting visit and a commission; tenant A's BC — in a context whose branch id is B's — reads none of it, B's own BC reads all of it (positive control)", async () => {
    const a = await world();
    const b = await world();
    const bcA = await a.person("bc", a.b1);
    const bcB = await b.person("bc", b.b1);
    const ownB = await b.person("owner");
    const foB = await b.person("fo_cashier", b.b1);
    // B's facts: a target of Rp77.000.000, a due control task, a sent intake still waiting for the doctor
    await b.as(ownB, (db) => setStaffTarget(db, key(), bcB.staffId, month(), { closingValueTarget: 77_000_000, plansTarget: 9 }));
    const secretPt = await patient(b, "Pasien Rahasia Tenant B", foB);
    await task(b, "control_due", "consultation_control", secretPt, b.b1, bcB, dayOffset(-2));
    const secretVisit = (await hn.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`, [b.t, b.b1, secretPt, foB.staffId])).rows[0].id as string;
    const { intakeId } = await b.as(bcB, (db) => openIntake(db, key(), secretVisit));
    await b.as(bcB, (db) => saveIntake(db, key(), intakeId, { complaint: "Keluhan rahasia B", facts: [{ kind: "allergy", value: "Tidak ada" }, { kind: "skincare", value: "Sabun" }, { kind: "medication", value: "Tidak ada" }] }));
    await b.as(bcB, (db) => sendIntake(db, key(), intakeId));
    // positive control: B's own BC sees every one of them, so a result without them proves isolation and not an empty fixture
    const own = await load(b, bcB);
    expect(own.d.target.target).toEqual(v0(77_000_000));
    expect(rowsOf(own.d.contact).map((r) => r.patient)).toEqual(["Pasien Rahasia Tenant B"]);
    expect(rowsOf(own.d.waiting).map((r) => r.patient)).toEqual(["Pasien Rahasia Tenant B"]);
    // negative: A's BC, asked with B's own branch id as its active branch, is refused by the database — a not-found branch, never B's data
    const ctxA = await resolveContext(appP, bcA.acc, { tenantId: a.t, actingRole: "bc", activeBranchId: a.b1 });
    const asked = await withTenantContext(appP, ctxA, (db) => summaryIn(db, "bc", b.b1, bcA.staffId, bcA.name, new Date()));
    expect(asked.kind).toBe("no-branch"); // getBranch(B's branch) is invisible to A's tenant (RLS): the loader reads nothing
    const seen = JSON.stringify(asked);
    for (const secret of [b.t, b.b1, bcB.staffId, secretPt, secretVisit, bcB.name, "Pasien Rahasia Tenant B", "77.000.000", "Keluhan rahasia B"]) expect(seen).not.toContain(secret);
    // and A's own BC, in her own branch, reads only her own world: nothing of B's anywhere in what the page would show
    const mine = await load(a, bcA);
    const shown = JSON.stringify(mine) + html(mine.props);
    for (const secret of [b.t, b.b1, bcB.staffId, secretPt, secretVisit, bcB.name, "Pasien Rahasia Tenant B", "Rp77.000.000"]) expect(shown).not.toContain(secret);
    expect(mine.d.target.target).toBeNull();
    expect(rowsOf(mine.d.contact)).toEqual([]);
    expect(rowsOf(mine.d.waiting)).toEqual([]);
  }, LONG);

  it("'Perlu Dihubungi' / 'Belum Memilih' / 'Paket Hampir Habis' on followup_list: the BC's own tasks only — another BC's, an unassigned one and the CS queue never appear; the unavailable cards stay unavailable", async () => {
    const w = await world();
    const bc1 = await w.person("bc", w.b1);
    const bc2 = await w.person("bc", w.b1);
    const bcOther = await w.person("bc", w.b2);
    const fo = await w.person("fo_cashier", w.b1);
    const p = (n: string) => patient(w, n, fo);
    const mine = await p("Pasien Milik Bc1"); const hers = await p("Pasien Milik Bc2"); const free = await p("Pasien Tanpa Tugas"); const csPt = await p("Pasien Antrean CS"); const pl = await p("Pasien Rencana Bc1"); const pk = await p("Pasien Paket Bc1");
    await task(w, "control_due", "consultation_control", mine, w.b1, bc1, dayOffset(-3));
    await task(w, "control_due", "consultation_control", hers, w.b1, bc2, dayOffset(-3));
    await task(w, "control_due", "consultation_control", free, w.b1, null, dayOffset(-3)); // unassigned: readable by every BC of the branch, but not "mine"
    await task(w, "no_show", "appointment", csPt, w.b1, null, dayOffset(-1)); // the CS queue: a BC cannot read it at all
    await task(w, "plan_unselected", "care_plan", pl, w.b1, bc1, dayOffset(-7));
    await task(w, "package_expiry", "package", pk, w.b1, bc1, dayOffset(0), "d14");
    await task(w, "control_due", "consultation_control", await p("Pasien Cabang Lain"), w.b2, bcOther, dayOffset(-2));
    const a = await load(w, bc1);
    expect(rowsOf(a.d.contact).map((r) => r.patient)).toEqual(["Pasien Milik Bc1"]);
    expect(rowsOf(a.d.contact)[0]).toMatchObject({ reason: "control_due", overdue: true, mrn: expect.stringMatching(/^RM-/) });
    expect(rowsOf(a.d.unselected).map((r) => [r.patient, r.overdueDays, r.items, r.value])).toEqual([["Pasien Rencana Bc1", 7, null, null]]);
    expect(rowsOf(a.d.packages).map((r) => [r.patient, r.sessionsLeft, r.validUntil, r.dueOn])).toEqual([["Pasien Paket Bc1", null, null, dayOffset(0)]]);
    const out = html(a.props);
    for (const hidden of ["Pasien Milik Bc2", "Pasien Tanpa Tugas", "Pasien Antrean CS", "Pasien Cabang Lain"]) expect(out).not.toContain(hidden);
    // the BC reads names and MRNs (followup_json): the row links to the patient's profile, a page that exists and admits the BC
    expect(out).toContain(`href="/pasien/${mine}"`);
    // the two cards no reader a BC may call carries stay unavailable on the real database
    expect(a.d.k9).toMatchObject({ state: "unavailable", reason: REASONS.k9 });
    expect(a.d.dormant).toMatchObject({ state: "unavailable", reason: REASONS.dormant });
    // bc2 sees hers only
    expect(rowsOf((await load(w, bc2)).d.contact).map((r) => r.patient)).toEqual(["Pasien Milik Bc2"]);
  }, LONG);

  it("'Menunggu Dokter' through the real intake writers: the visit whose intake THIS BC sent shows; another BC's, a draft, no intake and a visit of another branch do not", async () => {
    const w = await world();
    const bc1 = await w.person("bc", w.b1);
    const bc2 = await w.person("bc", w.b1);
    const bcOther = await w.person("bc", w.b2);
    const fo = await w.person("fo_cashier", w.b1);
    const visit = async (name: string, branch: string) => {
      const pid = await patient(w, name, fo);
      return (await hn.admin.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`, [w.t, branch, pid, fo.staffId])).rows[0].id as string;
    };
    const open = async (bc: Who, v: string, complaint: string) => {
      const { intakeId } = await w.as(bc, (db) => openIntake(db, key(), v));
      const out = await w.as(bc, (db) => saveIntake(db, key(), intakeId, { complaint, facts: [{ kind: "allergy", value: "Tidak ada" }, { kind: "skincare", value: "Sabun wajah" }, { kind: "medication", value: "Tidak ada" }] }));
      expect(out).toMatchObject({ ok: true });
      return intakeId;
    };
    const vMine = await visit("Pasien Intake Saya", w.b1);
    const vHers = await visit("Pasien Intake Bc2", w.b1);
    const vDraft = await visit("Pasien Masih Draf", w.b1);
    await visit("Pasien Belum Intake", w.b1); // no intake at all
    const vElsewhere = await visit("Pasien Cabang Lain", w.b2);
    const send = async (bc: Who, v: string, complaint: string) => { const id = await open(bc, v, complaint); await w.as(bc, (db) => sendIntake(db, key(), id)); };
    await send(bc1, vMine, "Keluhan saya");
    await send(bc2, vHers, "Keluhan bc2");
    await open(bc1, vDraft, "Masih draf"); // a draft: not sent, so not waiting for the doctor yet
    await send(bcOther, vElsewhere, "Keluhan cabang lain");
    const a = await load(w, bc1);
    expect(rowsOf(a.d.waiting).map((r) => [r.patient, r.visitId])).toEqual([["Pasien Intake Saya", vMine]]);
    expect(rowsOf(a.d.waiting)[0]).toMatchObject({ href: `/pendampingan/${vMine}`, arrived: expect.stringMatching(/^\d{2}\.\d{2} WIB$/) });
    const out = html(a.props);
    for (const hidden of ["Pasien Intake Bc2", "Pasien Masih Draf", "Pasien Belum Intake", "Pasien Cabang Lain"]) expect(out).not.toContain(hidden);
    expect(rowsOf((await load(w, bc2)).d.waiting).map((r) => r.patient)).toEqual(["Pasien Intake Bc2"]);
    // the doctor starts: the visit leaves the wait (the doctor step moves on)
    await hn.admin.query(`update visits set doctor = 'in_progress' where id = $1`, [vMine]);
    expect(rowsOf((await load(w, bc1)).d.waiting)).toEqual([]);
  }, LONG);
});
