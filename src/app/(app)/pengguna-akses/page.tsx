// Pengguna & Akses (PR-91, UX-3 ▸ Akses): read-only permission matrix (07), sessions per
// staff with revoke, duty assignments (IAM-13) and the access change log.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ROLE_LABEL } from "../../../components/shell/nav";
import { PageTitle, Row, RowList } from "../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../components/ui/states";
import { CAPABILITY_LABEL, DUTY_LABEL, type Duty, permissionMatrix } from "../../../modules/org/access/access";
import { loadAccessPage } from "../../../modules/org/staff/page-data";
import { DutyToggle, RevokeSession } from "../staf/forms";

export const metadata: Metadata = { title: "Pengguna & Akses — Clinic Dashboard" };

const fmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });
const CELL = { full: "●", limited: "◐", duty: "◐ tugas" } as const;
const CELL_WORD = { full: "penuh", limited: "terbatas", duty: "dengan tugas" } as const;

async function Body() {
  const p = await loadAccessPage();
  if (p.kind === "redirect") redirect(p.to);
  if (p.kind === "forbidden") return <PermissionState object="pengaturan akses" />;
  const m = permissionMatrix();
  const name = new Map(p.staff.map((s) => [s.staffId, s.name]));
  const branchName = new Map(p.branches.map((b) => [b.id, b.name]));
  const admins = p.staff.filter((s) => s.active && s.roles.some((r) => r.role === "owner" || r.role === "admin_pusat"));
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-8">
      <section aria-labelledby="sesi-judul" className="grid gap-3">
        <h2 id="sesi-judul" className="m-0 text-[1.18rem] font-semibold">Sesi per staf</h2>
        <p className="m-0 text-[var(--label-2)]">Buka staf untuk melihat perangkatnya, atau cabut semua sesinya sekaligus. Perangkat yang dicabut keluar pada permintaan berikutnya.</p>
        <RowList label="Staf dan sesi">
          {p.staff.filter((s) => s.active).map((s) => (
            <Row key={s.staffId} href={`/staf/${s.staffId}`} title={s.name} subtitle={s.roles.map((r) => ROLE_LABEL[r.role]).join(", ")}>
              {s.staffId !== p.selfId && (
                <div className="relative z-10 justify-self-start">
                  <RevokeSession staffId={s.staffId} label="Cabut Semua Sesi" ctx={p.ctx} />
                </div>
              )}
            </Row>
          ))}
        </RowList>
      </section>

      <section aria-labelledby="tugas-judul" className="grid gap-3">
        <h2 id="tugas-judul" className="m-0 text-[1.18rem] font-semibold">Tugas</h2>
        <p className="m-0 text-[var(--label-2)]">Tugas pelindungan data dan admin IT diberikan Owner kepada Owner atau Admin Pusat.</p>
        <ul className="m-0 grid list-none gap-0 overflow-hidden rounded-[var(--radius-group)] bg-[var(--surface)] p-0">
          {admins.map((s) => (
            <li key={s.staffId} className="grid gap-2 border-b border-[var(--separator)] px-4 py-3 last:border-b-0 [border-bottom-width:0.5px]">
              <span className="font-semibold [overflow-wrap:anywhere]">{s.name}</span>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(DUTY_LABEL) as Duty[]).map((duty) => {
                  const assigned = p.duties.some((d) => d.staffId === s.staffId && d.duty === duty);
                  return p.isOwner ? (
                    <DutyToggle key={duty} staffId={s.staffId} duty={duty} assigned={assigned} label={DUTY_LABEL[duty]} ctx={p.ctx} />
                  ) : (
                    <span key={duty} className="text-[0.88rem] text-[var(--label-2)]">{DUTY_LABEL[duty]}: {assigned ? "ya" : "tidak"}</span>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="log-judul" className="grid gap-3">
        <h2 id="log-judul" className="m-0 text-[1.18rem] font-semibold">Log perubahan akses</h2>
        {p.log.length === 0 ? (
          <p role="status" className="m-0 rounded-[var(--radius-group)] bg-[var(--surface)] p-4 text-[var(--label-2)]">Belum ada perubahan akses.</p>
        ) : (
          <ol className="m-0 grid list-none gap-0 overflow-hidden rounded-[var(--radius-group)] bg-[var(--surface)] p-0">
            {p.log.map((l, i) => (
              <li key={i} className="grid gap-0.5 border-b border-[var(--separator)] px-4 py-3 last:border-b-0 [border-bottom-width:0.5px]">
                <span className="font-semibold">{l.label}</span>
                <span className="text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]">
                  {fmt.format(l.at)} · oleh {l.staffId ? (name.get(l.staffId) ?? "staf") : "sistem"}
                  {l.actingRole ? ` sebagai ${ROLE_LABEL[l.actingRole as keyof typeof ROLE_LABEL] ?? l.actingRole}` : ""}
                  {l.targetStaffId && name.get(l.targetStaffId) ? ` · ${name.get(l.targetStaffId)}` : ""}
                  {l.role ? ` · ${ROLE_LABEL[l.role as keyof typeof ROLE_LABEL] ?? l.role}` : ""}
                  {l.branchId ? ` · ${branchName.get(l.branchId) ?? "cabang"}` : ""}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="matriks-judul" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
        <h2 id="matriks-judul" className="m-0 text-[1.18rem] font-semibold">Matriks hak akses</h2>
        <p className="m-0 text-[var(--label-2)]">Hanya baca. ● penuh · ◐ terbatas · – tidak ada.</p>
        <div tabIndex={0} role="region" aria-label="Matriks hak akses per peran" className="relative w-full max-w-full min-w-0 overflow-x-auto rounded-[var(--radius-group)] bg-[var(--surface)] focus-visible:outline focus-visible:outline-3 focus-visible:outline-[var(--tint)]">
          <table className="border-collapse text-left text-[0.88rem]">
            <caption className="sr-only">Hak akses per peran</caption>
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 min-w-56 bg-[var(--surface)] px-3 py-2">Kemampuan</th>
                {m.roles.map((r) => (
                  <th key={r} scope="col" className="px-2 py-2 font-semibold whitespace-nowrap">{ROLE_LABEL[r]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.capabilities.map((c) => (
                <tr key={c} className="border-t border-[var(--separator)] [border-top-width:0.5px]">
                  <th scope="row" className="sticky left-0 bg-[var(--surface)] px-3 py-2 font-normal">{CAPABILITY_LABEL[c] ?? c}</th>
                  {m.roles.map((r) => {
                    const v = m.cells[c][r];
                    return (
                      <td key={r} className="px-2 py-2 text-center">
                        <span aria-hidden="true">{v ? CELL[v] : "–"}</span>
                        <span className="sr-only">{v ? CELL_WORD[v] : "tidak ada"}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function AccessPage() {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <PageTitle title="Pengguna & Akses" />
      <Suspense fallback={<LoadingList rows={4} />}>
        <Body />
      </Suspense>
    </main>
  );
}
