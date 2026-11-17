// Konsol Vendor › Tagihan Server › Klinik (UX-43; T-103 increment 2): fee versions, invoices (proration, VAT, outstanding), AutoLaris
// attempts (state, rc, Advice interpretations — never the provider's text, body or payment instruction), credits, review items and the
// billing requests with their actions. No patient data (PR-60); vendor- and tenant-entered strings are React text only.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { billingDetail } from "../../../../modules/vendor/billing/console";
import { consoleGate, vendorPool } from "../../_lib/server";
import { ConsoleShell, RefusedScreen } from "../../_lib/shell";
import s from "../../_lib/console.module.css";
import { FeeChangeForm, IssueButton, NoteForm, RequestActions, WaiverForm } from "../billing-actions";
import { ADVICE, ATTEMPT, CREDIT, day, INVOICE, period, REMINDER, REQUEST, REQUEST_STATE, REVIEW, rupiah, when } from "../labels";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type SP = Record<string, string | string[] | undefined>;
const HELD = "\\d+ tagihan tertahan: status pajak vendor belum dikonfirmasi\\.";
const ISSUE = new RegExp(`^(\\d+ tagihan diterbitkan\\.( ${HELD})?|${HELD}|Tidak ada tagihan yang jatuh waktu terbit\\.)$`);
const DONE = new Set(["Pengajuan perubahan biaya dikirim.", "Pengajuan pembebasan dikirim.", "Pengajuan disetujui.", "Pengajuan ditolak.", "Pengajuan dibatalkan.",
  "Referensi dukungan dicatat."]);
const nextMonth = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const y = Number(p.year); const m = Number(p.month);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

export default async function TagihanDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID.test(id)) notFound();
  const gate = await consoleGate();
  if (gate.kind === "signed-out") redirect("/vendor/masuk");
  if (gate.kind === "enrol-totp") redirect("/vendor/aktifkan-2fa");
  if (gate.kind === "refused") return <RefusedScreen reason={gate.reason} />;
  const r = await billingDetail(await vendorPool(), gate.caller, id);
  if (!r.ok && r.code === "ERR_NOT_FOUND") notFound();
  if (!r.ok) return <RefusedScreen reason={r.reason ?? "role_not_held"} />;
  const d = r.data;
  const roles = gate.user.roles;
  const finance = roles.includes("vendor_finance");
  const po = roles.includes("platform_owner");
  const done = typeof sp.ok === "string" && (DONE.has(sp.ok) || ISSUE.test(sp.ok)) ? sp.ok : undefined;
  const open = d.invoices.filter((i) => i.state === "issued" && i.outstanding > 0);
  return (
    <ConsoleShell user={gate.user} current="/vendor/tagihan">
      <div className={s.page}>
        <Link prefetch={false} className={`${s.plain} ${s.back}`} href="/vendor/tagihan">‹ Tagihan Server</Link>
        <div className={s.header}><h1 className={s.title}>{d.tenant.name ?? "Belum ada nama badan usaha"}</h1></div>
        {done && <p className={s.notice} role="status">{done}</p>}

        {d.reviews.length > 0 && (
          <section className={s.section} aria-labelledby="tinjauan">
            <h2 id="tinjauan" className={s.sectionTitle}>Perlu Ditinjau</h2>
            <ul className={`${s.cards} ${s.cardsAlways}`}>
              {d.reviews.map((v, k) => (
                <li key={k} className={s.card}><p className={s.cardTitle}>{REVIEW[v.kind] ?? v.kind}</p>
                  <p className={s.boxMuted}>{v.period ? `Periode ${period(v.period)}` : `Sejak ${when(v.created_at)}`}</p></li>
              ))}
            </ul>
          </section>
        )}

        <section className={s.section} aria-labelledby="tagihan">
          <h2 id="tagihan" className={s.sectionTitle}>Tagihan</h2>
          {(finance || po) && (
            <>
              <IssueButton tenantId={d.tenant.id} />
              <p className={s.help}>Menerbitkan tagihan yang sudah jatuh waktu sesuai jadwal (bulan pertama prorata dari tanggal live, lalu tiap tanggal 1). Tidak bisa memundurkan tanggal atau mengubah nominal.</p>
            </>
          )}
          {d.invoices.length === 0 ? <div className={s.box} role="status"><p className={s.boxMuted}>Belum ada tagihan.</p></div> : (
            <ul className={`${s.cards} ${s.cardsAlways}`}>
              {d.invoices.map((i) => {
                const st = INVOICE[i.state] ?? INVOICE.issued;
                return (
                  <li key={i.id} className={s.card}>
                    <div className={s.header}><p className={s.cardTitle}>{`${period(i.period)} · ${i.number}`}</p><span className={`${s.badge} ${st.tone}`}>{st.label}</span></div>
                    <dl className={s.facts}>
                      <div><dt>Terbit / jatuh tempo</dt><dd>{`${day(i.issue_date)} / ${day(i.due_date)}`}</dd></div>
                      <div><dt>Biaya bulanan</dt><dd>{`${rupiah(i.fee_amount)}${i.fee_source === "default" ? " (standar)" : ""}`}</dd></div>
                      {i.kind === "first" && <div><dt>Prorata</dt><dd>{`${i.proration.days} dari ${i.proration.days_in_month} hari`}</dd></div>}
                      <div><dt>Jumlah / PPN / total</dt><dd>{`${rupiah(i.amount)} / ${rupiah(i.vat)} / ${rupiah(i.total)}`}</dd></div>
                      <div><dt>Sisa tagihan</dt><dd>{rupiah(i.outstanding)}</dd></div>
                    </dl>
                    {i.reminders.length > 0 && (
                      <p className={s.boxMuted}>{`Pengingat terkirim: ${i.reminders.map((m) => `${REMINDER[m.kind] ?? m.kind} (${when(m.sent_at)})`).join(", ")}`}</p>
                    )}
                    {i.attempts.length > 0 && (
                      <ul className={s.cardsAlways} aria-label={`Pembayaran ${i.number}`}>
                        {i.attempts.map((a) => (
                          <li key={a.id} className={s.box}>
                            <p className={s.boxText}>{`${a.reff_id} · ${a.channel} · ${rupiah(a.amount)} · ${ATTEMPT[a.state] ?? a.state}${a.rc ? ` · rc ${a.rc}` : ""}`}</p>
                            {a.observations.length > 0 && (
                              <ul className={s.cardsAlways} aria-label="Jawaban Advice">
                                {a.observations.map((o, k) => <li key={k} className={s.boxMuted}>{`${when(o.at)} · ${ADVICE[o.interpreted] ?? o.interpreted}${o.rc ? ` · rc ${o.rc}` : ""}${o.status ? ` · ${o.status}` : ""}`}</li>)}
                              </ul>
                            )}
                            {a.notes.map((n, k) => <p key={k} className={s.boxMuted}>{`Referensi dukungan ${n.evidence_ref} (${when(n.at)}): ${n.reason}`}</p>)}
                            {finance && a.state === "unknown" && <NoteForm attemptId={a.id} />}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className={s.section} aria-labelledby="pengajuan">
          <h2 id="pengajuan" className={s.sectionTitle}>Pengajuan</h2>
          {d.requests.length === 0 ? <div className={s.box} role="status"><p className={s.boxMuted}>Belum ada pengajuan.</p></div> : (
            <ul className={`${s.cards} ${s.cardsAlways}`}>
              {d.requests.map((q) => {
                const st = REQUEST_STATE[q.state] ?? REQUEST_STATE.pending;
                const p = q.payload as { amount_rupiah?: number; effective_month?: string; invoice_id?: string };
                const inv = d.invoices.find((i) => i.id === p.invoice_id);
                return (
                  <li key={q.id} className={s.card}>
                    <div className={s.header}><p className={s.cardTitle}>{REQUEST[q.kind] ?? q.kind}</p><span className={`${s.badge} ${st.tone}`}>{st.label}</span></div>
                    <p className={s.boxText}>{q.kind === "server_fee_change" ? `${rupiah(p.amount_rupiah ?? 0)} mulai ${period(p.effective_month ?? "2000-01")}`
                      : `${rupiah(p.amount_rupiah ?? 0)} untuk ${inv ? inv.number : "tagihan"}`}</p>
                    <p className={s.boxMuted}>{`${q.reason} — oleh ${q.requested_by ?? "—"}, ${when(q.requested_at)}${q.decided_by ? `; diputuskan ${q.decided_by}` : ""}${q.state === "approved" ? (q.consumed ? "; sudah diterapkan" : "; menunggu diterapkan sistem") : ""}`}</p>
                    {q.state === "pending" && <RequestActions requestId={q.id} canDecide={po && !q.mine} canCancel={finance && q.mine} />}
                  </li>
                );
              })}
            </ul>
          )}
          {finance && (
            <>
              <h3 className={s.label}>Ajukan Perubahan Biaya</h3>
              <FeeChangeForm tenantId={d.tenant.id} minMonth={nextMonth()} />
              {open.length > 0 && (
                <>
                  <h3 className={s.label}>Ajukan Pembebasan / Kredit</h3>
                  <WaiverForm tenantId={d.tenant.id} invoices={open.map((i) => ({ id: i.id, label: `${i.number} · sisa ${rupiah(i.outstanding)}`, outstanding: i.outstanding }))} />
                </>
              )}
            </>
          )}
        </section>

        <section className={s.section} aria-labelledby="biaya">
          <h2 id="biaya" className={s.sectionTitle}>Versi Biaya dan Kredit</h2>
          <dl className={s.facts}>
            {d.fee_versions.length === 0 ? <div><dt>Biaya bulanan</dt><dd>Standar Rp1.000.000</dd></div>
              : d.fee_versions.map((f, k) => <div key={k}><dt>{`Mulai ${period(f.effective_month)}`}</dt><dd>{rupiah(f.amount)}</dd></div>)}
            {d.credits.map((c, k) => <div key={`c${k}`}><dt>{CREDIT[c.kind] ?? c.kind}</dt><dd>{`${rupiah(c.amount)} (sisa ${rupiah(c.remaining)})`}</dd></div>)}
          </dl>
        </section>
      </div>
    </ConsoleShell>
  );
}
