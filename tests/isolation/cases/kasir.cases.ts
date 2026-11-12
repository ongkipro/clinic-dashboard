// Kasir (UX-12, PR-19, T-072): every route (/kasir, terbuka, jual-cepat, the tagihan, Buat Tagihan for a visit, the
// struk and its PDF) and the actions. Each run seeds in B a counter tagihan (issued, part paid, with a receipt) and an
// open visit; then runs as the caller's own FO/cashier and owner: B's rows are absent from the lists or not found;
// every write on B's rows is refused. As B's staff (positive control) everything succeeds. Synthetic data (MIG-2).
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { publish } from "../../../src/modules/catalog/catalog";
import {
  getReceipt, issueKasirInvoice, kasirCounterItems, kasirInvoice, kasirQueue, kasirVisitLines, openKasirInvoice, receivePayment, requestVoid,
} from "../../../src/modules/cashier/kasir/kasir";
import { saveItem } from "../../../src/modules/inventory/stock";
import { setKekRingForTests } from "../../../src/lib/keys/runtime";
import { cancelCharge, createCharge, enableMockPort, pollCharge } from "../../../src/modules/payments/payments";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";
setKekRingForTests({ current: 1, keys: new Map([[1, Buffer.alloc(32, 5)]]) });

type CaseRole = "fo_cashier" | "owner" | "pharmacist" | "manager";
const accOf = new Map<string, string>();
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole): Promise<string> {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('Staf', $1) returning id`, [`${role}.ksr72.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Kasir ${role}` });
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId, staffId, role });
    if (role !== "owner") await assignBranch(c, { tenantId, staffRoleId: rid, branchId });
  } finally {
    c.release();
  }
  accOf.set(k, acc);
  return acc;
}
async function as<T>(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole, fn: (db: never) => Promise<T>): Promise<T> {
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const acc = await member(env, tenantId, branchId, role);
  const ctx = await resolveContext(env.app, acc, { tenantId, actingRole: role, activeBranchId: role === "owner" ? undefined : branchId });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}
const asMine = <T>(env: IsolationEnv, role: CaseRole, fn: (db: never) => Promise<T>) => as(env, env.actor.tenantId, env.actor.branchId, role, fn);

let runs = 0;
type Seed = { name: string; invoice: string; number: string; receipt: string; receiptNumber: string; unpaid: string; visit: string; patient: string; item: string; charge: string };
const latest = new Map<string, Seed>();
const items = new Map<string, string>();
async function victim(env: IsolationEnv): Promise<Seed> {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const k = () => crypto.randomUUID();
  const n = ++runs;
  let item = items.get(t);
  if (!item) {
    item = (await as(env, t, b, "owner", (db) => publish(db, { kind: "product", code: `KSR-${t.slice(0, 6).toUpperCase()}` },
      { name: "Produk Rahasia Kasir", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 10_000 } as never, "Produk"))).itemId;
    await as(env, t, b, "pharmacist", (db) => saveItem(db, k(), null, { catalogItemId: item!, unit: "pcs", storage: "ruang", highValue: false, active: true }));
    items.set(t, item);
  }
  const name = `Pasien Rahasia Kasir ${t.slice(0, 8)} ${n}`;
  const id = crypto.randomUUID().replace(/-/g, "");
  const patient = (await env.owner.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $3, '1990-01-01', 'female', 'nik', $4, $5, 'islam', 'Karyawan', 's1', 'kawin', $2,
             (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id`,
    [t, b, name, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43)])).rows[0].id as string;
  const { invoiceId: invoice } = await as(env, t, b, "fo_cashier", (db) => openKasirInvoice(db, k(), { counter: true, patientId: patient }));
  const issued = await as(env, t, b, "fo_cashier", (db) => issueKasirInvoice(db, k(), invoice, [{ itemId: item!, quantity: 2 }]));
  const paid = await as(env, t, b, "fo_cashier", (db) => receivePayment(db, k(), invoice, [{ method: "cash", amount: 5_000, cashTendered: 5_000 }]));
  // an unpaid tagihan of B (a void request is only for unpaid ones)
  const { invoiceId: unpaid } = await as(env, t, b, "fo_cashier", (db) => openKasirInvoice(db, k(), { counter: true, patientId: patient }));
  await as(env, t, b, "fo_cashier", (db) => issueKasirInvoice(db, k(), unpaid, [{ itemId: item!, quantity: 1 }]));
  // T-073: a mock port for both tenants and a pending QRIS charge on B's paid-in-part tagihan.
  for (const [tt, bb] of [[t, b], [env.actor.tenantId, env.actor.branchId]]) await as(env, tt, bb, "manager", (db) => enableMockPort(db));
  const { charge_id: charge } = await as(env, t, b, "fo_cashier", (db) => createCharge(db, k(), invoice, { channel: "qris" }));
  const fo = (await env.owner.query(`select s.id from staff s join staff_roles r on r.staff_id = s.id where s.tenant_id = $1 and r.role = 'fo_cashier' limit 1`, [t])).rows[0].id;
  const visit = (await env.owner.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by, selection) values ($1, $2, $3, 'walk_in', $4, 'done') returning id`,
    [t, b, patient, fo])).rows[0].id as string;
  for (const x of [name, invoice, issued.number, paid.receipt_id, paid.number, unpaid, visit, patient, charge]) env.victimSecret(x);
  const r = { name, invoice, number: issued.number, receipt: paid.receipt_id, receiptNumber: paid.number, unpaid, visit, patient, item: item!, charge };
  latest.set(t, r);
  return r;
}
const outcome = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));
const notFound = (e: unknown) => (e instanceof CommandError && (e.code === "ERR_NOT_FOUND" || e.code === "ERR_FORBIDDEN") ? { status: 404, body: null } : Promise.reject(e));
const marker = (env: IsolationEnv) => latest.get(env.victim.tenantId)?.name ?? "";
const idMarker = (k: keyof Seed) => (env: IsolationEnv) => String(latest.get(env.victim.tenantId)?.[k] ?? "");
const ok = (x: unknown) => ({ status: 200, body: JSON.parse(JSON.stringify(x)) });
const route = (id: string, expect: "filtered" | "not-found", m: (env: IsolationEnv) => string, run: (env: IsolationEnv, v: Seed) => Promise<{ status: number; body: unknown }>) =>
  ({ kind: "route" as const, id, expect, marker: m, async run(env: IsolationEnv) { const v = await victim(env); return run(env, v) as never; } });

export default defineCases(
  route("/kasir", "filtered", marker, (env) => asMine(env, "fo_cashier", (db) => kasirQueue(db as never, null).then(ok))),
  route("/kasir/terbuka", "filtered", idMarker("number"), (env) => asMine(env, "owner", (db) => kasirQueue(db as never, null).then(ok))),
  route("/kasir/jual-cepat", "filtered", idMarker("item"), (env) => asMine(env, "fo_cashier", (db) => kasirCounterItems(db as never, null, null).then(ok))),
  route("/kasir/[invoiceId]", "not-found", marker, (env, v) => asMine(env, "owner", (db) => kasirInvoice(db as never, v.invoice).then(ok, notFound))),
  route("/kasir/kunjungan/[visitId]", "not-found", marker, (env, v) => asMine(env, "fo_cashier", (db) => kasirVisitLines(db as never, v.visit).then(ok, notFound))),
  // The built-in receipt body names no patient (BILL-19 commercial facts only): its number is the marker.
  route("/kasir/struk/[receiptId]", "not-found", idMarker("receiptNumber"), (env, v) => asMine(env, "owner", (db) => getReceipt(db as never, v.receipt).then(ok, notFound))),
  // The handler renders the PDF from receipt_get; its data path for B's receipt is refused.
  route("/kasir/struk/[receiptId]/pdf#route", "not-found", idMarker("receiptNumber"), (env, v) => asMine(env, "fo_cashier", (db) => getReceipt(db as never, v.receipt).then(ok, notFound))),
  {
    kind: "action",
    id: "app/(app)/kasir/actions",
    marker,
    async run(env) {
      const v = await victim(env);
      const k = () => crypto.randomUUID();
      const attempts = {
        // a tagihan for B's patient or B's visit at the caller's branch
        open: await outcome(asMine(env, "fo_cashier", (db) => openKasirInvoice(db as never, k(), { patientId: v.patient, visitId: v.visit }))),
        counterPatient: await outcome(asMine(env, "fo_cashier", (db) => openKasirInvoice(db as never, k(), { counter: true, patientId: v.patient }))),
        // B's product on the caller's own draft
        issue: await outcome(asMine(env, "fo_cashier", async (db) => {
          const { invoiceId } = await openKasirInvoice(db as never, k(), { counter: true });
          return issueKasirInvoice(db as never, k(), invoiceId, [{ itemId: v.item, quantity: 1 }]);
        })),
        pay: await outcome(asMine(env, "fo_cashier", (db) => receivePayment(db as never, k(), v.invoice, [{ method: "cash", amount: 1, cashTendered: 1 }]))),
        payOwner: await outcome(asMine(env, "owner", (db) => receivePayment(db as never, k(), v.invoice, [{ method: "edc", amount: 1 }]))),
        // T-073: the port actions on B's tagihan and B's pending charge (both tenants have the mock port); before the
        // void request, which would leave the unpaid tagihan waiting for a decision.
        portCharge: await outcome(asMine(env, "fo_cashier", (db) => createCharge(db as never, k(), v.unpaid, { channel: "qris" }))),
        portPoll: await outcome(asMine(env, "fo_cashier", (db) => pollCharge(db as never, v.charge).then(() => undefined))),
        portCancel: await outcome(asMine(env, "fo_cashier", (db) => cancelCharge(db as never, v.charge))),
        void: await outcome(asMine(env, "fo_cashier", (db) => requestVoid(db as never, k(), v.unpaid, "Coba lintas"))),
      };
      const read = await asMine(env, "owner", (db) => kasirInvoice(db as never, v.invoice).then((x) => x.patient?.name ?? null, () => null));
      return { attempts, body: { ...attempts, read } };
    },
  },
);
