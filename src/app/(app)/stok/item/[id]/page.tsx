// Stok ▸ Item detail (UX-11): batches in FEFO order with fitness (CLIN-019), the open vial and its use-by, the next
// batch FEFO takes, the level, the recent card, and the sheets Terima Stok (prominent), Atur Min/Target, batch
// Karantina / Tarik / Lepas and Buka Vial for the roles that may.
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DetailPage } from "../../../../../components/templates/templates";
import { LoadingList } from "../../../../../components/ui/states";
import { StatusBadge } from "../../../../../components/ui/status-badge";
import { loadItem } from "../../data";
import { NotOkState } from "../../frame";
import { BatchActions, ItemForm, LevelForm, ReceiveForm } from "../../forms";
import { BATCH_STATE, date, KIND_LABEL, MOVE_LABEL, qty, STORAGE_LABEL, UNFIT_LABEL, when } from "../../labels";

export const metadata: Metadata = { title: "Item — Stok — Clinic Dashboard" };

async function Body({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const q = await searchParams;
  const d = await loadItem(id, typeof q.cabang === "string" ? q.cabang : undefined);
  if (d.kind !== "ok") return <NotOkState d={d} title="Item" />;
  const i = d.item;
  const wide = !["manager", "pharmacist"].includes(d.stock.role);
  const back = `${wide ? `?cabang=${d.branch.id}` : ""}`;
  return (
    <DetailPage as="section" title={i.name} subtitle={`${KIND_LABEL[i.kind]} · ${i.code} · ${d.branch.name}`}
      status={i.active ? undefined : { tone: "locked", label: "Nonaktif" }}
      related={[{ label: "Kartu Stok", href: `/stok/kartu?item=${i.id}${wide ? `&cabang=${d.branch.id}` : ""}` }, { label: "Semua item", href: `/stok/item${back}` }]}
      sections={[
        { id: "batch", label: "Batch (FEFO)", content: (
          <div className="grid min-w-0 gap-3">
            {d.stock.can_receive && <ReceiveForm ctx={d.ctx} item={i.id} branch={d.branch.id} unit={i.unit} prominent />}
            {i.batches.length === 0 ? <p className="m-0 text-[var(--label-2)]">Belum ada batch di cabang ini.</p> : (
              <ul aria-label="Batch" className="m-0 grid min-w-0 list-none gap-2 p-0">
                {i.batches.map((b) => (
                  <li key={b.id} className="grid min-w-0 gap-2 rounded-[var(--radius-field)] bg-[var(--surface-2)] p-3">
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="font-semibold [overflow-wrap:anywhere]">{`Batch ${b.batch_no}`}</span>
                      {b.unfit ? <StatusBadge tone="danger">{UNFIT_LABEL[b.unfit]}</StatusBadge> : <StatusBadge tone={BATCH_STATE[b.state].tone}>{BATCH_STATE[b.state].label}</StatusBadge>}
                      {b.id === i.next_batch_id && <StatusBadge tone="success">Dipakai berikutnya</StatusBadge>}
                    </span>
                    <span className="text-[0.94rem] tabular-nums">{`ED ${date(b.expiry)} · ${qty(b.quantity, i.unit)} · layak ${qty(b.fit_quantity, i.unit)}`}</span>
                    {b.hold_reason && <span className="text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]">{b.hold_reason}</span>}
                    {b.vial && (
                      <span className="text-[0.88rem] [overflow-wrap:anywhere]">
                        {`Vial terbuka: sisa ${qty(b.vial.remaining, i.unit)} · batas pakai ${when(b.vial.use_by)}`}
                        {b.vial.lapsed && <> · <StatusBadge tone="danger">Lewat batas pakai</StatusBadge></>}
                      </span>
                    )}
                    <BatchActions ctx={d.ctx} batch={b.id} state={b.state} vialItem={i.vial_size !== null} canHold={d.stock.can_hold && b.quantity > 0}
                      canOpen={d.stock.can_open_vial} vialOpenable={b.quantity > 0 && !b.unfit && (!b.vial || b.vial.lapsed)} label={b.batch_no} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) },
        { id: "batas", label: "Batas Stok", content: (
          <div className="grid min-w-0 gap-3">
            <p className="m-0 tabular-nums">{i.level ? `Minimum ${qty(i.level.min_qty, i.unit)} · Target ${qty(i.level.target_qty, i.unit)}` : "Belum diatur untuk cabang ini."}</p>
            {d.stock.can_set_levels && <LevelForm ctx={d.ctx} item={i.id} branch={d.branch.id} min={i.level?.min_qty ?? null} target={i.level?.target_qty ?? null} unit={i.unit} />}
          </div>
        ) },
        { id: "data", label: "Data Item", content: d.stock.can_edit_items ? (
          <ItemForm ctx={d.ctx} value={{ id: i.id, unit: i.unit, vial_size: i.vial_size, opened_use_hours: i.opened_use_hours, storage: i.storage, registration_no: i.registration_no, high_value: i.high_value, active: i.active }} />
        ) : (
          <dl className="m-0 grid min-w-0 gap-1">
            <dt className="text-[var(--label-2)]">Satuan</dt><dd className="m-0">{i.unit}</dd>
            <dt className="text-[var(--label-2)]">Suhu simpan</dt><dd className="m-0">{STORAGE_LABEL[i.storage]}</dd>
            {i.vial_size !== null && <><dt className="text-[var(--label-2)]">Vial</dt><dd className="m-0">{`${qty(i.vial_size, i.unit)} · ${i.opened_use_hours} jam setelah dibuka`}</dd></>}
            {i.registration_no && <><dt className="text-[var(--label-2)]">Izin edar</dt><dd className="m-0">{i.registration_no}</dd></>}
          </dl>
        ) },
      ]}
      timeline={d.card.map((m) => ({ at: m.created_at, label: `${MOVE_LABEL[m.kind]} ${m.quantity > 0 ? "+" : ""}${qty(m.quantity, i.unit)}`, detail: `Batch ${m.batch_no} · saldo ${qty(m.balance_after)}` }))}
    >
      <Link href={`/stok/item${back}`} className="inline-flex min-h-[44px] items-center text-[var(--tint)]">‹ Item</Link>
    </DetailPage>
  );
}

export default function ItemDetailPage(props: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}><Body {...props} /></Suspense>
    </main>
  );
}
