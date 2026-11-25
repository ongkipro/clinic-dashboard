// Status Backup view (UX-32 ▸ Backup; DR-1; T-122 D7).
import Link from "next/link";
import { PageTitle } from "../../../../components/templates/templates";
import { BlockedState } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { ROUTE as EKSPOR } from "../model";
import { instant, TARGETS, type BackupModel, type Signal } from "./model";

const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";

function SignalCard({ id, title, s, staleText }: { id: string; title: string; s: Signal; staleText: string }) {
  return (
    <li className="grid min-w-0 content-start gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-4" data-signal={id} data-state={s.kind}>
      <p className={muted}>{title}</p>
      {s.kind === "not_measured" ? (
        <>
          <StatusBadge tone="neutral" className="justify-self-start">Belum terpantau</StatusBadge>
          <p className={muted}>{`${s.why}.`}</p>
        </>
      ) : (
        <>
          <p className="m-0 text-[1.25rem] font-semibold [overflow-wrap:anywhere]">{instant(s.at)}</p>
          {s.stale && <StatusBadge tone="warning" className="justify-self-start">{staleText}</StatusBadge>}
          <p className={muted}>{`Bukti vendor: ${s.evidence}`}</p>
        </>
      )}
    </li>
  );
}

export function BackupView({ model }: { model: BackupModel }) {
  return (
    <div className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
      <PageTitle title="Status Backup" />
      {model.kind === "blocked" ? (
        <BlockedState reason={model.reason} unblock={model.unblock} />
      ) : (
        <>
          <ul aria-label="Status backup dari vendor" className="m-0 grid min-w-0 list-none grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-3 p-0">
            <SignalCard id="backup" title="Backup terakhir" s={model.backup} staleText="Lebih dari 26 jam" />
            <SignalCard id="drill" title="Uji restore terakhir" s={model.drill} staleText="Lebih dari satu kuartal" />
          </ul>
          <section aria-labelledby="backup-target" className="grid min-w-0 gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
            <h2 id="backup-target" className="m-0 text-[1.18rem] font-semibold">Target pemulihan</h2>
            <p className={muted}>
              {`Target vendor: data yang hilang paling banyak ${TARGETS.rpoMinutes} menit terakhir, layanan pulih dalam ${TARGETS.rtoHours} jam. Target, bukan hasil terukur.`}
            </p>
            <p className={muted}>Pemulihan dilakukan oleh vendor, tidak dari halaman ini.</p>
          </section>
          <Link href={EKSPOR} className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-primary">
            Minta ekspor data
          </Link>
        </>
      )}
    </div>
  );
}
