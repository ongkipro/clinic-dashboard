// Kasir ▸ Tagihan Terbuka (19:113): issued tagihan still owing (belum dibayar, sebagian), oldest first.
import type { Metadata } from "next";
import { Suspense } from "react";
import { ListPage, Row, RowList } from "../../../../components/templates/templates";
import { LoadingList } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { loadQueue } from "../data";
import { BranchChips, Main, NotOkState, wide } from "../frame";
import { patientLabel, payState, rp, SEGMENTS, when } from "../labels";

export const metadata: Metadata = { title: "Tagihan Terbuka — Kasir — Clinic Dashboard" };

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const d = await loadQueue(typeof sp.cabang === "string" ? sp.cabang : undefined);
  if (d.kind !== "ok") return <NotOkState d={d} title="Tagihan Terbuka" />;
  const q = d.q;
  const keep = wide(d.role) ? `?cabang=${q.branch.id}` : "";
  return (
    <>
      <ListPage as="section" title={`Tagihan Terbuka · ${q.branch.name}`} filters={SEGMENTS("terbuka", d.role, keep)}
        state={q.open.length === 0 ? { kind: "empty", message: "Tidak ada tagihan yang belum lunas." } : { kind: "rows" }}>
        <RowList label="Tagihan terbuka">
          {q.open.map((r) => {
            const st = payState(r.total, r.outstanding, r.state);
            return (
              <Row key={r.id} href={`/kasir/${r.id}`} title={`${r.number} · sisa ${rp(r.outstanding)}`}
                subtitle={`${patientLabel(r.patient)} · ${r.issued_at ? when(r.issued_at) : ""}${r.void_pending ? " · void diajukan" : ""}`}>
                <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
              </Row>
            );
          })}
        </RowList>
      </ListPage>
      {wide(d.role) && <BranchChips path="/kasir/terbuka" branches={d.branches} active={q.branch.id} />}
    </>
  );
}

export default function TerbukaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Main><Suspense fallback={<LoadingList rows={4} />}><Body searchParams={searchParams} /></Suspense></Main>;
}
