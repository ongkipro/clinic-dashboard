import { UnlockForm } from "./unlock-form";
import s from "../auth.module.css";

export default function TerkunciPage() {
  return (
    <main className={s.screen}>
      <div className={s.panel}>
        <h1 className={s.title}>Layar terkunci</h1>
        <p className={s.lead}>Tidak ada aktivitas selama 2 menit. Masukkan kata sandi untuk melanjutkan.</p>
        <UnlockForm />
      </div>
    </main>
  );
}
