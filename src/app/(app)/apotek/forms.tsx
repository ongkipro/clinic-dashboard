"use client";
// Siapkan & Serahkan forms (UX-10; T-065). Every write form posts its rendered context (HYG-009 B2-1) and a fresh
// idempotency key (remounted after every answer: n). A form that changes its row's state stays mounted with its
// result; the row moves to the other segment on the next load.
import { useActionState, useId, useState } from "react";
import { ContextFields } from "../../../components/context-fields";
import { Button } from "../../../components/ui/button";
import type { RenderedContext } from "../../../modules/org/context/context";
import { CHECKS, type ItemRef } from "../../../modules/pharmacy/pharmacy";
import { cancelAction, handOverAction, labelAction, mapAction, type PharmacyFormState, prepareAction, prepareMaterialsAction } from "./actions";
import { CHECK_LABEL, DEPOT_KIND } from "./labels";

const input = "min-h-[52px] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const hint = "m-0 text-[0.88rem] text-[var(--label-2)]";

function Notice({ s }: { s: PharmacyFormState }) {
  return (
    <>
      {s.error && <p role="alert" className="m-0 text-[var(--danger)] [overflow-wrap:anywhere]">{s.error}</p>}
      {s.ok && <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--success-soft)] px-3 py-2 text-[var(--success)]">{s.ok}</p>}
    </>
  );
}
function Key() {
  const [k] = useState(() => crypto.randomUUID());
  return <input type="hidden" name="key" value={k} />;
}
type Depot = { id: string; name: string; kind: string };

// Petakan (one unmapped recipe row): the stock item and its quantity per treatment.
export function MapForm({ ctx, version, row, material, items }: { ctx: RenderedContext; version: string; row: number; material: string; items: ItemRef[] }) {
  const [s, act, pending] = useActionState<PharmacyFormState, FormData>(mapAction, {});
  const [open, setOpen] = useState(false);
  const id = useId();
  if (s.ok) return <Notice s={s} />;
  if (!open) return <Button type="button" variant="plain" onClick={() => setOpen(true)}>{`Petakan ${material}…`}</Button>;
  return (
    <form action={act} key={`m${s.n ?? 0}`} aria-label={`Petakan ${material}`} className="grid min-w-0 gap-2">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="version" value={version} /><input type="hidden" name="row" value={row} />
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 min-[700px]:grid-cols-[minmax(0,1fr)_8rem]">
        <div className="grid min-w-0 gap-1">
          <label htmlFor={`${id}-i`}>Item stok</label>
          <select id={`${id}-i`} name="item" required defaultValue="" className={input}>
            <option value="" disabled>Pilih item</option>
            {items.map((x) => <option key={x.stock_item_id} value={x.stock_item_id}>{`${x.name} (${x.unit})`}</option>)}
          </select>
        </div>
        <div className="grid min-w-0 gap-1">
          <label htmlFor={`${id}-q`}>Per tindakan</label>
          <input id={`${id}-q`} name="qty" inputMode="decimal" required className={input} />
        </div>
      </div>
      <Notice s={s} />
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button type="submit" variant="secondary" aria-disabled={pending}>Simpan Peta</Button>
        <Button type="button" variant="plain" onClick={() => setOpen(false)}>Batal</Button>
      </div>
    </form>
  );
}

// Siapkan Bahan (treatment): the request from the mapped recipe, issued from the chosen depot to the room depot.
export function PrepareMaterialsForm({ ctx, item, name, depots }: { ctx: RenderedContext; item: string; name: string; depots: Depot[] }) {
  const [s, act, pending] = useActionState<PharmacyFormState, FormData>(prepareMaterialsAction, {});
  const id = useId();
  // treatment materials are kept in the gudang: it comes first (the apotek holds products)
  const sources = depots.filter((d) => d.kind !== "ruang").sort((a, b) => Number(b.kind === "gudang") - Number(a.kind === "gudang"));
  if (s.ok) return <Notice s={s} />;
  return (
    <form action={act} key={`b${s.n ?? 0}`} aria-label={`Siapkan bahan ${name}`} className="grid min-w-0 gap-2">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="item" value={item} />
      <div className="grid min-w-0 gap-1">
        <label htmlFor={`${id}-f`}>Keluarkan dari</label>
        <select id={`${id}-f`} name="from" required defaultValue={sources[0]?.id ?? ""} className={input}>
          {sources.map((d) => <option key={d.id} value={d.id}>{`${d.name} (${DEPOT_KIND[d.kind] ?? d.kind})`}</option>)}
        </select>
      </div>
      <Notice s={s} />
      <Button type="submit" variant="secondary" aria-disabled={pending} className="justify-self-start">{pending ? "Menyiapkan…" : "Siapkan Bahan"}</Button>
    </form>
  );
}

// Siapkan (product): the depot to dispense from (default from the database); no stock moves.
export function PrepareForm({ ctx, dispensing, name, depots, depot }: { ctx: RenderedContext; dispensing: string; name: string; depots: Depot[]; depot: string | null }) {
  const [s, act, pending] = useActionState<PharmacyFormState, FormData>(prepareAction, {});
  const id = useId();
  const sources = depots.filter((d) => d.kind === "apotek" || d.kind === "gudang");
  if (s.ok) return <Notice s={s} />;
  return (
    <form action={act} key={`p${s.n ?? 0}`} aria-label={`Siapkan ${name}`} className="grid min-w-0 gap-2">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="dispensing" value={dispensing} />
      <div className="grid min-w-0 gap-1">
        <label htmlFor={`${id}-d`}>Ambil dari</label>
        <select id={`${id}-d`} name="depot" defaultValue={depot ?? ""} className={input}>
          {sources.map((d) => <option key={d.id} value={d.id}>{`${d.name} (${DEPOT_KIND[d.kind] ?? d.kind})`}</option>)}
        </select>
      </div>
      <Notice s={s} />
      <Button type="submit" variant="secondary" aria-disabled={pending} className="justify-self-start">{pending ? "Menyiapkan…" : "Siapkan"}</Button>
    </form>
  );
}

// Cetak Etiket: records the print, then the browser prints this page (the label view).
export function LabelForm({ ctx, dispensing, external, printed }: { ctx: RenderedContext; dispensing: string; external: boolean; printed: number }) {
  const [s, act, pending] = useActionState<PharmacyFormState, FormData>(labelAction, {});
  return (
    <form action={act} key={`l${s.n ?? 0}`} aria-label="Cetak etiket" className="grid min-w-0 gap-2 print:hidden">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="dispensing" value={dispensing} />
      <Notice s={s} />
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button type="submit" variant="secondary" aria-disabled={pending}>{printed > 0 ? "Cetak Ulang Etiket" : external ? "Cetak Etiket Biru" : "Cetak Etiket"}</Button>
        {s.ok && <Button type="button" variant="plain" onClick={() => window.print()}>Buka Dialog Cetak</Button>}
      </div>
    </form>
  );
}

// Serahkan (CD-19): the seven checks; an unchecked one needs the exception note. One prominent action.
export function HandOverForm({ ctx, dispensing, blocked }: { ctx: RenderedContext; dispensing: string; blocked: boolean }) {
  const [s, act, pending] = useActionState<PharmacyFormState, FormData>(handOverAction, {});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const id = useId();
  if (s.ok) return <Notice s={s} />;
  const missing = CHECKS.some((c) => !checked[c]);
  return (
    <form action={act} key={`h${s.n ?? 0}`} aria-label="Serahkan" className="grid min-w-0 gap-3 print:hidden">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="dispensing" value={dispensing} />
      <fieldset className="m-0 grid min-w-0 gap-0 border-0 p-0">
        <legend className="mb-1 text-[1.25rem] font-semibold">Tujuh cek apoteker</legend>
        {CHECKS.map((c) => (
          <label key={c} className="flex min-h-[52px] min-w-0 items-center gap-3">
            <input type="checkbox" name={`c:${c}`} checked={!!checked[c]} onChange={(e) => setChecked({ ...checked, [c]: e.target.checked })} className="size-5 shrink-0" />
            <span className="min-w-0 [overflow-wrap:anywhere]">{CHECK_LABEL[c]}</span>
          </label>
        ))}
      </fieldset>
      {missing && (
        <div className="grid min-w-0 gap-1">
          <label htmlFor={`${id}-n`} className="font-semibold">Catatan pengecualian</label>
          <textarea id={`${id}-n`} name="note" rows={2} maxLength={500} className={`${input} py-2`} />
          <p className={hint}>Wajib bila ada cek yang tidak dicentang: tulis alasannya.</p>
        </div>
      )}
      <Notice s={s} />
      <Button type="submit" size="lg" aria-disabled={pending || blocked}>{pending ? "Menyerahkan…" : "Serahkan"}</Button>
    </form>
  );
}

export function CancelForm({ ctx, dispensing }: { ctx: RenderedContext; dispensing: string }) {
  const [s, act, pending] = useActionState<PharmacyFormState, FormData>(cancelAction, {});
  const [open, setOpen] = useState(false);
  const id = useId();
  if (s.ok) return <Notice s={s} />;
  if (!open) return <Button type="button" variant="plain" onClick={() => setOpen(true)} className="print:hidden">Batalkan Penyerahan…</Button>;
  return (
    <form action={act} key={`c${s.n ?? 0}`} aria-label="Batalkan penyerahan" className="grid min-w-0 gap-2 print:hidden">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="dispensing" value={dispensing} />
      <div className="grid min-w-0 gap-1">
        <label htmlFor={`${id}-r`}>Alasan pembatalan</label>
        <input id={`${id}-r`} name="reason" required minLength={3} maxLength={300} className={input} />
      </div>
      <Notice s={s} />
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button type="submit" variant="destructive" aria-disabled={pending}>Batalkan</Button>
        <Button type="button" variant="plain" onClick={() => setOpen(false)}>Tutup</Button>
      </div>
    </form>
  );
}
