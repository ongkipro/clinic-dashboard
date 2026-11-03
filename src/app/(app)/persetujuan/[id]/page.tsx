// Persetujuan detail (UX-26): requester, reason and impact; Setujui / Tolak only here and
// only for an approver who did not request it ("Anda pengaju — tidak dapat menyetujui").
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ROLE_LABEL } from "../../../../components/shell/nav";
import { DetailPage } from "../../../../components/templates/templates";
import { BlockedState, LoadingList, PermissionState } from "../../../../components/ui/states";
import type { StatusTone } from "../../../../components/ui/status-badge";
import { rupiah } from "../../../../modules/approvals/inbox";
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
    : <DecideForm id={d.id} />;
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
        { id: "keputusan", label: "Keputusan", content: decision },
      ]}
    />
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
