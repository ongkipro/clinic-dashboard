// Master Layanan detail (UX-25, PR-88, T-034): the active version in the 19 row's tabs (Umum ·
// Durasi & Sumber Daya · Staf & Delegasi · Harga Cabang · Pajak · Resep BHP · Persetujuan Tindakan ·
// Aftercare · Situs · Booking Online), the change waiting for review (which review, Tarik Ajuan for its
// requester, Persetujuan for reviewers) and the version history. Harga Cabang (T-035) and Situs (the
// public-site task) say plainly that they are not available yet. A pharmacist never sees unpublished
// clinical content here (DEC-047 (2)): RLS gives it no pending version; its review is in Persetujuan.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { DetailPage } from "../../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { CATEGORY_LABEL, MODE_LABEL, PROFESSION_LABEL, resourceLabel } from "../../../../modules/catalog/service/labels";
import { rupiah, SCOPE_LABEL, STATE_LABEL, TAX_LABEL } from "../../katalog/labels";
import { loadService, type Version } from "../data";
import { WithdrawReview } from "../forms";

export const metadata: Metadata = { title: "Layanan — Clinic Dashboard" };
const fmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });
const num = new Intl.NumberFormat("id-ID");
const muted = "m-0 text-[0.88rem] text-[var(--label-2)]";

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="m-0 grid min-w-0 grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-2">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-[var(--label-2)]">{k}</dt>
          <dd className="m-0 min-w-0 [overflow-wrap:anywhere] whitespace-pre-line">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
const eligText = (v: Version, names: Record<string, string>) =>
  v.rows.eligibility.length
    ? v.rows.eligibility.map((e) => `${e.role ? PROFESSION_LABEL[e.role] ?? e.role : names[e.staffId!] ?? "Staf"}: ${MODE_LABEL[e.mode] ?? e.mode}`).join("\n")
    : "Belum ditetapkan";
const recipeText = (v: Version) =>
  (v.materialFormula as { material: string; qty: number; unit: string }[]).map((x) => `${x.material} — ${num.format(x.qty)} ${x.unit}`).join("\n") || "Belum ada resep";
const resText = (v: Version, kind: "room" | "device") => v.rows.resources.filter((r) => r.kind === kind).map((r) => resourceLabel(r.kind, r.code) + (r.required ? "" : " (opsional)")).join(", ") || "—";

function Clinical({ v, names }: { v: Version; names: Record<string, string> }) {
  return (
    <Facts rows={[
      ["Staf yang boleh", eligText(v, names)],
      ["Indikasi", v.indications ?? "—"],
      ["Kontraindikasi", v.contraindications ?? "—"],
      ["Persetujuan tindakan", v.consentTemplate ?? "—"],
      ["Catatan delegasi", v.delegation ?? "—"],
      ["Aftercare", v.aftercareText ?? "—"],
    ]} />
  );
}

async function Body({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await loadService(id);
  if (p.kind === "redirect") redirect(p.to);
  if (p.kind === "forbidden") return <PermissionState object="Master Layanan" />;
  if (p.kind === "not-found") notFound();
  const c = p.commercial;
  const a = p.versions.find((v) => v.state === "active");
  const pending = p.versions.find((v) => v.state === "pending_review");
  const title = c?.name ?? pending?.name ?? p.versions[0]?.name ?? p.item.code;
  const soon = (what: string) => <p className="m-0">{what} belum tersedia. Fitur ini menyusul di tahap berikutnya.</p>;
  const sections: { id: string; label: string; content: React.ReactNode }[] = [];
  if (a && c) {
    sections.push(
      { id: "umum", label: "Umum", content: <Facts rows={[
        ["Kode", p.item.code],
        ["Kategori", a.category ? CATEGORY_LABEL[a.category] ?? a.category : "Belum dipilih"],
        ["Harga normal", rupiah(a.normalPrice)],
        ["Kontrol gratis", a.controlCount ? `${a.controlCount} kali dalam ${a.controlValidityDays} hari` : "Tidak ada"],
        ["Komisi untuk", a.commissionScope.length ? a.commissionScope.map((s) => SCOPE_LABEL[s]).join(", ") : "—"],
        ["Versi aktif", `Versi ${a.version}`],
      ]} /> },
      { id: "durasi", label: "Durasi & Sumber Daya", content: <Facts rows={[
        ["Persiapan", `${a.prepMin ?? 0} menit`],
        ["Tindakan", `${a.treatmentMin ?? 0} menit`],
        ["Jeda setelahnya", `${a.bufferMin ?? 0} menit`],
        ["Ruang", resText(a, "room")],
        ["Alat", resText(a, "device")],
      ]} /> },
      { id: "staf", label: "Staf & Delegasi", content: <Facts rows={[["Staf yang boleh", eligText(a, p.staffNames)], ["Catatan delegasi", a.delegation ?? "—"]]} /> },
      { id: "harga-cabang", label: "Harga Cabang", content: soon("Harga per cabang") },
      { id: "pajak", label: "Pajak", content: <Facts rows={[["Kategori", TAX_LABEL[a.taxCategory]], ["Dasar", a.taxBasis]]} /> },
      { id: "bhp", label: "Resep BHP", content: <Facts rows={[["Bahan per tindakan", recipeText(a)]]} /> },
      { id: "persetujuan-tindakan", label: "Persetujuan Tindakan", content: <Facts rows={[["Indikasi", a.indications ?? "—"], ["Kontraindikasi", a.contraindications ?? "—"], ["Templat", a.consentTemplate ?? "—"]]} /> },
      { id: "aftercare", label: "Aftercare", content: <Facts rows={[["Petunjuk", a.aftercareText ?? "—"]]} /> },
      { id: "situs", label: "Situs", content: soon("Data untuk situs publik") },
      { id: "booking-online", label: "Booking Online", content: <Facts rows={[["Booking online", a.onlineBookable ? "Ya" : "Tidak"], ["DP booking", a.bookingDpEnabled ? rupiah(a.bookingDpAmount ?? 0) : "Tidak"]]} /> },
    );
  } else if (c) {
    // A reader without clinical-content access (none of the Master Layanan roles today) sees the projection.
    sections.push({ id: "umum", label: "Umum", content: <Facts rows={[["Kode", p.item.code], ["Harga normal", rupiah(c.normalPrice)], ["Durasi", `${(c.prepMin ?? 0) + (c.treatmentMin ?? 0) + (c.bufferMin ?? 0)} menit`]]} /> });
  } else {
    sections.push({ id: "umum", label: "Umum", content: <p className="m-0">{pending ? "Belum ada versi aktif: layanan ini belum bisa dibooking atau dijual sampai reviewnya selesai." : "Belum ada versi aktif: ajuan terakhir ditolak atau ditarik. Ubah lalu ajukan lagi."}</p> });
  }
  if (pending) {
    const clinical = !!pending.approvalId;
    const materials = !!pending.materialsApprovalId;
    const who = clinical && materials ? "Penanggung Jawab Klinik dan Apoteker" : clinical ? "Penanggung Jawab Klinik" : "Apoteker";
    const mine = pending.createdBy === p.staffId;
    sections.push({
      id: "review",
      label: "Perubahan menunggu review",
      content: (
        <div className="grid min-w-0 gap-3">
          <p className="m-0">Versi {pending.version} diajukan {fmt.format(pending.createdAt)}: {pending.reason}. Menunggu review {who}. Versi aktif tetap berlaku sampai disetujui.</p>
          {clinical && <Clinical v={pending} names={p.staffNames} />}
          {materials && <Facts rows={[["Resep BHP diajukan", recipeText(pending)]]} />}
          {(p.role === "facility_head" || p.role === "owner") && pending.approvalId ? (
            <Link href={`/persetujuan/${pending.approvalId}`} className="inline-flex min-h-[var(--target)] items-center justify-self-start font-semibold text-[var(--tint)]">Buka review klinis di Persetujuan</Link>
          ) : null}
          {mine && p.openReview && <WithdrawReview ctx={p.ctx} itemId={p.item.id} approvalId={p.openReview} />}
        </div>
      ),
    });
  } else if (c?.pendingReview) {
    sections.push({ id: "review", label: "Perubahan", content: <p className="m-0">Ada perubahan yang menunggu review. Data di atas tetap berlaku sampai disetujui.</p> });
  }
  if (p.versions.length) {
    sections.push({
      id: "versi",
      label: "Riwayat versi",
      content: (
        <ol className="m-0 grid list-none gap-3 p-0" aria-label="Versi">
          {p.versions.map((v) => (
            <li key={v.id} className="grid min-w-0 gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">Versi {v.version}</span>
                <StatusBadge tone={v.state === "active" ? "success" : v.state === "pending_review" ? "warning" : "neutral"}>{v.state === "pending_review" ? "Menunggu review" : STATE_LABEL[v.state] ?? v.state}</StatusBadge>
              </div>
              <p className={muted}>{fmt.format(v.createdAt)} · {rupiah(v.normalPrice)} · {(v.prepMin ?? 0) + (v.treatmentMin ?? 0) + (v.bufferMin ?? 0)} menit · {v.reason}{v.decidedAt ? ` · diputuskan ${fmt.format(v.decidedAt)}` : ""}</p>
            </li>
          ))}
        </ol>
      ),
    });
  }
  return (
    <DetailPage
      title={title}
      subtitle={`Layanan · ${p.item.code}${a?.category ? ` · ${CATEGORY_LABEL[a.category] ?? a.category}` : ""}`}
      status={pending || c?.pendingReview ? { tone: "warning", label: "Menunggu review" } : c ? { tone: "success", label: "Aktif" } : undefined}
      primaryAction={p.canEdit && !pending && !c?.pendingReview ? { label: "Ubah", href: `/layanan/${p.item.id}/ubah` } : undefined}
      sections={sections}
    />
  );
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<LoadingList label="Memuat layanan" />}>
      <Body params={params} />
    </Suspense>
  );
}
