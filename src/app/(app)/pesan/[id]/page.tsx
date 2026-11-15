// Pesan › one conversation (UX-17 thread + side panel; PR-28; T-090): messages with their delivery state, the composer limited to approved
// templates outside the 24 h window ("Jendela 24 jam habis — pilih template"), marketing templates disabled without the patient's consent,
// Ambil / Lepas / Arahkan / Tandai Selesai; the side panel shows the matched patient (name, MRN, next appointment, marketing consent) and no
// clinical content (W-05, W-10).
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage, PageTitle } from "../../../../components/templates/templates";
import { LoadingList, SuccessNotice } from "../../../../components/ui/states";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { loadThread } from "../data";
import { Composer, ConversationActions, TakeForm } from "../forms";
import { DONE, phone, STATUS, when, windowLeft } from "../labels";

export const metadata: Metadata = { title: "Percakapan — Clinic Dashboard" };
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
const panel = "grid min-w-0 gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-4";

async function Body({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const done = typeof sp.ok === "string" ? DONE[sp.ok] : undefined;
  const d = await loadThread(id);
  if (d.kind === "redirect") redirect(d.to);
  if (d.kind === "not-found") notFound();
  if (d.kind === "forbidden") return <ListPage as="section" title="Percakapan" state={{ kind: "permission", object: "percakapan WhatsApp" }} />;
  const t = d.t;
  const c = t.conversation;
  const title = t.patient?.full_name ?? c.contact_name ?? phone(c.contact_wa_id);
  const left = windowLeft(c.window_expires_at, t.now);
  const branches = d.allowed === "*" || d.role === "central_cs" ? d.branches : d.branches.filter((b) => (d.allowed as readonly string[]).includes(b.id));
  const marketingBlocked = !!t.patient && !t.patient.marketing_consent;
  return (
    <section className="grid min-w-0 gap-4">
      <Link href="/pesan" className="inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]">Kembali ke Pesan</Link>
      <PageTitle title={title} />
      {done && <SuccessNotice message={done} />}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 min-[1100px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 content-start gap-4">
          <section aria-label="Isi percakapan" className={panel}>
            {t.messages.length === 0 && <p className={muted}>Belum ada pesan.</p>}
            <ol className="m-0 grid min-w-0 list-none gap-2 p-0">
              {t.messages.map((m) => (
                <li key={m.id} className={`grid min-w-0 max-w-[85%] gap-1 rounded-[var(--radius-field)] px-3 py-2 ${m.direction === "in"
                  ? "justify-self-start bg-[var(--surface-2)]" : "justify-self-end bg-[var(--tint-soft)]"}`}>
                  <p className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {m.kind === "template" ? `Template ${m.template_name ?? ""}` : m.kind === "media" ? `Lampiran ${m.media_mime_type ?? ""}${m.body ? ` — ${m.body}` : ""}` : (m.body ?? "Pesan tidak dapat dibuka.")}
                  </p>
                  <p className={muted}>
                    {[when(m.at), m.direction === "out" ? (m.sent_via === "business_app" ? "Dari aplikasi WhatsApp Business" : m.author_name) : null].filter(Boolean).join(" · ")}
                    {m.direction === "out" && <> {" "}<StatusBadge tone={(STATUS[m.status] ?? STATUS.sent)[1]}>{(STATUS[m.status] ?? STATUS.sent)[0]}</StatusBadge></>}
                  </p>
                </li>
              ))}
            </ol>
          </section>
          {t.can_write && c.sending && (
            <Composer ctx={d.ctx} conversation={c.id} windowOpen={c.window_open} windowText={left}
              templates={t.templates} marketingBlocked={marketingBlocked} shortcuts={[
                { label: "Sapaan", text: `Halo${t.patient ? ` ${t.patient.full_name}` : ""}, terima kasih telah menghubungi kami. Ada yang bisa kami bantu?` },
                { label: "Link Booking", text: "Silakan pilih jadwal kunjungan melalui halaman booking klinik kami. Kami siap membantu bila ada pertanyaan." },
                { label: "Daftar Harga Resmi", text: "Daftar harga resmi kami dapat dilihat di halaman perawatan klinik. Harga final dikonfirmasi saat konsultasi." },
              ]} />
          )}
          {t.can_write && !c.sending && <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--warning-soft)] px-3 py-2">Nomor WhatsApp ini sedang tidak dapat mengirim. Lihat Pesan › Nomor.</p>}
          {!t.can_write && <p className={muted}>Mode baca: Owner melihat percakapan tanpa membalas.</p>}
        </div>
        <aside aria-label="Panel samping" className="grid min-w-0 content-start gap-4">
          <section className={panel}>
            <h2 className="m-0 text-[1.1rem] font-semibold">Kontak</h2>
            <p className="m-0 [overflow-wrap:anywhere]">{phone(c.contact_wa_id)}</p>
            {t.patient ? (
              <>
                <p className="m-0 font-semibold [overflow-wrap:anywhere]">{t.patient.full_name}</p>
                <p className={muted}>{`No. RM ${t.patient.mrn}`}</p>
                <p className={muted}>{t.patient.next_appointment_at ? `Janji berikutnya ${when(t.patient.next_appointment_at)}` : "Tidak ada janji mendatang."}</p>
                <p className={muted}>{t.patient.marketing_consent ? "Setuju menerima promosi." : "Pasien tidak setuju promosi."}</p>
                <Link href={`/pasien/${t.patient.id}`} className="inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--tint)]">Buka Pasien</Link>
              </>
            ) : <p className={muted}>Belum dicocokkan dengan pasien.</p>}
          </section>
          {t.can_write && (
            <section className={panel}>
              <h2 className="m-0 text-[1.1rem] font-semibold">Penanganan</h2>
              <p className={muted}>{c.assignee_staff_id ? (c.assignee_staff_id === d.staffId ? "Ditangani Anda." : "Ditangani staf lain.") : "Belum ditugaskan."}</p>
              {!c.assignee_staff_id && d.staffId && (c.branch_id !== null || d.role === "central_cs") && <TakeForm ctx={d.ctx} conversation={c.id} me={d.staffId} />}
              <ConversationActions ctx={d.ctx} conversation={c.id} assigned={!!c.assignee_staff_id} state={c.state}
                branchOptions={branches} unrouted={c.branch_id === null} />
            </section>
          )}
        </aside>
      </div>
    </section>
  );
}

export default function ConversationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<LoadingList rows={4} label="Memuat percakapan" />}>
        <Body params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
