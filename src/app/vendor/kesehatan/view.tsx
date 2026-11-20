// Konsol Vendor › Kesehatan Platform view (UX-45, PR-62; T-118). Server component: the projected health in, markup out. Desktop-first
// dense table (UX-40–49 contract) with cards below 700 px; no charts. Counts, ages, timestamps and error codes only — never clinic
// content (PR-60). The four sources without data (uptime, worker heartbeat, backup age, app error rate) read "Belum terpantau" with why
// (Panel 2 D1 = Option A). Tenant names are tenant-controlled: React text only (SEC-21).
import Link from "next/link";
import s from "../_lib/console.module.css";
import {
  type Count, duration, filterHref, type Filter, type Health, NOT_MEASURED_COPY, type Provider, PROVIDER_LABEL, PROVIDERS, type ProviderRow, showCount, showFailed, statusOf,
  type TenantHealth, type Tone, type ViewState, when,
} from "./model";

const TONE: Record<Tone, { cls: string; label: string }> = {
  ok: { cls: s.toneSuccess, label: "Normal" }, warning: { cls: s.toneWarning, label: "Perlu dicek" }, alert: { cls: s.toneDanger, label: "Lewat ambang" },
  none: { cls: s.toneNeutral, label: "Tidak ada data" },
};
const age = (sec: number | null) => (sec === null ? "—" : duration(sec));
const codesText = (p: ProviderRow) => (p.codes.length ? p.codes.map((c) => `${c.code} (${c.count})`).join(", ") : "—");
const rate = (p: Provider, failed: Count, tried: Count) => (failed.kind === "count" && tried.kind === "count" && tried.value > 0 ? `${showCount(failed)} / ${showCount(tried)}` : showFailed(p, failed));

function Badge({ tone }: { tone: Tone }) {
  return <span className={`${s.badge} ${TONE[tone].cls}`}>{TONE[tone].label}</span>;
}

function Summary({ h }: { h: Health }) {
  return (
    <section className={s.section} aria-labelledby="ringkasan">
      <h2 id="ringkasan" className={s.sectionTitle}>Ringkasan</h2>
      <ul className={`${s.cards} ${s.cardsAlways}`} aria-label="Ringkasan kesehatan">
        {h.notMeasured.map((k) => (
          <li key={k} className={s.card} data-metric={k} data-state="not_measured">
            <p className={s.cardTitle}>{NOT_MEASURED_COPY[k].label}</p>
            <p className={s.boxText}><span className={`${s.badge} ${s.toneNeutral}`}>Belum terpantau</span></p>
            <p className={s.boxMuted}>{NOT_MEASURED_COPY[k].why}.</p>
          </li>
        ))}
        <li className={s.card} data-metric="wal_archive" data-state={h.platform.walReadable ? "value" : "not_measured"}>
          <p className={s.cardTitle}>Arsip WAL terakhir</p>
          {h.platform.walReadable ? (
            <>
              <p className={s.boxText}>{when(h.platform.walArchivedAt)}</p>
              {h.platform.walFailedAt && <p className={s.boxMuted}>Gagal terakhir {when(h.platform.walFailedAt)}</p>}
              <p className={s.boxMuted}>Sinyal RPO, bukan umur backup.</p>
            </>
          ) : <p className={s.boxText}><span className={`${s.badge} ${s.toneNeutral}`}>Belum terpantau</span></p>}
        </li>
        <li className={s.card} data-metric="unrouted">
          <p className={s.cardTitle}>Webhook Meta tanpa tujuan (24 jam)</p>
          <p className={s.boxText}>{showCount(h.platform.unrouted)}</p>
        </li>
      </ul>
    </section>
  );
}

function Filters({ f }: { f: Filter }) {
  const items = [{ label: "Semua penyedia", href: filterHref({ ...f, provider: null }), on: f.provider === null },
    ...PROVIDERS.map((p) => ({ label: PROVIDER_LABEL[p], href: filterHref({ ...f, provider: p }), on: f.provider === p }))];
  return (
    <nav aria-label="Saring" className={s.actions}>
      {items.map((i) => <Link key={i.href} prefetch={false} href={i.href} aria-current={i.on ? "page" : undefined} className={s.plain}>{i.label}</Link>)}
      <Link prefetch={false} href={filterHref({ ...f, attention: !f.attention })} aria-current={f.attention ? "page" : undefined} className={s.plain}>
        {f.attention ? "Tampilkan semua klinik" : "Hanya yang perlu dicek"}
      </Link>
    </nav>
  );
}

function Rows({ rows }: { rows: TenantHealth[] }) {
  const lines = rows.flatMap((t) => t.providers.map((p) => ({ t, p, st: statusOf(p) })));
  return (
    <section className={s.section} aria-labelledby="per-klinik">
      <h2 id="per-klinik" className={s.sectionTitle}>Per klinik dan penyedia</h2>
      <div className={s.tableWrap} role="region" aria-label="Kesehatan per klinik dan penyedia" tabIndex={0}>
        <table className={s.table}>
          <caption className="sr-only">Kesehatan per klinik dan penyedia</caption>
          <thead>
            <tr>
              <th scope="col">Klinik</th><th scope="col">Penyedia</th><th scope="col">Status</th><th scope="col" className={`${s.num} whitespace-nowrap [overflow-wrap:normal]!`}>Antre</th>
              <th scope="col" className={`${s.num} whitespace-nowrap [overflow-wrap:normal]!`}>Tertua</th><th scope="col" className={`${s.num} whitespace-nowrap [overflow-wrap:normal]!`}>Gagal 1 jam</th><th scope="col" className={`${s.num} whitespace-nowrap [overflow-wrap:normal]!`}>Gagal 24 jam</th>
              <th scope="col">Kode</th><th scope="col" className="[overflow-wrap:break-word]!">Aktivitas terakhir</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(({ t, p, st }) => (
              <tr key={`${t.id}:${p.provider}`} data-tenant={t.id} data-provider={p.provider} data-tone={st.tone}>
                <th scope="row" className="[overflow-wrap:break-word]!">{t.name ?? "Belum ada nama badan usaha"}</th>
                <td className="[overflow-wrap:break-word]!">{PROVIDER_LABEL[p.provider]}</td>
                <td><Badge tone={st.tone} />{st.reasons.map((r) => <span key={r} className={s.help}> {r}</span>)}</td>
                <td className={`${s.num} whitespace-nowrap [overflow-wrap:normal]!`}>{showCount(p.open)}</td>
                <td className={`${s.num} whitespace-nowrap [overflow-wrap:normal]!`}>{age(p.oldestSeconds)}</td>
                <td className={`${s.num} whitespace-nowrap [overflow-wrap:normal]!`}>{rate(p.provider, p.failed1h, p.attempts1h)}</td>
                <td className={`${s.num} whitespace-nowrap [overflow-wrap:normal]!`}>{showFailed(p.provider, p.failed24h)}</td>
                <td className="[overflow-wrap:break-word]!">{codesText(p)}</td>
                <td className="[overflow-wrap:break-word]!">{when(p.lastActivity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className={s.cards} aria-label="Kesehatan per klinik dan penyedia">
        {lines.map(({ t, p, st }) => (
          <li key={`${t.id}:${p.provider}`} className={s.card}>
            <p className={s.cardTitle}>{t.name ?? "Belum ada nama badan usaha"} · {PROVIDER_LABEL[p.provider]}</p>
            <p className={s.boxText}><Badge tone={st.tone} /> {st.reasons.join("; ")}</p>
            <dl className={s.cardMeta}>
              <dt>Antre</dt><dd>{showCount(p.open)}</dd><dt>Tertua</dt><dd>{age(p.oldestSeconds)}</dd>
              <dt>Gagal 1 jam</dt><dd>{rate(p.provider, p.failed1h, p.attempts1h)}</dd><dt>Gagal 24 jam</dt><dd>{showFailed(p.provider, p.failed24h)}</dd>
              <dt>Kode</dt><dd>{codesText(p)}</dd><dt>Aktivitas terakhir</dt><dd>{when(p.lastActivity)}</dd>
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function HealthView({ state }: { state: ViewState }) {
  const head = <><h1 className={s.title}>Kesehatan Platform</h1><p className={s.lead}>Antrean, kegagalan dan aktivitas per klinik dan penyedia — hanya jumlah, umur dan kode; tanpa data pasien atau isi pesan.</p></>;
  switch (state.kind) {
    case "permission":
      return <div className={s.page}>{head}<div className={s.box} role="status"><p className={s.boxText}>Anda tidak memiliki akses ke Kesehatan Platform.</p></div></div>;
    case "error":
      return (
        <div className={s.page}>{head}
          <div className={s.box} role="alert"><p className={s.boxText}>Data kesehatan belum dapat dimuat.</p>
            <Link prefetch={false} href="/vendor/kesehatan" className={s.plain}>Coba Lagi</Link></div>
        </div>
      );
    case "empty":
      return <div className={s.page}>{head}<Summary h={state.health} /><div className={s.box} role="status"><p className={s.boxMuted}>Belum ada klinik.</p></div></div>;
    case "filtered-empty":
      return (
        <div className={s.page}>{head}<Summary h={state.health} /><Filters f={state.filter} />
          <div className={s.box} role="status"><p className={s.boxMuted}>Tidak ada klinik untuk filter ini.</p>
            <Link prefetch={false} href="/vendor/kesehatan" className={s.plain}>Hapus Filter</Link></div>
        </div>
      );
    case "ok":
      return (
        <div className={s.page}>{head}
          <p className={s.help}>Diperbarui {when(state.health.at)}. Ambang OBS-4: antrean tertua &gt; 15 menit, kegagalan SATUSEHAT &gt; 5% per jam.</p>
          <Summary h={state.health} /><Filters f={state.filter} /><Rows rows={state.rows} />
        </div>
      );
  }
}
