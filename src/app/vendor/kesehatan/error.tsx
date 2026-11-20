"use client";
// Error state of Konsol Vendor › Kesehatan Platform (10 State Copy Patterns: message + "Coba Lagi"). The error itself is not shown.
import s from "../_lib/console.module.css";

export default function KesehatanError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main className={s.screen}>
      <div className={s.panel}>
        <p className={s.eyebrow}>Konsol Vendor</p>
        <h1 className={s.title}>Kesehatan Platform</h1>
        <div className={s.box} role="alert">
          <p className={s.boxText}>Data kesehatan belum dapat dimuat.</p>
          <button type="button" className={s.retry} onClick={retry}>Coba Lagi</button>
        </div>
      </div>
    </main>
  );
}
