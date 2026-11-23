// T-117 (PR-80, R3) slice 1 — owner daily digest, no database and no provider. Proves Scenario PR-80 (opted in → at the SET-37 time the
// digest shows K1, K2 and exception counts, never a patient name even when the upstream reader returns sentinels); opted out (SET-37
// default) → nothing queued; one idempotency key per (tenant, business day, channel); unavailable is "Belum tersedia", never Rp0; the
// runtime guard refuses a digest that would carry an MRN, phone, NIK, e-mail or URL. Expected text is written out by hand.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createHarness, type Harness, testPool } from "../rls/harness";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { runDigest, runOne } from "../../src/modules/reporting/digest/run";
import { emailDelivery, mockDigestDeliveryPort, mockDigestStore, MockDigestUnavailableError, type DigestDeliveryPort, type MockDigestStore } from "../../src/modules/reporting/digest/delivery";
import { changeSetting } from "../../src/modules/settings/settings";
import { kpi } from "../../src/modules/reporting/dashboards/dashboards";
import { loadAttention } from "../../src/app/(app)/ringkasan/owner/attention";
import { SETTINGS } from "../../src/modules/settings/registry";
import {
  bodyProblem, renderWithSpans, CHANNELS, GATED_CHANNELS, composeDigest, renderLines, dayClose, digestKey, eligible, EXCEPTIONS, guard, localClock, optIn, planDigest, primaryZone, projectFacts, RECIPIENT_ROLES,
  runKey, total,
} from "../../src/modules/reporting/digest/digest";
import { execFileSync } from "node:child_process";

const T = "0193a000-0000-7000-8000-0000000000aa";
const DAY = "2026-10-15";
const SENTINEL = { name: "Siti Sentinel Rahasia", mrn: "RM-000123", phone: "081299990000", nik: "3171000000000001", dx: "Diagnosis L70.0 Sentinel", note: "Catatan klinis sentinel", body: "Isi pesan WhatsApp sentinel" };
// What an over-eager reader might return: only clinic, branches[].name/k1/k2 and exceptions.<key> may be read.
const raw = (over: Record<string, unknown> = {}) => ({
  clinic: "Klinik Sintetis",
  branches: [
    { name: "Cabang A", k1_rupiah: 2_272_000, k2_rupiah: 2_605_000, top_patient: SENTINEL.name, mrn: SENTINEL.mrn },
    { name: "Cabang B", k1_rupiah: 0, k2_rupiah: 600_000, phone: SENTINEL.phone },
  ],
  exceptions: { approvals: 2, unpaid_visits: 1, low_stock: 0, leads_overdue: 3, satusehat_errors: 0, compliance_expired: 0, patients: [SENTINEL.name], note: SENTINEL.note },
  patients: [{ name: SENTINEL.name, nik: SENTINEL.nik, diagnosis: SENTINEL.dx }],
  last_message: SENTINEL.body,
  ...over,
});

describe("SET-37 opt-in (existing setting, no new one)", () => {
  it("matches the registry row; the default is Nonaktif", () => {
    const row = SETTINGS.find((s) => s.key === "SET-37")!;
    expect(row.kind === "value" && row.default).toEqual({ ringkasan: null, penerima: ["owner"] });
    expect(row.changers).toEqual(["owner"]);
    expect(optIn(row.kind === "value" ? row.default : null)).toEqual({ kind: "out" });
    // the recipient options are the registry's enum
    const spec = JSON.stringify(row.kind === "value" ? row.spec : {});
    for (const r of RECIPIENT_ROLES) expect(spec).toContain(`"v":"${r}"`);
  });
  it("validates time bounds and recipients", () => {
    expect(optIn({ ringkasan: "20:00", penerima: ["owner", "finance"] })).toEqual({ kind: "in", at: "20:00", recipients: ["owner", "finance"] });
    for (const bad of [{ ringkasan: "16:59", penerima: ["owner"] }, { ringkasan: "23:01", penerima: ["owner"] }, { ringkasan: "8pm", penerima: ["owner"] },
      { ringkasan: "20:00", penerima: [] }, { ringkasan: "20:00", penerima: ["owner", "owner"] }, { ringkasan: "20:00", penerima: ["doctor"] }, null, "x"]) {
      expect(optIn(bad), JSON.stringify(bad)).toEqual({ kind: "invalid" });
    }
  });
});

describe("plan: opted out queues nothing; one key per (tenant, day, channel)", () => {
  const on = { ringkasan: "20:00", penerima: ["owner"] };
  it("opted out → nothing queued, at any time", () => {
    expect(planDigest({ tenantId: T, setting: { ringkasan: null, penerima: ["owner"] }, localNow: `${DAY}T23:59`, channels: CHANNELS })).toEqual({ kind: "skip", reason: "opted_out" });
    expect(planDigest({ tenantId: T, setting: { ringkasan: "25:00", penerima: ["owner"] }, localNow: `${DAY}T23:59`, channels: CHANNELS })).toEqual({ kind: "skip", reason: "invalid_setting" });
  });
  it("before the SET-37 time → not due; at or after → one email item; the gated WhatsApp channel is never queued", () => {
    expect(planDigest({ tenantId: T, setting: on, localNow: `${DAY}T19:59`, channels: CHANNELS })).toEqual({ kind: "skip", reason: "not_due" });
    const p = planDigest({ tenantId: T, setting: on, localNow: `${DAY}T20:00`, channels: ["whatsapp", "email", "email"] });
    expect(p).toEqual({ kind: "queue", items: [
      { key: `digest:${T}:${DAY}:email`, tenantId: T, businessDate: DAY, channel: "email", recipients: ["owner"] },
    ] });
    expect(planDigest({ tenantId: T, setting: on, localNow: `${DAY}T20:00`, channels: GATED_CHANNELS })).toEqual({ kind: "queue", items: [] });
    // a later scheduler pass the same day produces the same keys (the queue's unique key absorbs it); the next day differs
    const again = planDigest({ tenantId: T, setting: on, localNow: `${DAY}T22:30`, channels: CHANNELS });
    expect(again.kind === "queue" && again.items.map((x) => x.key)).toEqual([`digest:${T}:${DAY}:email`]);
    expect(digestKey(T, "2026-10-16", "whatsapp")).not.toBe(digestKey(T, DAY, "whatsapp"));
    expect(digestKey(T.toUpperCase(), DAY, "email")).toBe(digestKey(T, DAY, "email"));
    expect(digestKey(T, DAY, "whatsapp")).toMatch(/^[A-Za-z0-9_.:-]{8,128}$/);
    expect(() => digestKey("tenant-1", DAY, "email")).toThrow(RangeError);
    expect(() => digestKey(T, "15-10-2026", "email")).toThrow(RangeError);
  });
  it("queue items carry ids only (outbox rule)", () => {
    const p = planDigest({ tenantId: T, setting: on, localNow: `${DAY}T21:00`, channels: ["email"] });
    expect(p.kind === "queue" && Object.keys(p.items[0]).sort()).toEqual(["businessDate", "channel", "key", "recipients", "tenantId"]);
  });
});

describe("Scenario PR-80: the digest shows K1, K2 and exception counts without patient names", () => {
  const wa = composeDigest({ channel: "whatsapp", businessDate: DAY }, raw());
  const em = composeDigest({ channel: "email", businessDate: DAY }, raw());
  it("text and template parameters", () => {
    if (wa.kind !== "ok" || em.kind !== "ok") throw new Error("refused");
    expect(wa.text).toBe([
      "Ringkasan harian Klinik Sintetis — Kamis, 15 Oktober 2026",
      "",
      "Uang masuk (K1): Rp2.272.000",
      "Layanan selesai (K2): Rp3.205.000",
      "",
      "Per cabang:",
      "• Cabang A: uang masuk Rp2.272.000, layanan selesai Rp2.605.000",
      "• Cabang B: uang masuk Rp0, layanan selesai Rp600.000",
      "",
      "Perlu ditangani: 6",
      "• Persetujuan menunggu: 2",
      "• Kunjungan belum bayar sebelum hari ini: 1",
      "• Lead melewati batas respons: 3",
      "",
      "Angka gabungan tanpa data pasien. Rincian ada di Ringkasan Owner.",
    ].join("\n"));
    expect(wa.whatsapp).toEqual({ params: ["Klinik Sintetis", "Kamis, 15 Oktober 2026", "Rp2.272.000", "Rp3.205.000", "6"] });
    expect(em.email?.subject).toBe("Ringkasan harian Klinik Sintetis — Kamis, 15 Oktober 2026");
    expect(renderLines(em.email!.lines)).toBe(em.text); // the typed body renders to exactly the text
    expect(em.text).toBe(wa.text);
  });
  it("no sentinel from the upstream input reaches any output", () => {
    const out = JSON.stringify([wa, em, projectFacts(raw(), DAY)]);
    for (const s of Object.values(SENTINEL)) expect(out, s).not.toContain(s);
  });
  it("a single branch has no per-branch block", () => {
    const one = composeDigest({ channel: "email", businessDate: DAY }, raw({ branches: [{ name: "Cabang A", k1_rupiah: 100, k2_rupiah: 200 }] }));
    expect(one.kind === "ok" && one.text).not.toContain("Per cabang");
  });
});

describe("unavailable is not Rp0", () => {
  it("a missing K1 at one branch: the branch and the total read Belum tersedia; a real zero stays Rp0", () => {
    const r = raw({ branches: [{ name: "Cabang A", k1_rupiah: null, k2_rupiah: 500_000 }, { name: "Cabang B", k1_rupiah: 0, k2_rupiah: 0 }] });
    const c = composeDigest({ channel: "whatsapp", businessDate: DAY }, r);
    if (c.kind !== "ok") throw new Error(c.reason);
    expect(c.text).toContain("Uang masuk (K1): Belum tersedia");
    expect(c.text).toContain("Layanan selesai (K2): Rp500.000");
    expect(c.text).toContain("• Cabang A: uang masuk Belum tersedia, layanan selesai Rp500.000");
    expect(c.text).toContain("• Cabang B: uang masuk Rp0, layanan selesai Rp0");
    expect(c.whatsapp!.params[2]).toBe("Belum tersedia");
    for (const bad of [1.5, "100", Number.NaN, undefined]) expect(total([{ kind: "money", rupiah: 1 }, ...(projectFacts(raw({ branches: [{ name: "X", k1_rupiah: bad, k2_rupiah: 0 }] }), DAY)!.branches.map((b) => b.k1))])).toEqual({ kind: "unavailable" });
    expect(total([])).toEqual({ kind: "unavailable" });
  });
  it("an unknown exception count makes the total unavailable and is listed", () => {
    const c = composeDigest({ channel: "email", businessDate: DAY }, raw({ exceptions: { approvals: 1 } }));
    if (c.kind !== "ok") throw new Error(c.reason);
    expect(c.text).toContain("Perlu ditangani: Belum tersedia");
    expect(c.text).toContain("• Stok klinis menipis: Belum tersedia");
    expect(c.text).toContain("• Persetujuan menunggu: 1");
    // the six Ringkasan Owner items (T-109), compliance counted as expired only (owner decision 2026-11-23)
    expect(EXCEPTIONS.map((e) => e.key)).toEqual(["approvals", "unpaid_visits", "low_stock", "leads_overdue", "satusehat_errors", "compliance_expired"]);
  });
});

describe("runtime guard", () => {
  it("refuses identifiers that slip in through tenant-controlled names", () => {
    const cases: [string, string][] = [
      [`Cabang ${SENTINEL.mrn}`, "mrn"], ["Cabang 0812-9999-0000", "phone"], ["Cabang +62 812 9999 0000", "phone"],
      [`Cabang ${SENTINEL.nik}`, "nik"], ["Cabang owner@klinik.test", "email"], ["Cabang https://x.test", "url"],
    ];
    for (const [name, found] of cases) {
      // two branches, so branch names reach the per-branch block
      const c = composeDigest({ channel: "whatsapp", businessDate: DAY }, raw({ branches: [{ name: "Cabang A", k1_rupiah: 1, k2_rupiah: 1 }, { name, k1_rupiah: 1, k2_rupiah: 1 }] }));
      expect(c, name).toEqual({ kind: "refused", reason: "identifier_found", found });
      // the clinic name reaches the subject and the template parameters
      expect(composeDigest({ channel: "email", businessDate: DAY }, raw({ clinic: name.replace("Cabang", "Klinik") })), name)
        .toEqual({ kind: "refused", reason: "identifier_found", found });
    }
    // a single branch's name never reaches the output, so it cannot leak
    expect(composeDigest({ channel: "email", businessDate: DAY }, raw({ branches: [{ name: `Cabang ${SENTINEL.mrn}`, k1_rupiah: 1, k2_rupiah: 1 }] })).kind).toBe("ok");
    expect(guard(["Uang masuk (K1): Rp2.272.000", "Kamis, 15 Oktober 2026", "Perlu ditangani: 6"])).toEqual({ ok: true });
  });
  it("refuses malformed facts instead of sending a partial digest", () => {
    for (const r of [null, "x", { branches: [] }, raw({ clinic: "" }), raw({ branches: "x" }), raw({ branches: [{ k1_rupiah: 1 }] })]) {
      expect(composeDigest({ channel: "email", businessDate: DAY }, r)).toEqual({ kind: "refused", reason: "invalid_facts" });
    }
    expect(composeDigest({ channel: "email", businessDate: "15/10/2026" }, raw())).toEqual({ kind: "refused", reason: "invalid_facts" });
  });
});

// ── slice A (pure, channel-neutral; Panel 2 D2 / D3): injected clock, primary-branch local day, live tenants only, one run key per day ──
// Instants are hand-worked: WIB = UTC+7, WITA = UTC+8, WIT = UTC+9 (no DST in Indonesia).
// ── r2, R3 finding 5: a valid figure is never refused as an identifier; a sum outside the exact integer range is never a rounded number ──
describe("money stays exact and the privacy scan never reads a figure as an identifier (R3 finding 5)", () => {
  it("K1 Rp1.081.234.567 (its digits look like a phone number) composes and delivers; a phone number pasted in a label is still refused", () => {
    const c = composeDigest({ channel: "email", businessDate: DAY }, raw({ branches: [{ name: "Cabang A", k1_rupiah: 1_081_234_567, k2_rupiah: 81_299_990 }, { name: "Cabang B", k1_rupiah: 0, k2_rupiah: 0 }] }));
    if (c.kind !== "ok") throw new Error(JSON.stringify(c));
    expect(c.text).toContain("Uang masuk (K1): Rp1.081.234.567");
    expect(c.text).toContain("• Cabang A: uang masuk Rp1.081.234.567, layanan selesai Rp81.299.990");
    // the RENDERED text would trip the phone pattern; the figure is a number in the typed body, so only the free text around it is scanned
    expect(guard([c.text]).ok).toBe(false);
    expect(bodyProblem(c.email!.subject, c.email!.lines)).toBeNull();
    expect(c.email!.lines[2]).toEqual(["Uang masuk (K1): ", { money: { kind: "money", rupiah: 1_081_234_567 } }]);
    // still refused: identifiers in labels, and ANY free text — no masking, currency-shaped text is not a figure (R3-r2 finding 3)
    for (const bad of ["Klinik 081299990000", "Klinik 0812-9999-0000", `Klinik ${SENTINEL.nik}`, "Klinik Rp62.812.999.000"])
      expect(composeDigest({ channel: "email", businessDate: DAY }, raw({ clinic: bad })), bad).toMatchObject({ kind: "refused", reason: "identifier_found" });
    for (const body of ["Hubungi Rp62.812.999.000", "Pasien: 081.299.990.000", "Hubungi Rp5 081299990000", `NIK ${SENTINEL.nik}`, "Pasien: 0812 9999 0000"])
      expect(bodyProblem("Ringkasan", [[body]]), body).toBe("identifier_found");
    // a split identifier is scanned as it renders (R3-r3 finding 3): adjacent free-text parts are joined
    for (const split of [["Hubungi 0812", "99990000"], ["Hubungi ", "0812", "-9999-", "0000"], ["NIK 31710000", "00000001"], ["https:", "//x.test"]])
      expect(bodyProblem("Ringkasan", [split]), JSON.stringify(split)).toBe("identifier_found");
    // the rendered body is scanned whole; a match is exempt only WHOLLY inside one figure span (R3-r5 finding 1)
    const n = (v: number) => ({ count: { kind: "count" as const, value: v } });
    const m = (v: number) => ({ money: { kind: "money" as const, rupiah: v } });
    for (const bad of [["Hubungi ", n(123), "@example.test"], ["Hubungi 0812", n(999), "90000"], ["Kode 0812", n(9_999_000)], ["Kode ", n(0), "812999900001"],
      ["Kode ", m(62), " 812 9999 0000"], ["RM-", n(123), "456"], ["NIK 31710000", n(1), "0000001"], ["x ", n(5), "@a.co"], ["x@", n(1), ".co"]])
      expect(bodyProblem("Ringkasan", [bad]), JSON.stringify(bad)).toBe("identifier_found");
    // across a line break too (the body renders as one stream)
    expect(bodyProblem("Ringkasan", [["Kode 0812"], ["99990000 lain"]])).toBe("identifier_found");
    // an exempt match inside a figure does not end the scan: a later match of the SAME pattern in free text is still refused
    expect(bodyProblem("Ringkasan", [["K1: ", m(1_081_234_567), ", hubungi 081299990000"]])).toBe("identifier_found");
    expect(bodyProblem("Ringkasan", [["K1: ", m(1_081_234_567)], ["Hubungi 0812 9999 0000"]])).toBe("identifier_found");
    // a figure rendered with id-ID grouping is what is scanned: "RM-" + 123.456 renders "RM-123.456", which is not an MRN
    expect(bodyProblem("Ringkasan", [["RM-", n(123_456)]])).toBeNull();
    // wholly inside one figure: exempt (the composer's own figures)
    for (const ok of [["Uang masuk (K1): ", m(1_081_234_567)], ["K2: ", m(81_299_990)], ["• A: ", m(9_007_199_254_740_991), ", ", n(1_234)], ["x ", n(5), " ", n(6), ", y"]])
      expect(bodyProblem("Ringkasan", [ok]), JSON.stringify(ok)).toBeNull();
    // the spans are the figures' exact positions in the delivered text
    expect(renderWithSpans([["Uang masuk (K1): ", m(1_081_234_567)], ["• A: ", n(7), ", y"]]))
      .toEqual({ text: "Uang masuk (K1): Rp1.081.234.567\n• A: 7, y", spans: [[17, 32], [38, 39]] });
    // a "figure" that is not exactly a number shape is not a figure: invalid body, never rendered
    for (const forged of [{ money: { kind: "money", rupiah: "62812999000" } }, { money: { kind: "money", rupiah: 1.5 } }, { money: { kind: "money", rupiah: 5 }, note: "x" },
      { count: { kind: "count", value: -1 } }, { money: { kind: "money", rupiah: 5, text: "Rp62.812.999.000" } }, 62_812_999_000])
      expect(bodyProblem("Ringkasan", [["Uang masuk: ", forged]]), JSON.stringify(forged)).toBe("invalid_body");
  });
  it("two safe branch values whose sum is unsafe give 'Belum tersedia', never a rounded number; a safe sum stays exact", () => {
    const a = 4_503_599_627_370_497, b = 4_503_599_627_370_496;
    expect([Number.isSafeInteger(a), Number.isSafeInteger(b), Number.isSafeInteger(a + b)]).toEqual([true, true, false]);
    expect(total([{ kind: "money", rupiah: a }, { kind: "money", rupiah: b }])).toEqual({ kind: "unavailable" });
    expect(total([{ kind: "money", rupiah: -a }, { kind: "money", rupiah: -b }])).toEqual({ kind: "unavailable" });
    expect(total([{ kind: "money", rupiah: Number.MAX_SAFE_INTEGER - 1 }, { kind: "money", rupiah: 1 }])).toEqual({ kind: "money", rupiah: Number.MAX_SAFE_INTEGER });
    const c = composeDigest({ channel: "email", businessDate: DAY }, raw({ branches: [{ name: "Cabang A", k1_rupiah: a, k2_rupiah: 1 }, { name: "Cabang B", k1_rupiah: b, k2_rupiah: 2 }] }));
    if (c.kind !== "ok") throw new Error(JSON.stringify(c));
    expect(c.text).toContain("Uang masuk (K1): Belum tersedia");
    expect(c.text).toContain("Layanan selesai (K2): Rp3");
    expect(c.text).not.toMatch(/Rp9\.007\.199/);
  });
});

describe("slice A: day close at the SET-37 time in the tenant's primary-branch local day", () => {
  const on = { ringkasan: "21:00", penerima: ["owner", "finance"] };
  const wib = [{ id: "b1", timezone: "Asia/Jakarta", createdAt: "2025-01-01T00:00:00Z" }];
  const at = (iso: string) => new Date(iso);
  const close = (now: string, over: Partial<Parameters<typeof dayClose>[0]> = {}) =>
    dayClose({ tenantId: T, lifecycleState: "live", setting: on, branches: wib, now: at(now), ...over });

  it("WIB: 20:59 local is not due; 21:00 local is due for that local day (one run key, roles from SET-37)", () => {
    expect(close("2026-10-15T13:59:59Z")).toEqual({ kind: "skip", reason: "not_due" });
    expect(close("2026-10-15T14:00:00Z")).toEqual({ kind: "due", runKey: `digest-run:${T}:2026-10-15`, tenantId: T, businessDate: "2026-10-15", zone: "Asia/Jakarta", recipients: ["owner", "finance"] });
  });
  it("WITA / WIT primary branch: due at its own 21:00 (13:00Z / 12:00Z)", () => {
    const wita = [{ id: "b9", timezone: "Asia/Makassar", createdAt: "2025-01-01T00:00:00Z" }];
    const wit = [{ id: "b9", timezone: "Asia/Jayapura", createdAt: "2025-01-01T00:00:00Z" }];
    expect(close("2026-10-15T12:59:00Z", { branches: wita }).kind).toBe("skip");
    expect(close("2026-10-15T13:00:00Z", { branches: wita })).toMatchObject({ kind: "due", businessDate: "2026-10-15", zone: "Asia/Makassar" });
    expect(close("2026-10-15T11:59:00Z", { branches: wit }).kind).toBe("skip");
    expect(close("2026-10-15T12:00:00Z", { branches: wit })).toMatchObject({ kind: "due", businessDate: "2026-10-15", zone: "Asia/Jayapura" });
  });
  it("the business day is the local date across UTC midnight: 23:00 WIB is 16:00Z the day before UTC's next date", () => {
    const late = { ringkasan: "23:00", penerima: ["owner"] };
    // 2026-10-15T16:00Z = 2026-10-15 23:00 WIB → due for 2026-10-15; 17:30Z = 2026-10-16 00:30 WIB → the new local day, not yet due
    expect(close("2026-10-15T16:00:00Z", { setting: late })).toMatchObject({ kind: "due", businessDate: "2026-10-15" });
    expect(close("2026-10-15T17:30:00Z", { setting: late })).toEqual({ kind: "skip", reason: "not_due" });
    // and a UTC date ahead of the local one never shifts it: 2026-10-15T23:30Z = 2026-10-16 06:30 WIB, still not due for 10-16
    expect(close("2026-10-15T23:30:00Z", { setting: late })).toEqual({ kind: "skip", reason: "not_due" });
    expect(close("2026-10-16T16:00:00Z", { setting: late })).toMatchObject({ kind: "due", businessDate: "2026-10-16", runKey: `digest-run:${T}:2026-10-16` });
  });
  it("primary branch = the earliest-created (ties by id); a later branch in another zone never moves the day; no branch → Asia/Jakarta", () => {
    const two = [{ id: "b2", timezone: "Asia/Jayapura", createdAt: "2025-06-01T00:00:00Z" }, { id: "b1", timezone: "Asia/Jakarta", createdAt: "2025-01-01T00:00:00Z" }];
    expect(primaryZone(two)).toBe("Asia/Jakarta");
    // 12:30Z = 21:30 WIT (the later branch) but 19:30 WIB (primary): not due
    expect(close("2026-10-15T12:30:00Z", { branches: two }).kind).toBe("skip");
    expect(primaryZone([{ id: "b2", timezone: "Asia/Makassar", createdAt: "2025-01-01T00:00:00Z" }, { id: "b1", timezone: "Asia/Jayapura", createdAt: "2025-01-01T00:00:00Z" }])).toBe("Asia/Jayapura");
    expect(primaryZone([])).toBe("Asia/Jakarta");
    expect(close("2026-10-15T14:00:00Z", { branches: [] })).toMatchObject({ kind: "due", zone: "Asia/Jakarta" });
    expect(() => primaryZone([{ id: "b1", timezone: "Europe/London", createdAt: "2025-01-01T00:00:00Z" }])).toThrow(RangeError);
    expect(() => localClock(new Date("x"), "Asia/Jakarta")).toThrow(RangeError);
    // the local date across UTC midnight (the primitive the day close uses): 17:30Z is already the next day in WIB, WITA and WIT
    expect(localClock(new Date("2026-10-15T17:30:00Z"), "Asia/Jakarta")).toEqual({ date: "2026-10-16", time: "00:30" });
    expect(localClock(new Date("2026-10-15T16:00:00Z"), "Asia/Makassar")).toEqual({ date: "2026-10-16", time: "00:00" });
    expect(localClock(new Date("2026-10-15T14:59:00Z"), "Asia/Jayapura")).toEqual({ date: "2026-10-15", time: "23:59" });
  });
  it("the result does not depend on the process timezone (a child process under TZ=UTC / Pacific/Kiritimati / America/Los_Angeles)", () => {
    const src = `import { dayClose } from ${JSON.stringify(new URL("../../src/modules/reporting/digest/digest.ts", import.meta.url).pathname)};
      const r = dayClose({ tenantId: ${JSON.stringify(T)}, lifecycleState: "live", setting: { ringkasan: "23:00", penerima: ["owner"] },
        branches: [{ id: "b1", timezone: "Asia/Jakarta", createdAt: "2025-01-01T00:00:00Z" }], now: new Date("2026-10-15T16:00:00Z") });
      process.stdout.write(JSON.stringify([r.kind, r.businessDate, new Date("2026-10-15T16:00:00Z").getDate()]));`;
    const days = new Set<number>();
    for (const tz of ["UTC", "Pacific/Kiritimati", "America/Los_Angeles"]) {
      const out = JSON.parse(execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", src], { env: { ...process.env, TZ: tz }, encoding: "utf8" }));
      expect([out[0], out[1]], tz).toEqual(["due", "2026-10-15"]);
      days.add(out[2]);
    }
    expect(days.size).toBeGreaterThan(1); // the process zones really differ (a local Date method would have moved the day)
  });
  it("live tenants only (D3): provisioning / onboarding / suspended / exit / closed are skipped, whatever the setting says", () => {
    for (const s of ["provisioning", "onboarding", "suspended", "exit", "closed", undefined, "LIVE"]) {
      expect(close("2026-10-15T14:00:00Z", { lifecycleState: s }), String(s)).toEqual({ kind: "skip", reason: "tenant_not_live" });
    }
    expect(eligible("live")).toBe(true);
    expect(close("2026-10-15T14:00:00Z", { lifecycleState: "suspended", setting: "not even an object" })).toEqual({ kind: "skip", reason: "tenant_not_live" });
    expect(close("2026-10-15T14:00:00Z", { lifecycleState: "suspended", setting: { ringkasan: null, penerima: ["owner"] } })).toEqual({ kind: "skip", reason: "tenant_not_live" });
  });
  it("SET-37 bounds and recipients: null opts out; outside 17:00–23:00, malformed, or bad penerima is invalid (no run)", () => {
    expect(close("2026-10-15T16:59:00Z", { setting: { ringkasan: null, penerima: ["owner"] } })).toEqual({ kind: "skip", reason: "opted_out" });
    for (const ringkasan of ["16:59", "23:01", "7:00", "21:00:00", "24:00", 2100]) {
      expect(close("2026-10-15T16:59:00Z", { setting: { ringkasan, penerima: ["owner"] } }), String(ringkasan)).toEqual({ kind: "skip", reason: "invalid_setting" });
    }
    for (const penerima of [[], ["owner", "owner"], ["owner", "admin_pusat", "finance", "manager", "owner"], ["doctor"], "owner", undefined]) {
      expect(close("2026-10-15T16:59:00Z", { setting: { ringkasan: "21:00", penerima } }), JSON.stringify(penerima)).toEqual({ kind: "skip", reason: "invalid_setting" });
    }
    expect(close("2026-10-15T10:00:00Z", { setting: { ringkasan: "17:00", penerima: ["owner", "admin_pusat", "finance", "manager"] } })).toMatchObject({ kind: "due" });
    expect(close("2026-10-15T15:59:00Z", { setting: { ringkasan: "23:00", penerima: ["manager"] } })).toEqual({ kind: "skip", reason: "not_due" });
  });
  it("idempotency: one channel-neutral key per (tenant, local day) — repeated passes the same day agree; another day or tenant differs", () => {
    const k1 = close("2026-10-15T14:00:00Z");
    const k2 = close("2026-10-15T16:30:00Z"); // 23:30 WIB, same local day
    const k3 = close("2026-10-16T14:00:00Z");
    expect(k1.kind === "due" && k2.kind === "due" && k1.runKey === k2.runKey).toBe(true);
    expect(k3.kind === "due" && k1.kind === "due" && k3.runKey !== k1.runKey).toBe(true);
    const U = "0193a000-0000-7000-8000-0000000000bb";
    expect(runKey(U, "2026-10-15")).not.toBe(runKey(T, "2026-10-15"));
    expect(runKey(T.toUpperCase(), "2026-10-15")).toBe(runKey(T, "2026-10-15"));
    expect(runKey(T, "2026-10-15")).toMatch(/^[A-Za-z0-9_.:-]{8,128}$/);
    expect(runKey(T, "2026-10-15")).not.toBe(digestKey(T, "2026-10-15", "email")); // distinct from the per-channel key
    expect(() => runKey("tenant-1", "2026-10-15")).toThrow(RangeError);
    expect(() => runKey(T, "2026-02-30")).toThrow(RangeError);
  });
});

// ── slice C1 (P1, 82340dfa): the EMAIL mock DigestDeliveryPort (Panel 2 D1). No address, no provider; in-app undecided; production refuses the mock. ──
describe("slice C1: the email delivery seam and the in-memory mock port", () => {
  process.env.DEPLOY_ENV = "local"; // synthetic (MIG-2), as the WABA / inbox mock suites: unset means production, where the mock refuses
  const key = digestKey(T, DAY, "email");
  const em = () => composeDigest({ channel: "email", businessDate: DAY }, raw());
  it("emailDelivery hands the port a typed body and roles (never addresses); the sentinel patient data never reaches it", () => {
    const d = emailDelivery(key, em(), ["owner", "finance"]);
    if (!d.ok) throw new Error(d.reason);
    expect(d.digest).toMatchObject({ key, recipients: ["owner", "finance"], subject: expect.stringMatching(/^Ringkasan harian Klinik Sintetis — /) });
    expect(renderLines(d.digest.lines)).toContain("Uang masuk (K1): Rp2.272.000");
    const all = JSON.stringify(d.digest);
    for (const s of Object.values(SENTINEL)) expect(all).not.toContain(s);
    expect(all).not.toMatch(/@|\+62|\b08\d{8,}/);
  });
  it("refuses, never sends: a WhatsApp composition, a refused composition, no / unknown / duplicated roles, a bad key", () => {
    expect(emailDelivery(key, composeDigest({ channel: "whatsapp", businessDate: DAY }, raw()), ["owner"])).toEqual({ ok: false, reason: "not_email" });
    expect(emailDelivery(key, composeDigest({ channel: "email", businessDate: DAY }, { bogus: true }), ["owner"])).toEqual({ ok: false, reason: "composed_refused" });
    expect(emailDelivery(key, em(), [])).toEqual({ ok: false, reason: "no_recipients" });
    for (const bad of [["doctor"], ["owner", "owner"], ["owner", "kasir"], ["patient"]]) expect(emailDelivery(key, em(), bad), JSON.stringify(bad)).toEqual({ ok: false, reason: "invalid_recipient" });
    expect(() => emailDelivery("short", em(), ["owner"])).toThrow(RangeError);
  });
  it("the mock is an in-memory test double: it accepts once per key within its store (a provider honouring the idempotency key); production refuses it", async () => {
    const d = emailDelivery(key, em(), ["owner"]);
    if (!d.ok) throw new Error(d.reason);
    const store = mockDigestStore();
    const first = await mockDigestDeliveryPort(store).sendEmail(d.digest);
    expect(first).toMatchObject({ kind: "sent", key, recipients: ["owner"], providerRef: expect.stringMatching(/^mock-/) });
    expect(await mockDigestDeliveryPort(store).sendEmail(d.digest)).toEqual(first); // same key, same store: the first acceptance
    expect(store.outbox).toHaveLength(1);
    expect(store.outbox[0].text).toContain("Uang masuk (K1): Rp2.272.000");
    const before = process.env.DEPLOY_ENV;
    process.env.DEPLOY_ENV = "production";
    try {
      await expect(mockDigestDeliveryPort().sendEmail(d.digest)).rejects.toBeInstanceOf(MockDigestUnavailableError);
    } finally {
      if (before === undefined) delete process.env.DEPLOY_ENV; else process.env.DEPLOY_ENV = before;
    }
  });
  it("the port refuses identifiers in free text as it renders, with no masking: whole, split across parts, currency-shaped; a valid large figure passes", async () => {
    const store = mockDigestStore();
    const port = mockDigestDeliveryPort(store);
    for (const lines of [[["Hubungi Rp62.812.999.000"]], [["Hubungi 0812", "99990000"]], [["Uang masuk (K1): ", "Rp62.812.999.000"]], [[`NIK ${SENTINEL.nik}`]]]) {
      expect(await port.sendEmail({ key, recipients: ["owner"], subject: "Ringkasan", lines: lines as never }), JSON.stringify(lines))
        .toEqual({ kind: "refused", key, reason: "identifier_found" });
    }
    // identifiers assembled across a figure (R3-r4 / R3-r5): the rendered match touches free text → refused, nothing rendered
    for (const lines of [[["Hubungi ", { count: { kind: "count", value: 123 } }, "@example.test"]], [["Hubungi 0812", { count: { kind: "count", value: 999 } }, "90000"]]])
      expect(await port.sendEmail({ key, recipients: ["owner"], subject: "Ringkasan", lines: lines as never }), JSON.stringify(lines))
        .toEqual({ kind: "refused", key, reason: "identifier_found" });
    expect(await port.sendEmail({ key, recipients: ["owner"], subject: "Hubungi Rp62.812.999.000", lines: [] })).toEqual({ kind: "refused", key, reason: "identifier_found" });
    for (const forged of [{ money: { kind: "money", rupiah: "62812999000" } }, { money: { kind: "money", rupiah: 5, text: "Rp62.812.999.000" } }])
      expect(await port.sendEmail({ key, recipients: ["owner"], subject: "Ringkasan", lines: [["K1: ", forged]] as never })).toEqual({ kind: "refused", key, reason: "invalid_body" });
    expect(store.outbox).toEqual([]);
    expect(await port.sendEmail({ key, recipients: ["owner"], subject: "Ringkasan", lines: [["Uang masuk (K1): ", { money: { kind: "money", rupiah: 1_081_234_567 } }]] }))
      .toMatchObject({ kind: "sent" });
    expect(store.outbox.map((m) => m.text)).toEqual(["Uang masuk (K1): Rp1.081.234.567"]);
  });
  it("every composer-produced body passes the port's boundary rules and scan (one / two branches, unavailable values, negatives, large figures)", async () => {
    const store = mockDigestStore();
    const port = mockDigestDeliveryPort(store);
    const variants = [raw(), raw({ branches: [{ name: "Cabang A", k1_rupiah: 100, k2_rupiah: 200 }] }), raw({ exceptions: {} }),
      raw({ branches: [{ name: "Cabang A", k1_rupiah: -5_000, k2_rupiah: 0 }, { name: "Cabang B", k1_rupiah: "x", k2_rupiah: 1_081_234_567 }] }),
      raw({ branches: [{ name: "Cabang 1", k1_rupiah: 9_007_199_254_740_991, k2_rupiah: 9 }, { name: "Cabang 2", k1_rupiah: 1, k2_rupiah: 0 }],
        exceptions: { approvals: 1_234, unpaid_visits: 0, low_stock: 7, leads_overdue: 99, satusehat_errors: 1, compliance_expired: 2 } })];
    for (const [i, v] of variants.entries()) {
      const c = composeDigest({ channel: "email", businessDate: DAY }, v);
      if (c.kind !== "ok") throw new Error(`variant ${i}: ${JSON.stringify(c)}`);
      expect(bodyProblem(c.email!.subject, c.email!.lines), `variant ${i}`).toBeNull();
      const d = emailDelivery(digestKey(T, `2026-10-${String(10 + i).padStart(2, "0")}`, "email"), c, ["owner"]);
      if (!d.ok) throw new Error(d.reason);
      expect(await port.sendEmail(d.digest), `variant ${i}`).toMatchObject({ kind: "sent" });
      expect(store.outbox.at(-1)!.text, `variant ${i}`).toBe(c.text); // the port renders exactly what the composer rendered
    }
  });
  it("email is the only channel (owner decision 2026-11-23): the port has email send only; in-app is not required; WhatsApp stays gated", () => {
    const port = mockDigestDeliveryPort() as unknown as Record<string, unknown>;
    expect(Object.keys(port).filter((k) => typeof port[k] === "function")).toEqual(["sendEmail"]);
    expect([...CHANNELS]).toEqual(["email"]);
    expect([...GATED_CHANNELS]).toEqual(["whatsapp"]);
  });
});

// ── slices B1 + D on real PostgreSQL (migration 0131, runDigest; r2 after the R3 review): Scenario PR-80 end to end through the claimed job;
// exact K1 / K2 on facts that distinguish branch-local days, the executing branch, both K1 refund arms and a non-package K2 fact; the TEN-5
// authority of digest_facts (generation-bound); the dispatch fence (stale workers, send-time opt-in / recipients / lifecycle); fully unbound
// worker calls; one lease clock (clock_timestamp); and cross-tenant isolation. Synthetic facts only (MIG-2). The schedule instant (p_now) is
// injected; leases always run on the database clock, so no test depends on which day it runs. ──
describe("owner digest job on PostgreSQL (B1 + D)", () => {
  type Pool = pg.Pool;
  let h: Harness; let app: Pool; let owner: Pool; let n = 0;
  type W = { t: string; b1: string; b2: string; own: { acc: string; staffId: string } };
  type Claim = { id: string; tenant_id: string; business_date: string; gen: number };
  const SENT = { name: "Siti Sentinel Digest", phone: "081277770000", nik: "3171999900000001", note: "Catatan klinis sentinel digest" };
  const D = "2026-10-15"; // the scheduled business day of the fixtures (fixed: the lease is on the database clock, not on this date)
  const plusDay = (d: string, k: number) => new Date(Date.parse(`${d}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);
  const wib = (day: string, hm: string) => new Date(`${day}T${hm}:00+07:00`);
  const wita = (day: string, hm: string) => new Date(`${day}T${hm}:00+08:00`);
  const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string }) => e.code ?? String(e));
  const quiet = async <X>(fn: () => Promise<X>) => { const err = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = err; } };

  // two branches: A (primary, earliest-created) in `tz`, B in Asia/Makassar (WITA)
  const world = async (label: string, lifecycle = "live", tz = "Asia/Jakarta"): Promise<W> => {
    const t = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ($1) returning id`, [lifecycle])).rows[0].id as string;
    await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [t, `PT ${label} Sintetis`]);
    const br = async (c: string, z: string, created: string) => (await h.admin.query(
      `insert into branches (tenant_id, code, name, timezone, created_at) values ($1, $2, $3, $4, $5) returning id`, [t, c, `Cabang ${label} ${c}`, z, created])).rows[0].id as string;
    const b1 = await br("A", tz, "2026-01-01T00:00:00Z");
    const b2 = await br("B", "Asia/Makassar", "2026-02-01T00:00:00Z");
    const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`dg${++n}@klinik-sintetis.test`])).rows[0].id as string;
    const { staffId } = await createMembership(owner, { tenantId: t, accountId: acc, displayName: `Pemilik ${label}` });
    await assignRole(h.admin, { tenantId: t, staffId, role: "owner" });
    return { t, b1, b2, own: { acc, staffId } };
  };
  // a setting version; a later one supersedes the earlier for followup_setting (newest effective_from first)
  const setting = (w: W, value: unknown, key = "SET-37", from = "2026-01-01") => h.admin.query(
    `insert into setting_versions (tenant_id, key, value, effective_from, state, changed_by, changed_as, changed_name, reason)
     values ($1, $2, $3::jsonb, $5, 'active', $4, 'owner', 'Pemilik', 'Uji ringkasan')`, [w.t, key, JSON.stringify(value), w.own.staffId, from]);
  // a change "now" (for send-time authority): effective from the database clock
  const settingNow = (w: W, value: unknown) => h.admin.query(
    `insert into setting_versions (tenant_id, key, value, effective_from, state, changed_by, changed_as, changed_name, reason)
     values ($1, 'SET-37', $2::jsonb, clock_timestamp(), 'active', $3, 'owner', 'Pemilik', 'Uji ubah')`, [w.t, JSON.stringify(value), w.own.staffId]);
  const patient = async (w: W, b: string, name = SENT.name) => (await h.admin.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $4, '1990-01-01', 'female', 'newborn_via_guardian', $5, 'islam', 'Karyawan', 's1', 'kawin', $2, $3, 'fo_cashier') returning id`,
    [w.t, b, w.own.staffId, name, SENT.note])).rows[0].id as string;
  // raw facts of the shape the writers persist (as the T-107 / T-109 fixtures): guards and FKs off for the seed only, in one transaction
  const SEEDED = ["invoices", "invoice_lines", "payments", "packages", "package_sessions", "catalog_items", "catalog_versions", "approvals", "visits",
    "stock_items", "stock_batches", "stock_levels", "leads", "satusehat_links", "evidence_items", "refunds", "balance_accounts", "balance_entries",
    "booking_deposits", "treatment_executions", "plan_items"];
  type Q = (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  async function seed(fn: (q: Q) => Promise<void>) {
    const q: Q = (sql, args = []) => h.admin.query(sql, args) as unknown as Promise<{ rows: Record<string, unknown>[] }>;
    await h.admin.query("begin");
    try {
      await h.admin.query("set local session_replication_role = replica");
      const tg = (await h.admin.query(`select c.relname t, g.tgname n, g.tgenabled m from pg_trigger g join pg_class c on c.oid = g.tgrelid
        where c.relname = any($1) and not g.tgisinternal and g.tgenabled <> 'D'`, [SEEDED])).rows as { t: string; n: string; m: string }[];
      for (const x of tg) await h.admin.query(`alter table ${x.t} disable trigger ${x.n}`);
      await fn(q);
      for (const x of tg) await h.admin.query(`alter table ${x.t} enable ${x.m === "A" ? "always " : x.m === "R" ? "replica " : ""}trigger ${x.n}`);
      await h.admin.query("commit");
    } catch (e) { await h.admin.query("rollback"); throw e; }
  }
  const service = async (q: Q, w: W, price: number) => {
    const svc = (await q(`insert into catalog_items (tenant_id, kind, code, created_by) values ($1, 'service', $2, $3) returning id`, [w.t, `DG-${++n}`, w.own.staffId])).rows[0].id as string;
    const ver = (await q(`insert into catalog_versions (tenant_id, item_id, version, state, name, tax_category, tax_basis, normal_price, reason, created_by, created_as)
      values ($1, $2, 1, 'active', 'Layanan Digest', 'exempt_medical', 'Jasa medis', $3, 'Baru', $4, 'owner') returning id`, [w.t, svc, price, w.own.staffId])).rows[0].id as string;
    return { svc, ver };
  };
  const invoice = async (q: Q, w: W, b: string, pid: string, at: Date, visit: string | null = null) => (await q(
    `insert into invoices (tenant_id, branch_id, sold_branch_id, patient_id, visit_id, number, state, is_pkp_at_issue, issued_at, issued_by, issued_as, command_key, created_by, created_as)
     values ($1, $2, $2, $3, $4, $5, 'issued', false, $6, $7, 'fo_cashier', $8, $7, 'fo_cashier') returning id`,
    [w.t, b, pid, visit, `DG-${++n}`, at, w.own.staffId, `dg-${crypto.randomUUID()}`])).rows[0].id as string;
  // K1: one payment (method / simulated as given) at branch b at `at`
  const pay = (w: W, b: string, at: Date, amount: number, method = "cash", simulated = false) => seed(async (q) => {
    const inv = await invoice(q, w, b, await patient(w, b), at);
    await q(`insert into payments (tenant_id, branch_id, receipt_id, seq, invoice_id, method, amount, cash_tendered, change_given, environment, is_simulated, received_by, received_as, received_at)
      values ($1, $2, gen_random_uuid(), 1, $3, $4, $5, case when $4 = 'cash' then $5::bigint end, case when $4 = 'cash' then 0 end, 'local', $6, $7, 'fo_cashier', $8)`,
      [w.t, b, inv, method, amount, simulated, w.own.staffId, at]);
  });
  // K1 arm 2: a paid cash refund at branch b at `at` (its cash entry is the negative balance entry the dashboard reads)
  const cashRefund = (w: W, b: string, at: Date, amount: number) => seed(async (q) => {
    const pid = await patient(w, b);
    const { svc, ver } = await service(q, w, amount);
    const inv = await invoice(q, w, b, pid, new Date(at.getTime() - 86_400_000 * 3));
    const ln = (await q(`insert into invoice_lines (tenant_id, branch_id, invoice_id, item_id, catalog_version_id, quantity, unit_price, line_total, tax_category, tax_basis, vat_base, vat_amount)
      values ($1, $2, $3, $4, $5, 1, $6, $6, 'exempt_medical', 'Jasa medis', $6, 0) returning id`, [w.t, b, inv, svc, ver, amount])).rows[0].id;
    const acct = (await q(`insert into balance_accounts (tenant_id, patient_id) values ($1, $2) returning id`, [w.t, pid])).rows[0].id;
    const ref = crypto.randomUUID();
    const credit = (await q(`insert into balance_entries (tenant_id, account_id, branch_id, kind, amount, balance_after, source_kind, source_id, command_key, created_by, created_as, created_at)
      values ($1, $2, $3, 'from_refund', $4, $4, 'refund', $5, $6, $7, 'fo_cashier', $8) returning id`, [w.t, acct, b, amount, ref, `be-${crypto.randomUUID()}`, w.own.staffId, at])).rows[0].id;
    const cash = (await q(`insert into balance_entries (tenant_id, account_id, branch_id, kind, amount, balance_after, source_kind, source_id, command_key, created_by, created_as, created_at)
      values ($1, $2, $3, 'cash_refund', $4, 0, 'refund', $5, $6, $7, 'fo_cashier', $8) returning id`, [w.t, acct, b, -amount, ref, `be-${crypto.randomUUID()}`, w.own.staffId, at])).rows[0].id;
    await q(`insert into refunds (id, tenant_id, branch_id, patient_id, invoice_id, invoice_line_id, amount, destination, state, delivered, reason, approval_id, balance_entry_id, cash_entry_id,
             paid_method, requested_by, requested_as, paid_by, paid_as, paid_at, command_key)
      values ($1, $2, $3, $4, $5, $6, $7, 'cash', 'paid', false, 'Refund uji', gen_random_uuid(), $8, $9, 'cash', $10, 'fo_cashier', $10, 'fo_cashier', $11, $12)`,
      [ref, w.t, b, pid, inv, ln, amount, credit, cash, w.own.staffId, at, `rf-${crypto.randomUUID()}`]);
  });
  // K1 arm 3: a booking DP refunded at branch b at `at`
  const dpRefund = (w: W, b: string, at: Date, amount: number) => seed(async (q) => {
    const pid = await patient(w, b);
    const { ver } = await service(q, w, amount);
    await q(`insert into booking_deposits (tenant_id, branch_id, appointment_id, patient_id, catalog_version_id, receipt_id, method, amount, tax_category, is_pkp_at_receipt, vat_base, vat_amount,
             cutoff_hours, state, decision_code, refund_method, decided_by, decided_as, decided_at, command_key, received_by, received_as, received_at)
      values ($1, $2, gen_random_uuid(), $3, $4, gen_random_uuid(), 'cash', $5, 'exempt_medical', false, $5, 0, 24, 'refunded', 'clinic_cancel', 'cash', $6, 'fo_cashier', $7, $8, $6, 'fo_cashier', $9)`,
      [w.t, b, pid, ver, amount, w.own.staffId, at, `dp-${crypto.randomUUID()}`, new Date(at.getTime() - 86_400_000 * 5)]);
  });
  // K2 arm 1: a counted single treatment finished at branch b at `at` (its visit's issued line: line_total − VAT)
  const treatment = (w: W, b: string, at: Date, value: number) => seed(async (q) => {
    const pid = await patient(w, b);
    const { svc, ver } = await service(q, w, value);
    const visit = (await q(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by, checked_in_at, payment) values ($1, $2, $3, 'walk_in', $4, $5, 'done') returning id`,
      [w.t, b, pid, w.own.staffId, new Date(at.getTime() - 3_600_000)])).rows[0].id as string;
    const pi = (await q(`insert into plan_items (tenant_id, branch_id, plan_id, examination_id, stage, catalog_version_id, qty) values ($1, $2, gen_random_uuid(), gen_random_uuid(), 1, $3, 1) returning id`,
      [w.t, b, ver])).rows[0].id;
    const inv = await invoice(q, w, b, pid, new Date(at.getTime() - 1_800_000), visit);
    await q(`insert into invoice_lines (tenant_id, branch_id, invoice_id, item_id, catalog_version_id, quantity, unit_price, line_total, tax_category, tax_basis, vat_base, vat_amount, plan_item_id)
      values ($1, $2, $3, $4, $5, 1, $6, $6, 'exempt_medical', 'Jasa medis', $6, 0, $7)`, [w.t, b, inv, svc, ver, value, pi]);
    await q(`insert into treatment_executions (tenant_id, branch_id, visit_id, plan_item_id, performer_staff_id, identity_confirmed, state, started_by, started_as, start_command_key,
             started_at, finished_at, finished_by, finished_as, finish_command_key, outcome)
      values ($1, $2, $3, $4, $5, true, 'finished', $5, 'doctor', $6, $7, $8, $5, 'doctor', $9, 'completed')`,
      [w.t, b, visit, pi, w.own.staffId, `ts-${crypto.randomUUID()}`, new Date(at.getTime() - 900_000), at, `tf-${crypto.randomUUID()}`]);
  });
  // K2 arm 2: a package SOLD at `sold` and its session REDEEMED at `at` at branch `redeemed`
  const redeem = (w: W, sold: string, redeemed: string, at: Date, value: number) => seed(async (q) => {
    const { svc, ver } = await service(q, w, value);
    const pid = await patient(w, sold);
    const inv = await invoice(q, w, sold, pid, new Date("2026-01-05T03:00:00Z"));
    const ln = (await q(`insert into invoice_lines (tenant_id, branch_id, invoice_id, item_id, catalog_version_id, quantity, unit_price, line_total, tax_category, tax_basis, vat_base, vat_amount)
      values ($1, $2, $3, $4, $5, 1, $6, $6, 'exempt_medical', 'Jasa medis', $6, 0) returning id`, [w.t, sold, inv, svc, ver, value])).rows[0].id;
    const pkg = (await q(`insert into packages (tenant_id, sold_branch_id, patient_id, invoice_id, invoice_line_id, item_id, catalog_version_id, price, min_dp, validity_end, created_by, created_as)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $8, now() + interval '180 days', $9, 'fo_cashier') returning id`, [w.t, sold, pid, inv, ln, svc, ver, value, w.own.staffId])).rows[0].id;
    await q(`insert into package_sessions (tenant_id, package_id, seq, service_item_id, allocated_value, tax_category, tax_basis, vat_base, vat_amount, state, reserved_execution_id, redeemed_branch_id, redeemed_at, beneficiary_patient_id)
      values ($1, $2, 1, $3, $4, 'exempt_medical', 'Jasa medis', $4, 0, 'redeemed', gen_random_uuid(), $5, $6, $7)`, [w.t, pkg, svc, value, redeemed, at, pid]);
  });
  // one of each of the six exceptions (and a non-counting twin of each), at branch b1 of w — relative to the wall clock (read-time snapshot)
  const exceptions = (w: W) => seed(async (q) => {
    const pid = await patient(w, w.b1);
    await q(`insert into approvals (tenant_id, type, subject_kind, subject_id, request_reason, state, requested_by, requested_as, branch_id)
             values ($1, 'refund_exception', 'refund', gen_random_uuid(), $3, 'pending', $2, 'fo_cashier', $4),
                    ($1, 'record_late_correction', 'record_correction', gen_random_uuid(), 'Koreksi uji', 'pending', $2, 'doctor', $4)`, [w.t, w.own.staffId, SENT.name, w.b1]);
    const pid2 = await patient(w, w.b1); const pid3 = await patient(w, w.b1);
    for (const [p, at, closed] of [[pid, new Date(Date.now() - 86_400_000 * 2), false], [pid2, new Date(), false], [pid3, new Date(Date.now() - 86_400_000 * 2), true]] as const) {
      await q(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by, checked_in_at, payment, closed_at, closed_by)
               values ($1, $2, $3, 'walk_in', $4, $5, 'in_progress', case when $6 then now() end, case when $6 then $4::uuid end)`, [w.t, w.b1, p, w.own.staffId, at, closed]);
    }
    for (const [fit, label] of [[3, "Kasa"], [20, "Sarung"]] as const) {
      const cat = (await q(`insert into catalog_items (tenant_id, kind, code, created_by) values ($1, 'material', $2, $3) returning id`, [w.t, `DGM-${++n}`, w.own.staffId])).rows[0].id;
      const item = (await q(`insert into stock_items (tenant_id, catalog_item_id, unit, created_by, updated_by) values ($1, $2, 'pak', $3, $3) returning id`, [w.t, cat, w.own.staffId])).rows[0].id;
      await q(`insert into stock_batches (tenant_id, branch_id, item_id, batch_no, expiry, quantity) values ($1, $2, $3, $4, current_date + 300, $5)`, [w.t, w.b1, item, `${label}-${n}`, fit]);
      await q(`insert into stock_levels (tenant_id, branch_id, item_id, min_qty, target_qty, updated_by, updated_as) values ($1, $2, $3, 5, 10, $4, 'pharmacist')`, [w.t, w.b1, item, w.own.staffId]);
    }
    for (const [ago, answered] of [[60, false], [5, false], [60, true]] as const) {
      await q(`insert into leads (tenant_id, branch_id, source, stage, first_response_at, contacted_at, created_by, created_as, command_key, created_at)
               values ($1, $2, 'instagram', $3, $4, $4, $5, 'central_cs', $6, now() - make_interval(mins => $7))`,
        [w.t, w.b1, answered ? "contacted" : "new", answered ? new Date() : null, w.own.staffId, `ld-${crypto.randomUUID()}`, ago]);
    }
    const visit = (await q(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by, checked_in_at, payment, closed_at, closed_by)
      values ($1, $2, $3, 'walk_in', $4, now() - interval '3 days', 'done', now(), $4) returning id`, [w.t, w.b1, pid2, w.own.staffId])).rows[0].id;
    for (const [env, st, why, k] of [["sandbox", "failed", "http_4xx", "a"], ["sandbox", "exception", "duplicate_remote", "b"], ["sandbox", "confirmed", null, "c"], ["production", "failed", "http_4xx", "d"]] as const) {
      await q(`insert into satusehat_links (tenant_id, branch_id, environment, visit_id, fhir_type, local_key, organization_id, current_revision, status, status_reason, remote_id, confirmed_revision)
               values ($1, $2, $3, $4, 'Encounter', $5, 'ORG-1', 1, $6, $7, case when $6 = 'confirmed' then 'R-1' end, case when $6 = 'confirmed' then 1 end)`, [w.t, w.b1, env, visit, k, st, why]);
    }
    await q(`insert into evidence_items (tenant_id, obligation_key, state, valid_until) values ($1, 'tax_advice', 'approved', current_date - 1), ($1, 'sop_incident', 'submitted', null)`, [w.t]);
  });
  const claimAt = (p: Pool, at: Date | null) => p.query(`select digest_claim($1) r`, [at]).then((r) => r.rows[0].r as Claim[]);
  const mine = (cs: Claim[], w: W) => cs.filter((x) => x.tenant_id === w.t);
  const facts = (p: Pool, tenantId: string, run: string, gen: number) => withTenantContext(p, { tenantId, allowedBranchIds: "*", roles: [] }, async (db) => {
    await db.query(`select set_config('app.deploy_env', 'local', true)`);
    return (await db.query(`select digest_facts($1, $2) f`, [run, gen])).rows[0].f as Record<string, unknown>;
  });
  type Disp = { mode: string; outcome?: string; recipients?: string[] };
  const dispatch = (run: string, gen: number | null, refusal: string | null = null) =>
    app.query(`select digest_dispatch($1, $2, $3) r`, [run, gen, refusal]).then((r) => r.rows[0].r as Disp);
  const runs = async (t: string) => (await h.admin.query(`select id, business_date::text d, state, lease_gen, attempts, outcome, recipients, dispatched_gens
     from digest_runs where tenant_id = $1 order by created_at`, [t])).rows;
  // the provider record of the in-memory mock: ONE store shared by every port instance in this file (a provider honouring the idempotency key)
  let provider: MockDigestStore;
  const freshPort = () => mockDigestDeliveryPort(provider);
  const outbox = (t: string) => provider.outbox.filter((m) => m.key.includes(t));
  // a port that counts its sends and can be made to fail BEFORE acceptance (a technical error)
  const countingPort = (o: { throwOnSend?: boolean } = {}) => {
    const base = freshPort();
    const calls = { send: 0 };
    const port: DigestDeliveryPort = { async sendEmail(d) { calls.send++; if (o.throwOnSend) throw new TypeError("network down"); return base.sendEmail(d); } };
    return { port, calls };
  };
  // expire a lease without waiting: move it to the past on the database clock (the lease state itself is what is under test)
  const expire = (run: string) => h.admin.query(`update digest_runs set lease_until = clock_timestamp() - interval '1 second' where id = $1`, [run]);

  beforeAll(async () => {
    process.env.DEPLOY_ENV = "local"; // synthetic data only (MIG-2); the mock port refuses production
    provider = mockDigestStore();
    h = await createHarness();
    app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 4 });
    owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  }, 300_000);
  afterAll(async () => { await app?.end(); await owner?.end(); await h?.close(); });

  it("Scenario PR-80 end to end: ONE email after the SET-37 time with exact K1, K2 and the six counts; distinguishing facts; no patient data", async () => {
    const A = await world("Digest A");
    const B = await world("Digest B"); // another tenant with its own (larger) numbers, opted in too
    await setting(A, { ringkasan: "20:00", penerima: ["owner", "finance"] });
    await setting(A, { nama: "Klinik Digest A", aksen: "#0A6E86" }, "SET-1");
    await setting(B, { ringkasan: "17:00", penerima: ["owner"] });
    // Facts and their expected (branch, local day) — each fact's own branch-local day decides (R3 finding 6):
    const F = [
      { arm: "pay", b: A.b1, at: wib(D, "09:00"), amount: 300_001 },                       // A, D: K1 +300,001
      { arm: "pay", b: A.b1, at: wib(D, "10:00"), amount: 200_000, method: "transfer" },   // A, D: K1 +200,000
      { arm: "pay", b: A.b1, at: wib(D, "10:30"), amount: 9_999, method: "qris", sim: true }, // simulated: never K1
      { arm: "pay", b: A.b1, at: wib(D, "10:45"), amount: 77_777, method: "balance" },     // balance use: never K1
      { arm: "pay", b: A.b1, at: wib(plusDay(D, -1), "12:00"), amount: 444_444 },          // A, D−1: not D
      // straddling local midnight: 23:30 WIB on D = 00:30 WITA on D+1 — the SAME instant is D at A and D+1 at B
      { arm: "pay", b: A.b1, at: wib(D, "23:30"), amount: 11_111 },                        // A (WIB), D: counted
      { arm: "pay", b: A.b2, at: wib(D, "23:30"), amount: 22_222 },                        // B (WITA), D+1: NOT counted for D
      { arm: "pay", b: A.b2, at: wita(D, "00:30"), amount: 150_000 },                      // B, D 00:30 WITA (= D−1 23:30 WIB): counted at B for D
      { arm: "refund", b: A.b1, at: wib(D, "15:00"), amount: 33_000 },                     // A, D: K1 −33,000 (paid cash refund)
      { arm: "dp", b: A.b2, at: wita(D, "16:00"), amount: 44_000 },                        // B, D: K1 −44,000 (refunded booking DP)
      { arm: "treatment", b: A.b1, at: wib(D, "11:00"), amount: 250_000 },                 // A, D: K2 +250,000 (a counted single treatment)
      { arm: "redeem", sold: A.b1, b: A.b2, at: wita(D, "11:30"), amount: 600_000 },       // sold at A, redeemed at B on D: K2 at B only
    ] as const;
    for (const f of F) {
      if (f.arm === "pay") await pay(A, f.b, f.at, f.amount, "method" in f ? f.method : "cash", "sim" in f && f.sim);
      else if (f.arm === "refund") await cashRefund(A, f.b, f.at, f.amount);
      else if (f.arm === "dp") await dpRefund(A, f.b, f.at, f.amount);
      else if (f.arm === "treatment") await treatment(A, f.b, f.at, f.amount);
      else await redeem(A, f.sold, f.b, f.at, f.amount);
    }
    await exceptions(A);
    await pay(B, B.b1, wib(D, "09:00"), 9_100_000);
    await redeem(B, B.b1, B.b1, wib(D, "09:30"), 8_200_000);
    // the expected rows, computed here independently of the database: each fact's local date in its own branch's zone
    const zone: Record<string, string> = { [A.b1]: "Asia/Jakarta", [A.b2]: "Asia/Makassar" };
    const localDay = (at: Date, b: string) => at.toLocaleDateString("en-CA", { timeZone: zone[b] });
    const exp = { [A.b1]: { k1: 0, k2: 0 }, [A.b2]: { k1: 0, k2: 0 } };
    for (const f of F) {
      if (localDay(f.at, f.b) !== D) continue;
      if (f.arm === "pay" && !("sim" in f) && !("method" in f && f.method === "balance")) exp[f.b].k1 += f.amount;
      if (f.arm === "refund" || f.arm === "dp") exp[f.b].k1 -= f.amount;
      if (f.arm === "treatment" || f.arm === "redeem") exp[f.b].k2 += f.amount;
    }
    expect(exp).toEqual({ [A.b1]: { k1: 300_001 + 200_000 + 11_111 - 33_000, k2: 250_000 }, [A.b2]: { k1: 150_000 - 44_000, k2: 600_000 } });

    // the dashboard reader (owner of A) per branch and day agrees with the independent expectation (the shared helpers)
    const ownCtx = await resolveContext(app, A.own.acc, { tenantId: A.t, actingRole: "owner" });
    for (const b of [A.b1, A.b2]) {
      const [k1, k2] = await withTenantContext(app, ownCtx, async (db) => [await kpi(db, { kpi: "k1", from: D, to: D, branchId: b }), await kpi(db, { kpi: "k2", from: D, to: D, branchId: b })]);
      expect([k1.total ?? 0, k2.total ?? 0], b).toEqual([exp[b].k1, exp[b].k2]);
    }

    const port = freshPort();
    expect((await runDigest(app, { now: wib(D, "19:59"), port })).filter((r) => r.tenantId === A.t)).toEqual([]); // not due before 20:00
    const res = (await runDigest(app, { now: wib(D, "21:30"), port })).filter((r) => r.tenantId === A.t);
    expect(res).toEqual([{ runId: expect.any(String), tenantId: A.t, businessDate: D, outcome: "sent" }]);
    expect(await runs(A.t)).toEqual([{ id: res[0].runId, d: D, state: "done", lease_gen: 1, attempts: 1, outcome: "sent", recipients: ["owner", "finance"], dispatched_gens: [1] }]);
    const mails = outbox(A.t).map((m) => ({ key: m.key, recipients: m.recipients, subject: m.subject, text: m.text }));
    expect(mails).toHaveLength(1);
    const day = new Intl.DateTimeFormat("id-ID", { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${D}T00:00:00Z`));
    const rp = (v: number) => `${v < 0 ? "−" : ""}Rp${new Intl.NumberFormat("id-ID").format(Math.abs(v))}`;
    expect(mails[0]).toEqual({
      key: digestKey(A.t, D, "email"), recipients: ["owner", "finance"], subject: `Ringkasan harian Klinik Digest A — ${day}`,
      text: [
        `Ringkasan harian Klinik Digest A — ${day}`, "",
        `Uang masuk (K1): ${rp(exp[A.b1].k1 + exp[A.b2].k1)}`, `Layanan selesai (K2): ${rp(exp[A.b1].k2 + exp[A.b2].k2)}`, "",
        "Per cabang:", `• Cabang Digest A A: uang masuk ${rp(exp[A.b1].k1)}, layanan selesai ${rp(exp[A.b1].k2)}`,
        `• Cabang Digest A B: uang masuk ${rp(exp[A.b2].k1)}, layanan selesai ${rp(exp[A.b2].k2)}`, "",
        "Perlu ditangani: 7",
        "• Persetujuan menunggu: 1", "• Kunjungan belum bayar sebelum hari ini: 1", "• Stok klinis menipis: 1", "• Lead melewati batas respons: 1",
        "• Kiriman SATUSEHAT gagal: 2", "• Bukti kepatuhan sudah kedaluwarsa: 1", "",
        "Angka gabungan tanpa data pasien. Rincian ada di Ringkasan Owner.",
      ].join("\n"),
    });
    // the literal values, so a formatter regression cannot hide behind the shared `rp`
    expect(mails[0].text).toContain("Uang masuk (K1): Rp584.112");
    expect(mails[0].text).toContain("• Cabang Digest A B: uang masuk Rp106.000, layanan selesai Rp600.000");
    const blob = JSON.stringify(mails);
    for (const s of Object.values(SENT)) expect(blob).not.toContain(s);
    for (const s of ["9.100.000", "8.200.000"]) expect(blob).not.toContain(s);
    // a second pass the same day claims nothing and sends nothing new
    expect((await runDigest(app, { now: wib(D, "23:45"), port: freshPort() })).filter((r) => r.tenantId === A.t)).toEqual([]);
    expect(outbox(A.t)).toHaveLength(1);
  });

  it("the facts JSON is exactly the projectFacts allowlist and matches the T-109 owner readers on the same facts", async () => {
    const A = await world("Fakta");
    await setting(A, { ringkasan: "17:00", penerima: ["owner"] });
    await pay(A, A.b1, wib(D, "09:00"), 120_000);
    await exceptions(A);
    const [c] = mine(await claimAt(app, wib(D, "23:00")), A);
    expect(c).toEqual({ id: expect.any(String), tenant_id: A.t, business_date: D, gen: 1 });
    const f = await facts(app, A.t, c.id, c.gen);
    expect(f).toEqual({
      clinic: "PT Fakta Sintetis",
      branches: [{ name: "Cabang Fakta A", k1_rupiah: 120_000, k2_rupiah: 0 }, { name: "Cabang Fakta B", k1_rupiah: 0, k2_rupiah: 0 }],
      exceptions: { approvals: 1, unpaid_visits: 1, low_stock: 1, leads_overdue: 1, satusehat_errors: 2, compliance_expired: 1 },
    });
    const blob = JSON.stringify(f);
    for (const s of Object.values(SENT)) expect(blob).not.toContain(s);
    expect(blob).not.toMatch(/RM-\d|[0-9a-f]{8}-[0-9a-f]{4}-/i);
    const ownCtx = await resolveContext(app, A.own.acc, { tenantId: A.t, actingRole: "owner" });
    const att = await withTenantContext(app, ownCtx, async (db) => {
      const now = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
      return loadAttention(db, "owner", [A.b1, A.b2], await kpi(db, { kpi: "k18", from: now, to: now }));
    });
    const screen = Object.fromEntries(att.map((x) => [x.key, "count" in x ? x.count : x.state]));
    expect(screen).toEqual({ persetujuan: 1, belum_bayar: 1, stok_klinis: 1, lead_sla: 1, satusehat: 2, kepatuhan: 1 });
  });

  it("schedule: opted out, non-live, not yet due and an invalid SET-37 value create nothing; the primary branch's zone decides", async () => {
    const off = await world("Nonaktif");
    const onb = await world("Onboarding", "onboarding"); await setting(onb, { ringkasan: "17:00", penerima: ["owner"] });
    const sus = await world("Suspended", "suspended"); await setting(sus, { ringkasan: "17:00", penerima: ["owner"] });
    const late = await world("Belum Waktunya"); await setting(late, { ringkasan: "23:00", penerima: ["owner"] });
    const bad = await world("Rusak"); await setting(bad, { ringkasan: "08:00", penerima: ["owner"] });
    const wit = await world("Papua", "live", "Asia/Jayapura"); await setting(wit, { ringkasan: "21:00", penerima: ["owner"] });
    // 19:30 WIB = 21:30 WIT: the WIT tenant is due by its primary branch's clock; the WIB tenant at 23:00 is not
    const got = (await claimAt(app, wib(D, "19:30"))).map((x) => x.tenant_id);
    for (const w of [off, onb, sus, late, bad]) expect(got, w.t).not.toContain(w.t);
    for (const w of [off, onb, sus, late, bad]) expect(await runs(w.t)).toEqual([]);
    expect(await runs(wit.t)).toMatchObject([{ d: D, state: "leased" }]);
    // 22:30 WIB = 00:30 WIT of D+1: before 21:00 there, so no run for D+1
    expect(mine(await claimAt(app, wib(D, "22:30")), wit)).toEqual([]);
    expect(await runs(wit.t)).toHaveLength(1);
    expect(await runs(late.t)).toEqual([]);
  });

  it("one lease clock (R3 finding 4): a PAST p_now creates a run whose lease is valid on the wall clock; a FUTURE p_now cannot expire a live lease", async () => {
    const A = await world("Jam Lalu");
    await setting(A, { ringkasan: "18:00", penerima: ["owner"] });
    // a backfill-style instant long in the past: the run is for that day, and its lease runs from the database clock
    const [c] = mine(await claimAt(app, wib("2026-01-10", "18:30")), A);
    expect(c.business_date).toBe("2026-01-10");
    const lease = (await h.admin.query(`select lease_until > clock_timestamp() + interval '4 minutes' ok from digest_runs where id = $1`, [c.id])).rows[0].ok;
    expect(lease).toBe(true);
    expect((await facts(app, A.t, c.id, c.gen)).clinic).toBe("PT Jam Lalu Sintetis"); // readable now: the lease holds on the wall clock
    // a worker with a far-future p_now sees the run as live: it is not reaped or re-leased
    expect(mine(await claimAt(app, wib("2027-06-01", "23:00")), A).filter((x) => x.id === c.id)).toEqual([]);
    expect(await runs(A.t)).toMatchObject([{ id: c.id, state: "leased", lease_gen: 1 }, { d: "2027-06-01" }]); // that call only scheduled ITS day
    expect(await dispatch(c.id, c.gen)).toMatchObject({ mode: "send" });
  });

  it("lifecycle: one run per day; reaping on the wall clock; re-claim bumps the generation; stale completion refused; replay answers; 'sent' needs a dispatch", async () => {
    const A = await world("Lease");
    await setting(A, { ringkasan: "18:00", penerima: ["owner"] });
    const [c1] = mine(await claimAt(app, wib(D, "18:05")), A);
    expect(c1.gen).toBe(1);
    expect(mine(await claimAt(app, wib(D, "18:06")), A)).toEqual([]); // leased: nothing new
    await expire(c1.id);
    const [c2] = mine(await claimAt(app, wib(D, "18:07")), A);
    expect([c2.id, c2.gen]).toEqual([c1.id, 2]);
    expect(await code(app.query(`select digest_complete($1, $2, 'sent')`, [c1.id, c1.gen]))).toBe("40001"); // stale
    expect(await code(app.query(`select digest_complete($1, $2, 'sent')`, [c2.id, c2.gen]))).toBe("40001"); // nothing delivered yet
    expect(await code(app.query(`select digest_delivered($1, $2, 'ref-1')`, [c2.id, c2.gen]))).toBe("40001"); // nothing dispatched yet
    expect(await dispatch(c2.id, c2.gen)).toEqual({ mode: "send", recipients: ["owner"] });
    expect(await code(app.query(`select digest_complete($1, $2, 'sent')`, [c2.id, c2.gen]))).toBe("40001"); // dispatched, not yet delivered
    expect(await app.query(`select digest_delivered($1, $2, 'ref-1') s`, [c2.id, c2.gen]).then((r) => r.rows[0].s)).toBe("recorded");
    expect(await app.query(`select digest_delivered($1, $2, 'ref-1') s`, [c2.id, c2.gen]).then((r) => r.rows[0].s)).toBe("recorded"); // same ref: no-op
    expect(await code(app.query(`select digest_delivered($1, $2, 'ref-2')`, [c2.id, c2.gen]))).toBe("40001"); // never changed
    expect(await code(app.query(`select digest_complete($1, $2, 'refused:x_y')`, [c2.id, c2.gen]))).toBe("40001"); // never a refusal over a delivery
    expect(await app.query(`select digest_complete($1, $2, 'sent') s`, [c2.id, c2.gen]).then((r) => r.rows[0].s)).toBe("sent");
    expect(await app.query(`select digest_complete($1, $2, 'sent') s`, [c2.id, c2.gen]).then((r) => r.rows[0].s)).toBe("sent"); // replay
    expect(await code(app.query(`select digest_complete($1, $2, 'refused:x_y')`, [c2.id, c2.gen]))).toBe("40001");
    expect(await code(app.query(`select digest_complete($1, 1, 'nonsense')`, [c2.id]))).toBe("22023");
    expect(mine(await claimAt(app, wib(D, "23:59")), A)).toEqual([]);
    expect(await runs(A.t)).toEqual([{ id: c1.id, d: D, state: "done", lease_gen: 2, attempts: 2, outcome: "sent", recipients: ["owner"], dispatched_gens: [2] }]);
    expect(mine(await claimAt(app, wib(plusDay(D, 1), "18:00")), A)).toMatchObject([{ business_date: plusDay(D, 1), gen: 1 }]);
    await expect(app.query(`select * from digest_runs`)).rejects.toMatchObject({ code: "42501" });
    await expect(h.admin.query(`delete from digest_runs where id = $1`, [c1.id])).rejects.toMatchObject({ code: "42501" });
  });

  it("POLICY: five attempts that fail BEFORE any dispatch end refused:attempts_exhausted; a definitive refusal is final at once", async () => {
    const A = await world("Habis");
    await setting(A, { ringkasan: "17:00", penerima: ["owner"] });
    // each attempt: claimed, then the worker dies before dispatch (an error) — nothing was ever authorized to send
    for (let i = 0; i < 5; i++) {
      const [c] = mine(await claimAt(app, wib(D, "21:00")), A);
      expect(c.gen).toBe(i + 1);
      await expire(c.id);
    }
    expect(mine(await claimAt(app, wib(D, "21:00")), A)).toEqual([]);
    expect(await runs(A.t)).toMatchObject([{ state: "done", attempts: 5, outcome: "refused:attempts_exhausted", dispatched_gens: [] }]);
    const R = await world("Final");
    await setting(R, { ringkasan: "17:00", penerima: ["owner"] });
    await setting(R, { nama: "Klinik 081299990000", aksen: "#0A6E86" }, "SET-1");
    expect((await runDigest(app, { now: wib(D, "21:00"), port: freshPort() })).filter((x) => x.tenantId === R.t)).toMatchObject([{ outcome: "refused:identifier_found" }]);
    expect(await runs(R.t)).toMatchObject([{ state: "done", attempts: 1, outcome: "refused:identifier_found", dispatched_gens: [] }]);
    expect(outbox(R.t)).toEqual([]);
  });

  it("unconfirmed is never refused (R3-r3 finding 1): attempts 1–4 fail before acceptance, attempt 5 dies after the send → unconfirmed:attempts_exhausted; one dispatch per generation; a late receipt upgrades to sent", async () => {
    const A = await world("Belum Pasti");
    await setting(A, { ringkasan: "17:00", penerima: ["owner"] });
    const boom = countingPort({ throwOnSend: true });
    for (let i = 0; i < 4; i++) {
      const out = await quiet(() => runDigest(app, { now: wib(D, "21:00"), port: boom.port }));
      expect(out.filter((r) => r.tenantId === A.t)).toMatchObject([{ outcome: null }]); // dispatched, the port threw before accepting
      await expire((await runs(A.t))[0].id as string);
    }
    expect(boom.calls.send).toBe(4); // each retry re-sends with the SAME key (the provider dedups by contract)
    // attempt 5: dispatched, the provider ACCEPTS, the worker dies before recording the receipt
    const [c5] = mine(await claimAt(app, wib(D, "21:00")), A);
    expect(c5.gen).toBe(5);
    let accepted: { providerRef: string } | null = null;
    const dies: DigestDeliveryPort = { async sendEmail(d) { const r = await freshPort().sendEmail(d); accepted = r as { providerRef: string }; throw new Error("worker died after acceptance"); } };
    expect(await quiet(() => runOne(app, c5, dies))).toBeNull();
    expect(accepted).not.toBeNull();
    expect(await runs(A.t)).toMatchObject([{ state: "dispatching", attempts: 5, dispatched_gens: [1, 2, 3, 4, 5] }]);
    await expire(c5.id);
    expect(mine(await claimAt(app, wib(D, "21:00")), A)).toEqual([]); // the cap: closed, NOT refused
    expect(await runs(A.t)).toMatchObject([{ state: "done", outcome: "unconfirmed:attempts_exhausted", dispatched_gens: [1, 2, 3, 4, 5] }]);
    expect(outbox(A.t)).toHaveLength(1); // the provider accepted exactly once
    // the late receipt (an operator or the provider's callback) upgrades it: the only allowed terminal change
    expect(await app.query(`select digest_delivered($1, 5, $2) s`, [c5.id, accepted!.providerRef]).then((r) => r.rows[0].s)).toBe("upgraded");
    expect(await runs(A.t)).toMatchObject([{ state: "done", outcome: "sent" }]);
    // a generation that never dispatched cannot record a receipt; a sent run is final
    expect(await code(app.query(`select digest_delivered($1, 6, 'x-1')`, [c5.id]))).toBe("40001");
    await expect(h.admin.query(`update digest_runs set outcome = 'refused:x_y' where id = $1`, [c5.id])).rejects.toMatchObject({ code: "42501" });
  });

  it("stale worker after send authorization (R3-r3 finding 2): A pauses after 'send', B reclaims, the owner opts out → unconfirmed:opted_out; A's late acceptance can only upgrade to sent", async () => {
    const T = await world("Jeda");
    await setting(T, { ringkasan: "17:00", penerima: ["owner"] });
    const [a] = mine(await claimAt(app, wib(D, "21:00")), T);
    let resume!: () => void;
    const paused = new Promise<void>((r) => { resume = r; });
    let reached!: () => void;
    const atPort = new Promise<void>((r) => { reached = r; });
    const aRun = runOne(app, a, freshPort(), { beforeSend: async () => { reached(); await paused; } });
    await atPort; // A holds 'send' for gen 1 and has not called the port
    expect(await runs(T.t)).toMatchObject([{ state: "dispatching", lease_gen: 1, dispatched_gens: [1] }]);
    await expire(a.id);
    const [b] = mine(await claimAt(app, wib(D, "21:00")), T);
    expect(b.gen).toBe(2);
    await settingNow(T, { ringkasan: null, penerima: ["owner"] });
    expect(await runOne(app, b, freshPort())).toBe("unconfirmed:opted_out"); // B closes it: never refused, nothing sent by B
    expect(await runs(T.t)).toMatchObject([{ state: "done", outcome: "unconfirmed:opted_out", dispatched_gens: [1] }]);
    expect(outbox(T.t)).toEqual([]);
    resume(); // A calls the port now: the provider accepts; A records the receipt with ITS generation (1 dispatched) → upgrade
    // A recorded its receipt with ITS generation (1 dispatched) → the run is upgraded; A's completion then replays the stored 'sent'
    expect(await aRun).toBe("sent");
    expect(outbox(T.t)).toHaveLength(1);
    expect(await runs(T.t)).toMatchObject([{ state: "done", outcome: "sent" }]);
  });

  it("one outcome rule (R3-r4 finding 2): gen 1 dispatched, the adapter definitively refuses → unconfirmed:<reason>, never refused; refused:* only without a dispatch", async () => {
    const T = await world("Tolak Pertama");
    await setting(T, { ringkasan: "17:00", penerima: ["owner"] });
    const refuser: DigestDeliveryPort = { async sendEmail(d) { return { kind: "refused", key: d.key, reason: "invalid_recipient" }; } };
    expect((await runDigest(app, { now: wib(D, "21:00"), port: refuser })).filter((x) => x.tenantId === T.t)).toMatchObject([{ outcome: "unconfirmed:invalid_recipient" }]);
    expect(await runs(T.t)).toMatchObject([{ state: "done", attempts: 1, outcome: "unconfirmed:invalid_recipient", dispatched_gens: [1] }]);
    expect(mine(await claimAt(app, wib(D, "23:00")), T)).toEqual([]); // terminal for the day (owner policy)
    // the schema refuses refused:* on a dispatched row (CHECK + guard), whoever writes it
    const [r] = await runs(T.t);
    await expect(h.admin.query(`update digest_runs set outcome = 'refused:x_y' where id = $1`, [r.id])).rejects.toMatchObject({ code: expect.stringMatching(/^(42501|23514)$/) });
    const U = await world("Tolak Pertama Cek");
    await setting(U, { ringkasan: "17:00", penerima: ["owner"] });
    const [u] = mine(await claimAt(app, wib(D, "21:00")), U);
    expect(await dispatch(u.id, u.gen)).toMatchObject({ mode: "send" });
    await h.admin.query(`alter table digest_runs disable trigger digest_runs_guard`);
    try {
      await expect(h.admin.query(`update digest_runs set state = 'done', lease_until = null, outcome = 'refused:x_y', finished_at = now() where id = $1`, [u.id]))
        .rejects.toMatchObject({ code: "23514" }); // the CHECK alone
    } finally { await h.admin.query(`alter table digest_runs enable always trigger digest_runs_guard`); }
    await expect(h.admin.query(`update digest_runs set state = 'done', lease_until = null, outcome = 'refused:x_y', finished_at = now() where id = $1`, [u.id]))
      .rejects.toMatchObject({ code: "42501" }); // the guard
  });

  it("receipt beats every closure (R3-r4 finding 1): a reaped, re-queued run gets its receipt (finished sent), the tenant is suspended, and the next claim still serves another live tenant", async () => {
    const A = await world("Kuitansi Antre");
    await setting(A, { ringkasan: "17:00", penerima: ["owner"] });
    const [a] = mine(await claimAt(app, wib(D, "21:00")), A);
    expect(await dispatch(a.id, a.gen)).toMatchObject({ mode: "send" }); // A dispatched gen 1, then stalls
    // an OLDER queued run elsewhere takes the only claim slot, so the reaped A stays queued
    const O = await world("Kuitansi Lain");
    await setting(O, { ringkasan: "17:00", penerima: ["owner"] });
    await h.admin.query(`insert into digest_runs (tenant_id, business_date, recipients, created_at) values ($1, $2, '{owner}', '2026-01-01T00:00:00Z')`, [O.t, plusDay(D, -30)]);
    await expire(a.id);
    const one = await app.query(`select digest_claim($1, 1) r`, [wib(D, "16:00")]).then((r) => r.rows[0].r as Claim[]); // 16:00: nobody newly due
    expect(one.map((c) => c.tenant_id)).toEqual([O.t]);
    expect(await runs(A.t)).toMatchObject([{ state: "queued", dispatched_gens: [1] }]);
    // A's receipt arrives while the run is queued: finished as sent in the same statement
    expect(await app.query(`select digest_delivered($1, $2, 'mock-late') s`, [a.id, a.gen]).then((r) => r.rows[0].s)).toBe("finished");
    expect(await runs(A.t)).toMatchObject([{ state: "done", outcome: "sent" }]);
    await h.admin.query(`update tenants_registry set lifecycle_state = 'suspended' where id = $1`, [A.t]);
    // the next claim succeeds and still claims a live tenant's due run in the same call
    const L = await world("Kuitansi Hidup");
    await setting(L, { ringkasan: "17:00", penerima: ["owner"] });
    const next = await claimAt(app, wib(D, "21:00"));
    expect(mine(next, L)).toMatchObject([{ business_date: D, gen: 1 }]);
    expect(await runs(A.t)).toMatchObject([{ state: "done", outcome: "sent" }]);
  });

  it("receipt beats every closure: a queued receipted row (written before r5 rules could finish it) is closed sent by the non-live closure and the cap — never unconfirmed, never refused", async () => {
    // seed rows that hold a receipt while queued, bypassing digest_delivered (the closure itself is under test)
    const mk = async (label: string, attempts: number) => {
      const W = await world(label);
      await setting(W, { ringkasan: "17:00", penerima: ["owner"] });
      const [c] = mine(await claimAt(app, wib(D, "21:00")), W);
      await dispatch(c.id, c.gen);
      await h.admin.query(`update digest_runs set state = 'queued', lease_until = null, attempts = $2, delivered_at = clock_timestamp(), provider_ref = 'mock-seed' where id = $1`, [c.id, attempts]);
      return W;
    };
    const S = await mk("Kuitansi Tangguh", 1);
    await h.admin.query(`update tenants_registry set lifecycle_state = 'suspended' where id = $1`, [S.t]);
    const C = await mk("Kuitansi Batas", 5);
    // the cap applies to expired leases: lease C again so it expires with a receipt
    await h.admin.query(`update digest_runs set state = 'leased', lease_until = clock_timestamp() - interval '1 second' where tenant_id = $1`, [C.t]);
    const L = await world("Kuitansi Hidup 2");
    await setting(L, { ringkasan: "17:00", penerima: ["owner"] });
    const got = await claimAt(app, wib(D, "21:00"));
    expect(mine(got, L)).toHaveLength(1);
    expect(await runs(S.t)).toMatchObject([{ state: "done", outcome: "sent" }]);
    expect(await runs(C.t)).toMatchObject([{ state: "done", outcome: "sent" }]);
  });

  it("recovery without live reads: a suspended tenant's unconfirmed run → unconfirmed:not_live (no facts read, nothing sent); a never-dispatched one → refused:not_live", async () => {
    const S = await world("Ditangguhkan Kirim");
    await setting(S, { ringkasan: "17:00", penerima: ["owner"] });
    const [s1] = mine(await claimAt(app, wib(D, "21:00")), S);
    expect(await dispatch(s1.id, s1.gen)).toMatchObject({ mode: "send" }); // a send was authorized; the worker then died
    const N = await world("Ditangguhkan Antre");
    await setting(N, { ringkasan: "17:00", penerima: ["owner"] });
    const [n1] = mine(await claimAt(app, wib(D, "21:00")), N); // claimed, never dispatched
    for (const w of [S, N]) await h.admin.query(`update tenants_registry set lifecycle_state = 'suspended' where id = $1`, [w.t]);
    await expire(s1.id); await expire(n1.id);
    const before = outbox(S.t).length;
    expect(mine(await claimAt(app, wib(D, "21:00")), S)).toEqual([]); // the claim closes both, reading no facts
    expect(await runs(S.t)).toMatchObject([{ state: "done", outcome: "unconfirmed:not_live", dispatched_gens: [1] }]);
    expect(await runs(N.t)).toMatchObject([{ state: "done", outcome: "refused:not_live", dispatched_gens: [] }]);
    expect(outbox(S.t)).toHaveLength(before);
    // a re-queued unconfirmed run (reaped while live, not yet re-leased: claim limit 1 spent on another run) of a tenant then suspended
    const Q = await world("Ditangguhkan Ulang");
    await setting(Q, { ringkasan: "17:00", penerima: ["owner"] });
    const [q1] = mine(await claimAt(app, wib(D, "21:00")), Q);
    expect(await dispatch(q1.id, q1.gen)).toMatchObject({ mode: "send" });
    await expire(q1.id);
    await h.admin.query(`update tenants_registry set lifecycle_state = 'suspended' where id = $1`, [Q.t]);
    await claimAt(app, wib(D, "21:00"));
    expect(await runs(Q.t)).toMatchObject([{ state: "done", outcome: "unconfirmed:not_live", dispatched_gens: [1] }]);
  });

  it("NULL-strict SQL boundary (R3-r3 finding 4): a NULL generation is rejected by dispatch, delivered and complete before any state write", async () => {
    const T = await world("Kosong Gen");
    await setting(T, { ringkasan: "17:00", penerima: ["owner"] });
    const [c] = mine(await claimAt(app, wib(D, "21:00")), T);
    expect(await code(dispatch(c.id, null))).toBe("22023");
    expect(await runs(T.t)).toMatchObject([{ state: "leased", dispatched_gens: [] }]);
    expect(await dispatch(c.id, c.gen)).toMatchObject({ mode: "send" });
    expect(await code(app.query(`select digest_delivered($1, null, 'mock-x')`, [c.id]))).toBe("22023");
    expect(await code(app.query(`select digest_complete($1, null, 'refused:x_y')`, [c.id]))).toBe("22023");
    expect(await code(app.query(`select digest_delivered(null, $1, 'mock-x')`, [c.gen]))).toBe("22023");
    expect(await runs(T.t)).toMatchObject([{ state: "dispatching", outcome: null, dispatched_gens: [1] }]);
    // the same generation cannot authorize a second send
    expect(await code(dispatch(c.id, c.gen))).toBe("40001");
  });

  it("generation fence isolated: A's stale gen-1 dispatch fails ONLY on the generation while B holds an unexpired gen-2 lease — before and during B's dispatch", async () => {
    const T = await world("Pagar");
    await setting(T, { ringkasan: "17:00", penerima: ["owner"] });
    const [a] = mine(await claimAt(app, wib(D, "21:00")), T);
    expect((await facts(app, T.t, a.id, a.gen)).clinic).toBe("PT Pagar Sintetis");
    await expire(a.id);
    const [b] = mine(await claimAt(app, wib(D, "21:00")), T);
    expect([b.id, b.gen]).toEqual([a.id, 2]);
    const row = async () => (await h.admin.query(`select state, lease_gen, recipients, lease_until > clock_timestamp() live, dispatched_gens from digest_runs where id = $1`, [a.id])).rows[0];
    expect(await row()).toEqual({ state: "leased", lease_gen: 2, recipients: ["owner"], live: true, dispatched_gens: [] });
    expect(await code(dispatch(a.id, a.gen))).toBe("40001");
    expect(await code(facts(app, T.t, a.id, a.gen))).toBe("42501");
    expect(await row()).toEqual({ state: "leased", lease_gen: 2, recipients: ["owner"], live: true, dispatched_gens: [] });
    expect(await dispatch(b.id, b.gen)).toEqual({ mode: "send", recipients: ["owner"] });
    expect(await row()).toEqual({ state: "dispatching", lease_gen: 2, recipients: ["owner"], live: true, dispatched_gens: [2] });
    expect(await code(dispatch(a.id, a.gen))).toBe("40001");
    expect(await code(app.query(`select digest_complete($1, $2, 'refused:x_y')`, [a.id, a.gen]))).toBe("40001");
    expect(await row()).toEqual({ state: "dispatching", lease_gen: 2, recipients: ["owner"], live: true, dispatched_gens: [2] });
    expect(outbox(T.t)).toEqual([]);
    const aw = countingPort();
    expect(await quiet(() => runOne(app, a, aw.port))).toBeNull();
    expect(aw.calls).toEqual({ send: 0 });
  });

  it("lease expiry around delivery: a lease that runs out after the facts read and before dispatch is refused at dispatch — no send", async () => {
    const T = await world("Kedaluwarsa Kirim");
    await setting(T, { ringkasan: "17:00", penerima: ["owner"] });
    const [a] = mine(await claimAt(app, wib(D, "21:00")), T);
    await facts(app, T.t, a.id, a.gen);
    await expire(a.id);
    expect(await code(dispatch(a.id, a.gen))).toBe("40001");
    expect(outbox(T.t)).toEqual([]);
    const [b] = mine(await claimAt(app, wib(D, "21:00")), T);
    expect(await runOne(app, b, freshPort())).toBe("sent");
    expect(outbox(T.t)).toHaveLength(1);
  });

  it("durable receipt: accepted and recorded, then completion fails; the next worker recovers 'sent' without calling the port — also after an opt-out", async () => {
    for (const optOut of [false, true]) {
      const T = await world(optOut ? "Pulih Berhenti" : "Pulih");
      await setting(T, { ringkasan: "17:00", penerima: ["owner", "finance"] });
      const [a] = mine(await claimAt(app, wib(D, "21:00")), T);
      expect(await dispatch(a.id, a.gen)).toMatchObject({ mode: "send" });
      await app.query(`select digest_delivered($1, $2, 'mock-accepted')`, [a.id, a.gen]); // the receipt; completion never ran
      if (optOut) await settingNow(T, { ringkasan: null, penerima: ["owner"] });
      // a live lease of a new generation (as if B claimed at the instant A's lease ran out): dispatch recovers, never re-authorizes
      await h.admin.query(`update digest_runs set state = 'leased', lease_gen = 2, attempts = 2, lease_until = clock_timestamp() + interval '5 minutes' where id = $1`, [a.id]);
      expect(await dispatch(a.id, 2)).toEqual({ mode: "recover" });
      const bw = countingPort();
      expect(await runOne(app, { ...a, gen: 2 }, bw.port)).toBe("sent");
      expect(bw.calls).toEqual({ send: 0 });
      expect(await runs(T.t)).toMatchObject([{ state: "done", outcome: "sent" }]);
      expect(await code(app.query(`select digest_complete($1, 2, 'refused:x_y')`, [a.id]))).toBe("40001"); // never a refusal over a receipt
    }
    // the reaper finishes an expired run with a receipt as 'sent'
    const R = await world("Pulih Reaper");
    await setting(R, { ringkasan: "17:00", penerima: ["owner"] });
    const [r] = mine(await claimAt(app, wib(D, "21:00")), R);
    await dispatch(r.id, r.gen);
    await app.query(`select digest_delivered($1, $2, 'mock-r')`, [r.id, r.gen]);
    await expire(r.id);
    expect(mine(await claimAt(app, wib(D, "21:00")), R)).toEqual([]);
    expect(await runs(R.t)).toMatchObject([{ state: "done", outcome: "sent" }]);
  });

  it("retry of an unconfirmed run re-sends with the SAME key when authority still allows; a port refusal after an earlier dispatch is unconfirmed, not refused", async () => {
    const T = await world("Ulang");
    await setting(T, { ringkasan: "17:00", penerima: ["owner"] });
    expect((await quiet(() => runDigest(app, { now: wib(D, "21:00"), port: countingPort({ throwOnSend: true }).port }))).filter((x) => x.tenantId === T.t)).toMatchObject([{ outcome: null }]);
    await expire((await runs(T.t))[0].id as string);
    const ok = countingPort();
    expect((await runDigest(app, { now: wib(D, "21:00"), port: ok.port })).filter((x) => x.tenantId === T.t)).toMatchObject([{ outcome: "sent" }]);
    expect(ok.calls.send).toBe(1);
    expect(outbox(T.t).map((m) => m.key)).toEqual([digestKey(T.t, D, "email")]);
    // a port refusal on the retry of an unconfirmed run: unconfirmed:<reason>
    const U = await world("Ulang Tolak");
    await setting(U, { ringkasan: "17:00", penerima: ["owner"] });
    expect((await quiet(() => runDigest(app, { now: wib(D, "21:00"), port: countingPort({ throwOnSend: true }).port }))).filter((x) => x.tenantId === U.t)).toMatchObject([{ outcome: null }]);
    await expire((await runs(U.t))[0].id as string);
    const refuser: DigestDeliveryPort = { async sendEmail(d) { return { kind: "refused", key: d.key, reason: "identifier_found" }; } };
    expect((await runDigest(app, { now: wib(D, "21:00"), port: refuser })).filter((x) => x.tenantId === U.t)).toMatchObject([{ outcome: "unconfirmed:identifier_found" }]);
    expect(await runs(U.t)).toMatchObject([{ state: "done", outcome: "unconfirmed:identifier_found", dispatched_gens: [1, 2] }]);
  });

  it("send-time authority: opt-out / a removed role / not live — refused:* when nothing was ever dispatched, unconfirmed:* when a send was authorized before", async () => {
    // never dispatched: refused
    const Z = await world("Kosong");
    await setting(Z, { ringkasan: "17:00", penerima: ["finance"] });
    const [z] = mine(await claimAt(app, wib(D, "21:00")), Z);
    await settingNow(Z, { ringkasan: "17:00", penerima: ["admin_pusat"] });
    expect(await dispatch(z.id, z.gen)).toEqual({ mode: "closed", outcome: "refused:no_recipients" });
    const L = await world("Ditangguhkan");
    await setting(L, { ringkasan: "17:00", penerima: ["owner"] });
    const [l] = mine(await claimAt(app, wib(D, "21:00")), L);
    expect((await facts(app, L.t, l.id, l.gen)).clinic).toBe("PT Ditangguhkan Sintetis");
    await h.admin.query(`update tenants_registry set lifecycle_state = 'suspended' where id = $1`, [L.t]);
    expect(await dispatch(l.id, l.gen)).toEqual({ mode: "closed", outcome: "refused:not_live" });
    // dispatched before (the send threw), then the owner opts out: unconfirmed:opted_out
    const O = await world("Berhenti");
    await setting(O, { ringkasan: "17:00", penerima: ["owner", "finance"] });
    expect((await quiet(() => runDigest(app, { now: wib(D, "21:00"), port: countingPort({ throwOnSend: true }).port }))).filter((x) => x.tenantId === O.t)).toMatchObject([{ outcome: null }]);
    await settingNow(O, { ringkasan: null, penerima: ["owner"] });
    await expire((await runs(O.t))[0].id as string);
    expect((await runDigest(app, { now: wib(D, "21:00"), port: freshPort() })).filter((x) => x.tenantId === O.t)).toEqual([expect.objectContaining({ outcome: "unconfirmed:opted_out" })]);
    // dispatched before, finance removed: the retry re-sends to the owner only, same key
    const R = await world("Penerima");
    await setting(R, { ringkasan: "17:00", penerima: ["owner", "finance"] });
    expect((await quiet(() => runDigest(app, { now: wib(D, "21:00"), port: countingPort({ throwOnSend: true }).port }))).filter((x) => x.tenantId === R.t)).toMatchObject([{ outcome: null }]);
    await settingNow(R, { ringkasan: "17:00", penerima: ["owner"] });
    await expire((await runs(R.t))[0].id as string);
    expect((await runDigest(app, { now: wib(D, "21:00"), port: freshPort() })).filter((x) => x.tenantId === R.t)).toMatchObject([{ outcome: "sent" }]);
    expect(outbox(R.t).map((m) => m.recipients)).toEqual([["owner"]]);
    for (const w of [O, Z, L]) expect(outbox(w.t)).toEqual([]);
  });

  it("fresh clock after the locks (R3-r2 finding 1): a dispatch BLOCKED behind the owner's open settings transaction sees a SET-37 change written AFTER it began waiting; no expired lease is handed out", async () => {
    const { setTimeout: sleep } = await import("node:timers/promises");
    const until = async (sql: string, args: unknown[] = []) => {
      for (let i = 0; i < 400; i++) { if ((await h.admin.query(sql, args)).rows[0].ok) return true; await sleep(25); }
      return false;
    };
    // connection 1 = the owner's settings command (setting_set: the actor lock — staff_access — first, as in production): a harmless SET-20
    // write takes the lock; then it waits; then (after dispatch is blocked) it writes the SET-37 change and commits
    const ownerTx = (T: W, change: unknown | null) => {
      let release!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      const done = (async () => {
        const ctx = await resolveContext(app, T.own.acc, { tenantId: T.t, actingRole: "owner" });
        await withTenantContext(app, ctx, async (db) => {
          await changeSetting(db, { key: "SET-20", branchId: null, value: 15 as never, reason: "Kunci uji" });
          await gate;
          if (change !== null) await changeSetting(db, { key: "SET-37", branchId: null, value: change as never, reason: "Ubah ringkasan" });
        });
      })();
      return { release, done };
    };
    const lockHeld = () => until(`select count(*) > 0 ok from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where l.locktype = 'advisory' and l.granted and a.datname = current_database() and a.state = 'idle in transaction'`);
    const dispatchBlocked = () => until(`select count(*) > 0 ok from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'
      and query like 'select digest_dispatch%'`);
    const scenario = async (label: string, change: unknown) => {
      const T = await world(label);
      await setting(T, { ringkasan: "17:00", penerima: ["owner", "finance"] });
      const [c] = mine(await claimAt(app, wib(D, "21:00")), T);
      const o = ownerTx(T, change);
      expect(await lockHeld(), "the owner holds the staff_access lock").toBe(true);
      const disp = dispatch(c.id, c.gen);
      expect(await dispatchBlocked(), "dispatch waits on the owner's lock").toBe(true);
      await sleep(200);
      o.release(); // the SET-37 version is written now: its effective_from is AFTER dispatch began waiting
      await o.done;
      const out = await disp;
      const row = (await h.admin.query(`select r.state, r.outcome, r.lease_until > clock_timestamp() + interval '4 minutes' fresh_lease,
          r.dispatched_at > v.effective_from after_change
        from digest_runs r, lateral (select max(effective_from) effective_from from setting_versions where tenant_id = r.tenant_id and key = 'SET-37') v
        where r.id = $1`, [c.id])).rows[0];
      return { out, row };
    };
    const off = await scenario("Kunci Berhenti", { ringkasan: null, penerima: ["owner"] });
    expect(off.out).toEqual({ mode: "closed", outcome: "refused:opted_out" });
    expect(off.row).toMatchObject({ state: "done", outcome: "refused:opted_out" });
    const drop = await scenario("Kunci Penerima", { ringkasan: "17:00", penerima: ["owner"] });
    expect(drop.out).toEqual({ mode: "send", recipients: ["owner"] }); // finance removed while dispatch waited
    expect(drop.row).toMatchObject({ state: "dispatching", fresh_lease: true, after_change: true });
    // a lease that runs out WHILE dispatch waits is refused, never handed back as an already-expired lease
    const T = await world("Kunci Habis");
    await setting(T, { ringkasan: "17:00", penerima: ["owner"] });
    const [c] = mine(await claimAt(app, wib(D, "21:00")), T);
    const o = ownerTx(T, null);
    expect(await lockHeld()).toBe(true);
    await h.admin.query(`update digest_runs set lease_until = clock_timestamp() + interval '300 milliseconds' where id = $1`, [c.id]);
    const disp = code(dispatch(c.id, c.gen));
    expect(await dispatchBlocked()).toBe(true);
    await sleep(700); // well past the lease, still blocked
    o.release();
    await o.done;
    expect(await disp).toBe("40001");
    expect(await runs(T.t)).toMatchObject([{ state: "leased", lease_gen: 1 }]);
  });

  it("worker calls refuse ANY binding (R3 finding 3): staff, service, role-only, branch-list-only and active-branch-only contexts", async () => {
    const A = await world("Terikat");
    await setting(A, { ringkasan: "17:00", penerima: ["owner"] });
    const [c] = mine(await claimAt(app, wib(D, "21:00")), A);
    const ownCtx = await resolveContext(app, A.own.acc, { tenantId: A.t, actingRole: "owner" });
    const raw = (settings: Record<string, string>) => async (sql: string, args: unknown[]) => {
      const cl = await app.connect();
      try {
        await cl.query("begin");
        for (const [k, v] of Object.entries(settings)) await cl.query(`select set_config($1, $2, true)`, [k, v]);
        return await cl.query(sql, args);
      } finally { await cl.query("rollback").catch(() => {}); cl.release(); }
    };
    const contexts: [string, (sql: string, args: unknown[]) => Promise<unknown>][] = [
      ["owner", (sql, args) => withTenantContext(app, ownCtx, (db) => db.query(sql, args))],
      ["service", (sql, args) => withTenantContext(app, { tenantId: A.t, allowedBranchIds: "*", roles: [] }, (db) => db.query(sql, args))],
      ["role-only", raw({ "app.roles": "owner" })],
      ["branch-list-only", raw({ "app.allowed_branch_ids": "*" })],
      ["active-branch-only", raw({ "app.active_branch_id": A.b1 })],
    ];
    for (const [name, run] of contexts) {
      expect(await code(run(`select digest_claim(null)`, [])), `${name} claim`).toBe("42501");
      expect(await code(run(`select digest_dispatch($1, $2, null)`, [c.id, c.gen])), `${name} dispatch`).toBe("42501");
      expect(await code(run(`select digest_delivered($1, $2, 'mock-x')`, [c.id, c.gen])), `${name} delivered`).toBe("42501");
      expect(await code(run(`select digest_complete($1, $2, 'refused:x_y')`, [c.id, c.gen])), `${name} complete`).toBe("42501");
    }
    expect(await runs(A.t)).toMatchObject([{ state: "leased", lease_gen: 1 }]); // untouched
  });

  it("digest_facts refuses: unbound; staff (owner, cashier); half-bound; another tenant; a stale generation, a finished run, an unknown id, an expired lease", async () => {
    const A = await world("Otoritas");
    const B = await world("Otoritas Lain");
    await setting(A, { ringkasan: "17:00", penerima: ["owner"] });
    await setting(B, { ringkasan: "17:00", penerima: ["owner"] });
    await pay(B, B.b1, wib(D, "09:00"), 7_300_000);
    const cl = await claimAt(app, wib(D, "17:30"));
    const ca = mine(cl, A)[0]; const cb = mine(cl, B)[0];
    expect((await facts(app, A.t, ca.id, ca.gen)).clinic).toBe("PT Otoritas Sintetis");
    expect(await code(app.query(`select digest_facts($1, $2)`, [ca.id, ca.gen]))).toBe("42501"); // unbound
    const fo = await (async () => {
      const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`dg${++n}@klinik-sintetis.test`])).rows[0].id as string;
      const { staffId } = await createMembership(owner, { tenantId: A.t, accountId: acc, displayName: "Kasir Otoritas" });
      const rid = await assignRole(h.admin, { tenantId: A.t, staffId, role: "fo_cashier" });
      await assignBranch(h.admin, { tenantId: A.t, staffRoleId: rid, branchId: A.b1 });
      return acc;
    })();
    for (const [acc, role, branch] of [[A.own.acc, "owner", undefined], [fo, "fo_cashier", A.b1]] as const) {
      const ctx = await resolveContext(app, acc, { tenantId: A.t, actingRole: role, activeBranchId: branch });
      expect(await code(withTenantContext(app, ctx, (db) => db.query(`select digest_facts($1, $2)`, [ca.id, ca.gen]))), role).toBe("42501");
    }
    const q = `select digest_facts($1, $2)`;
    for (const ctx of [{ tenantId: A.t, allowedBranchIds: "*" as const, roles: ["owner"] }, { tenantId: A.t, allowedBranchIds: "*" as const, roles: [], staffId: A.own.staffId },
      { tenantId: A.t, allowedBranchIds: [A.b1], roles: [] }, { tenantId: A.t, allowedBranchIds: "*" as const, activeBranchId: A.b1, roles: [] }]) {
      expect(await code(withTenantContext(app, ctx, (db) => db.query(q, [ca.id, ca.gen]))), JSON.stringify(ctx)).toBe("42501");
    }
    expect(await code(facts(app, A.t, cb.id, cb.gen))).toBe("42501"); // cross-tenant, both ways
    expect(await code(facts(app, B.t, ca.id, ca.gen))).toBe("42501");
    expect(JSON.stringify(await facts(app, A.t, ca.id, ca.gen))).not.toContain("7300000");
    expect((await facts(app, B.t, cb.id, cb.gen)).branches).toEqual([{ name: "Cabang Otoritas Lain A", k1_rupiah: 7_300_000, k2_rupiah: 0 }, { name: "Cabang Otoritas Lain B", k1_rupiah: 0, k2_rupiah: 0 }]);
    expect(await code(facts(app, A.t, ca.id, ca.gen + 1))).toBe("42501"); // a generation that is not the current one
    expect(await dispatch(cb.id, cb.gen)).toMatchObject({ mode: "send" });
    await app.query(`select digest_delivered($1, $2, 'mock:b')`, [cb.id, cb.gen]);
    await app.query(`select digest_complete($1, $2, 'sent')`, [cb.id, cb.gen]);
    expect(await code(facts(app, B.t, cb.id, cb.gen))).toBe("42501"); // finished
    expect(await code(facts(app, A.t, crypto.randomUUID(), 1))).toBe("42501");
    await expire(ca.id);
    expect(await code(facts(app, A.t, ca.id, ca.gen))).toBe("42501"); // expired lease
  });
});
