// Persetujuan detail (UX-26): requester, reason and impact; Setujui / Tolak only here and
// only for an approver who did not request it ("Anda pengaju — tidak dapat menyetujui").
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ROLE_LABEL } from "../../../../components/shell/nav";
import { DetailPage } from "../../../../components/templates/templates";
import { BlockedState, LoadingList, PermissionState } from "../../../../components/ui/states";
import type { StatusTone } from "../../../../components/ui/status-badge";
import { rupiah } from "../../../../modules/approvals/inbox";
import type { Clinical, ReviewTarget } from "../../../../modules/catalog/catalog";
import { CATEGORY_LABEL, MODE_LABEL, PROFESSION_LABEL } from "../../../../modules/catalog/service/labels";
import { loadDetail } from "../data";
import { DecideForm } from "../decide-form";

export const metadata: Metadata = { title: "Detail Persetujuan — Clinic Dashboard" };

const fmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });
const STATE: Record<string, { tone: StatusTone; label: string }> = {
  pending: { tone: "warning", label: "Menunggu" },
  approved: { tone: "success", label: "Disetujui" },
  rejected: { tone: "danger", label: "Ditolak" },
  cancelled: { tone: "neutral", label: "Dibatalkan" },
};

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="text-[0.88rem] text-[var(--label-2)]">{label}</dt>
      <dd className="m-0 [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

async function Body({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await loadDetail(id);
  if (p.kind === "redirect") redirect(p.to);
  if (p.kind === "forbidden") return <PermissionState object="persetujuan" />;
  if (p.kind === "not-found") notFound();
  const d = p.detail;
  const role = (r: string | null) => (r ? (ROLE_LABEL[r as keyof typeof ROLE_LABEL] ?? r) : "");
  const decision =
    d.blocked === "own-request" ? <BlockedState reason="Anda pengaju — tidak dapat menyetujui" unblock="Approver lain di klinik ini yang memutuskan" />
    : d.blocked === "not-approver" ? (
      <BlockedState reason="Jenis ini diputuskan peran lain" unblock={`${d.approverRoles.map(role).join(" atau ")} dapat memutuskannya`} />
    )
    : d.blocked === "decided" ? (
      <p className="m-0 text-[var(--label-2)]">
        {STATE[d.state].label}
        {d.deciderName ? ` oleh ${d.deciderName}` : ""}
        {d.decidedAs ? ` sebagai ${role(d.decidedAs)}` : ""}
        {d.decidedAt ? ` · ${fmt.format(d.decidedAt)}` : ""}
        {d.decisionReason ? ` · ${d.decisionReason}` : ""}
      </p>
    )
    : <DecideForm id={d.id} ctx={p.ctx} />;
  return (
    <DetailPage
      as="section"
      title={d.typeLabel}
      subtitle={`Diajukan ${fmt.format(d.requestedAt)}`}
      status={STATE[d.state]}
      sections={[
        {
          id: "permintaan",
          label: "Permintaan",
          content: (
            <dl className="m-0 grid gap-3">
              <Fact label="Pengaju" value={`${d.requesterName ?? "Staf"} · ${role(d.requestedAs)}`} />
              <Fact label="Alasan" value={d.reason ?? "Tanpa alasan tertulis"} />
              {d.branchName && <Fact label="Cabang" value={d.branchName} />}
            </dl>
          ),
        },
        {
          id: "dampak",
          label: "Dampak",
          content: (
            <dl className="m-0 grid gap-3">
              <Fact label="Nilai" value={d.amountRupiah !== null ? rupiah(d.amountRupiah) : "Tanpa nilai uang"} />
              <Fact label="Berlaku setelah disetujui" value="Perubahan baru dijalankan setelah keputusan ini." />
            </dl>
          ),
        },
        // T-033 review round 1 (P1), T-034 (DEC-047): a catalog review names the item and shows what it
        // decides next to the active version: clinical text, aftercare and eligibility for the clinical
        // review; only the recipe for the materials review.
        ...(p.catalog ? [{ id: "katalog", label: p.catalog.reviewType === "catalog_materials_review" ? "Perubahan resep BHP" : "Perubahan klinis katalog", content: <CatalogChange t={p.catalog} /> }] : []),
        { id: "keputusan", label: "Keputusan", content: decision },
      ]}
    />
  );
}

const eligText = (c: Clinical | null) =>
  c && c.eligibility.length ? c.eligibility.map((e) => `${e.role ? PROFESSION_LABEL[e.role] ?? e.role : e.staffName ?? "Staf"}: ${MODE_LABEL[e.mode] ?? e.mode}`).join("; ") : null;
const formulaText = (f: unknown[] | null) =>
  f && f.length ? (f as { material: string; qty: number; unit: string }[]).map((x) => `${x.material} ${new Intl.NumberFormat("id-ID").format(x.qty)} ${x.unit}`).join("; ") : null;

function Change({ label, next, now, hasActive }: { label: string; next: string | null; now: string | null; hasActive: boolean }) {
  return <Fact label={`${label}${(now ?? "") === (next ?? "") ? "" : " (berubah)"}`} value={`${next ?? "—"}${hasActive ? ` — sekarang: ${now ?? "—"}` : ""}`} />;
}

function CatalogChange({ t }: { t: ReviewTarget }) {
  return (
    <div className="grid min-w-0 gap-3">
      <dl className="m-0 grid gap-3">
        <Fact label="Item" value={`${t.name} · ${t.code} · versi ${t.version}${t.category ? ` · ${CATEGORY_LABEL[t.category] ?? t.category}` : ""}`} />
        {t.proposed
          ? <>
              {([["Indikasi", "indications"], ["Kontraindikasi", "contraindications"], ["Persetujuan tindakan", "consentTemplate"], ["Delegasi", "delegation"], ["Aftercare", "aftercareText"]] as const).map(([l, k]) => (
                <Change key={k} label={l} next={t.proposed![k]} now={t.active ? t.active[k] : null} hasActive={t.hasActive} />
              ))}
              <Change label="Staf yang boleh" next={eligText(t.proposed)} now={eligText(t.active)} hasActive={t.hasActive} />
            </>
          : <Change label="Resep BHP" next={formulaText(t.formula)} now={formulaText(t.activeFormula)} hasActive={t.hasActive} />}
      </dl>
      {/* Review round 1 (Argon): services open in Master Layanan, other kinds in Katalog. A materials
          review links nowhere: the pharmacist reads no unpublished item page (DEC-047 (2)). */}
      {t.proposed ? (
        <Link href={t.kind === "service" ? `/layanan/${t.itemId}` : `/katalog/${t.itemId}`} className="inline-flex min-h-[var(--target)] items-center justify-self-start font-semibold text-[var(--tint)]">
          {t.kind === "service" ? "Buka di Master Layanan" : "Buka item di Katalog"}
        </Link>
      ) : null}
    </div>
  );
}

export default function PersetujuanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body params={params} />
      </Suspense>
    </main>
  );
}
