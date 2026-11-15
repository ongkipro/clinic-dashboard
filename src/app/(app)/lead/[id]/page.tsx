// One lead (UX-18 detail; PR-29; T-092): the contact (masked per role), the stage with its facts (appointment, visit, the paying invoice), the
// next step with its readiness ("Belum ada pembayaran untuk konversi" before converted, Scenario PR-29), Tandai Hilang, Buka Kembali,
// Penanganan, Hubungi di Pesan / Buka Pasien / Buat Janji, and the timeline. No clinical content.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage, PageTitle } from "../../../../components/templates/templates";
import { LoadingList, SuccessNotice } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { loadLead } from "../data";
import { HandlingForms, MatchForm, StageForms } from "../forms";
import { LOST, NEXT, SOURCE, STAGE, when } from "../labels";

export const metadata: Metadata = { title: "Lead — Clinic Dashboard" };
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
const panel = "grid min-w-0 gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-4";
const DONE: Record<string, string> = {
  created: "Lead disimpan.", contacted: "Lead ditandai dihubungi.", booked: "Lead ditandai booking.", arrived: "Lead ditandai datang.",
  converted: "Lead ditandai bayar.", lost: "Lead ditandai hilang.", new: "Lead dibuka kembali.", assign: "Lead diambil.", unassign: "Lead dilepas.",
  route: "Lead diarahkan ke cabang.", campaign: "Kampanye lead disimpan.", match: "Lead dicocokkan dengan pasien.",
};
const BLOCKER: Record<string, string> = {
  contacted: "Belum ada janji temu untuk pasien ini. Buat janji di Jadwal lebih dulu.",
  booked: "Pasien belum check-in untuk janji ini.",
  arrived: "Belum ada pembayaran untuk konversi.",
};

async function Body({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const q = typeof sp.cari === "string" ? sp.cari.trim() : "";
  const d = await loadLead(id, q);
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "not-found") notFound();
  if (d.kind === "forbidden") return <ListPage as="section" title="Lead" state={{ kind: "permission", object: "lead" }} />;
  const v = d.v;
  const l = v.lead;
  const title = l.patient_name ?? l.contact_name ?? (l.consent_masked ? "Kontak tersembunyi" : "Tanpa nama");
  const ready = l.stage === "new" || (l.stage === "contacted" && !!l.next_appointment_id) || (l.stage === "booked" && !!l.next_visit_id) || (l.stage === "arrived" && !!l.next_invoice_id);
  const done = typeof sp.ok === "string" ? DONE[sp.ok] : undefined;
  const branches = d.branchId ? d.branches.filter((b) => b.id === d.branchId) : d.branches;
  const campaigns = (d.campaigns?.campaigns ?? []).filter((c) => c.active).map((c) => ({ id: c.id, name: c.name }));
  return (
    <section className="grid min-w-0 gap-4">
      <Link href="/lead" className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]">Kembali ke Lead</Link>
      <PageTitle title={title} />
      {done && <SuccessNotice message={done} />}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 min-[1100px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 content-start gap-4">
          <section aria-label="Tahap" className={panel}>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <StatusBadge tone={(STAGE[l.stage] ?? STAGE.new)[1]}>{(STAGE[l.stage] ?? STAGE.new)[0]}</StatusBadge>
              {l.sla_overdue && <StatusBadge tone="danger">{`Lewat ${l.sla_minutes} menit tanpa respons`}</StatusBadge>}
            </div>
            <p className={muted}>{[SOURCE[l.source] ?? l.source, l.campaign_name, l.branch_name ?? "Belum diarahkan ke cabang"].filter(Boolean).join(" · ")}</p>
            <p className={muted}>{l.first_response_at ? `Respons pertama ${when(l.first_response_at)}${l.response_minutes != null ? ` (${l.response_minutes} menit)` : ""}` : "Belum ada respons."}</p>
            {l.stage === "lost" && <p className={muted}>{`Hilang: ${LOST[l.lost_reason ?? ""] ?? "—"}${l.lost_note ? ` — ${l.lost_note}` : ""}`}</p>}
            {v.can_write && <StageForms ctx={d.ctx} lead={l.id} stage={l.stage} next={NEXT[l.stage]} ready={ready}
              blocker={l.stage === "contacted" && !l.patient_id ? "Cocokkan lead dengan pasien lebih dulu (Penanganan › Cocokkan Pasien)." : BLOCKER[l.stage] ?? null} />}
            {!v.can_write && <p className={muted}>Mode baca.</p>}
          </section>
          <section aria-label="Riwayat" className={panel}>
            <h2 className="m-0 text-[1.1rem] font-semibold">Riwayat</h2>
            <ol className="m-0 grid min-w-0 list-none gap-1 p-0">
              {l.events.map((e, i) => (
                <li key={i} className={muted}>{`${when(e.at)} · ${(STAGE[e.to_stage] ?? STAGE.new)[0]}${e.reason ? ` (${LOST[e.reason] ?? e.reason})` : ""}${e.actor_name ? ` · ${e.actor_name}` : ""}`}</li>
              ))}
            </ol>
          </section>
        </div>
        <aside aria-label="Kontak dan penanganan" className="grid min-w-0 content-start gap-4">
          <section className={panel}>
            <h2 className="m-0 text-[1.1rem] font-semibold">Kontak</h2>
            {l.consent_masked && <p className={muted}>Identitas disembunyikan untuk peran ini.</p>}
            {l.contact_phone && <p className="m-0 [overflow-wrap:anywhere]">{l.contact_phone}</p>}
            {l.patient_mrn && <p className={muted}>{`No. RM ${l.patient_mrn}`}</p>}
            {l.conversation_id && <Link href={`/pesan/${l.conversation_id}`} className="inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--tint)]">Hubungi di Pesan</Link>}
            {l.patient_id && !l.consent_masked && v.can_write && <Link href={`/pasien/${l.patient_id}`} className="inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--tint)]">Buka Pasien</Link>}
            {v.can_write && <Link href="/jadwal" className="inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--tint)]">Buat Janji di Jadwal</Link>}
          </section>
          {v.can_write && l.stage !== "converted" && l.stage !== "lost" && (
            <section className={panel}>
              <h2 className="m-0 text-[1.1rem] font-semibold">Penanganan</h2>
              <p className={muted}>{l.assignee_staff_id ? (l.assignee_staff_id === v.me ? "Ditangani Anda." : `Ditangani ${l.assignee_name ?? "staf lain"}.`) : "Belum ditugaskan."}</p>
              <HandlingForms ctx={d.ctx} lead={l.id} me={v.me} assignee={l.assignee_staff_id} branchId={l.branch_id} branches={branches} campaigns={campaigns} campaignId={l.campaign_id} />
              {!l.patient_id && (
                <section aria-label="Cocokkan Pasien" className="grid min-w-0 gap-2">
                  <h3 className="m-0 text-[1rem] font-semibold">Cocokkan Pasien</h3>
                  <form role="search" method="get" action={`/lead/${l.id}`} className="grid min-w-0 gap-2">
                    <label htmlFor="cari-pasien">Cari nama, No. RM atau telepon</label>
                    <input id="cari-pasien" name="cari" type="search" defaultValue={q} minLength={2} maxLength={80}
                      className="min-h-[52px] w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--control-border)] bg-white px-3" />
                    <button type="submit" className="inline-flex min-h-[var(--target)] items-center justify-self-start rounded-full bg-[var(--surface-2)] px-4 font-semibold">Cari</button>
                  </form>
                  {d.search && !d.search.ok && <p role="alert" className="m-0 text-[var(--danger)]">Terlalu banyak pencarian. Coba lagi sebentar lagi.</p>}
                  {d.search?.ok && d.search.rows.length === 0 && <p role="status" className={muted}>Tidak ada pasien yang cocok. Daftarkan pasien di Pasien lebih dulu.</p>}
                  {d.search?.ok && d.search.rows.length > 0 && (
                    <ul aria-label="Hasil pencarian pasien" className="m-0 grid min-w-0 list-none gap-2 p-0">
                      {d.search.rows.slice(0, 8).map((r) => (
                        <li key={r.id} className="grid min-w-0 gap-1">
                          <p className="m-0 font-semibold [overflow-wrap:anywhere]">{r.fullName}</p>
                          <p className={muted}>{[r.mrn, String(r.birthYear), r.maskedPhone, r.registeredBranch].filter(Boolean).join(" · ")}</p>
                          <MatchForm ctx={d.ctx} lead={l.id} patient={r.id} name={r.fullName} />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </section>
          )}
        </aside>
      </div>
    </section>
  );
}

export default function LeadDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} label="Memuat lead" />}>
        <Body params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
