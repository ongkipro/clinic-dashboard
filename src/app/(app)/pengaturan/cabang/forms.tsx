"use client";
// Cabang forms (UX-2, PR-2, T-036). One form per section with its own Simpan. Every form posts its
// rendered context (HYG-009 B2-1) and remounts its fields after each submit from the values the action
// returns (the T-035 lesson: what is shown is what is posted). Labels are <label for> so a select's
// options never join its name (the T-034 lesson).
import { useActionState, useId } from "react";
import { ContextFields } from "../../../../components/context-fields";
import { Button } from "../../../../components/ui/button";
import type { RenderedContext } from "../../../../modules/org/context/context";
import {
  activeAction, addClosureAction, type CabangState, createBranchAction, deviceAction, hoursAction, profileAction, removeClosureAction, roomAction, servicesAction,
} from "./actions";
import { DAYS, DEVICE_LABEL, ROOM_LABEL, TZ_LABEL } from "./labels";

const input = "min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const hintCls = "text-[0.88rem] text-[var(--label-2)]";

type Action = (prev: CabangState, f: FormData) => Promise<CabangState>;

function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string, hintId?: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-1">
      <label htmlFor={id} className="font-semibold">{label}</label>
      {children(id, hint ? `${id}-h` : undefined)}
      {hint && <span id={`${id}-h`} className={hintCls}>{hint}</span>}
    </div>
  );
}
function Notice({ s }: { s: CabangState }) {
  return (
    <>
      {s.error && <p role="alert" className="m-0 text-[var(--danger)]">{s.error}</p>}
      {s.ok && <p role="status" className="m-0 text-[var(--success)]">{s.ok}</p>}
    </>
  );
}

// A form whose fields remount after every submit; `render` gets the last returned values.
function SectionForm({ action, label, ctx, hidden, children, submit = "Simpan", variant }: {
  action: Action; label: string; ctx: RenderedContext; hidden: Record<string, string>;
  children: (v: Record<string, string>) => React.ReactNode; submit?: string; variant?: "plain";
}) {
  const [state, act, pending] = useActionState<CabangState, FormData>(action, {});
  const v = state.values ?? {};
  return (
    <form action={act} aria-label={label} className="@container grid min-w-0 gap-3" key={state.n ?? 0}>
      <ContextFields ctx={ctx} />
      {Object.entries(hidden).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
      {children(v)}
      <Notice s={state} />
      <div><Button type="submit" variant={variant} aria-disabled={pending}>{submit}</Button></div>
    </form>
  );
}

export function NewBranchForm({ ctx }: { ctx: RenderedContext }) {
  return (
    <SectionForm action={createBranchAction} label="Tambah cabang" ctx={ctx} hidden={{}} submit="Tambah Cabang">
      {(v) => (
        <div className="grid min-w-0 gap-3 @[34rem]:grid-cols-3">
          <Field label="Kode" hint="Huruf, angka, tanda hubung">{(id, h) => <input id={id} aria-describedby={h} className={input} name="code" defaultValue={v.code ?? ""} />}</Field>
          <Field label="Nama cabang">{(id) => <input id={id} className={input} name="name" defaultValue={v.name ?? ""} />}</Field>
          <Field label="Zona waktu">
            {(id) => (
              <select id={id} className={input} name="timezone" defaultValue={v.timezone ?? "Asia/Jakarta"}>
                {Object.entries(TZ_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            )}
          </Field>
        </div>
      )}
    </SectionForm>
  );
}

export function ProfileForm({ ctx, branch, section, initial, staff }: {
  ctx: RenderedContext; branch: string; section: "identitas" | "kontak" | "lokasi" | "situs" | "izin"; initial: Record<string, string>; staff?: { id: string; name: string }[];
}) {
  const label = { identitas: "Identitas cabang", kontak: "Nomor WhatsApp", lokasi: "Lokasi dan peta", situs: "Tayang di situs", izin: "Data izin" }[section];
  return (
    <SectionForm action={profileAction} label={label} ctx={ctx} hidden={{ branch, section }}>
      {(v0) => {
        const v = (k: string) => (v0[k] ?? initial[k] ?? "");
        if (section === "identitas") {
          return (
            <>
              <Field label="Nama cabang">{(id) => <input id={id} className={input} name="name" defaultValue={v("name")} />}</Field>
              <Field label="Zona waktu">
                {(id) => (
                  <select id={id} className={input} name="timezone" defaultValue={v("timezone")}>
                    {Object.entries(TZ_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                )}
              </Field>
              <Field label="Alamat">{(id) => <input id={id} className={input} name="address" defaultValue={v("address")} />}</Field>
            </>
          );
        }
        if (section === "kontak") return <Field label="Nomor WhatsApp cabang" hint="Opsional, format +62…">{(id, h) => <input id={id} aria-describedby={h} className={input} name="whatsapp_number" inputMode="tel" defaultValue={v("whatsapp_number")} />}</Field>;
        if (section === "lokasi") return <Field label="Tautan peta" hint="Diawali https://">{(id, h) => <input id={id} aria-describedby={h} className={input} name="map_url" defaultValue={v("map_url")} />}</Field>;
        if (section === "situs") {
          return (
            <div className="grid min-w-0 gap-3 @[34rem]:grid-cols-2">
              <Field label="Tayang mulai" hint="Tanggal di zona waktu cabang">{(id, h) => <input id={id} aria-describedby={h} className={input} type="date" name="publish_from" defaultValue={v("publish_from")} />}</Field>
              <Field label="Tayang sampai" hint="Kosongkan bila tanpa batas">{(id, h) => <input id={id} aria-describedby={h} className={input} type="date" name="publish_until" defaultValue={v("publish_until")} />}</Field>
            </div>
          );
        }
        return (
          <>
            <Field label="Nomor izin klinik">{(id) => <input id={id} className={input} name="licence_number" defaultValue={v("licence_number")} />}</Field>
            <Field label="NIB" hint="13 digit">{(id, h) => <input id={id} aria-describedby={h} className={input} name="nib" inputMode="numeric" defaultValue={v("nib")} />}</Field>
            <Field label="Kode fasyankes">{(id) => <input id={id} className={input} name="facility_code" defaultValue={v("facility_code")} />}</Field>
            <Field label="ID organisasi SATUSEHAT">{(id) => <input id={id} className={input} name="satusehat_org_id" defaultValue={v("satusehat_org_id")} />}</Field>
            <Field label="Penanggung jawab klinik">
              {(id) => (
                <select id={id} className={input} name="responsible_staff_id" defaultValue={v("responsible_staff_id")}>
                  <option value="">Belum dipilih</option>
                  {(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
            </Field>
          </>
        );
      }}
    </SectionForm>
  );
}

export function HoursForm({ ctx, branch, initial }: { ctx: RenderedContext; branch: string; initial: { weekday: number; opens: string; closes: string }[] }) {
  return (
    <SectionForm action={hoursAction} label="Jam buka" ctx={ctx} hidden={{ branch }}>
      {(v) => (
        <div className="grid min-w-0 gap-2">
          <p className={`m-0 ${hintCls}`}>Kosongkan untuk hari tutup. Isi dua rentang bila ada istirahat siang.</p>
          {DAYS.map((day, d) => {
            const mine = initial.filter((x) => x.weekday === d);
            return (
              <fieldset key={d} className="grid min-w-0 gap-2 border-0 p-0 @[34rem]:grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)]">
                <legend className="float-left font-semibold @[34rem]:pt-3">{day}</legend>
                {[0, 1].map((i) => (
                  <div key={i} className="grid min-w-0 grid-cols-2 gap-2">
                    <Field label={`Buka ${i + 1}`}>{(id) => <input id={id} className={input} name={`h_${d}_${i}_open`} placeholder="09:00" defaultValue={v[`h_${d}_${i}_open`] ?? mine[i]?.opens ?? ""} />}</Field>
                    <Field label={`Tutup ${i + 1}`}>{(id) => <input id={id} className={input} name={`h_${d}_${i}_close`} placeholder="20:00" defaultValue={v[`h_${d}_${i}_close`] ?? mine[i]?.closes ?? ""} />}</Field>
                  </div>
                ))}
              </fieldset>
            );
          })}
        </div>
      )}
    </SectionForm>
  );
}

export function AddClosureForm({ ctx, branch, today }: { ctx: RenderedContext; branch: string; today: string }) {
  return (
    <SectionForm action={addClosureAction} label="Tambah libur" ctx={ctx} hidden={{ branch }} submit="Tambah Libur">
      {(v) => (
        <div className="grid min-w-0 gap-3 @[34rem]:grid-cols-2">
          <Field label="Tanggal libur">{(id) => <input id={id} className={input} type="date" name="date" min={today} defaultValue={v.date ?? ""} />}</Field>
          <Field label="Alasan">{(id) => <input id={id} className={input} name="reason" defaultValue={v.reason ?? ""} />}</Field>
          <Field label="Mulai (opsional)" hint="Kosongkan untuk sehari penuh">{(id, h) => <input id={id} aria-describedby={h} className={input} name="from" placeholder="12:00" defaultValue={v.from ?? ""} />}</Field>
          <Field label="Selesai (opsional)">{(id) => <input id={id} className={input} name="until" placeholder="13:00" defaultValue={v.until ?? ""} />}</Field>
        </div>
      )}
    </SectionForm>
  );
}

export function RemoveClosure({ ctx, branch, id, label }: { ctx: RenderedContext; branch: string; id: string; label: string }) {
  const [state, act, pending] = useActionState<CabangState, FormData>(removeClosureAction, {});
  return (
    <form action={act} aria-label={`Hapus libur ${label}`} className="grid gap-1">
      <ContextFields ctx={ctx} />
      <input type="hidden" name="branch" value={branch} />
      <input type="hidden" name="id" value={id} />
      <div><Button type="submit" variant="plain" aria-disabled={pending} aria-label={`Hapus libur ${label}`}>Hapus</Button></div>
      <Notice s={state} />
    </form>
  );
}

export function RoomForm({ ctx, branch, room }: { ctx: RenderedContext; branch: string; room?: { id: string; name: string; kind: string; satusehatLocationId: string | null } }) {
  return (
    <SectionForm action={roomAction} label={room ? `Ubah ${room.name}` : "Tambah ruang"} ctx={ctx} hidden={{ branch, id: room?.id ?? "" }} submit={room ? "Simpan Ruang" : "Tambah Ruang"}>
      {(v) => (
        <div className="grid min-w-0 gap-3 @[34rem]:grid-cols-3">
          <Field label="Nama ruang">{(id) => <input id={id} className={input} name="name" defaultValue={v.name ?? room?.name ?? ""} />}</Field>
          <Field label="Jenis ruang">
            {(id) => (
              <select id={id} className={input} name="kind" defaultValue={v.kind ?? room?.kind ?? "treatment"}>
                {Object.entries(ROOM_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            )}
          </Field>
          <Field label="ID lokasi SATUSEHAT" hint="Opsional">{(id, h) => <input id={id} aria-describedby={h} className={input} name="satusehat" defaultValue={v.satusehat ?? room?.satusehatLocationId ?? ""} />}</Field>
        </div>
      )}
    </SectionForm>
  );
}

export function DeviceForm({ ctx, branch, device }: { ctx: RenderedContext; branch: string; device?: { id: string; type: string; label: string } }) {
  return (
    <SectionForm action={deviceAction} label={device ? `Ubah ${device.label}` : "Tambah alat"} ctx={ctx} hidden={{ branch, id: device?.id ?? "" }} submit={device ? "Simpan Alat" : "Tambah Alat"}>
      {(v) => (
        <div className="grid min-w-0 gap-3 @[34rem]:grid-cols-2">
          <Field label="Nama alat">{(id) => <input id={id} className={input} name="label" defaultValue={v.label ?? device?.label ?? ""} />}</Field>
          <Field label="Jenis alat">
            {(id) => (
              <select id={id} className={input} name="type" defaultValue={v.type ?? device?.type ?? "laser"}>
                {Object.entries(DEVICE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            )}
          </Field>
        </div>
      )}
    </SectionForm>
  );
}

export function ActiveToggle({ ctx, branch, id, what, active, name }: { ctx: RenderedContext; branch: string; id: string; what: "room" | "device"; active: boolean; name: string }) {
  const [state, act, pending] = useActionState<CabangState, FormData>(activeAction, {});
  const label = active ? `Nonaktifkan ${name}` : `Aktifkan ${name}`;
  return (
    <form action={act} aria-label={label} className="grid gap-1">
      <ContextFields ctx={ctx} />
      <input type="hidden" name="branch" value={branch} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="what" value={what} />
      <input type="hidden" name="active" value={active ? "0" : "1"} />
      <div><Button type="submit" variant="plain" aria-disabled={pending} aria-label={label}>{active ? "Nonaktifkan" : "Aktifkan"}</Button></div>
      <Notice s={state} />
    </form>
  );
}

export function ServicesForm({ ctx, branch, catalog, chosen }: { ctx: RenderedContext; branch: string; catalog: { itemId: string; name: string; code: string }[]; chosen: string[] }) {
  return (
    <SectionForm action={servicesAction} label="Layanan tersedia" ctx={ctx} hidden={{ branch }}>
      {() => (
        catalog.length === 0
          ? <p className="m-0">Belum ada layanan aktif di katalog.</p>
          : (
            <fieldset className="grid min-w-0 gap-1 border-0 p-0">
              <legend className="mb-1 font-semibold">Layanan yang bisa dipesan di cabang ini</legend>
              {catalog.map((c) => (
                <label key={c.itemId} className="flex min-h-[var(--target)] items-center gap-3">
                  <input type="checkbox" name="item" value={c.itemId} className="size-5" defaultChecked={chosen.includes(c.itemId)} />
                  <span className="[overflow-wrap:anywhere]">{c.name} <span className={hintCls}>· {c.code}</span></span>
                </label>
              ))}
            </fieldset>
          )
      )}
    </SectionForm>
  );
}
