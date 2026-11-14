"use client";
// Biaya Operasional & Kas Kecil forms (UX-22 ▸ Biaya; T-084). Every write form posts its rendered context (HYG-009 B2-1) and a fresh
// idempotency key (remounted after every answer: n). Catat Biaya and Kategori Biaya open in place as sheets; Batalkan names the amount.
import { useActionState, useId, useState } from "react";
import { ContextFields } from "../../../../components/context-fields";
import { Button } from "../../../../components/ui/button";
import type { RenderedContext } from "../../../../modules/org/context/context";
import { type BiayaState, recordAction, reverseAction, saveCategoryAction } from "./actions";
import { FUNDING, rp } from "./labels";

const input = "min-h-[52px] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const hint = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
const grid2 = "grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 min-[700px]:grid-cols-2";

function Notice({ s }: { s: BiayaState }) {
  return (
    <>
      {s.error && <p role="alert" className="m-0 text-[var(--danger)] [overflow-wrap:anywhere]">{s.error}</p>}
      {s.ok && <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--success-soft)] px-3 py-2 text-[var(--success)] [overflow-wrap:anywhere]">{s.ok}</p>}
    </>
  );
}
function Key() {
  const [k] = useState(() => crypto.randomUUID());
  return <input type="hidden" name="key" value={k} />;
}
function Sheet({ label, prominent, open: initial, children }: { label: string; prominent?: boolean; open?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!initial);
  if (!open) return <Button type="button" variant={prominent ? "default" : "secondary"} onClick={() => setOpen(true)} className="justify-self-start">{label}</Button>;
  return (
    <section aria-label={label} className="grid min-w-0 gap-3 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-[var(--surface)] p-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 min-w-0 text-[1.25rem] font-semibold [overflow-wrap:anywhere]">{label}</h2>
        <Button type="button" variant="plain" onClick={() => setOpen(false)}>Tutup</Button>
      </div>
      {children}
    </section>
  );
}
function F({ id, label, children, help }: { id: string; label: string; children: React.ReactNode; help?: string }) {
  return (
    <div className="grid min-w-0 gap-1">
      <label htmlFor={id}>{label}</label>
      {children}
      {help && <p id={`${id}-h`} className={hint}>{help}</p>}
    </div>
  );
}
type Opt = { id: string; name: string };

// Catat Biaya: branch (tenant-wide recorders pick it; a manager records at the active branch), date (≤ today), category, amount,
// source of funds, the supplier when Belum Dibayar, description and the receipt (required for Kas Kecil and Tunai).
export function RecordForm({ ctx, branches, fixedBranch, categories, suppliers, today, open }: {
  ctx: RenderedContext; branches: Opt[]; fixedBranch: string | null; categories: Opt[]; suppliers: Opt[]; today: string; open?: boolean;
}) {
  const [s, act, pending] = useActionState<BiayaState, FormData>(recordAction, {});
  const v = s.values ?? {};
  const [funding, setFunding] = useState(v.funding ?? "petty_cash");
  const id = useId();
  const needsReceipt = funding === "petty_cash" || funding === "cash";
  return (
    <Sheet label="Catat Biaya" prominent open={open || !!s.error}>
      <form action={act} key={`r${s.n ?? 0}`} aria-label="Catat biaya" className="grid min-w-0 gap-3">
        <ContextFields ctx={ctx} /><Key />
        <div className={grid2}>
          {fixedBranch === null ? (
            <F id={`${id}-b`} label="Cabang">
              <select id={`${id}-b`} name="branch" defaultValue={v.branch ?? branches[0]?.id ?? ""} required className={input}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </F>
          ) : <input type="hidden" name="branch" value="" />}
          <F id={`${id}-d`} label="Tanggal"><input id={`${id}-d`} name="date" type="date" defaultValue={v.date ?? today} max={today} required className={input} /></F>
          <F id={`${id}-c`} label="Kategori">
            <select id={`${id}-c`} name="category" defaultValue={v.category ?? categories[0]?.id ?? ""} required className={input}>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </F>
          <F id={`${id}-a`} label="Jumlah (Rp)"><input id={`${id}-a`} name="amount" inputMode="numeric" defaultValue={v.amount ?? ""} required className={input} /></F>
        </div>
        <fieldset className="grid min-w-0 gap-1 border-0 p-0">
          <legend className="mb-1">Sumber dana</legend>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1 min-[520px]:grid-cols-2">
            {Object.entries(FUNDING).map(([k, l]) => (
              <label key={k} className="flex min-h-[44px] items-center gap-2"><input type="radio" name="funding" value={k} checked={funding === k} onChange={() => setFunding(k)} />{l}</label>
            ))}
          </div>
          {funding === "unpaid" && <p className={hint}>Biaya ini dicatat sebagai utang ke pemasok dan dibayar dari Pembelian › Utang.</p>}
        </fieldset>
        {funding === "unpaid" && (
          <div className={grid2}>
            <F id={`${id}-s`} label="Pemasok">
              {suppliers.length === 0
                ? <p className={hint}>Belum ada pemasok aktif. Tambahkan di Pembelian › Pemasok.</p>
                : <select id={`${id}-s`} name="supplier" defaultValue={v.supplier ?? suppliers[0].id} required className={input}>
                    {suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>}
            </F>
            <F id={`${id}-i`} label="No. faktur pemasok (opsional)"><input id={`${id}-i`} name="invoice_number" maxLength={60} defaultValue={v.invoice_number ?? ""} className={input} /></F>
          </div>
        )}
        <F id={`${id}-k`} label="Keterangan"><textarea id={`${id}-k`} name="description" rows={2} maxLength={200} defaultValue={v.description ?? ""} required className={`${input} py-2`} /></F>
        <F id={`${id}-f`} label={needsReceipt ? "Bukti (wajib)" : "Bukti (opsional)"} help="Foto atau PDF nota, maksimal 5 MB.">
          <input id={`${id}-f`} type="file" name="receipt" accept="image/jpeg,image/png,application/pdf" required={needsReceipt} aria-describedby={`${id}-f-h`}
            className="min-h-[52px] w-full min-w-0 py-3 [overflow-wrap:anywhere]" />
        </F>
        <Notice s={s} />
        <Button type="submit" aria-disabled={pending} className="justify-self-start">Simpan Biaya</Button>
      </form>
    </Sheet>
  );
}

export function ReverseForm({ ctx, expense, amount }: { ctx: RenderedContext; expense: string; amount: number }) {
  const [s, act, pending] = useActionState<BiayaState, FormData>(reverseAction, {});
  const id = useId();
  return (
    <form action={act} key={`v${s.n ?? 0}`} aria-label="Batalkan biaya" className="grid min-w-0 gap-3">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="expense" value={expense} />
      <F id={`${id}-r`} label="Alasan"><textarea id={`${id}-r`} name="reason" rows={2} maxLength={300} className={`${input} py-2`} /></F>
      <Notice s={s} />
      <Button type="submit" variant="destructive" aria-disabled={pending} className="justify-self-start">{`Batalkan Biaya ${rp(amount)}`}</Button>
    </form>
  );
}

function CategoryRow({ ctx, c }: { ctx: RenderedContext; c: Opt & { active: boolean } }) {
  const [s, act, pending] = useActionState<BiayaState, FormData>(saveCategoryAction, {});
  const id = useId();
  return (
    <li className="grid min-w-0 gap-2 border-b border-[var(--separator)] py-3 last:border-b-0 [border-bottom-width:0.5px]">
      <form action={act} key={`k${s.n ?? 0}`} aria-label={`Ubah kategori ${c.name}`} className="grid min-w-0 gap-2 min-[700px]:grid-cols-[minmax(0,1fr)_auto_auto] min-[700px]:items-end">
        <ContextFields ctx={ctx} /><Key /><input type="hidden" name="category" value={c.id} />
        <F id={`${id}-n`} label={c.active ? "Nama" : "Nama (nonaktif)"}><input id={`${id}-n`} name="name" defaultValue={c.name} maxLength={60} className={input} /></F>
        <label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" name="active" value="1" defaultChecked={c.active} />Aktif</label>
        <input type="hidden" name="active" value="0" />
        <Button type="submit" variant="secondary" aria-disabled={pending}>Simpan</Button>
        <div className="min-[700px]:col-span-3"><Notice s={s} /></div>
      </form>
    </li>
  );
}
// Kategori Biaya (owner, finance): add, rename, deactivate; never deleted.
export function CategoriesSheet({ ctx, categories, open }: { ctx: RenderedContext; categories: (Opt & { active: boolean })[]; open?: boolean }) {
  const [s, act, pending] = useActionState<BiayaState, FormData>(saveCategoryAction, {});
  const id = useId();
  return (
    <Sheet label="Kategori Biaya" open={open}>
      {categories.length > 0 && <ul className="m-0 grid min-w-0 list-none p-0">{categories.map((c) => <CategoryRow key={c.id} ctx={ctx} c={c} />)}</ul>}
      <form action={act} key={`n${s.n ?? 0}`} aria-label="Tambah kategori biaya" className="grid min-w-0 gap-2 min-[700px]:grid-cols-[minmax(0,1fr)_auto] min-[700px]:items-end">
        <ContextFields ctx={ctx} /><Key />
        <F id={`${id}-n`} label="Kategori baru"><input id={`${id}-n`} name="name" maxLength={60} defaultValue={s.values?.name ?? ""} className={input} /></F>
        <Button type="submit" aria-disabled={pending}>Tambah Kategori</Button>
        <div className="min-[700px]:col-span-2"><Notice s={s} /></div>
      </form>
    </Sheet>
  );
}
