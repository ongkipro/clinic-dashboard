// Paket & Saldo (UX-13, PR-20, T-076): every route (the patient search, a patient's packages and balance, Isi Paket)
// and the actions. Each run seeds in B a package template, a patient with a package (partly paid) and a balance, and an
// open visit; then runs as the caller's own FO/cashier and owner: B's patient is absent from the search and not found
// by id; B's package template is not listed; every write on B's rows is refused. As B's staff (positive control)
// everything succeeds. Synthetic data (MIG-2).
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { issueKasirInvoice, openKasirInvoice, receivePayment } from "../../../src/modules/cashier/kasir/kasir";
import { publish } from "../../../src/modules/catalog/catalog";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import {
  cancelPackage, packageContents, patientPackages, releaseSession, reserveSession, searchPatients, setPackageContents, topUpBalance,
} from "../../../src/modules/packages/packages";
import { addBeneficiary, packageSharing, removeBeneficiary, setPackageSharing } from "../../../src/modules/packages/sharing/sharing";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";

type CaseRole = "fo_cashier" | "owner" | "facility_head";
const accOf = new Map<string, string>();
async function member(env: IsolationEnv, tenantId: string, branchId: string, role: CaseRole): Promise<string> {
  const k = `${tenantId}:${role}`;
  const known = accOf.get(k);
  if (known) return known;
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('Staf', $1) returning id`, [`${role}.pkt76.${tenantId}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId, accountId: acc, displayName: `Staf Paket ${role}` });
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
type Seed = { name: string; mrn: string; patient: string; pkg: string; version: string; versionName: string; visit: string; session: string; service: string; draft: string;
  item: string; beneficiary: string; child2: string };
const latest = new Map<string, Seed>();
const templates = new Map<string, { item: string; version: string; versionName: string; service: string }>();
async function victim(env: IsolationEnv): Promise<Seed> {
  const t = env.victim.tenantId;
  const b = env.victim.branchId;
  const k = () => crypto.randomUUID();
  const n = ++runs;
  let tpl = templates.get(t);
  if (!tpl) {
    const svc = await as(env, t, b, "owner", (db) => publish(db, { kind: "service", code: `PKS-${t.slice(0, 6).toUpperCase()}` }, {
      name: "Layanan Rahasia Paket", tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 100_000, category: "facial", prep_min: 10, treatment_min: 30,
      buffer_min: 10, indications: "Indikasi", consent_template: "Templat.", delegation: "Dokter", aftercare_text: "Perawatan", eligibility: [{ role: "doctor", mode: "performs" }],
    } as never, "Baru"));
    if (svc.approvalId) await as(env, t, b, "facility_head", (db) => (db as unknown as { query: (s: string, a: unknown[]) => Promise<unknown> }).query(`select approval_decide($1, true, null)`, [svc.approvalId]));
    const versionName = `Paket Rahasia ${t.slice(0, 8)}`;
    const pk = await as(env, t, b, "owner", (db) => publish(db, { kind: "package", code: `PKG-${t.slice(0, 6).toUpperCase()}` },
      { name: versionName, tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 200_000 } as never, "Baru"));
    await as(env, t, b, "owner", (db) => setPackageContents(db, k(), pk.versionId, [{ serviceItemId: svc.itemId, count: 2 }]));
    tpl = { item: pk.itemId, version: pk.versionId, versionName, service: svc.itemId };
    // T-082: B's template shares (the owner's switch), so B's package can carry a beneficiary.
    await as(env, t, b, "owner", (db) => setPackageSharing(db as never, k(), pk.itemId, true, "Paket keluarga"));
    templates.set(t, tpl);
  }
  const name = `Pasien Rahasia Paket ${t.slice(0, 8)} ${n}`;
  const id = crypto.randomUUID().replace(/-/g, "");
  const row = (await env.owner.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $3, '1990-01-01', 'female', 'nik', $4, $5, 'islam', 'Karyawan', 's1', 'kawin', $2,
             (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id, mrn`,
    [t, b, name, `v1.1.${id}.${id}.${id}`, (id + id).slice(0, 43)])).rows[0];
  const patient = row.id as string;
  const { invoiceId } = await as(env, t, b, "fo_cashier", (db) => openKasirInvoice(db, k(), { patientId: patient }));
  await as(env, t, b, "fo_cashier", (db) => issueKasirInvoice(db, k(), invoiceId, [{ itemId: tpl!.item, quantity: 1 }]));
  await as(env, t, b, "fo_cashier", (db) => receivePayment(db, k(), invoiceId, [{ method: "cash", amount: 100_000, cashTendered: 100_000 }]));
  await as(env, t, b, "fo_cashier", (db) => topUpBalance(db, k(), patient, null, { method: "cash", amount: 50_000, cashTendered: 50_000 }));
  const pkg = (await env.owner.query(`select id from packages where invoice_id = $1`, [invoiceId])).rows[0].id as string;
  const fo = (await env.owner.query(`select s.id from staff s join staff_roles r on r.staff_id = s.id where s.tenant_id = $1 and r.role = 'fo_cashier' limit 1`, [t])).rows[0].id;
  const visit = (await env.owner.query(`insert into visits (tenant_id, branch_id, patient_id, kind, checked_in_by) values ($1, $2, $3, 'walk_in', $4) returning id`,
    [t, b, patient, fo])).rows[0].id as string;
  const { sessionId: session } = await as(env, t, b, "fo_cashier", (db) => reserveSession(db, k(), pkg, visit));
  const kid = crypto.randomUUID().replace(/-/g, "");
  const child = (await env.owner.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Anak Rahasia', '2010-01-01', 'female', 'nik', $3, $4, 'islam', 'Pelajar', 'sma', 'belum_kawin', $2,
             (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id`,
    [t, b, `v1.1.${kid}.${kid}.${kid}`, (kid + kid).slice(0, 43)])).rows[0].id as string;
  const { beneficiaryId: beneficiary } = await as(env, t, b, "fo_cashier", (db) => addBeneficiary(db, k(), pkg, child, "Anak pemilik"));
  const child2 = (await env.owner.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, identity_enc, identity_bidx, religion, occupation, education,
                           marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, 'Anak Rahasia Dua', '2012-01-01', 'female', 'nik', $3, $4, 'islam', 'Pelajar', 'smp', 'belum_kawin', $2,
             (select s.id from staff s where s.tenant_id = $1 limit 1), 'fo_cashier') returning id`,
    [t, b, `v1.1.k${kid}.${kid}.${kid}`, ('k' + kid + kid).slice(0, 43)])).rows[0].id as string;
  // An unsold package version of B (Isi Paket edits only unsold versions).
  const draft = (await as(env, t, b, "owner", (db) => publish(db, { kind: "package", code: `PKD-${t.slice(0, 4).toUpperCase()}${n}` },
    { name: `Paket Draf ${n}`, tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 100_000 } as never, "Baru"))).versionId;
  for (const x of [name, row.mrn, patient, pkg, visit, session, tpl.versionName, draft]) env.victimSecret(x);
  env.victimSecret(beneficiary);
  const r = { name, mrn: row.mrn as string, patient, pkg, version: tpl.version, versionName: tpl.versionName, visit, session, service: tpl.service, draft,
    item: tpl.item, beneficiary, child2 };
  latest.set(t, r);
  return r;
}
const outcome = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));
const notFound = (e: unknown) => (e instanceof CommandError && (e.code === "ERR_NOT_FOUND" || e.code === "ERR_FORBIDDEN") ? { status: 404, body: null } : Promise.reject(e));
const marker = (env: IsolationEnv) => latest.get(env.victim.tenantId)?.name ?? "";
const ok = (x: unknown) => ({ status: 200, body: JSON.parse(JSON.stringify(x)) });
const route = (id: string, expect: "filtered" | "not-found", m: (env: IsolationEnv) => string, run: (env: IsolationEnv, v: Seed) => Promise<{ status: number; body: unknown }>) =>
  ({ kind: "route" as const, id, expect, marker: m, async run(env: IsolationEnv) { const v = await victim(env); return run(env, v) as never; } });

export default defineCases(
  // The search for B's patient by name and by MRN finds nothing in the caller's tenant.
  route("/kasir/paket-saldo", "filtered", marker, (env, v) => asMine(env, "fo_cashier", async (db) =>
    ok([...(await searchPatients(db as never, v.name)), ...(await searchPatients(db as never, v.mrn))]))),
  route("/kasir/paket-saldo/[patientId]", "not-found", marker, (env, v) => asMine(env, "owner", (db) => patientPackages(db as never, v.patient).then(ok, notFound))),
  // Isi Paket: B's package version (its id is the marker) is not found in the caller's tenant.
  route("/kasir/paket-saldo/isi-paket", "not-found", (env) => latest.get(env.victim.tenantId)?.version ?? "",
    (env, v) => asMine(env, "owner", (db) => packageContents(db as never, v.version).then(ok, notFound))),
  {
    kind: "action",
    id: "app/(app)/kasir/paket-saldo/actions",
    marker,
    async run(env) {
      const v = await victim(env);
      const k = () => crypto.randomUUID();
      const attempts = {
        // the seeded reservation released, then reserved again (B paid for one session), then the package cancelled
        release: await outcome(asMine(env, "fo_cashier", (db) => releaseSession(db as never, k(), v.session))),
        reserve: await outcome(asMine(env, "fo_cashier", (db) => reserveSession(db as never, k(), v.pkg, v.visit))),
        topUp: await outcome(asMine(env, "fo_cashier", (db) => topUpBalance(db as never, k(), v.patient, null, { method: "cash", amount: 1_000, cashTendered: 1_000 }))),
        // a sold version's contents are frozen even for B: the attempt is on a fresh unsold version of B (seeded below)
        contents: await outcome(asMine(env, "owner", (db) => setPackageContents(db as never, k(), v.draft, [{ serviceItemId: v.service, count: 1 }]))),
        // T-082 (before the cancel, on an active package): B's sharing switch and B's beneficiaries. As B the release above freed
        // the reservation, so the beneficiary can be removed; a second beneficiary is added (B's second seeded child); the read covers the switch.
        addBeneficiary: await outcome(asMine(env, "fo_cashier", (db) => addBeneficiary(db as never, k(), v.pkg, v.child2, "Coba lintas"))),
        shareRead: await outcome(asMine(env, "owner", (db) => packageSharing(db as never, v.item))),
        removeBeneficiary: await outcome(asMine(env, "fo_cashier", (db) => removeBeneficiary(db as never, k(), v.beneficiary, "Coba lintas"))),
        share: await outcome(asMine(env, "owner", (db) => setPackageSharing(db as never, k(), v.item, true, "Coba lintas"))),
        cancel: await outcome(asMine(env, "owner", (db) => cancelPackage(db as never, k(), v.pkg, "Coba lintas"))),
      };
      const read = await asMine(env, "owner", (db) => patientPackages(db as never, v.patient).then((x) => x.patient?.name ?? null, () => null));
      return { attempts, body: { ...attempts, read } };
    },
  },
);
