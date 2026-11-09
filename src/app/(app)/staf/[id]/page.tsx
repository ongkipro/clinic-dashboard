// Staff detail (UX-3): roles and branches, membership dates, sessions (staff admins),
// and the access actions; the requester never acts on their own access.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ROLE_LABEL } from "../../../../components/shell/nav";
import { DetailPage } from "../../../../components/templates/templates";
import { BlockedState, LoadingList, PermissionState } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { type Credential, completeSet, credentialStatus, statusBadge } from "../../../../modules/org/licences/licences";
import { loadStaffDetail } from "../../../../modules/org/staff/page-data";
import { EndMembership, RemoveRole, RevokeSession } from "../forms";
import { DecideCredential, EndCredential, RecordCredentialSheet } from "../kredensial-forms";
import { DECIDE_BLOCKED, KIND_LABEL, PROFESSION_LABEL } from "../kredensial-labels";

export const metadata: Metadata = { title: "Detail Staf — Clinic Dashboard" };

const fmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });

const dateFmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "UTC" });
const day = (d: string) => dateFmt.format(new Date(`${d}T00:00:00Z`));
const STATE: Record<Credential["state"], { tone: "success" | "warning" | "danger" | "neutral" | "blocked"; label: string }> = {
  pending: { tone: "warning", label: "Menunggu verifikasi" },
  verified: { tone: "success", label: "Terverifikasi" },
  rejected: { tone: "neutral", label: "Ditolak" },
  suspended: { tone: "blocked", label: "Ditangguhkan" },
  revoked: { tone: "danger", label: "Dicabut" },
};

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
  const live = d.credentials.filter((c) => !c.superseded && c.state !== "rejected");
  const status = credentialStatus(d.credentials, d.today);
  const badge = statusBadge(status);
  const kredensial = d.clinical
    ? [{
        id: "kredensial",
        label: "Kredensial",
        content: (
          <div className="grid gap-4">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
              {d.canRecord && (
                <RecordCredentialSheet
                  staffId={d.staff.staffId}
                  branches={d.branches.filter((b) => d.clinicalBranchIds.includes(b.id))}
                  replaceable={d.credentials.filter((c) => !c.superseded && !c.replaced && c.state !== "rejected").map((c) => ({ id: c.id, label: `${KIND_LABEL[c.kind]} ${c.number}` }))}
                  ctx={d.ctx}
                />
              )}
            </div>
            {/* Review r1 P1-3: the notice follows a complete set (STR + permit of one profession, verified, in force). */}
            {!completeSet(d.credentials, d.today) && (
              <BlockedState reason="Kredensial belum diverifikasi" unblock="Tindakan klinis butuh STR dan SIP cabang yang terverifikasi dan masih berlaku" />
            )}
            {d.credentials.length === 0 ? (
              <p className="m-0 text-[var(--label-2)]">Belum ada kredensial yang dicatat.</p>
            ) : (
              <ul className="m-0 grid list-none gap-3 p-0">
                {d.credentials.map((c) => {
                  const st = STATE[c.state];
                  const dec = d.decidable[c.id];
                  return (
                    <li key={c.id} className="grid min-w-0 gap-2 rounded-[var(--radius-field)] bg-[var(--surface-2)] p-3">
                      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold [overflow-wrap:anywhere]">
                          {KIND_LABEL[c.kind]} · {c.number}
                          {c.branchId && <span className="font-normal text-[var(--label-2)]"> · {branchName.get(c.branchId) ?? "cabang lain"}</span>}
                        </span>
                        <StatusBadge tone={st.tone}>{c.superseded ? "Diganti" : st.label}</StatusBadge>
                      </div>
                      <span className="text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]">
                        {PROFESSION_LABEL[c.profession]} · {c.issuer} · berlaku {day(c.validFrom)} – {c.expiresOn ? day(c.expiresOn) : "seumur hidup"}
                        {c.scope ? ` · ${c.scope}` : ""}
                      </span>
                      {c.decisionReason && <span className="text-[0.88rem] text-[var(--label-2)]">Alasan ditolak: {c.decisionReason}</span>}
                      {c.endReason && <span className="text-[0.88rem] text-[var(--label-2)]">Alasan: {c.endReason}</span>}
                      {c.state === "pending" && dec && (dec.ok
                        ? <DecideCredential key={`${c.id}:${c.state}`} id={c.id} staffId={d.staff.staffId} ctx={d.ctx} />
                        : dec.why && DECIDE_BLOCKED[dec.why] && <p className="m-0 text-[0.88rem] text-[var(--label-2)]">{DECIDE_BLOCKED[dec.why]}</p>)}
                      {/* Keyed by state: a changed credential remounts its form closed (no stale open form after a decision). */}
                      {d.canEnd && (c.state === "verified" || c.state === "suspended") && !c.superseded && (
                        <EndCredential key={`${c.id}:${c.state}`} id={c.id} staffId={d.staff.staffId} canSuspend={c.state === "verified"} ctx={d.ctx} />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {live.length > 0 && <p className="m-0 text-[0.88rem] text-[var(--label-2)]">Pengingat masa berlaku dikirim 60, 30 dan 7 hari sebelum habis ke pemegang dan Penanggung Jawab Klinik.</p>}
          </div>
        ),
      }]
    : [];
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
                  {manage && d.staff.active && <RemoveRole staffId={d.staff.staffId} role={r.role} label={ROLE_LABEL[r.role]} ctx={d.ctx} />}
                </li>
              ))}
              {d.staff.roles.length === 0 && <li className="text-[var(--label-2)]">Tanpa peran.</li>}
            </ul>
          ),
        },
        ...kredensial,
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
                          {manage && !s.revoked && <RevokeSession staffId={d.staff.staffId} sessionId={s.sessionId} label="Cabut Sesi" ctx={d.ctx} />}
                        </li>
                      ))}
                    </ul>
                  ),
              },
            ]
          : []),
        ...(manage && d.staff.active
          ? [{ id: "keanggotaan", label: "Keanggotaan", content: <EndMembership staffId={d.staff.staffId} ctx={d.ctx} /> }]
          : []),
      ]}
      auditHref={d.canAudit ? "/pengguna-akses" : undefined}
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
