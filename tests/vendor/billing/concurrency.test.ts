// T-103 increment 1 — credit allocation and issuance under real interleavings (Panel 2 after mutation probe 1). Invariant: a credit is never
// applied twice and an invoice never receives more than its total, under concurrent issuers, concurrent / replayed waiver applications and an
// issuer racing a waiver. Interleavings are forced: a blocker transaction holds the tenant's invoice row lock while the writers queue behind it,
// so without the tenant billing lock they would all read the same outstanding / remaining after the blocker releases. The ledger is then
// checked: per credit sum(allocations) = amount − remaining ≥ 0; per invoice credit + payment allocations ≤ total; no (credit, invoice) twice.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyWaiver, issue } from "../../../src/modules/vendor/billing/billing";
import { createMembership, assignRole } from "../../../src/modules/org/identity";
import { bootstrapVendor, createVendorStaff, decideVendorRequest, requestVendorAction, type VendorCaller } from "../../../src/modules/vendor/staff/staff";
import { createHarness, type Harness, testPool } from "../../rls/harness";

let h: Harness;
let exec: pg.Pool;
let execUser: string; // the writers' login: waiter counts are scoped to it (the full suite shares the server)
let owner: pg.Pool;
let opPool: pg.Pool;
let op: pg.PoolClient;
let n = 0;
const caller = (accountId: string): VendorCaller => ({ accountId, ip: "203.0.113.10", mfaAt: new Date() });
const WIB = (d: string) => new Date(`${d}T09:00:00+07:00`);
let PO: string; let FIN: string;

async function account(tag: string) {
  return (await h.admin.query(`insert into auth_user (name, email, two_factor_enabled) values ('X', $1, true) returning id`, [`${tag}${++n}@sintetis.test`])).rows[0].id as string;
}
async function tenant(goLive: string): Promise<string> {
  const t = (await h.admin.query(`insert into tenants_registry (lifecycle_state) values ('live') returning id`)).rows[0].id as string;
  await h.admin.query(`insert into tenants (id, legal_name, sak_framework) values ($1, 'PT Klinik Konkuren Sintetis', 'emkm')`, [t]);
  const acc = await account("own");
  const { staffId } = await createMembership(owner, { tenantId: t, accountId: acc, displayName: "Pemilik" });
  await assignRole(h.admin, { tenantId: t, staffId, role: "owner" });
  await h.admin.query(`alter table tenant_lifecycle_events disable trigger user`);
  try {
    await h.admin.query(`insert into tenant_lifecycle_events (tenant_id, from_state, to_state, reason, actor_kind, actor, at)
      values ($1, 'onboarding', 'live', 'Fixture uji konkurensi tagihan', 'service', 'billing.fixture', $2)`, [t, WIB(goLive)]);
  } finally {
    await h.admin.query(`alter table tenant_lifecycle_events enable trigger user`);
  }
  return t;
}
// an open tenant credit balance (a fixture standing in for an overpayment / exit remainder)
const credit = (t: string, inv: string, amount: number) => h.admin.query(`insert into vendor_credit_notes (tenant_id, source_invoice_id, kind, amount_rupiah,
  remaining_rupiah, reason, created_by) values ($1, $2, 'exit_remainder', $3, $3, 'Fixture saldo kredit konkuren', 'uji')`, [t, inv, amount]);
const invoices = async (t: string) => (await h.admin.query(`select id, period, state, total_rupiah from vendor_invoices where tenant_id = $1 order by period`, [t])).rows;
// The ledger invariant (Panel 2).
async function ledger(t: string) {
  const perCredit = (await h.admin.query(`select n.id, n.amount_rupiah - n.remaining_rupiah as used, coalesce(sum(a.amount_rupiah), 0)::int as alloc
    from vendor_credit_notes n left join vendor_credit_allocations a on a.credit_id = n.id where n.tenant_id = $1 group by n.id`, [t])).rows;
  const perInvoice = (await h.admin.query(`select i.id, i.total_rupiah,
    coalesce((select sum(amount_rupiah) from vendor_credit_allocations c where c.invoice_id = i.id), 0)::int
    + coalesce((select sum(amount_rupiah) from vendor_payment_allocations p where p.invoice_id = i.id), 0)::int as covered
    from vendor_invoices i where i.tenant_id = $1`, [t])).rows;
  const dup = (await h.admin.query(`select count(*)::int n from (select credit_id, invoice_id from vendor_credit_allocations a join vendor_credit_notes n on n.id = a.credit_id
    where n.tenant_id = $1 group by 1, 2 having count(*) > 1) x`, [t])).rows[0].n;
  return { creditsBalanced: perCredit.every((r) => r.used === r.alloc && r.used >= 0), invoicesNotOver: perInvoice.every((r) => r.covered <= r.total_rupiah), dup };
}
// Hold the row locks of the tenant's invoices and credit notes, start `writers`, and release only once that many backends are observed waiting
// on a lock (review r1 P2: a fixed sleep did not prove the writers had queued). Fails if they never queue.
async function interleave(t: string, writers: (() => Promise<unknown>)[], expectWaiting = writers.length): Promise<PromiseSettledResult<unknown>[]> {
  const blocker = await owner.connect();
  await blocker.query("begin");
  await blocker.query(`select id from vendor_invoices where tenant_id = $1 for update`, [t]);
  await blocker.query(`select id from vendor_credit_notes where tenant_id = $1 for update`, [t]);
  const blockerPid = (await blocker.query(`select pg_backend_pid() p`)).rows[0].p as number;
  let running: Promise<unknown>[] = [];
  let waiting = 0;
  try {
  running = writers.map((w) => w());
  for (let i = 0; i < 100 && waiting < expectWaiting; i++) {
    await new Promise((r) => setTimeout(r, 50));
    // a writer waits on the blocker's row lock, or on the tenant billing lock (advisory) held by a writer that waits on the blocker
    waiting = (await h.admin.query(`select count(*)::int n from pg_stat_activity where pid <> $1 and usename = $2 and datname = current_database()
      and wait_event_type = 'Lock' and ($1 = any (pg_blocking_pids(pid)) or wait_event = 'advisory')`, [blockerPid, execUser])).rows[0].n as number;
  }
  } finally {
    await blocker.query("commit");
    blocker.release();
  }
  const settled = await Promise.allSettled(running);
  expect(waiting, "writers queued behind the blocker before release").toBeGreaterThanOrEqual(expectWaiting);
  return settled;
}

beforeAll(async () => {
  h = await createHarness();
  const execLogin = await h.createLoginRole("", ["clinic_executor"]);
  exec = testPool({ connectionString: h.urlAs(execLogin), max: 8 });
  execUser = (await exec.query(`select current_user u`)).rows[0].u as string;
  owner = testPool({ connectionString: h.ownerUrl(), max: 3 });
  opPool = testPool({ connectionString: h.ownerUrl(), max: 2 });
  op = await opPool.connect();
  PO = await account("po"); FIN = await account("fin");
  await bootstrapVendor(op, PO, "Pemilik Platform", "203.0.113.0/24", "Kantor vendor");
  await createVendorStaff(op, caller(PO), FIN, "Keuangan Vendor", ["vendor_finance"]);
  await h.admin.query(`alter table vendor_billing_policy disable trigger vendor_billing_policy_guard`);
  await h.admin.query(`update vendor_billing_policy set channel_fee_bearer = 'tenant', fee_bearer_ref = 'UJI-Q16', tax_treatment_ref = 'SURAT-KONSULTAN-PAJAK-UJI'`);
  await h.admin.query(`alter table vendor_billing_policy enable always trigger vendor_billing_policy_guard`);
  await h.admin.query(`alter table vendor_profile disable trigger user`);
  await h.admin.query(`update vendor_profile set is_pkp = false, pkp_effective_from = null, tax_evidence_ref = 'SURAT-NON-PKP-UJI' where id = 1`);
  await h.admin.query(`alter table vendor_profile enable trigger user`);
});
afterAll(async () => {
  op?.release();
  await opPool?.end();
  await exec?.end();
  await owner?.end();
  await h?.close();
});

describe("T-103 lock order across tenants (review r1 P2)", () => {
  it("crash recovery and the issuer over two tenants never deadlock (both take tenant billing locks in tenant order)", async () => {
    const a = await tenant("2025-08-04");
    const b = await tenant("2025-08-04");
    await issue(exec, WIB("2025-08-04"));
    const [lo, hi] = [a, b].sort();
    // abandoned `creating` attempts: the higher tenant's created first (attempt-id order would lock hi before lo)
    for (const t of [hi, lo]) {
      const inv = (await h.admin.query(`select id from vendor_invoices where tenant_id = $1`, [t])).rows[0].id;
      const staff = (await h.admin.query(`select id from staff where tenant_id = $1 limit 1`, [t])).rows[0].id;
      await h.admin.query(`insert into vendor_payment_attempts (tenant_id, invoice_id, seq, reff_id, command_key, channel_code, amount_rupiah, expires_at, created_by, created_as, creating_since)
        values ($1, $2, 1, $3, $4, 'VABNI', 1000, now() + interval '1 day', $5, 'owner', now() - interval '10 minutes')`,
        [t, inv, `SF${String(Date.now()).slice(-10)}A${++n}`, `k-${crypto.randomUUID()}`, staff]);
    }
    // force the interleaving: a blocker holds the lower tenant's billing lock; the issuer, then recovery, queue on it. With tenant order
    // recovery waits for `lo` holding nothing; with attempt order it would already hold `hi` while the issuer, served first, takes `lo` and
    // waits for `hi` — a cycle PostgreSQL breaks by aborting one worker (40P01).
    const blocker = await owner.connect();
    await blocker.query("begin");
    await blocker.query(`select pg_advisory_xact_lock(hashtextextended('vendor_billing:' || $1::text, 0))`, [lo]);
    const blockerPid = (await blocker.query(`select pg_backend_pid() p`)).rows[0].p as number;
    // queue order matters (advisory lock waiters are served first come): the issuer queues on `lo` first, then recovery — so after the release
    // the issuer takes `lo` and goes on to `hi`; recovery must not be holding `hi` at that moment
    const advisoryWaiters = async (want: number) => {
      let w = 0;
      for (let i = 0; i < 100 && w < want; i++) {
        await new Promise((res) => setTimeout(res, 50));
        w = (await h.admin.query(`select count(*)::int n from pg_stat_activity where pid <> $1 and usename = $2 and datname = current_database()
          and wait_event_type = 'Lock' and wait_event = 'advisory'`, [blockerPid, execUser])).rows[0].n;
      }
      return w;
    };
    const running: Promise<unknown>[] = [];
    let first = 0;
    let waiting = 0;
    try {
      running.push(exec.query(`select vendor_billing_issue($1, 'billing.issue')`, [WIB("2025-10-01")]));
      first = await advisoryWaiters(1);
      running.push(exec.query(`select vendor_billing_recover(now(), 'billing.recover')`));
      waiting = await advisoryWaiters(2);
    } finally {
      await blocker.query("commit");
      blocker.release();
    }
    const r = await Promise.allSettled(running);
    expect(first, "the issuer queued on lo").toBe(1);
    expect(waiting, "recovery and the issuer queued on the lower tenant's billing lock").toBe(2);
    expect(r.map((x) => (x.status === "rejected" ? String((x as PromiseRejectedResult).reason?.code ?? x.reason) : "ok"))).toEqual(["ok", "ok"]);
    expect((await h.admin.query(`select count(*)::int n from vendor_payment_attempts where tenant_id = any($1) and state = 'unknown'`, [[a, b]])).rows[0].n).toBe(2);
  });
});

describe("T-103 credit allocation under interleavings", () => {
  it("four parallel issuers over two new months with one open credit: each month issued once, the credit spent once, nothing over-covered", async () => {
    const t = await tenant("2025-11-21");
    await issue(exec, WIB("2025-11-21"));
    const [nov] = await invoices(t);
    await credit(t, nov.id, 1_500_000);
    // November is issued (and holds the credit's first 333,333 at once); December and January come from four racing issuers
    const r = await interleave(t, [1, 2, 3, 4].map(() => () => issue(exec, WIB("2026-01-01"))));
    expect(r.every((x) => x.status === "fulfilled")).toBe(true);
    const inv = await invoices(t);
    expect(inv.map((x) => x.period)).toEqual(["2025-11", "2025-12", "2026-01"]);
    expect(await ledger(t)).toEqual({ creditsBalanced: true, invoicesNotOver: true, dup: 0 });
    expect((await h.admin.query(`select sum(a.amount_rupiah)::int s from vendor_credit_allocations a join vendor_credit_notes n on n.id = a.credit_id where n.tenant_id = $1`, [t])).rows[0].s)
      .toBe(1_500_000);
  });

  it("the same approved waiver applied concurrently and replayed, racing an issuer: one credit note, applied once; the ledger balances", async () => {
    const t = await tenant("2025-10-06");
    await issue(exec, WIB("2025-10-06"));
    const [oct] = await invoices(t);
    await credit(t, oct.id, 200_000); // an older open credit the waiver and the issuer both see
    const out = (await h.admin.query(`select vendor_invoice_outstanding($1) o`, [oct.id])).rows[0].o as number;
    const req = await requestVendorAction(op, caller(FIN), t, { kind: "invoice_waiver", invoiceId: oct.id, amountRupiah: Math.floor(out / 2) }, "Kompensasi gangguan uji konkurensi");
    await decideVendorRequest(op, caller(PO), req, true);
    const r = await interleave(t, [() => applyWaiver(exec, req, t), () => applyWaiver(exec, req, t), () => issue(exec, WIB("2025-11-01")), () => applyWaiver(exec, req, t)]);
    expect(r.filter((x) => x.status === "fulfilled").length).toBe(2); // one waiver application + the issuer
    expect(r.filter((x) => x.status === "rejected").map((x) => String((x as PromiseRejectedResult).reason?.message ?? x))).toEqual(
      expect.arrayContaining([expect.stringMatching(/already_consumed|not_approved|ERR_VERSION_CONFLICT/)]));
    expect((await h.admin.query(`select count(*)::int n from vendor_credit_notes where request_id = $1`, [req])).rows[0].n).toBe(1);
    expect(await ledger(t)).toEqual({ creditsBalanced: true, invoicesNotOver: true, dup: 0 });
  });

  it("an issuer and a waiver racing on the same open credit: the credit is split, never doubled; an exhausted credit is never allocated again", async () => {
    const t = await tenant("2025-09-01");
    await issue(exec, WIB("2025-09-01"));
    const [sep] = await invoices(t);
    // September stays issued with outstanding 1,000,000; a 300,000 credit appears; the issuer (October) and the waiver race
    await credit(t, sep.id, 300_000);
    const req = await requestVendorAction(op, caller(FIN), t, { kind: "invoice_waiver", invoiceId: sep.id, amountRupiah: 100_000 }, "Kompensasi kecil uji konkurensi");
    await decideVendorRequest(op, caller(PO), req, true);
    const r = await interleave(t, [() => issue(exec, WIB("2025-10-01")), () => applyWaiver(exec, req, t), () => issue(exec, WIB("2025-10-01"))]);
    expect(r.every((x) => x.status === "fulfilled")).toBe(true);
    expect(await ledger(t)).toEqual({ creditsBalanced: true, invoicesNotOver: true, dup: 0 });
    expect((await h.admin.query(`select sum(remaining_rupiah)::int s from vendor_credit_notes where tenant_id = $1`, [t])).rows[0].s).toBe(0);
  });
});
