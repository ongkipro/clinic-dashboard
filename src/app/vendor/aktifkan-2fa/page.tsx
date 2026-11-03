import { EnrolForm } from "../../(auth)/aktifkan-2fa/enrol-form";
import s from "../_lib/console.module.css";

export default function VendorAktifkan2faPage() {
  return (
    <main className={s.screen}>
      <div className={s.panel}>
        <p className={s.eyebrow}>Konsol Vendor</p>
        <h1 className={s.title}>Aktifkan verifikasi dua langkah</h1>
        <p className={s.lead}>Semua akun Tim Vendor wajib memakai aplikasi autentikator sebelum membuka Konsol Vendor.</p>
        <EnrolForm base="/vendor/api/auth" home="/vendor/tenant" />
      </div>
    </main>
  );
}
