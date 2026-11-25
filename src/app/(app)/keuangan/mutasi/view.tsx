// Presentational view for /keuangan/mutasi (Apple light-only HIG, zero patient identity).
import { KpiRow, ListPage } from "../../../../components/templates/templates";
import { StatusBadge } from "../../../../components/ui/status-badge";
import type { MutasiData } from "./data";
import {
  EMPTY_MUTASI,
  formatDay,
  methodLabel,
  MUTASI_TITLE,
  rp,
  SETTLEMENT_UNAVAILABLE,
  sourceLabel,
} from "./labels";

const panel = "grid min-w-0 content-start gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4";
const input = "min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";

export function MutasiView({ data, today }: { data: MutasiData; today: string }) {
  const hasRows = data.rows.length > 0;
  return (
    <ListPage as="section" title={MUTASI_TITLE} state={{ kind: "rows" }}>
      <form
        method="get"
        action="/keuangan/mutasi"
        aria-label="Filter periode mutasi"
        className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 min-[700px]:grid-cols-[repeat(3,minmax(0,1fr))_auto] min-[700px]:items-end"
      >
        <label className="grid min-w-0 gap-1">
          Dari
          <input name="dari" type="date" defaultValue={data.from} max={today} className={input} />
        </label>
        <label className="grid min-w-0 gap-1">
          Sampai
          <input name="sampai" type="date" defaultValue={data.to} max={today} className={input} />
        </label>
        <label className="grid min-w-0 gap-1">
          Cabang
          <select name="cabang" defaultValue={data.branchId ?? ""} className={input}>
            <option value="">Semua Cabang</option>
            {data.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="min-h-[var(--target)] rounded-full bg-[var(--secondary)] px-5 font-semibold text-[var(--label)]"
        >
          Terapkan
        </button>
      </form>

      <KpiRow
        items={[
          {
            label: "Total uang masuk bersih (K1)",
            value: hasRows ? rp(data.total) : "—",
            basis: `${formatDay(data.from)} – ${formatDay(data.to)} · tanpa pemakaian saldo & transaksi simulasi`,
          },
          {
            label: "Jumlah baris mutasi",
            value: String(data.rows.length),
            basis: data.branchId ? "Filter satu cabang" : "Semua cabang",
          },
        ]}
      />

      {!hasRows ? (
        <div className={panel} role="status">
          <p className="m-0 text-[var(--label-2)]">{EMPTY_MUTASI}</p>
        </div>
      ) : (
        <>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 min-[900px]:grid-cols-2">
            <section aria-labelledby="h-per-metode" className={panel}>
              <h2 id="h-per-metode" className="m-0 text-[1.15rem] font-semibold">
                Ringkasan per metode
              </h2>
              <dl className="m-0 grid min-w-0 gap-1.5">
                {data.byMethod.map((m) => (
                  <div key={m.dim} className="flex min-w-0 flex-wrap justify-between gap-x-3">
                    <dt className="min-w-0 [overflow-wrap:anywhere]">{methodLabel(m.dim)}</dt>
                    <dd className="m-0 font-medium tabular-nums">{rp(m.amount)}</dd>
                  </div>
                ))}
                <div className="flex min-w-0 flex-wrap justify-between gap-x-3 border-t border-[var(--separator)] pt-1.5 font-semibold">
                  <dt>Total K1</dt>
                  <dd className="m-0 tabular-nums">{rp(data.total)}</dd>
                </div>
              </dl>
              <p className={muted}>
                Refund tunai dan refund DP ditampilkan sebagai baris tersendiri sesuai definisi K1.
              </p>
            </section>

            <section aria-labelledby="h-per-cabang" className={panel}>
              <h2 id="h-per-cabang" className="m-0 text-[1.15rem] font-semibold">
                Ringkasan per cabang
              </h2>
              <dl className="m-0 grid min-w-0 gap-1.5">
                {data.byBranch.map((b) => (
                  <div key={b.branchId} className="flex min-w-0 flex-wrap justify-between gap-x-3">
                    <dt className="min-w-0 [overflow-wrap:anywhere]">{b.branchName}</dt>
                    <dd className="m-0 font-medium tabular-nums">{rp(b.amount)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>

          <section aria-labelledby="h-rincian-mutasi" className={panel}>
            <h2 id="h-rincian-mutasi" className="m-0 text-[1.15rem] font-semibold">
              Rincian baris mutasi
            </h2>
            <div className="w-full overflow-x-auto">
              <table className="w-full border-collapse text-left text-[0.9rem]">
                <thead>
                  <tr className="border-b border-[var(--separator)] text-[var(--label-2)]">
                    <th className="py-2 pr-3 font-medium">Tanggal</th>
                    <th className="py-2 pr-3 font-medium">Cabang</th>
                    <th className="py-2 pr-3 font-medium">Jenis</th>
                    <th className="py-2 pr-3 font-medium">Metode</th>
                    <th className="py-2 pr-3 font-medium">Referensi</th>
                    <th className="py-2 text-right font-medium">Nominal</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr
                      key={`${row.sourceKind}-${row.sourceRef}-${row.day}-${row.dim}`}
                      className="border-b border-[var(--separator)] last:border-b-0"
                    >
                      <td className="py-2 pr-3 whitespace-nowrap tabular-nums">{formatDay(row.day)}</td>
                      <td className="py-2 pr-3">{row.branchName}</td>
                      <td className="py-2 pr-3">{sourceLabel(row.sourceKind)}</td>
                      <td className="py-2 pr-3">{methodLabel(row.dim)}</td>
                      <td className="py-2 pr-3 font-mono text-[0.82rem] text-[var(--label-2)]">{row.sourceRef}</td>
                      <td className="py-2 text-right font-medium tabular-nums">{rp(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <section aria-labelledby="h-settlement" className={panel}>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <h2 id="h-settlement" className="m-0 text-[1.15rem] font-semibold">
            Settlement gateway
          </h2>
          <StatusBadge tone="neutral">Belum tersedia</StatusBadge>
        </div>
        <p role="status" className={muted}>
          {SETTLEMENT_UNAVAILABLE}
        </p>
      </section>
    </ListPage>
  );
}
