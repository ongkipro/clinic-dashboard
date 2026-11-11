// T-020 Done-when: scenario PR-57 passes; dual vendor/clinic identity refused without both
// approvals. Plus TOTP, IP allowlist, roles per request kind, suspension/exit of vendor
// staff, the maker-checker go-live rule, append-only history, and no clinic_app access.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import {
  bootstrapVendor, cancelVendorRequest, consumeVendorRequest, createVendorStaff, executeVendorRequest, recordConsumeRefusal, decideVendorRequest, requestVendorAction, setVendorIpAllowlist, updateVendorStaff,
  type VendorCaller, vendorDualIdentities, vendorDualIdentityClinicDecide, VendorStaffError,
} from "../../src/modules/vendor/staff/staff";
import { createHarness, type Harness, testClient, testPool } from "../rls/harness";

let h: Harness;
let app: pg.Pool;
let opPool: pg.Pool;
let op: pg.PoolClient; // platform operator connection
let owner: pg.Pool;
let n = 0;
const IP = "203.0.113.10"; // inside the allowlisted 203.0.113.0/24
const OUTSIDE = "198.51.100.7";

async function account(totp = true): Promise<string> {
  return (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('V', $1, $2) returning id`, [`v${++n}@vendor-sintetis.test`, totp])).rows[0].id as string;
}
const caller = (accountId: string, ip = IP, mfaAt = new Date()): VendorCaller => ({ accountId, ip, mfaAt });
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof VendorStaffError ? (e.reason ? `${e.code}:${e.reason}` : e.code) : `raw:${e.code ?? e.message}`));
async function tenant(): Promise<string> {
  const id = (await h.admin.query(`insert into tenants_registry default values returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Sintetis', 'emkm')`, [id]);
  return id;
}
async function lastAction() {
  return (await h.admin.query(`select acting_role, action, outcome, reason_code from vendor_actions order by seq desc limit 1`)).rows[0];
}

let PO: string; // platform owner account
let FIN: string; // vendor finance
let SUP: string; // support
let PO2: string; // a second platform owner
let T: string;

beforeAll(async () => {
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 3 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  opPool = testPool({ connectionString: h.ownerUrl(), max: 1 });
  op = await opPool.connect();
  PO = await account();
  await bootstrapVendor(op, PO, "Pemilik Platform", "203.0.113.0/24", "Kantor vendor");
  FIN = await account();
  SUP = await account();
  PO2 = await account();
  await createVendorStaff(op, caller(PO), FIN, "Keuangan Vendor", ["vendor_finance"]);
  await createVendorStaff(op, caller(PO), SUP, "Dukungan Vendor", ["support"]);
  await createVendorStaff(op, caller(PO), PO2, "Pemilik Platform Kedua", ["platform_owner"]);
  T = await tenant();
});

afterAll(async () => {
  op?.release();
  await opPool?.end();
  await owner?.end();
  await app?.end();
  await h?.close();
});

describe("scenario PR-57 maker-checker for vendor actions", () => {
  it("vendor finance proposes a new server fee; the same person cannot approve it; refused and audited", async () => {
    const id = await requestVendorAction(op, caller(FIN), T, { kind: "server_fee_change", amountRupiah: 1_250_000, effectiveMonth: "2026-12" }, "Kenaikan biaya server mulai Desember");
    expect(await code(decideVendorRequest(op, caller(FIN), id, true))).toBe("ERR_FORBIDDEN:role_not_held");
    expect(await lastAction()).toMatchObject({ action: "request_decide", outcome: "denied", reason_code: "role_not_held" });
    // A platform owner who requested the same change cannot approve it either.
    const own = await requestVendorAction(op, caller(PO), T, { kind: "dual_identity", accountId: await account() }, "Uji identitas ganda oleh pemilik");
    expect(await code(decideVendorRequest(op, caller(PO), own, true))).toBe("ERR_APPROVER_IS_REQUESTER");
    expect(await lastAction()).toMatchObject({ action: "request_decide", outcome: "denied", reason_code: "approver_is_requester", acting_role: "platform_owner" });
    // Another platform owner approves.
    expect(await decideVendorRequest(op, caller(PO2), id, true)).toBe("approved");
    expect(await lastAction()).toMatchObject({ action: "request_decide", outcome: "success", reason_code: "approved" });
    // The table refuses requester = approver too.
    await expect(h.admin.query(`update vendor_requests set state = 'approved', decided_by = requested_by, decided_at = now() where id = $1`, [own])).rejects.toMatchObject({ code: "23514" });
  });

  it("each kind is requested only by its roles: suspension and exit by finance or support, fee and waiver by finance, clinical grant by support", async () => {
    const t2 = await tenant();
    expect(await code(requestVendorAction(op, caller(SUP), t2, { kind: "suspension" }, "Tunggakan dua bulan berturut"))).toBe("ok");
    expect(await code(requestVendorAction(op, caller(SUP), t2, { kind: "suspension" }, "Tunggakan dua bulan berturut"))).toBe("ERR_IDEMPOTENCY_CONFLICT");
    expect(await code(requestVendorAction(op, caller(FIN), t2, { kind: "exit" }, "Kontrak berakhir bulan ini"))).toBe("ok");
    expect(await code(requestVendorAction(op, caller(SUP), t2, { kind: "invoice_waiver", invoiceId: crypto.randomUUID(), amountRupiah: 500_000 }, "Kompensasi gangguan layanan"))).toBe("ERR_FORBIDDEN:role_not_held");
    const supStaff = (await h.admin.query(`select id from vendor_staff where account_id = $1`, [SUP])).rows[0].id;
    expect(await code(requestVendorAction(op, caller(FIN), t2, { kind: "clinical_grant", staffId: supStaff }, "Akses klinis untuk investigasi"))).toBe("ERR_FORBIDDEN:role_not_held");
    // Nobody requests a clinical grant for themselves.
    expect(await code(requestVendorAction(op, caller(SUP), t2, { kind: "clinical_grant", staffId: supStaff }, "Akses klinis untuk investigasi"))).toBe("ERR_INVALID_INPUT");
    const sup2 = await account();
    const sup2Staff = await createVendorStaff(op, caller(PO), sup2, "Dukungan Kedua", ["support"]);
    expect(await code(requestVendorAction(op, caller(sup2), t2, { kind: "clinical_grant", staffId: supStaff }, "Akses klinis untuk investigasi"))).toBe("ok");
    void sup2Staff;
    // A fee change starts next month at the earliest (never retroactive).
    const thisMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
    expect(await code(requestVendorAction(op, caller(FIN), t2, { kind: "server_fee_change", amountRupiah: 1_000, effectiveMonth: thisMonth }, "Biaya berlaku surut tidak boleh"))).toBe("ERR_INVALID_INPUT");
    const grantId = (await h.admin.query(`select id from vendor_requests where kind = 'clinical_grant' and tenant_id = $1`, [t2])).rows[0].id;
    expect(await decideVendorRequest(op, caller(PO), grantId, false, "Tidak perlu data klinis")).toBe("rejected");
    // Bad payloads and unknown kinds are refused and logged.
    expect(await code(requestVendorAction(op, caller(FIN), t2, { kind: "server_fee_change", amountRupiah: -5, effectiveMonth: "2026-12" }, "Biaya negatif tidak boleh"))).toBe("ERR_INVALID_INPUT");
    expect(await code(requestVendorAction(op, caller(FIN), t2, { kind: "server_fee_change", amountRupiah: "banyak" as never, effectiveMonth: "2026-12" }, "Jumlah berupa teks tidak boleh"))).toBe("ERR_INVALID_INPUT");
    expect(await code(requestVendorAction(op, caller(FIN), t2, { kind: "server_fee_change", amountRupiah: 1.5, effectiveMonth: "2026-13" }, "Biaya pecahan tidak boleh"))).toBe("ERR_INVALID_INPUT");
    expect(await code(requestVendorAction(op, caller(FIN), crypto.randomUUID(), { kind: "exit" }, "Tenant yang tidak ada"))).toBe("ERR_NOT_FOUND");
    expect(await code(requestVendorAction(op, caller(FIN), t2, { kind: "suspension" }, "pendek"))).toBe("ERR_INVALID_INPUT");
  });
});

describe("dual vendor/clinic identity (IAM-10)", () => {
  it("refused without both approvals; platform owner and clinic owner (two people) make it effective; listed in Akses Vendor", async () => {
    const t3 = await tenant();
    const clinicOwnerAcc = (await h.admin.query(`insert into auth_user (name, email) values ('Owner', $1) returning id`, [`owner${++n}@klinik-sintetis.test`])).rows[0].id;
    const { staffId } = await createMembership(owner, { tenantId: t3, accountId: clinicOwnerAcc, displayName: "Owner Klinik" });
    await assignRole(h.admin, { tenantId: t3, staffId, role: "owner" });
    const asOwner = async <R>(fn: (db: pg.PoolClient) => Promise<R>) => withTenantContext(app, await resolveContext(app, clinicOwnerAcc, { tenantId: t3, actingRole: "owner" }), fn);

    // A vendor support account cannot join the clinic.
    await expect(createMembership(owner, { tenantId: t3, accountId: SUP, displayName: "Dukungan" })).rejects.toThrow(/ERR_FORBIDDEN/);
    // Requested by support (about itself), approved by a platform owner only: still refused.
    const req = await requestVendorAction(op, caller(SUP), t3, { kind: "dual_identity", accountId: SUP }, "Membantu klinik sebagai staf sementara");
    expect(await decideVendorRequest(op, caller(PO), req, true)).toBe("approved");
    await expect(createMembership(owner, { tenantId: t3, accountId: SUP, displayName: "Dukungan" })).rejects.toThrow(/ERR_FORBIDDEN/);
    // The clinic owner of another tenant cannot approve it.
    const t4 = await tenant();
    const otherAcc = (await h.admin.query(`insert into auth_user (name, email) values ('Owner', $1) returning id`, [`owner${++n}@klinik-sintetis.test`])).rows[0].id;
    const other = await createMembership(owner, { tenantId: t4, accountId: otherAcc, displayName: "Owner Lain" });
    await assignRole(h.admin, { tenantId: t4, staffId: other.staffId, role: "owner" });
    expect(await withTenantContext(app, await resolveContext(app, otherAcc, { tenantId: t4, actingRole: "owner" }), (db) => vendorDualIdentityClinicDecide(db, req, true))).toEqual({ refused: "ERR_NOT_FOUND" });
    // The clinic owner approves: now the membership is allowed, and Akses Vendor lists it.
    expect(await asOwner((db) => vendorDualIdentityClinicDecide(db, req, true))).toBe("approved");
    expect(await asOwner((db) => vendorDualIdentityClinicDecide(db, req, true))).toEqual({ refused: "ERR_VERSION_CONFLICT" });
    await createMembership(owner, { tenantId: t3, accountId: SUP, displayName: "Dukungan" });
    const listed = await asOwner(vendorDualIdentities);
    expect(listed).toEqual([expect.objectContaining({ requestId: req, accountId: SUP, vendorName: "Dukungan Vendor", effective: true })]);
    const audit = (await h.admin.query(`select reason_code, outcome from audit_events where object_id = $1 and tenant_id = $2 and staff_id is not null order by seq`, [req, t3])).rows;
    expect(audit).toEqual([{ reason_code: "vendor_dual_identity_approved", outcome: "success" }, { reason_code: "dual_identity_already_decided", outcome: "denied" }]);
  });

  it("clinic approval alone is not enough; a clinic member cannot become vendor staff without both; the subject never approves", async () => {
    const t5 = await tenant();
    const acc = await account();
    const ownAcc = (await h.admin.query(`insert into auth_user (name, email) values ('Owner', $1) returning id`, [`owner${++n}@klinik-sintetis.test`])).rows[0].id;
    const o = await createMembership(owner, { tenantId: t5, accountId: ownAcc, displayName: "Owner" });
    await assignRole(h.admin, { tenantId: t5, staffId: o.staffId, role: "owner" });
    await createMembership(owner, { tenantId: t5, accountId: acc, displayName: "Staf Klinik" });
    // A clinic member is not made vendor staff without an approved dual identity.
    expect(await code(createVendorStaff(op, caller(PO), acc, "Calon Vendor", ["support"]))).toBe("ERR_FORBIDDEN:dual_identity_not_approved");
    const req = await requestVendorAction(op, caller(FIN), t5, { kind: "dual_identity", accountId: acc }, "Staf klinik membantu tim vendor");
    expect(await withTenantContext(app, await resolveContext(app, ownAcc, { tenantId: t5, actingRole: "owner" }), (db) => vendorDualIdentityClinicDecide(db, req, true))).toBe("approved");
    expect(await code(createVendorStaff(op, caller(PO), acc, "Calon Vendor", ["support"]))).toBe("ERR_FORBIDDEN:dual_identity_not_approved");
    // A platform owner who is the subject cannot approve.
    const req2 = await requestVendorAction(op, caller(FIN), t5, { kind: "dual_identity", accountId: PO2 }, "Pemilik platform ikut klinik");
    expect(await code(decideVendorRequest(op, caller(PO2), req2, true))).toBe("ERR_APPROVER_IS_REQUESTER");
    // Both approvals: allowed.
    expect(await decideVendorRequest(op, caller(PO), req, true)).toBe("approved");
    expect(await code(createVendorStaff(op, caller(PO), acc, "Calon Vendor", ["support"]))).toBe("ok");
    // The clinic owner never approves their own vendor identity.
    const req3 = await requestVendorAction(op, caller(FIN), t5, { kind: "dual_identity", accountId: ownAcc }, "Owner klinik ikut tim vendor");
    expect(await withTenantContext(app, await resolveContext(app, ownAcc, { tenantId: t5, actingRole: "owner" }), (db) => vendorDualIdentityClinicDecide(db, req3, true))).toEqual({ refused: "ERR_APPROVER_IS_REQUESTER" });
    // An owner who is also the vendor staff who requested it (approved dual identity) cannot approve it on the clinic side.
    const req4 = await requestVendorAction(op, caller(acc), t5, { kind: "dual_identity", accountId: await account() }, "Diajukan oleh staf ganda");
    const accStaff = await createMembership(owner, { tenantId: t5, accountId: acc, displayName: "x" }).catch(() => null);
    void accStaff;
    await assignRole(h.admin, { tenantId: t5, staffId: (await h.admin.query(`select s.id from staff s join memberships m on m.id = s.membership_id where m.account_id = $1 and m.tenant_id = $2`, [acc, t5])).rows[0].id, role: "owner" });
    expect(await withTenantContext(app, await resolveContext(app, acc, { tenantId: t5, actingRole: "owner" }), (db) => vendorDualIdentityClinicDecide(db, req4, true))).toEqual({ refused: "ERR_APPROVER_IS_REQUESTER" });
  });
});

describe("vendor actor checks (IAM-10)", () => {
  it("TOTP is required, the console is reachable only from the allowlist, and every refusal is logged", async () => {
    const noTotp = await account(false);
    await createVendorStaff(op, caller(PO), noTotp, "Tanpa TOTP", ["vendor_finance"]);
    expect(await code(requestVendorAction(op, caller(noTotp), T, { kind: "exit" }, "Percobaan tanpa TOTP"))).toBe("ERR_FORBIDDEN:totp_required");
    expect(await code(requestVendorAction(op, caller(FIN, OUTSIDE), T, { kind: "exit" }, "Percobaan dari luar kantor"))).toBe("ERR_FORBIDDEN:ip_not_allowed");
    expect(await lastAction()).toMatchObject({ outcome: "denied", reason_code: "ip_not_allowed" });
    expect(await code(requestVendorAction(op, caller(FIN, "bukan-ip"), T, { kind: "exit" }, "Alamat tidak terbaca sama sekali"))).toBe("ERR_FORBIDDEN:ip_not_allowed");
    const stranger = await account();
    expect(await code(requestVendorAction(op, caller(stranger), T, { kind: "exit" }, "Bukan staf vendor sama sekali"))).toBe("ERR_FORBIDDEN:not_vendor_staff");
    // The allowlist changes only by the platform owner; removing the caller's own range is refused.
    expect(await code(setVendorIpAllowlist(op, caller(FIN), "198.51.100.0/24", "Rumah", true))).toBe("ERR_FORBIDDEN:role_not_held");
    expect(await code(setVendorIpAllowlist(op, caller(PO), "203.0.113.0/24", "", false))).toBe("ERR_FORBIDDEN:lockout");
    expect(await lastAction()).toMatchObject({ outcome: "denied", reason_code: "lockout" });
    expect(await code(setVendorIpAllowlist(op, caller(PO), "0.0.0.0/0", "Semua", true))).toBe("ERR_INVALID_INPUT:range_too_wide");
    for (const bad of ["203.0.113.10/24", " 203.0.113.10", "203.0.113.10 ", "", "::ffff:198.51.100.7x"]) {
      expect(await code(requestVendorAction(op, caller(FIN, bad), T, { kind: "exit" }, "Alamat dengan bentuk aneh")), bad).toBe("ERR_FORBIDDEN:ip_not_allowed");
    }
    expect(await code(requestVendorAction(op, caller(FIN, "::ffff:203.0.113.10"), await tenant(), { kind: "exit" }, "Alamat IPv4 dalam IPv6"))).toBe("ok");
    // TOTP verified in this session, recently.
    expect(await code(requestVendorAction(op, caller(FIN, IP, new Date(Date.now() - 13 * 3600_000)), T, { kind: "exit" }, "Sesi lama tanpa verifikasi"))).toBe("ERR_FORBIDDEN:totp_not_verified");
    expect(await code(setVendorIpAllowlist(op, caller(PO), "bukan-cidr", "Rumah", true))).toBe("ERR_INVALID_INPUT");
    expect(await code(setVendorIpAllowlist(op, caller(PO), "198.51.100.0/24", "Kantor cabang", true))).toBe("ok");
    expect(await code(requestVendorAction(op, caller(FIN, OUTSIDE), T, { kind: "exit" }, "Dari kantor cabang sekarang"))).toBe("ok");
  });

  it("a suspended or exited vendor staff member acts no more; nobody changes their own access; one platform owner always remains", async () => {
    const acc = await account();
    const id = await createVendorStaff(op, caller(PO), acc, "Dukungan Sementara", ["support"]);
    await updateVendorStaff(op, caller(PO), id, ["support"], "suspended");
    expect(await code(requestVendorAction(op, caller(acc), await tenant(), { kind: "suspension" }, "Akun ditangguhkan mencoba"))).toBe("ERR_FORBIDDEN:vendor_staff_inactive");
    await updateVendorStaff(op, caller(PO), id, ["support"], "exited");
    expect(await code(updateVendorStaff(op, caller(PO), id, ["support"], "active"))).toBe("ERR_INVALID_INPUT"); // exit is final
    const poId = (await h.admin.query(`select id from vendor_staff where account_id = $1`, [PO])).rows[0].id;
    expect(await code(updateVendorStaff(op, caller(PO), poId, ["support"], "active"))).toBe("ERR_FORBIDDEN:self_change");
    const po2Id = (await h.admin.query(`select id from vendor_staff where account_id = $1`, [PO2])).rows[0].id;
    // PO removes PO2's platform-owner role: allowed (PO remains); PO2 then cannot remove PO's.
    await updateVendorStaff(op, caller(PO), po2Id, ["support"], "active");
    expect(await code(updateVendorStaff(op, caller(PO2), poId, ["support"], "active"))).toBe("ERR_FORBIDDEN:role_not_held");
    await updateVendorStaff(op, caller(PO), po2Id, ["platform_owner"], "active");
    const po3 = await account();
    const po3Id = await createVendorStaff(op, caller(PO), po3, "Pemilik Ketiga", ["support"]);
    expect(await code(updateVendorStaff(op, caller(PO), po3Id, ["support"], "suspended"))).toBe("ok");
    // Reactivation re-checks the dual identity: an exited-free suspended staff member with an unapproved clinic membership stays out.
    const t9 = await tenant();
    await h.admin.query(`alter table memberships disable trigger memberships_vendor_guard`);
    const sneaky = (await h.admin.query(`insert into memberships (tenant_id, account_id) values ($1, $2) returning id`, [t9, po3])).rows[0].id;
    await h.admin.query(`alter table memberships enable trigger memberships_vendor_guard`);
    expect(await code(updateVendorStaff(op, caller(PO), po3Id, ["support"], "active"))).toBe("ERR_FORBIDDEN:dual_identity_not_approved");
    // Ending that membership is always allowed (offboarding).
    await h.admin.query(`update memberships set effective_to = now() where id = $1`, [sneaky]);
    // Moving a membership to a vendor staff account is refused.
    const t10 = await tenant();
    const m = (await h.admin.query(`insert into auth_user (name, email) values ('M', $1) returning id`, [`m${++n}@klinik-sintetis.test`])).rows[0].id;
    const mem = await createMembership(owner, { tenantId: t10, accountId: m, displayName: "M" });
    await expect(h.admin.query(`update memberships set account_id = $1 where id = $2`, [SUP, mem.membershipId])).rejects.toMatchObject({ code: "42501" });
    expect(await code(bootstrapVendor(op, await account(), "Kedua", "10.0.0.0/8", "Lain"))).toBe("ERR_FORBIDDEN:already_bootstrapped");
  });

  it("production go-live needs two active vendor staff including a platform owner", async () => {
    const blockers = async () => (await h.admin.query(`select vendor_go_live_blockers() as b`)).rows[0].b as string[];
    expect(await blockers()).not.toContain("vendor_staff_maker_checker");
    await h.admin.query(`alter table vendor_staff disable trigger all`);
    await h.admin.query(`update vendor_staff set state = 'suspended' where account_id <> $1`, [PO]);
    expect(await blockers()).toContain("vendor_staff_maker_checker");
    // A platform owner plus only a vendor auditor is not a working maker-checker.
    const aud = await account();
    const audId = (await h.admin.query(`insert into vendor_staff (account_id, display_name) values ($1, 'Auditor') returning id`, [aud])).rows[0].id;
    await h.admin.query(`insert into vendor_staff_roles (staff_id, role) values ($1, 'vendor_auditor')`, [audId]);
    expect(await blockers()).toContain("vendor_staff_maker_checker");
    await h.admin.query(`update vendor_staff set state = 'active' where account_id in ($1, $2, $3)`, [FIN, SUP, PO2]);
    expect(await blockers()).not.toContain("vendor_staff_maker_checker");
    // Platform owners who never enrolled TOTP cannot approve anything: blocked.
    const poAccounts = (await h.admin.query(`select v.account_id from vendor_staff v join vendor_staff_roles r on r.staff_id = v.id and r.role = 'platform_owner'`)).rows.map((r) => r.account_id);
    await h.admin.query(`update auth_user set two_factor_enabled = false where id = any($1)`, [poAccounts]);
    expect(await blockers()).toContain("vendor_staff_maker_checker");
    await h.admin.query(`update auth_user set two_factor_enabled = true where id = any($1)`, [poAccounts]);
    await h.admin.query(`alter table vendor_staff enable trigger all`);
  });
});

describe("requests over time and concurrency", () => {
  it("the requester withdraws a pending request; a request whose requester left cannot be approved", async () => {
    const t6 = await tenant();
    const id = await requestVendorAction(op, caller(FIN), t6, { kind: "invoice_waiver", invoiceId: crypto.randomUUID(), amountRupiah: 250_000 }, "Pembebasan sebagian tagihan");
    expect(await code(cancelVendorRequest(op, caller(SUP), id))).toBe("ERR_NOT_FOUND"); // not the requester
    await cancelVendorRequest(op, caller(FIN), id);
    expect(await code(decideVendorRequest(op, caller(PO), id, true))).toBe("ERR_VERSION_CONFLICT");
    expect(await code(requestVendorAction(op, caller(FIN), t6, { kind: "invoice_waiver", invoiceId: crypto.randomUUID(), amountRupiah: 250_000 }, "Pembebasan sebagian tagihan"))).toBe("ok");
    const leaver = await account();
    const leaverId = await createVendorStaff(op, caller(PO), leaver, "Akan Keluar", ["vendor_finance"]);
    const req = await requestVendorAction(op, caller(leaver), t6, { kind: "suspension" }, "Diajukan sebelum keluar");
    await updateVendorStaff(op, caller(PO), leaverId, ["vendor_finance"], "exited");
    expect(await code(decideVendorRequest(op, caller(PO), req, true))).toBe("ERR_VERSION_CONFLICT:requester_inactive");
    // A requester who no longer holds the role they requested as: not approvable either.
    const mover = await account();
    const moverId = await createVendorStaff(op, caller(PO), mover, "Pindah Peran", ["vendor_finance"]);
    const req2 = await requestVendorAction(op, caller(mover), t6, { kind: "exit" }, "Diajukan sebelum pindah peran");
    await updateVendorStaff(op, caller(PO), moverId, ["vendor_auditor"], "active");
    expect(await code(decideVendorRequest(op, caller(PO), req2, true))).toBe("ERR_VERSION_CONFLICT:requester_inactive");
  });

  it("a clinic membership being created holds the account: vendor staff creation waits and then refuses", async () => {
    const t8 = await tenant();
    const acc = await account();
    const tx = await owner.connect();
    try {
      await tx.query("begin");
      await tx.query(`insert into memberships (tenant_id, account_id) values ($1, $2)`, [t8, acc]); // the trigger takes the account lock
      const extra = testPool({ connectionString: h.ownerUrl(), max: 1 });
      const op2 = await extra.connect();
      const pending = code(createVendorStaff(op2, caller(PO), acc, "Menunggu", ["support"]));
      await new Promise((r) => setTimeout(r, 300));
      await tx.query("commit");
      expect(await pending).toBe("ERR_FORBIDDEN:dual_identity_not_approved");
      op2.release();
      await extra.end();
    } finally {
      tx.release();
    }
    expect((await h.admin.query(`select count(*)::int n from vendor_staff where account_id = $1`, [acc])).rows[0].n).toBe(0);
  });

  it("vendor staff creation and a clinic membership for the same account at once: exactly one wins", async () => {
    for (let i = 0; i < 3; i++) {
      const t7 = await tenant();
      const acc = await account();
      const extra = testPool({ connectionString: h.ownerUrl(), max: 1 });
      const op2 = await extra.connect();
      const r = await Promise.allSettled([
        createVendorStaff(op2, caller(PO), acc, "Balapan", ["support"]),
        createMembership(owner, { tenantId: t7, accountId: acc, displayName: "Balapan" }),
      ]);
      op2.release();
      await extra.end();
      const staff = (await h.admin.query(`select count(*)::int n from vendor_staff where account_id = $1`, [acc])).rows[0].n;
      const mem = (await h.admin.query(`select count(*)::int n from memberships where account_id = $1`, [acc])).rows[0].n;
      expect(staff + mem, `round ${i}: ${r.map((x) => x.status).join(",")}`).toBe(1);
    }
  });
});

describe("round 2: one person per half, execution once, logs", () => {
  it("a clinic owner who is also a platform owner approves the clinic half first, then cannot approve the platform half", async () => {
    const t11 = await tenant();
    // PO2's account becomes clinic owner of t11 through an approved dual identity (PO + another clinic owner).
    const firstOwnerAcc = await account();
    const fo = await createMembership(owner, { tenantId: t11, accountId: firstOwnerAcc, displayName: "Owner Pertama" });
    await assignRole(h.admin, { tenantId: t11, staffId: fo.staffId, role: "owner" });
    const asFirst = async <R>(fn: (db: pg.PoolClient) => Promise<R>) => withTenantContext(app, await resolveContext(app, firstOwnerAcc, { tenantId: t11, actingRole: "owner" }), fn);
    const d1 = await requestVendorAction(op, caller(SUP), t11, { kind: "dual_identity", accountId: PO2 }, "Pemilik platform juga owner klinik");
    expect(await decideVendorRequest(op, caller(PO), d1, true)).toBe("approved");
    expect(await asFirst((db) => vendorDualIdentityClinicDecide(db, d1, true))).toBe("approved");
    const po2m = await createMembership(owner, { tenantId: t11, accountId: PO2, displayName: "PO2 Klinik" });
    await assignRole(h.admin, { tenantId: t11, staffId: po2m.staffId, role: "owner" });
    // A new dual identity for someone else: PO2 approves the clinic half, then tries the platform half.
    const subject = await account();
    const d2 = await requestVendorAction(op, caller(SUP), t11, { kind: "dual_identity", accountId: subject }, "Staf vendor kedua untuk klinik");
    expect(await withTenantContext(app, await resolveContext(app, PO2, { tenantId: t11, actingRole: "owner" }), (db) => vendorDualIdentityClinicDecide(db, d2, true))).toBe("approved");
    expect(await code(decideVendorRequest(op, caller(PO2), d2, true))).toBe("ERR_APPROVER_IS_REQUESTER");
    expect(await lastAction()).toMatchObject({ outcome: "denied", reason_code: "approved_clinic_half" });
    expect(await decideVendorRequest(op, caller(PO), d2, true)).toBe("approved");
    // Vendor actions on the tenant are in the clinic's audit chain too (SEC-16), and the chain holds.
    const rows = (await h.admin.query(`select vendor_staff_id, acting_role, object_kind, outcome, reason_code from audit_events where tenant_id = $1 and vendor_staff_id is not null order by seq`, [t11])).rows;
    expect(rows.map((r) => `${r.object_kind}:${r.outcome}:${r.reason_code ?? ""}`)).toEqual(expect.arrayContaining(["request_dual_identity:success:", "request_decide:success:approved", "request_decide:denied:approved_clinic_half"]));
    // A refused tenant request (guard refusal) is in that tenant's chain too.
    expect(await code(requestVendorAction(op, caller(SUP), t11, { kind: "server_fee_change", amountRupiah: 1000, effectiveMonth: "2099-01" }, "Peran tidak cukup untuk ini"))).toBe("ERR_FORBIDDEN:role_not_held");
    expect((await h.admin.query(`select object_kind, outcome, reason_code from audit_events where tenant_id = $1 order by seq desc limit 1`, [t11])).rows[0])
      .toEqual({ object_kind: "request_server_fee_change", outcome: "denied", reason_code: "role_not_held" });
    expect(rows.every((r) => r.vendor_staff_id && String(r.acting_role).startsWith("vendor:"))).toBe(true);
    // The chain holds: each row's hash covers its predecessor and its canonical form.
    const broken = (await h.admin.query(
      `select count(*)::int n from (select e.hash, lag(e.hash) over (order by e.seq) prev, e.prev_hash, e.seq,
              encode(digest(e.prev_hash || audit_canonical(e), 'sha256'), 'hex') want from audit_events e where e.tenant_id = $1) x
        where x.hash <> x.want or (x.seq > 1 and x.prev_hash <> x.prev)`, [t11])).rows[0].n;
    expect(broken).toBe(0);
  });

  it("an approved request is executed once, inside the effect's transaction, within 30 days, for its tenant; refusals are recorded", async () => {
    const t12 = await tenant();
    const SVC = "billing.worker";
    const exec = testPool({ connectionString: h.urlAs(await h.createLoginRole("", ["clinic_executor"])), max: 3 });
    const login = (await exec.query(`select session_user as u`)).rows[0].u.replace(/[0-9]/g, (d: string) => "abcdefghij"[Number(d)]);
    let effects = 0;
    const run = (id: string, kind: "invoice_waiver" | "exit" | "server_fee_change" | "suspension", tenantId = t12, effect?: () => Promise<void>) =>
      code(executeVendorRequest(exec, id, kind, tenantId, SVC, async () => {
        effects++;
        await effect?.();
      }));
    const denials = async (id: string) => (await h.admin.query(`select reason_code, tenant_id from vendor_actions where object_id = $1 and action = 'request_consume' and outcome = 'denied' order by seq`, [id])).rows;
    const chainDenials = async (id: string, tenantId: string) =>
      (await h.admin.query(`select reason_code, service_identity from audit_events where tenant_id = $1 and object_id = $2 and outcome = 'denied' order by seq`, [tenantId, id])).rows;
    const consumed = async (id: string) => (await h.admin.query(`select consumed_at from vendor_requests where id = $1`, [id])).rows[0].consumed_at;

    const id = await requestVendorAction(op, caller(FIN), t12, { kind: "invoice_waiver", invoiceId: crypto.randomUUID(), amountRupiah: 100_000 }, "Kompensasi gangguan layanan");
    // Not approved yet: refused, no effect, recorded in the vendor log and the clinic chain.
    expect(await run(id, "invoice_waiver")).toBe("ERR_VERSION_CONFLICT:not_approved");
    expect(effects).toBe(0);
    expect(await denials(id)).toEqual([{ reason_code: "not_approved", tenant_id: t12 }]);
    expect(await chainDenials(id, t12)).toEqual([{ reason_code: "not_approved", service_identity: `${SVC}.${login}` }]);
    expect(await decideVendorRequest(op, caller(PO), id, true)).toBe("approved");
    // Wrong kind; wrong tenant: refused and recorded, but never in the stated tenant's chain.
    expect(await run(id, "suspension")).toBe("ERR_VERSION_CONFLICT:not_found");
    const otherTenant = await tenant();
    expect(await run(id, "invoice_waiver", otherTenant)).toBe("ERR_VERSION_CONFLICT:not_found");
    expect((await denials(id)).slice(-1)).toEqual([{ reason_code: "not_found", tenant_id: null }]);
    expect(await chainDenials(id, otherTenant)).toEqual([]);
    expect((await h.admin.query(`select count(*)::int n from audit_events where tenant_id = $1`, [otherTenant])).rows[0].n).toBe(0);
    // Outside a transaction the low-level call is refused before anything runs.
    expect(await code(consumeVendorRequest(op, id, "invoice_waiver", t12, SVC))).toBe("ERR_FORBIDDEN:call inside the effect's transaction");
    // A failed effect rolls the consumption back (no refusal recorded: the approval was fine); it can then be executed.
    const before = (await denials(id)).length;
    expect(await run(id, "invoice_waiver", t12, async () => {
      throw new Error("effect failed");
    })).toBe("raw:effect failed");
    expect(await consumed(id)).toBeNull();
    expect((await denials(id)).length).toBe(before);
    // An effect that fails with a VendorStaffError carrying a consume-like reason is not a consumption refusal.
    expect(await run(id, "invoice_waiver", t12, async () => {
      throw new VendorStaffError("ERR_VERSION_CONFLICT", "not_approved");
    })).toBe("ERR_VERSION_CONFLICT:not_approved");
    expect(await consumed(id)).toBeNull();
    expect((await denials(id)).length).toBe(before);
    // Two executions at once: exactly one applies its effect; the other is refused and recorded.
    effects = 0;
    const r = await Promise.all([1, 2].map(() => run(id, "invoice_waiver")));
    expect(r.sort()).toEqual(["ERR_VERSION_CONFLICT:already_consumed", "ok"]);
    expect(effects).toBe(1); // the loser waited on the row lock inside consume, then was refused before its effect
    expect(await consumed(id)).not.toBeNull();
    expect((await denials(id)).slice(-1)).toEqual([{ reason_code: "already_consumed", tenant_id: t12 }]);
    // The success is logged with the service identity, anchored to the login, in both logs.
    expect((await h.admin.query(`select acting_role from vendor_actions where object_id = $1 and action = 'request_consume' and outcome = 'success'`, [id])).rows).toEqual([{ acting_role: `service:${SVC}.${login}` }]);
    expect((await h.admin.query(`select service_identity from audit_events where tenant_id = $1 and object_id = $2 and outcome = 'success' and service_identity is not null`, [t12, id])).rows)
      .toEqual([{ service_identity: `${SVC}.${login}` }]);
    // Expired approvals and a fee change whose month passed (rows created directly: history is immutable).
    await h.admin.query(`alter table vendor_requests disable trigger vendor_requests_guard`);
    const old = (await h.admin.query(
      `insert into vendor_requests (kind, tenant_id, payload, reason, requested_by, requested_as, state, decided_by, decided_at)
       select 'exit', $1, '{}', 'Kontrak berakhir lama', r.requested_by, 'vendor_finance', 'approved', r.decided_by, now() - interval '31 days'
         from vendor_requests r where r.id = $2 returning id`, [t12, id])).rows[0].id;
    const fee = (await h.admin.query(
      `insert into vendor_requests (kind, tenant_id, payload, reason, requested_by, requested_as, state, decided_by, decided_at)
       select 'server_fee_change', $1, '{"amount_rupiah": 1000, "effective_month": "2026-01"}', 'Biaya lama menunggu', r.requested_by, 'vendor_finance', 'approved', r.decided_by, now()
         from vendor_requests r where r.id = $2 returning id`, [t12, id])).rows[0].id;
    await h.admin.query(`alter table vendor_requests enable trigger vendor_requests_guard`);
    expect(await run(old, "exit")).toBe("ERR_VERSION_CONFLICT:approval_expired");
    expect(await run(fee, "server_fee_change")).toBe("ERR_VERSION_CONFLICT:effective_month_passed");
    expect((await denials(old))).toEqual([{ reason_code: "approval_expired", tenant_id: t12 }]);
    expect((await chainDenials(fee, t12))).toEqual([{ reason_code: "effective_month_passed", service_identity: `${SVC}.${login}` }]);
    // A dual identity is never consumed.
    const d = await requestVendorAction(op, caller(SUP), t12, { kind: "dual_identity", accountId: await account() }, "Identitas ganda untuk klinik");
    await decideVendorRequest(op, caller(PO), d, true);
    expect(await run(d, "exit")).toBe("ERR_VERSION_CONFLICT:not_found");
    // The recorder accepts only consume's reason codes; the executor role reads no vendor table and decides nothing.
    const wc = await exec.connect();
    try {
      await expect(recordConsumeRefusal(wc, id, "invoice_waiver", t12, SVC, "free text here")).rejects.toMatchObject({ code: "22023" });
      await expect(wc.query(`select 1 from vendor_requests limit 1`)).rejects.toMatchObject({ code: "42501" });
      await expect(wc.query(`select vendor_request_decide($1, $2, now(), $3, true, null)`, [PO, IP, id])).rejects.toMatchObject({ code: "42501" });
    } finally {
      wc.release();
    }
    await exec.end();
  });

  it("the console role touches no vendor table and cannot call the actor-taking commands (T-021 session binding)", async () => {
    const consoleRole = await h.createLoginRole("", ["clinic_vendor"]);
    const c = testClient({ connectionString: h.urlAs(consoleRole) });
    await c.connect();
    try {
      for (const t of ["vendor_staff", "vendor_staff_roles", "vendor_ip_allowlist", "vendor_requests", "vendor_actions", "audit_events"]) {
        await expect(c.query(`select 1 from ${t} limit 1`), t).rejects.toMatchObject({ code: "42501" });
        await expect(c.query(`delete from ${t}`), t).rejects.toMatchObject({ code: "42501" });
      }
      await expect(c.query(`select vendor_request_consume(gen_random_uuid(), 'exit', gen_random_uuid(), 'x.y')`)).rejects.toMatchObject({ code: "42501" });
      await expect(c.query(`select vendor_bootstrap(gen_random_uuid(), 'x', '10.0.0.0/16', 'x')`)).rejects.toMatchObject({ code: "42501" });
      const t15 = await tenant();
      await expect(c.query(`select vendor_request($1, $2, now(), 'exit', $3, '{}', 'Lewat peran konsol') as r`, [FIN, IP, t15])).rejects.toMatchObject({ code: "42501" });
    } finally {
      await c.end();
    }
  });

  it("decided requests cannot be rewritten; clinic approval cannot be cleared on cancel; approved needs a decider", async () => {
    const t13 = await tenant();
    const id = await requestVendorAction(op, caller(FIN), t13, { kind: "exit" }, "Kontrak berakhir bulan ini");
    await decideVendorRequest(op, caller(PO), id, true);
    for (const set of [`decision_reason = 'diubah'`, `decided_at = now() - interval '1 day'`, `state = 'rejected'`, `consumed_at = now(), decision_reason = 'x'`]) {
      await expect(h.admin.query(`update vendor_requests set ${set} where id = $1`, [id]), set).rejects.toMatchObject({ code: "42501" });
    }
    const d = await requestVendorAction(op, caller(SUP), t13, { kind: "dual_identity", accountId: await account() }, "Identitas ganda untuk klinik");
    const ownAcc = await account();
    const o = await createMembership(owner, { tenantId: t13, accountId: ownAcc, displayName: "Owner" });
    await assignRole(h.admin, { tenantId: t13, staffId: o.staffId, role: "owner" });
    expect(await withTenantContext(app, await resolveContext(app, ownAcc, { tenantId: t13, actingRole: "owner" }), (db) => vendorDualIdentityClinicDecide(db, d, true))).toBe("approved");
    await expect(h.admin.query(`update vendor_requests set state = 'cancelled', decided_at = now(), clinic_approved_at = null, clinic_approved_by = null, clinic_approved_account = null where id = $1`, [d])).rejects.toMatchObject({ code: "42501" });
    await h.admin.query(`alter table vendor_requests disable trigger vendor_requests_guard`);
    await expect(h.admin.query(`update vendor_requests set state = 'approved', decided_at = now() where id = $1`, [d])).rejects.toMatchObject({ code: "23514" });
    await h.admin.query(`alter table vendor_requests enable trigger vendor_requests_guard`);
  });

  it("role changes are logged one row per role; null state, bootstrap refusals and unknown references are logged", async () => {
    const a = await account();
    const id = await createVendorStaff(op, caller(PO), a, "Peran Berganti", ["support", "onboarding"]);
    const roleRows = async () => (await h.admin.query(`select reason_code from vendor_actions where object_id = $1 and action = 'vendor_staff_role' order by seq`, [id])).rows.map((r) => r.reason_code);
    expect(await roleRows()).toEqual(["role_added_onboarding", "role_added_support"]);
    await updateVendorStaff(op, caller(PO), id, ["support", "vendor_finance"], "active");
    expect(await roleRows()).toEqual(["role_added_onboarding", "role_added_support", "role_removed_onboarding", "role_added_vendor_finance"]);
    expect(await code(updateVendorStaff(op, caller(PO), id, ["support"], null as never))).toBe("ERR_INVALID_INPUT");
    expect(await lastAction()).toMatchObject({ outcome: "denied", reason_code: "invalid_input" });
    expect(await code(bootstrapVendor(op, await account(), "Lagi", "198.51.100.0/24", "Lagi"))).toBe("ERR_FORBIDDEN:already_bootstrapped");
    expect(await lastAction()).toMatchObject({ action: "vendor_bootstrap", outcome: "denied", reason_code: "already_bootstrapped" });
    // Before any vendor staff exists, malformed bootstrap input is refused and logged (seen in a rolled-back transaction).
    await h.admin.query("begin");
    try {
      await h.admin.query(`alter table vendor_staff_roles disable trigger all`);
      await h.admin.query(`set local session_replication_role = replica`);
      await h.admin.query(`delete from vendor_staff_roles`);
      await h.admin.query(`delete from vendor_staff`);
      await h.admin.query(`set local session_replication_role = origin`);
      for (const [cidr, name] of [["0.0.0.0/0", "Pemilik"], ["bukan cidr", "Pemilik"], ["10.1.0.0/16", "x"]]) {
        const r = (await h.admin.query(`select vendor_bootstrap($1, $2, $3, 'Kantor') as r`, [await account(), name, cidr])).rows[0].r;
        expect(r, cidr).toMatchObject({ ok: false, code: "ERR_INVALID_INPUT" });
        expect((await h.admin.query(`select action, reason_code from vendor_actions order by seq desc limit 1`)).rows[0]).toEqual({ action: "vendor_bootstrap", reason_code: "invalid_input" });
      }
    } finally {
      await h.admin.query("rollback");
    }
    // Malformed payload ids are refused and logged, never a raw cast error.
    expect(await code(requestVendorAction(op, caller(SUP), T, { kind: "clinical_grant", staffId: "bukan-uuid" }, "Id yang tidak sah sama sekali"))).toBe("ERR_INVALID_INPUT");
    // Unknown kind with an unknown account and tenant still commits its refusal.
    const ghost = crypto.randomUUID();
    expect(await code(requestVendorAction(op, caller(ghost), crypto.randomUUID(), { kind: "nope" } as never, "Jenis yang tidak dikenal"))).toBe("ERR_NOT_FOUND");
    expect((await h.admin.query(`select account_id, tenant_id, reason_code from vendor_actions order by seq desc limit 1`)).rows[0]).toEqual({ account_id: null, tenant_id: null, reason_code: "unknown_kind" });
  });

  it("approvals and staff or allowlist changes need a fresh TOTP step-up (10 minutes); requests accept the session's", async () => {
    const old = new Date(Date.now() - 30 * 60_000);
    const t14 = await tenant();
    const id = await requestVendorAction(op, caller(FIN, IP, old), t14, { kind: "exit" }, "Kontrak berakhir bulan ini");
    expect(await code(decideVendorRequest(op, caller(PO, IP, old), id, true))).toBe("ERR_FORBIDDEN:totp_not_verified");
    expect(await code(createVendorStaff(op, caller(PO, IP, old), await account(), "Lama", ["support"]))).toBe("ERR_FORBIDDEN:totp_not_verified");
    expect(await code(setVendorIpAllowlist(op, caller(PO, IP, old), "198.51.100.0/24", "Cabang", true))).toBe("ERR_FORBIDDEN:totp_not_verified");
    expect(await decideVendorRequest(op, caller(PO), id, true)).toBe("approved");
  });

  it("an IPv4-mapped IPv6 caller is treated as IPv4 when removing a range; the log names the range", async () => {
    await setVendorIpAllowlist(op, caller(PO), "100.64.0.0/24", "Kantor cadangan", true);
    expect((await h.admin.query(`select reason_code, detail from vendor_actions order by seq desc limit 1`)).rows[0]).toEqual({ reason_code: "added", detail: "100.64.0.0/24" });
    expect(await code(setVendorIpAllowlist(op, caller(PO), "100.64.0.0/24", "Kantor cadangan", true))).toBe("ERR_VERSION_CONFLICT:already_present");
    expect(await code(setVendorIpAllowlist(op, caller(PO), "192.0.2.0/24", "", false))).toBe("ERR_NOT_FOUND");
    expect(await code(setVendorIpAllowlist(op, caller(PO, "::ffff:203.0.113.10"), "100.64.0.0/24", "", false))).toBe("ok");
    expect((await h.admin.query(`select reason_code, detail from vendor_actions order by seq desc limit 1`)).rows[0]).toEqual({ reason_code: "removed", detail: "100.64.0.0/24" });
  });

  it("two platform owners updating each other at once: both finish (no deadlock)", async () => {
    const x = await account();
    const y = await account();
    const xId = await createVendorStaff(op, caller(PO), x, "Pemilik X", ["platform_owner"]);
    const yId = await createVendorStaff(op, caller(PO), y, "Pemilik Y", ["platform_owner"]);
    const pools = [testPool({ connectionString: h.ownerUrl(), max: 1 }), testPool({ connectionString: h.ownerUrl(), max: 1 })];
    const [c1, c2] = await Promise.all(pools.map((p) => p.connect()));
    const r = await Promise.allSettled([
      updateVendorStaff(c1, caller(x), yId, ["platform_owner", "support"], "active"),
      updateVendorStaff(c2, caller(y), xId, ["platform_owner", "support"], "active"),
    ]);
    c1.release();
    c2.release();
    await Promise.all(pools.map((p) => p.end()));
    expect(r.map((v) => v.status)).toEqual(["fulfilled", "fulfilled"]);
  });

  it("a vendor call inside an open transaction is refused before anything runs", async () => {
    await op.query("begin");
    try {
      expect(await code(requestVendorAction(op, caller(FIN), T, { kind: "exit" }, "Di dalam transaksi pemanggil"))).toBe("ERR_FORBIDDEN:call outside an open transaction");
    } finally {
      await op.query("rollback");
    }
  });
});

describe("history and isolation", () => {
  it("requests and the action log are append-only; clinic_app reads and writes nothing of the vendor tables", async () => {
    const id = (await h.admin.query(`select id from vendor_requests limit 1`)).rows[0].id;
    await expect(h.admin.query(`delete from vendor_requests where id = $1`, [id])).rejects.toMatchObject({ code: "42501" });
    await expect(h.admin.query(`update vendor_requests set reason = 'diubah sesudahnya' where id = $1`, [id])).rejects.toMatchObject({ code: "42501" });
    await expect(h.admin.query(`update vendor_actions set outcome = 'success'`)).rejects.toMatchObject({ code: "42501" });
    await expect(h.admin.query(`delete from vendor_actions`)).rejects.toMatchObject({ code: "42501" });
    const c = await app.connect();
    try {
      for (const t of ["vendor_staff", "vendor_staff_roles", "vendor_ip_allowlist", "vendor_requests", "vendor_actions"]) {
        await expect(c.query(`select 1 from ${t} limit 1`), t).rejects.toMatchObject({ code: "42501" });
      }
      for (const f of [`vendor_request_decide('${PO}', '${IP}', now(), '${id}', true, null)`, `vendor_staff_create('${PO}', '${IP}', now(), '${PO}', 'x', '{support}')`, `vendor_bootstrap('${PO}', 'x', '10.0.0.0/16', 'x')`]) {
        await expect(c.query(`select ${f}`), f).rejects.toMatchObject({ code: "42501" });
      }
    } finally {
      c.release();
    }
  });
});
