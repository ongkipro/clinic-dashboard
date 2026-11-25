"use client";
// UX-1 / UX-41 ▸ Impor Data Awal interactive view (PR-85, DATA-58, ARCH-10; T-128).
// Apple light-only HIG surface: displays DPA/residency blockers explicitly, dry-run reconciliation
// totals (tabular-nums BigInt Rupiah), zero-PII validation codes, and owner batch approval/rollback.
import { useActionState } from "react";
import { ContextFields } from "../../../../components/context-fields";
import { Button } from "../../../../components/ui/button";
import type { BatchSummaryDto } from "../../../../modules/import";
import type { RenderedContext } from "../../../../modules/org/context/context";
import {
  approveImportBatchAction,
  dryRunImportAction,
  rollbackImportBatchAction,
  type ApproveBatchState,
  type ImportDryRunState,
  type RollbackBatchState,
} from "./actions";
import { BATCH_STATE_LABEL, ENTITY_LABEL, ISSUE_LABEL, ROLLBACK_REASON_LABEL } from "./labels";

function formatRp(idrStr: string): string {
  try {
    const val = BigInt(idrStr);
    const neg = val < BigInt("0");
    const abs = (neg ? -val : val).toString();
    const grouped = abs.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return `${neg ? "-" : ""}Rp${grouped}`;
  } catch {
    return "Rp0";
  }
}

export function ImportWorkspaceView({
  ctx,
  gateBlockers,
  batches,
}: {
  ctx: RenderedContext;
  gateBlockers: { code: string; label: string }[];
  batches: BatchSummaryDto[];
}) {
  const [dryState, dryAction, dryPending] = useActionState<ImportDryRunState, FormData>(dryRunImportAction, {});
  const [appState, appAction, appPending] = useActionState<ApproveBatchState, FormData>(approveImportBatchAction, {});
  const [rbState, rbAction, rbPending] = useActionState<RollbackBatchState, FormData>(rollbackImportBatchAction, {});

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
      {gateBlockers.length > 0 && (
        <section
          role="alert"
          className="min-w-0 rounded-2xl border border-[#FF3B30]/30 bg-[#FF3B30]/5 p-5 [overflow-wrap:anywhere]"
        >
          <h2 className="text-[17px] font-semibold text-[#1D1D1F]">
            Impor data pasien nyata belum dapat dijalankan
          </h2>
          <p className="mt-1 text-[14px] text-[#6E6E73]">
            Lengkapi prasyarat kepatuhan dan residensi data berikut sebelum mengimpor data pasien:
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-[14px] text-[#1D1D1F]">
            {gateBlockers.map((b) => (
              <li key={b.code}>{b.label}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-[#D2D2D7]/70 bg-white p-6 shadow-xs">
        <h2 className="text-[19px] font-semibold tracking-tight text-[#1D1D1F]">
          Uji Coba Impor (Dry-Run &amp; Rekonsiliasi)
        </h2>
        <p className="mt-1 text-[14px] text-[#6E6E73]">
          Validasi berkas data awal tanpa menulis ke basis data. Seluruh total saldo, paket, DP janji, dan piutang dihitung dalam rupiah bulat.
        </p>

        <form action={dryAction} className="mt-4 grid gap-4">
          <ContextFields ctx={ctx} />
          <label className="grid gap-1.5 text-[14px] font-medium text-[#1D1D1F]">
            Data Awal (JSON Terstruktur)
            <textarea
              name="payload_json"
              rows={7}
              required
              placeholder='{"cutoverDate":"2026-10-31","sourceSystem":"legacy_clinic_system","patients":[],"packages":[],"balances":[],"receivables":[],"bookingDps":[]}'
              className="w-full rounded-xl border border-[#D2D2D7] bg-[#F5F5F7]/50 p-3 font-mono text-[13px] text-[#1D1D1F] focus:border-[#007AFF] focus:outline-none"
            />
          </label>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={dryPending} className="min-h-[44px]">
              {dryPending ? "Memvalidasi..." : "Jalankan Uji Coba"}
            </Button>
          </div>
        </form>

        {dryState.error && (
          <p role="alert" className="mt-4 rounded-xl bg-[#FF3B30]/10 px-4 py-3 text-[14px] text-[#D70015]">
            {dryState.error}
          </p>
        )}

        {dryState.issues && dryState.issues.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded-xl border border-[#D2D2D7]/70">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-[#F5F5F7] text-[#6E6E73]">
                <tr>
                  <th className="px-3 py-2 font-medium">Entitas</th>
                  <th className="px-3 py-2 font-medium">Baris</th>
                  <th className="px-3 py-2 font-medium">Kode</th>
                  <th className="px-3 py-2 font-medium">Keterangan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#D2D2D7]/50">
                {dryState.issues.slice(0, 50).map((iss, idx) => (
                  <tr key={`${iss.entity}-${iss.rowNo}-${iss.code}-${idx}`}>
                    <td className="px-3 py-2 font-medium text-[#1D1D1F]">{ENTITY_LABEL[iss.entity] ?? iss.entity}</td>
                    <td className="px-3 py-2 tabular-nums">{iss.rowNo}</td>
                    <td className="px-3 py-2 font-mono text-[12px] text-[#6E6E73]">{iss.code}</td>
                    <td className="px-3 py-2 text-[#1D1D1F]">{ISSUE_LABEL[iss.code] ?? iss.code}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {dryState.summary && (
          <div className="mt-5 grid gap-4 rounded-xl border border-[#34C759]/40 bg-[#34C759]/5 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[16px] font-semibold text-[#1D1D1F]">
                Hasil Rekonsiliasi Dry-Run (Cutover {dryState.summary.cutoverDate})
              </h3>
              <span className="font-mono text-[12px] text-[#6E6E73]">
                Manifest: {dryState.summary.validatedManifestSha256.slice(0, 16)}…
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 @min-[44em]:grid-cols-4">
              <div className="rounded-xl bg-white p-3.5 shadow-2xs">
                <div className="text-[12px] text-[#6E6E73]">Sisa Paket</div>
                <div className="mt-1 text-[16px] font-semibold tabular-nums text-[#1D1D1F]">
                  {formatRp(dryState.summary.totalsIdr.packagesPaidRemaining)}
                </div>
              </div>
              <div className="rounded-xl bg-white p-3.5 shadow-2xs">
                <div className="text-[12px] text-[#6E6E73]">Saldo Pasien</div>
                <div className="mt-1 text-[16px] font-semibold tabular-nums text-[#1D1D1F]">
                  {formatRp(dryState.summary.totalsIdr.balances)}
                </div>
              </div>
              <div className="rounded-xl bg-white p-3.5 shadow-2xs">
                <div className="text-[12px] text-[#6E6E73]">DP Janji</div>
                <div className="mt-1 text-[16px] font-semibold tabular-nums text-[#1D1D1F]">
                  {formatRp(dryState.summary.totalsIdr.bookingDps)}
                </div>
              </div>
              <div className="rounded-xl bg-white p-3.5 shadow-2xs">
                <div className="text-[12px] text-[#6E6E73]">Piutang Awal</div>
                <div className="mt-1 text-[16px] font-semibold tabular-nums text-[#1D1D1F]">
                  {formatRp(dryState.summary.totalsIdr.receivables)}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-[#D2D2D7]/70 bg-white p-6 shadow-xs">
        <h2 className="text-[19px] font-semibold tracking-tight text-[#1D1D1F]">
          Riwayat Batch Impor
        </h2>
        {(appState.error || rbState.error) && (
          <p role="alert" className="mt-3 rounded-xl bg-[#FF3B30]/10 px-4 py-3 text-[14px] text-[#D70015]">
            {appState.error || rbState.error}
          </p>
        )}
        {(appState.ok || rbState.ok) && (
          <p role="status" className="mt-3 rounded-xl bg-[#34C759]/10 px-4 py-3 text-[14px] text-[#1D7A36]">
            {appState.ok || rbState.ok}
          </p>
        )}

        {batches.length === 0 ? (
          <p className="mt-3 text-[14px] text-[#6E6E73]">
            Belum ada batch impor yang tercatat pada klinik ini.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-[#D2D2D7]/70">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-[#F5F5F7] text-[#6E6E73]">
                <tr>
                  <th className="px-3 py-2 font-medium">Sumber</th>
                  <th className="px-3 py-2 font-medium">Cutover</th>
                  <th className="px-3 py-2 font-medium">Baris</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#D2D2D7]/50">
                {batches.map((b) => (
                  <tr key={b.batchId}>
                    <td className="px-3 py-2.5 font-medium text-[#1D1D1F]">{b.sourceSystem}</td>
                    <td className="px-3 py-2.5 tabular-nums">{b.cutoverDate}</td>
                    <td className="px-3 py-2.5 tabular-nums">{b.rowCount}</td>
                    <td className="px-3 py-2.5">{BATCH_STATE_LABEL[b.state] ?? b.state}</td>
                    <td className="px-3 py-2.5">
                      {b.state === "validated" && !b.payloadPurgedAt ? (
                        <form action={appAction}>
                          <ContextFields ctx={ctx} />
                          <input type="hidden" name="batch_id" value={b.batchId} />
                          <input type="hidden" name="validation_revision" value={String(b.validationRevision)} />
                          <input type="hidden" name="manifest_sha256" value={b.validatedManifestSha256} />
                          <Button type="submit" disabled={appPending} className="min-h-[44px]">
                            Setujui Batch
                          </Button>
                        </form>
                      ) : b.state === "applied" ? (
                        <form action={rbAction} className="flex flex-wrap items-center gap-2">
                          <ContextFields ctx={ctx} />
                          <input type="hidden" name="batch_id" value={b.batchId} />
                          <select
                            name="rollback_reason"
                            required
                            defaultValue="cutover_correction"
                            className="min-h-[44px] rounded-lg border border-[#D2D2D7] bg-white px-2.5 text-[13px]"
                          >
                            {Object.entries(ROLLBACK_REASON_LABEL).map(([code, label]) => (
                              <option key={code} value={code}>
                                {label}
                              </option>
                            ))}
                          </select>
                          <Button type="submit" variant="outline" disabled={rbPending} className="min-h-[44px]">
                            Batalkan Batch
                          </Button>
                        </form>
                      ) : (
                        <span className="text-[#6E6E73]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
