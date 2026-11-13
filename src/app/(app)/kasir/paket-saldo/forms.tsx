"use client";
// Paket & Saldo forms (UX-13; T-076). Each write form posts its rendered context and a fresh idempotency key (remounted
// after every answer: n). Pesan Sesi says what is still needed when the paid value does not cover the next session.
import Link from "next/link";
import { useActionState, useId, useState } from "react";
import { ContextFields } from "../../../../components/context-fields";
import { Button } from "../../../../components/ui/button";
import type { RenderedContext } from "../../../../modules/org/context/context";
import { cancelAction, contentsAction, type PaketState, releaseAction, reserveAction, topUpAction } from "./actions";

const input = "min-h-[52px] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const hint = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
const field = "grid min-w-0 gap-1";
const box = "grid min-w-0 gap-3 rounded-[var(--radius-field)] bg-[var(--surface)] p-4";

function Notice({ s }: { s: PaketState }) {
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
const time = (iso: string) => new Intl.DateTimeFormat("id-ID", { timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));

// Pesan Sesi: a visit of today at this branch (the newest by default) and, for a mixed package, the service.
export function ReserveForm({ ctx, pkg, visits, services, blocked }: {
  ctx: RenderedContext; pkg: string; visits: { id: string; checked_in_at: string }[]; services: { id: string; name: string }[]; blocked: string | null;
}) {
  const [s, act, pending] = useActionState<PaketState, FormData>(reserveAction, {});
  const id = useId();
  if (blocked) return <p className={hint}>{blocked}</p>;
  if (visits.length === 0) return <p className={hint}>Pesan Sesi tersedia setelah pasien datang hari ini (Hari Ini › Catat Datang).</p>;
  return (
    <form action={act} key={`r${s.n ?? 0}`} aria-label="Pesan sesi" className="grid min-w-0 gap-2">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="package" value={pkg} />
      {visits.length > 1 ? (
        <label htmlFor={`${id}-v`} className={field}><span>Kunjungan</span>
          <select id={`${id}-v`} name="visit" className={input}>{visits.map((v) => <option key={v.id} value={v.id}>{`Datang ${time(v.checked_in_at)}`}</option>)}</select>
        </label>
      ) : <input type="hidden" name="visit" value={visits[0].id} />}
      {services.length > 1 && (
        <label htmlFor={`${id}-s`} className={field}><span>Layanan</span>
          <select id={`${id}-s`} name="service" className={input}>{services.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        </label>
      )}
      <Notice s={s} />
      <Button type="submit" aria-disabled={pending} className="justify-self-start">Pesan Sesi</Button>
    </form>
  );
}

export function ReleaseForm({ ctx, session }: { ctx: RenderedContext; session: string }) {
  const [s, act, pending] = useActionState<PaketState, FormData>(releaseAction, {});
  return (
    <form action={act} key={`x${s.n ?? 0}`} aria-label="Batal pesan sesi" className="grid min-w-0 gap-1">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="session" value={session} />
      <Notice s={s} />
      <Button type="submit" variant="plain" aria-disabled={pending} className="justify-self-start">Batal Pesan</Button>
    </form>
  );
}

export function CancelForm({ ctx, pkg }: { ctx: RenderedContext; pkg: string }) {
  const [s, act, pending] = useActionState<PaketState, FormData>(cancelAction, {});
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!open && !s.error) return <Button type="button" variant="plain" className="justify-self-start text-[var(--danger)]" onClick={() => setOpen(true)}>Batalkan Paket</Button>;
  return (
    <form action={act} key={`c${s.n ?? 0}`} aria-label="Batalkan paket" className="grid min-w-0 gap-2 border-t border-[var(--separator)] pt-3">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="package" value={pkg} />
      <p className={hint}>Nilai yang sudah dibayar dan belum terpakai masuk saldo pasien. Sisa yang belum dibayar dibatalkan, bukan utang.</p>
      <label htmlFor={`${id}-r`} className={field}><span>Alasan</span><textarea id={`${id}-r`} name="reason" rows={2} minLength={3} maxLength={500} required className={`${input} py-2`} /></label>
      <Notice s={s} />
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button type="submit" variant="destructive" aria-disabled={pending}>Batalkan Paket</Button>
        <Button type="button" variant="plain" onClick={() => setOpen(false)}>Kembali</Button>
      </div>
    </form>
  );
}

// Isi Saldo: tunai (with change), EDC or transfer (SET-14); a KW receipt.
export function TopUpForm({ ctx, patient, branch }: { ctx: RenderedContext; patient: string; branch: string | null }) {
  const [s, act, pending] = useActionState<PaketState, FormData>(topUpAction, {});
  const [method, setMethod] = useState<"cash" | "edc" | "transfer">("cash");
  const id = useId();
  return (
    <form action={act} key={`t${s.n ?? 0}`} aria-label="Isi saldo" className={box}>
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="patient" value={patient} /><input type="hidden" name="method" value={method} />
      {branch && <input type="hidden" name="branch" value={branch} />}
      <h3 className="m-0 text-[1.06rem] font-semibold">Isi Saldo</h3>
      <div role="group" aria-label="Metode" className="flex min-w-0 flex-wrap gap-2">
        {(["cash", "edc", "transfer"] as const).map((m) => (
          <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)}
            className={`min-h-[44px] rounded-full px-4 text-[0.94rem] font-semibold ${method === m ? "bg-[var(--tint)] text-white" : "bg-[var(--surface-2)] text-[var(--label)]"}`}>
            {m === "cash" ? "Tunai" : m === "edc" ? "EDC" : "Transfer"}
          </button>
        ))}
      </div>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 min-[700px]:grid-cols-2">
        <label htmlFor={`${id}-a`} className={field}><span>Jumlah</span><input id={`${id}-a`} name="amount" inputMode="numeric" required className={input} /></label>
        {method === "cash" && <label htmlFor={`${id}-t`} className={field}><span>Uang diterima</span><input id={`${id}-t`} name="tendered" inputMode="numeric" className={input} /></label>}
      </div>
      <Notice s={s} />
      {s.receipt && <Link href={`/kasir/struk/${s.receipt}`} className="inline-flex min-h-[44px] items-center self-start font-semibold text-[var(--tint)]">Lihat Struk</Link>}
      <Button type="submit" aria-disabled={pending} className="justify-self-start">Isi Saldo</Button>
    </form>
  );
}

// Isi Paket: rows of service × count, in order (owner, admin pusat; unsold versions only).
export function ContentsForm({ ctx, version, rows, services }: {
  ctx: RenderedContext; version: string; rows: { service_item_id: string; count: number }[]; services: { id: string; name: string }[];
}) {
  const [s, act, pending] = useActionState<PaketState, FormData>(contentsAction, {});
  const [list, setList] = useState(() => (rows.length ? rows : [{ service_item_id: services[0]?.id ?? "", count: 1 }]).map((r, k) => ({ ...r, k })));
  const id = useId();
  return (
    <form action={act} key={`p${s.n ?? 0}`} aria-label="Isi paket" className={box}>
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="version" value={version} />
      <ol className="m-0 grid min-w-0 list-none gap-2 p-0">
        {list.map((r, i) => (
          <li key={r.k} className="grid min-w-0 grid-cols-[minmax(0,1fr)_6rem] items-end gap-2 border-b border-[var(--separator)] pb-2">
            <label htmlFor={`${id}-s${r.k}`} className={field}><span>{`Layanan ${i + 1}`}</span>
              <select id={`${id}-s${r.k}`} name={`svc:${i}`} defaultValue={r.service_item_id} className={input}>{services.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
            </label>
            <label htmlFor={`${id}-c${r.k}`} className={field}><span>Sesi</span><input id={`${id}-c${r.k}`} name={`cnt:${i}`} type="number" min={1} max={50} defaultValue={r.count} className={input} /></label>
            {list.length > 1 && <Button type="button" variant="plain" className="col-span-2 justify-self-start" onClick={() => setList((x) => x.filter((y) => y.k !== r.k))}>Hapus baris</Button>}
          </li>
        ))}
      </ol>
      {list.length < 20 && <Button type="button" variant="secondary" className="justify-self-start" onClick={() => setList((x) => [...x, { service_item_id: services[0]?.id ?? "", count: 1, k: Date.now() }])}>Tambah Layanan</Button>}
      <Notice s={s} />
      <Button type="submit" aria-disabled={pending} className="justify-self-start">Simpan Isi Paket</Button>
    </form>
  );
}
