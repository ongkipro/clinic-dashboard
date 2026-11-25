// Situs Klinik admin workspace (UX-50, PR-64, PR-65; T-123).
// Roles: owner, admin_pusat, marketing, facility_head (clinical review of treatment web copy).
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BlockedState, LoadingList } from "../../../components/ui/states";
import { StatusBadge } from "../../../components/ui/status-badge";
import { withTenantContext } from "../../../db/rls/context";
import { renderedContext } from "../../../modules/org/context/context";
import { appPool, requestContext } from "../../../modules/org/context/store";
import { getSiteAdminView } from "../../../modules/public-site";
import { PublishControls, ServiceWebFieldCard, SiteSettingsForm } from "./forms";

export const metadata: Metadata = { title: "Situs Klinik — Clinic Dashboard" };

const ALLOWED_ROLES = new Set(["owner", "admin_pusat", "marketing", "facility_head"]);

async function Body() {
  const rc = await requestContext();
  if (rc.kind === "redirect") redirect(rc.to);
  if (rc.kind === "blocked") {
    return (
      <BlockedState
        reason="Sesi Anda belum memiliki peran aktif."
        unblock="Hubungi Owner atau Admin Pusat."
      />
    );
  }
  const roles = rc.active.context.roles;
  if (!roles.some((r) => ALLOWED_ROLES.has(r))) {
    return (
      <BlockedState
        reason="Anda tidak memiliki akses ke pengelolaan Situs Klinik."
        unblock="Halaman ini hanya tersedia untuk Marketing, Admin Pusat, Owner, dan Penanggung Jawab Klinik."
      />
    );
  }

  const ctx = renderedContext(rc.active.context);
  const view = await withTenantContext(await appPool(), rc.active.context, (db) => getSiteAdminView(db));
  const activeBranchCount = view.branches.filter((b) => b.inPublishWindow).length;
  const siteState = view.site?.state ?? "draft";
  const canApproveClinical = roles.includes("owner") || roles.includes("facility_head");

  return (
    <div className="grid min-w-0 gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid min-w-0 gap-1">
          <h1 className="m-0 text-[1.75rem] font-bold tracking-tight [overflow-wrap:anywhere]">Situs Klinik</h1>
          <p className="m-0 text-[0.9375rem] text-[var(--label-2)] [overflow-wrap:anywhere]">
            Atur halaman publik klinik dari data cabang dan katalog terverifikasi sesuai Permenkes 1787/2010.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={siteState === "published" ? "success" : siteState === "unpublished" ? "warning" : "neutral"}>
            {siteState === "published"
              ? `Terbit v${view.site?.publishedVersion ?? 1}`
              : siteState === "unpublished"
                ? "Diturunkan"
                : "Draf"}
          </StatusBadge>
          <Link
            href="/situs/promo"
            className="inline-flex min-h-[var(--target)] items-center rounded-full bg-[var(--surface-2)] px-4 text-[0.875rem] font-semibold text-[var(--label)] no-underline"
          >
            Kode Promo &amp; Voucher
          </Link>
        </div>
      </header>

      {!view.counselGateOpen && (
        <BlockedState
          reason="Penerbitan situs terkunci sampai bukti pendapat hukum situs klinik (Q-15) disetujui."
          unblock="Unggah dan setujui bukti Pendapat Hukum Situs Klinik di halaman Kepatuhan."
        />
      )}

      {activeBranchCount === 0 && (
        <BlockedState
          reason="Belum ada cabang yang berada di dalam jendela publikasi aktif."
          unblock="Atur tanggal mulai publikasi cabang di Pengaturan Cabang."
        />
      )}

      <SiteSettingsForm
        ctx={ctx}
        site={view.site}
        suggestedSlug={view.suggestedSlug}
        counselGateOpen={view.counselGateOpen}
      />

      <PublishControls
        ctx={ctx}
        state={siteState}
        counselGateOpen={view.counselGateOpen}
        hasActiveBranch={activeBranchCount > 0}
      />

      <section className="grid gap-3">
        <h2 className="m-0 text-[1.25rem] font-semibold">Konten Publik Perawatan</h2>
        {view.services.length === 0 ? (
          <p className="m-0 rounded-[var(--radius-group)] bg-[var(--surface)] p-5 text-[0.9375rem] text-[var(--label-2)]">
            Belum ada layanan aktif di katalog.
          </p>
        ) : (
          <div className="grid gap-4">
            {view.services.map((svc) => (
              <ServiceWebFieldCard
                key={svc.itemId}
                ctx={ctx}
                service={svc}
                canApproveClinical={canApproveClinical}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default function SitusPage() {
  return (
    <main className="mx-auto grid w-full max-w-[1040px] min-w-0 gap-4">
      <Suspense fallback={<LoadingList rows={5} />}>
        <Body />
      </Suspense>
    </main>
  );
}
