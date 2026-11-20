// T-102 increment 4 (TD-31): the practitioner NIK lookup — non-migration slice. No database: a synthetic KEK ring and tenant DEKs, the mock
// SATUSEHAT port, synthetic 16-digit NIKs only (DEC-082, MIG-2). `fetch` is stubbed and asserted never called after every test.
// Proves: the strict NIK; the sealed NIK bound to its tenant, staff member and lookup row (no transplant); the documented Practitioner query;
// the Bundle classifier (one → matched, none → not_found, several → ambiguous and never auto-selected, malformed / HTTP → failed); the worker
// step on the mock port; no NIK in any error, outcome or rendered markup; the UX-23 form never prefilled and never echoing a NIK.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type KekRing, newWrappedDek, type TenantKeys } from "../../../src/lib/keys/envelope";
import {
  classifyPortAnswer, classifyPractitionerBundle, LOOKUP_PURPOSE, LookupInputError, NIK_SYSTEM, openLookupNik, parseNik, practitionerQuery,
  runPractitionerLookup, SANDBOX_FHIR_BASE, sealLookupNik,
} from "../../../src/modules/integrations/satusehat/practitioner-lookup";
import { mockSatusehatPort } from "../../../src/modules/integrations/satusehat/mock";
import { LOOKUP_COPY, NikLookupForm, NikLookupStatus } from "../../../src/app/(app)/satusehat/nik-lookup";

const RING: KekRing = { current: 1, keys: new Map([[1, Buffer.alloc(32, 41)]]) };
const keysFor = (tenantId: string): TenantKeys => {
  const w = newWrappedDek(RING, tenantId, 1);
  return { tenantId, current: w, byVersion: (v) => (v === 1 ? w : undefined) };
};
const T_A = "0b7a2f2e-6a1d-4c2b-9f00-0000000000a1";
const T_B = "0b7a2f2e-6a1d-4c2b-9f00-0000000000b2";
const STAFF_1 = "11111111-1111-4111-8111-111111111111";
const STAFF_2 = "22222222-2222-4222-8222-222222222222";
const LOOKUP_1 = "33333333-3333-4333-8333-333333333333";
const LOOKUP_2 = "44444444-4444-4444-8444-444444444444";
const NIK = "3171011203890001"; // synthetic
const NIK_2 = "3171011203890002"; // synthetic
const KA = keysFor(T_A);
const KB = keysFor(T_B);
const b1 = { staffId: STAFF_1, lookupId: LOOKUP_1 };
const noNik = (x: unknown) => {
  const s = typeof x === "string" ? x : JSON.stringify(x, (_k, v) => (v instanceof Error ? { ...v, message: v.message, name: v.name } : v));
  expect(s).not.toContain(NIK);
  expect(s).not.toContain(NIK.slice(0, 10));
};

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchSpy = vi.fn(() => Promise.reject(new Error("network forbidden in tests")));
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("NIK input", () => {
  it("accepts exactly 16 digits (spaces and dashes typed by a person dropped)", () => {
    expect(parseNik(NIK)).toBe(NIK);
    expect(parseNik("3171 0112 0389 0001")).toBe(NIK);
    expect(parseNik("3171-0112-0389-0001")).toBe(NIK);
  });
  it("refuses everything else with a reason code only — the input never appears in the error", () => {
    for (const bad of ["317101120389000", "31710112038900011", "3171O11203890001", "", null, 3171011203890001, "+6281234567890"]) {
      let err: unknown;
      try { parseNik(bad); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(LookupInputError);
      expect((err as LookupInputError).reason).toBe("nik_format");
      expect((err as Error).message).toBe("NIK harus 16 angka.");
      noNik(err);
      noNik(String(err));
    }
  });
});

describe("sealed NIK (purpose satusehat.lookup_nik, bound to tenant, staff and lookup)", () => {
  it("round-trips for its own row; the ciphertext carries no NIK digits", () => {
    const sealed = sealLookupNik(RING, KA, b1, NIK);
    expect(sealed.startsWith("v1.1.")).toBe(true);
    noNik(sealed);
    expect(openLookupNik(RING, KA, b1, sealed)).toBe(NIK);
    expect(LOOKUP_PURPOSE).toBe("satusehat.lookup_nik");
  });
  it("cannot be transplanted to another staff member's or another lookup's row (refused, never opened to a NIK)", () => {
    const sealed = sealLookupNik(RING, KA, b1, NIK);
    for (const other of [{ staffId: STAFF_2, lookupId: LOOKUP_1 }, { staffId: STAFF_1, lookupId: LOOKUP_2 }]) {
      let err: unknown;
      try { openLookupNik(RING, KA, other, sealed); } catch (e) { err = e; }
      expect((err as LookupInputError).reason).toBe("binding");
      noNik(err);
    }
  });
  it("cannot be opened in another tenant (the envelope AAD) or under another purpose", async () => {
    const sealed = sealLookupNik(RING, KA, b1, NIK);
    expect(() => openLookupNik(RING, KB, b1, sealed)).toThrow();
    const { decryptField } = await import("../../../src/lib/keys/envelope");
    expect(() => decryptField(RING, KA, "patient.identity", sealed)).toThrow(/decryption failed/);
  });
  it("a tampered ciphertext is refused", () => {
    const sealed = sealLookupNik(RING, KA, b1, NIK);
    const p = sealed.split(".");
    p[3] = Buffer.from(Buffer.from(p[3], "base64url").map((x, i) => (i === 0 ? x ^ 1 : x))).toString("base64url");
    expect(() => openLookupNik(RING, KA, b1, p.join("."))).toThrow();
  });
  it("refuses malformed bindings before touching a key", () => {
    expect(() => sealLookupNik(RING, KA, { staffId: "x", lookupId: LOOKUP_1 }, NIK)).toThrow(LookupInputError);
  });
});

describe("the documented Practitioner search and its Bundle", () => {
  it("builds GET {base}/Practitioner?identifier=https://fhir.kemkes.go.id/id/nik|<nik> (Q-19; docs/tasks/T-102.md)", () => {
    const q = practitionerQuery(SANDBOX_FHIR_BASE, NIK);
    expect(q.method).toBe("GET");
    const u = new URL(q.url);
    expect(`${u.origin}${u.pathname}`).toBe(`${SANDBOX_FHIR_BASE}/Practitioner`);
    expect(u.searchParams.get("identifier")).toBe(`${NIK_SYSTEM}|${NIK}`);
    expect(NIK_SYSTEM).toBe("https://fhir.kemkes.go.id/id/nik");
    expect(() => practitionerQuery(SANDBOX_FHIR_BASE, "123")).toThrow(LookupInputError);
  });
  const bundle = (ids: string[], o: { total?: number; type?: string } = {}) => ({
    resourceType: "Bundle", type: o.type ?? "searchset", total: o.total ?? ids.length,
    entry: ids.map((id) => ({ fullUrl: `x/Practitioner/${id}`, resource: { resourceType: "Practitioner", id, identifier: [{ system: NIK_SYSTEM, value: "redacted" }] }, search: { mode: "match" } })),
  });
  it("exactly one Practitioner → matched with its IHS id", () => {
    expect(classifyPractitionerBundle(bundle(["10009880728"]))).toEqual({ state: "matched", ihs: "10009880728" });
  });
  it("no entry (absent or empty) → not_found", () => {
    expect(classifyPractitionerBundle({ resourceType: "Bundle", type: "searchset", total: 0 })).toEqual({ state: "not_found" });
    expect(classifyPractitionerBundle(bundle([]))).toEqual({ state: "not_found" });
  });
  it("several → ambiguous, never auto-selecting one (TD-31); the same id twice is one practitioner", () => {
    expect(classifyPractitionerBundle(bundle(["10009880728", "10009880729"]))).toEqual({ state: "ambiguous", count: 2 });
    expect(classifyPractitionerBundle(bundle(["10009880728", "10009880728"]))).toEqual({ state: "matched", ihs: "10009880728" });
  });
  it("malformed → failed: not a Bundle, wrong type, another resource type, missing / bad id, total disagreeing, entry not an array", () => {
    for (const bad of [null, "x", { resourceType: "OperationOutcome" }, bundle(["1000"], { type: "transaction" }),
      { resourceType: "Bundle", entry: [{ resource: { resourceType: "Patient", id: "P1000" } }] },
      { resourceType: "Bundle", entry: [{ resource: { resourceType: "Practitioner" } }] },
      { resourceType: "Bundle", entry: [{ resource: { resourceType: "Practitioner", id: "<script>" } }] },
      bundle(["10009880728"], { total: 2 }), { resourceType: "Bundle", entry: {} }]) {
      expect(classifyPractitionerBundle(bad), JSON.stringify(bad)).toEqual({ state: "failed", reason: "malformed" });
    }
  });
  it("port errors → failed with the error class only", () => {
    expect(classifyPortAnswer({ kind: "http_5xx", status: 503 })).toEqual({ state: "failed", reason: "http_5xx" });
    expect(classifyPortAnswer({ kind: "timeout" })).toEqual({ state: "failed", reason: "timeout" });
    expect(classifyPortAnswer({ kind: "http_4xx", status: 401, code: "login", path: null, body: {} })).toEqual({ state: "failed", reason: "http_4xx" });
  });
});

describe("the worker step on the mock port (no live call)", () => {
  const now = new Date("2026-11-19T05:00:00Z");
  const packet = (o: Partial<Parameters<typeof runPractitionerLookup>[0]> = {}) => ({
    lookupId: LOOKUP_1, staffId: STAFF_1, nikEnc: sealLookupNik(RING, KA, b1, NIK), expiresAt: "2026-11-19T05:10:00Z", environment: "sandbox" as const, ...o,
  });
  const deps = (port = mockSatusehatPort()) => ({ port, ring: RING, keys: KA, token: async () => "tok-synthetic-1", clock: () => now });
  it("one practitioner for the NIK → matched; the port saw the NIK, the outcome does not carry it", async () => {
    const port = mockSatusehatPort();
    port.practitioners.set(NIK, ["10009880728"]);
    const out = await runPractitionerLookup(packet(), deps(port));
    expect(out).toEqual({ state: "matched", ihs: "10009880728" });
    expect(port.count("practitioner")).toBe(1);
    noNik(out);
    noNik(port.calls);
  });
  it("none → not_found; two → ambiguous (no link chosen)", async () => {
    const port = mockSatusehatPort();
    port.practitioners.set(NIK_2, ["10009880728", "10009880730"]);
    expect(await runPractitionerLookup(packet(), deps(port))).toEqual({ state: "not_found" });
    const two = packet({ nikEnc: sealLookupNik(RING, KA, b1, NIK_2) });
    expect(await runPractitionerLookup(two, deps(port))).toEqual({ state: "ambiguous", count: 2 });
  });
  it("expired, erased (nik_enc null), missing keys, a transplanted seal, a token failure or a thrown port → failed with a reason, no call when refused early", async () => {
    const port = mockSatusehatPort();
    expect(await runPractitionerLookup(packet({ expiresAt: "2026-11-19T04:59:59Z" }), deps(port))).toEqual({ state: "failed", reason: "expired" });
    expect(await runPractitionerLookup(packet({ nikEnc: null }), deps(port))).toEqual({ state: "failed", reason: "expired" });
    expect(await runPractitionerLookup(packet(), { ...deps(port), keys: null })).toEqual({ state: "failed", reason: "keys" });
    expect(await runPractitionerLookup(packet({ staffId: STAFF_2 }), deps(port))).toEqual({ state: "failed", reason: "binding" });
    expect(await runPractitionerLookup(packet(), { ...deps(port), keys: KB })).toEqual({ state: "failed", reason: "binding" });
    expect(await runPractitionerLookup(packet(), { ...deps(port), token: async () => { throw new Error(`token for ${NIK}`); } })).toEqual({ state: "failed", reason: "token" });
    expect(port.count("practitioner")).toBe(0);
    port.next("practitioner", { kind: "throw" });
    expect(await runPractitionerLookup(packet(), deps(port))).toEqual({ state: "failed", reason: "lost" });
    port.next("practitioner", { kind: "http_5xx" });
    expect(await runPractitionerLookup(packet(), deps(port))).toEqual({ state: "failed", reason: "http_5xx" });
  });
});

// review b62a4c56 F2: a lookup valid on entry that expires while the token is being acquired is never opened or sent.
describe("expiry is rechecked after the token wait (fresh clock; no disclosure after expires_at)", () => {
  const packet = () => ({ lookupId: LOOKUP_1, staffId: STAFF_1, nikEnc: sealLookupNik(RING, KA, b1, NIK), expiresAt: "2026-11-19T05:10:00Z", environment: "sandbox" as const });
  it("the clock crosses expires_at during token acquisition → failed/expired and zero practitioner searches", async () => {
    const port = mockSatusehatPort();
    port.practitioners.set(NIK, ["10009880728"]);
    let t = new Date("2026-11-19T05:09:59Z").getTime(); // valid on entry
    const out = await runPractitionerLookup(packet(), { port, ring: RING, keys: KA, clock: () => new Date(t),
      token: async () => { t = new Date("2026-11-19T05:10:00Z").getTime(); return "tok-synthetic-1"; } }); // expires while the token is pending
    expect(out).toEqual({ state: "failed", reason: "expired" });
    expect(port.count("practitioner")).toBe(0);
    noNik(out);
  });
  it("control: the same lookup still valid after the token wait is searched once", async () => {
    const port = mockSatusehatPort();
    port.practitioners.set(NIK, ["10009880728"]);
    let t = new Date("2026-11-19T05:09:58Z").getTime();
    const out = await runPractitionerLookup(packet(), { port, ring: RING, keys: KA, clock: () => new Date(t),
      token: async () => { t = new Date("2026-11-19T05:09:59Z").getTime(); return "tok-synthetic-1"; } });
    expect(out).toEqual({ state: "matched", ihs: "10009880728" });
    expect(port.count("practitioner")).toBe(1);
  });
  it("a token failure never opens the NIK (refused before the seal is read): a transplanted seal with a failing token reports token, not binding", async () => {
    const port = mockSatusehatPort();
    const out = await runPractitionerLookup({ ...packet(), staffId: STAFF_2 }, { port, ring: RING, keys: KA, clock: () => new Date("2026-11-19T05:00:00Z"),
      token: async () => { throw new Error("token"); } });
    expect(out).toEqual({ state: "failed", reason: "token" });
    expect(port.count("practitioner")).toBe(0);
  });
});

describe("UX-23 lookup form and status (never renders a NIK)", () => {
  const ctx = { t: T_A, r: "facility_head", b: "" };
  it("the NIK input is a password field, autocomplete off, never prefilled; no NIK in the markup", () => {
    const out = renderToStaticMarkup(h(NikLookupForm, { action: "/satusehat", ctx, cabang: "b", staff: STAFF_1, name: "dr. Ayu", idempotencyKey: LOOKUP_1 }));
    const nikInput = /<input[^>]*name="nik"[^>]*>/.exec(out)?.[0] ?? "";
    expect(nikInput).toContain('type="password"');
    expect(nikInput).toMatch(/autocomplete="off"/i);
    expect(nikInput).not.toContain("value=");
    expect(out).toMatch(/<form[^>]*autocomplete="off"/i);
    expect(out).toContain("Cari Nomor IHS");
    expect(out).toContain("lalu dihapus");
    noNik(out);
  });
  it("status shows outcome words only (and never an IHS for the other states)", () => {
    for (const state of Object.keys(LOOKUP_COPY) as (keyof typeof LOOKUP_COPY)[]) {
      const out = renderToStaticMarkup(h(NikLookupStatus, { status: { state, requestedAt: "2026-11-19T05:00:00Z" } }));
      expect(out).toContain(LOOKUP_COPY[state].text);
      expect(out).toContain(`data-lookup="${state}"`);
      noNik(out);
    }
    expect(renderToStaticMarkup(h(NikLookupStatus, { status: null }))).toBe("");
    expect(LOOKUP_COPY.ambiguous.text).toMatch(/Lebih dari satu/);
  });
});
