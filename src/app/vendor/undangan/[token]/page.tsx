// Undangan Tim Vendor (HYG-003, DEC-036): the one-time link. Shows the invited name and
// roles; an invalid, used or expired token shows one message. The person sets a password
// here; TOTP enrolment is forced at the first sign-in.
import type { Metadata } from "next";
import { lookupMemberInvite } from "../../../../modules/vendor/team/team";
import { vendorPool } from "../../_lib/server";
import { VENDOR_ROLE_LABEL } from "../../_lib/shell";
import { MemberAcceptForm } from "./accept-form";
import s from "../../_lib/console.module.css";

export const metadata: Metadata = { title: "Undangan Tim Vendor — Konsol Vendor", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function VendorUndanganPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const info = /^[A-Za-z0-9_-]{20,64}$/.test(token) ? await lookupMemberInvite(await vendorPool(), token) : null;
  return (
    <main className={s.screen}>
      <div className={s.panel}>
        <p className={s.eyebrow}>Konsol Vendor</p>
        <h1 className={s.title}>Undangan Tim Vendor</h1>
        {info ? (
          <>
            <p className={s.lead}>
              <strong>{info.name}</strong>, Anda diundang sebagai {info.roles.map((r) => VENDOR_ROLE_LABEL[r]).join(", ")}. Buat kata sandi untuk akun Anda. Setelah masuk, Anda akan memasang aplikasi autentikator.
            </p>
            <MemberAcceptForm token={token} email={info.email} />
          </>
        ) : (
          <p className={s.lead} role="status">
            Undangan sudah tidak berlaku. Minta undangan baru ke Pemilik Platform.
          </p>
        )}
      </div>
    </main>
  );
}
