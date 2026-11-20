// UX-23 ▸ Nomor IHS Tenaga Kesehatan — the NIK lookup form and its status (T-102 increment 4, TD-31; HYG-free presentational slice).
// Mounted by forms.tsx (LookupForm → lookupAction → requestPractitionerLookup, which seals the NIK) and page.tsx (status per staff member).
// The form posts to a caller-supplied action; the NIK field is a password-style input with autocomplete off, never prefilled, and nothing
// here ever renders a NIK back — the status shows only the outcome words. Manual IHS entry (PractitionerForm) stays beside it.
import type { RenderedContext } from "../../../modules/org/context/context";
import { ContextFields } from "../../../components/context-fields";

export type LookupState = "pending" | "matched" | "not_found" | "ambiguous" | "failed" | "expired";
export type LookupStatus = { state: LookupState; requestedAt: string; ihs?: string | null } | null;

export const LOOKUP_COPY: Record<LookupState, { text: string; tone: "neutral" | "success" | "warning" | "danger" }> = {
  pending: { text: "Pencarian dikirim. Hasilnya muncul di sini dalam beberapa menit.", tone: "neutral" },
  matched: { text: "Nomor IHS ditemukan dan disimpan.", tone: "success" },
  not_found: { text: "NIK tidak ditemukan di SATUSEHAT. Periksa NIK atau isi nomor IHS dari portal.", tone: "warning" },
  ambiguous: { text: "Lebih dari satu data cocok. Isi nomor IHS dari portal SATUSEHAT.", tone: "warning" },
  failed: { text: "Pencarian belum berhasil. Coba lagi nanti atau isi nomor IHS dari portal.", tone: "danger" },
  expired: { text: "Pencarian kedaluwarsa sebelum diproses. Kirim ulang bila perlu.", tone: "neutral" },
};
const TONE = { neutral: "text-[var(--label-2)]", success: "text-[var(--success)]", warning: "text-[var(--warning)]", danger: "text-[var(--danger)]" } as const;
const input = "min-h-[var(--target)] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3";

export function NikLookupStatus({ status }: { status: LookupStatus }) {
  if (!status) return null;
  const c = LOOKUP_COPY[status.state];
  return <p role="status" data-lookup={status.state} className={`m-0 text-[0.94rem] ${TONE[c.tone]}`}>{c.text}</p>;
}

// A plain server-compatible form (no client state): the action seals the NIK on arrival; a fresh key per render keeps the command idempotent.
export function NikLookupForm({ action, ctx, cabang, staff, name, idempotencyKey, pending }: {
  action: string | ((f: FormData) => void); ctx: RenderedContext; cabang: string; staff: string; name: string; idempotencyKey: string; pending?: boolean;
}) {
  return (
    <form action={action} aria-label={`Cari nomor IHS ${name} lewat NIK`} autoComplete="off" className="grid min-w-0 gap-2 min-[700px]:grid-cols-[minmax(0,1fr)_auto] min-[700px]:items-end">
      <ContextFields ctx={ctx} />
      <input type="hidden" name="cabang" value={cabang} />
      <input type="hidden" name="key" value={idempotencyKey} />
      <input type="hidden" name="staff" value={staff} />
      <label className="grid gap-1">NIK tenaga kesehatan
        <input name="nik" type="password" inputMode="numeric" autoComplete="off" required minLength={16} maxLength={19} pattern="[0-9\s\-]{16,19}"
          spellCheck={false} aria-describedby={`nik-${staff}-hint`} className={input} />
      </label>
      <button type="submit" disabled={pending} className="min-h-[var(--target)] rounded-full bg-[var(--secondary)] px-5 font-semibold text-[var(--label)]">Cari Nomor IHS</button>
      <p id={`nik-${staff}-hint`} className="m-0 text-[0.88rem] text-[var(--label-2)] min-[700px]:col-span-2">
        NIK hanya dipakai sekali untuk mencari nomor IHS, lalu dihapus. Tidak ditampilkan lagi.
      </p>
    </form>
  );
}
