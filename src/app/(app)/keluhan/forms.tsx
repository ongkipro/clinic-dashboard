"use client";
// Keluhan forms (UX-28; T-057). Every write form posts its rendered context (HYG-009 B2-1) and a fresh
// idempotency key (remounted after every answer: n); forms stay mounted after success so the result shows.
import Link from "next/link";
import { useActionState, useId, useState } from "react";
import { ContextFields } from "../../../components/context-fields";
import { Button } from "../../../components/ui/button";
import type { RenderedContext } from "../../../modules/org/context/context";
import { type ComplaintFormState, flagAction, noteAction, reopenAction, resolveAction, takeAction, triageAction } from "./actions";
import { CATEGORY_LABEL, KLINIS_OUTCOMES, LAYANAN_OUTCOMES, OUTCOME_LABEL, TRIAGE, TRIAGE_HINT } from "./labels";

const input = "min-h-[52px] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const area = "min-h-[104px] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white p-3";
const hint = "m-0 text-[0.88rem] text-[var(--label-2)]";

function Notice({ s }: { s: ComplaintFormState }) {
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

export type FlagVisit = { visit_id: string; patient_id: string; patient_name: string; patient_mrn: string; time: string };
export function FlagForm({ ctx, visits, preset, kinds, pharmacist, branch }: {
  ctx: RenderedContext; visits: FlagVisit[]; preset: string | null; kinds: ("klinis" | "layanan")[]; pharmacist: boolean; branch: string | null;
}) {
  const [s, act, pending] = useActionState<ComplaintFormState, FormData>(flagAction, {});
  const [kind, setKind] = useState(kinds[0]);
  const id = useId();
  const pre = visits.find((v) => v.visit_id === preset);
  return (
    <form action={act} key={`f${s.n ?? 0}`} aria-label="Laporkan keluhan" className="grid min-w-0 gap-4">
      <ContextFields ctx={ctx} /><Key />
      {branch && <input type="hidden" name="branch" value={branch} />}
      <div className="grid min-w-0 gap-1">
        <label htmlFor={`${id}-p`} className="font-semibold">Pasien</label>
        <select id={`${id}-p`} name="target" required defaultValue={pre ? `${pre.patient_id}:${pre.visit_id}` : ""} className={input}>
          <option value="" disabled>Pilih pasien kunjungan hari ini</option>
          {visits.map((v) => <option key={v.visit_id} value={`${v.patient_id}:${v.visit_id}`}>{`${v.patient_name} · ${v.patient_mrn} · datang ${v.time}`}</option>)}
        </select>
      </div>
      {kinds.length > 1 ? (
        <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0">
          <legend className="mb-1 font-semibold">Jenis keluhan</legend>
          {kinds.map((k) => (
            <label key={k} className="flex min-h-[44px] items-center gap-3">
              <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="size-5 shrink-0" />
              {k === "klinis" ? "Klinis: reaksi, efek samping, dugaan komplikasi" : "Layanan: waktu tunggu, tagihan, sikap staf"}
            </label>
          ))}
        </fieldset>
      ) : <input type="hidden" name="kind" value={kind} />}
      {kind === "klinis" ? (
        <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0">
          <legend className="mb-1 font-semibold">Triase</legend>
          {(["merah", "kuning", "hijau"] as const).map((t) => (
            <label key={t} className="flex min-h-[44px] items-start gap-3">
              <input type="radio" name="triage" value={t} defaultChecked={t === "kuning"} className="mt-1 size-5 shrink-0" />
              <span>{TRIAGE_HINT[t]}</span>
            </label>
          ))}
        </fieldset>
      ) : (
        <div className="grid min-w-0 gap-1">
          <label htmlFor={`${id}-c`} className="font-semibold">Kategori</label>
          <select id={`${id}-c`} name="category" required defaultValue="" className={input}>
            <option value="" disabled>Pilih kategori</option>
            {Object.entries(CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
      )}
      {pharmacist && kind === "klinis" && <input type="hidden" name="source" value="pharmacist" />}
      <div className="grid min-w-0 gap-1">
        <label htmlFor={`${id}-s`} className="font-semibold">Ringkasan keluhan</label>
        <textarea id={`${id}-s`} name="summary" required minLength={3} maxLength={1000} className={area} />
        <p className={hint}>{kind === "klinis" ? "Tulis apa yang dirasakan pasien dan sejak kapan. Hanya tim klinis yang membaca isi ini." : "Tulis apa yang dikeluhkan pasien. Hanya manajer dan penanggung jawab klinik yang membaca isi ini."}</p>
      </div>
      <Notice s={s} />
      {s.taskId && <Link href={`/keluhan/${s.taskId}`} className="inline-flex min-h-[44px] items-center font-semibold text-[var(--tint)]">Lihat status keluhan</Link>}
      <Button type="submit" size="lg" aria-disabled={pending || visits.length === 0}>{pending ? "Mengirim…" : "Laporkan Keluhan"}</Button>
    </form>
  );
}

function Hidden({ ctx, task }: { ctx: RenderedContext; task: string }) {
  return <><ContextFields ctx={ctx} /><Key /><input type="hidden" name="task" value={task} /></>;
}

export function TakeForm({ ctx, task, open }: { ctx: RenderedContext; task: string; open: boolean }) {
  const [s, act, pending] = useActionState<ComplaintFormState, FormData>(takeAction, {});
  if (!open) return <Notice s={{ ok: s.ok }} />;
  return (
    <form action={act} key={`t${s.n ?? 0}`} aria-label="Tangani keluhan" className="grid min-w-0 gap-2">
      <Hidden ctx={ctx} task={task} />
      <Notice s={s} />
      <Button type="submit" size="lg" aria-disabled={pending}>{pending ? "Menyimpan…" : "Tangani"}</Button>
    </form>
  );
}

export function TriageForm({ ctx, task, current, open }: { ctx: RenderedContext; task: string; current: string; open: boolean }) {
  const [s, act, pending] = useActionState<ComplaintFormState, FormData>(triageAction, {});
  const id = useId();
  if (!open) return <Notice s={{ ok: s.ok }} />;
  return (
    <form action={act} key={`g${s.n ?? 0}`} aria-label="Ubah triase" className="grid min-w-0 gap-2">
      <Hidden ctx={ctx} task={task} />
      <label htmlFor={`${id}-t`}>Triase</label>
      <div className="flex min-w-0 flex-wrap gap-2">
        <select id={`${id}-t`} name="triage" defaultValue={current} className={`${input} max-w-[16rem]`}>
          {Object.entries(TRIAGE).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
        </select>
        <Button type="submit" variant="secondary" aria-disabled={pending}>Ubah Triase</Button>
      </div>
      <Notice s={s} />
    </form>
  );
}

export function NoteForm({ ctx, task }: { ctx: RenderedContext; task: string }) {
  const [s, act, pending] = useActionState<ComplaintFormState, FormData>(noteAction, {});
  const id = useId();
  return (
    <form action={act} key={`n${s.n ?? 0}`} aria-label="Tambah catatan" className="grid min-w-0 gap-2">
      <Hidden ctx={ctx} task={task} />
      <label htmlFor={`${id}-n`}>Catatan penanganan</label>
      <textarea id={`${id}-n`} name="note" required minLength={3} maxLength={1000} className={area} />
      <Notice s={s} />
      <Button type="submit" variant="secondary" aria-disabled={pending}>Simpan Catatan</Button>
    </form>
  );
}

// Stays mounted after resolving (done: only the notice) so the result shows.
export function ResolveForm({ ctx, task, kind, done }: { ctx: RenderedContext; task: string; kind: "klinis" | "layanan"; done: boolean }) {
  const [s, act, pending] = useActionState<ComplaintFormState, FormData>(resolveAction, {});
  const id = useId();
  if (done) return <Notice s={{ ok: s.ok }} />;
  const outcomes = kind === "klinis" ? KLINIS_OUTCOMES : LAYANAN_OUTCOMES;
  return (
    <form action={act} key={`r${s.n ?? 0}`} aria-label="Selesaikan keluhan" className="grid min-w-0 gap-2">
      <Hidden ctx={ctx} task={task} />
      <label htmlFor={`${id}-o`}>Hasil penanganan</label>
      <select id={`${id}-o`} name="outcome" required defaultValue="" className={input}>
        <option value="" disabled>Pilih hasil</option>
        {outcomes.map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
      </select>
      <label htmlFor={`${id}-n`}>Catatan penyelesaian</label>
      <textarea id={`${id}-n`} name="note" required minLength={3} maxLength={1000} className={area} />
      <Notice s={s} />
      <Button type="submit" aria-disabled={pending}>{pending ? "Menyimpan…" : "Selesaikan"}</Button>
    </form>
  );
}

export function ReopenForm({ ctx, task, open }: { ctx: RenderedContext; task: string; open: boolean }) {
  const [s, act, pending] = useActionState<ComplaintFormState, FormData>(reopenAction, {});
  const id = useId();
  if (!open) return <Notice s={{ ok: s.ok }} />;
  return (
    <details className="min-w-0">
      <summary className="flex min-h-[44px] cursor-pointer items-center text-[var(--tint)]">Buka Kembali</summary>
      <form action={act} key={`o${s.n ?? 0}`} aria-label="Buka kembali keluhan" className="grid min-w-0 gap-2 pt-2">
        <Hidden ctx={ctx} task={task} />
        <label htmlFor={`${id}-n`}>Alasan membuka kembali</label>
        <input id={`${id}-n`} name="note" required minLength={3} maxLength={1000} className={input} />
        <Notice s={s} />
        <Button type="submit" variant="secondary" aria-disabled={pending}>Buka Kembali</Button>
      </form>
    </details>
  );
}
