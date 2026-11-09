"use client";
// Privasi forms (UX-30 ▸ Privasi, PR-92, T-039). Every write form posts its rendered context (HYG-009 B2-1)
// and a per-mount idempotency key (a retry replays; a remount after an answer gets a new key). Values are
// kept after a refusal; "Tambah" and "Catat Kebocoran" are the section actions (17:191).
import { useActionState, useId, useState } from "react";
import { ContextFields } from "../../../components/context-fields";
import { Button } from "../../../components/ui/button";
import type { RenderedContext } from "../../../modules/org/context/context";
import type { Processor } from "../../../modules/privacy/privacy";
import {
  assessAction, closeAction, concludeAction, noticeAction, type PrivState, processorAction, processorActiveAction, publishTextAction, recordBreachAction,
} from "./actions";
import { PURPOSE, RECIPIENT } from "./labels";

const input = "min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const area = "min-h-24 w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white p-3";
const box = "grid min-w-0 gap-3 rounded-[var(--radius-field)] border border-[var(--separator)] p-3";
const hintCls = "m-0 text-[0.88rem] text-[var(--label-2)]";

function Notice({ s }: { s: PrivState }) {
  return (
    <>
      {s.error && <p role="alert" className="m-0 text-[var(--danger)]">{s.error}</p>}
      {s.ok && <p role="status" className="m-0 text-[var(--success)]">{s.ok}</p>}
    </>
  );
}
function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-1">
      <label htmlFor={id} className="font-semibold">{label}</label>
      {children(id)}
      {hint && <p className={hintCls}>{hint}</p>}
    </div>
  );
}
function Key() {
  const [k] = useState(() => crypto.randomUUID());
  return <input type="hidden" name="key" value={k} />;
}
function Hidden({ ctx, id }: { ctx: RenderedContext; id?: string }) {
  return <><ContextFields ctx={ctx} /><Key />{id && <input type="hidden" name="id" value={id} />}</>;
}

export function PublishText({ ctx }: { ctx: RenderedContext }) {
  const [s, act, pending] = useActionState<PrivState, FormData>(publishTextAction, {});
  const v = s.values ?? {};
  return (
    <form action={act} key={`t${s.n ?? 0}`} aria-label="Terbitkan versi baru" className={box}>
      <Hidden ctx={ctx} />
      <Field label="Jenis persetujuan">{(id) => (
        <select id={id} name="purpose" className={input} defaultValue={v.purpose ?? "care_notice"}>
          {Object.entries(PURPOSE).filter(([k]) => k !== "procedure").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      )}</Field>
      <Field label="Teks persetujuan" hint="Versi lama tetap tersimpan; persetujuan yang sudah dicatat tetap merujuk teks yang ditunjukkan saat itu.">
        {(id) => <textarea id={id} name="body" className={area} defaultValue={v.body ?? ""} />}
      </Field>
      <Notice s={s} />
      <div><Button type="submit" variant="secondary" aria-disabled={pending}>Terbitkan Versi Baru</Button></div>
    </form>
  );
}

export function ProcessorForm({ ctx, p }: { ctx: RenderedContext; p?: Processor }) {
  const [s, act, pending] = useActionState<PrivState, FormData>(processorAction, {});
  const v = s.values ?? {};
  const [cross, setCross] = useState(v.cross_border ? v.cross_border === "on" : p?.crossBorder ?? false);
  const val = (k: string, d: string | null | undefined) => v[k] ?? d ?? "";
  return (
    <form action={act} key={`p${s.n ?? 0}`} aria-label={p ? `Ubah pemroses ${p.name}` : "Tambah pemroses"} className={box}>
      <Hidden ctx={ctx} id={p?.id} />
      <div className="grid min-w-0 gap-3 @[40rem]:grid-cols-2">
        <Field label="Nama">{(id) => <input id={id} name="name" className={input} defaultValue={val("name", p?.name)} />}</Field>
        <Field label="Peran">{(id) => (
          <select id={id} name="role" className={input} defaultValue={val("role", p?.role ?? "processor")}>
            <option value="processor">Pemroses</option><option value="sub_processor">Sub-pemroses</option>
          </select>
        )}</Field>
        <Field label="Layanan">{(id) => <input id={id} name="service" className={input} defaultValue={val("service", p?.service)} />}</Field>
        <Field label="Kategori data">{(id) => <input id={id} name="data_categories" className={input} defaultValue={val("data_categories", p?.dataCategories)} />}</Field>
        <Field label="Lokasi pemrosesan">{(id) => <input id={id} name="location" className={input} defaultValue={val("location", p?.location)} />}</Field>
        <Field label="Referensi perjanjian (opsional)">{(id) => <input id={id} name="agreement_ref" className={input} defaultValue={val("agreement_ref", p?.agreementRef)} />}</Field>
      </div>
      <label className="flex min-h-[var(--target)] items-center gap-2">
        <input type="checkbox" name="cross_border" checked={cross} onChange={(e) => setCross(e.target.checked)} /> Data dikirim ke luar negeri
      </label>
      {cross && <Field label="Dasar transfer">{(id) => <input id={id} name="transfer_basis" className={input} defaultValue={val("transfer_basis", p?.transferBasis)} />}</Field>}
      <Notice s={s} />
      <div><Button type="submit" variant="secondary" aria-disabled={pending}>{p ? "Simpan" : "Tambah"}</Button></div>
    </form>
  );
}

export function ProcessorActive({ ctx, id, active, label }: { ctx: RenderedContext; id: string; active: boolean; label: string }) {
  const [s, act, pending] = useActionState<PrivState, FormData>(processorActiveAction, {});
  return (
    <form action={act} key={`a${s.n ?? 0}`} aria-label={`${active ? "Nonaktifkan" : "Aktifkan"} ${label}`} className="grid min-w-0 gap-1">
      <Hidden ctx={ctx} id={id} /><input type="hidden" name="active" value={active ? "false" : "true"} />
      <div><Button type="submit" variant="plain" aria-disabled={pending}>{active ? "Nonaktifkan" : "Aktifkan"}</Button></div>
      <Notice s={s} />
    </form>
  );
}

export function RecordBreach({ ctx }: { ctx: RenderedContext }) {
  const [s, act, pending] = useActionState<PrivState, FormData>(recordBreachAction, {});
  const v = s.values ?? {};
  return (
    <form action={act} key={`b${s.n ?? 0}`} aria-label="Catat kebocoran" className={box}>
      <Hidden ctx={ctx} />
      <div className="grid min-w-0 gap-3 @[40rem]:grid-cols-2">
        <Field label="Waktu diketahui (WIB)" hint="Batas 3×24 jam dihitung dari waktu ini.">{(id) => <input id={id} type="datetime-local" name="aware_at" className={input} defaultValue={v.aware_at ?? ""} />}</Field>
        <Field label="Perkiraan jumlah terdampak (opsional)">{(id) => <input id={id} type="number" min={0} name="affected_count" className={input} defaultValue={v.affected_count ?? ""} />}</Field>
      </div>
      <Field label="Kategori data">{(id) => <input id={id} name="data_categories" className={input} defaultValue={v.data_categories ?? ""} />}</Field>
      <Field label="Uraian">{(id) => <textarea id={id} name="description" className={area} defaultValue={v.description ?? ""} />}</Field>
      <Notice s={s} />
      <div><Button type="submit" aria-disabled={pending}>Catat Kebocoran</Button></div>
    </form>
  );
}

export function BreachStep({ ctx, id, state, label }: { ctx: RenderedContext; id: string; state: string; label: string }) {
  const [a, assess, pa] = useActionState<PrivState, FormData>(assessAction, {});
  const [c, conclude, pc] = useActionState<PrivState, FormData>(concludeAction, {});
  const [x, close, px] = useActionState<PrivState, FormData>(closeAction, {});
  const [no, setNo] = useState(false);
  if (state === "open") {
    return (
      <form action={assess} key={`s${a.n ?? 0}`} aria-label={`Nilai ${label}`} className="grid min-w-0 gap-1">
        <Hidden ctx={ctx} id={id} /><div><Button type="submit" variant="secondary" aria-disabled={pa}>Tandai Sudah Dinilai</Button></div><Notice s={a} />
      </form>
    );
  }
  if (state === "assessed") {
    return (
      <div className="grid min-w-0 gap-2">
        <div className="flex min-w-0 flex-wrap gap-2">
          <form action={conclude} key={`y${c.n ?? 0}`} aria-label={`Diberitahukan ${label}`}>
            <Hidden ctx={ctx} id={id} /><input type="hidden" name="notifiable" value="yes" />
            <Button type="submit" variant="secondary" aria-disabled={pc}>Tandai Diberitahukan</Button>
          </form>
          <Button type="button" variant="plain" aria-expanded={no} onClick={() => setNo(!no)}>Tidak Wajib Diberitahukan</Button>
        </div>
        {no && (
          <form action={conclude} key={`n${c.n ?? 0}`} aria-label={`Tidak wajib diberitahukan ${label}`} className={box}>
            <Hidden ctx={ctx} id={id} /><input type="hidden" name="notifiable" value="no" />
            <Field label="Alasan">{(fid) => <textarea id={fid} name="reason" className={area} defaultValue={c.values?.reason ?? ""} />}</Field>
            <div><Button type="submit" variant="secondary" aria-disabled={pc}>Simpan Alasan</Button></div>
          </form>
        )}
        <Notice s={c} />
      </div>
    );
  }
  if (state === "notified" || state === "not_notifiable") {
    return (
      <form action={close} key={`c${x.n ?? 0}`} aria-label={`Tutup ${label}`} className="grid min-w-0 gap-1">
        <Hidden ctx={ctx} id={id} /><div><Button type="submit" variant="secondary" aria-disabled={px}>Tutup Kebocoran</Button></div><Notice s={x} />
      </form>
    );
  }
  return null;
}

export function AddNotice({ ctx, id, label }: { ctx: RenderedContext; id: string; label: string }) {
  const [s, act, pending] = useActionState<PrivState, FormData>(noticeAction, {});
  const v = s.values ?? {};
  return (
    <form action={act} key={`m${s.n ?? 0}`} aria-label={`Tambah pemberitahuan ${label}`} className={box}>
      <Hidden ctx={ctx} id={id} />
      <div className="grid min-w-0 gap-3 @[40rem]:grid-cols-2">
        <Field label="Penerima">{(fid) => (
          <select id={fid} name="recipient_kind" className={input} defaultValue={v.recipient_kind ?? "data_subjects"}>
            {Object.entries(RECIPIENT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        )}</Field>
        <Field label="Nama penerima">{(fid) => <input id={fid} name="recipient" className={input} defaultValue={v.recipient ?? ""} />}</Field>
        <Field label="Waktu kirim (WIB)">{(fid) => <input id={fid} type="datetime-local" name="sent_at" className={input} defaultValue={v.sent_at ?? ""} />}</Field>
        <Field label="Saluran">{(fid) => <input id={fid} name="channel" className={input} defaultValue={v.channel ?? ""} placeholder="Surat tertulis" />}</Field>
      </div>
      <Field label="Ringkasan isi">{(fid) => <textarea id={fid} name="content_summary" className={area} defaultValue={v.content_summary ?? ""} />}</Field>
      <Field label="Bukti (PDF, PNG atau JPEG, maks. 5 MB)">{(fid) => <input id={fid} type="file" name="file" accept="application/pdf,image/png,image/jpeg" className={input} />}</Field>
      <Notice s={s} />
      <div><Button type="submit" variant="secondary" aria-disabled={pending}>Simpan Pemberitahuan</Button></div>
    </form>
  );
}
