// Loading state of Kesehatan Platform (10 State Copy Patterns: skeleton only, no text).
import s from "../_lib/console.module.css";

export default function KesehatanLoading() {
  return (
    <main className={s.screen} aria-busy="true" aria-label="Memuat Kesehatan Platform">
      <div className={s.panel}>
        {[0, 1, 2].map((i) => <div key={i} aria-hidden="true" className={`${s.box} min-h-16`} />)}
      </div>
    </main>
  );
}
