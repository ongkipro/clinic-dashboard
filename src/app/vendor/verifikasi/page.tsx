import { VerifyForm } from "../../(auth)/verifikasi/verify-form";
import s from "../_lib/console.module.css";

export default function VendorVerifikasiPage() {
  return (
    <main className={s.screen}>
      <div className={s.panel}>
        <p className={s.eyebrow}>Konsol Vendor</p>
        <h1 className={s.title}>Verifikasi</h1>
        <p className={s.lead}>Masukkan kode dari aplikasi autentikator untuk melanjutkan.</p>
        <VerifyForm base="/vendor/api/auth" home="/vendor/tenant" />
      </div>
    </main>
  );
}
