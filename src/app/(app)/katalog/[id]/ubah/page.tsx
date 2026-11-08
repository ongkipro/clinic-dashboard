// Ubah item katalog (UX-25): a new version from the active one. Editors only; refused while a
// clinical change waits (DEC-046 (3), also enforced by the database).
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../../../components/templates/templates";
import { BlockedState, LoadingList, PermissionState } from "../../../../../components/ui/states";
import { loadItem } from "../../data";
import { type Initial, VersionForm } from "../../forms";

export const metadata: Metadata = { title: "Ubah Item Katalog — Clinic Dashboard" };

async function Body({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await loadItem(id);
  if (p.kind === "redirect") redirect(p.to);
  if (p.kind === "forbidden") return <PermissionState object="katalog" />;
  if (p.kind === "not-found") notFound();
  if (!p.canEdit) return <PermissionState object="perubahan katalog" />;
  // Review round 1 (P1): blocked only while a review waits. Without an active version (a first version
  // rejected or withdrawn) the form starts from the latest version and the clinical baseline is empty:
  // nothing clinical was ever approved, so any clinical content goes to review again.
  const active = p.versions.find((v) => v.state === "active");
  const a = active ?? p.versions[0];
  if (p.versions.some((v) => v.state === "pending_review") || !a) {
    return (
      <main className="mx-auto grid w-full max-w-[760px] min-w-0 gap-4">
        <PageTitle title="Ubah item" />
        <BlockedState reason="Perubahan klinis item ini masih menunggu review." unblock="Tunggu keputusan Penanggung Jawab Klinik atau tarik ajuannya di halaman item." />
      </main>
    );
  }
  const s = (n: number | null) => (n === null ? "" : String(n));
  const initial: Initial = {
    name: a.name, tax_category: a.taxCategory, tax_basis: a.taxBasis, normal_price: String(a.normalPrice), control_count: String(a.controlCount),
    control_validity_days: s(a.controlValidityDays), booking_dp_enabled: a.bookingDpEnabled, booking_dp_amount: s(a.bookingDpAmount), min_dp_pct: s(a.minDpPct),
    installments_allowed: a.installmentsAllowed, validity_days: s(a.validityDays), commission_scope: a.commissionScope,
    indications: a.indications ?? "", contraindications: a.contraindications ?? "", consent_template: a.consentTemplate ?? "", delegation: a.delegation ?? "",
  };
  return (
    <main className="mx-auto grid w-full max-w-[760px] min-w-0 gap-4">
      <PageTitle title={`Ubah ${a.name}`} />
      <p className="m-0 text-[var(--label-2)]">Menyimpan membuat versi {Math.max(...p.versions.map((v) => v.version)) + 1}. Versi lama tetap tersimpan untuk transaksi yang sudah memakainya.</p>
      <VersionForm ctx={p.ctx} itemId={p.item.id} initial={initial} canSeeClinical={p.seesClinical}
        clinicalActive={active
          ? { indications: initial.indications, contraindications: initial.contraindications, consent_template: initial.consent_template, delegation: initial.delegation }
          : { indications: "", contraindications: "", consent_template: "", delegation: "" }} />
    </main>
  );
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<LoadingList label="Memuat item" />}>
      <Body params={params} />
    </Suspense>
  );
}
