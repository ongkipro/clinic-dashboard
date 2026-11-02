import { EnrolForm } from "./enrol-form";
import s from "../auth.module.css";

export default function Aktifkan2faPage() {
  return (
    <main className={s.screen}>
      <div className={s.panel}>
        <h1 className={s.title}>Aktifkan verifikasi dua langkah</h1>
        <p className={s.lead}>Peran Anda wajib memakai aplikasi autentikator sebelum membuka halaman klinik.</p>
        <EnrolForm />
      </div>
    </main>
  );
}
