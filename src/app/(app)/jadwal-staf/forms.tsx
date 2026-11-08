"use client";
// Jadwal Staf forms (UX-33, PR-48, T-043). The week grid is one form (Simpan Jadwal) with one set of
// inputs: a staff × day grid at regular widths, a list per day at compact widths, switched by CSS only.
// After a refused save the fields remount from the values the action returns (the T-035 lesson); after a
// save the page reloads from the database.
import { useActionState, useId } from "react";
import { ContextFields } from "../../../components/context-fields";
import { Button } from "../../../components/ui/button";
import type { RenderedContext } from "../../../modules/org/context/context";
import type { Leave, ShiftRow } from "../../../modules/scheduling/rosters/rosters";
import { addLeaveAction, cancelLeaveAction, type JadwalState, saveWeekAction } from "./actions";
import { dayLabel, LEAVE_LABEL, ROLE_LABEL } from "./labels";

const input = "min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-2";
const hintCls = "text-[0.88rem] text-[var(--label-2)]";

function Notice({ s }: { s: JadwalState }) {
  return (
    <>
      {s.error && <p role="alert" className="m-0 text-[var(--danger)]">{s.error}</p>}
      {s.ok && <p role="status" className="m-0 text-[var(--success)]">{s.ok}</p>}
    </>
  );
}

type Staff = { id: string; name: string; roles: string[] };
type CellValues = { starts: string; ends: string; bstart: string; bend: string };

function cellFrom(shifts: ShiftRow[], staffId: string, date: string): CellValues {
  const w = shifts.find((s) => s.staffId === staffId && s.date === date && s.kind === "work");
  const b = shifts.find((s) => s.staffId === staffId && s.date === date && s.kind === "break");
  return { starts: w?.starts ?? "", ends: w?.ends ?? "", bstart: b?.starts ?? "", bend: b?.ends ?? "" };
}

// One staff × day cell: work start/end and an optional break. Past days are read-only text (not posted).
function Cell({ staff, date, v, past, onLeave }: { staff: Staff; date: string; v: CellValues; past: boolean; onLeave: boolean }) {
  const n = (k: string) => `s_${staff.id}_${date}_${k}`;
  const who = `${staff.name}, ${dayLabel(date)}`;
  if (past) {
    return <span className={hintCls}>{v.starts ? `${v.starts}–${v.ends}${v.bstart ? ` (istirahat ${v.bstart}–${v.bend})` : ""}` : "—"}</span>;
  }
  return (
    <div className="grid min-w-0 gap-1">
      {onLeave && <span className="text-[0.88rem] font-semibold text-[var(--warning)]">Tidak hadir</span>}
      <div className="grid grid-cols-2 gap-1">
        <input aria-label={`Mulai kerja ${who}`} className={input} name={n("starts")} defaultValue={v.starts} inputMode="numeric" placeholder="09:00" />
        <input aria-label={`Selesai kerja ${who}`} className={input} name={n("ends")} defaultValue={v.ends} inputMode="numeric" placeholder="17:00" />
      </div>
      <div className="grid grid-cols-2 gap-1">
        <input aria-label={`Mulai istirahat ${who}`} className={input} name={n("bstart")} defaultValue={v.bstart} inputMode="numeric" placeholder="Istirahat" />
        <input aria-label={`Selesai istirahat ${who}`} className={input} name={n("bend")} defaultValue={v.bend} inputMode="numeric" placeholder="—" />
      </div>
    </div>
  );
}

// One set of inputs for every width (inputs hidden by CSS still post, so two layouts would post every
// name twice: browser run 3). Compact: one section per day. Regular: the day sections become
// display:contents and their cells are placed into a staff × day grid by row and column.
export function WeekForm({ ctx, branch, week, days, today, staff, shifts, leave }: {
  ctx: RenderedContext; branch: string; week: string; days: string[]; today: string; staff: Staff[]; shifts: ShiftRow[]; leave: Leave[];
}) {
  const [state, act, pending] = useActionState<JadwalState, FormData>(saveWeekAction, {});
  // Refused: show what was posted; otherwise what the database holds.
  const posted = state.error ? state.values ?? {} : null;
  const value = (s: Staff, d: string): CellValues => {
    if (!posted) return cellFrom(shifts, s.id, d);
    const k = (x: string) => posted[`s_${s.id}_${d}_${x}`] ?? "";
    return { starts: k("starts"), ends: k("ends"), bstart: k("bstart"), bend: k("bend") };
  };
  const off = (s: Staff, d: string) => leave.some((l) => !l.cancelledAt && l.staffId === s.id && l.from <= d && d <= l.to);
  const at = (r: number, c: number) => ({ "--r": r, "--c": c }) as React.CSSProperties;
  const place = "@[52rem]:[grid-row:var(--r)] @[52rem]:[grid-column:var(--c)]";
  return (
    <form action={act} aria-label="Jadwal minggu ini" className="@container grid min-w-0 gap-3" key={state.n ?? 0}>
      <ContextFields ctx={ctx} />
      <input type="hidden" name="branch" value={branch} />
      <input type="hidden" name="week" value={week} />
      {staff.map((s) => <input key={s.id} type="hidden" name="staff" value={s.id} />)}
      <div role="region" aria-label={`Kisi jadwal, minggu mulai ${dayLabel(week)}`} tabIndex={0}
        className="grid min-w-0 gap-4 @[52rem]:max-w-full @[52rem]:grid-cols-[minmax(10rem,auto)_repeat(7,minmax(9.5rem,1fr))] @[52rem]:gap-x-2 @[52rem]:gap-y-3 @[52rem]:overflow-x-auto @[52rem]:rounded-[var(--radius-group)] @[52rem]:bg-[var(--surface)] @[52rem]:p-3">
        {/* Regular widths only: the staff column (text, no inputs). */}
        <span aria-hidden="true" className="hidden font-semibold @[52rem]:block" style={at(1, 1)}>Staf</span>
        {staff.map((s, j) => (
          <div key={s.id} aria-hidden="true" className={`hidden min-w-0 @[52rem]:block ${place}`} style={at(j + 2, 1)}>
            <span className="block">{s.name}</span>
            <span className={hintCls}>{s.roles.map((r) => ROLE_LABEL[r]).join(", ")}</span>
          </div>
        ))}
        {days.map((d, i) => (
          <section key={d} aria-label={dayLabel(d)} className="grid min-w-0 gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-3 @[52rem]:contents">
            <h3 className={`m-0 text-[1.05rem] font-semibold ${place}`} style={at(1, i + 2)}>{dayLabel(d)}</h3>
            {staff.map((s, j) => (
              <div key={s.id} className={`grid min-w-0 gap-1 border-t border-[var(--separator)] pt-2 @[52rem]:border-0 @[52rem]:pt-0 ${place}`} style={at(j + 2, i + 2)}>
                <span className="font-semibold @[52rem]:hidden">{s.name} <span className={hintCls}>· {s.roles.map((r) => ROLE_LABEL[r]).join(", ")}</span></span>
                <Cell staff={s} date={d} v={value(s, d)} past={d < today} onLeave={off(s, d)} />
              </div>
            ))}
          </section>
        ))}
      </div>
      <p className={hintCls}>Kosongkan jam untuk hari libur staf. Tulis 24:00 untuk sampai tengah malam. Hari yang sudah lewat tidak dapat diubah.</p>
      <Notice s={state} />
      <div><Button type="submit" aria-disabled={pending}>Simpan Jadwal</Button></div>
    </form>
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

export function AddLeaveForm({ ctx, branch, staff, today }: { ctx: RenderedContext; branch: string; staff: Staff[]; today: string }) {
  const [state, act, pending] = useActionState<JadwalState, FormData>(addLeaveAction, {});
  const v = state.error ? state.values ?? {} : {};
  return (
    <form action={act} aria-label="Catat ketidakhadiran" className="@container grid min-w-0 gap-3" key={state.n ?? 0}>
      <ContextFields ctx={ctx} />
      <input type="hidden" name="branch" value={branch} />
      <div className="grid min-w-0 gap-3 @[40rem]:grid-cols-2">
        <Field label="Staf">
          {(id) => (
            <select id={id} className={input} name="staff" defaultValue={v.staff ?? ""}>
              <option value="">Pilih staf</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Jenis">
          {(id) => (
            <select id={id} className={input} name="kind" defaultValue={v.kind ?? "leave"}>
              {Object.entries(LEAVE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          )}
        </Field>
        <Field label="Dari tanggal">{(id) => <input id={id} type="date" className={input} name="from" min={today} defaultValue={v.from ?? ""} />}</Field>
        <Field label="Sampai tanggal">{(id) => <input id={id} type="date" className={input} name="to" min={today} defaultValue={v.to ?? ""} />}</Field>
      </div>
      <Field label="Alasan">{(id) => <input id={id} className={input} name="reason" defaultValue={v.reason ?? ""} />}</Field>
      <Notice s={state} />
      <div><Button type="submit" variant="secondary" aria-disabled={pending}>Catat</Button></div>
    </form>
  );
}

export function CancelLeave({ ctx, id, label }: { ctx: RenderedContext; id: string; label: string }) {
  const [state, act, pending] = useActionState<JadwalState, FormData>(cancelLeaveAction, {});
  const rid = useId();
  return (
    <form action={act} aria-label={`Batalkan ${label}`} className="grid min-w-0 gap-2 @[30rem]:grid-cols-[minmax(0,1fr)_auto] @[30rem]:items-end" key={state.n ?? 0}>
      <ContextFields ctx={ctx} />
      <input type="hidden" name="id" value={id} />
      <div className="grid min-w-0 gap-1">
        <label htmlFor={rid} className="text-[0.88rem]">Alasan pembatalan</label>
        <input id={rid} className={input} name="reason" defaultValue={state.error ? state.values?.reason ?? "" : ""} />
      </div>
      <div><Button type="submit" variant="secondary" aria-disabled={pending}>Batalkan</Button></div>
      <div className="@[30rem]:col-span-2"><Notice s={state} /></div>
    </form>
  );
}
