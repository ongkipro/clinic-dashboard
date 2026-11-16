"use client";
// Kampanye forms (UX-19; T-100). Every write form posts its rendered context (HYG-009 B2-1) and a fresh idempotency key (remounted after
// every answer: n). The database decides authority, lifecycle and the Q-15 gate (DEC-112).
import { useActionState, useState } from "react";
import { ContextFields } from "../../../components/context-fields";
import { Button } from "../../../components/ui/button";
import type { SegmentRules } from "../../../modules/crm/campaigns/campaigns";
import type { RenderedContext } from "../../../modules/org/context/context";
import { type KampanyeState, saveSegmentAction, scheduleAction, sendAction, unscheduleAction } from "./actions";
import { MONTHS } from "./labels";

const input = "min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const hint = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";

function Notice({ s }: { s: KampanyeState }) {
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

// The segment editor: the closed rule set (no service, procedure or package — DEC-112); members always need marketing consent.
export function SegmentForm({ ctx, branches, segment }: { ctx: RenderedContext; branches: { id: string; name: string }[];
  segment?: { id: string; name: string; rules: SegmentRules } }) {
  const [s, act, pending] = useActionState<KampanyeState, FormData>(saveSegmentAction, {});
  const r = segment?.rules ?? {};
  const visit = r.visit_within_days ? "within" : r.no_visit_within_days ? "not_within" : "";
  const id = segment?.id ?? "baru";
  return (
    <form action={act} key={`g${id}${s.n ?? 0}`} aria-label={segment ? `Ubah segmen ${segment.name}` : "Segmen baru"} className="grid min-w-0 gap-3">
      <ContextFields ctx={ctx} /><Key />{segment && <input type="hidden" name="id" value={segment.id} />}
      <label className="grid gap-1">Nama segmen<input name="name" required minLength={2} maxLength={120} defaultValue={segment?.name} className={input} /></label>
      <div className="grid min-w-0 gap-3 min-[700px]:grid-cols-2">
        <label className="grid gap-1">Cabang terdaftar
          <select name="branch_id" defaultValue={r.branch_id ?? ""} className={input}>
            <option value="">Semua cabang</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1">Bulan ulang tahun
          <select name="birthday_month" defaultValue={r.birthday_month ? String(r.birthday_month) : ""} className={input}>
            <option value="">Semua bulan</option>
            {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
          </select>
        </label>
        <label className="grid gap-1">Kunjungan
          <select name="visit_mode" defaultValue={visit} className={input}>
            <option value="">Semua</option>
            <option value="within">Berkunjung dalam … hari terakhir</option>
            <option value="not_within">Tidak berkunjung dalam … hari terakhir</option>
          </select>
        </label>
        <label className="grid gap-1">Jumlah hari
          <input type="number" name="visit_days" min={1} max={730} defaultValue={String(r.visit_within_days ?? r.no_visit_within_days ?? "")} className={input} />
        </label>
        <label className="grid gap-1">Usia minimal<input type="number" name="age_min" min={0} max={120} defaultValue={r.age_min !== undefined ? String(r.age_min) : ""} className={input} /></label>
        <label className="grid gap-1">Usia maksimal<input type="number" name="age_max" min={0} max={120} defaultValue={r.age_max !== undefined ? String(r.age_max) : ""} className={input} /></label>
        <label className="grid gap-1">Jenis kelamin
          <select name="sex" defaultValue={r.sex ?? ""} className={input}>
            <option value="">Semua</option><option value="female">Perempuan</option><option value="male">Laki-laki</option>
          </select>
        </label>
      </div>
      <p className={hint}>Hanya pasien dengan persetujuan promosi yang masuk segmen. Segmen tidak memakai riwayat tindakan.</p>
      <Notice s={s} />
      <Button type="submit" aria-disabled={pending} className="justify-self-start">Simpan Segmen</Button>
    </form>
  );
}

export function ScheduleForm({ ctx, campaign, segments, templates, value, min }: { ctx: RenderedContext; campaign: string;
  segments: { id: string; name: string }[]; templates: { id: string; name: string }[];
  value: { segment_id: string | null; template_id: string | null; scheduled_for: string | null }; min: string }) {
  const [s, act, pending] = useActionState<KampanyeState, FormData>(scheduleAction, {});
  return (
    <form action={act} key={`j${campaign}${s.n ?? 0}`} aria-label="Jadwalkan kampanye" className="grid min-w-0 gap-3">
      <ContextFields ctx={ctx} /><Key /><input type="hidden" name="campaign" value={campaign} />
      <div className="grid min-w-0 gap-3 min-[820px]:grid-cols-3">
        <label className="grid gap-1">Segmen
          <select name="segment" required defaultValue={value.segment_id ?? ""} className={input}>
            <option value="" disabled>Pilih segmen</option>
            {segments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1">Templat promosi
          <select name="template" required defaultValue={value.template_id ?? ""} className={input}>
            <option value="" disabled>Pilih templat</option>
            {templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1">Tanggal kirim<input type="date" name="date" required min={min} defaultValue={value.scheduled_for ?? min} className={input} /></label>
      </div>
      {templates.length === 0 && <p className={hint}>Belum ada templat promosi yang disetujui. Ajukan di Templat WhatsApp.</p>}
      <Notice s={s} />
      <Button type="submit" aria-disabled={pending} className="justify-self-start">Jadwalkan</Button>
    </form>
  );
}

export function StateButtons({ ctx, campaign, state, locked }: { ctx: RenderedContext; campaign: string; state: string; locked: boolean }) {
  const [u, actU, pendingU] = useActionState<KampanyeState, FormData>(unscheduleAction, {});
  const [k, actK, pendingK] = useActionState<KampanyeState, FormData>(sendAction, {});
  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex min-w-0 flex-wrap gap-2">
        {state === "scheduled" && (
          <form action={actK} key={`k${campaign}${k.n ?? 0}`} aria-label="Kirim kampanye">
            <ContextFields ctx={ctx} /><Key /><input type="hidden" name="campaign" value={campaign} />
            <Button type="submit" aria-disabled={pendingK || locked} disabled={locked} aria-describedby={locked ? "terkunci" : undefined}>Kirim</Button>
          </form>
        )}
        {(state === "scheduled" || state === "draft") && (
          <form action={actU} key={`u${campaign}${u.n ?? 0}`} aria-label="Ubah status kampanye" className="flex min-w-0 flex-wrap gap-2">
            <ContextFields ctx={ctx} /><Key /><input type="hidden" name="campaign" value={campaign} />
            {state === "scheduled" && <Button type="submit" name="to" value="draft" variant="plain" aria-disabled={pendingU}>Kembalikan ke Draf</Button>}
            <Button type="submit" name="to" value="cancelled" variant="plain" aria-disabled={pendingU}>Batalkan</Button>
          </form>
        )}
      </div>
      <Notice s={u} /><Notice s={k} />
    </div>
  );
}
