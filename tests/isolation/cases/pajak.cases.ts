// Pajak ▸ Coretax (UX-22 ▸ Pajak, PR-98, T-106): the status reader (page) and the export route. Each run seeds in B a PKP sale with a unique
// invoice number through B's own staff (B's tax-advice evidence approved, B PKP); then runs as the caller's own owner and finance: B's
// invoice number and amount are absent from the caller's status and from every document the caller downloads, and nothing is logged in B.
// As B's staff (positive control) B's sale is in B's digunggung document. Synthetic data.
import { withTenantContext } from "../../../src/db/rls/context";
import { coretaxStatus, exportCoretax } from "../../../src/modules/accounting/coretax/coretax";
import { issueKasirInvoice, openKasirInvoice } from "../../../src/modules/cashier/kasir/kasir";
import { publish } from "../../../src/modules/catalog/catalog";
import { saveItem } from "../../../src/modules/inventory/stock";
import { decideEvidence, uploadEvidence } from "../../../src/modules/compliance/compliance";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

type CaseRole = "owner" | "finance" | "fo_cashier" | "pharmacist";
const accOf = new Map<string, string>();
async function member(env: IsolationEnv, tenantId: string, role: CaseRole, branchId?: string): Promise<string> {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('Staf', $1) returning id`, [`${role}.ct106.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Pajak ${role}` });
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId, staffId, role });
    if ((role === "fo_cashier" || role === "pharmacist") && branchId) await assignBranch(c, { tenantId, staffRoleId: rid, branchId });
  } finally {
    c.release();
  }
  accOf.set(k, acc);
  return acc;
}
async function as<T>(env: IsolationEnv, tenantId: string, role: CaseRole, fn: (db: never) => Promise<T>, branchId?: string): Promise<T> {
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const acc = await member(env, tenantId, role, branchId);
  const ctx = await resolveContext(env.app, acc, { tenantId, actingRole: role, ...(branchId ? { activeBranchId: branchId } : {}) });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}
const asMine = <T>(env: IsolationEnv, role: CaseRole, fn: (db: never) => Promise<T>) => as(env, env.actor.tenantId, role, fn);
const month = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }).slice(0, 7);

// B is PKP with its tax-advice evidence approved only for the duration of fn (kewajiban.cases pattern): later cases share tenant B and must
// see it non-PKP with no open tax gate. The approval is revoked and the PKP history row removed afterwards (guards bypassed for this fixture).
async function withPkp<T>(env: IsolationEnv, t: string, fn: () => Promise<T>): Promise<T> {
  const pdf = Buffer.from(`%PDF-1.7\nsaran ${crypto.randomUUID()}\n%%EOF\n`);
  const { fileId } = await as(env, t, "finance", (db) => uploadEvidence(db as never, { obligationKey: "tax_advice", fileName: "saran.pdf", content: pdf, expertName: "Konsultan Pajak Sintetis", documentDate: "2026-10-01" }));
  const item = (await env.owner.query(`select item_id from evidence_files where id = $1`, [fileId])).rows[0].item_id as string;
  await as(env, t, "owner", (db) => decideEvidence(db as never, item, fileId, "approved"));
  const staff = (await env.owner.query(`select id from staff where tenant_id = $1 limit 1`, [t])).rows[0].id;
  const key = `pkp-ctx-${crypto.randomUUID()}`;
  const flip = async (on: boolean) => {
    await env.owner.query(`alter table tax_profile_changes disable trigger tax_profile_changes_guard`);
    await env.owner.query(`alter table tenants disable trigger tenants_tax_guard`);
    try {
      if (on) {
        await env.owner.query(`insert into tax_profile_changes (tenant_id, npwp, is_pkp, pkp_effective_from, reason, command_key, changed_by, changed_as, changed_at)
          values ($1, '012345678901234', true, current_date - 40, 'PKP sintetis', $2, $3, 'owner', now() - interval '45 days')`, [t, key, staff]);
        await env.owner.query(`update tenants set is_pkp = true, npwp = '012345678901234', pkp_effective_from = current_date - 40 where id = $1`, [t]);
      } else {
        await env.owner.query(`delete from tax_profile_changes where tenant_id = $1 and command_key = $2`, [t, key]);
        await env.owner.query(`update tenants set is_pkp = false, npwp = null, pkp_effective_from = null where id = $1`, [t]);
      }
    } finally {
      await env.owner.query(`alter table tax_profile_changes enable always trigger tax_profile_changes_guard`);
      await env.owner.query(`alter table tenants enable always trigger tenants_tax_guard`);
    }
  };
  await flip(true);
  try {
    return await fn();
  } finally {
    await flip(false);
    await as(env, t, "owner", (db) => decideEvidence(db as never, item, fileId, "revoked", "Selesai uji isolasi pajak"));
  }
}
// One PKP taxable counter sale in B per run (issued while B is PKP: is_pkp_at_issue is stamped by the writer), unique price.
let runs = 0;
const latest = new Map<string, { number: string; price: number }>();
async function victim(env: IsolationEnv) {
  const t = env.victim.tenantId;
  const n = ++runs;
  const price = 731_000 + n;
  const itemId = (await as(env, t, "owner", (db) => publish(db as never, { kind: "product", code: `CTX-${t.slice(0, 4)}-${n}` },
    { name: "Produk Pajak Rahasia", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: price } as never, "Produk"))).itemId;
  await as(env, t, "pharmacist", (db) => saveItem(db as never, crypto.randomUUID(), null, { catalogItemId: itemId, unit: "pcs", storage: "ruang", highValue: false, active: true }), env.victim.branchId);
  const { invoiceId } = await as(env, t, "fo_cashier", (db) => openKasirInvoice(db as never, crypto.randomUUID(), { counter: true }), env.victim.branchId);
  await as(env, t, "fo_cashier", (db) => issueKasirInvoice(db as never, crypto.randomUUID(), invoiceId, [{ itemId, quantity: 1 }]), env.victim.branchId);
  const row = (await env.owner.query(`select number, is_pkp_at_issue from invoices where id = $1`, [invoiceId])).rows[0];
  if (!row.is_pkp_at_issue) throw new Error("isolation case: B's sale must be PKP at issue");
  for (const x of [row.number as string, invoiceId]) env.victimSecret(x);
  const r = { number: row.number as string, price };
  latest.set(t, r);
  return r;
}
const marker = (env: IsolationEnv) => latest.get(env.victim.tenantId)?.number ?? "";
const ok = (x: unknown) => ({ status: 200, body: JSON.parse(JSON.stringify(x)) });

export default defineCases(
  {
    kind: "route", id: "/keuangan/pajak", expect: "filtered", marker,
    async run(env) {
      return withPkp(env, env.victim.tenantId, async () => {
        await victim(env);
        const owner = await asMine(env, "owner", (db) => coretaxStatus(db as never, month()));
        const finance = await asMine(env, "finance", (db) => coretaxStatus(db as never, month()));
        // the status carries counts and totals only: the positive control proves B's sale through B's own document
        const own = env.actor.tenantId === env.victim.tenantId ? await asMine(env, "finance", (db) => exportCoretax(db as never, { period: month(), kind: "retail" })) : null;
        return ok({ owner, finance, own });
      });
    },
  },
  {
    kind: "route", id: "/keuangan/pajak/ekspor#route", expect: "filtered", marker,
    async run(env) {
      return withPkp(env, env.victim.tenantId, async () => {
      await victim(env);
      const docs: Record<string, unknown> = {};
      for (const kind of ["retail", "faktur", "retur", "pembatalan"] as const) {
        docs[kind] = await asMine(env, "finance", (db) => exportCoretax(db as never, { period: month(), kind }));
      }
      // the caller's own log rows only (RLS): never a row of B
      const log = await asMine(env, "finance", (db) => (db as unknown as { query: (q: string) => Promise<{ rows: unknown[] }> })
        .query(`select tenant_id, period, doc_kind from coretax_exports`).then((r) => r.rows));
      return ok({ docs, log });
      });
    },
  },
);
