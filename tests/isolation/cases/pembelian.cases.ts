// Pembelian (UX-52, PR-17, PR-75, PR-90, T-067): every route (/pembelian, pemasok and its detail, po and its detail,
// penerimaan, retur, transfer, utang) and the actions. Each run seeds in B a fresh supplier, a sent PO with a receipt,
// an invoice, a return and an inter-branch transfer; then runs as the caller's own purchasing / finance / pharmacist:
// B's rows are absent from the lists or not found; every write on B's rows is refused. As B's staff (positive control)
// everything succeeds. Synthetic data (MIG-2).
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { publish } from "../../../src/modules/catalog/catalog";
import { cancelTransfer, listTransfers, sendToBranch } from "../../../src/modules/inventory/depots/depots";
import { saveItem } from "../../../src/modules/inventory/stock";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import {
  cancelPurchaseOrder, getPurchaseOrder, listPurchaseOrders, listReceipts, payableOverview, purchasingContext, receiveGoods, recordInvoice, recordPayment,
  savePurchaseOrder, sendPurchaseOrder,
} from "../../../src/modules/purchasing/payables/payables";
import { getSupplier, listReturns, listSuppliers, returnToSupplier, saveSupplier } from "../../../src/modules/purchasing/suppliers/suppliers";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

type CaseRole = "pharmacist" | "purchasing" | "finance" | "owner";
const accOf = new Map<string, string>();
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole): Promise<string> {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('Staf', $1) returning id`, [`${role}.pmb67.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Pembelian ${role}` });
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId, staffId, role });
    if (role === "pharmacist") await assignBranch(c, { tenantId, staffRoleId: rid, branchId });
  } finally {
    c.release();
  }
  accOf.set(k, acc);
  return acc;
}
async function as<T>(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole, fn: (db: never) => Promise<T>): Promise<T> {
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const acc = await member(env, tenantId, branchId, role);
  const ctx = await resolveContext(env.app, acc, { tenantId, actingRole: role, activeBranchId: role === "pharmacist" ? branchId : undefined });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}
const asMine = <T>(env: IsolationEnv, role: CaseRole, fn: (db: never) => Promise<T>) => as(env, env.actor.tenantId, env.actor.branchId, role, fn);

let runs = 0;
type Seed = { name: string; supplier: string; po: string; receipt: string; invoice: string; ret: string; transfer: string | null; item: string; batch: string };
const latest = new Map<string, Seed>();
const items = new Map<string, string>();
async function victim(env: IsolationEnv): Promise<Seed> {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const k = () => crypto.randomUUID();
  const n = ++runs;
  const name = `PT Pemasok Rahasia ${t.slice(0, 8)} ${n}`;
  let item = items.get(t);
  if (!item) {
    const cat = (await as(env, t, b, "owner", (db) => publish(db, { kind: "material", code: `PMB-${t.slice(0, 6).toUpperCase()}` }, { name: "Bahan Rahasia Pembelian", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1 } as never, "Bahan"))).itemId;
    item = (await as(env, t, b, "pharmacist", (db) => saveItem(db, k(), null, { catalogItemId: cat, unit: "pcs", storage: "ruang", highValue: false, active: true }))).itemId;
    items.set(t, item);
  }
  const { supplierId: supplier } = await as(env, t, b, "purchasing", (db) => saveSupplier(db, k(), null, { name }));
  const { poId: po } = await as(env, t, b, "purchasing", (db) => savePurchaseOrder(db, k(), null, { supplierId: supplier, branchId: b, lines: [{ itemId: item!, quantity: "20", unitPrice: 1_000 }] }));
  await as(env, t, b, "purchasing", (db) => sendPurchaseOrder(db, k(), po));
  const { receiptId } = await as(env, t, b, "pharmacist", (db) => receiveGoods(db, k(), null, { supplierId: supplier, poId: po, lines: [{ itemId: item!, batchNo: `PMB-${n}`, expiry: "2099-01-01", quantity: "10" }] }));
  const receipt = (await env.owner.query(`select id, batch_id from supplier_receipts where source_id = $1`, [receiptId])).rows[0];
  const { invoiceId: invoice } = await as(env, t, b, "purchasing", (db) => recordInvoice(db, k(), b, { supplierId: supplier, number: `RHS-${n}`, invoiceDate: "2026-11-12", lines: [{ receiptId: receipt.id }] }));
  const { returnId: ret } = await as(env, t, b, "purchasing", (db) => returnToSupplier(db, k(), b, { supplierId: supplier, batchId: receipt.batch_id, quantity: "1", reason: "damaged", note: "Retur rahasia" }));
  // An inter-branch transfer needs a second branch of B; seed one once.
  let other = (await env.owner.query(`select id from branches where tenant_id = $1 and id <> $2 limit 1`, [t, b])).rows[0]?.id as string | undefined;
  if (!other) other = (await env.owner.query(`insert into branches (tenant_id, code, name, timezone) values ($1, 'PMB2', 'Cabang Rahasia Dua', 'Asia/Jakarta') returning id`, [t])).rows[0].id as string;
  const gudang = (await env.owner.query(`select id from depots where tenant_id = $1 and branch_id = $2 and is_default`, [t, b])).rows[0].id as string;
  const { transferId: transfer } = await as(env, t, b, "purchasing", (db) => sendToBranch(db, k(), { fromDepotId: gudang, toBranchId: other!, lines: [{ batchId: receipt.batch_id, quantity: "1" }] }));
  for (const x of [name, supplier, po, receiptId, invoice, ret, transfer]) env.victimSecret(x);
  const r = { name, supplier, po, receipt: receiptId, invoice, ret, transfer, item: item!, batch: receipt.batch_id as string };
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
  route("/pembelian", "filtered", marker, (env) => asMine(env, "purchasing", (db) => purchasingContext(db as never).then(ok))),
  route("/pembelian/pemasok", "filtered", marker, (env) => asMine(env, "purchasing", (db) => listSuppliers(db as never).then(ok))),
  route("/pembelian/pemasok/[id]", "not-found", marker, (env, v) => asMine(env, "purchasing", (db) => getSupplier(db as never, v.supplier).then(ok, notFound))),
  route("/pembelian/po", "filtered", idMarker("po"), (env) => asMine(env, "purchasing", (db) => listPurchaseOrders(db as never, env.actor.branchId).then(ok))),
  route("/pembelian/po/[id]", "not-found", idMarker("po"), (env, v) => asMine(env, "purchasing", (db) => getPurchaseOrder(db as never, v.po).then(ok, notFound))),
  route("/pembelian/penerimaan", "filtered", idMarker("receipt"), (env) => asMine(env, "pharmacist", (db) => listReceipts(db as never, null).then(ok))),
  route("/pembelian/retur", "filtered", idMarker("ret"), (env) => asMine(env, "pharmacist", (db) => listReturns(db as never, null).then(ok))),
  route("/pembelian/transfer", "filtered", idMarker("transfer"), (env) => asMine(env, "pharmacist", (db) => listTransfers(db as never, null).then(ok))),
  route("/pembelian/utang", "filtered", idMarker("invoice"), (env) => asMine(env, "finance", (db) => payableOverview(db as never, env.actor.branchId).then(ok))),
  {
    kind: "action",
    id: "app/(app)/pembelian/actions",
    marker,
    async run(env) {
      const v = await victim(env);
      const k = () => crypto.randomUUID();
      const own = env.actor.tenantId === env.victim.tenantId;
      const attempts = {
        supplier: await outcome(asMine(env, "purchasing", (db) => saveSupplier(db as never, k(), v.supplier, { name: `${v.name} ubah` }))),
        po: await outcome(asMine(env, "purchasing", (db) => savePurchaseOrder(db as never, k(), null, { supplierId: v.supplier, branchId: env.actor.branchId,
          lines: [{ itemId: v.item, quantity: "1", unitPrice: 1 }] }))),
        // a draft PO of B (nothing received) to cancel
        cancel: await outcome(as(env, env.victim.tenantId, env.victim.branchId, "purchasing", (db) => savePurchaseOrder(db as never, k(), null, { supplierId: v.supplier,
          branchId: env.victim.branchId, lines: [{ itemId: v.item, quantity: "1", unitPrice: 1 }] })).then((r) =>
          asMine(env, "purchasing", (db) => cancelPurchaseOrder(db as never, k(), r.poId, "Coba lintas")))),
        receive: await outcome(asMine(env, "pharmacist", (db) => receiveGoods(db as never, k(), null, { supplierId: v.supplier, poId: v.po,
          lines: [{ itemId: v.item, batchNo: `LNT-${k().slice(0, 6)}`, expiry: "2099-01-01", quantity: "1" }] }))),
        return: await outcome(asMine(env, "purchasing", (db) => returnToSupplier(db as never, k(), env.actor.branchId, { supplierId: v.supplier, batchId: v.batch, quantity: "1",
          reason: "other", note: "Coba lintas" }))),
        pay: await outcome(asMine(env, "finance", (db) => recordPayment(db as never, k(), env.actor.branchId, { supplierId: v.supplier, amount: 1, method: "cash", paidOn: "2026-11-12",
          allocations: [{ invoiceId: v.invoice }] }))),
        transfer: own ? "done" : await outcome(asMine(env, "purchasing", (db) => cancelTransfer(db as never, k(), v.transfer!))),
      };
      const read = await asMine(env, "purchasing", (db) => getPurchaseOrder(db as never, v.po).then((x) => x.supplier_name, () => null));
      return { attempts, body: { ...attempts, read } };
    },
  },
);
