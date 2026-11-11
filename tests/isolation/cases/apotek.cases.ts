// Siapkan & Serahkan (UX-10, PR-18, T-065): the lists (pharmacy_prep_list, pharmacy_handover_list), one dispensing
// (pharmacy_dispensing_get) and the actions (map, prepare materials, prepare, label, hand over, cancel). Each run seeds
// in B a fresh patient with a confirmed selection of a mapped treatment and two products (one prepared) and a draft
// prescription; then runs as a pharmacist of the caller's own branch: B's rows are absent from the lists and not
// found; every write on B's rows is refused. As B's staff (positive control) everything succeeds. Synthetic data
// (MIG-2).
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { decideApproval } from "../../../src/modules/approvals/approvals";
import { publish } from "../../../src/modules/catalog/catalog";
import { createDepot } from "../../../src/modules/inventory/depots/depots";
import { issueMaterials } from "../../../src/modules/inventory/materials/materials";
import { receiveStock, saveItem } from "../../../src/modules/inventory/stock";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import {
  addPrescriptionItem, CHECKS, type Check, cancelDispensing, confirmSelection, createPrescription, getDispensing, handOver, handoverList, mapRecipe,
  prepareDispensing, prepareMaterials, prepList, printLabel,
} from "../../../src/modules/pharmacy/pharmacy";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

type CaseRole = "doctor" | "pharmacist" | "owner" | "fo_cashier" | "facility_head";
const accOf = new Map<string, string>();
const staffOf = new Map<string, string>();
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole): Promise<string> {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email, two_factor_enabled) values ('Staf', $1, true) returning id`, [`${role}.apt65.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Apotek ${role}` });
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId, staffId, role });
    if (role !== "owner") await assignBranch(c, { tenantId, staffRoleId: rid, branchId });
  } finally {
    c.release();
  }
  accOf.set(k, acc);
  staffOf.set(k, staffId);
  return acc;
}
async function as<T>(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole, fn: (db: never) => Promise<T>): Promise<T> {
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [tenantId]);
  const acc = await member(env, tenantId, branchId, role);
  const ctx = await resolveContext(env.app, acc, { tenantId, actingRole: role, activeBranchId: role === "owner" ? undefined : branchId });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}
const asMine = <T>(env: IsolationEnv, fn: (db: never) => Promise<T>) => as(env, env.actor.tenantId, env.actor.branchId, "pharmacist", fn);
const ALL = Object.fromEntries(CHECKS.map((c) => [c, true])) as Record<Check, boolean>;

let runs = 0;
type Setup = { service: string; serum: string; gudang: string; gel: string };
const setup = new Map<string, Setup>();
const latest = new Map<string, { name: string; visit: string; service: string; queued: string; prepared: string; rx: string }>();
async function victim(env: IsolationEnv) {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const k = () => crypto.randomUUID();
  await member(env, t, b, "doctor");
  const docStaff = staffOf.get(`${t}:doctor`)!;
  let s = setup.get(t);
  if (!s) {
    await member(env, t, b, "owner");
    await member(env, t, b, "facility_head");
    const code = t.slice(0, 6).toUpperCase();
    const ver = await as(env, t, b, "owner", (db) => publish(db, { kind: "service", code: `AS-${code}` }, {
      name: "Laser Rahasia Apotek", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 1, category: "facial", prep_min: 10, treatment_min: 30, buffer_min: 10,
      indications: "Indikasi", consent_template: "Templat.", delegation: "Dokter", aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }],
      material_formula: [{ material: "Gel rahasia", qty: 1, unit: "ml" }],
    } as never, "Layanan uji isolasi"));
    if (ver.approvalId) await as(env, t, b, "facility_head", (db) => decideApproval(db, ver.approvalId!, true));
    if (ver.materialsApprovalId) await as(env, t, b, "facility_head", (db) => decideApproval(db, ver.materialsApprovalId!, true));
    const mat = (await as(env, t, b, "owner", (db) => publish(db, { kind: "material", code: `AM-${code}` }, { name: "Gel Rahasia", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1 } as never, "Bahan"))).itemId;
    const gel = (await as(env, t, b, "pharmacist", (db) => saveItem(db, k(), null, { catalogItemId: mat, unit: "ml", storage: "ruang", highValue: false, active: true }))).itemId;
    await as(env, t, b, "pharmacist", (db) => receiveStock(db, k(), null, { itemId: gel, batchNo: "AG-1", expiry: "2099-01-01", quantity: "100000", reason: "stok_awal" }));
    await as(env, t, b, "pharmacist", (db) => mapRecipe(db, k(), ver.versionId, 0, { stockItemId: gel, quantity: "1" }));
    await as(env, t, b, "pharmacist", (db) => createDepot(db, k(), { branchId: null, name: "Depot Ruang Apotek Rahasia", kind: "ruang" }));
    const prod = await as(env, t, b, "owner", (db) => publish(db, { kind: "product", code: `AP-${code}` }, { name: "Serum Rahasia", tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1 } as never, "Produk"));
    const serumItem = (await as(env, t, b, "pharmacist", (db) => saveItem(db, k(), null, { catalogItemId: prod.itemId, unit: "btl", storage: "ruang", highValue: false, active: true }))).itemId;
    await as(env, t, b, "pharmacist", (db) => receiveStock(db, k(), null, { itemId: serumItem, batchNo: "AS-1", expiry: "2099-01-01", quantity: "100000", reason: "stok_awal" }));
    const gudang = (await env.owner.query(`select id from depots where tenant_id = $1 and branch_id = $2 and is_default`, [t, b])).rows[0].id as string;
    s = { service: ver.versionId, serum: prod.versionId, gudang, gel };
    setup.set(t, s);
  }
  const name = `Pasien Rahasia Apotek ${t.slice(0, 8)} ${++runs}`;
  const id = crypto.randomUUID().replace(/-/g, "");
  const patient = (await env.owner.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education, marital_status,
                           registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $2, '1990-01-01', 'female', 'nik', $5, $6, 'islam', 'Karyawan', 's1', 'kawin', $3, $4, 'fo_cashier') returning id`,
    [t, name, b, docStaff, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43)])).rows[0].id as string;
  const visit = (await env.owner.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`, [t, b, patient, docStaff])).rows[0].id as string;
  await as(env, t, b, "fo_cashier", (db) => confirmSelection(db, k(), visit, { items: [{ catalogVersionId: s!.service, quantity: "1" }, { catalogVersionId: s!.serum, quantity: "1" }, { catalogVersionId: s!.serum, quantity: "1" }] }));
  const rows = (await env.owner.query(`select d.id from dispensings d where d.visit_id = $1 order by d.queued_at, d.id`, [visit])).rows.map((r) => r.id as string);
  const service = (await env.owner.query(`select id from selection_items where visit_id = $1 and kind = 'service'`, [visit])).rows[0].id as string;
  await as(env, t, b, "pharmacist", (db) => prepareDispensing(db, k(), rows[1]));
  const { prescriptionId: rx } = await as(env, t, b, "doctor", (db) => createPrescription(db, k(), visit));
  await as(env, t, b, "doctor", (db) => addPrescriptionItem(db, k(), rx, { catalogVersionId: s!.serum, quantity: "1", signa: "Rahasia 1x sehari" }));
  for (const x of [name, patient, visit, service, rows[0], rows[1], rx]) env.victimSecret(x);
  const r = { name, visit, service, queued: rows[0], prepared: rows[1], rx };
  latest.set(t, r);
  return r;
}
const outcome = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));
const notFound = (e: unknown) => (e instanceof CommandError && (e.code === "ERR_NOT_FOUND" || e.code === "ERR_FORBIDDEN") ? { status: 404, body: null } : Promise.reject(e));
const marker = (env: IsolationEnv) => latest.get(env.victim.tenantId)?.name ?? "";
const ok = (x: unknown) => ({ status: 200, body: JSON.parse(JSON.stringify(x)) });

export default defineCases(
  {
    kind: "route",
    id: "/apotek",
    expect: "filtered",
    marker,
    async run(env) {
      await victim(env);
      return asMine(env, (db) => prepList(db as never).then(ok));
    },
  },
  {
    kind: "route",
    id: "/apotek/siapkan",
    expect: "filtered",
    marker,
    async run(env) {
      await victim(env);
      return asMine(env, (db) => prepList(db as never).then(ok));
    },
  },
  {
    kind: "route",
    id: "/apotek/serahkan",
    expect: "filtered",
    marker,
    async run(env) {
      await victim(env);
      return asMine(env, (db) => handoverList(db as never).then(ok));
    },
  },
  {
    kind: "route",
    id: "/apotek/serahkan/[id]",
    expect: "not-found",
    marker,
    async run(env) {
      const v = await victim(env);
      return asMine(env, (db) => getDispensing(db as never, v.prepared).then(ok, notFound));
    },
  },
  {
    kind: "action",
    id: "app/(app)/apotek/actions",
    marker,
    async run(env) {
      const v = await victim(env);
      const s = setup.get(env.victim.tenantId)!;
      const k = () => crypto.randomUUID();
      const attempts = {
        map: await outcome(asMine(env, (db) => mapRecipe(db as never, k(), s.service, 0, { stockItemId: s.gel, quantity: "1" }))),
        materials: await outcome(asMine(env, async (db) => {
          const { requestId } = await prepareMaterials(db as never, k(), v.service);
          await issueMaterials(db as never, k(), requestId, { fromDepotId: s.gudang });
        })),
        prepare: await outcome(asMine(env, (db) => prepareDispensing(db as never, k(), v.queued))),
        label: await outcome(asMine(env, (db) => printLabel(db as never, k(), v.prepared))),
        hand: await outcome(asMine(env, (db) => handOver(db as never, k(), v.prepared, { checks: ALL }))),
        cancel: await outcome(asMine(env, (db) => cancelDispensing(db as never, k(), v.queued, "Coba lintas"))),
      };
      const read = await asMine(env, (db) => getDispensing(db as never, v.prepared).then((x) => x.patient.name, () => null));
      return { attempts, body: { ...attempts, read } };
    },
  },
);
