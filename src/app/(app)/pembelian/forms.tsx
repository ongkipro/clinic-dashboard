"use client";
// Pembelian forms (UX-52; T-067). Every write form posts its rendered context (HYG-009 B2-1) and a fresh idempotency
// key (remounted after every answer: n). Sheets open in place; the one prominent action of each view is filled.
import { useActionState, useId, useState } from "react";
import { ContextFields } from "../../../components/context-fields";
import { Button } from "../../../components/ui/button";
import type { RenderedContext } from "../../../modules/org/context/context";
import {
  applyCreditAction, type BuyFormState, creditNoteAction, invoiceAction, payAction, poSaveAction, poTransitionAction, receiveAction, returnAction, supplierAction,
  transferActAction, transferSendAction,
} from "./actions";
import { RETURN_REASON, rp } from "./labels";

const input = "min-h-[52px] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const hint = "m-0 text-[0.88rem] text-[var(--label-2)]";
const field = "grid min-w-0 gap-1";
const grid2 = "grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 min-[700px]:grid-cols-2";

function Notice({ s }: { s: BuyFormState }) {
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
function Sheet({ label, prominent, children }: { label: string; prominent?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!open) return <Button type="button" variant={prominent ? "default" : "secondary"} onClick={() => setOpen(true)} className="justify-self-start">{label}</Button>;
  return (
    <section aria-label={label} className="grid min-w-0 gap-3 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-[var(--surface)] p-4">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h2 className="m-0 text-[1.25rem] font-semibold">{label}</h2>
        <Button type="button" variant="plain" onClick={() => setOpen(false)}>Tutup</Button>
      </div>
      {children}
    </section>
  );
}
function F({ id, label, children, help }: { id: string; label: string; children: React.ReactNode; help?: string }) {
  return (
    <div className={field}>
      <label htmlFor={id}>{label}</label>
      {children}
      {help && <p className={hint}>{help}</p>}
    </div>
  );
}
type Opt = { id: string; name: string };
const BranchField = ({ branch }: { branch: string | null }) => (branch ? <input type="hidden" name="branch" value={branch} /> : null);

// ── Pemasok ────────────────────────────────────────────────────────────────────────────────────────────
export function SupplierForm({ ctx, s0 }: { ctx: RenderedContext; s0?: { id: string; name: string; npwp: string | null; contact_name: string | null; phone: string | null;
  email: string | null; address: string | null; payment_terms_days: number; active: boolean } }) {
  const [s, act, pending] = useActionState<BuyFormState, FormData>(supplierAction, {});
  const id = useId();
  return (
    <Sheet label={s0 ? `Ubah ${s0.name}` : "Tambah Pemasok"} prominent={!s0}>
      <form action={act} key={`s${s.n ?? 0}`} aria-label={s0 ? `Ubah pemasok ${s0.name}` : "Tambah pemasok"} className="grid min-w-0 gap-3">
        <ContextFields ctx={ctx} /><Key />{s0 && <input type="hidden" name="supplier" value={s0.id} />}
        <div className={grid2}>
          <F id={`${id}-n`} label="Nama pemasok"><input id={`${id}-n`} name="name" defaultValue={s0?.name} required minLength={2} maxLength={120} className={input} /></F>
          <F id={`${id}-t`} label="Syarat bayar (hari)"><input id={`${id}-t`} name="terms" inputMode="numeric" defaultValue={s0?.payment_terms_days ?? 30} className={input} /></F>
          <F id={`${id}-w`} label="NPWP (opsional)"><input id={`${id}-w`} name="npwp" inputMode="numeric" defaultValue={s0?.npwp ?? ""} className={input} /></F>
          <F id={`${id}-c`} label="Kontak (opsional)"><input id={`${id}-c`} name="contact" defaultValue={s0?.contact_name ?? ""} className={input} /></F>
          <F id={`${id}-p`} label="Telepon (opsional)"><input id={`${id}-p`} name="phone" inputMode="tel" defaultValue={s0?.phone ?? ""} className={input} /></F>
          <F id={`${id}-e`} label="Email (opsional)"><input id={`${id}-e`} name="email" type="email" defaultValue={s0?.email ?? ""} className={input} /></F>
        </div>
        <F id={`${id}-a`} label="Alamat (opsional)"><input id={`${id}-a`} name="address" defaultValue={s0?.address ?? ""} className={input} /></F>
        {s0 && (
          <label className="flex min-h-[52px] items-center gap-3">
            <input type="checkbox" name="active" value="on" defaultChecked={s0.active} className="size-5" />
            <span>Aktif</span>
          </label>
        )}
        <Notice s={s} />
        <Button type="submit" aria-disabled={pending} className="justify-self-start">Simpan Pemasok</Button>
      </form>
    </Sheet>
  );
}

// ── PO ─────────────────────────────────────────────────────────────────────────────────────────────────
export function PoForm({ ctx, branch, suppliers, items, money }: { ctx: RenderedContext; branch: string | null; suppliers: Opt[]; items: (Opt & { unit: string })[]; money: boolean }) {
  const [s, act, pending] = useActionState<BuyFormState, FormData>(poSaveAction, {});
  const [rows, setRows] = useState(1);
  const id = useId();
  return (
    <Sheet label="Buat PO" prominent>
      <form action={act} key={`p${s.n ?? 0}`} aria-label="Buat PO" className="grid min-w-0 gap-3">
        <ContextFields ctx={ctx} /><Key /><BranchField branch={branch} />
        <div className={grid2}>
          <F id={`${id}-s`} label="Pemasok">
            <select id={`${id}-s`} name="supplier" required defaultValue="" className={input}>
              <option value="" disabled>Pilih pemasok</option>
              {suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </F>
          <F id={`${id}-d`} label="Perkiraan tiba (opsional)"><input id={`${id}-d`} name="expected" type="date" className={input} /></F>
        </div>
        {Array.from({ length: rows }, (_, i) => (
          <fieldset key={i} className="m-0 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 border-0 p-0 min-[700px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <legend className="sr-only">{`Baris ${i + 1}`}</legend>
            <F id={`${id}-i${i}`} label={`Item ${i + 1}`}>
              <select id={`${id}-i${i}`} name={`item:${i}`} defaultValue="" className={input}>
                <option value="">Pilih item</option>
                {items.map((x) => <option key={x.id} value={x.id}>{`${x.name} (${x.unit})`}</option>)}
              </select>
            </F>
            <F id={`${id}-q${i}`} label="Jumlah"><input id={`${id}-q${i}`} name={`qty:${i}`} inputMode="decimal" className={input} /></F>
            <F id={`${id}-p${i}`} label="Harga satuan (Rp)"><input id={`${id}-p${i}`} name={`price:${i}`} inputMode="numeric" className={input} /></F>
          </fieldset>
        ))}
        {rows < 20 && <Button type="button" variant="plain" onClick={() => setRows(rows + 1)} className="justify-self-start">Tambah Baris</Button>}
        {!money && <p className={hint}>Harga satuan tidak ditampilkan untuk peran ini setelah disimpan.</p>}
        <Notice s={s} />
        <Button type="submit" aria-disabled={pending} className="justify-self-start">Simpan Draf</Button>
      </form>
    </Sheet>
  );
}
export function PoActions({ ctx, po, state }: { ctx: RenderedContext; po: string; state: string }) {
  const [s, act, pending] = useActionState<BuyFormState, FormData>(poTransitionAction, {});
  const [cancel, setCancel] = useState(false);
  const id = useId();
  return (
    <form action={act} key={`t${s.n ?? 0}`} aria-label="Status PO" className="grid min-w-0 gap-2">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="po" value={po} />
      {cancel && (
        <F id={`${id}-r`} label="Alasan pembatalan"><input id={`${id}-r`} name="reason" required minLength={3} maxLength={300} className={input} /></F>
      )}
      <Notice s={s} />
      <div className="flex min-w-0 flex-wrap gap-2">
        {state === "draft" && !cancel && <Button type="submit" name="action" value="send" aria-disabled={pending}>Kirim ke Pemasok</Button>}
        {cancel ? <Button type="submit" name="action" value="cancel" variant="destructive" aria-disabled={pending}>Batalkan PO</Button>
          : <Button type="button" variant="plain" onClick={() => setCancel(true)}>Batalkan…</Button>}
      </div>
    </form>
  );
}

// ── Terima Barang ──────────────────────────────────────────────────────────────────────────────────────
export function ReceiveForm({ ctx, branch, supplier, suppliers, po, lines, items }: {
  ctx: RenderedContext; branch: string | null; supplier?: string; suppliers?: Opt[]; po?: string;
  lines?: { item_id: string; name: string; unit: string; open: number }[]; items?: (Opt & { unit: string })[];
}) {
  const [s, act, pending] = useActionState<BuyFormState, FormData>(receiveAction, {});
  const id = useId();
  const rows = lines ?? [{ item_id: "", name: "", unit: "", open: 0 }];
  return (
    <Sheet label="Terima Barang" prominent>
      <form action={act} key={`r${s.n ?? 0}`} aria-label="Terima barang" className="grid min-w-0 gap-3">
        <ContextFields ctx={ctx} /><Key /><BranchField branch={branch} />
        {po && <input type="hidden" name="po" value={po} />}
        {supplier ? <input type="hidden" name="supplier" value={supplier} /> : (
          <F id={`${id}-s`} label="Pemasok">
            <select id={`${id}-s`} name="supplier" required defaultValue="" className={input}>
              <option value="" disabled>Pilih pemasok</option>
              {(suppliers ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </F>
        )}
        <F id={`${id}-n`} label="Nomor surat jalan (opsional)"><input id={`${id}-n`} name="note" className={input} /></F>
        {rows.map((l, i) => (
          <fieldset key={i} className="m-0 grid min-w-0 gap-2 border-0 border-t border-[var(--separator)] p-0 pt-3">
            <legend className="mb-1 font-semibold [overflow-wrap:anywhere]">{l.name ? `${l.name} · sisa PO ${l.open} ${l.unit}` : `Baris ${i + 1}`}</legend>
            {l.item_id ? <input type="hidden" name={`item:${i}`} value={l.item_id} /> : (
              <F id={`${id}-i${i}`} label="Item">
                <select id={`${id}-i${i}`} name={`item:${i}`} defaultValue="" className={input}>
                  <option value="">Pilih item</option>
                  {(items ?? []).map((x) => <option key={x.id} value={x.id}>{`${x.name} (${x.unit})`}</option>)}
                </select>
              </F>
            )}
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 min-[700px]:grid-cols-3">
              <F id={`${id}-b${i}`} label="Nomor batch"><input id={`${id}-b${i}`} name={`batch:${i}`} className={input} /></F>
              <F id={`${id}-e${i}`} label="Kedaluwarsa"><input id={`${id}-e${i}`} name={`expiry:${i}`} type="date" className={input} /></F>
              <F id={`${id}-q${i}`} label="Jumlah diterima"><input id={`${id}-q${i}`} name={`qty:${i}`} inputMode="decimal" className={input} /></F>
            </div>
            {!po && <F id={`${id}-c${i}`} label="Harga satuan (Rp)"><input id={`${id}-c${i}`} name={`cost:${i}`} inputMode="numeric" className={input} /></F>}
          </fieldset>
        ))}
        {po && <p className={hint}>Harga satuan mengikuti PO.</p>}
        <Notice s={s} />
        <Button type="submit" aria-disabled={pending} className="justify-self-start">{pending ? "Menyimpan…" : "Simpan Penerimaan"}</Button>
      </form>
    </Sheet>
  );
}

// ── Retur ──────────────────────────────────────────────────────────────────────────────────────────────
export function ReturnForm({ ctx, branch, suppliers, batches }: { ctx: RenderedContext; branch: string | null; suppliers: Opt[];
  batches: { supplier_id: string; batch_id: string; label: string; open: number }[] }) {
  const [s, act, pending] = useActionState<BuyFormState, FormData>(returnAction, {});
  const [sup, setSup] = useState("");
  const id = useId();
  return (
    <Sheet label="Retur ke Pemasok" prominent>
      <form action={act} key={`x${s.n ?? 0}`} aria-label="Retur ke pemasok" className="grid min-w-0 gap-3">
        <ContextFields ctx={ctx} /><Key /><BranchField branch={branch} />
        <div className={grid2}>
          <F id={`${id}-s`} label="Pemasok">
            <select id={`${id}-s`} name="supplier" required value={sup} onChange={(e) => setSup(e.target.value)} className={input}>
              <option value="" disabled>Pilih pemasok</option>
              {suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </F>
          <F id={`${id}-b`} label="Batch">
            <select id={`${id}-b`} name="batch" required defaultValue="" className={input}>
              <option value="" disabled>Pilih batch</option>
              {batches.filter((b) => b.supplier_id === sup).map((b) => <option key={b.batch_id} value={b.batch_id}>{`${b.label} · dapat diretur ${b.open}`}</option>)}
            </select>
          </F>
          <F id={`${id}-q`} label="Jumlah"><input id={`${id}-q`} name="qty" inputMode="decimal" required className={input} /></F>
          <F id={`${id}-r`} label="Alasan">
            <select id={`${id}-r`} name="reason" required defaultValue="" className={input}>
              <option value="" disabled>Pilih alasan</option>
              {Object.entries(RETURN_REASON).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </F>
        </div>
        <F id={`${id}-n`} label="Catatan"><input id={`${id}-n`} name="note" required minLength={3} maxLength={300} className={input} /></F>
        <Notice s={s} />
        <Button type="submit" aria-disabled={pending} className="justify-self-start">Catat Retur</Button>
      </form>
    </Sheet>
  );
}

// ── Transfer ───────────────────────────────────────────────────────────────────────────────────────────
export function TransferForm({ ctx, depots, branches, batches }: { ctx: RenderedContext; depots: Opt[]; branches: Opt[];
  batches: { depot_id: string; batch_id: string; label: string }[] }) {
  const [s, act, pending] = useActionState<BuyFormState, FormData>(transferSendAction, {});
  const [from, setFrom] = useState(depots[0]?.id ?? "");
  const id = useId();
  return (
    <Sheet label="Kirim ke Cabang Lain" prominent>
      <form action={act} key={`k${s.n ?? 0}`} aria-label="Kirim transfer" className="grid min-w-0 gap-3">
        <ContextFields ctx={ctx} /><Key />
        <div className={grid2}>
          <F id={`${id}-f`} label="Dari depot">
            <select id={`${id}-f`} name="from" required value={from} onChange={(e) => setFrom(e.target.value)} className={input}>
              {depots.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </F>
          <F id={`${id}-t`} label="Ke cabang">
            <select id={`${id}-t`} name="to" required defaultValue="" className={input}>
              <option value="" disabled>Pilih cabang</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </F>
          <F id={`${id}-b`} label="Batch">
            <select id={`${id}-b`} name="batch" required defaultValue="" className={input}>
              <option value="" disabled>Pilih batch</option>
              {batches.filter((b) => b.depot_id === from).map((b) => <option key={b.batch_id} value={b.batch_id}>{b.label}</option>)}
            </select>
          </F>
          <F id={`${id}-q`} label="Jumlah"><input id={`${id}-q`} name="qty" inputMode="decimal" required className={input} /></F>
        </div>
        <Notice s={s} />
        <Button type="submit" aria-disabled={pending} className="justify-self-start">Kirim</Button>
      </form>
    </Sheet>
  );
}
export function TransferActions({ ctx, transfer, canReceive, canCancel, depots }: { ctx: RenderedContext; transfer: string; canReceive: boolean; canCancel: boolean; depots: Opt[] }) {
  const [s, act, pending] = useActionState<BuyFormState, FormData>(transferActAction, {});
  const id = useId();
  if (!canReceive && !canCancel) return null;
  return (
    <form action={act} key={`a${s.n ?? 0}`} aria-label="Tindak lanjut transfer" className="grid min-w-0 gap-2">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="transfer" value={transfer} />
      {canReceive && depots.length > 1 && (
        <F id={`${id}-d`} label="Terima ke depot">
          <select id={`${id}-d`} name="depot" defaultValue={depots[0].id} className={input}>{depots.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        </F>
      )}
      <Notice s={s} />
      <div className="flex min-w-0 flex-wrap gap-2">
        {canReceive && <Button type="submit" name="action" value="receive" variant="secondary" aria-disabled={pending}>Terima</Button>}
        {canCancel && <Button type="submit" name="action" value="cancel" variant="plain" aria-disabled={pending}>Batalkan</Button>}
      </div>
    </form>
  );
}

// ── Utang ──────────────────────────────────────────────────────────────────────────────────────────────
export function InvoiceForm({ ctx, branch, suppliers, uninvoiced, today }: { ctx: RenderedContext; branch: string | null; suppliers: Opt[];
  uninvoiced: { receipt_id: string; supplier_id: string; label: string; grni: number }[]; today: string }) {
  const [s, act, pending] = useActionState<BuyFormState, FormData>(invoiceAction, {});
  const [sup, setSup] = useState("");
  const id = useId();
  const mine = uninvoiced.filter((u) => u.supplier_id === sup);
  return (
    <Sheet label="Catat Faktur" prominent>
      <form action={act} key={`f${s.n ?? 0}`} aria-label="Catat faktur" className="grid min-w-0 gap-3">
        <ContextFields ctx={ctx} /><Key /><BranchField branch={branch} />
        <div className={grid2}>
          <F id={`${id}-s`} label="Pemasok">
            <select id={`${id}-s`} name="supplier" required value={sup} onChange={(e) => setSup(e.target.value)} className={input}>
              <option value="" disabled>Pilih pemasok</option>
              {suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </F>
          <F id={`${id}-n`} label="Nomor faktur"><input id={`${id}-n`} name="number" required maxLength={40} className={input} /></F>
          <F id={`${id}-d`} label="Tanggal faktur"><input id={`${id}-d`} name="date" type="date" required defaultValue={today} className={input} /></F>
          <F id={`${id}-u`} label="Jatuh tempo (opsional)" help="Kosong: sesuai syarat bayar pemasok."><input id={`${id}-u`} name="due" type="date" className={input} /></F>
        </div>
        <fieldset className="m-0 grid min-w-0 gap-0 border-0 p-0">
          <legend className="mb-1 font-semibold">Penerimaan yang difakturkan</legend>
          {sup && mine.length === 0 && <p className={hint}>Tidak ada penerimaan yang belum difakturkan untuk pemasok ini.</p>}
          {mine.map((u) => (
            <label key={u.receipt_id} className="flex min-h-[52px] min-w-0 items-center gap-3">
              <input type="checkbox" name="receipt" value={u.receipt_id} defaultChecked className="size-5 shrink-0" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{`${u.label} · ${rp(u.grni)}`}</span>
            </label>
          ))}
        </fieldset>
        <Notice s={s} />
        <Button type="submit" aria-disabled={pending} className="justify-self-start">Simpan Faktur</Button>
      </form>
    </Sheet>
  );
}
export function PayForm({ ctx, branch, invoice, supplier, outstanding, today }: { ctx: RenderedContext; branch: string | null; invoice: string; supplier: string;
  outstanding: number; today: string }) {
  const [s, act, pending] = useActionState<BuyFormState, FormData>(payAction, {});
  const id = useId();
  return (
    <Sheet label="Bayar">
      <form action={act} key={`b${s.n ?? 0}`} aria-label="Bayar faktur" className="grid min-w-0 gap-3">
        <ContextFields ctx={ctx} /><Key /><BranchField branch={branch} />
        <input type="hidden" name="invoice" value={invoice} /><input type="hidden" name="supplier" value={supplier} />
        <div className={grid2}>
          <F id={`${id}-a`} label="Jumlah (Rp)" help={`Sisa ${rp(outstanding)}`}><input id={`${id}-a`} name="amount" inputMode="numeric" required defaultValue={outstanding} className={input} /></F>
          <F id={`${id}-m`} label="Cara bayar">
            <select id={`${id}-m`} name="method" defaultValue="bank_transfer" className={input}><option value="bank_transfer">Transfer bank</option><option value="cash">Tunai</option></select>
          </F>
          <F id={`${id}-d`} label="Tanggal bayar"><input id={`${id}-d`} name="date" type="date" required defaultValue={today} className={input} /></F>
          <F id={`${id}-r`} label="Referensi (opsional)"><input id={`${id}-r`} name="reference" maxLength={40} className={input} /></F>
        </div>
        <Notice s={s} />
        <Button type="submit" aria-disabled={pending} className="justify-self-start">Simpan Pembayaran</Button>
      </form>
    </Sheet>
  );
}
export function CreditNoteForm({ ctx, branch, ret, supplier, amount, today }: { ctx: RenderedContext; branch: string | null; ret: string; supplier: string; amount: number; today: string }) {
  const [s, act, pending] = useActionState<BuyFormState, FormData>(creditNoteAction, {});
  const id = useId();
  return (
    <Sheet label="Catat Nota Kredit">
      <form action={act} key={`c${s.n ?? 0}`} aria-label="Catat nota kredit" className="grid min-w-0 gap-3">
        <ContextFields ctx={ctx} /><Key /><BranchField branch={branch} />
        <input type="hidden" name="return" value={ret} /><input type="hidden" name="supplier" value={supplier} />
        <div className={grid2}>
          <F id={`${id}-n`} label="Nomor nota kredit"><input id={`${id}-n`} name="number" required maxLength={40} className={input} /></F>
          <F id={`${id}-a`} label="Jumlah (Rp)"><input id={`${id}-a`} name="amount" inputMode="numeric" required defaultValue={amount || ""} className={input} /></F>
          <F id={`${id}-d`} label="Tanggal"><input id={`${id}-d`} name="date" type="date" required defaultValue={today} className={input} /></F>
        </div>
        <Notice s={s} />
        <Button type="submit" aria-disabled={pending} className="justify-self-start">Simpan Nota Kredit</Button>
      </form>
    </Sheet>
  );
}
export function ApplyCreditForm({ ctx, credit, invoices }: { ctx: RenderedContext; credit: string; invoices: { id: string; label: string }[] }) {
  const [s, act, pending] = useActionState<BuyFormState, FormData>(applyCreditAction, {});
  const id = useId();
  if (invoices.length === 0) return null;
  return (
    <form action={act} key={`k${s.n ?? 0}`} aria-label="Terapkan nota kredit" className="grid min-w-0 gap-2">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="credit" value={credit} />
      <F id={`${id}-i`} label="Terapkan ke faktur">
        <select id={`${id}-i`} name="invoice" defaultValue={invoices[0].id} className={input}>{invoices.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
      </F>
      <Notice s={s} />
      <Button type="submit" variant="secondary" aria-disabled={pending} className="justify-self-start">Terapkan</Button>
    </form>
  );
}
