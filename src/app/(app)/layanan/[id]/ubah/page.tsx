// Ubah layanan (UX-25, PR-88, T-034): a new version from the active one (or, with none, from the
// latest; the review baseline then is empty). Editors only; refused while a review waits (DEC-046
// (3), also enforced by the database).
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../../../components/templates/templates";
import { BlockedState, LoadingList, PermissionState } from "../../../../../components/ui/states";
import { loadService, type Version } from "../../data";
import { type Baseline, ServiceForm, type ServiceInitial } from "../../forms";

export const metadata: Metadata = { title: "Ubah Layanan — Clinic Dashboard" };

const s = (n: number | null) => (n === null ? "" : String(n));
const recipe = (v: Version) => v.materialFormula as { material: string; qty: number; unit: string }[];

async function Body({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await loadService(id, { staff: true });
  if (p.kind === "redirect") redirect(p.to);
  if (p.kind === "forbidden") return <PermissionState object="Master Layanan" />;
  if (p.kind === "not-found") notFound();
  if (!p.canEdit) return <PermissionState object="perubahan Master Layanan" />;
  const active = p.versions.find((v) => v.state === "active");
  const a = active ?? p.versions[0];
  if (p.versions.some((v) => v.state === "pending_review") || !a) {
    return (
      <main className="mx-auto grid w-full max-w-[760px] min-w-0 gap-4">
        <PageTitle title="Ubah layanan" />
        <BlockedState reason="Perubahan layanan ini masih menunggu review." unblock="Tunggu keputusan reviewer atau tarik ajuannya di halaman layanan." />
      </main>
    );
  }
  const initial: ServiceInitial = {
    name: a.name, tax_category: a.taxCategory, tax_basis: a.taxBasis, normal_price: String(a.normalPrice), control_count: String(a.controlCount),
    control_validity_days: s(a.controlValidityDays), booking_dp_enabled: a.bookingDpEnabled, booking_dp_amount: s(a.bookingDpAmount), min_dp_pct: s(a.minDpPct),
    installments_allowed: a.installmentsAllowed, validity_days: s(a.validityDays), commission_scope: a.commissionScope,
    indications: a.indications ?? "", contraindications: a.contraindications ?? "", consent_template: a.consentTemplate ?? "", delegation: a.delegation ?? "",
    aftercare_text: a.aftercareText ?? "", category: a.category ?? "", prep_min: s(a.prepMin), treatment_min: s(a.treatmentMin), buffer_min: s(a.bufferMin),
    online_bookable: a.onlineBookable, resources: a.rows.resources.map((r) => `${r.kind}:${r.code}`), eligibility: a.rows.eligibility, recipe: recipe(a),
  };
  const baseline: Baseline = active
    ? { clinical: { indications: initial.indications, contraindications: initial.contraindications, consent_template: initial.consent_template, delegation: initial.delegation, aftercare_text: initial.aftercare_text }, eligibility: active.rows.eligibility, recipe: recipe(active) }
    : { clinical: { indications: "", contraindications: "", consent_template: "", delegation: "", aftercare_text: "" }, eligibility: [], recipe: [] };
  return (
    <main className="mx-auto grid w-full max-w-[760px] min-w-0 gap-4">
      <PageTitle title={`Ubah ${a.name}`} />
      <p className="m-0 text-[var(--label-2)]">Menyimpan membuat versi {Math.max(...p.versions.map((v) => v.version)) + 1}. Versi lama tetap tersimpan untuk booking dan transaksi yang sudah memakainya.</p>
      <ServiceForm ctx={p.ctx} itemId={p.item.id} initial={initial} baseline={baseline} staff={p.staff ?? []} />
    </main>
  );
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<LoadingList label="Memuat layanan" />}>
      <Body params={params} />
    </Suspense>
  );
}
