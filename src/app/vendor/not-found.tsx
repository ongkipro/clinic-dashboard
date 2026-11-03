// Not found inside the vendor console. Rendered per request under the vendor layout (which
// awaits connection()), so its scripts carry the response's CSP nonce.
import Link from "next/link";
import s from "./_lib/console.module.css";

export default function VendorNotFound() {
  return (
    <main className={s.screen}>
      <div className={s.panel}>
        <p className={s.eyebrow}>Konsol Vendor</p>
        <h1 className={s.title}>Halaman tidak ditemukan</h1>
        <div className={s.box}>
          <Link className={s.retry} href="/vendor/tenant">
            Buka Tenant
          </Link>
        </div>
      </div>
    </main>
  );
}
