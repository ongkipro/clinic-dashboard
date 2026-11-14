"use client";
// Piutang & Refund forms (UX-14; T-078). Each write form posts its rendered context and a fresh idempotency key (remounted
// after every answer: n). A destructive write-off names the amount on its button and needs a typed reason.
import { useActionState, useId, useState } from "react";
import { ContextFields } from "../../../components/context-fields";
import { Button } from "../../../components/ui/button";
import type { RenderedContext } from "../../../modules/org/context/context";
import type { RefundLine } from "../../../modules/cashier/receivables/receivables";
import {
  collectAction, convertAction, payRefundAction, type PiutangState, refundAction, requestWriteOffAction, writeOffAction,
} from "./actions";

const input = "min-h-[52px] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const hint = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
const field = "grid min-w-0 gap-1";
const rp = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n).replace(/\s/g, "");

function Notice({ s }: { s: PiutangState }) {
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

// Ajukan Refund: a line, the amount (default the room), Tujuan (Saldo pasien preselected, or Tunai), the reason, and for a
// delivered product the units back to stock.
export function RefundForm({ ctx, lines, cashApprover }: { ctx: RenderedContext; lines: RefundLine[]; cashApprover: string }) {
  const [s, act, pending] = useActionState<PiutangState, FormData>(refundAction, {});
  const open = lines.filter((l) => !l.blocked);
  const [line, setLine] = useState(open[0]?.id ?? "");
  const [dest, setDest] = useState<"balance" | "cash">("balance");
  const [ret, setRet] = useState(false);
  const id = useId();
  const sel = open.find((l) => l.id === line);
  if (open.length === 0) return <p className={hint}>Tidak ada baris yang dapat direfund.</p>;
  return (
    <form action={act} key={`f${s.n ?? 0}`} aria-label="Ajukan refund" className="grid min-w-0 gap-3">
      <ContextFields ctx={ctx} /><Key />
      <label htmlFor={`${id}-l`} className={field}><span>Baris tagihan</span>
        <select id={`${id}-l`} name="line" value={line} onChange={(e) => setLine(e.target.value)} className={input}>
          {open.map((l) => <option key={l.id} value={l.id}>{`${l.name} · dapat direfund ${rp(l.room)}`}</option>)}
        </select>
      </label>
      <label htmlFor={`${id}-a`} className={field}><span>Jumlah</span>
        <input id={`${id}-a`} name="amount" inputMode="numeric" defaultValue={sel ? String(sel.room) : ""} key={line} className={input} />
      </label>
      <fieldset className="grid min-w-0 gap-2 border-0 p-0">
        <legend className="mb-1">Tujuan</legend>
        <label className="flex min-h-[44px] items-center gap-2"><input type="radio" name="destination" value="balance" checked={dest === "balance"} onChange={() => setDest("balance")} />Saldo pasien</label>
        <label className="flex min-h-[44px] items-center gap-2"><input type="radio" name="destination" value="cash" checked={dest === "cash"} onChange={() => setDest("cash")} />Tunai</label>
        {dest === "cash" && <p className={hint}>{`Refund tunai perlu persetujuan ${cashApprover}.`}</p>}
      </fieldset>
      <label htmlFor={`${id}-r`} className={field}><span>Alasan</span>
        <textarea id={`${id}-r`} name="reason" rows={2} maxLength={500} className={`${input} py-2`} />
      </label>
      {sel?.delivered && (
        <div className="grid min-w-0 gap-2">
          <label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" name="returned" checked={ret} onChange={(e) => setRet(e.target.checked)} />Barang kembali utuh dan layak jual</label>
          {ret && <label htmlFor={`${id}-q`} className={field}><span>Jumlah barang kembali</span><input id={`${id}-q`} name="qty" inputMode="numeric" defaultValue="1" className={input} /></label>}
        </div>
      )}
      <Notice s={s} />
      <Button type="submit" aria-disabled={pending} className="justify-self-start">{dest === "balance" ? "Refund ke Saldo" : "Ajukan Refund Tunai"}</Button>
    </form>
  );
}

export function PayRefundForm({ ctx, refund }: { ctx: RenderedContext; refund: string }) {
  const [s, act, pending] = useActionState<PiutangState, FormData>(payRefundAction, {});
  const [method, setMethod] = useState("cash");
  const id = useId();
  return (
    <form action={act} key={`p${s.n ?? 0}`} aria-label="Bayar refund" className="grid min-w-0 gap-3">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="refund" value={refund} />
      <label htmlFor={`${id}-m`} className={field}><span>Metode</span>
        <select id={`${id}-m`} name="method" value={method} onChange={(e) => setMethod(e.target.value)} className={input}>
          <option value="cash">Tunai</option><option value="transfer">Transfer</option>
        </select>
      </label>
      {method === "transfer" && (
        <>
          <label htmlFor={`${id}-b`} className={field}><span>Bank</span><input id={`${id}-b`} name="bank" maxLength={60} className={input} /></label>
          <label htmlFor={`${id}-f`} className={field}><span>No. referensi</span><input id={`${id}-f`} name="reference" maxLength={60} className={input} /></label>
        </>
      )}
      <Notice s={s} />
      <Button type="submit" aria-disabled={pending} className="justify-self-start">Bayar Refund</Button>
    </form>
  );
}

export function ConvertForm({ ctx, visit, amount }: { ctx: RenderedContext; visit: string; amount: number }) {
  const [s, act, pending] = useActionState<PiutangState, FormData>(convertAction, {});
  return (
    <form action={act} key={`c${s.n ?? 0}`} aria-label="Jadikan piutang" className="grid min-w-0 gap-2">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="visit" value={visit} />
      <Notice s={s} />
      <Button type="submit" aria-disabled={pending} className="justify-self-start">{`Jadikan Piutang ${rp(amount)}`}</Button>
    </form>
  );
}

export function CollectForm({ ctx, receivable, open }: { ctx: RenderedContext; receivable: string; open: number }) {
  const [s, act, pending] = useActionState<PiutangState, FormData>(collectAction, {});
  const [method, setMethod] = useState("cash");
  const id = useId();
  return (
    <form action={act} key={`t${s.n ?? 0}`} aria-label="Terima pembayaran piutang" className="grid min-w-0 gap-3">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="receivable" value={receivable} />
      <label htmlFor={`${id}-m`} className={field}><span>Metode</span>
        <select id={`${id}-m`} name="method" value={method} onChange={(e) => setMethod(e.target.value)} className={input}>
          <option value="cash">Tunai</option><option value="edc">EDC</option><option value="transfer">Transfer</option><option value="balance">Saldo pasien</option>
        </select>
      </label>
      <label htmlFor={`${id}-a`} className={field}><span>{`Jumlah (sisa ${rp(open)})`}</span>
        <input id={`${id}-a`} name="amount" inputMode="numeric" defaultValue={String(open)} className={input} />
      </label>
      {method === "cash" && <label htmlFor={`${id}-u`} className={field}><span>Uang diterima</span><input id={`${id}-u`} name="tendered" inputMode="numeric" className={input} /></label>}
      <Notice s={s} />
      <Button type="submit" aria-disabled={pending} className="justify-self-start">Terima Pembayaran</Button>
    </form>
  );
}

export function WriteOffForm({ ctx, receivable, open, owner }: { ctx: RenderedContext; receivable: string; open: number; owner: boolean }) {
  const [s, act, pending] = useActionState<PiutangState, FormData>(owner ? writeOffAction : requestWriteOffAction, {});
  const id = useId();
  return (
    <form action={act} key={`w${s.n ?? 0}`} aria-label={owner ? "Hapus buku piutang" : "Ajukan hapus buku"} className="grid min-w-0 gap-3">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="receivable" value={receivable} />
      <label htmlFor={`${id}-r`} className={field}><span>{owner ? "Alasan (minimal 10 karakter)" : "Alasan"}</span>
        <textarea id={`${id}-r`} name="reason" rows={2} maxLength={500} className={`${input} py-2`} />
      </label>
      <Notice s={s} />
      <Button type="submit" variant={owner ? "destructive" : undefined} aria-disabled={pending} className="justify-self-start">
        {owner ? `Hapus Buku ${rp(open)}` : "Ajukan Hapus Buku"}
      </Button>
    </form>
  );
}
