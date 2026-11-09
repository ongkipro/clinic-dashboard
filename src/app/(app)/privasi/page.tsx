// Privasi & Persetujuan (UX-30 ▸ Privasi, 19:211, PR-92, T-039): segments Persetujuan · Pemroses ·
// Kebocoran. Persetujuan: the consent texts and their versions (Terbitkan Versi Baru), the ledger counts
// and the latest consent events (→ the patient's consents). Pemroses: the processor register. Kebocoran:
// the breach register with the awareness time, the 3×24 h deadline ("Batas 3×24 jam: {sisa waktu}") and
// the notices with their evidence files. The privacy officers only; others get the permission state.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "../../../components/templates/templates";
import { EmptyState, LoadingList, PermissionState } from "../../../components/ui/states";
import { StatusBadge } from "../../../components/ui/status-badge";
import { minutesLeft } from "../../../modules/privacy/privacy";
import { loadPrivasi } from "./data";
import { AddNotice, BreachStep, ProcessorActive, ProcessorForm, PublishText, RecordBreach } from "./forms";
import { at, BREACH_STATE, CHANNEL, PURPOSE, RECIPIENT, ROLE, type Section, SECTIONS, timeLeft } from "./labels";

export const metadata: Metadata = { title: "Privasi & Persetujuan — Clinic Dashboard" };
type Q = { bagian?: string };
const muted = "m-0 text-[0.88rem] text-[var(--label-2)]";
const link = "inline-flex min-h-[var(--target)] items-center rounded-[var(--radius-field)] px-3 text-[var(--primary)] hover:bg-[var(--accent)]";
const card = "@container grid min-w-0 gap-2 rounded-[var(--radius-group)] bg-[var(--surface)] p-4";
const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto grid w-full max-w-[1100px] min-w-0 grid-cols-[minmax(0,1fr)] gap-5">{children}</main>;
}
function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="m-0 text-[1.18rem] font-semibold">{children}</h2>;
}

async function Body({ searchParams }: { searchParams: Promise<Q> }) {
  const q = await searchParams;
  const p = await loadPrivasi();
  if (p.kind === "redirect") redirect(p.to);
  if (p.kind === "forbidden") return <Shell><PageTitle title="Privasi & Persetujuan" /><PermissionState object="register privasi" /></Shell>;
  const section: Section = q.bagian === "pemroses" || q.bagian === "kebocoran" ? q.bagian : "persetujuan";
  const { o, ctx } = p;
  const purposes = [...new Set(o.texts.map((t) => t.purpose))];
  return (
    <Shell>
      <PageTitle title="Privasi & Persetujuan" />
      <nav aria-label="Bagian">
        <ul className="m-0 flex min-w-0 list-none flex-wrap gap-1 p-0">
          {(Object.keys(SECTIONS) as Section[]).map((s) => (
            <li key={s}><Link className={link} aria-current={section === s ? "page" : undefined} href={s === "persetujuan" ? "/privasi" : `/privasi?bagian=${s}`}>{SECTIONS[s]}</Link></li>
          ))}
        </ul>
      </nav>

      {section === "persetujuan" && (
        <>
          <section aria-labelledby="teks" className="grid min-w-0 gap-2">
            <H2 id="teks">Teks persetujuan</H2>
            {purposes.length === 0 ? <EmptyState message="Belum ada teks persetujuan yang diterbitkan." /> : (
              <ul className="m-0 grid min-w-0 list-none gap-2 p-0">
                {purposes.map((purpose) => {
                  const versions = o.texts.filter((t) => t.purpose === purpose);
                  const c = o.counts.find((x) => x.purpose === purpose);
                  return (
                    <li key={purpose} className={card}>
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <strong>{PURPOSE[purpose] ?? purpose}</strong>
                        <StatusBadge tone="neutral">{`Versi ${versions[0].version}`}</StatusBadge>
                      </div>
                      <p className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{versions[0].body}</p>
                      <p className={muted}>Berlaku sejak {at(versions[0].effectiveFrom)} · {c ? `${c.active} aktif, ${c.withdrawn} ditarik` : "belum ada persetujuan"}</p>
                      {versions.length > 1 && (
                        <details className="min-w-0">
                          <summary className="inline-flex min-h-[var(--target)] cursor-pointer items-center text-[var(--tint)]">Versi sebelumnya ({versions.length - 1})</summary>
                          <ul className="m-0 grid list-none gap-2 p-0">
                            {versions.slice(1).map((v) => <li key={v.id} className="grid gap-1"><span className={muted}>Versi {v.version} · sejak {at(v.effectiveFrom)}</span><span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{v.body}</span></li>)}
                          </ul>
                        </details>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <PublishText ctx={ctx} />
          </section>
          <section aria-labelledby="ledger" className="grid min-w-0 gap-2">
            <H2 id="ledger">Catatan persetujuan terbaru</H2>
            {o.recent.length === 0 ? <EmptyState message="Belum ada persetujuan tercatat." /> : (
              <ul className="m-0 grid min-w-0 list-none gap-0 rounded-[var(--radius-group)] bg-[var(--surface)] p-0">
                {o.recent.map((e) => (
                  <li key={e.id} className="grid min-w-0 gap-1 border-b border-[var(--separator)] px-4 py-3 last:border-b-0 [border-bottom-width:0.5px]">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Link href={`/pasien/${e.patientId}#persetujuan`} className="inline-flex min-h-[var(--target)] items-center font-semibold text-[var(--label)] underline-offset-2 hover:underline">{e.patientName}</Link>
                      <span className={muted}>{e.patientMrn}</span>
                      {e.state === "active" ? <StatusBadge tone="success">Aktif</StatusBadge> : <StatusBadge tone="neutral">Ditarik</StatusBadge>}
                    </div>
                    <span className={muted}>
                      {PURPOSE[e.purpose] ?? e.purpose} · teks versi {e.textVersion} · disetujui {at(e.grantedAt)} ({CHANNEL[e.grantChannel] ?? e.grantChannel})
                      {e.withdrawnAt ? ` · ditarik ${at(e.withdrawnAt)} (${CHANNEL[e.withdrawChannel ?? ""] ?? e.withdrawChannel})` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {section === "pemroses" && (
        <section aria-labelledby="pemroses" className="grid min-w-0 gap-2">
          <H2 id="pemroses">Register pemroses</H2>
          {o.processors.length === 0 ? <EmptyState message="Belum ada pemroses tercatat." /> : (
            <ul className="m-0 grid min-w-0 list-none gap-2 p-0">
              {o.processors.map((x) => (
                <li key={x.id} className={card}>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <strong>{x.name}</strong>
                    <StatusBadge tone={x.active ? "success" : "locked"}>{x.active ? "Aktif" : "Nonaktif"}</StatusBadge>
                    <span className={muted}>{ROLE[x.role]}</span>
                  </div>
                  <p className={muted}>{x.service} · data: {x.dataCategories} · lokasi: {x.location}{x.crossBorder ? ` · lintas negara (${x.transferBasis})` : ""}{x.agreementRef ? ` · perjanjian ${x.agreementRef}` : ""}</p>
                  <details className="min-w-0">
                    <summary className="inline-flex min-h-[var(--target)] cursor-pointer items-center text-[var(--tint)]">Ubah</summary>
                    <ProcessorForm ctx={ctx} p={x} />
                  </details>
                  <ProcessorActive ctx={ctx} id={x.id} active={x.active} label={x.name} />
                </li>
              ))}
            </ul>
          )}
          <h3 className="m-0 text-[1.05rem] font-semibold">Tambah pemroses</h3>
          <div className="@container min-w-0"><ProcessorForm ctx={ctx} /></div>
        </section>
      )}

      {section === "kebocoran" && (
        <section aria-labelledby="kebocoran" className="grid min-w-0 gap-2">
          <H2 id="kebocoran">Register kebocoran</H2>
          {o.breaches.length === 0 ? <EmptyState message="Belum ada kebocoran tercatat." /> : (
            <ul className="m-0 grid min-w-0 list-none gap-3 p-0">
              {o.breaches.map((b) => {
                const left = minutesLeft(b, o.now);
                const pending = b.state === "open" || b.state === "assessed";
                const label = `kebocoran ${at(b.awareAt)}`;
                return (
                  <li key={b.id} className={card}>
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <StatusBadge tone={BREACH_STATE[b.state].tone}>{BREACH_STATE[b.state].label}</StatusBadge>
                      <span className="font-semibold">Diketahui {at(b.awareAt)} WIB</span>
                    </div>
                    <p className={`m-0 font-semibold ${pending && left < 0 ? "text-[var(--danger)]" : ""}`}>
                      Batas 3×24 jam: {pending ? timeLeft(left) : "selesai"} <span className="font-normal text-[var(--label-2)]">(tenggat {at(b.deadlineAt)} WIB)</span>
                    </p>
                    <p className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{b.description}</p>
                    <p className={muted}>Data: {b.dataCategories}{b.affectedCount !== null ? ` · perkiraan terdampak ${b.affectedCount}` : ""}</p>
                    {b.notNotifiableReason && <p className={muted}>Tidak wajib diberitahukan: {b.notNotifiableReason}</p>}
                    <div className="grid min-w-0 gap-1">
                      <h3 className="m-0 text-[1rem] font-semibold">Bukti pemberitahuan ({b.notices.length})</h3>
                      {b.notices.length === 0 ? <p className={muted}>Belum ada pemberitahuan.</p> : (
                        <ul className="m-0 grid min-w-0 list-none gap-2 p-0">
                          {b.notices.map((n) => (
                            <li key={n.id} className="grid min-w-0 gap-0.5">
                              <span className="[overflow-wrap:anywhere]"><strong>{RECIPIENT[n.recipientKind]}</strong> · {n.recipient} · {n.channel} · {at(n.sentAt)} WIB</span>
                              <span className={`${muted} [overflow-wrap:anywhere]`}>{n.contentSummary}</span>
                              <a className="inline-flex min-h-[var(--target)] items-center text-[var(--tint)] [overflow-wrap:anywhere]" href={`/privasi/bukti/${n.id}`}>Unduh {n.fileName} ({kb(n.sizeBytes)})</a>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <BreachStep ctx={ctx} id={b.id} state={b.state} label={label} />
                    {(b.state === "assessed" || b.state === "notified") && (
                      <details className="min-w-0">
                        <summary className="inline-flex min-h-[var(--target)] cursor-pointer items-center text-[var(--tint)]">Tambah Pemberitahuan</summary>
                        <AddNotice ctx={ctx} id={b.id} label={label} />
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <h3 className="m-0 text-[1.05rem] font-semibold">Catat kebocoran baru</h3>
          <div className="@container min-w-0"><RecordBreach ctx={ctx} /></div>
        </section>
      )}
    </Shell>
  );
}

export default function Page({ searchParams }: { searchParams: Promise<Q> }) {
  return (
    <Suspense fallback={<Shell><PageTitle title="Privasi & Persetujuan" /><LoadingList label="Memuat register privasi" /></Shell>}>
      <Body searchParams={searchParams} />
    </Suspense>
  );
}
