// Kasir ▸ Siap Ditagih (UX-12, 19:111): open visits with a confirmed selection and no issued tagihan, then the
// tagihan issued in the last two days. Row → Buat Tagihan (visit) or the tagihan.
import type { Metadata } from "next";
import { Suspense } from "react";
import { ListPage, Row, RowList } from "../../../components/templates/templates";
import { LoadingList } from "../../../components/ui/states";
import { StatusBadge } from "../../../components/ui/status-badge";
import { loadQueue } from "./data";
import { BranchChips, Main, NotOkState, wide } from "./frame";
import { patientLabel, payState, rp, SEGMENTS, time } from "./labels";

export const metadata: Metadata = { title: "Kasir — Clinic Dashboard" };

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const d = await loadQueue(typeof sp.cabang === "string" ? sp.cabang : undefined);
  if (d.kind !== "ok") return <NotOkState d={d} title="Kasir" />;
  const q = d.q;
  const keep = wide(d.role) ? `?cabang=${q.branch.id}` : "";
  const empty = q.ready.length === 0 && q.recent.length === 0;
  return (
    <>
      <ListPage as="section" title={`Kasir · ${q.branch.name}`} filters={SEGMENTS("kasir", d.role, keep)}
        state={empty ? { kind: "empty", message: "Belum ada pasien yang siap ditagih." } : { kind: "rows" }}>
        <div className="grid min-w-0 gap-6">
          {q.ready.length > 0 && (
            <section aria-label="Siap ditagih" className="grid min-w-0 gap-2">
              <h2 className="m-0 text-[1.25rem] font-semibold">Siap ditagih</h2>
              <RowList label="Siap ditagih">
                {q.ready.map((r) => (
                  <Row key={r.visit_id} href={r.draft_id ? `/kasir/${r.draft_id}` : `/kasir/kunjungan/${r.visit_id}`} title={patientLabel(r.patient)}
                    subtitle={`Datang ${time(r.checked_in_at)}`} />
                ))}
              </RowList>
            </section>
          )}
          {q.recent.length > 0 && (
            <section aria-label="Selesai hari ini" className="grid min-w-0 gap-2">
              <h2 className="m-0 text-[1.25rem] font-semibold">Baru selesai</h2>
              <RowList label="Baru selesai">
                {q.recent.map((r) => {
                  const st = payState(r.total, r.outstanding, r.state);
                  return (
                    <Row key={r.id} href={`/kasir/${r.id}`} title={`${r.number ?? "Draf"} · ${rp(r.total)}`} subtitle={patientLabel(r.patient)}>
                      <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                    </Row>
                  );
                })}
              </RowList>
            </section>
          )}
        </div>
      </ListPage>
      {wide(d.role) && <BranchChips path="/kasir" branches={d.branches} active={q.branch.id} />}
    </>
  );
}

export default function KasirPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Main><Suspense fallback={<LoadingList rows={4} />}><Body searchParams={searchParams} /></Suspense></Main>;
}
