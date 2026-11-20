// SATUSEHAT (UX-23, 17:62 / :174, 19:222, 07:63; T-102 increment 3): per branch, the queue and the resources sent, confirmed or rejected
// (codes only), the identity queue, the reporting room, the practitioner IHS numbers (entered by hand or found once by NIK — TD-31,
// increment 4), the ICD-9 CM map and the branch
// credentials (the secret is never shown). The database projects per role: owner, manager, facility head, records officer see the monitor;
// Admin Pusat sees counts and credentials; a doctor sees only his own signed visits. A rejected item opens the record for the facility head
// only (the clinical role here). States: loading, empty, error, success (?ok=), blocked ("Kredensial cabang belum aktif"), permission.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListPage } from "../../../components/templates/templates";
import { LoadingList } from "../../../components/ui/states";
import { StatusBadge, type StatusTone } from "../../../components/ui/status-badge";
import { loadSatusehat, type SatusehatData } from "./data";
import { CodeMapForm, CredentialForm, IdentityForm, LookupForm, PractitionerForm, ResendForm, RevokeForm, RoomForm } from "./forms";
import { type LookupState, NikLookupStatus } from "./nik-lookup";
import { counter, LINK, OUTBOX, reason, resendable, shortId, TYPE, when } from "./labels";

export const metadata: Metadata = { title: "SATUSEHAT — Clinic Dashboard" };
const TITLE = "SATUSEHAT";
const panel = "grid min-w-0 gap-3 rounded-[var(--radius-group)] bg-[var(--surface)] p-4";
const card = "grid min-w-0 gap-2 rounded-[var(--radius-field)] bg-[var(--bg-grouped)] p-3";
const h2 = "m-0 text-[1.25rem] font-semibold";
const muted = "m-0 text-[0.88rem] text-[var(--label-2)] [overflow-wrap:anywhere]";
const link = "inline-flex min-h-[var(--target)] items-center self-start font-semibold text-[var(--tint)]";
type SP = Record<string, string | string[] | undefined>;
const DONE: Record<string, string> = {
  "dikirim-ulang": "Item dimasukkan lagi ke antrean.", identitas: "Identitas pasien disimpan.", "tidak-terselesaikan": "Identitas ditandai tidak dapat diselesaikan.",
  ruang: "Ruang periksa disimpan.", nakes: "Nomor IHS tenaga kesehatan disimpan.", peta: "Kode ICD-9 CM disimpan.", kredensial: "Kredensial cabang disimpan.",
  dicabut: "Kredensial cabang dicabut.", "cari-nakes": "Pencarian nomor IHS lewat NIK dikirim. NIK tidak disimpan setelah pencarian selesai.",
};
const TONE: Record<string, StatusTone> = { confirmed: "success", queued: "neutral", sending: "warning", outcome_unknown: "warning", held: "locked",
  failed: "danger", exception: "danger", withdrawal_pending: "blocked" };

// held for a reason fixed in a section below (the room or the identity): that fix re-queues the visit itself, so Kirim Ulang is not offered
const FIXED_BELOW: Record<string, [string, string]> = { // [for the roles that fix it here, for the others]
  no_room: ["Pilih ruang periksa di bagian Ruang Periksa Belum Dipilih.", "Ruang periksa dipilih oleh petugas rekam medis atau penanggung jawab klinik."],
  identity_review: ["Tinjau identitas pasien di bagian Identitas Perlu Ditinjau.", "Identitas pasien ditinjau oleh petugas rekam medis atau penanggung jawab klinik."],
};
const title = (type: string, visit: string) => (type === "Encounter" ? `Kunjungan …${shortId(visit)}` : `${TYPE[type] ?? type} · kunjungan …${shortId(visit)}`);

// The latest NIK lookup of a staff member (TD-31): a leased row shows as pending; the status never carries the NIK or an IHS id.
function lookupOf(d: SatusehatData, staff: string) {
  const r = d.lookups?.find((x) => x.staff_id === staff);
  return r ? { state: (r.state === "leased" ? "pending" : r.state) as LookupState, requestedAt: r.requested_at } : null;
}

function Counts({ d }: { d: SatusehatData }) {
  const c = d.page.counts;
  if (!c) return null;
  const rows = [...Object.entries(c.outbox).map(([k, n]) => ({ k: `Kunjungan: ${counter(k, OUTBOX)}`, n })),
    ...Object.entries(c.links).map(([k, n]) => ({ k: `Data: ${counter(k, LINK)}`, n }))];
  return (
    <section aria-labelledby="ringkasan" className={panel}>
      <h2 id="ringkasan" className={h2}>Ringkasan</h2>
      {rows.length === 0 ? <p className="m-0">Belum ada data yang dikirim dari cabang ini.</p> : (
        <dl className="m-0 grid min-w-0 gap-2 min-[700px]:grid-cols-2">
          {rows.map((r) => (
            <div key={r.k} className="flex min-w-0 items-center justify-between gap-3 rounded-[var(--radius-field)] bg-[var(--bg-grouped)] px-3 py-2">
              <dt className="min-w-0 [overflow-wrap:anywhere]">{r.k}</dt><dd className="m-0 font-semibold tabular-nums">{r.n}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

async function Content({ sp }: { sp: SP }) {
  const r = await loadSatusehat(typeof sp.cabang === "string" ? sp.cabang : undefined);
  if (r.kind === "redirect") redirect(r.to);
  if (r.kind === "forbidden") return <ListPage as="section" title={TITLE} state={{ kind: "permission", object: "SATUSEHAT" }} />;
  if (r.kind === "empty") return <ListPage as="section" title={TITLE} state={{ kind: "empty", message: "Belum ada cabang." }} />;
  const d = r.d;
  const p = d.page;
  const base = { ctx: d.ctx, cabang: d.branchId };
  const done = typeof sp.ok === "string" && Object.hasOwn(DONE, sp.ok) ? DONE[sp.ok] : undefined;
  const canCredentials = d.credentials !== null;
  const active = d.credentials?.find((c) => c.revoked_at === null && c.environment === p.environment);
  const canResend = ["owner", "manager", "facility_head", "records_officer"].includes(p.role);
  const canResolve = p.role === "facility_head" || p.role === "records_officer";
  const canMap = p.role === "owner" || p.role === "facility_head";
  return (
    <ListPage as="section" title={TITLE} state={{ kind: "rows" }}>
      {done && <p role="status" className="m-0 rounded-[var(--radius-field)] bg-[var(--success-soft)] px-3 py-2 text-[var(--success)]">{done}</p>}
      {d.branches.length > 1 && (
        <nav aria-label="Pilih cabang" className="flex min-w-0 flex-wrap gap-2">
          {d.branches.map((b) => (
            <Link key={b.id} href={`/satusehat?cabang=${b.id}`} aria-current={b.id === d.branchId ? "page" : undefined}
              className={`inline-flex min-h-[var(--target)] items-center rounded-full px-4 font-semibold ${b.id === d.branchId ? "bg-[var(--tint)] text-white" : "bg-[var(--surface)] text-[var(--tint)]"}`}>{b.name}</Link>
          ))}
        </nav>
      )}
      <p className={muted}>{`Lingkungan: ${p.environment === "production" ? "produksi" : "sandbox"}. Koneksi ke SATUSEHAT belum diuji; pengiriman memakai adapter uji.`}</p>
      {!p.credential_active && (
        <div id="belum-aktif" role="status" className="grid min-w-0 gap-1 rounded-[var(--radius-field)] bg-[var(--warning-soft)] p-3 text-[var(--warning)]">
          <p className="m-0 font-semibold">Kredensial cabang belum aktif.</p>
          <p className="m-0 [overflow-wrap:anywhere]">{canCredentials ? "Isi kredensial di bawah. Data yang sudah ditandatangani ditahan; setelah kredensial disimpan, pilih Kirim Ulang pada kunjungan yang ditahan."
            : "Data yang sudah ditandatangani ditahan. Minta Owner atau Admin Pusat mengisi kredensial cabang, lalu pilih Kirim Ulang pada kunjungan yang ditahan."}</p>
        </div>
      )}

      {p.role !== "doctor" && <Counts d={d} />}

      {p.mine && (
        <section aria-labelledby="milik-saya" className={panel}>
          <h2 id="milik-saya" className={h2}>Kunjungan Saya</h2>
          {p.mine.length === 0 ? <p className="m-0">Belum ada rekam medis Anda yang ditandatangani di cabang ini.</p> : (
            <ul className="m-0 grid list-none gap-2 p-0" aria-label="Kunjungan saya">
              {p.mine.map((m) => (
                <li key={m.visit_id} className={card}>
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <Link href={`/pasien/${m.patient_id}`} className="inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--tint)] [overflow-wrap:anywhere]">{`${m.patient_name} · ${when(m.signed_at)}`}</Link>
                    <span className={muted}>{m.state ? counter(m.state, OUTBOX) : "Belum masuk antrean"}</span>
                  </div>
                  {m.links.length > 0 && (
                    <ul className="m-0 flex min-w-0 list-none flex-wrap gap-2 p-0" aria-label="Data terkirim">
                      {m.links.map((l, i) => <li key={`${l.type}${i}`}><StatusBadge tone={TONE[l.status] ?? "neutral"}>{`${TYPE[l.type] ?? l.type}: ${LINK[l.status] ?? l.status}${l.error_code ? ` (kode ${l.error_code})` : ""}`}</StatusBadge></li>)}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {p.exceptions && (
        <section aria-labelledby="perlu-ditangani" className={panel}>
          <h2 id="perlu-ditangani" className={h2}>Perlu Ditangani</h2>
          {p.exceptions.length === 0 ? <p className="m-0">Tidak ada data yang ditolak atau ditahan.</p> : (
            <ul className="m-0 grid list-none gap-2 p-0" aria-label="Data yang perlu ditangani">
              {p.exceptions.map((e) => (
                <li key={`${e.visit_id}${e.type}${e.attempt_id ?? e.at}`} className={card}>
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold [overflow-wrap:anywhere]">{title(e.type, e.visit_id)}</span>
                    <StatusBadge tone={TONE[e.status] ?? "neutral"}>{LINK[e.status] ?? e.status}</StatusBadge>
                  </div>
                  <p className={muted}>{[reason(e.reason), e.error_code && `kode ${e.error_code}`, e.error_path && `bagian ${e.error_path}`, when(e.at)].filter(Boolean).join(" · ")}</p>
                  {e.patient_id && (
                    <div className="flex min-w-0 flex-wrap gap-x-4">
                      <Link href={`/pasien/${e.patient_id}`} className={link}>Buka Rekam Medis</Link>
                      {e.attempt_id && e.error_code && <Link href={`/satusehat/galat/${e.attempt_id}`} className={link}>Lihat Jawaban SATUSEHAT</Link>}
                    </div>
                  )}
                  {canResend && resendable(e.status, e.reason) && <ResendForm {...base} visit={e.visit_id} label={title(e.type, e.visit_id)} />}
                  {e.status === "exception" && !resendable(e.status, e.reason) && (
                    <p className={muted}>Tidak bisa dikirim ulang dari sini. Periksa data ini di portal SATUSEHAT bersama penanggung jawab klinik.</p>
                  )}
                  {e.status === "withdrawal_pending" && <p className={muted}>Data sumber sudah dihapus. Tarik data ini secara manual di portal SATUSEHAT.</p>}
                </li>
              ))}
            </ul>
          )}
          {p.held_items && p.held_items.length > 0 && (
            <>
              <h3 className="m-0 text-base font-semibold">Kunjungan Ditahan</h3>
              <ul className="m-0 grid list-none gap-2 p-0" aria-label="Kunjungan ditahan">
                {p.held_items.map((h) => (
                  <li key={h.visit_id} className={card}>
                    <span className="font-semibold [overflow-wrap:anywhere]">{`Kunjungan …${shortId(h.visit_id)} · ${reason(h.reason)}`}</span>
                    <p className={muted}>{`Sejak ${when(h.since)}`}</p>
                    {Object.hasOwn(FIXED_BELOW, h.reason) ? <p className={muted}>{FIXED_BELOW[h.reason][canResolve ? 0 : 1]}</p>
                      : canResend && <ResendForm {...base} visit={h.visit_id} label={`kunjungan …${shortId(h.visit_id)}`} />}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {p.identity_queue && (
        <section aria-labelledby="identitas" className={panel}>
          <h2 id="identitas" className={h2}>Identitas Perlu Ditinjau</h2>
          <p className={muted}>{`Pasien tetap dilayani. Datanya dikirim setelah nomor IHS ditemukan.${canResolve ? "" : " Peninjauan dilakukan petugas rekam medis atau penanggung jawab klinik."}`}</p>
          {p.identity_queue.length === 0 ? <p className="m-0">Tidak ada identitas yang perlu ditinjau.</p> : (
            <ul className="m-0 grid list-none gap-2 p-0" aria-label="Identitas perlu ditinjau">
              {p.identity_queue.map((i) => (
                <li key={i.patient_id} className={card}>
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold [overflow-wrap:anywhere]">{`${i.name} · ${i.mrn}`}</span>
                    <StatusBadge tone={i.state === "unresolvable" ? "blocked" : "warning"}>{i.state === "unresolvable" ? "Tidak dapat diselesaikan" : "Perlu ditinjau"}</StatusBadge>
                  </div>
                  {i.reason && <p className={muted}>{reason(i.reason)}</p>}
                  {canResolve && (
                    <details className="min-w-0">
                      <summary className={`${link} cursor-pointer`}>Tinjau</summary>
                      <IdentityForm {...base} patient={i.patient_id} name={i.name} />
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {p.no_room && p.no_room.length > 0 && (
        <section aria-labelledby="ruang" className={panel}>
          <h2 id="ruang" className={h2}>Ruang Periksa Belum Dipilih</h2>
          <ul className="m-0 grid list-none gap-2 p-0" aria-label="Kunjungan tanpa ruang">
            {p.no_room.map((v) => (
              <li key={v.visit_id} className={card}>
                <span className="font-semibold">{`Kunjungan …${shortId(v.visit_id)} · ${when(v.signed_at)}`}</span>
                {(p.rooms?.length ?? 0) > 0 ? <RoomForm {...base} visit={v.visit_id} rooms={p.rooms ?? []} /> : <p className={muted}>Cabang ini belum punya ruang aktif.</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {p.practitioners && (
        <section aria-labelledby="nakes" className={panel}>
          <h2 id="nakes" className={h2}>Nomor IHS Tenaga Kesehatan</h2>
          <p className={muted}>Isi nomor IHS dari portal SATUSEHAT, atau cari sekali lewat NIK tenaga kesehatan. NIK hanya dipakai untuk satu pencarian (paling lama 15 menit), lalu dihapus.</p>
          {p.practitioners.length === 0 ? <p className="m-0">Belum ada tenaga kesehatan di cabang ini.</p> : (
            <ul className="m-0 grid list-none gap-2 p-0" aria-label="Tenaga kesehatan">
              {p.practitioners.map((s) => (
                <li key={s.staff_id} className={card}>
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold [overflow-wrap:anywhere]">{s.name}</span>
                    <StatusBadge tone={s.ihs ? "success" : "warning"}>{s.ihs ? `IHS ${s.ihs}` : "Belum diisi"}</StatusBadge>
                  </div>
                  <NikLookupStatus status={lookupOf(d, s.staff_id)} />
                  <details className="min-w-0" open={!s.ihs}>
                    <summary className={`${link} cursor-pointer`}>{s.ihs ? "Ganti nomor" : "Isi nomor"}</summary>
                    <PractitionerForm {...base} staff={s.staff_id} name={s.name} ihs={s.ihs} />
                  </details>
                  {d.page.credential_active && (
                    <details className="min-w-0">
                      <summary className={`${link} cursor-pointer`}>Cari lewat NIK</summary>
                      <LookupForm {...base} staff={s.staff_id} name={s.name} />
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {p.services && (
        <section aria-labelledby="kode" className={panel}>
          <h2 id="kode" className={h2}>Kode Tindakan ICD-9 CM</h2>
          <p className={muted}>{`Kode berlaku untuk kunjungan berikutnya. Data yang sudah terkirim tidak dikirim ulang.${canMap ? "" : " Kode diisi Owner atau penanggung jawab klinik."}`}</p>
          {p.services.length === 0 ? <p className="m-0">Belum ada layanan di katalog.</p> : (
            <ul className="m-0 grid list-none gap-2 p-0" aria-label="Layanan">
              {p.services.map((s) => (
                <li key={s.item_id} className={card}>
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold [overflow-wrap:anywhere]">{s.name ? `${s.name} · ${s.code}` : s.code}</span>
                    <StatusBadge tone={s.map ? (s.map.validated ? "success" : "neutral") : "warning"}>{s.map ? (s.map.validated ? s.map.code : `${s.map.code} · belum divalidasi`) : "Belum dipetakan"}</StatusBadge>
                  </div>
                  {canMap && (
                    <details className="min-w-0">
                      <summary className={`${link} cursor-pointer`}>{s.map ? "Ubah kode" : "Isi kode"}</summary>
                      <CodeMapForm {...base} item={s.item_id} name={s.name ?? s.code} map={s.map} />
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {canCredentials && (
        <section aria-labelledby="kredensial" className={panel}>
          <h2 id="kredensial" className={h2}>Kredensial Cabang</h2>
          {active ? (
            <div className={card}>
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <span className="font-semibold [overflow-wrap:anywhere]">{`Organisasi ${active.organization_id}`}</span>
                <StatusBadge tone="success">{`Aktif · versi ${active.generation}`}</StatusBadge>
              </div>
              <p className={muted}>{`Client ID ${active.client_id} · disimpan ${when(active.created_at)}. Client secret tidak ditampilkan.`}</p>
              <details className="min-w-0"><summary className={`${link} cursor-pointer`}>Cabut kredensial</summary><RevokeForm {...base} credential={active.id} /></details>
            </div>
          ) : <p className="m-0">Belum ada kredensial aktif untuk cabang ini.</p>}
          <details className="min-w-0" open={!active}>
            <summary className={`${link} cursor-pointer`}>{active ? "Ganti kredensial" : "Isi kredensial"}</summary>
            <CredentialForm {...base} environment={p.environment} />
          </details>
        </section>
      )}
    </ListPage>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  return (
    <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Suspense fallback={<ListPage as="section" title={TITLE} state={{ kind: "loading" }}><LoadingList /></ListPage>}>
        <Content sp={sp} />
      </Suspense>
    </main>
  );
}
