"use client";
// Gabung Data Ganda forms (PR-85; HYG-NAV-2): search a patient for side A or B (POST; the result links set ?a= / ?b=, ids only), the
// merge form (survivor and duplicate chosen explicitly, reason required) and Batalkan Penggabungan per active merge. Each form posts
// its rendered context and a per-mount idempotency key.
import Link from "next/link";
import { useActionState, useId, useState } from "react";
import { ContextFields } from "../../../../components/context-fields";
import { Button } from "../../../../components/ui/button";
import type { RenderedContext } from "../../../../modules/org/context/context";
import { findAction, type FindState, mergeAction, type MergeState, unmergeAction } from "./actions";
import { REASON_MAX, REASON_MIN } from "./model";

const input = "min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)]";
function Key() {
  const [k] = useState(() => crypto.randomUUID());
  return <input type="hidden" name="key" value={k} />;
}
function Notice({ s }: { s: { error?: string; ok?: string } }) {
  return (
    <>
      {s.error && <p role="alert" className="m-0 text-[var(--danger)] [overflow-wrap:anywhere]">{s.error}</p>}
      {s.ok && <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--success-soft)] px-3 py-2 text-[var(--success)]">{s.ok}</p>}
    </>
  );
}

export function Find({ ctx, side, other }: { ctx: RenderedContext; side: "a" | "b"; other: string | null }) {
  const [s, act, pending] = useActionState<FindState, FormData>(findAction, {});
  const id = useId();
  const pick = (pid: string) => `/pasien/gabung?${new URLSearchParams({ [side]: pid, ...(other ? { [side === "a" ? "b" : "a"]: other } : {}) })}`;
  return (
    <div className="grid min-w-0 gap-2">
      <form action={act} key={`f${s.n ?? 0}`} role="search" className="flex min-w-0 flex-wrap gap-2">
        <ContextFields ctx={ctx} />
        <label htmlFor={id} className="sr-only">Cari pasien {side.toUpperCase()}</label>
        <input id={id} name="q" defaultValue={s.q ?? ""} className={`${input} flex-[1_1_14rem]`} placeholder="Nama, No. RM atau nomor HP" autoComplete="off" />
        <Button type="submit" variant="secondary" aria-disabled={pending}>Cari</Button>
      </form>
      <Notice s={s} />
      {s.rows && (s.rows.length === 0 ? <p className={muted}>Tidak ada pasien yang cocok.</p> : (
        <ul aria-label={`Hasil pencarian ${side.toUpperCase()}`} className="m-0 grid list-none gap-1 p-0">
          {s.rows.map((r) => (
            <li key={r.id}>
              <Link href={pick(r.id)} className="grid min-h-[var(--target)] min-w-0 gap-0.5 rounded-[var(--radius-field)] px-3 py-2 text-[var(--label)] no-underline hover:bg-[var(--accent)]">
                <span className="font-semibold [overflow-wrap:anywhere]">{r.fullName}</span>
                <span className={muted}>{r.mrn} · lahir {r.birthYear}{r.maskedPhone ? ` · ${r.maskedPhone}` : ""}</span>
              </Link>
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}

export function MergeForm({ ctx, a, b }: { ctx: RenderedContext; a: { id: string; label: string }; b: { id: string; label: string } }) {
  const [s, act, pending] = useActionState<MergeState, FormData>(mergeAction, {});
  const id = useId();
  return (
    <form action={act} key={`m${s.n ?? 0}`} aria-label="Gabungkan data pasien" className="grid min-w-0 gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
      <ContextFields ctx={ctx} /><Key />
      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className="mb-1 font-semibold">Data yang dipertahankan</legend>
        {[a, b].map((x, i) => (
          <label key={x.id} className="flex min-h-[var(--target)] items-center gap-2">
            <input type="radio" name="survivor" value={x.id} defaultChecked={i === 0} className="size-5" required />
            <span className="[overflow-wrap:anywhere]">{x.label}</span>
          </label>
        ))}
      </fieldset>
      {/* The duplicate is the side not kept: the action derives it from the pair (model.pairToMerge). */}
      <input type="hidden" name="pair_a" value={a.id} /><input type="hidden" name="pair_b" value={b.id} />
      <label htmlFor={id} className="grid gap-1">
        <span>Alasan penggabungan</span>
        <textarea id={id} name="reason" required minLength={REASON_MIN} maxLength={REASON_MAX} rows={3} className={`${input} py-2`} />
      </label>
      <Notice s={s} />
      <Button type="submit" aria-disabled={pending} className="justify-self-start">Gabungkan</Button>
    </form>
  );
}
export function Unmerge({ ctx, mergeId, label, pair }: { ctx: RenderedContext; mergeId: string; label: string; pair: { a: string | null; b: string | null } }) {
  const [s, act, pending] = useActionState<MergeState, FormData>(unmergeAction, {});
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="grid min-w-0 gap-2">
      <Button type="button" variant="plain" aria-expanded={open} onClick={() => setOpen(!open)} className="justify-self-start">Batalkan Penggabungan</Button>
      {open && (
        <form action={act} key={`u${s.n ?? 0}`} aria-label={`Batalkan penggabungan ${label}`} className="grid min-w-0 gap-2">
          <ContextFields ctx={ctx} /><Key /><input type="hidden" name="merge" value={mergeId} />
          {pair.a && <input type="hidden" name="a" value={pair.a} />}{pair.b && <input type="hidden" name="b" value={pair.b} />}
          <label htmlFor={id} className="grid gap-1"><span>Alasan pembatalan</span>
            <textarea id={id} name="reason" required minLength={REASON_MIN} maxLength={REASON_MAX} rows={2} className={`${input} py-2`} /></label>
          <Button type="submit" variant="destructive" aria-disabled={pending} className="justify-self-start">Batalkan Penggabungan</Button>
        </form>
      )}
      <Notice s={s} />
    </div>
  );
}
