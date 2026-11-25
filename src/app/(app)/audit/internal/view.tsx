// Presentational view for /audit/internal (UX-53, PR-63, PR-72; zero patient identity).
import { KpiRow, ListPage } from "../../../../components/templates/templates";
import { StatusBadge } from "../../../../components/ui/status-badge";
import type { AuditInternalData } from "./data";
import {
  APPROVALS_UNAVAILABLE,
  AUDIT_INTERNAL_TITLE,
  DISCOUNT_STATE_LABELS,
  EXPORT_UNAVAILABLE,
  formatDateTime,
  NAME_UNAVAILABLE,
  REFUND_STATE_LABELS,
  roleLabel,
  rp,
  STOCK_COUNT_WINDOW_NOTE,
  SUSPICIOUS_COMPOSITE_UNAVAILABLE,
} from "./labels";

const panel = "grid min-w-0 content-start gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4";
const input = "min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";

export function AuditInternalView({ data, today }: { data: AuditInternalData; today: string }) {
  return (
    <ListPage as="section" title={AUDIT_INTERNAL_TITLE} state={{ kind: "rows" }}>
      <form
        method="get"
        action="/audit/internal"
        aria-label="Filter periode audit internal"
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
            label: "Diskon manual",
            value: String(data.manualDiscounts.length),
            basis: `${data.from} – ${data.to}`,
          },
          {
            label: "Tagihan batal (void)",
            value: String(data.voids.length),
            basis: `${data.from} – ${data.to}`,
          },
          {
            label: "Refund & hapus buku",
            value: String(data.refunds.length + data.writeOffs.length),
            basis: `${data.refunds.length} refund · ${data.writeOffs.length} hapus buku`,
          },
          {
            label: "Selisih stok & kas",
            value: String(data.stockVariances.length + data.cashVariances.length),
            basis: `${data.stockVariances.length} baris stok · ${data.cashVariances.length} hitungan kas`,
          },
        ]}
      />

      <section aria-labelledby="h-aktivitas-mencurigakan" className={panel}>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <h2 id="h-aktivitas-mencurigakan" className="m-0 text-[1.15rem] font-semibold">
            Aktivitas mencurigakan (komposit)
          </h2>
          <StatusBadge tone="neutral">Belum tersedia</StatusBadge>
        </div>
        <p role="status" className={muted}>
          {SUSPICIOUS_COMPOSITE_UNAVAILABLE}
        </p>
        <p className={muted}>
          Sumber SEC-9 yang sudah tersedia ditampilkan pada daftar terpisah di bawah (diskon manual, void, refund, hapus buku, selisih stok, dan selisih kas).
        </p>
      </section>

      <section aria-labelledby="h-diskon-manual" className={panel}>
        <h2 id="h-diskon-manual" className="m-0 text-[1.15rem] font-semibold">
          Diskon manual
        </h2>
        {data.manualDiscounts.length === 0 ? (
          <p className={muted}>Tidak ada diskon manual pada periode ini.</p>
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="w-full border-collapse text-left text-[0.9rem]">
              <thead>
                <tr className="border-b border-[var(--separator)] text-[var(--label-2)]">
                  <th className="py-2 pr-3 font-medium">Waktu</th>
                  <th className="py-2 pr-3 font-medium">Tagihan</th>
                  <th className="py-2 pr-3 font-medium">Cabang</th>
                  <th className="py-2 pr-3 font-medium">Pemohon</th>
                  <th className="py-2 pr-3 font-medium">Penyetuju</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 text-right font-medium">Diskon</th>
                </tr>
              </thead>
              <tbody>
                {data.manualDiscounts.map((d) => (
                  <tr key={d.line_id} className="border-b border-[var(--separator)] last:border-b-0">
                    <td className="py-2 pr-3 whitespace-nowrap tabular-nums">{formatDateTime(d.issued_at)}</td>
                    <td className="py-2 pr-3 font-mono text-[0.82rem]">{d.invoice_number ?? d.invoice_id.slice(0, 8)}</td>
                    <td className="py-2 pr-3">{d.branch.name}</td>
                    <td className="py-2 pr-3">{`${d.requester.name} (${roleLabel(d.requester.role)})`}</td>
                    <td className="py-2 pr-3">
                      {d.approver ? `${d.approver.name} (${roleLabel(d.approver.role)})` : "—"}
                    </td>
                    <td className="py-2 pr-3">{DISCOUNT_STATE_LABELS[d.state] ?? d.state}</td>
                    <td className="py-2 text-right font-medium tabular-nums">
                      {rp(d.discount > 0 ? d.discount : (d.requested ?? 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="h-void" className={panel}>
        <h2 id="h-void" className="m-0 text-[1.15rem] font-semibold">
          Tagihan batal (void)
        </h2>
        {data.voids.length === 0 ? (
          <p className={muted}>Tidak ada tagihan batal pada periode ini.</p>
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="w-full border-collapse text-left text-[0.9rem]">
              <thead>
                <tr className="border-b border-[var(--separator)] text-[var(--label-2)]">
                  <th className="py-2 pr-3 font-medium">Waktu batal</th>
                  <th className="py-2 pr-3 font-medium">Nomor</th>
                  <th className="py-2 pr-3 font-medium">Cabang</th>
                  <th className="py-2 pr-3 font-medium">Peran terbit</th>
                  <th className="py-2 pr-3 font-medium">Nama & alasan</th>
                  <th className="py-2 text-right font-medium">Nilai</th>
                </tr>
              </thead>
              <tbody>
                {data.voids.map((v) => (
                  <tr key={v.id} className="border-b border-[var(--separator)] last:border-b-0">
                    <td className="py-2 pr-3 whitespace-nowrap tabular-nums">{formatDateTime(v.voidedAt)}</td>
                    <td className="py-2 pr-3 font-mono text-[0.82rem]">{v.number ?? v.id.slice(0, 8)}</td>
                    <td className="py-2 pr-3">{v.branchName}</td>
                    <td className="py-2 pr-3">{roleLabel(v.issuedAs)}</td>
                    <td className="py-2 pr-3 text-[var(--label-2)]">{NAME_UNAVAILABLE}</td>
                    <td className="py-2 text-right font-medium tabular-nums">{rp(v.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 min-[900px]:grid-cols-2">
        <section aria-labelledby="h-refund" className={panel}>
          <h2 id="h-refund" className="m-0 text-[1.15rem] font-semibold">
            Refund
          </h2>
          {data.refunds.length === 0 ? (
            <p className={muted}>Tidak ada refund pada periode ini.</p>
          ) : (
            <ul className="m-0 grid min-w-0 list-none gap-2 p-0">
              {data.refunds.map((r) => (
                <li key={r.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--separator)] pb-2 last:border-b-0 last:pb-0">
                  <div className="grid min-w-0 gap-0.5">
                    <span className="font-medium">{`${r.branchName} · ${r.destination === "cash" ? "Tunai" : "Saldo"}`}</span>
                    <span className={muted}>
                      {`${formatDateTime(r.paidAt ?? r.requestedAt)} · ${REFUND_STATE_LABELS[r.state] ?? r.state} · Peran: ${roleLabel(r.paidAs ?? r.requestedAs)} · Nama: ${NAME_UNAVAILABLE}`}
                    </span>
                  </div>
                  <span className="font-semibold tabular-nums">{rp(r.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="h-writeoff" className={panel}>
          <h2 id="h-writeoff" className="m-0 text-[1.15rem] font-semibold">
            Hapus buku piutang
          </h2>
          {data.writeOffs.length === 0 ? (
            <p className={muted}>Tidak ada hapus buku pada periode ini.</p>
          ) : (
            <ul className="m-0 grid min-w-0 list-none gap-2 p-0">
              {data.writeOffs.map((w) => (
                <li key={w.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--separator)] pb-2 last:border-b-0 last:pb-0">
                  <div className="grid min-w-0 gap-0.5">
                    <span className="font-medium">{w.branchName}</span>
                    <span className={muted}>
                      {`${formatDateTime(w.createdAt)} · ${w.ownerSelf ? "Diputuskan Owner" : "Persetujuan"} · Nama: ${NAME_UNAVAILABLE}`}
                    </span>
                  </div>
                  <span className="font-semibold tabular-nums">{rp(w.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 min-[900px]:grid-cols-2">
        <section aria-labelledby="h-selisih-stok" className={panel}>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <h2 id="h-selisih-stok" className="m-0 text-[1.15rem] font-semibold">
              Selisih hitung stok
            </h2>
            <span className={muted}>{STOCK_COUNT_WINDOW_NOTE}</span>
          </div>
          {data.stockVariances.length === 0 ? (
            <p className={muted}>Tidak ada selisih hitung stok pada periode ini.</p>
          ) : (
            <ul className="m-0 grid min-w-0 list-none gap-2 p-0">
              {data.stockVariances.map((s) => (
                <li key={`${s.countId}-${s.batchNo}-${s.itemName}`} className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--separator)] pb-2 last:border-b-0 last:pb-0">
                  <div className="grid min-w-0 gap-0.5">
                    <span className="font-medium">{`${s.itemName} (${s.batchNo})`}</span>
                    <span className={muted}>{`${s.branchName} · ${formatDateTime(s.countedAt)} · Sistem ${s.systemQty ?? "—"} / Hitung ${s.countedQty ?? "—"} ${s.unit}`}</span>
                  </div>
                  <span className="font-semibold tabular-nums">{`${s.difference > 0 ? "+" : ""}${s.difference} ${s.unit}`}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="h-selisih-kas" className={panel}>
          <h2 id="h-selisih-kas" className="m-0 text-[1.15rem] font-semibold">
            Selisih kas shift
          </h2>
          {data.cashVariances.length === 0 ? (
            <p className={muted}>Tidak ada selisih kas pada periode ini.</p>
          ) : (
            <ul className="m-0 grid min-w-0 list-none gap-2 p-0">
              {data.cashVariances.map((c) => (
                <li key={c.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--separator)] pb-2 last:border-b-0 last:pb-0">
                  <div className="grid min-w-0 gap-0.5">
                    <span className="font-medium">{`${c.branchName} · Hitung #${c.seq}`}</span>
                    <span className={muted}>
                      {`${formatDateTime(c.countedAt)} · Ekspektasi ${rp(c.expectedCash)} / Hitung ${rp(c.countedCash)} · Peran: ${roleLabel(c.countedAs)}${c.escalated ? " · Dieskalasi" : ""}`}
                    </span>
                  </div>
                  <span className="font-semibold tabular-nums">{rp(c.difference)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 min-[900px]:grid-cols-2">
        <section aria-labelledby="h-persetujuan" className={panel}>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <h2 id="h-persetujuan" className="m-0 text-[1.15rem] font-semibold">
              Persetujuan
            </h2>
            <StatusBadge tone="neutral">Belum tersedia</StatusBadge>
          </div>
          <p role="status" className={muted}>
            {APPROVALS_UNAVAILABLE}
          </p>
        </section>

        <section aria-labelledby="h-ekspor-audit" className={panel}>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <h2 id="h-ekspor-audit" className="m-0 text-[1.15rem] font-semibold">
              Ekspor
            </h2>
            <StatusBadge tone="neutral">Belum tersedia</StatusBadge>
          </div>
          <p role="status" className={muted}>
            {EXPORT_UNAVAILABLE}
          </p>
        </section>
      </div>
    </ListPage>
  );
}
