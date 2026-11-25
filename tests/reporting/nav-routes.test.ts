// Real-DB behavioral, role-boundary, and rendered-HTML tests for the 5 zero-migration 19 §2 routes:
// /keuangan/mutasi, /audit/internal, /laporan/atribusi, /laporan/audit, /laporan/terjadwal.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadAuditInternalIn, parseAuditFilters, todayJakarta as auditToday } from "../../src/app/(app)/audit/internal/data";
import {
  APPROVALS_UNAVAILABLE,
  EXPORT_UNAVAILABLE,
  STOCK_COUNT_WINDOW_NOTE,
  SUSPICIOUS_COMPOSITE_UNAVAILABLE,
} from "../../src/app/(app)/audit/internal/labels";
import { AuditInternalView } from "../../src/app/(app)/audit/internal/view";
import { loadMutasiIn, parseMutasiFilters, todayJakarta as mutasiToday } from "../../src/app/(app)/keuangan/mutasi/data";
import { EMPTY_MUTASI, SETTLEMENT_UNAVAILABLE } from "../../src/app/(app)/keuangan/mutasi/labels";
import { MutasiView } from "../../src/app/(app)/keuangan/mutasi/view";
import { loadAtribusiIn, parseAtribusiFilters } from "../../src/app/(app)/laporan/atribusi/data";
import { loadTerjadwalIn } from "../../src/app/(app)/laporan/terjadwal/data";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { decideApproval } from "../../src/modules/approvals/approvals";
import { issueKasirInvoice, openKasirInvoice, receivePayment, requestVoid } from "../../src/modules/cashier/kasir/kasir";
import { myShift, openShift, submitShiftCount } from "../../src/modules/cashier/shifts/shifts";
import { publish } from "../../src/modules/catalog/catalog";
import { createLead } from "../../src/modules/crm/leads/leads";
import { saveItem } from "../../src/modules/inventory/stock";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { topUpBalance } from "../../src/modules/packages/packages";
import { changeSetting } from "../../src/modules/settings/settings";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local";

const NOW = new Date("2026-11-25T05:00:00Z");

describe("hyg-nav-3 filter & unavailable contracts (pure)", () => {
  it("parseMutasiFilters rejects malformed branch UUID and inverted/oversized date ranges", () => {
    expect(parseMutasiFilters({}, NOW)).toEqual({
      ok: true,
      filters: { from: "2026-11-01", to: "2026-11-25", branchId: null },
    });
    expect(parseMutasiFilters({ cabang: "not-a-uuid" }, NOW)).toEqual({ ok: false, reason: "bad-branch" });
    expect(parseMutasiFilters({ dari: "2026-11-31" }, NOW)).toEqual({ ok: false, reason: "bad-date" });
    expect(parseMutasiFilters({ dari: "2026-11-20", sampai: "2026-11-10" }, NOW)).toEqual({
      ok: false,
      reason: "bad-date",
    });
    expect(parseMutasiFilters({ dari: "2025-01-01", sampai: "2026-11-25" }, NOW)).toEqual({
      ok: false,
      reason: "bad-date",
    });
    expect(parseMutasiFilters({ dari: "2026-11-26", sampai: "2026-11-26" }, NOW)).toEqual({
      ok: false,
      reason: "bad-date",
    });
    expect(parseMutasiFilters({ cabang: ["019a0000-0000-7000-8000-000000000001", "bad"] }, NOW)).toEqual({
      ok: false,
      reason: "bad-branch",
    });
    expect(parseMutasiFilters({ dari: ["2026-11-01", "2026-11-02"] }, NOW)).toEqual({
      ok: false,
      reason: "bad-date",
    });
    expect(SETTLEMENT_UNAVAILABLE).toContain("Belum tersedia");
    expect(SETTLEMENT_UNAVAILABLE).not.toMatch(/Rp/i);
  });

  it("parseAuditFilters enforces strict UUID/date bounds and exact unavailable texts", () => {
    expect(parseAuditFilters({}, NOW)).toEqual({
      ok: true,
      filters: { from: "2026-11-01", to: "2026-11-25", branchId: null },
    });
    expect(parseAuditFilters({ cabang: "bad" }, NOW)).toEqual({ ok: false, reason: "bad-branch" });
    expect(parseAuditFilters({ cabang: ["019a0000-0000-7000-8000-000000000001", "bad"] }, NOW)).toEqual({
      ok: false,
      reason: "bad-branch",
    });
    expect(parseAuditFilters({ dari: "invalid" }, NOW)).toEqual({ ok: false, reason: "bad-date" });
    expect(parseAuditFilters({ dari: "2026-11-26", sampai: "2026-11-26" }, NOW)).toEqual({
      ok: false,
      reason: "bad-date",
    });
    expect(parseAuditFilters({ sampai: ["2026-11-25", "2026-11-25"] }, NOW)).toEqual({
      ok: false,
      reason: "bad-date",
    });
    expect(APPROVALS_UNAVAILABLE).toContain("Belum tersedia");
    expect(APPROVALS_UNAVAILABLE).not.toMatch(/Rp|0/);
    expect(SUSPICIOUS_COMPOSITE_UNAVAILABLE).toContain("Belum tersedia");
    expect(SUSPICIOUS_COMPOSITE_UNAVAILABLE).not.toMatch(/Tidak ada aktivitas|Rp|0/);
    expect(EXPORT_UNAVAILABLE).toBe("Ekspor belum tersedia");
    expect(STOCK_COUNT_WINDOW_NOTE).toBe("Hitung stok 60 hari terakhir");
  });

  it("parseAtribusiFilters validates branch UUID and calendar date range", () => {
    const validBranch = "019a0000-0000-7000-8000-000000000001";
    expect(parseAtribusiFilters({ dari: "2026-11-01", sampai: "2026-11-15", cabang: validBranch }, NOW)).toEqual({
      ok: true,
      filters: { from: "2026-11-01", to: "2026-11-15", branchId: validBranch },
    });
    expect(parseAtribusiFilters({ cabang: "xyz" }, NOW)).toEqual({ ok: false, reason: "bad-branch" });
    expect(parseAtribusiFilters({ cabang: [validBranch, "xyz"] }, NOW)).toEqual({ ok: false, reason: "bad-branch" });
    expect(parseAtribusiFilters({ sampai: "2026-02-30" }, NOW)).toEqual({ ok: false, reason: "bad-date" });
    expect(parseAtribusiFilters({ dari: "2026-11-26", sampai: "2026-11-26" }, NOW)).toEqual({ ok: false, reason: "bad-date" });
  });
});

describe("hyg-nav-3 real-DB behavioral & HTML privacy checks", () => {
  let h: Harness;
  let owner: pg.Pool;
  let app: pg.Pool;
  let tenantA: string;
  let branchA1: string;
  let branchA2: string;
  let branchB1: string;

  const accounts = new Map<string, string>();
  type RoleName = "owner" | "finance" | "auditor" | "marketing" | "central_cs" | "fo_cashier" | "pharmacist";

  async function member(tenantId: string, branchId: string, role: RoleName): Promise<string> {
    const key = `${tenantId}:${role}`;
    const existing = accounts.get(key);
    if (existing) return existing;
    const acc = (
      await owner.query(
        `insert into auth_user (name, email, two_factor_enabled) values ('Staf', $1, true) returning id`,
        [`${role}.nav3.${tenantId}@klinik-sintetis.test`],
      )
    ).rows[0].id as string;
    const { staffId } = await createMembership(owner, { tenantId, accountId: acc, displayName: `Staf ${role}` });
    const c = await owner.connect();
    try {
      const rid = await assignRole(c, { tenantId, staffId, role });
      if (role === "fo_cashier" || role === "pharmacist") {
        await assignBranch(c, { tenantId, staffRoleId: rid, branchId });
      }
    } finally {
      c.release();
    }
    accounts.set(key, acc);
    return acc;
  }

  async function as<T>(tenantId: string, branchId: string, role: RoleName, fn: (db: pg.ClientBase) => Promise<T>): Promise<T> {
    const acc = await member(tenantId, branchId, role);
    const wide = role !== "fo_cashier" && role !== "pharmacist";
    const ctx = await resolveContext(app, acc, {
      tenantId,
      actingRole: role,
      activeBranchId: wide ? undefined : branchId,
    });
    return withTenantContext(app, ctx, fn);
  }

  beforeAll(async () => {
    h = await createHarness();
    owner = testPool({ connectionString: h.ownerUrl() });
    const login = await h.createLoginRole("NOSUPERUSER NOBYPASSRLS", [APP_GROUP_ROLE]);
    app = await openAppPool({ connectionString: h.urlAs(login) }, APP_GROUP_ROLE);
    const seedTenant = async (name: string, code: string) => {
      const tid = (await owner.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
      await owner.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tid, name]);
      const bid = (
        await owner.query(
          `insert into branches (tenant_id, code, name, timezone) values ($1, $2, $3, 'Asia/Jakarta') returning id`,
          [tid, code, `Cabang ${code}`],
        )
      ).rows[0].id as string;
      return { tid, bid };
    };
    const a = await seedTenant("PT Klinik Nav3 A", "NAV3A");
    const b = await seedTenant("PT Klinik Nav3 B", "NAV3B");
    tenantA = a.tid;
    branchA1 = a.bid;
    branchB1 = b.bid;
    branchA2 = (
      await owner.query(
        `insert into branches (tenant_id, code, name, timezone) values ($1, 'MKS2', 'Cabang Makassar 2', 'Asia/Makassar') returning id`,
        [tenantA],
      )
    ).rows[0].id as string;
  }, 60_000);

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await h?.close();
  });

  it("/keuangan/mutasi agrees with K1 row sum, excludes balance usage, filters branches, and renders settlement unavailable without Rp", async () => {
    const today = mutasiToday();
    const from = `${today.slice(0, 8)}01`;
    await member(tenantA, branchA1, "fo_cashier");
    const staffId = (await owner.query(`select id from staff where tenant_id = $1 limit 1`, [tenantA])).rows[0].id as string;
    const pid = (
      await owner.query(
        `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
         values ($1, 'RM-9999999999001', 'Pasien Sentinel Audit', '1990-05-05', 'female', 'newborn_via_guardian', 'Fixture', 'islam', 'Karyawan', 's1', 'kawin', $2, $3, 'fo_cashier') returning id`,
        [tenantA, branchA1, staffId],
      )
    ).rows[0].id as string;

    // Top-up cash 100k & transfer 200k at branchA1
    await as(tenantA, branchA1, "fo_cashier", (db) =>
      topUpBalance(db, crypto.randomUUID(), pid, null, { method: "cash", amount: 100_000, cashTendered: 100_000 }),
    );
    await as(tenantA, branchA1, "fo_cashier", (db) =>
      topUpBalance(db, crypto.randomUUID(), pid, null, { method: "transfer", amount: 200_000 }),
    );

    // Product sale paid with balance (70k) MUST be excluded from K1
    const itemId = (
      await as(tenantA, branchA1, "owner", (db) =>
        publish(
          db,
          { kind: "product", code: "NAV3-P1" },
          { name: "Serum Sintetis", tax_category: "exempt_medical", tax_basis: "Obat", normal_price: 70_000, unit: "pcs" } as never,
          "Produk nav3",
        ),
      )
    ).itemId;
    await as(tenantA, branchA1, "pharmacist", (db) =>
      saveItem(db, crypto.randomUUID(), null, { catalogItemId: itemId, unit: "pcs", storage: "ruang", highValue: false, active: true }),
    );
    const { invoiceId } = await as(tenantA, branchA1, "fo_cashier", (db) =>
      openKasirInvoice(db, crypto.randomUUID(), { patientId: pid }),
    );
    await as(tenantA, branchA1, "fo_cashier", (db) =>
      issueKasirInvoice(db, crypto.randomUUID(), invoiceId, [{ itemId, quantity: 1 }]),
    );
    await as(tenantA, branchA1, "fo_cashier", (db) =>
      receivePayment(db, crypto.randomUUID(), invoiceId, [{ method: "balance", amount: 70_000 }]),
    );

    const all = await as(tenantA, branchA1, "finance", (db) =>
      loadMutasiIn(db, { from, to: today, branchId: null }),
    );
    expect(all.total).toBe(300_000);
    expect(all.rows.reduce((s, r) => s + r.amount, 0)).toBe(all.total);
    expect(all.byMethod).toEqual([
      { dim: "cash", amount: 100_000 },
      { dim: "transfer", amount: 200_000 },
    ]);

    const b2Only = await as(tenantA, branchA1, "finance", (db) =>
      loadMutasiIn(db, { from, to: today, branchId: branchA2 }),
    );
    expect(b2Only.rows).toEqual([]);

    // Foreign tenant branch must fail with ERR_NOT_FOUND
    await expect(
      as(tenantA, branchA1, "finance", (db) =>
        loadMutasiIn(db, { from, to: today, branchId: branchB1 }),
      ),
    ).rejects.toMatchObject({ code: "ERR_NOT_FOUND" });

    // Rendered HTML checks (settlement unavailable without Rp, empty branch message, zero patient PII)
    const htmlAll = renderToStaticMarkup(createElement(MutasiView, { data: all, today }));
    expect(htmlAll).toContain(SETTLEMENT_UNAVAILABLE);
    expect(htmlAll).not.toContain("Pasien Sentinel Audit");
    expect(htmlAll).not.toContain("RM-9999999999001");
    const settlementBlock = htmlAll.slice(htmlAll.indexOf("Settlement gateway"));
    expect(settlementBlock).not.toMatch(/Rp/i);

    const htmlEmpty = renderToStaticMarkup(createElement(MutasiView, { data: b2Only, today }));
    expect(htmlEmpty).toContain(EMPTY_MUTASI);
  });

  it("/audit/internal surfaces manual discount, void, and cash variance with zero patient identity and blocks finance", async () => {
    const today = auditToday();
    const from = `${today.slice(0, 8)}01`;

    // Use the cashier's auto-opened shift (expected cash = 100,000 from top-up) and submit 50,000 -> variance -50,000
    const existingShift = await as(tenantA, branchA1, "fo_cashier", (db) => myShift(db, branchA1));
    const shiftId =
      existingShift?.id ??
      (await as(tenantA, branchA1, "fo_cashier", (db) => openShift(db, crypto.randomUUID(), { openingFloat: 100_000 }))).shiftId;
    await as(tenantA, branchA1, "fo_cashier", (db) =>
      submitShiftCount(db, crypto.randomUUID(), shiftId, { countedCash: 50_000, reason: "Selisih sintetis" }),
    );

    // Issue invoice with manual discount and void another invoice
    const itemId = (
      await owner.query(`select id from catalog_items where tenant_id = $1 and code = 'NAV3-P1'`, [tenantA])
    ).rows[0].id as string;

    const inv1 = (await as(tenantA, branchA1, "fo_cashier", (db) => openKasirInvoice(db, crypto.randomUUID(), { counter: true }))).invoiceId;
    await as(tenantA, branchA1, "fo_cashier", (db) =>
      issueKasirInvoice(db, crypto.randomUUID(), inv1, [{ itemId, quantity: 1, discount: 15_000 }]),
    );

    // Owner issues >200 applied manual-discount lines (5 invoices x 41 lines = 205 x Rp 1,000 = Rp 205,000) to prove
    // uncapped SQL aggregation AND that inv1's pending unapproved request (Rp 15,000) is excluded from manualDiscountTotal.
    for (let i = 0; i < 5; i++) {
      const invBulk = (await as(tenantA, branchA1, "owner", (db) => openKasirInvoice(db, crypto.randomUUID(), { counter: true, branchId: branchA1 }))).invoiceId;
      await as(tenantA, branchA1, "owner", (db) =>
        issueKasirInvoice(
          db,
          crypto.randomUUID(),
          invBulk,
          Array.from({ length: 41 }, () => ({ itemId, quantity: 1, discount: 1_000 })),
        ),
      );
    }

    const inv2 = (await as(tenantA, branchA1, "fo_cashier", (db) => openKasirInvoice(db, crypto.randomUUID(), { counter: true }))).invoiceId;
    await as(tenantA, branchA1, "fo_cashier", (db) =>
      issueKasirInvoice(db, crypto.randomUUID(), inv2, [{ itemId, quantity: 1 }]),
    );
    const { approvalId } = await as(tenantA, branchA1, "fo_cashier", (db) =>
      requestVoid(db, crypto.randomUUID(), inv2, "Salah input sintetis"),
    );
    await as(tenantA, branchA1, "owner", (db) =>
      decideApproval(db, approvalId, true, "Disetujui sintetis"),
    );

    // Auditor reads all sections cleanly; finance is refused by discount_manual_list at DB boundary
    const data = await as(tenantA, branchA1, "auditor", (db) =>
      loadAuditInternalIn(db, { from, to: today, branchId: null }),
    );
    expect(data.manualDiscounts.length).toBeGreaterThanOrEqual(206);
    expect(data.totals.manualDiscountTotal).toBe(205_000);
    expect(data.totals.paidRefundTotal).toBe(0);
    expect(data.totals.cashVarianceTotal).toBe(-50_000);
    expect(data.voids.length).toBeGreaterThanOrEqual(1);
    expect(data.totals.voidTotal).toBeGreaterThan(0);
    expect(data.cashVariances.some((c) => c.difference === -50_000)).toBe(true);

    await expect(
      as(tenantA, branchA1, "finance", (db) =>
        loadAuditInternalIn(db, { from, to: today, branchId: null }),
      ),
    ).rejects.toThrow();

    await expect(
      as(tenantA, branchA1, "auditor", (db) =>
        loadAuditInternalIn(db, { from, to: today, branchId: branchB1 }),
      ),
    ).rejects.toBeInstanceOf(CommandError);

    // Zero patient identity in rendered HTML + exact unavailable strings
    const html = renderToStaticMarkup(createElement(AuditInternalView, { data, today }));
    expect(html).not.toContain("Pasien Sentinel Audit");
    expect(html).not.toContain("RM-9999999999001");
    expect(html).toContain(APPROVALS_UNAVAILABLE);
    expect(html).toContain(SUSPICIOUS_COMPOSITE_UNAVAILABLE);
    expect(html).toContain(EXPORT_UNAVAILABLE);
    expect(html).toContain(STOCK_COUNT_WINDOW_NOTE);
  });

  it("/laporan/atribusi reads K13 by source/branch and /laporan/terjadwal reads SET-37 schedule", async () => {
    const today = mutasiToday();
    const from = `${today.slice(0, 8)}01`;
    await as(tenantA, branchA1, "central_cs", (db) =>
      createLead(db, crypto.randomUUID(), { source: "referral", branchId: branchA1 }),
    );
    const atr = await as(tenantA, branchA1, "marketing", (db) =>
      loadAtribusiIn(db, { from, to: today, branchId: null }),
    );
    expect(atr.totals.lead).toBeGreaterThanOrEqual(1);
    expect(atr.bySource.some((s) => s.key === "referral" && s.lead >= 1)).toBe(true);
    await expect(
      as(tenantA, branchA1, "marketing", (db) =>
        loadAtribusiIn(db, { from, to: today, branchId: branchB1 }),
      ),
    ).rejects.toMatchObject({ code: "ERR_NOT_FOUND" });

    // /laporan/terjadwal default off -> enabled after SET-37 change
    const before = await as(tenantA, branchA1, "owner", (db) => loadTerjadwalIn(db));
    expect(before.optIn).toEqual({ kind: "out" });
    await as(tenantA, branchA1, "owner", (db) =>
      changeSetting(db, {
        key: "SET-37",
        branchId: null,
        value: { ringkasan: "20:30", penerima: ["owner", "finance"] },
        reason: "Aktifkan ringkasan sintetis",
      }),
    );
    const after = await as(tenantA, branchA1, "owner", (db) => loadTerjadwalIn(db));
    expect(after.optIn).toEqual({ kind: "in", at: "20:30", recipients: ["owner", "finance"] });
  });
});
