// Staff detail (UX-3): roles and branches, membership dates, sessions (staff admins),
// and the access actions; the requester never acts on their own access.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ROLE_LABEL } from "../../../../components/shell/nav";
import { DetailPage } from "../../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../../components/ui/states";
import { loadStaffDetail } from "../../../../modules/org/staff/page-data";
import { EndMembership, RemoveRole, RevokeSession } from "../forms";

export const metadata: Metadata = { title: "Detail Staf — Clinic Dashboard" };

const fmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });

function device(ua: string | null): string {
  if (!ua) return "Perangkat tidak dikenal";
  if (/iPad|Tablet/i.test(ua)) return "Tablet";
  if (/iPhone|Android.+Mobile/i.test(ua)) return "Ponsel";
  return "Komputer";
}

async function Body({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await loadStaffDetail(id);
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") return <PermissionState object="data staf" />;
  if (d.kind === "not-found") notFound();
  const branchName = new Map(d.branches.map((b) => [b.id, b.name]));
  const manage = d.canManage && !d.self;
  return (
    <DetailPage
      as="section"
      title={d.staff.name}
      subtitle={`Anggota sejak ${fmt.format(d.staff.from)}${d.staff.to ? ` · berakhir ${fmt.format(d.staff.to)}` : ""}`}
      status={d.staff.active ? { tone: "success", label: "Aktif" } : { tone: "neutral", label: "Berakhir" }}
      sections={[
        {
          id: "peran",
          label: "Peran & Cabang",
          content: (
            <ul className="m-0 grid list-none gap-3 p-0">
              {d.staff.roles.map((r) => (
                <li key={r.role} className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <span className="[overflow-wrap:anywhere]">
                    <span className="font-semibold">{ROLE_LABEL[r.role]}</span>
                    {r.branchIds.length > 0 && <span className="text-[var(--label-2)]"> · {r.branchIds.map((b) => branchName.get(b) ?? "cabang lain").join(", ")}</span>}
                  </span>
                  {manage && d.staff.active && <RemoveRole staffId={d.staff.staffId} role={r.role} label={ROLE_LABEL[r.role]} />}
                </li>
              ))}
              {d.staff.roles.length === 0 && <li className="text-[var(--label-2)]">Tanpa peran.</li>}
            </ul>
          ),
        },
        ...(d.canManage
          ? [
              {
                id: "sesi",
                label: "Sesi Aktif",
                content:
                  d.sessions.length === 0 ? (
                    <p className="m-0 text-[var(--label-2)]">Tidak ada sesi aktif.</p>
                  ) : (
                    <ul className="m-0 grid list-none gap-3 p-0">
                      {d.sessions.map((s) => (
                        <li key={s.sessionId} className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                          <span className="grid min-w-0 gap-0.5">
                            <span className="font-semibold">{device(s.userAgent)}</span>
                            <span className="text-[0.88rem] text-[var(--label-2)]">
                              Terakhir aktif {fmt.format(s.lastActiveAt)}{s.revoked ? " · dicabut" : ""}
                            </span>
                          </span>
                          {manage && !s.revoked && <RevokeSession staffId={d.staff.staffId} sessionId={s.sessionId} label="Cabut Sesi" />}
                        </li>
                      ))}
                    </ul>
                  ),
              },
            ]
          : []),
        ...(manage && d.staff.active
          ? [{ id: "keanggotaan", label: "Keanggotaan", content: <EndMembership staffId={d.staff.staffId} /> }]
          : []),
      ]}
      auditHref={d.canManage ? "/pengguna-akses" : undefined}
    />
  );
}

export default function StaffDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 gap-4">
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body params={params} />
      </Suspense>
    </main>
  );
}
