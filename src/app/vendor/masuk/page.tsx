// Konsol Vendor sign-in (SEC-21): the vendor host's own auth API and cookies. A clinic
// session is never accepted here, and this session is never accepted by the clinic app.
import { SignInForm } from "../../(auth)/masuk/sign-in-form";
import s from "../_lib/console.module.css";

export default function VendorMasukPage() {
  return (
    <main className={s.screen}>
      <div className={s.panel}>
        <p className={s.eyebrow}>Konsol Vendor</p>
        <h1 className={s.title}>Masuk</h1>
        <p className={s.lead}>Untuk Tim Vendor. Wajib verifikasi dua langkah.</p>
        <SignInForm base="/vendor/api/auth" home="/vendor/tenant" verify="/vendor/verifikasi" />
      </div>
    </main>
  );
}
