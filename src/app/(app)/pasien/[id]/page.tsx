// Profil Pasien (UX-29, PR-49, T-040; 19:76): inset grouped sections for the acting role. Identity,
// guardians and consents for every identity reader; clinical sections (Rekam Medis, Foto & Dokumen,
// Resep) for clinical roles only, never for the cashier or other non-clinical roles (scenario PR-49).
// The identity number is never shown (no masked column yet, DEC-056); sections owned by later tasks say
// so instead of looking empty. Salinan Rekam Medis arrives with signed records (the signing task).
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { DetailPage, PageTitle } from "../../../../components/templates/templates";
import { LoadingList, PermissionState } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import type { SectionId } from "../../../../modules/patients/profile";
import { loadPatientProfile } from "./data";
import { GrantConsent, WithdrawConsent } from "./forms";
import { CHANNEL, EDUCATION, IDENTITY, MARITAL, PURPOSE, RELATION, RELIGION, SEX } from "./labels";

export const metadata: Metadata = { title: "Profil Pasien — Clinic Dashboard" };
const muted = "m-0 text-[0.88rem] text-[var(--label-2)]";
const day = (d: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${d.slice(0, 10)}T00:00:00Z`));
const at = (d: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(d));

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="@container m-0 grid min-w-0 grid-cols-1 gap-x-4 gap-y-1 @[30rem]:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] @[30rem]:gap-y-2">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-[var(--label-2)]">{k}</dt>
          <dd className="m-0 min-w-0 [overflow-wrap:anywhere]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
const Later = ({ text }: { text: string }) => <p className={muted}>{text}</p>;

async function Body({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await loadPatientProfile(id);
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "forbidden") {
    return (
      <main className="mx-auto grid w-full max-w-[1100px] min-w-0 gap-5">
        <PageTitle title="Profil Pasien" />
        <PermissionState object="profil pasien" />
      </main>
    );
  }
  if (d.kind === "not-found") notFound();
  const { patient: p, consents, sections, canRecordConsent } = d.profile;
  const active = consents.filter((c) => c.withdrawnAt === null).map((c) => c.purpose);
  const content: Record<SectionId, { label: string; node: React.ReactNode }> = {
    ringkasan: {
      label: "Ringkasan",
      node: (
        <Facts rows={[
          ["No. RM", p.mrn], ["Tanggal lahir", `${day(p.birthDate)} (${d.age} tahun)`], ["Jenis kelamin", SEX[p.sex] ?? p.sex],
          ["Identitas", p.identityType === "newborn_via_guardian" ? "Belum punya nomor identitas (lewat wali)" : `${IDENTITY[p.identityType] ?? p.identityType} · nomor tersimpan terenkripsi`],
          ["No. HP", p.phone ?? "—"], ["Alamat", p.address ?? "—"], ["Agama", RELIGION[p.religion] ?? p.religion], ["Pekerjaan", p.occupation],
          ["Pendidikan", EDUCATION[p.education] ?? p.education], ["Status perkawinan", MARITAL[p.maritalStatus] ?? p.maritalStatus],
          ["Cabang pendaftaran", d.branchName], ["Terdaftar", at(p.createdAt)],
        ]} />
      ),
    },
    wali: {
      label: "Wali",
      node: p.guardians.length === 0
        ? <p className={muted}>Tidak ada wali tercatat.</p>
        : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {p.guardians.map((g, i) => (
              <li key={i} className="grid gap-0.5">
                <span className="font-semibold [overflow-wrap:anywhere]">{g.name}</span>
                <span className={muted}>{RELATION[g.relation] ?? g.relation}{g.phone ? ` · ${g.phone}` : ""}</span>
              </li>
            ))}
          </ul>
        ),
    },
    persetujuan: {
      label: "Persetujuan",
      node: (
        <div className="grid min-w-0 gap-4">
          {consents.length === 0 ? <p className={muted}>Belum ada persetujuan tercatat.</p> : (
            <ul className="m-0 grid list-none gap-0 p-0">
              {consents.map((c) => (
                <li key={c.id} className="grid min-w-0 gap-1 border-b border-[var(--separator)] py-3 first:pt-0 last:border-b-0 last:pb-0 [border-bottom-width:0.5px]">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-semibold">{PURPOSE[c.purpose] ?? c.purpose}</span>
                    {c.withdrawnAt === null ? <StatusBadge tone="success">Aktif</StatusBadge> : <StatusBadge tone="neutral">Ditarik</StatusBadge>}
                  </div>
                  <span className={muted}>
                    Disetujui {at(c.grantedAt)} · {CHANNEL[c.grantChannel] ?? c.grantChannel} · teks versi {c.textVersion}
                    {c.withdrawnAt ? ` · ditarik ${at(c.withdrawnAt)} (${CHANNEL[c.withdrawChannel ?? ""] ?? c.withdrawChannel})` : ""}
                  </span>
                  {canRecordConsent && c.withdrawnAt === null && c.purpose !== "care_notice" && (
                    <WithdrawConsent ctx={d.ctx} patient={p.id} consent={c.id} label={PURPOSE[c.purpose] ?? c.purpose} />
                  )}
                </li>
              ))}
            </ul>
          )}
          {canRecordConsent && <GrantConsent ctx={d.ctx} patient={p.id} texts={d.texts} active={active} />}
          <p className={muted}>Persetujuan tindakan dicatat di Persetujuan Tindakan saat kunjungan.</p>
        </div>
      ),
    },
    kunjungan: { label: "Kunjungan", node: <Later text="Riwayat kunjungan tampil di sini setelah fitur check-in aktif." /> },
    "paket-saldo": { label: "Paket & Saldo", node: <Later text="Paket, saldo dan piutang tampil di sini setelah modul kasir aktif." /> },
    "rekam-medis": { label: "Rekam Medis", node: <Later text="Rekam medis tampil di sini setelah pemeriksaan pertama ditandatangani." /> },
    foto: { label: "Foto & Dokumen", node: <Later text="Foto klinis tampil di sini setelah fitur intake aktif." /> },
    resep: { label: "Resep", node: <Later text="Resep tampil di sini setelah fitur resep aktif." /> },
  };
  return (
    <DetailPage
      title={p.fullName}
      subtitle={`${p.mrn} · ${d.age} tahun · ${SEX[p.sex] ?? p.sex}`}
      sections={sections.map((s) => ({ id: s, label: content[s].label, content: content[s].node }))}
    />
  );
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto grid w-full max-w-[1100px] gap-5"><PageTitle title="Profil Pasien" /><LoadingList label="Memuat profil pasien" /></main>}>
      <Body params={params} />
    </Suspense>
  );
}
