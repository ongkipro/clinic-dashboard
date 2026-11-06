// T-014: VisitTrack and the list/detail/report templates.
// - Without RUN_UI (Vitest): server-rendered markup — VisitTrack renders all 10 segments
//   with word labels and accessible names, one state per list template, report cards.
// - With RUN_UI=1 (node, needs `next dev` serving /dev/templat): browser evidence at
//   390/820/1180/1440 and 200% text for every list state.
//   RUN_UI=1 BASE_URL=http://localhost:3912 PLAYWRIGHT_CORE=... node tests/ui/templates.spec.ts out-dir
import { mkdirSync, writeFileSync } from "node:fs";

if (process.env.RUN_UI) {
  await browserRun();
} else {
  await unitTests();
}

async function unitTests() {
  const { describe, expect, it } = await import("vitest");
  const { createElement: h } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { VISIT_STEPS, VisitTrack, stepLabel } = await import("../../src/components/visit-track/visit-track");
  const { DetailPage, ListPage, ReportTable } = await import("../../src/components/templates/templates");
  const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

  describe("VisitTrack (10 Component Contract)", () => {
    it("renders all 10 segments in order with word labels and accessible names", () => {
      const out = html(h(VisitTrack, { states: { Daftar: "selesai", Dokter: "berjalan", Bayar: "terblokir", Pendampingan: "tidak_perlu" }, blocker: "Menunggu pembayaran" }));
      // The accessible name is text inside each item (robust across screen readers).
      const names = [...out.matchAll(/<li[^>]*><span class="sr-only">([^<]+)<\/span>/g)].map((m) => m[1]);
      expect(names).toHaveLength(10);
      expect(names[0]).toBe("Langkah 1 dari 10: Daftar — selesai");
      expect(names[1]).toBe("Langkah 2 dari 10: Pendampingan — tidak perlu");
      expect(names[2]).toBe("Langkah 3 dari 10: Dokter — menunggu");
      expect(names[5]).toBe("Langkah 6 dari 10: Bayar — terblokir");
      expect(names[9]).toBe("Langkah 10 dari 10: Selesai — belum dimulai");
      // Every segment carries its visible word label (two rows of five on compact).
      const labels = [...out.matchAll(/data-slot="segment-label"[^>]*>([^<]+)</g)].map((m) => m[1].replace(/\u00ad/g, ""));
      expect(labels).toEqual([...VISIT_STEPS]);
      expect(out).toContain('aria-label="Jalur Kunjungan"');
    });

    it("names the blocker under the capsule; exactly one current step even with several in progress", () => {
      const out = html(h(VisitTrack, { states: { Dokter: "berjalan", Bayar: "terblokir", Persiapan: "berjalan" }, blocker: "Menunggu pembayaran tambahan Rp350.000" }));
      expect(out).toContain("Menunggu pembayaran tambahan Rp350.000");
      expect(out.match(/aria-current="step"/g)).toHaveLength(1);
      expect(out).toMatch(/<li data-state="terblokir" aria-current="step"/);
    });

    it("a blocked step without blocker text is a programming error", () => {
      expect(() => html(h(VisitTrack, { states: { Bayar: "terblokir" } } as never))).toThrow(/blocker/);
    });

    it("summary (inside a list-row link): one sentence for assistive technology, segments hidden", () => {
      const out = html(h(VisitTrack, { summary: true, states: { Daftar: "selesai", Dokter: "berjalan" } }));
      // The step in progress is named (before the first step not started).
      expect(out).toMatch(/^<div[^>]*><span class="sr-only">Langkah 3 dari 10: Dokter — menunggu<\/span>/);
      expect(out).toContain('<ol aria-hidden="true"');
      expect(html(h(VisitTrack, { summary: true, states: Object.fromEntries(VISIT_STEPS.map((s) => [s, "selesai"])) }))).toContain("Kunjungan selesai");
    });

    it("each state has its own symbol (colour is never the only signal)", () => {
      const symbol = (state: "selesai" | "terblokir" | "tidak_perlu" | "berjalan" | "belum") =>
        html(h(VisitTrack, state === "terblokir" ? { states: { Daftar: state }, blocker: "x" } : { states: { Daftar: state } })).split("</li>")[0];
      for (const st of ["selesai", "terblokir", "tidak_perlu", "berjalan"] as const) expect(symbol(st)).toContain(`data-symbol="${st}"`);
      expect(symbol("belum")).not.toContain("data-symbol");
    });

    it("stepLabel is stable for every step and state", () => {
      expect(stepLabel("Dokter", "berjalan")).toBe("Langkah 3 dari 10: Dokter — menunggu");
      expect(stepLabel("Serahkan", "selesai")).toBe("Langkah 9 dari 10: Serahkan — selesai");
    });
  });

  describe("ListPage states (NAV-4, 10 State Copy Patterns)", () => {
    const base = { title: "Pasien" };
    const cases = [
      [{ kind: "loading" }, 'aria-busy="true"', "status"],
      [{ kind: "empty", message: "Belum ada pasien.", action: "Daftarkan Pasien", actionHref: "/pasien/baru" }, "Belum ada pasien.", "status"],
      [{ kind: "filtered-empty", message: "Tidak ada janji untuk filter ini.", clearHref: "/jadwal" }, "Hapus Filter", "status"],
      [{ kind: "error", message: "Koneksi terputus.", retryHref: "/pasien" }, "Coba Lagi", "alert"],
      [{ kind: "blocked", reason: "Belum dibayar", unblock: "Kasir dapat menerima pembayaran" }, "Belum dibayar.", "status"],
      [{ kind: "permission", object: "daftar pasien" }, "Anda tidak memiliki akses ke daftar pasien.", "status"],
    ] as const;
    for (const [state, text, role] of cases) {
      it(`${state.kind}: shows its pattern and no rows`, () => {
        const out = html(h(ListPage, { ...base, state, children: h("p", null, "BARIS-RAHASIA") }));
        expect(out).toContain(text);
        expect(out).toContain(`role="${role}"`);
        expect(out).not.toContain("BARIS-RAHASIA");
      });
    }
    it("rows: renders the rows and no state panel; bulk actions only while rows are selected", () => {
      const props = { ...base, state: { kind: "rows" } as const, bulkActions: [{ label: "Kirim Pengingat", href: "/x" }], children: h("p", null, "BARIS") };
      const out = html(h(ListPage, props));
      expect(out).toContain("BARIS");
      expect(out).not.toContain("Kirim Pengingat");
      expect(out).not.toMatch(/role="(status|alert)"/);
      expect(html(h(ListPage, { ...props, selectedCount: 2 }))).toContain("2 dipilih");
    });

    it("permission: only the title and the message — no action, search, filters or export", () => {
      const out = html(
        h(ListPage, {
          ...base, state: { kind: "permission", object: "daftar pasien" }, primaryAction: { label: "Daftarkan", href: "/x" },
          search: { name: "q", label: "Cari", action: "/x" }, filters: [{ label: "Semua", href: "/x" }], exportHref: "/e",
          columns: [{ id: "a", label: "A", visible: true }],
        }),
      );
      for (const t of ["Daftarkan", "Cari", "Semua", "Ekspor", "Kolom"]) expect(out).not.toContain(t);
      expect(out).toContain("Anda tidak memiliki akses ke daftar pasien.");
    });

    it("column chooser is a GET form with an apply button; search keeps the active view", () => {
      const out = html(h(ListPage, { ...base, state: { kind: "rows" }, columns: [{ id: "bc", label: "BC", visible: false }], search: { name: "q", label: "Cari", action: "/p", keep: { keadaan: "menunggu" } } }));
      const form = out.slice(out.indexOf("<details"), out.indexOf("</details>"));
      expect(form).toContain('name="kolom" value="bc"');
      expect(form).toContain('type="submit"');
      expect(form).toContain("Terapkan");
      expect(out).toContain('<input type="hidden" name="keadaan" value="menunggu"/>');
    });
    it("export appears only when the page passes it (role-gated)", () => {
      expect(html(h(ListPage, { ...base, state: { kind: "rows" } }))).not.toContain("Ekspor");
      expect(html(h(ListPage, { ...base, state: { kind: "rows" }, exportHref: "/ekspor" }))).toContain("Ekspor");
    });
    it("one <main> by default, a <section> when nested", () => {
      expect(html(h(ListPage, { ...base, state: { kind: "rows" } }))).toMatch(/^<main/);
      expect(html(h(ListPage, { ...base, as: "section", state: { kind: "rows" } }))).toMatch(/^<section/);
    });
  });

  describe("DetailPage (NAV-5) and ReportTable (NAV-7)", () => {
    it("detail: header with status, sections, timeline, related records, one primary action, audit link", () => {
      const out = html(
        h(DetailPage, {
          title: "Rina", status: { tone: "warning", label: "Belum dibayar" }, primaryAction: { label: "Tagih", href: "/kasir" },
          sections: [{ id: "a", label: "Kunjungan", content: "x" }, { id: "b", label: "Paket", content: "y" }],
          timeline: [{ at: "2026-11-02T03:30:00Z", label: "Pasien datang" }],
          related: [{ label: "Tagihan", href: "/t" }], auditHref: "/audit",
        }),
      );
      for (const t of ["Rina", "Belum dibayar", "Kunjungan", "Paket", "Riwayat", "Pasien datang", "Data terkait", "Lihat jejak audit"]) expect(out).toContain(t);
      expect(out.match(/>Tagih</g)).toHaveLength(1);
      expect(out).toMatch(/datetime="2026-11-02T03:30:00Z"/i); // React keeps the dateTime casing in static markup
    });
    it("detail without an audit link when the role may not see it; empty timeline says so", () => {
      const out = html(h(DetailPage, { title: "X", sections: [{ id: "a", label: "A", content: "" }], timeline: [] }));
      expect(out).not.toContain("jejak audit");
      expect(out).toContain("Belum ada riwayat.");
    });
    it("report: KPI header first, a table for regular width and one card per row for compact", () => {
      const out = html(
        h(ReportTable, {
          caption: "Uang masuk per cabang",
          kpis: [{ label: "Uang Masuk", value: "Rp48.250.000", delta: { direction: "naik", text: "12% dibanding minggu lalu" }, basis: "1–7 Nov 2026" }],
          columns: [{ id: "c", label: "Cabang" }, { id: "u", label: "Uang masuk", numeric: true }],
          rows: [{ c: "Kemang", u: "Rp30.100.000" }, { c: "Senopati", u: "Rp18.150.000" }],
        }),
      );
      expect(out.indexOf("Uang Masuk")).toBeLessThan(out.indexOf("<table"));
      expect(out).toContain("Naik </span>12% dibanding minggu lalu"); // direction in words, not only ▲
      expect(out.match(/<th scope="row"/g)).toHaveLength(2);
      expect(out.match(/<li class="grid gap-2 rounded/g)).toHaveLength(2);
      expect(out).toMatch(/role="region" aria-label="Uang masuk per cabang" tabindex="0"|tabindex="0" role="region"/i);
    });
    it("report without rows shows its empty state; invalid timeline dates do not crash", () => {
      expect(html(h(ReportTable, { caption: "X", columns: [{ id: "a", label: "A" }], rows: [] }))).toContain("Tidak ada data untuk periode ini.");
      expect(() => html(h(DetailPage, { title: "X", sections: [], timeline: [{ at: "bukan-tanggal", label: "?" }] }))).not.toThrow();
    });
  });
}

async function browserRun() {
  const { chromium } = await import(process.env.PLAYWRIGHT_CORE ? `${process.env.PLAYWRIGHT_CORE}/index.mjs` : "playwright-core");
  const BASE = process.env.BASE_URL ?? "http://localhost:3912";
  const OUT = process.argv[2] ?? "/tmp/t014ui";
  mkdirSync(OUT, { recursive: true });
  const report: Record<string, unknown> = { layout: {}, states: {}, console: [] };
  const browser = await chromium.launch();
  try {
    const measure = (page: Awaited<ReturnType<typeof browser.newPage>>) =>
      page.evaluate(() => {
        const vis = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"; };
        const ctl = [...document.querySelectorAll("main a, main button, main input, main summary")].filter(vis);
        const track = document.querySelector("[data-slot=visit-track]")!;
        return {
          overflowX: document.documentElement.scrollWidth - innerWidth,
          // A checkbox's touch target is its wrapping label (the whole row).
          minTarget: Math.min(...ctl.map((e) => Math.round((e.closest("label") ?? e).getBoundingClientRect().height))),
          unnamed: ctl.filter((e) => !(e.getAttribute("aria-label") || e.textContent?.trim() || (e as HTMLInputElement).labels?.length)).length,
          segments: track.querySelectorAll("li").length,
          segmentLabelsVisible: [...track.querySelectorAll("[data-slot=segment-label]")].filter(vis).length,
          // Word labels never truncate (11 px minimum, two rows on compact).
          labelsClipped: [...track.querySelectorAll("[data-slot=segment-label]")].filter((e) => e.scrollWidth > e.clientWidth + 1).length,
          // A label taller than one line must be one of the two words with a soft hyphen.
          labelsBroken: [...track.querySelectorAll("[data-slot=segment-label]")].filter((e) => {
            const range = document.createRange();
            range.selectNodeContents(e);
            const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
            return lines > 1 && !e.textContent!.includes("\u00ad");
          }).length,
          minLabelPx: Math.min(...[...track.querySelectorAll("[data-slot=segment-label]")].map((e) => parseFloat(getComputedStyle(e).fontSize))),
          table: vis(document.querySelector("table")!),
          cards: [...document.querySelectorAll('ul[aria-label="Uang masuk per cabang"] > li')].filter(vis).length,
          mains: document.querySelectorAll("main").length,
          // No two text boxes of a report card overlap (label vs value at large text).
          cardOverlaps: [...document.querySelectorAll('ul[aria-label="Uang masuk per cabang"] dl > div')].filter(vis).filter((row) => {
            const [a, b] = [...row.children].map((e) => e.getBoundingClientRect());
            return a && b && a.right > b.left + 0.5 && a.bottom > b.top + 0.5 && b.bottom > a.top + 0.5;
          }).length,
        };
      });
    for (const w of [390, 820, 1180, 1440]) {
      for (const zoom of [1, 2]) {
        const page = await browser.newPage({ viewport: { width: w, height: 900 } });
        page.on("console", (m: { type(): string; text(): string }) => m.type() === "error" && !m.text().includes("caret-color") && (report.console as string[]).push(m.text().slice(0, 200)));
        await page.goto(`${BASE}/dev/templat`);
        await page.getByRole("heading", { name: "Jalur Kunjungan" }).waitFor();
        if (zoom === 2) await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
        (report.layout as Record<string, unknown>)[`${w}${zoom === 2 ? "@200%" : ""}`] = await measure(page);
        if (zoom === 1 || w === 390) await page.screenshot({ path: `${OUT}/templat-${w}${zoom === 2 ? "-200" : ""}.png`, fullPage: true });
        await page.close();
      }
    }
    // Column chooser opened: its controls are full-size targets too.
    {
      const page = await browser.newPage({ viewport: { width: 820, height: 900 } });
      await page.goto(`${BASE}/dev/templat`);
      await page.getByText("Kolom", { exact: true }).click();
      report.columnChooser = await page.evaluate(() => [...document.querySelectorAll("details[open] label, details[open] button")].map((e) => Math.round(e.getBoundingClientRect().height)));
      await page.screenshot({ path: `${OUT}/kolom-820.png` });
      await page.close();
    }
    for (const state of ["loading", "empty", "filtered-empty", "error", "blocked", "permission"]) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.goto(`${BASE}/dev/templat?keadaan=${state}`);
      await page.getByRole("heading", { name: "Hari Ini" }).waitFor();
      const list = page.locator("section").filter({ has: page.getByRole("heading", { name: "Hari Ini" }) });
      (report.states as Record<string, unknown>)[state] = {
        text: (await list.innerText()).replace(/\s+/g, " ").slice(0, 400),
        rows: await page.getByRole("list", { name: "Kunjungan hari ini" }).count(),
        overflowX: await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      };
      await page.screenshot({ path: `${OUT}/state-${state}-390.png` });
      await page.close();
    }
  } catch (e) {
    report.error = String(e).split("\n").slice(0, 3).join(" ");
    process.exitCode = 1; // HYG-010 C-01: a failed flow fails the runner (the report is kept)
  } finally {
    await browser.close();
  }
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
