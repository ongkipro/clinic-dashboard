"use client";
// Kasir forms (UX-12; T-072). Every write form posts its rendered context (HYG-009 B2-1) and a fresh idempotency key
// (remounted after every answer: n). The tender sheet: method chips (unavailable ones say why), the amount, cash
// tendered and change, EDC/transfer details, the remaining amount in Title 1, one prominent "Terima Rp…".
import Link from "next/link";
import { useActionState, useId, useMemo, useState } from "react";
import { ContextFields } from "../../../components/context-fields";
import { Button } from "../../../components/ui/button";
import type { CounterItem, TenderMethod, TenderOption } from "../../../modules/cashier/kasir/kasir";
import type { RenderedContext } from "../../../modules/org/context/context";
import { issueAction, type KasirFormState, receiveAction, voidAction } from "./actions";
import { rp, TENDER, TENDER_BLOCKED } from "./labels";

const input = "min-h-[52px] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const hint = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
const field = "grid min-w-0 gap-1";
const grid2 = "grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 min-[700px]:grid-cols-2";
const digits = (s: string) => Number(s.replace(/\D/g, "") || "0");

function Notice({ s }: { s: KasirFormState }) {
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

// ── Buat Tagihan / Jual Cepat: lines (item, quantity), removable; issue in one step ──────────────────────────────
type LineOpt = { item_id: string; name: string; price: number | null };
export function IssueForm({ ctx, branch, visit, patient, initial, options, label }: {
  ctx: RenderedContext; branch: string | null; visit?: string; patient?: string | null; initial: (LineOpt & { quantity: number })[]; options?: CounterItem[]; label: string;
}) {
  const [s, act, pending] = useActionState<KasirFormState, FormData>(issueAction, {});
  const [rows, setRows] = useState(() => initial.map((l, i) => ({ ...l, k: i })));
  const [pickId, setPick] = useState("");
  const id = useId();
  const total = rows.reduce((t, r) => t + (r.price ?? 0) * r.quantity, 0);
  if (s.id) {
    return (
      <section aria-label="Tagihan diterbitkan" className="grid min-w-0 gap-3 rounded-[var(--radius-field)] bg-[var(--surface)] p-4">
        <Notice s={s} />
        <Link href={`/kasir/${s.id}`} className="inline-flex min-h-[52px] items-center justify-center justify-self-start rounded-full bg-[var(--tint)] px-5 font-semibold text-white no-underline">Lanjut ke Pembayaran</Link>
      </section>
    );
  }
  return (
    <form action={act} key={`i${s.n ?? 0}`} aria-label={label} className="grid min-w-0 gap-3 rounded-[var(--radius-field)] bg-[var(--surface)] p-4">
      <ContextFields ctx={ctx} /><Key />
      {branch && <input type="hidden" name="branch" value={branch} />}
      {visit && <input type="hidden" name="visit" value={visit} />}
      {patient && <input type="hidden" name="patient" value={patient} />}
      {rows.length === 0 ? <p className={hint}>Belum ada item.</p> : (
        <ul aria-label="Item" className="m-0 grid min-w-0 list-none gap-2 p-0">
          {rows.map((r, i) => (
            <li key={r.k} className="flex min-w-0 flex-wrap items-end gap-2 border-b border-[var(--separator)] pb-2">
              <input type="hidden" name={`item:${i}`} value={r.item_id} />
              {/* wraps the quantity below the name when the name needs the width (390 px, 200 % text) */}
              <div className="grid min-w-[min(100%,14rem)] flex-1 gap-1">
                <span className="font-semibold [overflow-wrap:anywhere]">{r.name}</span>
                <span className={hint}>{r.price == null ? "Harga belum ada" : `${rp(r.price)} × ${r.quantity} = ${rp(r.price * r.quantity)}`}</span>
              </div>
              <div className="flex min-w-0 items-end gap-2">
                <label className={field}>
                  <span className="sr-only">{`Jumlah ${r.name}`}</span>
                  <input name={`qty:${i}`} inputMode="numeric" aria-label={`Jumlah ${r.name}`} value={r.quantity}
                    onChange={(e) => setRows((x) => x.map((y) => (y.k === r.k ? { ...y, quantity: Math.max(1, Math.min(99999, digits(e.target.value) || 1)) } : y)))}
                    className={`${input} w-[5.5rem] text-right`} />
                </label>
                <Button type="button" variant="plain" aria-label={`Hapus ${r.name}`} onClick={() => setRows((x) => x.filter((y) => y.k !== r.k))}>Hapus</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {options && (
        <div className="grid min-w-0 gap-2 min-[700px]:grid-cols-[minmax(0,1fr)_auto] min-[700px]:items-end">
          <label htmlFor={`${id}-p`} className={field}>
            <span>Tambah produk</span>
            <select id={`${id}-p`} value={pickId} onChange={(e) => setPick(e.target.value)} className={input}>
              <option value="">Pilih produk…</option>
              {options.map((o) => <option key={o.item_id} value={o.item_id}>{`${o.name} · ${rp(o.price)}`}</option>)}
            </select>
          </label>
          <Button type="button" variant="secondary" onClick={() => {
            const o = options.find((x) => x.item_id === pickId);
            if (!o) return;
            setRows((x) => (x.some((y) => y.item_id === o.item_id) ? x.map((y) => (y.item_id === o.item_id ? { ...y, quantity: y.quantity + 1 } : y))
              : [...x, { item_id: o.item_id, name: o.name, price: o.price, quantity: 1, k: Date.now() }]));
            setPick("");
          }}>Tambah</Button>
        </div>
      )}
      <p className="m-0 text-[1.25rem] font-semibold">{`Total ${rp(total)}`}</p>
      <p className={hint}>Harga dibekukan saat tagihan diterbitkan. Diskon manual belum tersedia.</p>
      <Notice s={s} />
      <Button type="submit" aria-disabled={pending || rows.length === 0} className="justify-self-start">Terbitkan Tagihan</Button>
    </form>
  );
}

// ── Terima: the tender sheet ───────────────────────────────────────────────────────────────────────────────────
type Row = { k: number; method: TenderMethod; amount: string; tendered: string };
export function TenderSheet({ ctx, invoice, outstanding, tenders }: { ctx: RenderedContext; invoice: string; outstanding: number; tenders: TenderOption[] }) {
  const [s, act, pending] = useActionState<KasirFormState, FormData>(receiveAction, {});
  const avail = tenders.filter((t) => t.available).map((t) => t.method);
  const [rows, setRows] = useState<Row[]>(() => [{ k: 0, method: avail[0] ?? "cash", amount: String(outstanding), tendered: "" }]);
  const id = useId();
  const sum = useMemo(() => rows.reduce((t, r) => t + digits(r.amount), 0), [rows]);
  const remaining = Math.max(0, outstanding - sum);
  // Stays mounted after the page revalidates (fully paid): the receipt panel of this Terima, else nothing.
  if (!s.receipt && outstanding === 0) return null;
  if (s.receipt) {
    return (
      <section aria-label="Pembayaran diterima" className="grid min-w-0 gap-3 rounded-[var(--radius-field)] bg-[var(--surface)] p-4">
        <Notice s={s} />
        {s.change ? <p className="m-0 text-[1.75rem] font-bold">{`Kembalian ${rp(s.change)}`}</p> : null}
        <div className="flex min-w-0 flex-wrap gap-2">
          <a href={`/kasir/struk/${s.receipt}/pdf`} className="inline-flex min-h-[52px] items-center rounded-full bg-[var(--tint)] px-5 font-semibold text-white no-underline">Cetak Struk</a>
          <Link href={`/kasir/struk/${s.receipt}`} className="inline-flex min-h-[52px] items-center rounded-full bg-[var(--secondary)] px-5 font-semibold text-[var(--label)] no-underline">Lihat Struk</Link>
        </div>
        <p className={hint}>Kirim WhatsApp belum tersedia: WhatsApp klinik belum terhubung. Owner dapat menghubungkannya di Pengaturan.</p>
      </section>
    );
  }
  const set = (k: number, p: Partial<Row>) => setRows((x) => x.map((r) => (r.k === k ? { ...r, ...p } : r)));
  return (
    <form action={act} key={`t${s.n ?? 0}`} aria-label="Terima pembayaran" className="grid min-w-0 gap-4 rounded-[var(--radius-field)] bg-[var(--surface)] p-4">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="invoice" value={invoice} />
      <div className="grid min-w-0 gap-1">
        <span className={hint}>Sisa setelah isian ini</span>
        <p className="m-0 text-[1.75rem] font-bold leading-tight" aria-live="polite">{rp(remaining)}</p>
      </div>
      {rows.map((r, i) => (
        <fieldset key={r.k} className="m-0 grid min-w-0 gap-3 border-0 border-t border-[var(--separator)] p-0 pt-3">
          <legend className="sr-only">{`Metode ${i + 1}`}</legend>
          <input type="hidden" name={`m:${i}`} value={r.method} />
          <div role="group" aria-label={`Metode bayar ${i + 1}`} className="flex min-w-0 flex-wrap gap-2">
            {tenders.map((t) => (
              <button key={t.method} type="button" disabled={!t.available} aria-pressed={r.method === t.method}
                onClick={() => set(r.k, { method: t.method })}
                className={`min-h-[44px] rounded-full px-4 text-[0.94rem] font-semibold ${r.method === t.method ? "bg-[var(--tint)] text-white" : "bg-[var(--surface-2)] text-[var(--label)]"} disabled:bg-[var(--surface-2)] disabled:text-[var(--label-3)]`}>
                {TENDER[t.method]}
              </button>
            ))}
          </div>
          <div className={grid2}>
            <label htmlFor={`${id}-a${r.k}`} className={field}>
              <span>{`Jumlah ${TENDER[r.method]}`}</span>
              <input id={`${id}-a${r.k}`} name={`a:${i}`} inputMode="numeric" value={r.amount} onChange={(e) => set(r.k, { amount: e.target.value.replace(/[^\d.]/g, "") })} className={input} />
            </label>
            {r.method === "cash" && (
              <label htmlFor={`${id}-t${r.k}`} className={field}>
                <span>Uang diterima</span>
                <input id={`${id}-t${r.k}`} name={`t:${i}`} inputMode="numeric" value={r.tendered} placeholder={r.amount} onChange={(e) => set(r.k, { tendered: e.target.value.replace(/[^\d.]/g, "") })} className={input} />
                {digits(r.tendered) > digits(r.amount) && <span className={hint}>{`Kembalian ${rp(digits(r.tendered) - digits(r.amount))}`}</span>}
              </label>
            )}
            {r.method === "edc" && (
              <>
                <label className={field}><span>Jenis kartu</span><input name={`d:${i}:card_type`} className={input} placeholder="Debit / Kredit" /></label>
                <label className={field}><span>Bank</span><input name={`d:${i}:bank`} className={input} /></label>
                <label className={field}><span>Nomor trace</span><input name={`d:${i}:trace`} inputMode="numeric" className={input} /></label>
                <label className={field}><span>Kode approval</span><input name={`d:${i}:approval_code`} className={input} /></label>
              </>
            )}
            {r.method === "transfer" && (
              <>
                <label className={field}><span>Bank</span><input name={`d:${i}:bank`} className={input} /></label>
                <label className={field}><span>Referensi</span><input name={`d:${i}:reference`} className={input} /></label>
              </>
            )}
          </div>
          {rows.length > 1 && <Button type="button" variant="plain" className="justify-self-start" onClick={() => setRows((x) => x.filter((y) => y.k !== r.k))}>Hapus metode ini</Button>}
        </fieldset>
      ))}
      {tenders.filter((t) => !t.available).map((t) => (
        <p key={t.method} className={hint}>{`${TENDER[t.method]}: ${TENDER_BLOCKED[t.blocked ?? "payment_port"].reason}.`}</p>
      ))}
      {rows.length < 6 && remaining > 0 && (
        <Button type="button" variant="secondary" className="justify-self-start"
          onClick={() => setRows((x) => [...x, { k: Date.now(), method: avail.find((m) => !x.some((y) => y.method === m && m === "cash")) ?? "edc", amount: String(remaining), tendered: "" }])}>
          Bagi Pembayaran
        </Button>
      )}
      <Notice s={s} />
      <Button type="submit" aria-disabled={pending || sum < 1 || sum > outstanding} className="justify-self-stretch min-[700px]:justify-self-start">{`Terima ${rp(sum)}`}</Button>
      {sum > outstanding && <p role="alert" className="m-0 text-[var(--danger)]">Jumlah melebihi sisa tagihan.</p>}
    </form>
  );
}

// ── Ajukan Void (secondary; reason) ───────────────────────────────────────────────────────────────────────────
export function VoidForm({ ctx, invoice }: { ctx: RenderedContext; invoice: string }) {
  const [s, act, pending] = useActionState<KasirFormState, FormData>(voidAction, {});
  const [open, setOpen] = useState(false);
  const id = useId();
  if (s.ok) return <Notice s={s} />;
  if (!open) return <Button type="button" variant="destructive" className="justify-self-start" onClick={() => setOpen(true)}>Ajukan Void</Button>;
  return (
    <form action={act} key={`v${s.n ?? 0}`} aria-label="Ajukan void" className="grid min-w-0 gap-3 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-[var(--surface)] p-4">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="invoice" value={invoice} />
      <label htmlFor={`${id}-r`} className={field}>
        <span>Alasan void</span>
        <textarea id={`${id}-r`} name="reason" required minLength={3} maxLength={500} rows={3} className={`${input} py-2`} />
        <span className={hint}>Manajer menyetujui di hari yang sama; setelahnya owner. Anda tidak dapat menyetujui pengajuan sendiri.</span>
      </label>
      <Notice s={s} />
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button type="submit" variant="destructive" aria-disabled={pending}>Kirim Pengajuan Void</Button>
        <Button type="button" variant="plain" onClick={() => setOpen(false)}>Batal</Button>
      </div>
    </form>
  );
}
