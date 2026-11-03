// Tenant list body (UX-40; the error state is error.tsx). Pure: rows in, markup out (tests render it with a hostile
// tenant name to prove names are escaped, SEC-21). Tenant names are tenant-controlled
// strings and are only ever React text children.
import s from "../_lib/console.module.css";

export type TenantRow = { id: string; state: State; name: string | null; branches: number };
type State = "provisioning" | "onboarding" | "live" | "suspended" | "exit" | "closed";

// TEN-12 states in Bahasa Indonesia.
const STATE: Record<State, { label: string; tone: string }> = {
  provisioning: { label: "Penyiapan", tone: s.toneNeutral },
  onboarding: { label: "Onboarding", tone: s.toneWarning },
  live: { label: "Aktif", tone: s.toneSuccess },
  suspended: { label: "Ditangguhkan", tone: s.toneDanger },
  exit: { label: "Proses keluar", tone: s.toneWarning },
  closed: { label: "Ditutup", tone: s.toneNeutral },
};

const NO_NAME = "Belum ada nama badan usaha";
const count = new Intl.NumberFormat("id-ID");

export function TenantList({ rows }: { rows: TenantRow[] }) {
  return (
    <>
      {rows.length === 0 ? (
        <div className={s.box} role="status">
          <p className={s.boxMuted}>Belum ada tenant.</p>
        </div>
      ) : (
        <>
          <p className={s.lead}>{count.format(rows.length)} tenant</p>
          <div className={s.tableWrap} role="region" aria-label="Daftar tenant" tabIndex={0}>
            <table className={s.table}>
              <caption className="sr-only">Daftar tenant</caption>
              <thead>
                <tr>
                  <th scope="col">Klinik</th>
                  <th scope="col">Status</th>
                  <th scope="col" className={s.num}>
                    Cabang
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <th scope="row">{t.name ?? NO_NAME}</th>
                    <td>
                      <span className={`${s.badge} ${STATE[t.state].tone}`}>{STATE[t.state].label}</span>
                    </td>
                    <td className={s.num}>{count.format(t.branches)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className={s.cards} aria-label="Daftar tenant">
            {rows.map((t) => (
              <li key={t.id} className={s.card}>
                <p className={s.cardTitle}>{t.name ?? NO_NAME}</p>
                <dl className={s.cardMeta}>
                  <dt>Status</dt>
                  <dd>
                    <span className={`${s.badge} ${STATE[t.state].tone}`}>{STATE[t.state].label}</span>
                  </dd>
                </dl>
                <dl className={s.cardMeta}>
                  <dt>Cabang</dt>
                  <dd className={s.num}>{count.format(t.branches)}</dd>
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
