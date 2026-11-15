// T-092 Done-when: Scenario PR-29 — a booked lead that arrived but paid nothing is refused converted until a payment exists; then it converts.
// Plus: the pipeline order and its facts (contacted, booked with an appointment, arrived with a checked-in visit), lost with a reason and
// reopen, the first response from the inbox conversation (TD-24 trigger), one open lead per conversation and patient cluster, the masked
// readers (marketing without consent, the auditor), BC own-only, branch scope, tenants, campaigns, guards, LeadStatusChanged (ids only).
// Synthetic data (MIG-2); no network (DEC-082).
import { createHash } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../../src/auth/policy";
import { APP_GROUP_ROLE, withTenantContext } from "../../src/db/rls/context";
import { openAppPool } from "../../src/db/rls/pool";
import { CommandError } from "../../src/lib/command";
import { setKekRingForTests } from "../../src/lib/keys/runtime";
import { issueKasirInvoice, openKasirInvoice, receivePayment } from "../../src/modules/cashier/kasir/kasir";
import { publish } from "../../src/modules/catalog/catalog";
import { campaignList, createLead, leadGet, leadList, saveCampaign, setLeadStage, updateLead } from "../../src/modules/crm/leads/leads";
import { saveItem } from "../../src/modules/inventory/stock";
import { mergePatients } from "../../src/modules/patients/merge/merge";
import { requestRefund } from "../../src/modules/cashier/receivables/receivables";
import { inboundText } from "../../src/modules/messaging/inbox/fixtures";
import { receiveMetaWebhook, sendInboxMessage, updateConversation } from "../../src/modules/messaging/inbox/inbox";
import { mockInboxPort, mockMetaAppSecret, signMeta } from "../../src/modules/messaging/inbox/mock";
import { mockWabaGraphPort } from "../../src/modules/messaging/waba/mock";
import { addWaNumber, completeWabaSignup, startWabaSignup } from "../../src/modules/messaging/waba/waba";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../src/modules/org/identity";
import { grantConsent, publishConsentText } from "../../src/modules/patients/consents/consents";
import { createHarness, type Harness, testPool } from "../rls/harness";

process.env.DEPLOY_ENV = "local";

let h: Harness;
let app: pg.Pool;
let owner: pg.Pool;
let n = 0;
type T = { tenantId: string; b1: string; b2: string };
type P = { acc: string; staffId: string; tenantId: string; role: Role; branch?: string };
const TENANT_WIDE = ["owner", "finance", "admin_pusat", "auditor", "purchasing", "marketing", "central_cs"];

async function tenant(name: string): Promise<T> {
  const tenantId = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, $2, 'emkm')`, [tenantId, name]);
  const br = async (c: string, nm: string) =>
    (await h.admin.query(`insert into branches (tenant_id, code, name, timezone, address) values ($1, $2, $3, 'Asia/Jakarta', 'Jl. Uji') returning id`, [tenantId, c, nm])).rows[0].id as string;
  return { tenantId, b1: await br("LD1", "Kemang"), b2: await br("LD2", "Bintaro") };
}
async function person(t: T, role: Role, ...branches: string[]): Promise<P> {
  const acc = (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`lead${++n}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(owner, { tenantId: t.tenantId, accountId: acc, displayName: `Staf Lead ${n}` });
  const rid = await assignRole(h.admin, { tenantId: t.tenantId, staffId, role });
  if (!TENANT_WIDE.includes(role)) for (const b of branches.length ? branches : [t.b1]) await assignBranch(h.admin, { tenantId: t.tenantId, staffRoleId: rid, branchId: b });
  return { acc, staffId, tenantId: t.tenantId, role, branch: TENANT_WIDE.includes(role) ? undefined : branches[0] ?? t.b1 };
}
const as = async <R>(p: P, fn: (db: pg.PoolClient) => Promise<R>) =>
  withTenantContext(app, await resolveContext(app, p.acc, { tenantId: p.tenantId, actingRole: p.role, activeBranchId: p.branch }), fn);
const why = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? `${e.code}:${(e as { reason?: string }).reason ?? ""}` : `raw:${e.code ?? e.message}`));
const code = (x: Promise<unknown>) => x.then(() => "ok", (e) => (e instanceof CommandError ? e.code : `raw:${e.code ?? e.message}`));
const key = () => crypto.randomUUID();
const raw = (sql: string, args: unknown[] = []) => h.admin.query(sql, args).then(() => "ok", (e) => `raw:${e.code}`);
async function patient(t: T, name: string, by: P) {
  return (await h.admin.query(`insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation,
       education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $2, '1990-01-01', 'female', 'nik', 'v1.1.aa.bb.cc', $3, 'islam', 'Karyawan', 's1',
       'kawin', $4, $5, 'fo_cashier') returning id`, [t.tenantId, name, createHash("sha256").update(name + Math.random()).digest("base64url").slice(0, 43), t.b1, by.staffId])).rows[0].id as string;
}
// A live appointment and a checked-in visit for the patient at Kemang (the facts behind booked and arrived).
async function appointment(t: T, pt: string) {
  await h.admin.query(`alter table appointments disable trigger appointments_guard`);
  try {
    return (await h.admin.query(`insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state, channel, created_by, created_as)
      values ($1, $2, $3, $4, $5, now() + interval '2 days', now() + interval '2 days 30 minutes', 'booked', 'phone', $5, 'fo_cashier') returning id`,
      [t.tenantId, t.b1, pt, facialV, DOC.staffId])).rows[0].id as string;
  } finally {
    await h.admin.query(`alter table appointments enable always trigger appointments_guard`);
  }
}
// check-in: the appointment arrives first (a booked visit opens on its arrived appointment), then the visit opens
async function visit(t: T, pt: string, apt: string) {
  await h.admin.query(`alter table appointments disable trigger appointments_guard`);
  try {
    await h.admin.query(`update appointments set state = 'arrived', state_changed_at = now(), state_changed_by = $2 where id = $1`, [apt, FO.staffId]);
  } finally {
    await h.admin.query(`alter table appointments enable always trigger appointments_guard`);
  }
  return (await h.admin.query(`insert into visits (tenant_id, branch_id, patient_id, appointment_id, kind, checked_in_by) values ($1, $2, $3, $4, 'booked', $5) returning id`,
    [t.tenantId, t.b1, pt, apt, FO.staffId])).rows[0].id as string;
}
// A visit invoice with the serum (no treatment needed) and optionally its payment.
async function invoice(pt: string, v: string, paid: boolean) {
  const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pt, visitId: v }));
  await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: serum, quantity: 1 }]));
  if (paid) await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 250_000, cashTendered: 250_000 }]));
  return invoiceId;
}

let A: T; let B: T;
let OWN: P; let CS: P; let BC: P; let BC2: P; let MGR: P; let MGR2: P; let MKT: P; let AU: P; let FO: P; let DOC: P; let FH: P; let ADM: P; let FIN: P; let BCS: P;
let facialV: string; let serum: string;
let META: string; let PN: string; let FO2: P; let RO: P; let wseq = 0;
// a signed recorded inbound message at the Kemang number (the mock app secret)
async function inbound(from: string, name: string, text: string) {
  const raw = JSON.stringify(inboundText({ wabaId: META, phoneNumberId: PN }, { id: `wamid.LEAD${Date.now()}${++wseq}`, from, name, text, at: Math.floor(Date.now() / 1000) }));
  await receiveMetaWebhook(app, raw, signMeta(mockMetaAppSecret()!, raw));
  return (await h.admin.query(`select * from conversations where tenant_id = $1 and contact_wa_id = $2`, [A.tenantId, from])).rows[0];
}

beforeAll(async () => {
  setKekRingForTests({ current: 1, keys: new Map([[1, Buffer.alloc(32, 4)]]) });
  h = await createHarness();
  app = await openAppPool({ connectionString: h.urlAs(await h.createLoginRole("", [APP_GROUP_ROLE])), max: 6 });
  owner = testPool({ connectionString: h.ownerUrl(), max: 2 });
  A = await tenant("PT Klinik Lead Sintetis");
  B = await tenant("PT Klinik Lain Lead Sintetis");
  OWN = await person(A, "owner"); CS = await person(A, "central_cs"); BC = await person(A, "bc", A.b1); BC2 = await person(A, "bc", A.b1);
  MGR = await person(A, "manager", A.b1); MGR2 = await person(A, "manager", A.b2); MKT = await person(A, "marketing"); AU = await person(A, "auditor");
  FO = await person(A, "fo_cashier", A.b1); DOC = await person(A, "doctor", A.b1); FH = await person(A, "facility_head", A.b1); ADM = await person(A, "admin_pusat");
  FIN = await person(A, "finance"); BCS = await person(B, "central_cs");
  const f = await as(OWN, (db) => publish(db, { kind: "service", code: "LD-FAC" }, {
    name: "Facial Lead", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 500_000, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
    indications: "Indikasi", consent_template: "Templat persetujuan Facial Lead.", delegation: "Dokter", aftercare_text: "Perawatan",
    eligibility: [{ role: "doctor", mode: "performs" }],
  } as never, "Layanan baru"));
  if (f.approvalId) await as(FH, (db) => db.query(`select approval_decide($1, true, null)`, [f.approvalId]));
  facialV = f.versionId;
  serum = (await as(OWN, (db) => publish(db, { kind: "product", code: "LD-SRM" }, { name: "Serum Lead", tax_category: "non_object", tax_basis: "Barang", normal_price: 250_000 } as never, "Produk"))).itemId;
  const ph = await person(A, "pharmacist", A.b1);
  await as(ph, (db) => saveItem(db, key(), null, { catalogItemId: serum, unit: "pcs", storage: "ruang", highValue: false, active: true }));
  // a connected WABA with a Kemang number (mock Graph port, recorded fixtures)
  const g = mockWabaGraphPort();
  const { wabaId } = await as(OWN, (db) => startWabaSignup(db, key(), { onboardingChannel: "cloud_api" }));
  await as(OWN, (db) => completeWabaSignup(db, wabaId, "code-verified", { port: g }));
  PN = `9${String(Date.now()).slice(-9)}`;
  await as(OWN, (db) => addWaNumber(db, key(), wabaId, { branchId: A.b1, phoneNumber: "+6281299990001", phoneNumberId: PN }, { port: g }));
  META = (await h.admin.query(`select meta_waba_id from waba_accounts where id = $1`, [wabaId])).rows[0].meta_waba_id as string;
  FO2 = await person(A, "fo_cashier", A.b1);
  RO = await person(A, "records_officer", A.b1);
}, 300_000);
afterAll(async () => {
  setKekRingForTests(undefined);
  await app?.end();
  await owner?.end();
  await h?.close();
});

describe("T-092 scenario PR-29 (converted requires payment)", () => {
  it("new → contacted → booked → arrived; converted refused until a payment exists, then converts", async () => {
    const pt = await patient(A, "Pasien Lead Sintetis", FO);
    const { leadId } = await as(CS, (db) => createLead(db, key(), { source: "instagram", patientId: pt, branchId: A.b1, contactName: "Rina Lead" }));
    expect(await why(as(CS, (db) => setLeadStage(db, key(), leadId, { to: "booked" })))).toBe("ERR_VERSION_CONFLICT:stage_order");
    expect((await as(CS, (db) => setLeadStage(db, key(), leadId, { to: "contacted" }))).stage).toBe("contacted");
    expect(await why(as(CS, (db) => setLeadStage(db, key(), leadId, { to: "booked" })))).toBe("ERR_VERSION_CONFLICT:appointment_required");
    const apt = await appointment(A, pt);
    expect((await as(CS, (db) => setLeadStage(db, key(), leadId, { to: "booked" }))).stage).toBe("booked");
    expect(await why(as(CS, (db) => setLeadStage(db, key(), leadId, { to: "arrived" })))).toBe("ERR_VERSION_CONFLICT:visit_required");
    const v = await visit(A, pt, apt);
    expect((await as(CS, (db) => setLeadStage(db, key(), leadId, { to: "arrived" }))).stage).toBe("arrived");
    // arrived, invoiced but unpaid: converted refused (Scenario PR-29)
    const inv = await invoice(pt, v, false);
    expect(await why(as(CS, (db) => setLeadStage(db, key(), leadId, { to: "converted" })))).toBe("ERR_VERSION_CONFLICT:payment_required");
    const d0 = await as(CS, (db) => leadGet(db, leadId));
    expect(d0.lead).toMatchObject({ stage: "arrived", next_invoice_id: null, contact_name: "Rina Lead" });
    // paid: converts, the invoice recorded
    await as(FO, (db) => receivePayment(db, key(), inv, [{ method: "cash", amount: 250_000, cashTendered: 250_000 }]));
    expect((await as(CS, (db) => leadGet(db, leadId))).lead.next_invoice_id).toBe(inv);
    expect((await as(CS, (db) => setLeadStage(db, key(), leadId, { to: "converted" }))).stage).toBe("converted");
    const row = (await h.admin.query(`select stage, converted_invoice_id, appointment_id, visit_id from leads where id = $1`, [leadId])).rows[0];
    expect(row).toEqual({ stage: "converted", converted_invoice_id: inv, appointment_id: apt, visit_id: v });
    // converted is final
    expect(await why(as(CS, (db) => setLeadStage(db, key(), leadId, { to: "lost", reason: "harga" })))).toBe("ERR_VERSION_CONFLICT:stage_order");
    const ev = (await h.admin.query(`select type, payload from domain_events where aggregate_id = $1 order by occurred_at`, [leadId])).rows;
    expect(ev.map((e) => e.payload.to_stage)).toEqual(["new", "contacted", "booked", "arrived", "converted"]);
    expect(JSON.stringify(ev)).not.toContain("Rina");
    expect((await as(CS, (db) => leadGet(db, leadId))).lead.events.map((e) => e.to_stage)).toEqual(["new", "contacted", "booked", "arrived", "converted"]);
  });

  it("a counter sale since the lead does not count; a non-counter invoice issued since the lead and paid does", async () => {
    const pt = await patient(A, "Pasien Kasir Lain", FO);
    const { leadId } = await as(CS, (db) => createLead(db, key(), { source: "phone", patientId: pt, branchId: A.b1 }));
    await as(CS, (db) => setLeadStage(db, key(), leadId, { to: "contacted" }));
    const apt = await appointment(A, pt);
    await as(CS, (db) => setLeadStage(db, key(), leadId, { to: "booked" }));
    const v = await visit(A, pt, apt);
    await as(CS, (db) => setLeadStage(db, key(), leadId, { to: "arrived" }));
    // an anonymous counter sale (no patient) paid in full: not the lead's payment
    const { invoiceId: counter } = await as(FO, (db) => openKasirInvoice(db, key(), { counter: true }));
    await as(FO, (db) => issueKasirInvoice(db, key(), counter, [{ itemId: serum, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), counter, [{ method: "cash", amount: 250_000, cashTendered: 250_000 }]));
    expect(await why(as(CS, (db) => setLeadStage(db, key(), leadId, { to: "converted" })))).toBe("ERR_VERSION_CONFLICT:payment_required");
    // a named invoice of another patient: refused
    const other = await patient(A, "Pasien Orang Lain", FO);
    const ov = await visit(A, other, await appointment(A, other));
    const oinv = await invoice(other, ov, true);
    expect(await why(as(CS, (db) => setLeadStage(db, key(), leadId, { to: "converted", invoiceId: oinv })))).toBe("ERR_VERSION_CONFLICT:payment_required");
    // the visit's own invoice paid: converts
    await invoice(pt, v, true);
    expect((await as(CS, (db) => setLeadStage(db, key(), leadId, { to: "converted" }))).stage).toBe("converted");
  });
});

async function arrivedLead(name: string) {
  const pt = await patient(A, name, FO);
  const { leadId } = await as(CS, (db) => createLead(db, key(), { source: "phone", patientId: pt, branchId: A.b1 }));
  await as(CS, (db) => setLeadStage(db, key(), leadId, { to: "contacted" }));
  const apt = await appointment(A, pt);
  await as(CS, (db) => setLeadStage(db, key(), leadId, { to: "booked" }));
  const v = await visit(A, pt, apt);
  await as(CS, (db) => setLeadStage(db, key(), leadId, { to: "arrived" }));
  return { pt, leadId, v };
}

describe("T-092 the paying invoice (lead_paid_invoice)", () => {
  it("a paid counter sale for the lead's own patient does not convert", async () => {
    const { pt, leadId } = await arrivedLead("Pasien Counter Sendiri");
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pt, counter: true }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: serum, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 250_000, cashTendered: 250_000 }]));
    expect(await why(as(CS, (db) => setLeadStage(db, key(), leadId, { to: "converted" })))).toBe("ERR_VERSION_CONFLICT:payment_required");
    expect(await why(as(CS, (db) => setLeadStage(db, key(), leadId, { to: "converted", invoiceId })))).toBe("ERR_VERSION_CONFLICT:payment_required");
  });

  it("another patient's paid non-visit invoice issued since the lead does not convert, named or not", async () => {
    const { leadId } = await arrivedLead("Pasien Tanpa Bayar Lain");
    const other = await patient(A, "Pasien Pembayar Lain", FO);
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: other }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: serum, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 250_000, cashTendered: 250_000 }]));
    expect(await why(as(CS, (db) => setLeadStage(db, key(), leadId, { to: "converted" })))).toBe("ERR_VERSION_CONFLICT:payment_required");
    expect(await why(as(CS, (db) => setLeadStage(db, key(), leadId, { to: "converted", invoiceId })))).toBe("ERR_VERSION_CONFLICT:payment_required");
  });

  it("a paid invoice on the same patient's earlier visit does not convert; the patient's own non-visit invoice since the lead does", async () => {
    const pt = await patient(A, "Pasien Kunjungan Lama", FO);
    const old = await visit(A, pt, await appointment(A, pt));
    const { invoiceId: oldInv } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pt, visitId: old }));
    await as(FO, (db) => issueKasirInvoice(db, key(), oldInv, [{ itemId: serum, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), oldInv, [{ method: "cash", amount: 250_000, cashTendered: 250_000 }]));
    // the earlier visit is closed (one open visit per patient and branch)
    await h.admin.query(`update visits set closed_at = now(), closed_by = $2 where id = $1`, [old, FO.staffId]);
    const { leadId } = await as(CS, (db) => createLead(db, key(), { source: "phone", patientId: pt, branchId: A.b1 }));
    await as(CS, (db) => setLeadStage(db, key(), leadId, { to: "contacted" }));
    const apt = await appointment(A, pt);
    await as(CS, (db) => setLeadStage(db, key(), leadId, { to: "booked" }));
    const v = await visit(A, pt, apt);
    await as(CS, (db) => setLeadStage(db, key(), leadId, { to: "arrived", visitId: v }));
    expect(await why(as(CS, (db) => setLeadStage(db, key(), leadId, { to: "converted", invoiceId: oldInv })))).toBe("ERR_VERSION_CONFLICT:payment_required");
    expect(await why(as(CS, (db) => setLeadStage(db, key(), leadId, { to: "converted" })))).toBe("ERR_VERSION_CONFLICT:payment_required");
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pt }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: serum, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 250_000, cashTendered: 250_000 }]));
    expect((await as(CS, (db) => setLeadStage(db, key(), leadId, { to: "converted" }))).stage).toBe("converted");
    expect((await h.admin.query(`select converted_invoice_id from leads where id = $1`, [leadId])).rows[0].converted_invoice_id).toBe(invoiceId);
  });

  it("a fully refunded paid line does not convert (refund_reserved / moved_to_balance count against the payment; Argon r1 P3-1)", async () => {
    const { pt, leadId, v } = await arrivedLead("Pasien Refund Penuh");
    const { invoiceId } = await as(FO, (db) => openKasirInvoice(db, key(), { patientId: pt, visitId: v }));
    await as(FO, (db) => issueKasirInvoice(db, key(), invoiceId, [{ itemId: serum, quantity: 1 }]));
    await as(FO, (db) => receivePayment(db, key(), invoiceId, [{ method: "cash", amount: 250_000, cashTendered: 250_000 }]));
    const line = (await h.admin.query(`select id from invoice_lines where invoice_id = $1 order by id limit 1`, [invoiceId])).rows[0].id as string;
    await as(FO, (db) => requestRefund(db, key(), line, { amount: 250_000, reason: "Dikembalikan utuh", destination: "balance" }));
    expect(await why(as(CS, (db) => setLeadStage(db, key(), leadId, { to: "converted" })))).toBe("ERR_VERSION_CONFLICT:payment_required");
  });
});

describe("T-092 pipeline rules", () => {
  it("booking needs a matched patient first, then a live appointment (a cancelled or no-show one is not live)", async () => {
    const { leadId } = await as(CS, (db) => createLead(db, key(), { source: "phone", branchId: A.b1, contactName: "Belum Cocok" }));
    await as(CS, (db) => setLeadStage(db, key(), leadId, { to: "contacted" }));
    expect(await why(as(CS, (db) => setLeadStage(db, key(), leadId, { to: "booked" })))).toBe("ERR_VERSION_CONFLICT:match_patient_first");
    const pt = await patient(A, "Pasien Janji Batal", FO);
    await as(CS, (db) => updateLead(db, leadId, { action: "match", patientId: pt }));
    const apt = await appointment(A, pt);
    for (const [state, extra] of [["cancelled", ", state_reason = 'Batal pasien'"], ["no_show", ", state_reason = null"]] as const) {
      await h.admin.query(`alter table appointments disable trigger appointments_guard`);
      try {
        await h.admin.query(`update appointments set state = $2, state_changed_at = now(), state_changed_by = $3${extra} where id = $1`, [apt, state, FO.staffId]);
      } finally {
        await h.admin.query(`alter table appointments enable always trigger appointments_guard`);
      }
      expect(await why(as(CS, (db) => setLeadStage(db, key(), leadId, { to: "booked" }))), state).toBe("ERR_VERSION_CONFLICT:appointment_required");
    }
  });

  it("lost needs a reason (a note for lainnya); reopen clears the funnel facts and keeps the first response", async () => {
    const { leadId } = await as(CS, (db) => createLead(db, key(), { source: "walk_in", branchId: A.b1, contactName: "Tamu Sintetis" }));
    await as(CS, (db) => setLeadStage(db, key(), leadId, { to: "contacted" }));
    expect(await why(as(CS, (db) => setLeadStage(db, key(), leadId, { to: "lost", reason: "lainnya" })))).toBe("ERR_INVALID_INPUT:lost_reason");
    expect((await as(CS, (db) => setLeadStage(db, key(), leadId, { to: "lost", reason: "lainnya", note: "Pindah kota" }))).stage).toBe("lost");
    const fr = (await h.admin.query(`select first_response_at from leads where id = $1`, [leadId])).rows[0].first_response_at;
    expect((await as(CS, (db) => setLeadStage(db, key(), leadId, { to: "new" }))).stage).toBe("new");
    expect((await h.admin.query(`select stage, lost_reason, lost_note, contacted_at, first_response_at from leads where id = $1`, [leadId])).rows[0])
      .toEqual({ stage: "new", lost_reason: null, lost_note: null, contacted_at: null, first_response_at: fr });
  });

  it("one open lead per patient cluster; the same key replays; campaigns tag leads", async () => {
    const pt = await patient(A, "Pasien Ganda Lead", FO);
    const k = key();
    const first = await as(CS, (db) => createLead(db, k, { source: "website", patientId: pt, branchId: A.b1 }));
    expect(await as(CS, (db) => createLead(db, k, { source: "website", patientId: pt, branchId: A.b1 }))).toEqual({ leadId: first.leadId, replayed: true });
    expect(await why(as(CS, (db) => createLead(db, key(), { source: "phone", patientId: pt, branchId: A.b1 })))).toBe("ERR_VERSION_CONFLICT:open_lead_exists");
    // the cluster, not the id: a lead on the duplicate (made before the merge) blocks one on the survivor after the merge
    const surv = await patient(A, "Pasien Gabung Asli", FO);
    const dup = await patient(A, "Pasien Gabung Ganda", FO);
    await as(CS, (db) => createLead(db, key(), { source: "phone", patientId: dup, branchId: A.b1 }));
    await as(RO, (db) => mergePatients(db, key(), surv, dup, "Data ganda: pasien sama"));
    expect(await why(as(CS, (db) => createLead(db, key(), { source: "phone", patientId: surv, branchId: A.b1 })))).toBe("ERR_VERSION_CONFLICT:open_lead_exists");
    // idempotency: the same key with another contact name is a different command
    const k2 = key();
    await as(CS, (db) => createLead(db, k2, { source: "walk_in", branchId: A.b1, contactName: "Nama Pertama" }));
    expect(await code(as(CS, (db) => createLead(db, k2, { source: "walk_in", branchId: A.b1, contactName: "Nama Kedua" })))).toBe("ERR_IDEMPOTENCY_CONFLICT");
    const { campaignId } = await as(MKT, (db) => saveCampaign(db, key(), { name: "Promo Akhir Tahun", code: "akhir-tahun", channel: "instagram" }));
    expect(await code(as(CS, (db) => saveCampaign(db, key(), { name: "Coba", code: "coba", channel: "ads" })))).toBe("ERR_FORBIDDEN");
    await as(CS, (db) => updateLead(db, first.leadId, { action: "campaign", campaignId }));
    expect((await as(MKT, (db) => campaignList(db))).campaigns.find((c) => c.id === campaignId)).toMatchObject({ leads: 1, active: true });
  });
});

describe("T-092 leads from the inbox (TD-24)", () => {
  it("a lead from a conversation takes its branch, patient and contact; the first staff reply stamps its first response once; one open lead per conversation", async () => {
    const from = "6281388880001";
    const c0 = await inbound(from, "Sari Percakapan", "Halo, mau tanya harga facial");
    expect(c0.first_response_at).toBeNull();
    const pt = await patient(A, "Pasien Percakapan Sintetis", FO);
    await as(FO2, (db) => updateConversation(db, c0.id, { action: "match", patientId: pt }));
    const { leadId } = await as(CS, (db) => createLead(db, key(), { source: "phone", conversationId: c0.id }));
    const l0 = (await h.admin.query(`select source, branch_id, patient_id, conversation_id, first_response_at from leads where id = $1`, [leadId])).rows[0];
    expect(l0).toEqual({ source: "whatsapp", branch_id: A.b1, patient_id: pt, conversation_id: c0.id, first_response_at: null });
    // the contact comes from the conversation (sealed there), shown to the lead readers, masked for marketing without consent
    expect((await as(CS, (db) => leadGet(db, leadId))).lead).toMatchObject({ contact_name: "Sari Percakapan", contact_phone: `+${from}`, conversation_id: c0.id });
    expect((await as(MKT, (db) => leadGet(db, leadId))).lead).toMatchObject({ contact_name: null, contact_phone: null, conversation_id: null });
    expect(await why(as(CS, (db) => createLead(db, key(), { source: "phone", conversationId: c0.id })))).toBe("ERR_VERSION_CONFLICT:open_lead_exists");
    // overdue before any reply (SET-20 default 15 minutes): backdate the lead
    await h.admin.query(`alter table leads disable trigger leads_guard`);
    await h.admin.query(`update leads set created_at = now() - interval '20 minutes' where id = $1`, [leadId]);
    await h.admin.query(`alter table leads enable always trigger leads_guard`);
    expect((await as(CS, (db) => leadGet(db, leadId))).lead).toMatchObject({ sla_overdue: true, response_minutes: null });
    // the first staff reply: the conversation's first response, copied to the lead by the trigger; later replies do not move it
    await as(FO2, (db) => sendInboxMessage(db, key(), c0.id, { kind: "text", body: "Halo Kak, harga mulai 350 ribu." }, { port: mockInboxPort() }));
    const fr = (await h.admin.query(`select first_response_at from conversations where id = $1`, [c0.id])).rows[0].first_response_at;
    expect(fr).not.toBeNull();
    const l1 = (await h.admin.query(`select first_response_at from leads where id = $1`, [leadId])).rows[0];
    expect(l1.first_response_at).toEqual(fr);
    expect((await as(CS, (db) => leadGet(db, leadId))).lead).toMatchObject({ sla_overdue: false, response_minutes: 20 });
    await as(FO2, (db) => sendInboxMessage(db, key(), c0.id, { kind: "text", body: "Ada lagi yang bisa dibantu?" }, { port: mockInboxPort() }));
    expect((await h.admin.query(`select first_response_at from leads where id = $1`, [leadId])).rows[0].first_response_at).toEqual(fr);
    // a lead created after the reply takes the conversation's first response at once (lost, then a new one is refused while reopen is possible)
    await as(CS, (db) => setLeadStage(db, key(), leadId, { to: "lost", reason: "duplikat" }));
    const second = await as(CS, (db) => createLead(db, key(), { source: "phone", conversationId: c0.id }));
    expect((await h.admin.query(`select first_response_at from leads where id = $1`, [second.leadId])).rows[0].first_response_at).toEqual(fr);
    expect(await why(as(CS, (db) => setLeadStage(db, key(), leadId, { to: "new" })))).toBe("ERR_VERSION_CONFLICT:open_lead_exists");
    // a conversation never matched to a patient: only the conversation rule (one open lead per conversation) refuses the reopen
    const c1 = await inbound("6281388880003", "Tanpa Pasien", "Masih ada promo?");
    const first = await as(CS, (db) => createLead(db, key(), { source: "phone", conversationId: c1.id }));
    expect((await h.admin.query(`select patient_id from leads where id = $1`, [first.leadId])).rows[0].patient_id).toBeNull();
    await as(CS, (db) => setLeadStage(db, key(), first.leadId, { to: "lost", reason: "tidak_merespons" }));
    await as(CS, (db) => createLead(db, key(), { source: "phone", conversationId: c1.id }));
    expect(await why(as(CS, (db) => setLeadStage(db, key(), first.leadId, { to: "new" })))).toBe("ERR_VERSION_CONFLICT:open_lead_exists");
  });

  it("a BC cannot create a lead for another branch's conversation; a Bintaro manager does not see it", async () => {
    const c = await inbound("6281388880002", "Tono Percakapan", "Info promo?");
    const bcB2 = await person(A, "bc", A.b2);
    expect(await code(as(bcB2, (db) => createLead(db, key(), { source: "phone", conversationId: c.id })))).toBe("ERR_NOT_FOUND");
    const { leadId } = await as(BC, (db) => createLead(db, key(), { source: "phone", conversationId: c.id }));
    expect((await h.admin.query(`select assignee_staff_id from leads where id = $1`, [leadId])).rows[0].assignee_staff_id).toBe(BC.staffId);
    expect(await code(as(MGR2, (db) => leadGet(db, leadId)))).toBe("ERR_NOT_FOUND");
  });
});

describe("T-092 roles, masking and tenants", () => {
  it("BC sees its own and unassigned leads only; managers their branch; marketing masked without consent; the auditor masked always", async () => {
    const pt = await patient(A, "Pasien Rahasia Lead", FO);
    const own = await as(BC, (db) => createLead(db, key(), { source: "referral", patientId: pt, contactName: "Kontak Rahasia" }));
    const other = await as(BC2, (db) => createLead(db, key(), { source: "phone", contactName: "Milik BC2" }));
    const ids = async (p: P) => (await as(p, (db) => leadList(db, "all"))).leads.map((l) => l.id);
    expect(await ids(BC)).toContain(own.leadId);
    expect(await ids(BC)).not.toContain(other.leadId);
    expect(await code(as(BC, (db) => leadGet(db, other.leadId)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BC, (db) => setLeadStage(db, key(), other.leadId, { to: "contacted" })))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BC, (db) => updateLead(db, own.leadId, { action: "assign", staffId: BC2.staffId })))).toBe("ERR_FORBIDDEN");
    expect(await ids(MGR)).toEqual(expect.arrayContaining([own.leadId, other.leadId]));
    expect(await ids(MGR2)).not.toContain(own.leadId);
    // marketing: masked until the patient consents to marketing
    const m0 = (await as(MKT, (db) => leadList(db, "all"))).leads.find((l) => l.id === own.leadId)!;
    expect(m0).toMatchObject({ patient_name: null, contact_name: null, contact_phone: null, consent_masked: true, lost_note: null, conversation_id: null });
    const textId = (await as(OWN, (db) => publishConsentText(db, { purpose: "marketing_wa", body: "Saya setuju menerima promosi." }))).id;
    await as(FO, (db) => grantConsent(db, key(), { patientId: pt, purpose: "marketing_wa", textId, channel: "in_person" }));
    const m1 = (await as(MKT, (db) => leadList(db, "all"))).leads.find((l) => l.id === own.leadId)!;
    expect(m1).toMatchObject({ patient_name: "Pasien Rahasia Lead", contact_name: "Kontak Rahasia", consent_masked: false });
    // the auditor: no names, the MRN tail only
    const a0 = (await as(AU, (db) => leadGet(db, own.leadId))).lead;
    expect(a0).toMatchObject({ patient_name: null, contact_name: null, consent_masked: true });
    expect(a0.patient_mrn).toMatch(/^\*\*\*.{3}$/);
    // writers: central_cs, bc, manager only
    for (const p of [OWN, MKT, AU, FO, ADM, FIN, DOC]) expect(await code(as(p, (db) => createLead(db, key(), { source: "phone", branchId: A.b1 }))), p.role).toBe("ERR_FORBIDDEN");
    expect(await why(as(MKT, (db) => createLead(db, key(), { source: "phone", branchId: A.b1 })))).toBe("ERR_FORBIDDEN:role may not work leads");
    // RLS itself: the Bintaro manager reads none of Kemang's lead rows or history; the Kemang manager does
    expect((await as(MGR2, (db) => db.query(`select id from leads where id = $1`, [own.leadId]))).rowCount).toBe(0);
    expect((await as(MGR2, (db) => db.query(`select id from lead_events where lead_id = $1`, [own.leadId]))).rowCount).toBe(0);
    expect((await as(MGR, (db) => db.query(`select id from leads where id = $1`, [own.leadId]))).rowCount).toBe(1);
    // every definer accepts exactly its key set
    expect(await code(as(CS, (db) => db.query(`select lead_stage_set($1, '{"to":"contacted","x":1}'::jsonb)`, [own.leadId])))).toBe("raw:22023");
    expect(await code(as(CS, (db) => db.query(`select lead_update($1, '{"action":"unassign","x":1}'::jsonb)`, [own.leadId])))).toBe("raw:22023");
    expect(await code(as(CS, (db) => db.query(`select lead_create('k-extra-0001', '{"source":"phone","x":1}'::jsonb)`)))).toBe("raw:22023");
    expect(await code(as(MKT, (db) => db.query(`select campaign_save('k-extra-0002', '{"name":"X","code":"xx","channel":"ads","x":1}'::jsonb)`)))).toBe("raw:22023");
    for (const p of [FO, ADM, FIN, DOC]) expect(await code(as(p, (db) => leadList(db))), p.role).toBe("ERR_FORBIDDEN");
    // the sealed contact columns are not granted; another tenant sees nothing
    expect(await code(as(CS, (db) => db.query(`select contact_name_enc from leads`)))).toBe("raw:42501");
    expect(await code(as(CS, (db) => db.query(`select lost_note from leads`)))).toBe("raw:42501");
    expect((await as(BCS, (db) => leadList(db, "all"))).leads.map((l) => l.id)).not.toContain(own.leadId);
    expect(await code(as(BCS, (db) => leadGet(db, own.leadId)))).toBe("ERR_NOT_FOUND");
    expect(await code(as(BCS, (db) => setLeadStage(db, key(), own.leadId, { to: "contacted" })))).toBe("ERR_NOT_FOUND");
  });

  it("guards: never deleted; the source and a set first response frozen; the stage moves along the pipeline only", async () => {
    const { leadId } = await as(CS, (db) => createLead(db, key(), { source: "phone", branchId: A.b1 }));
    expect(await raw(`delete from leads where id = $1`, [leadId])).toBe("raw:42501");
    expect(await raw(`update leads set source = 'ads' where id = $1`, [leadId])).toBe("raw:42501");
    expect(await raw(`update leads set stage = 'arrived', contacted_at = now(), first_response_at = now(), booked_at = now(), arrived_at = now() where id = $1`, [leadId])).toBe("raw:42501");
    expect(await raw(`update lead_events set reason = 'harga' where lead_id = $1`, [leadId])).toBe("raw:42501");
    for (const t of ["campaigns", "leads", "lead_events"]) expect(await raw(`truncate ${t} cascade`), t).toBe("raw:42501");
    const trg = (await h.admin.query(`select tgname from pg_trigger where tgname = any($1) and tgenabled = 'A' order by 1`,
      [["campaigns_guard", "leads_guard", "lead_events_guard", "campaigns_no_truncate", "leads_no_truncate", "lead_events_no_truncate", "conversations_lead_first_response"]])).rows;
    expect(trg).toHaveLength(7);
  });
});
