// Ekspor Data view (UX-32, PR-52; T-122).
// Single primary action (Mulai Ekspor); download is a guarded POST form (never GET/prefetch).
import Link from "next/link";
import { PageTitle } from "../../../components/templates/templates";
import { BlockedState } from "../../../components/ui/states";
import { StatusBadge } from "../../../components/ui/status-badge";
import type { RenderedContext } from "../../../modules/org/context/context";
import { DownloadExportForm, StartExportForm } from "./forms";
import { instant, remaining, ROUTE, size, STATE_LABEL, type EksporModel, type Job } from "./model";

const TITLE = "Ekspor Data Klinik";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";

function JobRow({ j, now, ctx }: { j: Job; now: string; ctx: RenderedContext | null }) {
  const st = STATE_LABEL[j.state];
  const left = j.state === "ready" ? remaining(j.expiresAt, now) : null;
  return (
    <li
      className="grid min-w-0 gap-2 border-b border-[var(--separator)] px-4 py-[11px] last:border-b-0 [border-bottom-width:0.5px]"
      data-state={j.state}
      data-export-id={j.id}
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="font-semibold [overflow-wrap:anywhere]">{`Diminta ${instant(j.requestedAt)}`}</span>
        <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
      </div>
      <dl className="m-0 grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-x-4 gap-y-1">
        <div className="min-w-0">
          <dt className={muted}>Ukuran</dt>
          <dd className="tabular m-0">{size(j.sizeBytes)}</dd>
        </div>
        <div className="min-w-0">
          <dt className={muted}>Berkas</dt>
          <dd className="tabular m-0">{j.fileCount ?? "—"}</dd>
        </div>
        <div className="min-w-0">
          <dt className={muted}>Kedaluwarsa</dt>
          <dd className="m-0 [overflow-wrap:anywhere]">{j.expiresAt ? `${instant(j.expiresAt)}${left ? ` (${left})` : ""}` : "—"}</dd>
        </div>
        <div className="min-w-0">
          <dt className={muted}>Manifest SHA-256</dt>
          <dd className="tabular m-0 [overflow-wrap:anywhere]">
            {j.manifestSha256 ? <abbr title={j.manifestSha256}>{`${j.manifestSha256.slice(0, 12)}…`}</abbr> : "—"}
          </dd>
        </div>
      </dl>
      {j.state === "failed" && <p className={muted}>{`Ekspor gagal${j.errorCode ? ` (${j.errorCode})` : ""}. Mulai ekspor baru.`}</p>}
      {j.state === "expired" && <p className={muted}>Berkas sudah dihapus setelah 24 jam. Mulai ekspor baru bila masih diperlukan.</p>}
      {j.canDownload && ctx && <DownloadExportForm ctx={ctx} exportId={j.id} />}
    </li>
  );
}

export function EksporView({ model, ctx = null }: { model: EksporModel; ctx?: RenderedContext | null }) {
  return (
    <div className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
      <PageTitle title={TITLE} />
      {model.kind === "blocked" ? (
        <BlockedState reason={model.reason} unblock={model.unblock} />
      ) : model.kind === "error" ? (
        <div role="alert" className="grid gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
          <p className="m-0 text-destructive">Daftar ekspor belum dapat ditampilkan. Tidak ada yang berubah.</p>
          <Link href={ROUTE} className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-primary">
            Coba Lagi
          </Link>
        </div>
      ) : (
        <>
          <section aria-labelledby="ekspor-mulai" className="grid min-w-0 gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
            <h2 id="ekspor-mulai" className="m-0 text-[1.18rem] font-semibold">Ekspor semua data klinik</h2>
            <p className={muted}>
              Rekam medis sebagai bundle FHIR dan PDF per rekam, media klinis terpisah, serta data keuangan dan CRM sebagai CSV, dengan manifest SHA-256 setiap berkas.
              Berkas dapat diunduh selama 24 jam setelah selesai, lalu dihapus otomatis.
            </p>
            {model.canStart && ctx ? (
              <StartExportForm ctx={ctx} />
            ) : (
              <p role="status" className="m-0 font-semibold">{`${model.startBlocked ?? "Ekspor tidak tersedia saat ini"}.`}</p>
            )}
          </section>
          <section aria-labelledby="ekspor-daftar" className="grid min-w-0 gap-2">
            <h2 id="ekspor-daftar" className="m-0 text-[1.18rem] font-semibold">Riwayat ekspor</h2>
            {model.jobs.length === 0 ? (
              <p role="status" className="m-0 rounded-[var(--radius-group)] bg-[var(--surface)] p-4 text-[var(--label-2)]">
                Belum ada ekspor.
              </p>
            ) : (
              <ul aria-label="Riwayat ekspor" className="m-0 grid list-none overflow-hidden rounded-[var(--radius-group)] bg-[var(--surface)] p-0">
                {model.jobs.map((j) => (
                  <JobRow key={j.id} j={j} now={model.now} ctx={ctx} />
                ))}
              </ul>
            )}
          </section>
          <Link href={`${ROUTE}/backup`} className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-primary">
            Lihat status backup
          </Link>
        </>
      )}
    </div>
  );
}
