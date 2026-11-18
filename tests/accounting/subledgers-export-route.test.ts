// T-104 Sol r1 P1-7 / P2-6: the CSV cell rule (formula and control-character prefixes neutralised, integer amounts kept) and the export
// route's input handling (impossible calendar dates, reversed / unknown inputs → 400 before the database; a refused role → 403). The
// request layer and the sub-ledger reader are replaced here; nothing reaches a database.
import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ calls: [] as unknown[], fail: null as null | string }));
vi.mock("../../src/modules/org/context/store", () => ({
  requestContext: async () => ({ kind: "ok", active: { context: { tenantId: "t", actingRole: "finance" } } }),
  appPool: async () => ({}),
}));
vi.mock("../../src/db/rls/context", () => ({ withTenantContext: async (_p: unknown, _c: unknown, fn: (db: unknown) => unknown) => fn({}) }));
vi.mock("../../src/modules/accounting/subledgers/subledgers", async (orig) => {
  const real = await orig<typeof import("../../src/modules/accounting/subledgers/subledgers")>();
  return {
    ...real,
    exportRows: async (_db: unknown, o: unknown) => {
      io.calls.push(o);
      if (io.fail) throw new real.SubledgerError(io.fail as never);
      return [["tanggal", "jumlah"], ["2026-01-02", "-5000"]];
    },
  };
});

const { csvCell, isCalendarDate, toCsv } = await import("../../src/modules/accounting/subledgers/subledgers");
const { GET } = await import("../../src/app/(app)/keuangan/kewajiban/ekspor/route");
const get = (q: string) => GET(new Request(`http://app.test/keuangan/kewajiban/ekspor?${q}`));

beforeEach(() => {
  io.calls = [];
  io.fail = null;
});

describe("CSV cells (P1-7)", () => {
  it("neutralises formula markers, leading control characters and whitespace before a marker; integers stay plain", () => {
    for (const bad of ["=1+1", "+1", "-A1", "@SUM(A1)", "\t=1+1", "\r=1+1", "\n=1", " =1", "  +1", "\u0000x", "\u001b=1", "\t-2"]) {
      expect(csvCell(bad).replace(/^"/, "").startsWith("'"), JSON.stringify(bad)).toBe(true);
    }
    expect(csvCell("-5000")).toBe("-5000");
    expect(csvCell("125000")).toBe("125000");
    expect(csvCell("Lina, Keuangan")).toBe('"Lina, Keuangan"');
    expect(csvCell('Kata "kutip"')).toBe('"Kata ""kutip"""');
    expect(csvCell("dua\nbaris")).toBe('"dua\nbaris"');
    expect(csvCell("Rina Keuangan")).toBe("Rina Keuangan");
    expect(toCsv([["a", "-1"], ["=x", ""]])).toBe("a,-1\r\n'=x,\r\n");
  });
});

describe("export route input (P2-6)", () => {
  it("impossible calendar dates and malformed inputs are 400 before the reader; a valid request streams the CSV", async () => {
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("2024-02-29")).toBe(true);
    expect(isCalendarDate("0000-01-01")).toBe(false);
    for (const q of ["jenis=vat&dari=2026-02-30&sampai=2026-03-01", "jenis=vat&dari=0000-01-01&sampai=0000-01-02", "jenis=vat&dari=2026-01-01&sampai=2026-02-31", "jenis=journal&dari=2026-01-01&sampai=2026-01-31",
      "jenis=vat&dari=2026-1-1&sampai=2026-01-31", "jenis=vat&dari=2026-01-01&sampai=2026-01-31&cabang=x", "jenis=commissions&dari=2026-01-01&sampai=2026-01-31&staf=1"]) {
      expect((await get(q)).status, q).toBe(400);
    }
    expect(io.calls).toEqual([]);
    const ok = await get("jenis=vat&dari=2026-01-01&sampai=2026-01-31");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toMatch(/text\/csv/);
    // the UTF-8 BOM (EF BB BF) first, then the rows (Response.text() would strip the BOM)
    expect(Buffer.from(await ok.arrayBuffer()).toString("hex")).toBe(Buffer.from("\uFEFFtanggal,jumlah\r\n2026-01-02,-5000\r\n", "utf8").toString("hex"));
  });

  it("the reader's refusals map: reversed / too long period 400, a refused role 403, an unknown branch 404", async () => {
    for (const [code, status] of [["ERR_INVALID_INPUT", 400], ["ERR_FORBIDDEN", 403], ["ERR_NOT_FOUND", 404]] as const) {
      io.fail = code;
      expect((await get("jenis=payments&dari=2026-02-01&sampai=2026-01-01")).status, code).toBe(status);
    }
  });
});
