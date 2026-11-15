// Komisi (UX-16, PR-23, T-087): Rekap Komisi & Batch, one batch, its CSV export, Aturan Komisi, Komisi Saya and the actions. Each run
// seeds in B the fixture rules (once), a package sale whose closing BC is set by command and paid (B's BC earns 5 %), a draft rule version,
// a draft batch and an approved batch of past months; then runs as the caller's own owner, finance and BC: B's batches, rules and rows are
// absent from the lists, B's batch and export are not found, B's commission never appears in the caller's Komisi Saya, and every write on
// B's rows (attribution, rule version, decision, submit, mark paid, the simulator on B's item) is refused. As B's staff (positive control)
// everything succeeds. Synthetic data (MIG-2).
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { decideApproval } from "../../../src/modules/approvals/approvals";
import { issueKasirInvoice, openKasirInvoice, receivePayment } from "../../../src/modules/cashier/kasir/kasir";
import { publish } from "../../../src/modules/catalog/catalog";
import {
  attributeSale, createRule, decideRuleVersion, exportBatch, getBatch, listBatches, listRules, markBatchPaid, myCommission, newRuleVersion, openBatch, simulateRule, submitBatch,
} from "../../../src/modules/commission/commission";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { setPackageContents } from "../../../src/modules/packages/packages";
import { defineCases, expectLive, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

type CaseRole = "owner" | "finance" | "fo_cashier" | "bc" | "facility_head";
const accOf = new Map<string, { acc: string; staffId: string }>();
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole) {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('Staf', $1) returning id`, [`${role}.kms87.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Komisi Rahasia ${role} ${tenantId.slice(0, 6)}` });
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId, staffId, role });
    if (role === "fo_cashier" || role === "bc" || role === "facility_head") await assignBranch(c, { tenantId, staffRoleId: rid, branchId });
  } finally {
    c.release();
  }
  accOf.set(k, { acc, staffId });
  return { acc, staffId };
}
async function as<T>(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole, fn: (db: never) => Promise<T>): Promise<T> {
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const { acc } = await member(env, tenantId, branchId, role);
  const wide = role === "owner" || role === "finance";
  const ctx = await resolveContext(env.app, acc, { tenantId, actingRole: role, activeBranchId: wide ? undefined : branchId });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}
const asMine = <T>(env: IsolationEnv, role: CaseRole, fn: (db: never) => Promise<T>) => as(env, env.actor.tenantId, env.actor.branchId, role, fn);

let runs = 0;
type Seed = { itemName: string; item: string; invoice: string; rule: string; ruleName: string; draft: string; batch: string; approved: string; month: string; approvedMonth: string };
const latest = new Map<string, Seed>();
const setup = new Map<string, { item: string; itemName: string; rule: string; ruleName: string }>();
const month = (n: number) => { const t = 2019 * 12 + 11 - n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
async function victim(env: IsolationEnv): Promise<Seed> {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const k = () => crypto.randomUUID();
  const n = ++runs;
  let s = setup.get(t);
  if (!s) {
    const svc = await as(env, t, b, "owner", (db) => publish(db, { kind: "service", code: `KMS-${t.slice(0, 6).toUpperCase()}` }, {
      name: "Layanan Rahasia Komisi", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 100_000, category: "facial", prep_min: 10, treatment_min: 30,
      buffer_min: 10, indications: "Indikasi", consent_template: "Templat.", delegation: "Dokter", aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }],
    } as never, "Baru"));
    if (svc.approvalId) await as(env, t, b, "facility_head", (db) => (db as unknown as { query: (s: string, a: unknown[]) => Promise<unknown> }).query(`select approval_decide($1, true, null)`, [svc.approvalId]));
    const itemName = `Paket Rahasia Komisi ${t.slice(0, 8)}`;
    const pk = await as(env, t, b, "owner", (db) => publish(db, { kind: "package", code: `KMP-${t.slice(0, 6).toUpperCase()}` },
      { name: itemName, tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 200_000 } as never, "Baru"));
    await as(env, t, b, "owner", (db) => setPackageContents(db, k(), pk.versionId, [{ serviceItemId: svc.itemId, count: 2 }]));
    const ruleName = `Aturan Rahasia ${t.slice(0, 8)}`;
    const r = await as(env, t, b, "finance", (db) => createRule(db, k(), { contributionType: "closing_bc", name: ruleName, kind: "percent", basisPoints: 500 }));
    await as(env, t, b, "owner", (db) => decideRuleVersion(db, r.versionId, "activate"));
    s = { item: pk.itemId, itemName, rule: r.ruleId, ruleName };
    setup.set(t, s);
  }
  const bc = await member(env, t, b, "bc");
  const id = crypto.randomUUID().replace(/-/g, "");
  const patient = (await env.owner.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Pasien Rahasia Komisi', '1990-01-01', 'female', 'nik', $3, $4, 'islam', 'Karyawan', 's1', 'kawin', $2,
             (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id`,
    [t, b, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43)])).rows[0].id as string;
  const { invoiceId: invoice } = await as(env, t, b, "fo_cashier", (db) => openKasirInvoice(db, k(), { patientId: patient }));
  await as(env, t, b, "fo_cashier", (db) => issueKasirInvoice(db, k(), invoice, [{ itemId: s!.item, quantity: 1 }]));
  await as(env, t, b, "fo_cashier", (db) => attributeSale(db, k(), invoice, { closingBcId: bc.staffId }));
  await as(env, t, b, "fo_cashier", (db) => receivePayment(db, k(), invoice, [{ method: "cash", amount: 100_000, cashTendered: 100_000 }]));
  const { versionId: draft } = await as(env, t, b, "finance", (db) => newRuleVersion(db, k(), s!.rule, { kind: "percent", basisPoints: 600 + n }));
  // past months, descending per run (a submit needs no earlier open batch): an approved batch holding B's BC commission (its accrual moved into
  // that month through the seeding pool, the guard paused), and a later draft
  await env.owner.query(`alter table commission_entitlements disable trigger commission_entitlements_insert_only`);
  try {
    await env.owner.query(`update commission_entitlements set accrued_at = $2::date + interval '10 days'
      where contribution_id in (select c.id from commission_contributions c join invoice_lines l on l.id = c.invoice_line_id where l.invoice_id = $1)`, [invoice, `${month(2 * n)}-01`]);
  } finally {
    await env.owner.query(`alter table commission_entitlements enable always trigger commission_entitlements_insert_only`);
  }
  const approved = (await as(env, t, b, "finance", (db) => openBatch(db, k(), month(2 * n)))).batchId;
  const ap = await as(env, t, b, "finance", (db) => submitBatch(db, approved));
  await as(env, t, b, "owner", (db) => decideApproval(db, ap, true));
  const batch = (await as(env, t, b, "finance", (db) => openBatch(db, k(), month(2 * n - 1)))).batchId;
  for (const x of [s.itemName, s.ruleName, invoice, patient, draft, batch, approved, s.rule, `Staf Komisi Rahasia bc ${t.slice(0, 6)}`]) env.victimSecret(x);
  const r = { itemName: s.itemName, item: s.item, invoice, rule: s.rule, ruleName: s.ruleName, draft, batch, approved, month: month(2 * n - 1), approvedMonth: month(2 * n) };
  latest.set(t, r);
  return r;
}
const outcome = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));
const ok = (x: unknown) => ({ status: 200, body: JSON.parse(JSON.stringify(x)) });
const notFound = (e: unknown) => (e instanceof CommandError && e.code === "ERR_NOT_FOUND" ? { status: 404, body: null } : Promise.reject(e));
const route = (id: string, expect: "filtered" | "not-found", m: (env: IsolationEnv) => string, run: (env: IsolationEnv, v: Seed) => Promise<{ status: number; body: unknown }>) =>
  ({ kind: "route" as const, id, expect, marker: m, async run(env: IsolationEnv) { const v = await victim(env); return run(env, v) as never; } });
const batchMarker = (env: IsolationEnv) => latest.get(env.victim.tenantId)?.batch ?? "";
const ruleMarker = (env: IsolationEnv) => latest.get(env.victim.tenantId)?.ruleName ?? "";
const itemMarker = (env: IsolationEnv) => latest.get(env.victim.tenantId)?.itemName ?? "";
const bcMarker = (env: IsolationEnv) => `Staf Komisi Rahasia bc ${env.victim.tenantId.slice(0, 6)}`;
const thisMonth = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }).slice(0, 7);

export default defineCases(
  route("/komisi", "filtered", batchMarker, async (env) => ok({
    owner: await asMine(env, "owner", (db) => listBatches(db as never)), finance: await asMine(env, "finance", (db) => listBatches(db as never)),
  })),
  route("/komisi/batch/[id]", "not-found", batchMarker, (env, v) => asMine(env, "owner", (db) => getBatch(db as never, v.batch).then(ok, notFound))),
  route("/komisi/batch/[id]/ekspor#route", "not-found", bcMarker, (env, v) => asMine(env, "finance", (db) => exportBatch(db as never, v.approved)
    .then((rows) => ({ status: 200, body: { batch: v.approved, rows } }), notFound))),
  route("/komisi/aturan", "filtered", ruleMarker, async (env) => ok({
    owner: await asMine(env, "owner", (db) => listRules(db as never)), finance: await asMine(env, "finance", (db) => listRules(db as never)),
  })),
  // The caller's own BC: never B's commission (B's item name is the marker; as B's BC it is on the month's rows).
  route("/saya/komisi", "filtered", itemMarker, (env, v) => asMine(env, "bc", async (db) => ({ now: await myCommission(db as never, thisMonth()),
    old: await myCommission(db as never, v.approvedMonth) })).then(ok)),
  {
    kind: "action",
    id: "app/(app)/komisi/actions",
    marker: ruleMarker,
    async run(env) {
      const v = await victim(env);
      const k = () => crypto.randomUUID();
      const bc = await member(env, env.actor.tenantId, env.actor.branchId, "bc");
      await expectLive(env, "B's draft rule version", `exists (select 1 from commission_rule_versions where id = $1 and state = 'draft')`, [v.draft]);
      await expectLive(env, "B's draft batch", `exists (select 1 from payout_batches where id = $1 and state = 'draft')`, [v.batch]);
      await expectLive(env, "B's approved batch", `exists (select 1 from payout_batches where id = $1 and state = 'approved')`, [v.approved]);
      const attempts = {
        attribute: await outcome(asMine(env, "fo_cashier", (db) => attributeSale(db as never, k(), v.invoice, { closingBcId: bc.staffId, reason: "Coba lintas" }))),
        newVersion: await outcome(asMine(env, "finance", (db) => newRuleVersion(db as never, k(), v.rule, { kind: "percent", basisPoints: 900 }))),
        decide: await outcome(asMine(env, "owner", (db) => decideRuleVersion(db as never, v.draft, "activate"))),
        submit: await outcome(asMine(env, "finance", (db) => submitBatch(db as never, v.batch))),
        markPaid: await outcome(asMine(env, "finance", (db) => markBatchPaid(db as never, v.approved, "transfer"))),
        simulate: await outcome(asMine(env, "finance", (db) => simulateRule(db as never, { itemId: v.item, price: 100_000, closingBcId: bc.staffId }))),
      };
      const read = await asMine(env, "owner", (db) => listRules(db as never).then((d) => d.rules.find((r) => r.id === v.rule)?.name ?? null));
      return { attempts, body: { ...attempts, read } };
    },
  },
);
