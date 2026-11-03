// Undangan staf (UX-3): the invite link. Shows the clinic and the person invited; nothing
// else about the tenant. An invalid, used or expired token shows one message.
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { ROLE_LABEL } from "../../../../components/shell/nav";
import { appPool } from "../../../../modules/org/context/store";
import { lookupInvite, lookupOwnerInvite } from "../../../../modules/org/staff/staff";
import { AcceptForm } from "./accept-form";
import s from "../../auth.module.css";

export const metadata: Metadata = { title: "Undangan Staf — Clinic Dashboard", robots: { index: false, follow: false }, referrer: "no-referrer" };

async function Invitation({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const valid = /^[A-Za-z0-9_-]{20,64}$/.test(token);
  const info = valid ? await lookupInvite(await appPool(), token) : null;
  // The first Owner of a new clinic (DEC-033): issued from the vendor console.
  const owner = !info && valid ? await lookupOwnerInvite(await appPool(), token) : null;
  if (owner) {
    return (
      <>
        <p className={s.lead}>
          <strong>{owner.displayName}</strong>, Anda didaftarkan sebagai Owner {owner.clinic}. Buat kata sandi untuk akun Anda. Setelah masuk, Anda akan memasang aplikasi autentikator.
        </p>
        <AcceptForm token={token} email={owner.email} />
      </>
    );
  }
  if (!info) {
    return (
      <p className={s.lead} role="status">
        Undangan sudah tidak berlaku. Minta undangan baru ke klinik Anda.
      </p>
    );
  }
  return (
    <>
      <p className={s.lead}>
        {info.clinic} mengundang <strong>{info.displayName}</strong> sebagai {info.roles.map((r) => ROLE_LABEL[r]).join(", ")}. Buat kata sandi untuk akun staf Anda.
      </p>
      <AcceptForm token={token} email={info.email} />
    </>
  );
}

export default function UndanganPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <main className={s.screen}>
      <div className={s.panel}>
        <h1 className={s.title}>Undangan Staf</h1>
        <Suspense fallback={<p className={s.lead} aria-busy="true" />}>
          <Invitation params={params} />
        </Suspense>
      </div>
    </main>
  );
}
