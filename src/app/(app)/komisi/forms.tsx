"use client";
// Komisi forms (UX-16; T-087). Every write form posts its rendered context (HYG-009 B2-1) and, where the command is keyed, a fresh
// idempotency key (remounted after every answer: n). The database decides authority and money (DEC-099).
import { useActionState, useId, useState } from "react";
import { ContextFields } from "../../../components/context-fields";
import { Button } from "../../../components/ui/button";
import type { RenderedContext } from "../../../modules/org/context/context";
import {
  createRuleAction, decideReceivableAction, decideVersionAction, type KomisiState, markPaidAction, newVersionAction, openBatchAction, simulateAction, submitBatchAction,
} from "./actions";
import { ROLE, rp, TYPE } from "./labels";

const input = "min-h-[52px] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const hint = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
const grid2 = "grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 min-[700px]:grid-cols-2";
type Opt = { id: string; name: string };

function Notice({ s }: { s: KomisiState }) {
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
function Sheet({ label, prominent, open: initial, children }: { label: string; prominent?: boolean; open?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!initial);
  if (!open) return <Button type="button" variant={prominent ? "default" : "secondary"} onClick={() => setOpen(true)} className="justify-self-start">{label}</Button>;
  return (
    <section aria-label={label} className="grid min-w-0 gap-3 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-[var(--surface)] p-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 min-w-0 text-[1.25rem] font-semibold [overflow-wrap:anywhere]">{label}</h2>
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
      {help && <p id={`${id}-h`} className={hint}>{help}</p>}
    </div>
  );
}

// ── Rekap Komisi & Batch ──
export function OpenBatchForm({ ctx, period, max }: { ctx: RenderedContext; period: string; max: string }) {
  const [s, act, pending] = useActionState<KomisiState, FormData>(openBatchAction, {});
  const id = useId();
  return (
    <Sheet label="Buka Batch" prominent open={!!s.error}>
      <form action={act} key={`o${s.n ?? 0}`} aria-label="Buka batch komisi" className="grid min-w-0 gap-3">
        <ContextFields ctx={ctx} /><Key />
        <F id={`${id}-p`} label="Bulan" help="Batch berisi komisi sampai tanggal tutup bulan itu (Pengaturan › Komisi).">
          <input id={`${id}-p`} name="period" type="month" defaultValue={s.values?.period ?? period} max={max} required aria-describedby={`${id}-p-h`} className={input} />
        </F>
        <Notice s={s} />
        <Button type="submit" aria-disabled={pending} className="justify-self-start">Buka Batch</Button>
      </form>
    </Sheet>
  );
}
export function SubmitBatchForm({ ctx, batch }: { ctx: RenderedContext; batch: string }) {
  const [s, act, pending] = useActionState<KomisiState, FormData>(submitBatchAction, {});
  return (
    <form action={act} key={`s${s.n ?? 0}`} aria-label="Ajukan batch" className="grid min-w-0 gap-2">
      <ContextFields ctx={ctx} /><input type="hidden" name="batch" value={batch} />
      <p className={hint}>Setelah diajukan, isi batch dikunci dan Owner menyetujuinya di Persetujuan. Penyesuaian yang datang kemudian masuk batch berikutnya.</p>
      <Notice s={s} />
      <Button type="submit" aria-disabled={pending} className="justify-self-start">Ajukan Persetujuan</Button>
    </form>
  );
}
export function MarkPaidForm({ ctx, batch, total }: { ctx: RenderedContext; batch: string; total: number }) {
  const [s, act, pending] = useActionState<KomisiState, FormData>(markPaidAction, {});
  const id = useId();
  return (
    <form action={act} key={`p${s.n ?? 0}`} aria-label="Tandai dibayar" className="grid min-w-0 gap-3">
      <ContextFields ctx={ctx} /><input type="hidden" name="batch" value={batch} />
      <F id={`${id}-m`} label="Cara bayar">
        <select id={`${id}-m`} name="method" defaultValue="transfer" className={input}>
          <option value="transfer">Transfer</option>
          <option value="cash">Tunai</option>
        </select>
      </F>
      <Notice s={s} />
      <Button type="submit" aria-disabled={pending} className="justify-self-start">{`Tandai Dibayar ${rp(total)}`}</Button>
    </form>
  );
}
export function ReceivableForm({ ctx, id: rid, staff, amount }: { ctx: RenderedContext; id: string; staff: string; amount: number }) {
  const [s, act, pending] = useActionState<KomisiState, FormData>(decideReceivableAction, {});
  const id = useId();
  return (
    <form action={act} key={`r${s.n ?? 0}`} aria-label={`Putuskan piutang ${staff}`} className="grid min-w-0 gap-2">
      <ContextFields ctx={ctx} /><input type="hidden" name="receivable" value={rid} />
      <F id={`${id}-r`} label="Alasan"><textarea id={`${id}-r`} name="reason" rows={2} maxLength={500} defaultValue={s.values?.reason ?? ""} className={`${input} py-2`} /></F>
      <Notice s={s} />
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button type="submit" name="state" value="settled" aria-disabled={pending}>{`Tandai Lunas ${rp(amount)}`}</Button>
        <Button type="submit" name="state" value="waived" variant="secondary" aria-disabled={pending}>Hapuskan</Button>
      </div>
    </form>
  );
}

// ── Aturan Komisi ──
function ValueFields({ v, id }: { v: Record<string, string>; id: string }) {
  const [kind, setKind] = useState(v.kind ?? "percent");
  return (
    <>
      <fieldset className="grid min-w-0 gap-1 border-0 p-0">
        <legend className="mb-1">Bentuk nilai</legend>
        <div className="flex min-w-0 flex-wrap gap-4">
          <label className="flex min-h-[44px] items-center gap-2"><input type="radio" name="kind" value="percent" checked={kind === "percent"} onChange={() => setKind("percent")} />Persen dari dasar (tanpa PPN)</label>
          <label className="flex min-h-[44px] items-center gap-2"><input type="radio" name="kind" value="fixed" checked={kind === "fixed"} onChange={() => setKind("fixed")} />Nominal per tindakan</label>
        </div>
      </fieldset>
      <div className={grid2}>
        {kind === "percent"
          ? <F id={`${id}-pc`} label="Persen"><input id={`${id}-pc`} name="percent" inputMode="decimal" defaultValue={v.percent ?? ""} required className={input} /></F>
          : <F id={`${id}-am`} label="Nominal (Rp)"><input id={`${id}-am`} name="amount" inputMode="numeric" defaultValue={v.amount ?? ""} required className={input} /></F>}
        <F id={`${id}-ef`} label="Berlaku mulai (opsional)" help="Kosong: sejak diberlakukan. Penjualan sebelumnya tetap memakai versi lama.">
          <input id={`${id}-ef`} name="effective_from" type="date" defaultValue={v.effective_from ?? ""} aria-describedby={`${id}-ef-h`} className={input} />
        </F>
      </div>
    </>
  );
}
export function CreateRuleForm({ ctx, staff, items, open }: { ctx: RenderedContext; staff: Opt[]; items: Opt[]; open?: boolean }) {
  const [s, act, pending] = useActionState<KomisiState, FormData>(createRuleAction, {});
  const v = s.values ?? {};
  const id = useId();
  return (
    <Sheet label="Siapkan Aturan" prominent open={open || !!s.error}>
      <form action={act} key={`c${s.n ?? 0}`} aria-label="Siapkan aturan komisi" className="grid min-w-0 gap-3">
        <ContextFields ctx={ctx} /><Key />
        <div className={grid2}>
          <F id={`${id}-n`} label="Nama aturan"><input id={`${id}-n`} name="name" maxLength={80} defaultValue={v.name ?? ""} required className={input} /></F>
          <F id={`${id}-t`} label="Jenis kontribusi">
            <select id={`${id}-t`} name="contribution_type" defaultValue={v.contribution_type ?? "closing_bc"} className={input}>
              {Object.entries(TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </F>
          <F id={`${id}-r`} label="Untuk peran (opsional)">
            <select id={`${id}-r`} name="role" defaultValue={v.role ?? ""} className={input}>
              <option value="">Semua peran</option>
              {Object.entries(ROLE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </F>
          <F id={`${id}-s`} label="Khusus staf (opsional)" help="Aturan khusus staf menggantikan aturan peran.">
            <select id={`${id}-s`} name="staff" defaultValue={v.staff ?? ""} aria-describedby={`${id}-s-h`} className={input}>
              <option value="">Tidak</option>
              {staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </F>
          <F id={`${id}-i`} label="Khusus item (opsional)">
            <select id={`${id}-i`} name="item" defaultValue={v.item ?? ""} className={input}>
              <option value="">Semua item</option>
              {items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </F>
          <F id={`${id}-p`} label="Prioritas (opsional)"><input id={`${id}-p`} name="priority" inputMode="numeric" defaultValue={v.priority ?? ""} className={input} /></F>
        </div>
        <ValueFields v={v} id={id} />
        <Notice s={s} />
        <Button type="submit" aria-disabled={pending} className="justify-self-start">Simpan Draf</Button>
      </form>
    </Sheet>
  );
}
export function NewVersionForm({ ctx, rule, name }: { ctx: RenderedContext; rule: string; name: string }) {
  const [s, act, pending] = useActionState<KomisiState, FormData>(newVersionAction, {});
  const id = useId();
  return (
    <Sheet label={`Versi Baru · ${name}`} open={!!s.error}>
      <form action={act} key={`v${s.n ?? 0}`} aria-label={`Versi baru ${name}`} className="grid min-w-0 gap-3">
        <ContextFields ctx={ctx} /><Key /><input type="hidden" name="rule" value={rule} />
        <ValueFields v={s.values ?? {}} id={id} />
        <Notice s={s} />
        <Button type="submit" aria-disabled={pending} className="justify-self-start">Simpan Draf</Button>
      </form>
    </Sheet>
  );
}
export function DecideVersionForm({ ctx, version, label }: { ctx: RenderedContext; version: string; label: string }) {
  const [s, act, pending] = useActionState<KomisiState, FormData>(decideVersionAction, {});
  return (
    <form action={act} key={`d${s.n ?? 0}`} aria-label={`Putuskan draf ${label}`} className="grid min-w-0 gap-2">
      <ContextFields ctx={ctx} /><input type="hidden" name="version" value={version} />
      <Notice s={s} />
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button type="submit" name="action" value="activate" aria-disabled={pending}>Berlakukan</Button>
        <Button type="submit" name="action" value="cancel" variant="secondary" aria-disabled={pending}>Batalkan Draf</Button>
      </div>
    </form>
  );
}
export function SimulatorForm({ ctx, items, staff }: { ctx: RenderedContext; items: Opt[]; staff: Opt[] }) {
  const [s, act, pending] = useActionState<KomisiState, FormData>(simulateAction, {});
  const v = s.values ?? {};
  const id = useId();
  const pick = (k: string, label: string) => (
    <F id={`${id}-${k}`} label={label}>
      <select id={`${id}-${k}`} name={k} defaultValue={v[k] ?? ""} className={input}>
        <option value="">Tidak ada</option>
        {staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
    </F>
  );
  return (
    <Sheet label="Simulasi" open={!!s.sim || !!s.error}>
      <form action={act} key={`m${s.n ?? 0}`} aria-label="Simulasi komisi" className="grid min-w-0 gap-3">
        <ContextFields ctx={ctx} />
        <p className={hint}>Hanya hitungan: tidak ada yang tersimpan. Dasar persen adalah harga tanpa PPN, dibayar penuh.</p>
        <div className={grid2}>
          <F id={`${id}-i`} label="Item">
            <select id={`${id}-i`} name="item" defaultValue={v.item ?? items[0]?.id ?? ""} required className={input}>
              {items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </F>
          <F id={`${id}-pr`} label="Harga (Rp)"><input id={`${id}-pr`} name="price" inputMode="numeric" defaultValue={v.price ?? ""} required className={input} /></F>
          <F id={`${id}-at`} label="Tanggal penjualan (opsional)"><input id={`${id}-at`} name="at" type="date" defaultValue={v.at ?? ""} className={input} /></F>
          {staff.length > 0 && pick("closing", "BC closing")}
          {staff.length > 0 && pick("guiding", "BC pendamping")}
          {staff.length > 0 && pick("registrar", "Pendaftar pasien baru")}
          {staff.length > 0 && pick("performer", "Pelaksana")}
        </div>
        <Notice s={s} />
        <Button type="submit" variant="secondary" aria-disabled={pending} className="justify-self-start">Hitung</Button>
        {s.sim && (
          <div role="status" className="grid min-w-0 gap-1">
            <p className="m-0 tabular-nums">{`Dasar tanpa PPN ${rp(s.sim.basis)}`}</p>
            {s.sim.contributions.length === 0
              ? <p className={hint}>Pilih minimal satu kontributor.</p>
              : <ul className="m-0 grid min-w-0 list-none gap-1 p-0">
                  {s.sim.contributions.map((c) => (
                    <li key={c.type} className="tabular-nums [overflow-wrap:anywhere]">
                      {`${TYPE[c.type]}: ${c.rule_version_id ? rp(c.amount) : "tidak ada aturan yang berlaku"}`}
                    </li>
                  ))}
                </ul>}
          </div>
        )}
      </form>
    </Sheet>
  );
}
