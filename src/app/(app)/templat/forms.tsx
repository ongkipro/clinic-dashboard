"use client";
// Templat Dokumen and Surat forms (UX-54, PR-74; T-058). Every write form posts its rendered context (HYG-009 B2-1)
// and a fresh idempotency key (remounted after every answer: n); forms stay mounted after success so the result
// shows. One prominent action per form.
import Link from "next/link";
import { useActionState, useId, useState } from "react";
import { ContextFields } from "../../../components/context-fields";
import { Button } from "../../../components/ui/button";
import type { RenderedContext } from "../../../modules/org/context/context";
import { correctLetterAction, createLetterAction, type DocFormState, retireTemplateAction, saveLetterAction, saveTemplateAction } from "./actions";
import { KIND_LABEL, LETTER_TYPE_LABEL, PAPER_LABEL, PLACEHOLDER_HINT } from "./labels";

const input = "min-h-[52px] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const area = "min-h-[240px] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white p-3 font-mono text-[0.94rem]";
const hint = "m-0 text-[0.88rem] text-[var(--label-2)]";

function Notice({ s }: { s: DocFormState }) {
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
function Placeholders({ required, allowed }: { required: string[]; allowed: string[] }) {
  return (
    <details className="min-w-0">
      <summary className="flex min-h-[44px] cursor-pointer items-center text-[var(--tint)]">Daftar isian</summary>
      <ul className="m-0 grid min-w-0 list-none gap-1 p-0 pt-2">
        {allowed.map((k) => (
          <li key={k} className="min-w-0 [overflow-wrap:anywhere]">
            <code>{`{{${k}}}`}</code> — {PLACEHOLDER_HINT[k] ?? k}{required.includes(k) ? " (wajib)" : ""}
          </li>
        ))}
      </ul>
    </details>
  );
}

// Simpan Versi for an existing template, or the first version of a new one (kinds offered by role).
export function TemplateForm({ ctx, template, kinds, body, paper, kind, required, allowed, used }: {
  ctx: RenderedContext; template: string | null; kinds: string[]; body: string; paper: string; kind: string | null;
  required: string[]; allowed: string[]; used: boolean;
}) {
  const [s, act, pending] = useActionState<DocFormState, FormData>(saveTemplateAction, {});
  const [k, setK] = useState(kind ?? kinds[0]);
  const id = useId();
  return (
    <form action={act} key={`t${s.n ?? 0}`} aria-label={template ? "Simpan versi templat" : "Buat templat"} className="grid min-w-0 gap-3">
      <ContextFields ctx={ctx} /><Key />
      {template && <input type="hidden" name="template" value={template} />}
      {used && <p role="note" className="m-0 rounded-[var(--radius-field)] bg-[var(--warning-soft)] px-3 py-2 text-[var(--warning)]">Versi sudah dipakai — buat versi baru. Versi lama tetap tersimpan.</p>}
      {!template && (
        <>
          <div className="grid min-w-0 gap-1">
            <label htmlFor={`${id}-k`} className="font-semibold">Jenis</label>
            <select id={`${id}-k`} name="kind" value={k} onChange={(e) => setK(e.target.value)} className={input}>
              {kinds.map((x) => <option key={x} value={x}>{KIND_LABEL[x]}</option>)}
            </select>
          </div>
          {k === "letter" && (
            <div className="grid min-w-0 gap-1">
              <label htmlFor={`${id}-l`} className="font-semibold">Jenis surat</label>
              <select id={`${id}-l`} name="letter_type" defaultValue="surat_keterangan" className={input}>
                {Object.entries(LETTER_TYPE_LABEL).map(([x, l]) => <option key={x} value={x}>{l}</option>)}
              </select>
            </div>
          )}
          <div className="grid min-w-0 gap-1">
            <label htmlFor={`${id}-n`} className="font-semibold">Nama templat</label>
            <input id={`${id}-n`} name="name" required minLength={3} maxLength={120} className={input} />
          </div>
        </>
      )}
      <div className="grid min-w-0 gap-1">
        <label htmlFor={`${id}-p`} className="font-semibold">Ukuran kertas</label>
        <select id={`${id}-p`} name="paper" defaultValue={paper} className={input}>
          {Object.entries(PAPER_LABEL).filter(([x]) => k === "receipt" || x === "a4").map(([x, l]) => <option key={x} value={x}>{l}</option>)}
        </select>
      </div>
      <div className="grid min-w-0 gap-1">
        <label htmlFor={`${id}-b`} className="font-semibold">Isi templat</label>
        <textarea id={`${id}-b`} name="body" required minLength={10} maxLength={20000} defaultValue={body} className={area} />
        <p className={hint}>Gunakan isian seperti {"{{pasien.nama}}"}; jangan menulis data pasien langsung.</p>
      </div>
      {required.length > 0 && <Placeholders required={required} allowed={allowed} />}
      <Notice s={s} />
      {!template && s.id && <Link href={`/templat/dokumen/${s.id}`} className="inline-flex min-h-[44px] items-center font-semibold text-[var(--tint)]">Buka templat</Link>}
      <Button type="submit" size="lg" aria-disabled={pending}>{pending ? "Menyimpan…" : "Simpan Versi"}</Button>
    </form>
  );
}

export function RetireForm({ ctx, template, active }: { ctx: RenderedContext; template: string; active: boolean }) {
  const [s, act, pending] = useActionState<DocFormState, FormData>(retireTemplateAction, {});
  if (!active) return <Notice s={{ ok: s.ok }} />;
  return (
    <details className="min-w-0">
      <summary className="flex min-h-[44px] cursor-pointer items-center text-[var(--danger)]">Pensiunkan Templat</summary>
      <form action={act} key={`r${s.n ?? 0}`} aria-label="Pensiunkan templat" className="grid min-w-0 gap-2 pt-2">
        <ContextFields ctx={ctx} /><Key /><input type="hidden" name="template" value={template} />
        <p className={hint}>Templat tidak dapat dipakai untuk surat baru. Surat dan versi yang sudah ada tetap tersimpan.</p>
        <Notice s={s} />
        <Button type="submit" variant="destructive" aria-disabled={pending}>Pensiunkan</Button>
      </form>
    </details>
  );
}

export type LetterVisit = { visit_id: string; label: string; disabled: boolean };
export function NewLetterForm({ ctx, visits, templates, preset }: {
  ctx: RenderedContext; visits: LetterVisit[]; templates: { version_id: string; label: string }[]; preset: string | null;
}) {
  const [s, act, pending] = useActionState<DocFormState, FormData>(createLetterAction, {});
  const id = useId();
  return (
    <form action={act} key={`c${s.n ?? 0}`} aria-label="Buat surat" className="grid min-w-0 gap-3">
      <ContextFields ctx={ctx} /><Key />
      <div className="grid min-w-0 gap-1">
        <label htmlFor={`${id}-v`} className="font-semibold">Pasien</label>
        <select id={`${id}-v`} name="visit" required defaultValue={preset ?? ""} className={input}>
          <option value="" disabled>Pilih pasien kunjungan hari ini</option>
          {visits.map((v) => <option key={v.visit_id} value={v.visit_id} disabled={v.disabled}>{v.label}</option>)}
        </select>
      </div>
      <div className="grid min-w-0 gap-1">
        <label htmlFor={`${id}-t`} className="font-semibold">Templat</label>
        <select id={`${id}-t`} name="template_version" required defaultValue="" className={input}>
          <option value="" disabled>Pilih templat surat</option>
          {templates.map((t) => <option key={t.version_id} value={t.version_id}>{t.label}</option>)}
        </select>
      </div>
      <Notice s={s} />
      {s.id && <Link href={`/templat/surat/${s.id}`} className="inline-flex min-h-[44px] items-center font-semibold text-[var(--tint)]">Buka draf surat</Link>}
      <Button type="submit" size="lg" aria-disabled={pending || visits.length === 0 || templates.length === 0}>{pending ? "Membuat…" : "Buat Surat"}</Button>
    </form>
  );
}

// The draft editor (author only); the signed letter shows the correction form instead.
export function LetterBodyForm({ ctx, letter, body, mode }: { ctx: RenderedContext; letter: string; body: string; mode: "draft" | "correct" }) {
  const [s, act, pending] = useActionState<DocFormState, FormData>(mode === "draft" ? saveLetterAction : correctLetterAction, {});
  const id = useId();
  return (
    <form action={act} key={`b${s.n ?? 0}`} aria-label={mode === "draft" ? "Ubah draf surat" : "Koreksi surat"} className="grid min-w-0 gap-3">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="letter" value={letter} />
      <div className="grid min-w-0 gap-1">
        <label htmlFor={`${id}-b`} className="font-semibold">{mode === "draft" ? "Isi surat" : "Isi surat yang dikoreksi"}</label>
        <textarea id={`${id}-b`} name="body" required minLength={10} maxLength={40000} defaultValue={body} className={area} />
      </div>
      {mode === "correct" && (
        <div className="grid min-w-0 gap-1">
          <label htmlFor={`${id}-r`} className="font-semibold">Alasan koreksi</label>
          <input id={`${id}-r`} name="reason" required minLength={3} maxLength={500} className={input} />
        </div>
      )}
      <Notice s={s} />
      <Button type="submit" variant={mode === "draft" ? "secondary" : "default"} aria-disabled={pending}>{pending ? "Menyimpan…" : mode === "draft" ? "Simpan Draf" : "Simpan Koreksi"}</Button>
    </form>
  );
}
