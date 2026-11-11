"use client";
// Stok forms (UX-11; T-060). Every write form posts its rendered context (HYG-009 B2-1) and a fresh idempotency key
// (remounted after every answer: n); forms stay mounted after success so the result shows. One prominent action per
// screen; sheet forms open in place (disclosure) and stay open after an answer.
import { useActionState, useId, useState } from "react";
import { ContextFields } from "../../../components/context-fields";
import { Button } from "../../../components/ui/button";
import type { RenderedContext } from "../../../modules/org/context/context";
import {
  cancelCountAction, holdAction, levelAction, openVialAction, receiveAction, recordCountAction, saveItemAction, startCountAction, submitCountAction,
  type StockFormState,
} from "./actions";
import { STORAGE_LABEL } from "./labels";

const input = "min-h-[52px] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const hint = "m-0 text-[0.88rem] text-[var(--label-2)]";
const field = "grid min-w-0 gap-1";

function Notice({ s }: { s: StockFormState }) {
  return (
    <>
      {s.error && <p role="alert" className="m-0 text-[var(--danger)]">{s.error}</p>}
      {s.ok && <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--success-soft)] px-3 py-2 text-[var(--success)]">{s.ok}</p>}
    </>
  );
}
function Key() {
  const [k] = useState(() => crypto.randomUUID());
  return <input type="hidden" name="key" value={k} />;
}
// A sheet: a plain button that opens the form in place; kept open once used.
function Sheet({ label, prominent, children }: { label: string; prominent?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!open) return <Button type="button" variant={prominent ? "default" : "plain"} onClick={() => setOpen(true)}>{label}</Button>;
  return <div className="grid min-w-0 gap-3 rounded-[var(--radius-field)] bg-[var(--surface-2)] p-4">{children}</div>;
}

export type ItemFormValue = {
  id?: string; unit: string; vial_size: number | null; opened_use_hours: number | null; storage: string; registration_no: string | null; high_value: boolean; active: boolean;
};
export function ItemForm({ ctx, options, value }: { ctx: RenderedContext; options?: { catalog_item_id: string; name: string; code: string }[]; value?: ItemFormValue }) {
  const [s, act, pending] = useActionState<StockFormState, FormData>(saveItemAction, {});
  const id = useId();
  const v = value;
  return (
    <form action={act} key={`i${s.n ?? 0}`} aria-label={v ? "Ubah item" : "Tambah item"} className="grid min-w-0 gap-3">
      <ContextFields ctx={ctx} /><Key />
      {v?.id && <input type="hidden" name="item" value={v.id} />}
      {!v && (
        <div className={field}>
          <label htmlFor={`${id}-c`}>Item katalog</label>
          <select id={`${id}-c`} name="catalog_item" required className={input} defaultValue="">
            <option value="" disabled>Pilih bahan atau produk</option>
            {(options ?? []).map((o) => <option key={o.catalog_item_id} value={o.catalog_item_id}>{`${o.name} (${o.code})`}</option>)}
          </select>
          <p className={hint}>Hanya bahan (BHP) dan produk katalog yang belum ada di Master Item.</p>
        </div>
      )}
      <div className="grid min-w-0 gap-3 min-[820px]:grid-cols-2">
        <div className={field}>
          <label htmlFor={`${id}-u`}>Satuan pakai</label>
          <input id={`${id}-u`} name="unit" required maxLength={12} defaultValue={v?.unit ?? ""} className={input} />
          <p className={hint}>Mis. ml, U, pcs. Tidak dapat diubah setelah ada stok.</p>
        </div>
        <div className={field}>
          <label htmlFor={`${id}-s`}>Suhu simpan</label>
          <select id={`${id}-s`} name="storage" defaultValue={v?.storage ?? "ruang"} className={input}>
            {Object.entries(STORAGE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div className={field}>
          <label htmlFor={`${id}-v`}>Ukuran vial (satuan pakai)</label>
          <input id={`${id}-v`} name="vial_size" inputMode="decimal" defaultValue={v?.vial_size ?? ""} className={input} />
        </div>
        <div className={field}>
          <label htmlFor={`${id}-h`}>Batas pakai setelah dibuka (jam)</label>
          <input id={`${id}-h`} name="opened_use_hours" inputMode="numeric" defaultValue={v?.opened_use_hours ?? ""} className={input} />
          <p className={hint}>Kosongkan keduanya untuk item yang bukan vial.</p>
        </div>
        <div className={field}>
          <label htmlFor={`${id}-r`}>Nomor izin edar (BPOM/KFA)</label>
          <input id={`${id}-r`} name="registration_no" maxLength={40} defaultValue={v?.registration_no ?? ""} className={input} />
        </div>
      </div>
      <label className="flex min-h-[52px] items-center gap-3"><input type="checkbox" name="high_value" defaultChecked={v?.high_value ?? false} className="size-5" /> Nilai tinggi (dihitung lebih sering)</label>
      {v && <label className="flex min-h-[52px] items-center gap-3"><input type="checkbox" name="active" defaultChecked={v.active} className="size-5" /> Aktif</label>}
      <Notice s={s} />
      <Button type="submit" aria-disabled={pending} className="justify-self-start">{v ? "Simpan Item" : "Tambah Item"}</Button>
    </form>
  );
}

export function ReceiveForm({ ctx, item, branch, unit, prominent }: { ctx: RenderedContext; item: string; branch: string; unit: string; prominent?: boolean }) {
  const [s, act, pending] = useActionState<StockFormState, FormData>(receiveAction, {});
  const id = useId();
  return (
    <Sheet label="Terima Stok" prominent={prominent}>
      <form action={act} key={`r${s.n ?? 0}`} aria-label="Terima stok" className="grid min-w-0 gap-3">
        <ContextFields ctx={ctx} /><Key /><input type="hidden" name="item" value={item} /><input type="hidden" name="branch" value={branch} />
        <div className="grid min-w-0 gap-3 min-[820px]:grid-cols-2">
          <div className={field}><label htmlFor={`${id}-b`}>Nomor batch</label><input id={`${id}-b`} name="batch_no" required maxLength={40} className={input} /></div>
          <div className={field}><label htmlFor={`${id}-e`}>Kedaluwarsa</label><input id={`${id}-e`} name="expiry" type="date" required className={input} /></div>
          <div className={field}><label htmlFor={`${id}-q`}>{`Jumlah (${unit})`}</label><input id={`${id}-q`} name="quantity" inputMode="decimal" required className={input} /></div>
          <div className={field}>
            <label htmlFor={`${id}-a`}>Asal</label>
            <select id={`${id}-a`} name="reason" defaultValue="penerimaan" className={input}><option value="penerimaan">Penerimaan</option><option value="stok_awal">Stok awal</option></select>
          </div>
        </div>
        <Notice s={s} />
        <Button type="submit" aria-disabled={pending} className="justify-self-start">Terima</Button>
      </form>
    </Sheet>
  );
}

export function LevelForm({ ctx, item, branch, min, target, unit }: { ctx: RenderedContext; item: string; branch: string; min: number | null; target: number | null; unit: string }) {
  const [s, act, pending] = useActionState<StockFormState, FormData>(levelAction, {});
  const id = useId();
  return (
    <Sheet label="Atur Min/Target">
      <form action={act} key={`l${s.n ?? 0}`} aria-label="Atur batas stok" className="grid min-w-0 gap-3">
        <ContextFields ctx={ctx} /><Key /><input type="hidden" name="item" value={item} /><input type="hidden" name="branch" value={branch} />
        <div className="grid min-w-0 gap-3 min-[820px]:grid-cols-2">
          <div className={field}><label htmlFor={`${id}-m`}>{`Minimum (${unit})`}</label><input id={`${id}-m`} name="min" inputMode="decimal" required defaultValue={min ?? ""} className={input} /></div>
          <div className={field}><label htmlFor={`${id}-t`}>{`Target (${unit})`}</label><input id={`${id}-t`} name="target" inputMode="decimal" required defaultValue={target ?? ""} className={input} /></div>
        </div>
        <Notice s={s} />
        <Button type="submit" aria-disabled={pending} className="justify-self-start">Simpan Batas</Button>
      </form>
    </Sheet>
  );
}

// The forms stay mounted when the batch changes (a vial opened, a hold set, a recall): the result stays on screen
// (T-054 lesson); only the buttons follow the new state.
// T-065 (PR-18): every hold and release asks for the reason.
const HOLD_REASON = { quarantined: "Alasan karantina", temperature_excursion: "Catatan suhu menyimpang", recalled: "Alasan penarikan", active: "Alasan pelepasan" } as const;
const HOLD_SUBMIT = { quarantined: "Karantina", temperature_excursion: "Tahan Batch", recalled: "Tarik Batch", active: "Lepas Batch" } as const;
export function BatchActions({ ctx, batch, state, vialItem, canHold, canOpen, vialOpenable, label }: {
  ctx: RenderedContext; batch: string; state: string; vialItem: boolean; canHold: boolean; canOpen: boolean; vialOpenable: boolean; label: string;
}) {
  const [s, act, pending] = useActionState<StockFormState, FormData>(holdAction, {});
  const [v, actV, pendingV] = useActionState<StockFormState, FormData>(openVialAction, {});
  const [hold, setHold] = useState<"" | "quarantined" | "temperature_excursion" | "recalled" | "active">("");
  const id = useId();
  if (!canHold && !(canOpen && vialItem)) return null;
  return (
    <div className="grid min-w-0 gap-2">
      {canOpen && vialItem && (
        <form action={actV} key={`v${v.n ?? 0}`} aria-label={`Buka vial ${label}`} className="grid min-w-0 gap-2">
          <ContextFields ctx={ctx} /><Key /><input type="hidden" name="batch" value={batch} />
          <Notice s={v} />
          {vialOpenable && state === "active" && <Button type="submit" variant="plain" aria-disabled={pendingV} className="justify-self-start">Buka Vial</Button>}
        </form>
      )}
      {canHold && (
        <form action={act} key={`h${s.n ?? 0}`} aria-label={`Status batch ${label}`} className="grid min-w-0 gap-2">
          <ContextFields ctx={ctx} /><Key /><input type="hidden" name="batch" value={batch} />
          {hold && (
            <div className={field}>
              <label htmlFor={`${id}-r`}>{HOLD_REASON[hold]}</label>
              <input id={`${id}-r`} name="reason" required minLength={3} maxLength={300} className={input} />
              <input type="hidden" name="state" value={hold} />
            </div>
          )}
          <Notice s={s} />
          {state !== "recalled" && <div className="flex min-w-0 flex-wrap gap-2">
            {hold
              ? <Button type="submit" variant={hold === "recalled" ? "destructive" : "default"} aria-disabled={pending}>{HOLD_SUBMIT[hold]}</Button>
              : <>
                  {state === "active" && <Button type="button" variant="plain" onClick={() => setHold("quarantined")}>Karantina…</Button>}
                  {state === "active" && <Button type="button" variant="plain" onClick={() => setHold("temperature_excursion")}>Suhu Menyimpang…</Button>}
                  {(state === "quarantined" || state === "temperature_excursion") && <Button type="button" variant="plain" onClick={() => setHold("active")}>Lepas…</Button>}
                  <Button type="button" variant="plain" onClick={() => setHold("recalled")}>Tarik…</Button>
                </>}
          </div>}
        </form>
      )}
    </div>
  );
}

export function StartCountForm({ ctx, items }: { ctx: RenderedContext; items: { id: string; name: string; unit: string }[] }) {
  const [s, act, pending] = useActionState<StockFormState, FormData>(startCountAction, {});
  return (
    <Sheet label="Hitung Stok" prominent>
      <form action={act} key={`s${s.n ?? 0}`} aria-label="Mulai hitung stok" className="grid min-w-0 gap-3">
        <ContextFields ctx={ctx} /><Key />
        <fieldset className="grid min-w-0 gap-1 border-0 p-0">
          <legend className="mb-1">Item yang dihitung</legend>
          <p className={hint}>Kosongkan untuk menghitung semua item yang punya stok.</p>
          {items.map((i) => (
            <label key={i.id} className="flex min-h-[44px] min-w-0 items-center gap-3 [overflow-wrap:anywhere]"><input type="checkbox" name="items" value={i.id} className="size-5 shrink-0" />{i.name}</label>
          ))}
        </fieldset>
        <label className="flex min-h-[52px] items-center gap-3"><input type="checkbox" name="blind" defaultChecked className="size-5" /> Hitung buta (jumlah sistem disembunyikan)</label>
        <Notice s={s} />
        <Button type="submit" aria-disabled={pending} className="justify-self-start">Mulai Hitung</Button>
      </form>
    </Sheet>
  );
}

export function CountLineForm({ ctx, count, line, counted, unit, label }: { ctx: RenderedContext; count: string; line: string; counted: number | null; unit: string; label: string }) {
  const [s, act, pending] = useActionState<StockFormState, FormData>(recordCountAction, {});
  const id = useId();
  return (
    <form action={act} key={`c${s.n ?? 0}`} aria-label={`Hitung ${label}`} className="flex min-w-0 flex-wrap items-end gap-2">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="count" value={count} /><input type="hidden" name="line" value={line} />
      <div className="grid min-w-0 flex-1 gap-1">
        <label htmlFor={`${id}-q`}>{`Terhitung (${unit})`}</label>
        <input id={`${id}-q`} name="counted" inputMode="decimal" required defaultValue={counted ?? ""} className={input} />
      </div>
      <Button type="submit" variant="plain" aria-disabled={pending}>Catat</Button>
      <div className="basis-full"><Notice s={s} /></div>
    </form>
  );
}

// Kept mounted after the count is submitted (open = false) so the answer stays on screen.
export function SubmitCountForm({ ctx, count, open }: { ctx: RenderedContext; count: string; open: boolean }) {
  const [s, act, pending] = useActionState<StockFormState, FormData>(submitCountAction, {});
  const id = useId();
  if (!open) return s.ok ? <Notice s={{ ok: s.ok }} /> : <p className="m-0 text-[var(--label-2)]">Hitungan sudah diajukan.</p>;
  return (
    <form action={act} key={`a${s.n ?? 0}`} aria-label="Ajukan hitungan" className="grid min-w-0 gap-3">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="count" value={count} />
      <div className={field}>
        <label htmlFor={`${id}-r`}>Keterangan</label>
        <input id={`${id}-r`} name="reason" required minLength={3} maxLength={500} className={input} />
        <p className={hint}>Selisih di atas ambang (Pengaturan › Uang & Kasir) menunggu persetujuan Owner atau Manajer.</p>
      </div>
      <Notice s={s} />
      <Button type="submit" aria-disabled={pending} className="justify-self-start">Ajukan Hitungan</Button>
    </form>
  );
}

export function CancelCountForm({ ctx, count }: { ctx: RenderedContext; count: string }) {
  const [s, act, pending] = useActionState<StockFormState, FormData>(cancelCountAction, {});
  return (
    <form action={act} key={`x${s.n ?? 0}`} aria-label="Batalkan hitungan" className="grid min-w-0 gap-2">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="count" value={count} />
      <Notice s={s} />
      <Button type="submit" variant="secondary" aria-disabled={pending} className="justify-self-start">Batalkan Hitungan</Button>
    </form>
  );
}
