"use client";
// One setting row in Pengaturan (19 §2.17): current value, default and its source, bounds,
// effective date, history, Ubah (inline form generated from the value spec) and
// Kembalikan ke default; drafts show "Menunggu persetujuan {peran}".
import { ContextFields } from "../../../components/context-fields";
import type { RenderedContext } from "../../../modules/org/context/context";
import { useActionState, useId, useState } from "react";
import { Button } from "../../../components/ui/button";
import type { Spec, Value } from "../../../modules/settings/spec";
import { type SaveState, saveAction, withdrawAction } from "./actions";

const input = "min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";

type Prev = Record<string, string[]> | undefined;
const pick = (prev: Prev, n: string, fallback: string) => prev?.[n]?.[0] ?? fallback;

// Form fields for a value of spec s (names follow fromForm in spec.ts).
function Field({ s, name, label, value, prev }: { s: Spec; name: string; label: string; value: Value; prev: Prev }) {
  const uid = useId();
  switch (s.t) {
    case "int":
    case "rupiah":
      return (
        <label className="grid min-w-0 gap-1">
          <span className="font-semibold">{label}</span>
          <span className="flex min-w-0 items-center gap-2">
            {s.t === "rupiah" && <span aria-hidden="true">Rp</span>}
            <input className={input} name={name} inputMode="numeric" defaultValue={pick(prev, name, value === null ? "" : String(value))} aria-describedby={s.t === "int" && s.unit ? `${uid}-u` : undefined} />
            {s.t === "int" && s.unit && <span id={`${uid}-u`} className="shrink-0 text-[var(--label-2)]">{s.unit}</span>}
          </span>
        </label>
      );
    case "bool":
      return (
        <label className="flex min-h-[var(--target)] items-center gap-3">
          <input type="hidden" name={name} value="0" />
          <input type="checkbox" name={name} value="1" className="size-5" defaultChecked={prev ? (prev[name] ?? []).includes("1") : Boolean(value)} />
          <span><span className="font-semibold">{label}</span> <span className="text-[var(--label-2)]">({s.on ?? "Aktif"})</span></span>
        </label>
      );
    case "enum":
      return (
        <label className="grid min-w-0 gap-1">
          <span className="font-semibold">{label}</span>
          <select className={input} name={name} defaultValue={pick(prev, name, String(value ?? ""))}>
            {s.of.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        </label>
      );
    case "time":
      return (
        <label className="grid min-w-0 gap-1">
          <span className="font-semibold">{label}</span>
          <input className={input} type="time" name={name} min={s.min} max={s.max} defaultValue={pick(prev, name, String(value ?? ""))} />
        </label>
      );
    case "text":
    case "accent":
      return (
        <label className="grid min-w-0 gap-1">
          <span className="font-semibold">{label}</span>
          <input className={input} name={name} defaultValue={pick(prev, name, String(value ?? ""))} maxLength={s.t === "text" ? s.max : 7} autoComplete="off" />
        </label>
      );
    case "obj":
      return (
        <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0">
          <legend className="sr-only">{label}</legend>
          {s.f.map((f) => <Field key={f.k} s={f.s} name={`${name}.${f.k}`} label={f.l} value={(value as Record<string, Value> | null)?.[f.k] ?? null} prev={prev} />)}
        </fieldset>
      );
    case "list":
      if (s.of.t === "enum") {
        const chosen = prev ? (prev[name] ?? []) : ((value as string[] | null) ?? []);
        return (
          <fieldset className="m-0 grid min-w-0 gap-1 border-0 p-0">
            <legend className="mb-1 font-semibold">{label}</legend>
            {s.of.of.map((o) => (
              <label key={o.v} className="flex min-h-[var(--target)] items-center gap-3">
                <input type="checkbox" name={name} value={o.v} className="size-5" defaultChecked={chosen.includes(o.v)} />
                {o.l}
              </label>
            ))}
          </fieldset>
        );
      }
      return (
        <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0">
          <legend className="mb-1 font-semibold">{label}</legend>
          {Array.from({ length: s.max }, (_, i) => {
            const v = prev ? (prev[name]?.[i] ?? "") : String((value as Value[] | null)?.[i] ?? "");
            return (
              <label key={i} className="flex min-w-0 items-center gap-2">
                <span className="sr-only">{`${label} ${i + 1}`}</span>
                <input className={input} name={name} inputMode="numeric" defaultValue={v} />
                <span className="shrink-0 text-[var(--label-2)]">{s.of.t === "int" ? s.of.unit : ""}</span>
              </label>
            );
          })}
        </fieldset>
      );
    case "opt": {
      const on = prev ? prev[`${name}.on`]?.[0] === "1" : value !== null;
      return <OptField s={s} name={name} label={label} value={value} prev={prev} initial={on} />;
    }
    case "oneof": {
      const cur = prev ? pick(prev, `${name}.k`, "") : ((value as { k?: string } | null)?.k ?? s.of[0].k);
      return <OneOfField s={s} name={name} label={label} value={value} prev={prev} initial={cur} />;
    }
  }
}

function OptField({ s, name, label, value, prev, initial }: { s: Extract<Spec, { t: "opt" }>; name: string; label: string; value: Value; prev: Prev; initial: boolean }) {
  const [on, setOn] = useState(initial);
  return (
    <div className="grid min-w-0 gap-2">
      <label className="flex min-h-[var(--target)] items-center gap-3">
        <input type="checkbox" name={`${name}.on`} value="1" className="size-5" checked={on} onChange={(e) => setOn(e.target.checked)} />
        <span><span className="font-semibold">{label}</span>{!on && <span className="text-[var(--label-2)]"> ({s.off})</span>}</span>
      </label>
      {on && <Field s={s.of} name={name} label={`${label} — nilai`} value={value} prev={prev} />}
    </div>
  );
}

function OneOfField({ s, name, label, value, prev, initial }: { s: Extract<Spec, { t: "oneof" }>; name: string; label: string; value: Value; prev: Prev; initial: string }) {
  const [k, setK] = useState(initial);
  const c = s.of.find((o) => o.k === k);
  return (
    <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0">
      <legend className="mb-1 font-semibold">{label}</legend>
      {s.of.map((o) => (
        <label key={o.k} className="flex min-h-[var(--target)] items-center gap-3">
          <input type="radio" name={`${name}.k`} value={o.k} className="size-5" checked={k === o.k} onChange={() => setK(o.k)} />
          {o.l}
        </label>
      ))}
      {c?.s && <Field s={c.s} name={`${name}.v`} label={c.l} value={(value as { v?: Value } | null)?.v ?? null} prev={prev} />}
    </fieldset>
  );
}

function Message({ state }: { state: SaveState }) {
  if (state.error) return <p role="alert" className="m-0 text-[var(--danger)]">{state.error}</p>;
  if (state.ok) return <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--success-soft)] px-3 py-2 text-[var(--success)]">{state.ok}</p>;
  return null;
}

export function SettingEditor({
  settingKey, label, spec, value, branchId, draftMode, isDefault, ctx,
}: {
  settingKey: string; label: string; spec: Spec; value: Value; branchId: string | null; ctx: RenderedContext;
  draftMode: string | null; // "Owner" when this role only proposes
  isDefault: boolean;
}) {
  const [state, action, pending] = useActionState<SaveState, FormData>(saveAction, {});
  const [open, setOpen] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  // After a successful save the form closes (state.ok); after a refusal it stays open with
  // the input kept. The page also keys this editor by the newest version, so a remount
  // starts closed.
  const [seen, setSeen] = useState(state);
  if (seen !== state) {
    setSeen(state);
    if (state.ok) {
      setOpen(false);
      setConfirmRestore(false);
    }
  }
  const effId = useId();
  const verb = draftMode ? "Kirim Usulan" : "Simpan";
  return (
    <div className="grid min-w-0 gap-3">
      <Message state={state} />
      {!open && !confirmRestore && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => setOpen(true)}>{draftMode ? "Usulkan Perubahan" : "Ubah"}</Button>
          {!isDefault && <Button type="button" variant="plain" onClick={() => setConfirmRestore(true)}>Kembalikan ke default</Button>}
        </div>
      )}
      {/* A saved change or restore closes the form: the page keys this editor by the
          version in force, so it remounts with the new value. */}
      {(open || confirmRestore) && (
        <form action={action} className="grid min-w-0 gap-4 rounded-[var(--radius-field)] bg-[var(--bg-grouped)] p-3">
          <input type="hidden" name="key" value={settingKey} />
          <ContextFields ctx={ctx} />
          <input type="hidden" name="branch" value={branchId ?? ""} />
          <input type="hidden" name="intent" value={confirmRestore ? "restore" : "change"} />
          {confirmRestore ? (
            <p className="m-0">
              {draftMode
                ? <>Usulkan pengembalian seluruh <span className="font-semibold">{label}</span> ke nilai default? Berlaku setelah disetujui {draftMode}.</>
                : <>Kembalikan seluruh <span className="font-semibold">{label}</span> ke nilai default? Versi baru dicatat dan berlaku sekarang; riwayat tetap tersimpan.</>}
            </p>
          ) : (
            <Field s={spec} name="v" label={label} value={value} prev={state.values} />
          )}
          {!confirmRestore && (
            <label className="grid min-w-0 gap-1">
              <span className="font-semibold">Berlaku mulai</span>
              <input className={input} type="date" name="effective" defaultValue={state.values?.effective?.[0] ?? ""} aria-describedby={effId} />
              <span id={effId} className="text-[0.88rem] text-[var(--label-2)]">Kosongkan untuk berlaku sekarang, atau pilih tanggal mulai besok sampai setahun ke depan.</span>
            </label>
          )}
          <label className="grid min-w-0 gap-1">
            <span className="font-semibold">Alasan</span>
            <input className={input} name="reason" required minLength={3} maxLength={500} defaultValue={state.values?.reason?.[0] ?? ""} />
          </label>
          {draftMode && !confirmRestore && <p className="m-0 text-[0.88rem] text-[var(--label-2)]">Usulan berlaku setelah disetujui {draftMode}.</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>{pending ? "Menyimpan…" : draftMode ? "Kirim Usulan" : confirmRestore ? "Kembalikan ke default" : verb}</Button>
            <Button type="button" variant="plain" onClick={() => { setOpen(false); setConfirmRestore(false); }}>Batal</Button>
          </div>
        </form>
      )}
    </div>
  );
}

export function WithdrawDraft({ approvalId, group, ctx }: { approvalId: string; group: string; ctx: RenderedContext }) {
  const [state, action, pending] = useActionState<SaveState, FormData>(withdrawAction, {});
  return (
    <form action={action} className="grid gap-1">
      <input type="hidden" name="approval" value={approvalId} />
      <ContextFields ctx={ctx} />
      <input type="hidden" name="group" value={group} />
      <Button type="submit" variant="plain" disabled={pending}>Tarik Usulan</Button>
      <Message state={state} />
    </form>
  );
}
