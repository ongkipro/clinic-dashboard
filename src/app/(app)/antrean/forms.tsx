"use client";
// Antrean forms (UX-6 ▸ Antrean, PR-71, T-048). Every write form posts its rendered context (HYG-009 B2-1)
// and a per-mount idempotency key (a retry replays; a remount after an answer gets a new key). The search
// is a POST (the query never goes into a URL); the pairing link is shown once in this answer only.
import Link from "next/link";
import { useActionState, useId, useState } from "react";
import { ContextFields } from "../../../components/context-fields";
import { Button } from "../../../components/ui/button";
import type { RenderedContext } from "../../../modules/org/context/context";
import { callAction, type FindState, findPatientAction, pairAction, type QueueState, revokeAction, skipAction, walkInAction } from "./actions";

const input = "min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const hintCls = "m-0 text-[0.88rem] text-[var(--label-2)]";

function Notice({ s }: { s: { error?: string; ok?: string } }) {
  return (
    <>
      {s.error && <p role="alert" className="m-0 text-[var(--danger)]">{s.error}</p>}
      {s.ok && <p role="status" className="m-0 text-[var(--success)]">{s.ok}</p>}
    </>
  );
}
function Key() {
  const [k] = useState(() => crypto.randomUUID());
  return <input type="hidden" name="key" value={k} />;
}
function Branch({ branch }: { branch: string | null }) {
  return branch ? <input type="hidden" name="branch" value={branch} /> : null;
}

// Pasien Datang tanpa janji: search an existing patient, then open a walk-in visit with the next number.
export function WalkIn({ ctx, branch }: { ctx: RenderedContext; branch: string | null }) {
  const [f, find, finding] = useActionState<FindState, FormData>(findPatientAction, {});
  const [s, act, pending] = useActionState<QueueState, FormData>(walkInAction, {});
  const id = useId();
  return (
    <div className="grid min-w-0 gap-3">
      <form action={find} aria-label="Cari pasien" className="grid min-w-0 gap-2">
        <ContextFields ctx={ctx} />
        <label htmlFor={id} className="font-semibold">Cari pasien (nama, No. RM atau nomor HP)</label>
        <div className="flex min-w-0 flex-wrap gap-2">
          <input id={id} name="q" className={`${input} flex-1 basis-56`} defaultValue={f.q ?? ""} autoComplete="off" />
          <Button type="submit" variant="secondary" aria-disabled={finding}>Cari</Button>
        </div>
        <Notice s={f} />
      </form>
      {f.matches && (f.matches.length === 0
        ? (
          <div className="grid min-w-0 gap-1">
            <p className={hintCls}>Tidak ada pasien yang cocok.</p>
            <Link className="inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--tint)]" href="/pasien/baru">Daftarkan pasien baru</Link>
          </div>
        )
        : (
          <ul className="m-0 grid min-w-0 list-none gap-2 p-0" aria-label="Hasil pencarian">
            {f.matches.map((m) => (
              <li key={m.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-[var(--radius-field)] border border-[var(--separator)] p-3">
                <span className="min-w-0 [overflow-wrap:anywhere]"><strong>{m.fullName}</strong> <span className={hintCls}>· {m.mrn} · lahir {m.birthYear}{m.maskedPhone ? ` · ${m.maskedPhone}` : ""}</span></span>
                <form action={act} key={`w${s.n ?? 0}-${m.id}`} aria-label={`Daftarkan kunjungan ${m.fullName}`}>
                  <ContextFields ctx={ctx} /><Key /><Branch branch={branch} /><input type="hidden" name="patient" value={m.id} />
                  <Button type="submit" aria-disabled={pending}>Daftarkan Kunjungan</Button>
                </form>
              </li>
            ))}
          </ul>
        ))}
      {s.number && <p role="status" className="m-0 text-[1.5rem] font-bold text-[var(--success)]">Nomor antrean {s.number}</p>}
      {s.error && <p role="alert" className="m-0 text-[var(--danger)]">{s.error}</p>}
    </div>
  );
}

export function TicketActions({ ctx, ticket, label, rooms, state }: { ctx: RenderedContext; ticket: string; label: string; rooms: { id: string; name: string }[]; state: string }) {
  const [c, call, pc] = useActionState<QueueState, FormData>(callAction, {});
  const [k, skip, pk] = useActionState<QueueState, FormData>(skipAction, {});
  const id = useId();
  if (state === "done") return null;
  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex min-w-0 flex-wrap items-end gap-2">
        {rooms.length > 0 ? (
          <form action={call} key={`c${c.n ?? 0}`} aria-label={`Panggil ${label}`} className="flex min-w-0 flex-wrap items-end gap-2">
            <ContextFields ctx={ctx} /><Key /><input type="hidden" name="ticket" value={ticket} />
            <div className="grid min-w-0 gap-1">
              <label htmlFor={id} className={hintCls}>Ruang</label>
              <select id={id} name="room" className={input}>{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
            </div>
            <Button type="submit" variant="secondary" aria-disabled={pc}>{state === "called" ? "Panggil Ulang" : "Panggil"}</Button>
          </form>
        ) : <p className={hintCls}>Tambahkan ruang di Pengaturan › Cabang untuk memanggil.</p>}
        {state !== "skipped" && (
          <form action={skip} key={`s${k.n ?? 0}`} aria-label={`Lewati ${label}`}>
            <ContextFields ctx={ctx} /><Key /><input type="hidden" name="ticket" value={ticket} />
            <Button type="submit" variant="plain" aria-disabled={pk}>Lewati</Button>
          </form>
        )}
      </div>
      <Notice s={c} /><Notice s={k} />
    </div>
  );
}

export function PairDisplay({ ctx, branch }: { ctx: RenderedContext; branch: string | null }) {
  const [s, act, pending] = useActionState<QueueState, FormData>(pairAction, {});
  const id = useId();
  return (
    <div className="grid min-w-0 gap-2">
      <form action={act} key={`p${s.n ?? 0}`} aria-label="Pasangkan layar TV" className="flex min-w-0 flex-wrap items-end gap-2">
        <ContextFields ctx={ctx} /><Key /><Branch branch={branch} />
        <div className="grid min-w-0 flex-1 basis-56 gap-1">
          <label htmlFor={id} className="font-semibold">Nama layar</label>
          <input id={id} name="label" className={input} placeholder="TV Lobi" />
        </div>
        <Button type="submit" variant="secondary" aria-disabled={pending}>Pasangkan Layar TV</Button>
      </form>
      <Notice s={s} />
      {s.link && <p className="m-0 break-all rounded-[var(--radius-field)] bg-[var(--surface-2)] p-3 font-mono text-[0.88rem]">{s.link}</p>}
    </div>
  );
}

export function RevokeDisplay({ ctx, display, label }: { ctx: RenderedContext; display: string; label: string }) {
  const [s, act, pending] = useActionState<QueueState, FormData>(revokeAction, {});
  return (
    <div className="grid min-w-0 gap-1">
      <form action={act} key={`r${s.n ?? 0}`} aria-label={`Cabut ${label}`}>
        <ContextFields ctx={ctx} /><Key /><input type="hidden" name="display" value={display} />
        <Button type="submit" variant="destructive" aria-disabled={pending}>Cabut</Button>
      </form>
      <Notice s={s} />
    </div>
  );
}
