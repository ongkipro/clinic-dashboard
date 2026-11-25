"use client";
// Konsol Vendor › Audit Vendor CSV export control (RATE-5, UX-47; T-129 + HYG-024).
// Posts exact application/json to /vendor/api/console/audit-export and shows UI-5 step-up / quota / limit states.
import { useState } from "react";
import s from "../_lib/console.module.css";

const COPY: Record<string, string> = {
  totp_not_verified: "Verifikasi dua langkah Anda sudah lebih dari 10 menit. Keluar lalu masuk kembali untuk melanjutkan.",
  role_not_held: "Peran Anda tidak mengizinkan ekspor log audit.",
  ip_not_allowed: "Ekspor audit hanya dari jaringan kantor vendor.",
  rate_limited: "Batas ekspor 5 kali per 5 menit tercapai. Tunggu beberapa menit lalu coba lagi.",
  row_limit_exceeded: "Jumlah baris melebihi batas 10.000 baris. Persempit rentang tanggal atau pilih satu klinik.",
  invalid_range: "Tanggal mulai tidak boleh lebih akhir dari tanggal selesai.",
  ERR_INVALID_INPUT: "Periksa format tanggal mulai dan tanggal selesai.",
  ERR_RATE_LIMITED: "Batas ekspor 5 kali per 5 menit tercapai. Tunggu beberapa menit lalu coba lagi.",
  ERR_LIMIT_EXCEEDED: "Jumlah baris melebihi batas 10.000 baris. Persempit rentang tanggal atau pilih satu klinik.",
  ERR_UNAUTHENTICATED: "Sesi Anda berakhir. Masuk kembali.",
};

export function AuditExportForm({ tenantId }: { tenantId: string | null }) {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (fromDate && toDate && fromDate > toDate) {
      setError(COPY.invalid_range);
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        ...(tenantId ? { tenantId } : {}),
        ...(fromDate ? { from: `${fromDate}T00:00:00+07:00` } : {}),
        ...(toDate ? { to: `${toDate}T23:59:59.999999+07:00` } : {}),
      };
      const res = await fetch("/vendor/api/console/audit-export", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        setError(COPY[String(data.reason)] ?? COPY[String(data.code)] ?? "Ekspor audit tidak dapat diproses. Coba Lagi.");
        return;
      }
      const csv = await res.text();
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = "audit-vendor.csv";
        a.click();
      } finally {
        URL.revokeObjectURL(url);
      }
      setNotice("File audit-vendor.csv berhasil diunduh.");
    } catch {
      setError("Koneksi terputus. Coba Lagi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={s.form} onSubmit={onSubmit} aria-label="Ekspor CSV audit vendor">
      <div className={s.row2}>
        <div className={s.field}>
          <label className={s.label} htmlFor="audit-from">Dari tanggal (WIB)</label>
          <input id="audit-from" className={s.input} type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div className={s.field}>
          <label className={s.label} htmlFor="audit-to">Sampai tanggal (WIB)</label>
          <input id="audit-to" className={s.input} type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
      </div>
      <p className={s.help}>Memerlukan verifikasi dua langkah ≤ 10 menit · maks. 10.000 baris · maks. 5 ekspor per 5 menit.</p>
      {error ? <p className={s.alert} role="alert">{error}</p> : null}
      {notice ? <p className={s.notice} role="status">{notice}</p> : null}
      <div className={s.actions}>
        <button type="submit" className={s.primary} disabled={busy} aria-disabled={busy}>
          {busy ? "Menyiapkan CSV..." : "Unduh CSV Audit"}
        </button>
      </div>
    </form>
  );
}
