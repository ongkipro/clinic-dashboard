import { VerifyForm } from "./verify-form";
import s from "../auth.module.css";

export default function VerifikasiPage() {
  return (
    <main className={s.screen}>
      <div className={s.panel}>
        <h1 className={s.title}>Verifikasi</h1>
        <p className={s.lead}>Masukkan kode dari aplikasi autentikator untuk melanjutkan.</p>
        <VerifyForm />
      </div>
    </main>
  );
}
