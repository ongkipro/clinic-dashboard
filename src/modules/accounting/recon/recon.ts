// Rekonsiliasi KPI operasional vs buku besar (PR-34, UX-22 ▸ Rekon; T-108). Pure engine: operational facts and ledger postings in,
// differences by day and branch out. No database here: the `recon_report` reader (drizzle/0129, read through report.ts) returns
// both sides already normalised to one reference per source document and the metric's natural sign, in integer rupiah.
//
// Matching is by source reference, never by totals alone, so a difference always names the document behind it (Scenario PR-34: a
// payment recorded without its ledger posting is listed with the payment reference). Rules:
// - placement is the fact's BUSINESS date and branch (Appendix A attribution: K1 branch where paid, K2 executing branch); the ledger
//   side is compared on its business date too, so a late fact booked into a later open period (PR-26, `ledger_booked_date`) is a
//   TIMING item, explained with its booked period, not a difference;
// - a fact without a posting is "queued" when its domain event still waits for the ledger consumer, otherwise "missing";
// - a posting without a fact, a different amount, or another business day or branch (placement) is a difference;
// - inter-branch clearing must net to zero across branches per day (S11: package sold at A, session counted at B); a per-branch
//   clearing balance is expected and never a difference by itself. The net is judged on the tenant-wide total the reader supplies
//   (`clearingNet`), never on the legs shown: with one branch selected only its own legs are listed (R3 7adf39f6 F1);
// - postings of one reference without a fact are netted per metric, reference, business day and branch (an original and its
//   reversal cancel only inside that bucket); a nonzero bucket lists each entry with its own attribution (R3 7adf39f6 F2);
// - every derived rupiah (sums, totals, differences) is checked: an unsafe intermediate is refused, never rounded (R3 7adf39f6 F3);
// - handed products without an exact invoice-line link (T-105 G-Q4 "selisih penyerahan produk") are not valued on either side, so
//   they are reported as exceptions and keep the report from claiming a clean K2;
// - a metric whose input could not be read is unavailable for that row, never Rp0 and never "cocok".
// The metrics are the operational KPIs of PR-34 (Appendix A K1, K2) and patient receivables. Output VAT is not a KPI and is not
// reconciled here (Sol decision, option A): its owners are the VAT sub-ledger (UX-22 ▸ Kewajiban, PR-25) and Coretax (▸ Pajak, PR-98).

export const METRICS = ["k1", "k2", "receivables"] as const;
export type Metric = (typeof METRICS)[number];
export const METRIC_LABEL: Record<Metric, string> = { k1: "Uang masuk (K1)", k2: "Layanan selesai (K2)", receivables: "Piutang" };

export type Ref = { kind: string; id: string; label: string }; // label: receipt / invoice / document number shown to finance
export type Fact = { metric: Metric; ref: Ref; day: string; branchId: string; amount: number };
export type Posting = { metric: Metric; ref: Ref; entryId: string; businessDay: string; period: string; originalPeriod: string; branchId: string; amount: number };
export type PendingEvent = { eventId: string; event: string; ref: Ref };
export type Clearing = { day: string; branchId: string; amount: number }; // inter-branch clearing net movement (debit − credit)
export type ClearingNet = { day: string; amount: number }; // the tenant-wide clearing net of a day (all branches, whatever is selected)
export type HandoverException = { branchId: string; fractional: number; unlinked: number };
export type Unavailable = { metric: Metric; branchId: string | null; reason: string }; // null branch = every branch

export type ReconInput = {
  from: string; to: string;
  branches: { id: string; name: string }[];
  facts: Fact[]; postings: Posting[]; pending: PendingEvent[]; clearing: Clearing[]; clearingNet: ClearingNet[];
  handover: HandoverException[]; unavailable: Unavailable[];
};

export type ItemKind = "missing" | "queued" | "orphan" | "amount" | "placement" | "timing";
export type Item = {
  kind: ItemKind; metric: Metric; ref: Ref; day: string; branchId: string;
  fact: number | null; ledger: number | null; difference: number; // fact − ledger at this day and branch (0 for timing)
  bookedPeriod?: string; entryId?: string; eventId?: string;
};
export type CellStatus = "cocok" | "selisih" | "menunggu" | "waktu" | "tidak_tersedia";
export type Cell = { metric: Metric; fact: number | null; ledger: number | null; difference: number | null; status: CellStatus; reason?: string };
export type Row = { day: string; branchId: string; cells: Cell[]; status: CellStatus };
export type ClearingCheck = { day: string; net: number; byBranch: { branchId: string; amount: number }[] };
export type Verdict = "bersih" | "ada_selisih" | "menunggu_posting" | "ada_pengecualian" | "tidak_lengkap";
export type ReconReport = {
  from: string; to: string; rows: Row[]; items: Item[]; clearing: ClearingCheck[]; exceptions: HandoverException[];
  unavailable: Unavailable[]; verdict: Verdict;
};

const key = (r: Ref) => `${r.kind}:${r.id}`;
const RANK: Record<CellStatus, number> = { cocok: 0, waktu: 1, menunggu: 2, selisih: 3, tidak_tersedia: 4 };
const worst = (a: CellStatus, b: CellStatus) => (RANK[b] > RANK[a] ? b : a);

function assertInt(n: number, what: string) {
  if (!Number.isSafeInteger(n)) throw new Error(`recon: ${what} is not integer rupiah`);
}
// Checked rupiah arithmetic: safe inputs can still produce an unsafe sum or difference; refuse it rather than return a rounded value.
const checked = (n: number, what: string) => {
  if (!Number.isSafeInteger(n)) throw new Error(`recon: ${what} is not a safe integer`);
  return n;
};
const add = (a: number, b: number, what: string) => checked(a + b, what);
const sub = (a: number, b: number, what: string) => checked(a - b, what);
const sum = (xs: number[], what: string) => xs.reduce((s, n) => add(s, n, what), 0);

// Every calendar day from..to inclusive (YYYY-MM-DD).
export function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export function reconcile(x: ReconInput): ReconReport {
  for (const f of x.facts) assertInt(f.amount, `fact ${key(f.ref)}`);
  for (const p of x.postings) assertInt(p.amount, `posting ${key(p.ref)}`);
  for (const c of x.clearing) assertInt(c.amount, "clearing");
  for (const c of x.clearingNet) assertInt(c.amount, "clearing net");

  const pending = new Map(x.pending.map((e) => [key(e.ref), e]));
  // A metric that could not be read for a branch yields no item there: its facts or postings may be partial, so a "missing" or "orphan"
  // from that side would be invented (slice 2). The row says Belum tersedia and the verdict stays tidak_lengkap.
  const unavailableFor = (metric: Metric, branchId: string) => x.unavailable.find((u) => u.metric === metric && (u.branchId === null || u.branchId === branchId));
  const items: Item[] = [];
  for (const metric of METRICS) {
    // DEC-117 Row 5a P2: bucket facts by (ref, day, branchId) so facts sharing a ref on different
    // days or branches are never silently collapsed into the first bucket.
    const factBucketsByRef = new Map<string, Map<string, Fact>>();
    for (const f of x.facts.filter((f) => f.metric === metric)) {
      const rk = key(f.ref);
      let byPlace = factBucketsByRef.get(rk);
      if (!byPlace) {
        byPlace = new Map<string, Fact>();
        factBucketsByRef.set(rk, byPlace);
      }
      const pk = `${f.day}|${f.branchId}`;
      const prev = byPlace.get(pk);
      byPlace.set(pk, prev ? { ...prev, amount: add(prev.amount, f.amount, `fact ${rk}`) } : f);
    }
    const posts = new Map<string, Posting[]>();
    for (const p of x.postings.filter((p) => p.metric === metric)) posts.set(key(p.ref), [...(posts.get(key(p.ref)) ?? []), p]);

    for (const [k, byPlace] of factBucketsByRef) {
      const ps = posts.get(k) ?? [];
      if (ps.length === 0) {
        const ev = pending.get(k);
        for (const f of byPlace.values()) {
          items.push({ kind: ev ? "queued" : "missing", metric, ref: f.ref, day: f.day, branchId: f.branchId, fact: f.amount, ledger: null, difference: f.amount, eventId: ev?.eventId });
        }
        continue;
      }
      // Placement: flag any posting whose (businessDay, branchId) has no matching fact bucket for this ref.
      for (const p of ps) {
        if (!byPlace.has(`${p.businessDay}|${p.branchId}`)) {
          items.push({ kind: "placement", metric, ref: p.ref, day: p.businessDay, branchId: p.branchId, fact: null, ledger: p.amount, difference: sub(0, p.amount, `placement ${k}`), entryId: p.entryId });
        }
      }
      for (const f of byPlace.values()) {
        const here = ps.filter((p) => p.branchId === f.branchId && p.businessDay === f.day);
        const ledger = sum(here.map((p) => p.amount), `ledger ${k}`);
        if (here.length === 0) {
          items.push({ kind: "placement", metric, ref: f.ref, day: f.day, branchId: f.branchId, fact: f.amount, ledger: null, difference: f.amount });
        } else if (ledger !== f.amount) {
          items.push({ kind: "amount", metric, ref: f.ref, day: f.day, branchId: f.branchId, fact: f.amount, ledger, difference: sub(f.amount, ledger, `difference ${k}`), entryId: here[0].entryId });
        }
        // Timing: a late fact booked into a later open period (its own month was locked, PR-26). Same business day and branch, so it
        // matches here; the books show it in the booked period, which finance must see, but it is not a difference.
        for (const p of here.filter((p) => p.period !== p.originalPeriod)) {
          items.push({ kind: "timing", metric, ref: f.ref, day: f.day, branchId: f.branchId, fact: f.amount, ledger: p.amount, difference: 0, bookedPeriod: p.period, entryId: p.entryId });
        }
      }
    }
    for (const [k, ps] of posts) {
      if (factBucketsByRef.has(k)) continue;
      // net per business day and branch first: an original and its reversal in the same bucket leave nothing; a nonzero bucket keeps
      // each entry listed with its own attribution (never cancelled across days or branches)
      const buckets = new Map<string, Posting[]>();
      for (const p of ps) buckets.set(`${p.businessDay}|${p.branchId}`, [...(buckets.get(`${p.businessDay}|${p.branchId}`) ?? []), p]);
      for (const [b, bp] of buckets) {
        if (sum(bp.map((p) => p.amount), `orphan ${k} ${b}`) === 0) continue;
        for (const p of bp) items.push({ kind: "orphan", metric, ref: p.ref, day: p.businessDay, branchId: p.branchId, fact: null, ledger: p.amount, difference: sub(0, p.amount, `orphan ${k}`), entryId: p.entryId });
      }
    }
  }

  // Rows: every day × branch of the period, so a clean day shows as matched rather than missing.
  const rows: Row[] = [];
  for (const day of days(x.from, x.to)) {
    for (const b of x.branches) {
      const cells = METRICS.map((metric): Cell => {
        const u = unavailableFor(metric, b.id);
        if (u) return { metric, fact: null, ledger: null, difference: null, status: "tidak_tersedia", reason: u.reason };
        const fact = sum(x.facts.filter((f) => f.metric === metric && f.day === day && f.branchId === b.id).map((f) => f.amount), `${metric} facts ${day}`);
        const ledger = sum(x.postings.filter((p) => p.metric === metric && p.businessDay === day && p.branchId === b.id).map((p) => p.amount), `${metric} ledger ${day}`);
        const mine = items.filter((i) => i.metric === metric && i.day === day && i.branchId === b.id);
        const status: CellStatus = mine.some((i) => i.kind !== "timing" && i.kind !== "queued") ? "selisih"
          : mine.some((i) => i.kind === "queued") ? "menunggu"
          : mine.some((i) => i.kind === "timing") ? "waktu" : "cocok";
        return { metric, fact, ledger, difference: sub(fact, ledger, `${metric} cell ${day}`), status };
      });
      rows.push({ day, branchId: b.id, cells, status: cells.reduce<CellStatus>((s, c) => worst(s, c.status), "cocok") });
    }
  }

  // Inter-branch clearing nets to zero across ALL branches per day: the net is the reader's tenant-wide total; the legs listed are only
  // the selected branches' (a single selected branch's leg is normally nonzero and is never judged on its own).
  const nets = new Map(x.clearingNet.map((c) => [c.day, c.amount]));
  if (nets.size !== x.clearingNet.length) throw new Error("recon: clearing net repeated for a day");
  for (const c of x.clearing) if (!nets.has(c.day)) throw new Error(`recon: clearing net missing for ${c.day}`);
  const clearing: ClearingCheck[] = [...nets.keys()].sort().map((day) => ({
    day, net: nets.get(day)!, byBranch: x.clearing.filter((c) => c.day === day).map((c) => ({ branchId: c.branchId, amount: c.amount })),
  }));

  const exceptions = x.handover.filter((h) => h.fractional > 0 || h.unlinked > 0);
  const verdict: Verdict = x.unavailable.length > 0 ? "tidak_lengkap"
    : items.some((i) => i.kind !== "timing" && i.kind !== "queued") || clearing.some((c) => c.net !== 0) ? "ada_selisih"
    : items.some((i) => i.kind === "queued") ? "menunggu_posting"
    : exceptions.length > 0 ? "ada_pengecualian" : "bersih";
  items.splice(0, items.length, ...items.filter((i) => !unavailableFor(i.metric, i.branchId)));
  const order: Record<ItemKind, number> = { missing: 0, amount: 1, placement: 2, orphan: 3, queued: 4, timing: 5 };
  items.sort((a, b) => order[a.kind] - order[b.kind] || a.day.localeCompare(b.day) || (Math.abs(b.difference) > Math.abs(a.difference) ? 1 : Math.abs(b.difference) < Math.abs(a.difference) ? -1 : 0) || key(a.ref).localeCompare(key(b.ref)));
  return { from: x.from, to: x.to, rows, items, clearing, exceptions, unavailable: x.unavailable, verdict };
}
