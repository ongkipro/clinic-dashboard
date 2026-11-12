// Kasir ▸ Buat Tagihan for a visit (UX-12): the confirmed selection as lines (editable quantities, removable), the
// branch prices now, then Terbitkan Tagihan (prices frozen at issue).
import type { Metadata } from "next";
import { Suspense } from "react";
import { PageTitle } from "../../../../../components/templates/templates";
import { BlockedState, LoadingList } from "../../../../../components/ui/states";
import { loadVisit } from "../../data";
import { IssueForm } from "../../forms";
import { Main, muted, NotOkState, wide } from "../../frame";
import { PAYERS, patientLabel } from "../../labels";

export const metadata: Metadata = { title: "Buat Tagihan — Kasir — Clinic Dashboard" };

async function Body({ params }: { params: Promise<{ visitId: string }> }) {
  const { visitId } = await params;
  const d = await loadVisit(visitId);
  if (d.kind !== "ok") return <NotOkState d={d} title="Buat Tagihan" />;
  const v = d.v;
  return (
    <>
      <PageTitle title="Buat Tagihan" />
      <p className={muted}>{patientLabel(v.patient)}</p>
      {v.closed ? <BlockedState reason="Kunjungan sudah ditutup" unblock="Buka kunjungan baru dari Hari Ini" />
        : !PAYERS.has(d.role) ? <BlockedState reason="Peran ini hanya dapat melihat" unblock="Kasir, manajer, finance, atau owner dapat menerbitkan tagihan" />
        : (
          <IssueForm ctx={d.ctx} branch={wide(d.role) ? v.branch_id : null} visit={v.visit_id} patient={v.patient?.id ?? null} label="Buat tagihan kunjungan"
            initial={v.lines.map((l) => ({ item_id: l.item_id, name: l.name, price: l.price, quantity: Math.max(1, l.quantity) }))} />
        )}
    </>
  );
}

export default function BuatTagihanPage({ params }: { params: Promise<{ visitId: string }> }) {
  return <Main><Suspense fallback={<LoadingList rows={3} />}><Body params={params} /></Suspense></Main>;
}
