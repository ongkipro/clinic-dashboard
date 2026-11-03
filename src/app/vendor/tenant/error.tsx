"use client";
// Error state of Konsol Vendor › Tenant (10 State Copy Patterns: message + "Coba Lagi").
// Next 16 passes `retry` (stable since 16.3). The error itself is not shown.
import s from "../_lib/console.module.css";

export default function TenantError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main className={s.screen}>
      <div className={s.panel}>
        <p className={s.eyebrow}>Konsol Vendor</p>
        <h1 className={s.title}>Tenant</h1>
        <div className={s.box} role="alert">
          <p className={s.boxText}>Daftar tenant belum dapat ditampilkan.</p>
          <button type="button" className={s.retry} onClick={retry}>
            Coba Lagi
          </button>
        </div>
      </div>
    </main>
  );
}
