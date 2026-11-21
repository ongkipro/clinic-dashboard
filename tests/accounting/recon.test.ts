// T-108 (PR-34) — Rekonsiliasi KPI operasional vs buku besar: the pure engine (src/modules/accounting/recon) and the UX-22 ▸ Rekon view.
// Synthetic facts only (no database): the `recon_report` reader that feeds this engine lands after T-107 and gets its own real-DB run.
// Covers Scenario PR-34 (payment recorded without its ledger posting → difference listed with the payment reference), a queued event
// (not yet a difference), multi-branch attribution (S11: package paid at A, session counted at B; clearing nets to zero), a late fact
// booked into a later period (timing, not an error), amount / placement / orphan differences, handover exceptions, unavailable inputs,
// clean days, the view's states and layouts, and no clinical text.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { setKekRingForTests } from "../../src/lib/keys/runtime";
import { ledgerPostingConsumer, LEDGER_CONSUMER } from "../../src/modules/accounting/ledger/posting";
import { issueKasirInvoice, openKasirInvoice, receivePayment } from "../../src/modules/cashier/kasir/kasir";
import { publish } from "../../src/modules/catalog/catalog";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { runOutboxBatch } from "../../src/workers/outbox";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local";
import { days, type Fact, type Posting, type ReconInput, reconcile, type Ref } from "../../src/modules/accounting/recon/recon";
import { readRecon, toReconInput } from "../../src/modules/accounting/recon/report";
import { explain, type RekonProps } from "../../src/app/(app)/keuangan/rekon/model";
import { Rekon } from "../../src/app/(app)/keuangan/rekon/view";

const A = "branch-a";
const B = "branch-b";
const pay = (id: string, label = `KW-${id}`): Ref => ({ kind: "payment", id, label });
const exe = (id: string): Ref => ({ kind: "package_session", id, label: `Sesi ${id}` });
const fact = (metric: Fact["metric"], ref: Ref, day: string, branchId: string, amount: number): Fact => ({ metric, ref, day, branchId, amount });
const post = (metric: Posting["metric"], ref: Ref, day: string, branchId: string, amount: number, period = day.slice(0, 7), originalPeriod = period): Posting =>
  ({ metric, ref, entryId: `je-${ref.id}-${branchId}`, businessDay: day, period, originalPeriod, branchId, amount });
function input(over: Partial<ReconInput> = {}): ReconInput {
  return {
    from: "2026-11-01", to: "2026-11-03", branches: [{ id: A, name: "Cabang A" }, { id: B, name: "Cabang B" }],
    facts: [], postings: [], pending: [], clearing: [], clearingNet: [], handover: [], unavailable: [], ...over,
  };
}
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const scope = { branches: [{ id: A, name: "Cabang A" }, { id: B, name: "Cabang B" }], branch: null, from: "2026-11-01", to: "2026-11-03",
  action: "/keuangan/rekon", period: "1–3 November 2026" };
const props = (r: ReturnType<typeof reconcile>, over: Partial<RekonProps> = {}): RekonProps =>
  ({ scope, ledgerHref: "/keuangan/buku-besar", hrefFor: (ref) => (ref.kind === "payment" ? `/kasir/struk/${ref.id}` : undefined), state: { kind: "ready", data: r }, ...over });
const html = (p: RekonProps) => renderToStaticMarkup(h(Rekon, p));

describe("Scenario PR-34 reconciliation: a payment recorded without its ledger posting", () => {
  const r = reconcile(input({
    facts: [fact("k1", pay("p1", "KW-0001"), "2026-11-02", A, 350_000), fact("k1", pay("p2", "KW-0002"), "2026-11-02", A, 100_000)],
    postings: [post("k1", pay("p2", "KW-0002"), "2026-11-02", A, 100_000)],
  }));
  it("lists the difference with the payment reference", () => {
    expect(r.items).toEqual([expect.objectContaining({ kind: "missing", metric: "k1", ref: pay("p1", "KW-0001"), day: "2026-11-02", branchId: A, fact: 350_000, ledger: null, difference: 350_000 })]);
    expect(r.verdict).toBe("ada_selisih");
    const cell = r.rows.find((x) => x.day === "2026-11-02" && x.branchId === A)!.cells.find((c) => c.metric === "k1")!;
    expect(cell).toMatchObject({ fact: 450_000, ledger: 100_000, difference: 350_000, status: "selisih" });
  });
  it("the view shows the reference first, the signed difference, and links to the payment", () => {
    const out = html(props(r));
    expect(text(out)).toContain("KW-0001 · Belum diposting ke buku besar · +Rp350.000");
    expect(out).toContain('href="/kasir/struk/p1"');
    expect(out).toMatch(/data-verdict="ada_selisih"/);
    expect(out).toMatch(/data-row="2026-11-02:branch-a" data-status="selisih"/);
  });
  it("an event still waiting for the ledger consumer is 'menunggu posting', not a difference", () => {
    const q = reconcile(input({ facts: [fact("k1", pay("p1"), "2026-11-02", A, 350_000)], pending: [{ eventId: "ev1", event: "PaymentAllocated", ref: pay("p1") }] }));
    expect(q.items).toEqual([expect.objectContaining({ kind: "queued", eventId: "ev1", difference: 350_000 })]);
    expect(q.verdict).toBe("menunggu_posting");
    expect(q.rows.find((x) => x.day === "2026-11-02" && x.branchId === A)!.status).toBe("menunggu");
  });
});

describe("S11 multi-branch attribution: package paid at A, session counted at B", () => {
  const r = reconcile(input({
    facts: [fact("k1", pay("pk"), "2026-11-01", A, 3_000_000), fact("k2", exe("s1"), "2026-11-02", B, 600_000)],
    postings: [post("k1", pay("pk"), "2026-11-01", A, 3_000_000), post("k2", exe("s1"), "2026-11-02", B, 600_000)],
    clearing: [{ day: "2026-11-02", branchId: A, amount: -600_000 }, { day: "2026-11-02", branchId: B, amount: 600_000 }],
    clearingNet: [{ day: "2026-11-02", amount: 0 }],
  }));
  it("cash at A and revenue at B both match; clearing nets to zero; the report is clean", () => {
    expect(r.items).toEqual([]);
    expect(r.clearing).toEqual([{ day: "2026-11-02", net: 0, byBranch: [{ branchId: A, amount: -600_000 }, { branchId: B, amount: 600_000 }] }]);
    expect(r.verdict).toBe("bersih");
    expect(r.rows.find((x) => x.day === "2026-11-02" && x.branchId === B)!.cells.find((c) => c.metric === "k2")!.status).toBe("cocok");
    expect(text(html(props(r)))).toContain("Seimbang");
  });
  it("revenue posted at the selling branch instead of the executing branch is a placement difference on both branches", () => {
    const bad = reconcile(input({ facts: [fact("k2", exe("s1"), "2026-11-02", B, 600_000)], postings: [post("k2", exe("s1"), "2026-11-02", A, 600_000)] }));
    expect(new Set(bad.items.map((i) => `${i.kind}:${i.branchId}:${i.difference}`))).toEqual(new Set([`placement:${A}:-600000`, `placement:${B}:600000`]));
    expect(bad.verdict).toBe("ada_selisih");
  });
  it("clearing that does not net to zero is a difference", () => {
    const c = reconcile(input({ clearing: [{ day: "2026-11-02", branchId: A, amount: -600_000 }, { day: "2026-11-02", branchId: B, amount: 500_000 }],
      clearingNet: [{ day: "2026-11-02", amount: -100_000 }] }));
    expect(c.clearing[0].net).toBe(-100_000);
    expect(c.verdict).toBe("ada_selisih");
    expect(text(html(props(c)))).toContain("Tidak seimbang −Rp100.000");
  });
});

describe("R3 7adf39f6 F1: clearing balance is judged tenant-wide; a selected branch shows only its own legs", () => {
  it("one branch selected: its single leg is shown, the tenant-wide net is zero, the report is clean (S11 filtered)", () => {
    const r = reconcile(input({ branches: [{ id: B, name: "Cabang B" }], clearing: [{ day: "2026-11-02", branchId: B, amount: 600_000 }], clearingNet: [{ day: "2026-11-02", amount: 0 }] }));
    expect(r.clearing).toEqual([{ day: "2026-11-02", net: 0, byBranch: [{ branchId: B, amount: 600_000 }] }]);
    expect(r.verdict).toBe("bersih");
    expect(text(html(props(r)))).toContain("Seimbang");
  });
  it("a true tenant-wide imbalance is a difference even where the selected branch has no leg (no other branch's leg is exposed)", () => {
    const r = reconcile(input({ branches: [{ id: B, name: "Cabang B" }], clearingNet: [{ day: "2026-11-02", amount: -70_000 }] }));
    expect(r.clearing).toEqual([{ day: "2026-11-02", net: -70_000, byBranch: [] }]);
    expect(r.verdict).toBe("ada_selisih");
    expect(text(html(props(r)))).toContain("di cabang lain Tidak seimbang −Rp70.000");
  });
  it("a leg on a day without its tenant-wide net is refused (never judged from partial legs)", () => {
    expect(() => reconcile(input({ clearing: [{ day: "2026-11-02", branchId: A, amount: -600_000 }] }))).toThrow(/clearing net missing/);
  });
});

describe("R3 7adf39f6 F2: an original and its reversal net within metric, reference, day and branch only", () => {
  const doc = { kind: "treatment_execution", id: "x1", label: "x1" };
  const pe = (day: string, branchId: string, amount: number, entryId: string): Posting => ({ ...post("k2", doc, day, branchId, amount), entryId });
  it("same bucket, net zero: no orphan, clean", () => {
    const r = reconcile(input({ postings: [pe("2026-11-02", A, 400_000, "je-orig"), pe("2026-11-02", A, -400_000, "je-mirror")] }));
    expect(r.items).toEqual([]);
    expect(r.verdict).toBe("bersih");
  });
  it("different day or branch: never cancelled; each entry stays attributed", () => {
    const d = reconcile(input({ postings: [pe("2026-11-01", A, 400_000, "je-orig"), pe("2026-11-02", A, -400_000, "je-mirror")] }));
    expect(d.items.map((i) => [i.kind, i.day, i.entryId, i.difference])).toEqual([["orphan", "2026-11-01", "je-orig", -400_000], ["orphan", "2026-11-02", "je-mirror", 400_000]]);
    const b = reconcile(input({ postings: [pe("2026-11-02", A, 400_000, "je-orig"), pe("2026-11-02", B, -400_000, "je-mirror")] }));
    expect(b.items.map((i) => [i.branchId, i.entryId])).toEqual([[A, "je-orig"], [B, "je-mirror"]]);
    expect(b.verdict).toBe("ada_selisih");
  });
  it("same bucket, nonzero residual: the entries stay listed with their attribution and sum to the residual", () => {
    const r = reconcile(input({ postings: [pe("2026-11-02", A, 400_000, "je-orig"), pe("2026-11-02", A, -150_000, "je-part")] }));
    expect(r.items.map((i) => i.entryId).sort()).toEqual(["je-orig", "je-part"]);
    expect(r.items.reduce((s, i) => s + i.difference, 0)).toBe(-250_000);
    expect(r.verdict).toBe("ada_selisih");
  });
  it("another metric of the same reference is not cancelled against it", () => {
    const r = reconcile(input({ postings: [pe("2026-11-02", A, 400_000, "je-orig"), { ...post("k1", doc, "2026-11-02", A, -400_000), entryId: "je-k1" }] }));
    expect(new Set(r.items.map((i) => `${i.kind}:${i.metric}:${i.entryId}`))).toEqual(new Set(["orphan:k1:je-k1", "orphan:k2:je-orig"]));
  });
});

describe("R3 7adf39f6 F3: derived rupiah is exact or refused (safe inputs, unsafe sums)", () => {
  const H = 2 ** 52; // safe; H + H = 2^53 is not
  it("two safe parts of one document", () => {
    expect(() => reconcile(input({ facts: [fact("k1", pay("o"), "2026-11-01", A, H), fact("k1", pay("o"), "2026-11-01", A, H)] }))).toThrow(/not a safe integer/);
  });
  it("a day × branch total over different documents", () => {
    expect(() => reconcile(input({ facts: [fact("k1", pay("o1"), "2026-11-01", A, H), fact("k1", pay("o2"), "2026-11-01", A, H)],
      postings: [post("k1", pay("o1"), "2026-11-01", A, H), post("k1", pay("o2"), "2026-11-01", A, H)] }))).toThrow(/not a safe integer/);
  });
  it("a ledger sum of one document's entries", () => {
    expect(() => reconcile(input({ facts: [fact("k1", pay("o"), "2026-11-01", A, 1)],
      postings: [{ ...post("k1", pay("o"), "2026-11-01", A, H), entryId: "e1" }, { ...post("k1", pay("o"), "2026-11-01", A, H), entryId: "e2" }] }))).toThrow(/not a safe integer/);
  });
  it("a fact − ledger difference", () => {
    expect(() => reconcile(input({ facts: [fact("k1", pay("o"), "2026-11-01", A, Number.MAX_SAFE_INTEGER)], postings: [post("k1", pay("o"), "2026-11-01", A, -1)] }))).toThrow(/not a safe integer/);
  });
  it("an orphan bucket net", () => {
    expect(() => reconcile(input({ postings: [{ ...post("k2", exe("z"), "2026-11-01", A, H), entryId: "e1" }, { ...post("k2", exe("z"), "2026-11-01", A, H), entryId: "e2" }] }))).toThrow(/not a safe integer/);
  });
  it("the largest exact values still reconcile", () => {
    const r = reconcile(input({ facts: [fact("k1", pay("o"), "2026-11-01", A, Number.MAX_SAFE_INTEGER)], postings: [post("k1", pay("o"), "2026-11-01", A, Number.MAX_SAFE_INTEGER)] }));
    expect(r.verdict).toBe("bersih");
  });
});

describe("timing: a late fact booked into a later open period", () => {
  // October was locked; a 31 Oct payment posts into November (business date kept, period moved; PR-26 ledger_booked_date).
  const r = reconcile(input({
    from: "2026-10-31", to: "2026-11-01",
    facts: [fact("k1", pay("late", "KW-0099"), "2026-10-31", A, 200_000)],
    postings: [post("k1", pay("late", "KW-0099"), "2026-10-31", A, 200_000, "2026-11", "2026-10")],
  }));
  it("is labelled as booked in the later period, not as a difference", () => {
    expect(r.items).toEqual([expect.objectContaining({ kind: "timing", difference: 0, bookedPeriod: "2026-11" })]);
    expect(r.verdict).toBe("bersih");
    expect(r.rows.find((x) => x.day === "2026-10-31" && x.branchId === A)!.status).toBe("waktu");
    expect(explain(r.items[0])).toBe("KW-0099 · Dibukukan di periode lain: November 2026 (bulan asal dikunci)");
  });
  it("a posting on another business day is a placement difference, not timing", () => {
    const d = reconcile(input({ facts: [fact("k1", pay("x"), "2026-11-01", A, 10)], postings: [post("k1", pay("x"), "2026-11-02", A, 10)] }));
    expect(d.items.map((i) => i.kind)).toEqual(["placement", "placement"]);
    expect(d.verdict).toBe("ada_selisih");
  });
});

describe("other differences", () => {
  it("different amount and a ledger entry with no operational fact", () => {
    const r = reconcile(input({
      facts: [fact("k2", { kind: "dispensing", id: "l1", label: "INV-7/1" }, "2026-11-01", A, 11_000)],
      postings: [post("k2", { kind: "dispensing", id: "l1", label: "INV-7/1" }, "2026-11-01", A, 10_000), post("receivables", { kind: "receivable", id: "r9", label: "PTG-9" }, "2026-11-03", B, 50_000)],
    }));
    expect(r.items.map((i) => [i.kind, i.ref.label, i.difference])).toEqual([["amount", "INV-7/1", 1_000], ["orphan", "PTG-9", -50_000]]);
    expect(text(html(props(r)))).toContain("PTG-9 · Ada di buku besar, tidak ada di operasional · −Rp50.000");
  });
  it("parts of one document on the same day and branch are summed before matching", () => {
    const r = reconcile(input({ facts: [fact("k1", pay("s"), "2026-11-01", A, 60), fact("k1", pay("s"), "2026-11-01", A, 40)], postings: [post("k1", pay("s"), "2026-11-01", A, 100)] }));
    expect(r.items).toEqual([]);
  });
  it("refuses non-integer rupiah", () => {
    expect(() => reconcile(input({ facts: [fact("k1", pay("f"), "2026-11-01", A, 1.5)] }))).toThrow(/integer rupiah/);
  });
});

describe("handover exceptions and unavailable inputs", () => {
  it("handed products without an exact line link keep the report from claiming clean", () => {
    const r = reconcile(input({ handover: [{ branchId: B, fractional: 1, unlinked: 2 }, { branchId: A, fractional: 0, unlinked: 0 }] }));
    expect(r.exceptions).toEqual([{ branchId: B, fractional: 1, unlinked: 2 }]);
    expect(r.verdict).toBe("ada_pengecualian");
    expect(text(html(props(r)))).toContain("Cabang B · 2 tanpa tautan · 1 pecahan");
  });
  it("an unavailable metric is 'Belum tersedia' with its reason, never Rp0 or Cocok", () => {
    const r = reconcile(input({ facts: [fact("k2", exe("s"), "2026-11-01", A, 5)], unavailable: [{ metric: "k2", branchId: null, reason: "Pembacaan K2 belum tersedia (T-107)" }] }));
    expect(r.verdict).toBe("tidak_lengkap");
    const c = r.rows.find((x) => x.day === "2026-11-01" && x.branchId === A)!.cells.find((x) => x.metric === "k2")!;
    expect(c).toEqual({ metric: "k2", fact: null, ledger: null, difference: null, status: "tidak_tersedia", reason: "Pembacaan K2 belum tersedia (T-107)" });
    const out = text(html(props(r)));
    expect(out).toContain("Layanan selesai (K2): Pembacaan K2 belum tersedia (T-107)");
    expect(out).toContain("Belum lengkap");
  });
});

describe("clean days and view layout", () => {
  const r = reconcile(input({ facts: [fact("k1", pay("c"), "2026-11-01", A, 75_000)], postings: [post("k1", pay("c"), "2026-11-01", A, 75_000)] }));
  it("every day × branch is a row; a clean period reads 'Semua cocok'", () => {
    expect(days("2026-11-01", "2026-11-03")).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(r.rows).toHaveLength(6);
    expect(r.rows.every((x) => x.status === "cocok")).toBe(true);
    expect(r.verdict).toBe("bersih");
    const out = html(props(r));
    expect(text(out)).toContain("Semua cocok");
    expect(text(out)).toContain("5 hari-cabang tanpa transaksi dan tanpa selisih tidak ditampilkan.");
    expect(out).toContain("Rp75.000");
  });
  it("table on regular, cards on compact; branch segments keep the period", () => {
    const out = html(props(r));
    expect(out).toContain("min-[700px]:block");
    expect(out).toContain("min-[700px]:hidden");
    expect(out).toContain('href="/keuangan/rekon?dari=2026-11-01&amp;sampai=2026-11-03&amp;cabang=branch-b"');
    expect(out).toContain('href="/keuangan/buku-besar"');
  });
  it("a reference without a page renders as text, not a dead link", () => {
    const x = reconcile(input({ facts: [fact("k2", exe("s9"), "2026-11-01", A, 1)] }));
    const out = html(props(x));
    expect(out).toMatch(/data-ref="s9"/);
    expect(out).not.toContain("href=\"undefined\"");
  });
});

describe("one state per screen (10 State Copy Patterns)", () => {
  const cases = [
    [{ kind: "loading" }, 'aria-busy="true"'],
    [{ kind: "empty", message: "Belum ada transaksi pada periode ini." }, "Belum ada transaksi pada periode ini."],
    [{ kind: "filtered-empty", message: "Tidak ada transaksi untuk filter ini.", clearHref: "/keuangan/rekon" }, "Hapus Filter"],
    [{ kind: "error", message: "Koneksi terputus.", retryHref: "/keuangan/rekon" }, "Coba Lagi"],
    [{ kind: "blocked", reason: "Peta posting belum ditandatangani", unblock: "Finance dapat meminta tanda tangan akuntan" }, "Peta posting belum ditandatangani."],
    [{ kind: "permission", object: "rekonsiliasi" }, "Anda tidak memiliki akses ke rekonsiliasi."],
  ] as const;
  it.each(cases)("%o renders its copy and no report", (state, copy) => {
    const out = html(props(reconcile(input()), { state }));
    expect(out).toContain(copy);
    expect(out).not.toContain("data-verdict=");
    expect(out).not.toContain("data-row=");
  });
});

describe("no clinical content and safe text", () => {
  it("escapes document labels and branch names; no clinical vocabulary", () => {
    const hostile = `<img src=x onerror="alert(1)">`;
    const r = reconcile(input({ facts: [fact("k1", pay("h", hostile), "2026-11-01", A, 1)] }));
    const out = html(props(r, { scope: { ...scope, branches: [{ id: A, name: hostile }, { id: B, name: "Cabang B" }] } }));
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
    expect(text(out)).not.toMatch(/diagnos|alergi|resep|anamnesis|rekam medis|pasien/i);
  });
});

// ── slice 2 (P1, on main f0bd3c44): the reader boundary and two discriminating fixtures. The SQL reader `recon_report` is not built (no
// migration in this slice); these tests fix the TypeScript side of its contract so the reader plugs in without touching the engine. ──
describe("Sol option A: VAT is not a Rekon metric; completeness stays enforced on the supported metrics", () => {
  it("a fully matched dataset of k1, k2 and receivables is clean (bersih), with no VAT column or cell", () => {
    const r = reconcile(input({
      facts: [fact("k1", pay("m1"), "2026-11-01", A, 100_000), fact("k2", exe("m2"), "2026-11-02", B, 80_000),
              fact("receivables", { kind: "receivable", id: "m3", label: "PTG-3" }, "2026-11-03", A, 40_000)],
      postings: [post("k1", pay("m1"), "2026-11-01", A, 100_000), post("k2", exe("m2"), "2026-11-02", B, 80_000),
                 post("receivables", { kind: "receivable", id: "m3", label: "PTG-3" }, "2026-11-03", A, 40_000)],
    }));
    expect(r.items).toEqual([]);
    expect(r.verdict).toBe("bersih");
    expect(r.rows.every((x) => x.cells.map((c) => c.metric).join() === "k1,k2,receivables")).toBe(true);
    const out = text(html(props(r)));
    expect(out).toContain("Semua cocok");
    expect(out).not.toMatch(/PPN/);
  });
  it("missing supported data (a supported metric unreadable for a branch) still makes the report tidak_lengkap", () => {
    const r = reconcile(input({
      facts: [fact("k1", pay("m1"), "2026-11-01", A, 100_000)], postings: [post("k1", pay("m1"), "2026-11-01", A, 100_000)],
      unavailable: [{ metric: "receivables", branchId: B, reason: "Pembacaan piutang cabang ini belum tersedia" }],
    }));
    expect(r.verdict).toBe("tidak_lengkap");
    expect(r.rows.find((x) => x.branchId === B)!.cells.find((c) => c.metric === "receivables")!.status).toBe("tidak_tersedia");
  });
  it("the PR-34 receipt mismatch stays visible next to matched metrics", () => {
    const r = reconcile(input({
      facts: [fact("k1", pay("lost", "KW-0042"), "2026-11-01", A, 500_000), fact("k2", exe("m2"), "2026-11-01", A, 80_000)],
      postings: [post("k2", exe("m2"), "2026-11-01", A, 80_000)],
    }));
    expect(r.items).toEqual([expect.objectContaining({ kind: "missing", metric: "k1", ref: pay("lost", "KW-0042"), difference: 500_000 })]);
    expect(r.verdict).toBe("ada_selisih");
    expect(text(html(props(r)))).toContain("KW-0042");
  });
});

describe("an unavailable metric produces no item (slice 2 defect, reproduced first)", () => {
  it("a k2 fact without a posting is not listed as 'Belum diposting' while k2 is unavailable; another branch's k2 and every k1 still are", () => {
    const r = reconcile(input({
      facts: [fact("k2", exe("s1"), "2026-11-01", A, 500_000), fact("k2", exe("s2"), "2026-11-01", B, 200_000), fact("k1", pay("p1"), "2026-11-01", A, 100_000)],
      unavailable: [{ metric: "k2", branchId: A, reason: "Pembacaan K2 cabang ini belum tersedia" }],
    }));
    expect(r.items.map((i) => [i.kind, i.metric, i.ref.id, i.branchId])).toEqual([["missing", "k2", "s2", B], ["missing", "k1", "p1", A]]); // larger difference first
    expect(r.verdict).toBe("tidak_lengkap");
    expect(text(html(props(r)))).not.toContain("Sesi s1 · Belum diposting");
  });
});

describe("Panel 2 invariant: a receipt paid on several lines reconciles 1-to-1 per payment reference", () => {
  it("two PaymentAllocated entries carrying the same payment reference sum to the fact; one missing allocation is an amount difference, not a split", () => {
    const f = fact("k1", pay("p9", "KW-0009"), "2026-11-02", A, 500_000);
    const two = [post("k1", pay("p9", "KW-0009"), "2026-11-02", A, 300_000), { ...post("k1", pay("p9", "KW-0009"), "2026-11-02", A, 200_000), entryId: "je-alloc-2" }];
    expect(reconcile(input({ facts: [f], postings: two })).items).toEqual([]);
    const one = reconcile(input({ facts: [f], postings: [two[0]] }));
    expect(one.items).toEqual([expect.objectContaining({ kind: "amount", ref: pay("p9", "KW-0009"), fact: 500_000, ledger: 300_000, difference: 200_000 })]);
  });
});

describe("toReconInput: the recon_report JSON boundary (snake_case, bigint as number or string)", () => {
  const raw = (over: Record<string, unknown> = {}) => ({
    from: "2026-11-01", to: "2026-11-03", branches: [{ id: A, name: "Cabang A" }, { id: B, name: "Cabang B" }],
    facts: [{ metric: "k1", ref: { kind: "payment", id: "p1", label: "KW-0001" }, day: "2026-11-02", branch_id: A, amount: "350000" }],
    postings: [], pending: [], clearing: [{ day: "2026-11-02", branch_id: A, amount: 0 }], clearing_net: [{ day: "2026-11-02", amount: "0" }], handover: [{ branch_id: B, fractional: "1", unlinked: 2 }],
    unavailable: [{ metric: "k2", branch_id: B, reason: "Pembacaan K2 cabang ini belum tersedia" }],
    ...over,
  });
  it("Scenario PR-34 through the boundary: the payment without its posting is listed with its reference", () => {
    const x = toReconInput(raw());
    expect(x.facts).toEqual([fact("k1", pay("p1", "KW-0001"), "2026-11-02", A, 350_000)]);
    expect(x.handover).toEqual([{ branchId: B, fractional: 1, unlinked: 2 }]);
    expect(x.unavailable).toEqual([{ metric: "k2", branchId: B, reason: "Pembacaan K2 cabang ini belum tersedia" }]);
    const r = reconcile(x);
    expect(r.items).toEqual([expect.objectContaining({ kind: "missing", ref: pay("p1", "KW-0001"), difference: 350_000 })]);
  });
  it("postings and pending events map their fields; a queued event keeps the payment out of the differences", () => {
    const x = toReconInput(raw({
      postings: [{ metric: "k1", ref: { kind: "payment", id: "p2", label: "KW-0002" }, entry_id: "e2", business_day: "2026-11-02", period: "2026-11", original_period: "2026-10", branch_id: A, amount: 75_000 }],
      pending: [{ event_id: "ev1", event: "PaymentAllocated", ref: { kind: "payment", id: "p1", label: "KW-0001" } }],
    }));
    expect(x.postings).toEqual([{ metric: "k1", ref: pay("p2", "KW-0002"), entryId: "e2", businessDay: "2026-11-02", period: "2026-11", originalPeriod: "2026-10", branchId: A, amount: 75_000 }]);
    // engine order: orphan (a posting without a fact) before queued; the booked-later posting of an unknown document is an orphan, not timing
    expect(reconcile(x).items.map((i) => [i.kind, i.ref.id])).toEqual([["orphan", "p2"], ["queued", "p1"]]);
  });
  it.each([
    ["output VAT, not a Rekon metric (Sol option A)", { facts: [{ metric: "vat", ref: { kind: "invoice_line", id: "l", label: "x" }, day: "2026-11-02", branch_id: A, amount: 1 }] }],
    ["VAT marked unavailable", { unavailable: [{ metric: "vat", branch_id: null, reason: "x" }] }],
    ["an unknown metric", { facts: [{ metric: "k9", ref: { kind: "payment", id: "p", label: "x" }, day: "2026-11-02", branch_id: A, amount: 1 }] }],
    ["a fractional amount", { facts: [{ metric: "k1", ref: { kind: "payment", id: "p", label: "x" }, day: "2026-11-02", branch_id: A, amount: "1.5" }] }],
    ["an amount beyond safe integers", { facts: [{ metric: "k1", ref: { kind: "payment", id: "p", label: "x" }, day: "2026-11-02", branch_id: A, amount: "9007199254740993" }] }],
    ["a missing part (never read as empty)", { postings: undefined }],
    ["a missing tenant-wide clearing net", { clearing_net: undefined }],
    ["an unsafe clearing net", { clearing_net: [{ day: "2026-11-02", amount: "9007199254740993" }] }],
    ["a malformed day", { clearing: [{ day: "2026-11-31", branch_id: A, amount: 0 }] }],
    ["a reference without an id", { facts: [{ metric: "k1", ref: { kind: "payment", label: "x" }, day: "2026-11-02", branch_id: A, amount: 1 }] }],
  ])("refuses %s (an error state, not a clean report)", (_, over) => {
    expect(() => toReconInput(raw(over as Record<string, unknown>))).toThrow(/recon_report/);
  });
});


// ── recon_report on real PostgreSQL (drizzle/0129): the real writers, the real posting consumer, the definer, then the engine ──
// Synthetic tenants and staff only (MIG-2). Discriminating: a posted payment reconciles clean, a queued one is "menunggu" (not a
// difference), and a payment whose posting receipt was completed without an entry (the PR-34 scenario) is a difference listed with the
// receipt number. Owner / finance / auditor read their own tenant only; other roles are refused; another tenant's branch is not found.
describe("recon_report on PostgreSQL (PR-34; owner, finance, auditor; tenant-scoped)", () => {
  type T = { tenantId: string; b1: string; b2: string };
  type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
  const WIDE = ["owner", "finance", "admin_pusat", "auditor", "purchasing"];
  let hx: Harness; let app: pg.Pool; let own: pg.Pool; let worker: pg.Pool; let n = 0;
  let A: T; let B: T; let OWN: P; let FIN: P; let AU: P; let MGR: P; let FO: P; let BFIN: P; let item: string; let item2: string;
  const key = () => crypto.randomUUID();
  const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
    withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
  const err = (x: Promise<unknown>) => x.then(() => "ok", (e) => String((e as Error).message));
  async function tenant(name: string): Promise<T> {
    const tenantId = (await hx.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
    await hx.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, name]);
    const br = async (c: string) => (await hx.admin.query(`insert into branches (tenant_id, code, name, timezone) values ($1, $2, $2, 'Asia/Jakarta') returning id`, [tenantId, c])).rows[0].id as string;
    return { tenantId, b1: await br("RK1"), b2: await br("RK2") };
  }
  async function person(t: T, role: Role, branch?: string): Promise<P> {
    const acc = (await hx.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`rk${++n}@klinik-sintetis.test`])).rows[0].id as string;
    const { staffId } = await createMembership(own, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Rekon ${n}` });
    const rid = await assignRole(hx.admin, { tenantId: t.tenantId, staffId, role });
    if (!WIDE.includes(role)) await assignBranch(hx.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: branch ?? t.b1 });
    return { acc, staffId, tenantId: t.tenantId, role, branch: WIDE.includes(role) ? undefined : branch ?? t.b1 };
  }
  async function patient(t: T, branch: string): Promise<string> {
    const id = crypto.randomUUID().replace(/-/g, "");
    return (await hx.admin.query(
      `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                             marital_status, registered_branch_id, created_by, created_as)
       values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Pasien Rekon Sintetis', '1990-01-01', 'female', 'nik', $3, $4,
               'islam', 'Karyawan', 's1', 'kawin', $2, (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id`,
      [t.tenantId, branch, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43)])).rows[0].id as string;
  }
  async function drain() {
    for (let i = 0; i < 20; i++) {
      const [r] = await runOutboxBatch(worker, [ledgerPostingConsumer], { worker: "t108", limit: 200, leaseSeconds: 5 });
      if (r.done + r.skipped + r.failed === 0) return;
    }
  }
  // a product sale paid in cash at the counter: one receipt, one payment, one allocation (K1 fact + PaymentAllocated)
  async function sale(amount: number) {
    const pid = await patient(A, A.b1);
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: item, quantity: amount / 100_000 }]));
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount, cashTendered: amount }]));
    return (await hx.admin.query(`select y.id, r.number from payments y join receipts r on r.id = y.receipt_id
                                   where y.tenant_id = $1 and y.invoice_id = $2`, [A.tenantId, invoiceId])).rows[0] as { id: string; number: string };
  }
  const today = async () => (await hx.admin.query(`select public.tax_local_date($1, now(), $2)::text d`, [A.tenantId, A.b1])).rows[0].d as string;

  beforeAll(async () => {
    setKekRingForTests({ current: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) });
    hx = await createHarness();
    app = await openAppPool({ connectionString: hx.urlAs(await hx.createLoginRole("", [APP_GROUP_ROLE])), max: 4 });
    worker = await openAppPool({ connectionString: hx.urlAs(await hx.createLoginRole("", [APP_GROUP_ROLE])), max: 2 });
    own = testPool({ connectionString: hx.ownerUrl(), max: 2 });
    A = await tenant("PT Rekon Sintetis"); B = await tenant("PT Rekon Lain");
    OWN = await person(A, "owner"); FIN = await person(A, "finance"); AU = await person(A, "auditor"); MGR = await person(A, "manager"); FO = await person(A, "fo_cashier");
    BFIN = await person(B, "finance");
    item = (await as(OWN, (db) => publish(db, { kind: "product", code: "RK-SRM" }, {
      name: "Serum Rekon", tax_category: "exempt_medical", tax_basis: "Obat", normal_price: 100_000, unit: "pcs",
    } as never, "Produk baru"))).itemId;
    item2 = (await as(OWN, (db) => publish(db, { kind: "product", code: "RK-TNR" }, {
      name: "Toner Rekon", tax_category: "exempt_medical", tax_basis: "Obat", normal_price: 250_000, unit: "pcs",
    } as never, "Produk baru"))).itemId;
  }, 300_000);
  afterAll(async () => {
    setKekRingForTests(undefined);
    await app?.end(); await worker?.end(); await own?.end(); await hx?.close();
  });

  it("PR-34: a posted payment is clean; a queued one waits; a completed receipt without its entry is a difference with the receipt number", async () => {
    const posted = await sale(300_000);
    await drain();
    const queued = await sale(200_000);
    const lost = await sale(500_000);
    // the posting consumer completes the lost payment's receipt without an entry (what a skipped rule or a lost write leaves behind)
    await hx.admin.query(`update event_receipts r set done_at = now() from domain_events e
                           where e.id = r.event_id and r.consumer = $1 and e.type = 'PaymentAllocated' and e.payload ->> 'payment_id' = $2`, [LEDGER_CONSUMER, lost.id]);
    const d = await today();
    const r = await as(FIN, (db) => readRecon(db, { from: d, to: d }));
    const k1 = r.items.filter((i) => i.metric === "k1");
    expect(k1.find((i) => i.ref.id === posted.id)).toBeUndefined();
    expect(k1.find((i) => i.ref.id === queued.id)).toMatchObject({ kind: "queued", ref: { kind: "payment", label: queued.number } });
    expect(k1.find((i) => i.ref.id === lost.id)).toMatchObject({ kind: "missing", ref: { kind: "payment", label: lost.number }, fact: 500_000, ledger: null, difference: 500_000 });
    // the supported metrics are all read: the lost receipt makes the period a difference, not an incomplete report
    expect(r.verdict).toBe("ada_selisih");
    const cell = r.rows.find((x) => x.branchId === A.b1)!.cells.find((c) => c.metric === "k1")!;
    expect(cell).toMatchObject({ fact: 1_000_000, ledger: 300_000, status: "selisih" });
    expect(r.unavailable).toEqual([]);
    expect(r.rows.every((x) => x.cells.map((c) => c.metric).join() === "k1,k2,receivables")).toBe(true); // no VAT column, no 0/0 cell
    // the queued event posts: it leaves the list; the lost one stays a difference
    await drain();
    const r2 = await as(AU, (db) => readRecon(db, { from: d, to: d, branchId: A.b1 }));
    expect(r2.items.filter((i) => i.metric === "k1").map((i) => [i.kind, i.ref.id])).toEqual([["missing", lost.id]]);
  });

  it("Sol option A on PG: a fully posted branch-day reads bersih; recon_report returns no VAT metric and no unavailable row", async () => {
    const d = await today();
    const fo2 = await person(A, "fo_cashier", A.b2);
    const pid = await patient(A, A.b2);
    const { invoiceId } = await as(fo2, (db) => openKasirInvoice(db, key(), { patientId: pid }));
    await as(fo2, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: item, quantity: 2 }]));
    await as(fo2, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 200_000, cashTendered: 200_000 }]));
    await drain();
    const raw = (await as(FIN, (db) => db.query(`select recon_report($1::date, $1::date, $2) r`, [d, A.b2]))).rows[0].r;
    expect(raw.unavailable).toEqual([]);
    expect([...raw.facts, ...raw.postings].every((x: { metric: string }) => x.metric !== "vat")).toBe(true);
    expect(raw.facts.length).toBeGreaterThan(0);
    const r = await as(FIN, (db) => readRecon(db, { from: d, to: d, branchId: A.b2 }));
    expect(r.items).toEqual([]);
    expect(r.verdict).toBe("bersih");
  });

  it("Panel 2 invariant on PG: a receipt paying two lines posts two allocations, reconciled as one payment reference (no split difference)", async () => {
    const pid = await patient(A, A.b1);
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pid }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: item, quantity: 2 }, { itemId: item2, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 450_000, cashTendered: 450_000 }]));
    const y = (await hx.admin.query(`select y.id, r.number from payments y join receipts r on r.id = y.receipt_id where y.invoice_id = $1`, [invoiceId])).rows[0];
    expect((await hx.admin.query(`select count(*)::int c from payment_allocations where payment_id = $1`, [y.id])).rows[0].c).toBe(2);
    await drain();
    const d = await today();
    const raw = (await as(FIN, (db) => db.query(`select recon_report($1::date, $1::date, null) r`, [d]))).rows[0].r;
    const mine = raw.postings.filter((x: { metric: string; ref: { id: string } }) => x.metric === "k1" && x.ref.id === y.id);
    expect(mine).toHaveLength(2); // one per allocation entry, both carrying the payment reference and the receipt number
    expect(mine.every((x: { ref: { kind: string; label: string } }) => x.ref.kind === "payment" && x.ref.label === y.number)).toBe(true);
    expect(mine.reduce((a: number, x: { amount: number | string }) => a + Number(x.amount), 0)).toBe(450_000);
    const r = await as(FIN, (db) => readRecon(db, { from: d, to: d }));
    expect(r.items.filter((i) => i.ref.id === y.id)).toEqual([]);
  });

  it("an orphan tender posting (no K1 fact) is listed; a posting at another branch is placed there and filtered out by the branch scope", async () => {
    const d = await today();
    const fake = crypto.randomUUID();
    const c = await own.connect();
    try {
      await c.query("begin");
      await c.query(`select ledger_post($1, 'auto', $2, 'RefundPaid', 'refund', $3, null, $4::date, $5::jsonb, null, null, null)`,
        [A.tenantId, `t108-orphan:${fake}`, fake, d, JSON.stringify([{ account: "cash_shift", branch: A.b2, debit: 0, credit: 70_000 },
                                                                    { account: "liability_patient_balance", branch: A.b2, debit: 70_000, credit: 0 }])]);
      await c.query("commit");
    } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
    const all = await as(FIN, (db) => readRecon(db, { from: d, to: d }));
    expect(all.items.find((i) => i.ref.id === fake)).toMatchObject({ kind: "orphan", metric: "k1", branchId: A.b2, fact: null, ledger: -70_000 });
    const b1 = await as(FIN, (db) => readRecon(db, { from: d, to: d, branchId: A.b1 }));
    expect(b1.items.find((i) => i.ref.id === fake)).toBeUndefined();
    expect(b1.rows.every((x) => x.branchId === A.b1)).toBe(true);
  });

  it("period bound: a range that ends before today carries none of today's facts or postings", async () => {
    const d = await today();
    await sale(100_000);
    await drain();
    const prev = (await hx.admin.query(`select ($1::date - 1)::text d`, [d])).rows[0].d as string;
    const start = (await hx.admin.query(`select ($1::date - 30)::text d`, [d])).rows[0].d as string;
    const raw = (await as(FIN, (db) => db.query(`select recon_report($1::date, $2::date, null) r`, [start, prev]))).rows[0].r;
    expect(raw.facts).toEqual([]);
    expect(raw.postings).toEqual([]);
    const now = (await as(FIN, (db) => db.query(`select recon_report($1::date, $1::date, null) r`, [d]))).rows[0].r;
    expect(now.facts.length).toBeGreaterThan(0);
    expect(now.postings.length).toBeGreaterThan(0);
  });

  // owner-pool synthetic postings (the posting core, one transaction; the deferred balance check runs at COMMIT)
  async function ownPost(sql: string, args: unknown[]) {
    const c = await own.connect();
    try { await c.query("begin"); const r = await c.query(sql, args); await c.query("commit"); return r.rows[0]?.id as string | undefined; }
    catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
  }
  const lines = (l: { account: string; branch: string; debit?: number; credit?: number }[]) => JSON.stringify(l.map((x) => ({ debit: 0, credit: 0, ...x })));

  it("R3 F1 on PG: an S11 clearing pair selected by either branch is balanced (only that leg shown); a true tenant imbalance is a difference", async () => {
    const d = (await hx.admin.query(`select ($1::date - 40)::text d`, [await today()])).rows[0].d as string; // its own quiet day
    await ownPost(`select ledger_post($1, 'auto', $2, 'TestPosted', 'test_fact', gen_random_uuid(), null, $3::date, $4::jsonb, null, null, null) id`,
      [A.tenantId, `t108-s11:${key()}`, d, lines([{ account: "liability_packages", branch: A.b1, debit: 600_000 }, { account: "inter_branch_clearing", branch: A.b1, credit: 600_000 },
        { account: "inter_branch_clearing", branch: A.b2, debit: 600_000 }, { account: "other_income", branch: A.b2, credit: 600_000 }])]);
    for (const [br, leg] of [[A.b1, -600_000], [A.b2, 600_000]] as const) {
      const raw = (await as(FIN, (db) => db.query(`select recon_report($1::date, $1::date, $2) r`, [d, br]))).rows[0].r;
      expect(raw.clearing).toEqual([{ day: d, branch_id: br, amount: leg }]); // the other branch's leg is not exposed
      const r = await as(FIN, (db) => readRecon(db, { from: d, to: d, branchId: br }));
      expect(r.clearing).toEqual([{ day: d, net: 0, byBranch: [{ branchId: br, amount: leg }] }]);
      expect(r.verdict).toBe("bersih");
    }
    // a true imbalance (one clearing leg without its counter-leg, offset elsewhere) is a tenant-wide difference, whichever branch is shown
    const d2 = (await hx.admin.query(`select ($1::date - 41)::text d`, [await today()])).rows[0].d as string;
    await ownPost(`select ledger_post($1, 'auto', $2, 'TestPosted', 'test_fact', gen_random_uuid(), null, $3::date, $4::jsonb, null, null, null) id`,
      [A.tenantId, `t108-imb:${key()}`, d2, lines([{ account: "inter_branch_clearing", branch: A.b2, debit: 70_000 }, { account: "other_income", branch: A.b2, credit: 70_000 }])]);
    const r1 = await as(FIN, (db) => readRecon(db, { from: d2, to: d2, branchId: A.b1 }));
    expect(r1.clearing).toEqual([{ day: d2, net: 70_000, byBranch: [] }]);
    expect(r1.verdict).toBe("ada_selisih");
    const r2 = await as(FIN, (db) => readRecon(db, { from: d2, to: d2, branchId: A.b2 }));
    expect(r2.clearing).toEqual([{ day: d2, net: 70_000, byBranch: [{ branchId: A.b2, amount: 70_000 }] }]);
  });

  it("R3 F2 on PG: an original and its ledger_mirror reversal on the same day and branch are clean; on another day both stay listed", async () => {
    const t0 = await today();
    const mk = async (dOrig: string, dRev: string) => {
      const src = key();
      const orig = (await ownPost(`select ledger_post($1, 'auto', $2, 'TreatmentFinished', 'treatment_execution', $3, null, $4::date, $5::jsonb, null, null, null) id`,
        [A.tenantId, `t108-orig:${src}`, src, dOrig, lines([{ account: "liability_paid_not_delivered", branch: A.b1, debit: 400_000 }, { account: "revenue_treatment", branch: A.b1, credit: 400_000 }])]))!;
      const rev = (await ownPost(`select ledger_mirror($1, $2, $3, 'InvoiceVoided', 'invoice', gen_random_uuid(), null, $4::date, 'Invoice dibatalkan') id`,
        [A.tenantId, orig, `t108-rev:${src}`, dRev]))!;
      return { src, orig, rev };
    };
    const day = async (n: number) => (await hx.admin.query(`select ($1::date - $2::int)::text d`, [t0, n])).rows[0].d as string;
    const dA = await day(50);
    const same = await mk(dA, dA);
    const r = await as(FIN, (db) => readRecon(db, { from: dA, to: dA, branchId: A.b1 }));
    expect(r.items.filter((i) => i.ref.id === same.src)).toEqual([]);
    expect(r.verdict).toBe("bersih");
    const dB = await day(52); const dC = await day(51);
    const cross = await mk(dB, dC);
    const x = await as(FIN, (db) => readRecon(db, { from: dB, to: dC, branchId: A.b1 }));
    expect(x.items.filter((i) => i.ref.id === cross.src).map((i) => [i.kind, i.day, i.entryId, i.difference]))
      .toEqual([["orphan", dB, cross.orig, -400_000], ["orphan", dC, cross.rev, 400_000]]);
    expect(x.verdict).toBe("ada_selisih");
  });

  it("authority: owner, finance and the auditor read; a manager and FO are refused; another tenant sees none of A; a bad period or foreign branch is refused", async () => {
    const d = await today();
    for (const p of [OWN, FIN, AU]) expect((await as(p, (db) => readRecon(db, { from: d, to: d }))).from, p.role).toBe(d);
    for (const p of [MGR, FO]) expect(await err(as(p, (db) => readRecon(db, { from: d, to: d }))), p.role).toMatch(/ERR_FORBIDDEN/);
    await sale(100_000); // A has a fact and an open posting receipt now; B must see neither
    expect((await as(FIN, (db) => db.query(`select recon_report($1::date, $1::date, null) r`, [d]))).rows[0].r.pending.length).toBeGreaterThan(0);
    const b = await as(BFIN, (db) => db.query(`select recon_report($1::date, $1::date, null) r`, [d]));
    expect(b.rows[0].r.facts).toEqual([]);
    expect(b.rows[0].r.postings).toEqual([]);
    expect(b.rows[0].r.pending).toEqual([]);
    expect(b.rows[0].r.branches.map((x: { id: string }) => x.id).sort()).toEqual([B.b1, B.b2].sort());
    expect(await err(as(BFIN, (db) => readRecon(db, { from: d, to: d, branchId: A.b1 })))).toMatch(/ERR_NOT_FOUND/);
    expect(await err(as(FIN, (db) => readRecon(db, { from: d, to: "2020-01-01" })))).toMatch(/ERR_INVALID_INPUT/);
    expect(await err(as(FIN, (db) => readRecon(db, { from: "2024-01-01", to: "2025-06-01" })))).toMatch(/ERR_INVALID_INPUT/);
    // no patient or clinical field leaves the reader
    const raw = JSON.stringify((await as(FIN, (db) => db.query(`select recon_report($1::date, $1::date, null) r`, [d]))).rows[0].r);
    expect(raw).not.toMatch(/Pasien|full_name|patient/i);
  });
});
