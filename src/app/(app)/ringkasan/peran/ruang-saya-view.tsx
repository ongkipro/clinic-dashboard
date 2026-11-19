// Ruang Saya (UX-60, 19 §2.1; T-107 UI slice): the nurse/therapist home — jadwal ruang hari ini, pasien berikutnya
// datang, komisi saya bulan ini. Presentational and server-compatible (no hooks, no client state): every widget
// renders exactly what the page passes in (ruang-saya/page.tsx wires the readers); this file reads nothing itself.
// No clinical content (PR-33): a slot carries identity, time, the catalog service name and a status word only — no
// blocker, step, note, dose or finding. "Belum tersedia" (no evidence) is never shown as zero.
import Link from "next/link";
import { KpiRow, PageTitle, Row, RowList } from "../../../../components/templates/templates";
import { BlockedState, LoadingList, PermissionState } from "../../../../components/ui/states";
import { StatusBadge, type StatusTone } from "../../../../components/ui/status-badge";

// One widget's evidence. "unavailable" = the source cannot answer yet (reader missing, period not computable); it
// is a different thing from an answer of zero / none, which is { kind: "ok" } with an empty value.
export type Widget<T> =
  | { kind: "ok"; data: T }
  | { kind: "loading" }
  | { kind: "unavailable"; reason: string; unblock: string } // rendered as "{reason}. {unblock}."; state only what is true, promise no workflow
  | { kind: "error"; message: string; retryHref: string }
  | { kind: "permission"; object: string };

export type RoomSlot = {
  id: string;
  href: string; // drill-down to the source page, chosen by the caller (e.g. the visit in Ruang, or the day in Jadwal)
  at: string; // ISO instant: appointment start or check-in
  atLabel?: string; // e.g. "datang" before a check-in time
  patientName: string;
  patientMrn: string;
  serviceName: string; // catalog name(s), as on the Jadwal calendar and in Ruang
  status?: { tone: StatusTone; label: string };
};

export type RoomGroup = { key: string; roomName: string; slots: RoomSlot[] }; // in display order

export type OwnCommission = {
  month: string; // YYYY-MM
  amount: number; // integer rupiah
  basis: string; // what the figure counts, from the KPI dictionary (K17), written by the caller
  href?: string; // only when the acting role may open the source records
};

export type RuangSayaViewProps = {
  branchName: string;
  today: string; // YYYY-MM-DD, branch-local
  timeZone: string; // the branch's IANA zone
  schedule: Widget<RoomGroup[]>; // today's room visits grouped by room (UX-9)
  nextPatient: Widget<RoomSlot | null>; // null = nobody else expected today
  commission: Widget<OwnCommission>;
};

const muted = "m-0 rounded-[var(--radius-group)] bg-[var(--surface)] p-4 text-[var(--label-2)]";

function NotOk({ w }: { w: Exclude<Widget<unknown>, { kind: "ok" }> }) {
  switch (w.kind) {
    case "loading":
      return <LoadingList rows={2} />;
    case "unavailable":
      return <BlockedState reason={w.reason} unblock={w.unblock} />;
    case "error":
      return (
        <div role="alert" className="grid gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
          <p className="m-0 text-[var(--danger)]">{w.message}</p>
          <Link href={w.retryHref} className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]">
            Coba Lagi
          </Link>
        </div>
      );
    case "permission":
      return <PermissionState object={w.object} />;
  }
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid min-w-0 gap-2">
      <h2 id={id} className="m-0 text-[1.18rem] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function RuangSayaView(p: RuangSayaViewProps) {
  const time = new Intl.DateTimeFormat("id-ID", { timeStyle: "short", timeZone: p.timeZone });
  const day = new Intl.DateTimeFormat("id-ID", { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${p.today}T12:00:00Z`));
  const slot = (s: RoomSlot) => (
    <Row
      key={s.id}
      href={s.href}
      title={s.patientName}
      subtitle={`${s.patientMrn} · ${s.atLabel ? `${s.atLabel} ` : ""}${time.format(new Date(s.at))} · ${s.serviceName}`}
    >
      {/* the status sits under the link (not beside it) so the name keeps the full width at 200 % text on a phone */}
      {s.status && <StatusBadge tone={s.status.tone}>{s.status.label}</StatusBadge>}
    </Row>
  );
  const c = p.commission;
  // Integer rupiah only (11); anything else is not evidence and must not print as a number.
  const badAmount = c.kind === "ok" && !Number.isSafeInteger(c.data.amount);

  return (
    <div className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
      <div className="grid min-w-0 gap-1">
        <PageTitle title="Ruang Saya" />
        <p className="m-0 text-[var(--label-2)] [overflow-wrap:anywhere]">{`${p.branchName} · ${day}`}</p>
      </div>

      <Section id="ruang-saya-jadwal" title="Jadwal ruang hari ini">
        {p.schedule.kind !== "ok" ? (
          <NotOk w={p.schedule} />
        ) : p.schedule.data.length === 0 ? (
          <p role="status" className={muted}>Belum ada jadwal ruang hari ini.</p>
        ) : (
          <div className="grid min-w-0 gap-4">
            {p.schedule.data.map((g) => (
              <section key={g.key} aria-label={g.roomName} className="grid min-w-0 gap-2">
                <h3 className="m-0 text-[1rem] font-semibold">{g.roomName}</h3>
                <RowList label={g.roomName}>{g.slots.map(slot)}</RowList>
              </section>
            ))}
          </div>
        )}
      </Section>

      <Section id="ruang-saya-berikutnya" title="Pasien berikutnya datang">
        {p.nextPatient.kind !== "ok" ? (
          <NotOk w={p.nextPatient} />
        ) : p.nextPatient.data === null ? (
          <p role="status" className={muted}>Tidak ada pasien berikutnya hari ini.</p>
        ) : (
          <RowList label="Pasien berikutnya datang">{slot(p.nextPatient.data)}</RowList>
        )}
      </Section>

      <Section id="ruang-saya-komisi" title="Komisi saya bulan ini">
        {c.kind !== "ok" ? (
          <NotOk w={c} />
        ) : badAmount ? (
          <p role="status" className={muted}>Nilai komisi tidak dapat ditampilkan.</p>
        ) : (
          <div className="grid min-w-0 gap-2">
            <KpiRow
              items={[{
                label: new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${c.data.month}-01T00:00:00Z`)),
                value: new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(c.data.amount).replace(/\s/g, ""),
                basis: c.data.basis,
              }]}
            />
            {c.data.href && (
              <Link href={c.data.href} className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]">
                Lihat rincian komisi
              </Link>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
