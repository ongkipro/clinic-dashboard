// UX-30 ▸ Permintaan presentational views (PR-50; T-121).
// Segments Privasi · Permintaan link /privasi and /privasi/permintaan. Rows show right,
// requester + MRN only (never patient name or clinical content), 72h deadline, and state.
import Link from "next/link";
import { RowList } from "../../../../components/templates/templates";
import { BlockedState, EmptyState } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import {
  canProgress,
  CHANNEL_LABEL,
  CORRECTION_SCOPE_LABEL,
  deadlineAt,
  erasurePlan,
  IDENTITY_METHOD_LABEL,
  LEGAL_BASIS,
  LINK_KIND_LABEL,
  minutesLeft,
  OUTCOME_BASIS_LABEL,
  REFUSAL_COPY,
  RESTRICTION_PURPOSE_LABEL,
  RIGHT_LABEL,
  RIGHTS,
  urgency,
  type DsrDetail,
  type DsrListRow,
} from "../../../../modules/privacy/requests";
import { counts, type Filter, OUTCOME, REQUESTER, shapeList, STATE, timeLeft, URGENCY } from "./model";

const at = (d: Date) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(d);

const q = (f: Filter, o: Partial<{ status: string; hak: string | null }> = {}) => {
  const p = new URLSearchParams();
  const status = o.status ?? f.state;
  const hak = o.hak === undefined ? f.right : o.hak;
  if (status !== "open") p.set("status", status);
  if (hak) p.set("hak", hak);
  const s = p.toString();
  return `/privasi/permintaan${s ? `?${s}` : ""}`;
};

export function Segments({ active }: { active: "privasi" | "permintaan" }) {
  return (
    <nav aria-label="Privasi dan permintaan" className="flex flex-wrap gap-2">
      {(
        [
          ["privasi", "Privasi", "/privasi"],
          ["permintaan", "Permintaan", "/privasi/permintaan"],
        ] as const
      ).map(([id, label, href]) => (
        <Link
          key={id}
          href={href}
          prefetch={false}
          aria-current={active === id ? "page" : undefined}
          className={`inline-flex min-h-[var(--target)] items-center rounded-full px-4 no-underline ${
            active === id ? "bg-[var(--label)] text-[var(--surface)]" : "bg-[var(--surface-2)] text-[var(--label)]"
          }`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function RequestListView({ rows, filter, now }: { rows: DsrListRow[]; filter: Filter; now: Date }) {
  const list = shapeList(rows, filter, now);
  const c = counts(rows, now);
  return (
    <div className="grid min-w-0 gap-4">
      <Segments active="permintaan" />
      <p className="m-0 text-[var(--label-2)]" data-counts="">
        {`${c.open} terbuka · ${c.overdue} lewat tenggat · ${c.unverified} belum diverifikasi`}
      </p>
      <nav aria-label="Saring permintaan" className="flex flex-wrap gap-x-4 gap-y-1">
        {(["open", "closed", "all"] as const).map((s) => (
          <Link
            key={s}
            prefetch={false}
            href={q(filter, { status: s })}
            aria-current={filter.state === s ? "true" : undefined}
            className="inline-flex min-h-[var(--target)] items-center"
          >
            {s === "open" ? "Terbuka" : s === "closed" ? "Ditutup" : "Semua"}
          </Link>
        ))}
        <span aria-hidden="true" className="self-center text-[var(--label-3)]">|</span>
        <Link prefetch={false} href={q(filter, { hak: null })} aria-current={!filter.right ? "true" : undefined} className="inline-flex min-h-[var(--target)] items-center">
          Semua hak
        </Link>
        {RIGHTS.map((r) => (
          <Link key={r} prefetch={false} href={q(filter, { hak: r })} aria-current={filter.right === r ? "true" : undefined} className="inline-flex min-h-[var(--target)] items-center">
            {RIGHT_LABEL[r]}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <EmptyState message="Belum ada permintaan data pasien." />
      ) : list.length === 0 ? (
        <div role="status" className="grid justify-items-start gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
          <p className="m-0 text-[var(--label-2)]">Tidak ada permintaan untuk filter ini.</p>
          <Link prefetch={false} href="/privasi/permintaan?status=all" className="inline-flex min-h-[var(--target)] items-center font-semibold text-primary">
            Hapus Filter
          </Link>
        </div>
      ) : (
        <RowList label="Permintaan data pasien">
          {list.map((r) => (
            <li key={r.id} data-request={r.id} data-urgency={r.urgency} className="relative border-b border-[var(--separator)] last:border-b-0">
              <Link
                prefetch={false}
                href={`/privasi/permintaan/${r.id}`}
                className="grid min-h-[var(--target)] gap-1 px-4 py-[11px] text-[var(--label)] no-underline sm:flex sm:items-center sm:justify-between"
              >
                <span className="grid gap-1">
                  <span className="font-semibold">{r.right}</span>
                  <span className="text-[0.88rem] text-[var(--label-2)]">
                    {`${r.who} · tenggat ${at(r.due)} WIB${r.assignee ? ` · ${r.assignee}` : ""}`}
                  </span>
                  {r.state !== "closed" && <span className="text-[0.88rem]">{`Batas 3×24 jam: ${timeLeft(r.left)}`}</span>}
                </span>
                <span className="flex flex-wrap gap-2">
                  <StatusBadge tone={STATE[r.state].tone}>{STATE[r.state].label}</StatusBadge>
                  {r.state !== "closed" && <StatusBadge tone={URGENCY[r.urgency].tone}>{URGENCY[r.urgency].label}</StatusBadge>}
                  {r.state !== "closed" && !r.verified && <StatusBadge tone="blocked">Belum diverifikasi</StatusBadge>}
                  {r.assignee && !r.assigneeActive && <StatusBadge tone="warning">Petugas tidak aktif — perlu ditugaskan ulang</StatusBadge>}
                  {r.outcome && <StatusBadge tone="neutral">{r.outcome}</StatusBadge>}
                  {r.late && <StatusBadge tone="danger">Ditutup lewat tenggat</StatusBadge>}
                </span>
              </Link>
            </li>
          ))}
        </RowList>
      )}
    </div>
  );
}

export function RequestDetailView({ detail }: { detail: DsrDetail }) {
  const u = urgency(detail, detail.now);
  const blocked = !canProgress(detail).ok && detail.state !== "closed";
  const plan = detail.right === "erasure" ? erasurePlan(detail.hasClinicalRecords) : null;
  const invalidClusterLinks = detail.links.filter((l) => !l.clusterValid);

  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={STATE[detail.state].tone}>{STATE[detail.state].label}</StatusBadge>
        {detail.state !== "closed" && <StatusBadge tone={URGENCY[u].tone}>{URGENCY[u].label}</StatusBadge>}
        {detail.assignedTo && !detail.assigneeActive && (
          <StatusBadge tone="warning">Petugas tidak aktif — perlu ditugaskan ulang</StatusBadge>
        )}
      </div>

      <dl className="m-0 grid gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4 sm:grid-cols-2">
        <div>
          <dt className="font-semibold">Hak</dt>
          <dd className="m-0">
            {`${RIGHT_LABEL[detail.right]} (${LEGAL_BASIS[detail.right]})`}
            {detail.correctionScope ? ` · ${CORRECTION_SCOPE_LABEL[detail.correctionScope]}` : ""}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Pemohon &amp; Subjek</dt>
          <dd className="m-0">{`${REQUESTER[detail.requester]} · ${detail.mrn ?? "Subjek belum diikat"}`}</dd>
        </div>
        <div>
          <dt className="font-semibold">Saluran &amp; Diterima</dt>
          <dd className="m-0">{`${CHANNEL_LABEL[detail.channel]} · ${at(detail.receivedAt)} WIB`}</dd>
        </div>
        <div>
          <dt className="font-semibold">Tenggat 3×24 jam</dt>
          <dd className="m-0">
            {`${at(deadlineAt(detail.receivedAt))} WIB`}
            {detail.state !== "closed" && ` · Batas 3×24 jam: ${timeLeft(minutesLeft(detail.receivedAt, detail.now))}`}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Verifikasi identitas</dt>
          <dd className="m-0">
            {detail.identityVerifiedAt && detail.identityMethod
              ? `${IDENTITY_METHOD_LABEL[detail.identityMethod]} · ${at(detail.identityVerifiedAt)} WIB`
              : "Belum diverifikasi"}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Petugas</dt>
          <dd className="m-0">{detail.assigneeName ?? "Belum ditugaskan"}</dd>
        </div>
        {detail.outcome && (
          <div className="sm:col-span-2">
            <dt className="font-semibold">Hasil &amp; Dasar</dt>
            <dd className="m-0">
              {OUTCOME[detail.outcome]}
              {detail.outcomeBasisCode ? ` — ${OUTCOME_BASIS_LABEL[detail.outcomeBasisCode]}` : ""}
              {detail.outcomeNote ? ` (${detail.outcomeNote})` : ""}
            </dd>
          </div>
        )}
        {detail.deliveryConfirmedAt && detail.deliveryChannel && (
          <div className="sm:col-span-2">
            <dt className="font-semibold">Konfirmasi serah terima</dt>
            <dd className="m-0">
              {`${CHANNEL_LABEL[detail.deliveryChannel]} · ${at(detail.deliveryConfirmedAt)} WIB · Ref: ${detail.deliveryRef ?? "-"}`}
            </dd>
          </div>
        )}
        {detail.withdrawalSource && detail.withdrawalAttestation && (
          <div className="sm:col-span-2">
            <dt className="font-semibold">Konfirmasi pembatalan pemohon</dt>
            <dd className="m-0">{`${CHANNEL_LABEL[detail.withdrawalSource]} · ${detail.withdrawalAttestation}`}</dd>
          </div>
        )}
      </dl>

      {blocked && (
        <BlockedState
          reason={REFUSAL_COPY.identity_unverified}
          unblock="Verifikasi identitas pemohon (KTP, dokumen perwalian, atau surat kuasa) sebelum memproses"
        />
      )}

      {invalidClusterLinks.length > 0 && (
        <BlockedState
          reason={REFUSAL_COPY.cluster_changed}
          unblock="Periksa pemisahan gabungan pasien dan tautkan bukti yang masih berada pada klaster pasien saat ini"
        />
      )}

      {detail.right === "correction" && detail.correctionScope === "demographic" && detail.state !== "closed" && (
        <BlockedState
          reason={REFUSAL_COPY.demographic_unavailable}
          unblock="Tutup sebagai sebagian dipenuhi atau ditolak sementara dengan dasar terstruktur hingga alur perbaikan demografi tersedia"
        />
      )}

      {detail.right === "restriction" && detail.restrictionStatuses.length > 0 && (
        <section aria-labelledby="status-pembatasan" className="grid gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
          <h2 id="status-pembatasan" className="m-0 text-[1.05rem] font-semibold">Status persetujuan tujuan yang dibatasi</h2>
          <ul className="m-0 grid list-none gap-2 p-0">
            {detail.restrictionStatuses.map((s) => (
              <li key={s.purpose} className="flex flex-wrap items-center justify-between gap-2">
                <span>{RESTRICTION_PURPOSE_LABEL[s.purpose]}</span>
                <StatusBadge tone={s.status === "still_active" ? "danger" : "success"}>
                  {s.status === "still_active" ? "Masih aktif" : s.status === "applied" ? "Sudah ditarik (tertaut)" : "Sudah tidak aktif"}
                </StatusBadge>
              </li>
            ))}
          </ul>
        </section>
      )}

      {plan && detail.state !== "closed" && (
        <section aria-labelledby="hapus-rencana" className="grid gap-1 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
          <h2 id="hapus-rencana" className="m-0 text-[1.05rem] font-semibold">Ketentuan penghapusan data</h2>
          <p className="m-0">{plan.basis}</p>
        </section>
      )}

      <section aria-labelledby="bukti-tertaut" className="grid gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
        <h2 id="bukti-tertaut" className="m-0 text-[1.05rem] font-semibold">{`Bukti pemenuhan tertaut (${detail.links.length})`}</h2>
        {detail.links.length === 0 ? (
          <p className="m-0 text-[var(--label-2)]">Belum ada bukti pemenuhan yang ditautkan.</p>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {detail.links.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--separator)] pb-2 last:border-b-0 last:pb-0">
                <span>
                  <strong>{LINK_KIND_LABEL[l.kind]}</strong>
                  {` · ${l.linkId.slice(0, 8)}`}
                  {l.purpose ? ` (${l.purpose})` : ""}
                  {l.handoffRef ? ` · Ref: ${l.handoffRef}` : ""}
                </span>
                <StatusBadge tone={l.clusterValid ? "success" : "danger"}>
                  {l.clusterValid ? "Klaster sah" : "Klaster berubah"}
                </StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
