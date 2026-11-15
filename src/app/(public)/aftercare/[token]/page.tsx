// Panduan perawatan (PR-70; T-096, UX-51 patient pages): the aftercare link from the neutral WhatsApp notice, on the booking host only.
// Before the OTP only the clinic, branch and the masked phone show; after it, each treatment's reviewed aftercare text. No staff session,
// no tracking, no third-party script (AGENTS.md, PRIV-10); the tenant accent only (UI-8). States: loading, blocked (unknown / expired /
// locked), error and success (the OTP steps), empty, filtered-empty (the instructions' filter).
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { Suspense, type CSSProperties } from "react";
import { aftercarePage } from "../../../../modules/crm/aftercare/aftercare";
import { appPool } from "../../../../modules/org/context/store";
import { Instructions, OtpFlow } from "./forms";
import { SESSION_COOKIE } from "./labels";

export const metadata: Metadata = { title: "Panduan Perawatan", robots: { index: false, follow: false }, referrer: "no-referrer" };

const shell = "min-h-dvh bg-[var(--bg-grouped)] px-4 pb-8 pt-[max(env(safe-area-inset-top),32px)] text-[var(--label)] min-[700px]:px-5";
const panel = "mx-auto grid w-full max-w-[640px] gap-6";

function Blocked({ title, body }: { title: string; body: string }) {
  return (
    <main className={shell}>
      <div className={panel}>
        <h1 className="m-0 text-[2rem] font-bold leading-tight">{title}</h1>
        <p role="alert" className="m-0 rounded-[var(--radius-group)] bg-[var(--warning-soft)] p-4 text-[var(--warning)]">{body}</p>
      </div>
    </main>
  );
}

async function Content({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const session = (await cookies()).get(SESSION_COOKIE)?.value ?? null;
  const p = await aftercarePage(await appPool(), token, session);
  if (p.state === "not_found") return <Blocked title="Panduan Perawatan" body="Tautan ini tidak dikenali. Hubungi klinik untuk panduan perawatan Anda." />;
  const accent = p.accent && /^#[0-9A-Fa-f]{6}$/.test(p.accent) ? ({ "--tint": p.accent } as CSSProperties) : undefined;
  if (p.state === "link_expired") return <Blocked title={p.clinic_name} body="Tautan ini sudah kedaluwarsa. Hubungi klinik untuk panduan perawatan Anda." />;
  return (
    <main className={shell} style={accent}>
      <div className={panel}>
        <header className="grid gap-1">
          <p className="m-0 text-[0.94rem] text-[var(--label-2)]">{p.clinic_name} · {p.branch_name}</p>
          <h1 className="m-0 text-[2rem] font-bold leading-tight">Panduan Perawatan Anda</h1>
          {p.state === "verified" && <p className="m-0 text-[var(--label-2)]">Kunjungan {p.visit_date}</p>}
        </header>
        {p.state === "verified" ? (
          p.items.length === 0 ? <p className="m-0 rounded-[var(--radius-group)] bg-[var(--surface)] p-4">Belum ada panduan perawatan.</p> : <Instructions items={p.items} />
        ) : p.state === "otp_locked" ? (
          <p role="alert" className="m-0 rounded-[var(--radius-group)] bg-[var(--warning-soft)] p-4 text-[var(--warning)]">Terlalu banyak percobaan. Coba lagi dalam 15 menit atau hubungi klinik.</p>
        ) : (
          <section className="rounded-[var(--radius-group)] bg-[var(--surface)] p-4">
            <OtpFlow token={token} initial={p.state === "otp_sent" ? "code" : "send"} maskedPhone={p.masked_phone} />
          </section>
        )}
        <p className="m-0 text-[0.94rem] text-[var(--label-2)]">Ada keluhan setelah perawatan? Balas pesan WhatsApp klinik atau hubungi klinik.</p>
      </div>
    </main>
  );
}

export default function Page({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={<main className={shell} aria-busy="true"><div className={panel}><div className="h-8 w-2/3 rounded-[var(--radius-field)] bg-[var(--surface-2)]" /><div className="h-40 rounded-[var(--radius-group)] bg-[var(--surface-2)]" /></div></main>}>
      <Content params={params} />
    </Suspense>
  );
}
