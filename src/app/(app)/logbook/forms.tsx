"use client";
// Logbook forms (UX-9 ▸ Logbook; T-068). Every write form posts its rendered context (HYG-009 B2-1), the branch it was
// rendered for and a fresh idempotency key (remounted after every answer: n). Sheets open in place.
import { useActionState, useId, useState } from "react";
import { ContextFields } from "../../../components/context-fields";
import { Button } from "../../../components/ui/button";
import type { RenderedContext } from "../../../modules/org/context/context";
import { entryAction, type LogFormState, scheduleAction } from "./actions";
import { METHOD, RESULT, WASTE } from "./labels";

const input = "min-h-[52px] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const hint = "m-0 text-[0.88rem] text-[var(--label-2)]";
const grid2 = "grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 min-[700px]:grid-cols-2";

function Notice({ s }: { s: LogFormState }) {
  return (
    <>
      {s.error && <p role="alert" className="m-0 text-[var(--danger)] [overflow-wrap:anywhere]">{s.error}</p>}
      {s.ok && <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--success-soft)] px-3 py-2 text-[var(--success)]">{s.ok}</p>}
    </>
  );
}
function Key() {
  const [k] = useState(() => crypto.randomUUID());
  return <input type="hidden" name="key" value={k} />;
}
function Sheet({ label, prominent, children }: { label: string; prominent?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!open) return <Button type="button" variant={prominent ? "default" : "secondary"} onClick={() => setOpen(true)} className="justify-self-start">{label}</Button>;
  return (
    <section aria-label={label} className="grid min-w-0 gap-3 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-[var(--surface)] p-4">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h2 className="m-0 text-[1.25rem] font-semibold">{label}</h2>
        <Button type="button" variant="plain" onClick={() => setOpen(false)}>Tutup</Button>
      </div>
      {children}
    </section>
  );
}
function F({ id, label, children, help }: { id: string; label: string; children: React.ReactNode; help?: string }) {
  return (
    <div className="grid min-w-0 gap-1">
      <label htmlFor={id}>{label}</label>
      {children}
      {help && <p className={hint}>{help}</p>}
    </div>
  );
}
type Opt = { id: string; name: string };
const Hidden = ({ ctx, branch }: { ctx: RenderedContext; branch: string }) => (<><ContextFields ctx={ctx} /><Key /><input type="hidden" name="branch" value={branch} /></>);

export function SterilizationForm({ ctx, branch, today, devices, rooms }: { ctx: RenderedContext; branch: string; today: string; devices: Opt[]; rooms: Opt[] }) {
  const [s, act, pending] = useActionState<LogFormState, FormData>(entryAction, {});
  const id = useId();
  return (
    <Sheet label="Catat Sterilisasi" prominent>
      <form action={act} key={`st${s.n ?? 0}`} aria-label="Catat sterilisasi" className="grid min-w-0 gap-3">
        <Hidden ctx={ctx} branch={branch} /><input type="hidden" name="kind" value="sterilization" />
        <div className={grid2}>
          <F id={`${id}-d`} label="Tanggal"><input id={`${id}-d`} name="performed_on" type="date" defaultValue={today} max={today} required className={input} /></F>
          <F id={`${id}-c`} label="Nomor siklus (opsional)"><input id={`${id}-c`} name="cycle_no" maxLength={40} className={input} /></F>
          <F id={`${id}-m`} label="Metode">
            <select id={`${id}-m`} name="method" required defaultValue="" className={input}>
              <option value="" disabled>Pilih metode</option>
              {Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </F>
          <F id={`${id}-p`} label="Hasil indikator">
            <select id={`${id}-p`} name="passed" required defaultValue="" className={input}>
              <option value="" disabled>Pilih hasil</option>
              <option value="yes">Lulus</option>
              <option value="no">Gagal</option>
            </select>
          </F>
          {devices.length > 0 && (
            <F id={`${id}-v`} label="Alat sterilisator (opsional)">
              <select id={`${id}-v`} name="device" defaultValue="" className={input}>
                <option value="">Tanpa alat</option>
                {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </F>
          )}
          {rooms.length > 0 && (
            <F id={`${id}-r`} label="Ruang (opsional)">
              <select id={`${id}-r`} name="room" defaultValue="" className={input}>
                <option value="">Tanpa ruang</option>
                {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </F>
          )}
        </div>
        <F id={`${id}-i`} label="Alat atau set yang disterilkan"><input id={`${id}-i`} name="items" required minLength={2} maxLength={500} className={input} /></F>
        <F id={`${id}-n`} label="Catatan (opsional)"><input id={`${id}-n`} name="note" maxLength={500} className={input} /></F>
        <Notice s={s} />
        <Button type="submit" disabled={pending} className="justify-self-start">Simpan</Button>
      </form>
    </Sheet>
  );
}

export function DeviceEntryForm({ ctx, branch, today, devices, device }: { ctx: RenderedContext; branch: string; today: string; devices: Opt[]; device?: string }) {
  const [s, act, pending] = useActionState<LogFormState, FormData>(entryAction, {});
  const id = useId();
  const one = devices.find((d) => d.id === device);
  return (
    <Sheet label={one ? `Catat untuk ${one.name}` : "Catat Kalibrasi atau Perawatan"} prominent={!one}>
      <form action={act} key={`dv${s.n ?? 0}`} aria-label={one ? `Catat kalibrasi atau perawatan ${one.name}` : "Catat kalibrasi atau perawatan"} className="grid min-w-0 gap-3">
        <Hidden ctx={ctx} branch={branch} />
        <div className={grid2}>
          <F id={`${id}-k`} label="Jenis">
            <select id={`${id}-k`} name="kind" required defaultValue="calibration" className={input}>
              <option value="calibration">Kalibrasi</option>
              <option value="maintenance">Perawatan</option>
            </select>
          </F>
          <F id={`${id}-d`} label="Tanggal"><input id={`${id}-d`} name="performed_on" type="date" defaultValue={today} max={today} required className={input} /></F>
          {one ? <input type="hidden" name="device" value={one.id} /> : (
            <F id={`${id}-v`} label="Alat">
              <select id={`${id}-v`} name="device" required defaultValue="" className={input}>
                <option value="" disabled>Pilih alat</option>
                {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </F>
          )}
          <F id={`${id}-r`} label="Hasil">
            <select id={`${id}-r`} name="result" required defaultValue="" className={input}>
              <option value="" disabled>Pilih hasil</option>
              {Object.entries(RESULT).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </F>
          <F id={`${id}-p`} label="Teknisi atau vendor"><input id={`${id}-p`} name="performer_name" required minLength={2} maxLength={120} className={input} /></F>
          <F id={`${id}-c`} label="Nomor sertifikat (opsional)"><input id={`${id}-c`} name="certificate_no" maxLength={80} className={input} /></F>
        </div>
        <F id={`${id}-n`} label="Catatan (opsional)"><input id={`${id}-n`} name="note" maxLength={500} className={input} /></F>
        <Notice s={s} />
        <Button type="submit" disabled={pending} className="justify-self-start">Simpan</Button>
      </form>
    </Sheet>
  );
}

export function WasteForm({ ctx, branch, today }: { ctx: RenderedContext; branch: string; today: string }) {
  const [s, act, pending] = useActionState<LogFormState, FormData>(entryAction, {});
  const id = useId();
  return (
    <Sheet label="Catat Serah Limbah B3" prominent>
      <form action={act} key={`w${s.n ?? 0}`} aria-label="Catat serah limbah B3" className="grid min-w-0 gap-3">
        <Hidden ctx={ctx} branch={branch} /><input type="hidden" name="kind" value="b3_waste" />
        <div className={grid2}>
          <F id={`${id}-d`} label="Tanggal serah"><input id={`${id}-d`} name="performed_on" type="date" defaultValue={today} max={today} required className={input} /></F>
          <F id={`${id}-c`} label="Kategori">
            <select id={`${id}-c`} name="waste_category" required defaultValue="" className={input}>
              <option value="" disabled>Pilih kategori</option>
              {Object.entries(WASTE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </F>
          <F id={`${id}-q`} label="Jumlah (gram)"><input id={`${id}-q`} name="quantity_grams" inputMode="numeric" required className={input} /></F>
          <F id={`${id}-h`} label="Pengangkut berizin"><input id={`${id}-h`} name="handler_name" required minLength={2} maxLength={120} className={input} /></F>
          <F id={`${id}-r`} label="Nomor bukti serah (manifes)"><input id={`${id}-r`} name="handover_ref" required maxLength={80} className={input} /></F>
        </div>
        <F id={`${id}-n`} label="Catatan (opsional)"><input id={`${id}-n`} name="note" maxLength={500} className={input} /></F>
        <Notice s={s} />
        <Button type="submit" disabled={pending} className="justify-self-start">Simpan</Button>
      </form>
    </Sheet>
  );
}

export function ScheduleForm({ ctx, branch, device, label, kind, s0, today }: {
  ctx: RenderedContext; branch: string; device: string; label: string; kind: "calibration" | "maintenance"; today: string;
  s0?: { interval_days: number; next_due_on: string; active: boolean };
}) {
  const [s, act, pending] = useActionState<LogFormState, FormData>(scheduleAction, {});
  const id = useId();
  const what = kind === "calibration" ? "Kalibrasi" : "Perawatan";
  return (
    <Sheet label={`Jadwal ${what}`}>
      <form action={act} key={`sc${s.n ?? 0}`} aria-label={`Jadwal ${what.toLowerCase()} ${label}`} className="grid min-w-0 gap-3">
        <Hidden ctx={ctx} branch={branch} /><input type="hidden" name="device" value={device} /><input type="hidden" name="kind" value={kind} />
        <div className={grid2}>
          <F id={`${id}-i`} label="Interval (hari)"><input id={`${id}-i`} name="interval_days" inputMode="numeric" required defaultValue={s0?.interval_days ?? (kind === "calibration" ? 180 : 30)} className={input} /></F>
          <F id={`${id}-d`} label="Jatuh tempo berikutnya"><input id={`${id}-d`} name="next_due_on" type="date" required defaultValue={s0?.next_due_on ?? today} className={input} /></F>
        </div>
        {s0 && (
          <label className="flex min-h-[52px] items-center gap-3">
            <input type="checkbox" name="active" value="on" defaultChecked={s0.active} className="size-5" onChange={(e) => { e.currentTarget.value = e.currentTarget.checked ? "on" : "off"; }} />
            <span>Jadwal aktif</span>
          </label>
        )}
        <Notice s={s} />
        <Button type="submit" disabled={pending} className="justify-self-start">Simpan Jadwal</Button>
      </form>
    </Sheet>
  );
}
