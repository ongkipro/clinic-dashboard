// Piutang & Refund (UX-14, PR-21/37/15, T-078): every route (/piutang, a receivable, Ajukan Refund, a refund) and the actions.
// Each run seeds in B a paid counter tagihan with a cash refund requested and a balance refund paid, and an open receivable
// (seeded on the owner pool: its real path needs a performed addition); then runs as the caller's own FO/cashier and owner:
// B's rows are absent from the lists or not found; every write on B's rows is refused. As B's staff (positive control)
// everything succeeds. Synthetic data (MIG-2).
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { decideApproval } from "../../../src/modules/approvals/approvals";
import { publish } from "../../../src/modules/catalog/catalog";
import { issueKasirInvoice, openKasirInvoice, receivePayment } from "../../../src/modules/cashier/kasir/kasir";
import {
  collectReceivable, convertToReceivable, payRefund, piutang, refundOptions, refundPicks, requestRefund, requestWriteOff, writeOffAsOwner,
} from "../../../src/modules/cashier/receivables/receivables";
import { saveItem } from "../../../src/modules/inventory/stock";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

type CaseRole = "fo_cashier" | "owner" | "pharmacist";
const accOf = new Map<string, string>();
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole): Promise<string> {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('Staf', $1) returning id`, [`${role}.ptg78.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Piutang ${role}` });
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
type Seed = { name: string; invoice: string; line: string; cashRefund: string; paidRefund: string; receivable: string; receivable2: string; visit: string; visit2: string };
const latest = new Map<string, Seed>();
const items = new Map<string, string>();
async function victim(env: IsolationEnv): Promise<Seed> {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const k = () => crypto.randomUUID();
  const n = ++runs;
  let item = items.get(t);
  if (!item) {
    item = (await as(env, t, b, "owner", (db) => publish(db, { kind: "product", code: `PTG-${t.slice(0, 6).toUpperCase()}` },
      { name: "Produk Rahasia Piutang", tax_category: "non_object", tax_basis: "Barang", normal_price: 10_000 } as never, "Produk"))).itemId;
    await as(env, t, b, "pharmacist", (db) => saveItem(db, k(), null, { catalogItemId: item!, unit: "pcs", storage: "ruang", highValue: false, active: true }));
    items.set(t, item);
  }
  const name = `Pasien Rahasia Piutang ${t.slice(0, 8)} ${n}`;
  const id = crypto.randomUUID().replace(/-/g, "");
  const patient = (await env.owner.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $3, '1990-01-01', 'female', 'nik', $4, $5, 'islam', 'Karyawan', 's1', 'kawin', $2,
             (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id`,
    [t, b, name, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43)])).rows[0].id as string;
  const { invoiceId: invoice } = await as(env, t, b, "fo_cashier", (db) => openKasirInvoice(db, k(), { counter: true, patientId: patient }));
  await as(env, t, b, "fo_cashier", (db) => issueKasirInvoice(db, k(), invoice, [{ itemId: item!, quantity: 3 }]));
  await as(env, t, b, "fo_cashier", (db) => receivePayment(db, k(), invoice, [{ method: "cash", amount: 30_000, cashTendered: 30_000 }]));
  const line = (await env.owner.query(`select id from invoice_lines where invoice_id = $1`, [invoice])).rows[0].id as string;
  const paid = await as(env, t, b, "fo_cashier", (db) => requestRefund(db, k(), line, { amount: 5_000, reason: "Refund ke saldo B" }));
  const cash = await as(env, t, b, "fo_cashier", (db) => requestRefund(db, k(), line, { amount: 5_000, destination: "cash", reason: "Refund tunai B" }));
  // Approved by B's owner, so paying it is a write B itself can make (the positive control).
  await as(env, t, b, "owner", (db) => decideApproval(db as never, cash.approval_id!, true));
  // An open receivable of B on a visit (the owner pool; guards allow the insert shapes).
  const fo = (await env.owner.query(`select s.id from staff s join staff_roles r on r.staff_id = s.id where s.tenant_id = $1 and r.role = 'fo_cashier' limit 1`, [t])).rows[0].id;
  const visit = (await env.owner.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
    [t, b, patient, fo])).rows[0].id as string;
  const receivable = (await env.owner.query(`insert into receivables (tenant_id, branch_id, patient_id, visit_id, amount, command_key, created_by, created_as)
    values ($1, $2, $3, $4, 40000, $5, $6, 'fo_cashier') returning id`, [t, b, patient, visit, `rc-${k()}`, fo])).rows[0].id as string;
  // A second open receivable for the owner's write-off (the first carries the FO's pending request in the attempts).
  const receivable2 = (await env.owner.query(`insert into receivables (tenant_id, branch_id, patient_id, visit_id, amount, command_key, created_by, created_as)
    values ($1, $2, $3, $4, 20000, $5, $6, 'fo_cashier') returning id`, [t, b, patient, visit, `rc-${k()}`, fo])).rows[0].id as string;
  // A visit of B with a delivered unpaid remainder to convert: the visit tagihan for the product, issued unpaid, and its
  // line marked delivered by a handed dispensing on the owner pool (line-linked; the real visit path needs a selection or a
  // prescription and the pharmacist's prepare/hand-over chain).
  // (another patient of B: one open visit per patient)
  const id2 = crypto.randomUUID().replace(/-/g, "");
  const patient2 = (await env.owner.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $3, '1990-01-01', 'female', 'nik', $4, $5, 'islam', 'Karyawan', 's1', 'kawin', $2,
             (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id`,
    [t, b, `${name} Kedua`, `v1.1.${id2}.${id2}.${id2}`, (id2 + id2).slice(0, 43)])).rows[0].id as string;
  const visit2 = (await env.owner.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
    [t, b, patient2, fo])).rows[0].id as string;
  const { invoiceId: vinv } = await as(env, t, b, "fo_cashier", (db) => openKasirInvoice(db, k(), { patientId: patient2, visitId: visit2 }));
  await as(env, t, b, "fo_cashier", (db) => issueKasirInvoice(db, k(), vinv, [{ itemId: item!, quantity: 1 }]));
  const vline = (await env.owner.query(`select id from invoice_lines where invoice_id = $1`, [vinv])).rows[0].id as string;
  const si = (await env.owner.query(`select id from stock_items where tenant_id = $1 and catalog_item_id = $2`, [t, item])).rows[0].id as string;
  const ph = (await env.owner.query(`select s.id from staff s join staff_roles r on r.staff_id = s.id where s.tenant_id = $1 and r.role = 'pharmacist' limit 1`, [t])).rows[0].id;
  await env.owner.query(`alter table dispensings disable trigger dispensings_guard`);
  try {
    const depot = (await env.owner.query(`select id from depots where tenant_id = $1 and branch_id = $2 and is_default`, [t, b])).rows[0].id as string;
    await env.owner.query(`insert into dispensings (tenant_id, branch_id, visit_id, patient_id, invoice_line_id, stock_item_id, quantity, state,
                             prepared_at, prepared_by, prepare_key, depot_id, handed_at, handed_by, hand_key, checks)
      values ($1, $2, null, $3, $4, $5, 1, 'handed', now(), $6, $7, $8, now(), $6, $9, '{}'::jsonb)`, [t, b, patient2, vline, si, ph, `pk-${k()}`, depot, `hk-${k()}`]);
  } finally {
    await env.owner.query(`alter table dispensings enable always trigger dispensings_guard`);
  }
  for (const x of [name, invoice, line, cash.refund_id, paid.refund_id, receivable, receivable2, visit, visit2]) env.victimSecret(x);
  const r = { name, invoice, line, cashRefund: cash.refund_id, paidRefund: paid.refund_id, receivable, receivable2, visit, visit2 };
  latest.set(t, r);
  return r;
}
const outcome = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));
const marker = (env: IsolationEnv) => latest.get(env.victim.tenantId)?.name ?? "";
const ok = (x: unknown) => ({ status: 200, body: JSON.parse(JSON.stringify(x)) });
const route = (id: string, expect: "filtered" | "not-found", m: (env: IsolationEnv) => string, run: (env: IsolationEnv, v: Seed) => Promise<{ status: number; body: unknown }>) =>
  ({ kind: "route" as const, id, expect, marker: m, async run(env: IsolationEnv) { const v = await victim(env); return run(env, v) as never; } });
// The detail pages read through piutang_get; the caller's list never holds B's row (a missing row is a 404).
const pick = (list: { id: string }[], id: string) => (list.find((x) => x.id === id) ? { status: 200, body: list.find((x) => x.id === id) } : { status: 404, body: null });

export default defineCases(
  route("/piutang", "filtered", marker, (env) => asMine(env, "owner", (db) => piutang(db as never, null).then(ok))),
  route("/piutang/[receivableId]", "not-found", marker, (env, v) => asMine(env, "fo_cashier", (db) => piutang(db as never, null).then((d) => pick(d.receivables, v.receivable)))),
  route("/piutang/refund/baru", "filtered", marker, (env) => asMine(env, "fo_cashier", (db) => refundPicks(db as never).then(ok))),
  route("/piutang/refund/[refundId]", "not-found", marker, (env, v) => asMine(env, "owner", (db) => piutang(db as never, null).then((d) => (pick(d.refunds, v.cashRefund).status === 200 ? ok(d) : { status: 404, body: null })))),
  {
    kind: "action",
    id: "app/(app)/piutang/actions",
    marker,
    async run(env) {
      const v = await victim(env);
      const k = () => crypto.randomUUID();
      const attempts = {
        options: await outcome(asMine(env, "fo_cashier", (db) => refundOptions(db as never, v.invoice))),
        refund: await outcome(asMine(env, "fo_cashier", (db) => requestRefund(db as never, k(), v.line, { amount: 1_000, reason: "Coba lintas" }))),
        refundOwner: await outcome(asMine(env, "owner", (db) => requestRefund(db as never, k(), v.line, { amount: 1_000, reason: "Coba lintas owner" }))),
        pay: await outcome(asMine(env, "fo_cashier", (db) => payRefund(db as never, k(), v.cashRefund, "cash"))),
        convert: await outcome(asMine(env, "fo_cashier", (db) => convertToReceivable(db as never, k(), v.visit2))),
        collect: await outcome(asMine(env, "fo_cashier", (db) => collectReceivable(db as never, k(), v.receivable, { method: "cash", amount: 1_000, cashTendered: 1_000 }))),
        writeOffRequest: await outcome(asMine(env, "fo_cashier", (db) => requestWriteOff(db as never, k(), v.receivable, "Coba lintas"))),
        writeOff: await outcome(asMine(env, "owner", (db) => writeOffAsOwner(db as never, k(), v.receivable2, "Coba hapus buku lintas"))),
      };
      const read = await asMine(env, "owner", (db) => piutang(db as never, null).then((d) => d.receivables.find((x) => x.id === v.receivable)?.patient.name ?? null, () => null));
      return { attempts, body: { ...attempts, read } };
    },
  },
);
