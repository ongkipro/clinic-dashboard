"use client";
// Client forms for Kode Promo & Voucher (/situs/promo; PR-77, UX-50; T-123).
import { useActionState, useId } from "react";
import { ContextFields } from "../../../../components/context-fields";
import type { RenderedContext } from "../../../../modules/org/context/context";
import { createPromoAction, togglePromoAction, type PromoActionState } from "./actions";

export function CreatePromoForm({
  ctx,
  services,
}: {
  ctx: RenderedContext;
  services: { id: string; name: string; code: string }[];
}) {
  const [state, action, pending] = useActionState<PromoActionState, FormData>(createPromoAction, {});
  const key = useId();
  return (
    <form action={action} className="grid gap-4 rounded-[var(--radius-group)] bg-[var(--surface)] p-5">
      <ContextFields ctx={ctx} />
      <input type="hidden" name="idempotencyKey" value={`promo-create-${key}`} />
      <h2 className="m-0 text-[1.125rem] font-semibold">Buat Kode Promo Baru</h2>

      <div className="grid gap-3 min-[700px]:grid-cols-3">
        <label className="grid gap-1 text-[0.875rem]">
          <span className="font-medium">Kode</span>
          <input
            name="code"
            placeholder="MEMBER10"
            required
            className="min-h-[var(--target)] rounded-[var(--radius-field)] border border-[var(--separator)] bg-[var(--bg)] px-3 uppercase"
          />
        </label>
        <label className="grid gap-1 text-[0.875rem]">
          <span className="font-medium">Kuota</span>
          <input
            name="quota"
            type="number"
            min={1}
            defaultValue={50}
            required
            className="min-h-[var(--target)] rounded-[var(--radius-field)] border border-[var(--separator)] bg-[var(--bg)] px-3"
          />
        </label>
        <label className="grid gap-1 text-[0.875rem]">
          <span className="font-medium">Layanan Berlaku</span>
          <select
            name="itemId"
            required
            className="min-h-[var(--target)] rounded-[var(--radius-field)] border border-[var(--separator)] bg-[var(--bg)] px-3"
          >
            <option value="">Pilih layanan</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-[0.875rem]">
          <span className="font-medium">Jenis Potongan</span>
          <select
            name="discountKind"
            defaultValue="percent"
            className="min-h-[var(--target)] rounded-[var(--radius-field)] border border-[var(--separator)] bg-[var(--bg)] px-3"
          >
            <option value="percent">Persen (%)</option>
            <option value="rupiah">Rupiah (Rp)</option>
          </select>
        </label>
        <label className="grid gap-1 text-[0.875rem]">
          <span className="font-medium">Nilai Potongan</span>
          <input
            name="discountValue"
            type="number"
            min={1}
            defaultValue={10}
            required
            className="min-h-[var(--target)] rounded-[var(--radius-field)] border border-[var(--separator)] bg-[var(--bg)] px-3"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-[0.875rem]">
            <span className="font-medium">Mulai</span>
            <input
              name="validFrom"
              type="date"
              required
              className="min-h-[var(--target)] rounded-[var(--radius-field)] border border-[var(--separator)] bg-[var(--bg)] px-2.5"
            />
          </label>
          <label className="grid gap-1 text-[0.875rem]">
            <span className="font-medium">Sampai</span>
            <input
              name="validTo"
              type="date"
              required
              className="min-h-[var(--target)] rounded-[var(--radius-field)] border border-[var(--separator)] bg-[var(--bg)] px-2.5"
            />
          </label>
        </div>
      </div>

      {(state.error || state.ok) && (
        <p
          role="status"
          className={
            state.error
              ? "m-0 rounded-[var(--radius-field)] bg-[var(--danger-soft)] px-3.5 py-2 text-[0.875rem] text-[var(--danger)]"
              : "m-0 rounded-[var(--radius-field)] bg-[var(--success-soft)] px-3.5 py-2 text-[0.875rem] text-[var(--success)]"
          }
        >
          {state.error ?? state.ok}
        </p>
      )}

      <div>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-[var(--target)] items-center rounded-full bg-[var(--tint)] px-5 text-[0.9375rem] font-semibold text-white disabled:opacity-45"
        >
          {pending ? "Menyimpan..." : "Simpan Kode Promo"}
        </button>
      </div>
    </form>
  );
}

export function TogglePromoButton({
  ctx,
  promoId,
  active,
}: {
  ctx: RenderedContext;
  promoId: string;
  active: boolean;
}) {
  const [state, action, pending] = useActionState<PromoActionState, FormData>(togglePromoAction, {});
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <ContextFields ctx={ctx} />
      <input type="hidden" name="promoId" value={promoId} />
      <input type="hidden" name="nextActive" value={String(!active)} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-[36px] items-center rounded-full bg-[var(--surface-2)] px-3.5 text-[0.8125rem] font-semibold text-[var(--label)] disabled:opacity-45"
      >
        {pending ? "..." : active ? "Nonaktifkan" : "Aktifkan"}
      </button>
      {state.error && <span className="text-[0.75rem] text-[var(--danger)]">{state.error}</span>}
    </form>
  );
}
