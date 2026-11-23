// HYG-NAV-2 (PR-86): cross-tenant negative cases of the ten pages and three action modules of the batch. Each case seeds in tenant B the
// row its page reads (a secret-named patient, appointment, waitlist entry, guardian, package, depot, unfit batch, commission batch or
// payment port), then reads through the same module function the page uses as A's own role: B's rows never appear; a by-branch or by-id
// read of B is not-found. Actions attempt B's objects (merge, unmerge, sharing switch, depot create / move) as A and must be refused; as B
// (positive control) they succeed. Seeding uses the owner pool (fixtures only), like jadwal / stok / komisi cases. Synthetic data (MIG-2).
import { randomBytes } from "node:crypto";
import { withTenantContext } from "../../../src/db/rls/context";
import { CommandError } from "../../../src/lib/command";
import { setKekRingForTests } from "../../../src/lib/keys/runtime";
import { journal } from "../../../src/modules/accounting/ledger/ledger";
import { commercialCatalog, publish } from "../../../src/modules/catalog/catalog";
import { listBatches, openBatch } from "../../../src/modules/commission/commission";
import { createDepot, getDepot, listDepots, transferBetweenDepots } from "../../../src/modules/inventory/depots/depots";
import { batchWatch, receiveStock, saveItem, holdBatch, stockContext } from "../../../src/modules/inventory/stock";
import { setServices } from "../../../src/modules/org/branches/branches";
import { assignBranch, assignRole, createMembership, resolveContext } from "../../../src/modules/org/identity";
import { packageContents, setPackageContents } from "../../../src/modules/packages/packages";
import { packageSharing, setPackageSharing } from "../../../src/modules/packages/sharing/sharing";
import { enableMockPort } from "../../../src/modules/payments/payments";
import { mergePatients, mergesOf, unmergePatients } from "../../../src/modules/patients/merge/merge";
import { getPatient } from "../../../src/modules/patients/patients";
import { searchPatients } from "../../../src/modules/patients/search/search";
import { calendar } from "../../../src/modules/scheduling/appointments/appointments";
import { addToWaitlist, waitlistList } from "../../../src/modules/scheduling/waitlist/waitlist";
import { defineCases, type IsolationEnv } from "../case";

process.env.DEPLOY_ENV = "local";
setKekRingForTests({ current: 1, keys: new Map([[1, randomBytes(32)]]) });

type R = "owner" | "admin_pusat" | "fo_cashier" | "records_officer" | "pharmacist" | "purchasing" | "finance" | "manager" | "doctor" | "facility_head";
const BRANCHED: R[] = ["fo_cashier", "pharmacist", "manager", "doctor", "facility_head", "records_officer"];
const accs = new Map<string, { acc: string; staffId: string }>();
const branchOf = (env: IsolationEnv, t: string) => (t === env.victim.tenantId ? env.victim.branchId : env.actor.branchId);
async function member(env: IsolationEnv, t: string, role: R) {
  const k = `${t}:${role}`;
  const known = accs.get(k);
  if (known) return known;
  await env.owner.query(`update tenants_registry set lifecycle_state = 'live' where id = $1 and lifecycle_state <> 'live'`, [t]);
  const acc = (await env.owner.query(`insert into auth_user (name, email) values ('X', $1) returning id`, [`${role}.hn2.${t}@klinik-sintetis.test`])).rows[0].id as string;
  const { staffId } = await createMembership(env.owner, { tenantId: t, accountId: acc, displayName: `${role} hn2` });
  const c = await env.owner.connect();
  try {
    const rid = await assignRole(c, { tenantId: t, staffId, role });
    if (BRANCHED.includes(role)) await assignBranch(c, { tenantId: t, staffRoleId: rid, branchId: branchOf(env, t) });
  } finally {
    c.release();
  }
  accs.set(k, { acc, staffId });
  return { acc, staffId };
}
async function as<T>(env: IsolationEnv, t: string, role: R, fn: (db: never) => Promise<T>): Promise<T> {
  const m = await member(env, t, role);
  const ctx = await resolveContext(env.app, m.acc, { tenantId: t, actingRole: role, activeBranchId: BRANCHED.includes(role) ? branchOf(env, t) : undefined });
  return withTenantContext(env.app, ctx, (db) => fn(db as never));
}
const mine = <T>(env: IsolationEnv, role: R, fn: (db: never) => Promise<T>) => as(env, env.actor.tenantId, role, fn);
const ok = (x: unknown) => ({ status: 200, body: JSON.parse(JSON.stringify(x ?? null)) });
const nf = (e: unknown) => (e instanceof CommandError && (e.code === "ERR_NOT_FOUND" || e.code === "ERR_FORBIDDEN") ? { status: 404, body: null } : Promise.reject(e));
const outcome = (p: Promise<unknown>) => p.then(() => "done", (e) => (e instanceof CommandError ? e.code : Promise.reject(e)));
const k = () => crypto.randomUUID();
const day = (n: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(Date.now() + n * 86_400_000));

// ── B's fixtures (once per victim tenant, fresh per run where an attempt consumes them) ─────────────────────────────────────────
type V = { payoutBatch: string; name: string; pt: string; pt2: string; appt: string; item: string; version: string; pkg: string; pkgName: string; guardian: string;
  depot: string; depot2: string; depotName: string; batch: string; batchItem: string; stockName: string; batchId: string };
const seeded = new Map<string, V>();
let seededBatches = 0;
async function patient(env: IsolationEnv, t: string, b: string, name: string, by: string) {
  const id = (await env.owner.query(
    `insert into patients (tenant_id, mrn, full_name, birth_date, sex, identity_type, no_identity_reason, religion, occupation, education, marital_status, registered_branch_id, created_by, created_as)
     values ($1, 'RM-' || (1000000000000 + floor(random() * 8999999999999))::bigint::text, $2, '1990-01-01', 'female', 'newborn_via_guardian', 'Fixture', 'islam', 'Karyawan', 's1', 'kawin', $3, $4, 'fo_cashier') returning id`,
    [t, name, b, by])).rows[0].id as string;
  env.victimSecret(id);
  return id;
}
async function victim(env: IsolationEnv): Promise<V> {
  const t = env.victim.tenantId, b = env.victim.branchId;
  const known = seeded.get(t);
  if (known) return known;
  const tag = t.slice(0, 8);
  const doc = await member(env, t, "doctor");
  await member(env, t, "facility_head");
  const name = `Pasien Rahasia HN2 ${tag}`;
  const pt = await patient(env, t, b, name, doc.staffId);
  const pt2 = await patient(env, t, b, `${name} Ganda`, doc.staffId);
  // guardian of pt (registration writes guardians; the fixture inserts one directly — the table is insert-only)
  const guardian = `Wali Rahasia ${tag}`;
  await env.owner.query(`insert into guardians (tenant_id, patient_id, guardian_name, relation) values ($1, $2, $3, 'ibu')`, [t, pt, guardian]);
  // a service and an online appointment in the next week (inserted with the guard satisfied: booked, phone/online, performer)
  const svcName = `Layanan Rahasia HN2 ${tag}`;
  const svc = await as(env, t, "owner", (db) => publish(db, { kind: "service", code: `HN2S-${tag.toUpperCase()}` }, {
    name: svcName, tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 100_000, category: "consultation", prep_min: 0, treatment_min: 30, buffer_min: 0,
    indications: "I", contraindications: "K", consent_template: "T", delegation: "D", aftercare_text: "A", eligibility: [{ role: "doctor", mode: "performs" }],
  } as never, "Layanan uji"));
  if (svc.approvalId) await as(env, t, "facility_head", (db) => (db as unknown as { query: (s: string, a: unknown[]) => Promise<unknown> }).query(`select approval_decide($1, true, null)`, [svc.approvalId]));
  const s0 = new Date(`${day(3)}T10:00:00+07:00`);
  const appt = (await env.owner.query(
    `insert into appointments (tenant_id, branch_id, patient_id, catalog_version_id, performer_staff_id, starts_at, ends_at, state, channel, created_by, created_as)
     values ($1, $2, $3, $4, $5, $6, $7, 'booked', 'online', $5, 'fo_cashier') returning id`,
    [t, b, pt, svc.versionId, doc.staffId, s0, new Date(s0.getTime() + 30 * 60_000)])).rows[0].id as string;
  await env.owner.query(`insert into resource_reservations (tenant_id, branch_id, appointment_id, kind, resource_id, starts_at, ends_at) values ($1, $2, $3, 'staff', $4, $5, $6)`,
    [t, b, appt, doc.staffId, s0, new Date(s0.getTime() + 30 * 60_000)]);
  await as(env, t, "owner", (db) => setServices(db, b, [svc.itemId]));
  await as(env, t, "fo_cashier", (db) => addToWaitlist(db, k(), { branchId: b, patientId: pt, itemId: svc.itemId }));
  // a package template with contents
  const pkgName = `Paket Rahasia HN2 ${tag}`;
  const pk = await as(env, t, "owner", (db) => publish(db, { kind: "package", code: `HN2P-${tag.toUpperCase()}` },
    { name: pkgName, tax_category: "exempt_medical", tax_basis: "Jasa medis", normal_price: 300_000 } as never, "Paket uji"));
  await as(env, t, "owner", (db) => setPackageContents(db, k(), pk.versionId, [{ serviceItemId: svc.itemId, count: 3 }]));
  // stock: an item, a received batch put in quarantine (a disposal candidate), two depots
  const stockName = `Bahan Rahasia HN2 ${tag}`;
  const cat = await as(env, t, "owner", (db) => publish(db, { kind: "material", code: `HN2M-${tag.toUpperCase()}` },
    { name: stockName, tax_category: "taxable_goods", tax_basis: "Barang", normal_price: 1_000 } as never, "Bahan uji"));
  const { itemId: batchItem } = await as(env, t, "pharmacist", (db) => saveItem(db, k(), null, { catalogItemId: cat.itemId, unit: "pcs", vialSize: null, openedUseHours: null,
    storage: "ruang", highValue: false, active: true } as never));
  const exp = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10);
  const { batchId } = await as(env, t, "pharmacist", (db) => receiveStock(db, k(), null, { itemId: batchItem, batchNo: `HN2-${tag}`, expiry: exp, quantity: "10", reason: "stok_awal" }));
  await as(env, t, "pharmacist", (db) => holdBatch(db, k(), batchId, "quarantined", "Uji isolasi"));
  // a second, fit batch in the default depot: what the depot move case moves
  const { batchId: fit } = await as(env, t, "pharmacist", (db) => receiveStock(db, k(), null, { itemId: batchItem, batchNo: `HN2F-${tag}`, expiry: exp, quantity: "100", reason: "stok_awal" }));
  const depotName = `Depot Rahasia ${tag}`;
  const { depotId: depot } = await as(env, t, "pharmacist", (db) => createDepot(db, k(), { branchId: null, name: depotName, kind: "apotek" }));
  const depot2 = (await env.owner.query(`select id from depots where tenant_id = $1 and branch_id = $2 and is_default`, [t, b])).rows[0]?.id as string;
  // a real commission batch of B (review r1 P2: the Ekspor positive control must come from the reader, not from a synthetic field); a past
  // month unique per victim tenant so runs never collide. The victim tenant is shared by every case file and this batch stays a draft:
  // commission_batch_submit refuses while an EARLIER draft exists (earlier_batch_open), so the month must come after every month
  // komisi.cases.ts submits (all <= 2019-11) — 2021 counting down, still in the past.
  const n = seededBatches++;
  const period = (() => { const t = 2021 * 12 + 11 - n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; })();
  const payoutBatch = (await as(env, t, "finance", (db) => openBatch(db, k(), period))).batchId;
  for (const s of [name, guardian, appt, svcName, pkgName, pk.itemId, stockName, depotName, depot, batchId, fit, payoutBatch]) env.victimSecret(s);
  const v = { payoutBatch, name, pt, pt2, appt, item: svc.itemId, version: svc.versionId, pkg: pk.itemId, pkgName, guardian, depot, depot2, depotName, batch: fit, batchItem, stockName, batchId };
  seeded.set(t, v);
  return v;
}
const marker = (env: IsolationEnv) => seeded.get(env.victim.tenantId)?.name ?? "";

export default defineCases(
  // Daftar Reservasi and Booking Online read appointments_window of a branch: B's branch is not found for A.
  { kind: "route", id: "/jadwal/daftar", expect: "not-found", marker,
    async run(env) { await victim(env); return mine(env, "fo_cashier", (db) => calendar(db, env.victim.branchId, day(0), day(29)).then(ok, nf)); } },
  { kind: "route", id: "/jadwal/online", expect: "not-found", marker: (env) => seeded.get(env.victim.tenantId)?.appt ?? "",
    async run(env) { await victim(env); return mine(env, "fo_cashier", (db) => calendar(db, env.victim.branchId, day(0), day(29)).then(ok, nf)); } },
  { kind: "route", id: "/jadwal/tunggu", expect: "not-found", marker,
    async run(env) { await victim(env); return mine(env, "fo_cashier", (db) => waitlistList(db, env.victim.branchId).then(ok, nf)); } },
  // Gabung: the two sides are read by id (patient_get) and their merges; B's ids are not found.
  { kind: "route", id: "/pasien/gabung", expect: "not-found", marker,
    async run(env) {
      const v = await victim(env);
      return mine(env, "records_officer", async (db) => {
        const p = await getPatient(db, v.pt);
        return p ? ok({ p, merges: await mergesOf(db, v.pt), search: await searchPatients(db, v.name) }) : { status: 404, body: null };
      });
    } },
  // Keluarga: the guardian list under RLS never holds B's guardians or patients.
  { kind: "route", id: "/pasien/keluarga", expect: "filtered", marker: (env) => seeded.get(env.victim.tenantId)?.guardian ?? "",
    async run(env) {
      await victim(env);
      return mine(env, "fo_cashier", async (db) => ok((await (db as unknown as { query: (s: string) => Promise<{ rows: unknown[] }> }).query(
        `select g.guardian_name, p.full_name, p.mrn from guardians g join patients p on p.tenant_id = g.tenant_id and p.id = g.patient_id`)).rows));
    } },
  // Templat Paket: the commercial projection, B's package contents and sharing by id.
  { kind: "route", id: "/layanan/paket", expect: "filtered", marker: (env) => seeded.get(env.victim.tenantId)?.pkgName ?? "",
    async run(env) {
      const v = await victim(env);
      // one transaction per read: a refusal aborts its transaction (as the page, which reads B's ids only through its own list)
      const code = (e: unknown) => (e instanceof CommandError ? e.code : Promise.reject(e));
      return ok({
        list: await mine(env, "owner", async (db) => (await commercialCatalog(db)).filter((r) => r.kind === "package")),
        contents: await mine(env, "owner", (db) => packageContents(db, v.version)).catch(code),
        sharing: await mine(env, "owner", (db) => packageSharing(db, v.pkg)).catch(code),
      });
    } },
  // Gudang & Depot: B's branch depots are not found for A; B's depot detail by id is not found.
  { kind: "route", id: "/stok/depot", expect: "not-found", marker: (env) => seeded.get(env.victim.tenantId)?.depotName ?? "",
    async run(env) {
      const v = await victim(env);
      const list = await mine(env, "purchasing", (db) => listDepots(db, env.victim.branchId)).then((x) => ({ ok: x }), (e) => (e instanceof CommandError ? null : Promise.reject(e)));
      const det = await mine(env, "purchasing", (db) => getDepot(db, v.depot)).then((x) => ({ ok: x }), (e) => (e instanceof CommandError ? null : Promise.reject(e)));
      return list || det ? ok({ list: list?.ok ?? null, det: det?.ok ?? null }) : { status: 404, body: null };
    } },
  // Pemusnahan: the batch watch of B's branch (B's quarantined batch) is not found for A's owner; A's own context never lists B's branch.
  { kind: "route", id: "/stok/pemusnahan", expect: "not-found", marker: (env) => seeded.get(env.victim.tenantId)?.stockName ?? "",
    async run(env) {
      await victim(env);
      return mine(env, "owner", async (db) => {
        const ctx = await stockContext(db);
        if (!ctx.branches.some((b) => b.id === env.victim.branchId)) return { status: 404, body: null };
        return batchWatch(db, env.victim.branchId).then(ok, nf);
      });
    } },
  // Ekspor: the ledger status and the commission batches are the tenant's own (no B data; filtered).
  // Marker: B's own commission batch id, which only listBatches can return (no synthetic field). The ledger status is a tenant-level gate
  // with no rows to leak; it is read for the caller's tenant only (journal binds app_tenant_id()) and returned alongside.
  { kind: "route", id: "/keuangan/ekspor", expect: "filtered", marker: (env) => seeded.get(env.victim.tenantId)?.payoutBatch ?? "",
    async run(env) {
      await victim(env);
      return mine(env, "finance", async (db) => ok({ batches: (await listBatches(db)).batches, status: (await journal(db, { from: day(0), to: day(0) })).status }));
    } },
  // Pembayaran (port): B's port config is never read by A's owner.
  { kind: "route", id: "/kasir/pengaturan-bayar", expect: "filtered", marker: (env) => env.victim.tenantId,
    async run(env) {
      await victim(env);
      await as(env, env.victim.tenantId, "owner", (db) => enableMockPort(db)).catch(() => undefined);
      return mine(env, "owner", async (db) => ok({ ports: (await (db as unknown as { query: (s: string) => Promise<{ rows: unknown[] }> }).query(
        `select tenant_id, provider_account, order_prefix from payment_port_configs`)).rows }));
    } },
  // ── actions ──
  { kind: "action", id: "app/(app)/pasien/gabung/actions", marker: (env) => seeded.get(env.victim.tenantId)?.pt ?? "",
    async run(env) {
      const v = await victim(env);
      // a fresh duplicate per run (a merge consumes it)
      const doc = await member(env, env.victim.tenantId, "doctor");
      const dup = await patient(env, env.victim.tenantId, env.victim.branchId, `Duplikat ${crypto.randomUUID().slice(0, 6)}`, doc.staffId);
      const merge = await outcome(mine(env, "records_officer", (db) => mergePatients(db, k(), v.pt, dup, "Duplikat pendaftaran uji")));
      // an active merge of B to undo (made by B's records officer)
      const dup2 = await patient(env, env.victim.tenantId, env.victim.branchId, `Duplikat ${crypto.randomUUID().slice(0, 6)}`, doc.staffId);
      const { mergeId } = await as(env, env.victim.tenantId, "records_officer", (db) => mergePatients(db, k(), v.pt, dup2, "Duplikat pendaftaran uji"));
      const unmerge = await outcome(mine(env, "records_officer", (db) => unmergePatients(db, k(), mergeId, "Batal penggabungan uji")));
      const search = await mine(env, "records_officer", (db) => searchPatients(db, v.name));
      return { attempts: { merge, unmerge }, body: { merge, unmerge, search: JSON.parse(JSON.stringify(search)), pt: merge === "done" ? v.pt : null } };
    } },
  { kind: "action", id: "app/(app)/layanan/paket/actions", marker: (env) => seeded.get(env.victim.tenantId)?.pkg ?? "",
    async run(env) {
      const v = await victim(env);
      // flip B's current switch each run so the positive control always records a change
      const now = (await env.owner.query(`select enabled from package_sharing where tenant_id = $1 and item_id = $2 order by version desc limit 1`, [env.victim.tenantId, v.pkg])).rows[0]?.enabled === true;
      const sharing = await outcome(mine(env, "owner", (db) => setPackageSharing(db, k(), v.pkg, !now, "Uji isolasi berbagi")));
      return { attempts: { sharing }, body: { sharing, pkg: sharing === "done" ? v.pkg : null } };
    } },
  { kind: "action", id: "app/(app)/stok/depot/actions", marker: (env) => seeded.get(env.victim.tenantId)?.depot ?? "",
    async run(env) {
      const v = await victim(env);
      const create = await outcome(mine(env, "purchasing", (db) => createDepot(db, k(), { branchId: env.victim.branchId, name: `Depot Lintas ${k().slice(0, 4)}`, kind: "gudang" })));
      const move = await outcome(mine(env, "pharmacist", (db) => transferBetweenDepots(db, k(), { fromDepotId: v.depot2, toDepotId: v.depot, lines: [{ batchId: v.batch, quantity: "1" }] })));
      return { attempts: { create, move }, body: { create, move, depot: create === "done" ? v.depot : null } };
    } },
);
