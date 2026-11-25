// Kode Promo & Voucher admin page (/situs/promo; PR-77, UX-50; T-123).
// Roles: owner, admin_pusat, marketing. Explicitly enforces PR-77: promo codes are used at cashier and
// direct consented messages ONLY and are NEVER advertised on the public clinic site.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BlockedState, LoadingList } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { withTenantContext } from "../../../../db/rls/context";
import { renderedContext } from "../../../../modules/org/context/context";
import { appPool, requestContext } from "../../../../modules/org/context/store";
import { listPromoCodes } from "../../../../modules/promo/promo";
import { getSiteAdminView } from "../../../../modules/public-site";
import { CreatePromoForm, TogglePromoButton } from "./forms";

export const metadata: Metadata = { title: "Kode Promo & Voucher — Clinic Dashboard" };

const ALLOWED_ROLES = new Set(["owner", "admin_pusat", "marketing"]);

async function Body() {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked" || !rc.active.context.roles.some((r) => ALLOWED_ROLES.has(r))) {
    return (
      <BlockedState
        reason="Anda tidak memiliki akses ke Kode Promo & Voucher."
        unblock="Halaman ini hanya tersedia untuk Marketing, Admin Pusat, dan Owner."
      />
    );
  }

  const ctx = renderedContext(rc.active.context);
  const { promos, services } = await withTenantContext(await appPool(), rc.active.context, async (db) => {
    const [promoList, siteView] = await Promise.all([listPromoCodes(db), getSiteAdminView(db)]);
    return {
      promos: promoList,
      services: siteView.services.map((s) => ({ id: s.itemId, name: s.name, code: s.code })),
    };
  });

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="m-0 text-[1.75rem] font-bold tracking-tight">Kode Promo &amp; Voucher</h1>
          <p className="m-0 text-[0.9375rem] text-[var(--label-2)]">
            Hanya berlaku di kasir dan pesan langsung berpersetujuan (tidak ditampilkan di situs publik sesuai Permenkes 1787/2010).
          </p>
        </div>
        <Link
          href="/situs"
          className="inline-flex min-h-[var(--target)] items-center rounded-full bg-[var(--surface-2)] px-4 text-[0.875rem] font-semibold text-[var(--label)] no-underline"
        >
          Kembali ke Situs Klinik
        </Link>
      </header>

      <CreatePromoForm ctx={ctx} services={services} />

      <section className="grid gap-3">
        <h2 className="m-0 text-[1.25rem] font-semibold">Daftar Kode Promo</h2>
        {promos.length === 0 ? (
          <p className="m-0 rounded-[var(--radius-group)] bg-[var(--surface)] p-5 text-[0.9375rem] text-[var(--label-2)]">
            Belum ada kode promo yang dibuat.
          </p>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0">
            {promos.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-group)] border border-[var(--separator)] bg-[var(--surface)] p-4"
              >
                <div className="grid gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[1rem] font-bold">{p.code}</span>
                    <StatusBadge tone={p.active ? "success" : "neutral"}>
                      {p.active ? "Aktif" : "Nonaktif"}
                    </StatusBadge>
                  </div>
                  <p className="m-0 text-[0.875rem] text-[var(--label-2)]">
                    Terpakai {p.used} / {p.quota}
                  </p>
                </div>
                <TogglePromoButton ctx={ctx} promoId={p.id} active={p.active} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function SitusPromoPage() {
  return (
    <main className="mx-auto grid w-full max-w-[1040px] min-w-0 gap-4">
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body />
      </Suspense>
    </main>
  );
}
