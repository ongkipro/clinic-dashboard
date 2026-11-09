"use client";
// Jadwal forms (UX-5, PR-83, T-045). Every write form posts its rendered context (HYG-009 B2-1) and a
// per-mount idempotency key (a retry of the same submit replays; a remount gets a new key). Only
// Buat Janji is prominent (UI-13); Batalkan is destructive with a reason and the DP notice (17:288).
import { useActionState, useId, useState } from "react";
import { ContextFields } from "../../../components/context-fields";
import { Button } from "../../../components/ui/button";
import type { RenderedContext } from "../../../modules/org/context/context";
import {
  cancelAction, confirmAction, createAction, type FindState, findPatientAction, type JadwalState, noShowAction, rescheduleAction, type SlotState, slotsAction,
} from "./actions";
import { CHANNEL } from "./labels";

const input = "min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const hintCls = "text-[0.88rem] text-[var(--label-2)]";

function Notice({ s }: { s: { error?: string; ok?: string } }) {
  return (
    <>
      {s.error && <p role="alert" className="m-0 text-[var(--danger)]">{s.error}</p>}
      {s.ok && <p role="status" className="m-0 text-[var(--success)]">{s.ok}</p>}
    </>
  );
}
function Field({ label, children }: { label: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-1">
      <label htmlFor={id} className="font-semibold">{label}</label>
      {children(id)}
    </div>
  );
}
// One idempotency key per mounted form (the form remounts after each answer via key={state.n}).
function Key() {
  const [k] = useState(() => crypto.randomUUID());
  return <input type="hidden" name="key" value={k} />;
}

type Patient = { id: string; mrn: string; fullName: string; birthYear: number; maskedPhone: string | null };

// Cari pasien (FO, Central CS): on demand, POST only; at most 20 rows in the minimal projection.
function FindPatient({ ctx, onPick }: { ctx: RenderedContext; onPick: (p: Patient) => void }) {
  const [s, act, pending] = useActionState<FindState, FormData>(findPatientAction, {});
  return (
    <div className="grid min-w-0 gap-2">
      <form action={act} aria-label="Cari pasien" className="@container grid min-w-0 gap-2" key={s.n ?? 0}>
        <ContextFields ctx={ctx} />
        <Field label="Cari pasien">{(id) => <input id={id} className={input} name="q" autoComplete="off" placeholder="Nama, No. RM, atau HP" />}</Field>
        <div><Button type="submit" variant="secondary" aria-disabled={pending}>Cari</Button></div>
        <Notice s={s} />
      </form>
      {s.matches && (s.matches.length === 0
        ? <p className="m-0">Tidak ada pasien yang cocok.</p>
        : (
          <ul aria-label="Hasil pencarian pasien" className="m-0 grid list-none gap-1 p-0">
            {s.matches.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => onPick(m)} className="min-h-[var(--target)] w-full rounded-[var(--radius-field)] px-3 text-left hover:bg-[var(--accent)]">
                  <span className="font-semibold">{m.fullName}</span> <span className={hintCls}>· {m.mrn} · {m.birthYear}{m.maskedPhone ? ` · ${m.maskedPhone}` : ""}</span>
                </button>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}

// Slot picking for a service on a date; posts the chosen start (and the performer the slot offered).
// The radios belong to the form with id `target` (unique per sheet: "baru" or the appointment id).
function SlotPicker({ ctx, branch, tz, version, staff, date, target }: { ctx: RenderedContext; branch: string; tz: string; version: string; staff?: string; date: string; target: string }) {
  const [s, act, pending] = useActionState<SlotState, FormData>(slotsAction, {});
  return (
    <div className="grid min-w-0 gap-2">
      <form action={act} aria-label="Cari slot" className="grid min-w-0 gap-2 @[30rem]:grid-cols-[minmax(0,1fr)_auto] @[30rem]:items-end" key={s.n ?? 0}>
        <ContextFields ctx={ctx} />
        <input type="hidden" name="branch" value={branch} />
        <input type="hidden" name="version" value={version} />
        <input type="hidden" name="tz" value={tz} />
        {staff && <input type="hidden" name="staff" value={staff} />}
        <Field label="Tanggal">{(id) => <input id={id} type="date" className={input} name="date" defaultValue={s.date ?? date} />}</Field>
        <div><Button type="submit" variant="secondary" aria-disabled={pending || !version}>Lihat slot</Button></div>
      </form>
      <Notice s={s} />
      {s.slots && (s.slots.length === 0
        ? <p className="m-0">Tidak ada slot kosong pada tanggal ini.</p>
        : (
          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="font-semibold">Slot tersedia</legend>
            <div className="flex flex-wrap gap-2">
              {s.slots.map((x) => (
                <label key={x.start} className="inline-flex min-h-[var(--target)] items-center gap-2 rounded-[var(--radius-field)] border border-[var(--separator)] px-3">
                  <input type="radio" name="start" value={x.start} form={target} required /> {x.label}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
    </div>
  );
}

export function NewAppointment({ ctx, branch, tz, date, services, patient, search }: {
  ctx: RenderedContext; branch: string; tz: string; date: string; services: { versionId: string; name: string }[]; patient: Patient | null; search: boolean;
}) {
  const [picked, setPicked] = useState<Patient | null>(patient);
  const [version, setVersion] = useState(services[0]?.versionId ?? "");
  const [s, act, pending] = useActionState<JadwalState, FormData>(createAction, {});
  const target = "jadwal-baru";
  return (
    <section aria-labelledby="buat-janji" className="grid min-w-0 gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
      <h2 id="buat-janji" className="m-0 text-[1.18rem] font-semibold">Buat Janji</h2>
      {picked
        ? <p className="m-0">Pasien: <strong>{picked.fullName}</strong> <span className={hintCls}>· {picked.mrn} · {picked.birthYear}</span></p>
        : search ? <FindPatient ctx={ctx} onPick={setPicked} /> : <p className="m-0">Buka pasien di menu Pasien lalu pilih Buat Janji.</p>}
      {services.length === 0
        ? <p className="m-0">Cabang ini belum menawarkan layanan. Atur di Pengaturan › Cabang.</p>
        : (
          <>
            <Field label="Layanan">
              {(id) => (
                <select id={id} className={input} value={version} onChange={(e) => setVersion(e.target.value)}>
                  {services.map((x) => <option key={x.versionId} value={x.versionId}>{x.name}</option>)}
                </select>
              )}
            </Field>
            <SlotPicker key={version} ctx={ctx} branch={branch} tz={tz} version={version} date={date} target={target} />
            <form id={target} action={act} aria-label="Simpan janji" className="grid min-w-0 gap-3" key={s.n ?? 0}>
              <ContextFields ctx={ctx} />
              <Key />
              <input type="hidden" name="branch" value={branch} />
              <input type="hidden" name="version" value={version} />
              <input type="hidden" name="patient" value={picked?.id ?? ""} />
              <Field label="Saluran">
                {(id) => (
                  <select id={id} className={input} name="channel" defaultValue={s.values?.channel ?? "walk_in"}>
                    {Object.entries(CHANNEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                )}
              </Field>
              <Field label="Catatan (opsional)">{(id) => <input id={id} className={input} name="note" defaultValue={s.values?.note ?? ""} />}</Field>
              <Notice s={s} />
              <div><Button type="submit" aria-disabled={pending || !picked}>Simpan Janji</Button></div>
            </form>
          </>
        )}
    </section>
  );
}

// Row actions of one appointment (writers only). Tandai Tidak Datang is disabled until noShowFrom.
// noShowReady is decided on the server at render time (the database re-checks it on submit).
export function RowActions({ ctx, branch, tz, id, versionId, state, label, noShowReady, noShowLabel, date }: {
  ctx: RenderedContext; branch: string; tz: string; id: string; versionId: string; state: string; label: string; noShowReady: boolean; noShowLabel: string; date: string;
}) {
  const [open, setOpen] = useState<"" | "batal" | "ubah">("");
  const [c, actC, pC] = useActionState<JadwalState, FormData>(confirmAction, {});
  const [n, actN, pN] = useActionState<JadwalState, FormData>(noShowAction, {});
  const [x, actX, pX] = useActionState<JadwalState, FormData>(cancelAction, {});
  const [r, actR, pR] = useActionState<JadwalState, FormData>(rescheduleAction, {});
  const live = state === "booked" || state === "confirmed";
  if (!live) return null;
  const target = `ubah-${id}`;
  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex flex-wrap gap-2">
        {state === "booked" && (
          <form action={actC} key={`c${c.n ?? 0}`} aria-label={`Konfirmasi ${label}`}>
            <ContextFields ctx={ctx} /><Key /><input type="hidden" name="id" value={id} />
            <Button type="submit" variant="plain" aria-disabled={pC}>Konfirmasi</Button>
          </form>
        )}
        <Button type="button" variant="plain" aria-expanded={open === "ubah"} onClick={() => setOpen(open === "ubah" ? "" : "ubah")}>Ubah Jadwal</Button>
        <Button type="button" variant="plain" aria-expanded={open === "batal"} onClick={() => setOpen(open === "batal" ? "" : "batal")}>Batalkan</Button>
        <form action={actN} key={`n${n.n ?? 0}`} aria-label={`Tidak datang ${label}`}>
          <ContextFields ctx={ctx} /><Key /><input type="hidden" name="id" value={id} />
          <Button type="submit" variant="plain" disabled={!noShowReady} aria-disabled={pN || !noShowReady}>Tandai Tidak Datang</Button>
        </form>
      </div>
      {!noShowReady && <p className={hintCls}>Tidak Datang tersedia mulai {noShowLabel}.</p>}
      <Notice s={c} /><Notice s={n} />
      {open === "batal" && (
        <form action={actX} key={`x${x.n ?? 0}`} aria-label={`Batalkan ${label}`} className="grid min-w-0 gap-2 rounded-[var(--radius-field)] border border-[var(--separator)] p-3">
          <ContextFields ctx={ctx} /><Key /><input type="hidden" name="id" value={id} />
          <p className="m-0 text-[0.88rem]">Aturan DP berlaku saat modul kasir aktif; janji ini belum memakai DP.</p>
          <Field label="Alasan pembatalan">{(fid) => <input id={fid} className={input} name="reason" defaultValue={x.values?.reason ?? ""} />}</Field>
          <Notice s={x} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="destructive" aria-disabled={pX}>Batalkan Janji</Button>
            <Button type="button" variant="secondary" onClick={() => setOpen("")}>Batal</Button>
          </div>
        </form>
      )}
      {open === "ubah" && (
        <div className="grid min-w-0 gap-2 rounded-[var(--radius-field)] border border-[var(--separator)] p-3">
          <SlotPicker ctx={ctx} branch={branch} tz={tz} version={versionId} date={date} target={target} />
          <form id={target} action={actR} key={`r${r.n ?? 0}`} aria-label={`Ubah jadwal ${label}`} className="grid min-w-0 gap-2">
            <ContextFields ctx={ctx} /><Key /><input type="hidden" name="id" value={id} />
            <Notice s={r} />
            <div><Button type="submit" variant="secondary" aria-disabled={pR}>Simpan Jadwal Baru</Button></div>
          </form>
        </div>
      )}
    </div>
  );
}
