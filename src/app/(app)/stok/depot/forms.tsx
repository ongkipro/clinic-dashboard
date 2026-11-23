"use client";
// Gudang & Depot forms (HYG-NAV-2): Tambah Depot and Pindah Antar Depot (one batch line). Each posts its rendered context and a per-mount
// idempotency key and remounts after each answer; the database decides.
import { useActionState, useId, useState } from "react";
import { ContextFields } from "../../../../components/context-fields";
import { Button } from "../../../../components/ui/button";
import type { RenderedContext } from "../../../../modules/org/context/context";
import { createDepotAction, type DepotState, moveAction } from "./actions";
import { KIND_LABEL } from "./model";

const input = "min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
function Key() {
  const [k] = useState(() => crypto.randomUUID());
  return <input type="hidden" name="key" value={k} />;
}
function Notice({ s }: { s: DepotState }) {
  return (
    <>
      {s.error && <p role="alert" className="m-0 text-[var(--danger)] [overflow-wrap:anywhere]">{s.error}</p>}
      {s.ok && <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--success-soft)] px-3 py-2 text-[var(--success)]">{s.ok}</p>}
    </>
  );
}

export function NewDepot({ ctx, branch }: { ctx: RenderedContext; branch: string }) {
  const [s, act, pending] = useActionState<DepotState, FormData>(createDepotAction, {});
  const n = useId(), k = useId();
  return (
    <form action={act} key={`d${s.n ?? 0}`} aria-label="Tambah depot" className="@container rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
      {/* three columns only when the form holds 44 em of its own text; enlarged text or a narrow pane stacks (WCAG 1.4.10) */}
      <div className="grid min-w-0 gap-2 @min-[44em]:grid-cols-[minmax(0,1fr)_12em_auto] @min-[44em]:items-end">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="branch" value={branch} />
      <label htmlFor={n} className="grid gap-1"><span>Nama depot</span><input id={n} name="name" required minLength={2} maxLength={60} className={input} /></label>
      <label htmlFor={k} className="grid gap-1"><span>Jenis</span>
        <select id={k} name="kind" className={input} defaultValue="gudang">{Object.entries(KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <Button type="submit" variant="secondary" aria-disabled={pending}>Tambah Depot</Button>
      <div className="@min-[44em]:col-span-3"><Notice s={s} /></div>
      </div>
    </form>
  );
}

export type BatchOption = { depotId: string; batchId: string; label: string };
export function MoveForm({ ctx, depots, batches }: { ctx: RenderedContext; depots: { id: string; name: string }[]; batches: BatchOption[] }) {
  const [s, act, pending] = useActionState<DepotState, FormData>(moveAction, {});
  const [from, setFrom] = useState(depots[0]?.id ?? "");
  const ids = { f: useId(), t: useId(), b: useId(), q: useId() };
  const mine = batches.filter((b) => b.depotId === from);
  return (
    <form action={act} key={`m${s.n ?? 0}`} aria-label="Pindah antar depot" className="@container rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
      <div className="grid min-w-0 gap-2 @min-[36em]:grid-cols-2">
      <ContextFields ctx={ctx} /><Key />
      <label htmlFor={ids.f} className="grid gap-1"><span>Dari depot</span>
        <select id={ids.f} name="from" value={from} onChange={(e) => setFrom(e.target.value)} className={input}>{depots.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      <label htmlFor={ids.t} className="grid gap-1"><span>Ke depot</span>
        <select id={ids.t} name="to" className={input} defaultValue={depots.find((d) => d.id !== from)?.id}>{depots.filter((d) => d.id !== from).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      <label htmlFor={ids.b} className="grid gap-1"><span>Batch</span>
        <select id={ids.b} name="batch" className={input} required>{mine.length === 0 ? <option value="">Tidak ada stok layak di depot ini</option> : mine.map((b) => <option key={b.batchId} value={b.batchId}>{b.label}</option>)}</select></label>
      <label htmlFor={ids.q} className="grid gap-1"><span>Jumlah</span><input id={ids.q} name="quantity" inputMode="decimal" required pattern="\d{1,9}(\.\d{1,3})?" className={input} /></label>
      <div className="grid gap-2 @min-[36em]:col-span-2"><Notice s={s} /><Button type="submit" aria-disabled={pending || mine.length === 0} className="justify-self-start">Pindahkan</Button></div>
      </div>
    </form>
  );
}
