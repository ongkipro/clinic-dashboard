"use client";
// Ruang Tindakan forms (UX-9; T-064). Every write form posts its rendered context (HYG-009 B2-1) and a fresh
// idempotency key (remounted after every answer: n); forms stay mounted after success so the result shows. The timer
// is computed here from the database's stage start and clock offset; reaching any length changes nothing (UX-9).
import { useActionState, useEffect, useId, useState } from "react";
import { ContextFields } from "../../../components/context-fields";
import { Button } from "../../../components/ui/button";
import type { RenderedContext } from "../../../modules/org/context/context";
import type { Outcome, Stage } from "../../../modules/treatment/treatment";
import { extraMaterialAction, finishAction, type RoomFormState, startAction, timerAction } from "./actions";
import { OUTCOME_LABEL, OUTCOME_NOTE, STAGE_LABEL } from "./labels";

const input = "min-h-[52px] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const hint = "m-0 text-[0.88rem] text-[var(--label-2)]";
const row = "flex min-h-[52px] min-w-0 items-center gap-3";

function Notice({ s }: { s: RoomFormState }) {
  return (
    <>
      {s.error && (
        <div role="alert" className="grid min-w-0 gap-1 text-[var(--danger)]">
          <p className="m-0">{s.error}</p>
          {s.blockers && s.blockers.length > 0 && <ul className="m-0 grid gap-1 pl-5">{s.blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
        </div>
      )}
      {s.ok && <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--success-soft)] px-3 py-2 text-[var(--success)]">{s.ok}</p>}
    </>
  );
}
function Key() {
  const [k] = useState(() => crypto.randomUUID());
  return <input type="hidden" name="key" value={k} />;
}

// The running stage time (mm:ss), from the stage start shifted by the server/browser clock offset; frozen while paused.
export function StageTimer({ stageStartedAt, pausedAt, serverNow }: { stageStartedAt: string; pausedAt: string | null; serverNow: string }) {
  const [offset] = useState(() => new Date(serverNow).getTime() - Date.now());
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    if (pausedAt) return;
    const t = setInterval(() => setNow(Date.now() + offset), 1_000);
    return () => clearInterval(t);
  }, [pausedAt, offset]);
  const end = pausedAt ? new Date(pausedAt).getTime() : now;
  const s = Math.max(0, Math.floor((end - new Date(stageStartedAt).getTime()) / 1_000));
  const text = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return <span role="timer" aria-label={`Waktu tahap ${text}${pausedAt ? ", dijeda" : ""}`} className="text-[1.75rem] font-bold tabular-nums">{text}</span>;
}

type Person = { staff_id: string; name: string };
type Choice = { id: string; name: string };
// "Sebelum mulai" (UX-9): identity, consent and blockers (from the database), materials, performer. Mulai is the one
// prominent action, enabled only when the list is complete.
export function StartForm({ ctx, visit, item, performers, supervisors, assistants, rooms, requests, blockers, me }: {
  ctx: RenderedContext; visit: string; item: { id: string; name: string }; performers: (Person & { mode: string; credential_ok: boolean })[];
  supervisors: Person[]; assistants: Person[]; rooms: Choice[]; requests: Choice[]; blockers: string[]; me: string;
}) {
  const [s, act, pending] = useActionState<RoomFormState, FormData>(startAction, {});
  const [identity, setIdentity] = useState(false);
  const [performer, setPerformer] = useState(performers.some((p) => p.staff_id === me) ? me : "");
  const id = useId();
  const chosen = performers.find((p) => p.staff_id === performer);
  const ready = identity && !!chosen && blockers.length === 0;
  return (
    <form action={act} key={`s${s.n ?? 0}`} aria-label={`Sebelum mulai ${item.name}`} className="grid min-w-0 gap-3">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="visit" value={visit} /><input type="hidden" name="item" value={item.id} />
      <ul aria-label="Sebelum mulai" className="m-0 grid min-w-0 list-none gap-0 p-0">
        <li className={row}>
          <input id={`${id}-i`} type="checkbox" name="identity" checked={identity} onChange={(e) => setIdentity(e.target.checked)} className="size-5 shrink-0" />
          <label htmlFor={`${id}-i`} className="min-w-0 [overflow-wrap:anywhere]">Identitas pasien sudah dicocokkan (nama dan tanggal lahir)</label>
        </li>
        <li className={row}>
          <span aria-hidden className="size-5 shrink-0 text-center">{blockers.length === 0 ? "✓" : "!"}</span>
          <span className="min-w-0 [overflow-wrap:anywhere]">{blockers.length === 0 ? "Persetujuan tindakan, pemeriksaan, dan pembayaran siap" : "Belum siap — lihat kendala di atas"}</span>
        </li>
        <li className={row}>
          <span aria-hidden className="size-5 shrink-0 text-center">{requests.length > 0 ? "✓" : "–"}</span>
          <span className="min-w-0 [overflow-wrap:anywhere]">{requests.length > 0 ? "Bahan sudah dikeluarkan apoteker" : "Tanpa bahan dari apotek (minta lewat Bahan Tambahan bila perlu)"}</span>
        </li>
      </ul>
      <div className="grid min-w-0 gap-1">
        <label htmlFor={`${id}-p`} className="font-semibold">Pelaksana</label>
        <select id={`${id}-p`} name="performer" value={performer} onChange={(e) => setPerformer(e.target.value)} required className={input}>
          <option value="" disabled>Pilih pelaksana</option>
          {performers.map((p) => <option key={p.staff_id} value={p.staff_id}>{`${p.name}${p.mode === "supervised" ? " (perlu supervisi dokter)" : ""}${p.credential_ok ? "" : " — STR/SIP belum berlaku"}`}</option>)}
        </select>
        {performers.length === 0 && <p className={hint}>Belum ada staf yang berwenang untuk tindakan ini di cabang ini.</p>}
      </div>
      {chosen?.mode === "supervised" && (
        <div className="grid min-w-0 gap-1">
          <label htmlFor={`${id}-sv`} className="font-semibold">Dokter supervisi</label>
          <select id={`${id}-sv`} name="supervisor" required defaultValue="" className={input}>
            <option value="" disabled>Pilih dokter</option>
            {supervisors.filter((x) => x.staff_id !== performer).map((x) => <option key={x.staff_id} value={x.staff_id}>{x.name}</option>)}
          </select>
        </div>
      )}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 min-[700px]:grid-cols-2">
        <div className="grid min-w-0 gap-1">
          <label htmlFor={`${id}-a`} className="font-semibold">Asisten (opsional)</label>
          <select id={`${id}-a`} name="assistant" defaultValue="" className={input}>
            <option value="">Tanpa asisten</option>
            {assistants.filter((x) => x.staff_id !== performer).map((x) => <option key={x.staff_id} value={x.staff_id}>{x.name}</option>)}
          </select>
        </div>
        <div className="grid min-w-0 gap-1">
          <label htmlFor={`${id}-r`} className="font-semibold">Ruang</label>
          <select id={`${id}-r`} name="room" defaultValue="" className={input}>
            <option value="">{requests.length > 0 ? "Ikuti depot bahan" : "Belum ditentukan"}</option>
            {rooms.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </div>
      </div>
      {requests.length > 0 && <input type="hidden" name="request" value={requests[0].id} />}
      <Notice s={s} />
      <Button type="submit" size="lg" aria-disabled={pending || !ready}>{pending ? "Memulai…" : "Mulai"}</Button>
      {!ready && <p className={hint}>Mulai aktif setelah semua butir siap dan pelaksana dipilih.</p>}
    </form>
  );
}

// The stage stepper and Jeda / Lanjut: plain buttons (the view's one prominent action is Selesai Tindakan). The next
// stage travels as the submit button's value.
export function TimerControls({ ctx, execution, stage, paused, stages }: { ctx: RenderedContext; execution: string; stage: Stage; paused: boolean; stages: readonly Stage[] }) {
  const [s, act, pending] = useActionState<RoomFormState, FormData>(timerAction, {});
  const nextStage = stages[stages.indexOf(stage) + 1];
  return (
    <form action={act} key={`t${s.n ?? 0}`} aria-label="Tahap dan jeda" className="grid min-w-0 gap-2">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="execution" value={execution} />
      <Notice s={s} />
      <div className="flex min-w-0 flex-wrap gap-2">
        {!paused && nextStage && (
          <Button type="submit" name="next" value={`stage:${nextStage}`} variant="secondary" aria-disabled={pending}>{`Lanjut ke ${STAGE_LABEL[nextStage]}`}</Button>
        )}
        {paused
          ? <Button type="submit" name="next" value="resume" variant="secondary" aria-disabled={pending}>Lanjutkan</Button>
          : <Button type="submit" name="next" value="pause" variant="plain" aria-disabled={pending}>Jeda</Button>}
      </div>
    </form>
  );
}

type Line = { request: string; item: string; name: string; unit: string; issued: number; open: number };
// Selesai Tindakan (UX-9): a sheet of four large outcomes, a reason for a stop, then material deviations only.
export function FinishForm({ ctx, execution, lines }: { ctx: RenderedContext; execution: string; lines: Line[] }) {
  const [s, act, pending] = useActionState<RoomFormState, FormData>(finishAction, {});
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | "">("");
  const [deviate, setDeviate] = useState(false);
  const id = useId();
  if (s.ok) return <Notice s={s} />;
  if (!open) return <Button type="button" size="lg" onClick={() => setOpen(true)}>Selesai Tindakan</Button>;
  return (
    <form action={act} key={`f${s.n ?? 0}`} aria-label="Selesai tindakan" className="grid min-w-0 gap-3 rounded-[var(--radius-field)] border border-[var(--control-border)] p-4">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="execution" value={execution} />
      <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0">
        <legend className="mb-1 text-[1.25rem] font-semibold">Hasil tindakan</legend>
        {(Object.keys(OUTCOME_LABEL) as Outcome[]).map((o) => (
          <label key={o} className={`grid min-h-[64px] min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 rounded-[var(--radius-field)] border px-4 py-2 ${outcome === o ? "border-[var(--tint)]" : "border-[var(--control-border)]"}`}>
            <input type="radio" name="outcome" value={o} checked={outcome === o} onChange={() => setOutcome(o)} className="row-span-2 size-5" />
            <span className="font-semibold">{OUTCOME_LABEL[o]}</span>
            <span className={hint}>{OUTCOME_NOTE[o]}</span>
          </label>
        ))}
      </fieldset>
      {outcome && outcome !== "completed" && (
        <div className="grid min-w-0 gap-1">
          <label htmlFor={`${id}-r`} className="font-semibold">Alasan penghentian</label>
          <input id={`${id}-r`} name="reason" required minLength={3} maxLength={500} className={input} />
        </div>
      )}
      {lines.length > 0 && (
        <div className="grid min-w-0 gap-2">
          <p className="m-0 font-semibold">Bahan</p>
          <p className={hint}>Bahan dianggap terpakai sesuai yang dikeluarkan. Isi hanya bila berbeda.</p>
          {!deviate && <Button type="button" variant="plain" onClick={() => setDeviate(true)}>Ada penyimpangan bahan</Button>}
          {deviate && lines.map((l) => (
            <div key={`${l.request}:${l.item}`} className="grid min-w-0 grid-cols-[minmax(0,1fr)_8rem] items-center gap-2">
              <label htmlFor={`${id}-${l.request}-${l.item}`} className="[overflow-wrap:anywhere]">{`${l.name} (dikeluarkan ${l.issued} ${l.unit}, sisa ${l.open})`}</label>
              <input id={`${id}-${l.request}-${l.item}`} name={`m:${l.request}:${l.item}`} inputMode="decimal" placeholder={String(l.open)} className={input} />
            </div>
          ))}
        </div>
      )}
      <Notice s={s} />
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button type="submit" size="lg" aria-disabled={pending || !outcome}>{pending ? "Menyimpan…" : "Simpan Hasil"}</Button>
        <Button type="button" variant="plain" onClick={() => setOpen(false)}>Batal</Button>
      </div>
    </form>
  );
}

// Bahan Tambahan (UX-9 quick action): a new material request for this item; the pharmacist issues it.
export function ExtraMaterialForm({ ctx, visit, item, depots, stock }: { ctx: RenderedContext; visit: string; item: string; depots: Choice[]; stock: { id: string; name: string; unit: string }[] }) {
  const [s, act, pending] = useActionState<RoomFormState, FormData>(extraMaterialAction, {});
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!open) return (<><Notice s={s} /><Button type="button" variant="plain" onClick={() => setOpen(true)}>Bahan Tambahan</Button></>);
  return (
    <form action={act} key={`x${s.n ?? 0}`} aria-label="Bahan tambahan" className="grid min-w-0 gap-2">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="visit" value={visit} /><input type="hidden" name="item" value={item} />
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 min-[700px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem]">
        <div className="grid min-w-0 gap-1">
          <label htmlFor={`${id}-s`}>Bahan</label>
          <select id={`${id}-s`} name="stock" required defaultValue="" className={input}>
            <option value="" disabled>Pilih bahan</option>
            {stock.map((x) => <option key={x.id} value={x.id}>{`${x.name} (${x.unit})`}</option>)}
          </select>
        </div>
        <div className="grid min-w-0 gap-1">
          <label htmlFor={`${id}-d`}>Depot ruang</label>
          <select id={`${id}-d`} name="depot" required defaultValue={depots[0]?.id ?? ""} className={input}>
            {depots.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </div>
        <div className="grid min-w-0 gap-1">
          <label htmlFor={`${id}-q`}>Jumlah</label>
          <input id={`${id}-q`} name="qty" inputMode="decimal" required className={input} />
        </div>
      </div>
      <Notice s={s} />
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button type="submit" variant="secondary" aria-disabled={pending || depots.length === 0}>Kirim ke Apoteker</Button>
        <Button type="button" variant="plain" onClick={() => setOpen(false)}>Tutup</Button>
      </div>
      {depots.length === 0 && <p className={hint}>Belum ada depot ruang di cabang ini. Apoteker membuatnya di Stok › Depot.</p>}
    </form>
  );
}
