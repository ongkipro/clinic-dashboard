"use client";
// The OTP steps (PR-70; T-096): ask for the WhatsApp code, then enter it. After a verified code the page reloads from the server with the
// session cookie and shows the instructions; nothing about the patient or the treatment is in this component.
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import type { OtpState } from "./labels";

async function postAftercare(payload: { action: "send" | "verify"; token: string; code?: string }): Promise<OtpState> {
  try {
    const res = await fetch("/api/v1/public/aftercare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => null)) as OtpState | null;
    if (data && typeof data.step === "string") return data;
  } catch {
    // network error handled below
  }
  return { step: payload.action === "verify" ? "code" : "send", error: "Terjadi gangguan koneksi. Coba lagi." };
}

const field = "min-h-[var(--target)] w-full rounded-[var(--radius-field)] border border-[var(--control-border)] bg-[var(--surface)] px-3 text-[1.25rem] tracking-[0.3em] tabular-nums";
const primary = "min-h-[var(--button-primary)] w-full rounded-[var(--radius-group)] bg-[var(--tint)] px-4 text-[1.06rem] font-semibold text-[var(--on-tint)] aria-disabled:opacity-60";
const secondary = "min-h-[var(--target)] w-full rounded-[var(--radius-group)] bg-[var(--surface-2)] px-4 text-[1rem] font-semibold text-[var(--tint)]";

function Notice({ s }: { s: OtpState }) {
  if (s.error) return <p role="alert" className={`m-0 rounded-[var(--radius-field)] p-3 ${s.blocked ? "bg-[var(--warning-soft)] text-[var(--warning)]" : "bg-[var(--danger-soft)] text-[var(--danger)]"}`}>{s.error}</p>;
  if (s.message) return <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--success-soft)] p-3 text-[var(--success)]">{s.message}</p>;
  return null;
}

export function OtpFlow({ token, initial, maskedPhone }: { token: string; initial: "send" | "code"; maskedPhone: string | null }) {
  const router = useRouter();
  // each answer is stamped when it arrives; the page follows the latest of the two (review r1 P3-1: a resend after a wrong code must not
  // keep showing the old error)
  const [sent, send, sending] = useActionState<OtpState>(
    async () => ({ ...(await postAftercare({ action: "send", token })), at: Date.now() }),
    { step: initial },
  );
  const [checked, verify, verifying] = useActionState<OtpState, FormData>(
    async (_prev: OtpState, form: FormData) => ({
      ...(await postAftercare({ action: "verify", token, code: String(form.get("code") ?? "") })),
      at: Date.now(),
    }),
    { step: "code" },
  );
  const latest = sent.at === undefined && checked.at === undefined ? null : (checked.at ?? 0) > (sent.at ?? 0) ? checked : sent;
  const step: "send" | "code" = latest === null || latest.step === "done" ? initial : latest.step;
  useEffect(() => { if (checked.step === "done") router.refresh(); }, [checked, router]);
  const blocked = Boolean(latest?.blocked);
  const notice = latest ?? { step: initial };

  if (step === "send" || blocked) {
    return (
      <form action={send} className="grid gap-4">
        <Notice s={notice} />
        <p className="m-0 text-[var(--label-2)]">
          Untuk menjaga kerahasiaan, kami mengirim kode verifikasi lewat WhatsApp{maskedPhone ? <> ke nomor <span className="tabular-nums">{maskedPhone}</span></> : null}.
        </p>
        {!blocked && <button type="submit" className={primary} aria-disabled={sending}>{sending ? "Mengirim…" : "Kirim Kode"}</button>}
      </form>
    );
  }
  return (
    <div className="grid gap-4">
      <form action={verify} className="grid gap-4">
        <Notice s={notice} />
        <label htmlFor="code" className="text-[1rem] font-semibold">Kode verifikasi</label>
        <input id="code" name="code" className={field} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required
          aria-describedby="code-help" />
        <p id="code-help" className="m-0 text-[0.94rem] text-[var(--label-2)]">6 angka, berlaku 5 menit.</p>
        <button type="submit" className={primary} aria-disabled={verifying}>{verifying ? "Memeriksa…" : "Buka Panduan"}</button>
      </form>
      <form action={send}><button type="submit" className={secondary} aria-disabled={sending}>{sending ? "Mengirim…" : "Kirim Ulang Kode"}</button></form>
    </div>
  );
}

// The unlocked instructions with a filter (UI-5 filtered-empty).
export function Instructions({ items }: { items: { name: string; aftercare: string }[] }) {
  const [q, setQ] = useState("");
  const shown = items.filter((i) => (i.name + " " + i.aftercare).toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="grid gap-4">
      {items.length > 1 && (
        <div className="grid gap-2">
          <label htmlFor="cari" className="text-[0.94rem] font-semibold">Cari panduan</label>
          <input id="cari" type="search" value={q} onChange={(e) => setQ(e.target.value)}
            className="min-h-[var(--target)] w-full rounded-[var(--radius-field)] border border-[var(--control-border)] bg-[var(--surface)] px-3" />
        </div>
      )}
      {shown.length === 0 ? (
        <div className="grid gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
          <p className="m-0">Tidak ada panduan perawatan untuk filter ini.</p>
          <button type="button" className={secondary} onClick={() => setQ("")}>Hapus Filter</button>
        </div>
      ) : (
        <ol className="m-0 grid list-none gap-4 p-0">
          {shown.map((i, k) => (
            <li key={`${i.name}-${k}`} className="grid gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
              <h2 className="m-0 text-[1.25rem] font-semibold">{i.name}</h2>
              <p className="m-0 whitespace-pre-line leading-relaxed">{i.aftercare}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
