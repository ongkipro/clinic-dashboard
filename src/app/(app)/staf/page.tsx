// Staf & Undangan (UX-3, 19 §2.10): segments Staf · Undangan · Kredensial, plus Akses
// (Pengguna & Akses). Owner and Admin Pusat manage; manager and facility head view.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ROLE_LABEL } from "../../../components/shell/nav";
import { ListPage, Row, RowList } from "../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../components/ui/states";
import { StatusBadge } from "../../../components/ui/status-badge";
import { credentialStatus, statusBadge, type CredentialStatus } from "../../../modules/org/licences/licences";
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
// Kredensial status filter (T-050, P3-1) and its badge (UI-3: tone + symbol + word).
const STATUS_FILTERS = [
  { key: "semua", label: "Semua" },
  { key: "perlu", label: "Perlu Tindakan" },
  { key: "menunggu", label: "Menunggu Verifikasi" },
  { key: "habis", label: "Hampir/Sudah Habis" },
  { key: "aktif", label: "Terverifikasi" },
] as const;
const matches = (key: string, st: CredentialStatus) =>
  key === "semua" ? true
  : key === "perlu" ? st.kind !== "verified"
  : key === "menunggu" ? st.kind === "pending"
  : key === "habis" ? st.kind === "expiring" || st.kind === "expired"
  : st.kind === "verified";
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
    const filter = typeof q.status === "string" && STATUS_FILTERS.some((x) => x.key === q.status) ? q.status : "semua";
    const rows = page.clinical.map((s) => ({ s, st: credentialStatus(page.credentials.filter((c) => c.staffId === s.staffId), page.today) }));
    const shown = rows.filter((r) => matches(filter, r.st));
    return (
      <ListPage
        as="section"
        title="Kredensial"
        filters={segments}
        state={
          rows.length === 0 ? { kind: "empty", message: "Belum ada staf klinis." }
          : shown.length === 0 ? { kind: "filtered-empty", message: "Tidak ada staf klinis dengan status ini.", clearHref: "/staf?segmen=kredensial" }
          : { kind: "rows" }
        }
      >
        {/* Status filter: the template's segmented chips (same classes), labelled as a filter. */}
        <div role="group" aria-label="Filter status kredensial" className="flex min-w-0 flex-wrap gap-1 justify-self-start rounded-[var(--radius-capsule)] bg-[var(--surface-2)] p-1">
          {STATUS_FILTERS.map((x) => (
            <Link
              key={x.key}
              href={`/staf?segmen=kredensial&status=${x.key}`}
              aria-current={x.key === filter ? "true" : undefined}
              className={`inline-flex min-h-[var(--target)] items-center rounded-full px-4 text-[0.94rem] text-[var(--label)] no-underline ${x.key === filter ? "bg-[var(--surface)] font-semibold shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "bg-transparent"}`}
            >
              {x.label}
            </Link>
          ))}
        </div>
        <RowList label="Status kredensial">
          {shown.map(({ s, st }) => {
            const b = statusBadge(st);
            return (
              // The badge sits under the name (review r1 P2-3): a long badge beside it squeezed the name at 390 @ 200 %.
              <Row key={s.staffId} href={`/staf/${s.staffId}#kredensial`} title={s.name} subtitle={s.roles.map((r) => ROLE_LABEL[r.role]).join(", ")}>
                <StatusBadge tone={b.tone}>{b.label}</StatusBadge>
              </Row>
            );
          })}
        </RowList>
        <p className="m-0 text-[0.88rem] text-[var(--label-2)]">STR dan SIP per cabang dicatat Owner atau Admin Pusat dan diverifikasi oleh Penanggung Jawab Klinik.</p>
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
