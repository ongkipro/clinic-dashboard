// T-115 — Ringkasan Admin Pusat (UX-57, PR-33g) and its PR-63 boundary. No database: the model and view run on
// synthetic facts, and the loader runs against a recording fake client so every SQL it issues is checked. The readers it
// calls are existing `main` readers whose RLS is proven in their own suites (branches, catalog, staff, credentials,
// role requests, approvals); here we prove what this screen owns:
// - Scenario PR-33g: a branch without opening hours is listed as incomplete with "Jam buka belum diisi".
// - PR-63: the screen is Admin Pusat only; it reads no financial or clinical table and renders no money; owner-only
//   approvals (cash refund, write-off, commission batch) are never Admin Pusat's to decide; an Admin Pusat role request
//   for Owner shows as waiting for the Owner, not active.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ ctx: null as unknown, sql: [] as string[], rows: (): unknown[] => [] as unknown[] }) as { ctx: unknown; sql: string[]; rows: (sql: string) => unknown[] });
vi.mock("server-only", () => ({}));
vi.mock("../../src/modules/org/context/store", () => ({ requestContext: async () => io.ctx, appPool: async () => ({}) }));
// The loader suite runs withTenantContext on a recording fake client; every other export stays the real module (the PostgreSQL suite below uses it).
vi.mock("../../src/db/rls/context", async (orig) => ({
  ...(await orig<typeof import("../../src/db/rls/context")>()),
  withTenantContext: async (_p: unknown, _c: unknown, fn: (db: unknown) => Promise<unknown>) =>
    fn({ query: async (sql: string) => { io.sql.push(sql); return { rows: io.rows(sql) }; } }),
}));

const { APPROVAL_TYPES } = await import("../../src/modules/approvals/inbox");
const model = await import("../../src/app/(app)/ringkasan/admin-pusat/model");
const { AdminHome } = await import("../../src/app/(app)/ringkasan/admin-pusat/view");
const { loadAdminHome } = await import("../../src/app/(app)/ringkasan/admin-pusat/data");
type Raw = import("../../src/app/(app)/ringkasan/admin-pusat/model").Raw;
type Props = import("../../src/app/(app)/ringkasan/admin-pusat/model").AdminHomeProps;

const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const html = (p: Props) => renderToStaticMarkup(h(AdminHome, p));
const TODAY = "2026-11-19";
const cred = (staffId: string, kind: string, over: Partial<Raw["credentials"][number]> = {}): Raw["credentials"][number] =>
  ({ staffId, kind, profession: "dokter", state: "verified", validFrom: "2025-01-01", expiresOn: "2027-01-01", superseded: false, ...over });

// Branch A complete; branch B has no opening hours (the scenario) and nothing else missing.
function raw(over: Partial<Raw> = {}): Raw {
  return {
    branches: [
      { id: "a", code: "A01", name: "Cabang A", timezone: "Asia/Jakarta", licenceComplete: true, published: true },
      { id: "b", code: "B01", name: "Cabang B", timezone: "Asia/Makassar", licenceComplete: true, published: false },
    ],
    hours: { a: 7 }, rooms: { a: 2, b: 1 }, services: { a: ["s1"], b: ["s1"] }, activeServiceIds: ["s1"],
    staff: [
      { staffId: "d1", name: "Dokter A", active: true, roles: [{ role: "doctor", branchIds: ["a"] }] },
      { staffId: "m2", name: "Manajer B", active: true, roles: [{ role: "manager", branchIds: ["b"] }] },
    ],
    credentials: [cred("d1", "str"), cred("d1", "sip")],
    invitationsPending: 0, approvalsPending: [], roleRequestsPending: [], today: { a: TODAY, b: TODAY },
    ...over,
  };
}

describe("Scenario PR-33g Admin Pusat setup view", () => {
  it("a branch without opening hours is listed as incomplete with 'Jam buka belum diisi'", () => {
    const d = model.assemble(raw());
    const b = d.branches.find((x) => x.id === "b")!;
    expect(b.issues).toEqual([{ key: "jam", text: "Jam buka belum diisi", href: "/pengaturan/cabang/b#jam" }]);
    expect(d.branches.find((x) => x.id === "a")!.issues).toEqual([]);
    const out = html({ state: { kind: "ready", data: d } });
    expect(out).toMatch(/data-branch="b" data-complete="false"/);
    expect(out).toMatch(/data-branch="a" data-complete="true"/);
    expect(text(out)).toContain("Cabang B 1 belum lengkap");
    expect(text(out)).toContain("Jam buka belum diisi Lengkapi");
    expect(out).toContain('href="/pengaturan/cabang/b#jam"');
    expect(out.indexOf('data-branch="b"')).toBeLessThan(out.indexOf('data-branch="a"')); // incomplete first
  });

  it("names every other gap: rooms, services, prices, staff, credentials, licence", () => {
    const r = raw({
      rooms: { a: 2 }, services: { a: ["s1"], b: ["s1", "s2"] }, staff: [{ staffId: "d1", name: "Dokter A", active: true, roles: [{ role: "doctor", branchIds: ["a", "b"] }] }],
      credentials: [cred("d1", "str")], branches: [...raw().branches.slice(0, 1), { ...raw().branches[1], licenceComplete: false }],
    });
    const b = model.assemble(r).branches.find((x) => x.id === "b")!;
    expect(b.issues.map((i) => i.key)).toEqual(["jam", "ruang", "harga", "kredensial", "izin"]);
    expect(b.issues.find((i) => i.key === "harga")!.text).toBe("1 layanan belum punya harga aktif");
    expect(b.issues.find((i) => i.key === "kredensial")!.text).toBe("1 staf klinis kredensialnya belum lengkap");
    expect(model.assemble(raw({ services: { a: ["s1"] }, staff: [] })).branches.find((x) => x.id === "b")!.issues.map((i) => i.key)).toEqual(["jam", "layanan", "staf"]);
  });

  it("credentials: an expired permit or a pending one is incomplete", () => {
    expect(model.credentialsComplete([cred("x", "str"), cred("x", "sip")], TODAY)).toBe(true);
    expect(model.credentialsComplete([cred("x", "str"), cred("x", "sip", { expiresOn: "2026-11-18" })], TODAY)).toBe(false);
    expect(model.credentialsComplete([cred("x", "str"), cred("x", "sip", { state: "pending" })], TODAY)).toBe(false);
    expect(model.credentialsComplete([cred("x", "str"), cred("x", "sip", { profession: "perawat" })], TODAY)).toBe(false);
  });
});

describe("PR-63 Admin Pusat boundary", () => {
  it("cash refund, write-off and commission batch are never Admin Pusat's to decide (owner-only path)", () => {
    for (const t of ["refund_exception", "write_off", "commission_batch"]) expect(APPROVAL_TYPES[t].approverRoles).not.toContain("admin_pusat");
    expect(APPROVAL_TYPES.write_off.approverRoles).toEqual(["owner"]);
    expect(APPROVAL_TYPES.commission_batch.approverRoles).toEqual(["owner"]);
  });

  it("an Owner role request by Admin Pusat shows as waiting for the Owner, not active", () => {
    const d = model.assemble(raw({ roleRequestsPending: [{ id: "r1", staffName: "Budi", role: "owner", change: "grant", state: "pending" }] }));
    expect(d.waitingOwner).toEqual([{ key: "role-r1", title: "Pemberian peran Owner untuk Budi", subtitle: "Menunggu persetujuan Owner", href: "/staf" }]);
    expect(text(html({ state: { kind: "ready", data: d } }))).toContain("Menunggu Owner (1)");
  });

  it("own drafts go to Menunggu Owner or Konfigurasi tertunda by their first approver", () => {
    const d = model.assemble(raw({ invitationsPending: 2, approvalsPending: [
      { id: "x", type: "setting_change_owner", typeLabel: "Perubahan pengaturan", waitingFor: model.waitingFor(APPROVAL_TYPES.setting_change_owner.approverRoles) },
      { id: "y", type: "catalog_clinical_review", typeLabel: "Review klinis katalog", waitingFor: model.waitingFor(APPROVAL_TYPES.catalog_clinical_review.approverRoles) },
    ] }));
    expect(d.waitingOwner.map((p) => p.key)).toEqual(["ap-x"]);
    expect(d.waitingOwner[0].href).toBe("/pengaturan");
    expect(d.pendingConfig.map((p) => p.title)).toEqual(["2 undangan staf belum diterima", "Review klinis katalog"]);
    expect(d.pendingConfig[1]).toMatchObject({ subtitle: "Menunggu persetujuan Penanggung Jawab Klinik", href: "/layanan" });
  });

  it("renders no money and no clinical vocabulary", () => {
    const out = text(html({ state: { kind: "ready", data: model.assemble(raw({ invitationsPending: 1 })) } }));
    expect(out).not.toMatch(/Rp|komisi|uang masuk|penjualan|piutang/i);
    expect(out).not.toMatch(/diagnos|alergi|resep|rekam medis|pasien/i);
  });

  it("the home data has no money or patient slot (type-level guard)", () => {
    // @ts-expect-error — no revenue figure on the Admin Pusat home
    const bad: import("../../src/app/(app)/ringkasan/admin-pusat/model").AdminHomeData = { branches: [], pendingConfig: [], waitingOwner: [], revenue: 1 };
    expect(bad).toBeTruthy();
  });
});

describe("loader (existing readers only, Admin Pusat only)", () => {
  const ctx = (role: string) => ({ kind: "ok", active: { context: { actingRole: role, tenantId: "t", staffId: "s" }, branches: [] } });
  beforeEach(() => {
    io.sql = [];
    io.rows = (sql: string) => {
      if (/from branches/.test(sql)) return [{ id: "b", code: "B01", name: "Cabang B", timezone: "Asia/Jakarta", publish_from: null, publish_until: null,
        licence_number: "1", nib: "2", responsible_staff_id: "r", satusehat_org_id: "o" }];
      if (/from rooms/.test(sql)) return [{ branch_id: "b", n: "1" }];
      if (/from branch_services/.test(sql)) return [{ branch_id: "b", ids: [] }];
      if (/count\(\*\) as n from staff_invitations/.test(sql)) return [{ n: "0" }];
      return [];
    };
  });

  it("refuses every role except Admin Pusat before touching the database", async () => {
    for (const role of ["owner", "manager", "finance", "fo_cashier", "doctor", "auditor"]) {
      io.ctx = ctx(role);
      expect(await loadAdminHome()).toEqual({ kind: "forbidden" });
    }
    io.ctx = { kind: "redirect", to: "/masuk" };
    expect(await loadAdminHome()).toEqual({ kind: "redirect", to: "/masuk" });
    expect(io.sql).toEqual([]);
  });

  it("Admin Pusat: assembles the scenario branch and reads no financial or clinical table", async () => {
    io.ctx = ctx("admin_pusat");
    const r = await loadAdminHome();
    expect(r.kind).toBe("ok");
    const b = (r as { data: { branches: { issues: { key: string }[] }[] } }).data.branches[0];
    expect(b.issues.map((i) => i.key)).toEqual(["jam", "layanan", "staf"]);
    expect(io.sql.length).toBeGreaterThan(5);
    const all = io.sql.join("\n");
    expect(all).not.toMatch(/\b(payments|invoices?|invoice_lines|refunds|receivables|write_offs|commission\w*|branch_prices|packages|patients|visits|medical_records|examinations|prescriptions|subledger\w*|journal\w*)\b/i);
  });
});

describe("one state per screen (10 State Copy Patterns)", () => {
  const cases = [
    [{ kind: "loading" }, 'aria-busy="true"'],
    [{ kind: "empty", message: "Belum ada cabang.", action: "Tambah Cabang", actionHref: "/pengaturan/cabang" }, "Belum ada cabang."],
    [{ kind: "filtered-empty", message: "Tidak ada cabang untuk filter ini.", clearHref: "/ringkasan/admin-pusat" }, "Hapus Filter"],
    [{ kind: "error", message: "Koneksi terputus.", retryHref: "/ringkasan/admin-pusat" }, "Coba Lagi"],
    [{ kind: "blocked", reason: "Perjanjian pengolahan data belum ditandatangani", unblock: "Owner dapat menandatanganinya" }, "Perjanjian pengolahan data belum ditandatangani."],
    [{ kind: "permission", object: "ringkasan Admin Pusat" }, "Anda tidak memiliki akses ke ringkasan Admin Pusat."],
  ] as const;
  it.each(cases)("%o renders its copy and no branch", (state, copy) => {
    const out = html({ state });
    expect(out).toContain(copy);
    expect(out).not.toContain("data-branch=");
  });
  it("no branches yet → first-run empty with Tambah Cabang", () => {
    const out = html({ state: { kind: "ready", data: model.assemble(raw({ branches: [] })) } });
    expect(out).toContain("Belum ada cabang.");
    expect(out).toContain('href="/pengaturan/cabang"');
  });
  it("compact one column; two columns of cards and the side column follow the CONTAINER, never the viewport (T-115 mount defect, 200 % text)", () => {
    const out = html({ state: { kind: "ready", data: model.assemble(raw()) } });
    expect(out).toContain("@container");
    expect(out).toContain("@min-[64em]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]");
    expect(out).toContain("@min-[40em]:grid-cols-2");
    expect(out).not.toMatch(/min-\[\d+px\]:/);
  });
  it("an issue row wraps: the issue text keeps a readable width and 'Lengkapi' moves to its own line in a narrow card (never a letter per line)", () => {
    const out = html({ state: { kind: "ready", data: model.assemble(raw()) } });
    const row = out.slice(out.indexOf("data-issue="), out.indexOf("</li>", out.indexOf("data-issue=")));
    expect(row).toMatch(/<a [^>]*class="[^"]*flex-wrap[^"]*"/);
    expect(row).toMatch(/<span class="[^"]*min-w-\[min\(100%,12em\)\][^"]*flex-1/);
    expect(row).toContain("Lengkapi");
  });
  it("escapes branch and staff names", () => {
    const hostile = `<img src=x onerror="alert(1)">`;
    const d = model.assemble(raw({ branches: [{ ...raw().branches[0], name: hostile }], roleRequestsPending: [{ id: "r", staffName: hostile, role: "finance", change: "grant", state: "pending" }] }));
    const out = html({ state: { kind: "ready", data: d } });
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });
});

// ── T-115 slice 2 (P1, ef8e1f1d): readAdminHome on the REAL readers (PostgreSQL, synthetic). The suite above mocks db/rls/context for the loader's fake client;
// here the actual module is imported, so every read runs under RLS as the role on a throwaway database. Scenario PR-33g and the PR-63 exclusions on real data.
describe("readAdminHome on the real readers (PostgreSQL, synthetic; Scenario PR-33g + PR-63)", async () => {
  const { afterAll, beforeAll } = await import("vitest");
  const real = await vi.importActual<typeof import("../../src/db/rls/context")>("../../src/db/rls/context");
  const { openAppPool } = await import("../../src/db/rls/pool");
  const { createHarness, testPool } = await import("../rls/harness");
  const { assignBranch, assignRole, createMembership, resolveContext } = await import("../../src/modules/org/identity");
  const { setHours } = await import("../../src/modules/org/branches/branches");
  const { readAdminHome } = await import("../../src/app/(app)/ringkasan/admin-pusat/load");
  type H = Awaited<ReturnType<typeof createHarness>>;
  type P = { acc: string; staffId: string; tenantId: string; role: string; branch?: string };
  let hn: H; let app: import("pg").Pool; let own: import("pg").Pool; let seq = 0;
  const WIDE = ["owner", "admin_pusat", "finance", "auditor", "marketing", "central_cs", "purchasing"];
  const as = async <R>(p: P, fn: (db: import("pg").PoolClient) => Promise<R>) =>
    real.withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role as never, activeBranchId: p.branch }), fn);
  // tenant: X has nothing, Y is fully set up (hours, a room, an offered service with an active version, a doctor with verified STR + SIP), plus a patient and a price as sentinels
  async function world(name: string) {
    const t = (await hn.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
    await hn.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [t, name]);
    const br = async (c: string, n: string) => (await hn.admin.query(`insert into branches (tenant_id, code, name, timezone, licence_number, nib, satusehat_org_id) values ($1, $2, $3, 'Asia/Jakarta', '503/123/KLINIK', '1234567890123', 'org-123') returning id`, [t, c, n])).rows[0].id as string;
    const X = await br("CX", `Cabang Kosong ${name}`);
    const Y = await br("CY", `Cabang Lengkap ${name}`);
    const person = async (role: string, branch?: string): Promise<P> => {
      const acc = (await hn.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`ap${++seq}@klinik-sintetis.test`])).rows[0].id as string;
      const { staffId } = await createMembership(own, { tenantId: t, accountId: acc, displayName: `Staf AP ${seq}` });
      const rid = await assignRole(hn.admin, { tenantId: t, staffId, role: role as never });
      if (!WIDE.includes(role) && branch) await assignBranch(hn.admin, { tenantId: t, staffRoleId: rid, branchId: branch });
      return { acc, staffId, tenantId: t, role, branch: WIDE.includes(role) ? undefined : branch };
    };
    const owner = await person("owner"); const ap = await person("admin_pusat"); const doc = await person("doctor", Y); const mgr = await person("manager", Y); const fh = await person("facility_head", Y);
    await hn.admin.query(`update branches set responsible_staff_id = $2 where tenant_id = $1`, [t, owner.staffId]);
    await as(owner, (db) => setHours(db, Y, [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "08:00", closes: "20:00" }))));
    await hn.admin.query(`insert into rooms (tenant_id, branch_id, name, kind) values ($1, $2, 'Ruang Tindakan 1', 'treatment')`, [t, Y]);
    const svc = (await hn.admin.query(`insert into catalog_items (tenant_id, kind, code, created_by) values ($1, 'service', $2, $3) returning id`, [t, `SV-${seq}`, owner.staffId])).rows[0].id as string;
    await hn.admin.query(`insert into catalog_versions (tenant_id, item_id, version, state, name, tax_category, tax_basis, normal_price, reason, created_by, created_as)
      values ($1, $2, 1, 'active', 'Facial Sintetis', 'exempt_medical', 'Jasa medis', 777777, 'Layanan baru', $3, 'owner')`, [t, svc, owner.staffId]);
    await hn.admin.query(`insert into branch_services (tenant_id, branch_id, item_id) values ($1, $2, $3)`, [t, Y, svc]);
    // the doctor's verified STR + SIP (the dashboards.test.ts pattern: recorded, then verified by the facility head); the facility head itself gets the same
    for (const who of [doc, fh]) for (const [kind, b] of [["str", null], ["sip", Y]] as const) {
      const id = (await hn.admin.query(
        `insert into staff_credentials (tenant_id, staff_id, kind, number, issuer, profession, branch_id, valid_from, expires_on, recorded_by)
         values ($1, $2, $3, $4, 'Konsil Kesehatan', 'dokter', $5, '2024-01-01', $6, $7) returning id`, [t, who.staffId, kind, `NO-${++seq}`, b, b ? "2099-12-31" : null, owner.staffId])).rows[0].id as string;
      await hn.admin.query(`update staff_credentials set state = 'verified', decided_by = $2, decided_at = now() where id = $1`, [id, (who === fh ? doc : fh).staffId]);
    }
    // a patient (PR-63 sentinel; the dashboards.test.ts pattern): its name must never reach the Admin Pusat payload
    const pid = crypto.randomUUID().replace(/-/g, "");
    await hn.admin.query(
      `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
       values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Pasien Sentinel AP', '1990-01-01', 'female', 'nik', $3, $4, 'islam', 'Karyawan', 's1', 'kawin', $2, $5, 'fo_cashier')`,
      [t, Y, `v1.1.${pid}.${pid}.${pid}`, (pid + pid).slice(0, 43), owner.staffId]);
    return { t, X, Y, owner, ap, doc, mgr, fh };
  }
  beforeAll(async () => {
    process.env.DEPLOY_ENV = "local";
    hn = await createHarness();
    app = await openAppPool({ connectionString: hn.urlAs(await hn.createLoginRole("", [real.APP_GROUP_ROLE])), max: 4 });
    own = testPool({ connectionString: hn.ownerUrl(), max: 2 });
  }, 300_000);
  afterAll(async () => { await app?.end(); await own?.end(); await hn?.close(); });

  it("Scenario PR-33g on PostgreSQL: the branch without hours is listed first as incomplete with 'Jam buka belum diisi'; the fully set-up branch has no issue", async () => {
    const w = await world("A");
    const d = await as(w.ap, (db) => readAdminHome(db));
    expect(d.branches.map((b) => b.id)).toEqual([w.X, w.Y]);
    expect(d.branches[0].issues.map((i) => i.text)).toContain("Jam buka belum diisi");
    expect(d.branches[0].issues.map((i) => i.key)).toEqual(["jam", "ruang", "layanan", "staf"]);
    expect(d.branches[1].issues).toEqual([]);
    // an INACTIVE room is not a room: X with only a deactivated room still reads "Ruang belum diisi"
    await hn.admin.query(`insert into rooms (tenant_id, branch_id, name, kind, is_active) values ($1, $2, 'Ruang Lama Tutup', 'treatment', false)`, [w.t, w.X]);
    const d2 = await as(w.ap, (db) => readAdminHome(db));
    expect(d2.branches.find((b) => b.id === w.X)!.issues.map((i) => i.key)).toContain("ruang");
  });
  it("PR-63 on PostgreSQL: no statement touches a money / patient / clinical table, and no price or patient reaches the payload", async () => {
    const w = await world("B");
    const sql: string[] = [];
    const d = await as(w.ap, (db) => readAdminHome({ query: (q: string, a?: unknown[]) => { sql.push(q); return db.query(q, a); } } as never));
    expect(sql.join("\n")).not.toMatch(/\b(payments|invoices?|invoice_lines|refunds|receivables|write_offs|commission\w*|payout\w*|branch_prices|packages|patients|visits|examinations|plan_items|treatment\w*|prescriptions|dispensings|subledger\w*|journal\w*)\b/i);
    const payload = JSON.stringify(d);
    expect(payload).not.toContain("777777");
    expect(payload).not.toContain("Pasien Sentinel AP");
    expect(payload).not.toMatch(/Rp\s?\d/);
  });
  it("PR-63 approvals on PostgreSQL: Admin Pusat sees ONLY the approvals it requested (RLS requested_by) — its setting change waits for the Owner; another staff member's refund never shows", async () => {
    const w = await world("C");
    const mk = (type: string, by: P, as_: string) => hn.admin.query(`insert into approvals (tenant_id, type, subject_kind, subject_id, request_reason, state, requested_by, requested_as)
      values ($1, $2, 'subject', gen_random_uuid(), 'Uji', 'pending', $3, $4)`, [w.t, type, by.staffId, as_]);
    await mk("setting_change_owner", w.ap, "admin_pusat");
    await mk("refund_exception", w.mgr, "manager");
    const d = await as(w.ap, (db) => readAdminHome(db));
    expect(d.waitingOwner.map((p) => [p.title, p.subtitle])).toEqual([["Perubahan pengaturan", "Menunggu persetujuan Owner"]]);
    expect(JSON.stringify(d)).not.toContain("Refund tunai");
  });
  it("role requests and invitations on PostgreSQL: an Owner grant for a staff member waits for the Owner; a pending invitation is pending configuration", async () => {
    const w = await world("D");
    await hn.admin.query(`insert into role_requests (tenant_id, staff_id, role, change, requested_by, requested_as) values ($1, $2, 'owner', 'grant', $3, 'admin_pusat')`, [w.t, w.doc.staffId, w.ap.staffId]);
    await hn.admin.query(`insert into staff_invitations (tenant_id, email, display_name, roles, branch_ids, token_hash, invited_by, expires_at)
      values ($1, 'calon@klinik-sintetis.test', 'Calon Staf', '{bc}', $2, $3, $4, now() + interval '1 day')`, [w.t, [w.Y], (await import("node:crypto")).createHash("sha256").update(`undangan-${++seq}`).digest("hex"), w.ap.staffId]);
    const d = await as(w.ap, (db) => readAdminHome(db));
    expect(d.waitingOwner.some((p) => /Pemberian peran Owner untuk Staf AP/.test(p.title) && p.subtitle === "Menunggu persetujuan Owner")).toBe(true);
    expect(JSON.stringify(d.pendingConfig)).toMatch(/undangan/i);
    expect(JSON.stringify(d)).not.toContain("calon@klinik-sintetis.test"); // a count, never the address
  });
  it("cross-tenant on PostgreSQL: tenant E's Admin Pusat sees none of tenant F's branches, staff, requests or invitations", async () => {
    const e = await world("E");
    const f = await world("F");
    await hn.admin.query(`insert into role_requests (tenant_id, staff_id, role, change, requested_by, requested_as) values ($1, $2, 'owner', 'grant', $3, 'admin_pusat')`, [f.t, f.doc.staffId, f.ap.staffId]);
    const d = await as(e.ap, (db) => readAdminHome(db));
    const out = JSON.stringify(d);
    for (const s of [f.X, f.Y, "Cabang Kosong F", "Cabang Lengkap F", f.doc.staffId]) expect(out).not.toContain(s);
    expect(d.branches.map((b) => b.id).sort()).toEqual([e.X, e.Y].sort());
  });
});

// ── T-115 mount (P1, ef8e1f1d): the parked page restored unchanged + error.tsx. A page file may export only its default and metadata. ──
describe("T-115 route mount: page and error boundary (no database)", () => {
  it("the route exports only a default page and metadata; the title names the page", async () => {
    const m = await import("../../src/app/(app)/ringkasan/admin-pusat/page");
    expect(Object.keys(m).sort()).toEqual(["default", "metadata"]);
    expect((m.metadata as { title: string }).title).toBe("Ringkasan Admin Pusat — Clinic Dashboard");
  });
  it("loading: while the body streams the page shows the title with a busy skeleton (Suspense fallback), never a branch or a request", async () => {
    const m = await import("../../src/app/(app)/ringkasan/admin-pusat/page");
    const el = m.default() as { props: { fallback: unknown } };
    const out = renderToStaticMarkup(el.props.fallback as never);
    expect(out).toContain('aria-busy="true"');
    expect(text(out)).toContain("Ringkasan");
    expect(out).not.toMatch(/Jam buka belum diisi|Menunggu Owner|Konfigurasi tertunda/);
  });
  it("error boundary: the title, 'Coba Lagi' wired to retry, and never the error's own text", async () => {
    const e = await import("../../src/app/(app)/ringkasan/admin-pusat/error");
    const retry = vi.fn();
    const el = e.default({ error: new Error("rahasia: koneksi basis data putus"), retry }) as { props: { children: { props: { onRetry: unknown } }[] } };
    const out = renderToStaticMarkup(el as never);
    expect(out).toContain("Ringkasan Admin Pusat belum bisa dimuat. Tidak ada yang berubah.");
    expect(out).toContain('role="alert"');
    expect(out).toContain("Coba Lagi");
    expect(out).not.toContain("rahasia");
    expect(el.props.children[1].props.onRetry).toBe(retry);
  });
});
