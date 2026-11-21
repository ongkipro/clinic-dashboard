// K1–K19 report values from the real T-107 / T-088 readers (PR-95, UX-38; T-116 slice 2). No SQL of its own: dashboard_kpi (0126) for
// K1–K18 and target_list (0103) for K19 decide roles, tenant and branch scope; this module maps their payloads to report metrics without
// changing units (integer rupiah stays rupiah, counts stay counts, a ratio keeps numerator and denominator, K14 minutes → whole seconds,
// exact: the reader rounds to 0.1 minute = 6 s). What a reader cannot vouch for is "unavailable" with its reason, never 0 / Rp0:
// - a KPI the acting role may not read (07 Dashboards) → `forbidden` for that KPI only; the other KPIs of the report still show;
// - K4 with an undated cancellation (extra.complete = false), K5 with pre-cutover residue rows, K7 with an uncosted movement → `incomplete`;
// - a ratio with an empty denominator → no data; K19 for a period that is not one calendar month → `period_unsupported`;
// - K20–K27 → the 0130 readers (report_k20 … report_k27 via readers.ts: decode → calculators.ts); K21 / K22 are read "as of" the period's
//   last day; K22 / K23 / K25 / K27 also give a table (rows the page shows under the header). Their roles are the readers' own;
// - K17 in a branch view → `branch_unattributed` (slice 3, K17 preflight 2026-11-20): dashboard_kpi drops branch-less rows under a branch
//   scope (0126:434) and the net actually paid sits on the payout line with no branch, so a branch-scoped total is accrued + adjusted
//   only — the gross, not what is owed. Same conservative rule as T-114: decided on the scope the reader APPLIED (r.branch_id: an explicit
//   branch, or a manager bound to its branch — the reader echoes both); the consolidated total stays signed. Until a branch rule for paid
//   commission is decided, no branch K17 is shown, even where no payout exists yet.
// A branch outside the actor's scope is refused by the reader (ERR_NOT_FOUND / ERR_FORBIDDEN) and surfaces as the page's not-found.
import type pg from "pg";
import { CommandError } from "../../../lib/command";
import { kpi, type Kpi, type KpiResult, type K12Extra, type K14Extra, type K15Extra, type K4Extra } from "../dashboards/dashboards";
import { listTargets, type TargetList } from "../../commission/targets/targets";
import { BY_ID, type KpiId, REPORTS, type ReportId } from "./dictionary";
import { count, duration, type Metric, money, noData, pending, ratio, show, type Unavailable } from "./metrics";
import { read } from "./readers";

export type LiveKpi = { id: KpiId; label?: string; metric: Metric; basis: string };
export type LiveCell = string | Metric;
export type LiveTable = { kpi: KpiId; caption: string; columns: { id: string; label: string; numeric?: boolean }[]; rows: Record<string, LiveCell>[] };
export type LiveReport = { report: ReportId; from: string; to: string; branchId: string | null; kpis: LiveKpi[]; tables: LiveTable[]; allForbidden: boolean };

const off = (reason: Unavailable): Metric => ({ kind: "unavailable", reason });
const n = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : 0);
const dim = (r: KpiResult, k: string) => n(r.by_dim?.[k]);
// money totals: the reader's total is the sum of the money parts, null when there are none — a real Rp0 for a flow over the period
const total = (r: KpiResult): Metric => money(r.total === null ? 0 : n(r.total));
const K17_BRANCH = "Komisi yang sudah dibayar tidak tercatat per cabang; lihat Semua Cabang";
const basis = (id: KpiId, note?: string) => [BY_ID.get(id)!.attribution, note].filter(Boolean).join(" · ");

// One dashboard_kpi payload → the report rows of that KPI (pure; tested on crafted payloads and on the real reader).
export function fromKpi(id: KpiId, r: KpiResult): LiveKpi[] {
  switch (id) {
    case "K17":
      if (r.branch_id) return [{ id, metric: off("branch_unattributed"), basis: basis(id, K17_BRANCH) }];
      return [{ id, metric: total(r), basis: basis(id) }];
    case "K1": case "K2": case "K3": case "K6":
      return [{ id, metric: total(r), basis: basis(id) }];
    case "K4": {
      const x = r.extra as K4Extra | null;
      if (!x || x.complete !== true) return [{ id, metric: off("incomplete"), basis: basis(id, `${n(x?.undated_cancellations)} pembatalan tanpa tanggal`) }];
      return [{ id, metric: total(r), basis: basis(id) }];
    }
    case "K5": {
      const residue = dim(r, "incomplete");
      return [{ id, metric: residue > 0 ? off("incomplete") : total(r), basis: basis(id, residue > 0 ? `${residue} gerakan sebelum cutover` : undefined) }];
    }
    case "K7": {
      const uncosted = dim(r, "uncosted"), est = dim(r, "estimasi");
      if (uncosted > 0) return [{ id, metric: off("incomplete"), basis: basis(id, `biaya belum lengkap (${uncosted})`) }];
      return [{ id, metric: total(r), basis: basis(id, est > 0 ? "estimasi" : undefined) }];
    }
    case "K8": return [{ id, metric: ratio(dim(r, "purchase"), dim(r, "consultation")), basis: basis(id) }];
    case "K9":
      return [
        { id, label: "Rencana dipilih ≤ 30 hari (jumlah)", metric: ratio(dim(r, "selected_30_count"), dim(r, "recommended_count")), basis: basis(id) },
        { id, label: "Rencana dipilih ≤ 30 hari (nilai)", metric: ratio(dim(r, "selected_30_value"), dim(r, "recommended_value")), basis: basis(id) },
      ];
    case "K10":
      return [
        { id, label: "Pasien baru", metric: count(dim(r, "new")), basis: basis(id) },
        { id, label: "Pasien kembali", metric: count(dim(r, "returning")), basis: basis(id) },
      ];
    case "K11": return [{ id, metric: ratio(dim(r, "second_visit"), dim(r, "new")), basis: basis(id, "batas SET-22 saat kunjungan pertama") }];
    case "K12": {
      const x = r.extra as K12Extra | null;
      return [{ id, metric: ratio(n(x?.failed), n(x?.booked)), basis: basis(id) }];
    }
    case "K13": return [{ id, metric: ratio(dim(r, "paid"), dim(r, "lead")), basis: basis(id, `${dim(r, "lead")} lead`) }];
    case "K14": {
      const x = r.extra as K14Extra | null;
      if (!x || n(x.leads) === 0) return [{ id, metric: noData, basis: basis(id) }];
      // the share against the SLA is labelled by the thresholds in effect at entry (sla_mix), never today's sla_minutes
      const mix = (x.sla_mix ?? []).map((m) => `SLA ${m.minutes} menit: ${m.within} dari ${m.leads}`).join(" · ");
      return [
        { id, label: "Median respons", metric: duration(x.median_minutes === null ? null : Math.round(x.median_minutes * 60)), basis: basis(id, `${x.answered} dari ${x.leads} dijawab`) },
        { id, label: "Dijawab ≤ 15 menit", metric: ratio(n(x.within_15m), n(x.leads)), basis: basis(id) },
        { id, label: "Dijawab sesuai SLA saat lead masuk", metric: ratio(n(x.within_sla), n(x.leads)), basis: basis(id, mix) },
      ];
    }
    case "K15": {
      const x = r.extra as K15Extra | null;
      return [{ id, metric: ratio(n(x?.covered_minutes), n(x?.rostered_minutes)), basis: basis(id, "menit terisi ÷ menit jadwal") }];
    }
    case "K16": return [{ id, metric: ratio(dim(r, "with_product"), dim(r, "treatment_visit")), basis: basis(id) }];
    case "K18":
      return [
        { id, label: "Di bawah minimum", metric: count(dim(r, "below_min")), basis: basis(id) },
        { id, label: "Kedaluwarsa dekat", metric: count(dim(r, "expiring")), basis: basis(id) },
        { id, label: "Selisih hitung", metric: count(dim(r, "variance")), basis: basis(id) },
      ];
    default:
      return [{ id, metric: pending, basis: basis(id) }];
  }
}

// K19 from target_list: the BCs with a target this month — closing value actual ÷ target (money ÷ money), plans fully selected.
export function fromTargets(t: TargetList): LiveKpi[] {
  const bcs = t.rows.filter((r) => r.is_bc && r.target);
  const actual = bcs.reduce((s, r) => s + n(r.closing_value_actual), 0);
  const target = bcs.reduce((s, r) => s + n(r.target!.closing_value_target), 0);
  return [
    { id: "K19", label: "Closing vs target BC", metric: ratio(actual, target), basis: basis("K19", `${bcs.length} BC dengan target · ${t.period}`) },
    { id: "K19", label: "Nilai closing BC", metric: money(actual), basis: basis("K19", t.period) },
  ];
}

// K20–K27 from their reader (0130) through the calculator: the KPI header rows and, where the KPI is a list, its table. Ids only — a
// patient appears by MRN (and by name only when the reader sends it: owner / manager), a doctor by display name, a promo by code + version.
const branchName = (names: ReadonlyMap<string, string>, id: string) => names.get(id) ?? "Cabang";
export async function readKpi(db: pg.ClientBase, id: KpiId, o: { from: string; to: string; branchId?: string | null }, branches: ReadonlyMap<string, string>)
  : Promise<{ kpis: LiveKpi[]; table?: LiveTable }> {
  const q = { from: o.from, to: o.to, branchId: o.branchId ?? null };
  switch (id) {
    case "K20": {
      const r = await read.k20(db, q);
      return { kpis: [{ id, metric: r.average, basis: basis(id, `${show(r.invoices)} tagihan · K3 ${show(r.k3)}`) }] };
    }
    case "K21": {
      const r = await read.k21(db, { asOf: o.to, branchId: q.branchId });
      return { kpis: [{ id, metric: r.churn, basis: basis(id, `per ${o.to} · ${show(r.churned)} dari ${show(r.active)} pasien aktif · batas ${r.dormantDays} hari (SET-22)`) }] };
    }
    case "K22": {
      const rows = await read.k22(db, { asOf: o.to, branchId: q.branchId, limit: 10 });
      return {
        kpis: [{ id, label: "Pasien teratas (LTV)", metric: count(rows.length), basis: basis(id, `sejak kunjungan pertama s.d. ${o.to}`) }],
        table: { kpi: id, caption: "Pasien teratas", columns: [{ id: "mrn", label: "No. RM" }, ...(rows.some((x) => x.name !== null) ? [{ id: "name", label: "Nama" }] : []),
          { id: "ltv", label: "LTV (K22)", numeric: true }],
          rows: rows.map((x) => ({ mrn: x.mrn, ...(x.name !== null ? { name: x.name } : {}), ltv: money(x.ltv) })) },
      };
    }
    case "K23": {
      const r = await read.k23(db, q);
      return {
        // every shift row of the period (an opened shift without a transaction counts too — R3 7ea04efd), Tanpa shift excluded
        kpis: [{ id, label: "Jumlah shift", metric: count(r.rows.filter((x) => x.shift !== null).length), basis: basis(id) }],
        table: { kpi: id, caption: "Penjualan dan uang masuk per shift", columns: [{ id: "shift", label: "Shift" }, { id: "branch", label: "Cabang" },
          { id: "k3", label: "Penjualan (K3)", numeric: true }, { id: "k1", label: "Uang masuk (K1)", numeric: true }],
          rows: r.rows.map((x, i) => ({ shift: x.shift === null ? "Tanpa shift" : `Shift ${r.rows.slice(0, i + 1).filter((y) => y.shift !== null).length}`, branch: branchName(branches, x.branch), k3: x.k3, k1: x.k1 })) },
      };
    }
    case "K24": return { kpis: [{ id, metric: await read.k24(db, q), basis: basis(id, "median") }] };
    case "K25": {
      const r = await read.k25(db, q);
      return {
        kpis: [{ id, label: "Pemakaian kode promo", metric: count(r.rows.reduce((s, x) => s + (x.uses.kind === "count" ? x.uses.value : 0), 0)), basis: basis(id) }],
        table: { kpi: id, caption: "Performa kode promo", columns: [{ id: "code", label: "Kode" }, { id: "uses", label: "Pemakaian", numeric: true },
          { id: "discount", label: "Diskon", numeric: true }, { id: "k3", label: "Penjualan (K3)", numeric: true }],
          rows: r.rows.map((x) => ({ code: r.labels.get(x.version) ?? x.version, uses: x.uses, discount: x.discount, k3: x.k3 })) },
      };
    }
    case "K26": {
      const r = await read.k26(db, q);
      return { kpis: [
        { id, label: "Kepuasan rata-rata", metric: r.average, basis: basis(id, `${show(r.responses)} survei`) },
        { id, label: "Skor ≤ 2", metric: r.low, basis: basis(id) },
      ] };
    }
    case "K27": {
      const r = await read.k27(db, q);
      return {
        kpis: [{ id, label: "Dokter aktif", metric: count(r.rows.length), basis: basis(id) }],
        table: { kpi: id, caption: "Aktivitas dokter", columns: [{ id: "doctor", label: "Dokter" }, { id: "signed", label: "Ditandatangani", numeric: true },
          { id: "unsigned", label: "Belum ditandatangani > 24 jam", numeric: true }, { id: "decided", label: "Permintaan diputuskan", numeric: true },
          { id: "median", label: "Check-in → tanda tangan", numeric: true }],
          rows: r.rows.map((x) => ({ doctor: r.names.get(x.doctor) ?? "Dokter", signed: x.signed, unsigned: x.unsignedOver24h, decided: x.requestsDecided, median: x.checkInToSignature })) },
      };
    }
    default: return { kpis: [{ id, metric: pending, basis: basis(id) }] };
  }
}

// One calendar month exactly (YYYY-MM-01 .. its last day) → `YYYY-MM`, else null.
export function wholeMonth(from: string, to: string): string | null {
  if (!/^\d{4}-\d{2}-01$/.test(from)) return null;
  const [y, m] = from.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return to === last ? from.slice(0, 7) : null;
}

// Run one reader under a savepoint: a refusal for this KPI must not abort the page's transaction or the other KPIs.
async function guarded<T>(db: pg.ClientBase, fn: () => Promise<T>): Promise<T | "forbidden"> {
  await db.query("savepoint report_kpi");
  try {
    const r = await fn();
    await db.query("release savepoint report_kpi");
    return r;
  } catch (e) {
    await db.query("rollback to savepoint report_kpi");
    if (e instanceof CommandError && e.code === "ERR_FORBIDDEN") return "forbidden";
    throw e; // ERR_NOT_FOUND (a branch outside scope), ERR_INVALID_INPUT (period) and anything else: the page's state, not a value
  }
}

export async function loadReport(db: pg.ClientBase, report: ReportId, o: { from: string; to: string; branchId?: string | null }): Promise<LiveReport> {
  const kpis: LiveKpi[] = [];
  const tables: LiveTable[] = [];
  let readable = 0, asked = 0;
  let branches: Map<string, string> | null = null;
  for (const id of REPORTS[report].kpis) {
    const k = Number(id.slice(1));
    asked++;
    if (k >= 20) {
      branches ??= new Map((await db.query<{ id: string; name: string }>(`select id, name from branches`)).rows.map((b) => [b.id, b.name]));
      const r = await guarded(db, () => readKpi(db, id, o, branches!));
      if (r === "forbidden") kpis.push({ id, metric: off("forbidden"), basis: basis(id) });
      else { readable++; kpis.push(...r.kpis); if (r.table) tables.push(r.table); }
      continue;
    }
    if (k === 19) {
      const month = wholeMonth(o.from, o.to);
      if (!month) { readable++; kpis.push({ id, metric: off("period_unsupported"), basis: basis(id) }); continue; }
      const t = await guarded(db, () => listTargets(db, { period: month, branchId: o.branchId ?? null }));
      if (t === "forbidden") kpis.push({ id, metric: off("forbidden"), basis: basis(id) });
      else { readable++; kpis.push(...fromTargets(t)); }
      continue;
    }
    const r = await guarded(db, () => kpi(db, { kpi: id.toLowerCase() as Kpi, from: o.from, to: o.to, branchId: o.branchId ?? null }));
    if (r === "forbidden") kpis.push({ id, metric: off("forbidden"), basis: basis(id) });
    else { readable++; kpis.push(...fromKpi(id, r)); }
  }
  return { report, from: o.from, to: o.to, branchId: o.branchId ?? null, kpis, tables, allForbidden: asked > 0 && readable === 0 };
}
