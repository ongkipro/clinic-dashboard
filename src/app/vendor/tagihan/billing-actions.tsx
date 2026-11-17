"use client";
// Konsol Vendor › Tagihan Server actions (UX-43; T-103; Panel 2 option A). Ajukan Perubahan Biaya and Ajukan Pembebasan / Kredit (vendor
// finance), Setujui / Tolak (platform owner, never on own request), Batalkan (the requester), Catat Referensi Dukungan (vendor finance; a note,
// never a status change). Buttons appear only for roles that may use them; the database decides again. Approval never applies the request —
// the executor worker does.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { post } from "../_lib/post";
import s from "../_lib/console.module.css";

type Go = (url: string) => void;
async function run(go: Go, action: string, body: unknown, set: (e?: string) => void, busy: [boolean, (b: boolean) => void], done = "Tersimpan.") {
  if (busy[0]) return;
  busy[1](true);
  set(undefined);
  const r = await post(action, body);
  busy[1](false);
  if (!r.ok) return set(r.message);
  go(`?ok=${encodeURIComponent(done)}`);
}
// the page re-renders with the notice (and the fresh server data) after every successful write
function useGo(): Go {
  const router = useRouter();
  return (url) => {
    router.push(url);
    router.refresh();
  };
}

export function FeeChangeForm({ tenantId, minMonth }: { tenantId: string; minMonth: string }) {
  const go = useGo();
  const [err, setErr] = useState<string>();
  const busy = useState(false);
  return (
    <form className={s.form} aria-label="Ajukan perubahan biaya" onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      void run(go, "billing-request", { tenantId, kind: "server_fee_change", amountRupiah: Number(f.get("amount")), effectiveMonth: String(f.get("month")), reason: String(f.get("reason")) },
        setErr, busy, "Pengajuan perubahan biaya dikirim.");
    }}>
      {err && <p className={s.alert} role="alert">{err}</p>}
      <div className={s.row2}>
        <label className={s.field}><span className={s.label}>Biaya baru (Rp, tanpa PPN)</span>
          <input className={s.input} name="amount" type="number" min={1} step={1} required inputMode="numeric" /></label>
        <label className={s.field}><span className={s.label}>Berlaku mulai bulan</span>
          <input className={s.input} name="month" type="month" min={minMonth} required /></label>
      </div>
      <label className={s.field}><span className={s.label}>Alasan</span>
        <input className={s.input} name="reason" required minLength={10} maxLength={500} /></label>
      <p className={s.help}>Berlaku setelah disetujui Pemilik Platform lain. Tagihan yang sudah terbit tidak berubah.</p>
      <div className={s.actions}><button type="submit" className={s.primary} aria-disabled={busy[0]}>Ajukan Perubahan Biaya</button></div>
    </form>
  );
}

export function WaiverForm({ tenantId, invoices }: { tenantId: string; invoices: { id: string; label: string; outstanding: number }[] }) {
  const go = useGo();
  const [err, setErr] = useState<string>();
  const busy = useState(false);
  return (
    <form className={s.form} aria-label="Ajukan pembebasan atau kredit" onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      void run(go, "billing-request", { tenantId, kind: "invoice_waiver", invoiceId: String(f.get("invoice")), amountRupiah: Number(f.get("amount")), reason: String(f.get("reason")) },
        setErr, busy, "Pengajuan pembebasan dikirim.");
    }}>
      {err && <p className={s.alert} role="alert">{err}</p>}
      <div className={s.row2}>
        <label className={s.field}><span className={s.label}>Tagihan</span>
          <select className={s.input} name="invoice" required defaultValue="">
            <option value="" disabled>Pilih tagihan</option>
            {invoices.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
          </select></label>
        <label className={s.field}><span className={s.label}>Nominal (Rp)</span>
          <input className={s.input} name="amount" type="number" min={1} step={1} required inputMode="numeric" /></label>
      </div>
      <label className={s.field}><span className={s.label}>Alasan</span>
        <input className={s.input} name="reason" required minLength={10} maxLength={500} /></label>
      <p className={s.help}>Nominal sama dengan sisa tagihan = pembebasan; lebih kecil = kredit sebagian. Berlaku setelah disetujui Pemilik Platform lain.</p>
      <div className={s.actions}><button type="submit" className={s.primary} aria-disabled={busy[0]}>Ajukan Pembebasan</button></div>
    </form>
  );
}

export function RequestActions({ requestId, canDecide, canCancel }: { requestId: string; canDecide: boolean; canCancel: boolean }) {
  const go = useGo();
  const [err, setErr] = useState<string>();
  const [reason, setReason] = useState("");
  const busy = useState(false);
  if (!canDecide && !canCancel) return null;
  return (
    <div className={s.form}>
      {err && <p className={s.alert} role="alert">{err}</p>}
      {canDecide && (
        <>
          <label className={s.field}><span className={s.label}>Alasan (wajib bila menolak)</span>
            <input className={s.input} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></label>
          <div className={s.actions}>
            <button type="button" className={s.primary} aria-disabled={busy[0]} onClick={() => void run(go, "billing-decide", { requestId, approve: true, reason }, setErr, busy, "Pengajuan disetujui.")}>Setujui</button>
            <button type="button" className={s.danger} aria-disabled={busy[0]} onClick={() => void run(go, "billing-decide", { requestId, approve: false, reason }, setErr, busy, "Pengajuan ditolak.")}>Tolak</button>
          </div>
        </>
      )}
      {canCancel && (
        <div className={s.actions}>
          <button type="button" className={s.plain} aria-disabled={busy[0]} onClick={() => void run(go, "billing-cancel", { requestId }, setErr, busy, "Pengajuan dibatalkan.")}>Batalkan Pengajuan</button>
        </div>
      )}
    </div>
  );
}

export function NoteForm({ attemptId }: { attemptId: string }) {
  const go = useGo();
  const [err, setErr] = useState<string>();
  const busy = useState(false);
  return (
    <form className={s.form} aria-label="Catat referensi dukungan" onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      void run(go, "billing-note", { attemptId, evidenceRef: String(f.get("ref")), reason: String(f.get("reason")) }, setErr, busy, "Referensi dukungan dicatat.");
    }}>
      {err && <p className={s.alert} role="alert">{err}</p>}
      <div className={s.row2}>
        <label className={s.field}><span className={s.label}>Nomor tiket dukungan AutoLaris</span>
          <input className={s.input} name="ref" required minLength={3} maxLength={120} /></label>
        <label className={s.field}><span className={s.label}>Ringkasan jawaban</span>
          <input className={s.input} name="reason" required minLength={10} maxLength={500} /></label>
      </div>
      <p className={s.help}>Catatan hanya bukti. Status pembayaran tidak berubah dan pembayaran baru tetap menunggu keputusan pemilik.</p>
      <div className={s.actions}><button type="submit" className={s.plain} aria-disabled={busy[0]}>Catat Referensi</button></div>
    </form>
  );
}

// Terbitkan Tagihan: runs the same BILL-31 issuer for this clinic today; the notice says exactly what happened (issued, held by the tax
// gate, or nothing due) — never "terbit" when nothing was issued.
export function IssueButton({ tenantId }: { tenantId: string }) {
  const go = useGo();
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <div className={s.actions}>
      {err && <p className={s.alert} role="alert">{err}</p>}
      <button type="button" className={s.primary} aria-disabled={busy} onClick={async () => {
        if (busy) return;
        setBusy(true);
        setErr(undefined);
        const r = await post("billing-issue", { tenantId });
        setBusy(false);
        if (!r.ok) return setErr(r.message);
        const issued = Number(r.data.issued ?? 0);
        const held = Number(r.data.held ?? 0);
        const heldNote = `${held} tagihan tertahan: status pajak vendor belum dikonfirmasi.`;
        go(`?ok=${encodeURIComponent(issued > 0 ? `${issued} tagihan diterbitkan.${held > 0 ? ` ${heldNote}` : ""}` : held > 0 ? heldNote : "Tidak ada tagihan yang jatuh waktu terbit.")}`);
      }}>Terbitkan Tagihan</button>
    </div>
  );
}
