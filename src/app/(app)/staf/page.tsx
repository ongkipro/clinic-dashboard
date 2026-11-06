// Staf & Undangan (UX-3, 19 §2.10): segments Staf · Undangan · Kredensial, plus Akses
// (Pengguna & Akses). Owner and Admin Pusat manage; manager and facility head view.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ROLE_LABEL } from "../../../components/shell/nav";
import { ListPage, Row, RowList } from "../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../components/ui/states";
import { StatusBadge } from "../../../components/ui/status-badge";
import { loadStaffPage } from "../../../modules/org/staff/page-data";
import { CancelInvite, InviteSheet } from "./forms";

export const metadata: Metadata = { title: "Staf — Clinic Dashboard" };

const SEGMENTS = [
  { key: "staf", label: "Staf" },
  { key: "undangan", label: "Undangan" },
  { key: "kredensial", label: "Kredensial" },
] as const;
const ADMIN_PUSAT_ROLES = ["manager", "fo_cashier", "bc", "doctor", "nurse", "therapist", "pharmacist"];
const BRANCH_ROLES = new Set(["manager", "facility_head", "records_officer", "fo_cashier", "bc", "doctor", "nurse", "therapist", "pharmacist"]);
const CLINICAL = new Set(["doctor", "nurse", "therapist", "pharmacist", "facility_head"]);
const fmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "Asia/Jakarta" });

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const seg = typeof q.segmen === "string" && SEGMENTS.some((s) => s.key === q.segmen) ? q.segmen : "staf";
  const page = await loadStaffPage();
  if (page.kind === "redirect") redirect(page.to);
  if (page.kind === "forbidden") return <PermissionState object="data staf" />;
  const branchName = new Map(page.branches.map((b) => [b.id, b.name]));
  const segments = SEGMENTS.filter((s) => s.key !== "undangan" || page.canManage).map((s) => ({
    label: s.label,
    href: `/staf?segmen=${s.key}`,
    active: s.key === seg,
  }));
  const inviteRoles = Object.entries(ROLE_LABEL)
    .filter(([r]) => page.isOwner || ADMIN_PUSAT_ROLES.includes(r))
    .map(([value, label]) => ({ value, label, branch: BRANCH_ROLES.has(value) }));

  if (seg === "undangan" && page.canManage) {
    return (
      <ListPage
        as="section"
        title="Undangan"
        filters={segments}
        state={page.invitations.length === 0 ? { kind: "empty", message: "Belum ada undangan." } : { kind: "rows" }}
      >
        <RowList label="Undangan">
          {page.invitations.map((i) => (
            <li key={i.id} className="grid gap-2 border-b border-[var(--separator)] px-4 py-3 last:border-b-0 [border-bottom-width:0.5px]">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <span className="font-semibold [overflow-wrap:anywhere]">{i.name}</span>
                <StatusBadge tone={i.state === "pending" ? "warning" : i.state === "accepted" ? "success" : "neutral"}>
                  {i.state === "pending" ? "Menunggu" : i.state === "accepted" ? "Diterima" : i.state === "expired" ? "Kedaluwarsa" : "Dibatalkan"}
                </StatusBadge>
              </div>
              <span className="text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]">
                {i.email} · {i.roles.map((r) => ROLE_LABEL[r]).join(", ")} · berlaku sampai {fmt.format(i.expiresAt)}
              </span>
              {i.state === "pending" && <CancelInvite id={i.id} ctx={page.ctx} />}
            </li>
          ))}
        </RowList>
      </ListPage>
    );
  }

  if (seg === "kredensial") {
    const clinical = page.staff.filter((s) => s.active && s.roles.some((r) => CLINICAL.has(r.role)));
    return (
      <ListPage
        as="section"
        title="Kredensial"
        filters={segments}
        state={clinical.length === 0 ? { kind: "empty", message: "Belum ada staf klinis." } : { kind: "rows" }}
      >
        <RowList label="Status kredensial">
          {clinical.map((s) => (
            <Row key={s.staffId} href={`/staf/${s.staffId}`} title={s.name} subtitle={s.roles.map((r) => ROLE_LABEL[r.role]).join(", ")}
              trailing={<StatusBadge tone="warning">Belum diverifikasi</StatusBadge>} />
          ))}
        </RowList>
        <p className="m-0 text-[0.88rem] text-[var(--label-2)]">STR dan SIP per cabang diverifikasi oleh Penanggung Jawab Klinik.</p>
      </ListPage>
    );
  }

  return (
    <ListPage
      as="section"
      title="Staf"
      filters={segments}
      state={page.staff.length === 0 ? { kind: "empty", message: "Belum ada staf." } : { kind: "rows" }}
    >
      {page.canManage && (
        <div className="flex flex-wrap gap-2">
          <InviteSheet roles={inviteRoles} branches={page.branches} ctx={page.ctx} />
        </div>
      )}
      <RowList label="Daftar staf">
        {page.staff.map((s) => (
          <Row
            key={s.staffId}
            href={`/staf/${s.staffId}`}
            title={s.name}
            subtitle={
              s.roles
                .map((r) => `${ROLE_LABEL[r.role]}${r.branchIds.length ? ` (${r.branchIds.map((b) => branchName.get(b) ?? "cabang lain").join(", ")})` : ""}`)
                .join(" · ") || "Tanpa peran"
            }
            trailing={s.active ? undefined : <StatusBadge tone="neutral">Berakhir</StatusBadge>}
          />
        ))}
      </RowList>
    </ListPage>
  );
}

export default function StafPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 gap-4">
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
