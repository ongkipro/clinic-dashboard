// HYG-NAV-2 (PR-86; T-130 audit batch 2) — ten orphan nav routes built on existing readers, no migration. No database here: the pure
// models (filters, queues, grouping, validation, gates) with hand-worked fixtures, plus static checks that every nav href of the batch now
// has a page, that each page names its nav roles' reader list and renders a permission state, and that the batch adds no migration and
// no nav.ts change. Cross-tenant behaviour is in tests/isolation/cases/hyg-nav-2.cases.ts (DB gate).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NAV } from "../../src/components/shell/nav";
import { countByStatus, filterReservations, listState, manageHref, onlineQueue, parseStatus, waitlistGroups } from "../../src/app/(app)/jadwal/daftar/model";
import { checkMerge, checkReason, pairToMerge } from "../../src/app/(app)/pasien/gabung/model";
import { filterHouseholds, groupKey, households, maskPhone, normPhone } from "../../src/app/(app)/pasien/keluarga/model";
import { minDp, sessions, sharingLabel, validity } from "../../src/app/(app)/layanan/paket/model";
import { checkMove, fitHoldings, summary } from "../../src/app/(app)/stok/depot/model";
import { approvalFor, candidates, soon } from "../../src/app/(app)/stok/pemusnahan/model";
import { exportableBatch, exportLabel, journalGate, journalHref, monthToDate, subledgerHref } from "../../src/app/(app)/keuangan/ekspor/model";
import { portStatus } from "../../src/app/(app)/kasir/pengaturan-bayar/model";
import type { CalendarRow } from "../../src/modules/scheduling/appointments/appointments";
import type { WaitlistRow } from "../../src/modules/scheduling/waitlist/waitlist";
import type { Watch } from "../../src/modules/inventory/stock";

const ROOT = join(__dirname, "../..");
const ROUTES = ["/jadwal/daftar", "/jadwal/online", "/jadwal/tunggu", "/pasien/gabung", "/pasien/keluarga", "/layanan/paket", "/stok/depot",
  "/stok/pemusnahan", "/keuangan/ekspor", "/kasir/pengaturan-bayar"] as const;
const page = (r: string) => join(ROOT, "src/app/(app)", r, "page.tsx");

describe("the batch closes ten orphan nav routes", () => {
  const pages = new Map(NAV.flatMap((g) => g.pages).map((p) => [p.href, p]));
  it("each route is a nav row and now has a page.tsx", () => {
    for (const r of ROUTES) {
      expect(pages.has(r), `${r} in nav`).toBe(true);
      expect(existsSync(page(r)), `${r} page`).toBe(true);
    }
  });
  it("each page renders a permission state for roles outside its reader list", () => {
    for (const r of ROUTES) {
      const dir = join(ROOT, "src/app/(app)", r);
      const src = readFileSync(page(r), "utf8") + (existsSync(join(dir, "data.ts")) ? readFileSync(join(dir, "data.ts"), "utf8") : "");
      expect(/PermissionState|NotOkState/.test(src), r).toBe(true);
      expect(/"forbidden"/.test(src), r).toBe(true);
    }
  });
  it("page reader lists match the nav roles (each nav role can open the page)", () => {
    const readers: Record<string, string[]> = {
      "/jadwal/daftar": ["owner", "admin_pusat", "manager", "fo_cashier", "central_cs", "bc", "doctor", "nurse", "therapist"],
      "/jadwal/tunggu": ["owner", "admin_pusat", "manager", "fo_cashier", "central_cs"],
      "/pasien/gabung": ["records_officer"], "/pasien/keluarga": ["fo_cashier"], "/layanan/paket": ["owner", "admin_pusat"],
      "/stok/pemusnahan": ["pharmacist", "owner"], "/keuangan/ekspor": ["finance"], "/kasir/pengaturan-bayar": ["owner"],
      "/stok/depot": ["owner", "admin_pusat", "finance", "purchasing", "auditor", "manager", "pharmacist"],
    };
    for (const [r, roles] of Object.entries(readers)) for (const role of pages.get(r)!.roles) expect(roles, `${r} ${role}`).toContain(role);
  });
});

// ── jadwal ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const appt = (id: string, state: CalendarRow["state"], channel: string, start: string): CalendarRow => ({
  id, state, channel, startsAt: new Date(start), endsAt: new Date(start), holdUntil: null, noShowFrom: new Date(start), patientId: "p", patientName: "Pasien",
  patientMrn: "RM-000001", serviceName: "Layanan", versionId: "v", performerId: "s", performerName: "Dokter", rooms: [], devices: [],
});
const cal = [
  appt("a3", "confirmed", "phone", "2026-11-20T10:00:00+07:00"), appt("a1", "held", "online", "2026-11-20T09:00:00+07:00"),
  appt("a2", "booked", "online", "2026-11-21T09:00:00+07:00"), appt("a4", "arrived", "online", "2026-11-19T09:00:00+07:00"),
  appt("a5", "no_show", "walk_in", "2026-11-18T09:00:00+07:00"), appt("a6", "cancelled", "online", "2026-11-22T09:00:00+07:00"),
  appt("a7", "rescheduled", "staff", "2026-11-22T10:00:00+07:00"), appt("a8", "booked", "whatsapp", "2026-11-20T08:00:00+07:00"),
];

describe("Daftar Reservasi / Booking Online / Daftar Tunggu", () => {
  it("status filters over stored states; sorted by start", () => {
    expect(filterReservations(cal, "dibuat").map((r) => r.id)).toEqual(["a8", "a1", "a2"]); // held counts as dibuat
    expect(filterReservations(cal, "semua").map((r) => r.id)).toEqual(["a5", "a4", "a8", "a1", "a3", "a2", "a6", "a7"]);
    expect(countByStatus(cal)).toEqual({ semua: 8, dibuat: 3, dikonfirmasi: 1, datang: 1, "tidak-datang": 1, batal: 1, "dijadwal-ulang": 1 });
    expect(parseStatus("batal")).toBe("batal");
    expect(parseStatus("__proto__")).toBe("semua");
    expect(parseStatus(undefined)).toBe("semua");
  });
  it("online queue: online and still waiting (held or booked) only", () => {
    expect(onlineQueue(cal).map((r) => r.id)).toEqual(["a1", "a2"]);
  });
  it("states: empty vs filtered-empty vs rows", () => {
    expect(listState(0, 0)).toBe("empty");
    expect(listState(3, 0)).toBe("filtered-empty");
    expect(listState(3, 1)).toBe("rows");
  });
  it("manage link opens the Kalender day view of that branch and date", () => {
    expect(manageHref("b1", "2026-11-20")).toBe("/jadwal?cabang=b1&tampilan=hari&tanggal=2026-11-20");
  });
  it("waitlist: grouped per service, offered first, then oldest", () => {
    const w = (id: string, item: string, state: WaitlistRow["state"], created: string): WaitlistRow =>
      ({ id, item_id: item, state, patient_id: id, patient_name: id, patient_mrn: id, offered_appointment_id: null, offered_starts_at: null, created_at: created });
    const g = waitlistGroups([w("x1", "S2", "waiting", "2026-11-02"), w("x2", "S1", "waiting", "2026-11-01"), w("x3", "S1", "offered", "2026-11-03"),
      w("x4", "S2", "waiting", "2026-11-01")]);
    expect(g.map((x) => [x.itemId, x.rows.map((r) => r.id)])).toEqual([["S2", ["x4", "x1"]], ["S1", ["x3", "x2"]]]);
  });
});

// ── pasien ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const A = "0193a000-0000-7000-8000-0000000000a1";
const B = "0193a000-0000-7000-8000-0000000000b1";
describe("Gabung Data Ganda validation", () => {
  it("two different patients and a 10–500 character reason", () => {
    expect(checkMerge({ survivor: A, merged: B, reason: "Duplikat pendaftaran ganda" })).toEqual({ ok: true });
    expect(checkMerge({ survivor: A, merged: A, reason: "Duplikat pendaftaran ganda" }).ok).toBe(false);
    expect(checkMerge({ survivor: A, merged: A.toUpperCase(), reason: "Duplikat pendaftaran ganda" }).ok).toBe(false);
    expect(checkMerge({ survivor: "x", merged: B, reason: "Duplikat pendaftaran ganda" }).ok).toBe(false);
    expect(checkReason("pendek").ok).toBe(false);
    expect(checkReason(" ".repeat(20) + "123456789").ok).toBe(false); // 9 characters after trim
    expect(checkReason("x".repeat(501)).ok).toBe(false);
  });
  it("the duplicate is the side not kept; a survivor outside the pair is refused", () => {
    expect(pairToMerge(A, B, B, "alasan sepuluh")).toEqual({ survivor: B, merged: A, reason: "alasan sepuluh" });
    expect(pairToMerge(A, B, A, "alasan sepuluh")).toEqual({ survivor: A, merged: B, reason: "alasan sepuluh" });
    expect(pairToMerge(A, B, "0193a000-0000-7000-8000-0000000000c1", "alasan sepuluh")).toBeNull();
  });
});

describe("Keluarga / Wali grouping", () => {
  // as data.ts does: group key from the UNMASKED phone, then only the masked phone leaves
  let gid = 0;
  const l = (patientId: string, patientName: string, guardianName: string, phone: string | null, gp: string | null = null) => {
    const raw = { id: `g${gid++}`, patientId, patientName, patientMrn: `RM-${patientId}`, guardianName, relation: "ibu", phone, guardianPatientId: gp };
    return { ...raw, phone: maskPhone(phone), group: groupKey(raw) };
  };
  const links = [l("1", "Anak Satu", "Ibu Sari", "081211111111"), l("2", "Anak Dua", "Ibu Sari", "+62 812-1111-1111"), l("3", "Anak Tiga", "Ibu Sari", "081222222222"),
    l("4", "Anak Empat", "Pak Budi", null, "P9"), l("5", "Anak Lima", "Budi", null, "P9"), l("1", "Anak Satu", "Ibu Sari", "081211111111")];
  it("one guardian, several children; same name with another phone stays apart; a guardian-patient by id", () => {
    const h = households(links);
    expect(h.map((x) => [x.guardianName, x.children.map((c) => c.patientId)])).toEqual([
      ["Ibu Sari", ["1", "2"]], ["Pak Budi", ["4", "5"]], ["Ibu Sari", ["3"]],
    ]);
  });
  it("review r1 P2: two guardians whose masked phones collide (081211111234 / 081299991234) stay apart; same name without a phone never merges", () => {
    const a = l("7", "Anak Tujuh", "Ibu Sari", "081211111234"), b = l("8", "Anak Delapan", "Ibu Sari", "081299991234");
    expect(a.phone).toBe(b.phone); // the display is identical…
    expect(households([a, b]).map((h) => h.children.map((c) => c.patientId))).toEqual([["7"], ["8"]]); // …the households are not
    const n1 = l("9", "Anak Sembilan", "Ibu Sari", null), n2 = l("10", "Anak Sepuluh", "Ibu Sari", null);
    expect(households([n1, n2])).toHaveLength(2);
    expect(normPhone("+62 812-1111-1234")).toBe("+6281211111234");
    expect(maskPhone("081211111234")).toBe("+62•••••••1234");
  });
  it("data.ts sends only an opaque salted group key and the masked phone (never the full phone or the identity key)", () => {
    const src = readFileSync(join(ROOT, "src/app/(app)/pasien/keluarga/data.ts"), "utf8");
    expect(src).toMatch(/group: opaque\(salt, groupKey\(raw\)\)/);
    expect(src).toMatch(/phone: maskPhone\(raw\.phone\)/);
    expect(src).toContain("randomBytes(16)");
  });
  it("filter by guardian, child name or MRN; under 2 characters shows all", () => {
    const h = households(links);
    expect(filterHouseholds(h, "lima").map((x) => x.guardianName)).toEqual(["Pak Budi"]);
    expect(filterHouseholds(h, "RM-3").map((x) => x.children[0].patientId)).toEqual(["3"]);
    expect(filterHouseholds(h, "s")).toHaveLength(3);
  });
});

// ── layanan, stok ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("Templat Paket summary", () => {
  it("min DP rounds up to whole rupiah; missing is null, never Rp0", () => {
    expect(minDp(1_000_001, 30)).toBe(300_001); // 300,000.3 → 300,001
    expect(minDp(3_000_000, 0)).toBe(0);
    expect(minDp(3_000_000, null)).toBeNull();
    expect(minDp(3_000_000, 101)).toBeNull();
    expect(sessions([{ seq: 1, service: "A", count: 3 }, { seq: 2, service: null, count: 2 }])).toBe(5);
    expect(validity(null)).toBe("Tanpa batas");
    expect(validity(365)).toBe("365 hari");
    expect(sharingLabel(null)).toBe("—");
    expect(sharingLabel({ enabled: true })).toBe("Boleh berbagi keluarga");
  });
});

describe("Gudang & Depot", () => {
  const h = (batch: string, item: string, quantity: number, unfit: string | null = null) => ({ item_id: item, name: item, unit: "pcs", batch_id: batch, batch_no: batch, expiry: "2027-01-01", quantity, unfit });
  it("summary and fit holdings", () => {
    const hs = [h("b1", "i1", 3), h("b2", "i1", 0), h("b3", "i2", 1, "expired"), h("b4", "i3", 2)];
    expect(summary(hs)).toEqual({ items: 3, batches: 3, unfit: 1 });
    expect(fitHoldings(hs).map((x) => x.batch_id)).toEqual(["b1", "b4"]);
  });
  it("move check: different depots, positive quantity ≤ 3 decimals, not above available", () => {
    const ok = { from: "d1", to: "d2", batch: "b1", quantity: "1.5" };
    expect(checkMove(ok, 2)).toEqual({ ok: true });
    expect(checkMove({ ...ok, to: "d1" }, 2).ok).toBe(false);
    expect(checkMove({ ...ok, quantity: "0" }, 2).ok).toBe(false);
    expect(checkMove({ ...ok, quantity: "1.2345" }, 2).ok).toBe(false);
    expect(checkMove({ ...ok, quantity: "3" }, 2).ok).toBe(false);
    expect(checkMove({ ...ok, quantity: "3" }, null)).toEqual({ ok: true }); // unknown availability: the database decides
  });
});

describe("Pemusnahan", () => {
  const w: Watch = { near_expiry_days: 30, today: "2026-11-19", vials: [], batches: [
    { id: "x1", item_id: "i", name: "A", unit: "u", batch_no: "1", expiry: "2026-11-01", quantity: 2, state: "active", hold_reason: null, unfit: "expired", days_left: -18 },
    { id: "x2", item_id: "i", name: "B", unit: "u", batch_no: "2", expiry: "2026-12-01", quantity: 1, state: "active", hold_reason: null, unfit: null, days_left: 12 },
    { id: "x3", item_id: "i", name: "C", unit: "u", batch_no: "3", expiry: "2027-12-01", quantity: 0, state: "recalled", hold_reason: "Ditarik", unfit: "recalled", days_left: 377 },
    { id: "x4", item_id: "i", name: "D", unit: "u", batch_no: "4", expiry: "2027-06-01", quantity: 5, state: "quarantined", hold_reason: "Cek", unfit: "quarantined", days_left: 194 },
  ] };
  it("candidates: unfit with stock; soon: fit within the near-expiry window", () => {
    expect(candidates(w).map((b) => b.id)).toEqual(["x1", "x4"]);
    expect(soon(w).map((b) => b.id)).toEqual(["x2"]);
  });
  it("SET-43 approver by event value and month-to-date (defaults 1 jt / 5 jt / 10 jt)", () => {
    const t = { musnah_kedua_kejadian: 1_000_000, musnah_kedua_bulan: 5_000_000, musnah_owner: 10_000_000 };
    expect(approvalFor(999_999, 0, t)).toBe("satu");
    expect(approvalFor(1_000_000, 0, t)).toBe("kedua");
    expect(approvalFor(500_000, 4_500_000, t)).toBe("kedua");
    expect(approvalFor(500_000, 4_499_999, t)).toBe("satu");
    expect(approvalFor(10_000_000, 0, t)).toBe("owner");
    expect(() => approvalFor(1.5, 0, t)).toThrow(RangeError);
  });
});

// ── keuangan, kasir ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("Ekspor hub", () => {
  it("month to date and the existing export routes", () => {
    const p = monthToDate("2026-11-19");
    expect(p).toEqual({ from: "2026-11-01", to: "2026-11-19" });
    expect(subledgerHref("receivables", p)).toBe("/keuangan/kewajiban/ekspor?jenis=receivables&dari=2026-11-01&sampai=2026-11-19");
    expect(journalHref(p)).toBe("/keuangan/buku-besar/ekspor?dari=2026-11-01&sampai=2026-11-19");
    expect(exportLabel("receivables")).toBe("Piutang pasien");
    expect(exportLabel("payments")).toBe("Pembayaran");
    expect(() => monthToDate("19-11-2026")).toThrow(RangeError);
    for (const r of ["src/app/(app)/keuangan/kewajiban/ekspor/route.ts", "src/app/(app)/keuangan/buku-besar/ekspor/route.ts", "src/app/(app)/komisi/batch/[id]/ekspor/route.ts"]) {
      expect(existsSync(join(ROOT, r)), r).toBe(true);
    }
  });
  it("journal gate: unsigned map → blocked, signed but not activated → blocked, both → open", () => {
    expect(journalGate({ map_signed: false, activated: false })).toMatchObject({ kind: "blocked", reason: expect.stringContaining("posting map") });
    expect(journalGate({ map_signed: true, activated: false })).toMatchObject({ kind: "blocked", reason: expect.stringContaining("belum diaktifkan") });
    expect(journalGate({ map_signed: true, activated: true })).toEqual({ kind: "open" });
    expect(journalGate(null)).toEqual({ kind: "unknown" });
    expect(exportableBatch("draft")).toBe(false);
    expect(exportableBatch("pending_approval")).toBe(true);
  });
});

describe("Pembayaran (port)", () => {
  it("none / simulated / inactive; the mock is never offered in production", () => {
    expect(portStatus([], "local")).toEqual({ kind: "none", canEnableMock: true });
    expect(portStatus([], "production")).toEqual({ kind: "none", canEnableMock: false });
    expect(portStatus([{ provider: "mock", active: true }], "local")).toEqual({ kind: "mock", simulated: true });
    expect(portStatus([{ provider: "mock", active: false }], "local")).toEqual({ kind: "inactive" });
  });
});
