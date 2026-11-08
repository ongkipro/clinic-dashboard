"use client";
// Katalog forms (UX-25): the version form (Simpan; "Minta Review" when a clinical field differs
// from the active version, PR-41) and Tarik Ajuan for a pending clinical change. The database
// decides; the button text only tells the editor what will happen.
import { useActionState, useId, useState } from "react";
import { ContextFields } from "../../../components/context-fields";
import { Button } from "../../../components/ui/button";
import type { RenderedContext } from "../../../modules/org/context/context";
import { type KatalogState, publishAction, withdrawAction } from "./actions";
import { KIND_LABEL, SCOPE_LABEL, TAX_LABEL } from "./labels";

const input = "min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";
const area = "min-h-[6rem] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3 py-2";

export type Initial = {
  name: string; tax_category: string; tax_basis: string; normal_price: string; control_count: string; control_validity_days: string;
  booking_dp_enabled: boolean; booking_dp_amount: string; min_dp_pct: string; installments_allowed: boolean; validity_days: string;
  commission_scope: string[]; indications: string; contraindications: string; consent_template: string; delegation: string;
};
const CLINICAL = ["indications", "contraindications", "consent_template", "delegation"] as const;
const norm = (s: string) => s.trim();

function Text({ name, label, value, hint, numeric }: { name: string; label: string; value: string; hint?: string; numeric?: boolean }) {
  const id = useId();
  return (
    <label className="grid min-w-0 gap-1">
      <span className="font-semibold">{label}</span>
      <input className={input} name={name} defaultValue={value} inputMode={numeric ? "numeric" : undefined} aria-describedby={hint ? `${id}-h` : undefined} />
      {hint && <span id={`${id}-h`} className="text-[0.88rem] text-[var(--label-2)]">{hint}</span>}
    </label>
  );
}

export function VersionForm({ ctx, itemId, initial, clinicalActive, canSeeClinical }: {
  ctx: RenderedContext; itemId: string | null; initial: Initial; clinicalActive: Record<(typeof CLINICAL)[number], string>; canSeeClinical: boolean;
}) {
  const [state, action, pending] = useActionState<KatalogState, FormData>(publishAction, {});
  const v = (k: keyof Initial) => (state.values?.[k] ?? String(initial[k] ?? ""));
  const [clinical, setClinical] = useState<Record<string, string>>(() => Object.fromEntries(CLINICAL.map((k) => [k, state.values?.[k] ?? initial[k]])));
  const changed = CLINICAL.some((k) => norm(clinical[k] ?? "") !== norm(clinicalActive[k] ?? ""));
  return (
    <form action={action} className="grid min-w-0 gap-4" aria-label={itemId ? "Versi baru item katalog" : "Item katalog baru"}>
      <ContextFields ctx={ctx} />
      {itemId ? (
        <input type="hidden" name="item" value={itemId} />
      ) : (
        <div className="grid min-w-0 gap-3 min-[700px]:grid-cols-2">
          <label className="grid min-w-0 gap-1">
            <span className="font-semibold">Jenis</span>
            <select className={input} name="kind" defaultValue={state.values?.kind ?? "service"}>
              {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <Text name="code" label="Kode" value={state.values?.code ?? ""} hint="Huruf besar, angka, tanda hubung; tidak bisa diubah." />
        </div>
      )}
      <fieldset className="grid min-w-0 gap-3 border-0 p-0">
        <legend className="mb-2 text-[1.1rem] font-semibold">Umum & harga</legend>
        <Text name="name" label="Nama" value={v("name")} />
        <div className="grid min-w-0 gap-3 min-[700px]:grid-cols-2">
          <Text name="normal_price" label="Harga normal (Rp)" value={v("normal_price")} numeric />
          <label className="grid min-w-0 gap-1">
            <span className="font-semibold">Kategori pajak</span>
            <select className={input} name="tax_category" defaultValue={v("tax_category")}>
              <option value="">Pilih</option>
              {Object.entries(TAX_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
        </div>
        <Text name="tax_basis" label="Dasar kategori pajak" value={v("tax_basis")} hint="Mengapa kategori ini berlaku (dicatat untuk penasihat pajak)." />
        <div className="grid min-w-0 gap-3 min-[700px]:grid-cols-3">
          <Text name="control_count" label="Kontrol gratis (kali)" value={v("control_count")} numeric />
          <Text name="control_validity_days" label="Berlaku kontrol (hari)" value={v("control_validity_days")} numeric />
          <Text name="validity_days" label="Masa berlaku paket (hari)" value={v("validity_days")} numeric hint="Untuk paket: 30–1095 hari." />
        </div>
        <div className="grid min-w-0 gap-3 min-[700px]:grid-cols-2">
          <label className="flex min-h-[var(--target)] items-center gap-3">
            <input type="checkbox" name="booking_dp_enabled" value="1" className="size-5" defaultChecked={state.values ? state.values.booking_dp_enabled === "1" : initial.booking_dp_enabled} />
            <span className="font-semibold">DP booking</span>
          </label>
          <Text name="booking_dp_amount" label="Nominal DP booking (Rp)" value={v("booking_dp_amount")} numeric />
        </div>
        <div className="grid min-w-0 gap-3 min-[700px]:grid-cols-2">
          <Text name="min_dp_pct" label="DP minimal paket (%)" value={v("min_dp_pct")} numeric />
          <label className="flex min-h-[var(--target)] items-center gap-3">
            <input type="checkbox" name="installments_allowed" value="1" className="size-5" defaultChecked={state.values ? state.values.installments_allowed === "1" : initial.installments_allowed} />
            <span className="font-semibold">Boleh dicicil</span>
          </label>
        </div>
        <fieldset className="grid min-w-0 gap-1 border-0 p-0">
          <legend className="font-semibold">Komisi untuk</legend>
          <div className="flex flex-wrap gap-x-5">
            {Object.entries(SCOPE_LABEL).map(([k, l]) => (
              <label key={k} className="flex min-h-[var(--target)] items-center gap-2">
                <input type="checkbox" name="commission_scope" value={k} className="size-5" defaultChecked={initial.commission_scope.includes(k)} />
                {l}
              </label>
            ))}
          </div>
        </fieldset>
      </fieldset>
      {canSeeClinical && (
        <fieldset className="grid min-w-0 gap-3 border-0 p-0">
          <legend className="mb-1 text-[1.1rem] font-semibold">Data klinis</legend>
          <p className="m-0 text-[var(--label-2)]">Perubahan di bagian ini aktif setelah direview Penanggung Jawab Klinik. Versi aktif tetap berlaku sampai disetujui.</p>
          {([["indications", "Indikasi"], ["contraindications", "Kontraindikasi"], ["consent_template", "Templat persetujuan tindakan"], ["delegation", "Delegasi"]] as const).map(([k, l]) => (
            <label key={k} className="grid min-w-0 gap-1">
              <span className="font-semibold">{l}</span>
              <textarea className={area} name={k} value={clinical[k]} onChange={(e) => setClinical((c) => ({ ...c, [k]: e.target.value }))} />
            </label>
          ))}
        </fieldset>
      )}
      {!canSeeClinical && CLINICAL.map((k) => <input key={k} type="hidden" name={k} value={clinical[k]} />)}
      <label className="grid min-w-0 gap-1">
        <span className="font-semibold">Alasan perubahan</span>
        <input className={input} name="reason" defaultValue={state.values?.reason ?? ""} />
      </label>
      {state.error && <p role="alert" className="m-0 text-[var(--danger)]">{state.error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" aria-disabled={pending}>{changed ? "Minta Review" : "Simpan"}</Button>
      </div>
    </form>
  );
}

export function WithdrawPending({ ctx, itemId, approvalId }: { ctx: RenderedContext; itemId: string; approvalId: string }) {
  const [state, action, pending] = useActionState<KatalogState, FormData>(withdrawAction, {});
  return (
    <form action={action} className="grid gap-2" aria-label="Tarik ajuan perubahan">
      <ContextFields ctx={ctx} />
      <input type="hidden" name="item" value={itemId} />
      <input type="hidden" name="approval" value={approvalId} />
      <div><Button type="submit" variant="plain" aria-disabled={pending}>Tarik Ajuan</Button></div>
      {state.error && <p role="alert" className="m-0 text-[var(--danger)]">{state.error}</p>}
      {state.ok && <p role="status" className="m-0 text-[var(--success)]">{state.ok}</p>}
    </form>
  );
}
