"use client";
// Tutup Kasir forms (UX-15; T-085). Each write form posts its rendered context (HYG-009 B2-1) and a fresh idempotency key (remounted
// after every answer: n). The count shows the live difference against the expected cash and asks for the reason only when it differs.
import { useActionState, useId, useState } from "react";
import { ContextFields } from "../../../../components/context-fields";
import { Button } from "../../../../components/ui/button";
import type { RenderedContext } from "../../../../modules/org/context/context";
import { countAction, openAction, type ShiftState } from "./actions";
import { rp, signed } from "./labels";

const input = "min-h-[52px] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const hint = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";

function Notice({ s }: { s: ShiftState }) {
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

// Buka Kasir: the float (Modal awal); a tenant-wide cashier names the branch.
export function OpenForm({ ctx, branches }: { ctx: RenderedContext; branches: { id: string; name: string }[] | null }) {
  const [s, act, pending] = useActionState<ShiftState, FormData>(openAction, {});
  const id = useId();
  return (
    <form action={act} key={`o${s.n ?? 0}`} aria-label="Buka kasir" className="grid min-w-0 gap-3 rounded-[var(--radius-field)] bg-[var(--surface)] p-4">
      <ContextFields ctx={ctx} /><Key />
      {branches && (
        <label htmlFor={`${id}-b`} className="grid min-w-0 gap-1"><span>Cabang</span>
          <select id={`${id}-b`} name="branch" defaultValue={s.values?.branch ?? branches[0]?.id} className={input}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      )}
      <label htmlFor={`${id}-f`} className="grid min-w-0 gap-1"><span>Modal awal (Rp)</span>
        <input id={`${id}-f`} name="opening_float" inputMode="numeric" defaultValue={s.values?.opening_float ?? "0"} className={input} />
      </label>
      <p className={hint}>Pembayaran pertama tanpa Buka Kasir membuka kasir otomatis dengan modal awal Rp0.</p>
      <Notice s={s} />
      <Button type="submit" aria-disabled={pending} className="justify-self-start">Buka Kasir</Button>
    </form>
  );
}

// Tutup Kasir / Hitung Ulang: the counted cash; the live difference; the reason required when it differs.
export function CountForm({ ctx, shift, expected, threshold, recount }: { ctx: RenderedContext; shift: string; expected: number; threshold: number; recount: boolean }) {
  const [s, act, pending] = useActionState<ShiftState, FormData>(countAction, {});
  const [counted, setCounted] = useState(s.values?.counted_cash ?? "");
  const id = useId();
  const n = /^\s*\d[\d.\s]*$/.test(counted) ? Number(counted.replace(/[.\s]/g, "")) : NaN;
  const diff = Number.isFinite(n) ? n - expected : null;
  return (
    <form action={act} key={`c${s.n ?? 0}`} aria-label={recount ? "Hitung ulang" : "Tutup kasir"} className="grid min-w-0 gap-3">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="shift" value={shift} />
      <label htmlFor={`${id}-c`} className="grid min-w-0 gap-1"><span>Uang tunai di laci (Rp)</span>
        <input id={`${id}-c`} name="counted_cash" inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value)} aria-describedby={`${id}-d`} className={input} />
      </label>
      <p id={`${id}-d`} aria-live="polite" className="m-0 font-semibold tabular-nums">{diff === null ? `Tunai yang diharapkan ${rp(expected)}` : signed(diff)}</p>
      {diff !== null && diff !== 0 && (
        <>
          <label htmlFor={`${id}-r`} className="grid min-w-0 gap-1"><span>Alasan selisih</span>
            <textarea id={`${id}-r`} name="reason" rows={2} maxLength={500} defaultValue={s.values?.reason ?? ""} className={`${input} py-2`} />
          </label>
          <p className={hint}>{Math.abs(diff) > threshold ? `Selisih di atas ${rp(threshold)} — diteruskan ke Owner.` : "Selisih menunggu persetujuan manajer."}</p>
        </>
      )}
      <Notice s={s} />
      <Button type="submit" aria-disabled={pending} className="justify-self-start">{recount ? "Hitung Ulang" : "Tutup Kasir"}</Button>
    </form>
  );
}
