// Katalog item detail (UX-25, PR-41): the active version, the clinical change waiting for review
// (with Tarik Ajuan for its requester and a link to Persetujuan for reviewers), and the version
// history. Clinical content only for the DEC-046 (2) roles; every member sees the commercial part.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { DetailPage } from "../../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import type { VersionRow } from "../../../../modules/catalog/catalog";
import { loadItem } from "../data";
import { WithdrawPending } from "../forms";
import { BranchPriceTab } from "../harga-cabang/summary";
import { KIND_LABEL, rupiah, SCOPE_LABEL, STATE_LABEL, TAX_LABEL } from "../labels";

export const metadata: Metadata = { title: "Item Katalog — Clinic Dashboard" };
const fmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });
const muted = "m-0 text-[0.88rem] text-[var(--label-2)]";

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="m-0 grid min-w-0 grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-2">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-[var(--label-2)]">{k}</dt>
          <dd className="m-0 min-w-0 [overflow-wrap:anywhere]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
function Clinical({ v }: { v: VersionRow }) {
  return (
    <Facts rows={[
      ["Indikasi", v.indications ?? "—"],
      ["Kontraindikasi", v.contraindications ?? "—"],
      ["Persetujuan tindakan", v.consentTemplate ?? "—"],
      ["Delegasi", v.delegation ?? "—"],
    ]} />
  );
}

// T-034: which review a pending version waits for (unknown to roles that read no versions).
function reviewLabel(v: VersionRow | undefined): string {
  if (!v) return "Menunggu review";
  return v.approvalId && v.materialsApprovalId ? "Menunggu review klinis & BHP" : v.approvalId ? "Menunggu review klinis" : "Menunggu review BHP";
}

async function Body({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await loadItem(id);
  if (p.kind === "redirect") redirect(p.to);
  if (p.kind === "forbidden") return <PermissionState object="katalog" />;
  if (p.kind === "not-found") notFound();
  const c = p.commercial;
  const activeV = p.versions.find((v) => v.state === "active");
  const pending = p.versions.find((v) => v.state === "pending_review");
  const title = c?.name ?? pending?.name ?? p.versions[0]?.name ?? p.item.code;
  const sections = [
    {
      id: "umum",
      label: "Umum & harga",
      content: c ? (
        <Facts rows={[
          ["Jenis", KIND_LABEL[p.item.kind]],
          ["Kode", p.item.code],
          ["Harga normal", rupiah(c.normalPrice)],
          ["Pajak", `${TAX_LABEL[c.taxCategory]} — ${c.taxBasis}`],
          ["Kontrol gratis", c.controlCount ? `${c.controlCount} kali dalam ${c.controlValidityDays} hari` : "Tidak ada"],
          ["DP booking", c.bookingDpEnabled ? rupiah(c.bookingDpAmount ?? 0) : "Tidak"],
          ["Paket", [c.validityDays ? `berlaku ${c.validityDays} hari` : null, c.minDpPct !== null ? `DP minimal ${c.minDpPct}%` : null, c.installmentsAllowed ? "boleh dicicil" : null].filter(Boolean).join(", ") || "—"],
          ["Komisi untuk", c.commissionScope.length ? c.commissionScope.map((s) => SCOPE_LABEL[s]).join(", ") : "—"],
          ["Versi aktif", `Versi ${c.version}`],
        ]} />
      ) : (
        <p className="m-0">
          {pending ? "Belum ada versi aktif: item ini belum bisa dijual sampai data klinisnya direview." : "Belum ada versi aktif: ajuan terakhir ditolak atau ditarik. Ubah lalu ajukan lagi."}
        </p>
      ),
    },
  ];
  if (p.prices) sections.push({ id: "harga-cabang", label: "Harga Cabang", content: <BranchPriceTab itemId={p.item.id} prices={p.prices} canEdit={p.role === "owner"} /> });
  if (p.seesClinical && activeV) sections.push({ id: "klinis", label: "Data klinis", content: <Clinical v={activeV} /> });
  if (p.seesClinical && pending) {
    const mine = pending.createdBy === p.staffId;
    // T-034 (DEC-047 (2)): a pending version waits for the clinical review, the materials review, or both.
    const who = pending.approvalId && pending.materialsApprovalId ? "Penanggung Jawab Klinik dan Apoteker" : pending.approvalId ? "Penanggung Jawab Klinik" : "Apoteker";
    sections.push({
      id: "review",
      label: `Perubahan ${reviewLabel(pending).toLowerCase()}`,
      content: (
        <div className="grid min-w-0 gap-3">
          <p className="m-0">Versi {pending.version} diajukan {fmt.format(pending.createdAt)}: {pending.reason}. Versi aktif tetap berlaku sampai {who} menyetujui.</p>
          {pending.approvalId && <Clinical v={pending} />}
          {(p.role === "facility_head" || p.role === "owner") && pending.approvalId ? (
            <Link href={`/persetujuan/${pending.approvalId}`} className="inline-flex min-h-[var(--target)] items-center justify-self-start font-semibold text-[var(--tint)]">Buka di Persetujuan</Link>
          ) : null}
          {mine && p.openReview && <WithdrawPending ctx={p.ctx} itemId={p.item.id} approvalId={p.openReview} />}
        </div>
      ),
    });
  } else if (c?.pendingReview) {
    sections.push({ id: "review", label: "Perubahan", content: <p className="m-0">Ada perubahan yang menunggu review klinis atau BHP. Harga dan data di atas tetap berlaku.</p> });
  }
  if (p.seesClinical) {
    sections.push({
      id: "versi",
      label: "Riwayat versi",
      content: (
        <ol className="m-0 grid list-none gap-3 p-0" aria-label="Versi">
          {p.versions.map((v) => (
            <li key={v.id} className="grid min-w-0 gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">Versi {v.version}</span>
                <StatusBadge tone={v.state === "active" ? "success" : v.state === "pending_review" ? "warning" : "neutral"}>{STATE_LABEL[v.state] ?? v.state}</StatusBadge>
              </div>
              <p className={muted}>{fmt.format(v.createdAt)} · {rupiah(v.normalPrice)} · {v.reason}{v.decidedAt ? ` · diputuskan ${fmt.format(v.decidedAt)}` : ""}</p>
            </li>
          ))}
        </ol>
      ),
    });
  }
  return (
    <DetailPage
      title={title}
      subtitle={`${KIND_LABEL[p.item.kind]} · ${p.item.code}`}
      status={pending || c?.pendingReview ? { tone: "warning", label: reviewLabel(pending) } : c ? { tone: "success", label: "Aktif" } : undefined}
      primaryAction={p.canEdit && !pending && !c?.pendingReview ? { label: "Ubah", href: `/katalog/${p.item.id}/ubah` } : undefined}
      sections={sections}
    />
  );
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<LoadingList label="Memuat item" />}>
      <Body params={params} />
    </Suspense>
  );
}
