"use client";
// Error state of Tim Vendor (10 State Copy Patterns: message + "Coba Lagi").
import s from "../_lib/console.module.css";

export default function TimError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main className={s.screen}>
      <div className={s.panel}>
        <p className={s.eyebrow}>Konsol Vendor</p>
        <h1 className={s.title}>Tim Vendor</h1>
        <div className={s.box} role="alert">
          <p className={s.boxText}>Tim Vendor belum dapat ditampilkan.</p>
          <button type="button" className={s.retry} onClick={retry}>
            Coba Lagi
          </button>
        </div>
      </div>
    </main>
  );
}
