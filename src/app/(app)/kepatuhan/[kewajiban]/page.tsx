// Kepatuhan detail (UX-58): file versions with checksum and who uploaded them, decisions
// with approver and validity, the features this item unlocks; Unggah Bukti and Tandai
// Disetujui for the roles that handle it. Vendor items show status only.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ROLE_LABEL } from "../../../../components/shell/nav";
import { DetailPage } from "../../../../components/templates/templates";
import { BlockedState, LoadingList, PermissionState } from "../../../../components/ui/states";
import { AREA_LABEL, GATE_LABEL, STATUS_LABEL as STATUS } from "../../../../modules/compliance/compliance";
import { loadItem } from "../data";
import { DecideForm, UploadForm } from "../forms";

export const metadata: Metadata = { title: "Detail Kepatuhan — Clinic Dashboard" };

const dt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });
const d = (s: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "Asia/Jakarta" }).format(new Date(`${s}T00:00:00+07:00`));
const role = (r: string) => ROLE_LABEL[r as keyof typeof ROLE_LABEL] ?? r;
const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

async function Body({ params }: { params: Promise<{ kewajiban: string }> }) {
  const { kewajiban } = await params;
  if (!/^[a-z][a-z0-9_]{2,60}$/.test(kewajiban)) notFound();
  const p = await loadItem(kewajiban);
  if (p.kind === "redirect") redirect(p.to);
  if (p.kind === "forbidden") return <PermissionState object="register kepatuhan" />;
  if (p.kind === "not-found") notFound();
  const { row } = p;
  const latest = p.files[0];
  const gates = row.gates.map((g) => GATE_LABEL[g] ?? g);
  const locked = row.status !== "approved" && gates.length > 0;
  return (
    <DetailPage
      as="section"
      title={row.label}
      subtitle={`${AREA_LABEL[row.area]} · ${row.scope === "vendor" ? "kewajiban vendor" : "kewajiban klinik"}`}
      status={STATUS[row.status]}
      sections={[
        {
          id: "status",
          label: "Status",
          content: (
            <div className="grid gap-3">
              {locked && <BlockedState reason={`Fitur ${gates.join(", ")} terkunci sampai bukti ini disetujui`} unblock={row.scope === "vendor" ? "Vendor melengkapi bukti ini" : "Owner atau penanggung bidangnya dapat menyetujuinya"} />}
              {!locked && gates.length > 0 && <p className="m-0">Ikut membuka: {gates.join(", ")} (fitur terbuka bila semua bukti yang diperlukannya disetujui).</p>}
              {gates.length === 0 && <p className="m-0 text-[var(--label-2)]">Tidak mengunci fitur; disimpan sebagai bukti kepatuhan.</p>}
              {row.validUntil && <p className="m-0">Berlaku sampai {d(row.validUntil)}.</p>}
            </div>
          ),
        },
        ...(row.scope === "tenant" && row.mayRead
          ? [
              {
                id: "berkas",
                label: "Berkas",
                content: (
                  <div className="grid min-w-0 gap-4">
                    {p.files.length === 0 ? (
                      <p className="m-0 text-[var(--label-2)]">Belum ada berkas.</p>
                    ) : (
                      <ol className="m-0 grid list-none gap-3 p-0">
                        {p.files.map((f) => (
                          <li key={f.id} className="grid min-w-0 gap-0.5">
                            <a href={`/kepatuhan/berkas/${f.id}`} className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)] [overflow-wrap:anywhere]">
                              Versi {f.version}: {f.fileName}
                            </a>
                            <span className="text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]">
                              {f.expertName} · dokumen {d(f.documentDate)} · {kb(f.sizeBytes)} · diunggah {f.uploadedName} sebagai {role(f.uploadedAs)}, {dt.format(f.uploadedAt)}
                            </span>
                            <span className="font-mono text-[0.76rem] text-[var(--label-2)] [overflow-wrap:anywhere]">SHA-256 {f.sha256}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                    {row.mayAct && <UploadForm obligationKey={row.obligationKey} />}
                  </div>
                ),
              },
              {
                id: "keputusan",
                label: "Keputusan",
                content: (
                  <div className="grid min-w-0 gap-4">
                    {p.decisions.length === 0 ? (
                      <p className="m-0 text-[var(--label-2)]">Belum ada keputusan.</p>
                    ) : (
                      <ol className="m-0 grid list-none gap-3 p-0">
                        {p.decisions.map((x, i) => (
                          <li key={i} className="grid min-w-0 gap-0.5">
                            <span className="font-semibold">
                              {{ approved: "Disetujui", rejected: "Ditolak", revoked: "Dicabut" }[x.decision]} · versi {p.files.find((f) => f.id === x.fileId)?.version ?? "?"}
                              {x.validUntil ? ` · berlaku sampai ${d(x.validUntil)}` : ""}
                            </span>
                            <span className="text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]">
                              {x.decidedName} sebagai {role(x.decidedAs)}, {dt.format(x.decidedAt)}{x.reason ? ` · ${x.reason}` : ""}
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}
                    {row.mayAct && row.itemId && latest && row.latestFileId && (row.status === "submitted" || row.status === "expired" || row.status === "approved") && (
                      row.mayDecide || row.status === "approved" ? (
                        <DecideForm obligationKey={row.obligationKey} itemId={row.itemId} fileId={row.latestFileId} approved={row.status === "approved"} />
                      ) : (
                        <BlockedState reason="Anda pengunggah berkas terbaru" unblock="Penanggung bidang lain atau owner yang menyetujuinya" />
                      )
                    )}
                  </div>
                ),
              },
            ]
          : []),
      ]}
    />
  );
}

export default function KepatuhanDetailPage({ params }: { params: Promise<{ kewajiban: string }> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body params={params} />
      </Suspense>
    </main>
  );
}
